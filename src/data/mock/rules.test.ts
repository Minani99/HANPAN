import { describe, expect, it } from 'vitest';
import { DataAdapterError } from '../adapter';
import type { MeetingInput, ParticipantStatus } from '../types';
import { kstDateTimeToIso } from '../../lib/date';
import type { MockDb, MockMeetingRecord } from './records';
import * as rules from './rules';
import { DEV_ACCOUNT_IDS, createSeedDb } from './seed';

const NOW = new Date('2026-11-23T03:00:00Z'); // KST 11-23(월) 12:00
const MINUTE = 60 * 1000;
const A = DEV_ACCOUNT_IDS.hostA;
const B = DEV_ACCOUNT_IDS.userB;
const NEW = DEV_ACCOUNT_IDS.newcomer;
const ADMIN = DEV_ACCOUNT_IDS.admin;

function seed(): MockDb {
  return createSeedDb(NOW);
}

function meeting(db: MockDb, id: string): MockMeetingRecord {
  const found = db.meetings.find((item) => item.id === id);
  if (!found) throw new Error(`meeting ${id} not found`);
  return found;
}

function row(db: MockDb, meetingId: string, userId: string) {
  return db.participants.find((item) => item.meetingId === meetingId && item.userId === userId);
}

function rowsWith(db: MockDb, meetingId: string, status: ParticipantStatus) {
  return db.participants.filter((item) => item.meetingId === meetingId && item.status === status);
}

/** 규칙 오류 코드(+detail)를 확인한다 */
function expectError(work: () => unknown, code: string, detail?: string) {
  try {
    work();
  } catch (error) {
    expect(error).toBeInstanceOf(DataAdapterError);
    expect((error as DataAdapterError).code).toBe(code);
    if (detail !== undefined) expect((error as DataAdapterError).detail).toBe(detail);
    return;
  }
  throw new Error(`${code} 오류가 나야 합니다.`);
}

function patchMeeting(db: MockDb, id: string, patch: Partial<MockMeetingRecord>): MockDb {
  return { ...db, meetings: db.meetings.map((item) => (item.id === id ? { ...item, ...patch } : item)) };
}

function patchProfile(db: MockDb, id: string, patch: Partial<MockDb['profiles'][number]>): MockDb {
  return { ...db, profiles: db.profiles.map((item) => (item.id === id ? { ...item, ...patch } : item)) };
}

function validInput(overrides: Partial<MeetingInput> = {}): MeetingInput {
  return {
    categoryId: 'party',
    gameName: '  코드네임 ',
    title: '  새 모임 테스트  ',
    description: '설명',
    notice: '   ',
    startAt: kstDateTimeToIso('2026-11-25', '19:00'),
    durationMinutes: 120,
    regionCode: 'dunsan_tanbang',
    venueId: null,
    venueNote: '',
    minParticipants: 2,
    maxParticipants: 6,
    skillLevel: 'anyone',
    approvalMode: 'auto',
    allowWaitlist: true,
    holdemPolicyAgreed: false,
    ...overrides,
  };
}

describe('seed 일관성', () => {
  it('모든 모임의 카운트가 실제 참가 행 집계와 같다(모임장 포함)', () => {
    const db = seed();
    expect(rules.findCountMismatches(db)).toEqual([]);
    for (const item of db.meetings) {
      const hosts = db.participants.filter((p) => p.meetingId === item.id && p.role === 'host');
      expect(hosts).toHaveLength(1);
      expect(hosts[0]?.status).toBe('confirmed');
    }
  });
});

