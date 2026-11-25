# 아키텍처

상태: Phase 5 반영 (2026-11-25 — 보안 헤더 빌드 생성·SPA 폴백 방식·Zod jitless. Phase 3: Supabase 어댑터 구현, 실제 Supabase 연결은 `BLOCKED:`)

관련 문서: [PRD](./PRD.md) · [DB_SCHEMA](./DB_SCHEMA.md) · [SECURITY](./SECURITY.md) · [TEST_PLAN](./TEST_PLAN.md) · [DEPLOYMENT](./DEPLOYMENT.md)

## 1. 구성 개요

```
브라우저 (React SPA, Cloudflare Pages 정적 호스팅)
  ├─ 정적 자원: index.html, JS/CSS 번들, _headers(보안 헤더 — 빌드 때 env로 생성), robots.txt
  │            SPA 폴백: 404.html이 없으면 Pages가 모르는 경로에 index.html을 준다(_redirects 없음)
  ├─ 폰트: SUIT Variable (cdn.jsdelivr.net)
  └─ supabase-js (anon/publishable 키만, 별도 청크로 동적 import)
        ├─ Auth: Google OAuth(PKCE), Kakao(선택)  → /auth/callback에서 code 교환
        ├─ RPC: 목록·상세·내 정보 조회(jsonb), security definer 함수로만 쓰기
        ├─ PostgREST select: 기준 데이터(categories·regions)만
        └─ Postgres (RLS, 제약조건, 행 잠금, audit_logs)
```

