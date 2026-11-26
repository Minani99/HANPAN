import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// npm run test:tz(scripts/test-tz.mjs): 정한 시스템 시간대가 실제로 적용됐는지 확인한다(원래 시간대로 헛도는 실행 방지).
const expectedTimeZone = process.env.HANPAN_TEST_TZ;
if (expectedTimeZone) {
  const actualTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (actualTimeZone !== expectedTimeZone) {
    throw new Error(`[test:tz] 시스템 시간대가 ${expectedTimeZone}이어야 하는데 ${actualTimeZone}입니다.`);
  }
}

afterEach(() => {
  cleanup();
});

// jsdom에 없는 브라우저 API 보완 (테스트 전용)
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