describe('참가 신청 (apply_to_meeting)', () => {
  it('auto: 자리가 있으면 confirmed, 확정 인원 +1', () => {
    const db = seed();
    const { db: next, value } = rules.applyToMeeting(db, B, 'seed-meeting-01', null, NOW);
    expect(value).toBe('confirmed');
    expect(meeting(next, 'seed-meeting-01').confirmedCount).toBe(3);
    expect(row(next, 'seed-meeting-01', B)?.confirmedAt).not.toBeNull();
    expect(rules.findCountMismatches(next)).toEqual([]);
  });

  it('입력 db는 바뀌지 않는다(복사본에만 반영)', () => {
    const db = seed();
    const before = JSON.stringify(db);
    rules.applyToMeeting(db, B, 'seed-meeting-01', null, NOW);
    expect(JSON.stringify(db)).toBe(before);
  });

  it('manual: pending이 되고 자리를 차지하지 않는다', () => {
    const db = seed();
    const { db: next, value } = rules.applyToMeeting(db, B, 'seed-meeting-13', '  잘 부탁드려요  ', NOW);
    expect(value).toBe('pending');
    expect(meeting(next, 'seed-meeting-13').confirmedCount).toBe(2);
    expect(meeting(next, 'seed-meeting-13').pendingCount).toBe(3);
    expect(row(next, 'seed-meeting-13', B)?.message).toBe('잘 부탁드려요');
  });

  it('정원은 모임장 포함: 4명 정원(모임장 1)에는 게스트 3명까지, 그다음은 MEETING_FULL(대기 불가)', () => {
    let db = seed();
    expect(meeting(db, 'seed-meeting-05')).toMatchObject({ maxParticipants: 4, confirmedCount: 1, allowWaitlist: false });
    for (const user of [A, B, ADMIN]) db = rules.applyToMeeting(db, user, 'seed-meeting-05', null, NOW).db;
    expect(meeting(db, 'seed-meeting-05').confirmedCount).toBe(4);
    expectError(() => rules.applyToMeeting(db, 'seed-guest-01', 'seed-meeting-05', null, NOW), 'MEETING_FULL');
  });

  it('정원이 찼고 대기 허용이면 waitlisted', () => {
    const db = seed();
    const { db: next, value } = rules.applyToMeeting(db, B, 'seed-meeting-03', null, NOW);
    expect(value).toBe('waitlisted');
    expect(meeting(next, 'seed-meeting-03')).toMatchObject({ confirmedCount: 4, waitlistCount: 2 });
  });

  it('중복 신청 → ALREADY_APPLIED, 자기 모임 → OWN_MEETING', () => {
    const db = rules.applyToMeeting(seed(), B, 'seed-meeting-01', null, NOW).db;
    expectError(() => rules.applyToMeeting(db, B, 'seed-meeting-01', null, NOW), 'ALREADY_APPLIED');
    expectError(() => rules.applyToMeeting(db, A, 'seed-meeting-13', null, NOW), 'OWN_MEETING');
  });

  it('취소된 모임·모집 마감·시작/종료 후·숨김·없는 모임은 거절', () => {
    const db = seed();
    expectError(() => rules.applyToMeeting(db, B, 'seed-meeting-10', null, NOW), 'MEETING_CANCELLED');
    expectError(() => rules.applyToMeeting(db, B, 'seed-meeting-09', null, NOW), 'MEETING_NOT_OPEN');
    expectError(() => rules.applyToMeeting(db, B, 'seed-meeting-12', null, NOW), 'MEETING_STARTED');
    expectError(() => rules.applyToMeeting(db, B, 'seed-meeting-11', null, NOW), 'MEETING_STARTED');
    expectError(() => rules.applyToMeeting(db, B, 'seed-meeting-16', null, NOW), 'NOT_FOUND');
    expectError(() => rules.applyToMeeting(db, B, 'nope', null, NOW), 'NOT_FOUND');
  });

  it('거절된 신청은 다시 신청할 수 없다(APPLICATION_REJECTED)', () => {
    let db = rules.applyToMeeting(seed(), B, 'seed-meeting-13', null, NOW).db;
    const target = row(db, 'seed-meeting-13', B);
    db = rules.decideParticipant(db, A, target!.id, 'reject', NOW).db;
    expectError(() => rules.applyToMeeting(db, B, 'seed-meeting-13', null, NOW), 'APPLICATION_REJECTED');
  });

  it('메시지 200자 초과 → VALIDATION_FAILED(message)', () => {
    expectError(
      () => rules.applyToMeeting(seed(), B, 'seed-meeting-01', '가'.repeat(201), NOW),
      'VALIDATION_FAILED',
      'message',
    );
    expect(rules.applyToMeeting(seed(), B, 'seed-meeting-01', '가'.repeat(200), NOW).value).toBe('confirmed');
  });

  it('로그인·계정 상태·최초 설정 검사', () => {
    const db = seed();
    expectError(() => rules.applyToMeeting(db, null, 'seed-meeting-01', null, NOW), 'AUTH_REQUIRED');
    expectError(() => rules.applyToMeeting(db, NEW, 'seed-meeting-01', null, NOW), 'PROFILE_INCOMPLETE');
    const restricted = patchProfile(db, B, { status: 'restricted' });
    expectError(() => rules.applyToMeeting(restricted, B, 'seed-meeting-01', null, NOW), 'ACCOUNT_RESTRICTED');
    const deleted = patchProfile(db, B, { status: 'deletion_requested' });
    expectError(() => rules.applyToMeeting(deleted, B, 'seed-meeting-01', null, NOW), 'ACCOUNT_DELETION_REQUESTED');
  });
});

