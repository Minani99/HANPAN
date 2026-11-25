import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataAdapterError } from '../adapter';
import {
  normalizeTimestamp,
  parseApplyStatus,
  parseCategories,
  parseCreatedMeetingId,
  parseDecision,
  parseMeetingOrNull,
  parseMeetingPage,
  parseMyMeetings,
  parseParticipants,
  parseParticipationOrNull,
  parseProfileOrNull,
  parseRegions,
  toMyProfile,
  toSessionUser,
} from './mapping';

const MEETING_ID = '11111111-1111-4111-8111-111111111111';
const HOST_ID = '22222222-2222-4222-8222-222222222222';
const GUEST_ID = '33333333-3333-4333-8333-333333333333';
const PARTICIPATION_ID = '44444444-4444-4444-8444-444444444444';

/** meeting_to_json 출력과 같은 모양(시각은 Postgres jsonb 표기) */
function meetingRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: MEETING_ID,
    hostId: HOST_ID,
    hostNickname: '모임장',
    categoryId: 'strategy',
    gameId: null,
    gameName: '카탄',
    title: '카탄 한 판',
    description: '',
    notice: null,
    startAt: '2026-11-25T10:00:00+00:00',
    endAt: '2026-11-25T12:00:00+00:00',
    durationMinutes: 120,
    regionCode: 'etc_daejeon',
    venueId: null,
    venueName: null,
    venueNote: '탄방역 근처',
    minParticipants: 2,
    maxParticipants: 4,
    confirmedCount: 1,
    pendingCount: 0,
    waitlistCount: 0,
    remainingSeats: 3,
    skillLevel: 'beginner_welcome',
    approvalMode: 'manual',
    allowWaitlist: true,
    status: 'open',
    isHidden: false,
    hiddenReason: null,
    cancelReason: null,
    cancelledAt: null,
    imageUrl: null,
    createdAt: '2026-11-24T08:12:05.231456+00:00',
    updatedAt: '2026-11-24T08:12:05.231+00:00',
    ...overrides,
  };
}

function participationRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PARTICIPATION_ID,
    meetingId: MEETING_ID,
    userId: GUEST_ID,
    role: 'guest',
    status: 'pending',
    attendance: 'unknown',
    message: '처음이에요',
    appliedAt: '2026-11-24T09:00:00+00:00',
    decidedAt: null,
    confirmedAt: null,
    cancelledAt: null,
    attendanceMarkedAt: null,
    updatedAt: '2026-11-24T09:00:00+00:00',
    ...overrides,
  };
}

function profileRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: GUEST_ID,
    nickname: '보드게임러',
    regionCode: null,
    bio: '',
    favoriteCategoryIds: ['party'],
    status: 'active',
    termsAgreedAt: null,
    privacyAgreedAt: null,
    deletionRequestedAt: null,
    onboarded: false,
    isAdmin: false,
    createdAt: '2026-11-24T09:00:00+00:00',
    ...overrides,
  };
}

