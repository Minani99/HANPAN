# 보안 설계

상태: Phase 5 반영 (2026-11-25 — 관리자 권한에 계정 상태 반영(마이그레이션 9), 보안 헤더 빌드 생성·CSP 스모크 테스트, 역할×동작 매트릭스 보강(DB 테스트), 코드·산출물 감사). DB 규칙은 PGlite 테스트, 어댑터는 계약 테스트로 확인했다. 실제 Supabase·Cloudflare Pages 재확인은 `BLOCKED:`.

이 문서는 설계 의도와 점검 계획이다. 보안이 "검증 완료"되었다는 뜻이 아니다. 실제 점검 결과는 [TEST_PLAN](./TEST_PLAN.md)과 [CHANGELOG](./CHANGELOG.md)에 기록한다.
관련 문서: [DB_SCHEMA](./DB_SCHEMA.md) · [ARCHITECTURE](./ARCHITECTURE.md) · [DEPLOYMENT](./DEPLOYMENT.md) · [OPERATIONS](./OPERATIONS.md)

## 1. 전제

- 브라우저 번들과 anon(또는 publishable) 키는 공개된다. 누구나 PostgREST·RPC를 직접 호출할 수 있다고 가정한다.
- 따라서 **보호 경계는 Postgres(RLS, 권한, RPC 내부 검사, 제약조건)뿐**이다. 클라이언트 검사·버튼 비활성화는 사용성 목적이다.
- 별도 서버가 없다. service role 키를 쓰는 코드는 저장소에 없다.

## 2. 위협 모델 요약

| 자산 / 위협 | 공격 예 | 대응 | 상태 |
|---|---|---|---|
| 모임 데이터 변조 | 다른 사람 모임을 PostgREST로 직접 update/delete | 테이블 DML 권한 revoke, 쓰기는 RPC만, RPC가 `auth.uid()`로 모임장 확인 | PGlite DB 테스트 통과(`permissions.test.ts`). 실환경 `BLOCKED:` |
| 정원 초과·중복 신청 | 동시 요청, 재전송, 직접 insert | 모임 행 `for update` 잠금, `unique (meeting_id, user_id)`, `confirmed_count <= max` check | 순차·제약은 DB 테스트 통과. 진짜 동시성은 실DB 필요(`BLOCKED:` `scripts/race-test.ts`) |
| 관리자 권한 탈취 | 클라이언트에서 role 값 조작, admin_roles insert | admin_roles에 anon/authenticated 권한·정책 없음, `is_admin()`(admin_roles 행 + active 계정)만 사용, 부여는 SQL Editor | DB 테스트 통과(JWT claim·`is_admin` 키로 불가) |
| 개인정보 노출 | 참가자 목록·이메일·계정 상태·신고 내용 조회 | profiles는 공개 컬럼만 grant(`status` 제외 — 본인은 `get_my_profile`), 참가자 행은 본인·모임장·관리자만, 이메일은 auth.users에만, reports는 신고자·관리자만(`admin_note`·`handled_by` 제외) | DB 테스트 통과 |
| XSS | 모임 소개에 스크립트·악성 링크 | React 기본 이스케이프, `dangerouslySetInnerHTML` 금지, 사용자 텍스트 자동 링크 없음, CSP(`script-src 'self'`, unsafe-inline·unsafe-eval 없음) | 소스 감사 단위 테스트(§14), 빌드 결과 CSP 스모크 위반 0건(§7). 실제 Pages 헤더는 `미확인` |
| 세션 탈취 | XSS로 localStorage 토큰 탈취 | XSS 방지 + CSP. supabase-js 기본 저장소가 localStorage임을 위험으로 기록 | 잔여 위험 |
| Open redirect | `returnTo=//evil.example` | 내부 경로 검증(`src/lib/returnTo.ts`), OAuth `redirectTo`는 `{현재 origin}/auth/callback` 고정, Supabase Redirect URL 허용 목록 | 단위 테스트 통과. Redirect URL 설정은 `BLOCKED:` |
| 스팸·남용 | 모임·신고 대량 생성 | RPC 레이트 리밋(§10), 목록 페이지 크기 제한(1~50) | DB 테스트 통과 |
| 개발 데이터 유출 | 예시 데이터가 운영에 노출 | mock 동적 import, `check:seed`(`scripts/seed-needles.json`의 마커 검색), seed.sql 운영 적용 금지, `db:bundle`은 seed 제외 | `npm run verify`에 포함, Supabase env를 넣은 빌드에서도 통과 확인 |
| 비밀키 유출 | service role 키를 `VITE_` 변수나 Git에 넣음 | §4 규칙, `.gitignore`, 키 가드(빌드 중단 + 런타임 거부) | 키 가드 단위 테스트 통과. Git·운영 규칙은 사람이 지킴 |
| 클릭재킹 | iframe에 서비스 삽입 | `frame-ancestors 'none'`, `X-Frame-Options: DENY` | 빌드 때 `_headers` 생성(§7), 미리보기 응답 헤더 확인(CSP 스모크). 실제 Pages는 `미확인` |
| 관리자 화면 우회 | `/admin` 직접 접근, SessionUser.isAdmin을 개발자 도구로 바꿈, 관리자 RPC·테이블 직접 호출 | 화면 확인은 사용성용. 모든 관리자 조회 RPC(`admin_*`)는 `is_admin()` 아니면 `NOT_ADMIN`, 공간·카테고리 쓰기는 RLS `is_admin()`(insert 42501, update 0행). 관리자 메뉴는 헤더·내비에 노출하지 않음 | DB 테스트·계약 테스트 통과(`venues-admin.test.ts`, 계약 '관리자'). E2E로 일반 계정 권한 없음 화면 확인 |
| 관리자 쓰기 추적 누락 | 공간·카테고리를 테이블 직접 DML로 바꿔 기록이 남지 않음 | after 트리거 `_audit_admin_table_change`(security definer)가 actor·바뀐 필드 이름을 audit_logs에 기록(SQL Editor 수정도 actor null로 기록). `created_by`는 before 트리거가 요청자로 고정 | DB 테스트 통과 |
| 외부 링크 악용 | 공간 링크에 `javascript:`·피싱 주소, 새 창의 `window.opener` 악용 | DB check `^https://`, 관리자 폼 Zod(https만), 응답 검증에서 https 아닌 링크 버림, 렌더 직전 `safeExternalUrl`(https·호스트 필수·user:pass 거부·500자), `target="_blank" rel="noopener noreferrer"` | 단위·컴포넌트·E2E 통과 |
| 정책 문서 렌더 XSS | 마크다운에 HTML·스크립트 삽입 | 자체 부분집합 파서 — HTML 해석 없음, React 요소만(`dangerouslySetInnerHTML` 없음), 내부 경로만 링크 | 컴포넌트 테스트(스크립트 태그가 요소가 되지 않음) |

