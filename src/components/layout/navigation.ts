/** 헤더·하단 내비 공통 경로 판별 */

export const EXPLORE_PATHS = ['/', '/meetings'] as const;

export function isExplorePath(pathname: string): boolean {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return (EXPLORE_PATHS as readonly string[]).includes(normalized);
}

/** 모임 찾기 메뉴가 활성인 경로: 탐색 화면과 모임 상세(모임 만들기 제외) */
export function isExploreSection(pathname: string): boolean {
  if (isExplorePath(pathname)) return true;
  return pathname.startsWith('/meetings/') && !pathname.startsWith('/meetings/new');
}

export function isPathWithin(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}
