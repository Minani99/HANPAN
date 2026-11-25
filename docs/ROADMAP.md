# 로드맵

상태: Phase 5 반영 (2026-11-25)

**현재: Phase 1~5의 코드·문서 작업 완료. 실제 Supabase·OAuth 연결, 동시 신청 경쟁 테스트, 프리뷰·운영 배포는 `BLOCKED:`(사용자 결정·콘솔 설정·승인 필요 — [NEXT_STEPS](./NEXT_STEPS.md) 출시 체크리스트).** 체크박스는 실제로 끝나고 검증된 항목만 표시한다(검증 수단을 함께 적음). 일정(날짜)은 약속하지 않는다.
관련 문서: [PRD](./PRD.md) · [TEST_PLAN](./TEST_PLAN.md) · [NEXT_STEPS](./NEXT_STEPS.md) · [BACKLOG](./BACKLOG.md) · [CHANGELOG](./CHANGELOG.md)

## Phase 0 — 저장소 점검·계획

작업
- [x] 저장소와 디자인 자료(v3 spec, design lab, claude prompt, 마스터 프롬프트) 확인
- [x] 문서 초안: PRD, ARCHITECTURE, DB_SCHEMA, UI_SPEC, SECURITY, TEST_PLAN, DEPLOYMENT, OPERATIONS, ROADMAP, BACKLOG, CHANGELOG, NEXT_STEPS, 약관·개인정보처리방침 초안 (검수 대기)
- [x] Vite + React + TS(strict) + Tailwind 프로젝트 구성, `.env.example`, `README.md` (`npm run verify`)
- [ ] 각 문서의 미결·`미확인:` 항목 검토와 결정 — DB_SCHEMA §16은 대부분 결정됨, 남은 항목·각 문서의 `미확인:`은 진행 중

완료 조건
- 위 문서가 `docs/`에 있고 서로 모순되지 않는다.
- `npm run typecheck`, `npm run build`가 빈 앱 기준으로 통과한다.
- 진행 계획과 주요 기술 리스크를 보고했다.

## Phase 1 — 프론트엔드 디자인 구현 (mock)

작업
- [x] 디자인 토큰(`@theme`), SUIT 폰트 로드, 포커스 스타일
- [x] 공통 컴포넌트: Button(Primary/Secondary/Text), Chip, Input/Select/Textarea, Dialog(포커스 트랩), Badge, Toast, Skeleton (컴포넌트 테스트)
- [x] 레이아웃: 헤더, 모바일 하단 내비(4칸), 푸터, 개발용 데이터 띠
- [x] 데이터 어댑터 인터페이스·팩토리·mock·unconfigured, `check:seed` 마커 (`npm run check:seed`)
- [x] 탐색 화면(날짜 스트립, 장르 칩, 모집 중만, 정렬, 검색, 목록, 더 보기, 빈·오류·로딩) (컴포넌트·E2E)
- [x] URL 쿼리 동기화(`src/lib/filters`)와 KST 날짜 유틸(`src/lib/date`) (단위, 여러 TZ)
- [x] 모임 상세(CTA 상태표 전체), 생성·수정 폼, 내 모임 (컴포넌트·E2E)
- [x] 320·375·390·768·1280·1440px 스크린샷과 v3 시안 비교 자료(`docs/screenshots/`). 육안 비교 결과의 최종 검수는 사용자 몫

완료 조건
- [UI_SPEC](./UI_SPEC.md) §3.3의 의도적 차이 외에는 시안과 일치한다.
- 6개 뷰포트에서 가로 오버플로가 없다(E2E).
- 필터·KST·meetingPhase 단위 테스트, CTA 상태 컴포넌트 테스트 통과.
- 프로덕션 빌드에서 `check:seed` 통과, 설정 없는 빌드는 빈 상태만 보인다.

## Phase 2 — DB·인증·권한

