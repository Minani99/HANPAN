/**
 * PGlite 기반 DB 테스트 하네스.
 *
 * 1) PGlite(WASM Postgres) 인스턴스에 Supabase 스텁을 만든다:
 *    역할(anon, authenticated, service_role, supabase_auth_admin), auth 스키마, auth.users,
 *    auth.uid()/auth.role()/auth.jwt(), Supabase의 public 스키마 기본 권한(default privileges).
 * 2) supabase/migrations/*.sql을 파일명 순서로 적용한다.
 * 3) 마이그레이션까지 끝난 인스턴스를 템플릿으로 캐시하고, 테스트마다 clone()으로 독립된 DB를 준다.
 *
 * 역할 전환은 트랜잭션 단위다: `set local role` + `set_config('request.jwt.claims', ..., true)`.
 * 트랜잭션이 끝나면 역할·claims가 자동으로 원래대로 돌아간다.
 *
 * 주의: PGlite의 기본 사용자 postgres는 superuser다(Supabase의 postgres는 superuser가 아니지만
 * 테이블·함수 소유자라서 security definer 함수가 RLS를 우회하는 점은 같다).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite, type PGliteInterface, type Transaction } from '@electric-sql/pglite';

const here = dirname(fileURLToPath(import.meta.url));
export const SUPABASE_DIR = join(here, '..');
export const MIGRATIONS_DIR = join(SUPABASE_DIR, 'migrations');

/** Supabase가 제공하는 객체의 최소 스텁. 마이그레이션은 이 객체들을 만들지 않는다. */
export const SUPABASE_STUB_SQL = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role supabase_auth_admin nologin noinherit;

create schema auth;
create table auth.users (
  instance_id uuid,
  id uuid primary key,
  aud text,
  role text,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Supabase auth.uid()/auth.role()와 같은 정의: 옛 GUC(request.jwt.claim.sub)와
-- 새 GUC(request.jwt.claims JSON)를 모두 읽는다. 각각 nullif('')를 거쳐야 한다 —
-- 한 번 설정됐다가 롤백된 GUC는 null이 아니라 ''로 남기 때문.
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;
grant execute on all functions in schema auth to anon, authenticated, service_role, supabase_auth_admin;
grant select, insert, update, delete on auth.users to supabase_auth_admin;

-- Supabase 기본 권한 흉내: public에 새로 만드는 객체를 API 역할에 모두 준다.
-- 마이그레이션 2가 이것을 회수하는지까지 테스트가 검증한다.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/.test(name))
    .sort()
    .map((name) => join(MIGRATIONS_DIR, name));
}

export function readSql(path: string): string {
  return readFileSync(path, 'utf8');
}

/** 스텁 + 마이그레이션 적용. 템플릿을 쓰지 않는 테스트(마이그레이션 자체 검증)에서 직접 부른다. */
export async function createMigratedPglite(): Promise<PGliteInterface> {
  const db = await PGlite.create();
  await db.exec(SUPABASE_STUB_SQL);
  for (const file of migrationFiles()) {
    try {
      await db.exec(readSql(file));
    } catch (error) {
      throw new Error(`마이그레이션 실패: ${file}: ${(error as Error).message}`, { cause: error });
    }
  }
  return db;
}

let templatePromise: Promise<PGliteInterface> | null = null;

/** 테스트마다 독립된 DB(마이그레이션 적용된 템플릿의 복제본). */
export async function createTestDb(): Promise<TestDb> {
  templatePromise ??= createMigratedPglite();
  const template = await templatePromise;
  return new TestDb(await template.clone());
}

// ---------------------------------------------------------------------------
// 쿼리 도우미
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

export interface Q {
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Row>(sql: string, params?: unknown[]): Promise<T>;
  /** 한 행 한 열 값 */
  value<T = unknown>(sql: string, params?: unknown[]): Promise<T>;
  exec(sql: string): Promise<void>;
}

