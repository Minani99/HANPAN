import type { Category, CategoryId } from '../data/types';

/**
 * 게임 유형(카테고리) 기준값. id·이름·정렬값은 DB 기준 데이터(supabase/migrations/20261124000400_reference_data.sql)와 같다.
 * 추후 DB `categories` 테이블에서 내려오지만, 화면이 즉시 그려질 수 있도록 상수와 정렬 순서를 함께 둔다.
 */
export const CATEGORIES: readonly Category[] = [
  { id: 'party', name: '파티·캐주얼', sortOrder: 10 },
  { id: 'deduction', name: '추리·마피아', sortOrder: 20 },
  { id: 'strategy', name: '전략', sortOrder: 30 },
  { id: 'murder_mystery', name: '머더미스터리', sortOrder: 40 },
  { id: 'mahjong_etc', name: '마작·기타', sortOrder: 50 },
  { id: 'holdem_social', name: '홀덤(비금전)', sortOrder: 60 },
];

export const CATEGORY_IDS: readonly CategoryId[] = CATEGORIES.map((category) => category.id);

const CATEGORY_NAME = new Map<CategoryId, string>(CATEGORIES.map((c) => [c.id, c.name]));

export function isCategoryId(value: unknown): value is CategoryId {
  return typeof value === 'string' && CATEGORY_NAME.has(value as CategoryId);
}

export function getCategoryName(id: CategoryId): string {
  return CATEGORY_NAME.get(id) ?? id;
}

export function sortCategories(categories: readonly Category[]): Category[] {
  return [...categories].sort((a, b) => a.sortOrder - b.sortOrder);
}
