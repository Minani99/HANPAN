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
  // CI 러너(GitHub Actions 4 vCPU → 2 workers)는 이 개발 PC보다 느리고 Vite 개발 서버가 첫 요청에 변환을 한다.
  // 로컬에서 20~25초 걸리는 테스트(6개 뷰포트 순회·참가자 관리 흐름)가 기본 30초에 걸리지 않게 CI에서만 늘린다(로컬 값은 그대로).
  timeout: process.env.CI ? 60_000 : 30_000,
  expect: { timeout: process.env.CI ? 10_000 : 5_000 },
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
