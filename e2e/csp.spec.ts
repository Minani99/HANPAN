import { expect, test, type Page, type Response } from '@playwright/test';
import { buildCsp } from '../scripts/lib/security-headers.mjs';
import { loginAs, logout, resetMockData, waitForPage } from './helpers';

/**
 * CSP 스모크 테스트 — `npm run test:csp`(playwright.csp.config.ts). 일반 `npm run test:e2e`에는 포함되지 않는다.
 * 빌드 결과 + 생성된 _headers(Cloudflare Pages 흉내)로 주요 화면을 돌며 CSP 위반이 0건인지 확인한다.
 * 위반 감지: securitypolicyviolation 이벤트(문서마다 init script로 등록) + 콘솔의 "Refused to …" 문구.
 * 대조군 테스트가 "막혀야 할 것은 막히고 감지된다"를 먼저 보여 준다(감지 장치가 고장 나 0건이 되는 것을 막음).
 */

const FAKE_SUPABASE_ORIGIN = 'https://example-ref.supabase.co';
const CSP_VIOLATION_MARK = '[csp-violation]';

interface Watch {
  violations: string[];
  pageErrors: string[];
}

async function watchCsp(page: Page): Promise<Watch> {
  const watch: Watch = { violations: [], pageErrors: [] };
  await page.addInitScript((mark) => {
    document.addEventListener('securitypolicyviolation', (event) => {
      console.error(
        `${mark} ${JSON.stringify({
          directive: event.effectiveDirective,
          blocked: event.blockedURI,
          source: event.sourceFile,
          line: event.lineNumber,
          sample: event.sample,
        })}`,
      );
    });
  }, CSP_VIOLATION_MARK);
  page.on('console', (message) => {
    const text = message.text();
    if (text.startsWith(CSP_VIOLATION_MARK) || /Refused to|Content Security Policy/i.test(text)) {
      watch.violations.push(`${new URL(page.url()).pathname} :: ${text}`);
    }
  });
  page.on('pageerror', (error) => watch.pageErrors.push(`${page.url()} :: ${error.message}`));
  return watch;
}

function expectSecurityHeaders(response: Response | null, supabaseOrigin: string | null) {
  expect(response, '문서 응답이 있어야 한다').not.toBeNull();
  const headers = response!.headers();
  expect(headers['content-security-policy']).toBe(buildCsp(supabaseOrigin));
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['cross-origin-opener-policy']).toBe('same-origin');
  expect(headers['strict-transport-security']).toBe('max-age=31536000');
  expect(headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=(), payment=(), usb=()');
}

/** 화면 이동 + 보안 헤더 확인 + 본문 제목 대기 */
async function visit(page: Page, path: string, supabaseOrigin: string | null = null) {
  const response = await page.goto(path);
  expectSecurityHeaders(response, supabaseOrigin);
  await waitForPage(page);
}

function expectClean(watch: Watch) {
  expect(watch.violations, 'CSP 위반이 없어야 한다').toEqual([]);
  expect(watch.pageErrors, '페이지 오류가 없어야 한다').toEqual([]);
}

