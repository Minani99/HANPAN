/**
 * 어댑터 → 실제 SQL 함수 계약 테스트.
 *
 * 실제 src/data/supabase/adapter.ts(createSupabaseAdapter)에 PGlite로 SQL을 실행하는 가짜 클라이언트
 * (./fake-supabase-client.ts)를 주입해, RPC 인자 이름·jsonb 입력 키·응답 모양(Zod 검증)·오류 코드 매핑이
 * 마이그레이션의 실제 함수와 맞는지 확인한다.
 * PostgREST 계층(HTTP, 인자 직렬화, 함수 선택)과 실제 Supabase Auth는 여기서 검증되지 않는다 — docs/TEST_PLAN.md §6.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CATEGORIES, sortCategories } from '../../src/domain/categories';
import { REGIONS, sortRegions } from '../../src/domain/regions';
import { addDaysToDateKey, kstDateTimeToIso, toKstDateKey } from '../../src/lib/date';
import type { DataAdapter } from '../../src/data/adapter';
import { createMockAdapter } from '../../src/data/mock/adapter';
import { DEV_ACCOUNT_IDS, createSeedDb } from '../../src/data/mock/seed';
import { createSupabaseAdapter } from '../../src/data/supabase/adapter';
import { toDataAdapterError } from '../../src/data/supabase/errors';
import type { MeetingInput, SessionUser } from '../../src/data/types';
import { createFakeSupabase, type FakeSupabase } from './fake-supabase-client';
import { createTestDb, daysFromNow, hoursFromNow, type TestDb } from './harness';

let db: TestDb;
let fake: FakeSupabase;
let adapter: DataAdapter;

beforeEach(async () => {
  db = await createTestDb();
  fake = createFakeSupabase(db);
  adapter = createSupabaseAdapter({
    client: fake,
    kakaoAuthEnabled: false,
    browser: {
      origin: () => 'http://localhost:5173',
      href: () => 'http://localhost:5173/',
      replaceUrl: () => {},
      defer: (task) => task(),
    },
  });
});

afterEach(async () => {
  await db.close();
});

/** 오늘(KST)부터 days일 뒤의 KST 시각 */
function kstAt(days: number, time: string): string {
  return kstDateTimeToIso(addDaysToDateKey(toKstDateKey(new Date()), days), time);
}

function input(overrides: Partial<MeetingInput> = {}): MeetingInput {
  return {
    categoryId: 'party',
    gameName: '코드네임',
    title: '퇴근 후 보드게임 한 판',
    description: '가볍게 즐겨요',
    notice: '늦으면 연락 주세요',
    startAt: kstAt(3, '19:00'),
    durationMinutes: 120,
    regionCode: 'dunsan_tanbang',
    venueId: null,
    venueNote: '탄방역 근처 카페',
    minParticipants: 2,
    maxParticipants: 4,
    skillLevel: 'beginner_welcome',
    approvalMode: 'auto',
    allowWaitlist: true,
    holdemPolicyAgreed: false,
    ...overrides,
  };
}

/** 어댑터 호출이 DataAdapterError(code[, detail])로 실패하는지 */
async function expectCode(promise: Promise<unknown>, code: string, detail?: string) {
  const error = await promise.then(
    () => {
      throw new Error(`${code} 오류를 기대했지만 성공했습니다`);
    },
    (caught: unknown) => caught,
  );
  expect(error).toMatchObject(detail === undefined ? { code } : { code, detail });
}

/** 어댑터 호출 결과: 성공이면 'OK', 실패면 오류 code (Supabase 어댑터와 mock 결과 비교용) */
function codeOf(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => 'OK',
    (caught: unknown) => (caught as { code: string }).code,
  );
}

/** fake.signInAs + 어댑터로 한 번 호출 */
async function as<T>(userId: string, work: () => Promise<T>): Promise<T> {
  fake.signInAs(userId);
  return work();
}

