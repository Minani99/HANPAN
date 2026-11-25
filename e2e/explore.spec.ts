import { expect, test, type Locator, type Page } from '@playwright/test';
import { VIEWPORTS } from './viewports';

async function waitForList(page: Page) {
  await expect(page.getByTestId('meeting-row').first()).toBeVisible();
}

type Box = { x: number; y: number; width: number; height: number };

function overlaps(a: Box, b: Box): boolean {
  return !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
}

async function box(locator: Locator): Promise<Box> {
  const value = await locator.boundingBox();
  if (!value) throw new Error('요소의 bounding box를 구할 수 없습니다.');
  return value;
}

test.describe('홈 / 모임 탐색', () => {
  test('홈이 열리고 예시 목록과 개발용 안내가 보인다', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: '이번 주, 같이 한 판.' })).toBeVisible();
    await expect(page.getByTestId('dev-data-banner')).toContainText('개발용 예시 데이터입니다. 실제 모임이 아닙니다.');
    await waitForList(page);
    await expect(page.getByTestId('meeting-row')).toHaveCount(12);
    await expect(page.getByTestId('meeting-count')).toHaveText('12개');
    // 취소·지난·진행 중·숨김 모임은 보이지 않는다
    await expect(page.getByText('[예시] 취소된 젠가 모임')).toHaveCount(0);
    await expect(page.getByText('[예시] 이미 끝난 마피아 모임')).toHaveCount(0);
    await expect(page.getByText('[예시] 지금 진행 중인 할리갈리 모임')).toHaveCount(0);
    await expect(page.getByText('[예시] 운영 정책 위반으로 숨겨진 모임')).toHaveCount(0);
  });

  test('칩을 누르면 URL이 바뀌고 새로고침해도 필터가 유지된다', async ({ page }) => {
    await page.goto('/');
    await waitForList(page);

    await page.getByRole('button', { name: '전략', exact: true }).click();
    await expect(page).toHaveURL(/\/\?category=strategy$/);
    await expect(page.getByTestId('meeting-row')).toHaveCount(3);

    await page.getByRole('button', { name: '모집 중만' }).click();
    await expect(page).toHaveURL(/\?category=strategy&recruiting=1$/);
    await expect(page.getByTestId('meeting-row')).toHaveCount(1);

    await page.reload();
    await waitForList(page);
    await expect(page).toHaveURL(/\?category=strategy&recruiting=1$/);
    await expect(page.getByRole('button', { name: '전략', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: '모집 중만' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('meeting-row')).toHaveCount(1);
  });

  test('필터 변경은 히스토리를 쌓지 않는다(replace)', async ({ page }) => {
    await page.goto('/venues');
    await page.goto('/');
    await waitForList(page);
    await page.getByRole('button', { name: '파티·캐주얼' }).click();
    await page.getByRole('button', { name: '추리·마피아' }).click();
    await expect(page).toHaveURL(/category=deduction/);
    await page.goBack();
    await expect(page).toHaveURL(/\/venues$/);
  });

  test('검색어는 디바운스 후 URL에 반영되고 공유 링크로 열 수 있다', async ({ page }) => {
    await page.goto('/');
    await waitForList(page);
    await page.getByRole('searchbox', { name: '모임 검색' }).fill('카탄');
    await expect(page).toHaveURL(/\?q=%EC%B9%B4%ED%83%84$/);
    await expect(page.getByTestId('meeting-row')).toHaveCount(1);

    await page.goto(page.url());
    await waitForList(page);
    await expect(page.getByRole('searchbox', { name: '모임 검색' })).toHaveValue('카탄');
    await expect(page.getByTestId('meeting-row')).toHaveCount(1);
  });

  test('행을 누르면 /meetings/:id로 이동한다', async ({ page }) => {
    await page.goto('/');
    await waitForList(page);
    const first = page.getByTestId('meeting-row').first();
    const href = await first.getAttribute('href');
    const title = await first.getByTestId('meeting-title').textContent();
    expect(href).toMatch(/^\/meetings\/[^/]+$/);
    await first.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.getByRole('heading', { level: 1, name: title ?? '' })).toBeVisible();
    await expect(page.getByTestId('detail-cta')).toBeVisible();
  });

  test('지역 선택 대화상자: 선택하면 region 쿼리, ESC로 닫으면 트리거로 포커스 복귀', async ({ page }) => {
    await page.goto('/');
    await waitForList(page);
    const trigger = page.getByTestId('region-button');
    await expect(trigger).toContainText('대전 · 전체 지역');

    await trigger.click();
    const dialog = page.getByRole('dialog', { name: '지역 선택' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: '전체 지역' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await dialog.getByRole('button', { name: '노은·지족' }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\?region=noeun_jijok$/);
    await expect(trigger).toContainText('대전 · 노은·지족');
    await expect(page.getByTestId('meeting-row')).toHaveCount(2);
  });

  test('없는 주소는 404 화면', async ({ page }) => {
    await page.goto('/no-such-page');
    await expect(page.getByRole('heading', { name: '페이지를 찾을 수 없어요' })).toBeVisible();
  });

  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: 가로 오버플로가 없다`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/');
      await waitForList(page);
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

      const bottomNav = page.getByTestId('mobile-bottom-nav');
      if (viewport.width <= 760) {
        await expect(bottomNav).toBeVisible();
      } else {
        await expect(bottomNav).toBeHidden();
      }
    });
  }

  test('320px: 제목·메타·인원 영역이 겹치지 않는다', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/');
    await waitForList(page);
    const rows = page.getByTestId('meeting-row');
    const count = await rows.count();
    expect(count).toBe(12);
    for (let index = 0; index < count; index += 1) {
      const row = rows.nth(index);
      const title = await box(row.getByTestId('meeting-title'));
      const meta = await box(row.getByTestId('meeting-meta'));
      const availability = await box(row.getByTestId('meeting-availability'));
      const rowBox = await box(row);
      expect(overlaps(title, availability), `row ${index}: 제목/인원`).toBe(false);
      expect(overlaps(meta, availability), `row ${index}: 메타/인원`).toBe(false);
      expect(overlaps(title, meta), `row ${index}: 제목/메타`).toBe(false);
      // 행 밖으로 넘치지 않는다
      expect(title.x + title.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 0.5);
      expect(availability.x + availability.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 0.5);
    }
  });

  test('모바일: 하단 내비가 마지막 콘텐츠를 가리지 않는다', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await waitForList(page);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const nav = await box(page.getByTestId('mobile-bottom-nav'));
    const lastLink = await box(page.getByRole('link', { name: '운영정책' }));
    expect(lastLink.y + lastLink.height).toBeLessThanOrEqual(nav.y);
    await expect(page.getByTestId('mobile-bottom-nav').getByRole('link', { name: '모임 찾기' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});