test.describe('mock 빌드(--mode e2e)', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockData(page);
  });

  test('대조군: 헤더가 붙고, React style prop은 적용되며, 인라인 script·style 속성은 막히고 감지된다 @mock', async ({ page }) => {
    const watch = await watchCsp(page);
    const fontResponses: string[] = [];
    page.on('response', (response) => {
      if (response.url().startsWith('https://cdn.jsdelivr.net/')) fontResponses.push(`${response.status()} ${response.url()}`);
    });
    await visit(page, '/');
    await expect(page.getByTestId('meeting-row').first()).toBeVisible();

    // SUIT 글꼴(CSS + woff2)이 경로를 좁힌 style-src·font-src 안에서 실제로 받아진다.
    // 글꼴 CDN에 접속할 수 없는 환경이면 이 확인만 건너뛴다(위반 0건 확인은 그대로).
    const fontStatus = await page.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts].filter((font) => font.family.includes('SUIT')).map((font) => font.status);
    });
    if (fontResponses.length === 0) {
      test.info().annotations.push({ type: '미확인', description: '글꼴 CDN 응답 없음(오프라인?) — font-src 실제 로드 확인 못 함' });
    } else {
      expect(fontResponses.every((line) => line.startsWith('200 ')), fontResponses.join('\n')).toBe(true);
      expect(fontResponses.some((line) => line.includes('/gh/sun-typeface/SUIT@2/') && line.endsWith('.woff2'))).toBe(true);
      expect(fontStatus).toContain('loaded');
    }

    // React의 style prop(아이콘 크기)은 CSSOM으로 들어가므로 style-src에 막히지 않는다.
    const icon = page.getByTestId('region-button').locator('svg').first();
    expect(await icon.evaluate((element) => (element as SVGElement).style.width)).toBe('1.1em');
    expect((await icon.boundingBox())?.width ?? 0).toBeGreaterThan(0);
    expectClean(watch);

    // 해시가 붙은 /assets/* 파일은 오래 캐시한다.
    const scriptSrc = await page.locator('script[type="module"][src^="/assets/"]').first().getAttribute('src');
    expect(scriptSrc).toBeTruthy();
    const asset = await page.request.get(scriptSrc!);
    expect(asset.headers()['cache-control']).toBe('public, max-age=31536000, immutable');

    // 막혀야 하는 것: 인라인 script, style 속성 문자열
    const result = await page.evaluate(() => {
      const script = document.createElement('script');
      script.textContent = 'window.__HANPAN_INLINE_RAN__ = true';
      document.head.append(script);
      const probe = document.createElement('div');
      probe.setAttribute('style', 'width: 123px');
      document.body.append(probe);
      const width = getComputedStyle(probe).width;
      probe.remove();
      return { inlineRan: (window as unknown as { __HANPAN_INLINE_RAN__?: boolean }).__HANPAN_INLINE_RAN__ === true, width };
    });
    expect(result.inlineRan).toBe(false);
    expect(result.width).not.toBe('123px');
    await expect.poll(() => watch.violations.filter((v) => v.includes(CSP_VIOLATION_MARK)).length).toBeGreaterThanOrEqual(2);
    expect(watch.violations.some((v) => v.includes('script-src'))).toBe(true);
    expect(watch.violations.some((v) => v.includes('style-src'))).toBe(true);
  });

  test('비로그인: 홈·탐색 필터·지역 선택·상세·공간 목록/상세·정책·로그인·404 @mock', async ({ page }) => {
    const watch = await watchCsp(page);
    await visit(page, '/');
    await expect(page.getByTestId('meeting-row').first()).toBeVisible();
    await page.getByRole('button', { name: '전략', exact: true }).click();
    await page.getByRole('button', { name: '모집 중만' }).click();
    await page.getByRole('searchbox', { name: '모임 검색' }).fill('카탄');
    await expect(page).toHaveURL(/q=/);
    await page.getByTestId('region-button').click();
    await expect(page.getByRole('dialog', { name: '지역 선택' })).toBeVisible();
    await page.keyboard.press('Escape');

    await visit(page, '/meetings');
    await visit(page, '/meetings/seed-meeting-01');
    await expect(page.getByTestId('detail-cta')).toBeVisible();
    await visit(page, '/venues');
    await expect(page.getByTestId('venue-row').first()).toBeVisible();
    await visit(page, '/venues/seed-venue-01');
    for (const slug of ['terms', 'privacy', 'operations']) await visit(page, `/policies/${slug}`);
    await visit(page, '/login');
    await expect(page.getByTestId('dev-account').first()).toBeVisible();
    await visit(page, '/no-such-page');
    await expect(page.getByRole('heading', { name: '페이지를 찾을 수 없어요' })).toBeVisible();
    expectClean(watch);
  });

  test('로그인: 신청 대화상자·모임 만들기(검증·생성)·내 모임·참가자 관리·프로필 저장 @mock', async ({ page }) => {
    const watch = await watchCsp(page);
    await visit(page, '/login');
    await loginAs(page, '예시사용자B');

    await visit(page, '/meetings/seed-meeting-05');
    await page.getByRole('button', { name: '참가 신청하기' }).click();
    const dialog = page.getByRole('dialog', { name: '참가 신청' });
    await dialog.getByLabel('모임장에게 남길 말 (선택)').fill('CSP 확인');
    await dialog.getByRole('button', { name: '신청하기' }).click();
    await expect(page.getByTestId('cta-status')).toContainText('참가 확정');

    // 모임 만들기: 빈 폼 제출(Zod 검증 오류) → 값 입력 후 생성
    await visit(page, '/meetings/new');
    await page.getByRole('button', { name: '모임 만들기' }).click();
    await expect(page.getByLabel('모임 제목')).toHaveAttribute('aria-invalid', 'true');
    await page.locator('label').filter({ hasText: /^전략$/ }).click();
    await page.getByLabel('모임 제목').fill('CSP 확인용 모임');
    await page.getByLabel('시작 시간').selectOption('20:00');
    await page.getByLabel('권역').selectOption('dunsan_tanbang');
    await page.getByRole('button', { name: '모임 만들기' }).click();
    await expect(page).toHaveURL(/\/meetings\/mock-meeting-\d+$/);

    await visit(page, '/my/meetings');
    await visit(page, '/profile');
    await page.getByLabel('소개 (선택)').fill('CSP 확인 중');
    await page.getByRole('button', { name: '저장하기' }).click();
    await expect(page.getByRole('status').filter({ hasText: '내 정보를 저장했어요.' })).toBeVisible();

    await logout(page);
    await loginAs(page, '예시사용자A');
    await visit(page, '/meetings/seed-meeting-13/participants');
    await expect(page.getByTestId('participants-counts')).toBeVisible();
    expectClean(watch);
  });

  test('관리자: 탭 5개(마우스·화살표 키)·공간 등록 폼 검증 @mock', async ({ page }) => {
    const watch = await watchCsp(page);
    await visit(page, '/login');
    await loginAs(page, '예시관리계정');
    await visit(page, '/admin');
    await expect(page.getByTestId('admin-report').first()).toBeVisible();
    for (const tab of ['모임', '사용자', '공간', '카테고리', '신고']) {
      await page.getByRole('tab', { name: tab }).click();
      await expect(page.getByRole('tabpanel').getByRole('list').first()).toBeVisible();
    }
    await page.getByRole('tab', { name: '신고' }).press('ArrowRight');
    await expect(page.getByRole('tab', { name: '모임' })).toHaveAttribute('aria-selected', 'true');

    await visit(page, '/admin?tab=venues');
    await page.getByRole('button', { name: '새 공간 등록' }).click();
    await page.getByTestId('venue-save').click();
    await expect(page.getByLabel('공간 이름')).toHaveAttribute('aria-invalid', 'true');
    expectClean(watch);
  });
});

