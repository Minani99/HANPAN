#!/usr/bin/env node
/**
 * 단위·컴포넌트 테스트(`npm run test`)를 다른 시스템 시간대로 한 번 더 돌린다. `npm run test:tz`
 *
 *   npm run test:tz                              → America/Los_Angeles(기본)
 *   npm run test:tz -- UTC Pacific/Kiritimati    → 적은 시간대를 차례로
 *
 * 앱은 기기 시간대와 관계없이 KST로 계산·표시해야 한다(src/lib/date.ts). CI 러너(GitHub Actions ubuntu)는 UTC라
 * `npm run test`가 UTC를 확인하고, 이 스크립트는 KST와 날짜가 가장 자주 어긋나는 시간대(UTC-8/-7, 서머타임 있음)를 확인한다.
 *
 * Git Bash에서 `TZ=America/Los_Angeles npm run test`처럼 쓰지 않는다. MSYS가 '/'가 든 TZ 값을 Windows 프로그램에
 * 넘기지 않아 아무 표시 없이 원래 시간대(KST)로 돈다(`TZ=UTC`는 넘어간다 — 2026-11-25 확인).
 * 이 스크립트는 Node가 자식 프로세스 env로 TZ를 직접 넘기고, 시간대가 실제로 적용됐는지 먼저 확인한다
 * (모르는 이름은 Node가 오류 없이 'Etc/Unknown'(UTC)으로 처리한다). 테스트 안에서도 src/test/setup.ts가 HANPAN_TEST_TZ와
 * 실제 시간대를 비교한다.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VITEST_BIN = join(PROJECT_ROOT, 'node_modules', 'vitest', 'vitest.mjs');
const DEFAULT_TIME_ZONES = ['America/Los_Angeles'];

const args = process.argv.slice(2);
const unknownFlags = args.filter((arg) => arg.startsWith('-'));
if (unknownFlags.length > 0) {
  console.error(`[test:tz] 시간대 이름(IANA)만 받습니다: ${unknownFlags.join(' ')}`);
  process.exit(1);
}
const timeZones = args.length > 0 ? args : DEFAULT_TIME_ZONES;

const PROBE = [
  'process.stdout.write(JSON.stringify({',
  '  zone: Intl.DateTimeFormat().resolvedOptions().timeZone,',
  "  january: new Date('2026-01-15T00:00:00Z').getTimezoneOffset(),",
  "  july: new Date('2026-07-15T00:00:00Z').getTimezoneOffset(),",
  '}))',
].join('\n');

/** 자식 프로세스에서 TZ가 실제로 적용되는지 확인한다. */
function probe(timeZone) {
  const child = spawnSync(process.execPath, ['-e', PROBE], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, TZ: timeZone },
    encoding: 'utf8',
  });
  if (child.status !== 0) return { ok: false, detail: `${child.stdout ?? ''}${child.stderr ?? ''}`.trim() };
  const result = JSON.parse(child.stdout);
  return { ok: result.zone === timeZone, detail: `${result.zone}, UTC 오프셋(분) 1월 ${-result.january} / 7월 ${-result.july}` };
}

const results = [];
for (const timeZone of timeZones) {
  const check = probe(timeZone);
  if (!check.ok) {
    console.error(`[test:tz] ${timeZone}: 자식 프로세스에 시간대가 적용되지 않습니다(${check.detail}). IANA 이름을 확인하세요.`);
    results.push({ timeZone, ok: false });
    continue;
  }
  console.log(`\n[test:tz] ${timeZone} (${check.detail})로 단위·컴포넌트 테스트 실행`);
  const run = spawnSync(process.execPath, [VITEST_BIN, 'run'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, TZ: timeZone, HANPAN_TEST_TZ: timeZone },
    stdio: 'inherit',
  });
  results.push({ timeZone, ok: run.status === 0 });
}

console.log('');
for (const { timeZone, ok } of results) console.log(`[test:tz] ${ok ? '통과' : '실패'}  ${timeZone}`);
process.exit(results.every((result) => result.ok) ? 0 : 1);