describe('계약: 공개 조회(비로그인)', () => {
  it('목록·상세·기준 데이터가 응답 검증을 통과하고 프론트 상수와 같다', async () => {
    const host = await db.createUser({ nickname: '모임장A' });
    const id = await as(host, () => adapter.createMeeting(input()));
    fake.signOutNow();

    const page = await adapter.listMeetings({}, { limit: 20, offset: 0 });
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      id,
      hostId: host,
      hostNickname: '모임장A',
      categoryId: 'party',
      gameName: '코드네임',
      title: '퇴근 후 보드게임 한 판',
      notice: '늦으면 연락 주세요',
      venueNote: '탄방역 근처 카페',
      startAt: input().startAt,
      durationMinutes: 120,
      confirmedCount: 1,
      maxParticipants: 4,
      status: 'open',
      imageUrl: null,
      isHidden: false,
    });
    expect(Date.parse(page.items[0]!.endAt) - Date.parse(page.items[0]!.startAt)).toBe(120 * 60_000);

    expect(await adapter.getMeeting(id)).toMatchObject({ id, title: '퇴근 후 보드게임 한 판' });
    expect(await adapter.getMeeting('00000000-0000-4000-8000-000000000000')).toBeNull();
    expect(await adapter.listCategories()).toEqual(sortCategories(CATEGORIES));
    expect(await adapter.listRegions()).toEqual(sortRegions(REGIONS));
  });

  it('필터: KST 날짜 경계·카테고리·권역·검색어·모집 중·정렬·페이지', async () => {
    const hostA = await db.createUser();
    const hostB = await db.createUser();
    const dayKey = addDaysToDateKey(toKstDateKey(new Date()), 4);
    const midnight = await as(hostA, () =>
      adapter.createMeeting(input({ title: '자정 시작 전략', categoryId: 'strategy', startAt: kstDateTimeToIso(dayKey, '00:00') })),
    );
    await as(hostA, () =>
      adapter.createMeeting(
        input({ title: '전날 밤 파티', startAt: kstDateTimeToIso(addDaysToDateKey(dayKey, -1), '23:30'), regionCode: 'etc_daejeon' }),
      ),
    );
    const full = await as(hostB, () =>
      adapter.createMeeting(input({ title: '테라포밍 마스 정원 2', gameName: 'Terraforming Mars', maxParticipants: 2, startAt: kstAt(6, '14:00') })),
    );
    const guest = await db.createUser();
    await as(guest, () => adapter.applyToMeeting(full));
    fake.signOutNow();

    const titles = async (filters: Parameters<DataAdapter['listMeetings']>[0]) =>
      (await adapter.listMeetings(filters, { limit: 20, offset: 0 })).items.map((m) => m.title);

    expect(await titles({ date: dayKey })).toEqual(['자정 시작 전략']);
    expect(await titles({ date: addDaysToDateKey(dayKey, -1) })).toEqual(['전날 밤 파티']);
    expect(await titles({ category: 'strategy' })).toEqual(['자정 시작 전략']);
    expect(await titles({ region: 'etc_daejeon' })).toEqual(['전날 밤 파티']);
    expect(await titles({ q: 'terraforming' })).toEqual(['테라포밍 마스 정원 2']);
    expect(await titles({ q: '그 외 대전' })).toEqual(['전날 밤 파티']);
    expect(await titles({ recruiting: true })).not.toContain('테라포밍 마스 정원 2');
    expect(await titles({})).toEqual(['전날 밤 파티', '자정 시작 전략', '테라포밍 마스 정원 2']);
    expect((await titles({ sort: 'newest' }))[0]).toBe('테라포밍 마스 정원 2');

    const firstPage = await adapter.listMeetings({}, { limit: 2, offset: 0 });
    const secondPage = await adapter.listMeetings({}, { limit: 2, offset: 2 });
    expect(firstPage).toMatchObject({ total: 3 });
    expect(firstPage.items).toHaveLength(2);
    expect(secondPage.items.map((m) => m.id)).toEqual([full]);
    expect(midnight).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('비로그인: 신청·내 모임은 RPC 없이 AUTH_REQUIRED, 내 참가·프로필은 null. 직접 호출하면 서버는 42501 → PERMISSION_DENIED', async () => {
    const host = await db.createUser();
    const id = await as(host, () => adapter.createMeeting(input()));
    fake.signOutNow();
    const before = fake.rpcLog.length;

    await expectCode(adapter.applyToMeeting(id, '안녕하세요'), 'AUTH_REQUIRED');
    await expectCode(adapter.listMyMeetings(), 'AUTH_REQUIRED');
    expect(await adapter.getMyParticipation(id)).toBeNull();
    expect(await adapter.getMyProfile()).toBeNull();
    expect(await adapter.auth.getSessionUser()).toBeNull();
    expect(fake.rpcLog.length).toBe(before);

    // 어댑터를 거치지 않은 anon 직접 호출: EXECUTE 권한이 없어 42501
    const direct = await fake.rpc('apply_to_meeting', { p_meeting_id: id });
    expect(direct.error?.code).toBe('42501');
    expect(toDataAdapterError(direct.error, { status: direct.status }).code).toBe('PERMISSION_DENIED');
  });

  it('없는 인자 이름은 PGRST202(함수 없음)로 실패한다 — 어댑터가 보내는 이름이 함수 시그니처와 맞는지의 근거', async () => {
    const result = await fake.rpc('list_public_meetings', { p_unknown: 1 });
    expect(result.error?.code).toBe('PGRST202');
    expect(toDataAdapterError(result.error, { status: result.status }).code).toBe('UNKNOWN');
  });
});

