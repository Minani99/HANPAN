/**
 * 역할별 권한 매트릭스 보강(Phase 5, docs/SECURITY.md §3.1): 이용 제한(restricted)·탈퇴 요청(deletion_requested)·관리자 행.
 * 다른 파일에 이미 있는 칸(생성·신청·신고·프로필 등)은 매트릭스 표에 그 파일을 적고, 여기서는 빠진 칸을 채운다.
 * - 조회 RPC는 계정 상태와 무관하게 동작한다.
 * - 모임장 동작: 이용 제한은 취소만 허용(출석 체크도 불가), 탈퇴 요청은 모두 ACCOUNT_DELETION_REQUESTED.
 * - 관리자 권한(is_admin())은 admin_roles 행 + active 계정일 때만(마이그레이션 9). 이용 제한·탈퇴 요청 상태 관리자는
 *   관리자 RPC·테이블 쓰기·숨김/비공개 조회·isAdmin을 모두 잃고, active로 돌아오면 바로 복구된다.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { apply, createMeetingRpc, createTestDb, expectRpcError, hoursFromNow, meetingInput, type TestDb } from './harness';

let db: TestDb;
beforeEach(async () => {
  db = await createTestDb();
});
afterEach(async () => {
  await db.close();
});

const setStatus = (userId: string, status: 'active' | 'restricted' | 'deletion_requested') =>
  db.asOwner((q) => q.query('update public.profiles set status = $2 where id = $1', [userId, status]));

const participantId = (meetingId: string, userId: string) =>
  db.asOwner((q) =>
    q.value<string>('select id from public.meeting_participants where meeting_id = $1 and user_id = $2', [meetingId, userId]),
  );

/** 시작 전 승인제 모임(승인 대기 게스트 1) + 진행 중 모임(확정 게스트 1) */
async function hostFixture() {
  const host = await db.createUser();
  const guest = await db.createUser();
  const future = await createMeetingRpc(db, host, { approval_mode: 'manual', start_at: hoursFromNow(48).toISOString() });
  expect(await apply(db, guest, future)).toBe('pending');
  const started = await db.insertMeeting({ hostId: host, startAt: hoursFromNow(-1), durationMinutes: 180 });
  await db.insertParticipant(started, guest, 'confirmed');
  return {
    host,
    guest,
    future,
    started,
    pendingId: await participantId(future, guest),
    confirmedId: await participantId(started, guest),
  };
}

describe('조회는 계정 상태와 무관', () => {
  it.each(['restricted', 'deletion_requested'] as const)('%s: 공개 목록·상세·내 프로필·내 모임을 읽을 수 있다', async (status) => {
    const host = await db.createUser();
    const meetingId = await createMeetingRpc(db, host);
    const user = await db.createUser({ status });
    const list = await db.rpc<{ total: number }>(user, 'select public.list_public_meetings()');
    expect(list.total).toBe(1);
    expect(await db.rpc<{ id: string }>(user, 'select public.get_meeting($1)', [meetingId])).toMatchObject({ id: meetingId });
    expect(await db.rpc<{ status: string }>(user, 'select public.get_my_profile()')).toMatchObject({ status });
    expect(await db.rpc<unknown>(user, 'select public.list_my_meetings()')).toBeTruthy();
  });

  it('이용 제한된 모임장도 자기 모임 참가자 목록은 본다', async () => {
    const { host, future } = await hostFixture();
    await setStatus(host, 'restricted');
    const rows = await db.rpc<unknown[]>(host, 'select public.list_meeting_participants($1)', [future]);
    expect(Array.isArray(rows) ? rows.length : 0).toBeGreaterThan(0);
  });
});

describe('이용 제한(restricted) — 다른 파일에 없는 칸', () => {
  it('모임장: 출석 체크 ACCOUNT_RESTRICTED(승인·수정·마감은 participation/meetings 테스트), 취소는 허용', async () => {
    const { host, started, confirmedId, future } = await hostFixture();
    await setStatus(host, 'restricted');
    await expectRpcError(
      db.rpc(host, `select public.mark_attendance($1, 'attended')`, [confirmedId]),
      'ACCOUNT_RESTRICTED',
    );
    // 진행 중 모임 취소는 시작 후라 불가(규칙), 시작 전 모임 취소는 이용 제한이어도 가능
    await expectRpcError(db.rpc(host, 'select public.cancel_meeting($1, null)', [started]), 'MEETING_STARTED');
    await db.rpc(host, 'select public.cancel_meeting($1, $2)', [future, '이용 제한 중 취소']);
    expect(await db.asOwner((q) => q.value<string>('select status::text from public.meetings where id = $1', [future]))).toBe(
      'cancelled',
    );
  });

  it('탈퇴 요청은 할 수 있다(이용 제한 → deletion_requested)', async () => {
    const user = await db.createUser({ status: 'restricted' });
    await db.rpc(user, 'select public.request_account_deletion()');
    expect(await db.rpc<{ status: string }>(user, 'select public.get_my_profile()')).toMatchObject({ status: 'deletion_requested' });
  });

  it('관리자 기능은 NOT_ADMIN(일반 계정과 같음)', async () => {
    const user = await db.createUser({ status: 'restricted' });
    await expectRpcError(db.rpc(user, 'select public.admin_list_reports()'), 'NOT_ADMIN');
    await expectRpcError(db.rpc(user, 'select public.admin_list_meetings()'), 'NOT_ADMIN');
  });
});

