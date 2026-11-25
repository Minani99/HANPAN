import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { ExploreAsides } from '../components/explore/ExploreAsides';
import { ExploreHero } from '../components/explore/ExploreHero';
import { QuickActions } from '../components/explore/QuickActions';
import { PageContainer } from '../components/layout/PageContainer';
import { CategoryChips } from '../components/meeting/CategoryChips';
import { DateStrip } from '../components/meeting/DateStrip';
import { MeetingList, MeetingListSkeleton } from '../components/meeting/MeetingList';
import { Button, ButtonLink } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { Icon } from '../components/ui/Icon';
import { TextField } from '../components/ui/TextField';
import type { MeetingFilters } from '../data/types';
import { useMeetingList } from '../data/useMeetingList';
import { CATEGORIES } from '../domain/categories';
import { nextKstDays } from '../lib/date';
import {
  MAX_QUERY_LENGTH,
  clearNarrowingFilters,
  hasActiveFilters,
  normalizeQuery,
  parseFilters,
  serializeFilters,
  updateFilters,
} from '../lib/filters';
import { useDocumentTitle } from '../lib/useDocumentTitle';

export const SEARCH_DEBOUNCE_MS = 250;
const DATE_STRIP_DAYS = 7;
const FILTER_NAVIGATE_OPTIONS = { replace: true, preventScrollReset: true } as const;

const SORT_LABEL = { soonest: '가까운 순', newest: '최근 등록순' } as const;

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * 공개 홈 / 모임 탐색 (`/`, `/meetings`).
 * 필터의 단일 출처는 URL 쿼리다. 필터 변경은 replace로 히스토리를 쌓지 않고, 검색어는 250ms 디바운스한다.
 */