test.describe('운영 빌드 + 가짜 Supabase env', () => {
  test('connect-src에 Supabase origin, 요청이 CSP에 막히지 않고 Google 로그인은 전체 페이지 이동 @supabase', async ({ page }) => {
    const watch = await watchCsp(page);
    const supabaseRequests: string[] = [];
    // 외부로 나가지 않도록 가짜 Supabase 요청은 모두 여기서 응답한다(CORS 헤더 포함).
    await page.route(`${FAKE_SUPABASE_ORIGIN}/**`, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      supabaseRequests.push(`${request.method()} ${url.pathname}`);
      const cors = {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
      };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (url.pathname === '/auth/v1/authorize') {
        return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>가짜 공급자</title><h1>가짜 OAuth</h1>' });
      }
      let body: unknown = [];
      if (url.pathname.endsWith('/rpc/list_public_meetings')) body = { items: [], total: 0 };
      if (url.pathname.endsWith('/rpc/get_meeting')) body = null;
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    });

    await visit(page, '/', FAKE_SUPABASE_ORIGIN);
    await expect(page.getByTestId('dev-data-banner')).toHaveCount(0);
    await expect.poll(() => supabaseRequests.some((r) => r.endsWith('/rest/v1/rpc/list_public_meetings'))).toBe(true);
    await expect(page.getByText('조건에 맞는 모임이 아직 없어요.')).toBeVisible();

    await visit(page, '/venues', FAKE_SUPABASE_ORIGIN);
    await visit(page, '/meetings/00000000-0000-4000-8000-000000000000', FAKE_SUPABASE_ORIGIN);
    await visit(page, '/policies/privacy', FAKE_SUPABASE_ORIGIN);
    await visit(page, '/login', FAKE_SUPABASE_ORIGIN);
    expectClean(watch);

    // OAuth는 팝업이 아니라 전체 페이지 이동(COOP same-origin과 무관). 가짜 공급자 화면으로 이동하는지만 본다.
    await page.getByRole('button', { name: 'Google로 계속하기' }).click();
    await page.waitForURL((url) => url.origin === FAKE_SUPABASE_ORIGIN && url.pathname === '/auth/v1/authorize');
    expect(new URL(page.url()).searchParams.get('provider')).toBe('google');
    expect(new URL(page.url()).searchParams.get('redirect_to')).toBe('http://127.0.0.1:4180/auth/callback');
    expectClean(watch);
  });
});