describe('탈퇴 요청(deletion_requested) — 모임장 동작 전부 거부', () => {
  it('탈퇴 요청 후: 시작 전 주최 모임은 자동 취소, 진행 중 모임은 남고, 모임장 RPC 5종은 ACCOUNT_DELETION_REQUESTED', async () => {
    const { host, future, started, pendingId, confirmedId } = await hostFixture();
    await db.rpc(host, 'select public.request_account_deletion()');
    const statuses = await db.asOwner((q) =>
      q.query<{ id: string; status: string }>('select id, status::text as status from public.meetings where id = any($1::uuid[])', [
        [future, started],
      ]),
    );
    expect(Object.fromEntries(statuses.map((row) => [row.id, row.status]))).toEqual({ [future]: 'cancelled', [started]: 'open' });

    await expectRpcError(
      db.rpc(host, 'select public.update_meeting($1, $2::jsonb)', [future, JSON.stringify(meetingInput({ title: '탈퇴 후 수정' }))]),
      'ACCOUNT_DELETION_REQUESTED',
    );
    await expectRpcError(db.rpc(host, 'select public.set_meeting_recruiting($1, false)', [started]), 'ACCOUNT_DELETION_REQUESTED');
    await expectRpcError(db.rpc(host, 'select public.cancel_meeting($1, null)', [started]), 'ACCOUNT_DELETION_REQUESTED');
    await expectRpcError(db.rpc(host, `select public.decide_participant($1, 'approve')`, [pendingId]), 'ACCOUNT_DELETION_REQUESTED');
    await expectRpcError(
      db.rpc(host, `select public.mark_attendance($1, 'attended')`, [confirmedId]),
      'ACCOUNT_DELETION_REQUESTED',
    );
    expect(await db.countMismatches()).toEqual([]);
  });

  it('관리자 기능은 NOT_ADMIN(일반 계정과 같음)', async () => {
    const user = await db.createUser({ status: 'deletion_requested' });
    await expectRpcError(db.rpc(user, 'select public.admin_list_reports()'), 'NOT_ADMIN');
  });
});

describe('관리자 행 — 관리자 예외는 관리자 RPC·취소뿐', () => {
  it('일반 사용자 규칙으로 생성·신청·신고, 남의 모임 수정·마감·승인·출석은 NOT_HOST, 취소는 가능(관리자 취소)', async () => {
    const admin = await db.createUser({ admin: true });
    const { host, future, started, pendingId, confirmedId } = await hostFixture();
    const own = await createMeetingRpc(db, admin);
    expect(own).toBeTruthy();
    const other = await createMeetingRpc(db, host);
    expect(await apply(db, admin, other)).toBe('confirmed');
    await db.rpc(admin, `select public.submit_report('meeting', $1, 'spam', null)`, [other]);

    await expectRpcError(
      db.rpc(admin, 'select public.update_meeting($1, $2::jsonb)', [future, JSON.stringify(meetingInput({ title: '관리자 수정' }))]),
      'NOT_HOST',
    );
    await expectRpcError(db.rpc(admin, 'select public.set_meeting_recruiting($1, false)', [future]), 'NOT_HOST');
    await expectRpcError(db.rpc(admin, `select public.decide_participant($1, 'approve')`, [pendingId]), 'NOT_HOST');
    await expectRpcError(db.rpc(admin, `select public.mark_attendance($1, 'attended')`, [confirmedId]), 'NOT_HOST');
    // 진행 중 모임도 종료 전이면 관리자가 취소할 수 있다(meetings.test.ts '관리자는 종료 전까지 가능')
    await db.rpc(admin, 'select public.cancel_meeting($1, $2)', [started, '운영 정책 위반']);
    expect(await db.countMismatches()).toEqual([]);
  });
});