export function ExplorePage() {
  useDocumentTitle('모임 찾기');
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);
  const [now] = useState(() => new Date());
  const days = useMemo(() => nextKstDays(now, DATE_STRIP_DAYS), [now]);
  const list = useMeetingList(filters);
  const filtersRef = useRef<HTMLDivElement>(null);

  const applyFilters = useCallback(
    (patch: Partial<MeetingFilters>) => {
      setSearchParams((prev) => serializeFilters(updateFilters(parseFilters(prev), patch)), FILTER_NAVIGATE_OPTIONS);
    },
    [setSearchParams],
  );

  // ----- 검색어: 입력은 즉시 화면에, URL 반영은 디바운스 -----
  const urlQuery = filters.q ?? '';
  const [searchText, setSearchText] = useState(urlQuery);
  const [syncedUrlQuery, setSyncedUrlQuery] = useState(urlQuery);
  const [committedQuery, setCommittedQuery] = useState<string | null>(null);
  if (urlQuery !== syncedUrlQuery) {
    // URL이 외부 요인(필터 초기화·뒤로 가기 등)으로 바뀌면 입력칸도 맞춘다.
    // 방금 이 화면이 반영한 값이면 입력 중인 글자를 덮어쓰지 않는다.
    setSyncedUrlQuery(urlQuery);
    if (urlQuery !== committedQuery) setSearchText(urlQuery);
  }

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latestApplyFilters = useRef(applyFilters);
  useEffect(() => {
    latestApplyFilters.current = applyFilters;
  }, [applyFilters]);
  useEffect(() => () => clearTimeout(debounceTimer.current), []);

  const commitQuery = useCallback((value: string) => {
    clearTimeout(debounceTimer.current);
    const normalized = normalizeQuery(value) ?? '';
    setCommittedQuery(normalized);
    latestApplyFilters.current({ q: normalized || undefined });
  }, []);

  const handleSearchChange = (value: string) => {
    setSearchText(value);
    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => commitQuery(value), SEARCH_DEBOUNCE_MS);
  };

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    commitQuery(searchText);
  };

  const resetFilters = () => {
    clearTimeout(debounceTimer.current);
    setSearchText('');
    setCommittedQuery('');
    setSearchParams(serializeFilters(clearNarrowingFilters(filters)), FILTER_NAVIGATE_OPTIONS);
  };

  const scrollToFilters = () => {
    const target = filtersRef.current;
    if (!target) return;
    target.scrollIntoView?.({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    target.focus({ preventScroll: true });
  };

  const sort = filters.sort ?? 'soonest';
  const nextSort = sort === 'soonest' ? 'newest' : 'soonest';

  return (
    <PageContainer>
      <ExploreHero />
      <QuickActions onFindMeetings={scrollToFilters} />

      <div
        ref={filtersRef}
        tabIndex={-1}
        aria-label="모임 필터"
        role="region"
        className="scroll-mt-4 border-b border-border focus-visible:outline-none"
      >
        <DateStrip days={days} selected={filters.date} onSelect={(date) => applyFilters({ date })} />
        <div className="flex items-center gap-3 pt-1.75 pb-3.75 md:py-5.25">
          <div aria-hidden="true" className="hidden shrink-0 basis-filter-label text-md font-bold text-ink md:block">
            게임 유형
          </div>
          <CategoryChips
            categories={CATEGORIES}
            selected={filters.category}
            onSelect={(category) => applyFilters({ category })}
            recruitingOnly={Boolean(filters.recruiting)}
            onRecruitingChange={(recruiting) => applyFilters({ recruiting })}
          />
          <button
            type="button"
            onClick={() => applyFilters({ sort: nextSort })}
            aria-label={`정렬: ${SORT_LABEL[sort]}. 누르면 ${SORT_LABEL[nextSort]}으로 바뀝니다.`}
            className="hidden min-h-control-sm shrink-0 items-center gap-2 rounded-lg px-1.5 md:ml-1.5 text-sm font-bold whitespace-nowrap text-ink hover:bg-soft md:inline-flex"
            data-testid="sort-toggle"
          >
            정렬
            <span aria-hidden="true" className="text-border-strong">
              │
            </span>
            {SORT_LABEL[sort]}
            <Icon name="chevron-down" size="1em" />
          </button>
        </div>
      </div>

      <section aria-labelledby="explore-list-heading">
        <div className="pt-4.5 md:flex md:items-center md:justify-between md:gap-3 md:pt-4.25 md:pb-1.5">
          <div className="flex items-baseline gap-2">
            <h2
              id="explore-list-heading"
              className="text-2xl leading-tight font-heavy tracking-section text-ink md:text-3xl"
            >
              곧 열리는 모임.
            </h2>
            <span aria-live="polite" className="text-md font-semibold text-muted" data-testid="meeting-count">
              {list.status === 'success' ? `${list.total}개` : ''}
            </span>
          </div>
          <form role="search" aria-label="모임 검색" onSubmit={handleSearchSubmit} className="mt-3.5 md:mt-0 md:w-62.5">
            <TextField
              label="모임 검색"
              hideLabel
              aria-label="모임 검색"
              type="search"
              name="q"
              placeholder="게임이나 동네 검색"
              autoComplete="off"
              enterKeyHint="search"
              maxLength={MAX_QUERY_LENGTH}
              value={searchText}
              onChange={(event) => handleSearchChange(event.target.value)}
              leading={<Icon name="search" size="1.05rem" />}
            />
          </form>
        </div>

        {list.status === 'loading' ? <MeetingListSkeleton /> : null}

        {list.status === 'error' ? (
          <ErrorState title="모임 목록을 불러오지 못했어요." onRetry={list.retry} />
        ) : null}

        {list.status === 'success' && list.items.length === 0 ? (
          <EmptyState
            title="조건에 맞는 모임이 아직 없어요."
            description="다른 날짜를 선택하거나 직접 첫 모임을 만들어보세요."
            actions={
              <>
                {hasActiveFilters(filters) ? (
                  <Button variant="secondary" onClick={resetFilters}>
                    필터 초기화
                  </Button>
                ) : null}
                <ButtonLink to="/meetings/new">모임 만들기</ButtonLink>
              </>
            }
            footnote="관심 알림은 아직 준비 중이에요."
          />
        ) : null}

        {list.status === 'success' && list.items.length > 0 ? (
          <>
            <MeetingList meetings={list.items} now={now} aria-labelledby="explore-list-heading" />
            {list.hasMore || list.loadMoreFailed ? (
              <div className="mt-6 flex flex-col items-center gap-2">
                {list.loadMoreFailed ? (
                  <p role="alert" className="text-sm font-semibold text-danger">
                    모임을 더 불러오지 못했어요. 다시 시도해 주세요.
                  </p>
                ) : null}
                <Button variant="secondary" onClick={list.loadMore} loading={list.loadingMore} loadingLabel="불러오는 중">
                  모임 더 보기
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
      </section>

      <ExploreAsides />
    </PageContainer>
  );
}