describe('본인 신청 취소 (cancel_my_application)', () => {
  it('확정 취소 시 카운트가 줄고, 같은 행으로 다시 신청할 수 있다', () => {
    let db = seed();
    const before = meeting(db, 'seed-meeting-02').confirmedCount;
    db = rules.cancelMyApplication(db, A, 'seed-meeting-02', NOW).db;
    expect(meeting(db, 'seed-meeting-02').confirmedCount).toBe(before - 1);
    expect(row(db, 'seed-meeting-02', A)?.status).toBe('cancelled');
    const rowId = row(db, 'seed-meeting-02', A)?.id;
    const again = rules.applyToMeeting(db, A, 'seed-meeting-02', null, NOW);
    expect(again.value).toBe('confirmed');
    expect(row(again.db, 'seed-meeting-02', A)?.id).toBe(rowId);
  });

  it('대기자 자동 승격 없음: 확정자가 취소해도 waitlisted는 그대로', () => {
    let db = seed();
    const confirmedGuest = rowsWith(db, 'seed-meeting-03', 'confirmed').find((p) => p.role === 'guest');
    db = rules.cancelMyApplication(db, confirmedGuest!.userId, 'seed-meeting-03', NOW).db;
    expect(meeting(db, 'seed-meeting-03')).toMatchObject({ confirmedCount: 3, waitlistCount: 1 });
    expect(row(db, 'seed-meeting-03', A)?.status).toBe('waitlisted');
  });

  it('신청 없음 → NOT_APPLIED, 모임장 → OWN_MEETING, 시작 후 → MEETING_STARTED', () => {
    const db = seed();
    expectError(() => rules.cancelMyApplication(db, B, 'seed-meeting-01', NOW), 'NOT_APPLIED');
    expectError(() => rules.cancelMyApplication(db, A, 'seed-meeting-13', NOW), 'OWN_MEETING');
    const guest = rowsWith(db, 'seed-meeting-12', 'confirmed').find((p) => p.role === 'guest');
    expectError(() => rules.cancelMyApplication(db, guest!.userId, 'seed-meeting-12', NOW), 'MEETING_STARTED');
  });

  it('이용 제한 계정도 취소는 할 수 있다', () => {
    const db = patchProfile(seed(), A, { status: 'restricted' });
    expect(() => rules.cancelMyApplication(db, A, 'seed-meeting-02', NOW)).not.toThrow();
  });
});

describe('모임장 취소 (cancel_meeting)', () => {
  it('게스트 pending/confirmed/waitlisted → meeting_cancelled, 카운트 1/0/0, 거절·취소 행은 유지', () => {
    let db = rules.applyToMeeting(seed(), B, 'seed-meeting-13', null, NOW).db;
    const pendingGuest = rowsWith(db, 'seed-meeting-13', 'pending')[0]!;
    db = rules.decideParticipant(db, A, pendingGuest.id, 'reject', NOW).db;
    db = rules.cancelMeeting(db, A, 'seed-meeting-13', '  개인 사정  ', NOW).db;
    const cancelled = meeting(db, 'seed-meeting-13');
    expect(cancelled).toMatchObject({ status: 'cancelled', cancelReason: '개인 사정', confirmedCount: 1, pendingCount: 0, waitlistCount: 0 });
    expect(row(db, 'seed-meeting-13', B)?.status).toBe('meeting_cancelled');
    expect(db.participants.find((p) => p.id === pendingGuest.id)?.status).toBe('rejected');
    expect(row(db, 'seed-meeting-13', A)?.status).toBe('confirmed');
    expect(rules.findCountMismatches(db)).toEqual([]);
  });

  it('모임장 아님 → NOT_HOST, 이미 취소 → MEETING_CANCELLED, 시작 후 모임장 → MEETING_STARTED', () => {
    const db = seed();
    expectError(() => rules.cancelMeeting(db, B, 'seed-meeting-13', null, NOW), 'NOT_HOST');
    expectError(() => rules.cancelMeeting(db, 'seed-host-09', 'seed-meeting-10', null, NOW), 'MEETING_CANCELLED');
    expectError(() => rules.cancelMeeting(db, A, 'seed-meeting-12', null, NOW), 'MEETING_STARTED');
    expectError(() => rules.cancelMeeting(db, A, 'seed-meeting-13', '가'.repeat(201), NOW), 'VALIDATION_FAILED', 'reason');
  });

  it('관리자는 진행 중(종료 전) 모임도 취소할 수 있다', () => {
    const { db } = rules.cancelMeeting(seed(), ADMIN, 'seed-meeting-12', '운영 정책 위반', NOW);
    expect(meeting(db, 'seed-meeting-12').status).toBe('cancelled');
  });
});

