/**
 * 마이그레이션 결과 구조 검사: 기준 데이터, RLS 활성화, 테이블·컬럼·함수 권한 매트릭스, 제약조건, 트리거.
 * 권한 매트릭스는 docs/DB_SCHEMA.md §7, docs/SECURITY.md §3과 같아야 한다.
 */
import { basename } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestDb,
  expectSqlState,
  hoursFromNow,
  migrationFiles,
  readSql,
  type TestDb,
} from './harness';

let db: TestDb;
beforeEach(async () => {
  db = await createTestDb();
});
afterEach(async () => {
  await db.close();
});

const PUBLIC_TABLES = [
  'admin_roles',
  'audit_logs',
  'categories',
  'games',
  'meeting_participants',
  'meetings',
  'profiles',
  'regions',
  'reports',
  'user_private',
  'venues',
];

describe('마이그레이션 파일', () => {
  it('YYYYMMDDHHMMSS_name.sql 9개가 정해진 순서로 있다', () => {
    expect(migrationFiles().map((file) => basename(file))).toEqual([
      '20261124000100_schema.sql',
      '20261124000200_access_control.sql',
      '20261124000300_functions.sql',
      '20261124000400_reference_data.sql',
      '20261124000500_nickname_rules.sql',
      '20261124000600_venues_read.sql',
      '20261124000700_admin_tools.sql',
      '20261124000800_nickname_rules_v2.sql',
      '20261124000900_admin_requires_active.sql',
    ]);
  });

  it('auth 스키마를 만들지 않고 seed 마커·예시 데이터를 담지 않는다', () => {
    for (const file of migrationFiles()) {
      const sql = readSql(file);
      expect(sql).not.toMatch(/create\s+schema\s+(if\s+not\s+exists\s+)?auth/i);
      expect(sql).not.toMatch(/create\s+table\s+auth\./i);
      expect(sql).not.toMatch(/insert\s+into\s+auth\./i);
      expect(sql).not.toMatch(/create\s+extension/i);
      expect(sql).not.toContain('HANPAN_DEV_SEED_MARKER');
      expect(sql).not.toContain('[예시]');
    }
  });
});

describe('기준 데이터', () => {
  it('권역 6개·카테고리 6개가 정렬 순서대로 들어 있다', async () => {
    const regions = await db.asAnon((q) => q.query<{ code: string }>('select code from public.regions order by sort_order'));
    expect(regions.map((r) => r.code)).toEqual([
      'dunsan_tanbang',
      'gung_bongmyeong',
      'eunhaeng_daeheung',
      'noeun_jijok',
      'gwanjeo_gasuwon',
      'etc_daejeon',
    ]);
    const categories = await db.asAnon((q) =>
      q.query<{ id: string; description: string }>('select id, description from public.categories order by sort_order'),
    );
    expect(categories.map((c) => c.id)).toEqual([
      'party',
      'deduction',
      'strategy',
      'murder_mystery',
      'mahjong_etc',
      'holdem_social',
    ]);
    expect(categories.find((c) => c.id === 'holdem_social')?.description).toBe(
      '금전·경품을 걸지 않는 홀덤 모임만 열 수 있어요.',
    );
  });

  it('기준 데이터 마이그레이션을 다시 실행해도 중복되지 않는다(멱등)', async () => {
    const file = migrationFiles().find((f) => f.endsWith('_reference_data.sql'));
    if (!file) throw new Error('reference_data 마이그레이션 없음');
    await db.pg.exec(readSql(file));
    const counts = await db.asOwner((q) =>
      q.one<{ r: number; c: number }>(
        'select (select count(*)::int from public.regions) as r, (select count(*)::int from public.categories) as c',
      ),
    );
    expect(counts).toEqual({ r: 6, c: 6 });
  });

  it('마이그레이션만 적용하면 사용자·모임·공간·게임·신고·로그가 0행이다(seed 미유입)', async () => {
    const counts = await db.asOwner((q) =>
      q.one(
        `select (select count(*)::int from auth.users) as users,
                (select count(*)::int from public.profiles) as profiles,
                (select count(*)::int from public.meetings) as meetings,
                (select count(*)::int from public.meeting_participants) as participants,
                (select count(*)::int from public.venues) as venues,
                (select count(*)::int from public.games) as games,
                (select count(*)::int from public.reports) as reports,
                (select count(*)::int from public.admin_roles) as admins,
                (select count(*)::int from public.audit_logs) as logs`,
      ),
    );
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
  });
});