## 3. 역할별 권한 매트릭스

상세 GRANT·RLS는 [DB_SCHEMA §7~8](./DB_SCHEMA.md#7-권한-grant). 아래 표의 각 칸은 PGlite DB 테스트(`npm run test:db`, [TEST_PLAN §5](./TEST_PLAN.md#5-db-테스트-목록-pglite))로 확인했다(2026-11-25 Phase 4 기준 DB 테스트 216개 통과 — 어댑터 계약 테스트 26개 포함). 실제 Supabase에서의 재확인은 `BLOCKED:`.

| 동작 / 데이터 | 방문자(anon) | 로그인 사용자 | 모임장(본인 모임) | 관리자 | DB 구현 |
|---|---|---|---|---|---|
| 모임 목록·상세(숨김 제외) | O | O | O | O | `list_public_meetings`·`get_meeting`(security invoker), meetings select |
| 숨김 모임 조회 | X | X | O(상세만) | O(상세만) | meetings RLS. 공개 목록에는 아무에게도 안 나옴 |
| 참가자 목록(닉네임·신청 메시지) | X | 본인 행만 | O | O | `list_meeting_participants`(아니면 `NOT_HOST`), meeting_participants RLS |
| 공개 프로필(닉네임·권역·소개·관심 장르·가입일) | O | O | O | O | profiles 컬럼 단위 grant |
| 계정 상태(`profiles.status`) | X | 본인만(`get_my_profile`) | - | O(`admin_search_users`) | status 컬럼 grant 없음 |
| `user_private`(약관 동의·탈퇴 요청 시각) | X | 본인만 | - | X(정책 없음) | RLS `user_id = auth.uid()` |
| 이메일 | X | 본인 세션 정보만 | X | X(Supabase 대시보드에서만) | public 스키마에 저장 안 함 |
| 모임 생성 | X | O(active·온보딩 완료, 레이트 리밋) | - | O(같은 규칙) | `create_meeting` |
| 모임 수정·모집 마감 | X | X(`NOT_HOST`) | O(시작 전, restricted 불가) | X | `update_meeting`, `set_meeting_recruiting` |
| 모임 취소 | X | X(`NOT_HOST`) | O(시작 전, restricted도 허용) | O(종료 전) | `cancel_meeting` |
| 참가 신청 | X | O(active·온보딩 완료) | 본인 모임 불가(`OWN_MEETING`) | O(일반 사용자로서) | `apply_to_meeting` |
| 본인 신청 취소 | X | O(시작 전, restricted도 허용) | 본인 모임 불가 | O | `cancel_my_application` |
| 승인·거절·출석 체크 | X | X(`NOT_HOST`) | O(restricted 불가) | X | `decide_participant`, `mark_attendance` |
| 신고 접수 | X | O(온보딩 완료, restricted도 허용) | O | O | `submit_report` |
| 신고 조회 | X | 본인 신고(`admin_note`·`handled_by` 제외) | - | 전체(`admin_list_reports`) | reports 컬럼 grant + RLS |
| 신고 처리, 모임 숨김, 계정 제한 | X | X(`NOT_ADMIN`) | X | O | `admin_*` |
| 공간 공개 조회 | 공개만 | 공개만 | 공개만 | 공개만(공개 화면) | `list_public_venues`·`get_venue`(invoker + `is_public` 명시) |
| 관리자 목록(모임 전체·신고 화면용·공간 비공개 포함·카테고리 비활성 포함) | X(42501) | X(`NOT_ADMIN`) | X | O | `admin_list_meetings`·`admin_list_report_items`·`admin_list_venues`·`admin_list_categories` |
| 공간·카테고리·게임 쓰기 | X | X(RLS 거부: insert 42501, update·delete 0행) | X | O(직접 DML, RLS, 감사 트리거) | `is_admin()` 정책 + `venues_before_write`·`*_audit` 트리거 |
| 권역(regions) 쓰기 | X | X | X | X(마이그레이션·SQL Editor만) | grant 없음 |
| 감사 로그 조회 | X | X(0행) | X | O | audit_logs RLS |
| 관리자 지정·해제 | X | X | X | X(SQL Editor만) | admin_roles grant·정책 없음 |
| 테이블 직접 insert/update/delete(모임·참가·프로필·신고) | X | X | X | X(RPC만) | grant 없음 → 42501 |

- 방문자의 로그인 필요 RPC 호출은 EXECUTE 권한이 없어 42501로 실패한다(`AUTH_REQUIRED`가 아님). 로그인 역할인데 JWT sub가 없으면 `AUTH_REQUIRED`.
- 관리자 여부는 `admin_roles` 행 **그리고 계정 상태 active**로만 판단한다(`is_admin()`, 마이그레이션 9). JWT claim(`app_metadata` 등)이나 `update_my_profile`의 `is_admin` 같은 키로는 관리자가 될 수 없다(테스트로 확인).
- 탈퇴 요청(`deletion_requested`) 계정은 모든 쓰기 RPC가 `ACCOUNT_DELETION_REQUESTED`로 거부한다. 관리자 RPC는 `is_admin()`이 false가 되어 `NOT_ADMIN`으로 거부한다(마이그레이션 9).
- 프론트 어댑터는 세션이 없으면 로그인 필요 RPC를 아예 부르지 않는다(보호 경계가 아니라 불필요한 42501을 피하려는 것). 어댑터가 실제 SQL 함수와 같은 오류 코드를 받는지는 계약 테스트(`supabase/tests/adapter-contract.test.ts`)로 확인했다.

### 3.1 역할 × 동작 매트릭스와 근거 테스트 (Phase 5)

PGlite DB 테스트(`supabase/tests/`) 기준. O = 허용, X = 거부(괄호는 오류 코드). 근거는 `파일 › 테스트 이름(앞부분)`. 2026-11-25 실행: DB 테스트 **13개 파일 232개 통과**(Phase 5 검수 반영 후).
"일반 사용자"는 active·최초 설정 완료, "모임장"은 본인 모임 기준. 이용 제한·탈퇴 요청 행의 빈 칸은 Phase 5에 `account-status.test.ts`를 추가해 채웠다.

| 역할 \ 동작 | 조회(목록·상세) | 모임 생성 | 모임 수정·모집 마감 | 모임 취소 | 신청 | 본인 신청 취소 | 승인·거절 | 출석 체크 | 신고 | 관리자 기능 |
|---|---|---|---|---|---|---|---|---|---|---|
| 비로그인(anon) | O — `public-read › anon 목록·상세` | X(42501) — `permissions › 비로그인(anon)`(쓰기·로그인 RPC EXECUTE 거부) | X(42501) — 같음 | X(42501) — 같음 | X(42501) — 같음 | X(42501) — 같음 | X(42501) — 같음 | X(42501) — 같음 | X(42501) — 같음 | X(42501) — 같음, `venues-admin › 관리자 조회 RPC … anon 42501` |
| 일반 사용자 | O — `public-read`(숨김 모임은 X) | O — `meetings › 모임과 모임장 참가 행을 만들고` | 남의 모임 X(`NOT_HOST`) — `permissions › update/cancel/set_recruiting/decide/…` | 남의 모임 X(`NOT_HOST`) — 같음 | O — `participation › auto + 자리 있음 → confirmed` | O — `participation › 확정 취소 시 카운트 감소` | X(`NOT_HOST`) — `permissions › update/cancel/…`, `게스트(참가자)도 모임장 권한 RPC를 쓸 수 없다` | X(`NOT_HOST`) — 같음, `participation › 종료 7일 이후 … 모임장 아님 NOT_HOST` | O — `reports-admin › 모임·사용자 신고 접수` | X(`NOT_ADMIN`) — `permissions › 일반 계정은 admin_* RPC에서 NOT_ADMIN`, 공간·카테고리 쓰기 RLS |
| 모임장(본인 모임) | O(숨김 처리된 본인 모임 상세 포함) — `public-read › 숨김 모임 노출 범위` | O | O(시작 전) — `meetings › 모임장은 전체 필드를 갱신`, `open ↔ closed 전환` | O(시작 전) — `meetings › 게스트 pending/confirmed/waitlisted → meeting_cancelled` | 본인 모임 X(`OWN_MEETING`) — `participation › 자기 모임 OWN_MEETING` | 본인 모임 X(`OWN_MEETING`) — `participation › 신청 없음 NOT_APPLIED, 모임장 OWN_MEETING` | O — `participation › 거절 → rejected`, `pending은 자리를 차지하지 않는다` | O(시작 후~종료 7일) — `participation › 진행 중·종료 7일 이내 허용` | 본인·본인 모임 X(`CANNOT_REPORT_SELF`) — `reports-admin › 자기 자신·자기 모임 신고` | X(`NOT_ADMIN`) |
| 관리자(active) | O(숨김 모임 상세 포함) — `public-read › 숨김 모임 노출 범위` | O(일반 규칙) — `account-status › 관리자 행` | 남의 모임 X(`NOT_HOST`) — `account-status › 관리자 행` | O(종료 전) — `meetings › 관리자는 종료 전까지 가능`, `account-status › 관리자 행` | O(일반 규칙) — `account-status › 관리자 행` | O(일반 규칙) | X(`NOT_HOST`) — `account-status › 관리자 행` | X(`NOT_HOST`) — `account-status › 관리자 행` | O — `account-status › 관리자 행` | O — `reports-admin › 관리자 RPC`, `venues-admin`, `permissions › 공간·카테고리·게임 … 관리자는 쓸 수 있다` |
| 이용 제한(restricted) | O — `account-status › 조회는 계정 상태와 무관` | X(`ACCOUNT_RESTRICTED`) — `meetings › 계정 상태` | X(`ACCOUNT_RESTRICTED`) — `meetings › 이용 제한된 모임장은 수정·모집 마감 불가` | O(시작 전) — `meetings › 이용 제한된 모임장도 취소는 할 수 있다`, `account-status › 모임장: 출석 체크` | X(`ACCOUNT_RESTRICTED`) — `participation › 이용 제한 ACCOUNT_RESTRICTED`, `reports-admin › admin_set_user_status` | O — `participation › 이용 제한 계정도 본인 신청은 취소` | X(`ACCOUNT_RESTRICTED`) — `participation › 이용 제한된 모임장은 승인 불가` | X(`ACCOUNT_RESTRICTED`) — `account-status › 모임장: 출석 체크` | O — `reports-admin › 이용 제한 계정도 신고 가능` | X(`NOT_ADMIN`) — `account-status › 이용 제한 › 관리자 기능`. **관리자 역할이 있어도 X** — `account-status › 관리자 계정의 상태` |
| 탈퇴 요청(deletion_requested) | O — `account-status › 조회는 계정 상태와 무관` | X(`ACCOUNT_DELETION_REQUESTED`) — `meetings › 계정 상태`, `profile-account › 멱등이며 이후 쓰기 RPC` | X(같은 코드) — `account-status › 탈퇴 요청 후: … 모임장 RPC 5종` | X(같은 코드) — 같음(시작 전 주최 모임은 탈퇴 요청 때 자동 취소) | X(같은 코드) — `profile-account › 멱등이며 이후 쓰기 RPC` | X(같은 코드) — 같음 | X(같은 코드) — `account-status › 탈퇴 요청 후` | X(같은 코드) — 같음 | X(같은 코드) — `reports-admin › … 탈퇴 요청은 불가` | X(`NOT_ADMIN`) — `account-status › 탈퇴 요청 › 관리자 기능`. **관리자 역할이 있어도 X** — `account-status › 관리자 계정의 상태` |

- 이용 제한 계정은 탈퇴 요청을 할 수 있다(`account-status › 탈퇴 요청은 할 수 있다`). 프로필 수정은 이용 제한·탈퇴 요청 모두 불가(`profile-account › 이용 제한 계정은 프로필을 바꿀 수 없다`, `멱등이며 …`).
- 프론트 어댑터 경로(실제 어댑터 → SQL)는 계약 테스트(`adapter-contract.test.ts`)가 비로그인·일반·관리자·탈퇴 요청을 다시 확인한다. 이용 제한·탈퇴 요청 상태 관리자는 Supabase 어댑터와 mock이 같은 결과(관리자 메서드 `NOT_ADMIN`, 세션 `isAdmin` false, 숨김 모임 null)인지 단언한다.
- **관리자 계정의 상태(Phase 5 검수에서 결정·반영)**: Phase 5 점검에서 관리자 RPC·관리자 테이블 쓰기가 `admin_roles` 행만 보고 계정 상태를 보지 않는 것을 발견했다(이용 제한·탈퇴 요청 상태 관리자도 관리자 기능 사용 가능). 새 마이그레이션 `20261124000900_admin_requires_active.sql`이 `is_admin()`을 "admin_roles 행 + `profiles.status = 'active'`"로 바꿨다(기존 파일은 그대로, `create or replace` — 정책은 함수를 OID로 참조하므로 다시 만들 필요 없음). 이 함수를 쓰는 모든 곳이 따라 바뀐다: 관리자 RPC → `NOT_ADMIN`, venues·categories·games 쓰기 RLS 거부, 숨김 모임·비공개 공간·남의 신고·감사 로그 조회 불가, 관리자 취소 불가, `get_my_profile().isAdmin` false. active로 되돌리면 `admin_roles` 행이 그대로라 바로 복구된다. mock도 같은 규칙(`hasAdminPower`). 관리자는 자기 계정을 이용 제한할 수 없으므로(`admin_set_user_status`가 본인 대상 거부 — `VALIDATION_FAILED`/`user_id`) 실수로 자기 권한을 잃지 않는다. 테스트: `account-status › 관리자 계정의 상태`(DB), `adapter-contract › … 상태인 관리자`(Supabase 어댑터 = mock), `src/data/mock/phase4.test.ts`, E2E(`e2e/a11y.spec.ts` — 이용 제한된 관리자 `/admin` 권한 없음).

## 4. 비밀키 관리

| 값 | 위치 | 금지 |
|---|---|---|
| Supabase URL, anon/publishable 키 | `.env.local`(로컬), Cloudflare 환경 변수 | - (공개 값이지만 저장소에는 `.env.example`의 빈 값만) |
| service role / secret 키 | Supabase 대시보드에만. 필요 시 운영자 로컬에서 일회성 사용 | `VITE_` 변수, 저장소, 이슈·채팅, 브라우저 |
| DB 비밀번호·연결 문자열 | 운영자 비밀번호 관리자 | 저장소, 스크립트 기본값 |
| Google/Kakao client secret | Supabase Auth provider 설정 화면에만 | 저장소, 프론트엔드 |

- `.gitignore`가 `.env`, `.env.*`(`.env.example` 제외), `*.local`을 제외한다. 커밋 전 `service_role`, `sb_secret_`, `eyJ`(JWT 접두) 문자열을 검색한다(키 가드 코드 `src/data/supabase/keyGuard.ts`와 테스트에는 이 문자열이 일부러 들어 있다 — 실제 키 값인지 확인).
- 키 가드(`src/data/supabase/keyGuard.ts`): 브라우저에 노출되는 `VITE_` 변수 이름에 `SERVICE_ROLE`이 있거나, `VITE_SUPABASE_ANON_KEY`가 JWT `role=service_role` 또는 `sb_secret_` 키로 보이면
  - `npm run build`: 빌드를 멈춘다(`vite.config.ts`). 개발 서버는 경고만 한다.
  - 앱: 개발 콘솔에 경고하고 Supabase 클라이언트를 만들지 않는다(`unconfigured`, 빈 상태).
  - 메시지에는 변수 이름·사유만 있고 키 값은 없다. JWT 서명은 검증하지 않는다(payload만 읽음) — 가드는 실수 방지용이며 키가 이미 노출됐다면 재발급해야 한다.
  - `vite.config.ts`는 `VITE_` 변수 **이름**만 번들에 넣는다(`__HANPAN_PUBLIC_ENV_NAMES__`). `import.meta.env` 전체를 참조하면 쓰지 않는 `VITE_` 값까지 번들에 들어가므로 그렇게 하지 않는다.
- `미확인:` 새 Supabase 프로젝트에서 발급되는 키 형식(기존 anon/service_role JWT 또는 publishable/secret 키). 어느 쪽이든 브라우저에는 공개용 키만 둔다.
- Supabase·Cloudflare·Google Cloud·Kakao Developers 운영자 계정에 2단계 인증을 켤 것을 권장한다.

## 5. 입력 검증

- 클라이언트: Zod 스키마(`src/domain`)로 형식·길이·범위를 검사해 즉시 안내한다. 한도 상수는 한 파일에 모은다.
- 서버: 모든 RPC가 같은 규칙을 다시 검사한다([DB_SCHEMA §9](./DB_SCHEMA.md#9-함수rpc-명세)). 정의되지 않은 jsonb 키는 무시한다. 동적 SQL(`execute format(...)`)에 사용자 입력을 넣지 않는다.
- DB 제약조건(check, unique, FK)이 마지막 방어선이다.
- 클라이언트와 서버 규칙 불일치를 막기 위해 경계값(제목 1/2/60/61자, 정원 1/2/30/31명, 시작 30분 전후 등)을 DB 테스트와 단위 테스트에서 같은 값으로 검사한다.
- 검색어 `q`: 프론트 `normalizeQuery`가 공백을 정리하고 50자로 자른다. RPC 인자(`p_q`)로 넘기며 DB도 50자로 자르고 `\`·`%`·`_`를 이스케이프한 뒤 `ilike ... escape '\'`(PostgREST 필터 문법을 쓰지 않음).
- 라우트 파라미터(`:id`)가 uuid 형식이 아니면 Supabase 어댑터는 요청하지 않는다(조회는 "모임을 찾을 수 없어요", 쓰기는 `NOT_FOUND`).
- 서버 응답도 검증한다: 어댑터가 Zod로 응답 모양을 확인하고 어긋나면 `UNKNOWN`으로 실패한다(`imageUrl`은 `https://`만 허용).

## 6. XSS와 외부 링크

- 사용자 입력은 React 텍스트 노드로만 렌더링한다. `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function` 금지(린트 규칙 추가 권장).
- 모임 소개·유의사항의 URL을 자동으로 링크로 만들지 않는다.
- 외부 링크(공간 홈페이지·예약 링크) 정책(Phase 4 구현):
  1. 저장: DB check `^https://`·500자. 관리자 폼(Zod)도 https만 받는다.
  2. 응답 검증(`src/data/supabase/mapping.ts`): https가 아닌 값이 오면 링크만 버린다(null) — 화면 전체를 실패시키지 않는다.
  3. 렌더(`src/components/ui/ExternalLink.tsx` → `src/lib/externalUrl.ts`): `new URL()`로 다시 확인해 https·호스트 있음·사용자 정보(user:pass@) 없음일 때만 `<a>`를 만든다. 아니면 아무것도 렌더하지 않는다(`javascript:`·`data:`·`http:`·`//` 모두 차단).
  4. `target="_blank" rel="noopener noreferrer"`, 문구에 "(외부)" + 외부 아이콘 + 스크린리더 "(새 창에서 열림)".
  5. 예약 링크는 공간에 `bookingUrl`이 있을 때만 보여준다(확인된 공식 링크만 등록 — OPERATIONS §4).
- 정책 문서(`/policies/:slug`)는 `src/lib/markdown.ts`의 작은 부분집합 파서로 React 요소만 만든다. HTML은 해석하지 않고 글자로 남기며, 링크는 `/`로 시작하는 내부 경로만 만든다.

## 7. 보안 헤더와 CSP

Phase 5에서 확정(2026-11-25). `_headers`는 저장소에 두지 않고 **빌드할 때 생성**한다 — CSP의 Supabase 주소가 환경(운영·프리뷰)마다 다르기 때문이다.

- 생성: `npm run build` = `tsc -b && vite build && node scripts/write-headers.mjs` → `dist/_headers`. 순수 함수는 `scripts/lib/security-headers.mjs`(단위 테스트 `scripts/security-headers.test.ts`).
- env는 Vite와 같은 방식(`loadEnv`: 실행 환경 > `.env.[mode].local` > `.env.local` …)으로 읽으므로 번들에 들어간 값과 같다.
- `VITE_SUPABASE_URL` 처리: 앞뒤 공백만 정리하고, **가운데에 줄바꿈·공백·세미콜론·쉼표·따옴표·역슬래시·제어 문자가 있으면 거부**(URL 파서가 탭·줄바꿈을 조용히 지우기 전에 막는다). `https://호스트[:포트]`(끝의 `/` 하나 허용)만 받고, 경로·쿼리·해시·사용자 정보가 있거나 http면 **빌드 실패**(exit 1, 입력값은 출력하지 않음). 헤더에는 다시 조립한 origin만 들어간다. 값이 없으면 connect-src는 `'self'`만이고 콘솔에 알린다(앱은 `unconfigured`).
- 헤더 값에 줄바꿈이 있거나 한 줄이 2,000자(Pages 한도)를 넘으면 파일을 만들지 않는다.
- 빌드 결과에 최상위 `404.html`이 있으면 같은 스크립트가 빌드를 실패시킨다(Pages SPA 폴백 조건 — [DEPLOYMENT §7](./DEPLOYMENT.md#7-cloudflare-pages-설정)).
- 점검: `npm run check:dist`(verify에 포함)가 `_headers`가 현재 env로 만든 값과 같은지, 보안 헤더가 다 있는지, `index.html`에 인라인 script·style·이벤트 속성이 없는지, 비밀 키 값이 없는지 확인한다.

생성 결과(Supabase 설정이 있을 때 — 없으면 connect-src가 `'self'`만):

```
/*
  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' https://cdn.jsdelivr.net/gh/sun-typeface/; font-src https://cdn.jsdelivr.net/gh/sun-typeface/; img-src 'self'; connect-src 'self' https://<project-ref>.supabase.co; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  X-Frame-Options: DENY
  Cross-Origin-Opener-Policy: same-origin
  Strict-Transport-Security: max-age=31536000
/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

| 항목 | 값 | 이유 |
|---|---|---|
| `default-src` | `'none'` | 기준 초안의 `'self'`보다 좁힘. 아래에 적지 않은 종류(frame·worker·media·manifest 등)는 앱이 쓰지 않는다 |
| `script-src` | `'self'` | 번들 JS만. `index.html`·빌드 결과에 인라인 스크립트 없음(`check:dist`가 확인). eval 없음 — Zod JIT는 꺼 둠(아래) |
| `style-src` | `'self'` + SUIT 경로 | 번들 CSS + SUIT 글꼴 CSS. 호스트 전체가 아니라 `/gh/sun-typeface/` 경로만(버전 표기가 바뀌어도 맞게 저장소 경로까지). 인라인 `<style>`·style 속성 없음 |
| `font-src` | SUIT 경로만 | 글꼴 파일은 jsDelivr의 SUIT 경로에서만. 자체 호스팅으로 바꾸면 `'self'`로 바꾼다([NEXT_STEPS](./NEXT_STEPS.md) 글꼴 결정) |
| `img-src` | `'self'` | 기준 초안의 `data:`를 뺐다 — 빌드 결과에 data: 이미지 사용처가 없다(supabase-js의 MFA QR 코드 경로만 있고 앱은 쓰지 않음). 모임 사진(`imageUrl`)은 DB가 항상 null. 사진 저장소를 도입하면 그 origin을 추가한다 |
| `connect-src` | `'self'` (+ Supabase origin) | Supabase REST·Auth만(https). Realtime(`wss:`)·Storage는 쓰지 않는다. `'self'`는 modulepreload 폴리필(구형 브라우저의 fetch)용 |
| `frame-ancestors` / `X-Frame-Options` | `'none'` / `DENY` | 클릭재킹 방지. XFO는 frame-ancestors를 모르는 오래된 브라우저용 |
| `base-uri` / `form-action` / `object-src` | `'self'` / `'self'` / `'none'` | `<base>` 주입·외부 폼 전송·플러그인 금지(앱 폼은 JS로 처리) |
| `X-Content-Type-Options` | `nosniff` | MIME 추측 금지 |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | 다른 사이트에는 origin만. 외부 링크는 `noreferrer`도 붙인다 |
| `Permissions-Policy` | 카메라·마이크·위치·결제·USB 끔 | 쓰지 않는 권한. 공유(Web Share)·클립보드 쓰기는 기본값 유지 |
| `Cross-Origin-Opener-Policy` | `same-origin` | 다른 출처 창과 `window` 참조를 끊는다. OAuth는 팝업이 아니라 **전체 페이지 이동**이라 충돌 없음(CSP 스모크에서 Google 버튼 → 가짜 공급자 주소로 이동 확인) |
| `Strict-Transport-Security` | `max-age=31536000` | HTTPS만. `includeSubDomains`·`preload`는 운영 도메인이 정해진 뒤 결정(되돌리기 어렵다) |
| `/assets/*` `Cache-Control` | 1년 `immutable` | Vite가 내용 해시를 붙인 파일만 있는 폴더. `index.html`은 Pages 기본 캐시(재검증)를 따른다 |

인라인 코드 점검과 결정(2026-11-25):
- `index.html`·빌드 결과: 인라인 `<script>`·`<style>`·style 속성·`on*` 속성 없음(모듈 스크립트·CSS는 모두 파일). → `'unsafe-inline'`·해시 불필요.
- React `style` prop(아이콘 크기 `Icon`, `Spinner`, 하단 바 높이 `--bottom-nav-offset`, 대화상자 스크롤 잠금)은 CSSOM(`element.style`)으로 들어가 style-src의 대상이 아니다. CSP 스모크의 대조군이 실제로 확인한다: 아이콘의 `style.width`가 적용되고 위반 0건, 반대로 `setAttribute('style', …)`과 인라인 `<script>`는 막히고 위반으로 감지됨.
- **Zod 4 JIT**: 객체 스키마를 만들 때 `new Function("")`으로 eval 가능 여부를 시험한다. 예외는 Zod가 삼키지만 브라우저는 CSP 위반(script-src, blocked `eval`)으로 기록한다 — CSP 스모크가 실제로 검출했다(`schemas-*.js`). `src/lib/zodConfig.ts`가 `config({ jitless: true })`를 main.tsx의 **첫 import**로 실행해 시험 자체를 하지 않게 했다(검사 결과는 같고 속도만 조금 느림. 단위 테스트 `src/lib/zodConfig.test.ts`가 첫 import 위치를 고정). `'unsafe-eval'`은 넣지 않는다.
- react-router `ScrollRestoration`의 인라인 스크립트는 SSR(프레임워크 모드)에서만 렌더되고 SPA 모드에서는 `null`이다.

CSP 스모크 테스트 — `npm run test:csp`(`playwright.csp.config.ts`, `e2e/csp.spec.ts`, 5개):
- `scripts/csp-preview.mjs`가 빌드 2종을 임시 폴더(`node_modules/.tmp/hanpan-csp/`, 끝나면 삭제)에 만들고 `vite preview`로 띄운다. `vite.config.ts`의 미리보기 플러그인이 생성된 `_headers`를 Cloudflare Pages처럼 응답에 붙인다(`npm run preview`도 같음). 개발 서버는 HMR 인라인 스크립트가 있어 쓰지 않는다.
  - mock 빌드(`--mode e2e`): 홈·탐색(필터·검색)·지역 선택·상세·신청 대화상자(신청까지)·모임 만들기(검증 오류 → 생성)·내 모임·참가자 관리·프로필 저장·공간 목록/상세·관리자 탭 5개(마우스·화살표)·공간 등록 폼·정책 3개·로그인·404.
  - 운영 빌드 + 가짜 env(`https://example-ref.supabase.co`, 가짜 anon JWT): 헤더의 connect-src에 그 origin, `list_public_meetings` 요청이 막히지 않음(테스트가 가로채 응답 — 외부로 나가지 않음), 공간·상세·정책·로그인, Google 버튼 → 전체 페이지 이동.
- 위반 감지: `securitypolicyviolation` 이벤트(문서마다 init script) + 콘솔 "Refused to …". 대조군이 감지 장치를 먼저 확인한다. SUIT 글꼴 CSS·woff2가 경로를 좁힌 정책 안에서 200으로 받아지는 것도 확인(글꼴 CDN에 접속할 수 없으면 그 확인만 건너뛰고 표시).
- 결과(2026-11-25): **5개 통과, 위반 0건**. Zod jitless를 끈 상태로 돌리면 5개 중 3개가 위반으로 실패하는 것을 확인했다(검출력 확인).
- 남은 확인: 실제 Cloudflare Pages가 `_headers`를 그대로 붙이는지, 실제 Supabase·OAuth 공급자 화면에서의 동작 — 첫 프리뷰 배포 때([DEPLOYMENT §8](./DEPLOYMENT.md#8-첫-프리뷰-배포-확인)).

## 8. 인증·세션·리디렉션

- Supabase Auth, OAuth PKCE. 콜백 경로는 `/auth/callback` 하나로 고정한다.
- Supabase Redirect URLs 허용 목록에는 운영 도메인과 로컬 주소만 정확히 등록한다. 프리뷰 도메인 와일드카드는 개발용 프로젝트에서만 쓴다.
- `redirectTo`는 `window.location.origin + '/auth/callback'`이다(`VITE_SITE_URL` 미사용). 허용 목록에 없는 origin이면 Supabase가 Site URL로 돌려보낸다(`미확인:` 실제 동작은 콘솔 설정 후 확인).
- PKCE: `detectSessionInUrl: false`로 자동 감지를 끄고 콜백 화면에서 `exchangeCodeForSession(code)`를 한 번만 호출한다. 처리 전에 `code`·`error`·토큰류 파라미터를 `history.replaceState`로 주소와 방문 기록에서 지운다. 공급자 오류 설명(`error_description`)은 화면·로그에 그대로 쓰지 않는다.
- 세션은 supabase-js 기본 저장소(localStorage)에 있다(§2 세션 탈취 잔여 위험).
- `returnTo`: `sessionStorage`에만 저장. `/`로 시작하고 `//`로 시작하지 않으며, 백슬래시·제어문자가 없고, `/login`·`/auth/callback`이 아닌 경우만 허용. 그 외는 `/`. 사용 즉시 삭제.
- 로그아웃·사용자 전환 시 사용자 context를 바꾸고, 화면 조회 훅은 사용자 키가 바뀌면 이전 사용자의 응답을 즉시 버리고 다시 불러온다(`useAsyncData`, 테스트로 고정). 다른 탭의 로그아웃 이벤트도 처리한다. 오프라인이라 전역 로그아웃이 실패하면 이 기기 세션만이라도 지운다.
- 가입 트리거는 OAuth 메타데이터를 profiles로 복사하지 않는다. 단, `auth.users.raw_user_meta_data`에는 공급자가 준 이름·사진 URL 등이 Supabase에 의해 저장될 수 있다 → [PRIVACY_DRAFT](./policies/PRIVACY_DRAFT.md)에 고지.
- 개발용 테스트 계정 선택은 mock 어댑터 안에만 있고 프로덕션 번들에 포함되지 않는다(`check:seed`로 확인).

## 9. 관리자 권한 부여

1. 대상자가 서비스에 한 번 로그인해 `auth.users`에 계정이 생긴다.
2. 운영자가 Supabase 대시보드 SQL Editor에서 사용자 id를 확인하고 `admin_roles`에 insert 한다(SQL은 [DEPLOYMENT §3.4](./DEPLOYMENT.md#34-최초-관리자-지정)).
3. 같은 세션에서 `audit_logs`에 수동 기록을 남긴다(누가, 언제, 왜).
4. 해제는 `delete from admin_roles where user_id = ...`.
5. 관리자 계정을 이용 제한하거나 관리자가 탈퇴를 요청하면 그 즉시 관리자 권한이 멈춘다(`is_admin()`이 active만 인정 — 마이그레이션 9). 영구히 빼려면 위 4번으로 `admin_roles`에서 지운다. 관리자는 자기 계정을 이용 제한할 수 없다.

- 앱에는 관리자를 지정하는 화면·RPC가 없다. 클라이언트 입력으로 관리자가 될 수 있는 경로를 만들지 않는다.
- `/admin` 화면(Phase 4)의 관리자 확인(`SessionUser.isAdmin`)과 프로필의 "관리자 도구" 링크 노출은 **사용성용**이다. 권한의 경계는 서버다: 관리자 조회 RPC는 `is_admin()`(admin_roles 행 + active 계정)으로 `NOT_ADMIN`, 숨김·계정 제한·신고 처리 RPC도 같고, 공간·카테고리 쓰기는 RLS가 막는다. 코드 주석(`src/pages/AdminPage.tsx`, `src/components/admin/adminShared.tsx`)에도 같은 원칙을 적었다.
- 관리자 쓰기는 모두 audit_logs에 남는다: RPC(`admin.report_update`·`admin.meeting_hidden`·`admin.user_status`·`meeting.cancel`(by_admin)) + 테이블 직접 쓰기 트리거(`admin.venue_*`·`admin.category_*`·`admin.game_*`).
- 관리자 수는 최소로 유지하고 분기마다 목록을 확인한다(제안).

## 10. 레이트 리밋과 부하

| 대상 | 방법 | 상태 |
|---|---|---|
| 모임 생성·신고 | RPC 내부 집계(24시간 5개·진행 예정 10개, 신고 24시간 10건) | 설계 |
| 목록 조회 | 페이지 20개(RPC가 1~50으로 보정), 검색어 50자. Supabase API의 최대 반환 행 수 설정을 낮게(예: 100) 조정 권장 | `미확인:` 기본값 |
| 로그인 시도 | Supabase Auth 자체 제한 | `미확인:` 플랜별 수치 |
| 전체 요청 | Cloudflare 레이트 리밋 규칙 | `미확인:` 무료 플랜 제공 범위 |

공개 키로 profiles 전체 조회(닉네임·소개 수집)가 가능하다. 공개 필드만 있으므로 MVP에서는 허용하되, 소개란에 연락처를 적지 않도록 안내한다.

## 11. 로그와 개인정보

- 클라이언트 콘솔·오류 메시지에 토큰, 인가 코드, 이메일, 신청 메시지, 신고 본문을 남기지 않는다.
- 콘솔 출력 점검(Phase 4, 2026-11-25): 앱 코드는 `console.*`를 직접 쓰지 않고 개발 모드 전용 `devWarn`/`devError`(`src/lib/devConsole.ts`, 운영 빌드에서는 `import.meta.env.DEV`가 false로 치환돼 출력 없음)만 쓴다. `src/lib/devConsole.test.ts`가 `src/`의 직접 호출을 검사한다. 사용처 5곳:
  | 위치 | 내용 | 개인정보·비밀 값 |
  |---|---|---|
  | `main.tsx` | 데이터 어댑터 준비 실패(오류 객체) | 키 값 없음(어댑터 오류는 원본 메시지 미보관) |
  | `data/supabase/client.ts` | 키 가드 경고(변수 이름·사유) | 키 값 없음 |
  | `data/supabase/mapping.ts` | 프론트가 모르는 카테고리·권역 코드 | 기준 데이터 코드만 |
  | `pages/RouteErrorPage.tsx` | 라우트 오류 객체 | 개발 모드에서만 |
  | `components/layout/AppErrorBoundary.tsx` | 전역 오류 + 컴포넌트 스택 | 개발 모드에서만 |
- 오류 화면(라우트·전역 오류 경계)은 오류 원문·스택을 보여주지 않고 코드별 문구만 보여준다.
- `audit_logs.meta`에는 상태값·필드 이름·시각만 기록한다.
- 외부 오류 수집·분석 도구는 도입하지 않는다(도입 시 개인정보처리방침 갱신 필요).
- `미확인:` Supabase·Cloudflare가 자체 보관하는 요청 로그(IP 등)의 범위와 기간.

## 12. 의존성

- 의존성은 최소로 유지하고 `package-lock.json`을 커밋한다. 배포 전 `npm audit` 결과를 확인해 기록한다. 기록(2026-11-25): Phase 5에서 `@axe-core/playwright`를 설치할 때 npm이 "found 0 vulnerabilities"(274개 패키지)를 출력했다. `npm audit`을 따로 실행해 보관한 기록은 없다 — 배포 직전에 다시 실행한다.
- Phase 5에 추가한 개발 의존성: `@axe-core/playwright` 4.14.1(정확한 버전, 하위 의존성 `axe-core` 4.14.1, 라이선스 MPL-2.0 — 개발·테스트에서만 쓰고 배포 번들에 들어가지 않음). registry.npmjs.org에서 받았고 `package-lock.json`에 sha512 integrity가 있다. 목적: 접근성 자동 점검(`e2e/a11y.spec.ts`).
- 이 PC는 `NODE_TLS_REJECT_UNAUTHORIZED=0`이 전역으로 켜져 있어 npm·Node의 TLS 인증서 검증이 꺼진 상태다. 저장소 설정은 바꾸지 않았다. integrity 값이 패키지 내용을 확인하지만, 전역 설정은 제거를 권장한다([NEXT_STEPS](./NEXT_STEPS.md)).
- 새 의존성 추가 시 목적·대안을 ROADMAP 또는 PR에 남긴다.

## 13. 미검증 항목

- RLS·GRANT: PGlite DB 테스트로 확인(§3). 실제 Supabase(역할 소유 구조·PostgREST GUC 설정)에서의 재확인은 `BLOCKED:` 개발용 프로젝트 필요.
- 어댑터 ↔ PostgREST 계층: 계약 테스트는 SQL 함수까지만 검증한다. HTTP·JSON 인자 직렬화·오류 응답 필드(`code`/`message`/`details`)·JWT 오류 코드는 실제 Supabase에서 확인해야 한다(`BLOCKED:`).
- 동시 신청 경쟁: `BLOCKED:` 실제 개발용 DB와 `scripts/race-test.ts` 필요.
- 실제 OAuth 흐름(Google·Kakao), Redirect URL 설정, 프리뷰 origin이 허용 목록 밖일 때의 동작: `BLOCKED:` 콘솔 설정 필요.
- CSP: 빌드 결과 + 생성 헤더로 주요 화면 위반 0건(§7, `npm run test:csp`). 실제 Cloudflare Pages가 `_headers`를 그대로 적용하는지, 실제 Supabase·OAuth 화면 왕복에서의 위반 여부는 첫 프리뷰 배포 때 확인(`미확인`).
- (해결, Phase 5 검수) 관리자 권한이 계정 상태를 보지 않던 문제 — 마이그레이션 9로 active 계정만 관리자(§3.1). 실제 Supabase 적용은 `BLOCKED:`.
- (해결) `profiles.status`는 공개 grant에서 빠졌다(Phase 2). 본인은 `get_my_profile`, 관리자는 `admin_search_users`로만 본다.
- Supabase 대시보드의 보안 점검 기능(Advisors 등)으로 RLS 누락 경고 확인: 프로젝트 생성 후 수행.
- 외부 보안 점검·침투 테스트: 계획 없음.

## 14. 코드·산출물 감사 (Phase 5, 2026-11-25)

자동 검사로 고정했다: 소스는 `src/lib/securityAudit.test.ts`(단위 테스트, `npm run test`), 빌드 결과는 `scripts/check-dist.mjs`(`npm run check:dist`, verify에 포함).

**src(테스트 제외, 주석 제거 후)** — 모두 통과

| 검사 | 결과 |
|---|---|
| `dangerouslySetInnerHTML`, `innerHTML`/`outerHTML`, `insertAdjacentHTML`, `document.write`, `eval(`, `new Function`, 문자열 `setTimeout` | 0건 |
| `service_role`·`sb_secret_` | `data/supabase/keyGuard.ts`에만(가드 코드·안내 문구) |
| `console.*` | `lib/devConsole.ts`에만(`import.meta.env.DEV` 조건) |
| `localStorage` | `data/mock/`에만(개발·e2e 전용, 운영 번들에 없음 — `check:seed`). supabase 모드에서 앱이 직접 저장하는 데이터 없음 |
| `sessionStorage` | `lib/returnTo.ts`에만(로그인 후 복귀 경로) |
| `target="_blank"` | 외부 링크는 `ExternalLink`(https·`noopener noreferrer`)만. 그 밖에는 최초 설정 화면의 약관·방침 **내부** 링크 2개(새 탭 — 입력 중인 설정 보존. 스크린리더용 "(새 창에서 열림)"을 Phase 5에 추가) |
| `VITE_` 공개 변수 | 코드 = `src/vite-env.d.ts` = `.env.example` = README·ARCHITECTURE §11·DEPLOYMENT 표: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_AUTH_KAKAO_ENABLED`, `VITE_SITE_URL`. 문서의 `VITE_SUPABASE_SERVICE_ROLE_KEY`는 "넣으면 빌드가 멈추는 예"로만 등장 |

**dist(운영 빌드, `grep -F`)** — 우리 코드가 아니라 라이브러리 코드에서만 나온다

| 패턴 | 위치 | 판단 |
|---|---|---|
| `dangerouslySetInnerHTML` | 메인 청크(React DOM의 prop 처리), 라우터 청크(react-router `ScrollRestoration`의 SSR 스크립트) | 앱은 쓰지 않음. ScrollRestoration은 SPA 모드에서 `null`을 렌더 |
| `innerHTML` | 메인 청크(React DOM) | `dangerouslySetInnerHTML` 지원 코드. 앱은 쓰지 않음 |
| `Function(` | 메인 청크(Zod의 eval 가능 여부 시험) | jitless로 실행되지 않음. 실행돼도 CSP가 막음(§7) |
| `eval(`·`new Function`·`document.write`·`insertAdjacentHTML`·`outerHTML` | 없음 | - |
| `console.` | React DOM·스케줄러(`console.error` — 잡히지 않은 렌더 오류 보고), supabase-js(경고), 라우터 | 앱 코드의 출력은 운영 빌드에서 제거됨. 라이브러리 경고에는 토큰·개인정보를 넣지 않는다(`미확인:` supabase-js 경고 문구 전수 확인은 하지 않음) |
| `localStorage`·`sessionStorage` | supabase-js(세션 저장 — §8 잔여 위험), react-router `ScrollRestoration`(sessionStorage에 스크롤 위치), returnTo 청크(우리 코드), 정책 화면 청크(개인정보처리방침 본문의 낱말) | 앱 데이터 저장 없음. 스크롤 위치는 개인정보가 아님 |
| `service_role`·`sb_secret_` | supabase 청크(키 가드 코드) | 실제 키 값 없음 — `check:dist`가 `sb_secret_` 키 형태와 role이 anon이 아닌 JWT를 찾으면 실패 |
