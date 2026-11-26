# 테스트 계획

상태: 출시 전 마무리 반영 (2026-11-25 — GitHub Actions CI, 시간대 견고성(`npm run test:tz`, `e2e/timezone.spec.ts`), 관리자 취소 판단 순서 계약 단언, 결과 §10). Phase 5: 접근성(axe·키보드·글자 200%)·CSP 스모크·빌드 변형·색 대비·소스 감사·산출물 점검·역할×동작 매트릭스 DB 테스트(결과 §9). Phase 4: 공간·신고·관리자·정책, Phase 3: 어댑터 계약 테스트

관련 문서: [DB_SCHEMA](./DB_SCHEMA.md) · [SECURITY](./SECURITY.md) · [UI_SPEC](./UI_SPEC.md) · [ARCHITECTURE](./ARCHITECTURE.md)

## 1. 테스트 레벨과 명령

| 레벨 | 도구 | 대상 | 명령 |
|---|---|---|---|
| 단위 | Vitest | `src/lib`(KST 날짜, 필터 쿼리, returnTo 검증, 외부 링크 https 확인, 마크다운 파서, 콘솔 직접 호출 금지, **소스 보안 감사·VITE_ 목록 일치**(`securityAudit.test.ts`), **Zod jitless**(`zodConfig.test.ts`)), **색 대비**(`src/styles/contrast.test.ts` — index.css 토큰을 읽어 WCAG 비율 계산, 알려진 예외 기록), **보안 헤더 생성**(`scripts/security-headers.test.ts` — env 유무·잘못된 URL·헤더 조작 거부), `src/domain`(meetingPhase, Zod 스키마 — 공간 선택·게임 연결 포함, 닉네임 예약어, 공간·신고 폼), 어댑터 팩토리, mock 규칙(공간·신고·관리자), Supabase 어댑터(오류 매핑·응답 검증·인자 변환·키 가드·인증 흐름·관리자 테이블 쓰기, 가짜 클라이언트) | `npm run test`, 다른 시스템 시간대로 `npm run test:tz` |
| 컴포넌트 | Vitest + React Testing Library + jsdom | CTA 상태, 폼 오류, 다이얼로그 포커스, 빈·오류·로딩 상태, 신고 대화상자, 관리자 권한·탭, 공간 목록·상세(필터 줄 라벨·aria-labelledby), 정책 페이지, 전역 오류 경계, 계정 상태 안내 띠(이용 제한·탈퇴 요청 문구, active·비로그인 띠 없음) | `npm run test` |
| DB | Vitest + PGlite | 마이그레이션, GRANT, RLS, RPC 규칙, 제약조건, `db:bundle` 결과, 역할×동작 매트릭스(이용 제한·탈퇴 요청·관리자 행 — `account-status.test.ts`) | `npm run test:db`(타입 검사 `tsconfig.db.json` + `vitest.db.config.ts`) |
| 계약 | Vitest + PGlite + 실제 어댑터 | Supabase 어댑터 → 실제 SQL 함수(인자 이름·jsonb 키·응답 모양·오류 코드). §6 | `npm run test:db`에 포함(`supabase/tests/adapter-contract.test.ts`) |
| 동시성 | `scripts/race-test.ts` + 실제 Postgres | 동시 신청·동시 승인 시 정원 초과 없음 | `node scripts/race-test.ts --confirm-dev-db`(`BLOCKED:` DB 필요, 절차 §4.1) |
| E2E | Playwright(chromium), mock 모드 `--mode e2e` | 핵심 사용자 흐름, 뷰포트, URL 쿼리, **접근성**(`e2e/a11y.spec.ts`: axe 390·1280px serious·critical 0건, 키보드, 글자 200%), **시간대**(`e2e/timezone.spec.ts`: 브라우저 LA·UTC에서 KST 표시·필터·저장) | `npm run test:e2e` |
| CSP 스모크 | Playwright(`playwright.csp.config.ts`) + 빌드 결과 + 생성 `_headers`(vite preview) | 주요 화면 CSP 위반 0건, 보안 헤더, 대조군(인라인 script·style 속성 차단 감지), 가짜 Supabase env의 connect-src·OAuth 이동 | `npm run test:csp`(별도 — verify에 없음) |
| 빌드 변형 | `scripts/check-builds.mjs` | 임시 폴더에 운영 빌드: env 없음·가짜 Supabase env 성공(check:seed·check:dist), service_role·sb_secret_·SERVICE_ROLE 이름·http·경로 URL은 빌드 실패 | `npm run check:builds`(별도) |
| 스크린샷 | Playwright `screenshots` 프로젝트 | 6개 뷰포트 시각 비교 + 글자 200% 대표 화면(phase5) | `npm run screenshots` |
| 산출물 | `scripts/check-no-seed.mjs`, `scripts/check-dist.mjs` | `dist/`에 seed 마커 없음 / `404.html`·`_redirects` 없음, `_headers`가 현재 env와 일치, index.html 인라인 코드 없음, 비밀 키 값 없음, robots.txt | `npm run check:seed`, `npm run check:dist` |
| 통합 | - | 타입 → 린트 → 테스트 → DB 테스트 → 빌드(+ `_headers`) → seed 점검 → 산출물 점검 | `npm run verify` |
| CI | GitHub Actions(`.github/workflows/ci.yml`, ubuntu-24.04, UTC) | `npm ci` → verify → test:tz → Chromium 설치 → test:e2e → test:csp → check:builds, 실패 시 Playwright 리포트·trace artifact(7일) | `main` push·PR·수동 실행(README "CI") |
| 수동 | 실제 브라우저·기기 | OAuth, 실기기 Safari, 스크린리더 | 체크리스트(§3, §4) |

- 스크립트 이름은 현재 `package.json` 기준이다. DB 테스트 의존성: `@electric-sql/pglite`(devDependency). 동시성 스크립트 의존성: `pg`, `@types/pg`(devDependency).
- 화면 테스트 설정(`vite.config.ts`)의 `include`는 `src/**/*.test.{ts,tsx}`뿐이다. `supabase/tests`는 `vitest.db.config.ts`(node 환경)로 따로 돈다. `npm run verify`에 `test:db`가 포함되어 있다(test 다음, build 전).
- `supabase/tests/**`와 `scripts/**/*.ts`는 `npm run lint`(eslint.config.js)와 `npm run typecheck`(`tsconfig.json` references의 `tsconfig.db.json`)가 함께 검사한다. `test:db`도 시작할 때 `tsc -p tsconfig.db.json`을 한 번 더 돈다.
- E2E는 mock 어댑터로 돈다. 실제 DB 규칙 검증은 DB 레벨이 담당한다(mock은 보안 경계가 아님).
- 시간대: 앱은 기기 시간대와 관계없이 KST로 계산·표시·저장한다(`src/lib/date.ts` — 모든 변환이 `Intl.DateTimeFormat`의 `timeZone: 'Asia/Seoul'`). 확인 방법:
  - 단위: `src/lib/date.test.ts`가 테스트 안에서 `process.env.TZ`를 UTC·America/Los_Angeles·Asia/Seoul·Pacific/Kiritimati로 바꿔 날짜 유틸을 검사한다. 단위·컴포넌트 테스트 **전체**는 CI에서 UTC(`npm run test`)와 America/Los_Angeles(`npm run test:tz`)로 두 번 돈다. 로컬에서 UTC는 `npm run test:tz -- UTC`.
  - `npm run test:tz`(`scripts/test-tz.mjs`)는 자식 프로세스에 TZ를 직접 넘기고, 먼저 그 시간대가 적용되는지 확인한다(모르는 이름은 Node가 오류 없이 `Etc/Unknown`(UTC)으로 처리). 테스트 안에서도 `src/test/setup.ts`가 `HANPAN_TEST_TZ`와 실제 시간대를 비교해 다르면 실패한다.
  - **주의(Windows Git Bash)**: `TZ=America/Los_Angeles npm run test`처럼 앞에 붙이면 MSYS가 `/`가 든 TZ 값을 Windows 프로그램에 넘기지 않아 **아무 표시 없이 KST로 돈다**(`TZ=UTC`는 넘어간다). 2026-11-25 확인 — Vitest 시작 시각 표시와 `node -e`로 확인.
  - E2E: 기본은 `timezoneId: 'Asia/Seoul'`(playwright.config.ts). `e2e/timezone.spec.ts`만 LA·UTC로 바꾸고 `page.clock.install`로 KST 자정 직전(UTC 14:58)·직후(UTC 15:10)에 시작한다. 기대값은 앱 코드 없이 "KST = UTC+9"로 계산한다.

