#!/usr/bin/env node
/**
 * CSP 스모크 테스트용 미리보기 서버(`npm run test:csp`가 Playwright webServer로 실행한다 — playwright.csp.config.ts).
 *
 * 1. 빌드 2종을 임시 폴더(node_modules/.tmp/hanpan-csp/)에 만든다. 각각 vite build → scripts/write-headers.mjs.
 *    - mock:     --mode e2e(개발용 예시 데이터, 화면 전체를 돌 수 있음). Supabase env는 비워서 connect-src 'self'만.
 *    - supabase: 운영 모드 + 명백한 가짜 env(https://example-ref.supabase.co, 가짜 anon JWT). 실제 요청은 테스트가 가로챈다.
 * 2. 각각 `vite preview`로 띄운다. vite.config.ts의 미리보기 플러그인이 생성된 _headers를 Cloudflare Pages처럼 붙인다.
 *    mock → http://127.0.0.1:4179, supabase → http://127.0.0.1:4180
 * 3. 종료 신호를 받으면 서버를 닫고 임시 폴더를 지운다(강제 종료로 못 지운 경우 e2e/csp-teardown.ts가 지운다).
 */
import { join } from 'node:path';
import { preview } from 'vite';
import { FAKE_SUPABASE_URL, PROJECT_ROOT, TMP_ROOT, buildVariant, fakeSupabaseJwt, removeDir } from './lib/build-variant.mjs';

// e2e/csp-teardown.ts도 같은 경로를 지운다(이름을 바꾸면 함께 바꾼다).
const CSP_TMP_DIR = join(TMP_ROOT, 'hanpan-csp');

const VARIANTS = [
  { name: 'mock', mode: 'e2e', port: 4179, env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' } },
  {
    name: 'supabase',
    mode: 'production',
    port: 4180,
    env: { VITE_SUPABASE_URL: FAKE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY: fakeSupabaseJwt('anon'), VITE_AUTH_KAKAO_ENABLED: 'false' },
  },
];

removeDir(CSP_TMP_DIR);
const servers = [];

async function shutdown(code) {
  await Promise.allSettled(servers.map((server) => server.close()));
  removeDir(CSP_TMP_DIR);
  process.exit(code);
}
process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

for (const variant of VARIANTS) {
  const outDir = join(CSP_TMP_DIR, variant.name);
  console.log(`[csp-preview] ${variant.name}: 빌드 중(mode=${variant.mode})…`);
  const result = buildVariant({ mode: variant.mode, outDir, env: variant.env });
  if (!result.ok) {
    console.error(`[csp-preview] ${variant.name}: ${result.step} 실패\n${result.output}`);
    await shutdown(1);
  }
}

for (const variant of VARIANTS) {
  // 미리보기 설정도 같은 env로 읽게 한다(vite.config.ts의 키 가드). 빌드가 끝난 뒤라 번들에는 영향 없음.
  Object.assign(process.env, variant.env);
  const server = await preview({
    root: PROJECT_ROOT,
    mode: variant.mode,
    logLevel: 'warn',
    build: { outDir: join(CSP_TMP_DIR, variant.name) },
    preview: { host: '127.0.0.1', port: variant.port, strictPort: true, open: false },
  });
  servers.push(server);
  console.log(`[csp-preview] ${variant.name}: http://127.0.0.1:${variant.port}`);
}
