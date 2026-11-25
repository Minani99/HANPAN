import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { box, expectNoHorizontalOverflow, loginAs, logout, MOCK_STORAGE_KEY, resetMockData, waitForPage, ZOOM_200_CSS } from './helpers';

/**
 * Phase 5 접근성 점검(mock, Chromium). 결과는 "통과/실패/미실행"으로만 기록한다(docs/TEST_PLAN.md §3).
 * 1. axe 자동 점검: 390·1280px, CSP 스모크와 같은 화면 목록 — serious·critical 위반 0건.
 * 2. 키보드: 건너뛰기 링크, 헤더 Tab 순서·포커스 링, 지역 선택·신청 대화상자의 포커스 트랩·ESC·복귀, 관리자 탭 화살표 키.
 * 3. 글자 200%(루트 글자 32px): 390·1280px에서 가로 넘침 없음, 주요 버튼·입력이 화면 안에 보임.
 */

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const BLOCKING_IMPACTS = new Set(['serious', 'critical']);

/**
 * 디자인 결정(v3 토큰)에 걸려 고치지 않기로 한 위반만 요소 단위로 제외한다. 추가할 때는 이유와 문서 위치를 함께 적는다.
 * 2026-11-25 점검 기준 비어 있음 — color-contrast 위반 0건(axe는 테두리 같은 비텍스트 대비(WCAG 1.4.11)는 검사하지 않는다.
 * 입력·칩 테두리 #E5E8EB는 src/styles/contrast.test.ts의 '알려진 예외'와 docs/UI_SPEC.md §3.3-B).
 */
const DESIGN_EXCEPTIONS: ReadonlyArray<{ rule: string; selector: string; reason: string }> = [];

async function expectNoSeriousAxeViolations(page: Page, label: string) {
  let builder = new AxeBuilder({ page }).withTags(AXE_TAGS);
  for (const exception of DESIGN_EXCEPTIONS) builder = builder.exclude(exception.selector);
  const { violations } = await builder.analyze();
  const blocking = violations.filter((violation) => BLOCKING_IMPACTS.has(violation.impact ?? ''));
  const minor = violations.filter((violation) => !BLOCKING_IMPACTS.has(violation.impact ?? ''));
  for (const violation of minor) {
    test.info().annotations.push({ type: `axe ${violation.impact}`, description: `${label}: ${violation.id} (${violation.nodes.length})` });
  }
  const summary = blocking.map(
    (violation) =>
      `${violation.impact} ${violation.id}: ${violation.nodes
        .slice(0, 5)
        .map((node) => node.target.join(' '))
        .join(', ')}`,
  );
  expect(summary, `${label}: axe serious·critical 위반`).toEqual([]);
}

async function go(page: Page, path: string) {
  await page.goto(path);
  await waitForPage(page);
}

