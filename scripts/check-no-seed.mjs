#!/usr/bin/env node
/**
 * 프로덕션 빌드에 개발용 mock seed가 섞이지 않았는지 검사한다.
 *
 *   node scripts/check-no-seed.mjs [검사할 디렉터리=dist]
 *
 * - scripts/seed-needles.json의 마커(HANPAN_DEV_SEED_MARKER)와 seed 고유 문자열을 찾는다.
 * - 번들러가 한글을 \uXXXX로 이스케이프하는 경우도 함께 검사한다.
 * - 하나라도 발견되거나 디렉터리가 없으면 exit 1.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');
const targetDir = resolve(projectRoot, process.argv[2] ?? 'dist');

const needlesFile = join(scriptDir, 'seed-needles.json');
const { marker, uniqueStrings } = JSON.parse(readFileSync(needlesFile, 'utf8'));
const needles = [marker, ...uniqueStrings].filter((value) => typeof value === 'string' && value.length > 0);

/** 비ASCII 문자를 JS 이스케이프로 바꾼 변형 (소문자/대문자 16진수) */
function escapedVariants(value) {
  const escape = (upper) =>
    Array.from(value)
      .map((char) => {
        const code = char.codePointAt(0);
        if (code < 0x80) return char;
        const hex = code.toString(16).padStart(4, '0');
        return `\\u${upper ? hex.toUpperCase() : hex}`;
      })
      .join('');
  return [...new Set([value, escape(false), escape(true)])];
}

const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.css', '.html', '.json', '.map', '.txt', '.svg', '.xml', '']);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) yield* walk(fullPath);
    else yield fullPath;
  }
}

function extensionOf(file) {
  const base = file.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

if (!existsSync(targetDir) || !statSync(targetDir).isDirectory()) {
  console.error(`[check:seed] 검사할 디렉터리가 없습니다: ${targetDir}`);
  console.error('[check:seed] 먼저 `npm run build`를 실행하세요.');
  process.exit(1);
}

const variants = needles.map((needle) => ({ needle, forms: escapedVariants(needle) }));
const findings = [];
let scanned = 0;

for (const file of walk(targetDir)) {
  if (!TEXT_EXTENSIONS.has(extensionOf(file))) continue;
  scanned += 1;
  const content = readFileSync(file, 'utf8');
  for (const { needle, forms } of variants) {
    if (forms.some((form) => content.includes(form))) {
      findings.push({ file: relative(projectRoot, file), needle });
    }
  }
}

if (findings.length > 0) {
  console.error(`[check:seed] 실패: 빌드 결과에서 개발용 seed 흔적 ${findings.length}건을 찾았습니다.`);
  for (const { file, needle } of findings) console.error(`  - ${file}: "${needle}"`);
  console.error('[check:seed] mock 어댑터가 정적으로 import 되었는지 src/data/index.ts를 확인하세요.');
  process.exit(1);
}

console.log(`[check:seed] 통과: ${relative(projectRoot, targetDir) || '.'}의 파일 ${scanned}개에서 seed 흔적이 없습니다.`);
