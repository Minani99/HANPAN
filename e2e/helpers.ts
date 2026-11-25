import { expect, type Locator, type Page } from '@playwright/test';

export type Box = { x: number; y: number; width: number; height: number };

export function overlaps(a: Box, b: Box): boolean {
  return !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
}

export async function box(locator: Locator): Promise<Box> {
  const value = await locator.boundingBox();
  if (!value) throw new Error('요소의 bounding box를 구할 수 없습니다.');
  return value;
}

/** mock 저장소 키 (src/data/mock/adapter.ts의 MOCK_STORAGE_KEY와 같아야 한다) */
export const MOCK_STORAGE_KEY = 'hanpan.mock.v2';

/**
 * mock 데이터 초기화. Playwright는 테스트마다 새 브라우저 컨텍스트를 만들어 localStorage가 이미 비어 있지만,
 * 명시적으로 한 번 더 비운다. 앱을 띄우지 않도록 같은 출처의 정적 파일에서 실행한다.
 * (addInitScript는 새로고침 때마다 다시 실행되어 '새로고침 후 유지' 확인을 깨뜨리므로 쓰지 않는다)
 */
export async function resetMockData(page: Page) {
  await page.goto('/favicon.svg');
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
}

/** 화면 제목(h1)이 보일 때까지 기다린다. timeout을 주지 않으면 expect 기본값(5초) */
export async function waitForPage(page: Page, timeout?: number) {
  await expect(page.locator('main h1').first()).toBeVisible({ timeout });
}

/** /login의 개발용 테스트 계정으로 로그인하고 로그인 화면을 벗어날 때까지 기다린다 */
export async function loginAs(page: Page, nickname: string) {
  if (!new URL(page.url(), 'http://x').pathname.startsWith('/login')) await page.goto('/login');
  await page.getByTestId('dev-account').filter({ hasText: nickname }).click();
  await page.waitForURL((url) => url.pathname !== '/login');
}

export async function logout(page: Page) {
  await page.goto('/profile');
  await page.getByRole('button', { name: '로그아웃' }).click();
  await page.waitForURL((url) => url.pathname === '/');
}

export async function expectNoHorizontalOverflow(page: Page, label: string) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `${label}: scrollWidth ${scrollWidth} > clientWidth ${clientWidth}`).toBeLessThanOrEqual(clientWidth);
}

/**
 * 글자 200%: 루트 글자 크기 16px → 32px. 글자·간격 토큰이 rem이라 브라우저 글자 크기 설정을 키운 것과 같다(고정 px 치수는 그대로).
 * 화면을 연 뒤 page.addStyleTag({ content: ZOOM_200_CSS })로 넣는다(e2e/a11y.spec.ts, e2e/screenshots.spec.ts).
 */
export const ZOOM_200_CSS = 'html { font-size: 32px !important; }';