for (const width of [390, 1280] as const) {
  test.describe(`axe ${width}px`, () => {
    // 화면마다 axe 분석(수백 ms~수 초)을 하므로 기본 30초보다 길게 둔다
    test.describe.configure({ timeout: 90_000 });
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await resetMockData(page);
    });

    test('비로그인: 홈·탐색(필터)·지역 선택·상세·공간 목록/상세·정책·로그인·404', async ({ page }) => {
      await go(page, '/');
      await expect(page.getByTestId('meeting-row').first()).toBeVisible();
      await expectNoSeriousAxeViolations(page, '홈');
      await go(page, '/meetings?category=strategy&recruiting=1&region=dunsan_tanbang');
      await expectNoSeriousAxeViolations(page, '탐색(필터)');
      await page.getByTestId('region-button').click();
      await expect(page.getByRole('dialog', { name: '지역 선택' })).toBeVisible();
      await expectNoSeriousAxeViolations(page, '지역 선택 대화상자');
      await page.keyboard.press('Escape');
      await go(page, '/meetings/seed-meeting-01');
      await expectNoSeriousAxeViolations(page, '상세');
      await go(page, '/venues');
      await expect(page.getByTestId('venue-row').first()).toBeVisible();
      await expectNoSeriousAxeViolations(page, '공간 목록');
      await go(page, '/venues/seed-venue-01');
      await expectNoSeriousAxeViolations(page, '공간 상세');
      for (const slug of ['terms', 'privacy', 'operations']) {
        await go(page, `/policies/${slug}`);
        await expectNoSeriousAxeViolations(page, `정책 ${slug}`);
      }
      await go(page, '/login');
      await expectNoSeriousAxeViolations(page, '로그인');
      await go(page, '/no-such-page');
      await expectNoSeriousAxeViolations(page, '404');
    });

    test('로그인: 신청 대화상자·모임 만들기(오류 상태 포함)·프로필·내 모임·참가자 관리', async ({ page }) => {
      await go(page, '/login');
      await loginAs(page, '예시사용자B');
      await go(page, '/meetings/seed-meeting-05');
      await page.getByRole('button', { name: '참가 신청하기' }).click();
      await expect(page.getByRole('dialog', { name: '참가 신청' })).toBeVisible();
      await expectNoSeriousAxeViolations(page, '신청 대화상자');
      await go(page, '/meetings/new');
      await expectNoSeriousAxeViolations(page, '모임 만들기');
      await page.getByRole('button', { name: '모임 만들기' }).click();
      await expect(page.getByLabel('모임 제목')).toHaveAttribute('aria-invalid', 'true');
      await expectNoSeriousAxeViolations(page, '모임 만들기(오류)');
      await go(page, '/profile');
      await expectNoSeriousAxeViolations(page, '프로필');
      await logout(page);
      await loginAs(page, '예시사용자A');
      await go(page, '/my/meetings');
      await expectNoSeriousAxeViolations(page, '내 모임');
      await go(page, '/my/meetings?role=hosted');
      await expectNoSeriousAxeViolations(page, '내 모임(내가 연 모임)');
      await go(page, '/meetings/seed-meeting-13/participants');
      await expectNoSeriousAxeViolations(page, '참가자 관리');
    });

    test('관리자: 탭 5개·공간 등록 폼', async ({ page }) => {
      await go(page, '/login');
      await loginAs(page, '예시관리계정');
      for (const tab of ['', '?tab=meetings', '?tab=users', '?tab=venues', '?tab=categories']) {
        await go(page, `/admin${tab}`);
        await expect(page.getByRole('tabpanel').getByRole('list').first()).toBeVisible();
        await expectNoSeriousAxeViolations(page, `관리자${tab || ' 신고'}`);
      }
      await go(page, '/admin?tab=venues');
      await page.getByRole('button', { name: '새 공간 등록' }).click();
      await expect(page.getByTestId('venue-editor')).toBeVisible();
      await expectNoSeriousAxeViolations(page, '공간 등록 폼');
    });
  });
}

// ---------------------------------------------------------------------------
// axe moderate 정리 확인: region(랜드마크 밖 내용)·heading-order(제목 단계 건너뜀)
// Phase 5 검수에서 고친 화면 — 개발용 안내 띠·계정 상태 안내 띠(aside), 내 모임 행 제목(h2), 공간 등록 폼 제목(h2)
// ---------------------------------------------------------------------------

