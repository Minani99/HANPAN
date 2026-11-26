import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginAs, resetMockData, waitForPage } from './helpers';

/**
 * 기기 시간대가 KST가 아니어도 날짜·시각을 KST로 계산·표시·저장하는지 확인한다(src/lib/date.ts).
 * playwright.config.ts의 기본 timezoneId(Asia/Seoul)를 이 파일에서만 바꾸고, page.clock으로 KST 자정 근처에서 시작한다
 * (install: 정한 시각부터 실제 속도로 흐름).
 *
 * mock 예시 모임은 브라우저의 현재 시각(여기서는 가짜 시각) 기준으로 처음 열 때 만들어진다(src/data/mock/seed.ts):
 * seed-meeting-01 = 3시간 뒤를 30분 단위로 올림, seed-meeting-02 = 다음 날(KST) 19:00, seed-meeting-15 = 다음 날(KST) 20:00.
 * 기대값은 앱 코드를 쓰지 않고 "KST = UTC+9(서머타임 없음)"으로 따로 계산한다.
 */

/** KST 11-28(토) 00:10 = UTC 11-27(금) 15:10 = LA 11-27(금) 07:10 — 기기 날짜는 아직 11-27이다 */
const AFTER_KST_MIDNIGHT = '2026-11-27T15:10:00Z';
/** KST 11-27(금) 23:58 = UTC 11-27 14:58 = LA 11-27 06:58 */
const BEFORE_KST_MIDNIGHT = '2026-11-27T14:58:00Z';
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** UTC ISO → KST 날짜 키(YYYY-MM-DD) */
function kstDateKey(iso: string): string {
  return new Date(Date.parse(iso) + KST_OFFSET_MS).toISOString().slice(0, 10);
}

const DEVICE_TIME_ZONES = [
  { timezoneId: 'America/Los_Angeles', januaryOffsetMinutes: 480 },
  { timezoneId: 'UTC', januaryOffsetMinutes: 0 },
] as const;

/** 브라우저가 정말 그 시간대로 도는지 먼저 확인한다(설정이 무시되면 테스트가 헛돈다). */
async function expectDeviceTimeZone(page: Page, timezoneId: string, januaryOffsetMinutes: number) {
  const device = await page.evaluate(() => ({
    zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    offset: new Date('2026-01-15T00:00:00Z').getTimezoneOffset(),
  }));
  expect(device).toEqual({ zone: timezoneId, offset: januaryOffsetMinutes });
}

function dateStrip(page: Page): Locator {
  return page.getByRole('group', { name: '날짜 선택' });
}

/** 날짜 칸 이름의 앞부분(보이는 글자 '토 11.28' + 숨긴 설명의 쉼표). Chromium은 숨긴 설명 앞에 공백을 넣기도 한다 */
function dayNamePrefix(weekday: string, label: string): string {
  return `^${weekday}\\s*${label.replace('.', '\\.')}\\s*,`;
}

/** 날짜 칸 버튼: 보이는 글자(요일·MM.DD)로 찾는다 */
function dayButton(page: Page, weekday: string, label: string): Locator {
  return dateStrip(page).getByRole('button', { name: new RegExp(dayNamePrefix(weekday, label)) });
}

async function expectToday(page: Page, weekday: string, label: string, longLabel: string) {
  const today = dateStrip(page).getByRole('button', { name: /, 오늘$/ });
  await expect(today).toHaveCount(1);
  await expect(today).toHaveAccessibleName(new RegExp(`${dayNamePrefix(weekday, label)} ${longLabel}, 오늘$`));
}

/** 목록의 모든 모임 시작 시각(time[datetime])이 고른 KST 날짜인지 */
async function expectRowsOnKstDate(page: Page, dateKey: string, count: number) {
  const rows = page.getByTestId('meeting-row');
  await expect(rows).toHaveCount(count);
  const starts = await rows.locator('time').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('datetime') ?? ''));
  expect(starts).toHaveLength(count);
  for (const start of starts) expect(kstDateKey(start), start).toBe(dateKey);
}

