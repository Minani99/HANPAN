/**
 * Zod 전역 설정 — main.tsx가 다른 모든 모듈보다 먼저 불러온다(첫 import).
 *
 * jitless: Zod 4는 객체 스키마를 만들 때 `new Function("")`으로 eval 가능 여부를 시험하고, 되면 코드를 생성해 빠르게 검사한다.
 * 운영 CSP는 script-src 'self'(unsafe-eval 없음)라 이 시험이 막히고, 예외는 Zod가 삼켜도 브라우저는
 * CSP 위반(securitypolicyviolation)으로 기록한다. 시험 자체를 하지 않도록 끈다(검사 결과는 같고 속도만 조금 느리다).
 * 스키마가 처음 만들어지기 전에 설정해야 하므로 이 파일은 main.tsx의 맨 앞에서만 import 한다.
 * 근거: docs/SECURITY.md §7, CSP 스모크 테스트 `npm run test:csp`.
 */
import { config } from 'zod';

config({ jitless: true });
