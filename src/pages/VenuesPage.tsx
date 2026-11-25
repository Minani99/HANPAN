import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { PageContainer } from '../components/layout/PageContainer';
import { PageTitle } from '../components/layout/PageTitle';
import { Button } from '../components/ui/Button';
import { Chip } from '../components/ui/Chip';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { Notice } from '../components/ui/Notice';
import { VenueListSkeleton, VenueRow } from '../components/venue/VenueRow';
import { useDataAdapter } from '../data';
import { useAsyncData } from '../data/useAsyncData';
import { REGIONS } from '../domain/regions';
import { VENUE_NOTICE, VENUE_TYPES, VENUE_TYPE_LABEL, parseVenueQuery, serializeVenueQuery, type VenueQuery } from '../domain/venues';
import { useDocumentTitle } from '../lib/useDocumentTitle';

const NAVIGATE_OPTIONS = { replace: true, preventScrollReset: true } as const;

/**
 * 필터 줄 맨 앞 라벨(스크롤 영역 안). 모바일은 고정폭 없이 짧게(13px, 오른쪽 여백만), 데스크톱은 64px 고정폭 14px.
 * 칩 그룹은 aria-labelledby로 이 라벨을 이름으로 쓴다(보이는 라벨과 접근 가능한 이름을 하나로).
 */
const FILTER_LABEL_CLASS = 'shrink-0 pr-1 text-sm font-bold text-ink md:w-16 md:pr-0 md:text-md';

/**
 * 공간 찾기 (`/venues`). 공개 공간만(관리자도). 권역·유형 필터는 URL 쿼리(region, type)가 단일 출처다.
 * 실시간 영업 상태·좌석·가격·예약 가능 시간은 보여주지 않는다.
 */
export function VenuesPage() {
  useDocumentTitle('공간 찾기');
  const adapter = useDataAdapter();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = useMemo(() => parseVenueQuery(searchParams), [searchParams]);
  const queryKey = serializeVenueQuery(query).toString();
  const venues = useAsyncData(`venues:${queryKey}`, () => adapter.listVenues(query));

  const apply = (patch: Partial<VenueQuery>) => {
    setSearchParams((prev) => {
      const next: VenueQuery = { ...parseVenueQuery(prev), ...patch };
      if (!patch.region && 'region' in patch) delete next.region;
      if (!patch.type && 'type' in patch) delete next.type;
      return serializeVenueQuery(next);
    }, NAVIGATE_OPTIONS);
  };

  const filtered = Boolean(query.region || query.type);

  return (
    <PageContainer className="pt-2 pb-12 md:pt-4 md:pb-20">
      <PageTitle
        title="공간 찾기"
        description="대전의 보드게임 카페와 파티룸 정보를 모았어요. 예약은 각 공간의 공식 채널에서 해 주세요."
      />
      <Notice tone="info" className="max-w-3xl" data-testid="venue-notice">
        {VENUE_NOTICE}
      </Notice>

      <div className="mt-6 space-y-3 md:mt-8" aria-label="공간 필터" role="region">
        <div className="scrollbar-none -m-1.5 flex items-center gap-1.75 overflow-x-auto p-1.5 md:gap-2.25">
          <span id="venue-filter-region" className={FILTER_LABEL_CLASS}>
            권역
          </span>
          <div role="group" aria-labelledby="venue-filter-region" className="flex shrink-0 items-center gap-1.75 md:gap-2.25">
            <Chip selected={!query.region} onClick={() => apply({ region: undefined })}>
              전체
            </Chip>
            {REGIONS.map((region) => (
              <Chip key={region.code} selected={query.region === region.code} onClick={() => apply({ region: region.code })}>
                {region.name}
              </Chip>
            ))}
          </div>
        </div>
        <div className="scrollbar-none -m-1.5 flex items-center gap-1.75 overflow-x-auto p-1.5 md:gap-2.25">
          <span id="venue-filter-type" className={FILTER_LABEL_CLASS}>
            유형
          </span>
          <div role="group" aria-labelledby="venue-filter-type" className="flex shrink-0 items-center gap-1.75 md:gap-2.25">
            <Chip selected={!query.type} onClick={() => apply({ type: undefined })}>
              전체
            </Chip>
            {VENUE_TYPES.map((type) => (
              <Chip key={type} selected={query.type === type} onClick={() => apply({ type })}>
                {VENUE_TYPE_LABEL[type]}
              </Chip>
            ))}
          </div>
        </div>
      </div>

      <section aria-labelledby="venue-list-heading" className="mt-8 md:mt-10">
        <div className="flex items-baseline gap-2 border-b border-ink pb-3">
          <h2 id="venue-list-heading" className="text-2xl leading-snug font-heavy tracking-section text-ink md:text-3xl">
            등록된 공간.
          </h2>
          {venues.status === 'success' ? (
            <p className="text-md text-muted" data-testid="venue-count">
              {venues.data?.length ?? 0}곳
            </p>
          ) : null}
        </div>

        {venues.status === 'loading' ? <VenueListSkeleton /> : null}
        {venues.status === 'error' ? (
          <ErrorState title="공간 정보를 불러오지 못했어요." onRetry={venues.retry} headingLevel="h3" />
        ) : null}
        {venues.status === 'success' && venues.data && venues.data.length > 0 ? (
          <ul role="list" aria-labelledby="venue-list-heading" data-testid="venue-list">
            {venues.data.map((venue) => (
              <VenueRow key={venue.id} venue={venue} />
            ))}
          </ul>
        ) : null}
        {venues.status === 'success' && venues.data && venues.data.length === 0 ? (
          filtered ? (
            <EmptyState
              title="조건에 맞는 공간이 아직 없어요."
              description="권역이나 유형을 바꿔 보세요."
              actions={
                <Button variant="secondary" onClick={() => setSearchParams(new URLSearchParams(), NAVIGATE_OPTIONS)}>
                  필터 초기화
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="아직 등록된 공간이 없어요."
              description="운영자가 공식 정보를 확인한 공간부터 차례로 등록할 예정이에요."
              footnote="운영 중인 공간을 알려 주시는 방법은 아직 준비 중이에요."
            />
          )
        ) : null}
      </section>
    </PageContainer>
  );
}
