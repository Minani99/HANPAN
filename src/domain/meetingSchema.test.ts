import { afterAll, describe, expect, it } from 'vitest';
import { DataAdapterError } from '../data/adapter';
import {
  MEETING_FIELD_MESSAGES as M,
  createDefaultMeetingValues,
  firstErrorField,
  mapServerErrorToField,
  meetingToFormValues,
  timeOptions,
  validateMeetingForm,
  type MeetingFormValues,
} from './meetingSchema';
import type { Meeting } from '../data/types';
import { VENUE_SELECTION_MESSAGES } from './venues';

function createMeetingStub(): Meeting {
  return {
    id: 'm-1',
    hostId: 'h-1',
    hostNickname: '모임장',
    categoryId: 'strategy',
    gameName: null,
    title: '카탄 한 판',
    description: '',
    notice: null,
    startAt: '2026-11-25T10:00:00.000Z',
    endAt: '2026-11-25T12:00:00.000Z',
    durationMinutes: 120,
    regionCode: 'dunsan_tanbang',
    venueId: null,
    venueName: null,
    venueNote: null,
    minParticipants: 2,
    maxParticipants: 4,
    confirmedCount: 1,
    pendingCount: 0,
    waitlistCount: 0,
    skillLevel: 'anyone',
    approvalMode: 'auto',
    allowWaitlist: true,
    status: 'open',
    cancelReason: null,
    imageUrl: null,
    createdAt: '2026-11-20T00:00:00.000Z',
  };
}

const NOW = new Date('2026-11-23T03:00:00Z'); // KST 11-23(월) 12:00
const ORIGINAL_TZ = process.env.TZ;

afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

function values(overrides: Partial<MeetingFormValues> = {}): MeetingFormValues {
  return {
    ...createDefaultMeetingValues(NOW),
    categoryId: 'party',
    title: '  토요일 아발론 한 판  ',
    regionCode: 'dunsan_tanbang',
    date: '2026-11-25',
    time: '19:00',
    ...overrides,
  };
}

function errorsOf(input: MeetingFormValues, context = { now: NOW }) {
  const result = validateMeetingForm(input, context);
  if (result.ok) throw new Error('검증 오류가 있어야 합니다.');
  return result.errors;
}