## 2. 필수 테스트 매핑 (마스터 프롬프트 8장)

| # | 필수 테스트 | 단위 | 컴포넌트 | DB(PGlite) | E2E(mock) | 실DB·수동 |
|---|---|---|---|---|---|---|
| 1 | 미로그인 사용자가 목록·상세를 볼 수 있다 | | | anon으로 `meetings`·`profiles` select 성공, 숨김 모임 미노출. 계약: 비로그인 어댑터로 목록·필터·상세 | 비로그인으로 `/`, `/meetings/:id` 진입 | 실 Supabase anon 조회(BLOCKED) |
| 2 | 미로그인 신청 → 로그인 → 원래 모임 복귀 | returnTo 저장·검증(`//`, 백슬래시, 외부 URL 거부), Supabase 어댑터: 로그인 시작 시 returnTo 저장·`redirectTo`=현재 origin, 콜백 code 교환·주소 정리·returnTo 반환 | CTA가 `/login`으로 이동, `/auth/callback` 화면(가짜 클라이언트) | 계약: 비로그인 신청은 RPC 없이 `AUTH_REQUIRED` | 상세 → 로그인 → 개발용 계정 선택 → 같은 상세로 복귀 | 실제 Google OAuth 복귀(BLOCKED) |
| 3 | A는 B의 모임을 수정·삭제할 수 없다 | | 수정 화면 권한 없음 상태 | 직접 update/delete 거부(권한 오류), `update_meeting`·`cancel_meeting`·`decide_participant` → `NOT_HOST` | B의 수정 URL 직접 접근 시 권한 없음 | |
| 4 | 일반 계정은 관리자 API·데이터를 읽거나 바꿀 수 없다 | mock: 관리자 메서드 12종 `NOT_ADMIN`(관리자 취소는 DB `cancel_meeting`과 같은 순서 — 계정 → 모임 존재 → 권한: 없는·숨김 모임은 `NOT_FOUND`가 먼저). Supabase 단위: `adminCancelMeeting`의 `NOT_HOST` → `NOT_ADMIN`(다른 코드는 그대로) | `/admin` 권한 없음(관리자 데이터 미요청) | `admin_*`(Phase 4 조회 RPC 4종 포함) → `NOT_ADMIN`·anon 42501, 이용 제한·탈퇴 요청 상태 관리자도 `NOT_ADMIN`(마이그레이션 9, `account-status.test.ts`), `audit_logs` select 0행, `admin_roles` select·insert 거부, venues insert 거부·update/delete 0행, categories update 0행, 숨김 모임 미노출. 계약: 관리자 메서드 전부 `NOT_ADMIN`(테이블 쓰기·관리자 취소 포함, 관리자 취소는 mock과 같은 코드인지 단언 — 없는·숨김 모임은 둘 다 `NOT_FOUND`) | 일반 계정으로 `/admin` → 권한 없음, 프로필에 관리자 링크 없음 | 실 Supabase에서 동일 확인(BLOCKED) |
| 5 | 동일 계정 이중 신청 불가 | | 더블클릭 시 요청 1회 | 두 번째 `apply_to_meeting` → `ALREADY_APPLIED`, 직접 insert 거부, unique 제약 | 연속 클릭 후 상태 1건 | |
| 6 | 1자리 남은 모임에 동시 신청 시 1명만 확정 | | | 순차 신청 시 두 번째는 `waitlisted`/`MEETING_FULL`, `pg_get_functiondef`에 `for update` 존재, `confirmed_count <= max` check 위반 insert 거부 | | `scripts/race-test.ts` 동시 N건(BLOCKED) |
| 7 | 취소·마감·과거 모임에 규칙 위반 신청 불가 | | 각 상태 CTA 비활성 + 사유 | `MEETING_CANCELLED`, `MEETING_NOT_OPEN`, `MEETING_STARTED`, `OWN_MEETING`, `APPLICATION_REJECTED`, restricted → `ACCOUNT_RESTRICTED` | 마감 모임 상세 CTA | |
| 8 | 모임장이 취소하면 신청 상태가 일관되게 정리 | | | 게스트 `pending/confirmed/waitlisted` → `meeting_cancelled`, 카운트 1/0/0, `rejected`·`cancelled` 유지, audit 기록 | 취소 후 참가자 계정의 내 모임 '취소' 탭 | |
| 9 | 신청 실패 시 UI 원복·오류 안내 | 오류 코드 → 문구 매핑, PostgREST·Auth·네트워크 오류 → `DataAdapterError` | 어댑터가 오류를 던지면 버튼 원복, `role="alert"` 문구, 재시도 가능 | 계약: 실제 RPC 오류가 같은 코드·detail로 전달 | mock 실패 주입(예: `MEETING_FULL`) | |
| 10 | 320px에서 제목·인원·CTA가 겹치지 않음 | | | | 320px에서 `scrollWidth <= clientWidth`, 제목·인원·CTA 경계 상자 비겹침 | 스크린샷 육안 확인 |
| 11 | 긴 텍스트·빈 결과·이미지 없음·오류·로딩 | | 60자 제목·60자 장소, 빈 목록, 오류, 스켈레톤 렌더 | | 긴 제목 예시 데이터 화면 | 스크린샷 육안 확인 |
| 12 | 링크 공유 후 필터 쿼리 유지 | parse ↔ serialize 왕복, 잘못된 값 무시 | | | 쿼리 포함 URL 직접 진입 → 선택 상태 일치, 필터 변경 → URL 갱신, 새로고침 유지 | |
| 13 | 역할별 개인정보 접근 범위 | | 공개 상세에 참가자 닉네임 없음 | anon: `meeting_participants`·`user_private`·`reports` 0행/거부. 사용자: 타인 `user_private` 0행, 타인 모임 참가자 0행, 신고 `admin_note` 컬럼 거부. 모임장: 본인 모임 참가자만. profiles에 이메일 컬럼 없음 | 게스트 계정으로 참가자 관리 URL 접근 시 권한 없음 | |
| 14 | 개발 seed가 프로덕션 빌드·운영 DB에 유입되지 않음 | 팩토리: 설정 없음 → mock(개발)/`unconfigured`(프로덕션), env 있음 → supabase, service_role 키 → `unconfigured` | | 마이그레이션만 적용 후 사용자·모임·공간 등 0행, 마이그레이션에 seed 마커·`[예시]`·`auth.users` insert 없음, seed.sql 첫 줄 금지 주석·마커, `db:bundle`에 seed 없음 | | `npm run build && npm run check:seed`(Supabase env를 넣은 빌드에서도 확인), 운영 DB에 seed 미적용 확인(수동) |

