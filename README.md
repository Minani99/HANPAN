# HANPAN (한판)

대전 지역 보드게임 모임을 날짜·지역·게임 유형으로 찾고 참가하는 웹서비스의 MVP 프론트엔드입니다.
서비스명·브랜드는 가칭이며, 현재 **Phase 5(출시 전 QA·접근성·보안 점검, Cloudflare Pages 배포 준비)**까지 마쳤습니다. 실제 배포는 하지 않았습니다(사용자 승인·외부 설정 필요 — [`docs/NEXT_STEPS.md`](docs/NEXT_STEPS.md) 출시 체크리스트).
탐색·상세·신청·모임 만들기/수정·내 모임·참가자 관리·로그인/프로필·공간·신고·관리자 도구·정책 화면이 설정이 없으면 **개발용 mock 데이터**로,
Supabase 환경 변수 2개를 넣으면 **Supabase(DB·RPC·Google/Kakao OAuth)**로 동작합니다.
실제 Supabase 프로젝트·OAuth 콘솔 설정은 아직 없어서 **실제 연결은 확인하지 못했습니다(`BLOCKED`)** — DB 규칙은 PGlite 테스트, 어댑터는 계약 테스트로 확인했습니다.

- 디자인 기준: `hanpan_v3_design_spec.md`, `hanpan_v3_design_lab.html` (v3, 잉크 블랙)
- 상위 요구사항: `HANPAN_Claude_Code_전체개발_마스터프롬프트.md`
- 설계·운영 문서: `docs/`

## 요구 환경

| 항목 | 버전 |
|---|---|
| Node.js | 22.22.0 이상 (React Router 8 요구사항). 개발 확인·배포 지정: 24.18.0 (`.nvmrc`) |
| npm | 10 이상. 개발 확인: 11.16.0 |
| 브라우저(E2E) | Playwright Chromium (chromium-1248, `@playwright/test` 1.64.1) |

## 설치와 실행

```bash
npm install
npm run dev            # http://localhost:5173 (개발용 예시 데이터로 동작)
```

E2E 테스트용 브라우저가 없다면 한 번 설치합니다.

```bash
npx playwright install chromium
```

## 명령어