describe('RLS·권한 매트릭스', () => {
  it('public의 모든 테이블에 RLS가 켜져 있다', async () => {
    const rows = await db.asOwner((q) =>
      q.query<{ relname: string; rls: boolean }>(
        `select c.relname, c.relrowsecurity as rls
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind in ('r', 'p') order by c.relname`,
      ),
    );
    expect(rows.map((r) => r.relname)).toEqual(PUBLIC_TABLES);
    expect(rows.every((r) => r.rls)).toBe(true);
  });

  it('anon/authenticated의 테이블 단위 권한이 문서 표와 정확히 일치한다', async () => {
    const rows = await db.asOwner((q) =>
      q.query<{ grant: string }>(
        `select r.rolname || ':' || c.relname || ':' || p.priv as grant
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         cross join (values ('anon'), ('authenticated')) as r (rolname)
         cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as p (priv)
         where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
           and has_table_privilege(r.rolname, c.oid, p.priv)
         order by 1`,
      ),
    );
    const expected = [
      'anon:categories:SELECT',
      'anon:games:SELECT',
      'anon:meetings:SELECT',
      'anon:regions:SELECT',
      'anon:venues:SELECT',
      'authenticated:audit_logs:SELECT',
      'authenticated:categories:DELETE',
      'authenticated:categories:INSERT',
      'authenticated:categories:SELECT',
      'authenticated:categories:UPDATE',
      'authenticated:games:DELETE',
      'authenticated:games:INSERT',
      'authenticated:games:SELECT',
      'authenticated:games:UPDATE',
      'authenticated:meeting_participants:SELECT',
      'authenticated:meetings:SELECT',
      'authenticated:regions:SELECT',
      'authenticated:user_private:SELECT',
      'authenticated:venues:DELETE',
      'authenticated:venues:INSERT',
      'authenticated:venues:SELECT',
      'authenticated:venues:UPDATE',
    ];
    expect(rows.map((r) => r.grant).sort()).toEqual([...expected].sort());
  });

  it('profiles·reports는 컬럼 단위 SELECT만 있다(status·admin_note·handled_by 제외)', async () => {
    const rows = await db.asOwner((q) =>
      q.query<{ grant: string }>(
        `select r.rolname || ':' || c.relname || '.' || a.attname as grant
         from pg_attribute a
         join pg_class c on c.oid = a.attrelid
         join pg_namespace n on n.oid = c.relnamespace
         cross join (values ('anon'), ('authenticated')) as r (rolname)
         where n.nspname = 'public' and c.relname in ('profiles', 'reports')
           and a.attnum > 0 and not a.attisdropped
           and has_column_privilege(r.rolname, c.oid, a.attnum, 'SELECT')
         order by 1`,
      ),
    );
    const profileColumns = ['bio', 'created_at', 'favorite_category_ids', 'id', 'nickname', 'region_code'];
    const reportColumns = [
      'body',
      'created_at',
      'handled_at',
      'id',
      'reason',
      'reporter_id',
      'status',
      'target_meeting_id',
      'target_type',
      'target_user_id',
    ];
    const expected = [
      ...profileColumns.map((c) => `anon:profiles.${c}`),
      ...profileColumns.map((c) => `authenticated:profiles.${c}`),
      ...reportColumns.map((c) => `authenticated:reports.${c}`),
    ];
    expect(rows.map((r) => r.grant).sort()).toEqual(expected.sort());
  });

  it('함수 EXECUTE 권한이 허용 목록과 정확히 일치한다(그 외 함수는 anon/authenticated 실행 불가)', async () => {
    const rows = await db.asOwner((q) =>
      q.query<{ role: string; fn: string }>(
        `select r.rolname as role, p.proname as fn
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         cross join (values ('anon'), ('authenticated')) as r (rolname)
         where n.nspname = 'public' and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
         order by 1, 2`,
      ),
    );
    const publicRead = [
      'get_meeting',
      'get_venue',
      'is_admin',
      'is_meeting_host',
      'list_public_meetings',
      'list_public_venues',
      'meeting_to_json',
      'venue_to_json',
    ];
    const authOnly = [
      'admin_list_categories',
      'admin_list_meetings',
      'admin_list_report_items',
      'admin_list_reports',
      'admin_list_venues',
      'admin_search_users',
      'admin_set_meeting_hidden',
      'admin_set_user_status',
      'admin_update_report',
      'apply_to_meeting',
      'cancel_meeting',
      'cancel_my_application',
      'create_meeting',
      'decide_participant',
      'get_my_participation',
      'get_my_profile',
      'list_meeting_participants',
      'list_my_meetings',
      'mark_attendance',
      'request_account_deletion',
      'set_meeting_recruiting',
      'submit_report',
      'update_meeting',
      'update_my_profile',
    ];
    const actual = rows.map((r) => `${r.role}:${r.fn}`).sort();
    const expected = [
      ...publicRead.map((f) => `anon:${f}`),
      ...publicRead.map((f) => `authenticated:${f}`),
      ...authOnly.map((f) => `authenticated:${f}`),
    ].sort();
    expect(actual).toEqual(expected);
  });

  it('public의 모든 함수가 search_path = public, pg_temp를 고정한다(security definer 포함)', async () => {
    const rows = await db.asOwner((q) =>
      q.query<{ fn: string; definer: boolean; config: string[] | null }>(
        `select p.proname as fn, p.prosecdef as definer, p.proconfig as config
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'`,
      ),
    );
    expect(rows.length).toBeGreaterThan(30);
    const missing = rows.filter((r) => !(r.config ?? []).includes('search_path=public, pg_temp')).map((r) => r.fn);
    expect(missing).toEqual([]);
    const definers = rows.filter((r) => r.definer).map((r) => r.fn);
    expect(definers).toContain('apply_to_meeting');
    expect(definers).toContain('handle_new_user');
    // 공개 목록·상세는 RLS가 적용되도록 security invoker
    expect(definers).not.toContain('list_public_meetings');
    expect(definers).not.toContain('get_meeting');
    expect(definers).not.toContain('meeting_to_json');
    expect(definers).not.toContain('list_public_venues');
    expect(definers).not.toContain('get_venue');
    expect(definers).not.toContain('venue_to_json');
    // 관리자 조회 RPC와 감사 트리거는 definer(관리자 확인은 함수 안에서 is_admin())
    expect(definers).toEqual(expect.arrayContaining(['admin_list_meetings', 'admin_list_venues', '_audit_admin_table_change']));
    // 공간 쓰기 보정 트리거는 요청자 권한(invoker)으로 돈다 — RLS가 먼저 거른다
    expect(definers).not.toContain('_venues_before_write');
  });

  it('스토리지 버킷 등 public 외 스키마에 마이그레이션이 객체를 만들지 않는다', async () => {
    const rows = await db.asOwner((q) =>
      q.query<{ nspname: string }>(
        `select nspname from pg_namespace
         where nspname not like 'pg_%' and nspname not in ('information_schema', 'public', 'auth')
         order by 1`,
      ),
    );
    expect(rows).toEqual([]);
  });
});

