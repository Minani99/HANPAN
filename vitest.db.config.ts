import { defineConfig } from 'vitest/config';

/**
 * DB 테스트 전용 설정: `npm run test:db`
 * PGlite(WASM Postgres)에 supabase/migrations를 적용하고 GRANT·RLS·RPC 규칙을 검사한다.
 * 화면 테스트(vite.config.ts의 jsdom 설정)와 분리해 node 환경에서 돈다.
 */
export default defineConfig({
  test: {
    name: 'db',
    environment: 'node',
    include: ['supabase/tests/**/*.test.ts'],
    // 파일마다 PGlite 템플릿(마이그레이션 적용)을 한 번 만들고 테스트마다 clone한다.
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