| 명령 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 (Supabase env가 없으면 mock 데이터, 있으면 Supabase) |
| `npm run dev:e2e` | e2e 모드 개발 서버 (항상 mock 데이터) |
| `npm run build` | 타입 검사(`tsc -b`) → 프로덕션 빌드 → 보안 헤더 생성(`scripts/write-headers.mjs`) → `dist/`, `dist/_headers`. `VITE_SUPABASE_URL`이 https origin이 아니면 실패 |
| `npm run preview` | 빌드 결과 미리보기(http://localhost:4173). `dist/_headers`를 Cloudflare Pages처럼 응답에 붙인다 |
| `npm run typecheck` | TypeScript 검사 (strict) |
| `npm run lint` | ESLint (flat config, typescript-eslint, react-hooks) — `src`, `e2e`, `supabase/tests`, `scripts` |
| `npm run test` | 단위·컴포넌트 테스트 (Vitest + React Testing Library + jsdom) |
| `npm run test:db` | DB 테스트 (PGlite: 마이그레이션·GRANT·RLS·RPC 규칙 + Supabase 어댑터 계약 테스트) |
| `npm run db:bundle` | 마이그레이션을 한 파일로 묶기 → `supabase/.bundle/all-migrations.sql` (Git 제외, seed 미포함, SQL Editor 붙여 넣기용) |
| `npm run test:e2e` | E2E 테스트 (Playwright, Chromium, mock) — 개발 서버를 자동으로 띄웁니다. 접근성(axe 390·1280px, 키보드, 글자 200%) 포함 |
| `npm run test:csp` | CSP 스모크 테스트 — 빌드 2종(mock·가짜 Supabase env)을 임시 폴더에 만들고 생성된 `_headers`를 붙여 주요 화면의 CSP 위반 0건 확인(끝나면 임시 폴더 삭제). verify에는 없음 |
| `npm run screenshots` | 홈 6개 뷰포트 + 상세·만들기(390/1280)·내 모임(390)·참가자 관리(1280)·로그인(390) → `docs/screenshots/phase1`, 공간 목록(390/1280)·공간 상세(390)·관리자 신고 탭(1280)·운영정책(390) → `docs/screenshots/phase4`, 글자 200% 대표 화면 5장 → `docs/screenshots/phase5`, 비교용 시안 → `docs/screenshots/reference` |
| `npm run check:seed` | `dist/`에 개발용 seed 데이터가 섞이지 않았는지 검사 (빌드 후 실행) |
| `npm run check:dist` | 배포 산출물 점검: `404.html`·`_redirects` 없음(Pages SPA 폴백), `_headers`가 현재 env와 일치, `index.html` 인라인 코드 없음, 비밀 키 값 없음, `robots.txt` |
| `npm run check:builds` | 운영 빌드 변형 검증(임시 폴더, 끝나면 삭제): env 없음·가짜 Supabase env는 성공, service_role·`sb_secret_`·`SERVICE_ROLE` 이름·http·경로 있는 URL은 빌드 실패 |
| `npm run verify` | typecheck → lint → test → test:db → build → check:seed → check:dist 순차 실행 |

## 데이터 모드

화면은 `src/data/adapter.ts`의 `DataAdapter` 인터페이스에만 의존합니다. 실행 환경에 따라 구현체가 정해집니다(`src/data/index.ts`).

| 모드 | 조건 | 동작 |
|---|---|---|
| `mock` | `npm run dev`(DEV)이면서 Supabase 설정이 없을 때, 또는 e2e 모드 | `src/data/mock/`의 **개발용 예시 데이터**. 화면 상단에 "개발용 예시 데이터입니다. 실제 모임이 아닙니다." 띠가 표시됩니다. |
| `supabase` | `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` 설정 (e2e 모드 제외) | `src/data/supabase/`(동적 import). 모든 조회·쓰기는 RPC, 로그인은 Google(·Kakao) OAuth PKCE. 키가 service_role/secret으로 보이면 경고 후 `unconfigured` |
| `unconfigured` | 그 외 (프로덕션 빌드 + 설정 없음) | 가짜 데이터 없이 항상 빈 목록. 빈 상태 안내가 그대로 보입니다. |

- mock 모듈은 개발/e2e 조건 안에서 **동적 import로만** 불러오므로 프로덕션 빌드에서 제거됩니다.
  `npm run check:seed`가 `dist/` 전체에서 seed 마커(`HANPAN_DEV_SEED_MARKER`)와 seed 고유 문자열을 찾아 발견되면 실패합니다
  (검사 문자열: `scripts/seed-needles.json`).
- mock은 기본 300ms 지연(테스트 0ms)이 있고, 오류 상태 재현용으로 `__setMockFailure()`를 제공합니다.
  개발 서버 브라우저 콘솔에서는 `window.__HANPAN_MOCK__.setFailure({ methods: ['listMeetings'], times: 1 })`처럼 쓸 수 있습니다.
- 예시 모임은 현재 시각(KST) 기준 앞으로 7일 안에 생성되며 모든 제목이 `[예시]`로 시작합니다. 장소는 '보드게임 카페 A' 같은 가상의 이름입니다.
- 예시 공간 11곳(공개 10·비공개 1)은 가상의 이름, '대전 서구 예시로 12 (가상 주소)' 같은 명백한 예시 주소, `https://example.com/...` 또는 빈 링크만 씁니다. 관리자 화면 확인용 예시 신고 3건도 있습니다.
- mock은 DB RPC 규칙(`docs/DB_SCHEMA.md` §4~§11)을 `src/data/mock/rules.ts`에서 흉내 냅니다(정원은 모임장 포함, 대기자 자동 승격 없음, 시작 30분~90일, 레이트 리밋 등). **보안 경계가 아니며** 규칙의 정답은 DB입니다.
- 상태(모임·신청·프로필·로그인 계정·공간·신고·카테고리)는 브라우저 `localStorage`의 `hanpan.mock.v2`에 저장돼 새로고침해도 유지됩니다(Phase 4에서 v1 → v2, 이전 값은 버리고 새로 만듦). 24시간이 지나면 예시 데이터를 새로 만듭니다.
  로그인 화면 아래 **"개발용 테스트 계정"** 섹션에서 계정을 고르거나 **"개발 데이터 초기화"**로 처음 상태로 되돌릴 수 있습니다(mock 모드에서만 보임).

### 개발용 테스트 계정 (mock 전용, 실제 사용자 아님)

| 계정 | 용도 |
|---|---|
| 예시사용자A | 예시 모임 2개 주최(승인 대기 신청 있음, 진행 중 모임 출석 체크), 확정·대기·완료·취소·거절 신청 내역 |
| 예시사용자B | 신청 내역 없는 일반 사용자 (신청 흐름 확인용) |
| 예시신규사용자 | 최초 설정(닉네임·약관 동의) 전 — 신청·만들기 시 `/profile?onboarding=1`로 안내 |
| 예시관리계정 | 관리자 권한 — 마이 → "관리자 도구 열기"(`/admin`). mock은 이 계정만 관리자 메서드를 허용하고 나머지는 `NOT_ADMIN` |

Google·카카오 버튼은 mock 모드에서 실제 OAuth로 연결되지 않고 테스트 계정 선택을 안내합니다.

## Supabase 연결 (요약)

자세한 절차와 확인 순서는 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)에 있습니다. 외부 콘솔 작업은 모두 직접 해야 하며 아직 하지 않았습니다(`BLOCKED`).