describe('모집 마감/재개 (set_meeting_recruiting)', () => {
  it('마감하면 신청이 MEETING_NOT_OPEN, 다시 열면 신청 가능', () => {
    let db = rules.setMeetingRecruiting(seed(), A, 'seed-meeting-13', false, NOW).db;
    expect(meeting(db, 'seed-meeting-13').status).toBe('closed');
    expectError(() => rules.applyToMeeting(db, B, 'seed-meeting-13', null, NOW), 'MEETING_NOT_OPEN');
    db = rules.setMeetingRecruiting(db, A, 'seed-meeting-13', true, NOW).db;
    expect(rules.applyToMeeting(db, B, 'seed-meeting-13', null, NOW).value).toBe('pending');
    expectError(() => rules.setMeetingRecruiting(db, B, 'seed-meeting-13', false, NOW), 'NOT_HOST');
    expectError(() => rules.setMeetingRecruiting(db, A, 'seed-meeting-12', false, NOW), 'MEETING_STARTED');
  });
});

describe('승인/거절 (decide_participant)', () => {
  it('승인하면 confirmed + 카운트 갱신, 자리가 없으면 MEETING_FULL', () => {
    let db = patchMeeting(seed(), 'seed-meeting-13', { maxParticipants: 3 });
    const [first, second] = rowsWith(db, 'seed-meeting-13', 'pending');
    const approved = rules.decideParticipant(db, A, first!.id, 'approve', NOW);
    expect(approved.value).toBe('confirmed');
    db = approved.db;
    expect(meeting(db, 'seed-meeting-13')).toMatchObject({ confirmedCount: 3, pendingCount: 1 });
    expectError(() => rules.decideParticipant(db, A, second!.id, 'approve', NOW), 'MEETING_FULL');
    expect(rules.decideParticipant(db, A, second!.id, 'reject', NOW).value).toBe('rejected');
  });

  it('대기자는 자리가 나야 모임장이 직접 승인할 수 있다', () => {
    let db = seed();
    const waiting = row(db, 'seed-meeting-03', A)!;
    expectError(() => rules.decideParticipant(db, 'seed-host-03', waiting.id, 'approve', NOW), 'MEETING_FULL');
    const confirmedGuest = rowsWith(db, 'seed-meeting-03', 'confirmed').find((p) => p.role === 'guest')!;
    db = rules.cancelMyApplication(db, confirmedGuest.userId, 'seed-meeting-03', NOW).db;
    expect(rules.decideParticipant(db, 'seed-host-03', waiting.id, 'approve', NOW).value).toBe('confirmed');
  });

  it('모임장 아님 → NOT_HOST, 이미 확정된 행 → INVALID_STATE, 잘못된 결정 → VALIDATION_FAILED', () => {
    const db = seed();
    const pending = rowsWith(db, 'seed-meeting-13', 'pending')[0]!;
    const confirmed = rowsWith(db, 'seed-meeting-13', 'confirmed').find((p) => p.role === 'guest')!;
    expectError(() => rules.decideParticipant(db, B, pending.id, 'approve', NOW), 'NOT_HOST');
    expectError(() => rules.decideParticipant(db, A, confirmed.id, 'approve', NOW), 'INVALID_STATE');
    expectError(
      () => rules.decideParticipant(db, A, pending.id, 'maybe' as never, NOW),
      'VALIDATION_FAILED',
      'decision',
    );
  });
});

describe('출석 체크 (mark_attendance)', () => {
  it('시작 후 ~ 종료 7일: 확정 게스트만 기록', () => {
    const db = seed();
    const guest = rowsWith(db, 'seed-meeting-12', 'confirmed').find((p) => p.role === 'guest')!;
    const next = rules.markAttendance(db, A, guest.id, 'attended', NOW).db;
    expect(next.participants.find((p) => p.id === guest.id)?.attendance).toBe('attended');
    const host = row(db, 'seed-meeting-12', A)!;
    expectError(() => rules.markAttendance(db, A, host.id, 'attended', NOW), 'INVALID_STATE');
    // 종료 26시간 뒤(7일 이내)도 가능
    const ended = row(db, 'seed-meeting-11', A)!;
    expect(() => rules.markAttendance(db, 'seed-host-02', ended.id, 'absent', NOW)).not.toThrow();
  });

  it('시작 전·종료 7일 후 → ATTENDANCE_WINDOW_CLOSED', () => {
    const db = seed();
    const future = rowsWith(db, 'seed-meeting-13', 'confirmed').find((p) => p.role === 'guest')!;
    expectError(() => rules.markAttendance(db, A, future.id, 'attended', NOW), 'ATTENDANCE_WINDOW_CLOSED');
    const later = new Date(NOW.getTime() + 8 * 24 * 60 * MINUTE);
    const guest = rowsWith(db, 'seed-meeting-12', 'confirmed').find((p) => p.role === 'guest')!;
    expectError(() => rules.markAttendance(db, A, guest.id, 'attended', later), 'ATTENDANCE_WINDOW_CLOSED');
  });
});