- DB(PGlite) 열: 2026-11-24 `supabase/tests/*.test.ts`로 구현·통과(파일별 내용 §5, 계약 테스트 §6). #1의 profiles 조회는 공개 컬럼만 허용되고 `status`는 거부되는 것까지 검사한다. #6의 실DB 동시성은 미실행(`BLOCKED:`).

## 3. 뷰포트·접근성 점검표

뷰포트: 320 · 375 · 390 · 768 · 1280 · 1440px. 화면: 탐색, 상세(비로그인·신청 가능·마감·본인 모임), 생성 폼, 내 모임, 참가자 관리, 로그인, 프로필, 공간 목록, 관리자, 404.
결과는 2026-11-25 Phase 5 실행 기준이며 "통과/실패/미실행"으로만 적는다(**"접근성 준수"라는 뜻이 아니다**).

| 항목 | 방법 | 레벨 | 결과 |
|---|---|---|---|
| 가로 오버플로 없음 | `document.documentElement.scrollWidth <= clientWidth` | E2E(6개 뷰포트) | 통과 |
| 고정 요소가 콘텐츠를 가리지 않음 | 하단 내비·CTA 바 위로 마지막 요소까지 스크롤 가능 | E2E + 스크린샷 | 통과 |
| 768px 헤더·목록 행 겹침 없음 | 데스크톱 레이아웃 시작점 확인 | 스크린샷 | 육안(사용자 검수 몫) |
| axe 자동 점검 | `@axe-core/playwright` 4.14.1, 태그 wcag2a·2aa·21a·21aa·22aa·best-practice, 390·1280px, CSP 스모크와 같은 화면 목록(지역 선택·신청 대화상자, 만들기 오류 상태, 관리자 5개 탭·공간 등록 폼 포함) | E2E(`e2e/a11y.spec.ts` 6개) | 통과 — serious·critical 0건. 처음 실행 때 serious 1종(`label-content-name-mismatch`: 날짜 칸 버튼의 aria-label이 보이는 글자를 포함하지 않음)을 고침. moderate 2종도 검수 때 고침: `region`(개발용 안내 띠·계정 상태 안내 띠를 이름 붙은 `aside`로), `heading-order`(공간 등록 폼 제목 h3 → h2, 내 모임 행 제목 h3 → h2 — 모양 그대로). `region`·`heading-order` 0건 단언 2개 추가(390·1280px, 이용 제한 계정 안내 띠 포함). 그 밖의 moderate·minor 0건 |
| 건너뛰기 링크 | 첫 Tab에 "본문 바로가기"가 보이고 Enter → `main` 포커스, 다음 Tab은 본문 안 / 포커스 전에는 1px(sr-only) | E2E | 통과(기존 링크 확인 — 새로 만들지 않음) |
| 키보드 Tab 순서 | 1280px: 건너뛰기 → 로고 → 모임 찾기 → 공간 찾기 → 모임 만들기 → 지역 선택 → 로그인 → 본문. 390px: 건너뛰기 → 로고 → 지역 선택 → 본문 | E2E | 통과 |
| 포커스 표시 | 위 순서의 각 요소와 관리자 탭에서 `outline: 3px solid rgb(72,106,167)` + `:focus-visible` | E2E | 통과(검사한 요소 한정. 모든 요소 전수는 아님) |
| 다이얼로그 포커스 트랩·ESC·복귀 | 지역 선택·신청 대화상자: 키보드로 열기 → 안에 포커스 → Tab·Shift+Tab 각각 (요소 수+2)회 안에 머묾 → 처음↔마지막 순환 → ESC 닫힘 → 연 버튼으로 복귀 | 컴포넌트 + E2E | 통과 |
| 탭 화살표 키 | 관리자 탭 ←/→(양끝 순환)·Home·End로 이동과 동시에 선택(URL `tab`), 선택된 탭만 Tab 정지점, Tab은 패널로 | 컴포넌트 + E2E | 통과 |
| disabled 사유 전달 | `aria-disabled` + `aria-describedby` 문구 | 컴포넌트 | 통과(기존) |
| 글자 200% 확대 | 루트 글자 32px(`html { font-size: 32px }` 주입 — 글자·간격 토큰이 rem). 390·1280px에서 홈(로딩 중·로딩 후)·상세·모임 만들기·공간 목록(로딩 중·로딩 후)·관리자의 가로 넘침 없음 + 지역 선택·검색·첫 행·상세 CTA·제목/권역 입력·만들기 버튼·신고 처리 Select·저장 버튼이 보이고 가로로 화면 안 | E2E + 스크린샷(`docs/screenshots/phase5/*-text200.png` 5장) | 통과 — 처음 실행 때 390px 홈 **로딩 스켈레톤**이 14px 넘침(고정 rem 폭 막대) → `max-w-full`로 고침. 1280px에서 브라우저 확대(zoom) 200%(= CSS 뷰포트 640px)는 따로 실행하지 않음(미실행 — 390·768px 검사 사이 폭) |
| 색 대비 AA | `src/styles/contrast.test.ts` — index.css 토큰을 읽어 WCAG 비율 계산(글자 4.5:1, 포커스 3:1) + axe `color-contrast` | 단위 + E2E | 통과 18쌍. **알려진 예외 3쌍**(토큰 변경 없음, 사용자 결정 필요): muted/soft 4.22:1, muted/hover 4.33:1(데스크톱 목록 행 hover 때 보조 정보), border/surface 1.23:1(입력·칩 테두리, 비텍스트 3:1 미달). axe color-contrast 위반 0건(hover 상태는 axe가 보지 않음) |
| 색에만 의존하지 않음 | 상태 배지·오류에 텍스트 병기 | 컴포넌트 | 통과(기존) |
| 이미지 대체 텍스트 | 장식 플레이스홀더 `alt=""`, 의미 있는 이미지만 설명 | 컴포넌트 + axe | 통과 |
| 페이지 제목·랜드마크 | `<title>`, `header/nav/main/footer`, 제목 계층 | 컴포넌트 + axe | 통과(moderate 기록은 위 axe 행) |
| 권한 요청 없음 | 카메라·마이크·위치 권한 팝업이 뜨지 않음 | 헤더(`Permissions-Policy`로 끔) | 통과(CSP 스모크에서 헤더 확인) |
| 스크린리더 | VoiceOver(iOS Safari)·NVDA 중 가능한 것으로 핵심 흐름 | 수동 | **미실행**(`미확인:` 장비) |
| 실기기 Safari·200% 확대 실제 브라우저 설정 | iPhone 등, 브라우저 글자 크기 설정 | 수동 | **미실행** |