async function expectNoRuleViolations(page: Page, rules: string[], label: string) {
  const { violations } = await new AxeBuilder({ page }).withRules(rules).analyze();
  const found = violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`);
  expect(found, `${label}: ${rules.join('·')} 위반`).toEqual([]);
}

/** mock 저장소에서 닉네임으로 찾은 계정의 상태를 바꾸고 새로고침(관리자 화면 없이 계정 상태 화면을 만들기 위한 테스트 전용 조작) */
async function setMockAccountStatus(page: Page, nickname: string, status: 'active' | 'restricted' | 'deletion_requested') {
  await page.evaluate(
    ({ key, nickname, status }) => {
      const state = JSON.parse(window.localStorage.getItem(key) ?? 'null') as { db: { profiles: Array<{ nickname: string; status: string }> } };
      const profile = state.db.profiles.find((item) => item.nickname === nickname);
      if (!profile) throw new Error(`mock 계정 없음: ${nickname}`);
      profile.status = status;
      window.localStorage.setItem(key, JSON.stringify(state));
    },
    { key: MOCK_STORAGE_KEY, nickname, status },
  );
  await page.reload();
}

for (const width of [390, 1280] as const) {
  test(`${width}px region·heading-order 0건: 개발용 안내 띠·내 모임·공간 등록 폼·계정 상태 안내 띠`, async ({ page }) => {
    test.setTimeout(90_000);
    const rules = ['region', 'heading-order'];
    await page.setViewportSize({ width, height: 900 });
    await resetMockData(page);

    await go(page, '/');
    await expect(page.getByTestId('meeting-row').first()).toBeVisible();
    await expect(page.getByRole('complementary', { name: '개발 환경 안내' })).toContainText('개발용 예시 데이터입니다.');
    await expectNoRuleViolations(page, rules, '홈(개발용 안내 띠)');

    await go(page, '/login');
    await loginAs(page, '예시사용자A');
    for (const path of ['/my/meetings', '/my/meetings?role=hosted']) {
      await go(page, path);
      await expect(page.getByTestId('meeting-row').first()).toBeVisible();
      await expect(page.getByTestId('meeting-title').first()).toHaveJSProperty('tagName', 'H2');
      await expectNoRuleViolations(page, rules, path);
    }

    await logout(page);
    await loginAs(page, '예시관리계정');
    await go(page, '/admin?tab=venues');
    await page.getByRole('button', { name: '새 공간 등록' }).click();
    await expect(page.getByRole('heading', { level: 2, name: '새 공간 등록' })).toBeVisible();
    await expectNoRuleViolations(page, rules, '관리자 공간 등록 폼');

    // 이용 제한된 관리자: 계정 상태 안내 띠(aside) + 관리자 권한 없음(DB is_admin()과 같은 규칙 — 마이그레이션 9)
    await setMockAccountStatus(page, '예시관리계정', 'restricted');
    await go(page, '/admin');
    await expect(page.getByRole('heading', { level: 1, name: '접근 권한이 없어요.' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: '계정 상태 안내' })).toContainText('이용이 제한된 계정이에요.');
    await expectNoRuleViolations(page, rules, '이용 제한 계정(안내 띠)');
    await go(page, '/');
    await expectNoRuleViolations(page, rules, '이용 제한 계정 홈');
  });
}

// ---------------------------------------------------------------------------
// 키보드
// ---------------------------------------------------------------------------

async function activeElementInside(container: Locator): Promise<boolean> {
  return container.evaluate((element) => element.contains(document.activeElement));
}

/** 키보드 포커스 표시: 3px focus 색 실선(src/styles/index.css :focus-visible) */
async function expectFocusRing(locator: Locator, label: string) {
  await expect(locator, `${label}: 포커스`).toBeFocused();
  const outline = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: style.outlineWidth, color: style.outlineColor, visible: element.matches(':focus-visible') };
  });
  expect(outline, `${label}: 포커스 링`).toEqual({ style: 'solid', width: '3px', color: 'rgb(72, 106, 167)', visible: true });
}

test.describe('키보드', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockData(page);
  });

  test('건너뛰기 링크: 첫 Tab에 보이고, Enter로 본문(main)에 포커스, 다음 Tab은 본문 안', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await go(page, '/');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: '본문 바로가기' });
    await expectFocusRing(skip, '건너뛰기 링크');
    const skipBox = await box(skip);
    expect(skipBox.width).toBeGreaterThan(20);
    expect(skipBox.y).toBeGreaterThanOrEqual(0);
    expect(skipBox.y + skipBox.height).toBeLessThanOrEqual(800);
    await expect(skip).toHaveAttribute('href', '#main-content');

    await page.keyboard.press('Enter');
    await expect(page.locator('main#main-content')).toBeFocused();
    expect(new URL(page.url()).hash).toBe('');
    await page.keyboard.press('Tab');
    expect(await activeElementInside(page.locator('main'))).toBe(true);
  });

  test('건너뛰기 링크는 포커스 전에는 보이지 않는다(sr-only)', async ({ page }) => {
    await go(page, '/');
    const skip = page.getByRole('link', { name: '본문 바로가기' });
    const size = await skip.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    expect(size.width).toBeLessThanOrEqual(1);
    expect(size.height).toBeLessThanOrEqual(1);
  });

  test('1280px 헤더 Tab 순서와 포커스 링: 건너뛰기 → 로고 → 모임 찾기 → 공간 찾기 → 모임 만들기 → 지역 선택 → 로그인', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await go(page, '/');
    const header = page.getByRole('banner');
    const expected: Array<[string, Locator]> = [
      ['건너뛰기', page.getByRole('link', { name: '본문 바로가기' })],
      ['로고', header.getByRole('link', { name: 'HANPAN 홈' })],
      ['모임 찾기', header.getByRole('link', { name: '모임 찾기' })],
      ['공간 찾기', header.getByRole('link', { name: '공간 찾기' })],
      ['모임 만들기', header.getByRole('link', { name: '모임 만들기' })],
      ['지역 선택', header.getByTestId('region-button')],
      ['로그인', header.getByRole('link', { name: '로그인' })],
    ];
    for (const [label, locator] of expected) {
      await page.keyboard.press('Tab');
      await expectFocusRing(locator, label);
    }
    // 그다음은 본문(개발용 안내 띠에는 포커스할 요소가 없다)
    await page.keyboard.press('Tab');
    expect(await activeElementInside(page.locator('main'))).toBe(true);
  });

  test('390px 헤더 Tab 순서: 건너뛰기 → 로고 → 지역 선택 → 본문', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await go(page, '/');
    for (const [label, locator] of [
      ['건너뛰기', page.getByRole('link', { name: '본문 바로가기' })],
      ['로고', page.getByRole('banner').getByRole('link', { name: 'HANPAN 홈' })],
      ['지역 선택', page.getByTestId('region-button')],
    ] as const) {
      await page.keyboard.press('Tab');
      await expectFocusRing(locator, label);
    }
    await page.keyboard.press('Tab');
    expect(await activeElementInside(page.locator('main'))).toBe(true);
  });

  /** 대화상자 안에서 Tab·Shift+Tab이 순환하는지(밖으로 나가지 않음) */
  async function expectFocusTrapped(page: Page, dialog: Locator) {
    const count = await dialog.evaluate(
      (element) =>
        element.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ).length,
    );
    expect(count).toBeGreaterThan(1);
    for (let index = 0; index < count + 2; index += 1) {
      await page.keyboard.press('Tab');
      expect(await activeElementInside(dialog), `Tab ${index + 1}번째에도 대화상자 안`).toBe(true);
    }
    for (let index = 0; index < count + 2; index += 1) {
      await page.keyboard.press('Shift+Tab');
      expect(await activeElementInside(dialog), `Shift+Tab ${index + 1}번째에도 대화상자 안`).toBe(true);
    }
    // 처음 요소(제목 줄의 닫기 아이콘 버튼)에서 Shift+Tab → 마지막 요소, 마지막에서 Tab → 처음
    const closeButton = dialog.getByRole('button', { name: '닫기' }).first();
    await closeButton.focus();
    await page.keyboard.press('Shift+Tab');
    const lastIsFocused = await dialog.evaluate((element) => {
      const items = element.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      return document.activeElement === items[items.length - 1];
    });
    expect(lastIsFocused, '처음에서 Shift+Tab → 마지막').toBe(true);
    await page.keyboard.press('Tab');
    await expect(closeButton, '마지막에서 Tab → 처음(닫기)').toBeFocused();
  }

  test('지역 선택 대화상자: 키보드로 열기 → 포커스가 안에 갇힘·순환 → ESC로 닫힘 → 연 버튼으로 복귀', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await go(page, '/');
    const trigger = page.getByTestId('region-button');
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: '지역 선택' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog.getByRole('button', { name: '전체 지역' })).toBeFocused();
    await expectFocusTrapped(page, dialog);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('신청 대화상자: 키보드로 열기 → 포커스 트랩·순환 → ESC → 신청 버튼으로 복귀', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await go(page, '/login');
    await loginAs(page, '예시사용자B');
    await go(page, '/meetings/seed-meeting-05');
    const cta = page.getByRole('button', { name: '참가 신청하기' });
    await cta.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: '참가 신청' });
    await expect(dialog).toBeVisible();
    expect(await activeElementInside(dialog)).toBe(true);
    await expectFocusTrapped(page, dialog);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(cta).toBeFocused();
    // 신청하지 않았으므로 상태 그대로
    await expect(page.getByTestId('detail-cta-content')).not.toHaveAttribute('data-kind', 'confirmed');
  });

  test('관리자 탭: ←/→/Home/End로 이동·선택(roving tabindex), Tab은 패널로', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await go(page, '/login');
    await loginAs(page, '예시관리계정');
    await go(page, '/admin');
    const tab = (name: string) => page.getByRole('tab', { name });
    await tab('신고').focus();
    await expectFocusRing(tab('신고'), '신고 탭');
    await page.keyboard.press('ArrowRight');
    await expect(tab('모임')).toBeFocused();
    await expect(tab('모임')).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/\/admin\?tab=meetings$/);
    await page.keyboard.press('End');
    await expect(tab('카테고리')).toBeFocused();
    await expect(tab('카테고리')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(tab('신고')).toBeFocused(); // 끝에서 처음으로
    await page.keyboard.press('ArrowLeft');
    await expect(tab('카테고리')).toBeFocused(); // 처음에서 끝으로
    await page.keyboard.press('Home');
    await expect(tab('신고')).toBeFocused();
    // 선택된 탭만 Tab 정지점
    await expect(page.getByRole('tab').and(page.locator('[tabindex="0"]'))).toHaveCount(1);
    await page.keyboard.press('Tab');
    expect(await activeElementInside(page.getByRole('tabpanel'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 글자 200%
// ---------------------------------------------------------------------------

async function goZoomed(page: Page, path: string) {
  await page.goto(path);
  await page.addStyleTag({ content: ZOOM_200_CSS });
  await waitForPage(page);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('32px');
}

/** 요소가 보이고 가로로 화면 안에 있는지(세로는 스크롤로 닿으면 됨) */
async function expectWithinViewportWidth(page: Page, locator: Locator, label: string) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator, label).toBeVisible();
  const rect = await box(locator);
  const viewportWidth = page.viewportSize()?.width ?? 0;
  expect(rect.x, `${label}: 왼쪽이 잘림`).toBeGreaterThanOrEqual(-0.5);
  expect(rect.x + rect.width, `${label}: 오른쪽이 잘림`).toBeLessThanOrEqual(viewportWidth + 0.5);
}

for (const width of [390, 1280] as const) {
  test(`글자 200% ${width}px: 홈·상세·모임 만들기·공간 목록·관리자 — 가로 넘침 없음, 주요 버튼·입력이 화면 안`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 900 });
    await resetMockData(page);

    await goZoomed(page, '/');
    // 목록을 불러오는 동안(스켈레톤, mock 300ms 지연)과 불러온 뒤 모두 확인
    await expectNoHorizontalOverflow(page, `200% 홈(로딩) ${width}`);
    await expect(page.getByTestId('meeting-row').first()).toBeVisible();
    await expectNoHorizontalOverflow(page, `200% 홈 ${width}`);
    await expectWithinViewportWidth(page, page.getByTestId('region-button'), '지역 선택');
    await expectWithinViewportWidth(page, page.getByRole('searchbox', { name: '모임 검색' }), '검색 입력');
    await expectWithinViewportWidth(page, page.getByTestId('meeting-row').first(), '첫 모임 행');
    await expectWithinViewportWidth(page, page.getByTestId('meeting-row').first().getByTestId('meeting-title'), '첫 모임 제목');

    await goZoomed(page, '/meetings/seed-meeting-07');
    await expectNoHorizontalOverflow(page, `200% 상세 ${width}`);
    await expectWithinViewportWidth(page, page.getByTestId('detail-title'), '상세 제목');
    await expectWithinViewportWidth(page, page.getByTestId('detail-cta').getByRole('link', { name: '로그인하고 신청하기' }), '상세 CTA');

    await goZoomed(page, '/venues');
    await expectNoHorizontalOverflow(page, `200% 공간 목록(로딩) ${width}`);
    await expect(page.getByTestId('venue-row').first()).toBeVisible();
    await expectNoHorizontalOverflow(page, `200% 공간 목록 ${width}`);
    await expectWithinViewportWidth(page, page.getByTestId('venue-row').first(), '첫 공간 행');

    await page.goto('/login');
    await loginAs(page, '예시관리계정');
    await goZoomed(page, '/meetings/new');
    await expectNoHorizontalOverflow(page, `200% 모임 만들기 ${width}`);
    await expectWithinViewportWidth(page, page.getByLabel('모임 제목'), '제목 입력');
    await expectWithinViewportWidth(page, page.getByLabel('권역'), '권역 선택');
    await expectWithinViewportWidth(page, page.getByRole('button', { name: '모임 만들기' }), '만들기 버튼');

    await goZoomed(page, '/admin');
    await expect(page.getByTestId('admin-report').first()).toBeVisible();
    await expectNoHorizontalOverflow(page, `200% 관리자 ${width}`);
    await expectWithinViewportWidth(page, page.getByTestId('admin-report').first().getByTestId('admin-report-status'), '신고 처리 상태');
    await expectWithinViewportWidth(page, page.getByTestId('admin-report').first().getByTestId('admin-report-save'), '처리 상태 저장');
  });
}
