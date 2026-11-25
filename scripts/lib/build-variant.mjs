/**
 * 임시 폴더에 빌드 변형을 만드는 도우미(CSP 스모크 테스트 서버, 빌드 검증 스크립트가 함께 쓴다).
 *
 * `npm run build`와 같은 순서(vite build → scripts/write-headers.mjs)를 같은 CLI로 실행한다. 타입 검사(tsc -b)는 하지 않는다.
 * 환경 변수는 자식 프로세스에만 넘긴다(실행 환경이 .env 파일보다 우선 — Vite loadEnv 규칙). 로컬 .env.local 값에 흔들리지 않도록
 * 호출하는 쪽이 VITE_SUPABASE_URL·VITE_SUPABASE_ANON_KEY를 항상 명시한다(빈 문자열 = 설정 없음).
 * 출력 폴더는 node_modules/.tmp 아래(Git 제외)이며, 끝나면 removeDir로 지운다.
 */
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const TMP_ROOT = join(PROJECT_ROOT, 'node_modules', '.tmp');
const VITE_BIN = join(PROJECT_ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const WRITE_HEADERS = join(PROJECT_ROOT, 'scripts', 'write-headers.mjs');

/** 명백한 가짜 Supabase 주소(테스트 전용 — 실제 프로젝트가 아니다) */
export const FAKE_SUPABASE_URL = 'https://example-ref.supabase.co';

function base64url(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/**
 * 키 가드 확인용 가짜 JWT. 서명 자리는 'fake-signature'를 인코딩한 값이라 어디에서도 유효하지 않다.
 * @param {'anon' | 'service_role'} role
 */
export function fakeSupabaseJwt(role) {
  const header = base64url({ alg: 'HS256', typ: 'JWT' });
  const payload = base64url({ iss: 'hanpan-fake', ref: 'example-ref', role, note: 'FAKE KEY FOR TESTS - NOT REAL' });
  return `${header}.${payload}.${Buffer.from('fake-signature').toString('base64url')}`;
}

/**
 * @param {{ mode: string, outDir: string, env: Record<string, string>, quiet?: boolean }} options
 * @returns {{ ok: boolean, step: 'vite build' | 'write-headers' | null, output: string }}
 */
export function buildVariant({ mode, outDir, env, quiet = true }) {
  const childEnv = { ...process.env, ...env };
  const stdio = quiet ? 'pipe' : 'inherit';
  const build = spawnSync(
    process.execPath,
    [VITE_BIN, 'build', '--mode', mode, '--outDir', outDir, '--emptyOutDir', '--logLevel', 'warn'],
    { cwd: PROJECT_ROOT, env: childEnv, stdio, encoding: 'utf8' },
  );
  const buildOutput = `${build.stdout ?? ''}${build.stderr ?? ''}`;
  if (build.status !== 0) return { ok: false, step: 'vite build', output: buildOutput };
  const headers = spawnSync(process.execPath, [WRITE_HEADERS, '--mode', mode, '--out-dir', outDir], {
    cwd: PROJECT_ROOT,
    env: childEnv,
    stdio,
    encoding: 'utf8',
  });
  const output = `${buildOutput}${headers.stdout ?? ''}${headers.stderr ?? ''}`;
  if (headers.status !== 0) return { ok: false, step: 'write-headers', output };
  return { ok: true, step: null, output };
}

/** 임시 폴더 삭제(Windows에서 잠깐 잠긴 파일이 있으면 몇 번 다시 시도) */
export function removeDir(dir) {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
