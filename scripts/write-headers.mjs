#!/usr/bin/env node
/**
 * 빌드 결과에 Cloudflare Pages 보안 헤더 파일(`_headers`)을 쓴다. `npm run build`가 vite build 뒤에 실행한다.
 *
 *   node scripts/write-headers.mjs                       → dist/_headers (mode=production)
 *   node scripts/write-headers.mjs --out-dir <폴더> --mode <mode>
 *
 * - 환경 변수는 Vite와 같은 방식(loadEnv: .env 파일 + 실행 환경, 실행 환경 우선)으로 읽는다 → 번들에 들어간 값과 같다.
 * - CSP connect-src: VITE_SUPABASE_URL이 있으면 https origin만 추가, 없으면 'self'만(콘솔에 알림).
 *   https가 아니거나 경로·이상한 문자가 있으면 exit 1(빌드 실패). 실패할 때 입력값은 출력하지 않는다
 *   (성공하면 정리된 origin만 출력 — 번들에도 들어가는 공개 값).
 * - Cloudflare Pages는 최상위 404.html이 없을 때만 SPA로 동작한다(모르는 경로 → index.html).
 *   빌드 결과에 404.html이 있으면 딥링크가 깨지므로 exit 1(docs/DEPLOYMENT.md §7).
 * - 정책 내용과 이유: scripts/lib/security-headers.mjs, docs/SECURITY.md §7.
 */
import { existsSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import {
  HEADERS_FILE_NAME,
  HeadersConfigError,
  buildHeaderRules,
  parseSupabaseOrigin,
  renderHeadersFile,
} from './lib/security-headers.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readOption(name, fallback) {
  const args = process.argv.slice(2);
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    console.error(`[headers] ${name} 값이 없습니다.`);
    process.exit(1);
  }
  return value;
}

const mode = readOption('--mode', 'production');
const outDir = resolve(projectRoot, readOption('--out-dir', 'dist'));
const label = relative(projectRoot, outDir) || '.';

if (!existsSync(outDir) || !statSync(outDir).isDirectory()) {
  console.error(`[headers] 빌드 결과 폴더가 없습니다: ${label} — 먼저 vite build를 실행하세요.`);
  process.exit(1);
}
if (existsSync(join(outDir, '404.html'))) {
  console.error(`[headers] 실패: ${label}/404.html이 있습니다. Cloudflare Pages가 SPA 폴백을 끄므로 딥링크·새로고침이 404가 됩니다.`);
  process.exit(1);
}

const env = loadEnv(mode, projectRoot, 'VITE_');
let supabaseOrigin;
try {
  supabaseOrigin = parseSupabaseOrigin(env.VITE_SUPABASE_URL);
} catch (error) {
  if (error instanceof HeadersConfigError) {
    console.error(`[headers] 실패: ${error.message} 빌드를 중단합니다.`);
    process.exit(1);
  }
  throw error;
}

if (supabaseOrigin === null) {
  console.log("[headers] VITE_SUPABASE_URL이 없어 CSP connect-src를 'self'만 허용합니다(Supabase 미설정 빌드 — 앱은 빈 상태로 동작).");
}

const content = renderHeadersFile(buildHeaderRules({ supabaseOrigin }), [
  'scripts/write-headers.mjs가 빌드 때 생성 — 직접 고치지 말 것. 정책과 이유: docs/SECURITY.md §7',
  `mode=${mode}, connect-src: ${supabaseOrigin ? "'self' + Supabase origin" : "'self'만"}`,
]);
writeFileSync(join(outDir, HEADERS_FILE_NAME), content, 'utf8');
console.log(`[headers] ${label}/${HEADERS_FILE_NAME} 작성${supabaseOrigin ? ` (connect-src에 ${supabaseOrigin} 포함)` : ''}`);
