import type { MeetingFilters } from '../data/types';
import { isCategoryId } from '../domain/categories';
import { isRegionCode } from '../domain/regions';
import { isValidDateKey } from './date';

/**
 * 탐색 필터 <-> URL 쿼리 문자열.
 * - 공유·새로고침 시 같은 화면이 나오도록 URL을 단일 출처로 사용한다.
 * - 잘못된 값은 오류 없이 무시한다.
 * - 기본값(정렬 soonest, 모집 중 여부 false)은 URL에 쓰지 않는다.
 */

export const FILTER_PARAM_KEYS = ['date', 'category', 'region', 'q', 'recruiting', 'sort'] as const;

/** 검색어 최대 길이. 서버 부하와 URL 길이를 제한한다. */
export const MAX_QUERY_LENGTH = 50;

type SearchParamsInput = URLSearchParams | string | Record<string, string>;

function toSearchParams(input: SearchParamsInput): URLSearchParams {
  return input instanceof URLSearchParams ? input : new URLSearchParams(input);
}

/** 공백 정리 + 길이 제한. 빈 문자열이면 undefined */
export function normalizeQuery(value: string | null | undefined): string | undefined {
  if (value == null) return undefined;
  const normalized = value.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH).trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function parseFilters(input: SearchParamsInput): MeetingFilters {
  const params = toSearchParams(input);
  const filters: MeetingFilters = {};

  const date = params.get('date');
  if (isValidDateKey(date)) filters.date = date;

  const category = params.get('category');
  if (isCategoryId(category)) filters.category = category;

  const region = params.get('region');
  if (isRegionCode(region)) filters.region = region;

  const q = normalizeQuery(params.get('q'));
  if (q) filters.q = q;

  if (params.get('recruiting') === '1') filters.recruiting = true;

  if (params.get('sort') === 'newest') filters.sort = 'newest';

  return filters;
}

/** 필터를 정규화해 URLSearchParams로. 키 순서가 고정되어 같은 필터는 항상 같은 문자열이 된다. */
export function serializeFilters(filters: MeetingFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.date && isValidDateKey(filters.date)) params.set('date', filters.date);
  if (filters.category && isCategoryId(filters.category)) params.set('category', filters.category);
  if (filters.region && isRegionCode(filters.region)) params.set('region', filters.region);
  const q = normalizeQuery(filters.q);
  if (q) params.set('q', q);
  if (filters.recruiting) params.set('recruiting', '1');
  if (filters.sort === 'newest') params.set('sort', 'newest');
  return params;
}

/** 필터 객체의 안정적인 키(캐시·의존성 비교용). venueId(공간 상세용, URL에 쓰지 않음)도 포함한다 */
export function filtersKey(filters: MeetingFilters): string {
  const params = serializeFilters(filters);
  if (filters.venueId) params.set('venue', filters.venueId);
  return params.toString();
}

/** 정렬을 제외한 '결과를 좁히는' 필터가 하나라도 있는지 */
export function hasActiveFilters(filters: MeetingFilters): boolean {
  return Boolean(filters.date || filters.category || filters.region || filters.q || filters.recruiting);
}

/** 필터를 변경한 새 객체. undefined/false 값은 해당 필터를 제거한다. */
export function updateFilters(filters: MeetingFilters, patch: Partial<MeetingFilters>): MeetingFilters {
  const next: MeetingFilters = { ...filters, ...patch };
  for (const key of Object.keys(next) as (keyof MeetingFilters)[]) {
    if (next[key] === undefined || next[key] === false) delete next[key];
  }
  if (next.sort === 'soonest') delete next.sort;
  return next;
}

/** 정렬은 유지하고 결과를 좁히는 필터만 초기화 */
export function clearNarrowingFilters(filters: MeetingFilters): MeetingFilters {
  return filters.sort ? { sort: filters.sort } : {};
}
