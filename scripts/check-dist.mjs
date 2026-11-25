#!/usr/bin/env node
/**
 * 배포 산출물 점검(Cloudflare Pages 기준). `npm run verify`가 build·check:seed 뒤에 실행한다.
 *
 *   node scripts/check-dist.mjs [검사할 폴더=dist] [--mode production]
 *
 * 실패(exit 1)
 * 1. 최상위 404.html 있음 — Pages가 SPA 폴백을 끈다(딥링크·새로고침이 404).
 * 2. _redirects 있음 — `/* /index.html 200`은 Pages가 무한 루프 규칙으로 보고 무시한다(SPA 폴백은 404.html이 없을 때 기본 동작).
 * 3. _headers 없음·형식 오류·보안 헤더 누락, CSP가 현재 env(VITE_SUPABASE_URL)로 만든 값과 다름.
 * 4. index.html에 인라인 <script>·<style>·style 속성·on* 이벤트 속성(CSP script-src/style-src 'self'와 충돌).
 * 5. 실제 비밀 키처럼 보이는 값: `sb_secret_` 키, payload role이 anon이 아닌 JWT. (키 가드 코드의 문자열 자체는 허용)
 * 6. robots.txt 없음.
 * 정보로만 출력: 'service_role' 문자열이 들어 있는 파일(키 가드 코드여야 한다 — docs/SECURITY.md §4).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import {
  HEADERS_FILE_NAME,
  buildCsp,
  headersForPath,
  parseHeadersFile,
  parseSupabaseOrigin,
} from './lib/security-headers.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const modeIndex = args.indexOf('--mode');
const mode = modeIndex === -1 ? 'production' : args[modeIndex + 1];
if (!mode || mode.startsWith('--')) {
  console.error('[check:dist] --mode 값이 없습니다.');
  process.exit(1);
}
const positional = args.filter((arg, index) => !arg.startsWith('--') && (modeIndex === -1 || index !== modeIndex + 1));
const targetDir = resolve(projectRoot, positional[0] ?? 'dist');
const label = relative(projectRoot, targetDir) || '.';

const failures = [];
const notes = [];

if (!existsSync(targetDir) || !statSync(targetDir).isDirectory()) {
  console.error(`[check:dist] 검사할 폴더가 없습니다: ${label} — 먼저 npm run build를 실행하세요.`);
  process.exit(1);
}

// 1·2. Cloudflare Pages SPA 조건
if (existsSync(join(targetDir, '404.html'))) failures.push('404.html이 있습니다(Pages SPA 폴백이 꺼짐).');
if (existsSync(join(targetDir, '_redirects'))) failures.push('_redirects가 있습니다(SPA 폴백은 404.html이 없을 때 Pages 기본 동작 — 규칙이 필요 없다).');

// 3. 보안 헤더
const REQUIRED_PAGE_HEADERS = [
  'Content-Security-Policy',
  'X-Content-Type-Options',
  'Referrer-Policy',
  'Permissions-Policy',
  'X-Frame-Options',
  'Cross-Origin-Opener-Policy',
  'Strict-Transport-Security',
];
const headersFile = join(targetDir, HEADERS_FILE_NAME);
if (!existsSync(headersFile)) {
  failures.push(`${HEADERS_FILE_NAME}가 없습니다(npm run build가 scripts/write-headers.mjs로 만든다).`);
} else {
  try {
    const rules = parseHeadersFile(readFileSync(headersFile, 'utf8'));
    const page = headersForPath(rules, '/meetings/00000000-0000-4000-8000-000000000000');
    for (const name of REQUIRED_PAGE_HEADERS) if (!page[name]) failures.push(`${HEADERS_FILE_NAME}: 페이지 응답에 ${name}가 없습니다.`);
    const env = loadEnv(mode, projectRoot, 'VITE_');
    const expected = buildCsp(parseSupabaseOrigin(env.VITE_SUPABASE_URL));
    if (page['Content-Security-Policy'] && page['Content-Security-Policy'] !== expected) {
      failures.push(`${HEADERS_FILE_NAME}: CSP가 현재 env(mode=${mode})로 만든 값과 다릅니다. 같은 env로 다시 빌드하세요.`);
    }
    const asset = headersForPath(rules, '/assets/x.js');
    if (!/immutable/.test(asset['Cache-Control'] ?? '')) failures.push(`${HEADERS_FILE_NAME}: /assets/*에 Cache-Control immutable이 없습니다.`);
    notes.push(`connect-src: ${expected.split('; ').find((part) => part.startsWith('connect-src'))}`);
  } catch (error) {
    failures.push(`${HEADERS_FILE_NAME}를 해석하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// 4. index.html 인라인 코드
const indexFile = join(targetDir, 'index.html');
if (!existsSync(indexFile)) {
  failures.push('index.html이 없습니다.');
} else {
  const html = readFileSync(indexFile, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const inlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(
    ([, attrs, body]) => !/\bsrc\s*=/.test(attrs) || body.trim() !== '',
  );
  if (inlineScripts.length > 0) failures.push(`index.html에 인라인 <script> ${inlineScripts.length}개(CSP script-src 'self'에 막힘).`);
  if (/<style\b/i.test(html)) failures.push("index.html에 <style> 블록이 있습니다(CSP style-src에 'unsafe-inline' 없음).");
  if (/\sstyle\s*=/i.test(html)) failures.push('index.html에 style 속성이 있습니다.');
  if (/\son[a-z]+\s*=/i.test(html)) failures.push('index.html에 on* 이벤트 속성이 있습니다.');
}

// 5. 비밀 값
const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.css', '.html', '.json', '.map', '.txt', '.svg', '.xml', '']);
function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) yield* walk(fullPath);
    else yield fullPath;
  }
}
function decodeJwtRole(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload?.role === 'string' ? payload.role : '(role 없음)';
  } catch {
    return null;
  }
}
const serviceRoleFiles = [];
let scanned = 0;
let anonJwts = 0;
for (const file of walk(targetDir)) {
  const base = file.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  const ext = dot <= 0 ? '' : base.slice(dot).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext)) continue;
  scanned += 1;
  const rel = relative(projectRoot, file).replace(/\\/g, '/');
  const content = readFileSync(file, 'utf8');
  if (/sb_secret_[A-Za-z0-9_-]{8,}/.test(content)) failures.push(`${rel}: sb_secret_ 키 값으로 보이는 문자열이 있습니다.`);
  for (const [token] of content.matchAll(/eyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g)) {
    const role = decodeJwtRole(token);
    if (role === 'anon') anonJwts += 1;
    else if (role !== null) failures.push(`${rel}: role=${role}인 JWT가 있습니다(anon 키만 허용).`);
  }
  if (content.includes('service_role')) serviceRoleFiles.push(rel);
}
notes.push(`검사한 텍스트 파일 ${scanned}개, anon JWT ${anonJwts}개`);
notes.push(`'service_role' 문자열이 있는 파일(키 가드 코드여야 함): ${serviceRoleFiles.length > 0 ? serviceRoleFiles.join(', ') : '없음'}`);

// 6. robots.txt
if (!existsSync(join(targetDir, 'robots.txt'))) failures.push('robots.txt가 없습니다(public/robots.txt).');

if (failures.length > 0) {
  console.error(`[check:dist] 실패(${label}, mode=${mode}): ${failures.length}건`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`[check:dist] 통과: ${label} (mode=${mode})`);
for (const note of notes) console.log(`  - ${note}`);
