import { describe, expect, it } from 'vitest';
import {
  MAX_QUERY_LENGTH,
  clearNarrowingFilters,
  filtersKey,
  hasActiveFilters,
  normalizeQuery,
  parseFilters,
  serializeFilters,
  updateFilters,
} from './filters';

describe('lib/filters', () => {
  it('유효한 쿼리를 모두 파싱한다', () => {
    expect(
      parseFilters('date=2026-11-28&category=strategy&region=dunsan_tanbang&q=카탄&recruiting=1&sort=newest'),
    ).toEqual({
      date: '2026-11-28',
      category: 'strategy',
      region: 'dunsan_tanbang',
      q: '카탄',
      recruiting: true,
      sort: 'newest',
    });
  });

  it('잘못된 값은 조용히 무시한다', () => {
    expect(
      parseFilters('date=2026-02-30&category=poker&region=seoul&q=%20%20&recruiting=true&sort=oldest&foo=bar'),
    ).toEqual({});
    expect(parseFilters('date=11-28&recruiting=0&sort=soonest')).toEqual({});
  });

  it('검색어는 공백을 정리하고 길이를 제한한다', () => {
    expect(normalizeQuery('  둔산   카탄  ')).toBe('둔산 카탄');
    expect(normalizeQuery('   ')).toBeUndefined();
    expect(normalizeQuery(undefined)).toBeUndefined();
    const long = 'ㄱ'.repeat(MAX_QUERY_LENGTH + 20);
    expect(normalizeQuery(long)).toHaveLength(MAX_QUERY_LENGTH);
  });

  it('직렬화는 기본값을 생략하고 키 순서가 고정된다', () => {
    expect(serializeFilters({}).toString()).toBe('');
    expect(serializeFilters({ sort: 'soonest', recruiting: false }).toString()).toBe('');
    const a = serializeFilters({ sort: 'newest', q: '마피아', region: 'gung_bongmyeong', category: 'deduction' });
    const b = serializeFilters({ category: 'deduction', region: 'gung_bongmyeong', q: '마피아', sort: 'newest' });
    expect(a.toString()).toBe(b.toString());
    expect([...a.keys()]).toEqual(['category', 'region', 'q', 'sort']);
    expect(serializeFilters({ recruiting: true }).toString()).toBe('recruiting=1');
  });

  it('직렬화 → 파싱 왕복이 같은 필터를 만든다', () => {
    const filters = { date: '2026-12-01', category: 'party' as const, q: 'a&b=c 한글', recruiting: true };
    expect(parseFilters(serializeFilters(filters))).toEqual(filters);
  });

  it('직렬화 시에도 잘못된 값은 버린다', () => {
    // 타입을 우회해 들어온 값 방어
    const bogus = { date: 'yesterday', category: 'poker', region: 'seoul' } as unknown as Parameters<
      typeof serializeFilters
    >[0];
    expect(serializeFilters(bogus).toString()).toBe('');
  });

  it('updateFilters는 undefined/false/soonest를 제거한다', () => {
    const base = { category: 'party' as const, recruiting: true, sort: 'newest' as const };
    expect(updateFilters(base, { category: undefined, recruiting: false, sort: 'soonest' })).toEqual({});
    expect(updateFilters(base, { region: 'noeun_jijok' })).toEqual({ ...base, region: 'noeun_jijok' });
  });

  it('hasActiveFilters / clearNarrowingFilters는 정렬을 필터로 보지 않는다', () => {
    expect(hasActiveFilters({ sort: 'newest' })).toBe(false);
    expect(hasActiveFilters({ recruiting: true })).toBe(true);
    expect(clearNarrowingFilters({ q: 'x', region: 'etc_daejeon', sort: 'newest' })).toEqual({ sort: 'newest' });
    expect(clearNarrowingFilters({ q: 'x' })).toEqual({});
  });

  it('filtersKey는 같은 필터에 같은 키', () => {
    expect(filtersKey({ q: '카탄', category: 'strategy' })).toBe(filtersKey({ category: 'strategy', q: ' 카탄 ' }));
  });
});
