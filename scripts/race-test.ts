#!/usr/bin/env node
/**
 * 동시 신청 경쟁 테스트 (실제 Postgres 필요 — PGlite는 단일 연결이라 재현 불가)
 *
 *   RACE_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
 *     node scripts/race-test.ts --confirm-dev-db
 *
 * - 대상: supabase/migrations가 적용된 **로컬 또는 개발용** Supabase DB. 운영 DB에 실행하지 않는다.
 * - 하는 일: 임시 사용자(auth.users)와 모임을 만들고, N개 연결에서 서로 다른 사용자로 동시에
 *   apply_to_meeting을 호출한다. 남은 자리 수만큼만 confirmed가 되는지, 카운트가 실제 행 집계와 같은지,
 *   정원을 넘지 않는지 확인한 뒤 만든 데이터를 지운다(--keep이면 남긴다).
 * - 시나리오: (A) 대기 불가 → 나머지는 MEETING_FULL, (B) 대기 허용 → 나머지는 waitlisted,
 *            (C) 승인제 → 모두 pending 후 모임장이 동시에 승인 → 자리 수만큼만 confirmed.
 * - 환경 변수: RACE_TEST_DATABASE_URL(필수), RACE_TEST_CONCURRENCY(기본 20), RACE_TEST_SEATS(남은 자리, 기본 1)
 * - 연결 문자열은 로컬 env로만 넘기고 커밋하지 않는다. 연결 역할은 auth.users에 insert 할 수 있어야 한다(postgres).
 * - 종료 코드: 통과 0, 실패 1. RACE_TEST_DATABASE_URL이 없으면 BLOCKED 안내 후 0.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';

type Client = InstanceType<typeof pg.Client>;

const url = process.env.RACE_TEST_DATABASE_URL;
const args = new Set(process.argv.slice(2));

console.warn('[race-test] 경고: 운영(production) DB에 실행하지 마세요. 임시 사용자·모임을 만들고 지웁니다.');

if (!url) {
  console.log('BLOCKED: RACE_TEST_DATABASE_URL 필요 (로컬/개발용 Supabase DB 연결 문자열). 테스트를 실행하지 않았습니다.');
  process.exit(0);
}
if (!args.has('--confirm-dev-db')) {
  console.error('[race-test] 개발용 DB임을 확인했다면 --confirm-dev-db 인자를 붙여 다시 실행하세요.');
  process.exit(1);
}

const concurrency = clampInt(process.env.RACE_TEST_CONCURRENCY, 20, 2, 200);
const seats = clampInt(process.env.RACE_TEST_SEATS, 1, 1, 29);
const keep = args.has('--keep');
const runId = randomUUID().slice(0, 8);

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = raw === undefined ? fallback : Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

async function connect(): Promise<Client> {
  const client = new pg.Client({ connectionString: url, application_name: `hanpan-race-test-${runId}` });
  await client.connect();
  return client;
}

/** 로그인 사용자로 한 트랜잭션 실행(PostgREST와 같은 방식: set local role + request.jwt.claims). */
async function asUser<T>(client: Client, userId: string, fn: () => Promise<T>): Promise<T> {
  await client.query('begin');
  try {
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: 'authenticated', aud: 'authenticated' }),
    ]);
    await client.query('set local role authenticated');
    const result = await fn();
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  }
}

interface Outcome {
  userId: string;
  status?: string;
  error?: string;
}

const createdUsers: string[] = [];
const createdMeetings: string[] = [];

async function createUsers(admin: Client, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = randomUUID();
    await admin.query(
      `insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
       values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, '{}'::jsonb, '{}'::jsonb, now(), now())`,
      [id, `race-${runId}-${i}@example.invalid`],
    );
    createdUsers.push(id);
    ids.push(id);
  }
  await admin.query(
    `update public.user_private set terms_agreed_at = now(), privacy_agreed_at = now() where user_id = any($1::uuid[])`,
    [ids],
  );
  return ids;
}

