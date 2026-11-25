import type { Meeting } from '../../data/types';
import { getMeetingPhase, isBelowMinimum, remainingSeats, type MeetingPhase } from '../../domain/meetingPhase';
import { cn } from '../../lib/cn';
import { Badge } from '../ui/Badge';

export interface AvailabilityInfo {
  phase: MeetingPhase;
  /** 보조 문구 (예: '3자리 남음') */
  sub: string | null;
  /** 상태 배지 (예: '정원 마감') */
  badge: string | null;
}

const PHASE_BADGE: Partial<Record<MeetingPhase, string>> = {
  full: '정원 마감',
  closed: '모집 마감',
  in_progress: '진행 중',
  finished: '종료',
  cancelled: '취소됨',
};

export function getAvailabilityInfo(meeting: Meeting, now: Date): AvailabilityInfo {
  const phase = getMeetingPhase(meeting, now);
  if (phase === 'open') {
    return {
      phase,
      sub: `${remainingSeats(meeting)}자리 남음`,
      badge: isBelowMinimum(meeting) ? '최소 인원 모집 중' : null,
    };
  }
  if (phase === 'full') {
    return { phase, sub: meeting.allowWaitlist ? '대기 신청 가능' : null, badge: PHASE_BADGE.full ?? null };
  }
  return { phase, sub: null, badge: PHASE_BADGE[phase] ?? null };
}

export interface AvailabilityLabelProps {
  meeting: Meeting;
  now: Date;
  className?: string;
}

/**
 * 인원 현황: '5/8명' + 보조 문구/상태 배지.
 * 모바일은 한 줄 가로 배치, 데스크톱(761px~)은 오른쪽 정렬 세로 배치.
 */
export function AvailabilityLabel({ meeting, now, className }: AvailabilityLabelProps) {
  const { sub, badge, phase } = getAvailabilityInfo(meeting, now);
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-2 gap-y-1 text-left',
        'md:flex-col md:items-end md:gap-0 md:text-right',
        className,
      )}
      data-testid="meeting-availability"
      data-phase={phase}
    >
      <strong className="text-sm leading-tight font-heavy tracking-tight whitespace-nowrap text-ink md:text-2xl">
        <span aria-hidden="true">
          {meeting.confirmedCount}/{meeting.maxParticipants}명
        </span>
        <span className="sr-only">
          확정 {meeting.confirmedCount}명, 정원 {meeting.maxParticipants}명
        </span>
      </strong>
      {sub ? <span className="text-xs leading-snug whitespace-nowrap text-muted md:mt-0.75">{sub}</span> : null}
      {badge ? (
        <Badge tone="status" className="md:mt-1.25">
          {badge}
        </Badge>
      ) : null}
    </div>
  );
}
