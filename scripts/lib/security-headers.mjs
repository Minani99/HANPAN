/**
 * Cloudflare Pages 보안 헤더 파일(`_headers`) 생성·해석 — 순수 함수만 둔다(파일·환경 변수 접근 없음).
 *
 * 쓰는 곳
 * - scripts/write-headers.mjs: `npm run build`의 vite build 뒤에 dist/_headers를 쓴다.
 * - vite.config.ts: `vite preview`가 빌드 결과의 _headers를 Cloudflare Pages처럼 응답에 붙인다(CSP 스모크 테스트).
 * - scripts/check-dist.mjs: 빌드 결과 점검. scripts/security-headers.test.ts: 단위 테스트.
 *
 * 정책 근거는 docs/SECURITY.md §7. 항목을 바꾸면 문서와 테스트를 함께 고친다.
 */

export const HEADERS_FILE_NAME = '_headers';

/** Cloudflare Pages `_headers`의 한 줄 최대 길이(공식 문서 기준 2,000자) */
export const MAX_HEADERS_LINE_LENGTH = 2000;

/**
 * SUIT 글꼴(index.html의 jsDelivr 링크)이 있는 경로. CSS와 글꼴 파일이 모두 이 아래에 있다.
 * 호스트 전체(cdn.jsdelivr.net)가 아니라 SUIT 저장소 경로만 허용한다. 끝의 `/`는 "이 경로 아래 전부"라는 뜻이다.
 * 버전 표기(`SUIT@2` → `SUIT@2.x.y`)를 바꿔도 맞도록 저장소 경로까지만 적는다.
 */
export const FONT_CDN_SOURCE = 'https://cdn.jsdelivr.net/gh/sun-typeface/';

export class HeadersConfigError extends Error {
  /**
   * @param {string} message 사람이 읽을 안내(입력값은 넣지 않는다 — 제어 문자 등이 로그에 섞이지 않게)
   * @param {'not_https' | 'has_path' | 'format'} reason
   */
  constructor(message, reason) {
    super(message);
    this.name = 'HeadersConfigError';
    this.reason = reason;
  }
}

// 호스트 이름: 영문·숫자·하이픈 레이블을 점으로 잇는다(레이블 앞뒤 하이픈 금지). 포트는 선택.
const HOST_LABEL = '(?!-)[A-Za-z0-9-]{1,63}(?<!-)';
const STRICT_ORIGIN = new RegExp(`^https://${HOST_LABEL}(?:\\.${HOST_LABEL})*(?::(\\d{1,5}))?/?$`);

/**
 * VITE_SUPABASE_URL → CSP connect-src에 넣을 origin.
 * - 값이 없거나 공백뿐이면 null(설정 없음 → connect-src는 'self'만).
 * - 앞뒤 공백만 정리한다(앱의 src/lib/env.ts와 같은 처리). 가운데의 줄바꿈·공백·세미콜론·따옴표 등은 모두 거부한다.
 * - https만, 경로·쿼리·해시·사용자 정보 없이 `https://호스트[:포트]` (끝의 `/` 하나는 허용).
 * - 결과는 다시 조립한 origin이라 입력 문자열이 헤더에 그대로 들어가지 않는다.
 * @param {string | undefined | null} raw
 * @returns {string | null}
 * @throws {HeadersConfigError}
 */
export function parseSupabaseOrigin(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') throw new HeadersConfigError('VITE_SUPABASE_URL 형식이 올바르지 않습니다.', 'format');
  const value = raw.trim();
  if (value === '') return null;

  if (!/^https:\/\//i.test(value)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
      throw new HeadersConfigError('VITE_SUPABASE_URL은 https:// 주소여야 합니다(http 등은 허용하지 않음).', 'not_https');
    }
    throw new HeadersConfigError('VITE_SUPABASE_URL 형식이 올바르지 않습니다. 예: https://<project-ref>.supabase.co', 'format');
  }
  // 가운데의 공백·제어 문자(줄바꿈·탭 포함)와 헤더 구분 문자는 URL 해석 전에 거부한다(URL 파서는 탭·줄바꿈을 조용히 지운다).
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f;,'"`<>\\]/.test(value)) {
    throw new HeadersConfigError('VITE_SUPABASE_URL에 허용되지 않는 문자(공백·줄바꿈·세미콜론·따옴표 등)가 있습니다.', 'format');
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new HeadersConfigError('VITE_SUPABASE_URL 형식이 올바르지 않습니다. 예: https://<project-ref>.supabase.co', 'format');
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '' || /[?#]/.test(value)) {
    throw new HeadersConfigError('VITE_SUPABASE_URL에는 경로·쿼리 없이 origin만 넣어 주세요. 예: https://<project-ref>.supabase.co', 'has_path');
  }
  const match = STRICT_ORIGIN.exec(value);
  if (!match || url.username !== '' || url.password !== '') {
    throw new HeadersConfigError('VITE_SUPABASE_URL 형식이 올바르지 않습니다. 예: https://<project-ref>.supabase.co', 'format');
  }
  const port = match[1] === undefined ? null : Number(match[1]);
  if (port !== null && (port < 1 || port > 65535)) {
    throw new HeadersConfigError('VITE_SUPABASE_URL의 포트 번호가 올바르지 않습니다.', 'format');
  }
  return url.origin;
}

