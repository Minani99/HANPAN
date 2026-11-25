import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { filtersKey as toFiltersKey, parseFilters } from '../lib/filters';
import { MEETING_PAGE_SIZE } from './adapter';
import { useDataAdapter } from './index';
import type { Meeting, MeetingFilters } from './types';

type LoadedState =
  | { key: string; status: 'success'; items: Meeting[]; total: number }
  | { key: string; status: 'error'; error: unknown };

type MoreState = { key: string; status: 'loading' | 'error' };

export interface MeetingListResult {
  status: 'loading' | 'error' | 'success';
  items: Meeting[];
  total: number;
  error: unknown;
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreFailed: boolean;
  /** 다음 페이지를 이어 붙인다. 진행 중이면 무시한다. */
  loadMore: () => Promise<void>;
  /** 첫 페이지부터 다시 요청 */
  retry: () => void;
}

function mergeById(current: Meeting[], next: Meeting[]): Meeting[] {
  const seen = new Set(current.map((meeting) => meeting.id));
  return [...current, ...next.filter((meeting) => !seen.has(meeting.id))];
}

/**
 * 탐색 목록 로딩 상태 관리.
 * 필터나 로그인 사용자(useAuth().userKey)가 바뀌면 이전 응답은 버리고(경쟁 상태 방지) 첫 페이지부터 다시 불러온다.
 * 공개 목록도 RLS가 적용되므로(관리자는 비공개 공간 이름이 보이는 등) 사용자가 바뀌면 다시 요청한다.
 * 로딩 여부는 '현재 요청 키와 마지막 응답 키가 다른가'로 계산해 effect 안에서 동기 setState를 하지 않는다.
 */
export function useMeetingList(filters: MeetingFilters, pageSize = MEETING_PAGE_SIZE): MeetingListResult {
  const adapter = useDataAdapter();
  const { userKey } = useAuth();
  const filterKey = toFiltersKey(filters);
  const stableFilters = useMemo(() => {
    const parsed = parseFilters(filterKey);
    const venueId = new URLSearchParams(filterKey).get('venue');
    return venueId ? { ...parsed, venueId } : parsed;
  }, [filterKey]);

  const [attempt, setAttempt] = useState(0);
  const requestKey = `${filterKey}|${userKey}#${attempt}`;
  const [loaded, setLoaded] = useState<LoadedState | null>(null);
  const [more, setMore] = useState<MoreState | null>(null);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    let active = true;
    adapter.listMeetings(stableFilters, { limit: pageSize, offset: 0 }).then(
      (page) => {
        if (active) setLoaded({ key: requestKey, status: 'success', items: page.items, total: page.total });
      },
      (error: unknown) => {
        if (active) setLoaded({ key: requestKey, status: 'error', error });
      },
    );
    return () => {
      active = false;
    };
  }, [adapter, stableFilters, pageSize, requestKey]);

  const current = loaded && loaded.key === requestKey ? loaded : null;
  const success = current?.status === 'success' ? current : null;

  const loadMore = useCallback(async () => {
    if (!success || loadingMoreRef.current) return;
    if (success.items.length >= success.total) return;
    loadingMoreRef.current = true;
    const key = success.key;
    setMore({ key, status: 'loading' });
    try {
      const page = await adapter.listMeetings(stableFilters, { limit: pageSize, offset: success.items.length });
      setLoaded((prev) =>
        prev && prev.key === key && prev.status === 'success'
          ? { ...prev, items: mergeById(prev.items, page.items), total: page.total }
          : prev,
      );
      setMore((prev) => (prev?.key === key ? null : prev));
    } catch {
      setMore((prev) => (prev?.key === key ? { key, status: 'error' } : prev));
    } finally {
      loadingMoreRef.current = false;
    }
  }, [adapter, stableFilters, pageSize, success]);

  const retry = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  const moreState = more?.key === requestKey ? more : null;
  const items = success?.items ?? [];
  const total = success?.total ?? 0;

  return {
    status: current ? current.status : 'loading',
    items,
    total,
    error: current?.status === 'error' ? current.error : null,
    hasMore: Boolean(success) && items.length < total,
    loadingMore: moreState?.status === 'loading',
    loadMoreFailed: moreState?.status === 'error',
    loadMore,
    retry,
  };
}