describe('모임 생성 (create_meeting)', () => {
  it('모임장 참가 행(confirmed)과 함께 1/0/0으로 시작하고, 입력을 정규화한다', () => {
    const { db, value } = rules.createMeeting(seed(), B, validInput(), NOW);
    const created = meeting(db, value);
    expect(created).toMatchObject({
      hostId: B,
      hostNickname: '예시사용자B',
      title: '새 모임 테스트',
      gameName: '코드네임',
      notice: null,
      venueNote: null,
      status: 'open',
      confirmedCount: 1,
      pendingCount: 0,
      waitlistCount: 0,
    });
    expect(Date.parse(created.endAt) - Date.parse(created.startAt)).toBe(120 * MINUTE);
    expect(row(db, value, B)).toMatchObject({ role: 'host', status: 'confirmed' });
  });

  it('제목 2~60자, 소개 ≤2000, 유의사항 ≤1000, 게임명 ≤40', () => {
    const db = seed();
    expectError(() => rules.createMeeting(db, B, validInput({ title: ' 가 ' }), NOW), 'VALIDATION_FAILED', 'title');
    expectError(() => rules.createMeeting(db, B, validInput({ title: '가'.repeat(61) }), NOW), 'VALIDATION_FAILED', 'title');
    expect(() => rules.createMeeting(db, B, validInput({ title: '가'.repeat(60) }), NOW)).not.toThrow();
    expectError(
      () => rules.createMeeting(db, B, validInput({ description: '가'.repeat(2001) }), NOW),
      'VALIDATION_FAILED',
      'description',
    );
    expectError(() => rules.createMeeting(db, B, validInput({ notice: '가'.repeat(1001) }), NOW), 'VALIDATION_FAILED', 'notice');
    expectError(() => rules.createMeeting(db, B, validInput({ gameName: '가'.repeat(41) }), NOW), 'VALIDATION_FAILED', 'game_name');
  });

  it('시작 시각은 지금 + 30분 ~ 90일', () => {
    const db = seed();
    const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
    expectError(() => rules.createMeeting(db, B, validInput({ startAt: at(29 * MINUTE) }), NOW), 'VALIDATION_FAILED', 'start_at');
    expect(() => rules.createMeeting(db, B, validInput({ startAt: at(30 * MINUTE) }), NOW)).not.toThrow();
    expect(() => rules.createMeeting(db, B, validInput({ startAt: at(90 * 24 * 60 * MINUTE) }), NOW)).not.toThrow();
    expectError(
      () => rules.createMeeting(db, B, validInput({ startAt: at(90 * 24 * 60 * MINUTE + MINUTE) }), NOW),
      'VALIDATION_FAILED',
      'start_at',
    );
    expectError(() => rules.createMeeting(db, B, validInput({ startAt: 'not-a-date' }), NOW), 'VALIDATION_FAILED', 'start_at');
  });

  it('소요 30~720분, 최소 ≥2, 정원 ≤30, 최소 ≤ 정원', () => {
    const db = seed();
    expectError(() => rules.createMeeting(db, B, validInput({ durationMinutes: 20 }), NOW), 'VALIDATION_FAILED', 'duration_minutes');
    expectError(() => rules.createMeeting(db, B, validInput({ durationMinutes: 721 }), NOW), 'VALIDATION_FAILED', 'duration_minutes');
    expectError(() => rules.createMeeting(db, B, validInput({ minParticipants: 1 }), NOW), 'VALIDATION_FAILED', 'min_participants');
    expectError(() => rules.createMeeting(db, B, validInput({ maxParticipants: 31 }), NOW), 'VALIDATION_FAILED', 'max_participants');
    expectError(
      () => rules.createMeeting(db, B, validInput({ minParticipants: 7, maxParticipants: 6 }), NOW),
      'VALIDATION_FAILED',
      'min_participants',
    );
    expect(() => rules.createMeeting(db, B, validInput({ minParticipants: 30, maxParticipants: 30 }), NOW)).not.toThrow();
  });

  it('홀덤은 비금전 동의가 필요하다', () => {
    const db = seed();
    expectError(
      () => rules.createMeeting(db, B, validInput({ categoryId: 'holdem_social' }), NOW),
      'HOLDEM_AGREEMENT_REQUIRED',
    );
    expect(() =>
      rules.createMeeting(db, B, validInput({ categoryId: 'holdem_social', holdemPolicyAgreed: true }), NOW),
    ).not.toThrow();
  });

  it('레이트 리밋: 24시간 5개, 진행 예정 10개', () => {
    let db = seed();
    for (let index = 0; index < 5; index += 1) db = rules.createMeeting(db, B, validInput(), NOW).db;
    expectError(() => rules.createMeeting(db, B, validInput(), NOW), 'RATE_LIMITED', 'create_24h');

    // 이틀 전에 만든 진행 예정 모임 10개
    let other = seed();
    const template = meeting(other, 'seed-meeting-14');
    const old = new Date(NOW.getTime() - 48 * 60 * MINUTE).toISOString();
    other = {
      ...other,
      meetings: [
        ...other.meetings,
        ...Array.from({ length: 10 }, (_, index) => ({ ...template, id: `old-${index}`, hostId: B, createdAt: old })),
      ],
    };
    expectError(() => rules.createMeeting(other, B, validInput(), NOW), 'RATE_LIMITED', 'open_meetings');
  });

  it('최초 설정 전·이용 제한 계정은 만들 수 없다', () => {
    const db = seed();
    expectError(() => rules.createMeeting(db, NEW, validInput(), NOW), 'PROFILE_INCOMPLETE');
    expectError(() => rules.createMeeting(patchProfile(db, B, { status: 'restricted' }), B, validInput(), NOW), 'ACCOUNT_RESTRICTED');
    expectError(() => rules.createMeeting(db, null, validInput(), NOW), 'AUTH_REQUIRED');
  });
});

