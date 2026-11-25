/**
 * 모임 쓰기 RPC: create_meeting(경계값·레이트 리밋), update_meeting, cancel_meeting, set_meeting_recruiting.
 * 마스터 프롬프트 8장 #7·#8, TEST_PLAN §5(생성·수정).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  apply,
  createMeetingRpc,
  createTestDb,
  daysFromNow,
  expectRpcError,
  hoursFromNow,
  meetingInput,
  minutesFromNow,
  type TestDb,
} from './harness';

let db: TestDb;
beforeEach(async () => {
  db = await createTestDb();
});
afterEach(async () => {
  await db.close();
});

function create(userId: string, overrides: Record<string, unknown> = {}) {
  return createMeetingRpc(db, userId, overrides);
}

function update(userId: string, meetingId: string, overrides: Record<string, unknown> = {}) {
  return db.rpc(userId, 'select public.update_meeting($1, $2::jsonb)', [
    meetingId,
    JSON.stringify(meetingInput(overrides)),
  ]);
}

async function meetingRow(meetingId: string) {
  return db.asOwner((q) => q.one<Record<string, unknown>>('select * from public.meetings where id = $1', [meetingId]));
}

describe('create_meeting', () => {
  it('모임과 모임장 참가 행을 만들고 카운트는 1/0/0, audit meeting.create', async () => {
    const host = await db.createUser();
    const meetingId = await create(host, { title: '  앞뒤 공백 제목  ', notice: '   ' });
    const row = await meetingRow(meetingId);
    expect(row).toMatchObject({
      host_id: host,
      title: '앞뒤 공백 제목',
      notice: null,
      status: 'open',
      confirmed_count: 1,
      pending_count: 0,
      waitlist_count: 0,
      remaining_seats: 3,
      is_hidden: false,
    });
    expect(new Date(row.end_at as string).getTime() - new Date(row.start_at as string).getTime()).toBe(120 * 60_000);
    const hostRow = await db.asOwner((q) =>
      q.one('select role, status from public.meeting_participants where meeting_id = $1', [meetingId]),
    );
    expect(hostRow).toEqual({ role: 'host', status: 'confirmed' });
    const audit = await db.asOwner((q) =>
      q.query<{ action: string; actor_id: string }>(
        `select action, actor_id from public.audit_logs where target_id = $1`,
        [meetingId],
      ),
    );
    expect(audit).toEqual([{ action: 'meeting.create', actor_id: host }]);
  });

  it('정의되지 않은 키(host_id, status, confirmed_count, is_hidden 등)는 무시한다', async () => {
    const host = await db.createUser();
    const other = await db.createUser();
    const meetingId = await create(host, {
      host_id: other,
      status: 'closed',
      confirmed_count: 99,
      is_hidden: true,
      remaining_seats: 100,
      end_at: daysFromNow(80).toISOString(),
    });
    expect(await meetingRow(meetingId)).toMatchObject({
      host_id: host,
      status: 'open',
      confirmed_count: 1,
      is_hidden: false,
    });
  });

  it('시작 시각: 29분 후 거부, 31분 후 허용, 90일 초과 거부, 89일 허용, 오프셋 없는 문자열 거부', async () => {
    const host = await db.createUser();
    await expectRpcError(create(host, { start_at: minutesFromNow(29).toISOString() }), 'VALIDATION_FAILED', 'start_at');
    await create(host, { start_at: minutesFromNow(31).toISOString() });
    await expectRpcError(create(host, { start_at: daysFromNow(90.1).toISOString() }), 'VALIDATION_FAILED', 'start_at');
    await create(host, { start_at: daysFromNow(89).toISOString() });
    await expectRpcError(create(host, { start_at: '2030-01-01T19:00:00' }), 'VALIDATION_FAILED', 'start_at');
    await expectRpcError(create(host, { start_at: daysFromNow(-1).toISOString() }), 'VALIDATION_FAILED', 'start_at');
    await expectRpcError(create(host, { start_at: 'tomorrow' }), 'VALIDATION_FAILED', 'start_at');
  });

  it('KST 오프셋(+09:00) 입력을 UTC로 저장한다', async () => {
    const host = await db.createUser();
    const start = daysFromNow(3);
    start.setUTCSeconds(0, 0);
    const kst = new Date(start.getTime() + 9 * 3_600_000).toISOString().replace('Z', '+09:00');
    const meetingId = await create(host, { start_at: kst });
    const row = await meetingRow(meetingId);
    expect(new Date(row.start_at as string).getTime()).toBe(start.getTime());
  });

  it('소요 시간 29/30/720/721분', async () => {
    const host = await db.createUser();
    await expectRpcError(create(host, { duration_minutes: 29 }), 'VALIDATION_FAILED', 'duration_minutes');
    await create(host, { duration_minutes: 30 });
    await create(host, { duration_minutes: 720 });
    await expectRpcError(create(host, { duration_minutes: 721 }), 'VALIDATION_FAILED', 'duration_minutes');
    await expectRpcError(create(host, { duration_minutes: '120' }), 'VALIDATION_FAILED', 'duration_minutes');
    await expectRpcError(create(host, { duration_minutes: 90.5 }), 'VALIDATION_FAILED', 'duration_minutes');
  });

  it('정원 1/2/30/31명, 최소 인원 1명, min > max', async () => {
    const host = await db.createUser();
    await expectRpcError(create(host, { min_participants: 2, max_participants: 1 }), 'VALIDATION_FAILED', 'max_participants');
    await create(host, { min_participants: 2, max_participants: 2 });
    await create(host, { min_participants: 2, max_participants: 30 });
    await expectRpcError(create(host, { max_participants: 31 }), 'VALIDATION_FAILED', 'max_participants');
    await expectRpcError(create(host, { min_participants: 1 }), 'VALIDATION_FAILED', 'min_participants');
    await expectRpcError(create(host, { min_participants: 5, max_participants: 4 }), 'VALIDATION_FAILED', 'min_participants');
  });

  it('제목 1/2/60/61자(공백 제거 후), 소개·유의사항·장소 메모·게임명 길이', async () => {
    const host = await db.createUser();
    await expectRpcError(create(host, { title: '가' }), 'VALIDATION_FAILED', 'title');
    await expectRpcError(create(host, { title: '  가  ' }), 'VALIDATION_FAILED', 'title');
    await create(host, { title: '가나' });
    await create(host, { title: '가'.repeat(60) });
    await expectRpcError(create(host, { title: '가'.repeat(61) }), 'VALIDATION_FAILED', 'title');
    await expectRpcError(create(host, { title: 123 }), 'VALIDATION_FAILED', 'title');
    await expectRpcError(create(host, { description: '가'.repeat(2001) }), 'VALIDATION_FAILED', 'description');
    await expectRpcError(create(host, { notice: '가'.repeat(1001) }), 'VALIDATION_FAILED', 'notice');
    await expectRpcError(create(host, { venue_note: '가'.repeat(61) }), 'VALIDATION_FAILED', 'venue_note');
    await expectRpcError(create(host, { game_name: '가'.repeat(41) }), 'VALIDATION_FAILED', 'game_name');
  }, 60_000);

  it('enum·참조 값 검증: 카테고리·권역·난이도·승인 방식, 비활성 카테고리', async () => {
    const host = await db.createUser();
    await expectRpcError(create(host, { category_id: 'casino' }), 'VALIDATION_FAILED', 'category_id');
    await expectRpcError(create(host, { region_code: 'seoul' }), 'VALIDATION_FAILED', 'region_code');
    await expectRpcError(create(host, { skill_level: 'pro' }), 'VALIDATION_FAILED', 'skill_level');
    await expectRpcError(create(host, { approval_mode: 'lottery' }), 'VALIDATION_FAILED', 'approval_mode');
    await expectRpcError(create(host, { allow_waitlist: 'yes' }), 'VALIDATION_FAILED', 'allow_waitlist');
    await db.asOwner((q) => q.query(`update public.categories set is_active = false where id = 'mahjong_etc'`));
    await expectRpcError(create(host, { category_id: 'mahjong_etc' }), 'VALIDATION_FAILED', 'category_id');
    await expectRpcError(
      db.rpc(host, 'select public.create_meeting($1::jsonb)', ['[]']),
      'VALIDATION_FAILED',
      'input',
    );
  });

  it('game_id와 game_name 동시 지정은 VALIDATION_FAILED', async () => {
    const host = await db.createUser();
    const gameId = await db.asOwner((q) =>
      q.value<string>(`insert into public.games (name, category_id) values ('카탄', 'strategy') returning id`),
    );
    await expectRpcError(create(host, { game_id: gameId, game_name: '카탄' }), 'VALIDATION_FAILED', 'game');
    const meetingId = await create(host, { game_id: gameId });
    const detail = await db.rpc<{ gameName: string; gameId: string }>(null, 'select public.get_meeting($1)', [meetingId]);
    expect(detail).toMatchObject({ gameId, gameName: '카탄' });
    await expectRpcError(create(host, { game_id: 'not-a-uuid' }), 'VALIDATION_FAILED', 'game_id');
    await expectRpcError(
      create(host, { game_id: '00000000-0000-4000-8000-000000000000' }),
      'VALIDATION_FAILED',
      'game_id',
    );
  });

  it('공간: 비공개 공간·권역 불일치 거부', async () => {
    const host = await db.createUser();
    const [publicVenue, privateVenue] = await db.asOwner(async (q) => [
      await q.value<string>(
        `insert into public.venues (name, region_code, address, venue_type, is_public)
         values ('공개', 'dunsan_tanbang', '대전', 'board_game_cafe', true) returning id`,
      ),
      await q.value<string>(
        `insert into public.venues (name, region_code, address, venue_type, is_public)
         values ('비공개', 'dunsan_tanbang', '대전', 'board_game_cafe', false) returning id`,
      ),
    ]);
    await expectRpcError(create(host, { venue_id: privateVenue }), 'VALIDATION_FAILED', 'venue_id');
    await expectRpcError(
      create(host, { venue_id: publicVenue, region_code: 'noeun_jijok' }),
      'VALIDATION_FAILED',
      'venue_id',
    );
    await create(host, { venue_id: publicVenue });
  });

  it('홀덤(비금전)은 동의가 없으면 HOLDEM_AGREEMENT_REQUIRED', async () => {
    const host = await db.createUser();
    await expectRpcError(create(host, { category_id: 'holdem_social' }), 'HOLDEM_AGREEMENT_REQUIRED');
    await expectRpcError(
      create(host, { category_id: 'holdem_social', holdem_policy_agreed: false }),
      'HOLDEM_AGREEMENT_REQUIRED',
    );
    await create(host, { category_id: 'holdem_social', holdem_policy_agreed: true });
  });

  it('계정 상태: 온보딩 전 PROFILE_INCOMPLETE, 이용 제한 ACCOUNT_RESTRICTED, 탈퇴 요청 ACCOUNT_DELETION_REQUESTED', async () => {
    const fresh = await db.createUser({ onboarded: false });
    const restricted = await db.createUser({ status: 'restricted' });
    const leaving = await db.createUser({ status: 'deletion_requested' });
    await expectRpcError(create(fresh), 'PROFILE_INCOMPLETE');
    await expectRpcError(create(restricted), 'ACCOUNT_RESTRICTED');
    await expectRpcError(create(leaving), 'ACCOUNT_DELETION_REQUESTED');
  });

  it('레이트 리밋: 24시간 6번째 생성 → RATE_LIMITED(create_24h)', async () => {
    const host = await db.createUser();
    for (let i = 0; i < 5; i += 1) {
      await create(host, { title: `모임 ${i}` });
    }
    await expectRpcError(create(host, { title: '여섯 번째' }), 'RATE_LIMITED', 'create_24h');
    // 취소한 모임도 24시간 집계에 포함된다
    const firstId = await db.asOwner((q) => q.value<string>('select id from public.meetings limit 1'));
    await db.rpc(host, 'select public.cancel_meeting($1, null)', [firstId]);
    await expectRpcError(create(host, { title: '여전히 제한' }), 'RATE_LIMITED', 'create_24h');
  });

  it('레이트 리밋: 진행 예정 주최 모임 10개면 11번째 → RATE_LIMITED(open_meetings)', async () => {
    const host = await db.createUser();
    for (let i = 0; i < 10; i += 1) {
      await db.insertMeeting({ hostId: host, startAt: daysFromNow(2 + i), createdAt: daysFromNow(-3) });
    }
    await expectRpcError(create(host), 'RATE_LIMITED', 'open_meetings');
    // 지난 모임·취소된 모임은 세지 않는다
    await db.asOwner((q) =>
      q.query(
        `update public.meetings set status = 'cancelled', cancelled_at = now()
         where id = (select id from public.meetings order by start_at limit 1)`,
      ),
    );
    await create(host);
  });
});

describe('update_meeting', () => {
  it('모임장은 전체 필드를 갱신하고 audit에 바뀐 필드 이름을 남긴다', async () => {
    const host = await db.createUser();
    const startAt = hoursFromNow(48).toISOString();
    const meetingId = await create(host, { start_at: startAt });
    await update(host, meetingId, { start_at: startAt, title: '새 제목', max_participants: 6 });
    const row = await meetingRow(meetingId);
    expect(row).toMatchObject({ title: '새 제목', max_participants: 6, remaining_seats: 5 });
    const meta = await db.asOwner((q) =>
      q.value<{ fields: string[] }>(
        `select meta from public.audit_logs where action = 'meeting.update' and target_id = $1`,
        [meetingId],
      ),
    );
    expect(meta.fields.sort()).toEqual(['max_participants', 'title']);
  });

  it('시작 시각을 바꾸지 않으면 30분 규칙을 적용하지 않는다(시작 20분 전 수정 허용)', async () => {
    const host = await db.createUser();
    const meetingId = await create(host);
    const soon = minutesFromNow(20);
    await db.moveMeeting(meetingId, soon);
    const stored = (await meetingRow(meetingId)).start_at as string;
    await update(host, meetingId, { start_at: new Date(stored).toISOString(), title: '임박 수정' });
    expect((await meetingRow(meetingId)).title).toBe('임박 수정');
    // 바꾸면 규칙 적용
    await expectRpcError(
      update(host, meetingId, { start_at: minutesFromNow(25).toISOString() }),
      'VALIDATION_FAILED',
      'start_at',
    );
  });

  it('일시 변경 시 audit에 이전·새 start_at, end_at 재계산', async () => {
    const host = await db.createUser();
    const meetingId = await create(host);
    const next = daysFromNow(5).toISOString();
    await update(host, meetingId, { start_at: next, duration_minutes: 60 });
    const row = await meetingRow(meetingId);
    expect(new Date(row.end_at as string).getTime() - new Date(next).getTime()).toBe(60 * 60_000);
    const meta = await db.asOwner((q) =>
      q.value<Record<string, unknown>>(
        `select meta from public.audit_logs where action = 'meeting.update' and target_id = $1`,
        [meetingId],
      ),
    );
    expect(meta).toHaveProperty('start_at_before');
    expect(meta).toHaveProperty('start_at_after');
  });

  it('시작 이후 MEETING_STARTED, 취소 후 MEETING_CANCELLED, 없음 NOT_FOUND', async () => {
    const host = await db.createUser();
    const started = await db.insertMeeting({ hostId: host, startAt: hoursFromNow(-1) });
    await expectRpcError(update(host, started), 'MEETING_STARTED');
    const cancelled = await db.insertMeeting({ hostId: host, status: 'cancelled' });
    await expectRpcError(update(host, cancelled), 'MEETING_CANCELLED');
    await expectRpcError(update(host, '00000000-0000-4000-8000-000000000000'), 'NOT_FOUND');
  });

  it('확정 인원보다 작은 정원으로 줄이면 CAPACITY_BELOW_CONFIRMED', async () => {
    const host = await db.createUser();
    const startAt = hoursFromNow(48).toISOString();
    const meetingId = await create(host, { start_at: startAt, max_participants: 4 });
    const g1 = await db.createUser();
    const g2 = await db.createUser();
    await apply(db, g1, meetingId);
    await apply(db, g2, meetingId);
    await expectRpcError(
      update(host, meetingId, { start_at: startAt, min_participants: 2, max_participants: 2 }),
      'CAPACITY_BELOW_CONFIRMED',
    );
    await update(host, meetingId, { start_at: startAt, min_participants: 2, max_participants: 3 });
    expect((await meetingRow(meetingId)).remaining_seats).toBe(0);
  });

  it('홀덤으로 바꾸면 동의 필요, 이미 홀덤이면 재동의 불필요', async () => {
    const host = await db.createUser();
    const startAt = hoursFromNow(48).toISOString();
    const meetingId = await create(host, { start_at: startAt });
    await expectRpcError(update(host, meetingId, { start_at: startAt, category_id: 'holdem_social' }), 'HOLDEM_AGREEMENT_REQUIRED');
    await update(host, meetingId, { start_at: startAt, category_id: 'holdem_social', holdem_policy_agreed: true });
    await update(host, meetingId, { start_at: startAt, category_id: 'holdem_social', title: '홀덤 제목 변경' });
  });

  it('승인 방식을 auto로 바꿔도 기존 pending은 자동 확정되지 않는다', async () => {
    const host = await db.createUser();
    const guest = await db.createUser();
    const startAt = hoursFromNow(48).toISOString();
    const meetingId = await create(host, { start_at: startAt, approval_mode: 'manual' });
    expect(await apply(db, guest, meetingId)).toBe('pending');
    await update(host, meetingId, { start_at: startAt, approval_mode: 'auto' });
    expect(await db.participantStatus(meetingId, guest)).toBe('pending');
    expect(await db.meetingCounts(meetingId)).toMatchObject({ confirmed: 1, pending: 1 });
  });

  it('비활성화된 기존 카테고리·비공개로 바뀐 기존 공간은 그대로 유지하며 수정할 수 있다', async () => {
    const host = await db.createUser();
    const startAt = hoursFromNow(48).toISOString();
    const venueId = await db.asOwner((q) =>
      q.value<string>(
        `insert into public.venues (name, region_code, address, venue_type, is_public)
         values ('카페', 'dunsan_tanbang', '대전', 'board_game_cafe', true) returning id`,
      ),
    );
    const meetingId = await create(host, { start_at: startAt, category_id: 'mahjong_etc', venue_id: venueId });
    await db.asOwner(async (q) => {
      await q.query(`update public.categories set is_active = false where id = 'mahjong_etc'`);
      await q.query('update public.venues set is_public = false where id = $1', [venueId]);
    });
    await update(host, meetingId, { start_at: startAt, category_id: 'mahjong_etc', venue_id: venueId, title: '유지' });
    expect((await meetingRow(meetingId)).title).toBe('유지');
  });

  it('이용 제한된 모임장은 수정·모집 마감 불가(ACCOUNT_RESTRICTED)', async () => {
    const host = await db.createUser();
    const meetingId = await create(host);
    await db.asOwner((q) => q.query(`update public.profiles set status = 'restricted' where id = $1`, [host]));
    await expectRpcError(update(host, meetingId), 'ACCOUNT_RESTRICTED');
    await expectRpcError(db.rpc(host, 'select public.set_meeting_recruiting($1, false)', [meetingId]), 'ACCOUNT_RESTRICTED');
  });
});

describe('cancel_meeting', () => {
  it('게스트 pending/confirmed/waitlisted → meeting_cancelled, rejected·cancelled 유지, 카운트 1/0/0, 이후 신청 불가', async () => {
    const host = await db.createUser();
    const meetingId = await create(host, { approval_mode: 'manual', max_participants: 3, allow_waitlist: true });
    const [pending, confirmed, waitlisted, rejected, selfCancelled, late] = await Promise.all(
      Array.from({ length: 6 }, () => db.createUser()),
    );
    if (!pending || !confirmed || !waitlisted || !rejected || !selfCancelled || !late) throw new Error('users');
    // 승인제 모임: 신청(pending) → 승인(confirmed)으로 정원 3(모임장+2)을 채운다. pending만 남는 경우는 아래 별도 테스트
    await apply(db, confirmed, meetingId);
    await apply(db, selfCancelled, meetingId);
    await apply(db, rejected, meetingId);
    await apply(db, pending, meetingId);
    const pid = (userId: string) =>
      db.asOwner((q) =>
        q.value<string>('select id from public.meeting_participants where meeting_id = $1 and user_id = $2', [
          meetingId,
          userId,
        ]),
      );
    await db.rpc(host, `select public.decide_participant($1, 'approve')`, [await pid(confirmed)]);
    await db.rpc(host, `select public.decide_participant($1, 'approve')`, [await pid(selfCancelled)]);
    await db.rpc(host, `select public.decide_participant($1, 'reject')`, [await pid(rejected)]);
    await db.rpc(selfCancelled, 'select public.cancel_my_application($1)', [meetingId]);
    await db.rpc(host, `select public.decide_participant($1, 'approve')`, [await pid(pending)]);
    // 이제 정원 3/3 → 다음 신청자는 대기
    expect(await apply(db, waitlisted, meetingId)).toBe('waitlisted');
    // 대기자를 둘로 만든다
    expect(await apply(db, late, meetingId)).toBe('waitlisted');
    expect(await db.meetingCounts(meetingId)).toMatchObject({ confirmed: 3, pending: 0, waitlisted: 2 });

    await db.rpc(host, 'select public.cancel_meeting($1, $2)', [meetingId, '  개인 사정  ']);

    const row = await meetingRow(meetingId);
    expect(row).toMatchObject({ status: 'cancelled', cancel_reason: '개인 사정', confirmed_count: 1, pending_count: 0, waitlist_count: 0 });
    expect(row.cancelled_at).not.toBeNull();
    expect(await db.participantStatus(meetingId, confirmed)).toBe('meeting_cancelled');
    expect(await db.participantStatus(meetingId, pending)).toBe('meeting_cancelled');
    expect(await db.participantStatus(meetingId, waitlisted)).toBe('meeting_cancelled');
    expect(await db.participantStatus(meetingId, rejected)).toBe('rejected');
    expect(await db.participantStatus(meetingId, selfCancelled)).toBe('cancelled');
    expect(await db.participantStatus(meetingId, host)).toBe('confirmed');

    const stranger = await db.createUser();
    await expectRpcError(apply(db, stranger, meetingId), 'MEETING_CANCELLED');
    await expectRpcError(apply(db, selfCancelled, meetingId), 'MEETING_CANCELLED');
    await expectRpcError(db.rpc(host, 'select public.cancel_meeting($1, null)', [meetingId]), 'MEETING_CANCELLED');
    expect(await db.countMismatches()).toEqual([]);

    const audit = await db.asOwner((q) =>
      q.value<Record<string, unknown>>(
        `select meta from public.audit_logs where action = 'meeting.cancel' and target_id = $1`,
        [meetingId],
      ),
    );
    expect(audit).toEqual({ by_admin: false, affected_guests: 4 });
  }, 60_000);

  it('pending 신청자도 meeting_cancelled로 정리된다', async () => {
    const host = await db.createUser();
    const guest = await db.createUser();
    const meetingId = await create(host, { approval_mode: 'manual' });
    expect(await apply(db, guest, meetingId)).toBe('pending');
    await db.rpc(host, 'select public.cancel_meeting($1, null)', [meetingId]);
    expect(await db.participantStatus(meetingId, guest)).toBe('meeting_cancelled');
    expect(await db.meetingCounts(meetingId)).toMatchObject({ confirmed: 1, pending: 0, waitlisted: 0 });
  });

  it('모임장은 시작 후 취소 불가, 관리자는 종료 전까지 가능, 종료 후 불가', async () => {
    const host = await db.createUser();
    const admin = await db.createUser({ admin: true });
    const inProgress = await db.insertMeeting({ hostId: host, startAt: hoursFromNow(-1), durationMinutes: 180 });
    await expectRpcError(db.rpc(host, 'select public.cancel_meeting($1, null)', [inProgress]), 'MEETING_STARTED');
    await db.rpc(admin, 'select public.cancel_meeting($1, $2)', [inProgress, '운영 정책 위반']);
    expect((await meetingRow(inProgress)).status).toBe('cancelled');
    const meta = await db.asOwner((q) =>
      q.value<Record<string, unknown>>(
        `select meta from public.audit_logs where action = 'meeting.cancel' and target_id = $1`,
        [inProgress],
      ),
    );
    expect(meta).toMatchObject({ by_admin: true });

    const ended = await db.insertMeeting({ hostId: host, startAt: daysFromNow(-2) });
    await expectRpcError(db.rpc(admin, 'select public.cancel_meeting($1, null)', [ended]), 'MEETING_STARTED', 'ended');
  });

  it('이용 제한된 모임장도 취소는 할 수 있다, 사유는 200자 이하', async () => {
    const host = await db.createUser();
    const meetingId = await create(host);
    await db.asOwner((q) => q.query(`update public.profiles set status = 'restricted' where id = $1`, [host]));
    await expectRpcError(
      db.rpc(host, 'select public.cancel_meeting($1, $2)', [meetingId, '가'.repeat(201)]),
      'VALIDATION_FAILED',
      'reason',
    );
    await db.rpc(host, 'select public.cancel_meeting($1, null)', [meetingId]);
    expect((await meetingRow(meetingId)).status).toBe('cancelled');
  });

  it('숨김 모임은 다른 사용자에게 NOT_FOUND', async () => {
    const host = await db.createUser();
    const other = await db.createUser();
    const meetingId = await db.insertMeeting({ hostId: host, isHidden: true });
    await expectRpcError(db.rpc(other, 'select public.cancel_meeting($1, null)', [meetingId]), 'NOT_FOUND');
    await expectRpcError(update(other, meetingId), 'NOT_FOUND');
  });
});

describe('set_meeting_recruiting', () => {
  it('open ↔ closed 전환, 마감 중 신청은 MEETING_NOT_OPEN, 같은 값이면 변화·기록 없음', async () => {
    const host = await db.createUser();
    const guest = await db.createUser();
    const meetingId = await create(host);
    await db.rpc(host, 'select public.set_meeting_recruiting($1, false)', [meetingId]);
    expect((await meetingRow(meetingId)).status).toBe('closed');
    await expectRpcError(apply(db, guest, meetingId), 'MEETING_NOT_OPEN');
    await db.rpc(host, 'select public.set_meeting_recruiting($1, false)', [meetingId]);
    await db.rpc(host, 'select public.set_meeting_recruiting($1, true)', [meetingId]);
    expect((await meetingRow(meetingId)).status).toBe('open');
    expect(await apply(db, guest, meetingId)).toBe('confirmed');
    const logs = await db.asOwner((q) =>
      q.value<number>(
        `select count(*)::int from public.audit_logs where action = 'meeting.recruiting' and target_id = $1`,
        [meetingId],
      ),
    );
    expect(logs).toBe(2);
  });

  it('취소 MEETING_CANCELLED, 시작 후 MEETING_STARTED, null VALIDATION_FAILED', async () => {
    const host = await db.createUser();
    const cancelled = await db.insertMeeting({ hostId: host, status: 'cancelled' });
    const started = await db.insertMeeting({ hostId: host, startAt: hoursFromNow(-1) });
    const open = await db.insertMeeting({ hostId: host });
    await expectRpcError(db.rpc(host, 'select public.set_meeting_recruiting($1, false)', [cancelled]), 'MEETING_CANCELLED');
    await expectRpcError(db.rpc(host, 'select public.set_meeting_recruiting($1, false)', [started]), 'MEETING_STARTED');
    await expectRpcError(db.rpc(host, 'select public.set_meeting_recruiting($1, null)', [open]), 'VALIDATION_FAILED', 'open');
  });
});
