# DB 스키마 명세 (Supabase Postgres)

상태: Phase 5 반영 (2026-11-25 — `is_admin()`에 계정 상태 반영(마이그레이션 9). Phase 4: 공간 조회 RPC·탐색 목록 공간 필터, 관리자 조회 RPC·관리자 테이블 쓰기 감사 트리거, 닉네임 예약어 '운영진'). Phase 3: 닉네임 예약어 완화 마이그레이션, Supabase 어댑터 매핑. 이 문서와 `supabase/migrations/*.sql`이 일치해야 한다. 스키마를 바꿀 때는 이 문서를 먼저 고친다.
검증: `npm run test:db`(PGlite) — 결과와 한계는 [TEST_PLAN §5](./TEST_PLAN.md#5-db-테스트-목록-pglite), 어댑터 → SQL 계약은 [TEST_PLAN §6](./TEST_PLAN.md#6-어댑터-계약-테스트-pglite). 실제 Supabase에서의 재확인은 아직 하지 않았다(`BLOCKED:` 개발용 프로젝트 필요).
관련 문서: [ARCHITECTURE](./ARCHITECTURE.md) · [SECURITY](./SECURITY.md) · [TEST_PLAN](./TEST_PLAN.md) · [OPERATIONS](./OPERATIONS.md)

## 0. 공통 규칙

- 모든 객체는 `public` 스키마. 모든 테이블 `enable row level security`.
- id는 `uuid default gen_random_uuid()`(코어 함수, 확장 불필요). 시각은 `timestamptz not null default now()`.
- 텍스트 길이는 `char_length()` 기준. 앞뒤 공백 제거와 빈 문자열 → `null` 변환은 RPC에서 한다(`_clean_text`).
- `updated_at`은 공통 트리거 `set_updated_at()`로 갱신(profiles, venues, meetings, meeting_participants).
- 마이그레이션 파일(`supabase/migrations/`, 파일명 순서로 적용):

| 파일 | 내용 |
|---|---|
| `20261124000100_schema.sql` | enum, 테이블, 제약조건, 인덱스, RLS 활성화 |
| `20261124000200_access_control.sql` | 일괄 revoke·기본 권한 회수, 정책용 함수 `is_admin()`·`is_meeting_host()`, 테이블·컬럼 grant, RLS 정책 |
| `20261124000300_functions.sql` | 내부 보조 함수, 트리거, 조회·쓰기·관리자 RPC, 함수별 EXECUTE 권한 |
| `20261124000400_reference_data.sql` | 권역·카테고리 기준 데이터(멱등) |
| `20261124000500_nickname_rules.sql` | 닉네임 예약어 함수 `_is_reserved_nickname` 교체(§9.12). 이미 적용된 환경을 고려해 기존 파일은 고치지 않고 `create or replace`로 함수만 바꾼다 |
| `20261124000600_venues_read.sql` | 공간 공개 조회 `venue_to_json`·`list_public_venues`·`get_venue`(§9.17), `list_public_meetings`에 `p_venue_id` 추가(기존 함수 drop 후 재생성 — 오버로드 방지) |
| `20261124000700_admin_tools.sql` | 관리자 조회 RPC `admin_list_meetings`·`admin_list_report_items`·`admin_list_venues`·`admin_list_categories`(§9.15), 공간 쓰기 보정 트리거 `_venues_before_write`, 관리자 테이블(venues·categories·games) 쓰기 감사 트리거 `_audit_admin_table_change`(§9.18) |
| `20261124000800_nickname_rules_v2.sql` | 닉네임 예약어 포함 금지에 `운영진` 추가(§9.12). 함수만 `create or replace` |
| `20261124000900_admin_requires_active.sql` | `is_admin()`을 "admin_roles 행 + `profiles.status = 'active'`"로 교체(§9.1, Phase 5 검수). 함수만 `create or replace` — 정책은 함수를 OID로 참조하므로 다시 만들지 않는다. 권한 revoke/grant는 마이그레이션 2와 같게 다시 명시 |

  정책이 `is_admin()`·`is_meeting_host()`를 참조하므로 이 두 함수는 ②에 둔다(처음 제안한 ②권한 ③함수 순서에서 조정).
- 마이그레이션은 Supabase와 PGlite 테스트 하네스 양쪽에서 돈다. `auth` 스키마·`auth.users`를 만들지 않고(Supabase에 이미 있음, 테스트는 스텁), 확장(extension)을 쓰지 않는다. 스토리지 버킷도 만들지 않는다(§18).
- RLS 정책 안에서는 `(select auth.uid())`, `(select public.is_admin())` 형태로 써서 행마다 재평가되지 않게 한다.
- 모든 함수는 `set search_path = public, pg_temp`. 테이블·함수 이름은 `public.`으로 한정해 쓴다.
- `_`로 시작하는 함수는 내부용이다. anon/authenticated에 EXECUTE가 없다(security definer RPC 안에서 소유자 권한으로 호출).
- RPC의 jsonb **입력** 키는 snake_case(예: `start_at`), jsonb **출력** 키는 camelCase(`src/data/types.ts`와 같은 이름)이다. 출력 시각은 UTC ISO 8601 문자열(`2026-11-24T08:12:05.231+00:00` 형식 — 함수에 `set timezone to 'UTC'`).
- 관리자 RPC 중 행을 돌려주는 함수(`admin_list_reports`, `admin_search_users`)는 테이블 컬럼 이름(snake_case) 그대로 반환한다.

## 1. Enum

| 타입 | 값 | 메모 |
|---|---|---|
| `meeting_status` | `open`, `closed`, `cancelled` | 정원 마감·진행 중·종료는 파생(§5) |
| `skill_level` | `beginner_welcome`, `anyone`, `experienced` | 초보 환영 / 누구나 / 경험자 |
| `approval_mode` | `auto`, `manual` | |
| `participant_role` | `host`, `guest` | |
| `participant_status` | `pending`, `confirmed`, `waitlisted`, `rejected`, `cancelled`, `meeting_cancelled` | 전이는 §6 |
| `attendance_status` | `unknown`, `attended`, `absent` | |
| `account_status` | `active`, `restricted`, `deletion_requested` | |
| `venue_type` | `board_game_cafe`, `party_room`, `other` | |
| `report_target` | `meeting`, `user` | |
| `report_reason` | `spam`, `inappropriate`, `gambling`, `harassment`, `no_show`, `commercial`, `other` | |
| `report_status` | `received`, `reviewing`, `resolved`, `dismissed` | |

## 2. 테이블

### 2.1 기준 데이터

**regions**

| 컬럼 | 타입 | 제약 |
|---|---|---|
| `code` | text | PK, `check (code ~ '^[a-z_]{2,40}$')` |
| `name` | text | not null, 1~20자 |
| `sort_order` | int | not null default 0 |
| `is_active` | boolean | not null default true |

**categories**: `id text PK (check ~ '^[a-z_]{2,40}$')`, `name text not null (1~20자)`, `description text not null default '' (≤200)`, `sort_order int not null default 0`, `is_active boolean not null default true`.

**games**

| 컬럼 | 타입 | 제약 |
|---|---|---|
| `id` | uuid | PK |
| `name` | text | not null, 1~60자. `unique (lower(name))` 인덱스 |
| `category_id` | text | **not null**, FK → categories(id) `on delete restrict` |
| `min_players`, `max_players` | int | null 허용, 1~99, `min_players <= max_players` |
| `play_minutes` | int | null 허용, 1~1440 |
| `is_active` | boolean | not null default true |
| `created_at` | timestamptz | |

### 2.2 사용자

**profiles** — 공개 가능한 필드만 둔다. 이메일·실명·전화번호를 저장하지 않는다(이메일은 `auth.users`에만 있음).

| 컬럼 | 타입 | 제약 |
|---|---|---|
| `id` | uuid | PK, FK → `auth.users(id) on delete cascade` |
| `nickname` | text | not null, `char_length between 2 and 20`. 형식 검사(§9.12)는 RPC |
| `region_code` | text | null, FK → regions `on delete set null` |
| `bio` | text | not null default '', ≤200 |
| `favorite_category_ids` | text[] | not null default '{}', `cardinality <= 6`. 각 값의 유효성은 RPC가 검사 |
| `status` | account_status | not null default `active`. **공개 grant 제외**(§7) — 본인은 `get_my_profile()`로 조회 |
| `created_at`, `updated_at` | timestamptz | |

- 인덱스: `unique (lower(nickname)) where status <> 'deletion_requested'` — 탈퇴한 사용자 여러 명이 같은 표시명("탈퇴한 사용자")을 가질 수 있게 부분 인덱스로 둔다.

**user_private** — 본인만 조회.

| 컬럼 | 타입 | 제약 |
|---|---|---|
| `user_id` | uuid | PK, FK → `auth.users(id) on delete cascade` |
| `terms_agreed_at` | timestamptz | null. 최초 설정 완료 여부 판단 기준 |
| `privacy_agreed_at` | timestamptz | null |
| `deletion_requested_at` | timestamptz | null |
| `created_at` | timestamptz | |

**admin_roles** — anon/authenticated 정책·권한 없음. SQL Editor(서비스 권한)로만 쓴다.

| 컬럼 | 타입 | 제약 |
|---|---|---|
| `user_id` | uuid | PK, FK → `auth.users(id) on delete cascade` |
| `role` | text | not null default 'admin', `check (role = 'admin')` |
| `granted_at` | timestamptz | not null default now() |
| `granted_by` | uuid | null (FK 없음 — 부여자 삭제와 무관하게 기록 유지) |
| `note` | text | null, ≤200 |

### 2.3 공간

**venues** — 실시간 영업 상태·좌석·가격 필드를 두지 않는다.

| 컬럼 | 타입 | 제약 |
|---|---|---|
| `id` | uuid | PK |
| `name` | text | not null, 1~60자 |
| `region_code` | text | not null, FK → regions `on delete restrict` |
| `address` | text | not null, 1~200자 |
| `venue_type` | venue_type | not null |
| `website_url`, `booking_url` | text | null, `check (x ~ '^https://' and char_length(x) <= 500)` |
| `description` | text | not null default '', ≤1000 |
| `is_public` | boolean | not null default false |
| `info_verified_at` | timestamptz | null. 공식 출처로 정보를 확인한 시각 |
| `created_by` | uuid | null, FK → `auth.users(id) on delete set null` |
| `created_at`, `updated_at` | timestamptz | |

인덱스: `(region_code)`, `(is_public)`.

트리거(마이그레이션 7): `venues_set_updated_at`(updated_at), `venues_before_write`(앞뒤 공백 제거·빈 링크 null, API 요청이면 `created_by = auth.uid()` 고정 — 입력값 무시, 수정 때 `created_by`·`created_at`·`id` 유지), `venues_audit`(감사 로그, §9.18). 형식·길이 위반은 위 check 제약(23514)이 거부한다.

### 2.4 모임

**meetings**

| 컬럼 | 타입 | 제약 |
|---|---|---|
| `id` | uuid | PK |
| `host_id` | uuid | **null 허용**, FK → profiles(id) `on delete set null`(§13). RPC는 생성 시 항상 채운다. null이면 화면에 "탈퇴한 사용자" |
| `category_id` | text | not null, FK → categories `on delete restrict` |
| `game_id` | uuid | null, FK → games `on delete set null` |
| `game_name` | text | null, 1~40자. `check (game_id is null or game_name is null)` |
| `title` | text | not null, 2~60자 |
| `description` | text | not null default '', ≤2000 |
| `notice` | text | null, ≤1000 |
| `start_at` | timestamptz | not null |
| `end_at` | timestamptz | not null, `check (end_at > start_at)`. RPC가 `start_at + duration_minutes`로 계산 |
| `duration_minutes` | int | not null, 30~720 |
| `region_code` | text | not null, FK → regions `on delete restrict` |
| `venue_id` | uuid | null, FK → venues `on delete restrict` (공간은 삭제 대신 비공개 처리) |
| `venue_note` | text | null, ≤60 (예: "둔산동 카페 미정") |
| `min_participants` | int | not null, `>= 2` |
| `max_participants` | int | not null, `<= 30`, `check (min_participants <= max_participants)` |
| `skill_level` | skill_level | not null |
| `approval_mode` | approval_mode | not null |
| `allow_waitlist` | boolean | not null default true |
| `status` | meeting_status | not null default `open` |
| `is_hidden` | boolean | not null default false |
| `hidden_reason` | text | null, ≤200 |
| `confirmed_count` | int | not null default 1, `check (confirmed_count between 0 and max_participants)` |
| `pending_count`, `waitlist_count` | int | not null default 0, `>= 0` |
| `remaining_seats` | int | `generated always as (max_participants - confirmed_count) stored` — 모집 중 필터용 |
| `cancelled_at` | timestamptz | null, `check ((status = 'cancelled') = (cancelled_at is not null))` |
| `cancel_reason` | text | null, ≤200 |
| `created_at`, `updated_at` | timestamptz | |

- 카운트 3종은 비정규화 값이며 RPC만 갱신한다(직접 DML 권한 없음).
- `end_at`을 생성 컬럼으로 만들지 않는다: `timestamptz + interval` 연산이 IMMUTABLE이 아니어서 생성 컬럼에 쓸 수 없다.
- `remaining_seats`는 `stored`를 명시한다(PostgreSQL 18부터 생성 컬럼 기본값이 VIRTUAL. PGlite는 PG 19 기반).
- 인덱스: `(start_at)`, `(region_code, start_at)`, `(category_id, start_at)`, `(host_id)`, `(created_at)`(newest 정렬).

**meeting_participants**

| 컬럼 | 타입 | 제약 |
|---|---|---|
| `id` | uuid | PK |
| `meeting_id` | uuid | not null, FK → meetings `on delete cascade` |
| `user_id` | uuid | not null, FK → profiles `on delete cascade` |
| `role` | participant_role | not null |
| `status` | participant_status | not null, `check (role <> 'host' or status = 'confirmed')` |
| `attendance` | attendance_status | not null default `unknown` |
| `message` | text | null, ≤200. 신청 시 모임장에게 남기는 말 |
| `applied_at` | timestamptz | not null default now() |
| `decided_at`, `confirmed_at`, `cancelled_at`, `attendance_marked_at` | timestamptz | null |
| `updated_at` | timestamptz | |

- 제약: `unique (meeting_id, user_id)`, 모임당 모임장 1명 `unique (meeting_id) where role = 'host'`.
- 인덱스: `(user_id, status)`(내 모임), `(meeting_id, status)`(참가자 관리).

### 2.5 신고·로그

**reports**

| 컬럼 | 타입 | 제약 |
|---|---|---|
| `id` | uuid | PK |
| `reporter_id` | uuid | null 허용, FK → profiles `on delete set null` |
| `target_type` | report_target | not null |
| `target_meeting_id` | uuid | null, FK → meetings `on delete set null` |
| `target_user_id` | uuid | null, FK → profiles `on delete set null` |
| `reason` | report_reason | not null |
| `body` | text | not null default '', ≤1000 |
| `status` | report_status | not null default `received` |
| `admin_note` | text | null, ≤1000. 신고자에게 노출하지 않음(§7) |
| `handled_by` | uuid | null, FK → `auth.users(id) on delete set null` |
| `handled_at` | timestamptz | null |
| `created_at` | timestamptz | |

- 대상 check: `(target_type = 'meeting' and target_user_id is null) or (target_type = 'user' and target_meeting_id is null)`. "대상이 정확히 하나"는 접수 시 RPC가 강제한다(대상 삭제 시 `set null`이 check에 걸려 계정 삭제가 막히지 않도록).
- 중복 방지: `unique (reporter_id, target_type, coalesce(target_meeting_id, target_user_id)) where status in ('received', 'reviewing')`.
- 인덱스: `(status, created_at)`, `(reporter_id, created_at)`, `(target_user_id)`(관리자 검색의 최근 신고 수).

**audit_logs** — security definer 함수만 기록, 관리자만 조회.

| 컬럼 | 타입 | 제약 |
|---|---|---|
| `id` | bigint | `generated always as identity` PK |
| `actor_id` | uuid | null (FK 없음, 기록 보존) |
| `action` | text | not null (§12) |
| `target_type` | text | not null |
| `target_id` | text | null |
| `meta` | jsonb | not null default '{}'. 신청 메시지·신고 본문·이메일 금지 |
| `created_at` | timestamptz | |

인덱스: `(created_at)`, `(target_type, target_id)`.

알림 테이블은 만들지 않는다(알림 미구현).

## 3. 기준 데이터 (마이그레이션에 포함)

| regions.code | name | sort | categories.id | name | sort |
|---|---|---|---|---|---|
| `dunsan_tanbang` | 둔산·탄방 | 10 | `party` | 파티·캐주얼 | 10 |
| `gung_bongmyeong` | 궁동·봉명 | 20 | `deduction` | 추리·마피아 | 20 |
| `eunhaeng_daeheung` | 은행·대흥 | 30 | `strategy` | 전략 | 30 |
| `noeun_jijok` | 노은·지족 | 40 | `murder_mystery` | 머더미스터리 | 40 |
| `gwanjeo_gasuwon` | 관저·가수원 | 50 | `mahjong_etc` | 마작·기타 | 50 |
| `etc_daejeon` | 그 외 대전 | 90 | `holdem_social` | 홀덤(비금전) | 60 |

- `insert ... on conflict do nothing`으로 멱등하게 넣는다(다시 실행해도 6+6행, 테스트로 확인). 권역은 테이블이라 행 추가로 확장한다.
- `holdem_social.description`: "금전·경품을 걸지 않는 홀덤 모임만 열 수 있어요."
- games는 기준 데이터를 넣지 않는다(게임명 직접 입력 우선, 관리자가 추가).
- 프론트 상수(`src/domain/regions.ts`, `src/domain/categories.ts`)의 코드·이름·정렬값은 위 표와 같다(`etc_daejeon` 90). 계약 테스트가 `listRegions()`·`listCategories()` 결과와 상수를 비교한다.
- 권역·카테고리를 추가할 때는 프론트 상수(`RegionCode`·`CategoryId` 타입)를 먼저 배포한다. 어댑터는 모임·프로필에 프론트가 모르는 코드가 오면 계약 위반(`UNKNOWN`)으로 처리하고, 목록(`listRegions`/`listCategories`)에서는 모르는 코드를 빼고 콘솔에 경고한다.

## 4. 정원·카운트 규칙

- `max_participants` = 모임장 1명 포함 전체 인원. 모임 생성 시 모임장을 `role=host, status=confirmed`로 넣고 `confirmed_count=1`로 시작한다.
- `confirmed_count` = 해당 모임의 `status=confirmed` 행 수(모임장 포함). `pending_count` = `pending` 행 수, `waitlist_count` = `waitlisted` 행 수.
- 남은 자리 = `remaining_seats` = `max_participants - confirmed_count`. `pending`은 자리를 차지하지 않는다(승인 시 다시 검사).
- 모든 카운트 변경은 모임 행을 `select ... for update`로 잠근 같은 트랜잭션 안에서 한다. 구현은 증감 대신 `_sync_meeting_counts(meeting_id)`가 실제 행을 다시 집계해 맞춘다(불변식이 깨질 여지를 줄임). 집계 결과가 정원을 넘으면 `meetings_confirmed_count_range` check가 트랜잭션을 거부한다.
- DB 테스트에 "카운트 = 실제 행 집계" 불변식 검사가 있다(`TestDb.countMismatches()`).
- 계정 삭제(cascade)로 참가 행이 사라진 **지난** 모임의 카운트는 보정하지 않는다(§13).

## 5. 파생 상태 (meetingPhase)

`src/domain/meetingPhase.ts`에서 계산한다(이름은 프론트 구현 기준). 위에서부터 먼저 맞는 것을 택한다.

| 순서 | phase | 조건 | 화면 표기 |
|---|---|---|---|
| 1 | `cancelled` | `status = cancelled` | 취소됨 |
| 2 | `finished` | `now >= end_at` | 종료 |
| 3 | `in_progress` | `start_at <= now < end_at` | 진행 중 |
| 4 | `closed` | `status = closed` | 모집 마감(모임장 마감) |
| 5 | `full` | `confirmed_count >= max_participants` | 모집 마감(정원) / `allow_waitlist`면 대기 신청 가능 |
| 6 | `open` | 그 외 | 모집 중. `confirmed_count < min_participants`면 "최소 인원 미달" 보조 표기 |

- DB의 `list_public_meetings(p_recruiting => true)`는 phase `open`과 같은 조건이다: 시작 전(`start_at > now()`, 목록 공통 조건) + `status = 'open'` + `remaining_seats > 0`.
- `is_hidden`은 별도 플래그(모임장·관리자만 봄)로 표시한다.

## 6. 참가 상태 전이

| 현재 | 동작(RPC) | 다음 | 조건 |
|---|---|---|---|
| 없음 / `cancelled` | 신청(`apply_to_meeting`) | `confirmed` | auto, 자리 있음 |
| 〃 | 〃 | `pending` | manual, 자리 있음 |
| 〃 | 〃 | `waitlisted` | 자리 없음 + `allow_waitlist` |
| `pending`, `waitlisted` | 승인(`decide_participant approve`) | `confirmed` | 자리 재검사 |
| `pending`, `waitlisted` | 거절(`decide_participant reject`) | `rejected` | 재신청 불가 |
| `pending`, `confirmed`, `waitlisted` | 본인 취소(`cancel_my_application`) | `cancelled` | 시작 전. 재신청 가능(같은 행 재사용) |
| `pending`, `confirmed`, `waitlisted`(게스트) | 모임 취소(`cancel_meeting`) | `meeting_cancelled` | |
| `confirmed`(게스트) | 출석(`mark_attendance`) | 상태 유지, `attendance` 변경 | 시작 후~종료 7일 |

- **대기자 자동 승격 없음.** 확정자가 취소해 자리가 나도 `waitlisted`는 그대로이며, 모임장이 직접 승인한다(테스트로 확인).
- 확정된 게스트를 모임장이 내보내는 기능은 MVP에 없다(§16).

## 7. 권한 (GRANT)

1. 마이그레이션 ②가 `revoke all on all tables/sequences in schema public from anon, authenticated`, 그리고 `alter default privileges in schema public revoke all on tables/sequences/functions from anon, authenticated`를 실행한다. Supabase는 public에 새로 만드는 객체를 anon/authenticated/service_role에 기본 부여하므로, 이후 마이그레이션에서 만드는 테이블도 **명시적으로 grant 해야** API에서 보인다. service_role 권한은 건드리지 않는다.
2. 함수의 PUBLIC EXECUTE는 PostgreSQL 전역 기본값이라 스키마 단위로 회수할 수 없다. 그래서 함수마다 `revoke all on function ... from public, anon, authenticated` 후 아래 표대로 다시 grant 한다. 테스트가 public 스키마의 **모든** 함수에 대해 anon/authenticated EXECUTE 여부를 허용 목록과 비교한다.

테이블 권한(테스트가 `has_table_privilege`/`has_column_privilege`로 정확히 비교):

| 테이블 | anon | authenticated |
|---|---|---|
| regions | select | select |
| categories, games | select | select, insert, update, delete (RLS로 관리자만 쓰기) |
| venues | select | select, insert, update, delete (RLS로 관리자만 쓰기) |
| profiles | `select (id, nickname, region_code, bio, favorite_category_ids, created_at)` | 같음 — `status`, `updated_at` 제외 |
| user_private | - | select |
| admin_roles | - | - |
| meetings | select | select |
| meeting_participants | - | select |
| reports | - | `select (id, reporter_id, target_type, target_meeting_id, target_user_id, reason, body, status, created_at, handled_at)` — `admin_note`, `handled_by` 제외. 관리자는 `admin_list_reports()`로 전체 컬럼 조회 |
| audit_logs | - | select (RLS로 관리자만) |

- regions 쓰기는 마이그레이션·SQL Editor로만 한다(관리자도 API로 불가).
- 컬럼 단위 grant 때문에 `select *`는 profiles·reports에서 권한 오류(42501)가 난다. 프론트는 컬럼을 명시하거나 RPC를 쓴다.

함수 EXECUTE:

| 대상 | anon | authenticated |
|---|---|---|
| `is_admin()`, `is_meeting_host(uuid)` (정책 평가용), `list_public_meetings(...)`, `get_meeting(uuid)`, `meeting_to_json(meetings)`(목록·상세가 security invoker로 호출하는 순수 변환 함수), `list_public_venues(...)`, `get_venue(uuid)`, `venue_to_json(venues)` | O | O |
| `get_my_profile`, `get_my_participation`, `list_my_meetings`, `list_meeting_participants`, 모든 쓰기 RPC, `admin_*`(조회 RPC 포함) | X | O |
| `_`로 시작하는 내부 함수(트리거 함수 `_venues_before_write`·`_audit_admin_table_change` 포함), `handle_new_user()`, `set_updated_at()` | X | X |

## 8. RLS 정책 매트릭스

| 테이블 | select | insert / update / delete |
|---|---|---|
| regions, categories, games | `true` (비활성 항목도 기존 모임 표시용으로 조회. 폼은 `is_active`만 사용) | categories·games: `is_admin()` (using·with check) |
| venues | `is_public or is_admin()` | `is_admin()` |
| profiles | `true` (공개 컬럼만 grant) | 정책 없음(RPC·트리거만) |
| user_private | `user_id = (select auth.uid())` | 정책 없음 |
| admin_roles | 정책 없음 | 정책 없음 |
| meetings | `is_hidden = false or host_id = (select auth.uid()) or is_admin()` | 정책 없음(RPC만) |
| meeting_participants | `user_id = (select auth.uid()) or is_meeting_host(meeting_id) or is_admin()` | 정책 없음(RPC만) |
| reports | `reporter_id = (select auth.uid()) or is_admin()` | 정책 없음(RPC만) |
| audit_logs | `is_admin()` | 정책 없음 |

- 정책은 `to anon, authenticated`(또는 `to authenticated`)로 대상 역할을 명시한다.
- 공개 화면에는 인원 수만 보인다. 참가자 닉네임 목록은 모임장(과 관리자)만 조회된다(`list_meeting_participants`).
- 숨김 처리된 모임은 게스트에게도 보이지 않는다. `list_my_meetings`의 joined 항목은 이때 `meeting: null`이다([UI_SPEC §5](./UI_SPEC.md#5-상태-목록)).

## 9. 함수/RPC 명세

### 9.0 공통

- 쓰기 RPC: `language plpgsql security definer set search_path = public, pg_temp`. 소유자는 마이그레이션 실행 역할(테이블 소유자라 RLS를 우회한다).
- 첫 단계 `_require_actor(p_require_onboarded, p_allow_restricted)`: `auth.uid()`가 null이면 `AUTH_REQUIRED`, 프로필 없음 `PROFILE_INCOMPLETE`(detail `profile_missing`), `deletion_requested` → `ACCOUNT_DELETION_REQUESTED`, `restricted`(허용 안 하는 함수) → `ACCOUNT_RESTRICTED`, 온보딩 필요한데 `user_private.terms_agreed_at is null` → `PROFILE_INCOMPLETE`.
- jsonb 입력은 정의된 키만 읽고 나머지는 무시한다. 값 타입이 다르면(예: 숫자 자리에 문자열, 정수 자리에 소수) `VALIDATION_FAILED`(detail=키). 문자열은 앞뒤 공백을 지우고 빈 문자열은 null로 본다.
- 시각 입력은 오프셋(`Z` 또는 `±HH:MM`)이 있는 ISO 8601만 받는다(세션 시간대에 따라 해석이 달라지지 않게).
- 오류: `raise exception using errcode = 'P0001', message = '<CODE>', detail = '<필드명 또는 세부 사유, 없으면 빈 문자열>'`(`_err`). `unique_violation`은 잡아서 의미 있는 코드로 바꾼다. 권한 없는 함수 호출·테이블 접근은 Postgres `42501`.
- 잠금 순서는 항상 **meetings 행 → meeting_participants 행**(교착 방지). 여러 모임을 잠글 때는 id 순서.
- 모든 쓰기 RPC는 audit_logs에 기록한다(§12). 신고 접수는 기록하지 않는다(신고 행 자체가 기록).

### 9.1 `is_admin() returns boolean` (stable, security definer)
`exists (select 1 from admin_roles ar join profiles p on p.id = ar.user_id where ar.user_id = auth.uid() and p.status = 'active')` (마이그레이션 9 — 이전에는 admin_roles 행만 봤다). anon이면 false. JWT claim(예: `app_metadata.role`)은 보지 않는다.
- 이용 제한·탈퇴 요청 상태인 관리자는 false → 관리자 RPC `NOT_ADMIN`, venues·categories·games 쓰기 RLS 거부, 숨김 모임·비공개 공간·남의 신고·감사 로그 조회 불가, 관리자 취소 불가, `get_my_profile().isAdmin` false. active로 되돌리면 admin_roles 행이 그대로라 바로 복구된다.
- 관리자 해제는 admin_roles 행 삭제(SQL Editor). 관리자는 자기 계정을 이용 제한할 수 없다(`admin_set_user_status`가 본인 대상 거부).

### 9.2 `is_meeting_host(p_meeting_id uuid) returns boolean` (stable, security definer)
RLS에서 meetings를 다시 조회할 때 정책이 얽히지 않도록 security definer로 둔다.

### 9.3 `handle_new_user()` — `after insert on auth.users` 트리거
`profiles(id, nickname = '플레이어' || 6자리 난수)`와 `user_private(user_id)`를 만든다. 닉네임 충돌(unique_violation) 시 최대 5회 재시도 후 `'플레이어' || id 앞 12자리`. `raw_user_meta_data`(이름·사진 등)·이메일을 복사하지 않는다. 실패하면 가입 자체가 실패하므로 로직을 최소로 유지한다. EXECUTE는 누구에게도 주지 않는다(트리거 실행에는 필요 없음 — PGlite에서 `supabase_auth_admin` 역할 insert로 확인).

### 9.4 `create_meeting(p jsonb) returns uuid`
- 키: `category_id`, `game_id?`, `game_name?`, `title`, `description?`, `notice?`, `start_at`(오프셋 포함 ISO 8601), `duration_minutes`, `region_code`, `venue_id?`, `venue_note?`, `min_participants`, `max_participants`, `skill_level`, `approval_mode`, `allow_waitlist?`(기본 true), `holdem_policy_agreed?`
- 거절: 로그인·active·온보딩 아님. `start_at < now() + 30분` 또는 `> now() + 90일` → `VALIDATION_FAILED`(start_at). 비활성/없는 카테고리·권역·게임. `game_id`와 `game_name` 동시 지정 → `VALIDATION_FAILED`(detail `game`). `venue_id`가 없거나 비공개이거나 권역 불일치 → `VALIDATION_FAILED`(venue_id). 길이·범위 위반 → `VALIDATION_FAILED`(detail=필드). 홀덤인데 동의 없음 → `HOLDEM_AGREEMENT_REQUIRED`. 최근 24시간 생성 5개 이상 → `RATE_LIMITED`(`create_24h`), `status in (open, closed) and start_at > now()`인 주최 모임 10개 이상 → `RATE_LIMITED`(`open_meetings`).
- 동작: `pg_advisory_xact_lock(hashtext('hanpan.create_meeting'), hashtext(uid))`로 같은 사용자의 동시 생성을 직렬화 → meetings insert(`status=open`, 카운트 1/0/0, `end_at` 계산) → 모임장 참가 행 insert → audit `meeting.create`(category_id, start_at).

### 9.5 `update_meeting(p_meeting_id uuid, p jsonb) returns void`
- 키: 생성과 같은 편집 필드 전체(부분 수정 아님). 선택 키를 빼면 생성과 같은 기본값(`allow_waitlist`=true, 나머지 null/'')으로 바뀐다 — 어댑터는 항상 전체 값을 보낸다.
- 거절: 모임 없음 또는 (숨김이고 모임장·관리자 아님) `NOT_FOUND`, 모임장 아님 `NOT_HOST`(관리자도 수정 불가), 취소됨 `MEETING_CANCELLED`, 시작 이후 `MEETING_STARTED`, restricted `ACCOUNT_RESTRICTED`. `start_at`이 **바뀐 경우에만** 30분~90일 규칙 적용. 카테고리·권역·게임 활성 검사와 공간 공개 검사도 **값이 바뀐 경우에만**(기존 값 유지는 허용. 공간-권역 일치는 항상 검사). `max_participants < confirmed_count` → `CAPACITY_BELOW_CONFIRMED`. 홀덤으로 바꾸면 동의 필요(이미 홀덤이면 불필요).
- 동작: 행 잠금 후 갱신, `end_at` 재계산. 승인 방식·정원을 바꿔도 기존 `pending`·`waitlisted`는 그대로(자동 확정 없음). audit `meeting.update`(`fields`: 바뀐 필드 이름 배열, 일시 변경 시 `start_at_before`·`start_at_after`).

### 9.6 `cancel_meeting(p_meeting_id uuid, p_reason text default null) returns void`
- 권한: 모임장(시작 전) 또는 관리자(종료 전). restricted 모임장도 취소 허용(피해 축소). 다른 사용자: 숨김 모임이면 `NOT_FOUND`, 아니면 `NOT_HOST`. 이미 취소 `MEETING_CANCELLED`. 모임장 시작 후 `MEETING_STARTED`, 관리자 종료 후 `MEETING_STARTED`(detail `ended`). 사유 ≤200(선택, 공백 제거).
- 동작(`_cancel_meeting_core`): `status=cancelled, cancelled_at, cancel_reason` → 게스트 `pending/confirmed/waitlisted` → `meeting_cancelled`(`cancelled_at` 기록, `rejected`·`cancelled`는 유지) → 카운트 재집계(모임장만 남아 1/0/0) → audit `meeting.cancel`(`by_admin`, `affected_guests`).

### 9.7 `set_meeting_recruiting(p_meeting_id uuid, p_open boolean) returns void`
모임장만, 취소되지 않고 시작 전, restricted 불가. `p_open` null → `VALIDATION_FAILED`(open). `open ↔ closed` 전환(같은 값이면 변화·기록 없음). audit `meeting.recruiting`(from, to).

### 9.8 `apply_to_meeting(p_meeting_id uuid, p_message text default null) returns participant_status`
1. 로그인·active(restricted → `ACCOUNT_RESTRICTED`)·온보딩 확인. `p_message` ≤200(공백 제거 후).
2. `select ... from public.meetings where id = p_meeting_id for update`. 없거나 숨김 → `NOT_FOUND`.
3. 모임장 본인 `OWN_MEETING` → 취소됨 `MEETING_CANCELLED` → `closed` `MEETING_NOT_OPEN` → 모임장 계정이 삭제됨(host_id null) `MEETING_NOT_OPEN`(detail `host_missing`) → `start_at <= now()` `MEETING_STARTED`.
4. 기존 행(`for update`): `pending/confirmed/waitlisted` → `ALREADY_APPLIED`, `rejected` → `APPLICATION_REJECTED`, `cancelled` → 같은 행을 갱신해 재신청.
5. 결정: `confirmed_count < max_participants`이면 auto `confirmed` / manual `pending`. 자리 없으면 `allow_waitlist`일 때 `waitlisted`, 아니면 `MEETING_FULL`.
6. insert 또는 update(`applied_at=now()`, `decided_at/cancelled_at=null`, 확정이면 `confirmed_at=now()`, 출석 초기화), 카운트 재집계, audit `participant.apply`(status, reapply). `unique_violation` → `ALREADY_APPLIED`. 반환: 결정된 상태.

### 9.9 `cancel_my_application(p_meeting_id uuid) returns void`
모임 잠금 → 없으면 `NOT_FOUND`(숨김이어도 본인 신청 취소는 허용), 모임장이면 `OWN_MEETING` → 본인 게스트 행이 `pending/confirmed/waitlisted`가 아니면 `NOT_APPLIED` → 시작 이후 `MEETING_STARTED`. `cancelled` + `cancelled_at`, 카운트 재집계, **대기자 승격 없음**. restricted 계정도 허용. audit `participant.cancel`(from).

### 9.10 `decide_participant(p_participant_id uuid, p_decision text) returns participant_status`
`p_decision in ('approve','reject')` 아니면 `VALIDATION_FAILED`(decision). 참가 행 없음 `NOT_FOUND`. 참가 행으로 모임을 찾아 모임 잠금 → 참가 행 잠금. 모임장 아님 `NOT_HOST`(관리자도 불가), restricted `ACCOUNT_RESTRICTED`, 취소 `MEETING_CANCELLED`, 시작 이후 `MEETING_STARTED`, 대상이 `pending/waitlisted` 게스트가 아니면 `INVALID_STATE`(detail=현재 상태). approve: 자리 없으면 `MEETING_FULL`, 있으면 `confirmed`(`decided_at`, `confirmed_at`). reject: `rejected`(`decided_at`). 카운트 재집계, audit `participant.decide`(meeting_id, from, to).

### 9.11 `mark_attendance(p_participant_id uuid, p_attendance attendance_status) returns void`
모임장만(restricted 불가), 취소된 모임 `MEETING_CANCELLED`, `start_at <= now() <= end_at + 7일` 아니면 `ATTENDANCE_WINDOW_CLOSED`, 대상이 `confirmed` 게스트가 아니면 `INVALID_STATE`. `attendance`, `attendance_marked_at`(`unknown`으로 되돌리면 null) 갱신, audit `participant.attendance`.

### 9.12 `update_my_profile(p jsonb) returns void`
- 키: `nickname?`, `region_code?`, `bio?`, `favorite_category_ids?`, `agree_terms?`, `agree_privacy?`. **있는 키만** 바꾼다(부분 수정). 그 외 키(`is_admin`, `status`, `id`, `role` 등)는 무시한다.
- 닉네임 형식 `^[가-힣A-Za-z0-9_-]{2,20}$`(공백 제거 후). 예약어(`_is_reserved_nickname`, 마이그레이션 8 — 마이그레이션 5 규칙 + `운영진`): 소문자로 바꾸고 공백·`_`·`-`를 지운 값으로 비교한다.
  - **포함 금지**: `관리자`, `운영자`, `운영진`, `운영팀`, `admin`, `hanpan` — 어디에든 들어가면 금지(예: `관리자김`, `운영진김`, `superAdmin`)
  - **완전 일치 금지**: `한판`, `탈퇴한사용자` — 값 전체가 같을 때만 금지(예: `한판`·`한_판` 금지, `한판승부` 허용)
  - 위반 → `VALIDATION_FAILED`(nickname). 프론트 `src/domain/limits.ts`의 `isReservedNickname`이 같은 규칙이다(DB 테스트가 두 결과를 비교).
  - 마이그레이션 3의 이전 규칙(모두 포함 금지)은 마이그레이션 5가 대체했고, 마이그레이션 5에서 빠졌던 `운영진`은 마이그레이션 8에서 포함 금지로 다시 넣었다. 이미 `운영진`이 들어간 닉네임은 소급 변경하지 않는다(다음 닉네임 변경부터 적용).
- 다른 사람과 중복(대소문자 무시, 탈퇴 요청 계정 제외) → `NICKNAME_TAKEN`. 본인 닉네임의 대소문자만 바꾸는 것은 허용.
- 권역: 활성 권역 또는 null(지움). 소개 ≤200(null → ''). 관심 장르: 문자열 배열, 활성 카테고리만, 중복 제거 후 최대 6개, null → `{}`.
- 온보딩 전(`terms_agreed_at is null`)에는 `nickname`, `agree_terms=true`, `agree_privacy=true`가 모두 있어야 한다 → 아니면 `PROFILE_INCOMPLETE`. 동의 시각은 비어 있을 때만 기록(false는 무시 — 철회는 탈퇴 요청으로).
- deletion_requested → `ACCOUNT_DELETION_REQUESTED`, restricted → `ACCOUNT_RESTRICTED`. 닉네임이 바뀌면 audit `profile.nickname_change`(onboarding 여부).

### 9.13 `request_account_deletion() returns void`
이미 요청 상태면 아무것도 하지 않음(멱등). 프로필 행을 잠근 뒤: 시작 전·취소 안 된 모임의 본인 게스트 신청(`pending/confirmed/waitlisted`) → `cancelled`(모임 행 잠금 후 카운트 재집계). 주최 중인 시작 전 모임 → `cancel_meeting`과 같은 처리(사유 "모임장 탈퇴", 모임마다 audit `meeting.cancel`). 이미 시작·종료된 모임의 기록은 그대로. 프로필: `status=deletion_requested`, 닉네임 "탈퇴한 사용자", 소개 '', 권역 null, 관심 장르 '{}'. `user_private.deletion_requested_at=now()`. audit `account.deletion_requested`(cancelled_applications, cancelled_meetings). `auth.users` 삭제는 하지 않는다([OPERATIONS §5](./OPERATIONS.md#5-개인정보-요청-처리)).

### 9.14 `submit_report(p_target_type report_target, p_target_id uuid, p_reason report_reason, p_body text default null) returns uuid`
로그인·온보딩 확인(restricted 허용 — 안전 신고 경로 유지, `deletion_requested`는 불가). 인자 null → `VALIDATION_FAILED`. 본문 ≤1000(공백 제거), `reason=other`면 본문 필수. 대상 존재·조회 가능 확인(숨김 모임은 모임장·관리자만) → 없으면 `NOT_FOUND`. 자기 자신 또는 자기 모임 → `CANNOT_REPORT_SELF`. 사용자 단위 advisory lock 후 최근 24시간 10건 → `RATE_LIMITED`(`report_24h`). 미처리(`received/reviewing`) 중복 → `DUPLICATE_REPORT`. 반환: report id.

### 9.15 관리자 RPC (모두 `is_admin()` 아니면 `NOT_ADMIN`)

| 함수 | 동작 | audit |
|---|---|---|
| `admin_list_reports(p_status report_status default null, p_limit int default 50, p_offset int default 0) returns setof reports` | 전체 컬럼(admin_note 포함). 최신순, limit 1~100 보정 | - |
| `admin_update_report(p_report_id uuid, p_status report_status, p_admin_note text default null) returns void` | 상태·메모 변경(메모는 매번 덮어씀, ≤1000). `resolved/dismissed`면 `handled_by/handled_at` 기록, 그 외 상태면 null | `admin.report_update`(from, to) |
| `admin_set_meeting_hidden(p_meeting_id uuid, p_hidden boolean, p_reason text default null) returns void` | 숨길 때 사유 필수(≤200), 해제 시 사유 null | `admin.meeting_hidden`(hidden) |
| `admin_set_user_status(p_user_id uuid, p_status account_status, p_note text default null) returns void` | `active`·`restricted`만 허용. 본인 대상·`deletion_requested` 계정 변경 불가 → `VALIDATION_FAILED`. 같은 값이면 변화 없음. 해당 사용자의 모임을 자동 취소하지 않음. `p_note`(≤200, 관리자 작성)는 audit `meta.note`에 남긴다 | `admin.user_status`(from, to, note) |
| `admin_search_users(p_query text default null, p_limit int default 20) returns table (id uuid, nickname text, status account_status, created_at timestamptz, recent_report_count int)` | 닉네임 부분 일치(이스케이프, 최대 50자) 또는 id 정확 일치. 검색어 없으면 최근 가입순. `recent_report_count` = 최근 30일 해당 사용자 대상 신고 수. limit 1~50 | - |
| `admin_list_meetings(p_q text default null, p_hidden_only boolean default false, p_limit int default 20, p_offset int default 0) returns jsonb` (마이그레이션 7) | `{ items: Meeting[], total }`(meeting_to_json — isHidden·hiddenReason 포함). 숨김·취소·종료 포함, 최근 등록순(created_at desc, id). `p_q`: 제목·게임명(직접 입력·games.name) 부분 일치(공백 제거, 50자, `\`·`%`·`_` 이스케이프). limit 1~50, offset 음수 0 | - |
| `admin_list_report_items(p_status report_status default null, p_limit int default 50, p_offset int default 0) returns jsonb` (마이그레이션 7) | 화면용 신고 목록 `{ items, total }`. 원소: `id, targetType, targetId, targetLabel(모임 제목 또는 대상 닉네임 — 대상 삭제 시 null), targetHidden(모임 신고만), reason, body, status, adminNote, reporterId, reporterNickname, handledAt, createdAt`. 최신순, limit 1~100. `admin_list_reports`(행 그대로)는 그대로 둔다 | - |
| `admin_list_venues() returns jsonb` (마이그레이션 7) | 비공개 포함 공간 배열(venue_to_json), 권역 정렬 → 이름 순, 최대 500 | - |
| `admin_list_categories() returns jsonb` (마이그레이션 7) | 비활성 포함 `[{ id, name, description, sortOrder, isActive }]`, sort_order 순 | - |

### 9.16 조회 RPC (프론트 어댑터용)

| 함수 | 보안 | 반환 |
|---|---|---|
| `list_public_meetings(p_date_from timestamptz default null, p_date_to timestamptz default null, p_category text default null, p_region text default null, p_q text default null, p_recruiting boolean default false, p_sort text default 'soonest', p_limit int default 20, p_offset int default 0, p_venue_id uuid default null)` | security invoker(RLS 적용), anon 가능 | `{ items: Meeting[], total: int }`. `p_venue_id`는 마이그레이션 6에서 추가(공간 상세의 예정 모임) |
| `get_meeting(p_meeting_id uuid)` | security invoker, anon 가능 | `Meeting` 또는 null(없음·볼 수 없음). 취소·종료 모임도 반환 |
| `get_my_profile()` | definer, 로그인 필요 | `MyProfile` 또는 null(프로필 없음) |
| `get_my_participation(p_meeting_id uuid)` | definer, 로그인 필요 | `Participation` 또는 null. 모임장이면 role=host 행 |
| `list_my_meetings()` | definer, 로그인 필요 | `{ hosted: Meeting[], joined: { meeting: Meeting \| null, participation: Participation }[] }` |
| `list_meeting_participants(p_meeting_id uuid)` | definer, 모임장·관리자 | `(Participation & { nickname })[]`. 아니면 `NOT_HOST`(숨김 모임이면 `NOT_FOUND`) |

`list_public_meetings` 규칙:
- 공통 조건(명시 필터): `is_hidden = false`, `status <> 'cancelled'`, `start_at > now()`. 숨김 모임은 모임장·관리자에게도 목록에 나오지 않는다(상세 `get_meeting`으로만).
- 날짜 `[p_date_from, p_date_to)`(KST 하루 범위 변환은 프론트), 카테고리·권역 일치(없는 값이면 0건), `p_recruiting = true`면 `status = 'open' and remaining_seats > 0`.
- 검색어 `p_q`: 앞뒤 공백 제거, 최대 50자로 자름, `\`·`%`·`_`를 이스케이프한 뒤 `ilike ... escape '\'`로 제목·게임명(직접 입력 또는 games.name)·장소 메모·공간명(RLS상 보이는 공간만)·권역명 부분 일치. 프론트는 40자로 자르므로 DB 한도가 더 넉넉하다.
- 정렬 `soonest`(start_at 오름차순, id) | `newest`(created_at 내림차순, id). 그 외 값 → `VALIDATION_FAILED`(sort). limit 1~50으로 보정, offset 음수는 0.

### 9.17 공간 공개 조회 (마이그레이션 6)

| 함수 | 보안 | 반환 |
|---|---|---|
| `venue_to_json(v venues)` | security invoker, 순수 변환(`set timezone to 'UTC'`) | `Venue` = `{ id, name, regionCode, address, venueType, websiteUrl\|null, bookingUrl\|null, description, isPublic, infoVerifiedAt\|null, createdAt, updatedAt }` — 실시간 영업·좌석·가격 키 없음, created_by 미노출 |
| `list_public_venues(p_region text default null, p_type text default null)` | security invoker, anon 가능 | `Venue[]`. **공개 공간만**(`is_public` 명시 필터 — 관리자도 공개 화면에서는 공개만). 권역 정렬 → 이름 → id, 최대 200. 모르는 권역·유형은 0건(text 비교라 enum 캐스팅 오류 없음) |
| `get_venue(p_venue_id uuid)` | security invoker, anon 가능 | `Venue` 또는 null(없음·비공개 — 관리자도 null) |

### 9.18 관리자 테이블 직접 쓰기와 감사 트리거 (마이그레이션 7)

- 공간·카테고리·게임 쓰기는 기존 설계(§7·§8)대로 **테이블 직접 DML**이다(authenticated grant + RLS `is_admin()`). RPC가 아니므로 감사 기록은 트리거가 남긴다.
  - 일반 사용자: insert는 RLS with check 거부(42501), update·delete는 0행(오류 없음). anon은 grant 없음(42501).
- `_venues_before_write()`(before insert/update on venues, **security invoker**): 텍스트 앞뒤 공백 제거·빈 링크 null. API 요청(`auth.uid()` 있음)이면 insert 시 `created_by`를 요청자로 고정(입력값 무시), update 시 `created_by`·`created_at`·`id`를 원래 값으로 유지. SQL Editor(`auth.uid()` 없음)에서 넣은 값은 그대로. 형식 검사는 check 제약이 한다.
- `_audit_admin_table_change()`(after insert/update/delete on venues·categories·games, **security definer** — audit_logs insert 권한): §12의 `admin.venue_*`·`admin.category_*`·`admin.game_*`. meta는 바뀐 컬럼 이름 배열(`fields`, updated_at 제외)과 공개·활성 여부만 — 이름·주소·링크 같은 값은 남기지 않는다. 바뀐 컬럼이 없는 update는 기록하지 않는다. SQL Editor에서 고친 경우에도 actor_id null로 기록된다.
- 트리거 함수는 EXECUTE 권한이 없어도 실행된다(트리거 발동 시 EXECUTE를 검사하지 않음 — PGlite에서 일반 역할 DML로 확인).

## 10. 에러 코드

| 코드 | 의미 | 주로 발생 | detail |
|---|---|---|---|
| `AUTH_REQUIRED` | 로그인 필요 | 로그인 필요 RPC(authenticated 역할인데 sub 없음) | |
| `ACCOUNT_RESTRICTED` | 이용 제한 계정 | 생성·수정·마감·신청·승인·출석·프로필 | |
| `ACCOUNT_DELETION_REQUESTED` | 탈퇴 요청된 계정 | 모든 쓰기 RPC | |
| `PROFILE_INCOMPLETE` | 닉네임·약관 동의 전 | 생성·신청·신고·프로필 | `profile_missing`(프로필 행 없음) |
| `VALIDATION_FAILED` | 입력 검증 실패 | 전체 | 필드 이름(`title`, `start_at`, `game`, `sort` 등) |
| `HOLDEM_AGREEMENT_REQUIRED` | 홀덤 비금전 동의 누락 | 생성·수정 | |
| `NOT_FOUND` | 대상 없음 또는 볼 수 없음 | 전체 | |
| `NOT_HOST` | 모임장 아님 | 수정·취소·마감·승인·출석·참가자 목록 | |
| `NOT_ADMIN` | 관리자 아님 | `admin_*` | |
| `OWN_MEETING` | 본인 모임 신청·취소 시도 | 신청·신청 취소 | |
| `MEETING_NOT_OPEN` | 모임장이 모집 마감 / 모임장 계정 없음 | 신청 | `host_missing` |
| `MEETING_CANCELLED` | 취소된 모임 | 신청·수정·취소·마감·승인·출석 | |
| `MEETING_STARTED` | 이미 시작(관리자 취소는 종료 후) | 신청·신청 취소·수정·취소·마감·승인 | `ended`(관리자 취소) |
| `MEETING_FULL` | 자리 없음(대기 불가) | 신청·승인 | |
| `ALREADY_APPLIED` | 이미 신청함 | 신청 | |
| `APPLICATION_REJECTED` | 거절된 신청 재신청 | 신청 | |
| `NOT_APPLIED` | 취소할 신청 없음 | 신청 취소 | |
| `INVALID_STATE` | 허용되지 않는 상태 전이 | 승인·출석·신청 | 현재 참가 상태 |
| `CAPACITY_BELOW_CONFIRMED` | 확정 인원보다 작은 정원 | 수정 | `max_participants` |
| `ATTENDANCE_WINDOW_CLOSED` | 출석 체크 기간 아님 | 출석 | |
| `NICKNAME_TAKEN` | 닉네임 중복 | 프로필 | |
| `CANNOT_REPORT_SELF` | 본인·본인 모임 신고 | 신고 | |
| `DUPLICATE_REPORT` | 같은 대상 미처리 신고 존재 | 신고 | |
| `RATE_LIMITED` | 횟수 제한 | 생성·신고 | `create_24h`, `open_meetings`, `report_24h` |

- 위 코드는 모두 SQLSTATE `P0001` + `message = 코드`. supabase-js에서는 `error.code === 'P0001'`, `error.message`가 코드, `error.details`가 detail이다(PostgREST 응답 필드 이름 — 어댑터 구현 시 실제 응답으로 확인).
- 권한 없는 함수·테이블 접근(anon의 쓰기 RPC 호출, 직접 DML, `select *` on profiles/reports 등)은 SQLSTATE `42501` → 프론트 `PERMISSION_DENIED`.

## 11. 레이트 리밋 (DB 기준, 롤링 24시간)

| 대상 | 한도 | 기준 |
|---|---|---|
| 모임 생성 | 24시간 5개 | `meetings.created_at > now() - interval '24 hours'`(취소 포함) |
| 진행 예정 주최 모임 | 동시에 10개 | `status in (open, closed) and start_at > now()` |
| 신고 | 24시간 10건 | `reports.created_at` |

- 같은 사용자의 동시 호출이 집계를 빠져나가지 않도록 생성·신고는 사용자 단위 `pg_advisory_xact_lock`으로 직렬화한다.

## 12. 감사 로그 action

| action | target_type / target_id | meta |
|---|---|---|
| `meeting.create` | meeting / 모임 id | category_id, start_at |
| `meeting.update` | meeting | fields(바뀐 필드 이름 배열), 일시 변경 시 start_at_before·start_at_after |
| `meeting.cancel` | meeting | by_admin, affected_guests, (탈퇴 처리 시) source=account_deletion |
| `meeting.recruiting` | meeting | from, to |
| `participant.apply` | meeting | status, reapply |
| `participant.cancel` | meeting | from |
| `participant.decide` | participant / 참가 행 id | meeting_id, from, to |
| `participant.attendance` | participant | meeting_id, attendance |
| `profile.nickname_change` | user | onboarding |
| `account.deletion_requested` | user | cancelled_applications, cancelled_meetings |
| `admin.report_update` | report | from, to |
| `admin.meeting_hidden` | meeting | hidden |
| `admin.user_status` | user | from, to, note |
| `admin.venue_create` / `admin.venue_update` / `admin.venue_delete` (트리거) | venue / 공간 id | (update) fields, (insert·update) is_public |
| `admin.category_create` / `_update` / `_delete` (트리거) | category / 카테고리 id | (update) fields, is_active |
| `admin.game_create` / `_update` / `_delete` (트리거) | game / 게임 id | (update) fields, is_active |

- SQL Editor 수동 기록: `admin.role_grant`, `admin.role_revoke`([DEPLOYMENT §3.4](./DEPLOYMENT.md#34-최초-관리자-지정)).
- `meta`에는 상태값·필드 이름·시각만 담고 신청 메시지·신고 본문·이메일·닉네임은 넣지 않는다. 예외: `admin.user_status`의 `note`는 관리자가 작성한 처리 메모다(이용자 입력 아님, ≤200). 숨김 사유·취소 사유는 meetings 컬럼에만 저장한다.

## 13. 탈퇴·삭제와 FK 동작

| 관계 | on delete | 결과 |
|---|---|---|
| `auth.users` → profiles, user_private, admin_roles | cascade | 계정 삭제 시 함께 삭제 |
| profiles → meetings.host_id | **set null** | 탈퇴자의 지난 모임과 다른 참가자 기록이 남는다. 화면에는 "탈퇴한 사용자"(`hostId`/`hostNickname` = null). 미래 모임은 탈퇴 요청 때 이미 취소됨. 탈퇴 요청 없이 계정이 삭제된 미래 모임은 신청 불가(`MEETING_NOT_OPEN`/`host_missing`) |
| profiles → meeting_participants.user_id | cascade | 탈퇴자의 참가 기록(모임장 행 포함) 삭제. 지난 모임의 카운트는 보정하지 않음 |
| profiles/meetings → reports 대상·신고자 | set null | 신고 기록은 남고 대상 참조만 끊김 |
| venues → meetings.venue_id | restrict | 공간은 삭제 대신 `is_public=false`. 비공개 공간의 이름은 anon 목록·상세에서 null(관리자·definer 조회에서는 보임) |

## 14. seed 정책

- `supabase/seed.sql`은 **개발 전용**이다. 첫 줄: `-- 운영 DB 적용 금지: 개발 전용 seed (HANPAN_DEV_SEED_MARKER)`.
- 내용: 예시 사용자 4명(`auth.users` insert — 로컬 Supabase CLI 전용. 로그인 수단 없음, 이메일 `*@example.invalid`), 그중 1명 최초 설정 전·1명 개발용 관리자, 예시 공간 2개(공개·비공개), 예시 모임 5개(자동·승인제·정원 마감·모임장 마감·지난 모임, 시각은 실행 시점 KST 기준 상대값), 게스트 신청 몇 건. 모든 예시 텍스트에 `[예시]` 또는 `dev` 표시. 고정 id + `on conflict do nothing`으로 멱등, 마지막에 카운트 재집계.
- 마이그레이션에는 regions·categories 같은 기준 데이터만 넣는다. 테스트가 마이그레이션에 seed 마커·`[예시]`·`auth.users` insert가 없음과, 마이그레이션만 적용한 DB가 0행임을 확인한다.
- `미확인:` Supabase CLI 버전에 따라 `supabase db reset`이 seed.sql을 자동 적용한다(로컬 전용). 원격 적용 시 seed 포함 옵션이 있을 수 있다. 운영 프로젝트에는 seed 옵션을 쓰지 않는다.

## 15. DB 테스트 하네스 (PGlite)

- 파일: `supabase/tests/harness.ts`, 설정 `vitest.db.config.ts`, 타입 검사 `tsconfig.db.json`. 실행 `npm run test:db`.
- PGlite(`@electric-sql/pglite` 0.6, WASM PostgreSQL 19) 인스턴스에 먼저 Supabase 스텁을 만든다(`SUPABASE_STUB_SQL`): 역할 `anon`·`authenticated`·`service_role`·`supabase_auth_admin`(nologin), `auth` 스키마, `auth.users`(id, email, raw_user_meta_data 등 seed가 쓰는 컬럼), Supabase와 같은 정의의 `auth.uid()`·`auth.role()`·`auth.jwt()`(`request.jwt.claim.sub`와 `request.jwt.claims`의 sub를 모두 읽고 각각 `nullif(..., '')`), Supabase식 public 기본 권한(새 객체를 API 역할에 모두 부여 — 마이그레이션이 이를 회수하는지 검증하려고).
- 이후 `supabase/migrations/*.sql`을 파일명 순서로 적용한 인스턴스를 템플릿으로 캐시하고, 테스트마다 `clone()`으로 독립 DB를 쓴다(약 0.2초).
- 사용자 전환: 트랜잭션 안에서 `select set_config('request.jwt.claims', '{"sub":"<uuid>","role":"authenticated"}', true)` + `set local role authenticated`(`asUser`), anon은 `{"role":"anon"}` + `set local role anon`(`asAnon`), 픽스처는 소유자(`asOwner`).
- 가입은 `supabase_auth_admin` 역할로 `auth.users`에 insert → 트리거가 프로필을 만든다(`createUser`). 시작 이후·종료 후 같은 시각 픽스처는 소유자 권한으로 직접 insert/update 한다(`insertMeeting`, `insertParticipant`, `moveMeeting`).
- PGlite 확인 결과와 한계: [TEST_PLAN §5.1](./TEST_PLAN.md#51-pglite-검증-결과와-한계).
- 동시성: PGlite는 단일 백엔드라 진짜 동시 신청 경쟁을 재현할 수 없다. 대신 (1) 순차 신청 시 정원 초과 없음, (2) `pg_get_functiondef`에 모임 행 `for update`가 있고 참가 행 잠금보다 먼저임, (3) check 제약이 초과 확정을 막음을 검증하고, 동시성은 `scripts/race-test.ts`로 실제 Postgres에서 확인한다(`BLOCKED:` DB 필요) → [TEST_PLAN §4](./TEST_PLAN.md#4-실제-supabase가-필요한-항목-blocked).

## 16. 미결 사항

결정 완료(이 문서와 SQL에 반영):

| 항목 | 결정 |
|---|---|
| `recruiting=1` 필터(PostgREST 컬럼 간 비교 불가) | `remaining_seats` STORED 생성 컬럼 + `list_public_meetings` RPC |
| 탈퇴자 모임의 다른 참가자 기록 | `meetings.host_id` nullable + `on delete set null` |
| `profiles.status` 공개 여부 | 공개 grant에서 제외(컬럼 단위 grant), 본인은 `get_my_profile()`, 관리자는 `admin_search_users()` |
| `search_path` | 모든 함수 `public, pg_temp` |
| `game_id`·`game_name` 동시 지정 | `VALIDATION_FAILED`(detail `game`) + DB check |
| 공개 목록·상세 조회 방식 | `list_public_meetings`·`get_meeting`(security invoker, jsonb) |
| 내 모임·참가자 목록·내 참가 상태 | `list_my_meetings`, `list_meeting_participants`, `get_my_participation` |
| reports의 `admin_note`가 신고자에게 읽힘 | 컬럼 단위 grant로 제외 + `admin_list_reports()` |
| 신고 대상 "정확히 하나" check와 계정 삭제 시 `set null` 충돌 | 유형-컬럼 일치 check + RPC에서 비어 있지 않음 강제 |
| 탈퇴 닉네임 "탈퇴한 사용자"와 닉네임 유니크 충돌 | 부분 유니크 인덱스 |
| 스토리지 | 버킷 없음(§18) |
| 닉네임 예약어 범위 | 포함 금지(관리자·운영자·운영팀·admin·hanpan) + 완전 일치 금지(한판·탈퇴한사용자). 마이그레이션 5, 프론트와 같은 규칙(§9.12) |
| `Meeting.hostId`/`hostNickname` 타입 | 프론트 타입을 `string \| null`로 변경. null이면 화면에 "탈퇴한 사용자", 상세 CTA는 신청 대신 마감 표시 |
| 공간 상세의 예정 모임 | 클라이언트에서 거르지 않고 `list_public_meetings(p_venue_id)`(마이그레이션 6) |
| 관리자 모임 목록(숨김·취소·종료 포함) | `admin_list_meetings`(마이그레이션 7) |
| 관리자 신고 목록의 대상 이름 | `admin_list_report_items`(jsonb, 대상 제목·닉네임 포함). 기존 `admin_list_reports`(행)는 유지 |
| 공간·카테고리 쓰기 경로 | 기존 설계대로 테이블 직접 DML(RLS) + 감사 트리거. 관리자 조회만 RPC(NOT_ADMIN 일관) |
| 닉네임 예약어 `운영진` | 포함 금지로 다시 추가(마이그레이션 8) |

남은 항목:

| 항목 | 현재 처리 / 제안 |
|---|---|
| 확정 게스트를 모임장이 제외하는 기능 | MVP 제외. 필요 시 신고·관리자 처리 |
| restricted 계정의 기존 주최 모임 | 자동 취소하지 않고 관리자가 숨김·취소 판단 |
| 탈퇴 요청 없이 auth.users가 삭제된 미래 모임 | 신청만 막음(`host_missing`). 공개 목록에서 뺄지, 자동 취소할지 결정 필요 |
| 실제 Supabase에서의 GRANT·RLS·트리거 재확인 | `BLOCKED:` 개발용 프로젝트 필요 |

## 17. 프론트 어댑터용 RPC 시그니처 요약

supabase-js: `supabase.rpc('<name>', { p_...: value })`. 인자 이름은 아래와 같다. 반환 jsonb 키는 camelCase.
구현: `src/data/supabase/adapter.ts`(인자 변환 `rpcArgs.ts`, 응답 검증 `mapping.ts`, 오류 `errors.ts`). 인자 이름·jsonb 키·응답 모양은 PGlite 계약 테스트(`supabase/tests/adapter-contract.test.ts`)가 실제 함수로 확인한다.

```
Meeting = {
  id, hostId|null, hostNickname|null, categoryId, gameId|null, gameName|null, title, description, notice|null,
  startAt, endAt, durationMinutes, regionCode, venueId|null, venueName|null, venueNote|null,
  minParticipants, maxParticipants, confirmedCount, pendingCount, waitlistCount, remainingSeats,
  skillLevel, approvalMode, allowWaitlist, status, isHidden, hiddenReason|null, cancelReason|null,
  cancelledAt|null, imageUrl(null 고정), createdAt, updatedAt
}
Participation = {
  id, meetingId, userId, role, status, attendance, message|null,
  appliedAt, decidedAt|null, confirmedAt|null, cancelledAt|null, attendanceMarkedAt|null, updatedAt
}
MyProfile = {
  id, nickname, regionCode|null, bio, favoriteCategoryIds[], status, termsAgreedAt|null, privacyAgreedAt|null,
  deletionRequestedAt|null, onboarded, isAdmin, createdAt
}
```

| 어댑터 메서드 | RPC 호출 | 반환 |
|---|---|---|
| `listMeetings(filters, page)` | `list_public_meetings({ p_date_from, p_date_to, p_category, p_region, p_q, p_recruiting, p_sort, p_limit, p_offset })` | `{ items: Meeting[], total }` |
| `getMeeting(id)` | `get_meeting({ p_meeting_id })` | `Meeting \| null` |
| `listCategories()` / `listRegions()` | 테이블 select `categories`/`regions` (`order by sort_order`) | 행 |
| `getMyParticipation(meetingId)` | `get_my_participation({ p_meeting_id })` | `Participation \| null` |
| `applyToMeeting(meetingId, message)` | `apply_to_meeting({ p_meeting_id, p_message })` | `'confirmed' \| 'pending' \| 'waitlisted'` |
| `cancelMyApplication(meetingId)` | `cancel_my_application({ p_meeting_id })` | void |
| `createMeeting(input)` | `create_meeting({ p: { category_id, game_name, title, description, notice, start_at, duration_minutes, region_code, venue_id, venue_note, min_participants, max_participants, skill_level, approval_mode, allow_waitlist, holdem_policy_agreed } })` | uuid |
| `updateMeeting(id, input)` | `update_meeting({ p_meeting_id, p: 위와 같은 전체 값 })` | void |
| `cancelMeeting(id, reason)` | `cancel_meeting({ p_meeting_id, p_reason })` | void |
| `setMeetingRecruiting(id, open)` | `set_meeting_recruiting({ p_meeting_id, p_open })` | void |
| `listMyMeetings()` | `list_my_meetings()` | `{ hosted: Meeting[], joined: { meeting: Meeting \| null, participation: Participation }[] }` |
| `listParticipants(meetingId)` | `list_meeting_participants({ p_meeting_id })` | `(Participation & { nickname })[]` |
| `decideParticipant(id, decision)` | `decide_participant({ p_participant_id, p_decision })` | `'confirmed' \| 'rejected'` |
| `markAttendance(id, value)` | `mark_attendance({ p_participant_id, p_attendance })` | void |
| `getMyProfile()` | `get_my_profile()` | `MyProfile \| null` |
| `updateMyProfile(patch)` | `update_my_profile({ p: { nickname, region_code, bio, favorite_category_ids, agree_terms, agree_privacy } })` — 바꿀 키만 | void |
| `requestAccountDeletion()` | `request_account_deletion()` | void |
| `listVenues({ region?, type? })` | `list_public_venues({ p_region, p_type })` — 모르는 값은 생략 | `Venue[]` |
| `getVenue(id)` | `get_venue({ p_venue_id })` — uuid가 아니면 요청 없이 null | `Venue \| null` |
| `listMeetings({ venueId })` | `list_public_meetings({ ..., p_venue_id })` | 위와 같음 |
| `submitReport({ targetType, targetId, reason, body })` | `submit_report({ p_target_type, p_target_id, p_reason, p_body })` | uuid |
| `adminListReports({ status? }, page)` | `admin_list_report_items({ p_status, p_limit, p_offset })` | `{ items: AdminReport[], total }` |
| `adminUpdateReport(id, status, note)` | `admin_update_report({ p_report_id, p_status, p_admin_note })` | void |
| `adminListMeetings({ q?, hiddenOnly? }, page)` | `admin_list_meetings({ p_q, p_hidden_only, p_limit, p_offset })` | `{ items: AdminMeeting[], total }` |
| `adminSetMeetingHidden(id, hidden, reason)` | `admin_set_meeting_hidden({ p_meeting_id, p_hidden, p_reason })` | void |
| `adminCancelMeeting(id, reason)` | `cancel_meeting({ p_meeting_id, p_reason })`(관리자는 종료 전까지). 공용 RPC가 관리자 아닌 호출자에게 주는 `NOT_HOST`는 어댑터가 `NOT_ADMIN`으로 바꾼다(cause 보존, mock과 같은 코드). 그 밖의 코드는 그대로 | void |
| `adminSearchUsers(query)` | `admin_search_users({ p_query, p_limit: 20 })` — 행 snake_case | `AdminUser[]` |
| `adminSetUserStatus(id, status, note)` | `admin_set_user_status({ p_user_id, p_status, p_note })` | void |
| `adminListVenues()` / `adminListCategories()` | `admin_list_venues()` / `admin_list_categories()` | `Venue[]` / `AdminCategory[]` |
| `adminSaveVenue(id \| null, input)` | 테이블: `venues.insert(row).select('id')` 또는 `venues.update(row).eq('id', id).select('id')`. row = `{ name, region_code, address, venue_type, website_url, booking_url, description, is_public, info_verified_at }`(created_by 등은 보내지 않음) | id |
| `adminSetVenuePublic(id, isPublic)` / `adminSetCategoryActive(id, isActive)` | 테이블: `venues.update({ is_public })` / `categories.update({ is_active })` `.eq('id', id).select('id')` | void |

- 비로그인 상태에서 로그인 필요 RPC를 부르면 42501(권한 오류)이다. 어댑터는 세션이 없으면 `getMyProfile`·`getMyParticipation`을 호출하지 않고 null을, 그 밖의 로그인 필요 메서드는 호출 없이 `AUTH_REQUIRED`를 돌려준다.
- uuid 형식이 아닌 id는 요청하지 않는다(조회 null, 쓰기 `NOT_FOUND`). PostgREST의 `22P02`(잘못된 uuid) 오류를 피하려는 것이다.
- `listMeetings`의 `date`는 `kstDayRange`로 `p_date_from`/`p_date_to`(UTC ISO)로 바꾸고, 빈 필터는 생략한다. `p_sort`·`p_limit`(1~50 보정)·`p_offset`은 항상 보낸다.
- `create_meeting`/`update_meeting`의 `p`는 항상 17개 키 전체를 보낸다(`start_at`은 오프셋 포함 ISO → UTC `Z`로 정규화, 오프셋 없는 값은 보내지 않고 `VALIDATION_FAILED`(start_at)). `game_id`(Phase 4): 등록된 게임에 연결된 모임을 수정하면서 게임명을 바꾸지 않았으면 `game_id` = 원래 id, `game_name` = null로 연결을 유지한다. 게임명을 바꾸거나 비우면 `game_id` = null + `game_name`(직접 입력). 그 밖에는 항상 `game_id: null`. 둘을 동시에 보내지 않는다(`VALIDATION_FAILED`/game).
- 관리자 테이블 쓰기 오류: check·not null·FK·enum 위반(23514·23502·23503·22P02 등) → `VALIDATION_FAILED`(detail은 오류 메시지의 제약·컬럼 **이름**에서만 — 예 `venues_website_url_format` → `website_url`; 입력 행 값이 담긴 details는 쓰지 않음), 42501 → `NOT_ADMIN`. RLS에 막힌 update는 0행이므로 `is_admin()`을 불러 `NOT_ADMIN`/`NOT_FOUND`를 가른다(안내용, 경계 아님).
- void 함수의 응답 본문은 쓰지 않는다. 시각은 응답 검증 때 `YYYY-MM-DDTHH:mm:ss.sssZ`로 정규화한다(마이크로초는 밀리초로 자름).
- `MyParticipation`(src/data/types.ts)은 `Participation`의 부분집합이라 그대로 쓸 수 있다. `Participant`는 `list_meeting_participants` 원소와 같다.

## 18. 스토리지

- 이미지 업로드를 구현하지 않으므로 Supabase Storage 버킷과 정책을 만들지 않는다. `Meeting.imageUrl`은 항상 null이다.
- 업로드를 도입할 때는 버킷·RLS(소유자만 쓰기, 공개 읽기 범위)·용량 제한·이미지 검수 정책을 먼저 이 문서에 추가한다.
