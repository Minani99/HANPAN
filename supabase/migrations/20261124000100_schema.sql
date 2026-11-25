-- HANPAN 마이그레이션 1/4: enum, 테이블, 제약조건, 인덱스
-- 명세: docs/DB_SCHEMA.md §1~§2, §4, §13
-- 전제: auth 스키마와 auth.users는 Supabase가 제공한다(이 파일에서 만들지 않는다).
--       DB 테스트 하네스(supabase/tests/harness.ts)는 같은 이름의 스텁을 먼저 만든다.
-- 권한(GRANT)·RLS는 마이그레이션 2, 함수·RPC는 3, 기준 데이터는 4.

-- ---------------------------------------------------------------------------
-- 1. enum
-- ---------------------------------------------------------------------------
create type public.meeting_status as enum ('open', 'closed', 'cancelled');
create type public.skill_level as enum ('beginner_welcome', 'anyone', 'experienced');
create type public.approval_mode as enum ('auto', 'manual');
create type public.participant_role as enum ('host', 'guest');
create type public.participant_status as enum (
  'pending', 'confirmed', 'waitlisted', 'rejected', 'cancelled', 'meeting_cancelled'
);
create type public.attendance_status as enum ('unknown', 'attended', 'absent');
create type public.account_status as enum ('active', 'restricted', 'deletion_requested');
create type public.venue_type as enum ('board_game_cafe', 'party_room', 'other');
create type public.report_target as enum ('meeting', 'user');
create type public.report_reason as enum (
  'spam', 'inappropriate', 'gambling', 'harassment', 'no_show', 'commercial', 'other'
);
create type public.report_status as enum ('received', 'reviewing', 'resolved', 'dismissed');

-- ---------------------------------------------------------------------------
-- 2. 기준 데이터 테이블
-- ---------------------------------------------------------------------------
create table public.regions (
  code text primary key,
  name text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  constraint regions_code_format check (code ~ '^[a-z_]{2,40}$'),
  constraint regions_name_length check (char_length(name) between 1 and 20)
);

create table public.categories (
  id text primary key,
  name text not null,
  description text not null default '',
  sort_order int not null default 0,
  is_active boolean not null default true,
  constraint categories_id_format check (id ~ '^[a-z_]{2,40}$'),
  constraint categories_name_length check (char_length(name) between 1 and 20),
  constraint categories_description_length check (char_length(description) <= 200)
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category_id text not null references public.categories (id) on delete restrict,
  min_players int,
  max_players int,
  play_minutes int,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint games_name_length check (char_length(name) between 1 and 60),
  constraint games_min_players_range check (min_players is null or min_players between 1 and 99),
  constraint games_max_players_range check (max_players is null or max_players between 1 and 99),
  constraint games_players_order check (
    min_players is null or max_players is null or min_players <= max_players
  ),
  constraint games_play_minutes_range check (play_minutes is null or play_minutes between 1 and 1440)
);
create unique index games_name_lower_key on public.games (lower(name));
create index games_category_idx on public.games (category_id);

-- ---------------------------------------------------------------------------
-- 3. 사용자
-- ---------------------------------------------------------------------------
-- 공개 가능한 필드만 둔다. 이메일·실명·전화번호는 저장하지 않는다.
-- status 컬럼은 공개 조회 컬럼 grant에서 제외한다(마이그레이션 2).
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null,
  region_code text references public.regions (code) on delete set null,
  bio text not null default '',
  favorite_category_ids text[] not null default '{}',
  status public.account_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_nickname_length check (char_length(nickname) between 2 and 20),
  constraint profiles_bio_length check (char_length(bio) <= 200),
  constraint profiles_favorite_categories_max check (cardinality(favorite_category_ids) <= 6)
);
-- 탈퇴 요청 계정은 모두 "탈퇴한 사용자"로 표시되므로 유니크 대상에서 뺀다.
create unique index profiles_nickname_lower_key
  on public.profiles (lower(nickname))
  where status <> 'deletion_requested';

