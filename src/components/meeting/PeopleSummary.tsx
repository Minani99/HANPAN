import type { Meeting } from '../../data/types';
import { getMeetingPhase, isBelowMinimum, remainingSeats } from '../../domain/meetingPhase';
import { cn } from '../../lib/cn';

/** 인원 보조 문구: 남은 자리·최소 인원·대기. 참가자 닉네임은 보여주지 않는다(UI_SPEC §4.2). */
export function peopleDetails(meeting: Meeting, now: Date): string[] {
  const phase = getMeetingPhase(meeting, now);
  const lines: string[] = [];
  if (phase === 'open') lines.push(`${remainingSeats(meeting)}자리 남음`);
  else if (phase === 'full') lines.push(meeting.allowWaitlist ? '정원 마감 · 대기 신청 가능' : '정원 마감');
  else if (phase === 'closed') lines.push('모집 마감');
  if (isBelowMinimum(meeting) && phase !== 'cancelled') {
    const short = meeting.minParticipants - meeting.confirmedCount;
    lines.push(`최소 ${meeting.minParticipants}명 · ${short}명 더 모여야 해요`);
  } else {
    lines.push(`최소 ${meeting.minParticipants}명`);
  }
  if (meeting.waitlistCount > 0) lines.push(`대기 ${meeting.waitlistCount}명`);
  return lines;
}

export interface PeopleSummaryProps {
  meeting: Meeting;
  now: Date;
  /** row: 모바일 본문(구분선 사이 한 줄) / panel: 데스크톱 우측 패널 */
  variant: 'row' | 'panel';
  className?: string;
}

/** '현재 참여 인원 5/8명' (정원은 모임장 포함) */
export function PeopleSummary({ meeting, now, variant, className }: PeopleSummaryProps) {
  const details = peopleDetails(meeting, now);
  const count = (
    <>
      <span aria-hidden="true">
        {meeting.confirmedCount}/{meeting.maxParticipants}명
      </span>
      <span className="sr-only">
        확정 {meeting.confirmedCount}명, 정원 {meeting.maxParticipants}명
      </span>
    </>
  );

  if (variant === 'row') {
    return (
      <div className={cn('border-y border-border py-4', className)} data-testid="people-summary">
        <div className="flex items-center justify-between gap-3">
          <p className="text-base font-bold text-ink">현재 참여 인원</p>
          <p className="text-xl leading-tight font-heavy tracking-tight whitespace-nowrap text-ink">{count}</p>
        </div>
        <p className="mt-1.5 text-sm leading-snug text-text text-wrap-ko">
          {details.join(' · ')} <span className="text-muted">(모임장 포함)</span>
        </p>
      </div>
    );
  }

  return (
    <div className={className} data-testid="people-summary-panel">
      <p className="text-sm font-bold text-muted">현재 참여 인원 (모임장 포함)</p>
      <p className="mt-1 text-4xl leading-tight font-heavy tracking-tight text-ink">{count}</p>
      <ul role="list" className="mt-2 space-y-0.5 text-sm leading-snug text-text">
        {details.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
