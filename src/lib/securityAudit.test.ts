import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 소스 보안 감사(Phase 5, docs/SECURITY.md §14). 앱 코드(src, 테스트 제외)를 읽어 금지 패턴을 찾는다.
 * 주석은 지우고 검사한다(설명 주석에 'dangerouslySetInnerHTML 금지' 같은 문구가 있다).
 * 빌드 결과(dist) 쪽 점검은 scripts/check-dist.mjs(npm run check:dist).
 */

const SRC = join(import.meta.dirname, '..');
const ROOT = join(SRC, '..');

interface SourceFile {
  rel: string;
  code: string;
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === 'test') continue; // 테스트 도우미
      yield* walk(path);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      yield path;
    }
  }
}

/** 블록 주석과 줄 주석을 지운다(`https://`처럼 콜론 뒤의 //는 남긴다). 문자열 안의 주석 모양은 고려하지 않는 단순 처리 */
function stripComments(source: string): string {
  // 블록 주석은 줄 수를 유지한 채 지운다(보고하는 줄 번호가 원본과 같도록)
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ''))
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

const FILES: SourceFile[] = [...walk(SRC)].map((path) => ({
  rel: relative(SRC, path).replace(/\\/g, '/'),
  code: stripComments(readFileSync(path, 'utf8')),
}));

function offenders(pattern: RegExp, allow: (rel: string) => boolean = () => false): string[] {
  const found: string[] = [];
  for (const file of FILES) {
    if (allow(file.rel)) continue;
    file.code.split('\n').forEach((line, index) => {
      if (pattern.test(line)) found.push(`${file.rel}:${index + 1}`);
    });
  }
  return found;
}

describe('소스 보안 감사 (src, 테스트 제외)', () => {
  it('검사 대상 파일을 읽었다', () => {
    expect(FILES.length).toBeGreaterThan(100);
    expect(FILES.some((file) => file.rel === 'data/supabase/keyGuard.ts')).toBe(true);
  });

  it('HTML 문자열 삽입·동적 코드 실행이 없다: dangerouslySetInnerHTML, innerHTML/outerHTML, insertAdjacentHTML, document.write, eval, new Function, 문자열 setTimeout', () => {
    expect(offenders(/dangerouslySetInnerHTML/)).toEqual([]);
    expect(offenders(/\.(innerHTML|outerHTML)\b/)).toEqual([]);
    expect(offenders(/insertAdjacentHTML|document\.write/)).toEqual([]);
    expect(offenders(/(^|[^.\w])eval\s*\(/)).toEqual([]);
    expect(offenders(/new\s+Function\b/)).toEqual([]);
    expect(offenders(/set(Timeout|Interval)\(\s*['"`]/)).toEqual([]);
  });

  it("service_role·sb_secret_ 문자열은 키 가드(data/supabase/keyGuard.ts) 코드에만 있다", () => {
    expect(offenders(/service_role|sb_secret_/i, (rel) => rel === 'data/supabase/keyGuard.ts')).toEqual([]);
  });

  it('console.*는 devConsole 밖에서 쓰지 않는다', () => {
    expect(offenders(/\bconsole\.\w+/, (rel) => rel === 'lib/devConsole.ts')).toEqual([]);
  });

  it('localStorage는 mock 어댑터(개발·e2e 전용)만 쓴다 — supabase 모드에서 앱이 직접 저장하는 데이터 없음(세션은 supabase-js 기본 저장소)', () => {
    expect(offenders(/localStorage/, (rel) => rel.startsWith('data/mock/'))).toEqual([]);
  });

  it('sessionStorage는 로그인 후 복귀 경로(lib/returnTo.ts)만 쓴다', () => {
    expect(offenders(/sessionStorage/, (rel) => rel === 'lib/returnTo.ts')).toEqual([]);
  });

  it('외부 사이트로 가는 새 창 링크는 ExternalLink(https만·noopener noreferrer)에서만 만든다 — 그 밖의 target=_blank는 내부 경로 Link만', () => {
    const newWindow = offenders(/target=["{]['"]?_blank/, (rel) => rel === 'components/ui/ExternalLink.tsx');
    const notInternal = newWindow.filter((at) => {
      const [rel, line] = at.split(':');
      const code = FILES.find((file) => file.rel === rel)?.code.split('\n')[Number(line) - 1] ?? '';
      return !/<Link\s+to="\//.test(code);
    });
    expect(notInternal).toEqual([]);
  });
});

describe('공개 환경 변수(VITE_) 목록이 코드와 문서에서 같다', () => {
  const namesIn = (text: string) => new Set([...text.matchAll(/\bVITE_[A-Z0-9_]+\b/g)].map((match) => match[0]));
  const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
  // 문서에 '넣으면 안 되는 예'로만 나오는 이름
  const FORBIDDEN_EXAMPLES = new Set(['VITE_SUPABASE_SERVICE_ROLE_KEY']);

  const used = new Set(FILES.flatMap((file) => [...namesIn(file.code)]));
  const declared = namesIn(read('src/vite-env.d.ts'));

  it('코드가 쓰는 이름 = vite-env.d.ts 선언 = .env.example', () => {
    expect([...used].sort()).toEqual(['VITE_AUTH_KAKAO_ENABLED', 'VITE_SITE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_SUPABASE_URL']);
    expect([...declared].sort()).toEqual([...used].sort());
    expect([...namesIn(read('.env.example'))].sort()).toEqual([...used].sort());
  });

  it.each(['README.md', 'docs/ARCHITECTURE.md', 'docs/DEPLOYMENT.md'])('%s: 모든 이름을 설명하고, 없는 이름은 금지 예시뿐', (path) => {
    const names = namesIn(read(path));
    for (const name of used) expect(names.has(name), `${path}에 ${name} 설명 없음`).toBe(true);
    const extra = [...names].filter((name) => !used.has(name) && !FORBIDDEN_EXAMPLES.has(name));
    expect(extra).toEqual([]);
  });
});