-- 본인만 조회.
create table public.user_private (
  user_id uuid primary key references auth.users (id) on delete cascade,
  terms_agreed_at timestamptz,
  privacy_agreed_at timestamptz,
  deletion_requested_at timestamptz,
  created_at timestamptz not null default now()
);

-- anon/authenticated 권한·정책 없음. SQL Editor(서비스 권한)로만 쓴다.
create table public.admin_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'admin',
  granted_at timestamptz not null default now(),
  granted_by uuid,
  note text,
  constraint admin_roles_role_value check (role = 'admin'),
  constraint admin_roles_note_length check (note is null or char_length(note) <= 200)
);

-- ---------------------------------------------------------------------------
-- 4. 공간 (실시간 영업 상태·좌석·가격 필드를 두지 않는다)
-- ---------------------------------------------------------------------------
create table public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  region_code text not null references public.regions (code) on delete restrict,
  address text not null,
  venue_type public.venue_type not null,
  website_url text,
  booking_url text,
  description text not null default '',
  is_public boolean not null default false,
  info_verified_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint venues_name_length check (char_length(name) between 1 and 60),
  constraint venues_address_length check (char_length(address) between 1 and 200),
  constraint venues_website_url_format check (
    website_url is null or (website_url ~ '^https://' and char_length(website_url) <= 500)
  ),
  constraint venues_booking_url_format check (
    booking_url is null or (booking_url ~ '^https://' and char_length(booking_url) <= 500)
  ),
  constraint venues_description_length check (char_length(description) <= 1000)
);
create index venues_region_idx on public.venues (region_code);
create index venues_is_public_idx on public.venues (is_public);

-- ---------------------------------------------------------------------------
-- 5. 모임
-- ---------------------------------------------------------------------------
create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  -- 탈퇴(계정 삭제)한 모임장의 지난 모임과 다른 참가자 기록을 보존하기 위해 set null.
  -- RPC는 생성 시 항상 host_id를 채운다. null이면 화면에 "탈퇴한 사용자".
  host_id uuid references public.profiles (id) on delete set null,
  category_id text not null references public.categories (id) on delete restrict,
  game_id uuid references public.games (id) on delete set null,
  game_name text,
  title text not null,
  description text not null default '',
  notice text,
  start_at timestamptz not null,
  -- timestamptz + interval은 IMMUTABLE이 아니라서 생성 컬럼으로 만들 수 없다. RPC가 계산한다.
  end_at timestamptz not null,
  duration_minutes int not null,
  region_code text not null references public.regions (code) on delete restrict,
  venue_id uuid references public.venues (id) on delete restrict,
  venue_note text,
  min_participants int not null,
  max_participants int not null,
  skill_level public.skill_level not null,
  approval_mode public.approval_mode not null,
  allow_waitlist boolean not null default true,
  status public.meeting_status not null default 'open',
  is_hidden boolean not null default false,
  hidden_reason text,
  -- 비정규화 카운트(모임장 포함). RPC만 갱신한다.
  confirmed_count int not null default 1,
  pending_count int not null default 0,
  waitlist_count int not null default 0,
  -- 모집 중 필터용(PostgREST는 컬럼끼리 비교 필터를 지원하지 않는다). STORED를 명시한다
  -- (PostgreSQL 18부터 생성 컬럼 기본값이 VIRTUAL).
  remaining_seats int generated always as (max_participants - confirmed_count) stored,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meetings_game_name_length check (game_name is null or char_length(game_name) between 1 and 40),
  constraint meetings_game_source check (game_id is null or game_name is null),
  constraint meetings_title_length check (char_length(title) between 2 and 60),
  constraint meetings_description_length check (char_length(description) <= 2000),
  constraint meetings_notice_length check (notice is null or char_length(notice) <= 1000),
  constraint meetings_end_after_start check (end_at > start_at),
  constraint meetings_duration_range check (duration_minutes between 30 and 720),
  constraint meetings_venue_note_length check (venue_note is null or char_length(venue_note) <= 60),
  constraint meetings_min_participants_floor check (min_participants >= 2),
  constraint meetings_max_participants_ceiling check (max_participants <= 30),
  constraint meetings_participants_order check (min_participants <= max_participants),
  constraint meetings_hidden_reason_length check (hidden_reason is null or char_length(hidden_reason) <= 200),
  -- 정원 초과 확정의 마지막 방어선.
  constraint meetings_confirmed_count_range check (confirmed_count between 0 and max_participants),
  constraint meetings_pending_count_floor check (pending_count >= 0),
  constraint meetings_waitlist_count_floor check (waitlist_count >= 0),
  constraint meetings_cancelled_consistency check ((status = 'cancelled') = (cancelled_at is not null)),
  constraint meetings_cancel_reason_length check (cancel_reason is null or char_length(cancel_reason) <= 200)
);
create index meetings_start_at_idx on public.meetings (start_at);
create index meetings_region_start_idx on public.meetings (region_code, start_at);
create index meetings_category_start_idx on public.meetings (category_id, start_at);
create index meetings_host_idx on public.meetings (host_id);
create index meetings_created_at_idx on public.meetings (created_at);