1. Supabase 프로젝트를 만들고 **Project URL**과 **anon(publishable) 키**를 확인합니다. service_role/secret 키는 쓰지 않습니다.
2. `npm run db:bundle` → `supabase/.bundle/all-migrations.sql`을 빈 프로젝트의 SQL Editor에서 실행합니다(이미 적용한 프로젝트는 새 마이그레이션 파일만). `supabase/seed.sql`은 운영에 실행하지 않습니다.
3. Authentication → URL Configuration: Site URL과 Redirect URLs에 `<접속 주소>/auth/callback`(로컬 `http://localhost:5173/auth/callback`)을 등록합니다. 앱은 `redirectTo`를 **현재 주소의 origin** 기준으로 보냅니다.
4. Google provider 설정(공급자 콘솔의 리디렉션 URI는 `https://<project-ref>.supabase.co/auth/v1/callback`). Kakao는 선택이며, 설정을 마친 뒤 `VITE_AUTH_KAKAO_ENABLED=true`로 켭니다(이메일 동의항목 요건은 미확인).
5. `.env.local`에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`를 넣고 `npm run dev` → 로그인 → 최초 설정 → 모임 생성·신청 흐름을 확인합니다.
6. 관리자는 첫 로그인 후 SQL Editor에서 `admin_roles`에 추가합니다(DEPLOYMENT §3.4).
7. Cloudflare Pages: 빌드 명령 `npm run build`, 출력 `dist`, Node는 `.nvmrc`. 프리뷰에는 개발용 Supabase 프로젝트를 씁니다(DEPLOYMENT §2·§7·§8). 관리자 도구 사용 절차와 점검 쿼리는 [`docs/OPERATIONS.md`](docs/OPERATIONS.md) §6.1·§7.

- `VITE_` 이름에 `SERVICE_ROLE`이 들어간 변수가 있거나 anon 키 자리에 service_role JWT·`sb_secret_` 키를 넣으면 `npm run build`가 멈춥니다(개발 서버는 경고 후 빈 상태).
- 어댑터 계약 테스트는 PGlite로 실제 SQL 함수까지만 확인합니다. PostgREST(HTTP) 계층과 실제 OAuth는 첫 연결 때 확인해야 합니다.

## 환경 변수

`.env.example`을 `.env.local`로 복사해 사용합니다. `.env*` 파일은 Git에 커밋되지 않습니다(`.env.example` 제외).

| 변수 | 설명 |
|---|---|
| `VITE_SUPABASE_URL` | Supabase 프로젝트 URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon(publishable) 키. **service_role 키는 절대 넣지 마세요.** `VITE_` 값은 브라우저 번들에 그대로 포함됩니다. |
| `VITE_AUTH_KAKAO_ENABLED` | 카카오 로그인 허용 여부 (`true`일 때만 버튼 노출·요청). Supabase Kakao provider 설정을 마친 뒤 켭니다 |
| `VITE_SITE_URL` | 서비스 기준 URL. 모임 상세 공유 링크에만 사용(없으면 현재 주소의 origin). OAuth 리디렉션에는 쓰지 않습니다 |

## 디자인 구현 메모

- 토큰: `src/styles/index.css`의 `@theme` (Tailwind CSS v4). 색·글자 크기(rem)·굵기·행간·자간·모서리·컨트롤 높이를 토큰으로 정의하고, Tailwind 기본 팔레트는 초기화했습니다.
- 브레이크포인트: 모바일 퍼스트. `sm` = 381px 이상, `md` = 761px 이상(데스크톱). 시안의 `max-width: 760px`과 같은 경계입니다.
- 입력란 글자: 모바일(760px 이하) 16px(iOS 확대 방지), 데스크톱 15px.
- 글꼴: [SUIT Variable](https://github.com/sun-typeface/SUIT) (SIL Open Font License 1.1), jsDelivr CDN에서 로드.
- 아이콘: 인라인 SVG(`src/components/ui/Icon.tsx`). 외부 아이콘 패키지를 쓰지 않습니다.
- 사진이 없는 모임은 장르별 회색 플레이스홀더(`CategoryPlaceholder`)를 사용합니다. 외부·AI 생성 이미지는 쓰지 않습니다.
  상세 화면도 큰 배너 대신 목록 썸네일과 같은 비율의 작은 플레이스홀더(데스크톱 183×105 제목 왼쪽, 모바일 86×96 장르 배지 위)를 씁니다.

### 히어로 이미지 교체

시안의 히어로 사진은 출처·라이선스를 확인할 수 없어 사용하지 않았고, 같은 자리에 회색조 SVG 일러스트를 넣었습니다.
사용 권한이 확인된 사진으로 바꾸려면:

1. 사진을 `public/images/hero.jpg`로 저장합니다(가로형, 1200px 이상 권장).
2. 개발 서버를 재시작하거나 다시 빌드합니다. `vite.config.ts`가 파일 존재를 감지해 자동으로 사진을 사용합니다
   (저채도 `saturate(.62) contrast(.96)` 적용, 왼쪽 사선 마스크 유지).
3. 파일을 지우면 다시 SVG 일러스트로 돌아갑니다.

## 폴더 구조

```
src/
  main.tsx, App.tsx          진입점, 라우트(lazy 로드)
  styles/index.css           Tailwind + 디자인 토큰
  auth/                      AuthProvider(useAuth), RequireAuth/RequireSignedIn(라우트 가드), useSignOut
  components/ui/             Button(primary/secondary/danger/text), IconButton, Chip, ChoiceGroup(라디오 칩), Tabs,
                             TextField, Select, Textarea, Checkbox, Badge, Notice, Dialog, ConfirmDialog, Toast,
                             Skeleton, EmptyState, ErrorState, Spinner, VisuallyHidden, Icon, ExternalLink(https만·새 창)
  components/layout/         SiteHeader, MobileBottomNav, SiteFooter, PageContainer, PageTitle, PageStates, BackLink,
                             DevDataBanner, AccountStatusBanner, AppLayout, AppErrorBoundary(전역 오류 경계),
                             mobileBottomBar(상세 CTA 바 ↔ 레이아웃)
  components/meeting/        MeetingRow, MeetingList, DateStrip, CategoryChips, RegionDialog, CategoryPlaceholder,
                             AvailabilityLabel, MeetingInfoList, PeopleSummary, DetailCtaContent, ApplyDialog,
                             HoldemNotice, MeetingForm, useMeetingFormOptions(공개 공간·활성 카테고리)
  components/venue/          VenueRow(공간 목록 행)
  components/report/         ReportDialog(신고 접수)
  components/admin/          AdminReportsTab, AdminMeetingsTab, AdminUsersTab, AdminVenuesTab, AdminCategoriesTab, adminShared
  components/content/        Markdown(정책 문서 렌더러 — React 요소만)
  content/policies/          terms.md, privacy.md, operations.md(이용자 공개용 초안, ?raw import)
  components/explore/        ExploreHero, HeroArt, QuickActions, ExploreAsides
  pages/                     Explore, MeetingDetail, MeetingCreate, MeetingEdit, Participants, MyMeetings, Login,
                             AuthCallback, Profile, AccountDeletionRequested, Venues, VenueDetail, Admin, Policy,
                             NotFound, RouteError
  lib/                       date.ts(KST), filters.ts(URL ↔ 필터), returnTo.ts(로그인 후 복귀 경로 검증), env.ts,
                             focusField.ts, cn.ts, useDocumentTitle.ts, externalUrl.ts(https 확인), markdown.ts(부분집합 파서),
                             devConsole.ts(개발 모드 전용 콘솔), zodConfig.ts(Zod jitless — CSP에서 eval 시험 끄기, main.tsx 첫 import)
  domain/                    categories, regions, meetingPhase, skillLevels, limits(서버와 같은 한도),
                             meetingSchema·profileSchema(Zod), detailCta(상세 CTA 상태표), myMeetings(분류),
                             participation, errorMessages(코드별 한국어 문구), venues(유형·검증·쿼리), reports(사유·검증·오류 문구)
  data/                      types.ts, adapter.ts(DataAdapter·AuthAdapter·DataAdapterError), index.ts(팩토리·context),
                             unconfigured.ts, useMeetingList.ts, useAsyncData.ts,
                             mock/(개발 전용: adapter, rules, seed, records, query),
                             supabase/(동적 import: adapter, auth, client, keyGuard, rpcArgs, mapping, errors)
