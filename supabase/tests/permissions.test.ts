/**
 * 권한 우회 시도: 비로그인 쓰기, 남의 모임 조작, 관리자 권한 탈취, 개인정보 조회 범위.
 * 마스터 프롬프트 8장 #3·#4·#13, TEST_PLAN §2 #3·#4·#13.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  apply,
  createMeetingRpc,
  createTestDb,
  expectPermissionDenied,
  expectRpcError,
  hoursFromNow,
  meetingInput,
  type TestDb,
} from './harness';

const SOME_ID = '00000000-0000-4000-8000-000000000001';

let db: TestDb;
beforeEach(async () => {
  db = await createTestDb();
});
afterEach(async () => {
  await db.close();
});

describe('비로그인(anon)', () => {
  const writeCalls: Array<[string, string, unknown[]]> = [
    ['create_meeting', 'select public.create_meeting($1::jsonb)', [JSON.stringify(meetingInput())]],
    ['update_meeting', 'select public.update_meeting($1, $2::jsonb)', [SOME_ID, JSON.stringify(meetingInput())]],
    ['cancel_meeting', 'select public.cancel_meeting($1, null)', [SOME_ID]],
    ['set_meeting_recruiting', 'select public.set_meeting_recruiting($1, false)', [SOME_ID]],
    ['apply_to_meeting', 'select public.apply_to_meeting($1, null)', [SOME_ID]],
    ['cancel_my_application', 'select public.cancel_my_application($1)', [SOME_ID]],
    ['decide_participant', `select public.decide_participant($1, 'approve')`, [SOME_ID]],
    ['mark_attendance', `select public.mark_attendance($1, 'attended')`, [SOME_ID]],
    ['update_my_profile', 'select public.update_my_profile($1::jsonb)', ['{"nickname":"해커"}']],
    ['request_account_deletion', 'select public.request_account_deletion()', []],
    ['submit_report', `select public.submit_report('user', $1, 'spam', null)`, [SOME_ID]],
    ['get_my_profile', 'select public.get_my_profile()', []],
    ['list_my_meetings', 'select public.list_my_meetings()', []],
    ['get_my_participation', 'select public.get_my_participation($1)', [SOME_ID]],
    ['list_meeting_participants', 'select public.list_meeting_participants($1)', [SOME_ID]],
    ['admin_list_reports', 'select * from public.admin_list_reports()', []],
    ['admin_update_report', `select public.admin_update_report($1, 'resolved', null)`, [SOME_ID]],
    ['admin_set_meeting_hidden', `select public.admin_set_meeting_hidden($1, true, '사유')`, [SOME_ID]],
    ['admin_set_user_status', `select public.admin_set_user_status($1, 'restricted', null)`, [SOME_ID]],
    ['admin_search_users', 'select * from public.admin_search_users(null, 20)', []],
  ];

  it.each(writeCalls)('anon은 %s를 실행할 수 없다(EXECUTE 권한 없음)', async (_name, sql, params) => {
    await expectPermissionDenied(db.asAnon((q) => q.query(sql, params)));
  });

  it('anon은 내부 함수(_로 시작)·트리거 함수를 실행할 수 없다', async () => {
    await expectPermissionDenied(db.asAnon((q) => q.query(`select public._err('X')`)));
    await expectPermissionDenied(db.asAnon((q) => q.query('select public._sync_meeting_counts($1)', [SOME_ID])));
    await expectPermissionDenied(db.asAnon((q) => q.query('select public._require_actor(false, true)')));
  });

  it('anon은 테이블에 직접 insert/update/delete 할 수 없다', async () => {
    const host = await db.createUser();
    const meetingId = await db.insertMeeting({ hostId: host });
    const attempts = [
      `insert into public.meetings (host_id, category_id, title, start_at, end_at, duration_minutes, region_code,
         min_participants, max_participants, skill_level, approval_mode)
       values ('${host}', 'party', '침입', now() + interval '1 day', now() + interval '2 days', 120, 'dunsan_tanbang', 2, 4, 'anyone', 'auto')`,
      `update public.meetings set title = '변조' where id = '${meetingId}'`,
      `delete from public.meetings where id = '${meetingId}'`,
      `insert into public.meeting_participants (meeting_id, user_id, role, status) values ('${meetingId}', '${host}', 'guest', 'confirmed')`,
      `update public.profiles set nickname = '변조' where id = '${host}'`,
      `insert into public.reports (target_type, target_user_id, reason) values ('user', '${host}', 'spam')`,
      `insert into public.admin_roles (user_id) values ('${host}')`,
      `insert into public.venues (name, region_code, address, venue_type) values ('x', 'dunsan_tanbang', 'x', 'other')`,
      `update public.regions set name = '변조'`,
      `delete from public.categories`,
    ];
    for (const sql of attempts) {
      await expectPermissionDenied(db.asAnon((q) => q.query(sql)));
    }
    const title = await db.asOwner((q) => q.value<string>('select title from public.meetings where id = $1', [meetingId]));
    expect(title).toBe('테스트 모임');
  });

  it('anon은 비공개 테이블을 읽을 수 없다', async () => {
    for (const table of ['user_private', 'admin_roles', 'meeting_participants', 'reports', 'audit_logs']) {
      await expectPermissionDenied(db.asAnon((q) => q.query(`select * from public.${table}`)));
    }
  });
});

describe('사용자 A는 사용자 B의 모임을 조작할 수 없다', () => {
  async function setup() {
    const b = await db.createUser({ nickname: '모임장B' });
    const a = await db.createUser({ nickname: '사용자A' });
    const guest = await db.createUser();
    const meetingId = await createMeetingRpc(db, b, { approval_mode: 'manual', title: 'B의 모임' });
    await apply(db, guest, meetingId);
    const participantId = await db.asOwner((q) =>
      q.value<string>(`select id from public.meeting_participants where meeting_id = $1 and user_id = $2`, [
        meetingId,
        guest,
      ]),
    );
    return { a, b, guest, meetingId, participantId };
  }

  it('update/cancel/set_recruiting/decide/mark_attendance/참가자 목록 → NOT_HOST', async () => {
    const { a, meetingId, participantId } = await setup();
    await expectRpcError(
      db.rpc(a, 'select public.update_meeting($1, $2::jsonb)', [meetingId, JSON.stringify(meetingInput({ title: '탈취' }))]),
      'NOT_HOST',
    );
    await expectRpcError(db.rpc(a, 'select public.cancel_meeting($1, $2)', [meetingId, '탈취']), 'NOT_HOST');
    await expectRpcError(db.rpc(a, 'select public.set_meeting_recruiting($1, false)', [meetingId]), 'NOT_HOST');
    await expectRpcError(db.rpc(a, `select public.decide_participant($1, 'reject')`, [participantId]), 'NOT_HOST');
    await expectRpcError(db.rpc(a, `select public.mark_attendance($1, 'absent')`, [participantId]), 'NOT_HOST');
    await expectRpcError(db.rpc(a, 'select public.list_meeting_participants($1)', [meetingId]), 'NOT_HOST');
  });

  it('게스트(참가자)도 모임장 권한 RPC를 쓸 수 없다', async () => {
    const { guest, meetingId, participantId } = await setup();
    await expectRpcError(db.rpc(guest, `select public.decide_participant($1, 'approve')`, [participantId]), 'NOT_HOST');
    await expectRpcError(db.rpc(guest, 'select public.cancel_meeting($1, null)', [meetingId]), 'NOT_HOST');
    await expectRpcError(db.rpc(guest, 'select public.list_meeting_participants($1)', [meetingId]), 'NOT_HOST');
  });

  it('직접 DML(update/delete/insert)은 권한 오류이고 모임은 그대로다', async () => {
    const { a, b, meetingId } = await setup();
    await expectPermissionDenied(
      db.asUser(a, (q) => q.query(`update public.meetings set title = '탈취' where id = $1`, [meetingId])),
    );
    await expectPermissionDenied(db.asUser(a, (q) => q.query('delete from public.meetings where id = $1', [meetingId])));
    await expectPermissionDenied(
      db.asUser(a, (q) =>
        q.query(`update public.meetings set host_id = $2 where id = $1`, [meetingId, a]),
      ),
    );
    await expectPermissionDenied(
      db.asUser(a, (q) =>
        q.query(
          `insert into public.meeting_participants (meeting_id, user_id, role, status) values ($1, $2, 'guest', 'confirmed')`,
          [meetingId, a],
        ),
      ),
    );
    // 모임장 본인도 직접 DML은 안 된다(쓰기는 RPC만)
    await expectPermissionDenied(
      db.asUser(b, (q) => q.query(`update public.meetings set confirmed_count = 1 where id = $1`, [meetingId])),
    );
    await expectPermissionDenied(
      db.asUser(b, (q) =>
        q.query(`update public.meeting_participants set status = 'confirmed' where meeting_id = $1`, [meetingId]),
      ),
    );
    const meeting = await db.asOwner((q) =>
      q.one<{ title: string; status: string; host_id: string }>(
        'select title, status, host_id from public.meetings where id = $1',
        [meetingId],
      ),
    );
    expect(meeting).toEqual({ title: 'B의 모임', status: 'open', host_id: b });
  });

  it('A는 B 모임의 참가 행을 조회할 수 없다(0행), 모임장 B는 볼 수 있다', async () => {
    const { a, b, meetingId } = await setup();
    const asA = await db.asUser(a, (q) => q.query('select id from public.meeting_participants where meeting_id = $1', [meetingId]));
    expect(asA).toEqual([]);
    const asB = await db.asUser(b, (q) => q.query('select id from public.meeting_participants where meeting_id = $1', [meetingId]));
    expect(asB).toHaveLength(2);
  });
});

describe('관리자 권한', () => {
  it('일반 계정은 admin_* RPC에서 NOT_ADMIN', async () => {
    const user = await db.createUser();
    const host = await db.createUser();
    const meetingId = await db.insertMeeting({ hostId: host });
    await expectRpcError(db.asUser(user, (q) => q.query('select * from public.admin_list_reports()')), 'NOT_ADMIN');
    await expectRpcError(db.rpc(user, `select public.admin_update_report($1, 'resolved', null)`, [SOME_ID]), 'NOT_ADMIN');
    await expectRpcError(
      db.rpc(user, `select public.admin_set_meeting_hidden($1, true, '사유')`, [meetingId]),
      'NOT_ADMIN',
    );
    await expectRpcError(db.rpc(user, `select public.admin_set_user_status($1, 'restricted', null)`, [host]), 'NOT_ADMIN');
    await expectRpcError(db.asUser(user, (q) => q.query('select * from public.admin_search_users(null, 20)')), 'NOT_ADMIN');
  });

  it('일반 계정은 admin_roles를 읽거나 쓸 수 없고 audit_logs는 0행', async () => {
    const user = await db.createUser();
    const admin = await db.createUser({ admin: true });
    await createMeetingRpc(db, admin);
    await expectPermissionDenied(db.asUser(user, (q) => q.query('select * from public.admin_roles')));
    await expectPermissionDenied(
      db.asUser(user, (q) => q.query('insert into public.admin_roles (user_id) values ($1)', [user])),
    );
    const logs = await db.asUser(user, (q) => q.query('select * from public.audit_logs'));
    expect(logs).toEqual([]);
    const adminLogs = await db.asUser(admin, (q) => q.query('select * from public.audit_logs'));
    expect(adminLogs.length).toBeGreaterThan(0);
  });

  it('클라이언트 입력으로 관리자가 될 수 없다(update_my_profile의 is_admin·status·role 키 무시)', async () => {
    const user = await db.createUser({ nickname: '평범한사용자' });
    await db.rpc(user, 'select public.update_my_profile($1::jsonb)', [
      JSON.stringify({ is_admin: true, isAdmin: true, role: 'admin', status: 'active', id: SOME_ID, bio: '안녕' }),
    ]);
    const me = await db.rpc<{ isAdmin: boolean; bio: string; id: string }>(user, 'select public.get_my_profile()');
    expect(me).toMatchObject({ isAdmin: false, bio: '안녕', id: user });
    const isAdmin = await db.rpc<boolean>(user, 'select public.is_admin()');
    expect(isAdmin).toBe(false);
    const adminCount = await db.asOwner((q) => q.value<number>('select count(*)::int from public.admin_roles'));
    expect(adminCount).toBe(0);
  });

  it('JWT에 role=admin 같은 claim을 넣어도 관리자가 아니다', async () => {
    const user = await db.createUser();
    const result = await db.pg.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: user, role: 'authenticated', app_metadata: { role: 'admin' }, is_admin: true }),
      ]);
      await tx.query('set local role authenticated');
      return (await tx.query<{ a: boolean }>('select public.is_admin() as a')).rows[0]?.a;
    });
    expect(result).toBe(false);
  });

  it('일반 계정은 공간·카테고리·게임을 쓸 수 없고 관리자는 쓸 수 있다(RLS)', async () => {
    const user = await db.createUser();
    const admin = await db.createUser({ admin: true });
    const insertVenue = `insert into public.venues (name, region_code, address, venue_type, is_public)
                         values ('관리자 공간', 'dunsan_tanbang', '대전', 'board_game_cafe', true)`;
    await expectPermissionDenied(db.asUser(user, (q) => q.query(insertVenue)));
    await expectPermissionDenied(
      db.asUser(user, (q) => q.query(`insert into public.categories (id, name) values ('hacked', '해킹')`)),
    );
    await expectPermissionDenied(
      db.asUser(user, (q) => q.query(`insert into public.games (name, category_id) values ('게임', 'party')`)),
    );
    // update/delete는 RLS로 대상 행이 0행이 된다
    const updated = await db.asUser(user, (q) => q.query(`update public.categories set name = '변조' returning id`));
    expect(updated).toEqual([]);

    await db.asUser(admin, (q) => q.query(insertVenue));
    await db.asUser(admin, (q) => q.query(`insert into public.games (name, category_id) values ('카탄', 'strategy')`));
    await db.asUser(admin, (q) => q.query(`update public.categories set is_active = false where id = 'mahjong_etc'`));
    const venues = await db.asAnon((q) => q.query('select name from public.venues'));
    expect(venues).toEqual([{ name: '관리자 공간' }]);
    // regions는 관리자도 API로 쓸 수 없다(마이그레이션·SQL Editor만)
    await expectPermissionDenied(db.asUser(admin, (q) => q.query(`update public.regions set name = '변조'`)));
  });

  it('비공개 공간은 관리자만 조회한다', async () => {
    const user = await db.createUser();
    const admin = await db.createUser({ admin: true });
    await db.asOwner((q) =>
      q.query(
        `insert into public.venues (name, region_code, address, venue_type, is_public)
         values ('비공개 공간', 'dunsan_tanbang', '대전', 'other', false)`,
      ),
    );
    expect(await db.asAnon((q) => q.query('select id from public.venues'))).toEqual([]);
    expect(await db.asUser(user, (q) => q.query('select id from public.venues'))).toEqual([]);
    expect(await db.asUser(admin, (q) => q.query('select id from public.venues'))).toHaveLength(1);
  });
});

describe('개인정보 접근 범위', () => {
  it('로그인 사용자도 profiles.status를 직접 읽을 수 없고, 본인 상태는 get_my_profile로 본다', async () => {
    const user = await db.createUser({ status: 'restricted' });
    await expectPermissionDenied(db.asUser(user, (q) => q.query('select status from public.profiles where id = $1', [user])));
    const me = await db.rpc<{ status: string; onboarded: boolean }>(user, 'select public.get_my_profile()');
    expect(me).toMatchObject({ status: 'restricted', onboarded: true });
  });

  it('user_private는 본인 행만 보인다', async () => {
    const a = await db.createUser();
    const b = await db.createUser();
    const rows = await db.asUser(a, (q) => q.query<{ user_id: string }>('select user_id from public.user_private'));
    expect(rows).toEqual([{ user_id: a }]);
    const other = await db.asUser(a, (q) => q.query('select * from public.user_private where user_id = $1', [b]));
    expect(other).toEqual([]);
  });

  it('신고자는 자기 신고만 보고 admin_note·handled_by 컬럼은 읽을 수 없다', async () => {
    const reporter = await db.createUser();
    const other = await db.createUser();
    const target = await db.createUser();
    const reportId = await db.rpc<string>(reporter, `select public.submit_report('user', $1, 'spam', '스팸 홍보')`, [target]);
    await db.asOwner((q) => q.query(`update public.reports set admin_note = '내부 메모' where id = $1`, [reportId]));

    const own = await db.asUser(reporter, (q) =>
      q.query<{ id: string; status: string }>('select id, status, body from public.reports'),
    );
    expect(own).toEqual([{ id: reportId, status: 'received', body: '스팸 홍보' }]);
    await expectPermissionDenied(db.asUser(reporter, (q) => q.query('select admin_note from public.reports')));
    await expectPermissionDenied(db.asUser(reporter, (q) => q.query('select handled_by from public.reports')));
    await expectPermissionDenied(db.asUser(reporter, (q) => q.query('select * from public.reports')));
    const others = await db.asUser(other, (q) => q.query('select id from public.reports'));
    expect(others).toEqual([]);
    // 신고 대상자도 신고를 볼 수 없다
    const asTarget = await db.asUser(target, (q) => q.query('select id from public.reports'));
    expect(asTarget).toEqual([]);
  });

  it('참가 행은 본인·모임장·관리자만 본다(신청 메시지 포함)', async () => {
    const host = await db.createUser();
    const guest = await db.createUser();
    const stranger = await db.createUser();
    const admin = await db.createUser({ admin: true });
    const meetingId = await createMeetingRpc(db, host, { start_at: hoursFromNow(30).toISOString() });
    await apply(db, guest, meetingId, '잘 부탁드려요');

    const count = (userId: string) =>
      db.asUser(userId, (q) =>
        q.value<number>('select count(*)::int from public.meeting_participants where meeting_id = $1', [meetingId]),
      );
    expect(await count(guest)).toBe(1);
    expect(await count(host)).toBe(2);
    expect(await count(admin)).toBe(2);
    expect(await count(stranger)).toBe(0);
  });
});
