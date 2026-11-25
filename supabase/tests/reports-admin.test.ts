/**
 * 신고(submit_report)와 관리자 RPC(admin_*), 감사 로그.
 * TEST_PLAN §5(신고), DB_SCHEMA §9.14~9.15, SECURITY §3.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { apply, createMeetingRpc, createTestDb, expectRpcError, type TestDb } from './harness';

let db: TestDb;
beforeEach(async () => {
  db = await createTestDb();
});
afterEach(async () => {
  await db.close();
});

const report = (userId: string, type: 'meeting' | 'user', targetId: string, reason = 'spam', body: string | null = null) =>
  db.rpc<string>(userId, 'select public.submit_report($1::public.report_target, $2, $3::public.report_reason, $4)', [
    type,
    targetId,
    reason,
    body,
  ]);

describe('submit_report', () => {
  it('모임·사용자 신고 접수, 신고자는 자기 신고만 본다', async () => {
    const reporter = await db.createUser();
    const host = await db.createUser();
    const meetingId = await createMeetingRpc(db, host);
    const r1 = await report(reporter, 'meeting', meetingId, 'gambling', '판돈을 건다고 함');
    const r2 = await report(reporter, 'user', host, 'harassment', '  ');
    const rows = await db.asUser(reporter, (q) =>
      q.query<{ id: string; target_type: string; body: string; status: string }>(
        'select id, target_type, body, status from public.reports order by created_at, id',
      ),
    );
    expect(rows.map((r) => r.id).sort()).toEqual([r1, r2].sort());
    expect(rows.find((r) => r.id === r2)?.body).toBe('');
    expect(rows.every((r) => r.status === 'received')).toBe(true);
  });

  it('자기 자신·자기 모임 신고는 CANNOT_REPORT_SELF', async () => {
    const host = await db.createUser();
    const meetingId = await createMeetingRpc(db, host);
    await expectRpcError(report(host, 'user', host), 'CANNOT_REPORT_SELF');
    await expectRpcError(report(host, 'meeting', meetingId), 'CANNOT_REPORT_SELF');
  });

  it('없는 대상·볼 수 없는 숨김 모임은 NOT_FOUND', async () => {
    const reporter = await db.createUser();
    const host = await db.createUser();
    const hidden = await db.insertMeeting({ hostId: host, isHidden: true });
    await expectRpcError(report(reporter, 'meeting', hidden), 'NOT_FOUND');
    await expectRpcError(report(reporter, 'user', '00000000-0000-4000-8000-000000000000'), 'NOT_FOUND');
    await expectRpcError(report(reporter, 'meeting', '00000000-0000-4000-8000-000000000000'), 'NOT_FOUND');
  });

  it('미처리 중복 DUPLICATE_REPORT, 처리 후에는 다시 신고 가능', async () => {
    const reporter = await db.createUser();
    const target = await db.createUser();
    const admin = await db.createUser({ admin: true });
    const first = await report(reporter, 'user', target);
    await expectRpcError(report(reporter, 'user', target, 'other', '다른 사유'), 'DUPLICATE_REPORT');
    await db.rpc(admin, `select public.admin_update_report($1, 'reviewing', null)`, [first]);
    await expectRpcError(report(reporter, 'user', target), 'DUPLICATE_REPORT');
    await db.rpc(admin, `select public.admin_update_report($1, 'dismissed', '근거 부족')`, [first]);
    await report(reporter, 'user', target);
  });

  it('reason=other는 본문 필수, 본문 1000자 이하', async () => {
    const reporter = await db.createUser();
    const target = await db.createUser();
    await expectRpcError(report(reporter, 'user', target, 'other', null), 'VALIDATION_FAILED', 'body');
    await expectRpcError(report(reporter, 'user', target, 'other', '   '), 'VALIDATION_FAILED', 'body');
    await expectRpcError(report(reporter, 'user', target, 'spam', '가'.repeat(1001)), 'VALIDATION_FAILED', 'body');
    await report(reporter, 'user', target, 'other', '가'.repeat(1000));
  });

  it('24시간 11번째 신고는 RATE_LIMITED(report_24h)', async () => {
    const reporter = await db.createUser();
    const targets: string[] = [];
    for (let i = 0; i < 11; i += 1) targets.push(await db.createUser());
    for (const target of targets.slice(0, 10)) {
      await report(reporter, 'user', target);
    }
    const last = targets[10];
    if (!last) throw new Error('target');
    await expectRpcError(report(reporter, 'user', last), 'RATE_LIMITED', 'report_24h');
    // 24시간이 지난 신고는 세지 않는다
    await db.asOwner((q) =>
      q.query(`update public.reports set created_at = now() - interval '25 hours' where reporter_id = $1`, [reporter]),
    );
    await report(reporter, 'user', last);
  }, 60_000);

  it('이용 제한 계정도 신고 가능, 온보딩 전·탈퇴 요청은 불가', async () => {
    const restricted = await db.createUser({ status: 'restricted' });
    const fresh = await db.createUser({ onboarded: false });
    const leaving = await db.createUser({ status: 'deletion_requested' });
    const target = await db.createUser();
    await report(restricted, 'user', target);
    await expectRpcError(report(fresh, 'user', target), 'PROFILE_INCOMPLETE');
    await expectRpcError(report(leaving, 'user', target), 'ACCOUNT_DELETION_REQUESTED');
  });

  it('신고 대상이 삭제되면 신고 기록은 남고 대상 참조만 끊긴다', async () => {
    const reporter = await db.createUser();
    const target = await db.createUser();
    const reportId = await report(reporter, 'user', target);
    await db.asOwner((q) => q.query('delete from auth.users where id = $1', [target]));
    const row = await db.asOwner((q) =>
      q.one<{ target_user_id: string | null; reporter_id: string }>(
        'select target_user_id, reporter_id from public.reports where id = $1',
        [reportId],
      ),
    );
    expect(row).toEqual({ target_user_id: null, reporter_id: reporter });
  });
});

describe('관리자 RPC', () => {
  it('admin_list_reports: 전체 컬럼(admin_note 포함)·상태 필터, admin_update_report: 처리자·시각·audit', async () => {
    const admin = await db.createUser({ admin: true });
    const reporter = await db.createUser();
    const t1 = await db.createUser();
    const t2 = await db.createUser();
    const r1 = await report(reporter, 'user', t1);
    const r2 = await report(reporter, 'user', t2);
    await db.rpc(admin, `select public.admin_update_report($1, 'resolved', '  계정 제한 조치  ')`, [r1]);

    const all = await db.asUser(admin, (q) =>
      q.query<{ id: string; admin_note: string | null; handled_by: string | null; handled_at: string | null }>(
        'select * from public.admin_list_reports()',
      ),
    );
    expect(all).toHaveLength(2);
    const resolved = all.find((r) => r.id === r1);
    expect(resolved).toMatchObject({ admin_note: '계정 제한 조치', handled_by: admin });
    expect(resolved?.handled_at).not.toBeNull();

    const received = await db.asUser(admin, (q) =>
      q.query<{ id: string }>(`select id from public.admin_list_reports('received')`),
    );
    expect(received.map((r) => r.id)).toEqual([r2]);

    const paged = await db.asUser(admin, (q) => q.query('select id from public.admin_list_reports(null, 1, 1)'));
    expect(paged).toHaveLength(1);

    const audit = await db.asUser(admin, (q) =>
      q.query<{ meta: Record<string, string> }>(
        `select meta from public.audit_logs where action = 'admin.report_update' and target_id = $1`,
        [r1],
      ),
    );
    expect(audit).toEqual([{ meta: { from: 'received', to: 'resolved' } }]);
    await expectRpcError(
      db.rpc(admin, `select public.admin_update_report($1, 'resolved', null)`, ['00000000-0000-4000-8000-000000000000']),
      'NOT_FOUND',
    );
    await expectRpcError(
      db.rpc(admin, 'select public.admin_update_report($1, null, null)', [r2]),
      'VALIDATION_FAILED',
      'status',
    );
  });

  it('admin_set_meeting_hidden: 숨길 때 사유 필수, 숨기면 공개 목록·상세에서 사라지고 해제 시 사유 삭제', async () => {
    const admin = await db.createUser({ admin: true });
    const host = await db.createUser();
    const meetingId = await createMeetingRpc(db, host);
    await expectRpcError(
      db.rpc(admin, 'select public.admin_set_meeting_hidden($1, true, $2)', [meetingId, '  ']),
      'VALIDATION_FAILED',
      'reason',
    );
    await db.rpc(admin, 'select public.admin_set_meeting_hidden($1, true, $2)', [meetingId, '금전 홀덤 의심']);
    expect(await db.rpc(null, 'select public.get_meeting($1)', [meetingId])).toBeNull();
    const hostView = await db.rpc<{ isHidden: boolean; hiddenReason: string }>(host, 'select public.get_meeting($1)', [meetingId]);
    expect(hostView).toMatchObject({ isHidden: true, hiddenReason: '금전 홀덤 의심' });

    await db.rpc(admin, 'select public.admin_set_meeting_hidden($1, false, $2)', [meetingId, '무시되는 사유']);
    const visible = await db.rpc<{ isHidden: boolean; hiddenReason: string | null }>(null, 'select public.get_meeting($1)', [
      meetingId,
    ]);
    expect(visible).toMatchObject({ isHidden: false, hiddenReason: null });
    const logs = await db.asOwner((q) =>
      q.value<number>(`select count(*)::int from public.audit_logs where action = 'admin.meeting_hidden'`),
    );
    expect(logs).toBe(2);
  });

  it('admin_set_user_status: 제한하면 신청 불가, 모임은 자동 취소하지 않음, 본인·탈퇴 요청 계정·잘못된 상태 거부', async () => {
    const admin = await db.createUser({ admin: true });
    const user = await db.createUser();
    const host = await db.createUser();
    const leaver = await db.createUser({ status: 'deletion_requested' });
    const own = await createMeetingRpc(db, user);
    const other = await createMeetingRpc(db, host);

    await db.rpc(admin, `select public.admin_set_user_status($1, 'restricted', $2)`, [user, '반복 노쇼']);
    await expectRpcError(apply(db, user, other), 'ACCOUNT_RESTRICTED');
    const ownStatus = await db.asOwner((q) => q.value<string>('select status::text from public.meetings where id = $1', [own]));
    expect(ownStatus).toBe('open');
    expect((await db.rpc<{ status: string }>(user, 'select public.get_my_profile()')).status).toBe('restricted');

    const meta = await db.asOwner((q) =>
      q.value<Record<string, string>>(
        `select meta from public.audit_logs where action = 'admin.user_status' and target_id = $1`,
        [user],
      ),
    );
    expect(meta).toEqual({ from: 'active', to: 'restricted', note: '반복 노쇼' });

    await db.rpc(admin, `select public.admin_set_user_status($1, 'active', null)`, [user]);
    expect(await apply(db, user, other)).toBe('confirmed');

    await expectRpcError(
      db.rpc(admin, `select public.admin_set_user_status($1, 'restricted', null)`, [admin]),
      'VALIDATION_FAILED',
      'user_id',
    );
    await expectRpcError(
      db.rpc(admin, `select public.admin_set_user_status($1, 'active', null)`, [leaver]),
      'VALIDATION_FAILED',
      'status',
    );
    await expectRpcError(
      db.rpc(admin, `select public.admin_set_user_status($1, 'deletion_requested', null)`, [user]),
      'VALIDATION_FAILED',
      'status',
    );
    await expectRpcError(
      db.rpc(admin, `select public.admin_set_user_status($1, 'restricted', null)`, ['00000000-0000-4000-8000-000000000000']),
      'NOT_FOUND',
    );
  });

  it('admin_search_users: 닉네임 부분 일치(이스케이프)·id 일치, 최근 신고 수, 상태 포함', async () => {
    const admin = await db.createUser({ admin: true, nickname: '운영담당' });
    const target = await db.createUser({ nickname: 'Meeple_Lover' });
    await db.createUser({ nickname: 'MeepleXLover' });
    const reporter = await db.createUser();
    await report(reporter, 'user', target);

    type Row = { id: string; nickname: string; status: string; recent_report_count: number };
    const search = (q: string | null, limit = 20) =>
      db.asUser(admin, (tx) => tx.query<Row>('select * from public.admin_search_users($1, $2)', [q, limit]));

    expect((await search('meeple')).map((r) => r.nickname).sort()).toEqual(['MeepleXLover', 'Meeple_Lover']);
    expect((await search('meeple_')).map((r) => r.nickname)).toEqual(['Meeple_Lover']);
    const byId = await search(target);
    expect(byId).toHaveLength(1);
    expect(byId[0]).toMatchObject({ id: target, status: 'active', recent_report_count: 1 });
    expect(await search(null, 2)).toHaveLength(2);
    expect(await search('%')).toEqual([]);
  });
});