supabase/                    migrations/(9개), seed.sql(개발 전용), tests/(PGlite DB 테스트·어댑터 계약 테스트)
scripts/                     check-no-seed.mjs(빌드 결과 seed 유입 검사), bundle-migrations.mjs(db:bundle), race-test.ts(동시성, BLOCKED),
                             write-headers.mjs(빌드 후 dist/_headers 생성), check-dist.mjs(산출물 점검), check-builds.mjs(빌드 변형 검증),
                             csp-preview.mjs(CSP 스모크용 빌드·미리보기 서버), lib/(security-headers: 보안 헤더 순수 함수, build-variant)
e2e/                         Playwright 테스트(a11y·csp 포함), 스크린샷 스크립트. playwright.csp.config.ts는 CSP 스모크 전용
public/robots.txt            /admin·/auth/만 Disallow(보안 수단 아님). SPA 폴백은 _redirects 없이 Pages 기본 동작, _headers는 빌드 때 생성
```

## 현재 구현 범위

- 프로젝트 구성: Vite 8 + React 19 + TypeScript(strict) + React Router 8 + Tailwind CSS 4 + Zod 4 + Vitest + Playwright + ESLint
- 디자인 토큰, SUIT 폰트, 공통 UI 컴포넌트, 공통 레이아웃(헤더·푸터·모바일 하단 내비·개발용 안내 띠·계정 상태 안내)
- 홈 / 모임 탐색(`/`, `/meetings`): 날짜·게임 유형·모집 중만·권역·검색어·정렬, URL 쿼리 동기화, 로딩·오류·빈 결과·더 보기
- 모임 상세(`/meetings/:id`, 비로그인 공개): 일정(KST, 종료 시각·소요 시간), 권역·장소(장소 미정), 인원(모임장 포함)·남은 자리·최소 인원 미달,
  소개·유의사항(줄바꿈 보존, 링크 자동 변환 없음), 모임장 닉네임, 홀덤 비금전 안내, 공유(Web Share 또는 링크 복사), 신고(대상: 이 모임/모임장),
  공개 공간에 연결된 모임은 장소명 → 공간 상세 링크 + 공간에 예약 링크가 있을 때만 "예약 페이지(외부)".
  CTA 상태표(UI_SPEC §4.2) 전체 — 데스크톱 우측 sticky 패널 / 모바일 하단 고정 바(하단 내비 대신). 신청 확인 대화상자(남길 말 200자),
  실패 시 원복·오류 안내·재시도, 더블클릭 1회 전송, 신청 취소 확인
- 모임 만들기·수정(`/meetings/new`, `/meetings/:id/edit`): 공용 `MeetingForm`, Zod 검증(서버와 같은 한도), 첫 오류 포커스, 서버 오류 코드 → 필드/폼 오류,
  권역의 공개 공간 선택("장소 미정" 기본, 공개·권역 일치 검증), 비활성 카테고리 숨김, 등록된 게임(`gameId`) 연결 보존,
  추가 설정 접기, 수정 권한 없음·수정 불가(시작·취소) 안내, 시작 시각 변경 시 "자동 알림 없음" 안내, 정원 축소 제한
- 내 모임(`/my/meetings`): 참가한 모임 / 내가 연 모임 탭 + 예정·대기·완료·취소 칩(URL `role`·`tab`), 내 신청 상태 배지, 비공개 모임 행, 빈 상태
- 참가자 관리(`/meetings/:id/participants`, 모임장 전용): 승인 대기·대기자·확정·지난 신청, 승인/거절(확인), 자리 없으면 승인 비활성, 출석 체크,
  모집 마감/재개, 모임 취소(사유·자동 알림 없음 안내)
- 로그인·인증: `/login`(Google, 카카오는 플래그), mock 개발용 테스트 계정·데이터 초기화, `/auth/callback`, 보호 라우트 가드 + `returnTo`
  (sessionStorage, 내부 경로만), 최초 설정(`/profile?onboarding=1`: 닉네임·선호 권역·관심 장르·약관/개인정보 초안 동의) 후 원래 화면 복귀,
  헤더 프로필 버튼, 로그아웃
- 프로필(`/profile`): 내 정보 수정, 로그아웃, 탈퇴 요청(확인 대화상자 → `/account/deletion-requested`), 관리자에게만 "관리자 도구" 링크
- 공간(`/venues`, `/venues/:id`): 공개 공간만, 권역·유형 칩(URL `region`·`type`), 구분선 행(유형·이름·권역·주소·정보 확인일), 상세(주소·정보 확인일·고정 안내·
  https 외부 링크(새 창, `noopener noreferrer`)·소개·이 공간의 예정 모임). 실시간 영업 상태·예약 가능 시간·지도 없음
- 신고(`ReportDialog`): 사유 7종(필수), 상세 내용(기타면 필수, 1000자), 자동 제재 없음 안내, 실제 접수 성공 시에만 "신고가 접수됐어요",
  중복·하루 10건·자기 신고 등 오류 문구. 진입점: 모임 상세(이 모임/모임장), 참가자 관리(참가자 행 "신고")
- 관리자 도구(`/admin`): 로그인 + 관리자만(아니면 권한 없음, **서버 권한이 진짜 경계**). 탭 — 신고(상태 필터·상태/메모 저장), 모임(검색·숨김만·숨김/해제·취소),
  사용자(검색·이용 제한/해제), 공간(등록·수정·공개 전환), 카테고리(활성/비활성)
- 정책(`/policies/terms|privacy|operations`): 초안 배너 + 의존성 없는 마크다운 부분집합 렌더러(HTML 해석 없음), 정해지지 않은 값은 "확정 전"
- 오류 경계: 라우트 오류 화면 + 앱 전역 오류 경계(데이터 계층 오류는 코드별 문구), 콘솔 출력은 개발 모드 전용(`devWarn`/`devError`)
- 데이터 계약: `DataAdapter`(조회·신청·취소·생성·수정·모임 취소·모집 전환·내 모임·참가자·승인/거절·출석·프로필·탈퇴·공간·신고·관리자 12종) + `AuthAdapter`,
  오류 `DataAdapterError(code, detail)`. mock 구현은 규칙을 흉내 내고, unconfigured 구현은 빈 조회 + `SERVICE_UNCONFIGURED` 쓰기 실패
- Supabase 어댑터(`src/data/supabase/`): 조회·쓰기를 RPC로 매핑(기준 데이터 select, 관리자 공간·카테고리 쓰기만 테이블 직접 DML), 클라이언트 주입, Zod 응답 검증(계약 불일치 → `UNKNOWN`),
  PostgREST·Auth·네트워크 오류 분류, 세션이 없으면 로그인 필요 RPC 미호출, PKCE 콜백(code 교환·주소 정리·returnTo), Kakao 플래그, service_role 키 가드
- DB(`supabase/migrations/`): 스키마·GRANT·RLS·RPC·기준 데이터 + 닉네임 예약어(포함 금지 관리자·운영자·운영진·운영팀·admin·hanpan / 완전 일치 금지 한판·탈퇴한사용자)
  + 공간 공개 조회·탐색 목록 공간 필터(마이그레이션 6) + 관리자 조회 RPC·공간 쓰기 보정·관리자 테이블 감사 트리거(7) + 예약어 '운영진'(8)
  + 관리자 권한은 active 계정만(`is_admin()`에 계정 상태 반영 — 9, Phase 5 검수)
- 탈퇴한 모임장(`hostId`·`hostNickname` null): 상세 모임장 행에 "탈퇴한 사용자", 신청 대신 마감 안내
- 404 화면(없는 경로·없는 정책 slug)
- Phase 5(출시 전 점검): 보안 헤더(CSP 등) 빌드 생성(`dist/_headers`, Supabase origin은 env에서), Zod JIT 끄기(CSP unsafe-eval 없이), SPA 폴백을 Pages 기본 동작으로(`_redirects` 삭제), `.nvmrc`, `robots.txt`,
  접근성 수정(날짜 칸 버튼 이름에 보이는 글자 포함, 글자 200%에서 로딩 스켈레톤 넘침, 약관 새 탭 링크 스크린리더 안내), 역할×동작 권한 매트릭스와 DB 테스트, 배포·운영 문서(env 표·Supabase·OAuth·스모크·롤백·백업·사고 대응)

## 아직 구현하지 않은 범위

다음 기능은 **동작하지 않습니다.** 화면에서도 완료된 것처럼 표시하지 않습니다.

- 실제 Supabase 프로젝트·OAuth 연결 확인 — 코드는 준비됐지만 콘솔 설정이 없어 `BLOCKED`(PostgREST 계층·실제 로그인 왕복·동시 신청 경쟁 미검증)
- 운영 공간 제보 경로, 관리자의 카테고리 이름·순서 변경 화면(SQL Editor로 처리), 운영 이메일 등 정책 문서의 확정 전 값
- 이의제기 접수 화면(운영 이메일 미정 — `BLOCKED`)
- 이메일·푸시 알림(일정 변경·취소는 참가자에게 따로 알려야 한다고 화면에서 안내)
- 실제 배포 — 빌드 설정·보안 헤더·SPA 폴백·체크리스트는 준비됨(`docs/DEPLOYMENT.md`), Cloudflare·Supabase 계정과 사용자 승인이 필요(`BLOCKED`)

## 테스트 범위

- 단위: KST 날짜 유틸(시스템 시간대 UTC·America/Los_Angeles·Asia/Seoul·Pacific/Kiritimati), `kstDateTimeToIso`, URL 필터, 모임 상태,
  `sanitizeReturnTo`(외부 URL·`//`·`/\`·제어문자·로그인 경로 거부), 모임 Zod 스키마(길이·시작 30분~90일·소요·정원·홀덤·교차 규칙·서버 오류 매핑),
  오류 문구(모든 ErrorCode), 상세 CTA 상태표, 내 모임 분류, mock 규칙(정원·auto/manual·대기·중복·자기 모임·취소/마감/시작 후 거절·
  본인 취소 시 카운트 감소·대기자 자동 승격 없음·모임장 취소 시 meeting_cancelled·수정 규칙·생성 규칙·레이트 리밋·이용 제한·최초 설정·탈퇴),
  mock 어댑터(저장·인증·동시 중복 신청·오류 주입), seed 구성, 닉네임 예약어(포함/완전 일치),
  Supabase 어댑터(오류 매핑·Zod 응답 검증·필터/입력 → RPC 인자·세션 없을 때 RPC 미호출·service_role 키 가드·returnTo/콜백/Kakao 플래그·auth 이벤트), 데이터 팩토리 분기,
  `useAsyncData`·`AuthProvider`·`useMeetingList` 사용자 전환 시 이전 데이터 폐기·다시 요청,
  Phase 4: 외부 링크 https 필터(`javascript:`·`http:` 거부), 마크다운 파서, 공간·신고 폼 검증, 공간 선택·게임 연결 보존, mock 공간·신고·관리자 규칙(관리자 외 `NOT_ADMIN`),
  Supabase 공간·신고·관리자 인자·응답 검증·테이블 쓰기 오류 매핑, 콘솔 직접 호출 금지 검사
