import { Link } from 'react-router';
import type { Venue } from '../../data/types';
import { getRegionName } from '../../domain/regions';
import { VENUE_TYPE_LABEL, formatVerifiedDate, venuePath } from '../../domain/venues';
import { Badge } from '../ui/Badge';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';

/**
 * 공간 목록의 한 행(구분선 행, 행 전체가 상세 링크). 사진은 없다(중립).
 * 1줄: 유형 배지 / 2줄: 공간 이름(2줄 말줄임) / 3줄: 권역 · 주소(2줄 말줄임) / 4줄: 정보 확인일 / 오른쪽 화살표
 */
export function VenueRow({ venue }: { venue: Venue }) {
  return (
    <li className="border-b border-border">
      <Link
        to={venuePath(venue.id)}
        className="grid grid-cols-[minmax(0,1fr)_1.5rem] items-center gap-x-3 py-5 text-text transition-colors duration-100 md:gap-x-6 md:py-6 md:pr-2 md:hover:bg-hover"
        data-testid="venue-row"
      >
        <div className="min-w-0">
          <p className="mb-1.5 flex flex-wrap items-center gap-2 md:mb-2">
            <Badge tone="genre" data-testid="venue-type">
              {VENUE_TYPE_LABEL[venue.venueType]}
            </Badge>
          </p>
          <h3
            className="line-clamp-2 text-base leading-title font-heavy tracking-title-sm text-ink text-wrap-ko md:text-xl md:leading-tight md:font-title md:tracking-title"
            data-testid="venue-name"
          >
            {venue.name}
          </h3>
          <p className="mt-2 flex items-start gap-1.25 text-xs leading-snug tracking-meta text-muted md:mt-2.5 md:text-sm">
            <Icon name="pin" size="1.08em" className="mt-[0.17em]" />
            <span className="line-clamp-2 min-w-0 text-wrap-ko" data-testid="venue-address">
              {getRegionName(venue.regionCode)} · {venue.address}
            </span>
          </p>
          <p className="mt-1 flex items-center gap-1.25 text-xs leading-snug text-muted md:text-sm" data-testid="venue-verified">
            <Icon name="check-circle" size="1.08em" />
            {formatVerifiedDate(venue.infoVerifiedAt)}
          </p>
        </div>
        <Icon name="chevron-right" size="1.5rem" className="text-ink" />
      </Link>
    </li>
  );
}

export function VenueListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div aria-busy="true" data-testid="venue-list-loading">
      <p role="status" className="sr-only">
        공간 목록을 불러오는 중이에요.
      </p>
      <ul aria-hidden="true">
        {Array.from({ length: count }, (_, index) => (
          <li key={index} className="space-y-2.5 border-b border-border py-5 md:py-6">
            <Skeleton className="h-5 w-24 rounded-sm" />
            <Skeleton className="h-5 w-2/3 md:h-6" />
            <Skeleton className="h-4 w-11/12 md:w-1/2" />
          </li>
        ))}
      </ul>
    </div>
  );
}
