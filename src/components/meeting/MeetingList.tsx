import type { Meeting } from '../../data/types';
import { cn } from '../../lib/cn';
import { Skeleton } from '../ui/Skeleton';
import { MeetingRow } from './MeetingRow';

export interface MeetingListProps {
  meetings: readonly Meeting[];
  now: Date;
  className?: string;
  'aria-labelledby'?: string;
}

export function MeetingList({ meetings, now, className, 'aria-labelledby': labelledBy }: MeetingListProps) {
  return (
    // list-style:none 목록도 VoiceOver가 목록으로 읽도록 role="list"를 명시한다.
    <ul role="list" aria-labelledby={labelledBy} className={cn('mt-1.75', className)} data-testid="meeting-list">
      {meetings.map((meeting) => (
        <MeetingRow key={meeting.id} meeting={meeting} now={now} />
      ))}
    </ul>
  );
}

function MeetingRowSkeleton() {
  return (
    <li className="grid grid-cols-[80px_minmax(0,1fr)] gap-x-3.25 gap-y-2 border-b border-border py-5 sm:grid-cols-[86px_minmax(0,1fr)] md:grid-cols-[183px_minmax(0,1fr)_102px_22px] md:items-center md:gap-6.5 md:py-6 md:pr-2">
      <Skeleton className="row-span-2 h-[92px] w-full sm:h-[96px] md:row-span-1 md:h-[105px]" />
      <div className="col-start-2 min-w-0 space-y-2.5">
        <Skeleton className="h-5 w-32 max-w-full rounded-sm" />
        <Skeleton className="h-5 w-11/12 md:h-6 md:w-3/4" />
        <Skeleton className="h-4 w-2/3 md:w-1/2" />
      </div>
      <div className="col-start-2 md:col-start-3 md:justify-self-end">
        <Skeleton className="h-5 w-24 max-w-full md:h-7 md:w-20" />
      </div>
      <span className="hidden md:block" />
    </li>
  );
}

export interface MeetingListSkeletonProps {
  count?: number;
  label?: string;
}

/** 행 모양 스켈레톤. 영역 전체에 aria-busy, 스크린리더에는 문구 하나만 읽힌다. */
export function MeetingListSkeleton({ count = 4, label = '모임 목록을 불러오는 중이에요.' }: MeetingListSkeletonProps) {
  return (
    <div aria-busy="true" data-testid="meeting-list-loading">
      <p role="status" className="sr-only">
        {label}
      </p>
      <ul aria-hidden="true" className="mt-1.75">
        {Array.from({ length: count }, (_, index) => (
          <MeetingRowSkeleton key={index} />
        ))}
      </ul>
    </div>
  );
}
