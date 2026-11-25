/**
 * 로그인 후 돌아갈 내부 경로(returnTo).
 * - sessionStorage `hanpan.returnTo`에만 저장한다(탭 단위, 브라우저를 닫으면 사라짐).
 * - 열린 리디렉션을 막기 위해 같은 사이트의 경로만 허용한다(docs/SECURITY.md).
 * - 사용한 뒤 즉시 지운다.
 */

export const RETURN_TO_STORAGE_KEY = 'hanpan.returnTo';

/** 로그인 흐름 자체로는 돌아가지 않는다(무한 반복 방지). */
const BLOCKED_PATHS = ['/login', '/auth/callback'];

const MAX_RETURN_TO_LENGTH = 2048;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * 안전한 내부 경로면 정규화한 값을, 아니면 null을 돌려준다.
 * 허용: '/'로 시작하는 경로(+쿼리·해시). 거부: '//', '/\\', 백슬래시·제어문자 포함, 외부 URL, 로그인 경로.
 */
export function parseReturnTo(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.length === 0 || value.length > MAX_RETURN_TO_LENGTH) return null;
  if (!value.startsWith('/')) return null;
  if (value.startsWith('//')) return null;
  if (value.includes('\\')) return null;
  if (CONTROL_CHARS.test(value)) return null;

  // 브라우저가 해석했을 때 같은 출처로 남는지 한 번 더 확인한다.
  const base = 'https://hanpan.invalid';
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    return null;
  }
  if (url.origin !== base) return null;

  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  if (BLOCKED_PATHS.some((blocked) => pathname === blocked || pathname.startsWith(`${blocked}/`))) return null;

  return `${url.pathname}${url.search}${url.hash}`;
}

/** parseReturnTo의 결과가 없으면 fallback('/') */
export function sanitizeReturnTo(value: unknown, fallback = '/'): string {
  return parseReturnTo(value) ?? fallback;
}

function getSessionStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/** 안전한 경로만 저장한다. 저장했으면 true */
export function saveReturnTo(value: string): boolean {
  const safe = parseReturnTo(value);
  const storage = getSessionStorage();
  if (!safe || !storage) return false;
  try {
    storage.setItem(RETURN_TO_STORAGE_KEY, safe);
    return true;
  } catch {
    return false;
  }
}

/** 저장된 값을 지우지 않고 읽는다(검증 후). */
export function peekReturnTo(): string | null {
  const storage = getSessionStorage();
  if (!storage) return null;
  try {
    return parseReturnTo(storage.getItem(RETURN_TO_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function clearReturnTo(): void {
  try {
    getSessionStorage()?.removeItem(RETURN_TO_STORAGE_KEY);
  } catch {
    // 저장소를 쓸 수 없는 환경이면 지울 것도 없다.
  }
}

/** 읽고 바로 지운다. 없거나 안전하지 않으면 fallback */
export function consumeReturnTo(fallback = '/'): string {
  const value = peekReturnTo();
  clearReturnTo();
  return value ?? fallback;
}
