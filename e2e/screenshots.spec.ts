import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { loginAs, resetMockData, waitForPage, ZOOM_200_CSS } from './helpers';
import { VIEWPORTS } from './viewports';

/**
 * 시각 검수용 스크린샷 (테스트가 아니라 캡처 스크립트). `npm run screenshots`
 * - docs/screenshots/phase1/home-{width}.png : 구현 화면 (e2e 모드 mock 데이터)
 * - docs/screenshots/reference/lab-{width}.png : 비교용 v3 시안 (상단 Design Lab 바 숨김)
 * - docs/screenshots/phase1/{detail|create}-{390|1280}.png, my-meetings-390.png, participants-1280.png, login-390.png
 *   : 상세(비로그인)·모임 만들기·내 모임·참가자 관리·로그인 (e2e 모드 mock 데이터, 개발용 테스트 계정)
 * - docs/screenshots/phase4/{venues-390|venues-1280|venue-detail-390|admin-1280|policy-390}.png
 *   : 공간 목록·상세, 관리자 신고 탭(개발용 관리자 계정), 정책(운영정책 초안)
 * - docs/screenshots/phase5/*-text200.png : 글자 200%(루트 글자 32px, e2e/helpers.ts ZOOM_200_CSS) 대표 화면
 *   — 홈·상세(390), 모임 만들기·공간 목록·관리자(1280). 가로 넘침 검사는 e2e/a11y.spec.ts
 * 고정 요소(하단 내비)가 실제 위치에 찍히도록 뷰포트 높이를 문서 높이에 맞춘 뒤 캡처한다.
 */

const ROOT = resolve(import.meta.dirname, '..');
const LAB_URL = pathToFileURL(resolve(ROOT, 'hanpan_v3_design_lab.html')).href;

async function captureFullHeight(page: Page, width: number, path: string) {
  await page.evaluate(() => document.fonts.ready);
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width, height });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path, animations: 'disabled' });
}

test.describe.configure({ mode: 'parallel' });

for (const viewport of VIEWPORTS) {
  test(`home ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.getByTestId('meeting-row').first()).toBeVisible();
    await captureFullHeight(page, viewport.width, resolve(ROOT, `docs/screenshots/phase1/home-${viewport.width}.png`));
  });

  test(`reference lab ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(LAB_URL);
    await page.addStyleTag({ content: '.lab-bar{display:none !important}' });
    await expect(page.locator('.event-row').first()).toBeVisible();
    await captureFullHeight(page, viewport.width, resolve(ROOT, `docs/screenshots/reference/lab-${viewport.width}.png`));
  });
}

const OUT = (name: string, phase = 'phase1') => resolve(ROOT, `docs/screenshots/${phase}/${name}.png`);

interface PageShot {
  name: string;
  /** 저장 폴더(docs/screenshots/<phase>). 기본 phase1 */
  phase?: string;
  width: number;
  /** 로그인할 테스트 계정(없으면 비로그인) */
  as?: string;
  path: string;
  /** 글자 200%로 찍는다 */
  textZoom?: boolean;
}

const PAGE_SHOTS: readonly PageShot[] = [
  { name: 'detail-390', width: 390, path: '/meetings/seed-meeting-06' },
  { name: 'detail-1280', width: 1280, path: '/meetings/seed-meeting-06' },
  { name: 'create-390', width: 390, as: '예시사용자B', path: '/meetings/new' },
  { name: 'create-1280', width: 1280, as: '예시사용자B', path: '/meetings/new' },
  { name: 'my-meetings-390', width: 390, as: '예시사용자A', path: '/my/meetings' },
  { name: 'participants-1280', width: 1280, as: '예시사용자A', path: '/meetings/seed-meeting-13/participants' },
  { name: 'login-390', width: 390, path: '/login' },
  { name: 'venues-390', phase: 'phase4', width: 390, path: '/venues' },
  { name: 'venues-1280', phase: 'phase4', width: 1280, path: '/venues' },
  { name: 'venue-detail-390', phase: 'phase4', width: 390, path: '/venues/seed-venue-01' },
  { name: 'admin-1280', phase: 'phase4', width: 1280, as: '예시관리계정', path: '/admin' },
  { name: 'policy-390', phase: 'phase4', width: 390, path: '/policies/operations' },
  { name: 'home-390-text200', phase: 'phase5', width: 390, path: '/', textZoom: true },
  { name: 'detail-390-text200', phase: 'phase5', width: 390, path: '/meetings/seed-meeting-07', textZoom: true },
  { name: 'create-1280-text200', phase: 'phase5', width: 1280, as: '예시사용자B', path: '/meetings/new', textZoom: true },
  { name: 'venues-1280-text200', phase: 'phase5', width: 1280, path: '/venues', textZoom: true },
  { name: 'admin-1280-text200', phase: 'phase5', width: 1280, as: '예시관리계정', path: '/admin', textZoom: true },
];

for (const shot of PAGE_SHOTS) {
  test(`page ${shot.name}`, async ({ page }) => {
    await page.setViewportSize({ width: shot.width, height: 900 });
    await resetMockData(page);
    if (shot.as) {
      await page.goto('/login');
      await loginAs(page, shot.as);
    }
    await page.goto(shot.path);
    if (shot.textZoom) await page.addStyleTag({ content: ZOOM_200_CSS });
    // 캡처 29장이 병렬로 돌면 개발 서버가 lazy 청크를 처음 변환하는 동안 5초를 넘길 때가 있어 넉넉히 기다린다(검사가 아니라 캡처)
    await waitForPage(page, 20_000);
    // 목록 화면은 스켈레톤이 아니라 불러온 행을 찍는다(이전 my-meetings-390은 로딩 중에 찍힌 적이 있다)
    if (shot.path === '/' || shot.path === '/my/meetings') await expect(page.getByTestId('meeting-row').first()).toBeVisible();
    if (shot.path === '/login') await expect(page.getByTestId('dev-account').first()).toBeVisible();
    if (shot.path === '/venues') await expect(page.getByTestId('venue-row').first()).toBeVisible();
    if (shot.path.startsWith('/venues/')) await expect(page.getByTestId('meeting-row').first()).toBeVisible();
    if (shot.path === '/admin') await expect(page.getByTestId('admin-report').first()).toBeVisible();
    await captureFullHeight(page, shot.width, OUT(shot.name, shot.phase));
  });
}
