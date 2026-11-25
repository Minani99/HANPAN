import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { Meeting } from '../../data/types';
import { getCategoryName } from '../../domain/categories';
import { getRegionName } from '../../domain/regions';
import { getSkillLevelLabel } from '../../domain/skillLevels';
import { formatMeetingDateTime } from '../../lib/date';
import { Badge } from '../ui/Badge';
import { Icon } from '../ui/Icon';
import { AvailabilityLabel } from './AvailabilityLabel';
import { CategoryPlaceholder } from './CategoryPlaceholder';

export const UNDECIDED_VENUE_LABEL = '장소 미정';

export function meetingPath(id: string): string {
  return `/meetings/${encodeURIComponent(id)}`;
}

export interface MeetingRowProps {
  meeting: Meeting;
  now: Date;
  /** 첫 줄 앞에 붙일 배지(내 모임: 내 신청 상태 등). 색과 함께 문구로 상태를 전달한다 */
  badges?: ReactNode;
  /** 행 아래 별도 링크(예: '참가자 관리'). 행 링크 안에 중첩하지 않는다 */
  actions?: ReactNode;
  /**
   * 모임 제목의 제목 단계. 기본 3(탐색·공간 상세처럼 목록 위에 h2가 있는 곳).
   * 목록 위에 h2가 없는 화면(내 모임: h1 바로 아래)은 2 — 제목 단계를 건너뛰지 않게(axe heading-order). 모양은 같다.
   */
  headingLevel?: 2 | 3;
}

/**
 * 탐색 목록의 한 행. 행 전체가 상세 링크이며 안에 버튼을 두지 않는다.
 * 데스크톱: 썸네일 183x105 | 정보 | 인원 | → / 모바일: 썸네일(2행) | 정보 + 인원 줄
 */
export function MeetingRow({ meeting, now, badges, actions, headingLevel = 3 }: MeetingRowProps) {
  const TitleHeading = headingLevel === 2 ? 'h2' : 'h3';
  const categoryName = getCategoryName(meeting.categoryId);
  const place = meeting.venueName ?? UNDECIDED_VENUE_LABEL;
  const condition =
    meeting.approvalMode === 'manual'
      ? `${getSkillLevelLabel(meeting.skillLevel)} · 승인제`
      : getSkillLevelLabel(meeting.skillLevel);

  return (
    <li className="border-b border-border">
      <Link
        to={meetingPath(meeting.id)}
        className={[
          'grid grid-cols-[80px_minmax(0,1fr)] gap-x-3.25 gap-y-2 py-5 text-text transition-colors duration-100',
          'sm:grid-cols-[86px_minmax(0,1fr)]',
          'md:grid-cols-[183px_minmax(0,1fr)_minmax(102px,max-content)_22px] md:items-center md:gap-6.5 md:py-6 md:pr-2 md:hover:bg-hover',
        ].join(' ')}
        data-testid="meeting-row"
      >
        <div className="row-span-2 h-[92px] w-full self-start overflow-hidden rounded-md sm:h-[96px] md:row-span-1 md:h-[105px] md:self-auto">
          {meeting.imageUrl ? (
            <img
              src={meeting.imageUrl}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover saturate-70"
            />
          ) : (
            <CategoryPlaceholder categoryId={meeting.categoryId} decorative />
          )}
        </div>

        <div className="col-start-2 min-w-0">
          <p className="mb-1.5 flex flex-wrap items-center gap-x-1.25 gap-y-1 text-xs leading-snug font-semibold tracking-normal text-muted md:mb-2 md:gap-x-2">
            {badges}
            <Badge tone="genre">{categoryName}</Badge>
            {/* 구분점이 줄 끝에 홀로 남지 않도록 참여 조건과 한 덩어리로 묶는다 */}
            <span className="inline-flex min-w-0 gap-x-1.25 md:gap-x-2">
              <span aria-hidden="true">·</span>
              <span>{condition}</span>
            </span>
          </p>
          <TitleHeading
            className="line-clamp-2 text-base leading-title font-heavy tracking-title-sm text-ink text-wrap-ko md:text-xl md:leading-tight md:font-title md:tracking-title"
            data-testid="meeting-title"
          >
            {meeting.title}
          </TitleHeading>
          <div
            className="mt-2 text-xs leading-snug tracking-meta text-muted md:mt-3 md:flex md:flex-wrap md:gap-x-4.5 md:gap-y-1 md:text-sm"
            data-testid="meeting-meta"
          >
            <p className="mb-1 flex items-start gap-1.25 md:mb-0">
              <Icon name="calendar" size="1.08em" className="mt-[0.17em]" />
              <time dateTime={meeting.startAt}>{formatMeetingDateTime(meeting.startAt)}</time>
            </p>
            <p className="flex min-w-0 items-start gap-1.25">
              <Icon name="pin" size="1.08em" className="mt-[0.17em]" />
              <span className="min-w-0 text-wrap-ko">
                {getRegionName(meeting.regionCode)} · {place}
              </span>
            </p>
          </div>
        </div>

        <AvailabilityLabel meeting={meeting} now={now} className="col-start-2 md:col-start-3" />

        <span aria-hidden="true" className="hidden text-center text-arrow leading-none font-light text-ink md:block">
          →
        </span>
      </Link>
      {actions ? (
        <div className="-mt-1.5 grid grid-cols-[80px_minmax(0,1fr)] gap-x-3.25 pb-4 sm:grid-cols-[86px_minmax(0,1fr)] md:-mt-2 md:grid-cols-[183px_minmax(0,1fr)] md:gap-x-6.5 md:pb-5">
          <div className="col-start-2 flex flex-wrap gap-x-4 gap-y-1">{actions}</div>
        </div>
      ) : null}
    </li>
  );
}