describe('모임 수정 (update_meeting)', () => {
  function inputFrom(item: MockMeetingRecord, overrides: Partial<MeetingInput> = {}): MeetingInput {
    return {
      categoryId: item.categoryId,
      gameName: item.gameName,
      title: item.title,
      description: item.description,
      notice: item.notice,
      startAt: item.startAt,
      durationMinutes: item.durationMinutes,
      regionCode: item.regionCode,
      venueId: item.venueId,
      venueNote: item.venueNote,
      minParticipants: item.minParticipants,
      maxParticipants: item.maxParticipants,
      skillLevel: item.skillLevel,
      approvalMode: item.approvalMode,
      allowWaitlist: item.allowWaitlist,
      holdemPolicyAgreed: false,
      ...overrides,
    };
  }

  it('모임장은 시작 전 모임을 수정할 수 있고, 승인 방식을 바꿔도 대기 신청은 그대로다', () => {
    const db = seed();
    const target = meeting(db, 'seed-meeting-13');
    const next = rules.updateMeeting(db, A, target.id, inputFrom(target, { title: '바뀐 제목', approvalMode: 'auto' }), NOW).db;
    expect(meeting(next, target.id)).toMatchObject({ title: '바뀐 제목', approvalMode: 'auto', pendingCount: 2 });
    expect(rowsWith(next, target.id, 'pending')).toHaveLength(2);
  });

  it('모임장 아님 → NOT_HOST, 시작 후 → MEETING_STARTED, 취소됨 → MEETING_CANCELLED', () => {
    const db = seed();
    expectError(() => rules.updateMeeting(db, B, 'seed-meeting-13', inputFrom(meeting(db, 'seed-meeting-13')), NOW), 'NOT_HOST');
    expectError(() => rules.updateMeeting(db, A, 'seed-meeting-12', inputFrom(meeting(db, 'seed-meeting-12')), NOW), 'MEETING_STARTED');
    expectError(
      () => rules.updateMeeting(db, 'seed-host-09', 'seed-meeting-10', inputFrom(meeting(db, 'seed-meeting-10')), NOW),
      'MEETING_CANCELLED',
    );
  });

  it('확정 인원보다 작은 정원 → CAPACITY_BELOW_CONFIRMED', () => {
    const db = seed();
    const target = meeting(db, 'seed-meeting-02'); // 확정 5명
    expectError(
      () => rules.updateMeeting(db, 'seed-host-02', target.id, inputFrom(target, { maxParticipants: 4, minParticipants: 2 }), NOW),
      'CAPACITY_BELOW_CONFIRMED',
    );
    expect(() =>
      rules.updateMeeting(db, 'seed-host-02', target.id, inputFrom(target, { maxParticipants: 5 }), NOW),
    ).not.toThrow();
  });

  it('시작 시각이 바뀐 경우에만 30분~90일 규칙을 적용한다', () => {
    const soon = new Date(NOW.getTime() + 20 * MINUTE).toISOString();
    const db = patchMeeting(seed(), 'seed-meeting-13', { startAt: soon, endAt: new Date(Date.parse(soon) + 150 * MINUTE).toISOString() });
    const target = meeting(db, 'seed-meeting-13');
    expect(() => rules.updateMeeting(db, A, target.id, inputFrom(target, { title: '시각은 그대로' }), NOW)).not.toThrow();
    const moved = new Date(NOW.getTime() + 25 * MINUTE).toISOString();
    expectError(() => rules.updateMeeting(db, A, target.id, inputFrom(target, { startAt: moved }), NOW), 'VALIDATION_FAILED', 'start_at');
  });

  it('홀덤으로 바꾸면 동의가 필요하다', () => {
    const db = seed();
    const target = meeting(db, 'seed-meeting-13');
    expectError(
      () => rules.updateMeeting(db, A, target.id, inputFrom(target, { categoryId: 'holdem_social' }), NOW),
      'HOLDEM_AGREEMENT_REQUIRED',
    );
  });
});