- 별도 백엔드 서버 없음. 비즈니스 규칙의 최종 판단은 Postgres 제약조건과 RPC가 한다.
- service role 키는 브라우저 번들·Git 어디에도 두지 않는다 → [SECURITY §4](./SECURITY.md#4-비밀키-관리).

## 2. 기술 스택

| 영역 | 선택 | 메모 |
|---|---|---|
| UI | React + TypeScript(strict) + Vite | 버전은 `package.json` 기준 |
| 라우팅 | React Router | 최신 API는 공식 문서로 확인 후 사용 |
| 스타일 | Tailwind CSS v4, CSS 변수 토큰(`@theme`) | 토큰 값은 [UI_SPEC §2](./UI_SPEC.md#2-디자인-토큰) |
| 검증 | Zod | 클라이언트 검증. 서버는 RPC에서 같은 규칙을 다시 검사 |
| 데이터·인증 | Supabase(Postgres, Auth, RLS, RPC) | Edge Function은 MVP에서 쓰지 않음 |
| 상태 | React context + 훅 | 상태관리 라이브러리 없음 |
| 테스트 | Vitest, React Testing Library, Playwright, PGlite(DB 테스트) | [TEST_PLAN](./TEST_PLAN.md) |
| 배포 | Cloudflare Pages | 실제 배포는 사용자 승인 후 |

## 3. 폴더 구조

```
src/
  components/
    ui/          버튼, 칩, 입력, 다이얼로그, 배지, 토스트 등 공통 컴포넌트
    layout/      헤더, 모바일 하단 내비, 푸터, 개발용 데이터 띠
    meeting/     목록 행, 날짜 스트립, 필터 바, 상세 CTA 패널, 참가자 행
  pages/         라우트 단위 페이지
  lib/           date(KST 포맷·범위 변환), filters(URL 쿼리 파싱·직렬화), env(환경 변수 검증)
  domain/        categories, regions, meetingPhase(파생 상태), 검증 스키마(Zod)와 한도 상수
  data/
    types.ts     도메인 타입(Meeting, Participant, Profile, Venue, Report ...)
    adapter.ts   DataAdapter 인터페이스, AppError
    index.ts     모드 판별 팩토리
    supabase/    Supabase 구현(동적 import): client(생성·최소 계약), keyGuard(service_role 거부),
                 adapter(RPC 매핑), auth(PKCE·콜백), rpcArgs(입력 → 인자), mapping(응답 검증·변환), errors(오류 분류)
    mock/        개발·E2E 전용 구현과 예시 데이터(동적 import)
    unconfigured.ts  설정 없는 프로덕션용 빈 구현
supabase/
  migrations/    YYYYMMDDHHMMSS_<name>.sql
  seed.sql       개발 전용. 운영 DB 적용 금지
  tests/         PGlite 기반 DB 테스트
e2e/             Playwright 시나리오
scripts/         check-no-seed.mjs, bundle-migrations.mjs(npm run db:bundle), race-test.ts(BLOCKED),
                 write-headers.mjs·lib/security-headers.mjs(보안 헤더), check-dist.mjs, check-builds.mjs, csp-preview.mjs
public/          파비콘, robots.txt, images/(히어로 사진 교체 지점). _headers는 빌드 때 dist/에 생성(scripts/write-headers.mjs)
```

## 4. 데이터 어댑터

페이지와 컴포넌트는 `src/data/index.ts`가 돌려주는 `DataAdapter`만 쓴다. Supabase 클라이언트를 직접 import하지 않는다.

| 모드 | 조건 | 동작 |
|---|---|---|
| `supabase` | `VITE_SUPABASE_URL`과 `VITE_SUPABASE_ANON_KEY`가 모두 있고 형식이 유효(개발 서버 포함, e2e 모드 제외) | 실제 조회·RPC. 키가 service_role/secret으로 보이면 경고 후 `unconfigured` |
| `mock` | 위 설정이 없고 `import.meta.env.DEV` 또는 `import.meta.env.MODE === 'e2e'` | 메모리 예시 데이터. 화면 상단에 "개발용 예시 데이터" 띠. 로그인 화면에 "개발용 테스트 계정 선택" |
| `unconfigured` | 위 설정이 없는 프로덕션 빌드 | 모든 조회는 빈 결과, 쓰기는 `SERVICE_UNCONFIGURED` 오류. 가짜 데이터 없음. "서비스 준비 중" 안내 |

- mock 구현은 `if (import.meta.env.DEV || import.meta.env.MODE === 'e2e') { await import('./mock') }` 형태로만 불러온다. Vite가 이 조건을 빌드 시 상수로 치환하므로 프로덕션 번들에서 mock 청크가 빠진다.
- mock 데이터 모듈(`src/data/mock/seed.ts`)에는 seed 마커 문자열을 둔다. 마커와 예시 데이터 고유 문자열 목록은 `scripts/seed-needles.json`에 있고, `npm run check:seed`(`scripts/check-no-seed.mjs`)가 `dist/`에서 이 문자열을 찾으면 실패한다.
- 권장: E2E 빌드(`--mode e2e`)는 `dist/`가 아닌 별도 출력 폴더를 써서 배포 산출물과 섞이지 않게 한다.
- mock은 RPC 규칙을 흉내만 낸다. 보안 경계가 아니며 규칙의 정답은 DB 테스트([TEST_PLAN](./TEST_PLAN.md))다.
- mock 예시 일정은 현재 시각 기준 상대값(예: 오늘 + 2일 19:00 KST)으로 만들어 날짜가 지나도 깨지지 않게 한다.

인터페이스: `src/data/adapter.ts`의 `DataAdapter`(조회·신청·취소·생성·수정·모임 취소·모집 전환·내 모임·참가자·승인/거절·출석·프로필·탈퇴)와 `AuthAdapter`(`getSessionUser`·`onAuthStateChange`·`signInWithOAuth`·`completeOAuthCallback`·`signOut`, mock 전용 테스트 계정 메서드). Phase 4에서 공간(`listVenues`·`getVenue`)·신고(`submitReport`)·관리자(`admin*` 12종 — 서버 `is_admin()`·RLS가 경계, mock은 관리자 dev 계정만 허용) 메서드를 추가했다. 관리자 공간·카테고리 쓰기만 테이블 직접 DML(`SupabaseClientLike.table`)이고 나머지는 RPC다. RPC 매핑표는 [DB_SCHEMA §17](./DB_SCHEMA.md#17-프론트-어댑터용-rpc-시그니처-요약).

### 4.1 Supabase 어댑터 (`src/data/supabase/`)

| 파일 | 역할 |
|---|---|
| `index.ts` | 진입점 `createSupabaseDataAdapter(env, envNames)`. `src/data/index.ts`가 env가 있을 때만 동적 import → supabase-js·어댑터가 별도 청크 |
| `client.ts` | `createClient(url, anonKey, { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } })`와 어댑터가 쓰는 최소 계약 `SupabaseClientLike`(`rpc`, `from().select().eq().order()`, `auth` 5개 메서드). `callRpc`, `readSessionUserId` |
| `keyGuard.ts` | 공개 env 이름에 `SERVICE_ROLE`이 있거나, 키가 JWT `role=service_role`·`sb_secret_`이면 거부(키 값은 출력하지 않음). 브라우저와 `vite.config.ts`(빌드 중단)가 같이 쓴다 |
| `adapter.ts` | `createSupabaseAdapter({ client, kakaoAuthEnabled, browser? })` — **클라이언트를 주입받는다**. 세션이 없으면 로그인 필요 RPC를 부르지 않고(`getMyParticipation`·`getMyProfile` null, 나머지 `AUTH_REQUIRED`), uuid가 아닌 id는 요청하지 않는다 |
| `rpcArgs.ts` | 필터 → `list_public_meetings` 인자(`date`는 `kstDayRange`, 빈 값 생략), `MeetingInput` → snake_case jsonb(전체 키, `start_at`은 오프셋 포함 ISO만), `ProfileUpdate` → 보낸 키만 |
| `mapping.ts` | Zod로 응답 모양 검증 → 프론트 타입. 필수 키 누락·타입·enum·모르는 카테고리/권역·잘못된 시각이면 `UNKNOWN`(detail `contract:<rpc>`). 시각은 UTC `…Z`(밀리초)로 정규화 |
| `errors.ts` | PostgREST·Auth·네트워크 오류 → `DataAdapterError`(§10) |
| `auth.ts` | 로그인 시작(returnTo 저장, `redirectTo = location.origin + '/auth/callback'`, 카카오는 플래그가 켜졌을 때만), 콜백(code 교환·오류 쿼리 처리·주소에서 code 제거), 세션 사용자(`get_my_profile`), 상태 변화 구독 |

- 계약 테스트: `supabase/tests/adapter-contract.test.ts`가 PGlite로 SQL을 실행하는 가짜 클라이언트를 이 어댑터에 주입해 실제 함수와의 계약(인자 이름·jsonb 키·응답 모양·오류 코드)을 확인한다. PostgREST 계층(HTTP·직렬화)은 검증 범위 밖이다([TEST_PLAN §6](./TEST_PLAN.md#6-어댑터-계약-테스트-pglite)).

## 5. 라우트

| 경로 | 화면 | 로그인 | 비고 |
|---|---|---|---|
| `/` | 홈(히어로 + 탐색) | 불필요 | 탐색 쿼리 동일 |
| `/meetings` | 모임 찾기(히어로 없음) | 불필요 | |
| `/meetings/:id` | 모임 상세 | 불필요 | 신청은 로그인 필요 |
| `/meetings/new` | 모임 만들기 | 필요 | 온보딩 미완료 시 `/profile`로 |
| `/meetings/:id/edit` | 모임 수정 | 필요 | 모임장 아니면 권한 없음 화면 |
| `/meetings/:id/participants` | 참가자 관리 | 필요 | 모임장 전용 |
| `/my/meetings` | 내 모임 | 필요 | `?role=hosted\|applied&tab=...` |
| `/login` | 로그인 | - | 로그인 상태면 `returnTo` 또는 `/`로 |
| `/auth/callback` | OAuth 콜백 처리 | - | |
| `/profile` | 프로필·온보딩·탈퇴 요청 | 필요 | |
| `/venues`, `/venues/:id` | 공간 정보 | 불필요 | |
| `/admin` | 관리자 | 필요(로그인 + 최초 설정 가드) | UI는 `SessionUser.isAdmin`(=`is_admin()`)으로 분기 — 사용성용. 데이터는 RLS·RPC가 차단. 헤더·내비 미노출, 관리자에게만 프로필에 링크 |
| `/policies/:slug` | 정책 문서 | 불필요 | `terms`, `privacy`, `operations`. 그 외 slug는 404 |
| `*` | 404 | - | |

- 로그인 필요 라우트는 공통 가드가 세션을 확인하고, 없으면 현재 경로를 `returnTo`로 저장한 뒤 `/login`으로 보낸다.
- 새로고침·직접 접근: Cloudflare Pages는 빌드 출력에 최상위 `404.html`이 없으면 SPA로 보고 모르는 경로에 `index.html`을 준다. Phase 0의 `public/_redirects`(`/* /index.html 200` — Pages가 무한 루프 규칙으로 무시)는 Phase 5에 삭제했다. 빌드·`check:dist`가 `404.html`이 생기면 실패한다. 실제 동작은 첫 프리뷰 배포 때 확인([DEPLOYMENT §8](./DEPLOYMENT.md#8-첫-프리뷰-배포-확인)).

## 6. 인증 흐름

1. 사용자가 "로그인하고 신청하기" 또는 보호된 라우트에 접근 → `sessionStorage.hanpan.returnTo`에 현재 경로(쿼리 포함) 저장 → `/login`.
2. `/login`에서 Google(또는 Kakao) 선택 → `auth.signInWithOAuth(provider, returnTo)`: returnTo를 다시 저장(검증된 값만)하고 supabase-js PKCE 흐름 시작. `redirectTo = window.location.origin + '/auth/callback'` — `VITE_SITE_URL`을 쓰지 않는다(프리뷰 배포에서 로그인하면 운영 주소로 돌아가는 문제 방지). 이 주소는 Supabase Redirect URLs 허용 목록에 있어야 한다.
3. `/auth/callback`: `auth.completeOAuthCallback()`이 URL의 `code`를 `exchangeCodeForSession`으로 교환한다(`detectSessionInUrl: false`라 자동 감지하지 않음). 처리 전에 `code`·`error` 등 파라미터를 `history.replaceState`로 주소창·방문 기록에서 지운다. `error`/`error_description`(쿼리·해시)이 있으면 교환하지 않고 실패 안내 + 다시 로그인. 코드·토큰·오류 설명 문구는 로그·오류 메시지에 남기지 않는다.
4. 세션 확보 후 `get_my_profile`로 세션 사용자(닉네임·`onboarded`·계정 상태·관리자 여부)를 읽는다. 최초 설정 전이면 returnTo를 남겨 두고 `/profile?onboarding=1`로, 아니면 `returnTo`로 이동(사용 후 삭제). 교환에 실패하면 returnTo를 남겨 다시 로그인했을 때 원래 화면으로 돌아가게 한다.
5. `returnTo` 검증: `/`로 시작, `//`로 시작하지 않음, 백슬래시·제어문자 없음, `/login`·`/auth/callback`이 아님. 실패하면 `/`. 사용 후 즉시 삭제.

- 프로필은 가입 트리거 `handle_new_user()`가 만든다. 닉네임은 무작위 임시값이며 OAuth 메타데이터(실명 등)를 복사하지 않는다.
- Kakao 버튼은 `VITE_AUTH_KAKAO_ENABLED=true`일 때만 보인다. 이 값은 Supabase 콘솔에 Kakao provider 설정을 끝낸 뒤에만 켠다.
- 상태 변화(`onAuthStateChange`): `SIGNED_OUT` → 즉시 비로그인. `SIGNED_IN`·`USER_UPDATED` → 다음 틱에 `get_my_profile`을 다시 읽어 알림(supabase-js 콜백 안에서 다른 supabase 호출을 기다리지 않음). 같은 사용자의 `TOKEN_REFRESHED`·재발생한 `SIGNED_IN`(탭 복귀 등)과 `INITIAL_SESSION`은 다시 불러오지 않는다. 다른 사용자로 바뀌었는데 프로필을 읽지 못하면 비로그인으로 알린다(이전 사용자 화면을 남기지 않음).
- 로그아웃: `signOut()`(global, 실패하면 local로 이 기기만이라도) → 사용자 context, `returnTo` 초기화 → `/`. 다른 탭의 로그아웃(`SIGNED_OUT` 이벤트)에도 같은 초기화를 한다.
- 옵션 이름(`flowType`, `detectSessionInUrl`, `exchangeCodeForSession` 등)은 설치된 `@supabase/supabase-js` 2.119.2의 타입 정의로 확인했다.

## 7. 상태 관리와 캐시

- 전역 context는 `AuthContext`(세션 사용자 요약, `userKey`)와 `DataAdapterContext`(어댑터)뿐이다. 어댑터에는 캐시가 없다.
- 조회 결과는 화면 훅(`useAsyncData`) 상태에만 있다. 요청 키에 `useAuth().userKey`(`user:<id>` 또는 `anon`)를 넣어 사용자 변경(로그인·로그아웃·계정 전환) 시 다시 불러오고, 키가 바뀌는 즉시 이전 키의 응답을 메모리에서도 지운다(같은 키로 돌아와도 옛 응답을 다시 보여주지 않음). 늦게 도착한 이전 키의 응답·refresh 결과는 버린다. 테스트: `src/data/useAsyncData.test.tsx`, `src/auth/AuthProvider.test.tsx`.
- 탐색 목록(`useMeetingList`)은 사용자와 무관한 공개 데이터라 `userKey`를 쓰지 않는다. 예외: 관리자에게는 비공개 공간 이름이 보일 수 있으며, 로그아웃 후에도 같은 필터로 보던 목록은 다음 조회 때 갱신된다.
- 쓰기 요청 중에는 버튼을 잠그고(`aria-busy`) 같은 요청을 중복 전송하지 않는다. 실패하면 이전 상태로 되돌리고 오류를 안내한다. 낙관적 업데이트는 하지 않는다(서버 응답 후 반영).

## 8. 시간대 처리

- DB는 `timestamptz`. 화면 표시는 `Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', ... })`로 고정한다. 브라우저 시간대에 의존하지 않는다.
- 생성 폼의 날짜·시간 입력값은 KST 벽시계 시각으로 해석해 `+09:00` 오프셋을 붙여 ISO 문자열로 보낸다. 한국은 현재 일광절약시간이 없어 고정 오프셋을 쓴다(`src/lib/date`에 한 곳으로 모은다).
- 날짜 필터 `date=YYYY-MM-DD`는 `[해당일 00:00 KST, 다음날 00:00 KST)` 범위로 변환한다.
- "오늘"과 날짜 스트립 7일도 KST 기준으로 계산한다. 테스트는 다른 `TZ` 환경에서도 실행한다.

## 9. 탐색 URL 쿼리

| 키 | 값 | 기본 | 잘못된 값 |
|---|---|---|---|
| `date` | `YYYY-MM-DD`(실존 날짜) | 없음(전체) | 무시 |
| `category` | 카테고리 id | 없음(전체) | 무시 |
| `region` | 권역 code | 없음(전체) | 무시 |
| `q` | 검색어(제목·게임명·장소·권역명), 공백 정리, 최대 50자(DB도 50자) | 없음 | 잘라냄 |
| `recruiting` | `1` | 없음 | `1` 외 값은 무시 |
| `sort` | `newest` | 가까운 순(`soonest`, 쿼리 생략) | 무시 |

- 파싱·직렬화는 `src/lib/filters`에서 담당하고 왕복(parse → serialize) 단위 테스트를 둔다. 기본값은 URL에 쓰지 않는다.
- 목록 조건: `is_hidden = false`, `status <> 'cancelled'`, `start_at > now()`. 페이지 크기 20, "더 보기"로 다음 페이지.
- `recruiting=1`은 `status = 'open'`이면서 남은 자리가 있는 모임이다. `remaining_seats` 생성 컬럼 + `list_public_meetings` RPC로 처리한다([DB_SCHEMA §9.16](./DB_SCHEMA.md#916-조회-rpc-프론트-어댑터용)).
- 검색어는 RPC 인자(`p_q`)로 넘기고 DB가 `\`·`%`·`_`를 이스케이프해 `ilike`에 넣는다(PostgREST 필터 문법을 쓰지 않음).

## 10. 오류 처리

- 어댑터는 모든 오류를 `DataAdapterError { code, detail? }`로 바꾼다(`src/data/supabase/errors.ts`).
  - SQLSTATE `P0001`: message가 `ERROR_CODES`에 있으면 그 코드([DB_SCHEMA §10](./DB_SCHEMA.md#10-에러-코드)), 없으면 `UNKNOWN`. `details`는 필드 이름·사유 코드 형식일 때만 `detail`로 보존.
  - `42501` → `PERMISSION_DENIED`. PostgREST JWT 오류(`PGRST301·302·303`) → `AUTH_REQUIRED`(`미확인:` 실제 응답으로 확인 전).
  - fetch 실패(`TypeError`, status 0)·중단·시간 초과·게이트웨이 오류(502·503·504·520~527) → `NETWORK_ERROR`.
  - Auth: 재시도 가능한 fetch 오류 → `NETWORK_ERROR`, 세션 없음·PKCE 교환 실패·4xx → `AUTH_REQUIRED`, 429 → `RATE_LIMITED`(detail `auth`).
  - 응답 모양이 계약과 다르면 `UNKNOWN`(detail `contract:<rpc>`). 그 밖은 `UNKNOWN`.
  - 원본 오류 객체·메시지·`details`는 보관하지 않는다(개발자용 메시지에는 `source`·SQLSTATE·HTTP 상태만).
- 사용자 문구는 코드별 한국어 메시지 표([UI_SPEC §6](./UI_SPEC.md#6-오류-문구))로 매핑한다. 원본 오류 메시지를 화면에 그대로 노출하지 않는다.
- 콘솔 로그에 토큰, 이메일, 신청 메시지 등 개인정보를 남기지 않는다.

## 11. 환경 변수

| 이름 | 필수 | 공개 여부 | 설명 |
|---|---|---|---|
| `VITE_SUPABASE_URL` | 운영 필수 | 번들에 포함(공개) | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | 운영 필수 | 번들에 포함(공개) | anon(또는 publishable) 키. RLS가 보호 경계 |
| `VITE_AUTH_KAKAO_ENABLED` | 선택 | 공개 | `true`일 때만 Kakao 버튼 노출 |
| `VITE_SITE_URL` | 선택 | 공개 | 서비스 기준 URL. 공유 링크에만 쓴다. OAuth `redirectTo`는 `window.location.origin` 기준(프리뷰 배포가 운영 주소로 돌아가지 않도록) |

- 형식은 루트의 `.env.example`을 따른다. 로컬 값은 `.env.local`(Git 제외)에 둔다.
- `VITE_` 변수는 빌드 시점에 번들에 박힌다. 값을 바꾸면 다시 빌드해야 한다.
- service role 키, DB 비밀번호, OAuth client secret은 어떤 `VITE_` 변수에도 넣지 않는다. 실제 값은 `.env.local`과 Cloudflare 환경 변수에만 둔다.
- 키 가드: `VITE_` 변수 이름에 `SERVICE_ROLE`이 있거나 `VITE_SUPABASE_ANON_KEY`가 service_role JWT·`sb_secret_` 키로 보이면 `npm run build`가 멈추고(개발 서버는 경고), 앱은 경고 후 Supabase 연결을 거부한다(`unconfigured`). `vite.config.ts`는 `VITE_` 변수의 **이름 목록만** `__HANPAN_PUBLIC_ENV_NAMES__`로 주입한다(값은 넣지 않음).

## 12. 빌드와 산출물 점검

- `npm run build`(`tsc -b && vite build && node scripts/write-headers.mjs`) → `dist/` + `dist/_headers`(CSP connect-src = `VITE_SUPABASE_URL`의 origin, 없으면 `'self'`만. https origin이 아니면 빌드 실패 — [SECURITY §7](./SECURITY.md#7-보안-헤더와-csp)).
- `npm run check:dist`: 산출물 점검(`404.html`·`_redirects` 없음, `_headers`가 현재 env와 일치, 인라인 코드·비밀 키 값 없음). verify에 포함.
- `src/main.tsx`의 첫 import `src/lib/zodConfig.ts`가 Zod JIT(`new Function` 시험)를 끈다 — CSP `script-src 'self'`(unsafe-eval 없음)에서 위반이 기록되지 않게.
- `npm run check:seed`: `dist/`에서 seed 마커·mock 모듈 흔적을 찾으면 실패. 배포 전 필수.
- `npm run verify`: 타입 검사(앱·테스트·설정·DB 테스트·scripts) → 린트(`src`, `e2e`, `supabase/tests`, `scripts`) → 단위 테스트(`src`, `scripts/*.test.ts`) → DB 테스트(PGlite) → 빌드 → seed 점검 → 산출물 점검. 별도: `npm run test:csp`(빌드 결과 CSP 스모크), `npm run check:builds`(빌드 변형).
- `npm run db:bundle`: 마이그레이션을 파일명 순서로 이어 붙인 `supabase/.bundle/all-migrations.sql`(Git 제외, seed 미포함) — SQL Editor 붙여 넣기용.

## 13. 주요 결정 기록

| # | 결정 | 이유 |
|---|---|---|
| D1 | 별도 서버 없이 Supabase RLS + RPC | 1인 운영, 무료 플랜, 규칙을 DB 한 곳에 모음 |
| D2 | 쓰기는 security definer RPC만 | 정원·중복·권한 검사를 트랜잭션 안에서 강제 |
| D3 | 모집 상태 3종만 저장, 나머지는 파생 | 시간 경과에 따른 배치 작업 불필요 |
| D4 | 대기자 자동 승격 없음 | 알림이 없어 자동 확정 사실을 전달할 수 없음 |
| D5 | 알림 테이블 미생성 | 미구현 기능을 데이터 모델에 미리 두지 않음 |
| D6 | DB 테스트는 PGlite | 현재 환경에 Supabase CLI·Docker 없음. 동시성은 별도 스크립트(BLOCKED) |
| D7 | 상세는 모달이 아닌 페이지 | 공유 링크·새로고침·뒤로가기 지원 |

## 14. 기술 리스크

| 리스크 | 대응 |
|---|---|
| PGlite에서 역할 전환·RLS·트리거 동작이 Supabase와 다를 수 있음 | Phase 2 스파이크로 확인(차이는 TEST_PLAN §5.1). 실환경 재확인은 `BLOCKED:` |
| 어댑터 ↔ PostgREST 계층(HTTP·인자 직렬화·오류 응답 필드) 불일치 | PGlite 계약 테스트로 SQL 함수와의 계약만 확인. PostgREST 계층은 개발용 프로젝트에서 수동 확인(`BLOCKED:`) |
| PGlite로는 진짜 동시 신청 경쟁을 재현할 수 없음 | 행 잠금·제약 검증 + `scripts/race-test.ts`를 실제 개발용 DB에서 실행(BLOCKED) |
| CSP의 Supabase 주소가 환경별로 다름 | (결정, Phase 5) `_headers`를 빌드 때 env로 생성([SECURITY §7](./SECURITY.md#7-보안-헤더와-csp)). 실제 Pages 적용은 첫 프리뷰에서 확인 |
| 알림·채팅이 없어 일정 변경·취소 전달이 어려움 | 수정·취소 화면에 사실 그대로 안내. 정책 결정은 [PRD §10](./PRD.md#10-미결-사항) |
| 의존성 메이저 버전이 최신이라 API가 문서와 다를 수 있음 | 설치된 버전의 공식 문서·타입 정의로 확인 |
