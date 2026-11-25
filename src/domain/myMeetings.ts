import type { Meeting, MyJoinedMeeting } from '../data/types';
import { getMeetingPhase } from './meetingPhase';

/** 내 모임 화면 구분 (docs/UI_SPEC.md §4.4) */
export type MyMeetingsRole = 'applied' | 'hosted';
export type MyMeetingsTab = 'upcoming' | 'waiting' | 'done' | 'cancelled';

export const MY_MEETINGS_ROLES: readonly MyMeetingsRole[] = ['applied', 'hosted'];
export const MY_MEETINGS_TABS: readonly MyMeetingsTab[] = ['upcoming', 'waiting', 'done', 'cancelled'];

export const MY_MEETINGS_ROLE_LABEL: Readonly<Record<MyMeetingsRole, string>> = {
  applied: '참가한 모임',
  hosted: '내가 연 모임',
};

export const MY_MEETINGS_TAB_LABEL: Readonly<Record<MyMeetingsTab, string>> = {
  upcoming: '예정',
  waiting: '대기',
  done: '완료',
  cancelled: '취소',
};

export function parseMyMeetingsRole(value: string | null): MyMeetingsRole {
  return value === 'hosted' ? 'hosted' : 'applied';
}

export function parseMyMeetingsTab(value: string | null): MyMeetingsTab {
  return MY_MEETINGS_TABS.includes(value as MyMeetingsTab) ? (value as MyMeetingsTab) : 'upcoming';
}

/**
 * 참가한 모임 분류
 * - 예정: confirmed + 종료 전(진행 중 포함)
 * - 대기: pending·waitlisted + 시작 전
 * - 완료: confirmed + 종료됨
 * - 취소: cancelled·rejected·meeting_cancelled, 시작 때까지 확정되지 않은 신청, 취소된 모임
 * 모임을 읽을 수 없으면(숨김) 신청 상태만으로 분류한다.
 */
export function classifyJoined({ meeting, participation }: MyJoinedMeeting, now: Date): MyMeetingsTab {
  const { status } = participation;
  if (status === 'cancelled' || status === 'rejected' || status === 'meeting_cancelled') return 'cancelled';
  if (!meeting) return status === 'confirmed' ? 'upcoming' : 'waiting';
  const phase = getMeetingPhase(meeting, now);
  if (phase === 'cancelled') return 'cancelled';
  if (status === 'confirmed') return phase === 'finished' ? 'done' : 'upcoming';
  // pending · waitlisted
  return phase === 'in_progress' || phase === 'finished' ? 'cancelled' : 'waiting';
}

/**
 * 내가 연 모임 분류 (한 모임이 '예정'과 '대기'에 함께 나올 수 있다)
 * - 예정: 취소 전·종료 전 / 대기: 시작 전이면서 승인 대기 신청이 있음 / 완료: 종료 / 취소: 취소됨
 */
export function classifyHosted(meeting: Meeting, now: Date): MyMeetingsTab[] {
  const phase = getMeetingPhase(meeting, now);
  if (phase === 'cancelled') return ['cancelled'];
  if (phase === 'finished') return ['done'];
  const tabs: MyMeetingsTab[] = ['upcoming'];
  if (phase !== 'in_progress' && meeting.pendingCount > 0) tabs.push('waiting');
  return tabs;
}

function byStart(direction: 1 | -1) {
  return (a: { startAt: string }, b: { startAt: string }) => direction * (Date.parse(a.startAt) - Date.parse(b.startAt));
}

/** 예정·대기는 가까운 순, 완료·취소는 최근 순 */
export function sortForTab<T>(items: readonly T[], tab: MyMeetingsTab, getStart: (item: T) => string | null): T[] {
  const direction = tab === 'upcoming' || tab === 'waiting' ? 1 : -1;
  const compare = byStart(direction);
  return [...items].sort((a, b) => {
    const startA = getStart(a);
    const startB = getStart(b);
    if (startA === null || startB === null) return startA === null ? 1 : -1;
    return compare({ startAt: startA }, { startAt: startB });
  });
}