describe('제약조건·생성 컬럼', () => {
  it('remaining_seats는 STORED 생성 컬럼이다', async () => {
    const gen = await db.asOwner((q) =>
      q.value<string>(
        `select attgenerated::text from pg_attribute
         where attrelid = 'public.meetings'::regclass and attname = 'remaining_seats'`,
      ),
    );
    expect(gen).toBe('s');
  });

  it('confirmed_count > max_participants는 check 제약이 거부한다(직접 update·insert 모두)', async () => {
    const host = await db.createUser();
    const meetingId = await db.insertMeeting({ hostId: host, maxParticipants: 3 });
    await expectSqlState(
      db.asOwner((q) => q.query('update public.meetings set confirmed_count = 4 where id = $1', [meetingId])),
      '23514',
    );
    await expectSqlState(
      db.asOwner((q) =>
        q.query(
          `insert into public.meetings (host_id, category_id, title, start_at, end_at, duration_minutes, region_code,
             min_participants, max_participants, skill_level, approval_mode, confirmed_count)
           values ($1, 'party', '제약 확인', now() + interval '2 days', now() + interval '2 days 2 hours', 120,
             'dunsan_tanbang', 2, 2, 'anyone', 'auto', 3)`,
          [host],
        ),
      ),
      '23514',
    );
  });

  it('같은 모임·사용자 참가 행은 하나만, 모임장 행도 하나만 허용한다', async () => {
    const host = await db.createUser();
    const guest = await db.createUser();
    const meetingId = await db.insertMeeting({ hostId: host });
    await db.insertParticipant(meetingId, guest, 'pending');
    await expectSqlState(db.insertParticipant(meetingId, guest, 'confirmed'), '23505');
    await expectSqlState(
      db.asOwner((q) =>
        q.query(
          `update public.meeting_participants set role = 'host', status = 'confirmed'
           where meeting_id = $1 and user_id = $2`,
          [meetingId, guest],
        ),
      ),
      '23505',
    );
  });

  it('모임장 행은 confirmed만, game_id·game_name 동시 지정 불가, 취소 상태와 cancelled_at 일치', async () => {
    const host = await db.createUser();
    const meetingId = await db.insertMeeting({ hostId: host });
    await expectSqlState(
      db.asOwner((q) =>
        q.query(
          `update public.meeting_participants set status = 'cancelled' where meeting_id = $1 and role = 'host'`,
          [meetingId],
        ),
      ),
      '23514',
    );
    const gameId = await db.asOwner((q) =>
      q.value<string>(`insert into public.games (name, category_id) values ('카탄', 'strategy') returning id`),
    );
    await expectSqlState(
      db.asOwner((q) =>
        q.query(`update public.meetings set game_id = $2, game_name = '카탄' where id = $1`, [meetingId, gameId]),
      ),
      '23514',
    );
    await expectSqlState(
      db.asOwner((q) => q.query(`update public.meetings set status = 'cancelled' where id = $1`, [meetingId])),
      '23514',
    );
  });

  it('신고 대상 유형과 대상 컬럼이 맞아야 한다', async () => {
    const reporter = await db.createUser();
    const target = await db.createUser();
    await expectSqlState(
      db.asOwner((q) =>
        q.query(
          `insert into public.reports (reporter_id, target_type, target_meeting_id, target_user_id, reason)
           values ($1, 'meeting', null, $2, 'spam')`,
          [reporter, target],
        ),
      ),
      '23514',
    );
  });

  it('공간 링크는 https://만 허용한다', async () => {
    await expectSqlState(
      db.asOwner((q) =>
        q.query(
          `insert into public.venues (name, region_code, address, venue_type, website_url)
           values ('공간', 'dunsan_tanbang', '주소', 'other', 'http://example.com')`,
        ),
      ),
      '23514',
    );
  });

  it('updated_at 트리거가 갱신 시각을 바꾼다', async () => {
    const host = await db.createUser();
    const meetingId = await db.insertMeeting({ hostId: host, startAt: hoursFromNow(30) });
    await db.asOwner((q) =>
      q.query(`update public.meetings set updated_at = now() - interval '1 day' where id = $1`, [meetingId]),
    );
    const before = await db.asOwner((q) =>
      q.value<string>('select updated_at::text from public.meetings where id = $1', [meetingId]),
    );
    await db.asOwner((q) => q.query(`update public.meetings set title = '바뀐 제목' where id = $1`, [meetingId]));
    const after = await db.asOwner((q) =>
      q.value<string>('select updated_at::text from public.meetings where id = $1', [meetingId]),
    );
    expect(after).not.toBe(before);
  });
});

