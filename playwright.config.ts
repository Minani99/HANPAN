import { defineConfig, devices } from '@playwright/test';

const PORT = 5179;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * E2E: `npm run test:e2e` (chromium 프로젝트, 스크린샷 제외)
 * 스크린샷: `npm run screenshots` (docs/screenshots/ 에 저장)
 * 개발 서버를 e2e 모드로 띄워 항상 mock 데이터로 실행한다(로컬 .env 설정과 무관).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run dev:e2e -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // 스크린샷은 npm run screenshots, CSP 스모크(빌드 결과 필요)는 npm run test:csp(playwright.csp.config.ts)
      testIgnore: /(screenshots|csp)\.spec\.ts/,
    },
    {
      name: 'screenshots',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /screenshots\.spec\.ts/,
    },
  ],
});
