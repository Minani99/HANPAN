import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { Meeting } from '../../data/types';
import { getRegionName } from '../../domain/regions';
import { getSkillLevelLabel } from '../../domain/skillLevels';
import { cn } from '../../lib/cn';
import { formatDuration, formatMeetingSchedule } from '../../lib/date';
import { Icon, type IconName } from '../ui/Icon';
import { APPROVAL_DESCRIPTION, hostDisplayName, placeLabel } from './meetingText';

function InfoRow({ icon, label, children }: { icon: IconName; label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(4.5rem,auto)_minmax(0,1fr)] gap-x-4 py-3 sm:grid-cols-[5.5rem_minmax(0,1fr)]">
      <dt className="flex items-start gap-1.5 text-sm leading-relaxed font-semibold text-muted">
        <Icon name={icon} size="1.1em" className="mt-[0.3em]" />
        {label}
      </dt>
      <dd className="min-w-0 text-base leading-relaxed text-ink text-wrap-ko">{children}</dd>
    </div>
  );
}

export interface MeetingInfoListProps {
  meeting: Meeting;
  /** compact: 신청 대화상자 요약(일시·장소만) */
  compact?: boolean;
  /** 공개 공간에 연결된 모임이면 공간 상세 경로(장소 이름을 링크로) */
  venueHref?: string;
  className?: string;
}

/** 상세 정보 목록: 일시 · 장소 · 게임 · 진행 수준 · 참가 방식 · 모임장 */
export function MeetingInfoList({ meeting, compact = false, venueHref, className }: MeetingInfoListProps) {
  const schedule = formatMeetingSchedule(meeting.startAt, meeting.endAt);
  return (
    <dl className={cn('divide-y divide-border', className)} data-testid="meeting-info">
      <InfoRow icon="calendar" label="일시">
        <time dateTime={meeting.startAt} className="block">
          {schedule.date}
        </time>
        <span className="block">
          {schedule.time} <span className="text-muted">· 약 {formatDuration(meeting.durationMinutes)}</span>
        </span>
      </InfoRow>
      <InfoRow icon="pin" label="장소">
        {venueHref && meeting.venueName ? (
          <span className="block">
            {getRegionName(meeting.regionCode)} ·{' '}
            <Link to={venueHref} className="font-bold text-ink underline underline-offset-4" data-testid="meeting-venue-link">
              {meeting.venueName}
            </Link>
          </span>
        ) : (
          <span className="block">{placeLabel(meeting)}</span>
        )}
        {meeting.venueNote ? <span className="mt-0.5 block text-md text-text">{meeting.venueNote}</span> : null}
      </InfoRow>
      {compact ? null : (
        <>
          {meeting.gameName ? (
            <InfoRow icon="dice" label="게임">
              {meeting.gameName}
            </InfoRow>
          ) : null}
          <InfoRow icon="users" label="진행 수준">
            {getSkillLevelLabel(meeting.skillLevel)}
          </InfoRow>
          <InfoRow icon="check-circle" label="참가 방식">
            {APPROVAL_DESCRIPTION[meeting.approvalMode]}
            {meeting.allowWaitlist ? <span className="text-muted"> · 정원이 차면 대기 신청 가능</span> : null}
          </InfoRow>
          <InfoRow icon="user" label="모임장">
            {hostDisplayName(meeting)}
          </InfoRow>
        </>
      )}
    </dl>
  );
}