describe('계약: 모임·참가 흐름', () => {
  it('생성 → 신청(auto 확정 / manual 대기) → 승인 → 신청 취소 → 모임 취소', async () => {
    const host = await db.createUser({ nickname: '모임장' });
    const guest1 = await db.createUser({ nickname: '참가자일' });
    const guest2 = await db.createUser({ nickname: '참가자이' });

    const autoId = await as(host, () => adapter.createMeeting(input({ maxParticipants: 4 })));
    const manualId = await as(host, () => adapter.createMeeting(input({ title: '승인제 모임', approvalMode: 'manual' })));
    expect(await as(host, () => adapter.getMyParticipation(autoId))).toMatchObject({ role: 'host', status: 'confirmed' });

    // auto: 바로 확정
    expect(await as(guest1, () => adapter.applyToMeeting(autoId, '  처음이에요  '))).toBe('confirmed');
    expect(await adapter.getMyParticipation(autoId)).toMatchObject({ role: 'guest', status: 'confirmed', message: '처음이에요' });
    expect(await adapter.getMeeting(autoId)).toMatchObject({ confirmedCount: 2 });

    // manual: 승인 대기 → 모임장 승인
    expect(await as(guest2, () => adapter.applyToMeeting(manualId, null))).toBe('pending');
    const participants = await as(host, () => adapter.listParticipants(manualId));
    expect(participants.map((p) => [p.role, p.status, p.nickname])).toEqual([
      ['host', 'confirmed', '모임장'],
      ['guest', 'pending', '참가자이'],
    ]);
    const pendingId = participants[1]!.id;
    expect(await adapter.decideParticipant(pendingId, 'approve')).toBe('confirmed');
    await expectCode(adapter.decideParticipant(pendingId, 'reject'), 'INVALID_STATE', 'confirmed');

    // 신청 취소(대기자 자동 승격 없음)
    await as(guest1, () => adapter.cancelMyApplication(autoId));
    expect(await adapter.getMyParticipation(autoId)).toMatchObject({ status: 'cancelled' });
    expect(await adapter.getMeeting(autoId)).toMatchObject({ confirmedCount: 1 });
    await expectCode(adapter.cancelMyApplication(autoId), 'NOT_APPLIED');

    // 모임 취소
    await as(host, () => adapter.cancelMeeting(manualId, '  모임장 사정  '));
    expect(await adapter.getMeeting(manualId)).toMatchObject({ status: 'cancelled', cancelReason: '모임장 사정', confirmedCount: 1 });
    expect(await as(guest2, () => adapter.getMyParticipation(manualId))).toMatchObject({ status: 'meeting_cancelled' });
    await expectCode(adapter.applyToMeeting(manualId), 'MEETING_CANCELLED');
    expect(await db.countMismatches()).toEqual([]);
  });

  it('수정은 전체 값을 보낸다: 선택 값이 그대로 유지되고 바꾼 값만 바뀐다. 모집 마감/재개', async () => {
    const host = await db.createUser();
    const guest = await db.createUser();
    const id = await as(host, () => adapter.createMeeting(input({ allowWaitlist: false })));
    await adapter.updateMeeting(id, input({ title: '제목만 바꿈', allowWaitlist: false }));
    expect(await adapter.getMeeting(id)).toMatchObject({
      title: '제목만 바꿈',
      notice: '늦으면 연락 주세요',
      venueNote: '탄방역 근처 카페',
      gameName: '코드네임',
      allowWaitlist: false,
      startAt: input().startAt,
    });

    await adapter.setMeetingRecruiting(id, false);
    expect(await adapter.getMeeting(id)).toMatchObject({ status: 'closed' });
    await expectCode(as(guest, () => adapter.applyToMeeting(id)), 'MEETING_NOT_OPEN');
    await as(host, () => adapter.setMeetingRecruiting(id, true));
    expect(await as(guest, () => adapter.applyToMeeting(id))).toBe('confirmed');

    await expectCode(as(guest, () => adapter.updateMeeting(id, input())), 'NOT_HOST');
    await expectCode(as(host, () => adapter.updateMeeting(id, input({ maxParticipants: 1, minParticipants: 1 }))), 'VALIDATION_FAILED');
  });

  it('입력 검증 오류는 VALIDATION_FAILED + 필드 이름(detail), 홀덤 동의 누락은 HOLDEM_AGREEMENT_REQUIRED', async () => {
    const host = await db.createUser();
    fake.signInAs(host);
    await expectCode(adapter.createMeeting(input({ title: '가' })), 'VALIDATION_FAILED', 'title');
    await expectCode(adapter.createMeeting(input({ startAt: new Date(Date.now() + 10 * 60_000).toISOString() })), 'VALIDATION_FAILED', 'start_at');
    await expectCode(adapter.createMeeting(input({ categoryId: 'holdem_social', holdemPolicyAgreed: false })), 'HOLDEM_AGREEMENT_REQUIRED');
    expect(await adapter.createMeeting(input({ categoryId: 'holdem_social', holdemPolicyAgreed: true }))).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('중복 신청 ALREADY_APPLIED, 본인 모임 OWN_MEETING', async () => {
    const host = await db.createUser();
    const guest = await db.createUser();
    const id = await as(host, () => adapter.createMeeting(input()));
    await expectCode(adapter.applyToMeeting(id), 'OWN_MEETING');
    expect(await as(guest, () => adapter.applyToMeeting(id))).toBe('confirmed');
    await expectCode(adapter.applyToMeeting(id), 'ALREADY_APPLIED');
  });

  it('정원 초과: 대기 허용이면 waitlisted, 아니면 MEETING_FULL. 승인 시 자리 재검사', async () => {
    const host = await db.createUser();
    const [g1, g2, g3] = [await db.createUser(), await db.createUser(), await db.createUser()];
    const waitlist = await as(host, () => adapter.createMeeting(input({ maxParticipants: 2, allowWaitlist: true })));
    const noWaitlist = await as(host, () => adapter.createMeeting(input({ maxParticipants: 2, allowWaitlist: false })));

    expect(await as(g1, () => adapter.applyToMeeting(waitlist))).toBe('confirmed');
    expect(await as(g2, () => adapter.applyToMeeting(waitlist))).toBe('waitlisted');
    expect(await adapter.getMeeting(waitlist)).toMatchObject({ confirmedCount: 2, waitlistCount: 1 });
    const waiting = (await as(host, () => adapter.listParticipants(waitlist))).find((p) => p.status === 'waitlisted')!;
    await expectCode(adapter.decideParticipant(waiting.id, 'approve'), 'MEETING_FULL');

    expect(await as(g1, () => adapter.applyToMeeting(noWaitlist))).toBe('confirmed');
    await expectCode(as(g3, () => adapter.applyToMeeting(noWaitlist)), 'MEETING_FULL');
  });

  it('내 모임: 연 모임과 신청한 모임(참가 상태 포함), 숨김 모임은 joined.meeting = null', async () => {
    const host = await db.createUser();
    const guest = await db.createUser();
    const visible = await as(host, () => adapter.createMeeting(input({ title: '보이는 모임' })));
    const hidden = await as(host, () => adapter.createMeeting(input({ title: '숨김될 모임', startAt: kstAt(5, '20:00') })));
    await as(guest, () => adapter.applyToMeeting(visible));
    await adapter.applyToMeeting(hidden);
    await db.asOwner((q) => q.query(`update public.meetings set is_hidden = true, hidden_reason = '점검' where id = $1`, [hidden]));

    const mine = await as(host, () => adapter.listMyMeetings());
    expect(mine.hosted.map((m) => m.title).sort()).toEqual(['보이는 모임', '숨김될 모임']);
    expect(mine.hosted.find((m) => m.id === hidden)).toMatchObject({ isHidden: true, hiddenReason: '점검' });
    expect(mine.joined).toEqual([]);

    const joined = await as(guest, () => adapter.listMyMeetings());
    expect(joined.hosted).toEqual([]);
    const byMeetingId = new Map(joined.joined.map((item) => [item.participation.meetingId, item]));
    expect(byMeetingId.get(visible)).toMatchObject({ meeting: { id: visible }, participation: { status: 'confirmed' } });
    expect(byMeetingId.get(hidden)).toMatchObject({ meeting: null, participation: { status: 'confirmed' } });
  });

  it('참가자 목록 권한: 모임장만(다른 사용자 NOT_HOST, 숨김 모임은 NOT_FOUND)', async () => {
    const host = await db.createUser();
    const other = await db.createUser();
    const id = await as(host, () => adapter.createMeeting(input()));
    expect(await adapter.listParticipants(id)).toHaveLength(1);
    await expectCode(as(other, () => adapter.listParticipants(id)), 'NOT_HOST');
    await db.asOwner((q) => q.query(`update public.meetings set is_hidden = true, hidden_reason = '점검' where id = $1`, [id]));
    await expectCode(adapter.listParticipants(id), 'NOT_FOUND');
    expect(await adapter.getMeeting(id)).toBeNull();
    expect(await as(host, () => adapter.getMeeting(id))).toMatchObject({ isHidden: true });
  });

  it('출석 체크: 시작 후 확정 게스트만(시작 전 ATTENDANCE_WINDOW_CLOSED, 모임장 아님 NOT_HOST)', async () => {
    const host = await db.createUser();
    const guest = await db.createUser();
    const started = await db.insertMeeting({ hostId: host, startAt: hoursFromNow(-1), durationMinutes: 180 });
    const participantId = await db.insertParticipant(started, guest, 'confirmed');
    await as(host, () => adapter.markAttendance(participantId, 'attended'));
    const rows = await adapter.listParticipants(started);
    expect(rows.find((row) => row.id === participantId)).toMatchObject({ status: 'confirmed', attendance: 'attended' });
    await expectCode(as(guest, () => adapter.markAttendance(participantId, 'absent')), 'NOT_HOST');

    const future = await as(host, () => adapter.createMeeting(input()));
    expect(await as(guest, () => adapter.applyToMeeting(future))).toBe('confirmed');
    const futureGuest = (await as(host, () => adapter.listParticipants(future))).find((row) => row.role === 'guest')!;
    await expectCode(adapter.markAttendance(futureGuest.id, 'attended'), 'ATTENDANCE_WINDOW_CLOSED');
  });

  it('모임장 계정이 삭제된 지난·미래 모임: hostId·hostNickname null을 받아들이고, 신청은 MEETING_NOT_OPEN(host_missing)', async () => {
    const host = await db.createUser({ nickname: '떠난모임장' });
    const guest = await db.createUser();
    const future = await db.insertMeeting({ hostId: host, startAt: daysFromNow(3) });
    await db.asOwner((q) => q.query('delete from auth.users where id = $1', [host]));
    const meeting = await adapter.getMeeting(future);
    expect(meeting).toMatchObject({ hostId: null, hostNickname: null });
    await expectCode(as(guest, () => adapter.applyToMeeting(future)), 'MEETING_NOT_OPEN', 'host_missing');
  });
});

describe('계약: 프로필·계정', () => {
  it('온보딩: 가입 직후 onboarded=false → 닉네임만 보내면 PROFILE_INCOMPLETE → 동의까지 보내면 완료', async () => {
    const user = await db.createUser({ onboarded: false });
    fake.signInAs(user);
    const before = await adapter.auth.getSessionUser();
    expect(before).toMatchObject({ id: user, onboarded: false, status: 'active', isAdmin: false });
    expect(before?.nickname).toMatch(/^플레이어/);

    await expectCode(adapter.updateMyProfile({ nickname: '한판승부' }), 'PROFILE_INCOMPLETE');
    await expectCode(adapter.applyToMeeting('00000000-0000-4000-8000-000000000000'), 'PROFILE_INCOMPLETE');
    await adapter.updateMyProfile({ nickname: '한판승부', agreeTerms: true, agreePrivacy: true, regionCode: 'etc_daejeon' });
    expect(await adapter.auth.getSessionUser()).toEqual({
      id: user,
      nickname: '한판승부',
      onboarded: true,
      status: 'active',
      isAdmin: false,
    } satisfies SessionUser);
    const profile = await adapter.getMyProfile();
    expect(profile).toMatchObject({ nickname: '한판승부', regionCode: 'etc_daejeon', bio: '', favoriteCategoryIds: [] });
    expect(profile?.termsAgreedAt).not.toBeNull();
  });

  it('닉네임: 중복 NICKNAME_TAKEN, 예약어 VALIDATION_FAILED(nickname), 부분 수정은 보낸 키만 바꾼다', async () => {
    await db.createUser({ nickname: 'MeepleKing' });
    const user = await db.createUser({ nickname: '원래닉네임' });
    fake.signInAs(user);
    await adapter.updateMyProfile({ bio: '소개', favoriteCategoryIds: ['party', 'strategy'] });
    await expectCode(adapter.updateMyProfile({ nickname: 'meepleking' }), 'NICKNAME_TAKEN');
    await expectCode(adapter.updateMyProfile({ nickname: '한판' }), 'VALIDATION_FAILED', 'nickname');
    await expectCode(adapter.updateMyProfile({ nickname: '관리자김' }), 'VALIDATION_FAILED', 'nickname');
    await adapter.updateMyProfile({ nickname: '오늘도한판' });
    expect(await adapter.getMyProfile()).toMatchObject({
      nickname: '오늘도한판',
      bio: '소개',
      favoriteCategoryIds: ['party', 'strategy'],
    });
    await adapter.updateMyProfile({ regionCode: null, bio: '' });
    expect(await adapter.getMyProfile()).toMatchObject({ regionCode: null, bio: '' });
  });

  it('관리자 여부는 admin_roles로만(get_my_profile.isAdmin)', async () => {
    const admin = await db.createUser({ admin: true });
    expect(await as(admin, () => adapter.auth.getSessionUser())).toMatchObject({ isAdmin: true });
  });

  it('탈퇴 요청: 상태·닉네임 비식별화, 이후 쓰기는 ACCOUNT_DELETION_REQUESTED, 멱등', async () => {
    const host = await db.createUser();
    const leaver = await db.createUser({ nickname: '떠나는사람' });
    const id = await as(host, () => adapter.createMeeting(input()));
    expect(await as(leaver, () => adapter.applyToMeeting(id))).toBe('confirmed');
    const hosted = await adapter.createMeeting(input({ title: '떠나는 사람의 모임', startAt: kstAt(7, '18:00') }));

    await adapter.requestAccountDeletion();
    await adapter.requestAccountDeletion();
    expect(await adapter.getMyProfile()).toMatchObject({ status: 'deletion_requested', nickname: '탈퇴한 사용자', bio: '' });
    expect(await adapter.auth.getSessionUser()).toMatchObject({ status: 'deletion_requested' });
    expect(await adapter.getMyParticipation(id)).toMatchObject({ status: 'cancelled' });
    expect(await adapter.getMeeting(hosted)).toMatchObject({
      status: 'cancelled',
      cancelReason: '모임장 탈퇴',
      hostNickname: '탈퇴한 사용자',
    });
    await expectCode(adapter.applyToMeeting(id), 'ACCOUNT_DELETION_REQUESTED');
    await expectCode(adapter.updateMyProfile({ bio: '복귀' }), 'ACCOUNT_DELETION_REQUESTED');
  });

  it('auth 이벤트: SIGNED_IN이면 실제 get_my_profile로 SessionUser를, SIGNED_OUT이면 null을 알린다', async () => {
    const user = await db.createUser({ nickname: '이벤트확인' });
    const seen: (SessionUser | null)[] = [];
    const unsubscribe = adapter.auth.onAuthStateChange((value) => seen.push(value));
    fake.signInAs(user);
    await expect.poll(() => seen.length).toBe(1);
    expect(seen[0]).toMatchObject({ id: user, nickname: '이벤트확인', onboarded: true });
    await adapter.auth.signOut();
    expect(seen).toEqual([expect.objectContaining({ id: user }), null]);
    unsubscribe();
  });
});

/* ------------------------------------------------------------------ */
/* Phase 4: 공간·신고·관리자                                             */
/* ------------------------------------------------------------------ */

async function ownerVenue(name: string, options: { region?: string; type?: string; isPublic?: boolean; booking?: string | null } = {}) {
  return db.asOwner((q) =>
    q.value<string>(
      `insert into public.venues (name, region_code, address, venue_type, is_public, booking_url, website_url, info_verified_at)
       values ($1, $2, '대전 서구 예시로 1 (가상 주소)', $3::public.venue_type, $4, $5, 'https://example.com/v', now() - interval '2 days')
       returning id`,
      [name, options.region ?? 'dunsan_tanbang', options.type ?? 'board_game_cafe', options.isPublic ?? true, options.booking ?? null],
    ),
  );
}

describe('계약: 공간(공개 조회)', () => {
  it('listVenues: 공개 공간만·필터, getVenue: 공개만(비공개·잘못된 id는 null), 응답 검증 통과', async () => {
    const cafe = await ownerVenue('카페 가', { booking: 'https://example.com/book' });
    await ownerVenue('파티룸 나', { type: 'party_room', region: 'gung_bongmyeong' });
    const hidden = await ownerVenue('비공개 다', { isPublic: false });

    const all = await adapter.listVenues({});
    expect(all.map((v) => v.name)).toEqual(['카페 가', '파티룸 나']);
    expect(all[0]).toMatchObject({
      id: cafe,
      regionCode: 'dunsan_tanbang',
      venueType: 'board_game_cafe',
      websiteUrl: 'https://example.com/v',
      bookingUrl: 'https://example.com/book',
      isPublic: true,
    });
    expect(all[0]!.infoVerifiedAt).toMatch(/Z$/);
    expect((await adapter.listVenues({ type: 'party_room' })).map((v) => v.name)).toEqual(['파티룸 나']);
    expect((await adapter.listVenues({ region: 'gung_bongmyeong', type: 'board_game_cafe' })).map((v) => v.name)).toEqual([]);

    expect(await adapter.getVenue(cafe)).toMatchObject({ id: cafe, name: '카페 가' });
    expect(await adapter.getVenue(hidden)).toBeNull();
    expect(await adapter.getVenue('not-a-uuid')).toBeNull();
    // 관리자로 로그인해도 공개 화면 조회는 공개 공간만
    const admin = await db.createUser({ admin: true });
    expect((await as(admin, () => adapter.listVenues({}))).map((v) => v.name)).toEqual(['카페 가', '파티룸 나']);
    expect(await adapter.getVenue(hidden)).toBeNull();
  });

  it('listMeetings({ venueId }) → p_venue_id', async () => {
    const host = await db.createUser();
    const venueId = await ownerVenue('모임 공간');
    const atVenue = await as(host, () => adapter.createMeeting(input({ venueId, title: '공간 모임' })));
    await as(host, () => adapter.createMeeting(input({ title: '다른 모임', startAt: kstAt(4, '19:00') })));
    fake.signOutNow();
    const page = await adapter.listMeetings({ venueId }, { limit: 20, offset: 0 });
    expect(page.items.map((m) => [m.id, m.venueName])).toEqual([[atVenue, '모임 공간']]);
  });

  it('모임 수정: game_id로 연결된 모임은 게임명을 바꾸지 않으면 game_id를 유지하고, 바꾸면 game_name으로', async () => {
    const host = await db.createUser();
    const gameId = await db.asOwner((q) =>
      q.value<string>(`insert into public.games (name, category_id) values ('카탄', 'strategy') returning id`),
    );
    const meetingId = await as(host, () => adapter.createMeeting(input({ gameName: null })));
    await db.asOwner((q) => q.query('update public.meetings set game_id = $2, game_name = null where id = $1', [meetingId, gameId]));
    const linked = await adapter.getMeeting(meetingId);
    expect(linked).toMatchObject({ gameId, gameName: '카탄' });

    await adapter.updateMeeting(meetingId, input({ gameId, gameName: null, title: '제목만 바꿈' }));
    const stored = () =>
      db.asOwner((q) =>
        q.one<{ game_id: string | null; game_name: string | null }>('select game_id, game_name from public.meetings where id = $1', [
          meetingId,
        ]),
      );
    expect(await stored()).toEqual({ game_id: gameId, game_name: null });

    await adapter.updateMeeting(meetingId, input({ gameId: null, gameName: '카탄 확장판' }));
    expect(await stored()).toEqual({ game_id: null, game_name: '카탄 확장판' });
  });
});

describe('계약: 신고(submit_report)', () => {
  it('접수 → id, 같은 대상 재신고 DUPLICATE_REPORT, 자기 신고 CANNOT_REPORT_SELF, 비로그인 AUTH_REQUIRED(RPC 없음)', async () => {
    const host = await db.createUser();
    const reporter = await db.createUser();
    const meetingId = await as(host, () => adapter.createMeeting(input()));
    await expectCode(
      adapter.submitReport({ targetType: 'meeting', targetId: meetingId, reason: 'spam', body: null }),
      'CANNOT_REPORT_SELF',
    );
    await expectCode(adapter.submitReport({ targetType: 'user', targetId: host, reason: 'spam', body: null }), 'CANNOT_REPORT_SELF');

    fake.signInAs(reporter);
    const id = await adapter.submitReport({ targetType: 'meeting', targetId: meetingId, reason: 'gambling', body: '판돈 이야기' });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    await expectCode(
      adapter.submitReport({ targetType: 'meeting', targetId: meetingId, reason: 'other', body: '다른 사유' }),
      'DUPLICATE_REPORT',
    );
    await expectCode(adapter.submitReport({ targetType: 'user', targetId: host, reason: 'other', body: '   ' }), 'VALIDATION_FAILED', 'body');
    await expectCode(
      adapter.submitReport({ targetType: 'meeting', targetId: '00000000-0000-4000-8000-000000000000', reason: 'spam', body: null }),
      'NOT_FOUND',
    );

    fake.signOutNow();
    const before = fake.rpcLog.length;
    await expectCode(adapter.submitReport({ targetType: 'user', targetId: host, reason: 'spam', body: null }), 'AUTH_REQUIRED');
    expect(fake.rpcLog.length).toBe(before);
  });
});

describe('계약: 관리자', () => {
  const venueInput = {
    name: '새 공간',
    regionCode: 'dunsan_tanbang' as const,
    address: '대전 서구 예시로 3',
    venueType: 'other' as const,
    websiteUrl: null,
    bookingUrl: null,
    description: '',
    isPublic: true,
    infoVerifiedAt: null,
  };

  it('일반 사용자는 관리자 메서드가 전부 NOT_ADMIN(조회 RPC·테이블 쓰기·관리자 취소) — mock과 같은 코드', async () => {
    const user = await db.createUser();
    const venueId = await ownerVenue('공간');
    const host = await db.createUser();
    const meetingId = await as(host, () => adapter.createMeeting(input()));
    const reportId = await as(user, () => adapter.submitReport({ targetType: 'meeting', targetId: meetingId, reason: 'spam', body: null }));
    fake.signInAs(user);
    await expectCode(adapter.adminListReports({}, { limit: 20, offset: 0 }), 'NOT_ADMIN');
    await expectCode(adapter.adminUpdateReport(reportId, 'resolved', null), 'NOT_ADMIN');
    await expectCode(adapter.adminListMeetings({}, { limit: 20, offset: 0 }), 'NOT_ADMIN');
    await expectCode(adapter.adminSetMeetingHidden(meetingId, true, '사유'), 'NOT_ADMIN');
    // 관리자 취소: 서버 cancel_meeting의 NOT_HOST를 어댑터가 NOT_ADMIN으로 바꾼다(원인은 cause에 보존)
    const cancelError = await adapter.adminCancelMeeting(meetingId, null).then(
      () => null,
      (caught: unknown) => caught as { code: string; cause?: { code?: string } },
    );
    expect(cancelError).toMatchObject({ code: 'NOT_ADMIN', cause: { code: 'NOT_HOST' } });
    expect(await adapter.getMeeting(meetingId)).toMatchObject({ status: 'open' });
    // 같은 상황에서 mock 구현도 같은 코드를 낸다(일반 계정의 관리자 취소)
    const mock = createMockAdapter({ delayMs: 0, persist: false, sessionUserId: DEV_ACCOUNT_IDS.userB });
    const mockError = await mock.adminCancelMeeting('seed-meeting-01', null).then(
      () => null,
      (caught: unknown) => caught as { code: string },
    );
    expect(mockError?.code).toBe(cancelError?.code);
    // 없는 모임·볼 수 없는 숨김 모임: cancel_meeting은 계정 확인 → 모임 존재 → 권한 순서라 NOT_FOUND가 NOT_ADMIN보다 먼저다. mock도 같은 순서
    const hiddenId = await as(host, () => adapter.createMeeting(input({ title: '숨김 대상 모임' })));
    const admin = await db.createUser({ admin: true });
    await as(admin, () => adapter.adminSetMeetingHidden(hiddenId, true, '확인'));
    fake.signInAs(user);
    const missingId = '00000000-0000-4000-8000-000000000000';
    const notFound = {
      real: {
        missing: await codeOf(adapter.adminCancelMeeting(missingId, null)),
        hidden: await codeOf(adapter.adminCancelMeeting(hiddenId, null)),
      },
      mock: {
        missing: await codeOf(mock.adminCancelMeeting('no-such-meeting', null)),
        hidden: await codeOf(mock.adminCancelMeeting('seed-meeting-16', null)),
      },
    };
    expect(notFound.real).toEqual({ missing: 'NOT_FOUND', hidden: 'NOT_FOUND' });
    expect(notFound.mock).toEqual(notFound.real);
    expect(await as(admin, () => adapter.getMeeting(hiddenId))).toMatchObject({ status: 'open' });
    fake.signInAs(user);
    await expectCode(adapter.adminSearchUsers(''), 'NOT_ADMIN');
    await expectCode(adapter.adminSetUserStatus(host, 'restricted', null), 'NOT_ADMIN');
    await expectCode(adapter.adminListVenues(), 'NOT_ADMIN');
    await expectCode(adapter.adminListCategories(), 'NOT_ADMIN');
    // 테이블 직접 쓰기: insert는 RLS with check 거부(42501 → NOT_ADMIN), update는 0행 → is_admin()=false → NOT_ADMIN
    await expectCode(adapter.adminSaveVenue(null, venueInput), 'NOT_ADMIN');
    await expectCode(adapter.adminSaveVenue(venueId, venueInput), 'NOT_ADMIN');
    await expectCode(adapter.adminSetVenuePublic(venueId, false), 'NOT_ADMIN');
    await expectCode(adapter.adminSetCategoryActive('party', false), 'NOT_ADMIN');
    expect(await db.asOwner((q) => q.value<boolean>('select is_public from public.venues where id = $1', [venueId]))).toBe(true);
    expect(await db.asOwner((q) => q.value<boolean>(`select is_active from public.categories where id = 'party'`))).toBe(true);
  });

  it.each(['restricted', 'deletion_requested'] as const)(
    '%s 상태인 관리자: 관리자 메서드·세션 isAdmin·숨김 모임 결과가 Supabase 어댑터와 mock에서 같다(마이그레이션 9)',
    async (status) => {
      // Supabase 어댑터 → 실제 SQL
      const admin = await db.createUser({ admin: true });
      const host = await db.createUser();
      const venueId = await ownerVenue('공간');
      const meetingId = await as(host, () => adapter.createMeeting(input()));
      const visibleId = await as(host, () => adapter.createMeeting(input({ title: '공개 모임' })));
      await as(admin, () => adapter.adminSetMeetingHidden(meetingId, true, '준비'));
      await db.asOwner((q) => q.query('update public.profiles set status = $2 where id = $1', [admin, status]));
      fake.signInAs(admin);
      const real = {
        session: await adapter.auth.getSessionUser(),
        profileIsAdmin: (await adapter.getMyProfile())?.isAdmin,
        listMeetings: await codeOf(adapter.adminListMeetings({}, { limit: 20, offset: 0 })),
        listReports: await codeOf(adapter.adminListReports({}, { limit: 20, offset: 0 })),
        setHidden: await codeOf(adapter.adminSetMeetingHidden(meetingId, false, null)),
        saveVenue: await codeOf(adapter.adminSaveVenue(venueId, venueInput)),
        cancel: await codeOf(adapter.adminCancelMeeting(visibleId, null)),
        hiddenMeeting: await adapter.getMeeting(meetingId),
      };

      // mock(같은 상태의 관리자 dev 계정)
      const seed = createSeedDb(new Date());
      seed.profiles.find((profile) => profile.id === DEV_ACCOUNT_IDS.admin)!.status = status;
      const mock = createMockAdapter({ delayMs: 0, persist: false, db: seed, sessionUserId: DEV_ACCOUNT_IDS.admin });
      const mocked = {
        session: await mock.auth.getSessionUser(),
        profileIsAdmin: (await mock.getMyProfile())?.isAdmin,
        listMeetings: await codeOf(mock.adminListMeetings({}, { limit: 20, offset: 0 })),
        listReports: await codeOf(mock.adminListReports({}, { limit: 20, offset: 0 })),
        setHidden: await codeOf(mock.adminSetMeetingHidden('seed-meeting-16', false, null)),
        saveVenue: await codeOf(mock.adminSaveVenue('seed-venue-01', venueInput)),
        cancel: await codeOf(mock.adminCancelMeeting('seed-meeting-01', null)),
        hiddenMeeting: await mock.getMeeting('seed-meeting-16'),
      };

      const expectedCancel = status === 'deletion_requested' ? 'ACCOUNT_DELETION_REQUESTED' : 'NOT_ADMIN';
      expect(real).toMatchObject({
        session: { status, isAdmin: false },
        profileIsAdmin: false,
        listMeetings: 'NOT_ADMIN',
        listReports: 'NOT_ADMIN',
        setHidden: 'NOT_ADMIN',
        saveVenue: 'NOT_ADMIN',
        cancel: expectedCancel,
        hiddenMeeting: null,
      });
      const { session: realSession, ...realRest } = real;
      const { session: mockSession, ...mockRest } = mocked;
      expect(mockRest).toEqual(realRest);
      expect({ status: mockSession?.status, isAdmin: mockSession?.isAdmin }).toEqual({ status: realSession?.status, isAdmin: realSession?.isAdmin });
    },
  );

  it('신고 목록·상태 변경, 모임 숨김 → 공개 목록에서 사라짐 → 해제, 관리자 취소(audit)', async () => {
    const admin = await db.createUser({ admin: true });
    const host = await db.createUser({ nickname: '모임장닉' });
    const reporter = await db.createUser({ nickname: '신고자닉' });
    const meetingId = await as(host, () => adapter.createMeeting(input({ title: '숨길 모임' })));
    const reportId = await as(reporter, () =>
      adapter.submitReport({ targetType: 'meeting', targetId: meetingId, reason: 'gambling', body: '판돈' }),
    );

    fake.signInAs(admin);
    const reports = await adapter.adminListReports({ status: 'received' }, { limit: 20, offset: 0 });
    expect(reports.total).toBe(1);
    expect(reports.items[0]).toMatchObject({
      id: reportId,
      targetType: 'meeting',
      targetId: meetingId,
      targetLabel: '숨길 모임',
      reason: 'gambling',
      body: '판돈',
      status: 'received',
      adminNote: null,
      reporterNickname: '신고자닉',
    });
    await adapter.adminUpdateReport(reportId, 'resolved', '숨김 처리함');
    expect((await adapter.adminListReports({ status: 'resolved' }, { limit: 20, offset: 0 })).items[0]).toMatchObject({
      id: reportId,
      status: 'resolved',
      adminNote: '숨김 처리함',
    });
    expect((await adapter.adminListReports({ status: 'received' }, { limit: 20, offset: 0 })).total).toBe(0);

    await expectCode(adapter.adminSetMeetingHidden(meetingId, true, '  '), 'VALIDATION_FAILED', 'reason');
    await adapter.adminSetMeetingHidden(meetingId, true, '금전성 홀덤 의심');
    const hiddenList = await adapter.adminListMeetings({ hiddenOnly: true }, { limit: 20, offset: 0 });
    expect(hiddenList.items.map((m) => [m.id, m.isHidden, m.hiddenReason])).toEqual([[meetingId, true, '금전성 홀덤 의심']]);
    expect((await adapter.adminListMeetings({ q: '숨길' }, { limit: 20, offset: 0 })).total).toBe(1);
    fake.signOutNow();
    expect((await adapter.listMeetings({}, { limit: 20, offset: 0 })).total).toBe(0);

    fake.signInAs(admin);
    await adapter.adminSetMeetingHidden(meetingId, false, null);
    fake.signOutNow();
    expect((await adapter.listMeetings({}, { limit: 20, offset: 0 })).total).toBe(1);

    fake.signInAs(admin);
    await adapter.adminCancelMeeting(meetingId, '운영 정책 위반');
    expect(await adapter.getMeeting(meetingId)).toMatchObject({ status: 'cancelled', cancelReason: '운영 정책 위반' });
    const actions = await db.asOwner((q) =>
      q.query<{ action: string }>(`select action from public.audit_logs where actor_id = $1 and action <> 'profile.nickname_change' order by id`, [admin]),
    );
    expect(actions.map((row) => row.action)).toEqual([
      'admin.report_update',
      'admin.meeting_hidden',
      'admin.meeting_hidden',
      'meeting.cancel',
    ]);
  });

  it('사용자 검색·상태 변경(본인·탈퇴 요청 계정 불가)', async () => {
    const admin = await db.createUser({ admin: true, nickname: '관리계정' });
    const target = await db.createUser({ nickname: '검색대상닉' });
    const leaving = await db.createUser({ nickname: '떠날사람', status: 'deletion_requested' });
    fake.signInAs(admin);
    const found = await adapter.adminSearchUsers('검색대상');
    expect(found).toEqual([
      { id: target, nickname: '검색대상닉', status: 'active', createdAt: expect.stringMatching(/Z$/), recentReportCount: 0 },
    ]);
    await adapter.adminSetUserStatus(target, 'restricted', '반복 노쇼 확인');
    expect((await adapter.adminSearchUsers(target))[0]).toMatchObject({ id: target, status: 'restricted' });
    await expectCode(adapter.adminSetUserStatus(admin, 'restricted', null), 'VALIDATION_FAILED', 'user_id');
    await expectCode(adapter.adminSetUserStatus(leaving, 'active', null), 'VALIDATION_FAILED', 'status');
    await adapter.adminSetUserStatus(target, 'active', null);
    expect((await adapter.adminSearchUsers('검색대상'))[0]?.status).toBe('active');
  });

  it('공간 등록·수정·공개 전환(테이블 직접 쓰기 + 트리거), 검증 실패 detail, 카테고리 활성 전환', async () => {
    const admin = await db.createUser({ admin: true });
    fake.signInAs(admin);
    const base = {
      name: '  관리자 공간  ',
      regionCode: 'gung_bongmyeong' as const,
      address: '대전 유성구 예시로 5 (가상 주소)',
      venueType: 'board_game_cafe' as const,
      websiteUrl: 'https://example.com/site',
      bookingUrl: null,
      description: '소개',
      isPublic: false,
      infoVerifiedAt: kstDateTimeToIso(toKstDateKey(new Date()), '00:00'),
    };
    const id = await adapter.adminSaveVenue(null, base);
    const listed = await adapter.adminListVenues();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id, name: '관리자 공간', isPublic: false, websiteUrl: 'https://example.com/site' });
    expect(await db.asOwner((q) => q.value<string>('select created_by from public.venues where id = $1', [id]))).toBe(admin);
    expect(await adapter.listVenues({})).toEqual([]);

    await adapter.adminSaveVenue(id, { ...base, name: '바뀐 공간', bookingUrl: 'https://example.com/book' });
    await adapter.adminSetVenuePublic(id, true);
    expect(await adapter.getVenue(id)).toMatchObject({ name: '바뀐 공간', bookingUrl: 'https://example.com/book', isPublic: true });

    await expectCode(adapter.adminSaveVenue(id, { ...base, websiteUrl: 'http://example.com' }), 'VALIDATION_FAILED', 'website_url');
    await expectCode(adapter.adminSaveVenue(null, { ...base, name: '   ' }), 'VALIDATION_FAILED', 'name');
    await expectCode(adapter.adminSetVenuePublic('00000000-0000-4000-8000-000000000000', true), 'NOT_FOUND');

    const categories = await adapter.adminListCategories();
    expect(categories.map((c) => c.id)).toEqual(CATEGORIES.map((c) => c.id));
    await adapter.adminSetCategoryActive('mahjong_etc', false);
    expect((await adapter.adminListCategories()).find((c) => c.id === 'mahjong_etc')?.isActive).toBe(false);
    expect((await adapter.listCategories()).map((c) => c.id)).not.toContain('mahjong_etc');
    await expectCode(adapter.adminSetCategoryActive('no_such', true), 'NOT_FOUND');

    const actions = await db.asOwner((q) =>
      q.query<{ action: string }>(
        `select action from public.audit_logs where actor_id = $1 and action like 'admin.%' order by id`,
        [admin],
      ),
    );
    expect(actions.map((row) => row.action)).toEqual([
      'admin.venue_create',
      'admin.venue_update',
      'admin.venue_update',
      'admin.category_update',
    ]);
  });
});