function wrap(tx: Transaction): Q {
  const q: Q = {
    async query<T>(sql: string, params: unknown[] = []) {
      const result = await tx.query<T>(sql, params);
      return result.rows;
    },
    async one<T>(sql: string, params: unknown[] = []) {
      const rows = await q.query<T>(sql, params);
      if (rows.length !== 1) throw new Error(`한 행을 기대했지만 ${rows.length}행: ${sql}`);
      return rows[0] as T;
    },
    async value<T>(sql: string, params: unknown[] = []) {
      const row = await q.one<Row>(sql, params);
      const values = Object.values(row);
      if (values.length !== 1) throw new Error(`한 열을 기대했지만 ${values.length}열: ${sql}`);
      return values[0] as T;
    },
    async exec(sql: string) {
      await tx.exec(sql);
    },
  };
  return q;
}

export interface CreateUserOptions {
  /** 지정하면 온보딩(닉네임·약관 동의)까지 끝낸 상태로 만든다. 기본: 자동 닉네임 + 온보딩 완료 */
  nickname?: string;
  /** false면 가입 직후(약관 동의 전) 상태 */
  onboarded?: boolean;
  admin?: boolean;
  status?: 'active' | 'restricted' | 'deletion_requested';
  email?: string;
  metadata?: Record<string, unknown>;
}

export interface MeetingFixture {
  hostId: string;
  startAt?: Date | string;
  durationMinutes?: number;
  title?: string;
  categoryId?: string;
  regionCode?: string;
  gameName?: string | null;
  venueId?: string | null;
  venueNote?: string | null;
  minParticipants?: number;
  maxParticipants?: number;
  approvalMode?: 'auto' | 'manual';
  allowWaitlist?: boolean;
  status?: 'open' | 'closed' | 'cancelled';
  isHidden?: boolean;
  createdAt?: Date | string;
}

let userSeq = 0;

export class TestDb {
  readonly pg: PGliteInterface;

  constructor(pg: PGliteInterface) {
    this.pg = pg;
  }

  close(): Promise<void> {
    return this.pg.close();
  }

  /** 마이그레이션 실행 역할(테이블·함수 소유자) 권한. 픽스처 준비·검증용. */
  asOwner<T>(fn: (q: Q) => Promise<T>): Promise<T> {
    return this.pg.transaction((tx) => fn(wrap(tx)));
  }

