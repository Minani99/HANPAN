import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * `npm run test:csp` 전역 정리: scripts/csp-preview.mjs가 만든 임시 빌드 폴더를 지운다.
 * (Windows에서는 webServer가 강제 종료되어 서버 쪽 정리 코드가 돌지 않을 수 있다)
 */
export default function cspTeardown() {
  rmSync(resolve(import.meta.dirname, '..', 'node_modules', '.tmp', 'hanpan-csp'), {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
