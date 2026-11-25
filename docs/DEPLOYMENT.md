# 배포·설정 가이드 (Supabase + Cloudflare Pages)

상태: Phase 5 정리 (2026-11-25 — 보안 헤더 빌드 생성, SPA 폴백 방식 변경(`_redirects` 삭제), `.nvmrc`, 빌드 검증, 스모크·롤백 절차. 외부 콘솔 설정과 실제 배포는 전부 `BLOCKED:`)

> **현재 상태: `BLOCKED:`** 아래 외부 콘솔 단계는 모두 **사용자가 직접** 수행해야 한다. 아직 Supabase 프로젝트, OAuth 클라이언트, Cloudflare Pages 프로젝트, 도메인이 없다. 실제 운영 배포는 사용자 승인 후에만 한다.
> 앱 쪽 준비는 끝났다: env 2개(`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)를 넣으면 Supabase 어댑터가 동작하고, `npm run build`가 환경에 맞는 보안 헤더(`dist/_headers`)를 만든다. 실제 Supabase·Cloudflare에 연결해 확인한 적은 없다.
> 콘솔 메뉴 이름과 위치는 각 서비스가 바꿀 수 있다. 화면이 다르면 각 서비스 공식 문서를 기준으로 한다. 이 문서에서 `미확인:`으로 표시한 것은 실제 화면·배포에서 확인해야 한다.

관련 문서: [ARCHITECTURE §11](./ARCHITECTURE.md#11-환경-변수) · [SECURITY](./SECURITY.md) · [DB_SCHEMA](./DB_SCHEMA.md) · [OPERATIONS](./OPERATIONS.md)(백업·장애 대응) · [NEXT_STEPS](./NEXT_STEPS.md)(출시 체크리스트)

## 0. 한눈에 보는 순서

1. 준비물 확인(§1)과 환경 변수 값 정리(§2)
2. Supabase: 개발용 프로젝트 → 마이그레이션 → Auth URL → (첫 로그인 후) 관리자 지정(§3)
3. Google OAuth(§4), 필요하면 Kakao(§5)
4. 로컬에서 개발용 프로젝트로 첫 연결 확인 + 동시 신청 경쟁 테스트(§6)
5. Cloudflare Pages 프로젝트·빌드 설정·환경 변수(§7) → 프리뷰 배포 확인(§8)
6. 운영 Supabase 프로젝트를 같은 순서로 준비 → 운영 배포(사용자 승인) → 배포 직후 스모크(§9)
7. 문제가 생기면 롤백(§10). 백업·장애 대응은 [OPERATIONS §8~§9](./OPERATIONS.md#8-백업)

## 1. 준비물

| 항목 | 상태 |
|---|---|
| Supabase 계정·프로젝트(운영용 1, 개발·프리뷰용 1 권장) | `BLOCKED:` 미생성. `미확인:` 무료 플랜 프로젝트 수·비활성 일시중지 정책 |
| Google Cloud 프로젝트(OAuth 클라이언트) | `BLOCKED:` |
| Kakao Developers 앱(선택) | `BLOCKED:` |
| Git 원격 저장소(Cloudflare Pages Git 연동 시) | `BLOCKED:` 원격 저장소 미정 |
| Cloudflare 계정 | `BLOCKED:` |
| 운영 도메인 | `BLOCKED:` 브랜드·도메인 미정. 그 전에는 `<프로젝트>.pages.dev` 사용 |
| 운영 이메일(OAuth 동의 화면 지원 이메일, 문의 창구) | `BLOCKED:` |

## 2. 환경 변수

| 이름 | 필수 | 공개/비밀 | 운영(Production) 값 출처 | 프리뷰(Preview) 값 출처 |
|---|---|---|---|---|
| `VITE_SUPABASE_URL` | 운영 필수 | 공개(번들·CSP 헤더에 들어감) | 운영 Supabase 프로젝트 → Project Settings → API의 Project URL (`https://<ref>.supabase.co`, 경로 없이) | **개발용** Supabase 프로젝트의 Project URL |
| `VITE_SUPABASE_ANON_KEY` | 운영 필수 | 공개(번들에 들어감 — RLS가 보호 경계) | 운영 프로젝트의 anon(또는 publishable) 키 | 개발용 프로젝트의 anon(또는 publishable) 키 |
| `VITE_AUTH_KAKAO_ENABLED` | 선택(기본 꺼짐) | 공개 | Kakao provider 설정을 끝낸 운영 프로젝트면 `true` | 개발용 프로젝트 설정에 맞춤 |
| `VITE_SITE_URL` | 선택 | 공개 | 운영 주소(모임 공유 링크용. OAuth와 무관) | 비움(현재 주소 사용) 또는 프리뷰 주소 |
| `NODE_VERSION` | 선택 | 비밀 아님 | 보통 비움(`.nvmrc`의 `24.18.0`을 씀). `.nvmrc`를 못 읽는 빌드 이미지면 `24.18.0` | 같음 |

- **프리뷰 배포에는 개발용 Supabase 프로젝트를 쓴다.** 프리뷰에서 운영 DB에 테스트 모임·신고가 쌓이거나 운영 사용자 데이터가 노출되지 않게 한다. 프리뷰 env를 비우면 앱은 빈 상태(`unconfigured`)로 뜨고 로그인할 수 없다.
- **Pages 빌드는 항상 운영 모드(`vite build`, mode=production)다.** mock(개발용 예시 데이터)은 `npm run dev`·`--mode e2e`에서만 동적 import 되므로 Pages 빌드에는 들어갈 수 없다(`npm run check:seed`가 seed 흔적을 찾으면 실패). 프리뷰에서 예시 데이터를 보여 주는 방법은 없다.
- service role/secret 키, DB 비밀번호, OAuth client secret은 **어떤 환경 변수에도 넣지 않는다.** 넣으면 키 가드가 빌드를 멈춘다(이름에 `SERVICE_ROLE`이 들어간 `VITE_` 변수, service_role JWT, `sb_secret_` 키 — `npm run check:builds`로 확인).
- `VITE_SUPABASE_URL`이 https가 아니거나 경로·이상한 문자가 있으면 `npm run build`가 실패한다(보안 헤더 생성 단계 — [SECURITY §7](./SECURITY.md#7-보안-헤더와-csp)).
- `VITE_` 값은 빌드할 때 번들과 `_headers`에 들어간다. 값을 바꾸면 **재배포**해야 한다.
- Pages 환경 변수에 `NODE_ENV=production`을 넣지 않는다. npm이 devDependencies(TypeScript·Vite 등 빌드 도구)를 설치하지 않아 빌드가 실패한다.
- 로컬: `.env.example`을 `.env.local`로 복사해 두 값만 넣는다(Git 제외 파일).

## 3. Supabase 설정

개발용 프로젝트에서 먼저 끝까지 해 보고, 운영 프로젝트는 같은 순서로 다시 한다.

### 3.1 프로젝트 생성

1. Supabase 대시보드에서 새 프로젝트 생성. 리전은 서울 권장(제공 여부는 생성 화면에서 확인).
2. DB 비밀번호는 비밀번호 관리자에 보관한다. 저장소·채팅에 붙이지 않는다.
3. Project Settings → API에서 **Project URL**과 **공개용 키(anon 또는 publishable)**를 확인한다. service role/secret 키는 복사해 두지 않는다. `미확인:` 새 프로젝트에서 발급되는 키 형식(기존 JWT 형식 또는 publishable/secret 형식) — 어느 쪽이든 공개용 키만 쓴다.
4. API 설정에서 최대 반환 행 수를 낮게(예: 100) 조정할지 검토한다([SECURITY §10](./SECURITY.md#10-레이트-리밋과-부하)).
5. 운영자 계정에 2단계 인증을 켠다.

### 3.2 마이그레이션 적용

두 방법 중 하나로 통일한다. 섞어 쓰면 적용 이력이 어긋난다. **`supabase/seed.sql`(개발용 예시 데이터)은 운영 프로젝트에서 절대 실행하지 않는다.**

**A. SQL Editor(도구 설치 불필요, 권장)**
1. 빈 프로젝트에 처음 적용할 때: `npm run db:bundle` → `supabase/.bundle/all-migrations.sql`(Git 제외)을 열어 전체를 SQL Editor에 붙여 넣고 실행한다. 마이그레이션 파일(`supabase/migrations/*.sql`, 현재 9개)을 파일명 순서로 이어 붙인 것이며 seed는 들어 있지 않다(DB 테스트 `bundle.test.ts`가 빈 DB에 한 번에 적용되는지 확인).
2. 이미 적용한 프로젝트에 새 마이그레이션이 추가됐을 때: 묶음 전체를 다시 실행하지 말고(테이블 생성 등이 실패한다) **새 파일만** 파일명 순서대로 실행한다. 예: Phase 3까지(5개) 적용한 프로젝트는 `20261124000600_venues_read.sql` → `20261124000700_admin_tools.sql` → `20261124000800_nickname_rules_v2.sql` → `20261124000900_admin_requires_active.sql`, Phase 4까지(8개) 적용한 프로젝트는 `20261124000900_admin_requires_active.sql`만.
3. 적용한 파일명과 날짜를 운영 기록에 남긴다(SQL Editor는 이력을 관리하지 않는다).
4. 운영 프로젝트에 새 마이그레이션을 적용하기 **직전에 백업**(`pg_dump`)을 받는다([OPERATIONS §8](./OPERATIONS.md#8-백업)). 마이그레이션은 앞으로만 진행한다(§10).

**B. Supabase CLI**
```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push
```
- `미확인:` 설치되는 CLI 버전의 옵션. 운영 프로젝트에 seed를 포함하는 옵션은 쓰지 않는다.

적용 후 확인(SQL Editor):
```sql
select c.relname, c.relrowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r';      -- 모든 행이 true여야 함
select count(*) from public.meetings;                 -- 운영 출시 전 0
select code, sort_order from public.regions order by sort_order;   -- 6행, etc_daejeon = 90
select public._is_reserved_nickname('한판승부') as relaxed,          -- false
       public._is_reserved_nickname('운영진모임') as blocked;        -- true (마이그레이션 8)
select prosrc like '%status = ''active''%' as admin_requires_active
from pg_proc where oid = 'public.is_admin()'::regprocedure;  -- true (마이그레이션 9)
```

### 3.3 Auth URL 설정

Authentication → URL Configuration(이름은 바뀔 수 있음):

| 항목 | 운영 프로젝트 | 개발 프로젝트(프리뷰·로컬) |
|---|---|---|
| Site URL | `https://<운영 도메인>`(도메인 전에는 `https://<프로젝트>.pages.dev`) | `http://localhost:5173` |
| Redirect URLs | `https://<운영 도메인>/auth/callback` (도메인 전에는 `https://<프로젝트>.pages.dev/auth/callback`) — **정확한 주소만, 와일드카드 없음** | `http://localhost:5173/auth/callback`, `http://localhost:4173/auth/callback`(`npm run preview`), 프리뷰 주소(아래) |

- 앱은 `redirectTo`를 **현재 접속한 주소의 origin** + `/auth/callback`으로 보낸다(`VITE_SITE_URL`을 쓰지 않음). 로그인할 주소마다 `…/auth/callback`이 목록에 있어야 한다. 목록에 없으면 Supabase가 Site URL로 돌려보낸다(`미확인:` 실제 동작은 설정 후 확인).
- 프리뷰 주소 와일드카드의 위험과 대안:
  - 위험: `https://*.pages.dev/**`처럼 넓은 패턴은 **다른 사람의 Pages 프로젝트**도 허용해, 로그인 결과(인가 코드)가 남의 주소로 갈 수 있다. PKCE라 코드만으로는 세션을 만들 수 없지만 허용할 이유가 없다.
  - 대안 1(권장): 프리뷰용 브랜치 하나(예: `preview`)를 정하고 그 고정 별칭 `https://preview.<프로젝트>.pages.dev/auth/callback`만 개발 프로젝트에 등록한다.
  - 대안 2: 꼭 필요하면 **개발 프로젝트에만** 이 프로젝트의 하위 도메인으로 좁힌 패턴(예: `https://*.<프로젝트>.pages.dev/auth/callback`)을 쓴다. `미확인:` Supabase가 지원하는 와일드카드 문법(`*`·`**`의 의미)은 공식 문서로 확인.
  - 운영 프로젝트에는 와일드카드를 넣지 않는다.
- 이메일 로그인(매직 링크·비밀번호)은 쓰지 않는다. Authentication → Providers에서 Email provider를 끌지 검토한다(`미확인:` 끄면 대시보드의 사용자 초대 기능에 영향이 있는지).

### 3.4 최초 관리자 지정

대상자가 먼저 서비스에 한 번 로그인한 뒤, SQL Editor에서 실행한다. 앱에는 관리자 지정 기능이 없다.

```sql
-- 1) 사용자 id 확인
select id, created_at from auth.users where email = '<관리자 이메일>';

-- 2) 관리자 부여 + 수동 기록
insert into public.admin_roles (user_id, role, granted_by, note)
values ('<user-id>', 'admin', null, '최초 운영자 지정');
insert into public.audit_logs (actor_id, action, target_type, target_id, meta)
values (null, 'admin.role_grant', 'user', '<user-id>', '{"via":"sql_editor"}');

-- 해제
delete from public.admin_roles where user_id = '<user-id>';
insert into public.audit_logs (actor_id, action, target_type, target_id, meta)
values (null, 'admin.role_revoke', 'user', '<user-id>', '{"via":"sql_editor"}');
```

- 지정 후 대상자가 새로고침하면 세션 사용자의 `isAdmin`이 `true`가 된다(`get_my_profile`이 `admin_roles`를 본다). JWT claim은 쓰지 않으므로 재로그인은 필요 없다.
- 관리자 권한은 active 계정에서만 동작한다(마이그레이션 9 — [SECURITY §3.1](./SECURITY.md#31-역할--동작-매트릭스와-근거-테스트-phase-5)). 관리자 계정을 이용 제한하거나 탈퇴 요청되면 즉시 권한이 멈추고, 제한을 풀면 돌아온다. 관리자 자격을 완전히 빼려면 위 "해제"를 실행한다.

## 4. Google OAuth

공통: 공급자 콘솔의 리디렉션 URI는 **Supabase 콜백** `https://<project-ref>.supabase.co/auth/v1/callback`이다(앱의 `/auth/callback`이 아님). client secret은 Supabase provider 설정 화면에만 입력한다. 개발·운영 프로젝트마다 따로 만든다(ref가 다르다).

1. Google Cloud Console에서 프로젝트 생성.
2. OAuth 동의 화면(브랜딩): **앱 이름·지원 이메일·로고는 사용자 결정 사항**(브랜드 미정 — `BLOCKED:`), 승인된 도메인, 개인정보처리방침·서비스 약관 URL(`/policies/privacy`, `/policies/terms` — 법률 검토 전 초안임에 유의).
3. 범위는 기본(openid, email, profile)만 쓴다.
4. 사용자 인증 정보 → OAuth 클라이언트 ID → 웹 애플리케이션. **승인된 리디렉션 URI: `https://<project-ref>.supabase.co/auth/v1/callback`**. 승인된 JavaScript 원본은 비워도 된다(`미확인:` 콘솔이 요구하면 앱 주소).
5. Supabase → Authentication → Providers → Google 활성화, Client ID·Secret 입력.
6. `미확인:` 앱 게시 상태(테스트/프로덕션)와 검수 필요 여부. 테스트 상태에서는 등록한 테스트 사용자만 로그인될 수 있다.
7. 앱은 별도 설정 없이 Google 버튼을 보여준다(env 2개가 있으면 활성).

## 5. Kakao OAuth (선택)

1. Kakao Developers → 애플리케이션 추가.
2. 플랫폼(Web)에 사이트 도메인 등록, 카카오 로그인 활성화.
3. Redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`(Google과 같은 Supabase 콜백).
4. 동의항목은 최소화한다(닉네임 등 필수 항목만). 프로필 사진·성별·연령대 등은 요청하지 않는다.
5. 보안 메뉴에서 Client Secret 생성·활성화.
6. Supabase → Providers → Kakao: Client ID(REST API 키), Client Secret 입력.
7. 위 설정이 모두 끝난 뒤에만 `VITE_AUTH_KAKAO_ENABLED=true`로 다시 빌드한다(로컬 `.env.local` 또는 Pages 환경 변수). `true`가 아니면 카카오 버튼이 보이지 않고, 어댑터도 카카오 로그인 요청을 보내지 않는다(`SERVICE_UNCONFIGURED`).
- `미확인:` 이메일(`account_email`) 동의항목은 비즈 앱 전환·심사가 필요할 수 있다. Supabase Kakao 연동이 이메일을 필수로 요구하는지, 이메일 없는 사용자를 허용하는 설정이 있는지 콘솔에서 확인한다. 이메일 없이 가입이 막히면 Kakao는 끈 채로 출시한다.
- `미확인:` Supabase Kakao provider가 기본으로 요청하는 동의항목 범위. 앱은 추가 scope를 요청하지 않는다. 확인 결과에 따라 [PRIVACY_DRAFT](./policies/PRIVACY_DRAFT.md) 수집 항목을 고친다.

## 6. 첫 연결 확인 순서 (개발용 프로젝트에서 먼저)

`BLOCKED:` 아직 실행한 적 없다. 처음 연결할 때 아래 순서로 확인하고 결과를 CHANGELOG에 남긴다.

1. §3.2 마이그레이션 적용(1~9) + 적용 후 확인 SQL.
2. `.env.local`에 env 2개 → `npm run dev` → 화면 상단에 "개발용 예시 데이터" 띠가 **없고**, 탐색 목록이 빈 상태로 뜨는지(브라우저 콘솔에 오류·키 가드 경고가 없는지).
3. `/login` → Google → 공급자 화면 → `/auth/callback` → 최초 설정(`/profile?onboarding=1`)으로 오는지. 주소창에 `code=`가 남지 않는지.
4. SQL Editor: `select id, nickname from public.profiles;` — 닉네임이 `플레이어` + 숫자이고 실명·이메일이 복사되지 않았는지. `select * from public.user_private;` — `terms_agreed_at`이 비어 있는지.
5. 최초 설정(닉네임 `한판승부` 같은 값으로 예약어 완화도 확인) → returnTo로 돌아오는지 → 프로필 화면에 반영되는지.
6. 모임 만들기 → 상세 → 다른 계정(또는 시크릿 창의 다른 Google 계정)으로 신청 → 모임장 참가자 관리에서 승인 → 신청 취소 → 모임 취소.
7. 로그아웃 → 보호된 화면이 로그인을 요구하는지, 다른 탭도 로그아웃되는지.
8. anon 키로 PostgREST를 직접 호출해 쓰기 거부와 오류 응답 모양을 확인한다(anon 키는 공개 값이지만 명령 기록을 공유하지 않는다).

   ```bash
   # 세션 없이 쓰기 RPC → 권한 오류(code 42501 예상, HTTP 401/403)
   curl -s -X POST "https://<project-ref>.supabase.co/rest/v1/rpc/apply_to_meeting" \
     -H "apikey: <anon 키>" -H "Authorization: Bearer <anon 키>" -H "Content-Type: application/json" \
     -d '{"p_meeting_id":"00000000-0000-4000-8000-000000000000"}'
   # 공개 목록 RPC에 잘못된 정렬값 → {"code":"P0001","message":"VALIDATION_FAILED","details":"sort",...} 예상
   curl -s -X POST "https://<project-ref>.supabase.co/rest/v1/rpc/list_public_meetings" \
     -H "apikey: <anon 키>" -H "Authorization: Bearer <anon 키>" -H "Content-Type: application/json" \
     -d '{"p_sort":"oldest"}'
   ```

   응답의 `code`·`message`·`details` 필드가 어댑터 가정(P0001 + message=코드 + details=사유)과 같은지 확인한다([DB_SCHEMA §10](./DB_SCHEMA.md#10-에러-코드)). 다르면 `src/data/supabase/errors.ts`를 고친다.
9. §3.4로 관리자 지정 → 새로고침 후 세션 사용자의 관리자 여부(`get_my_profile.isAdmin`)가 `true`인지 확인.
10. **동시 신청 경쟁 테스트**(개발용 프로젝트에서만, 운영 금지) — 자세한 절차·판정은 [TEST_PLAN §4.1](./TEST_PLAN.md#41-동시-신청-경쟁-테스트-실행-절차-개발용-supabase):
    ```bash
    # Git Bash. 연결 문자열은 대시보드 Connect 화면의 직접 연결(또는 세션 풀러) 값 — 셸에서만 쓰고 파일·기록에 남기지 않는다
    RACE_TEST_DATABASE_URL='postgresql://postgres:<DB 비밀번호>@<호스트>:5432/postgres' node scripts/race-test.ts --confirm-dev-db
    ```
11. `npm run build && npm run preview` → `http://localhost:4173`에서 같은 흐름을 한 번 더(운영 빌드 + 생성된 보안 헤더 적용 — CSP 위반이 콘솔에 없는지). `http://localhost:4173/auth/callback`을 개발 프로젝트 Redirect URLs에 넣어야 한다.

## 7. Cloudflare Pages 설정

1. Cloudflare 대시보드 → Workers & Pages → 만들기 → Pages → Git 저장소 연결(또는 직접 업로드). 프로덕션 브랜치는 `main`.
2. 빌드 설정:

| 항목 | 값 |
|---|---|
| 프레임워크 프리셋 | 없음(None) |
| 빌드 명령 | `npm run build` (= 타입 검사 → vite build → `dist/_headers` 생성). 더 엄격하게: `npm run build && npm run check:seed && npm run check:dist` |
| 빌드 출력 디렉터리 | `dist` |
| 루트 디렉터리 | `/`(저장소 루트) |
| Node 버전 | 저장소의 `.nvmrc`(`24.18.0`, 로컬에서 확인한 버전). 빌드 이미지가 `.nvmrc`를 읽지 않으면 환경 변수 `NODE_VERSION=24.18.0`. `package.json`의 `engines`는 `>=22.22.0` |

   - `미확인:` Pages 빌드 이미지(v3 등)가 Node 24.18.0을 설치할 수 있는지, `.nvmrc`를 읽는지. 첫 빌드 로그의 Node 버전을 확인하고, 안 되면 `NODE_VERSION`으로 지원되는 24.x를 지정한다(로컬 확인 버전과 다르면 기록).
   - `미확인:` 빌드 이미지가 `package-lock.json`을 보고 `npm ci`로 설치하는지(로그 확인). Playwright 브라우저는 설치되지 않는다(빌드에 필요 없음).
3. 환경 변수: §2 표대로 Production과 Preview를 **따로** 넣는다. 프리뷰 = 개발용 Supabase 프로젝트.
4. 정적 파일 규칙(빌드 출력 루트에 둔다):
   - `_headers`: 저장소에 없다. `npm run build`가 env에 맞춰 생성한다(CSP connect-src = Supabase origin). 정책과 이유는 [SECURITY §7](./SECURITY.md#7-보안-헤더와-csp).
   - SPA 폴백: **`_redirects`를 두지 않는다**(Phase 0의 `public/_redirects`를 Phase 5에 삭제). 근거:
     - Cloudflare Pages는 빌드 출력 최상위에 `404.html`이 **없으면** SPA로 보고, 맞는 파일이 없는 경로에 루트 `index.html`을 200으로 준다.
     - `_redirects`의 `/* /index.html 200`은 Pages가 무한 루프 규칙으로 판단해 무시하고 빌드 로그에 경고를 남긴다.
     - 그래서 `dist/404.html`이 생기지 않게 한다. `scripts/write-headers.mjs`(빌드 마지막 단계)와 `npm run check:dist`가 `404.html`이 있으면 실패한다. `check:dist`는 `_redirects`가 다시 생겨도 실패한다.
     - 결과: 없는 주소도 200 + 앱의 404 화면("페이지를 찾을 수 없어요")이 된다(HTTP 404 상태 코드는 나오지 않음 — SPA의 한계).
     - **`미확인:` 위 동작은 공식 문서 기준 설명이며 실제 배포 전까지 확인하지 않았다** → §8.
   - `robots.txt`: 전체 허용, `/admin`·`/auth/`만 Disallow(보안 수단이 아님 — 권한은 서버가 막는다).
5. 사용자 정의 도메인 연결은 도메인 확정 후(`BLOCKED:`). 연결 후 Supabase Site URL·Redirect URLs와 Google 승인된 도메인을 함께 갱신한다. HSTS `includeSubDomains`·`preload`는 그때 결정한다.

## 8. 첫 프리뷰 배포 확인

`BLOCKED:` 프리뷰 배포를 한 적 없다(사용자 승인 후 실행). 첫 프리뷰에서 아래를 확인하고 결과를 CHANGELOG에 남긴다. `<주소>`는 프리뷰 주소.

- [ ] 빌드 로그: Node 버전, `[headers] dist/_headers 작성 (connect-src에 https://<ref>.supabase.co 포함)` 줄, `_redirects` 관련 경고 없음, 실패 없음.
- [ ] SPA 딥링크 — 주소창에 직접 입력 + 새로고침(F5) 모두 앱 화면이 뜨는지:
  - [ ] `<주소>/meetings/<실제 모임 id>`
  - [ ] `<주소>/venues/<실제 공간 id>`(운영 DB에 공간이 없으면 개발 프로젝트에 하나 등록)
  - [ ] `<주소>/admin`(로그인한 관리자로 새로고침 → 관리자 도구, 비로그인 → 로그인 화면)
  - [ ] `<주소>/no-such-page` → 앱의 404 화면
- [ ] 응답 헤더:
  ```bash
  curl -sI "<주소>/" | grep -iE "content-security-policy|x-frame-options|strict-transport|permissions-policy|referrer-policy|x-content-type|cross-origin-opener"
  curl -sI "<주소>/meetings/00000000-0000-4000-8000-000000000000" | grep -i content-security-policy
  curl -sI "<주소>/assets/<빌드된 파일 이름>.js" | grep -i cache-control   # public, max-age=31536000, immutable
  ```
  CSP의 connect-src에 프리뷰용(개발) Supabase origin이 있는지.
- [ ] 브라우저 개발자 도구 콘솔에 CSP 위반("Refused to …")이 없는지 — 홈·상세·로그인 → Google 왕복·모임 만들기·관리자.
- [ ] SUIT 글꼴이 적용되는지(Network 탭에서 jsDelivr CSS·woff2가 200).
- [ ] 로그인 → Google → 프리뷰 주소의 `/auth/callback`으로 돌아오는지(Redirect URLs에 프리뷰 주소 등록 필요 — §3.3).

## 9. 배포 직후 스모크 체크리스트 (운영)

운영 배포는 사용자 승인 후에만 한다. 배포 직후 운영 주소에서 15분 안에 끝낼 수 있는 범위:

- [ ] 홈이 뜨고 "개발용 예시 데이터" 띠가 **없다**. 빈 목록이면 빈 상태 안내가 보인다.
- [ ] 로그인 왕복: Google → `/auth/callback` → (처음이면) 최초 설정 → 원래 화면. 주소창에 `code=`가 남지 않는다.
- [ ] 모임 생성 → 상세 화면.
- [ ] 다른 계정으로 신청(승인제 모임) → 모임장 계정에서 승인 → 신청자 화면에 "참가 확정".
- [ ] 신고 1건 접수 → "신고가 접수됐어요" → 관리자 계정 `/admin` 신고 탭에 보임 → 처리 상태 저장. (테스트 모임·신고는 끝나고 관리자가 숨김·취소·기각 처리하고 운영 기록에 남긴다)
- [ ] 일반 계정으로 `/admin` → "접근 권한이 없어요".
- [ ] 헤더 확인: §8의 `curl -sI` 3개(운영 주소, connect-src에 운영 Supabase origin).
- [ ] 딥링크 새로고침: `/meetings/<id>`, `/venues/<id>`, `/admin`.
- [ ] 로그아웃 후 보호 화면이 로그인을 요구한다.
- 하나라도 실패하면 §10 롤백을 검토한다.

## 10. 롤백

**앱(Cloudflare Pages)**
- Pages 프로젝트 → 배포(Deployments) 목록에서 직전 정상 운영 배포를 골라 "이 배포로 롤백"(Rollback to this deployment). 정적 파일만 바뀌므로 즉시 반영된다. `미확인:` 메뉴 이름.
- 롤백한 배포는 그 배포 당시의 환경 변수 값이 들어간 빌드다. 환경 변수만 잘못 바꾼 경우에는 값을 고친 뒤 **재배포**(재빌드)해야 반영된다.
- 원인 커밋을 되돌리거나 고친 뒤 다시 배포한다.

**DB(Supabase) — 마이그레이션은 앞으로만 진행한다**
- 되돌리는(down) 마이그레이션은 만들지 않는다. 운영 DB에서 즉석 SQL로 되돌리지 않는다.
- 원칙:
  1. 운영에 새 마이그레이션을 적용하기 **직전에** `pg_dump` 백업을 받는다([OPERATIONS §8](./OPERATIONS.md#8-백업)).
  2. 마이그레이션은 가능하면 **추가만**(새 함수·컬럼 추가, 기존 시그니처 유지) 하도록 작성해, 앱을 이전 배포로 롤백해도 DB와 맞게 한다. 함수 시그니처를 바꾸거나 지우는 마이그레이션(예: 마이그레이션 6의 `list_public_meetings` drop·재생성)은 앱 배포와 같이 적용하고, 롤백 시 앱과 DB가 맞는지 먼저 확인한다.
  3. 문제가 생기면 **수정 마이그레이션을 새로 작성**해 개발 프로젝트에서 DB 테스트(`npm run test:db`)와 수동 확인 후 운영에 적용한다(fix-forward).
  4. 데이터가 손상됐을 때만 백업에서 복원한다. 복원하면 백업 이후의 데이터(가입·모임·신청)가 사라진다 — 영향 범위를 기록하고 이용자 공지를 검토한다. 복원 절차는 개발 프로젝트에서 먼저 시험한다.
  5. 운영 DB에서 즉석 수정 SQL을 실행했다면 같은 내용을 마이그레이션 파일로 남기고 운영 기록에 적는다.
- `미확인:` Supabase 플랜별 자동 백업·시점 복구(PITR) 제공 범위([OPERATIONS §8](./OPERATIONS.md#8-백업)).

## 11. 배포 전 체크리스트

- [ ] `npm run verify` 통과(타입·린트·단위·DB(계약 포함)·빌드·seed 점검·산출물 점검) — 결과를 CHANGELOG에 기록
- [ ] `npm run test:e2e`, `npm run test:csp`, `npm run check:builds` 통과
- [ ] `dist/`에 실제 비밀 키 값이 없음 — `npm run check:dist`(role이 anon이 아닌 JWT·`sb_secret_` 키 값이 있으면 실패)
- [ ] 운영 Supabase: 마이그레이션 적용, 모든 테이블 RLS 활성, seed 미적용
- [ ] Auth Site URL·Redirect URLs(운영은 정확한 주소만), Google(·Kakao) 로그인 왕복 확인
- [ ] 관리자 1명 이상 지정, 관리자 화면 접근 확인
- [ ] 프리뷰 배포 확인(§8) 전부 통과
- [ ] 프로덕션 환경 변수가 운영 프로젝트를 가리킴(프리뷰와 섞이지 않음)
- [ ] `BLOCKED:` 운영 이메일 확정, 정책 문서 운영자·법률 검토
- [ ] 백업 절차 1회 시험([OPERATIONS §8](./OPERATIONS.md#8-백업))
- [ ] 출시 전 결정 항목([NEXT_STEPS §1](./NEXT_STEPS.md#1-사용자-결정-필요)) 처리
- [ ] 사용자 승인

## 12. 백업·장애 대응

[OPERATIONS §8 백업](./OPERATIONS.md#8-백업), [§9 장애·사고 체크리스트](./OPERATIONS.md#9-장애사고-체크리스트), [§7 모니터링](./OPERATIONS.md#7-모니터링-최소안)으로 옮겼다(Phase 5).