  /** PostgREST의 anon 요청과 같은 상태(JWT role=anon, sub 없음). */
  asAnon<T>(fn: (q: Q) => Promise<T>): Promise<T> {
    return this.pg.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'anon' })]);
      await tx.query('set local role anon');
      return fn(wrap(tx));
    });
  }

  /** PostgREST의 로그인 사용자 요청과 같은 상태(JWT sub=userId, role=authenticated). */
  asUser<T>(userId: string, fn: (q: Q) => Promise<T>): Promise<T> {
    return this.pg.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: userId, role: 'authenticated', aud: 'authenticated' }),
      ]);
      await tx.query('set local role authenticated');
      return fn(wrap(tx));
    });
  }

  /** 사용자 RPC 한 번 호출(asUser + select fn(...)) — 결과 한 열 값을 돌려준다. */
  rpc<T = unknown>(userId: string | null, sql: string, params: unknown[] = []): Promise<T> {
    const run = (q: Q) => q.value<T>(sql, params);
    return userId === null ? this.asAnon(run) : this.asUser(userId, run);
  }

  /**
   * 가입(auth.users insert → handle_new_user 트리거) 후 옵션에 따라 온보딩·관리자·상태를 맞춘다.
   * auth.users insert는 Supabase처럼 supabase_auth_admin 역할로 한다.
   */
  async createUser(options: CreateUserOptions = {}): Promise<string> {
    userSeq += 1;
    const id = await this.asOwner((q) => q.value<string>('select gen_random_uuid()'));
    await this.pg.transaction(async (tx) => {
      await tx.query('set local role supabase_auth_admin');
      await tx.query(
        `insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
         values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, '{}'::jsonb, $3::jsonb)`,
        [id, options.email ?? `user${userSeq}@example.test`, JSON.stringify(options.metadata ?? {})],
      );
    });
    const onboarded = options.onboarded ?? true;
    if (onboarded) {
      const nickname = options.nickname ?? `user${userSeq}x${id.slice(0, 6)}`;
      await this.asUser(id, (q) =>
        q.query('select public.update_my_profile($1::jsonb)', [
          JSON.stringify({ nickname, agree_terms: true, agree_privacy: true }),
        ]),
      );
    }
    if (options.admin) {
      await this.asOwner((q) => q.query('insert into public.admin_roles (user_id) values ($1)', [id]));
    }
    if (options.status && options.status !== 'active') {
      await this.asOwner((q) => q.query('update public.profiles set status = $2 where id = $1', [id, options.status]));
    }
    return id;
  }

  /**
   * 소유자 권한으로 모임을 직접 넣는다(과거·진행 중 등 RPC로 만들 수 없는 시각 픽스처용).
   * 모임장 참가 행도 함께 넣고 카운트는 1/0/0.
   */
  async insertMeeting(f: MeetingFixture): Promise<string> {
    const startAt = toIso(f.startAt ?? hoursFromNow(48));
    const duration = f.durationMinutes ?? 120;
    const status = f.status ?? 'open';
    return this.asOwner(async (q) => {
      const id = await q.value<string>(
        `insert into public.meetings (
           host_id, category_id, game_name, title, description, start_at, end_at, duration_minutes,
           region_code, venue_id, venue_note, min_participants, max_participants, skill_level, approval_mode,
           allow_waitlist, status, is_hidden, cancelled_at, created_at
         ) values (
           $1::uuid, $2::text, $3::text, $4::text, '', $5::timestamptz, $5::timestamptz + make_interval(mins => $6::int), $6::int,
           $7::text, $8::uuid, $9::text, $10::int, $11::int, 'anyone', $12::public.approval_mode,
           $13::boolean, $14::public.meeting_status, $15::boolean,
           case when $14::public.meeting_status = 'cancelled' then now() end, coalesce($16::timestamptz, now())
         ) returning id`,
        [
          f.hostId,
          f.categoryId ?? 'party',
          f.gameName ?? null,
          f.title ?? '테스트 모임',
          startAt,
          duration,
          f.regionCode ?? 'dunsan_tanbang',
          f.venueId ?? null,
          f.venueNote ?? null,
          f.minParticipants ?? 2,
          f.maxParticipants ?? 4,
          f.approvalMode ?? 'auto',
          f.allowWaitlist ?? true,
          status,
          f.isHidden ?? false,
          f.createdAt ? toIso(f.createdAt) : null,
        ],
      );
      await q.query(
        `insert into public.meeting_participants (meeting_id, user_id, role, status, confirmed_at)
         values ($1, $2, 'host', 'confirmed', now())`,
        [id, f.hostId],
      );
      return id;
    });
  }

  /** 소유자 권한으로 참가 행을 직접 넣고 카운트를 맞춘다(시작된 모임의 확정자 픽스처 등). */
  async insertParticipant(meetingId: string, userId: string, status: string): Promise<string> {
    return this.asOwner(async (q) => {
      const id = await q.value<string>(
        `insert into public.meeting_participants (meeting_id, user_id, role, status, confirmed_at)
         values ($1::uuid, $2::uuid, 'guest', $3::public.participant_status, case when $3::public.participant_status = 'confirmed' then now() end)
         returning id`,
        [meetingId, userId, status],
      );
      await q.query('select public._sync_meeting_counts($1)', [meetingId]);
      return id;
    });
  }

  /** 소유자 권한으로 모임의 시각을 옮긴다(신청 후 모임이 시작된 상황 등). */
  async moveMeeting(meetingId: string, startAt: Date | string, durationMinutes = 120): Promise<void> {
    await this.asOwner((q) =>
      q.query(
        `update public.meetings
         set start_at = $2::timestamptz, end_at = $2::timestamptz + make_interval(mins => $3), duration_minutes = $3
         where id = $1`,
        [meetingId, toIso(startAt), durationMinutes],
      ),
    );
  }

  async meetingCounts(meetingId: string): Promise<Counts> {
    return this.asOwner((q) =>
      q.one<Counts>(
        `select confirmed_count as confirmed, pending_count as pending, waitlist_count as waitlisted,
                remaining_seats as remaining
         from public.meetings where id = $1`,
        [meetingId],
      ),
    );
  }

  async participantStatus(meetingId: string, userId: string): Promise<string | null> {
    const rows = await this.asOwner((q) =>
      q.query<{ status: string }>(
        'select status from public.meeting_participants where meeting_id = $1 and user_id = $2',
        [meetingId, userId],
      ),
    );
    return rows[0]?.status ?? null;
  }

  /** 카운트 = 실제 행 집계 불변식. 어긋난 모임 id 목록(비어 있어야 함). */
  async countMismatches(): Promise<string[]> {
    const rows = await this.asOwner((q) =>
      q.query<{ id: string }>(
        `select m.id
         from public.meetings m
         left join lateral (
           select count(*) filter (where mp.status = 'confirmed') as c,
                  count(*) filter (where mp.status = 'pending') as p,
                  count(*) filter (where mp.status = 'waitlisted') as w
           from public.meeting_participants mp where mp.meeting_id = m.id
         ) agg on true
         where m.confirmed_count <> agg.c or m.pending_count <> agg.p or m.waitlist_count <> agg.w
            or m.confirmed_count > m.max_participants`,
      ),
    );
    return rows.map((row) => row.id);
  }
}