/**
 * CSP 지시어 목록. [지시어, 값 목록, 이유] — 이유는 문서·주석용(헤더에는 넣지 않는다).
 * @param {string | null} supabaseOrigin
 * @returns {Array<[string, string[], string]>}
 */
export function cspDirectives(supabaseOrigin) {
  return [
    ['default-src', ["'none'"], '아래에 적지 않은 종류(frame·worker·media·manifest·object 등)는 모두 막는다. 앱이 쓰지 않는다.'],
    ['script-src', ["'self'"], "번들 JS만. 인라인 스크립트·eval 없음(index.html·빌드 결과에 인라인 script 없음, Zod JIT는 꺼 둠)."],
    ['style-src', ["'self'", FONT_CDN_SOURCE], "번들 CSS + SUIT 글꼴 CSS. 인라인 <style>·style 속성 없음(React style prop은 CSSOM이라 해당 없음)."],
    ['font-src', [FONT_CDN_SOURCE], 'SUIT 글꼴 파일만. 자체 호스팅으로 바꾸면 이 줄을 \'self\'로 바꾼다.'],
    ['img-src', ["'self'"], '파비콘·public/images만. data: 이미지 사용처 없음, 모임 사진(외부 저장소)은 아직 없다.'],
    [
      'connect-src',
      supabaseOrigin ? ["'self'", supabaseOrigin] : ["'self'"],
      'Supabase REST·Auth(https)만. Realtime(wss)은 쓰지 않는다. 설정이 없으면 self만.',
    ],
    ['frame-ancestors', ["'none'"], '다른 사이트의 iframe 안에 넣지 못하게(클릭재킹).'],
    ['base-uri', ["'self'"], '<base> 주입으로 상대 경로를 바꾸지 못하게.'],
    ['form-action', ["'self'"], '폼 전송은 같은 출처만(앱 폼은 전송하지 않고 JS로 처리).'],
    ['object-src', ["'none'"], '플러그인 콘텐츠 금지(default-src와 별개로 명시).'],
  ];
}

/** @param {string | null} supabaseOrigin */
export function buildCsp(supabaseOrigin) {
  return cspDirectives(supabaseOrigin)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}

/**
 * `_headers` 규칙. 순서대로 쓰며, Cloudflare Pages는 경로에 맞는 규칙의 헤더를 모두 합쳐서 붙인다.
 * @param {{ supabaseOrigin: string | null }} options
 * @returns {Array<{ path: string, headers: Array<[string, string]> }>}
 */
export function buildHeaderRules({ supabaseOrigin }) {
  return [
    {
      path: '/*',
      headers: [
        ['Content-Security-Policy', buildCsp(supabaseOrigin)],
        // MIME 추측 금지(업로드 기능은 없지만 기본값으로 둔다)
        ['X-Content-Type-Options', 'nosniff'],
        // 다른 사이트로는 origin만 보낸다(외부 링크는 noreferrer도 붙인다)
        ['Referrer-Policy', 'strict-origin-when-cross-origin'],
        // 쓰지 않는 기기 권한은 모두 끈다(권한 요청 팝업이 뜰 일이 없게)
        ['Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'],
        // frame-ancestors를 모르는 오래된 브라우저용
        ['X-Frame-Options', 'DENY'],
        // 다른 출처 창과 window 참조를 끊는다. OAuth는 팝업이 아니라 전체 페이지 이동이라 영향 없음
        ['Cross-Origin-Opener-Policy', 'same-origin'],
        // HTTPS만. includeSubDomains·preload는 운영 도메인이 정해진 뒤 결정(docs/SECURITY.md §7)
        ['Strict-Transport-Security', 'max-age=31536000'],
      ],
    },
    {
      // Vite가 내용 해시를 붙인 파일만 있는 폴더. 이름이 바뀌면 다른 파일이므로 오래 캐시해도 된다.
      path: '/assets/*',
      headers: [['Cache-Control', 'public, max-age=31536000, immutable']],
    },
  ];
}

