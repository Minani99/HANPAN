# 변경 기록

상태: 출시 전 마무리까지 기록 (2026-11-25)

형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를 따른다. 각 항목에는 실제로 끝난 작업과 실제로 실행한 검증만 적는다.

## [Unreleased]

### 추가 — 출시 전 마무리 (CI·시간대·문서, 2026-11-25)

커밋·푸시하지 않았다(GitHub에 올린 것 없음). 새 의존성 없음. 마이그레이션 1~9·루트 원본 문서 4개·v3 디자인(토큰·레이아웃·모양)은 고치지 않았다.

- **GitHub Actions CI** `.github/workflows/ci.yml`: `main` push·`main` 대상 PR·수동 실행. `permissions: contents: read`, 같은 ref의 이전 실행 취소(`concurrency`), `timeout-minutes: 40`, secrets 없음(Supabase env 없이 빌드 → unconfigured). ubuntu-24.04(UTC)에서 checkout(`persist-credentials: false`) → setup-node(`.nvmrc`, npm 캐시) → `npm ci` → `npm run verify` → `npm run test:tz` → `npx playwright install --with-deps chromium` → `npm run test:e2e` → `npm run test:csp` → `npm run check:builds`, 실패 시 `playwright-report/`·`test-results/`를 artifact(7일). actions는 `actions/checkout@v5`·`actions/setup-node@v5`·`actions/upload-artifact@v5` — 이 PC에서 버전을 확인할 수 없어 주석에 "첫 실행 때 확인"으로 표시.
- CI 환경 점검(스크립트를 읽고 로컬에서 확인): Windows 경로·`cmd` 문법·로컬 캐시 경로 가정 없음(스크립트는 `node:path`·`process.execPath`·`node_modules/.tmp`), 순서가 중요한 `readdirSync`는 모두 정렬, 상대 import 923개가 디스크 대소문자와 일치(Linux는 대소문자 구분), Git 인덱스 경로 303개도 디스크와 대소문자 일치, `package-lock.json`에 Linux x64용 네이티브 패키지(rolldown·tailwind oxide·lightningcss) 있음, `npm ls --all` exit 0(오류 없음 — `UNMET OPTIONAL`은 다른 플랫폼 바이너리·선택 peer뿐), lockfile 루트 의존성 = package.json.
- Playwright 설정 CI 보정(로컬 값은 그대로): `playwright.config.ts` — CI에서 테스트 제한 60초·`expect` 10초(로컬에서 20~25초 걸리는 테스트가 있어 느린 러너에서 기본 30초에 걸릴 수 있음). `playwright.csp.config.ts` — CI에서 1회 재시도(글꼴 CDN 응답도 확인), HTML 리포트(`playwright-report/csp`), 출력 폴더 `test-results/csp`(E2E 결과와 겹치지 않게). `reuseExistingServer`(E2E는 CI에서 끔, CSP는 항상 끔)·포트(5179, 4179·4180 — 사용자 미리보기 5173과 겹치지 않음)는 그대로 맞다.
- **시간대**: `npm run test:tz`(`scripts/test-tz.mjs`) — 단위·컴포넌트 테스트를 다른 시스템 시간대로 한 번 더(기본 America/Los_Angeles, 인자로 여러 개). 자식 프로세스에 TZ를 직접 넘기고 적용 여부를 먼저 확인(모르는 이름은 실패), `src/test/setup.ts`가 `HANPAN_TEST_TZ`와 실제 시간대를 비교. E2E `e2e/timezone.spec.ts`(6개 = 3개 × LA·UTC 브라우저): `page.clock`으로 KST 자정 직전·직후에 고정해 날짜 칸의 오늘·날짜 필터·목록/상세 시각·모임 만들기 날짜·시간 저장(상세 `datetime`·수정 화면 왕복)을 KST로 확인.
- 문서: README 첫머리(소개·현재 상태 표 — MVP·배포 전·mock 데이터·Supabase 미연결·CI, 빠른 시작, 문서 링크 표), 명령어 표(`test:tz`, E2E 시간대), "CI" 절(무엇을 돌리는지·첫 push 뒤 Actions 탭에서 확인할 것, 배지 없음), 폴더 구조. NEXT_STEPS(Git 원격 저장소 완료 — `Minani99/HANPAN`·`main`, CI 준비, 결정 #11 저장소 라이선스·#12 디자인 시안 사진 라이선스·#13 Dependabot), DEPLOYMENT(§1 Git 저장소 준비됨, §11 CI), TEST_PLAN(§1 시간대·CI 행, §2 #4, §6, §7-12, §10 결과).
- 공개 저장소 점검: README·docs에서 개인 정보(이름·이메일·회사)·이 PC 경로(`C:\Users\...`)를 grep — 해당 없음(예시 주소 `race-…@example.invalid`, `NODE_TLS_REJECT_UNAUTHORIZED` 권고 문구는 그대로).

### 수정 — 출시 전 마무리 (2026-11-25)

- **mock `adminCancelMeeting` 판단 순서를 DB `cancel_meeting`과 같게**: 계정 확인(로그인·탈퇴 요청) → 모임 존재(없거나 볼 수 없는 숨김 모임이면 `NOT_FOUND`) → 권한(관리자가 아니면 `NOT_ADMIN`). 전에는 일반 사용자가 없는 모임을 관리자 취소하면 mock은 `NOT_ADMIN`, Supabase 어댑터는 `NOT_FOUND`였다(`src/data/mock/rules.ts`).
- 테스트: 계약 테스트 "일반 사용자는 관리자 메서드가 전부 NOT_ADMIN"에 없는 모임·숨김 모임의 관리자 취소가 Supabase 어댑터(실제 SQL)와 mock에서 모두 `NOT_FOUND`인지 단언 추가(테스트 수 28 그대로, 비교 도우미 `codeOf`를 파일 위로 옮김). `src/data/mock/phase4.test.ts`에 같은 단언(비로그인은 `AUTH_REQUIRED`). 고치기 전 mock으로 두 테스트가 `NOT_ADMIN`으로 실패하는 것을 확인한 뒤 되돌림.

### 발견 — 출시 전 마무리 (2026-11-25)

- **시간대 버그는 없었다**: 앱 코드는 이미 모든 날짜·시각 계산을 `Intl.DateTimeFormat`(`timeZone: 'Asia/Seoul'`)로 해서 기기 시간대에 기대지 않는다. 단위 테스트 전체가 UTC·America/Los_Angeles에서 통과했고, 새 E2E도 LA·UTC 브라우저에서 통과했다. `src/` 앱 코드의 시간대 의존 API(`getHours`·`setHours`·`toLocaleString` 등) 사용 0건.
- **테스트 실행 방법의 함정**: Windows Git Bash에서 `TZ=America/Los_Angeles npm run test`는 MSYS가 `/`가 든 TZ 값을 Windows 프로그램에 넘기지 않아 아무 표시 없이 KST로 돈다(`TZ=UTC`는 넘어간다). 그래서 `npm run test:tz`를 만들었다. 이전 문서의 "`TZ=America/Los_Angeles`에서도 통과" 확인은 이 방식이었다면 실제로는 KST였을 수 있다(date.test.ts 안의 시간대 전환 테스트는 별개로 유효).
- mock과 DB의 남은 차이(고치지 않음): (1) 일반 사용자가 **자기가 연 모임**에 `adminCancelMeeting`을 부르면 DB는 모임장 취소로 성공(시작 전), mock은 `NOT_ADMIN`. 화면은 관리자에게만 관리자 취소를 보여 주므로 실제 경로는 없다. (2) 취소 사유 200자 초과 검사 순서: DB는 모임 확인 전, mock(`cancelMeeting`)은 마지막.
- 디자인 시안 사진: `hanpan_v3_design_lab.html`에 내장된 사진은 서로 다른 JPEG **4장**(히어로 1 + 썸네일 3)이다. 출처 미확인 — NEXT_STEPS #12.

### 검증 — 출시 전 마무리 (2026-11-25, 실제 실행)

- `npm run verify` 통과: test **52개 파일 438개**, test:db **13개 파일 232개**, build, check:seed, check:dist.
- `npm run test:tz -- UTC America/Los_Angeles`: **438개 × 2 통과**(자식 프로세스 시간대 확인 포함).
- `npm run test:e2e` **69개 통과**(63 + 시간대 6). `npm run test:csp` **5개 통과**. `npm run check:builds` **15/15 통과**.
- CI 설정 경로: `CI=true TZ=UTC`로 test:e2e(69)·test:csp(5) 통과, HTML 리포트·trace 폴더가 서로 덮어쓰지 않음. 같은 설정 + `--workers=2`(CI 러너와 같은 worker 수) E2E 69개 3.9분, 가장 긴 테스트 20.0초.
- `npm run screenshots`는 돌리지 않았다(화면 모양 변경 없음).
- **미검증**: GitHub Actions에서의 실제 실행(푸시 전), actions 메이저 버전(v5) 존재·Node 런타임 경고, Linux 러너의 글꼴·속도에 따른 E2E 시간.

### 수정 — Phase 5 검수 반영 (2026-11-25)

- **관리자 권한에 계정 상태 반영(선택지 b)**: 새 마이그레이션 `supabase/migrations/20261124000900_admin_requires_active.sql` — `is_admin()`을 "admin_roles 행 + `profiles.status = 'active'`"로 `create or replace`(시그니처·stable·security definer·search_path 그대로, 권한 revoke/grant 다시 명시, RLS 정책은 함수를 OID로 참조하므로 다시 만들지 않음). 기존 마이그레이션 1~8은 고치지 않음. 결과: 이용 제한·탈퇴 요청 상태 관리자는 관리자 RPC `NOT_ADMIN`, venues·categories·games 쓰기 RLS 거부, 숨김 모임·비공개 공간·남의 신고·감사 로그 조회 불가, 관리자 취소 불가, `get_my_profile().isAdmin` false. active로 되돌리면 바로 복구. 관리자는 자기 계정을 이용 제한할 수 없어(`admin_set_user_status` 본인 대상 거부) 실수로 권한을 잃지 않는다.
- mock도 같은 규칙: `src/data/mock/rules.ts`의 `hasAdminPower()`(관리자 역할 + active)로 관리자 메서드(`NOT_ADMIN`)·숨김 모임·비공개 공간 이름·세션/프로필 `isAdmin`을 판단. `adminCancelMeeting`은 DB `cancel_meeting`처럼 계정 확인(탈퇴 요청 → `ACCOUNT_DELETION_REQUESTED`)을 관리자 확인보다 먼저 한다.
- 테스트: `account-status.test.ts`의 "현재 동작 기록"을 새 규칙으로 교체(11 → 14개 — 상태별 권한 상실·active 복구·비관리자와 같은 결과·자기 제한 불가), `schema.test.ts` 마이그레이션 목록 9개, 계약 테스트에 Supabase 어댑터 = mock 단언 2개(26 → 28), `src/data/mock/phase4.test.ts` 2개.
- **axe moderate 정리(모양 변경 없음)**: 개발용 안내 띠와 계정 상태 안내 띠를 이름 붙은 `<aside>`(개발 환경 안내·계정 상태 안내)로 감쌈(`region`), 공간 등록 폼 제목 h3 → h2, 내 모임 행 제목 h3 → h2(`MeetingRow`의 `headingLevel` — 기본 3, className 그대로)(`heading-order`). `e2e/a11y.spec.ts`에 390·1280px `region`·`heading-order` 0건 단언 2개(이용 제한된 관리자의 안내 띠·`/admin` 권한 없음 포함). axe 스캔 화면에서 그 밖의 moderate·minor 0건.
- 문서: SECURITY(§3·§3.1·§9·§13), DB_SCHEMA(마이그레이션 표·§9.1), OPERATIONS(§6 관리자 제한 시 권한 즉시 정지·해제는 admin_roles 삭제, §7 쿼리 6), DEPLOYMENT(마이그레이션 9개·적용 순서·확인 SQL·§3.4), NEXT_STEPS(결정 목록에서 이 항목 제거), TEST_PLAN, ROADMAP, README.
- 검증(실제 실행): `npm run verify` 통과 — test **52개 파일 438개**, test:db **13개 파일 232개**, build, check:seed, check:dist. `npm run test:e2e` **63개 통과**. `npm run test:csp` 5개, `npm run check:builds` 15/15, `npm run screenshots` 29개 통과.

### 추가 — Phase 5 (출시 전 QA·접근성·보안 점검, Cloudflare Pages 배포 준비, 2026-11-25)

실제 배포는 하지 않았다. 외부 계정 생성·`wrangler`·Supabase CLI 설치·로그인 없음. 마이그레이션 1~8·루트 원본 문서 4개는 고치지 않았다.

- 보안 헤더 빌드 생성: `scripts/lib/security-headers.mjs`(순수 함수 — CSP·보안 헤더·`_headers` 생성·해석, `VITE_SUPABASE_URL` → origin 검증: https만, 경로·쿼리·사용자 정보·줄바꿈·세미콜론·따옴표 등 거부), `scripts/write-headers.mjs`(`npm run build`의 마지막 단계 → `dist/_headers`. Supabase 설정이 없으면 connect-src `'self'`만 + 콘솔 알림, 잘못된 URL·`404.html` 있으면 빌드 실패). 기준 초안보다 좁힘: `default-src 'none'`, `img-src`에서 `data:` 제외, 글꼴은 jsDelivr 호스트 전체가 아니라 SUIT 저장소 경로만, `font-src`에서 `'self'` 제외. 항목별 이유는 SECURITY §7.
- `vite preview`가 빌드 결과의 `_headers`를 Cloudflare Pages처럼 응답에 붙임(`vite.config.ts` 미리보기 플러그인).
- **CSP 수정**: Zod 4가 스키마 생성 때 `new Function("")`으로 eval 가능 여부를 시험해 CSP 위반(script-src, blocked eval)이 기록되던 문제를 CSP 스모크로 찾아, `src/lib/zodConfig.ts`(`config({ jitless: true })`)를 `main.tsx` 첫 import로 추가. `'unsafe-eval'`은 넣지 않음.
- CSP 스모크 테스트 `npm run test:csp`(`playwright.csp.config.ts`, `e2e/csp.spec.ts` 5개, `scripts/csp-preview.mjs`, `e2e/csp-teardown.ts`): mock 빌드·가짜 Supabase env 운영 빌드를 임시 폴더에 만들고 생성 헤더로 주요 화면 위반 0건 확인, 대조군(인라인 script·style 속성 차단 감지, React style prop은 적용), 글꼴 로드, Google 버튼 전체 페이지 이동.
- SPA 폴백: `public/_redirects` 삭제(Pages가 `/* /index.html 200`을 무한 루프 규칙으로 무시) → `404.html`이 없을 때의 Pages SPA 기본 동작 사용. 실제 동작은 첫 프리뷰 때 확인(DEPLOYMENT §8).
- 산출물 점검 `npm run check:dist`(`scripts/check-dist.mjs`, verify에 추가): `404.html`·`_redirects` 없음, `_headers`가 현재 env와 일치, `index.html` 인라인 script·style·이벤트 속성 없음, `sb_secret_` 키 값·role이 anon이 아닌 JWT 없음, `robots.txt`.
- 빌드 변형 검증 `npm run check:builds`(`scripts/check-builds.mjs`, `scripts/lib/build-variant.mjs`): 임시 폴더에 env 없음·가짜 Supabase env(`https://example-ref.supabase.co` + 가짜 anon JWT) 운영 빌드 → check:seed·check:dist, service_role JWT·`sb_secret_`·`VITE_SUPABASE_SERVICE_ROLE_KEY` 이름(키 가드)·http URL·경로 URL(헤더 생성)은 빌드 실패.
- `.nvmrc`(24.18.0), `public/robots.txt`(전체 허용, `/admin`·`/auth/`만 Disallow — 보안 수단 아님).
- 개발 의존성 `@axe-core/playwright` 4.14.1(정확한 버전, integrity 확인).
- 접근성: `e2e/a11y.spec.ts`(15개) — axe 390·1280px(CSP 스모크와 같은 화면, serious·critical 0건), 키보드(건너뛰기 링크, 헤더 Tab 순서·포커스 링, 지역 선택·신청 대화상자 포커스 트랩·순환·ESC·복귀, 관리자 탭 화살표 키), 글자 200%(루트 32px) 390·1280px 가로 넘침·주요 컨트롤. 스크린샷 `docs/screenshots/phase5/*-text200.png` 5장.
- 접근성 수정(화면 모양 변경 없음):
  - 날짜 칸 버튼·날짜 해제 칩: `aria-label`이 보이는 글자를 포함하지 않던 문제(axe serious `label-content-name-mismatch`, WCAG 2.5.3) → 보이는 글자 + `VisuallyHidden` 설명으로 이름 구성. 버튼에 `relative`(숨긴 설명이 가로 스크롤 영역 밖으로 빠져 문서 가로 넘침을 만들던 것 방지 — 기존 320·375·390px 오버플로 E2E가 잡음).
  - 글자 200%에서 목록 로딩 스켈레톤 막대(고정 rem 폭)가 390px에서 14px 넘침 → `max-w-full`.
  - 최초 설정의 약관·방침 새 탭 링크에 스크린리더용 "(새 창에서 열림)".
- 색 대비 단위 테스트 `src/styles/contrast.test.ts`: index.css 토큰을 읽어 18쌍 계산(글자 4.5:1, 포커스 3:1) + 알려진 예외 3쌍 비율 기록(muted/soft 4.22, muted/hover 4.33, border/surface 1.23 — 토큰 변경 없음, 사용자 결정 필요).
- 소스 보안 감사 `src/lib/securityAudit.test.ts`: innerHTML·eval·new Function 등 0건, `service_role`·`sb_secret_`은 키 가드에만, console은 devConsole에만, localStorage는 mock에만, sessionStorage는 returnTo에만, 외부 새 창 링크는 ExternalLink에만, `VITE_` 이름 목록이 코드·`vite-env.d.ts`·`.env.example`·README·ARCHITECTURE·DEPLOYMENT에서 같음. dist 감사 결과는 SECURITY §14.
- 권한: SECURITY §3.1 역할 × 동작 매트릭스(근거 테스트 파일·케이스), DB 테스트 `supabase/tests/account-status.test.ts`(11개 — 이용 제한·탈퇴 요청·관리자 행의 빈 칸).
- 문서: DEPLOYMENT 전면 정리(따라 하는 순서, env 표, Supabase·Auth URL·와일드카드 위험, Google·Kakao, Pages 빌드 설정·Node 버전, SPA 폴백 근거, 첫 프리뷰 확인, 배포 직후 스모크, 롤백, 배포 전 체크리스트), OPERATIONS(§7 모니터링 — 외부 도구 미사용·후보만, §8 백업 — `pg_dump` 절차·암호화 보관, §9 장애·사고 체크리스트 — 다운·키 노출·개인정보 유출·스팸·금전성 도박), SECURITY(§3.1·§7·§12·§13·§14), TEST_PLAN(§1·§3 결과·§4.1 동시 신청 경쟁 실행 절차·§5·§7·§9), UI_SPEC(§2.1 계산값·§8 접근성 규칙), ARCHITECTURE, README, ROADMAP, NEXT_STEPS(출시 체크리스트, 글꼴 결정), DB_SCHEMA(링크).
- 기존 테스트 수정: `ExplorePage.test.tsx`(날짜 칸 이름 — aria-label 대신 보이는 글자 + 숨긴 설명), `e2e/helpers.ts`(`waitForPage` 타임아웃 인자, `ZOOM_200_CSS`), `e2e/screenshots.spec.ts`(phase5 5장, 캡처 대기 20초, 홈·내 모임은 목록 행이 보인 뒤 캡처), `playwright.config.ts`(csp.spec 제외).

### 발견 — Phase 5 (고치지 않고 보고)

- 관리자 RPC·관리자 테이블 쓰기는 `is_admin()`(admin_roles)만 보고 계정 상태를 보지 않는다 — 이용 제한·탈퇴 요청 상태 관리자도 관리자 기능 사용 가능. → 검수 결정으로 마이그레이션 9에서 해결(위 "수정 — Phase 5 검수 반영").
- v3 토큰 대비: muted 글자가 soft·hover 배경 위 4.5:1 미달, 입력·칩 테두리 1.23:1(NEXT_STEPS §1 #5·#6).
- axe moderate(통과 기준 밖): mock 전용 개발용 안내 띠가 랜드마크 밖(`region`), 공간 등록 폼·내 모임의 제목 순서(`heading-order`). → 검수 때 고침.
- 스크린샷 재생성 후 스테이징본과 다른 PNG 10장(픽셀 비교):
  - 9장(phase1 home 6·participants-1280, phase4 admin-1280·venue-detail-390): mock 예시 데이터의 시각(실행 시각 기준) 글자만 다름 — 모임 시작 시각·신청 시각·신고 접수 시각의 작은 영역. 날짜 칸 등 이번에 고친 부분의 모양은 바뀌지 않음.
  - `my-meetings-390`: 스테이징본은 목록 **로딩 스켈레톤**이 찍혀 있었다(Phase 4 캡처 스크립트가 제목만 기다림). 캡처 스크립트가 목록 행을 기다리도록 고쳐 불러온 화면으로 다시 찍음(높이 969 → 900px).
  - 새 PNG 5장: `docs/screenshots/phase5/*-text200.png`.

### 검증 — Phase 5 (2026-11-25, 실제 실행)

- `npm run verify` 통과: typecheck → lint → `test` **52개 파일 436개** → `test:db` **13개 파일 227개** → build(+ `dist/_headers`, connect-src `'self'`) → check:seed(dist 54개 파일) → check:dist.
- `npm run test:e2e` **61개 통과**(46 + a11y 15). `npm run screenshots` **29개 통과**(24 + phase5 5). `npm run test:csp` **5개 통과**(위반 0건). `npm run check:builds` **15/15 통과**.
- CSP 스모크 검출력: Zod jitless를 끈 빌드에서 5개 중 3개가 CSP 위반으로 실패하는 것을 확인한 뒤 되돌림.
- **미검증(`BLOCKED:`)**: 실제 Cloudflare Pages(헤더 적용·SPA 딥링크·Node 버전), 실제 Supabase·OAuth, 동시 신청 경쟁(`scripts/race-test.ts`), 백업 복원 시험, 스크린리더·실기기 Safari.

### 추가 — Phase 4 (공간·신고·관리자·정책, 2026-11-25)

- 마이그레이션 3개(기존 파일은 고치지 않음):
  - `20261124000600_venues_read.sql`: `venue_to_json`·`list_public_venues(p_region, p_type)`·`get_venue(p_venue_id)`(security invoker, 공개 공간만 — 관리자도), `list_public_meetings`에 `p_venue_id uuid default null` 추가(기존 함수 drop 후 재생성 — 오버로드로 이름 지정 호출이 모호해지는 것 방지, 기존 인자 호출 호환).
  - `20261124000700_admin_tools.sql`: `admin_list_meetings`(숨김·취소·종료 포함, 검색·숨김만·페이지), `admin_list_report_items`(신고 + 대상 제목/닉네임·신고자 닉네임), `admin_list_venues`(비공개 포함), `admin_list_categories`(비활성 포함) — 모두 `NOT_ADMIN`. 공간 쓰기 보정 트리거 `_venues_before_write`(공백 정리, `created_by` 요청자 고정, 수정 시 `created_by`·`created_at` 유지). 관리자 테이블(venues·categories·games) 쓰기 감사 트리거 `_audit_admin_table_change`(security definer, 바뀐 필드 이름만 기록).
  - `20261124000800_nickname_rules_v2.sql`: 닉네임 예약어 포함 금지에 `운영진` 추가(프론트 `isReservedNickname`도 같은 규칙).
- 데이터 계약(`src/data/types.ts`·`adapter.ts`): `Venue`·`VenueFilters`·`VenueInput`, `ReportInput`·`ReportReason`·`ReportStatus`, `AdminReport`·`AdminMeeting`·`AdminUser`·`AdminCategory`, `Meeting.gameId?`·`MeetingInput.gameId?`·`MeetingFilters.venueId?`. 메서드 `listVenues`·`getVenue`·`submitReport` + 관리자 12종(`adminListReports`·`adminUpdateReport`·`adminListMeetings`·`adminSetMeetingHidden`·`adminCancelMeeting`·`adminSearchUsers`·`adminSetUserStatus`·`adminListVenues`·`adminSaveVenue`·`adminSetVenuePublic`·`adminListCategories`·`adminSetCategoryActive`). mock·supabase·unconfigured 모두 구현.
- Supabase 어댑터: 공간·신고·관리자 RPC 매핑과 Zod 응답 검증(https가 아닌 외부 링크는 버림), 관리자 공간·카테고리 쓰기는 테이블 직접 DML(`SupabaseClientLike.table`) — 제약 위반 → `VALIDATION_FAILED`(제약 이름에서만 detail), 42501 → `NOT_ADMIN`, RLS 0행 update는 `is_admin()`으로 `NOT_ADMIN`/`NOT_FOUND` 구분. 모임 수정 시 `game_id` 보존(17개 키).
- mock: 예시 공간 11곳(가상 이름·'예시로' 가상 주소·example.com 링크, 기존 모임 venueName과 같은 id로 연결 — 숨김 예시 모임의 권역을 공간과 맞춤), 예시 신고 3건, 카테고리 활성 상태. 공간·신고·관리자 규칙(관리자 dev 계정만, 나머지 `NOT_ADMIN`), 공간 선택 규칙(공개·권역 일치), 비활성 카테고리 거부, 게임 연결 유지, 관리자 모임 취소 규칙을 DB와 맞춤(종료 후 `MEETING_STARTED`/ended). 저장 키 `hanpan.mock.v2`.
- 화면: `/venues`(권역·유형 칩 ↔ URL, 구분선 행, 정보 확인일, 빈 상태), `/venues/:id`(https 외부 링크·고정 안내·예정 모임), 모임 폼 공간 선택·비활성 카테고리 숨김, 모임 상세 장소명 링크·예약 링크(외부)·신고 대화상자(이 모임/모임장), 참가자 관리 참가자 신고, `/admin`(신고·모임·사용자·공간·카테고리 탭, 관리자만 — 서버가 경계), 프로필의 관리자 도구 링크(관리자만), `/policies/:slug`(초안 배너 + 의존성 없는 마크다운 부분집합 렌더러, 확정 전 값). 플레이스홀더 화면 제거.
- 공통: `ExternalLink`(https만·새 창·noopener noreferrer), `ReportDialog`, `Markdown`, `AppErrorBoundary`(전역 오류 경계), 라우트 오류 화면의 데이터 오류 문구, `ConfirmDialog.errorMessage`, `devWarn`/`devError`(콘솔 출력 개발 모드 전용), 아이콘 `external-link`·`shield`.
- Phase 3 후속: `useMeetingList`가 사용자 키(로그인·로그아웃) 변경 시 다시 요청, 수정 시 `game_id` 보존, 닉네임 예약어 `운영진`.
- 테스트: DB `venues-admin.test.ts`(21), 계약 테스트 8개 추가(26), 가짜 PGlite 클라이언트에 setof RPC·테이블 insert/update 지원, 단위·컴포넌트(외부 링크, 마크다운, ReportDialog, AdminPage, Venues/VenueDetail, PolicyPage, useMeetingList, 콘솔 검사, mock 규칙, Supabase Phase 4, 공간 선택 폼, 전역 오류 경계, 도메인 검증), E2E `e2e/phase4.spec.ts`(17), 스크린샷 `docs/screenshots/phase4/` 5장. 기존 테스트 중 바뀐 계약에 맞춰 고친 것: 마이그레이션 목록·함수 권한 허용 목록(schema), `toMeeting`의 `gameId`, payload 키(game_id), 저장 키 v2, 상세 신고 테스트(곧 연결 → 실제 접수), `venue_id` 서버 오류 매핑.
- 문서: DB_SCHEMA(§0·§2.3·§7·§9.12·§9.15~§9.18·§12·§16·§17), UI_SPEC(§3.3 #11~#13, §4.2·§4.3·§4.7~§4.10), SECURITY(위협 모델·권한 매트릭스·외부 링크 정책·관리자 경계·콘솔 점검), OPERATIONS(§6.1 관리자 도구 절차, §7 점검 쿼리), TEST_PLAN, ROADMAP, README, ARCHITECTURE, DEPLOYMENT(새 마이그레이션 적용 순서), NEXT_STEPS.

### 수정 — Phase 4 검수 반영 (2026-11-25)

- 공간 찾기 필터: 모바일에서 숨겨져 있던 줄 라벨("권역"·"유형")을 각 줄 맨 앞(스크롤 영역 안)에 보이게 함 — 모바일 13px·고정폭 없음·오른쪽 여백, 데스크톱은 기존 64px 고정폭 그대로. 칩 그룹 이름은 `aria-label` 대신 `aria-labelledby`로 보이는 라벨에 연결(그룹 이름 "공간 유형" → "유형"). `venues-390.png` 다시 생성.
- Supabase `adminCancelMeeting`: 공용 RPC `cancel_meeting`의 `NOT_HOST`를 `NOT_ADMIN`으로 바꿔 던짐(cause 보존, 다른 코드는 그대로) → mock과 같은 코드. 계약 테스트의 "동작 차이" 주석을 지우고 두 구현의 코드가 같은지 단언.
- 계정 상태 안내 띠 `AccountStatusBanner` 화면 테스트 추가(이용 제한·탈퇴 요청 문구, active·비로그인은 띠 없음 — 세션 확인 완료 후 확인). ROADMAP 해당 항목 체크.
- 검증(실제 실행): `npm run verify` 통과 — test **48개 파일 387개**, test:db **12개 파일 216개**, build, check:seed(dist 53개 파일). `npm run test:e2e` **46개 통과**. `npm run screenshots` **24개 통과**.

### 검증 — Phase 4 (2026-11-25, 실제 실행)

- `npm run verify` 통과: typecheck → lint → `test` **47개 파일 381개 통과** → `test:db` **12개 파일 216개 통과**(계약 26·`venues-admin` 21 포함) → build → `check:seed` 통과(dist 53개 파일).
- `npm run test:e2e`(Chromium, mock) **45개 통과**(기존 28 + Phase 4 17). `npm run screenshots` **24개 캡처 통과**(phase4 5장 추가, 나머지 재생성).
- **미검증(`BLOCKED:`)**: 실제 Supabase에서 PostgREST 테이블 insert/update 응답·제약 오류 메시지 형식(관리자 공간 저장의 detail 추출이 메시지 형식에 의존), 감사 트리거·`drop function` 후 스키마 캐시, 실제 OAuth. (계정 상태 안내 띠 화면 테스트는 아래 검수 반영에서 추가)

### 추가 — Phase 3 (모임 핵심 흐름 연결 · Supabase 어댑터, 2026-11-24)

- `src/data/supabase/`: Supabase DataAdapter·AuthAdapter 전체 구현(동적 import, 별도 청크).
  - `client.ts`: `createClient(url, anonKey, { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } })`, 어댑터가 쓰는 최소 클라이언트 계약(`SupabaseClientLike`) — 어댑터는 클라이언트를 주입받는다.
  - `keyGuard.ts`: 공개 env 이름에 `SERVICE_ROLE`, JWT `role=service_role`, `sb_secret_` 키를 거부. 앱은 경고 후 `unconfigured`, `vite.config.ts`는 빌드 중단(개발 서버는 경고). 번들에는 `VITE_` 변수 이름만 주입.
  - `adapter.ts`: 16개 RPC + 기준 데이터 select. 세션이 없으면 로그인 필요 RPC 미호출(`getMyParticipation`·`getMyProfile` null, 나머지 `AUTH_REQUIRED`), uuid가 아닌 id 미요청.
  - `rpcArgs.ts`(필터 → 인자, KST 날짜 범위·빈 값 생략 / 모임 입력 전체 키·오프셋 ISO / 프로필 부분 수정), `mapping.ts`(Zod 응답 검증 → 계약 불일치 `UNKNOWN`, 시각 UTC 정규화), `errors.ts`(P0001·42501·PGRST3xx·네트워크·Auth 분류, 원본 메시지·details 미보관).
  - `auth.ts`: returnTo 저장 + `redirectTo = location.origin + '/auth/callback'`, Kakao는 `VITE_AUTH_KAKAO_ENABLED=true`일 때만, 콜백 code 교환·`error` 처리·`history.replaceState`로 code 제거, `get_my_profile`로 세션 사용자, auth 이벤트(SIGNED_IN·SIGNED_OUT·TOKEN_REFRESHED·USER_UPDATED) 처리, 오프라인 로그아웃은 local로.
- `src/data/index.ts`: env가 있으면 Supabase 어댑터(개발 서버 포함, e2e 모드는 계속 mock). mock 분기·`check:seed` 규칙은 그대로.
- `useAsyncData`: 키(사용자)가 바뀌면 이전 키의 응답을 즉시 버림(A → B → A 전환 때 옛 응답 재표시 방지). `AuthProvider`·`useAsyncData` 사용자 전환 테스트 추가.
- `supabase/migrations/20261124000500_nickname_rules.sql`: 닉네임 예약어 완화 — 포함 금지(관리자·운영자·운영팀·admin·hanpan) + 완전 일치 금지(한판·탈퇴한사용자), 공백·`_`·`-` 제거 후 소문자 비교. 프론트 `isReservedNickname`도 같은 규칙. 이전 목록의 `운영진`은 빠졌다.
- `Meeting.hostId`·`hostNickname`을 `string | null`로. 상세 모임장 행 "탈퇴한 사용자", hostId null이면 CTA "모집 마감"(서버 `MEETING_NOT_OPEN`/`host_missing`과 일치). mock 규칙·seed 생성도 반영.
- 모임 상세: 사진이 없을 때 16:6 대형 회색 배너 제거 → 목록 썸네일 비율의 작은 장르 플레이스홀더(데스크톱 183×105 제목 왼쪽, 모바일 86×96 장르 배지 위). 스크린샷 다시 생성.
- 권역 정렬값을 DB와 일치(`etc_daejeon` 90).
- `tsconfig.json` references에 `tsconfig.db.json` 추가(`npm run typecheck`가 DB 테스트·`scripts/**/*.ts` 검사), `eslint.config.js` 대상에 `supabase/tests/**`·`scripts/**/*.ts` 추가.
- `scripts/bundle-migrations.mjs` + `npm run db:bundle` → `supabase/.bundle/all-migrations.sql`(Git 제외, seed 미포함).
- 테스트: 어댑터 계약 테스트 `supabase/tests/adapter-contract.test.ts`(18개, 가짜 클라이언트 `fake-supabase-client.ts`가 PGlite로 실제 SQL 함수 실행), `bundle.test.ts`, 닉네임 규칙 DB 테스트, Supabase 어댑터 단위 테스트(errors·mapping·rpcArgs·client/keyGuard·auth·adapter), 데이터 팩토리, `/auth/callback` 화면, 프로필 스키마, 상세(탈퇴한 모임장·작은 플레이스홀더), 상세 CTA.
- 문서: DB_SCHEMA(마이그레이션 5, §9.12, §16, §17 어댑터 규칙), ARCHITECTURE(§4.1 어댑터, 인증·캐시·오류·키 가드), SECURITY(§2·§3·§4·§5·§8·§10·§13 현재 SQL 기준 정리), DEPLOYMENT(env 2개, Redirect URLs, Google·Kakao, db:bundle, 첫 연결 확인 순서, 관리자 지정), TEST_PLAN(§6 계약 테스트), ROADMAP, README, UI_SPEC(상세 플레이스홀더), NEXT_STEPS.

### 검증 — Phase 3 (2026-11-24, 실제 실행)

- `npm run verify` 통과: typecheck(앱·테스트·설정·DB) → lint → `test` **33개 파일 303개 통과** → `test:db` **11개 파일 187개 통과**(계약 18·bundle 1 포함) → build → `check:seed` 통과(dist 41개 파일).
- `npm run test:e2e`(Chromium, mock) **28개 통과**. `npm run screenshots` **19개 캡처 통과**(`detail-390`·`detail-1280` 포함 전체 재생성).
- 임시 `.env.local`(가짜 `VITE_SUPABASE_URL=https://example.supabase.co`·가짜 anon JWT)로 `npm run build`: supabase 어댑터가 별도 청크로 포함(`list_public_meetings` 문자열 확인), `check:seed` 통과·mock 마커 없음. 같은 방식으로 service_role JWT·`VITE_SUPABASE_SERVICE_ROLE_KEY` 이름을 넣으면 빌드가 멈추는 것 확인. 확인 후 `.env.local` 삭제.
- 계약 테스트 변이 확인: RPC 인자 이름·jsonb 키를 일부러 틀리면 실패하는 것을 확인하고 되돌림.
- **미검증(`BLOCKED:`)**: 실제 Supabase 연결(PostgREST HTTP 계층·오류 응답 필드·인자 직렬화), 실제 Google/Kakao OAuth 왕복·토큰 갱신·탭 간 이벤트, 실DB GRANT·RLS·트리거, 동시 신청 경쟁(`scripts/race-test.ts`).

### 추가 — Phase 2 (DB·권한, 2026-11-24)

- `supabase/migrations/` 4개: enum·테이블·제약·인덱스·RLS 활성화 / 일괄 revoke·컬럼 단위 grant·RLS 정책 / 내부 함수·트리거·조회·쓰기·관리자 RPC·함수별 EXECUTE / 권역·카테고리 기준 데이터(멱등). `supabase/seed.sql`(개발 전용 마커).
- `supabase/tests/`: PGlite 하네스(Supabase 스텁, 템플릿 clone, 역할·claims 전환)와 DB 테스트 9개 파일(스키마·권한 매트릭스·공개 조회·권한 우회·모임·참가·프로필/탈퇴·신고/관리자·seed).
- `scripts/race-test.ts`(실제 Postgres 동시성 테스트, 실행은 `BLOCKED:`).
- 결정: `remaining_seats` STORED 생성 컬럼 + `list_public_meetings` RPC, `profiles.status` 공개 grant 제외, `meetings.host_id` nullable(`on delete set null`), 숨김 모임 노출 범위 등(DB_SCHEMA §16).

### 검증 — Phase 2

- TEST_PLAN §5 기록 기준: `npm run test:db` 9개 파일 166개 통과(2026-11-24). 이 문서를 쓴 Phase 3 작업에서는 그 위에 테스트를 추가해 187개로 다시 실행했다(위 Phase 3 검증).

### 추가 — Phase 1 (프론트엔드 · mock)

- Vite + React 19 + TypeScript(strict) + React Router 8 + Tailwind CSS 4 + Zod 4 + Vitest + Playwright + ESLint 구성, 디자인 토큰·SUIT 폰트·공통 UI·레이아웃.
- 탐색(날짜·장르·모집 중·권역·검색·정렬, URL 쿼리 동기화), 모임 상세(CTA 상태표 전체, 신청·취소), 모임 만들기·수정, 내 모임, 참가자 관리, 로그인·`/auth/callback`·보호 라우트·returnTo, 최초 설정·프로필·탈퇴 요청.
- 데이터 계약 `DataAdapter`·`AuthAdapter`·`DataAdapterError`, mock(규칙 흉내·localStorage 저장·개발용 테스트 계정·오류 주입)·unconfigured 구현, `check:seed`.
- 6개 뷰포트 스크린샷과 v3 시안 비교 자료(`docs/screenshots/`).

### 검증 — Phase 1

- Phase 3 시작 시점에 전달받은 기준: `npm run verify` 통과(단위 218·DB 166), E2E 28개 통과. Phase 1 당시 실행 기록은 이 문서에 따로 남아 있지 않다.

### 추가 — Phase 0 (문서)

- `docs/PRD.md`: 서비스 정의, 역할, MVP 범위, 기능 요구사항 FR-01~21, 비기능 요구사항, 미결 사항.
- `docs/ARCHITECTURE.md`: 구성도, 폴더 구조, 데이터 어댑터 3모드(supabase/mock/unconfigured), 라우트, 인증·returnTo 흐름, KST 처리, URL 쿼리, 오류 처리, 환경 변수, 결정 기록.
- `docs/DB_SCHEMA.md`: enum 11종, 테이블 11개, 제약·인덱스, 기준 데이터, 파생 상태, 참가 상태 전이, GRANT·RLS 매트릭스, 함수·RPC 18종 명세(지정된 16종 + 보조 `is_meeting_host`, 제안 `admin_list_reports`), 에러 코드, 레이트 리밋, 감사 로그, FK 삭제 동작, PGlite 테스트 하네스.
- `docs/UI_SPEC.md`: v3 토큰·타이포·컴포넌트 수치, 시안 대비 의도적 차이 9건과 추가 제안, 화면별 구성, 상세 CTA 상태표, 상태 목록, 오류 문구.
- `docs/SECURITY.md`: 위협 모델, 역할별 권한, 비밀키 관리, 입력 검증, XSS, CSP·보안 헤더 초안, 리디렉션 검증, 관리자 부여 절차, 미검증 항목.
- `docs/TEST_PLAN.md`: 필수 테스트 14개의 레벨별 매핑, 뷰포트·접근성 점검표, BLOCKED 항목, DB·E2E 시나리오.
- `docs/DEPLOYMENT.md`: Supabase·OAuth(Google/Kakao)·Cloudflare Pages 설정 절차, 환경 변수 표, 배포 전 체크리스트, 백업·장애 대응.
- `docs/OPERATIONS.md`: 운영 규정, 신고 처리 절차, 공간 정보 등록 기준, 개인정보 요청·탈퇴 처리, 모니터링 최소안.
- `docs/ROADMAP.md`, `docs/BACKLOG.md`, `docs/NEXT_STEPS.md`.
- `docs/policies/TERMS_DRAFT.md`, `docs/policies/PRIVACY_DRAFT.md`: 운영자·법률 검토 전 초안.

### 검증 — Phase 0

- 문서 작업만 했다. 코드 빌드·테스트는 이 항목에 해당하지 않는다(실행하지 않음).
