/**
 * 개발 모드 전용 콘솔 출력. 운영 빌드에서는 import.meta.env.DEV가 false로 치환되어 아무것도 출력하지 않는다.
 * 앱 코드는 console.*를 직접 쓰지 않고 이 함수만 쓴다(src/lib/devConsole.test.ts가 검사).
 * 넘기지 말 것: 토큰·인가 코드·이메일·신청 메시지·신고 본문·키 값 등 개인정보와 비밀 값(docs/SECURITY.md §11).
 */
export function devWarn(...args: unknown[]): void {
  if (import.meta.env.DEV) console.warn(...args);
}

export function devError(...args: unknown[]): void {
  if (import.meta.env.DEV) console.error(...args);
}