for (const { timezoneId, januaryOffsetMinutes } of DEVICE_TIME_ZONES) {
  test.describe(`기기 시간대 ${timezoneId}에서도 KST`, () => {
    test.use({ timezoneId });

    test('KST 자정 직후: 날짜 칸의 오늘·날짜 필터·목록과 상세의 모임 시각이 KST 기준', async ({ page }) => {
      await page.clock.install({ time: AFTER_KST_MIDNIGHT });
      await resetMockData(page);
      await page.goto('/');
      await expectDeviceTimeZone(page, timezoneId, januaryOffsetMinutes);
      await expect(page.getByTestId('meeting-row').first()).toBeVisible();

      // 기기 날짜는 11-27(금)이지만 KST는 11-28(토)
      await expectToday(page, '토', '11.28', '11월 28일 토요일');
      await expect(dayButton(page, '금', '11.27')).toHaveCount(0);

      // 오늘(KST 11-28): 3시간 뒤 모임(UTC 18:30 = KST 03:30)만 — 기기 날짜로는 11-27인 모임
      await dayButton(page, '토', '11.28').click();
      await expect(page).toHaveURL(/\?date=2026-11-28$/);
      await expectRowsOnKstDate(page, '2026-11-28', 1);
      const soon = page.getByTestId('meeting-row').filter({ hasText: '[예시] 퇴근하고 코드네임 한 판' });
      await expect(soon.locator('time')).toHaveAttribute('datetime', '2026-11-27T18:30:00.000Z');
      await expect(soon.locator('time')).toHaveText('11.28 (토) · 03:30');

      // 다음 날(KST 11-29): 19:00·20:00 모임 2개
      await dayButton(page, '일', '11.29').click();
      await expect(page).toHaveURL(/\?date=2026-11-29$/);
      await expectRowsOnKstDate(page, '2026-11-29', 2);
      const evening = page.getByTestId('meeting-row').filter({ hasText: '[예시] 저녁에 아발론 같이 하실 분' });
      await expect(evening.locator('time')).toHaveAttribute('datetime', '2026-11-29T10:00:00.000Z');
      await expect(evening.locator('time')).toHaveText('11.29 (일) · 19:00');
      await expect(page.getByTestId('meeting-row').filter({ hasText: '[예시] 할리갈리 · 젠가 가볍게' }).locator('time')).toHaveText(
        '11.29 (일) · 20:00',
      );

      // 상세: 같은 시각을 KST로(150분 → 21:30 종료)
      await evening.click();
      await expect(page).toHaveURL(/\/meetings\/seed-meeting-02$/);
      const info = page.getByTestId('meeting-info');
      await expect(info.locator('time')).toHaveAttribute('datetime', '2026-11-29T10:00:00.000Z');
      await expect(info.locator('time')).toHaveText('2026년 11월 29일 (일)');
      await expect(info).toContainText('오후 7:00 ~ 오후 9:30');

      // 자정을 막 넘긴 KST 새벽 모임도 KST 날짜로
      await page.goto('/meetings/seed-meeting-01');
      await expect(info.locator('time')).toHaveText('2026년 11월 28일 (토)');
      await expect(info).toContainText('오전 3:30 ~ 오전 5:30');
    });

    test('KST 자정 직전 → 직후: 다시 열면 날짜 칸의 오늘이 KST 기준으로 바뀐다', async ({ page }) => {
      await page.clock.install({ time: BEFORE_KST_MIDNIGHT });
      await resetMockData(page);
      await page.goto('/');
      await expectDeviceTimeZone(page, timezoneId, januaryOffsetMinutes);
      await expect(page.getByTestId('meeting-row').first()).toBeVisible();
      await expectToday(page, '금', '11.27', '11월 27일 금요일');

      // KST 11-27에 남은 모임은 없다. 3시간 뒤 모임(UTC 18:00 — 기기 날짜로는 11-27)은 KST 11-28에 들어간다
      await dayButton(page, '금', '11.27').click();
      await expect(page.getByTestId('meeting-row')).toHaveCount(0);
      await expect(page.getByRole('heading', { name: '조건에 맞는 모임이 아직 없어요.' })).toBeVisible();
      await dayButton(page, '토', '11.28').click();
      await expectRowsOnKstDate(page, '2026-11-28', 3);
      await expect(page.getByTestId('meeting-row').filter({ hasText: '[예시] 퇴근하고 코드네임 한 판' }).locator('time')).toHaveText(
        '11.28 (토) · 03:00',
      );

      // 5분 뒤(KST 11-28 00:03) 다시 열면 오늘 = 11.28. 기기(LA·UTC) 날짜는 여전히 11-27
      await page.clock.fastForward('05:00');
      await page.goto('/');
      await expect(page.getByTestId('meeting-row').first()).toBeVisible();
      await expectToday(page, '토', '11.28', '11월 28일 토요일');
      await expect(dayButton(page, '금', '11.27')).toHaveCount(0);
      await dayButton(page, '토', '11.28').click();
      await expectRowsOnKstDate(page, '2026-11-28', 3);
    });

    test('모임 만들기: 날짜·시간 입력을 KST로 저장하고 상세·수정 화면에서 같은 시각으로 보인다', async ({ page }) => {
      await page.clock.install({ time: AFTER_KST_MIDNIGHT });
      await resetMockData(page);
      await page.goto('/meetings/new');
      await expect(page).toHaveURL(/\/login$/);
      await loginAs(page, '예시사용자B');
      await expect(page).toHaveURL(/\/meetings\/new$/);
      await waitForPage(page);
      await expectDeviceTimeZone(page, timezoneId, januaryOffsetMinutes);

      // 고를 수 있는 날짜는 KST 오늘(11-28)부터, 기본값은 KST 내일
      const date = page.getByLabel('날짜', { exact: true });
      await expect(date).toHaveAttribute('min', '2026-11-28');
      await expect(date).toHaveValue('2026-11-29');

      // KST 오늘 01:00 = UTC 11-27 16:00(기기 날짜로는 아직 11-27)
      const title = `E2E 시간대 확인 ${timezoneId}`;
      await page.locator('label').filter({ hasText: /^전략$/ }).click();
      await page.getByLabel('모임 제목').fill(title);
      await date.fill('2026-11-28');
      await page.getByLabel('시작 시간').selectOption('01:00');
      await page.getByLabel('권역').selectOption('dunsan_tanbang');
      await page.getByRole('button', { name: '모임 만들기' }).click();

      await expect(page).toHaveURL(/\/meetings\/mock-meeting-\d+$/);
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
      const detailPath = new URL(page.url()).pathname;
      const info = page.getByTestId('meeting-info');
      await expect(info.locator('time')).toHaveAttribute('datetime', '2026-11-27T16:00:00.000Z');
      await expect(info.locator('time')).toHaveText('2026년 11월 28일 (토)');
      await expect(info).toContainText('오전 1:00 ~ 오전 3:00');

      // 탐색의 KST 날짜 필터와 목록 시각
      await page.goto('/?date=2026-11-28');
      const row = page.getByTestId('meeting-row').filter({ hasText: title });
      await expect(row.locator('time')).toHaveText('11.28 (토) · 01:00');

      // 수정 화면: 저장된 시각을 같은 KST 날짜·시간으로 되돌려 보여 준다
      await page.goto(`${detailPath}/edit`);
      await waitForPage(page);
      await expect(page.getByLabel('날짜', { exact: true })).toHaveValue('2026-11-28');
      await expect(page.getByLabel('시작 시간')).toHaveValue('01:00');
    });
  });
}