/**
 * 규칙 → `_headers` 파일 내용. 헤더 이름·값에 줄바꿈이 있거나 줄이 너무 길면 예외(헤더 조작 방지).
 * @param {Array<{ path: string, headers: Array<[string, string]> }>} rules
 * @param {string[]} [comments] 파일 맨 위 주석 줄
 */
export function renderHeadersFile(rules, comments = []) {
  const lines = comments.map((comment) => `# ${comment}`);
  for (const rule of rules) {
    if (!/^\/[A-Za-z0-9/*._-]*$/.test(rule.path)) throw new Error(`_headers 경로 형식이 올바르지 않습니다: ${rule.path}`);
    lines.push(rule.path);
    for (const [name, value] of rule.headers) {
      if (!/^[A-Za-z0-9-]+$/.test(name)) throw new Error(`헤더 이름 형식이 올바르지 않습니다: ${name}`);
      // eslint-disable-next-line no-control-regex
      if (/[\r\n\u0000]/.test(value)) throw new Error(`헤더 값에 줄바꿈이 있습니다: ${name}`);
      const line = `  ${name}: ${value}`;
      if (line.length > MAX_HEADERS_LINE_LENGTH) throw new Error(`헤더 줄이 ${MAX_HEADERS_LINE_LENGTH}자를 넘습니다: ${name}`);
      lines.push(line);
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * `_headers` 파일 해석(Cloudflare Pages 형식의 부분집합: 경로 줄 + 들여쓴 `이름: 값` 줄, `#` 주석).
 * @param {string} text
 * @returns {Array<{ path: string, headers: Array<[string, string]> }>}
 */
export function parseHeadersFile(text) {
  /** @type {Array<{ path: string, headers: Array<[string, string]> }>} */
  const rules = [];
  /** @type {{ path: string, headers: Array<[string, string]> } | null} */
  let current = null;
  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.trim() === '' || rawLine.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(rawLine)) {
      current = { path: rawLine.trim(), headers: [] };
      rules.push(current);
      continue;
    }
    if (!current) throw new Error('_headers: 경로 줄보다 헤더 줄이 먼저 나왔습니다.');
    const line = rawLine.trim();
    const colon = line.indexOf(':');
    if (colon <= 0) throw new Error(`_headers: "이름: 값" 형식이 아닌 줄이 있습니다: ${line.slice(0, 40)}`);
    current.headers.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()]);
  }
  return rules;
}

/** `/assets/*`처럼 `*`를 쓰는 경로 규칙이 pathname과 맞는지(`*`는 아무 글자나 0개 이상) */
export function pathMatches(pattern, pathname) {
  const regex = new RegExp(`^${pattern.split('*').map(escapeRegex).join('.*')}$`);
  return regex.test(pathname);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 경로에 붙을 헤더(맞는 규칙을 순서대로 합침, 같은 이름은 뒤 규칙이 덮어씀 — 우리 규칙에는 겹치는 이름이 없다).
 * @param {Array<{ path: string, headers: Array<[string, string]> }>} rules
 * @param {string} pathname
 * @returns {Record<string, string>}
 */
export function headersForPath(rules, pathname) {
  /** @type {Record<string, string>} */
  const result = {};
  for (const rule of rules) {
    if (!pathMatches(rule.path, pathname)) continue;
    for (const [name, value] of rule.headers) result[name] = value;
  }
  return result;
}

/**
 * CSP 문자열 → { 지시어: 값 목록 }
 * @param {string} csp
 * @returns {Record<string, string[]>}
 */
export function parseCsp(csp) {
  /** @type {Record<string, string[]>} */
  const result = {};
  for (const part of csp.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    const [name, ...values] = tokens;
    if (name) result[name.toLowerCase()] = values;
  }
  return result;
}