describe('가입 트리거 handle_new_user', () => {
  it('auth.users insert 시 profiles(임시 닉네임, active)·user_private를 만들고 메타데이터를 복사하지 않는다', async () => {
    const id = await db.createUser({
      onboarded: false,
      email: 'real.name@example.test',
      metadata: { full_name: '홍길동', name: '홍길동', avatar_url: 'https://example.test/a.png' },
    });
    const profile = await db.asOwner((q) =>
      q.one<{ nickname: string; status: string; bio: string; region_code: string | null }>(
        'select nickname, status, bio, region_code from public.profiles where id = $1',
        [id],
      ),
    );
    expect(profile.nickname).toMatch(/^플레이어\d{6}$/);
    expect(profile.status).toBe('active');
    expect(profile.bio).toBe('');
    expect(profile.region_code).toBeNull();
    const privateRow = await db.asOwner((q) =>
      q.one<{ terms: string | null }>('select terms_agreed_at as terms from public.user_private where user_id = $1', [id]),
    );
    expect(privateRow.terms).toBeNull();
    // 이메일·이름이 public 스키마 어디에도 복사되지 않는다
    const leaked = await db.asOwner((q) =>
      q.value<number>(
        `select count(*)::int from (
           select to_jsonb(p) as j from public.profiles p
           union all select to_jsonb(u) from public.user_private u
         ) t where t.j::text like '%홍길동%' or t.j::text like '%real.name%'`,
      ),
    );
    expect(leaked).toBe(0);
  });

  it('profiles에 이메일 컬럼이 없다', async () => {
    const columns = await db.asOwner((q) =>
      q.query<{ column_name: string }>(
        `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'profiles'`,
      ),
    );
    expect(columns.map((c) => c.column_name)).not.toContain('email');
  });
});