export interface Counts {
  confirmed: number;
  pending: number;
  waitlisted: number;
  remaining: number;
}

// ---------------------------------------------------------------------------
// 시각·입력 도우미
// ---------------------------------------------------------------------------

export function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

export function hoursFromNow(hours: number): Date {
  return minutesFromNow(hours * 60);
}

export function daysFromNow(days: number): Date {
  return hoursFromNow(days * 24);
}

export function toIso(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString();
}

/** create_meeting 입력(p jsonb) 기본값. 필요한 키만 덮어쓴다. */
export function meetingInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    category_id: 'party',
    title: '퇴근 후 보드게임 한 판',
    description: '가볍게 즐겨요',
    start_at: hoursFromNow(48).toISOString(),
    duration_minutes: 120,
    region_code: 'dunsan_tanbang',
    min_participants: 2,
    max_participants: 4,
    skill_level: 'anyone',
    approval_mode: 'auto',
    allow_waitlist: true,
    ...overrides,
  };
}

/** RPC로 모임을 만든다. */
export async function createMeetingRpc(db: TestDb, hostId: string, overrides: Record<string, unknown> = {}): Promise<string> {
  return db.rpc<string>(hostId, 'select public.create_meeting($1::jsonb)', [JSON.stringify(meetingInput(overrides))]);
}

export async function apply(db: TestDb, userId: string, meetingId: string, message: string | null = null): Promise<string> {
  return db.rpc<string>(userId, 'select public.apply_to_meeting($1, $2)', [meetingId, message]);
}

// ---------------------------------------------------------------------------
// 오류 검사
// ---------------------------------------------------------------------------

export interface DbErrorShape {
  code?: string;
  message?: string;
  detail?: string;
}

/** RPC가 errcode P0001 + message=<code>로 실패했는지. detail까지 확인하려면 두 번째 인자. */
export async function expectRpcError(promise: Promise<unknown>, code: string, detail?: string): Promise<DbErrorShape> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  if (!caught) throw new Error(`오류 ${code}를 기대했지만 성공했습니다`);
  const err = caught as DbErrorShape;
  if (err.code !== 'P0001' || err.message !== code) {
    throw new Error(`오류 ${code}를 기대했지만 code=${err.code} message=${err.message} detail=${err.detail}`);
  }
  if (detail !== undefined && err.detail !== detail) {
    throw new Error(`오류 ${code}의 detail=${detail}를 기대했지만 detail=${err.detail}`);
  }
  return err;
}

/** 권한 거부(42501: GRANT 없음 또는 RLS with check 위반). */
export async function expectPermissionDenied(promise: Promise<unknown>): Promise<DbErrorShape> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  if (!caught) throw new Error('권한 오류(42501)를 기대했지만 성공했습니다');
  const err = caught as DbErrorShape;
  if (err.code !== '42501') {
    throw new Error(`권한 오류(42501)를 기대했지만 code=${err.code} message=${err.message}`);
  }
  return err;
}

/** 임의 SQLSTATE 오류(예: 23514 check 위반). */
export async function expectSqlState(promise: Promise<unknown>, sqlState: string): Promise<DbErrorShape> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  if (!caught) throw new Error(`SQLSTATE ${sqlState}를 기대했지만 성공했습니다`);
  const err = caught as DbErrorShape;
  if (err.code !== sqlState) {
    throw new Error(`SQLSTATE ${sqlState}를 기대했지만 code=${err.code} message=${err.message}`);
  }
  return err;
}
