#!/usr/bin/env node
/**
 * 운영 빌드 변형 검증(배포 전 1회 또는 빌드 설정을 바꿨을 때). `npm run check:builds`
 *
 * 임시 폴더(node_modules/.tmp/hanpan-builds/)에 운영 모드(production)로 빌드하고 끝나면 지운다. 로컬 .env.local 값과 무관하게
 * VITE_SUPABASE_URL·VITE_SUPABASE_ANON_KEY를 매번 명시한다(빈 문자열 = 설정 없음). 실제 Supabase에는 접속하지 않는다.
 *
 * 1. env 없음        → 빌드 성공, check:seed 통과, check:dist 통과(connect-src 'self'만), 앱은 unconfigured(빈 상태)
 * 2. 가짜 Supabase env(https://example-ref.supabase.co + 가짜 anon JWT)
 *                    → 빌드 성공, check:seed·check:dist 통과(connect-src에 그 origin), 번들에 그 URL이 들어감
 * 3. 막혀야 하는 env  → 빌드 실패: service_role 형태 JWT, sb_secret_ 키, SERVICE_ROLE이 들어간 VITE_ 변수 이름(키 가드),
 *                      http:// URL·경로가 있는 URL(보안 헤더 생성)
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FAKE_SUPABASE_URL,
  PROJECT_ROOT,
  TMP_ROOT,
  buildVariant,
  fakeSupabaseJwt,
  removeDir,
} from './lib/build-variant.mjs';

const WORK_DIR = join(TMP_ROOT, 'hanpan-builds');
const NO_SUPABASE = { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' };
const results = [];

function runNode(script, scriptArgs, env) {
  const child = spawnSync(process.execPath, [join(PROJECT_ROOT, 'scripts', script), ...scriptArgs], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { ok: child.status === 0, output: `${child.stdout ?? ''}${child.stderr ?? ''}`.trim() };
}

function record(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? '통과' : '실패'}  ${name}${detail ? `\n      ${detail.split('\n').join('\n      ')}` : ''}`);
}

/** @param {string | RegExp} needle */
function bundleContains(dir, needle) {
  return readdirSync(join(dir, 'assets')).some((file) => {
    if (!file.endsWith('.js')) return false;
    const content = readFileSync(join(dir, 'assets', file), 'utf8');
    return typeof needle === 'string' ? content.includes(needle) : needle.test(content);
  });
}

function expectBuildOk(name, env) {
  const outDir = join(WORK_DIR, name);
  const build = buildVariant({ mode: 'production', outDir, env });
  if (!build.ok) {
    record(`${name}: 빌드`, false, `${build.step} 실패\n${build.output}`);
    return null;
  }
  record(`${name}: 빌드(vite build + write-headers)`, true, build.output.split('\n').filter((l) => l.startsWith('[headers]')).join('\n'));
  const seed = runNode('check-no-seed.mjs', [outDir], env);
  record(`${name}: check:seed`, seed.ok, seed.output);
  const dist = runNode('check-dist.mjs', [outDir, '--mode', 'production'], env);
  record(`${name}: check:dist`, dist.ok, dist.output);
  return outDir;
}

function expectBuildFails(name, env, step, pattern) {
  const build = buildVariant({ mode: 'production', outDir: join(WORK_DIR, name), env });
  const ok = !build.ok && build.step === step && pattern.test(build.output);
  record(`${name}: ${step}에서 실패해야 함`, ok, ok ? (build.output.match(pattern)?.[0] ?? '') : `결과: ${build.ok ? '성공' : `${build.step} 실패`}\n${build.output}`);
}

removeDir(WORK_DIR);
try {
  // 1. env 없음
  const plain = expectBuildOk('no-env', NO_SUPABASE);
  if (plain) {
    const headers = readFileSync(join(plain, '_headers'), 'utf8');
    record("no-env: _headers connect-src가 'self'만", /connect-src 'self'; /.test(headers));
    // supabase-js 자체에 '*.supabase.co' 문자열이 있으므로 https://<ref>.supabase.co 형태만 본다
    record('no-env: 번들에 Supabase 프로젝트 URL 없음', !bundleContains(plain, /https:\/\/[a-z0-9-]+\.supabase\.co/));
  }

  // 2. 가짜 Supabase env
  const fakeEnv = { VITE_SUPABASE_URL: FAKE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY: fakeSupabaseJwt('anon') };
  const configured = expectBuildOk('fake-supabase', fakeEnv);
  if (configured) {
    const headers = readFileSync(join(configured, '_headers'), 'utf8');
    record(`fake-supabase: _headers connect-src에 ${FAKE_SUPABASE_URL}`, headers.includes(`connect-src 'self' ${FAKE_SUPABASE_URL};`));
    record('fake-supabase: 번들에 Supabase URL이 들어감(supabase 모드)', bundleContains(configured, FAKE_SUPABASE_URL));
  }

  // 3. 막혀야 하는 설정
  expectBuildFails(
    'service-role-jwt',
    { VITE_SUPABASE_URL: FAKE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY: fakeSupabaseJwt('service_role') },
    'vite build',
    /service_role 키로 보입니다[^\n]*빌드를 중단합니다/,
  );
  expectBuildFails(
    'secret-key',
    { VITE_SUPABASE_URL: FAKE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY: 'sb_secret_FAKEFAKEFAKEFAKE' },
    'vite build',
    /secret 키\(sb_secret_\)로 보입니다[^\n]*빌드를 중단합니다/,
  );
  expectBuildFails(
    'service-role-env-name',
    { ...NO_SUPABASE, VITE_SUPABASE_SERVICE_ROLE_KEY: 'fake-value' },
    'vite build',
    /VITE_SUPABASE_SERVICE_ROLE_KEY[^\n]*빌드를 중단합니다/,
  );
  expectBuildFails(
    'http-url',
    { VITE_SUPABASE_URL: 'http://example-ref.supabase.co', VITE_SUPABASE_ANON_KEY: fakeSupabaseJwt('anon') },
    'write-headers',
    /https:\/\/ 주소여야 합니다/,
  );
  expectBuildFails(
    'url-with-path',
    { VITE_SUPABASE_URL: `${FAKE_SUPABASE_URL}/rest/v1`, VITE_SUPABASE_ANON_KEY: fakeSupabaseJwt('anon') },
    'write-headers',
    /경로·쿼리 없이 origin만/,
  );
} finally {
  removeDir(WORK_DIR);
}

const failed = results.filter((result) => !result.ok);
console.log(`\n[check:builds] ${results.length - failed.length}/${results.length} 통과${failed.length ? ` — 실패 ${failed.length}건` : ''} (임시 폴더 삭제함)`);
process.exit(failed.length ? 1 : 0);
