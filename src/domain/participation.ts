import type { AttendanceStatus, Meeting, ParticipantStatus } from '../data/types';
import { ATTENDANCE_WINDOW_DAYS } from './limits';

/** 신청 상태 표기 (색과 함께 항상 문구로 전달한다) */
export const PARTICIPANT_STATUS_LABEL: Readonly<Record<ParticipantStatus, string>> = {
  pending: '승인 대기',
  confirmed: '참가 확정',
  waitlisted: '대기 중',
  rejected: '거절됨',
  cancelled: '신청 취소',
  meeting_cancelled: '모임 취소',
};

export const ATTENDANCE_LABEL: Readonly<Record<AttendanceStatus, string>> = {
  unknown: '출석 미확인',
  attended: '참석',
  absent: '불참',
};

export const ACTIVE_PARTICIPANT_STATUSES: readonly ParticipantStatus[] = ['pending', 'confirmed', 'waitlisted'];

export function isActiveParticipation(status: ParticipantStatus): boolean {
  return ACTIVE_PARTICIPANT_STATUSES.includes(status);
}

/** 출석 체크 가능 기간: 시작 ~ 종료 7일 뒤 (DB §9.11) */
export function isAttendanceWindowOpen(meeting: Pick<Meeting, 'startAt' | 'endAt' | 'status'>, now: Date): boolean {
  if (meeting.status === 'cancelled') return false;
  const nowMs = now.getTime();
  return (
    Date.parse(meeting.startAt) <= nowMs &&
    nowMs <= Date.parse(meeting.endAt) + ATTENDANCE_WINDOW_DAYS * 24 * 60 * 60 * 1000
  );
}