describe('관리자 계정의 상태 — 관리자 권한은 active 계정만(마이그레이션 9, docs/SECURITY.md §3.1)', () => {
  /** 관리자(active일 때 준비) + 숨김 모임 + 비공개 공간 + 신고 1건 */
  async function adminFixture() {
    const admin = await db.createUser({ admin: true });
    const host = await db.createUser();
    const reporter = await db.createUser();
    const visible = await createMeetingRpc(db, host);
    const hidden = await createMeetingRpc(db, host);
    await db.rpc(admin, 'select public.admin_set_meeting_hidden($1, true, $2)', [hidden, '준비']);
    await db.rpc(reporter, `select public.submit_report('meeting', $1, 'spam', null)`, [visible]);
    const venueId = await db.asOwner((q) =>
      q.value<string>(
        `insert into public.venues (name, region_code, address, venue_type, is_public)
         values ('비공개 공간', 'dunsan_tanbang', '대전 예시로 1', 'board_game_cafe', false) returning id`,
      ),
    );
    return { admin, host, visible, hidden, venueId };
  }

  type AdminFixture = Awaited<ReturnType<typeof adminFixture>>;

  /** 관리자 권한이 모두 막혔는지: 관리자 조회·쓰기 RPC, 관리자 취소, 테이블 쓰기 RLS, 숨김 모임·비공개 공간·신고·감사 로그 조회, isAdmin */
  async function expectNoAdminPower(userId: string, f: AdminFixture, cancelCode = 'NOT_HOST') {
    await expectRpcError(db.rpc(userId, 'select public.admin_list_meetings()'), 'NOT_ADMIN');
    await expectRpcError(db.rpc(userId, 'select public.admin_list_report_items()'), 'NOT_ADMIN');
    await expectRpcError(db.rpc(userId, 'select public.admin_set_meeting_hidden($1, false, null)', [f.hidden]), 'NOT_ADMIN');
    // 관리자 취소도 막힌다(남의 모임 → NOT_HOST. 탈퇴 요청 계정은 그보다 먼저 ACCOUNT_DELETION_REQUESTED)
    await expectRpcError(db.rpc(userId, 'select public.cancel_meeting($1, null)', [f.visible]), cancelCode);
    const venueUpdated = await db.asUser(userId, (q) =>
      q.query(`update public.venues set name = '바꿈' where id = $1 returning id`, [f.venueId]),
    );
    expect(venueUpdated).toHaveLength(0);
    const categoryUpdated = await db.asUser(userId, (q) =>
      q.query(`update public.categories set is_active = false where id = 'party' returning id`),
    );
    expect(categoryUpdated).toHaveLength(0);
    expect(await db.rpc(userId, 'select public.get_meeting($1)', [f.hidden])).toBeNull();
    expect(await db.asUser(userId, (q) => q.query('select id from public.meetings where id = $1', [f.hidden]))).toHaveLength(0);
    expect(await db.asUser(userId, (q) => q.query('select id from public.venues where id = $1', [f.venueId]))).toHaveLength(0);
    expect(await db.asUser(userId, (q) => q.query('select id from public.reports'))).toHaveLength(0);
    expect(await db.asUser(userId, (q) => q.query('select id from public.audit_logs'))).toHaveLength(0);
    expect(await db.rpc<{ isAdmin: boolean }>(userId, 'select public.get_my_profile()')).toMatchObject({ isAdmin: false });
  }

  it.each(['restricted', 'deletion_requested'] as const)('%s 상태인 관리자는 관리자 권한을 모두 잃는다(admin_roles 행은 남음)', async (status) => {
    const f = await adminFixture();
    await setStatus(f.admin, status);
    await expectNoAdminPower(f.admin, f, status === 'deletion_requested' ? 'ACCOUNT_DELETION_REQUESTED' : 'NOT_HOST');
    expect(
      await db.asOwner((q) => q.value<number>('select count(*)::int from public.admin_roles where user_id = $1', [f.admin])),
    ).toBe(1);
    // 일반 사용자로서의 쓰기도 계정 상태 규칙을 그대로 따른다
    await expectRpcError(apply(db, f.admin, f.visible), status === 'restricted' ? 'ACCOUNT_RESTRICTED' : 'ACCOUNT_DELETION_REQUESTED');
  });

  it('active로 되돌리면 관리자 권한이 바로 돌아온다(admin_roles 행이 그대로라서)', async () => {
    const f = await adminFixture();
    await setStatus(f.admin, 'restricted');
    await expectNoAdminPower(f.admin, f);
    await setStatus(f.admin, 'active');
    expect(await db.rpc<{ isAdmin: boolean }>(f.admin, 'select public.get_my_profile()')).toMatchObject({ isAdmin: true });
    expect((await db.rpc<{ total: number }>(f.admin, 'select public.admin_list_meetings()')).total).toBeGreaterThanOrEqual(2);
    expect(await db.rpc<{ id: string }>(f.admin, 'select public.get_meeting($1)', [f.hidden])).toMatchObject({ id: f.hidden });
    const updated = await db.asUser(f.admin, (q) =>
      q.query(`update public.venues set name = '바꾼 이름' where id = $1 returning id`, [f.venueId]),
    );
    expect(updated).toHaveLength(1);
    await db.rpc(f.admin, 'select public.admin_set_meeting_hidden($1, false, null)', [f.hidden]);
  });

  it('대조: 관리자가 아닌 active 계정과 같은 결과다', async () => {
    const f = await adminFixture();
    await expectNoAdminPower(await db.createUser(), f);
  });

  it('관리자는 자기 계정을 이용 제한할 수 없어 실수로 권한을 잃지 않는다', async () => {
    const admin = await db.createUser({ admin: true });
    await expectRpcError(db.rpc(admin, `select public.admin_set_user_status($1, 'restricted', null)`, [admin]), 'VALIDATION_FAILED', 'user_id');
    expect(await db.rpc<{ isAdmin: boolean }>(admin, 'select public.get_my_profile()')).toMatchObject({ isAdmin: true });
  });
});