async function createMeeting(admin: Client, hostId: string, options: { waitlist: boolean; manual: boolean }): Promise<string> {
  const startAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const meetingId = await asUser(admin, hostId, async () => {
    const result = await admin.query<{ id: string }>('select public.create_meeting($1::jsonb) as id', [
      JSON.stringify({
        category_id: 'party',
        title: `[race-test] ${runId}`,
        start_at: startAt,
        duration_minutes: 120,
        region_code: 'dunsan_tanbang',
        min_participants: 2,
        max_participants: seats + 1,
        skill_level: 'anyone',
        approval_mode: options.manual ? 'manual' : 'auto',
        allow_waitlist: options.waitlist,
      }),
    ]);
    return result.rows[0]?.id;
  });
  if (!meetingId) throw new Error('모임 생성 실패');
  createdMeetings.push(meetingId);
  return meetingId;
}

/** 모든 연결이 트랜잭션·역할 설정을 마친 뒤 같은 순간에 호출을 보낸다. */
async function fireConcurrently(
  clients: Client[],
  userIds: string[],
  sql: (index: number) => { text: string; values: unknown[] },
): Promise<Outcome[]> {
  await Promise.all(
    clients.map(async (client, index) => {
      await client.query('begin');
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: userIds[index], role: 'authenticated', aud: 'authenticated' }),
      ]);
      await client.query('set local role authenticated');
    }),
  );
  return Promise.all(
    clients.map(async (client, index): Promise<Outcome> => {
      const userId = userIds[index] ?? '';
      try {
        const { text, values } = sql(index);
        const result = await client.query<{ status: string }>(text, values);
        await client.query('commit');
        return { userId, status: result.rows[0]?.status };
      } catch (error) {
        await client.query('rollback').catch(() => undefined);
        return { userId, error: (error as { message?: string }).message ?? String(error) };
      }
    }),
  );
}

async function verifyCounts(admin: Client, meetingId: string): Promise<string[]> {
  const { rows } = await admin.query<{
    confirmed_count: number;
    pending_count: number;
    waitlist_count: number;
    max_participants: number;
    c: number;
    p: number;
    w: number;
  }>(
    `select m.confirmed_count, m.pending_count, m.waitlist_count, m.max_participants,
            count(*) filter (where mp.status = 'confirmed')::int as c,
            count(*) filter (where mp.status = 'pending')::int as p,
            count(*) filter (where mp.status = 'waitlisted')::int as w
     from public.meetings m
     left join public.meeting_participants mp on mp.meeting_id = m.id
     where m.id = $1
     group by m.id`,
    [meetingId],
  );
  const row = rows[0];
  if (!row) return ['모임 행 없음'];
  const problems: string[] = [];
  if (row.confirmed_count !== row.c) problems.push(`confirmed_count ${row.confirmed_count} != 실제 ${row.c}`);
  if (row.pending_count !== row.p) problems.push(`pending_count ${row.pending_count} != 실제 ${row.p}`);
  if (row.waitlist_count !== row.w) problems.push(`waitlist_count ${row.waitlist_count} != 실제 ${row.w}`);
  if (row.c > row.max_participants) problems.push(`정원 초과: 확정 ${row.c} > 정원 ${row.max_participants}`);
  if (row.c !== seats + 1) problems.push(`확정 인원 ${row.c} != 기대 ${seats + 1}(모임장 포함)`);
  return problems;
}

function tally(outcomes: Outcome[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const outcome of outcomes) {
    const key = outcome.status ?? `error:${outcome.error}`;
    result[key] = (result[key] ?? 0) + 1;
  }
  return result;
}

