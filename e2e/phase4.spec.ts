import { expect, test } from '@playwright/test';
import { box, expectNoHorizontalOverflow, loginAs, resetMockData, waitForPage } from './helpers';
import { VIEWPORTS } from './viewports';

test.beforeEach(async ({ page }) => {
  await resetMockData(page);
});

test.describe('공간', () => {
  test('목록 → 권역·유형 필터(URL) → 상세 → 외부 링크는 https·새 창·noopener noreferrer', async ({ page }) => {
    await page.goto('/venues');
    await expect(page.getByRole('heading', { level: 1, name: '공간 찾기' })).toBeVisible();
    await expect(page.getByTestId('venue-row').first()).toBeVisible();
    await expect(page.getByTestId('venue-list')).not.toContainText('비공개 예시 공간 J');

    await page.getByRole('group', { name: '권역' }).getByRole('button', { name: '둔산·탄방' }).click();
    await expect(page).toHaveURL(/\/venues\?region=dunsan_tanbang$/);
    await page.getByRole('group', { name: '유형', exact: true }).getByRole('button', { name: '보드게임 카페' }).click();
    await expect(page).toHaveURL(/region=dunsan_tanbang&type=board_game_cafe$/);
    await expect(page.getByTestId('venue-row')).toHaveCount(3);

    // 새로고침해도 같은 필터
    await page.reload();
    await expect(page.getByRole('group', { name: '권역' }).getByRole('button', { name: '둔산·탄방' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.locator('a[href="/venues/seed-venue-01"]').click();
    await expect(page).toHaveURL(/\/venues\/seed-venue-01$/);
    await expect(page.getByRole('heading', { level: 1, name: '보드게임 카페 A' })).toBeVisible();
    await expect(page.getByTestId('venue-notice')).toContainText('HANPAN은 예약·결제를 대행하지 않아요.');
    await expect(page.getByTestId('venue-info')).toContainText(/정보 확인일\s*\d{4}\.\d{2}\.\d{2}/);

    for (const testId of ['venue-website', 'venue-booking']) {
      const link = page.getByTestId(testId);
      await expect(link).toHaveAttribute('href', /^https:\/\/example\.com\//);
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
    await expect(page.getByTestId('venue-website')).toContainText('공식 홈페이지(외부)');
    await expect(page.getByTestId('venue-booking')).toContainText('예약 페이지(외부)');
    await expect(page.getByTestId('meeting-row').first()).toBeVisible();
  });

  test('모임 상세: 장소명이 공간 상세 링크, 예약 링크(외부)', async ({ page }) => {
    await page.goto('/meetings/seed-meeting-01');
    await waitForPage(page);
    await expect(page.getByTestId('meeting-venue-link')).toHaveAttribute('href', '/venues/seed-venue-01');
    await expect(page.getByTestId('meeting-venue-booking')).toHaveAttribute('rel', 'noopener noreferrer');
    await page.getByTestId('meeting-venue-link').click();
    await expect(page).toHaveURL(/\/venues\/seed-venue-01$/);
  });
});

test.describe('신고', () => {
  test('로그인 사용자가 모임 신고 → 접수 토스트 → 같은 대상 재신고는 중복 안내', async ({ page }) => {
    await page.goto('/login');
    await loginAs(page, '예시사용자B');
    await page.goto('/meetings/seed-meeting-05');
    await waitForPage(page);

    await page.getByRole('button', { name: '신고하기' }).click();
    let dialog = page.getByRole('dialog', { name: '신고하기' });
    await expect(dialog).toContainText('신고는 운영자가 직접 검토해요. 신고만으로 자동 제재되지 않아요.');
    await dialog.getByText('스팸·광고', { exact: true }).click();
    await dialog.getByLabel('상세 내용 (선택)').fill('같은 내용으로 반복 홍보해요.');
    await dialog.getByRole('button', { name: '신고하기' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: '신고가 접수됐어요' })).toBeVisible();

    await page.getByRole('button', { name: '신고하기' }).click();
    dialog = page.getByRole('dialog', { name: '신고하기' });
    await dialog.getByText('기타', { exact: true }).click();
    await dialog.getByLabel('상세 내용 (필수)').fill('다시 신고');
    await dialog.getByRole('button', { name: '신고하기' }).click();
    await expect(dialog.getByRole('alert')).toContainText('이미 접수된 신고가 있어요.');
  });

  test('비로그인 신고 → 로그인 → 같은 상세로 복귀', async ({ page }) => {
    await page.goto('/meetings/seed-meeting-05');
    await waitForPage(page);
    await page.getByRole('button', { name: '신고하기' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await loginAs(page, '예시사용자B');
    await expect(page).toHaveURL(/\/meetings\/seed-meeting-05$/);
  });
});

test.describe('관리자', () => {
  test('관리자 dev 계정: 신고 상태 변경, 모임 숨김 → 탐색 목록에서 사라짐 → 해제', async ({ page }) => {
    await page.goto('/login');
    await loginAs(page, '예시관리계정');
    await page.goto('/profile');
    await page.getByTestId('admin-tools-link').getByRole('link', { name: '관리자 도구 열기' }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('tab', { name: '신고' })).toHaveAttribute('aria-selected', 'true');

    const report = page.getByTestId('admin-report').filter({ hasText: '[예시] 칩만 쓰는 비금전 홀덤 친목 모임' });
    await report.getByTestId('admin-report-status').selectOption('reviewing');
    await report.getByLabel('관리자 메모 (신고자에게 보이지 않아요)').fill('홀덤 모임 내용 확인 중');
    await report.getByTestId('admin-report-save').click();
    await expect(page.getByRole('status').filter({ hasText: '신고 처리 상태를 저장했어요.' })).toBeVisible();
    await page.getByRole('group', { name: '신고 상태' }).getByRole('button', { name: '검토 중' }).click();
    await expect(page.getByTestId('admin-report').filter({ hasText: '홀덤 모임' }).getByTestId('admin-report-status')).toHaveValue(
      'reviewing',
    );

    await page.getByRole('tab', { name: '모임' }).click();
    await expect(page).toHaveURL(/\/admin\?tab=meetings$/);
    const row = page.getByTestId('admin-meeting').filter({ hasText: '[예시] 퇴근하고 코드네임 한 판' });
    await row.getByRole('button', { name: '숨기기' }).click();
    const dialog = page.getByRole('dialog', { name: '이 모임을 숨길까요?' });
    await dialog.getByLabel('숨김 사유 (필수)').fill('운영 정책 확인을 위해 숨김');
    await dialog.getByRole('button', { name: '숨기기' }).click();
    await expect(dialog).toBeHidden();
    await expect(row.getByText('숨김', { exact: true })).toBeVisible();

    await page.goto('/');
    await expect(page.getByTestId('meeting-row').first()).toBeVisible();
    await expect(page.getByTestId('meeting-list')).not.toContainText('[예시] 퇴근하고 코드네임 한 판');

    await page.goto('/admin?tab=meetings');
    const hiddenRow = page.getByTestId('admin-meeting').filter({ hasText: '[예시] 퇴근하고 코드네임 한 판' });
    await hiddenRow.getByRole('button', { name: '숨김 해제' }).click();
    await page.getByRole('dialog', { name: '숨김을 해제할까요?' }).getByRole('button', { name: '숨김 해제' }).click();
    await expect(page.getByRole('status').filter({ hasText: '모임 숨김을 해제했어요.' })).toBeVisible();

    await page.goto('/');
    await expect(page.getByTestId('meeting-list')).toContainText('[예시] 퇴근하고 코드네임 한 판');
  });

  test('일반 계정으로 /admin 직접 접근 → 권한 없음, 헤더·프로필에 관리자 메뉴 없음', async ({ page }) => {
    await page.goto('/login');
    await loginAs(page, '예시사용자A');
    await page.goto('/admin');
    await expect(page.getByRole('heading', { level: 1, name: '접근 권한이 없어요.' })).toBeVisible();
    await expect(page.getByRole('tablist')).toHaveCount(0);
    await expect(page.getByRole('banner').getByRole('link', { name: /관리자/ })).toHaveCount(0);
    await page.goto('/profile');
    await waitForPage(page);
    await expect(page.getByTestId('admin-tools-link')).toHaveCount(0);
  });

  test('비로그인 /admin → 로그인 유도', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe('정책 페이지', () => {
  for (const [slug, title] of [
    ['terms', '이용약관(초안)'],
    ['privacy', '개인정보처리방침(초안)'],
    ['operations', '운영정책(초안)'],
  ] as const) {
    test(`${slug}: 제목·초안 배너·본문`, async ({ page }) => {
      await page.goto(`/policies/${slug}`);
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
      await expect(page.getByTestId('policy-draft-banner')).toContainText('운영자·법률 검토 전 초안이에요. 정식 공개 전에 바뀔 수 있어요.');
      await expect(page.getByTestId('markdown').getByRole('heading', { level: 2 }).first()).toBeVisible();
      await expect(page.getByTestId('markdown')).not.toContainText('BLOCKED');
    });
  }

  test('없는 정책 slug는 404', async ({ page }) => {
    await page.goto('/policies/refund');
    await expect(page.getByRole('heading', { level: 1, name: '페이지를 찾을 수 없어요' })).toBeVisible();
  });
});

test('320px 공간 찾기: 필터 줄 라벨(권역·유형)이 보이고 칩 높이 42px 유지, 라벨과 칩이 같은 줄', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/venues');
  await expect(page.getByTestId('venue-row').first()).toBeVisible();
  for (const [id, group] of [
    ['#venue-filter-region', '권역'],
    ['#venue-filter-type', '유형'],
  ] as const) {
    const label = page.locator(id);
    await expect(label).toBeVisible();
    const chip = page.getByRole('group', { name: group, exact: true }).getByRole('button', { name: '전체' });
    const chipBox = await box(chip);
    const labelBox = await box(label);
    expect(chipBox.height).toBeGreaterThanOrEqual(42);
    expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(chipBox.x);
    expect(labelBox.y).toBeLessThan(chipBox.y + chipBox.height);
    expect(labelBox.y + labelBox.height).toBeGreaterThan(chipBox.y);
  }
  await expectNoHorizontalOverflow(page, '/venues filters @320');
});

test.describe('새 화면 가로 오버플로', () => {
  const PUBLIC_PATHS = ['/venues', '/venues/seed-venue-07', '/policies/terms', '/policies/privacy', '/policies/operations'];

  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: 공간·정책·관리자 화면`, async ({ page }) => {
      await page.setViewportSize(viewport);
      for (const path of PUBLIC_PATHS) {
        await page.goto(path);
        await waitForPage(page);
        await expectNoHorizontalOverflow(page, `${path} @${viewport.width}`);
      }
      await page.goto('/login');
      await loginAs(page, '예시관리계정');
      for (const tab of ['', '?tab=meetings', '?tab=users', '?tab=venues', '?tab=categories']) {
        await page.goto(`/admin${tab}`);
        await expect(page.getByRole('tablist', { name: '관리 항목' })).toBeVisible();
        await expect(page.getByRole('tabpanel').getByRole('list').first()).toBeVisible();
        await expectNoHorizontalOverflow(page, `/admin${tab} @${viewport.width}`);
      }
      await page.goto('/admin?tab=venues');
      await page.getByRole('button', { name: '새 공간 등록' }).click();
      await expect(page.getByTestId('venue-editor')).toBeVisible();
      await expectNoHorizontalOverflow(page, `/admin venue editor @${viewport.width}`);
    });
  }
});
