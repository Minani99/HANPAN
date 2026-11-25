import type { Meeting } from '../data/types';

/**
 * 화면에 보여줄 모임 상태.
 * 우선순위: cancelled > finished > in_progress > closed > full > open
 */
export type MeetingPhase = 'cancelled' | 'finished' | 'in_progress' | 'closed' | 'full' | 'open';

type PhaseInput = Pick<
  Meeting,
  'status' | 'startAt' | 'endAt' | 'confirmedCount' | 'maxParticipants'
>;

export function getMeetingPhase(meeting: PhaseInput, now: Date): MeetingPhase {
  if (meeting.status === 'cancelled') return 'cancelled';

  const nowMs = now.getTime();
  if (nowMs >= Date.parse(meeting.endAt)) return 'finished';
  if (nowMs >= Date.parse(meeting.startAt)) return 'in_progress';
  if (meeting.status === 'closed') return 'closed';
  if (meeting.confirmedCount >= meeting.maxParticipants) return 'full';
  return 'open';
}

/** 남은 자리 수 (정원은 모임장 포함). 음수가 되지 않는다. */
export function remainingSeats(meeting: Pick<Meeting, 'confirmedCount' | 'maxParticipants'>): number {
  return Math.max(0, meeting.maxParticipants - meeting.confirmedCount);
}

/** 확정 인원이 최소 진행 인원보다 적은지 */
export function isBelowMinimum(meeting: Pick<Meeting, 'confirmedCount' | 'minParticipants'>): boolean {
  return meeting.confirmedCount < meeting.minParticipants;
}

/** 지금 참가 신청을 받을 수 있는 상태인지 */
export function isRecruiting(meeting: PhaseInput, now: Date): boolean {
  return getMeetingPhase(meeting, now) === 'open';
}
