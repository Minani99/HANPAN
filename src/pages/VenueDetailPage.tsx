import { useState } from 'react';
import { useParams } from 'react-router';
import { BackLink } from '../components/layout/BackLink';
import { PageContainer } from '../components/layout/PageContainer';
import { InfoState, PageErrorState, PageSkeleton } from '../components/layout/PageStates';
import { MeetingList } from '../components/meeting/MeetingList';
import { Badge } from '../components/ui/Badge';
import { ButtonLink } from '../components/ui/Button';
import { ExternalLink } from '../components/ui/ExternalLink';
import { Icon } from '../components/ui/Icon';
import { Notice } from '../components/ui/Notice';
import { useDataAdapter } from '../data';
import type { Meeting, PageResult, Venue } from '../data/types';
import { useAsyncData } from '../data/useAsyncData';
import { getRegionName } from '../domain/regions';
import { VENUE_NOTICE, VENUE_TYPE_LABEL, formatVerifiedDay } from '../domain/venues';
import { useDocumentTitle } from '../lib/useDocumentTitle';

const UPCOMING_LIMIT = 10;

interface VenueDetailData {
  venue: Venue | null;
  /** 이 공간에서 열리는 예정 모임(실패해도 공간 정보는 보여준다 → null) */
  meetings: PageResult<Meeting> | null;
}

/**
 * 공간 상세 (`/venues/:id`). 공개 공간만.
 * 외부 링크는 https만 새 창으로(rel="noopener noreferrer"). 실시간 영업 상태·예약 가능 시간은 표시하지 않는다.
 */
export function VenueDetailPage() {
  const { id = '' } = useParams();
  const adapter = useDataAdapter();
  const [now] = useState(() => new Date());
  const detail = useAsyncData<VenueDetailData>(`venue:${id}`, async () => {
    const venue = await adapter.getVenue(id);
    if (!venue) return { venue: null, meetings: null };
    const meetings = await adapter
      .listMeetings({ venueId: venue.id }, { limit: UPCOMING_LIMIT, offset: 0 })
      .catch(() => null);
    return { venue, meetings };
  });
  const venue = detail.data?.venue ?? null;
  useDocumentTitle(detail.status === 'success' ? (venue ? venue.name : '공간을 찾을 수 없어요') : '공간 상세');

  if (detail.status === 'loading') return <PageSkeleton label="공간 정보를 불러오는 중이에요." />;
  if (detail.status === 'error' || !detail.data) {
    return <PageErrorState title="공간 정보를 불러오지 못했어요." onRetry={detail.retry} />;
  }
  if (!venue) {
    return (
      <InfoState
        title="공간을 찾을 수 없어요."
        description="삭제되었거나 비공개 처리됐을 수 있어요."
        actions={<ButtonLink to="/venues">공간 목록으로 가기</ButtonLink>}
      />
    );
  }

  const meetings = detail.data.meetings;
  const hasLinks = Boolean(venue.websiteUrl || venue.bookingUrl);

  return (
    <PageContainer className="pt-2 pb-12 md:pt-4 md:pb-20">
      <BackLink to="/venues" label="공간 목록" />
      <article aria-labelledby="venue-title" className="mt-2 max-w-3xl md:mt-3">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-snug font-semibold text-muted">
          <Badge tone="genre">{VENUE_TYPE_LABEL[venue.venueType]}</Badge>
          <span aria-hidden="true">·</span>
          <span>{getRegionName(venue.regionCode)}</span>
        </p>
        <h1
          id="venue-title"
          className="mt-2.5 text-3xl leading-tight font-heavy tracking-detail text-ink text-wrap-ko md:mt-3 md:text-4xl"
        >
          {venue.name}
        </h1>

        <dl className="mt-5 divide-y divide-border border-y border-border md:mt-6" data-testid="venue-info">
          <div className="grid grid-cols-[minmax(4.5rem,auto)_minmax(0,1fr)] gap-x-4 py-3 sm:grid-cols-[6.5rem_minmax(0,1fr)]">
            <dt className="flex items-start gap-1.5 text-sm leading-relaxed font-semibold text-muted">
              <Icon name="pin" size="1.1em" className="mt-[0.3em]" />
              주소
            </dt>
            <dd className="min-w-0 text-base leading-relaxed text-ink text-wrap-ko">{venue.address}</dd>
          </div>
          <div className="grid grid-cols-[minmax(4.5rem,auto)_minmax(0,1fr)] gap-x-4 py-3 sm:grid-cols-[6.5rem_minmax(0,1fr)]">
            <dt className="flex items-start gap-1.5 text-sm leading-relaxed font-semibold text-muted">
              <Icon name="check-circle" size="1.1em" className="mt-[0.3em]" />
              정보 확인일
            </dt>
            <dd className="min-w-0 text-base leading-relaxed text-ink" data-testid="venue-verified">
              {venue.infoVerifiedAt ? (
                <time dateTime={venue.infoVerifiedAt}>{formatVerifiedDay(venue.infoVerifiedAt)}</time>
              ) : (
                '확인일 없음'
              )}
              <span className="block text-sm text-muted">운영자가 공식 채널에서 정보를 확인한 날이에요.</span>
            </dd>
          </div>
        </dl>

        <Notice tone="info" className="mt-5" data-testid="venue-notice">
          {VENUE_NOTICE}
        </Notice>

        {hasLinks ? (
          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-1" data-testid="venue-links">
            <ExternalLink href={venue.websiteUrl} data-testid="venue-website">
              공식 홈페이지(외부)
            </ExternalLink>
            <ExternalLink href={venue.bookingUrl} data-testid="venue-booking">
              예약 페이지(외부)
            </ExternalLink>
          </div>
        ) : null}

        <section aria-labelledby="venue-description" className="mt-8">
          <h2 id="venue-description" className="text-lg leading-snug font-heavy text-ink">
            소개
          </h2>
          {venue.description ? (
            <p className="mt-3 text-base leading-loose whitespace-pre-wrap text-text text-wrap-ko">{venue.description}</p>
          ) : (
            <p className="mt-3 text-base text-muted">등록된 소개가 아직 없어요.</p>
          )}
        </section>
      </article>

      <section aria-labelledby="venue-meetings" className="mt-12 md:mt-14">
        <h2 id="venue-meetings" className="border-b border-ink pb-3 text-2xl leading-snug font-heavy tracking-section text-ink">
          이 공간에서 열리는 모임
        </h2>
        {meetings === null ? (
          <p className="py-8 text-md text-muted">모임 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p>
        ) : meetings.items.length === 0 ? (
          <div className="py-8">
            <p className="text-md text-muted">이 공간에서 열리는 예정 모임이 아직 없어요.</p>
            <ButtonLink to="/meetings/new" variant="secondary" className="mt-4">
              모임 만들기
            </ButtonLink>
          </div>
        ) : (
          <MeetingList meetings={meetings.items} now={now} aria-labelledby="venue-meetings" />
        )}
      </section>
    </PageContainer>
  );
}
