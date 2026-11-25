import { expect, test } from '@playwright/test';
import { box, expectNoHorizontalOverflow, loginAs, logout, overlaps, resetMockData, waitForPage } from './helpers';
import { VIEWPORTS } from './viewports';

test.beforeEach(async ({ page }) => {
  await resetMockData(page);
});

test.describe('모임 상세 · 신청', () => {
  test('비로그인 상세 → 로그인하고 신청하기 → 테스트 계정 로그인 → 원래 상세로 복귀 → 신청 → 새로고침 후 유지', async ({ page }) => {
    await page.goto('/meetings/seed-meeting-01');
    await expect(page.getByRole('heading', { level: 1, name: '[예시] 퇴근하고 코드네임 한 판' })).toBeVisible();
    await expect(page.getByTestId('meeting-info')).toContainText('둔산·탄방 · 보드게임 카페 A');

    await page.getByRole('link', { name: '로그인하고 신청하기' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await loginAs(page, '예시사용자B');
    await expect(page).toHaveURL(/\/meetings\/seed-meeting-01$/);
    await expect(page.getByTestId('profile-button')).toBeVisible();

    await page.getByRole('button', { name: '참가 신청하기' }).click();
    const dialog = page.getByRole('dialog', { name: '참가 신청' });
    await dialog.getByLabel('모임장에게 남길 말 (선택)').fill('처음이에요. 잘 부탁드려요.');
    await dialog.getByRole('button', { name: '신청하기' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('cta-status')).toContainText('참가 확정');
    await expect(page.getByTestId('people-summary-panel')).toContainText('3/6명');

    await page.reload();
    await expect(page.getByTestId('cta-status')).toContainText('참가 확정');
    await expect(page.getByRole('button', { name: '신청 취소' })).toBeVisible();
  });

  test('승인제 모임에 신청하면 "승인 대기 중"', async ({ page }) => {
    await page.goto('/login');
    await loginAs(page, '예시사용자B');
    await page.goto('/meetings/seed-meeting-13');
    await page.getByRole('button', { name: '참가 신청하기 (승인제)' }).click();
    await page.getByRole('dialog', { name: '참가 신청' }).getByRole('button', { name: '신청하기' }).click();
    await expect(page.getByTestId('cta-status')).toContainText('승인 대기 중');
  });

  test('신청 실패(오류 주입) → 오류 안내 후 원래 상태, 다시 시도하면 성공', async ({ page }) => {
    await page.goto('/login');
    await loginAs(page, '예시사용자B');
    await page.goto('/meetings/seed-meeting-05');
    await waitForPage(page);
    await page.evaluate(() => {
      // 개발/e2e 모드 전용 오류 주입 (src/data/mock/adapter.ts)
      const mock = (window as unknown as { __HANPAN_MOCK__?: { setFailure: (options: object) => void } }).__HANPAN_MOCK__;
      mock?.setFailure({ methods: ['applyToMeeting'], times: 1, code: 'NETWORK_ERROR' });
    });
    await page.getByRole('button', { name: '참가 신청하기' }).click();
    const dialog = page.getByRole('dialog', { name: '참가 신청' });
    await dialog.getByRole('button', { name: '신청하기' }).click();
    await expect(dialog.getByRole('alert')).toContainText('연결이 불안정해요.');
    await dialog.getByRole('button', { name: '신청하기' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('cta-status')).toContainText('참가 확정');
  });
});

test.describe('모임 만들기', () => {
  test('모임 생성 → 상세로 이동 → 탐색 목록에 노출', async ({ page }) => {
    await page.goto('/meetings/new');
    await expect(page).toHaveURL(/\/login$/); // 로그인 필요
    await loginAs(page, '예시사용자B');
    await expect(page).toHaveURL(/\/meetings\/new$/); // 로그인 후 원래 화면으로
    await waitForPage(page);

    const title = 'E2E 확인용 카탄 모임';
    await page.locator('label').filter({ hasText: /^전략$/ }).click();
    await page.getByLabel('게임명 (선택)').fill('카탄');
    await page.getByLabel('모임 제목').fill(title);
    await page.getByLabel('시작 시간').selectOption('20:00');
    await page.getByLabel('권역').selectOption('dunsan_tanbang');
    await page.getByLabel('정원 (모임장 포함)').selectOption('4');
    await page.getByLabel('소개 (선택)').fill('첫 줄\n둘째 줄');
    await page.getByRole('button', { name: '모임 만들기' }).click();

    await expect(page).toHaveURL(/\/meetings\/mock-meeting-\d+$/);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(page.getByTestId('detail-cta-content')).toHaveAttribute('data-kind', 'host');
    await expect(page.getByTestId('people-summary-panel')).toContainText('1/4명');

    await page.goto('/');
    await expect(page.getByTestId('meeting-count')).toHaveText('13개');
    await expect(page.getByTestId('meeting-row').filter({ hasText: title })).toHaveCount(1);
  });
});

test.describe('모임장 참가자 관리', () => {
  test('게스트 신청 → 모임장 승인·거절 → 모임 취소 → 게스트의 내 모임에서 "모임 취소" 확인', async ({ page }) => {
    // 게스트 B가 승인제 모임에 신청
    await page.goto('/login');
    await loginAs(page, '예시사용자B');
    await page.goto('/meetings/seed-meeting-13');
    await page.getByRole('button', { name: '참가 신청하기 (승인제)' }).click();
    await page.getByRole('dialog', { name: '참가 신청' }).getByRole('button', { name: '신청하기' }).click();
    await expect(page.getByTestId('cta-status')).toContainText('승인 대기 중');
    await logout(page);

    // 모임장 A가 승인·거절
    await loginAs(page, '예시사용자A');
    await page.goto('/meetings/seed-meeting-13/participants');
    const counts = page.getByTestId('participants-counts');
    await expect(counts).toHaveText('확정 2/6명 · 승인 대기 3명 · 대기 0명');
    await page.getByRole('button', { name: '예시사용자B님 승인' }).click();
    await expect(counts).toHaveText('확정 3/6명 · 승인 대기 2명 · 대기 0명');
    await expect(page.getByTestId('confirmed-list')).toContainText('예시사용자B');

    await page.getByRole('button', { name: '예시참가자03님 거절' }).click();
    const reject = page.getByRole('dialog', { name: '예시참가자03님의 신청을 거절할까요?' });
    await reject.getByRole('button', { name: '거절하기' }).click();
    await expect(reject).toBeHidden();
    await expect(counts).toHaveText('확정 3/6명 · 승인 대기 1명 · 대기 0명');

    // 모임 취소
    await page.getByRole('button', { name: '모임 취소하기' }).click();
    const cancel = page.getByRole('dialog', { name: '모임을 취소할까요?' });
    await expect(cancel).toContainText('참가자에게 자동 알림(이메일·푸시)이 가지 않으니 별도로 알려 주세요.');
    await cancel.getByLabel('취소 사유 (선택)').fill('인원이 모이지 않았어요');
    await cancel.getByRole('button', { name: '모임 취소하기' }).click();
    await expect(page.getByTestId('participants-cancelled')).toContainText('인원이 모이지 않았어요');
    await expect(counts).toHaveText('확정 1/6명 · 승인 대기 0명 · 대기 0명');

    await page.goto('/meetings/seed-meeting-13');
    await expect(page.getByTestId('cancelled-notice')).toContainText('취소 사유: 인원이 모이지 않았어요');
    await logout(page);

    // 게스트 B: 내 모임 > 취소
    await loginAs(page, '예시사용자B');
    await page.goto('/my/meetings?tab=cancelled');
    const row = page.getByTestId('meeting-row').filter({ hasText: '[예시] 머더미스터리 입문 시나리오' });
    await expect(row).toBeVisible();
    await expect(row.getByTestId('my-status-badge')).toHaveText('모임 취소');
  });
});

test.describe('모바일 상세 하단 CTA 바', () => {
  test('320px: 제목·인원·하단 CTA 바가 겹치지 않고, CTA 바가 본문을 가리지 않는다', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/meetings/seed-meeting-07'); // 35자 제목 + 30자 장소명
    await waitForPage(page);
    const bar = page.getByTestId('detail-cta');
    await expect(bar).toBeVisible();
    await expect(page.getByTestId('mobile-bottom-nav')).toHaveCount(0); // 하단 내비 대신 CTA 바
    await expectNoHorizontalOverflow(page, '상세 320px');

    const barBox = await box(bar);
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(640 + 0.5);
    expect(barBox.x).toBeGreaterThanOrEqual(0);
    expect(barBox.x + barBox.width).toBeLessThanOrEqual(320 + 0.5);
    const cta = bar.getByRole('link', { name: '로그인하고 신청하기' });
    const ctaBox = await box(cta);
    expect(ctaBox.height).toBeGreaterThanOrEqual(52);
    expect(ctaBox.x + ctaBox.width).toBeLessThanOrEqual(320);

    const title = await box(page.getByTestId('detail-title'));
    expect(overlaps(title, barBox)).toBe(false);
    expect(title.x + title.width).toBeLessThanOrEqual(320);

    // 인원 블록을 화면 위쪽으로 스크롤해도 제목·인원·바가 서로 겹치지 않는다
    const people = page.getByTestId('people-summary');
    await people.evaluate((element) => element.scrollIntoView({ block: 'start' }));
    const peopleBox = await box(people);
    expect(overlaps(peopleBox, await box(bar))).toBe(false);
    expect(overlaps(peopleBox, await box(page.getByTestId('detail-title')))).toBe(false);

    // 맨 아래까지 스크롤하면 마지막 콘텐츠(푸터 링크)가 CTA 바 위에 보인다
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const lastLink = await box(page.getByRole('link', { name: '운영정책' }));
    const barAtBottom = await box(bar);
    expect(lastLink.y + lastLink.height).toBeLessThanOrEqual(barAtBottom.y);
    const share = await box(page.getByRole('button', { name: '공유하기' }));
    expect(share.y + share.height).toBeLessThanOrEqual(barAtBottom.y);
  });

  test('데스크톱: CTA는 우측 sticky 패널 안에 있고 하단에 고정되지 않는다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/meetings/seed-meeting-07');
    await waitForPage(page);
    const aside = await box(page.getByTestId('detail-aside'));
    const bar = await box(page.getByTestId('detail-cta'));
    expect(bar.x).toBeGreaterThanOrEqual(aside.x);
    expect(bar.y + bar.height).toBeLessThanOrEqual(aside.y + aside.height + 0.5);
    const title = await box(page.getByTestId('detail-title'));
    expect(aside.x).toBeGreaterThan(title.x + title.width);
  });
});

test.describe('새 화면 가로 오버플로', () => {
  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: 상세·로그인·만들기·수정·내 모임·참가자 관리·프로필`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const visit = async (path: string) => {
        await page.goto(path);
        await waitForPage(page);
        await expectNoHorizontalOverflow(page, `${viewport.width}px ${path}`);
      };
      await visit('/meetings/seed-meeting-07');
      await visit('/meetings/seed-meeting-10');
      await visit('/login');
      await loginAs(page, '예시사용자A');
      await visit('/meetings/seed-meeting-02');
      await visit('/meetings/new');
      await visit('/meetings/seed-meeting-13/edit');
      await visit('/my/meetings');
      await visit('/my/meetings?role=hosted');
      await visit('/meetings/seed-meeting-13/participants');
      await visit('/meetings/seed-meeting-12/participants');
      await visit('/profile');
    });
  }
});