- axe는 WCAG 1.4.11(비텍스트 대비 — 입력 테두리 등)을 검사하지 않는다. 그 부분은 색 대비 단위 테스트의 알려진 예외로 기록했다.
- 예외 처리 장치: `e2e/a11y.spec.ts`의 `DESIGN_EXCEPTIONS`(규칙·요소·이유). 현재 비어 있다.

## 4. 실제 Supabase가 필요한 항목 (BLOCKED)

| 항목 | 필요한 것 | 방법 |
|---|---|---|
| 동시 신청 경쟁(#6) | 개발용 Supabase 프로젝트(또는 로컬 `supabase start`)의 직접 DB 연결 문자열. 연결 역할은 `auth.users`에 insert 가능해야 함 | §4.1. **미실행**(실제 Postgres 없음). 스크립트 흐름·SQL은 PGlite 소켓 서버에 순차 실행판으로 한 번 확인함(동시성 검증 아님) |
| Google/Kakao OAuth 왕복 | OAuth 클라이언트, Redirect URL 설정 | 수동: 로그인 → 콜백(주소창에 code 남지 않음) → 최초 설정 → returnTo 복귀, 로그아웃 후 이전 사용자 데이터가 남지 않음, 다른 탭 로그아웃 반영. 순서는 [DEPLOYMENT §6](./DEPLOYMENT.md#6-첫-연결-확인-순서-개발용-프로젝트에서-먼저) |
| PostgREST 계층 | 개발용 프로젝트 | 실제 HTTP 응답의 오류 필드(`code`·`message`·`details`)와 상태 코드, RPC 인자 직렬화(jsonb·timestamptz·enum), void·스칼라 반환의 `data` 값, JWT 만료 시 오류 코드(`PGRST3xx`)가 어댑터 가정과 같은지 |
| 가입 트리거 | 실 `auth.users` | 첫 로그인 후 profiles·user_private 생성, 닉네임이 실명이 아님 확인 |
| RLS·GRANT 실환경 재확인 | 개발용 프로젝트 | anon 키로 PostgREST 직접 호출(수정·삭제·관리자 데이터 조회 시도) |
| CSP·보안 헤더 | Cloudflare Pages 프리뷰 | 빌드 결과 + 생성 헤더로는 확인함(`npm run test:csp`). 실제 Pages 응답 헤더·SPA 딥링크·콘솔 CSP 위반은 [DEPLOYMENT §8](./DEPLOYMENT.md#8-첫-프리뷰-배포-확인) |
| 실기기 Safari | iPhone 등 | 안전 영역, 하단 고정 요소, 입력 확대 |

### 4.1 동시 신청 경쟁 테스트 실행 절차 (개발용 Supabase)

`scripts/race-test.ts` — `BLOCKED:`(실행한 적 없음). **운영 프로젝트에 실행하지 않는다**(임시 사용자·모임을 만들고 지운다).

1. 준비: 개발용 프로젝트에 마이그레이션 1~8 적용([DEPLOYMENT §3.2](./DEPLOYMENT.md#32-마이그레이션-적용)). Node 22.18 이상(`.ts`를 직접 실행 — Node의 타입 제거 기능 사용, 로컬 확인 24.18.0). `npm install` 완료(`pg` 개발 의존성).
2. 연결 문자열: 대시보드 → Connect → **직접 연결(Direct connection, 포트 5432)** 또는 세션 풀러(Session pooler). 트랜잭션 풀러(6543)는 쓰지 않는다(트랜잭션마다 `set local role`·claims를 바꾸므로 세션이 유지돼야 한다). 비밀번호의 특수문자는 퍼센트 인코딩한다. 값은 셸 변수로만 넘기고 파일·명령 기록·채팅에 남기지 않는다.
3. 실행(Git Bash):
   ```bash
   RACE_TEST_DATABASE_URL='postgresql://postgres:<DB 비밀번호>@<호스트>:5432/postgres' \
     RACE_TEST_CONCURRENCY=20 RACE_TEST_SEATS=1 \
     node scripts/race-test.ts --confirm-dev-db
   ```
   - `RACE_TEST_DATABASE_URL`이 없으면 `BLOCKED:` 안내 후 exit 0(아무것도 하지 않음). `--confirm-dev-db`가 없으면 exit 1.
   - 선택: `RACE_TEST_CONCURRENCY`(2~200, 기본 20), `RACE_TEST_SEATS`(남은 자리 1~29, 기본 1), `--keep`(임시 데이터 남김 — 조사용).
4. 하는 일: 임시 사용자 N+1명(`race-<runId>-<n>@example.invalid`)·모임 3개를 만들고, N개 연결에서 서로 다른 사용자로 `set local role authenticated` + `request.jwt.claims`를 설정한 뒤 **같은 순간에** 호출한다.
   - (A) 대기 불가 모임에 동시 신청 → 확정 = 남은 자리 수, 나머지 `MEETING_FULL`
   - (B) 대기 허용 모임 → 확정 = 남은 자리 수, 나머지 `waitlisted`
   - (C) 승인제 → 전원 pending 후 모임장이 **동시에** 전원 승인 → 확정 = 자리 수, 나머지 `MEETING_FULL`
   - 각 시나리오 후 카운트 = 실제 행 수, 정원 초과 없음을 확인하고, 끝나면(실패해도) 임시 데이터를 지운다.
5. 판정: 종료 코드 0 = 통과, 1 = 실패(출력에 시나리오별 결과). 결과·실행 일시·동시성·자리 수를 CHANGELOG에 남긴다.
6. 정리 확인(SQL Editor): `select count(*) from auth.users where email like 'race-%@example.invalid';` → 0, `select count(*) from public.meetings where title like '[race-test]%';` → 0.
- `미확인:` Supabase 호스팅 프로젝트의 `postgres` 역할이 `auth.users`에 직접 insert 할 수 있는지(권한 구조가 바뀌었을 수 있음). 막히면 로컬 Supabase(`npx supabase start`, Docker 필요)에서 실행하거나, 대시보드에서 테스트 사용자를 만든 뒤 스크립트를 그 사용자들로 바꾸는 방안을 검토한다.

## 5. DB 테스트 목록 (PGlite)

- 실행: `npm run test:db` = `tsc -p tsconfig.db.json`(타입 검사) → `vitest run --config vitest.db.config.ts`. 전체 약 20초.
- 하네스: `supabase/tests/harness.ts`([DB_SCHEMA §15](./DB_SCHEMA.md#15-db-테스트-하네스-pglite)). 파일마다 스텁+마이그레이션을 적용한 템플릿을 한 번 만들고 **테스트마다 `clone()`한 독립 DB**를 쓴다(테스트 간 상태 공유 없음). 역할 전환은 트랜잭션 단위(`asUser`/`asAnon`/`asOwner`)라 트랜잭션이 끝나면 역할·claims가 돌아온다.
- 오류 검사 도우미: `expectRpcError(p, 'CODE', detail?)`(SQLSTATE P0001 + message), `expectPermissionDenied(p)`(42501), `expectSqlState(p, '23514')`.
- 마지막 실행(2026-11-25, 출시 전 마무리): **13개 파일, 232개 테스트 통과, 실패 0**(계약 테스트 28개 — 관리자 취소 판단 순서 단언을 기존 테스트에 추가해 개수는 그대로, `venues-admin.test.ts` 21개·`account-status.test.ts` 14개 포함). Phase 5 첫 보고 때는 227개. Phase 4 기준은 12개 파일 216개, Phase 3은 11개 파일 187개.

| 파일 | 개수 | 내용 |
|---|---|---|
| `pglite-capabilities.test.ts` | 8 | 하네스 전제 확인(§5.1): 역할 전환, auth.uid() 두 GUC, RLS·컬럼 grant, security definer, auth.users 트리거, for update, advisory lock·생성 컬럼·P0001 |
| `schema.test.ts` | 20 | 마이그레이션 파일 9개·이름 규칙, auth 스키마·확장·seed 미포함, 기준 데이터 6+6행·멱등, 마이그레이션만 적용 시 0행, 모든 테이블 RLS, **테이블·컬럼·함수 권한 매트릭스 정확 비교**(`has_table_privilege`/`has_column_privilege`/`has_function_privilege`), 모든 함수 `search_path = public, pg_temp`, 목록·상세는 security invoker, public 외 스키마 미생성(스토리지 없음), check·unique 제약, updated_at 트리거, 가입 트리거(임시 닉네임·메타데이터·이메일 미복사) |
| `public-read.test.ts` | 16 | anon 목록·상세·Meeting 필드 모양, profiles 공개 컬럼만(status 거부), 숨김 모임 노출 범위(anon·타인 X, 모임장·관리자 O, 공개 목록에는 아무에게도 X), 필터(날짜 [from,to)·카테고리·권역·recruiting), 정렬·잘못된 sort, 페이지·limit 1~50 보정·total, 검색(제목·게임명·공간명·장소 메모·권역명, `%`·`_`·`\` 문자 그대로, 50자 자름), 탈퇴 모임장(host_id null·참가 기록 보존·신청 불가), 비공개 공간 이름 |
| `permissions.test.ts` | 37 | anon의 쓰기·로그인 RPC 20종 EXECUTE 거부, 내부 함수 거부, 테이블 직접 DML 10종 거부, 비공개 테이블 조회 거부 / A→B 모임 update·cancel·recruiting·decide·attendance·참가자 목록 `NOT_HOST`, 게스트도 불가, 직접 DML 거부(모임장 본인 포함), 타인 참가 행 0행 / `admin_*` `NOT_ADMIN`, admin_roles 조회·insert 거부, audit_logs 0행, update_my_profile의 `is_admin` 등 키 무시, JWT claim으로 관리자 불가, 공간·카테고리·게임 쓰기 RLS, regions는 관리자도 불가 / status 직접 조회 거부, user_private 본인만, 신고 본인만·`admin_note`·`handled_by` 거부, 참가 행 본인·모임장·관리자만 |
| `meetings.test.ts` | 30 | 생성: 모임장 행·카운트 1/0/0·audit, 정의 외 키 무시, 시작 29/31분·89/90일·오프셋 없음·과거, KST 오프셋 변환, 소요 29/30/720/721·문자열·소수, 정원 1/2/30/31·min 1·min>max, 제목 1/2/60/61(공백 제거)·각종 길이, enum·참조·비활성 카테고리, game_id+game_name, 공간 비공개·권역 불일치, 홀덤 동의, 계정 상태 3종, 24시간 6번째·진행 예정 11번째 `RATE_LIMITED` / 수정: 바뀐 필드 audit, 시작 시각 미변경 시 30분 규칙 미적용, 일시 변경 audit·end_at 재계산, 시작 후·취소·없음, `CAPACITY_BELOW_CONFIRMED`, 홀덤 전환, 승인 방식 변경 시 pending 유지, 비활성 기존 값 유지, restricted / 취소: 상태 정리·카운트 1/0/0·이후 신청 불가·audit, 시작 후(모임장)·종료 후(관리자), restricted 모임장 취소 허용 / 모집 마감 전환·기록·거부 조건 |
| `participation.test.ts` | 28 | 신청 결정(auto/manual × 자리 × 대기), **1자리 남은 모임 순차 신청 → 1명 confirmed·나머지 waitlisted / MEETING_FULL**, pending은 자리 미점유·승인 시 재검사, 중복 `ALREADY_APPLIED`(3상태), 직접 insert 거부·unique, `OWN_MEETING`·`MEETING_CANCELLED`·`MEETING_NOT_OPEN`·`MEETING_STARTED`(진행 중·과거)·`NOT_FOUND`(숨김·없음)·`APPLICATION_REJECTED`·재신청 행 재사용·restricted·온보딩 전·메시지 길이 / **함수 정의의 모임 행 `for update`와 잠금 순서**, **check 제약이 초과 확정 거부** / 본인 취소: 카운트 감소·**대기자 자동 승격 없음**·거부 조건·restricted 허용 / 승인·거절 상태 전이·시작 후·취소·restricted / 출석 기간 전·중·7일 이내·이후, 대상 상태, 권한 / get_my_participation·list_meeting_participants·list_my_meetings 모양 / **여러 동작 후 카운트 불변식** |
| `profile-account.test.ts` | 14 | 온보딩 필수 조건·동의 시각 1회 기록, sub 없는 authenticated → `AUTH_REQUIRED`, 닉네임 형식·예약어(포함 금지: `관리자김` 거부 / 완전 일치 금지: `한판` 거부·`한판승부` 허용, 프론트 `isReservedNickname`과 결과 비교)·중복(대소문자 무시)·audit, 관심 장르·권역·소개, restricted / 탈퇴 요청: 상태·비식별화·미래 신청 취소·주최 모임 취소·지난 기록 유지·"탈퇴한 사용자" 표시·audit·불변식, 멱등·이후 쓰기 RPC `ACCOUNT_DELETION_REQUESTED`, 탈퇴자 여러 명 같은 표시명·옛 닉네임 재사용 |
| `reports-admin.test.ts` | 12 | 신고 접수·본인 신고만 조회, 자기 신고, 대상 없음·숨김, 미처리 중복·처리 후 재신고, reason=other 본문, 24시간 11번째, restricted 허용·온보딩 전·탈퇴 요청 거부, 대상 삭제 시 기록 유지 / admin_list_reports 전체 컬럼·필터·페이지, admin_update_report 처리자·audit, 숨김 사유 필수·노출 변화·해제, 이용 제한 효과·모임 자동 취소 없음·거부 조건·audit note, 사용자 검색(이스케이프·id·최근 신고 수) |
| `seed.test.ts` | 3 | seed.sql 첫 줄 주석·마커, 마이그레이션 위 적용·두 번 실행 멱등·카운트 불변식, 예시 데이터 `[예시]` 표시 |
| `bundle.test.ts` | 1 | `scripts/bundle-migrations.mjs` 출력: 파일명 순서, seed 미포함, 빈 DB(스텁)에 한 번에 적용 후 기준 데이터·예약어 함수 동작 |
| `venues-admin.test.ts` | 21 | Phase 4 마이그레이션: 공개 공간 목록(공개만·관리자도·권역 정렬·필터·모르는 값 0건)·응답 모양(실시간 영업 키 없음)·비공개 `get_venue` null(anon·사용자·관리자)·테이블 직접 조회 RLS / `list_public_meetings(p_venue_id)`·기존 9개 인자 호출 호환·오버로드 1개 / 관리자 조회 RPC 4종 `NOT_ADMIN`·anon 42501, `admin_list_meetings`(숨김·취소·종료 포함·검색·이스케이프·숨김만·페이지), `admin_list_report_items`(대상 이름·신고자·메모·상태 필터), 신고 흐름(중복·자기 신고·처리 후 `admin_note` 비노출·재신고)·24시간 11번째 `RATE_LIMITED`, 비공개·비활성 포함 목록 / 공간·카테고리·게임 직접 쓰기: 일반 사용자 insert 42501·update/delete 0행·감사 없음, 관리자 insert 공백 정리·`created_by` 요청자 고정·audit, update 시 `created_by`·`created_at` 유지·`updated_at` 갱신·audit에 필드 이름만(값 없음), 변화 없는 update 미기록, 카테고리·게임 audit, check 제약 23514, 비공개 전환 후 모임 공간 이름 anon null / 예약어 `운영진`(DB = 프론트) / 관리자 모임 취소(진행 중 허용·종료 후 `MEETING_STARTED`/ended·by_admin) |
| `adapter-contract.test.ts` | 28 | §6 |
| `account-status.test.ts` | 14 | Phase 5 역할×동작 매트릭스 보강([SECURITY §3.1](./SECURITY.md#31-역할--동작-매트릭스와-근거-테스트-phase-5)): 이용 제한·탈퇴 요청 계정도 공개 목록·상세·내 프로필·내 모임 조회 가능, 이용 제한 모임장의 참가자 목록 조회, 이용 제한 모임장 출석 체크 `ACCOUNT_RESTRICTED`·시작 전 취소 허용, 이용 제한 → 탈퇴 요청 가능, 이용 제한·탈퇴 요청의 관리자 기능 `NOT_ADMIN`, 탈퇴 요청 후 시작 전 주최 모임 자동 취소·진행 중 모임 유지·모임장 RPC 5종(수정·마감·취소·승인·출석) `ACCOUNT_DELETION_REQUESTED`, 관리자 행(일반 규칙으로 생성·신청·신고, 남의 모임 수정·마감·승인·출석 `NOT_HOST`, 관리자 취소 허용), **관리자 계정의 상태(마이그레이션 9)**: 이용 제한·탈퇴 요청 상태 관리자는 관리자 조회·쓰기 RPC `NOT_ADMIN`, 관리자 취소 불가, venues·categories update 0행, 숨김 모임·비공개 공간·신고·감사 로그 조회 0행, `get_my_profile().isAdmin` false, admin_roles 행은 남음 / active로 되돌리면 바로 복구 / 관리자가 아닌 active 계정과 같은 결과(대조) / 관리자는 자기 계정을 이용 제한할 수 없음 |

### 5.1 PGlite 검증 결과와 한계

Phase 2 스파이크(`@electric-sql/pglite` 0.6.0)에서 확인한 내용. `pglite-capabilities.test.ts`가 매번 다시 확인한다.

| 기능 | 결과 | 비고 |
|---|---|---|
| `create role anon/authenticated/service_role nologin` | 동작 | |
| `set local role ...`, 트랜잭션 종료 시 복귀 | 동작 | 기본 사용자 `postgres`는 superuser |
| `current_setting('request.jwt.claims', true)`·`request.jwt.claim.sub` | 동작 | **주의**: 한 번 설정됐다 롤백된 GUC는 null이 아니라 `''`로 남는다. `coalesce(a, b)`만 쓰면 다음 요청의 claims를 가린다 → 스텁의 `auth.uid()`는 Supabase 정의와 같이 각각 `nullif(..., '')` 처리(스파이크에서 실제로 0행 버그를 재현·수정) |
| RLS(비소유자 역할에 적용, 소유자·superuser 우회) | 동작 | |
| 컬럼 단위 grant | 동작 | 금지 컬럼·`select *`는 42501 |
| `security definer` + `set search_path` | 동작 | 소유자 권한으로 실행, EXECUTE 회수 적용 |
| `auth.users` after insert 트리거 | 동작 | 비소유자 역할(`supabase_auth_admin`) insert에서도 실행, 트리거 함수 EXECUTE 불필요 |
| `select ... for update`(함수 안) | 문법·실행 동작 | 단일 연결이라 **잠금 대기는 관찰할 수 없음** |
| `pg_get_functiondef`, `pg_advisory_xact_lock`, `gen_random_uuid()`, STORED 생성 컬럼, `raise ... using errcode/message/detail` | 동작 | |
| `clone()` | 동작 | 마이그레이션 적용 템플릿 복제 약 0.2초 |

한계(대체 방법):
- **진짜 동시성 재현 불가**: PGlite는 단일 백엔드다. `@electric-sql/pglite-socket`으로 여러 연결을 받아도 트랜잭션이 직렬화되어, 동시 대기 지점(barrier)을 두는 경쟁 테스트는 교착(타임아웃)된다(직접 확인). → PGlite에서는 순차 신청·`for update` 존재·check 제약을 검증하고, 동시성은 `scripts/race-test.ts`를 실제 Postgres에서 실행한다(§4, `BLOCKED:`).
- **PostgreSQL 버전 차이**: PGlite 0.6은 PostgreSQL 19 기반, Supabase 신규 프로젝트는 15/17(`미확인:` 생성 시점 버전). 마이그레이션은 PG 15에 있는 문법만 쓰고, 버전에 따라 기본값이 다른 부분(생성 컬럼 STORED/VIRTUAL)은 명시했다. 실제 Supabase 적용은 `BLOCKED:`.
- **Supabase 역할 모델 차이**: 하네스의 `postgres`는 superuser, Supabase의 `postgres`는 superuser가 아니지만 테이블·함수 소유자다. security definer RPC가 RLS를 우회하는 동작은 소유자 기준이라 같다. Supabase의 실제 기본 권한(`supabase_admin` 소유 객체 등)과 PostgREST의 GUC 설정 방식은 스텁으로 흉내만 냈다 → 실환경 재확인 필요(§4 "RLS·GRANT 실환경 재확인").
- **auth 스텁 범위**: `auth.users`는 seed가 쓰는 컬럼만 있다. GoTrue가 실제로 넣는 값·트리거 실행 역할은 실환경에서 확인(§4 "가입 트리거").
- **PostgREST 계층 미검증**: HTTP 요청·JSON 인자 직렬화, 오류 응답 필드(`code`/`message`/`details`)와 상태 코드, `select *`와 컬럼 grant 상호작용, 최대 반환 행 수 설정은 PGlite로 확인할 수 없다. RPC 인자 **이름**과 jsonb 키는 §6 계약 테스트가 실제 함수 시그니처로 확인한다.

## 6. 어댑터 계약 테스트 (PGlite)

`supabase/tests/adapter-contract.test.ts` — **실제** `createSupabaseAdapter`(src/data/supabase/adapter.ts)에 가짜 Supabase 클라이언트(`supabase/tests/fake-supabase-client.ts`)를 주입해 어댑터 → 실제 SQL 함수 경로를 검증한다.

가짜 클라이언트가 하는 일(PostgREST 흉내):
- `.rpc(fn, args)` → 현재 세션의 역할로 `select public.<fn>(p_a => $1::<타입>, ...)`를 실행한다. 역할·claims 전환은 하네스의 `asUser`/`asAnon`(트랜잭션 단위)을 그대로 쓴다. 인자 타입은 `pg_proc`에서 읽고, 함수에 없는 인자 이름이면 PostgREST처럼 `PGRST202`. jsonb 인자는 JSON 값 그대로(`JSON.stringify`) 넘긴다(문자열을 보내면 jsonb 문자열이 된다).
- 결과는 `{ data, error: { code, message, details, hint }, status }`(void → `data: null`, 42501은 anon 401·로그인 403).
- `.from('categories'|'regions').select(cols).eq(col, v).order(col)`만 지원. auth는 메모리 세션(`signInAs`/`signOutNow`)과 이벤트.

검증하는 흐름(28개 — Phase 3 18개 + Phase 4 8개 + Phase 5 검수 2개): 공개 목록·상세·기준 데이터(프론트 상수와 동일), 필터(KST 날짜 경계 00:00/전날 23:30·카테고리·권역·검색어(게임명·권역명)·모집 중·정렬·페이지), 비로그인 신청·내 모임 → RPC 없이 `AUTH_REQUIRED`(어댑터를 거치지 않은 anon 직접 호출은 42501 → `PERMISSION_DENIED`), 없는 인자 이름 → `PGRST202`, 생성 → 신청(auto 확정·manual 대기) → 승인 → 신청 취소 → 모임 취소, 수정(전체 값 전송으로 선택 값 유지)·모집 마감/재개·`NOT_HOST`, 입력 검증 detail(`title`·`start_at`)·홀덤 동의, 중복 `ALREADY_APPLIED`·`OWN_MEETING`, 정원 초과 `waitlisted`/`MEETING_FULL`·승인 시 재검사, 내 모임(숨김 모임 joined.meeting = null), 참가자 목록 권한(`NOT_HOST`·숨김 `NOT_FOUND`), 출석 체크(시작 후 확정 게스트·`ATTENDANCE_WINDOW_CLOSED`·`NOT_HOST`), 모임장 계정 삭제(hostId·hostNickname null, `MEETING_NOT_OPEN`/`host_missing`), 온보딩(`PROFILE_INCOMPLETE` → 완료)·닉네임 중복·예약어·부분 수정, 관리자 여부, 탈퇴 요청(비식별화·이후 `ACCOUNT_DELETION_REQUESTED`·멱등), auth 이벤트 → 실제 `get_my_profile`로 SessionUser. Phase 4: 공개 공간 목록·필터·상세(비공개·잘못된 id null, 관리자도 공개만), `listMeetings({ venueId })`, 게임 연결 보존(`game_id` 유지 ↔ 이름 바꾸면 `game_name`), 신고 접수·중복·자기 신고·기타 본문·없는 대상·비로그인 RPC 미호출, 일반 사용자의 관리자 메서드 전부 `NOT_ADMIN`(테이블 insert 42501·update 0행 포함, 관리자 취소의 없는·숨김 모임은 계정 → 모임 존재 → 권한 순서라 `NOT_FOUND` — mock과 같은 결과), 관리자 신고 목록·처리·모임 숨김 → 공개 목록에서 사라짐 → 해제·관리자 취소·audit 순서, 사용자 검색·상태 변경(본인·탈퇴 요청 불가), 공간 등록·수정·공개 전환(트리거 `created_by`)·검증 detail(`website_url`·`name`)·카테고리 비활성 → `listCategories`에서 빠짐·audit.
- 가짜 클라이언트는 Phase 4에서 (1) setof/table 반환 RPC를 PostgREST처럼 행 배열로, (2) `table('venues'|'categories').insert/update`를 `jsonb_populate_record`로 형 변환해 현재 역할(RLS 적용)로 실행하도록 넓혔다.

- 모든 응답은 어댑터의 Zod 검증(`mapping.ts`)을 통과해야 하므로, SQL 출력 키·타입이 바뀌면 이 테스트가 실패한다.
- 변이 확인(2026-11-24, 수동): `get_meeting` 인자 이름을 바꾸거나 `allow_waitlist` 키 이름을 바꾸면 당시 17개 중 7개가 실패하는 것을 확인하고 되돌렸다.
- **검증되지 않는 것**: PostgREST 계층 자체(HTTP, 인자 직렬화·형 변환, 함수 선택, 오류 응답의 실제 필드·상태 코드), 실제 Supabase Auth(PKCE 교환·토큰 갱신·탭 간 이벤트), JWT 검증, 네트워크 오류. → §4 "PostgREST 계층", "Google/Kakao OAuth 왕복"(`BLOCKED:`).
- 단위 테스트(`src/data/supabase/*.test.ts`)는 네트워크 없는 가짜 클라이언트(`src/test/fakeSupabaseClient.ts`)로 오류 매핑, 응답 검증(정상·누락·타입·모르는 코드·시각 정규화), 인자 변환(KST 경계·빈 값 생략·전체 키·오프셋), 세션 없을 때 RPC 미호출, service_role 가드, returnTo·콜백·Kakao 플래그, auth 이벤트 처리를 검사한다.

## 7. E2E 시나리오 (mock)

1. 비로그인 탐색: 필터 조합 → URL 확인 → 새로고침 → 상세 → 뒤로가기 시 필터 유지.
2. 비로그인 신청 → 로그인(개발용 계정) → 상세 복귀 → 신청 → 상태 "참가 확정".
3. 모임 만들기 → 상세 → 참가자 관리 → 다른 계정으로 신청 → 승인 → 출석은 기간 외 비활성.
4. 모임 취소 → 참가자 계정 내 모임 '취소' 탭.
5. 신청 실패 주입 → 오류 문구 → 재시도 성공.
6. 일반 계정 `/admin`, 타인 모임 `/edit`·`/participants` 직접 접근 → 권한 없음.
7. 404, 존재하지 않는 모임 id, 잘못된 쿼리 값.
8. 6개 뷰포트 오버플로·겹침 검사 + 스크린샷.
9. (Phase 4, `e2e/phase4.spec.ts` 18개) 공간 목록 → 권역·유형 필터(URL·새로고침 유지) → 상세 → 외부 링크 https·`target=_blank`·`rel="noopener noreferrer"` / 모임 상세 장소명 → 공간 상세·예약 링크 / 로그인 사용자 모임 신고 → "신고가 접수됐어요" → 같은 대상 재신고 중복 안내 / 비로그인 신고 → 로그인 → 복귀 / 관리자 dev 계정: 프로필 → 관리자 도구 → 신고 상태·메모 저장 → 모임 숨김 → 탐색 목록에서 사라짐 → 해제 → 다시 보임 / 일반 계정 `/admin` 권한 없음·관리자 메뉴 없음 / 비로그인 `/admin` → 로그인 / 정책 3개 + 초안 배너 + 없는 slug 404 / 320px 공간 찾기 필터 줄 라벨(권역·유형) 보임·칩 높이 42px 이상·라벨과 칩 같은 줄 / 공간 목록·공간 상세·정책 3개·관리자 5개 탭·공간 등록 폼을 6개 뷰포트에서 가로 오버플로 없음.
10. (Phase 5, `e2e/a11y.spec.ts` 17개) axe 390·1280px × (비로그인 화면 / 로그인 화면 / 관리자 화면) 6개, `region`·`heading-order` 0건 390·1280px 2개(홈 개발용 안내 띠·내 모임 두 탭·공간 등록 폼·이용 제한된 관리자의 계정 상태 안내 띠와 `/admin` 권한 없음), 키보드 7개(건너뛰기 링크 2, 헤더 Tab 순서 1280·390, 지역 선택·신청 대화상자 포커스 트랩·ESC·복귀, 관리자 탭 화살표 키), 글자 200% 390·1280px 2개. 결과는 §3.
11. (Phase 5, `e2e/csp.spec.ts` 5개 — `npm run test:csp`, 빌드 결과 필요) [SECURITY §7](./SECURITY.md#7-보안-헤더와-csp).
12. (출시 전 마무리, `e2e/timezone.spec.ts` 6개 = 3개 × 브라우저 시간대 America/Los_Angeles·UTC) 브라우저 시간대와 `Intl` 결과가 정말 바뀌었는지 먼저 확인 →
    - KST 자정 직후(UTC 11-27 15:10 = KST 11-28 00:10, 기기 날짜는 11-27): 날짜 칸의 "오늘"이 토 11.28이고 금 11.27 칸이 없음, 날짜 필터 11.28 = 3시간 뒤 모임 1개(KST 03:30), 11.29 = 19:00·20:00 모임 2개(목록 행의 `time[datetime]`이 모두 그 KST 날짜), 목록·상세 시각 글자(`11.29 (일) · 19:00`, `2026년 11월 29일 (일)`, `오후 7:00 ~ 오후 9:30`).
    - KST 자정 직전(UTC 14:58) → `page.clock.fastForward` 5분 → 다시 열기: 오늘이 금 11.27 → 토 11.28로 바뀜, 기기 날짜로는 11-27인 KST 새벽 모임이 11.28 필터에 들어감.
    - 모임 만들기: 날짜 입력 `min`이 KST 오늘(11-28), 기본값이 KST 내일, KST 11-28 01:00으로 저장 → 상세 `time[datetime]` = `2026-11-27T16:00:00.000Z`·`2026년 11월 28일 (토)`·`오전 1:00 ~ 오전 3:00`, 탐색 11.28 필터 행 `11.28 (토) · 01:00`, 수정 화면 날짜·시간이 같은 값.
    - 검출력: `getKstParts`가 기기 시간대를 쓰게 바꾼 변이에서 6개 모두 실패하는 것을 확인하고 되돌렸다(2026-11-25).

## 8. 결과 기록

- 각 Phase 종료 시 실제 실행한 명령과 통과·실패 수를 [CHANGELOG](./CHANGELOG.md)에 남긴다. 실행하지 않은 테스트는 "미실행"으로 적는다.
- 실패를 남긴 채 다음 Phase로 갈 때는 원인과 영향 범위를 [NEXT_STEPS](./NEXT_STEPS.md)에 적는다.
- 스크린샷: `docs/screenshots/phase1/`(Phase 1~3 화면), `docs/screenshots/phase4/`(venues-390·venues-1280·venue-detail-390·admin-1280(신고 탭)·policy-390), `docs/screenshots/phase5/`(글자 200%: home-390·detail-390·create-1280·venues-1280·admin-1280 `-text200`), `docs/screenshots/reference/`(v3 시안). `npm run screenshots`로 다시 만든다(29장). mock 예시 데이터의 시각이 실행 시각 기준이라 다시 찍으면 시각 글자만 바뀐 PNG가 생긴다.

## 9. 최종 결과 (Phase 5, 2026-11-25 실제 실행)

검수 반영(관리자 권한에 계정 상태 반영 — 마이그레이션 9, axe moderate 정리) 뒤 다시 실행한 결과다.

| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run verify` | 통과 | typecheck → lint → test **52개 파일 438개**(Phase 4: 48개 파일 387개) → test:db **13개 파일 232개**(216) → build(+ `dist/_headers`) → check:seed → check:dist |
| `npm run test:e2e` | **63개 통과**(46 → 63) | explore 15·meetings 13·phase4 18·a11y 17 |
| `npm run screenshots` | **29개 통과**(24 → 29) | phase5 글자 200% 5장 추가 |
| `npm run test:csp` | **5개 통과**(신규) | mock 빌드 4 + 가짜 Supabase env 운영 빌드 1, CSP 위반 0건 |
| `npm run check:builds` | **15/15 통과**(신규) | env 없음·가짜 env 빌드 성공 + 막혀야 할 설정 5종 빌드 실패 |

새 테스트 종류: 보안 헤더 생성 단위 테스트, Zod jitless, 색 대비(토큰 파싱), 소스 보안 감사·VITE_ 목록 일치, 역할×동작 매트릭스 DB 테스트, 접근성 E2E(axe·키보드·글자 200%), CSP 스모크(빌드 결과 + 생성 헤더), 빌드 변형 검증, 산출물 점검(`check:dist`).
미실행(`BLOCKED:`): 실제 Supabase(PostgREST·OAuth·RLS 실환경·동시 신청 경쟁 §4.1), 실제 Cloudflare Pages(헤더·SPA 딥링크), 스크린리더·실기기 Safari.

## 10. 결과 (출시 전 마무리, 2026-11-25 실제 실행)

CI 워크플로·시간대 테스트·mock 관리자 취소 순서 수정 뒤 이 PC(Windows, Node 24.18.0, 시스템 시간대 KST)에서 실행한 결과다. CI(GitHub Actions)에서는 아직 실행하지 않았다(푸시 전).

| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run verify` | 통과 | test **52개 파일 438개**, test:db **13개 파일 232개**(계약 테스트 28개 — 단언 추가, 개수 그대로), build, check:seed(54개 파일), check:dist |
| `npm run test:tz -- UTC America/Los_Angeles` | **438개 통과 × 2** | 자식 프로세스의 시간대 확인: UTC(오프셋 0), America/Los_Angeles(1월 -480분·7월 -420분). 기본(`npm run test:tz`)은 LA만 |
| `npm run test:e2e` | **69개 통과**(63 → 69) | `e2e/timezone.spec.ts` 6개 추가 |
| `npm run test:csp` | **5개 통과** | |
| `npm run check:builds` | **15/15 통과** | |
| `CI=true TZ=UTC`로 test:e2e → test:csp | 69 + 5개 통과 | CI 설정 경로 확인: 개발 서버 새로 띄움, HTML 리포트 `playwright-report/`·`playwright-report/csp/`가 서로 덮어쓰지 않음, CSP 결과 `test-results/csp/` |
| `CI=true TZ=UTC`, test:e2e `--workers=2` | 69개 통과, **3.9분** | CI 러너와 같은 worker 수로 시간 추정. 가장 긴 테스트 20.0초(참가자 관리 흐름 — mock 지연 300ms가 쌓임) → CI 제한 60초 여유. 러너 CPU가 더 느리면 더 걸린다 |
| `npm run screenshots` | 미실행 | 화면 모양 변경 없음 |

- 검출력: `getKstParts`를 기기 시간대로 바꾼 변이 → `e2e/timezone.spec.ts` 6개 모두 실패. mock `adminCancelMeeting`을 이전 순서로 되돌린 변이 → 계약 테스트·mock 단위 테스트 각 1개 실패(`NOT_ADMIN` ≠ `NOT_FOUND`). 둘 다 되돌림.
- CI 워크플로: YAML은 playwright-core에 들어 있는 `yaml` 파서로 엄격 모드(중복 키 금지) 파싱 통과, 단계의 `npm run` 대상이 package.json에 모두 있음. GitHub에서의 실제 실행·actions 버전(v5)은 미확인(첫 실행 때 확인 — README "CI").