describe('프로필 (update_my_profile)', () => {
  it('최초 설정은 닉네임 + 두 동의가 모두 있어야 한다', () => {
    const db = seed();
    expectError(() => rules.updateMyProfile(db, NEW, { nickname: '새닉네임' }, NOW), 'PROFILE_INCOMPLETE');
    expectError(() => rules.updateMyProfile(db, NEW, { nickname: '새닉네임', agreeTerms: true }, NOW), 'PROFILE_INCOMPLETE');
    const next = rules.updateMyProfile(db, NEW, { nickname: '새닉네임', agreeTerms: true, agreePrivacy: true }, NOW).db;
    expect(rules.viewMyProfile(next, NEW)).toMatchObject({ nickname: '새닉네임', termsAgreedAt: NOW.toISOString() });
    expect(rules.applyToMeeting(next, NEW, 'seed-meeting-01', null, NOW).value).toBe('confirmed');
  });

  it('닉네임 형식·예약어·중복(대소문자 무시)', () => {
    const db = seed();
    expectError(() => rules.updateMyProfile(db, B, { nickname: '가' }, NOW), 'VALIDATION_FAILED', 'nickname');
    expectError(() => rules.updateMyProfile(db, B, { nickname: '공백 포함' }, NOW), 'VALIDATION_FAILED', 'nickname');
    expectError(() => rules.updateMyProfile(db, B, { nickname: '관리자123' }, NOW), 'VALIDATION_FAILED', 'nickname');
    expectError(() => rules.updateMyProfile(db, B, { nickname: 'Super_Admin' }, NOW), 'VALIDATION_FAILED', 'nickname');
    expectError(() => rules.updateMyProfile(db, B, { nickname: '예시사용자a' }, NOW), 'NICKNAME_TAKEN');
  });

  it('예약어: 포함 금지(관리자·운영자·운영팀·admin·hanpan) / 완전 일치 금지(한판·탈퇴한사용자)', () => {
    const db = seed();
    for (const reserved of ['관리자김', '운영팀장', 'HanPan_Club', '한판', '한-판', '탈퇴한사용자', '탈퇴한_사용자']) {
      expectError(() => rules.updateMyProfile(db, B, { nickname: reserved }, NOW), 'VALIDATION_FAILED', 'nickname');
    }
    for (const allowed of ['한판승부', '오늘도한판']) {
      const next = rules.updateMyProfile(db, B, { nickname: allowed }, NOW).db;
      expect(rules.viewMyProfile(next, B)?.nickname).toBe(allowed);
    }
  });

  it('모임장 계정이 삭제된 모임(hostId null)은 신청을 받지 않는다(MEETING_NOT_OPEN / host_missing)', () => {
    const db = patchMeeting(seed(), 'seed-meeting-01', { hostId: null, hostNickname: null });
    expectError(() => rules.applyToMeeting(db, B, 'seed-meeting-01', null, NOW), 'MEETING_NOT_OPEN', 'host_missing');
    expect(rules.viewMeeting(db, null, 'seed-meeting-01')).toMatchObject({ hostId: null, hostNickname: null });
  });

  it('닉네임을 바꾸면 내가 연 모임의 모임장 이름도 바뀐다', () => {
    const next = rules.updateMyProfile(seed(), A, { nickname: '바뀐닉네임' }, NOW).db;
    expect(meeting(next, 'seed-meeting-13').hostNickname).toBe('바뀐닉네임');
  });

  it('관심 장르는 유효한 값만, 중복 제거, 최대 6개 / 이용 제한 계정은 수정 불가', () => {
    const db = seed();
    const next = rules.updateMyProfile(db, B, { favoriteCategoryIds: ['party', 'party', 'strategy'] }, NOW).db;
    expect(rules.viewMyProfile(next, B)?.favoriteCategoryIds).toEqual(['party', 'strategy']);
    expectError(
      () => rules.updateMyProfile(db, B, { favoriteCategoryIds: ['nope' as never] }, NOW),
      'VALIDATION_FAILED',
      'favorite_category_ids',
    );
    expectError(() => rules.updateMyProfile(db, B, { bio: '가'.repeat(201) }, NOW), 'VALIDATION_FAILED', 'bio');
    expectError(() => rules.updateMyProfile(patchProfile(db, B, { status: 'restricted' }), B, { bio: '' }, NOW), 'ACCOUNT_RESTRICTED');
  });
});

