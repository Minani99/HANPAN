import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { HEADERS_FILE_NAME, headersForPath, parseHeadersFile } from './scripts/lib/security-headers.mjs';
import { checkPublicSupabaseConfig, describeUnsafeSupabaseConfig } from './src/data/supabase/keyGuard.ts';

/**
 * `vite preview` 전용: 빌드 결과의 `_headers`(scripts/write-headers.mjs가 생성)를 Cloudflare Pages처럼 응답에 붙인다.
 * 배포 전에 CSP·보안 헤더를 로컬에서 그대로 확인하기 위한 것이다(`npm run preview`, CSP 스모크 테스트 `npm run test:csp`).
 * 파일이 없으면(vite build만 실행한 경우) 경고하고 헤더 없이 띄운다. 개발 서버(`vite`)에는 적용하지 않는다
 * — 개발 서버는 HMR용 인라인 스크립트를 넣어서 운영 CSP와 맞지 않는다.
 */
function pagesHeadersPreview(): Plugin {
  return {
    name: 'hanpan:pages-headers-preview',
    configurePreviewServer(server) {
      const file = resolve(server.config.root, server.config.build.outDir, HEADERS_FILE_NAME);
      if (!existsSync(file)) {
        server.config.logger.warn(`[headers] ${HEADERS_FILE_NAME}가 없어 보안 헤더 없이 미리보기합니다. npm run build로 다시 빌드하세요.`);
        return;
      }
      const rules = parseHeadersFile(readFileSync(file, 'utf8'));
      server.config.logger.info(`[headers] ${HEADERS_FILE_NAME} 규칙 ${rules.length}개를 응답에 붙입니다(Cloudflare Pages 흉내).`);
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url ?? '/', 'http://preview.local').pathname;
        for (const [name, value] of Object.entries(headersForPath(rules, pathname))) res.setHeader(name, value);
        next();
      });
    },
  };
}

/**
 * 히어로 이미지 교체 지점.
 * `public/images/hero.jpg`가 있으면 그 사진을, 없으면 중립 SVG 일러스트를 사용한다.
 * 파일 존재 여부는 dev 서버 시작/빌드 시점에 판단하므로 파일을 추가한 뒤에는 서버를 재시작한다.
 */
const heroImageFile = fileURLToPath(new URL('./public/images/hero.jpg', import.meta.url));
const heroImageUrl = existsSync(heroImageFile) ? '/images/hero.jpg' : '';

export default defineConfig(({ command, mode }) => {
  /**
   * service_role 키 가드(빌드 시점): 브라우저에 노출되는 VITE_ 변수 이름에 SERVICE_ROLE이 있거나
   * VITE_SUPABASE_ANON_KEY가 service_role/secret 키로 보이면 빌드를 멈춘다(개발 서버는 경고만 하고
   * 앱이 런타임 가드로 Supabase 연결을 거부한다). 키 값은 출력하지 않는다.
   */
  const publicEnv = loadEnv(mode, process.cwd(), 'VITE_');
  const publicEnvNames = Object.keys(publicEnv).sort();
  const keyCheck = checkPublicSupabaseConfig({ anonKey: publicEnv.VITE_SUPABASE_ANON_KEY ?? '', envNames: publicEnvNames });
  if (!keyCheck.ok) {
    const message = describeUnsafeSupabaseConfig(keyCheck);
    if (command === 'build') throw new Error(`${message} 빌드를 중단합니다.`);
    console.warn(message);
  }

  return {
    plugins: [react(), tailwindcss(), pagesHeadersPreview()],
    define: {
      __HERO_IMAGE_URL__: JSON.stringify(heroImageUrl),
      // 이름만 넣는다(값은 넣지 않음). 런타임 가드가 SERVICE_ROLE 이름을 확인한다.
      __HANPAN_PUBLIC_ENV_NAMES__: JSON.stringify(publicEnvNames),
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      // scripts/*.test.ts: 빌드 스크립트의 순수 함수(보안 헤더 생성 등). 타입 검사는 tsconfig.db.json
      include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
      restoreMocks: true,
      unstubEnvs: true,
    },
  };
});
