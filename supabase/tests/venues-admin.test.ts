/**
 * Phase 4 마이그레이션(6·7·8) — 공간 공개 조회, 탐색 목록 공간 필터, 관리자 조회 RPC,
 * 공간·카테고리·게임 직접 쓰기의 RLS·보정 트리거·감사 로그, 닉네임 예약어 '운영진'.
 * DB_SCHEMA §9.12·§9.15~§9.18·§12, SECURITY §3.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isReservedNickname } from '../../src/domain/limits';
import {
  createMeetingRpc,
  createTestDb,
  daysFromNow,
  expectPermissionDenied,
  expectRpcError,
  expectSqlState,
  hoursFromNow,
  type TestDb,
} from './harness';

let db: TestDb;
beforeEach(async () => {
  db = await createTestDb();
});
afterEach(async () => {
  await db.close();
});

interface VenueJson {
  id: string;
  name: string;
  regionCode: string;
  venueType: string;
  isPublic: boolean;
  websiteUrl: string | null;
  infoVerifiedAt: string | null;
  createdAt: string;
}

async function insertVenue(
  values: { name: string; region?: string; type?: string; isPublic?: boolean; website?: string | null } = { name: '공간' },
): Promise<string> {
  return db.asOwner((q) =>
    q.value<string>(
      `insert into public.venues (name, region_code, address, venue_type, is_public, website_url, info_verified_at)
       values ($1, $2, '대전 예시로 1', $3::public.venue_type, $4, $5, now() - interval '1 day') returning id`,
      [values.name, values.region ?? 'dunsan_tanbang', values.type ?? 'board_game_cafe', values.isPublic ?? true, values.website ?? null],
    ),
  );
}

const listVenues = (userId: string | null, region: string | null = null, type: string | null = null) =>
  db.rpc<VenueJson[]>(userId, 'select public.list_public_venues(p_region => $1, p_type => $2)', [region, type]);

const auditRows = () =>
  db.asOwner((q) =>
    q.query<{ actor_id: string | null; action: string; target_type: string; target_id: string; meta: Record<string, unknown> }>(
      `select actor_id, action, target_type, target_id, meta from public.audit_logs
       where action like 'admin.venue_%' or action like 'admin.category_%' or action like 'admin.game_%'
       order by id`,
    ),
  );

describe('공간 공개 조회 (list_public_venues · get_venue)', () => {
  it('공개 공간만, 권역 정렬 → 이름 순. 관리자도 공개 공간만 받는다', async () => {
    const admin = await db.createUser({ admin: true });
    const user = await db.createUser();
    await insertVenue({ name: '나 카페', region: 'gung_bongmyeong' });
    await insertVenue({ name: '가 카페', region: 'gung_bongmyeong' });
    await insertVenue({ name: '하 카페', region: 'dunsan_tanbang' });
    await insertVenue({ name: '비공개', isPublic: false });
    for (const viewer of [null, user, admin]) {
      const venues = await listVenues(viewer);
      expect(venues.map((v) => v.name)).toEqual(['하 카페', '가 카페', '나 카페']);
      expect(venues.every((v) => v.isPublic)).toBe(true);
    }
  });

  it('권역·유형 필터, 모르는 값은 오류 없이 0건', async () => {
    await insertVenue({ name: '카페', region: 'dunsan_tanbang', type: 'board_game_cafe' });
    await insertVenue({ name: '파티룸', region: 'dunsan_tanbang', type: 'party_room' });
    await insertVenue({ name: '궁동 카페', region: 'gung_bongmyeong', type: 'board_game_cafe' });
    expect((await listVenues(null, 'dunsan_tanbang')).map((v) => v.name).sort()).toEqual(['카페', '파티룸']);
    expect((await listVenues(null, null, 'party_room')).map((v) => v.name)).toEqual(['파티룸']);
    expect((await listVenues(null, 'gung_bongmyeong', 'board_game_cafe')).map((v) => v.name)).toEqual(['궁동 카페']);
    expect(await listVenues(null, 'nowhere')).toEqual([]);
    expect(await listVenues(null, null, 'casino')).toEqual([]);
  });

  it('응답 모양: camelCase, 시각은 UTC 오프셋, 실시간 영업·좌석·가격 키 없음', async () => {
    const id = await insertVenue({ name: '카페', website: 'https://example.com/a' });
    const venue = await db.rpc<Record<string, unknown>>(null, 'select public.get_venue($1)', [id]);
    expect(Object.keys(venue).sort()).toEqual(
      [
        'address',
        'bookingUrl',
        'createdAt',
        'description',
        'id',
        'infoVerifiedAt',
        'isPublic',
        'name',
        'regionCode',
        'updatedAt',
        'venueType',
        'websiteUrl',
      ].sort(),
    );
    expect(venue.websiteUrl).toBe('https://example.com/a');
    expect(String(venue.createdAt)).toMatch(/\+00:00$/);
  });

  it('비공개 공간은 anon·사용자·관리자 모두 get_venue로 null (공개 화면)', async () => {
    const admin = await db.createUser({ admin: true });
    const user = await db.createUser();
    const id = await insertVenue({ name: '비공개', isPublic: false });
    for (const viewer of [null, user, admin]) {
      expect(await db.rpc(viewer, 'select public.get_venue($1)', [id])).toBeNull();
    }
    // 테이블 직접 조회도 anon·일반 사용자에게는 0행(RLS)
    expect(await db.asAnon((q) => q.query('select id from public.venues where id = $1', [id]))).toEqual([]);
    expect(await db.asUser(user, (q) => q.query('select id from public.venues where id = $1', [id]))).toEqual([]);
  });
});

describe('list_public_meetings p_venue_id', () => {
  it('공간으로 거르고, 기존 인자(9개 이하) 호출은 그대로 동작한다', async () => {
    const host = await db.createUser();
    const venueA = await insertVenue({ name: '공간 A' });
    const venueB = await insertVenue({ name: '공간 B' });
    const inA = await createMeetingRpc(db, host, { venue_id: venueA, title: '공간 A 모임' });
    await createMeetingRpc(db, host, { venue_id: venueB, title: '공간 B 모임' });
    await createMeetingRpc(db, host, { title: '장소 미정 모임' });

    const byVenue = await db.rpc<{ items: { id: string }[]; total: number }>(
      null,
      'select public.list_public_meetings(p_venue_id => $1)',
      [venueA],
    );
    expect(byVenue.total).toBe(1);
    expect(byVenue.items.map((m) => m.id)).toEqual([inA]);

    const all = await db.rpc<{ total: number }>(
      null,
      `select public.list_public_meetings(p_sort => 'soonest', p_limit => 20, p_offset => 0)`,
    );
    expect(all.total).toBe(3);
    // 위치 인자 9개(기존 시그니처 모양)도 그대로
    const positional = await db.rpc<{ total: number }>(
      null,
      `select public.list_public_meetings(null, null, null, null, null, false, 'soonest', 20, 0)`,
    );
    expect(positional.total).toBe(3);
  });

  it('오버로드가 하나만 남는다(이름 지정 호출이 모호해지지 않게)', async () => {
    const count = await db.asOwner((q) =>
      q.value<number>(
        `select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'list_public_meetings'`,
      ),
    );
    expect(count).toBe(1);
  });
});

describe('관리자 조회 RPC', () => {
  it('일반 사용자는 NOT_ADMIN, anon은 실행 권한 없음(42501)', async () => {
    const user = await db.createUser();
    for (const sql of [
      'select public.admin_list_meetings()',
      'select public.admin_list_report_items()',
      'select public.admin_list_venues()',
      'select public.admin_list_categories()',
    ]) {
      await expectRpcError(db.rpc(user, sql), 'NOT_ADMIN');
      await expectPermissionDenied(db.rpc(null, sql));
    }
  });

  it('admin_list_meetings: 숨김·취소·종료 포함, 제목·게임명 검색, 숨김만, 페이지·total', async () => {
    const admin = await db.createUser({ admin: true });
    const host = await db.createUser();
    const open = await createMeetingRpc(db, host, { title: '공개 카탄 모임', game_name: '카탄' });
    const hidden = await db.insertMeeting({ hostId: host, title: '숨긴 홀덤 모임', isHidden: true });
    const cancelled = await db.insertMeeting({ hostId: host, title: '취소된 모임', status: 'cancelled' });
    const finished = await db.insertMeeting({ hostId: host, title: '지난 모임', startAt: daysFromNow(-3) });

    const all = await db.rpc<{ items: { id: string; isHidden: boolean }[]; total: number }>(
      admin,
      'select public.admin_list_meetings()',
    );
    expect(all.total).toBe(4);
    expect(all.items.map((m) => m.id).sort()).toEqual([open, hidden, cancelled, finished].sort());

    const hiddenOnly = await db.rpc<{ items: { id: string; isHidden: boolean }[]; total: number }>(
      admin,
      'select public.admin_list_meetings(p_hidden_only => true)',
    );
    expect(hiddenOnly.items.map((m) => [m.id, m.isHidden])).toEqual([[hidden, true]]);

    const byGame = await db.rpc<{ items: { id: string }[] }>(admin, `select public.admin_list_meetings(p_q => '  카탄 ')`);
    expect(byGame.items.map((m) => m.id)).toEqual([open]);
    const escaped = await db.rpc<{ total: number }>(admin, `select public.admin_list_meetings(p_q => '%')`);
    expect(escaped.total).toBe(0);

    const paged = await db.rpc<{ items: unknown[]; total: number }>(
      admin,
      'select public.admin_list_meetings(p_limit => 1000, p_offset => -5)',
    );
    expect(paged.items).toHaveLength(4);
    const second = await db.rpc<{ items: unknown[]; total: number }>(admin, 'select public.admin_list_meetings(p_limit => 2, p_offset => 2)');
    expect(second).toMatchObject({ total: 4 });
    expect(second.items).toHaveLength(2);
  });

  it('admin_list_report_items: 대상 이름·신고자 닉네임·관리자 메모 포함, 상태 필터', async () => {
    const admin = await db.createUser({ admin: true });
    const reporter = await db.createUser({ nickname: '신고자닉' });
    const target = await db.createUser({ nickname: '대상닉' });
    const host = await db.createUser();
    const meetingId = await createMeetingRpc(db, host, { title: '신고된 모임' });
    const reportMeeting = await db.rpc<string>(
      reporter,
      `select public.submit_report('meeting', $1, 'gambling', '판돈 이야기')`,
      [meetingId],
    );
    await db.rpc<string>(reporter, `select public.submit_report('user', $1, 'no_show', null)`, [target]);
    await db.rpc(admin, `select public.admin_update_report($1, 'reviewing', '확인 중')`, [reportMeeting]);

    const all = await db.rpc<{ items: Record<string, unknown>[]; total: number }>(admin, 'select public.admin_list_report_items()');
    expect(all.total).toBe(2);
    const meetingItem = all.items.find((item) => item.id === reportMeeting);
    expect(meetingItem).toMatchObject({
      targetType: 'meeting',
      targetId: meetingId,
      targetLabel: '신고된 모임',
      targetHidden: false,
      reason: 'gambling',
      body: '판돈 이야기',
      status: 'reviewing',
      adminNote: '확인 중',
      reporterId: reporter,
      reporterNickname: '신고자닉',
      handledAt: null,
    });
    const userItem = all.items.find((item) => item.id !== reportMeeting);
    expect(userItem).toMatchObject({ targetType: 'user', targetId: target, targetLabel: '대상닉', targetHidden: null, body: '' });

    const reviewing = await db.rpc<{ items: { id: string }[]; total: number }>(
      admin,
      `select public.admin_list_report_items(p_status => 'reviewing')`,
    );
    expect(reviewing.items.map((item) => item.id)).toEqual([reportMeeting]);
  });

  it('신고 흐름: 접수 → 중복 거부 → 관리자 처리(메모) → 신고자는 admin_note를 읽을 수 없음 → 처리 후 재신고 가능', async () => {
    const admin = await db.createUser({ admin: true });
    const reporter = await db.createUser();
    const host = await db.createUser();
    const meetingId = await createMeetingRpc(db, host);
    const first = await db.rpc<string>(reporter, `select public.submit_report('meeting', $1, 'spam', null)`, [meetingId]);
    await expectRpcError(db.rpc(reporter, `select public.submit_report('meeting', $1, 'spam', null)`, [meetingId]), 'DUPLICATE_REPORT');
    await expectRpcError(db.rpc(host, `select public.submit_report('meeting', $1, 'spam', null)`, [meetingId]), 'CANNOT_REPORT_SELF');
    await db.rpc(admin, `select public.admin_update_report($1, 'resolved', '내부 메모')`, [first]);
    await expectPermissionDenied(db.asUser(reporter, (q) => q.query('select admin_note from public.reports')));
    const own = await db.asUser(reporter, (q) => q.query<{ status: string }>('select status from public.reports'));
    expect(own).toEqual([{ status: 'resolved' }]);
    await db.rpc<string>(reporter, `select public.submit_report('meeting', $1, 'spam', null)`, [meetingId]);
  });

  it('레이트 리밋: 24시간 11번째 신고는 RATE_LIMITED(report_24h)', async () => {
    const reporter = await db.createUser();
    const targets = await Promise.all(Array.from({ length: 11 }, () => db.createUser()));
    for (const target of targets.slice(0, 10)) {
      await db.rpc(reporter, `select public.submit_report('user', $1, 'spam', null)`, [target]);
    }
    await expectRpcError(
      db.rpc(reporter, `select public.submit_report('user', $1, 'spam', null)`, [targets[10]]),
      'RATE_LIMITED',
      'report_24h',
    );
  });

  it('admin_list_venues(비공개 포함)·admin_list_categories(비활성 포함)', async () => {
    const admin = await db.createUser({ admin: true });
    await insertVenue({ name: '공개' });
    await insertVenue({ name: '비공개', isPublic: false });
    await db.asOwner((q) => q.query(`update public.categories set is_active = false where id = 'mahjong_etc'`));
    const venues = await db.rpc<VenueJson[]>(admin, 'select public.admin_list_venues()');
    expect(venues.map((v) => [v.name, v.isPublic]).sort()).toEqual([
      ['공개', true],
      ['비공개', false],
    ]);
    const categories = await db.rpc<{ id: string; isActive: boolean; sortOrder: number }[]>(
      admin,
      'select public.admin_list_categories()',
    );
    expect(categories).toHaveLength(6);
    expect(categories.find((c) => c.id === 'mahjong_etc')?.isActive).toBe(false);
    expect(categories.map((c) => c.sortOrder)).toEqual([10, 20, 30, 40, 50, 60]);
  });
});

describe('공간·카테고리·게임 직접 쓰기: RLS · 보정 트리거 · 감사 로그', () => {
  const insertSql = `insert into public.venues (name, region_code, address, venue_type, is_public, created_by, website_url)
                     values ('  새 공간  ', 'dunsan_tanbang', ' 대전 예시로 2 ', 'party_room', true, $1, '  ')
                     returning id, name, address, website_url, created_by`;

  it('일반 사용자: insert 거부(42501), update·delete는 0행, 감사 로그 없음', async () => {
    const user = await db.createUser();
    const venueId = await insertVenue({ name: '기존 공간' });
    // 소유자(SQL Editor와 같은 경로)로 넣은 행도 기록된다 — 요청자가 없으므로 actor_id null
    const before = await auditRows();
    expect(before).toEqual([
      { actor_id: null, action: 'admin.venue_create', target_type: 'venue', target_id: venueId, meta: { is_public: true } },
    ]);
    await expectPermissionDenied(db.asUser(user, (q) => q.query(insertSql, [user])));
    const updated = await db.asUser(user, (q) => q.query(`update public.venues set is_public = false where id = $1 returning id`, [venueId]));
    expect(updated).toEqual([]);
    const deleted = await db.asUser(user, (q) => q.query('delete from public.venues where id = $1 returning id', [venueId]));
    expect(deleted).toEqual([]);
    const categories = await db.asUser(user, (q) =>
      q.query(`update public.categories set is_active = false where id = 'party' returning id`),
    );
    expect(categories).toEqual([]);
    expect(await auditRows()).toEqual(before);
    // anon은 grant 자체가 없다
    await expectPermissionDenied(db.asAnon((q) => q.query(`update public.categories set is_active = false`)));
  });

  it('관리자 insert: 공백 정리·빈 링크 null, created_by는 요청자로 고정(입력값 무시), audit admin.venue_create', async () => {
    const admin = await db.createUser({ admin: true });
    const other = await db.createUser();
    const row = await db.asUser(admin, (q) =>
      q.one<{ id: string; name: string; address: string; website_url: string | null; created_by: string }>(insertSql, [other]),
    );
    expect(row).toMatchObject({ name: '새 공간', address: '대전 예시로 2', website_url: null, created_by: admin });
    expect(await auditRows()).toEqual([
      { actor_id: admin, action: 'admin.venue_create', target_type: 'venue', target_id: row.id, meta: { is_public: true } },
    ]);
  });

  it('관리자 update: created_by·created_at 유지, updated_at 갱신, audit에 바뀐 필드 이름만(값 없음)', async () => {
    const admin = await db.createUser({ admin: true });
    const venueId = await db.asUser(admin, (q) =>
      q.value<string>(
        `insert into public.venues (name, region_code, address, venue_type, is_public)
         values ('공간', 'dunsan_tanbang', '주소', 'other', false) returning id`,
      ),
    );
    await db.asOwner((q) =>
      q.query(`update public.venues set created_at = now() - interval '3 days', updated_at = now() - interval '3 days' where id = $1`, [
        venueId,
      ]),
    );
    const before = await db.asOwner((q) =>
      q.one<{ created_at: string; updated_at: string }>('select created_at::text, updated_at::text from public.venues where id = $1', [venueId]),
    );
    const other = await db.createUser();
    await db.asUser(admin, (q) =>
      q.query(
        `update public.venues set name = '바뀐 이름', booking_url = 'https://example.com/book', is_public = true,
                created_by = $2, created_at = now()
         where id = $1`,
        [venueId, other],
      ),
    );
    const after = await db.asOwner((q) =>
      q.one<{ created_at: string; updated_at: string; created_by: string }>(
        'select created_at::text, updated_at::text, created_by from public.venues where id = $1',
        [venueId],
      ),
    );
    expect(after.created_at).toBe(before.created_at);
    expect(after.created_by).toBe(admin);
    expect(after.updated_at).not.toBe(before.updated_at);

    const logs = await auditRows();
    expect(logs.at(-1)).toEqual({
      actor_id: admin,
      action: 'admin.venue_update',
      target_type: 'venue',
      target_id: venueId,
      meta: { fields: ['booking_url', 'is_public', 'name'], is_public: true },
    });
    expect(JSON.stringify(logs)).not.toContain('바뀐 이름');
    expect(JSON.stringify(logs)).not.toContain('example.com');
  });

  it('바뀐 값이 없는 update는 기록하지 않는다', async () => {
    const admin = await db.createUser({ admin: true });
    await db.asUser(admin, (q) => q.query(`update public.categories set is_active = true where id = 'party'`));
    expect(await auditRows()).toEqual([]);
  });

  it('카테고리 비활성·게임 추가도 기록된다(admin.category_update · admin.game_create)', async () => {
    const admin = await db.createUser({ admin: true });
    await db.asUser(admin, (q) => q.query(`update public.categories set is_active = false where id = 'mahjong_etc'`));
    await db.asUser(admin, (q) => q.query(`insert into public.games (name, category_id) values ('카탄', 'strategy')`));
    const logs = await auditRows();
    expect(logs.map((log) => [log.action, log.target_type, log.meta])).toEqual([
      ['admin.category_update', 'category', { fields: ['is_active'], is_active: false }],
      ['admin.game_create', 'game', { is_active: true }],
    ]);
    expect(logs[0]?.target_id).toBe('mahjong_etc');
  });

  it('형식 위반은 기존 check 제약이 거부한다(http 링크 23514, 빈 이름 23514)', async () => {
    const admin = await db.createUser({ admin: true });
    await expectSqlState(
      db.asUser(admin, (q) =>
        q.query(
          `insert into public.venues (name, region_code, address, venue_type, website_url)
           values ('공간', 'dunsan_tanbang', '주소', 'other', 'http://example.com')`,
        ),
      ),
      '23514',
    );
    await expectSqlState(
      db.asUser(admin, (q) =>
        q.query(`insert into public.venues (name, region_code, address, venue_type) values ('   ', 'dunsan_tanbang', '주소', 'other')`),
      ),
      '23514',
    );
  });

  it('비공개로 바꾼 공간은 공개 목록에서 빠지지만, 이미 연결된 모임은 유지된다(공간 이름은 anon에게 null)', async () => {
    const admin = await db.createUser({ admin: true });
    const host = await db.createUser();
    const venueId = await insertVenue({ name: '곧 비공개' });
    const meetingId = await createMeetingRpc(db, host, { venue_id: venueId });
    await db.asUser(admin, (q) => q.query('update public.venues set is_public = false where id = $1', [venueId]));
    expect(await listVenues(null)).toEqual([]);
    const meeting = await db.rpc<{ venueId: string; venueName: string | null }>(null, 'select public.get_meeting($1)', [meetingId]);
    expect(meeting).toMatchObject({ venueId, venueName: null });
    const asAdmin = await db.rpc<{ venueName: string | null }>(admin, 'select public.get_meeting($1)', [meetingId]);
    expect(asAdmin.venueName).toBe('곧 비공개');
  });
});

describe("닉네임 예약어 '운영진' (마이그레이션 8)", () => {
  it("'운영진'이 들어가면 VALIDATION_FAILED(nickname), 프론트 isReservedNickname과 같은 결과", async () => {
    const user = await db.createUser();
    for (const nickname of ['운영진', '운영진김', '김운영진', '운_영진', '운-영진']) {
      await expectRpcError(
        db.rpc(user, 'select public.update_my_profile($1::jsonb)', [JSON.stringify({ nickname })]),
        'VALIDATION_FAILED',
        'nickname',
      );
    }
    const cases = ['운영진', '운영진김', '운_영진', '운영', '진운영', '한판', '한판승부', '운영자', '보드게임러'];
    const rows = await db.asOwner((q) =>
      q.query<{ nickname: string; reserved: boolean }>(
        'select n as nickname, public._is_reserved_nickname(n) as reserved from unnest($1::text[]) as n',
        [cases],
      ),
    );
    expect(Object.fromEntries(rows.map((row) => [row.nickname, row.reserved]))).toEqual(
      Object.fromEntries(cases.map((nickname) => [nickname, isReservedNickname(nickname)])),
    );
    expect(isReservedNickname('운영진김')).toBe(true);
    expect(isReservedNickname('운영')).toBe(false);
  });
});

describe('관리자 모임 취소(cancel_meeting): 종료 전까지, 숨김 모임도 가능', () => {
  it('관리자는 진행 중 모임도 취소, 종료 후는 MEETING_STARTED(ended)', async () => {
    const admin = await db.createUser({ admin: true });
    const host = await db.createUser();
    const running = await db.insertMeeting({ hostId: host, startAt: hoursFromNow(-1), durationMinutes: 180, isHidden: true });
    await db.rpc(admin, `select public.cancel_meeting($1, '운영 정책 위반')`, [running]);
    const ended = await db.insertMeeting({ hostId: host, startAt: daysFromNow(-2) });
    await expectRpcError(db.rpc(admin, 'select public.cancel_meeting($1, null)', [ended]), 'MEETING_STARTED', 'ended');
    const audit = await db.asOwner((q) =>
      q.one<{ meta: { by_admin: boolean } }>(`select meta from public.audit_logs where action = 'meeting.cancel' and target_id = $1`, [running]),
    );
    expect(audit.meta.by_admin).toBe(true);
  });
});
