/**
 * 외부 링크(공간 홈페이지·예약 페이지) 안전 확인 (docs/SECURITY.md §6).
 * DB check가 이미 `https://`만 저장하지만, 화면에 링크를 만들기 전에 한 번 더 확인한다.
 * - https: 프로토콜만(javascript:, data:, http: 등은 링크로 만들지 않는다)
 * - 호스트가 있어야 하고, 사용자 정보(user:pass@)가 들어간 주소는 거부한다(피싱용 위장 방지)
 * - 길이 500자 이하(DB와 같은 한도)
 * 통과하면 URL 파서가 정규화한 주소를, 아니면 null을 돌려준다.
 */
export const EXTERNAL_URL_MAX_LENGTH = 500;

export function safeExternalUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > EXTERNAL_URL_MAX_LENGTH) return null;
  if (!/^https:\/\//i.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname === '' || url.username !== '' || url.password !== '') return null;
  return url.href;
}

/** 링크에 보여줄 짧은 호스트 이름(예: 'example.com'). 안전하지 않으면 null */
export function externalUrlHost(value: string | null | undefined): string | null {
  const safe = safeExternalUrl(value);
  return safe ? new URL(safe).hostname.replace(/^www\./, '') : null;
}