function expectContractError(work: () => unknown, rpc: string) {
  try {
    work();
  } catch (error) {
    expect(error).toBeInstanceOf(DataAdapterError);
    expect((error as DataAdapterError).code).toBe('UNKNOWN');
    expect((error as DataAdapterError).detail).toBe(`contract:${rpc}`);
    return;
  }
  throw new Error('계약 위반 오류가 나야 합니다.');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('supabase/mapping 시각 정규화', () => {
  it('Postgres timestamptz JSON → UTC ISO(밀리초)', () => {
    expect(normalizeTimestamp('2026-11-24T08:12:05.231456+00:00')).toBe('2026-11-24T08:12:05.231Z');
    expect(normalizeTimestamp('2026-11-24T08:12:05+00:00')).toBe('2026-11-24T08:12:05.000Z');
    expect(normalizeTimestamp('2026-11-24T17:12:05.5+09:00')).toBe('2026-11-24T08:12:05.500Z');
    expect(normalizeTimestamp('2026-11-24 08:12:05+00')).toBe('2026-11-24T08:12:05.000Z');
    expect(normalizeTimestamp('2026-11-24T08:12:05Z')).toBe('2026-11-24T08:12:05.000Z');
  });

  it('오프셋 없는 값·날짜만·잘못된 값은 거부', () => {
    expect(normalizeTimestamp('2026-11-24T08:12:05')).toBeNull();
    expect(normalizeTimestamp('2026-11-24')).toBeNull();
    expect(normalizeTimestamp('2026-13-45T99:00:00Z')).toBeNull();
    expect(normalizeTimestamp('내일 저녁')).toBeNull();
  });
});

describe('supabase/mapping 모임', () => {
  it('정상 응답을 Meeting으로 바꾼다(모르는 키·서버 전용 키는 버린다)', () => {
    const meeting = parseMeetingOrNull({ ...meetingRow(), somethingNew: 1 });
    expect(meeting).toEqual({
      id: MEETING_ID,
      hostId: HOST_ID,
      hostNickname: '모임장',
      categoryId: 'strategy',
      gameId: null,
      gameName: '카탄',
      title: '카탄 한 판',
      description: '',
      notice: null,
      startAt: '2026-11-25T10:00:00.000Z',
      endAt: '2026-11-25T12:00:00.000Z',
      durationMinutes: 120,
      regionCode: 'etc_daejeon',
      venueId: null,
      venueName: null,
      venueNote: '탄방역 근처',
      minParticipants: 2,
      maxParticipants: 4,
      confirmedCount: 1,
      pendingCount: 0,
      waitlistCount: 0,
      skillLevel: 'beginner_welcome',
      approvalMode: 'manual',
      allowWaitlist: true,
      status: 'open',
      cancelReason: null,
      imageUrl: null,
      createdAt: '2026-11-24T08:12:05.231Z',
      isHidden: false,
      hiddenReason: null,
    });
  });

  it('없음(null)은 null, 탈퇴한 모임장(hostId·hostNickname null)도 받아들인다', () => {
    expect(parseMeetingOrNull(null)).toBeNull();
    expect(parseMeetingOrNull(undefined)).toBeNull();
    expect(parseMeetingOrNull(meetingRow({ hostId: null, hostNickname: null }))).toMatchObject({ hostId: null, hostNickname: null });
  });

  it('필수 필드 누락·타입 불일치·모르는 카테고리·잘못된 시각은 UNKNOWN(contract:get_meeting)', () => {
    const { title: _title, ...withoutTitle } = meetingRow();
    expectContractError(() => parseMeetingOrNull(withoutTitle), 'get_meeting');
    expectContractError(() => parseMeetingOrNull(meetingRow({ confirmedCount: '1' })), 'get_meeting');
    expectContractError(() => parseMeetingOrNull(meetingRow({ categoryId: 'casino' })), 'get_meeting');
    expectContractError(() => parseMeetingOrNull(meetingRow({ startAt: '2026-11-25T10:00:00' })), 'get_meeting');
    expectContractError(() => parseMeetingOrNull(meetingRow({ status: 'deleted' })), 'get_meeting');
    expectContractError(() => parseMeetingOrNull(meetingRow({ id: 'seed-meeting-01' })), 'get_meeting');
    expectContractError(() => parseMeetingOrNull(meetingRow({ imageUrl: 'javascript:alert(1)' })), 'get_meeting');
    expectContractError(() => parseMeetingOrNull('문자열'), 'get_meeting');
  });

  it('오류 메시지에는 문제 위치만 있고 값은 없다', () => {
    try {
      parseMeetingOrNull(meetingRow({ title: 12345, description: 'secret@example.com' }));
    } catch (error) {
      expect((error as Error).message).toContain('title');
      expect((error as Error).message).not.toContain('12345');
      expect((error as Error).message).not.toContain('example.com');
    }
  });

  it('목록: { items, total }', () => {
    const page = parseMeetingPage({ items: [meetingRow()], total: 7 });
    expect(page.total).toBe(7);
    expect(page.items[0]?.id).toBe(MEETING_ID);
    expectContractError(() => parseMeetingPage({ items: [meetingRow()] }), 'list_public_meetings');
    expectContractError(() => parseMeetingPage([meetingRow()]), 'list_public_meetings');
  });

  it('숨김 사유는 숨김 모임일 때만 남긴다', () => {
    expect(parseMeetingOrNull(meetingRow({ isHidden: true, hiddenReason: '운영 정책' }))).toMatchObject({
      isHidden: true,
      hiddenReason: '운영 정책',
    });
  });
});

describe('supabase/mapping 참가·프로필·기타', () => {
  it('내 참가: Participation → MyParticipation', () => {
    expect(parseParticipationOrNull(participationRow())).toEqual({
      id: PARTICIPATION_ID,
      meetingId: MEETING_ID,
      role: 'guest',
      status: 'pending',
      attendance: 'unknown',
      message: '처음이에요',
      appliedAt: '2026-11-24T09:00:00.000Z',
      confirmedAt: null,
      cancelledAt: null,
    });
    expect(parseParticipationOrNull(null)).toBeNull();
    expectContractError(() => parseParticipationOrNull(participationRow({ status: 'approved' })), 'get_my_participation');
  });

  it('참가자 목록: nickname 필수', () => {
    const rows = parseParticipants([participationRow({ nickname: '참가자' })]);
    expect(rows[0]).toMatchObject({ userId: GUEST_ID, nickname: '참가자', status: 'pending' });
    expectContractError(() => parseParticipants([participationRow()]), 'list_meeting_participants');
  });

  it('내 모임: joined.meeting은 null일 수 있다', () => {
    const value = parseMyMeetings({
      hosted: [meetingRow()],
      joined: [{ meeting: null, participation: participationRow() }],
    });
    expect(value.hosted).toHaveLength(1);
    expect(value.joined[0]).toMatchObject({ meeting: null, participation: { id: PARTICIPATION_ID } });
    expectContractError(() => parseMyMeetings({ hosted: [] }), 'list_my_meetings');
  });

  it('내 프로필: MyProfile·SessionUser로', () => {
    const row = parseProfileOrNull(profileRow());
    expect(row).not.toBeNull();
    expect(toSessionUser(row!)).toEqual({ id: GUEST_ID, nickname: '보드게임러', onboarded: false, status: 'active', isAdmin: false });
    expect(toMyProfile(row!)).toMatchObject({ favoriteCategoryIds: ['party'], termsAgreedAt: null, isAdmin: false });
    expect(parseProfileOrNull(null)).toBeNull();
    expectContractError(() => parseProfileOrNull(profileRow({ onboarded: undefined })), 'get_my_profile');
    expectContractError(() => parseProfileOrNull(profileRow({ status: 'banned' })), 'get_my_profile');
  });

  it('스칼라 반환: 신청 결과·승인 결과·새 모임 id', () => {
    expect(parseApplyStatus('waitlisted')).toBe('waitlisted');
    expectContractError(() => parseApplyStatus('rejected'), 'apply_to_meeting');
    expect(parseDecision('rejected')).toBe('rejected');
    expectContractError(() => parseDecision('pending'), 'decide_participant');
    expect(parseCreatedMeetingId(MEETING_ID)).toBe(MEETING_ID);
    expectContractError(() => parseCreatedMeetingId(null), 'create_meeting');
  });

  it('기준 데이터: 정렬하고, 프론트가 모르는 코드는 경고 후 뺀다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const categories = parseCategories([
      { id: 'strategy', name: '전략', sort_order: 30 },
      { id: 'party', name: '파티·캐주얼', sort_order: 10 },
      { id: 'new_category', name: '새 장르', sort_order: 70 },
    ]);
    expect(categories).toEqual([
      { id: 'party', name: '파티·캐주얼', sortOrder: 10 },
      { id: 'strategy', name: '전략', sortOrder: 30 },
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('new_category'));
    expect(parseRegions([{ code: 'etc_daejeon', name: '그 외 대전', sort_order: 90 }])).toEqual([
      { code: 'etc_daejeon', name: '그 외 대전', sortOrder: 90 },
    ]);
    expectContractError(() => parseRegions([{ code: 'etc_daejeon', name: '그 외 대전' }]), 'regions');
  });
});