describe('domain/meetingSchema', () => {
  it('정상 입력 → 서버 입력(MeetingInput): 공백 정리, 빈 값 null, KST → UTC ISO', () => {
    const result = validateMeetingForm(values({ gameName: ' ', notice: '', venueNote: '  둔산동 카페  ' }), { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input).toMatchObject({
      categoryId: 'party',
      title: '토요일 아발론 한 판',
      gameName: null,
      notice: null,
      venueNote: '둔산동 카페',
      startAt: '2026-11-25T10:00:00.000Z',
      durationMinutes: 120,
      minParticipants: 2,
      maxParticipants: 6,
      allowWaitlist: true,
      holdemPolicyAgreed: false,
    });
  });

  it('시스템 시간대와 무관하게 KST로 해석한다', () => {
    for (const tz of ['UTC', 'America/Los_Angeles', 'Asia/Seoul']) {
      process.env.TZ = tz;
      const result = validateMeetingForm(values({ date: '2026-11-26', time: '00:30' }), { now: NOW });
      expect(result.ok && result.input.startAt).toBe('2026-11-25T15:30:00.000Z');
    }
  });

  it('필수값: 장르·제목·권역', () => {
    const errors = errorsOf(values({ categoryId: '', title: '   ', regionCode: '' }));
    expect(errors.categoryId).toBe(M.categoryId);
    expect(errors.title).toBe(M.titleRequired);
    expect(errors.regionCode).toBe(M.regionCode);
  });

  it('길이: 제목 2~60, 소개 ≤2000, 유의사항 ≤1000, 게임명 ≤40, 장소 메모 ≤60', () => {
    expect(errorsOf(values({ title: '가' })).title).toBe(M.titleRange);
    expect(errorsOf(values({ title: '가'.repeat(61) })).title).toBe(M.titleRange);
    expect(validateMeetingForm(values({ title: '가'.repeat(60) }), { now: NOW }).ok).toBe(true);
    expect(errorsOf(values({ description: '가'.repeat(2001) })).description).toBe(M.description);
    expect(errorsOf(values({ notice: '가'.repeat(1001) })).notice).toBe(M.notice);
    expect(errorsOf(values({ gameName: '가'.repeat(41) })).gameName).toBe(M.gameName);
    expect(errorsOf(values({ venueNote: '가'.repeat(61) })).venueNote).toBe(M.venueNote);
  });

  it('시작 시각: 지금 + 30분 ~ 90일 (날짜가 범위 안이면 시간 칸, 밖이면 날짜 칸에 표시)', () => {
    // KST 12:00 기준: 오늘 12:00은 너무 이르다 → 시간 칸
    expect(errorsOf(values({ date: '2026-11-23', time: '12:00' })).time).toBe(M.startWindow);
    // 정확히 30분 뒤는 가능
    expect(validateMeetingForm(values({ date: '2026-11-23', time: '12:30' }), { now: NOW }).ok).toBe(true);
    // 어제 → 날짜 칸
    expect(errorsOf(values({ date: '2026-11-22', time: '19:00' })).date).toBe(M.startWindow);
    // 90일 뒤 12:00까지 가능, 그 이후 불가
    expect(validateMeetingForm(values({ date: '2027-02-21', time: '12:00' }), { now: NOW }).ok).toBe(true);
    expect(errorsOf(values({ date: '2027-02-21', time: '12:30' })).time).toBe(M.startWindow);
    expect(errorsOf(values({ date: '2027-02-22', time: '10:00' })).date).toBe(M.startWindow);
    expect(errorsOf(values({ date: '2026-02-30' })).date).toBe(M.date);
    expect(errorsOf(values({ time: '25:00' })).time).toBe(M.time);
  });

  it('수정: 시작 시각이 그대로면 범위 규칙을 적용하지 않는다', () => {
    const original = '2026-11-23T03:10:00.000Z'; // 지금부터 10분 뒤
    const unchanged = values({ date: '2026-11-23', time: '12:10' });
    expect(validateMeetingForm(unchanged, { now: NOW, originalStartAt: original }).ok).toBe(true);
    expect(errorsOf(values({ date: '2026-11-23', time: '12:20' }), { now: NOW, originalStartAt: original } as never).time).toBe(
      M.startWindow,
    );
  });

  it('소요 30~720분', () => {
    expect(errorsOf(values({ durationMinutes: '20' })).durationMinutes).toBe(M.durationMinutes);
    expect(errorsOf(values({ durationMinutes: '750' })).durationMinutes).toBe(M.durationMinutes);
    expect(validateMeetingForm(values({ durationMinutes: '720' }), { now: NOW }).ok).toBe(true);
  });

  it('인원: 최소 ≥ 2, 최소 ≤ 정원, 정원 ≤ 30, 수정 시 확정 인원 이상', () => {
    expect(errorsOf(values({ minParticipants: '1' })).minParticipants).toBe(M.minParticipants);
    expect(errorsOf(values({ minParticipants: '7', maxParticipants: '6' })).minParticipants).toBe(M.minParticipants);
    expect(errorsOf(values({ maxParticipants: '31' })).maxParticipants).toBe(M.maxParticipants);
    expect(validateMeetingForm(values({ minParticipants: '30', maxParticipants: '30' }), { now: NOW }).ok).toBe(true);
    expect(
      errorsOf(values({ maxParticipants: '4' }), { now: NOW, confirmedCount: 5 } as never).maxParticipants,
    ).toBe(M.capacity(5));
  });

  it('홀덤은 비금전 동의 필수', () => {
    expect(errorsOf(values({ categoryId: 'holdem_social' })).holdemPolicyAgreed).toBe(M.holdemPolicyAgreed);
    const agreed = validateMeetingForm(values({ categoryId: 'holdem_social', holdemPolicyAgreed: true }), { now: NOW });
    expect(agreed.ok && agreed.input.holdemPolicyAgreed).toBe(true);
    const other = validateMeetingForm(values({ holdemPolicyAgreed: true }), { now: NOW });
    expect(other.ok && other.input.holdemPolicyAgreed).toBe(false);
  });

  it('필드 오류가 있어도 교차 규칙 오류를 함께 보여주고, 첫 오류는 화면 순서로 고른다', () => {
    const errors = errorsOf(values({ title: '', categoryId: 'holdem_social', minParticipants: '9', maxParticipants: '4' }));
    expect(errors.title).toBe(M.titleRequired);
    expect(errors.holdemPolicyAgreed).toBe(M.holdemPolicyAgreed);
    expect(errors.minParticipants).toBe(M.minParticipants);
    expect(firstErrorField(errors)).toBe('holdemPolicyAgreed');
    expect(firstErrorField({ notice: 'x', title: 'y' })).toBe('title');
    expect(firstErrorField({})).toBeNull();
  });

  it('서버 오류 → 폼 필드', () => {
    expect(mapServerErrorToField(new DataAdapterError('VALIDATION_FAILED', { detail: 'start_at' }))).toEqual({
      field: 'date',
      message: M.startWindow,
    });
    expect(mapServerErrorToField(new DataAdapterError('VALIDATION_FAILED', { detail: 'max_participants' }))?.field).toBe(
      'maxParticipants',
    );
    expect(mapServerErrorToField(new DataAdapterError('VALIDATION_FAILED', { detail: 'gameName' }))?.field).toBe('gameName');
    expect(mapServerErrorToField(new DataAdapterError('HOLDEM_AGREEMENT_REQUIRED'))?.field).toBe('holdemPolicyAgreed');
    expect(mapServerErrorToField(new DataAdapterError('CAPACITY_BELOW_CONFIRMED'), 3)).toEqual({
      field: 'maxParticipants',
      message: M.capacity(3),
    });
    // Phase 4: 공간 선택이 생겨 venue_id는 공간 선택 필드로 간다
    expect(mapServerErrorToField(new DataAdapterError('VALIDATION_FAILED', { detail: 'venue_id' }))?.field).toBe('venueId');
    expect(mapServerErrorToField(new DataAdapterError('VALIDATION_FAILED', { detail: 'game' }))?.field).toBe('gameName');
    expect(mapServerErrorToField(new DataAdapterError('RATE_LIMITED', { detail: 'create_24h' }))).toBeNull();
    expect(mapServerErrorToField(new Error('x'))).toBeNull();
  });

  it('공간 선택: 공개 공간 + 권역 일치만 통과(서버 _meeting_input과 같은 규칙)', () => {
    const venues = [
      { id: 'venue-a', regionCode: 'dunsan_tanbang' as const },
      { id: 'venue-b', regionCode: 'gung_bongmyeong' as const },
    ];
    const context = { now: NOW, venueSelection: { venues } };
    expect(validateMeetingForm(values({ venueId: 'venue-a' }), context)).toMatchObject({ ok: true, input: { venueId: 'venue-a' } });
    expect(validateMeetingForm(values({ venueId: null }), context)).toMatchObject({ ok: true, input: { venueId: null } });
    // 다른 권역의 공간
    const mismatch = validateMeetingForm(values({ venueId: 'venue-b' }), context);
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.errors.venueId).toBe(VENUE_SELECTION_MESSAGES.regionMismatch);
    // 공개 목록에 없는 공간(비공개·없음)
    const unknown = validateMeetingForm(values({ venueId: 'venue-x' }), context);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.errors.venueId).toBe(VENUE_SELECTION_MESSAGES.unavailable);
    // 수정: 원래 공간(비공개로 바뀌어 목록에 없음)은 그대로 둘 수 있지만 권역은 같아야 한다
    const original = { venueId: 'venue-x', regionCode: 'dunsan_tanbang' as const };
    const keep = { now: NOW, venueSelection: { venues, original } };
    expect(validateMeetingForm(values({ venueId: 'venue-x' }), keep).ok).toBe(true);
    expect(validateMeetingForm(values({ venueId: 'venue-x', regionCode: 'gung_bongmyeong' }), keep).ok).toBe(false);
    expect(firstErrorField({ venueId: 'x', notice: 'y' })).toBe('venueId');
  });

  it('게임 연결: 게임명을 그대로 두면 gameId 유지(gameName null), 바꾸면 직접 입력(gameId null)', () => {
    const linkedGame = { id: '7c1e0e2a-4b8f-4a3e-9d1a-2f6b5c4d3e21', name: '카탄' };
    const kept = validateMeetingForm(values({ linkedGame, gameName: ' 카탄 ' }), { now: NOW });
    expect(kept).toMatchObject({ ok: true, input: { gameId: linkedGame.id, gameName: null } });
    const changed = validateMeetingForm(values({ linkedGame, gameName: '카탄 확장' }), { now: NOW });
    expect(changed).toMatchObject({ ok: true, input: { gameId: null, gameName: '카탄 확장' } });
    const cleared = validateMeetingForm(values({ linkedGame, gameName: '' }), { now: NOW });
    expect(cleared).toMatchObject({ ok: true, input: { gameId: null, gameName: null } });
    expect(validateMeetingForm(values({ gameName: '아발론' }), { now: NOW })).toMatchObject({
      ok: true,
      input: { gameId: null, gameName: '아발론' },
    });
  });

  it('수정 초기값: gameId가 있으면 연결 정보로 보관한다', () => {
    const meeting = { ...createMeetingStub(), gameId: 'g-1', gameName: '카탄' };
    expect(meetingToFormValues(meeting).linkedGame).toEqual({ id: 'g-1', name: '카탄' });
    expect(meetingToFormValues({ ...meeting, gameId: null }).linkedGame).toBeNull();
  });

  it('기본값과 선택지', () => {
    const defaults = createDefaultMeetingValues(NOW);
    expect(defaults).toMatchObject({ date: '2026-11-24', time: '19:00', allowWaitlist: true, minParticipants: '2' });
    expect(timeOptions()).toHaveLength(48);
    expect(timeOptions('15:10')).toContain('15:10');
    expect(timeOptions('15:10')).toHaveLength(49);
  });
});