describe('탈퇴 요청 (request_account_deletion)', () => {
  it('시작 전 신청 취소, 주최 중인 시작 전 모임 취소, 닉네임 비식별화, 멱등', () => {
    const db = seed();
    const next = rules.requestAccountDeletion(db, A, NOW).db;
    expect(row(next, 'seed-meeting-02', A)?.status).toBe('cancelled');
    expect(row(next, 'seed-meeting-03', A)?.status).toBe('cancelled');
    expect(meeting(next, 'seed-meeting-13')).toMatchObject({ status: 'cancelled', cancelReason: '모임장 탈퇴', hostNickname: '탈퇴한 사용자' });
    expect(rowsWith(next, 'seed-meeting-13', 'meeting_cancelled').length).toBeGreaterThan(0);
    expect(meeting(next, 'seed-meeting-12').status).toBe('open'); // 이미 시작한 모임은 취소하지 않는다
    expect(rules.viewMyProfile(next, A)).toMatchObject({ status: 'deletion_requested', nickname: '탈퇴한 사용자', bio: '' });
    expect(rules.findCountMismatches(next)).toEqual([]);
    expect(rules.requestAccountDeletion(next, A, NOW).db).toBe(next);
    expectError(() => rules.applyToMeeting(next, A, 'seed-meeting-01', null, NOW), 'ACCOUNT_DELETION_REQUESTED');
  });
});

describe('조회 권한 흉내 (RLS)', () => {
  it('숨김 모임은 모임장·관리자만 읽고 isHidden이 채워진다', () => {
    const db = seed();
    expect(rules.viewMeeting(db, null, 'seed-meeting-16')).toBeNull();
    expect(rules.viewMeeting(db, B, 'seed-meeting-16')).toBeNull();
    expect(rules.viewMeeting(db, 'seed-host-11', 'seed-meeting-16')).toMatchObject({ isHidden: true });
    expect(rules.viewMeeting(db, ADMIN, 'seed-meeting-16')?.isHidden).toBe(true);
    expect(rules.viewMeeting(db, null, 'seed-meeting-01')).not.toHaveProperty('isHidden');
  });

  it('참가자 목록은 모임장(맨 위)·관리자만', () => {
    const db = seed();
    expectError(() => rules.viewParticipants(db, B, 'seed-meeting-13'), 'NOT_HOST');
    expectError(() => rules.viewParticipants(db, null, 'seed-meeting-13'), 'AUTH_REQUIRED');
    const list = rules.viewParticipants(db, A, 'seed-meeting-13');
    expect(list[0]).toMatchObject({ role: 'host', nickname: '예시사용자A' });
    expect(list).toHaveLength(4);
    expect(rules.viewParticipants(db, ADMIN, 'seed-meeting-13')).toHaveLength(4);
  });

  it('내 모임: 숨김 처리된 참가 모임은 meeting=null로 돌려준다', () => {
    const db = seed();
    const withHidden: MockDb = {
      ...db,
      participants: [
        ...db.participants,
        { ...db.participants[0]!, id: 'x-hidden', meetingId: 'seed-meeting-16', userId: B, role: 'guest' },
      ],
    };
    const mine = rules.viewMyMeetings(withHidden, B);
    expect(mine.joined.find((entry) => entry.participation.id === 'x-hidden')?.meeting).toBeNull();
    expect(rules.viewMyMeetings(db, A).hosted.map((m) => m.id)).toEqual(['seed-meeting-12', 'seed-meeting-13']);
    expectError(() => rules.viewMyMeetings(db, null), 'AUTH_REQUIRED');
  });
});