- 컴포넌트: Button·Chip·Dialog·MeetingRow·ExplorePage, 상세 CTA 상태별 렌더·신청 성공/실패 원복·더블클릭 1회·신청 취소·공유·신고 안내,
  MeetingForm 검증 오류·첫 오류 포커스·추가 설정 펼침·서버 오류 매핑, 참가자 관리 권한 없음·승인·거절·취소·출석, 내 모임 탭(키보드)·칩 전환,
  인증 가드·returnTo·최초 설정·로그아웃, `/auth/callback`(PKCE 교환·최초 설정 분기·실패 안내), 상세의 탈퇴한 모임장·작은 플레이스홀더,
  ReportDialog(필수값·기타 본문·오류 매핑·성공 시에만 토스트), 관리자 권한 없음·탭·신고 처리·숨김 사유 필수, 공간 목록·상세(외부 링크 rel/https),
  정책 페이지(초안 배너·404·HTML 비해석), MeetingForm 공간 선택, 전역 오류 경계, 계정 상태 안내 띠(이용 제한·탈퇴 요청)
- E2E(Chromium, mock): 기존 탐색 시나리오 + 비로그인 상세 → 로그인 → 원래 상세 복귀 → 신청 → 새로고침 유지, 승인제 신청, 신청 실패 주입 후 재시도,
  모임 생성 → 상세 → 탐색 목록 노출, 게스트 신청 → 모임장 승인·거절 → 모임 취소 → 게스트 내 모임 확인,
  320px 상세 제목·인원·CTA 바 비겹침 및 가림 없음, 새 화면 6개 뷰포트 가로 오버플로 없음.
  Phase 4: 공간 목록 → 필터 → 상세 → 외부 링크 속성, 모임 신고 → 접수 토스트 → 재신고 중복 안내, 관리자 신고 상태 변경·모임 숨김 → 탐색에서 사라짐 → 해제,
  일반 계정 `/admin` 권한 없음, 정책 3개 + 초안 배너, 공간·정책·관리자 화면 6개 뷰포트 가로 오버플로 없음. 테스트마다 새 브라우저 컨텍스트 + mock 저장소 초기화

- DB(PGlite, `npm run test:db`): 마이그레이션·GRANT·RLS·RPC 규칙·카운트 불변식·seed·`db:bundle`, **어댑터 계약 테스트**(실제 어댑터 + PGlite로 SQL을 실행하는 가짜 클라이언트).
  결과와 한계는 `docs/TEST_PLAN.md` §5~§6

- Phase 5: 보안 헤더 생성(env 유무·잘못된 URL·헤더 조작 입력 거부), Zod jitless, 색 대비(토큰을 읽어 WCAG 비율 계산 — 알려진 예외 3쌍 기록), 소스 보안 감사(innerHTML·eval·service_role·console·storage·VITE_ 목록),
  역할×동작 매트릭스 DB 테스트(이용 제한·탈퇴 요청·관리자), E2E 접근성(axe serious·critical 0건, 키보드·포커스 트랩, 글자 200%), CSP 스모크(`npm run test:csp`), 빌드 변형(`npm run check:builds`). 결과: `docs/TEST_PLAN.md` §3·§9

자동 테스트가 접근성·보안을 보장하지는 않습니다. 스크린리더 실기기 확인, hover 등 상태별 색 대비 전수 점검, Safari/iOS 실기기 확인은 아직 하지 않았습니다.
