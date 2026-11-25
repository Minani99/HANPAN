/**
 * 참가 RPC: apply_to_meeting, cancel_my_application, decide_participant, mark_attendance,
 * 내 모임·참가자 목록 조회, 정원·카운트 불변식.
 * 마스터 프롬프트 8장 #5·#6·#7, TEST_PLAN §2 #5·#6·#7, §5(신청·승인·출석·불변식).
 *
 * PGlite는 연결이 하나라 진짜 동시 신청은 재현할 수 없다. 여기서는 (1) 순차 신청 시 정원 초과 없음,
 * (2) 함수 정의에 for update가 있음, (3) check 제약이 초과 확정을 막음을 검증한다.
 * 동시성 자체는 scripts/race-test.ts(실제 Postgres, BLOCKED)에서 확인한다.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  apply,
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

function participantId(meetingId: string, userId: string): Promise<string> {
  return db.asOwner((q) =>
    q.value<string>('select id from public.meeting_participants where meeting_id = $1 and user_id = $2', [meetingId, userId]),
  );
}

function decide(hostId: string, pid: string, decision: string): Promise<string> {
  return db.rpc<string>(hostId, 'select public.decide_participant($1, $2)', [pid, decision]);
}

function cancelMine(userId: string, meetingId: string) {
  return db.rpc(userId, 'select public.cancel_my_application($1)', [meetingId]);
}

describe('apply_to_meeting 결정 규칙', () => {
  it('auto + 자리 있음 → confirmed, manual + 자리 있음 → pending', async () => {
    const host = await db.createUser();
    const guest = await db.createUser();
    const auto = await createMeetingRpc(db, host, { approval_mode: 'auto' });
    const manual = await createMeetingRpc(db, host, { approval_mode: 'manual' });
    expect(await apply(db, guest, auto, '  안녕하세요  ')).toBe('confirmed');
    expect(await apply(db, guest, manual)).toBe('pending');
    expect(await db.meetingCounts(auto)).toMatchObject({ confirmed: 2, pending: 0, waitlisted: 0 });
    expect(await db.meetingCounts(manual)).toMatchObject({ confirmed: 1, pending: 1, waitlisted: 0 });
    const stored = await db.asOwner((q) =>
      q.value<string>(
        `select message from public.meeting_participants where meeting_id = $1 and user_id = $2`,
        [auto, guest],
      ),
    );
    expect(stored).toBe('안녕하세요');
  });

  it('정원 1자리 남은 모임에 두 사용자가 순차 신청 → 1명 confirmed, 1명 waitlisted', async () => {
    const host = await db.createUser();
    const [g1, g2, g3] = [await db.createUser(), await db.createUser(), await db.createUser()];
    const meetingId = await createMeetingRpc(db, host, { max_participants: 3, allow_waitlist: true });
    expect(await apply(db, g1, meetingId)).toBe('confirmed');
    expect(await db.meetingCounts(meetingId)).toMatchObject({ remaining: 1 });
    expect(await apply(db, g2, meetingId)).toBe('confirmed');
    expect(await apply(db, g3, meetingId)).toBe('waitlisted');
    expect(await db.meetingCounts(meetingId)).toEqual({ confirmed: 3, pending: 0, waitlisted: 1, remaining: 0 });
  });

  it('대기 불가 모임에서 자리가 없으면 MEETING_FULL, 행이 생기지 않는다', async () => {
    const host = await db.createUser();
    const g1 = await db.createUser();
    const g2 = await db.createUser();
    const meetingId = await createMeetingRpc(db, host, { min_participants: 2, max_participants: 2, allow_waitlist: false });
    expect(await apply(db, g1, meetingId)).toBe('confirmed');
    await expectRpcError(apply(db, g2, meetingId), 'MEETING_FULL');
    expect(await db.participantStatus(meetingId, g2)).toBeNull();
    expect(await db.meetingCounts(meetingId)).toMatchObject({ confirmed: 2, remaining: 0 });
  });

  it('승인제 + 자리 없음 + 대기 허용 → waitlisted', async () => {
    const host = await db.createUser();
    const g1 = await db.createUser();
    const g2 = await db.createUser();
    const meetingId = await db.insertMeeting({ hostId: host, approvalMode: 'manual', maxParticipants: 2 });
    await db.insertParticipant(meetingId, g1, 'confirmed');
    expect(await apply(db, g2, meetingId)).toBe('waitlisted');
  });

  it('pending은 자리를 차지하지 않는다(승인 시 다시 검사)', async () => {
    const host = await db.createUser();
    const [g1, g2, g3] = [await db.createUser(), await db.createUser(), await db.createUser()];
    const meetingId = await createMeetingRpc(db, host, { approval_mode: 'manual', max_participants: 2 });
    expect(await apply(db, g1, meetingId)).toBe('pending');
    expect(await apply(db, g2, meetingId)).toBe('pending');
    expect(await apply(db, g3, meetingId)).toBe('pending');
    expect(await decide(host, await participantId(meetingId, g1), 'approve')).toBe('confirmed');
    await expectRpcError(decide(host, await participantId(meetingId, g2), 'approve'), 'MEETING_FULL');
    expect(await db.participantStatus(meetingId, g2)).toBe('pending');
    // 정원이 차면 다음 신청은 대기(또는 MEETING_FULL)
    const g4 = await db.createUser();
    expect(await apply(db, g4, meetingId)).toBe('waitlisted');
    expect(await db.meetingCounts(meetingId)).toEqual({ confirmed: 2, pending: 2, waitlisted: 1, remaining: 0 });
  });
});

describe('apply_to_meeting 거부 규칙', () => {
  it('중복 신청 ALREADY_APPLIED(pending/confirmed/waitlisted 모두)', async () => {
    const host = await db.createUser();
    const guest = await db.createUser();
    const auto = await createMeetingRpc(db, host);
    const manual = await createMeetingRpc(db, host, { approval_mode: 'manual' });
    const full = await db.insertMeeting({ hostId: host, maxParticipants: 2 });
    await db.insertParticipant(full, await db.createUser(), 'confirmed');
    await apply(db, guest, auto);
    await apply(db, guest, manual);
    expect(await apply(db, guest, full)).toBe('waitlisted');
    for (const meetingId of [auto, manual, full]) {
      await expectRpcError(apply(db, guest, meetingId), 'ALREADY_APPLIED');
    }
    expect(await db.meetingCounts(auto)).toMatchObject({ confirmed: 2 });
  });

  it('직접 insert로 신청을 우회할 수 없다(권한 오류), 소유자 권한에서도 unique 제약이 막는다', async () => {
    const host = await db.createUser();
    const guest = await db.createUser();
    const meetingId = await createMeetingRpc(db, host);
    await expectPermissionDenied(
      db.asUser(guest, (q) =>
        q.query(
          `insert into public.meeting_participants (meeting_id, user_id, role, status) values ($1, $2, 'guest', 'confirmed')`,
          [meetingId, guest],
        ),
      ),
    );
    await apply(db, guest, meetingId);
    await expectSqlState(db.insertParticipant(meetingId, guest, 'confirmed'), '23505');
  });

  it('자기 모임 OWN_MEETING, 취소 MEETING_CANCELLED, 모임장 마감 MEETING_NOT_OPEN', async () => {
    const host = await db.createUser();
    const guest = await db.createUser();
    const own = await createMeetingRpc(db, host);
    await expectRpcError(apply(db, host, own), 'OWN_MEETING');
    const cancelled = await db.insertMeeting({ hostId: host, status: 'cancelled' });
    await expectRpcError(apply(db, guest, cancelled), 'MEETING_CANCELLED');
    const closed = await db.insertMeeting({ hostId: host, status: 'closed' });
    await expectRpcError(apply(db, guest, closed), 'MEETING_NOT_OPEN');
  });

  it('진행 중·지난 모임 MEETING_STARTED', async () => {
    const host = await db.createUser();
    const guest = await db.createUser();
    const inProgress = await db.insertMeeting({ hostId: host, startAt: hoursFromNow(-0.5) });
    const past = await db.insertMeeting({ hostId: host, startAt: daysFromNow(-7) });
    await expectRpcError(apply(db, guest, inProgress), 'MEETING_STARTED');
    await expectRpcError(apply(db, guest, past), 'MEETING_STARTED');
    expect(await db.participantStatus(past, guest)).toBeNull();
  });

  it('숨김·없는 모임 NOT_FOUND', async () => {
    const host = await db.createUser();
    const guest = await db.createUser();
    const hidden = await db.insertMeeting({ hostId: host, isHidden: true });
    await expectRpcError(apply(db, guest, hidden), 'NOT_FOUND');
    await expectRpcError(apply(db, guest, '00000000-0000-4000-8000-000000000000'), 'NOT_FOUND');
  });

  it('거절된 신청 재신청 APPLICATION_REJECTED, 본인 취소 후 재신청은 같은 행을 재사용', async () => {
    const host = await db.createUser();
    const rejected = await db.createUser();
    const again = await db.createUser();
    const meetingId = await createMeetingRpc(db, host, { approval_mode: 'manual' });
    await apply(db, rejected, meetingId);
    await decide(host, await participantId(meetingId, rejected), 'reject');
    await expectRpcError(apply(db, rejected, meetingId), 'APPLICATION_REJECTED');

    await apply(db, again, meetingId);
    const firstId = await participantId(meetingId, again);
    await cancelMine(again, meetingId);
    expect(await apply(db, again, meetingId, '다시 신청')).toBe('pending');
    expect(await participantId(meetingId, again)).toBe(firstId);
    const row = await db.asOwner((q) =>
      q.one<{ status: string; cancelled_at: string | null; message: string }>(
        'select status, cancelled_at, message from public.meeting_participants where id = $1',
        [firstId],
      ),
    );
    expect(row).toEqual({ status: 'pending', cancelled_at: null, message: '다시 신청' });
  });

  it('이용 제한 ACCOUNT_RESTRICTED, 온보딩 전 PROFILE_INCOMPLETE, 메시지 200자 초과 VALIDATION_FAILED', async () => {
    const host = await db.createUser();
    const restricted = await db.createUser({ status: 'restricted' });
    const fresh = await db.createUser({ onboarded: false });
    const guest = await db.createUser();
    const meetingId = await createMeetingRpc(db, host);
    await expectRpcError(apply(db, restricted, meetingId), 'ACCOUNT_RESTRICTED');
    await expectRpcError(apply(db, fresh, meetingId), 'PROFILE_INCOMPLETE');
    await expectRpcError(apply(db, guest, meetingId, '가'.repeat(201)), 'VALIDATION_FAILED', 'message');
    expect(await apply(db, guest, meetingId, '가'.repeat(200))).toBe('confirmed');
  });
});

describe('동시성 방어(PGlite에서 검증 가능한 부분)', () => {
  it('신청·승인·취소 함수 정의에 모임 행 for update가 있다', async () => {
    for (const fn of [
      'public.apply_to_meeting(uuid, text)',
      'public.decide_participant(uuid, text)',
      'public.cancel_my_application(uuid)',
      'public.cancel_meeting(uuid, text)',
      'public.update_meeting(uuid, jsonb)',
    ]) {
      const def = await db.asOwner((q) => q.value<string>(`select pg_get_functiondef($1::regprocedure)`, [fn]));
      expect(def, fn).toMatch(/from public\.meetings where id = [a-z_]+ for update/);
    }
    const applyDef = await db.asOwner((q) =>
      q.value<string>(`select pg_get_functiondef('public.apply_to_meeting(uuid, text)'::regprocedure)`),
    );
    // 모임 잠금이 참가 행 잠금보다 먼저 온다(잠금 순서)
    const meetingLock = applyDef.indexOf('from public.meetings where id = p_meeting_id for update');
    const participantLock = applyDef.indexOf('from public.meeting_participants');
    expect(meetingLock).toBeGreaterThan(0);
    expect(participantLock).toBeGreaterThan(meetingLock);
  });

  it('check 제약이 정원 초과 확정을 직접 막는다(카운트 동기화가 check에 걸림)', async () => {
    const host = await db.createUser();
    const g1 = await db.createUser();
    const g2 = await db.createUser();
    const meetingId = await db.insertMeeting({ hostId: host, maxParticipants: 2 });
    await db.insertParticipant(meetingId, g1, 'confirmed');
    await expectSqlState(db.insertParticipant(meetingId, g2, 'confirmed'), '23514');
    expect(await db.meetingCounts(meetingId)).toMatchObject({ confirmed: 2 });
  });
});

describe('cancel_my_application', () => {
  it('확정 취소 시 카운트 감소, 대기자 자동 승격 없음', async () => {
    const host = await db.createUser();
    const [g1, g2] = [await db.createUser(), await db.createUser()];
    const meetingId = await createMeetingRpc(db, host, { min_participants: 2, max_participants: 2 });
    expect(await apply(db, g1, meetingId)).toBe('confirmed');
    expect(await apply(db, g2, meetingId)).toBe('waitlisted');
    await cancelMine(g1, meetingId);
    expect(await db.participantStatus(meetingId, g1)).toBe('cancelled');
    expect(await db.participantStatus(meetingId, g2)).toBe('waitlisted');
    expect(await db.meetingCounts(meetingId)).toEqual({ confirmed: 1, pending: 0, waitlisted: 1, remaining: 1 });
    // 모임장이 대기자를 직접 승인한다
    expect(await decide(host, await participantId(meetingId, g2), 'approve')).toBe('confirmed');
    expect(await db.meetingCounts(meetingId)).toEqual({ confirmed: 2, pending: 0, waitlisted: 0, remaining: 0 });
  });

  it('pending·waitlisted 취소도 카운트를 맞춘다', async () => {
    const host = await db.createUser();
    const guest = await db.createUser();
    const meetingId = await createMeetingRpc(db, host, { approval_mode: 'manual' });
    await apply(db, guest, meetingId);
    await cancelMine(guest, meetingId);
    expect(await db.meetingCounts(meetingId)).toMatchObject({ confirmed: 1, pending: 0 });
  });

  it('신청 없음 NOT_APPLIED, 모임장 OWN_MEETING, 시작 후 MEETING_STARTED, 이미 취소 NOT_APPLIED', async () => {
    const host = await db.createUser();
    const guest = await db.createUser();
    const stranger = await db.createUser();
    const meetingId = await createMeetingRpc(db, host);
    await expectRpcError(cancelMine(stranger, meetingId), 'NOT_APPLIED');
    await expectRpcError(cancelMine(host, meetingId), 'OWN_MEETING');
    await apply(db, guest, meetingId);
    await db.moveMeeting(meetingId, hoursFromNow(-0.5));
    await expectRpcError(cancelMine(guest, meetingId), 'MEETING_STARTED');
    await db.moveMeeting(meetingId, hoursFromNow(5));
    await cancelMine(guest, meetingId);
    await expectRpcError(cancelMine(guest, meetingId), 'NOT_APPLIED');
  });

  it('이용 제한 계정도 본인 신청은 취소할 수 있다', async () => {
    const host = await db.createUser();
    const guest = await db.createUser();
    const meetingId = await createMeetingRpc(db, host);
    await apply(db, guest, meetingId);
    await db.asOwner((q) => q.query(`update public.profiles set status = 'restricted' where id = $1`, [guest]));
    await cancelMine(guest, meetingId);
    expect(await db.participantStatus(meetingId, guest)).toBe('cancelled');
  });
});

describe('decide_participant', () => {
  it('거절 → rejected(카운트 감소), 확정자·모임장 행 대상은 INVALID_STATE, 잘못된 결정 값 VALIDATION_FAILED', async () => {
    const host = await db.createUser();
    const [g1, g2] = [await db.createUser(), await db.createUser()];
    const meetingId = await createMeetingRpc(db, host, { approval_mode: 'manual' });
    await apply(db, g1, meetingId);
    await apply(db, g2, meetingId);
    expect(await decide(host, await participantId(meetingId, g1), 'reject')).toBe('rejected');
    expect(await db.meetingCounts(meetingId)).toMatchObject({ pending: 1 });
    await expectRpcError(decide(host, await participantId(meetingId, g1), 'approve'), 'INVALID_STATE');
    expect(await decide(host, await participantId(meetingId, g2), 'approve')).toBe('confirmed');
    await expectRpcError(decide(host, await participantId(meetingId, g2), 'reject'), 'INVALID_STATE');
    await expectRpcError(decide(host, await participantId(meetingId, host), 'reject'), 'INVALID_STATE');
    await expectRpcError(decide(host, await participantId(meetingId, g2), 'kick'), 'VALIDATION_FAILED', 'decision');
    await expectRpcError(decide(host, '00000000-0000-4000-8000-000000000000', 'approve'), 'NOT_FOUND');
  });

  it('시작 후·취소된 모임에서는 승인 불가', async () => {
    const host = await db.createUser();
    const guest = await db.createUser();
    const meetingId = await createMeetingRpc(db, host, { approval_mode: 'manual' });
    await apply(db, guest, meetingId);
    const pid = await participantId(meetingId, guest);
    await db.moveMeeting(meetingId, hoursFromNow(-1));
    await expectRpcError(decide(host, pid, 'approve'), 'MEETING_STARTED');
    await db.moveMeeting(meetingId, hoursFromNow(5));
    await db.rpc(host, 'select public.cancel_meeting($1, null)', [meetingId]);
    await expectRpcError(decide(host, pid, 'approve'), 'MEETING_CANCELLED');
  });

  it('이용 제한된 모임장은 승인 불가(ACCOUNT_RESTRICTED)', async () => {
    const host = await db.createUser();
    const guest = await db.createUser();
    const meetingId = await createMeetingRpc(db, host, { approval_mode: 'manual' });
    await apply(db, guest, meetingId);
    await db.asOwner((q) => q.query(`update public.profiles set status = 'restricted' where id = $1`, [host]));
    await expectRpcError(decide(host, await participantId(meetingId, guest), 'approve'), 'ACCOUNT_RESTRICTED');
  });
});

describe('mark_attendance', () => {
  async function setup(startAt: Date, durationMinutes = 120) {
    const host = await db.createUser();
    const confirmed = await db.createUser();
    const waitlisted = await db.createUser();
    const meetingId = await db.insertMeeting({ hostId: host, startAt, durationMinutes, maxParticipants: 2 });
    const confirmedId = await db.insertParticipant(meetingId, confirmed, 'confirmed');
    const waitlistedId = await db.insertParticipant(meetingId, waitlisted, 'waitlisted');
    return { host, meetingId, confirmedId, waitlistedId };
  }

  const mark = (userId: string, pid: string, value: string) =>
    db.rpc(userId, 'select public.mark_attendance($1, $2::public.attendance_status)', [pid, value]);

  it('시작 전 ATTENDANCE_WINDOW_CLOSED', async () => {
    const { host, confirmedId } = await setup(hoursFromNow(3));
    await expectRpcError(mark(host, confirmedId, 'attended'), 'ATTENDANCE_WINDOW_CLOSED');
  });

  it('진행 중·종료 7일 이내 허용, 확정 게스트만(대기자·모임장 INVALID_STATE)', async () => {
    const { host, meetingId, confirmedId, waitlistedId } = await setup(hoursFromNow(-1));
    await mark(host, confirmedId, 'attended');
    const row = await db.asOwner((q) =>
      q.one<{ attendance: string; marked: string | null }>(
        'select attendance, attendance_marked_at as marked from public.meeting_participants where id = $1',
        [confirmedId],
      ),
    );
    expect(row.attendance).toBe('attended');
    expect(row.marked).not.toBeNull();
    await expectRpcError(mark(host, waitlistedId, 'attended'), 'INVALID_STATE');
    await expectRpcError(mark(host, await participantId(meetingId, host), 'attended'), 'INVALID_STATE');

    const later = await setup(daysFromNow(-6.5));
    await mark(later.host, later.confirmedId, 'absent');
  });

  it('종료 7일 이후 ATTENDANCE_WINDOW_CLOSED, 모임장 아님 NOT_HOST, 취소된 모임 MEETING_CANCELLED', async () => {
    const old = await setup(daysFromNow(-8));
    await expectRpcError(mark(old.host, old.confirmedId, 'attended'), 'ATTENDANCE_WINDOW_CLOSED');
    const current = await setup(hoursFromNow(-1));
    const stranger = await db.createUser();
    await expectRpcError(mark(stranger, current.confirmedId, 'attended'), 'NOT_HOST');
    await db.asOwner((q) =>
      q.query(`update public.meetings set status = 'cancelled', cancelled_at = now() where id = $1`, [current.meetingId]),
    );
    await expectRpcError(mark(current.host, current.confirmedId, 'attended'), 'MEETING_CANCELLED');
  });
});

describe('조회 RPC', () => {
  it('get_my_participation: 본인 행, 모임장은 role=host, 신청 없으면 null', async () => {
    const host = await db.createUser();
    const guest = await db.createUser();
    const meetingId = await createMeetingRpc(db, host);
    expect(await db.rpc(guest, 'select public.get_my_participation($1)', [meetingId])).toBeNull();
    await apply(db, guest, meetingId, '반가워요');
    const mine = await db.rpc<Record<string, unknown>>(guest, 'select public.get_my_participation($1)', [meetingId]);
    expect(mine).toMatchObject({ meetingId, role: 'guest', status: 'confirmed', attendance: 'unknown', message: '반가워요' });
    expect(Object.keys(mine).sort()).toEqual(
      [
        'id',
        'meetingId',
        'userId',
        'role',
        'status',
        'attendance',
        'message',
        'appliedAt',
        'decidedAt',
        'confirmedAt',
        'cancelledAt',
        'attendanceMarkedAt',
        'updatedAt',
      ].sort(),
    );
    const hostRow = await db.rpc<Record<string, unknown>>(host, 'select public.get_my_participation($1)', [meetingId]);
    expect(hostRow).toMatchObject({ role: 'host', status: 'confirmed' });
  });

  it('list_meeting_participants: 모임장·관리자만, 닉네임 포함, 모임장 행 먼저', async () => {
    const host = await db.createUser({ nickname: '모임장닉' });
    const guest = await db.createUser({ nickname: '참가자닉' });
    const admin = await db.createUser({ admin: true });
    const meetingId = await createMeetingRpc(db, host, { approval_mode: 'manual' });
    await apply(db, guest, meetingId, '메시지');
    const rows = await db.rpc<Array<Record<string, unknown>>>(host, 'select public.list_meeting_participants($1)', [meetingId]);
    expect(rows.map((r) => [r.nickname, r.role, r.status])).toEqual([
      ['모임장닉', 'host', 'confirmed'],
      ['참가자닉', 'guest', 'pending'],
    ]);
    expect(rows[1]).toMatchObject({ userId: guest, message: '메시지' });
    const asAdmin = await db.rpc<unknown[]>(admin, 'select public.list_meeting_participants($1)', [meetingId]);
    expect(asAdmin).toHaveLength(2);
    await expectRpcError(db.rpc(guest, 'select public.list_meeting_participants($1)', [meetingId]), 'NOT_HOST');
    await expectRpcError(
      db.rpc(host, 'select public.list_meeting_participants($1)', ['00000000-0000-4000-8000-000000000000']),
      'NOT_FOUND',
    );
  });

  it('list_my_meetings: 주최(숨김 포함)·참가(숨김이면 meeting=null), 시작 시각 내림차순', async () => {
    const host = await db.createUser();
    const guest = await db.createUser();
    const otherHost = await db.createUser();
    const mine1 = await createMeetingRpc(db, host, { start_at: daysFromNow(2).toISOString(), title: '내 모임 1' });
    const mine2 = await db.insertMeeting({ hostId: host, startAt: daysFromNow(5), isHidden: true, title: '내 숨김 모임' });
    const joinedOpen = await createMeetingRpc(db, otherHost, { start_at: daysFromNow(3).toISOString(), title: '참가 모임' });
    const joinedHidden = await createMeetingRpc(db, otherHost, { start_at: daysFromNow(4).toISOString(), title: '숨겨질 모임' });
    await apply(db, guest, joinedOpen);
    await apply(db, guest, joinedHidden);
    await apply(db, host, joinedOpen);
    await db.asOwner((q) => q.query('update public.meetings set is_hidden = true where id = $1', [joinedHidden]));

    const hostView = await db.rpc<{ hosted: Array<{ id: string; isHidden: boolean }>; joined: unknown[] }>(
      host,
      'select public.list_my_meetings()',
    );
    expect(hostView.hosted.map((m) => m.id)).toEqual([mine2, mine1]);
    expect(hostView.hosted[0]?.isHidden).toBe(true);
    expect(hostView.joined).toHaveLength(1);

    const guestView = await db.rpc<{
      hosted: unknown[];
      joined: Array<{ meeting: { id: string } | null; participation: { meetingId: string; status: string } }>;
    }>(guest, 'select public.list_my_meetings()');
    expect(guestView.hosted).toEqual([]);
    expect(guestView.joined.map((j) => j.participation.meetingId)).toEqual([joinedHidden, joinedOpen]);
    expect(guestView.joined[0]?.meeting).toBeNull();
    expect(guestView.joined[1]?.meeting?.id).toBe(joinedOpen);
    expect(guestView.joined[1]?.participation.status).toBe('confirmed');
  });
});

describe('카운트 불변식', () => {
  it('여러 동작 뒤에도 confirmed/pending/waitlist 카운트 = 실제 행 집계', async () => {
    const host = await db.createUser();
    const users = [];
    for (let i = 0; i < 6; i += 1) users.push(await db.createUser());
    const [u0, u1, u2, u3, u4, u5] = users as [string, string, string, string, string, string];
    const auto = await createMeetingRpc(db, host, { max_participants: 3 });
    const manual = await createMeetingRpc(db, host, { approval_mode: 'manual', max_participants: 3 });

    await apply(db, u0, auto);
    await apply(db, u1, auto);
    await apply(db, u2, auto); // waitlisted
    await apply(db, u3, auto); // waitlisted
    await cancelMine(u1, auto);
    await decide(host, await participantId(auto, u2), 'approve');
    await decide(host, await participantId(auto, u3), 'reject');
    await apply(db, u1, auto); // 재신청 → waitlisted

    await apply(db, u0, manual);
    await apply(db, u4, manual);
    await apply(db, u5, manual);
    await decide(host, await participantId(manual, u0), 'approve');
    await decide(host, await participantId(manual, u4), 'approve');
    await cancelMine(u4, manual);
    await decide(host, await participantId(manual, u5), 'approve');

    expect(await db.meetingCounts(auto)).toEqual({ confirmed: 3, pending: 0, waitlisted: 1, remaining: 0 });
    expect(await db.meetingCounts(manual)).toEqual({ confirmed: 3, pending: 0, waitlisted: 0, remaining: 0 });
    expect(await db.countMismatches()).toEqual([]);

    await db.rpc(host, 'select public.cancel_meeting($1, null)', [manual]);
    await db.rpc(u0, 'select public.request_account_deletion()');
    expect(await db.countMismatches()).toEqual([]);
  }, 60_000);
});