create table public.meeting_participants (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.participant_role not null,
  status public.participant_status not null,
  attendance public.attendance_status not null default 'unknown',
  message text,
  applied_at timestamptz not null default now(),
  decided_at timestamptz,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  attendance_marked_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint meeting_participants_meeting_user_key unique (meeting_id, user_id),
  constraint meeting_participants_host_confirmed check (role <> 'host' or status = 'confirmed'),
  constraint meeting_participants_message_length check (message is null or char_length(message) <= 200)
);
-- 모임당 모임장 1명
create unique index meeting_participants_one_host_key
  on public.meeting_participants (meeting_id)
  where role = 'host';
create index meeting_participants_user_status_idx on public.meeting_participants (user_id, status);
create index meeting_participants_meeting_status_idx on public.meeting_participants (meeting_id, status);

-- ---------------------------------------------------------------------------
-- 6. 신고·감사 로그
-- ---------------------------------------------------------------------------
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles (id) on delete set null,
  target_type public.report_target not null,
  target_meeting_id uuid references public.meetings (id) on delete set null,
  target_user_id uuid references public.profiles (id) on delete set null,
  reason public.report_reason not null,
  body text not null default '',
  status public.report_status not null default 'received',
  admin_note text,
  handled_by uuid references auth.users (id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  -- "대상이 정확히 하나"는 접수 RPC가 강제한다. 여기서는 유형-컬럼 일치만 본다
  -- (대상 삭제 시 set null이 check에 걸려 계정 삭제가 막히지 않도록).
  constraint reports_target_shape check (
    (target_type = 'meeting' and target_user_id is null)
    or (target_type = 'user' and target_meeting_id is null)
  ),
  constraint reports_body_length check (char_length(body) <= 1000),
  constraint reports_admin_note_length check (admin_note is null or char_length(admin_note) <= 1000)
);
create unique index reports_open_dedupe_key
  on public.reports (reporter_id, target_type, coalesce(target_meeting_id, target_user_id))
  where status in ('received', 'reviewing');
create index reports_status_created_idx on public.reports (status, created_at);
create index reports_reporter_created_idx on public.reports (reporter_id, created_at);
create index reports_target_user_idx on public.reports (target_user_id);

-- security definer 함수만 기록하고 관리자만 조회한다. meta에 신청 메시지·신고 본문·이메일을 넣지 않는다.
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  target_type text not null,
  target_id text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at);
create index audit_logs_target_idx on public.audit_logs (target_type, target_id);

-- ---------------------------------------------------------------------------
-- 7. 모든 테이블 RLS 활성화 (정책은 마이그레이션 2)
-- ---------------------------------------------------------------------------
alter table public.regions enable row level security;
alter table public.categories enable row level security;
alter table public.games enable row level security;
alter table public.profiles enable row level security;
alter table public.user_private enable row level security;
alter table public.admin_roles enable row level security;
alter table public.venues enable row level security;
alter table public.meetings enable row level security;
alter table public.meeting_participants enable row level security;
alter table public.reports enable row level security;
alter table public.audit_logs enable row level security;