작업
- [x] PGlite 스파이크: 역할 전환·RLS·트리거 동작 확인(결과·한계는 [TEST_PLAN §5.1](./TEST_PLAN.md#51-pglite-검증-결과와-한계))
- [x] 마이그레이션: enum·테이블·제약·인덱스, GRANT·RLS, 함수·RPC, 기준 데이터 (+ Phase 3의 닉네임 규칙 마이그레이션 5)
- [x] DB 테스트 하네스와 권한 우회 테스트([TEST_PLAN §5](./TEST_PLAN.md#5-db-테스트-목록-pglite))
- [x] supabase 어댑터, 인증(Google, Kakao 플래그), `/auth/callback`(PKCE code 교환), returnTo, 로그아웃·사용자 전환 시 데이터 초기화 — 코드와 단위·계약 테스트([TEST_PLAN §6](./TEST_PLAN.md#6-어댑터-계약-테스트-pglite)). Phase 3에서 구현
- [x] 최초 설정(닉네임·약관 동의), 프로필 수정 (화면·mock·RPC·계약 테스트)
- [x] `supabase/seed.sql`(개발 전용 표기) (`seed.test.ts`)
- [ ] `BLOCKED:` 실제 Supabase 프로젝트 연결·실제 OAuth 왕복 확인(사용자 설정 필요, 순서는 [DEPLOYMENT §6](./DEPLOYMENT.md#6-첫-연결-확인-순서-개발용-프로젝트에서-먼저))

완료 조건
- 마이그레이션이 PGlite에서 적용되고 권한 표([DB_SCHEMA §7](./DB_SCHEMA.md#7-권한-grant))와 실제 GRANT가 일치한다.
- 필수 테스트 #3, #4, #13 DB 레벨 통과.
- 실제 Supabase가 없으면 연결 항목을 `BLOCKED`로 남기고 인터페이스는 유지한다.

## Phase 3 — 모임 핵심 흐름

작업
- [x] 모임 생성·수정·모집 마감·취소 RPC 연결 (Supabase 어댑터, 계약 테스트)
- [x] 참가 신청·취소·승인·거절·대기·출석 체크 (어댑터·계약 테스트, mock·E2E)
- [x] 내 모임 탭, 참가자 관리 화면 (컴포넌트·E2E, `list_my_meetings`·`list_meeting_participants` 계약 테스트)
- [x] 홀덤 비금전 동의 흐름 (폼·RPC·계약 테스트)
- [x] `scripts/race-test.ts` 작성 — **실행은 `BLOCKED:`**(실제 Postgres 필요)
- [x] Phase 2 후속: `Meeting.hostId`·`hostNickname` nullable("탈퇴한 사용자"), 닉네임 예약어 완화(SQL·프론트 동일), 정렬값 DB와 일치, typecheck·lint 범위에 DB 테스트·scripts 포함, 상세의 대형 플레이스홀더 제거, `npm run db:bundle`
- [ ] `BLOCKED:` 실제 DB 연결 환경에서 핵심 흐름 수동 검증

완료 조건
- 필수 테스트 #5~#9 DB·컴포넌트·E2E 레벨 통과.
- 카운트 불변식 테스트 통과.
- 실제 DB 연결 환경에서 핵심 흐름 수동 검증(BLOCKED이면 명시).

## Phase 4 — 공간·신고·관리자

작업
- [x] 공간 목록·상세, 외부 링크 처리(https만·새 창·noopener noreferrer), 모임 폼 공간 선택·상세 공간 링크/예약 링크, 탐색 목록 공간 필터 RPC (마이그레이션 6, DB·계약·컴포넌트·E2E)
- [x] 신고 대화상자와 `submit_report`(모임 상세·참가자 관리 진입점, 실제 접수 시에만 토스트, 오류 매핑) (계약·컴포넌트·E2E)
- [x] 관리자 화면: 신고 처리·모임 숨김/해제·관리자 취소·계정 제한/해제·공간 등록/수정/공개 전환·카테고리 활성 전환, 관리자 조회 RPC·관리자 테이블 쓰기 감사 트리거 (마이그레이션 7, DB·계약·컴포넌트·E2E). 카테고리 이름·순서 변경 화면은 제외(문서화)
- [x] 이용 제한·탈퇴 요청 계정 안내, 탈퇴 요청 흐름 — 화면·RPC는 Phase 1~3에 구현(탈퇴 요청은 DB·계약 테스트), 안내 띠 `AccountStatusBanner` 화면 테스트(이용 제한·탈퇴 요청 문구, active·비로그인은 띠 없음)를 Phase 4 검수에서 추가 (컴포넌트)
- [x] 정책 페이지(`/policies/:slug` 3종, 초안 배너, 의존성 없는 마크다운 부분집합 렌더러, 확정 전 값 표시) (컴포넌트·E2E)
- [x] 로그·오류 메시지 개인정보 점검: 콘솔 출력 개발 모드 전용(`devWarn`/`devError`) + 직접 호출 금지 테스트, 전역 오류 경계(오류 원문 미노출) (단위·컴포넌트)
- [x] Phase 3 후속: 닉네임 예약어 `운영진`(마이그레이션 8, DB = 프론트 비교), `useMeetingList` 사용자 전환 시 다시 요청, 수정 시 `game_id` 보존 (단위·DB·계약)

완료 조건
- 일반 계정의 관리자 기능 접근 불가(DB + E2E).
- 신고 중복·횟수 제한 테스트 통과.
- 빈 상태·오류 처리가 모든 신규 화면에 있다.

## Phase 5 — QA·배포 준비

작업
- [x] `npm run verify` 전체 통과 — test 52개 파일 438개, test:db 13개 파일 232개, build(+ `_headers`), check:seed, check:dist. 미해결 실패 없음
- [x] 주요 E2E(63개), 스크린샷 비교(29장 — 바뀐 PNG는 mock 시각 글자만), 접근성 점검표([TEST_PLAN §3](./TEST_PLAN.md#3-뷰포트접근성-점검표)): axe 390·1280px serious·critical 0건, 키보드(건너뛰기·Tab 순서·포커스 링·대화상자 트랩·탭 화살표), 글자 200%, 색 대비 단위 테스트(알려진 예외 3쌍 기록). 스크린리더·실기기는 미실행
- [x] RLS·권한 재점검: 역할(비로그인·일반·모임장·관리자·이용 제한·탈퇴 요청) × 동작 매트릭스와 근거 테스트([SECURITY §3.1](./SECURITY.md#31-역할--동작-매트릭스와-근거-테스트-phase-5)), 빈 칸은 `account-status.test.ts`(14개)로 채움. 발견한 문서와 다른 동작 1건(관리자 권한이 계정 상태를 보지 않음)은 검수 결정으로 마이그레이션 9(`is_admin()` = admin_roles + active) 반영, mock도 같은 규칙
- [ ] 동시 신청 경쟁 테스트 — `BLOCKED:` 실DB 필요(실행 절차 보강: [TEST_PLAN §4.1](./TEST_PLAN.md#41-동시-신청-경쟁-테스트-실행-절차-개발용-supabase))
- [x] `_headers`(CSP 등) 빌드 생성(`scripts/write-headers.mjs`, 단위 테스트), CSP 스모크(`npm run test:csp` 5개, 위반 0건 — Zod JIT eval 위반을 찾아 고침), SPA 폴백 확정(`_redirects` 삭제 → Pages 기본 동작, `404.html` 생성 방지 검사), 빌드 변형 검증(`npm run check:builds` 15/15), `.nvmrc`, `robots.txt`
- [ ] 프리뷰 배포 확인 — `BLOCKED:` 사용자 승인·Cloudflare 계정 필요([DEPLOYMENT §8](./DEPLOYMENT.md#8-첫-프리뷰-배포-확인))
- [x] DEPLOYMENT 최종 정리(env 표·Supabase·Auth URL·Google·Kakao·Pages 빌드 설정·스모크·롤백·배포 전 체크리스트), OPERATIONS 보강(백업·장애·사고 체크리스트·모니터링 후보), 코드·산출물 감사([SECURITY §14](./SECURITY.md#14-코드산출물-감사-phase-5-2026-11-25))
- [ ] 백업 시험 — `BLOCKED:` 실DB 필요([OPERATIONS §8](./OPERATIONS.md#8-백업))
- [ ] 정책 문서 운영자·법률 검토 요청(`BLOCKED:`)

완료 조건
- 실패·미실행 테스트가 숨김 없이 기록되어 있다 — [TEST_PLAN §3·§9](./TEST_PLAN.md#9-최종-결과-phase-5-2026-11-25-실제-실행), [CHANGELOG](./CHANGELOG.md).
- 사용자 승인 없이는 운영 배포하지 않는다 — 배포하지 않았다. 출시 순서는 [NEXT_STEPS](./NEXT_STEPS.md).