async function scenario(
  name: string,
  admin: Client,
  clients: Client[],
  hostId: string,
  guestIds: string[],
  options: { waitlist: boolean; manual: boolean },
): Promise<string[]> {
  const meetingId = await createMeeting(admin, hostId, options);
  const problems: string[] = [];
  let outcomes = await fireConcurrently(clients, guestIds, () => ({
    text: 'select public.apply_to_meeting($1, null) as status',
    values: [meetingId],
  }));
  let summary = tally(outcomes);

  if (options.manual) {
    // 모두 pending이어야 한다. 이어서 모임장이 여러 연결에서 동시에 전원 승인을 시도한다.
    if (summary.pending !== guestIds.length) problems.push(`승인제 신청 결과가 모두 pending이 아님: ${JSON.stringify(summary)}`);
    const { rows } = await admin.query<{ id: string }>(
      `select id from public.meeting_participants where meeting_id = $1 and role = 'guest' order by id`,
      [meetingId],
    );
    const participantIds = rows.map((r) => r.id);
    outcomes = await fireConcurrently(
      clients.slice(0, participantIds.length),
      participantIds.map(() => hostId),
      (index) => ({ text: `select public.decide_participant($1, 'approve') as status`, values: [participantIds[index]] }),
    );
    summary = tally(outcomes);
    const confirmed = summary.confirmed ?? 0;
    const full = summary['error:MEETING_FULL'] ?? 0;
    if (confirmed !== seats) problems.push(`승인 성공 ${confirmed} != 자리 ${seats}`);
    if (confirmed + full !== participantIds.length) problems.push(`예상 밖 승인 결과: ${JSON.stringify(summary)}`);
  } else {
    const confirmed = summary.confirmed ?? 0;
    const rest = options.waitlist ? (summary.waitlisted ?? 0) : (summary['error:MEETING_FULL'] ?? 0);
    if (confirmed !== seats) problems.push(`확정 ${confirmed} != 자리 ${seats}`);
    if (confirmed + rest !== guestIds.length) problems.push(`예상 밖 결과: ${JSON.stringify(summary)}`);
  }

  problems.push(...(await verifyCounts(admin, meetingId)));
  console.log(`[race-test] ${name}: ${JSON.stringify(summary)} → ${problems.length === 0 ? '통과' : '실패'}`);
  return problems.map((p) => `${name}: ${p}`);
}

async function cleanup(admin: Client): Promise<void> {
  if (keep) {
    console.log(`[race-test] --keep: 데이터를 남깁니다(run ${runId}, 이메일 race-${runId}-*@example.invalid).`);
    return;
  }
  // 모임을 먼저 지운다(host_id는 on delete set null이라 사용자 삭제만으로는 모임이 남는다).
  if (createdMeetings.length > 0) {
    await admin.query('delete from public.meetings where id = any($1::uuid[])', [createdMeetings]);
    await admin.query('delete from public.audit_logs where target_id = any($1::text[])', [createdMeetings]);
  }
  if (createdUsers.length > 0) {
    await admin.query('delete from public.audit_logs where actor_id = any($1::uuid[])', [createdUsers]);
    await admin.query('delete from auth.users where id = any($1::uuid[])', [createdUsers]);
  }
  console.log('[race-test] 임시 데이터 삭제 완료');
}

async function main(): Promise<number> {
  const admin = await connect();
  const clients: Client[] = [];
  try {
    const check = await admin.query<{ fn: string | null; users: string | null }>(
      `select to_regprocedure('public.apply_to_meeting(uuid, text)')::text as fn, to_regclass('auth.users')::text as users`,
    );
    if (!check.rows[0]?.fn || !check.rows[0]?.users) {
      console.error('[race-test] apply_to_meeting 또는 auth.users가 없습니다. 마이그레이션을 먼저 적용하세요.');
      return 1;
    }
    console.log(`[race-test] run ${runId}: 동시 연결 ${concurrency}개, 남은 자리 ${seats}`);

    const [hostId, ...guestIds] = await createUsers(admin, concurrency + 1);
    if (!hostId) throw new Error('사용자 생성 실패');
    for (let i = 0; i < concurrency; i += 1) clients.push(await connect());

    const problems = [
      ...(await scenario('A 대기 불가', admin, clients, hostId, guestIds, { waitlist: false, manual: false })),
      ...(await scenario('B 대기 허용', admin, clients, hostId, guestIds, { waitlist: true, manual: false })),
      ...(await scenario('C 승인제 동시 승인', admin, clients, hostId, guestIds, { waitlist: true, manual: true })),
    ];
    if (problems.length > 0) {
      console.error('[race-test] 실패:');
      for (const problem of problems) console.error(`  - ${problem}`);
      return 1;
    }
    console.log('[race-test] 통과: 정원 초과 없음, 카운트 = 실제 행 집계');
    return 0;
  } finally {
    await Promise.all(clients.map((client) => client.end().catch(() => undefined)));
    await cleanup(admin).catch((error: unknown) => console.error('[race-test] 정리 실패:', error));
    await admin.end();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error('[race-test] 오류:', (error as { message?: string }).message ?? error);
    process.exit(1);
  },
);
