import { defineConfig, devices } from '@playwright/test';

/**
 * CSP 스모크 테스트: `npm run test:csp` (e2e/csp.spec.ts)
 * 개발 서버가 아니라 **빌드 결과 + 생성된 _headers**로 확인한다. 개발 서버는 HMR용 인라인 스크립트가 있어 운영 CSP와 다르다.
 * scripts/csp-preview.mjs가 빌드 2종을 임시 폴더에 만들고 vite preview로 띄운다(헤더는 vite.config.ts의 미리보기 플러그인이 붙임).
 * - csp-mock:     --mode e2e 빌드(개발용 예시 데이터) — 주요 화면 전체
 * - csp-supabase: 운영 모드 + 가짜 Supabase env — Supabase 요청은 테스트가 가로채 응답한다(외부로 나가지 않음)
 */
const MOCK_URL = 'http://127.0.0.1:4179';
const SUPABASE_URL = 'http://127.0.0.1:4180';

export default defineConfig({
  testDir: './e2e',
  testMatch: /csp\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // CI: 글꼴 CDN(jsDelivr) 응답도 확인하므로 네트워크 일시 오류에 1회 재시도(재시도 후 통과는 flaky로 표시된다)
  retries: process.env.CI ? 1 : 0,
  // E2E(playwright.config.ts)의 test-results/·playwright-report/와 겹치지 않게 하위 폴더에 둔다(CI 실패 시 둘 다 올림 — .github/workflows/ci.yml)
  outputDir: './test-results/csp',
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/csp' }]] : [['list']],
  globalTeardown: './e2e/csp-teardown.ts',
  use: {
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/csp-preview.mjs',
    // 두 서버를 차례로 띄우므로 마지막 서버가 응답하면 둘 다 준비된 것이다.
    url: SUPABASE_URL,
    // 빌드 결과가 항상 새로 만들어지도록 기존 서버를 재사용하지 않는다.
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    { name: 'csp-mock', use: { ...devices['Desktop Chrome'], baseURL: MOCK_URL }, grep: /@mock/ },
    { name: 'csp-supabase', use: { ...devices['Desktop Chrome'], baseURL: SUPABASE_URL }, grep: /@supabase/ },
  ],
});
