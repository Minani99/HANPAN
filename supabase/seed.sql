-- 운영 DB 적용 금지: 개발 전용 seed (HANPAN_DEV_SEED_MARKER)
--
-- 이 파일은 로컬 개발 DB(Supabase CLI의 `supabase db reset`, PGlite 테스트)에서만 쓴다.
-- 운영 프로젝트의 SQL Editor에서 실행하거나 `db push`에 seed 옵션을 붙이지 않는다(docs/DEPLOYMENT.md §3).
-- 모든 예시 데이터는 제목·닉네임·장소에 '[예시]' 또는 'dev' 표시가 있다. 실제 이용자·모임·공간이 아니다.
--
-- auth.users insert는 로컬 Supabase(CLI) 전용이다. 호스팅 프로젝트의 auth.users에 직접 넣지 않는다.
-- 예시 계정은 화면 데이터 표시용이며 로그인 수단(비밀번호·OAuth 연결)이 없다.
-- 마이그레이션(supabase/migrations)이 먼저 적용되어 있어야 한다. 여러 번 실행해도 중복되지 않는다.

begin;

-- ---------------------------------------------------------------------------
-- 1. 예시 사용자 (handle_new_user 트리거가 profiles·user_private를 만든다)
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'd0000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'dev-host@example.invalid', '', now(), '{"provider":"dev"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd0000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'dev-guest@example.invalid', '', now(), '{"provider":"dev"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd0000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'dev-newbie@example.invalid', '', now(), '{"provider":"dev"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd0000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
   'dev-admin@example.invalid', '', now(), '{"provider":"dev"}', '{}', now(), now())
on conflict (id) do nothing;

-- 온보딩 완료 상태로 맞춘다(dev-newbie는 최초 설정 전 상태로 둔다).
update public.profiles p
set nickname = v.nickname, region_code = v.region_code, bio = v.bio
from (values
  ('d0000000-0000-4000-8000-000000000001'::uuid, 'dev모임장', 'dunsan_tanbang', '[예시] 개발용 계정입니다.'),
  ('d0000000-0000-4000-8000-000000000002'::uuid, 'dev참가자', 'gung_bongmyeong', '[예시] 개발용 계정입니다.'),
  ('d0000000-0000-4000-8000-000000000004'::uuid, 'dev운영', null, '[예시] 개발용 관리자 계정입니다.')
) as v (id, nickname, region_code, bio)
where p.id = v.id;

update public.user_private
set terms_agreed_at = coalesce(terms_agreed_at, now()),
    privacy_agreed_at = coalesce(privacy_agreed_at, now())
where user_id in (
  'd0000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000002',
  'd0000000-0000-4000-8000-000000000004'
);

-- 개발용 관리자 (운영에서는 docs/DEPLOYMENT.md §6 절차로만 지정)
insert into public.admin_roles (user_id, note)
values ('d0000000-0000-4000-8000-000000000004', '[예시] 개발용 관리자 (seed)')
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. 예시 공간 (가상)
-- ---------------------------------------------------------------------------
insert into public.venues (id, name, region_code, address, venue_type, description, is_public)
values
  ('d1000000-0000-4000-8000-000000000001', '[예시] 보드게임 카페 (가상)', 'dunsan_tanbang',
   '[예시] 대전 서구 둔산동 (가상 주소)', 'board_game_cafe', '[예시] 개발용 가상 공간입니다. 실제 영업 정보가 아닙니다.', true),
  ('d1000000-0000-4000-8000-000000000002', '[예시] 비공개 파티룸 (가상)', 'gung_bongmyeong',
   '[예시] 대전 유성구 궁동 (가상 주소)', 'party_room', '[예시] 비공개 상태 예시', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. 예시 모임 (시각은 실행 시점 기준 KST 상대값)
-- ---------------------------------------------------------------------------
with kst as (
  select date_trunc('day', now() at time zone 'Asia/Seoul') as today
),
src (id, host_id, category_id, game_name, title, day_offset, hour, duration, region_code, venue_id, venue_note,
     min_p, max_p, skill, approval, waitlist, status) as (
  values
    ('d2000000-0000-4000-8000-000000000001'::uuid, 'd0000000-0000-4000-8000-000000000001'::uuid, 'party', '할리갈리',
     '[예시] 퇴근 후 가볍게 파티게임', 2, 19, 150, 'dunsan_tanbang', 'd1000000-0000-4000-8000-000000000001'::uuid, null,
     3, 6, 'beginner_welcome', 'auto', true, 'open'),
    ('d2000000-0000-4000-8000-000000000002'::uuid, 'd0000000-0000-4000-8000-000000000001'::uuid, 'strategy', '테라포밍 마스',
     '[예시] 주말 전략게임 한 판 (승인제)', 4, 14, 240, 'dunsan_tanbang', null, '[예시] 둔산동 카페 미정',
     3, 4, 'experienced', 'manual', true, 'open'),
    ('d2000000-0000-4000-8000-000000000003'::uuid, 'd0000000-0000-4000-8000-000000000001'::uuid, 'deduction', null,
     '[예시] 마피아 소규모 (정원 마감)', 3, 20, 120, 'gung_bongmyeong', null, '[예시] 궁동 근처',
     2, 2, 'anyone', 'auto', false, 'open'),
    ('d2000000-0000-4000-8000-000000000004'::uuid, 'd0000000-0000-4000-8000-000000000001'::uuid, 'mahjong_etc', '리치 마작',
     '[예시] 마작 모임 (모집 마감)', 5, 18, 180, 'noeun_jijok', null, null,
     4, 4, 'anyone', 'auto', true, 'closed'),
    ('d2000000-0000-4000-8000-000000000005'::uuid, 'd0000000-0000-4000-8000-000000000001'::uuid, 'party', '딕싯',
     '[예시] 지난 모임 (출석 체크 예시)', -1, 19, 120, 'eunhaeng_daeheung', null, null,
     2, 5, 'anyone', 'auto', true, 'open')
)
insert into public.meetings (
  id, host_id, category_id, game_name, title, description, start_at, end_at, duration_minutes,
  region_code, venue_id, venue_note, min_participants, max_participants, skill_level, approval_mode,
  allow_waitlist, status
)
select
  s.id, s.host_id, s.category_id, s.game_name, s.title, '[예시] 개발용 예시 모임입니다. 실제 모임이 아닙니다.',
  ((k.today + make_interval(days => s.day_offset, hours => s.hour)) at time zone 'Asia/Seoul'),
  ((k.today + make_interval(days => s.day_offset, hours => s.hour, mins => s.duration)) at time zone 'Asia/Seoul'),
  s.duration, s.region_code, s.venue_id, s.venue_note, s.min_p, s.max_p,
  s.skill::public.skill_level, s.approval::public.approval_mode, s.waitlist, s.status::public.meeting_status
from src s cross join kst k
on conflict (id) do nothing;

-- 모임장 참가 행
insert into public.meeting_participants (meeting_id, user_id, role, status, confirmed_at)
select m.id, m.host_id, 'host', 'confirmed', now()
from public.meetings m
where m.id::text like 'd2000000-%'
on conflict (meeting_id, user_id) do nothing;

-- 게스트 신청 예시
insert into public.meeting_participants (meeting_id, user_id, role, status, message, confirmed_at)
values
  ('d2000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002', 'guest', 'confirmed', null, now()),
  ('d2000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', 'guest', 'pending',
   '[예시] 전략게임 경험 있어요', null),
  ('d2000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000002', 'guest', 'confirmed', null, now()),
  ('d2000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000002', 'guest', 'confirmed', null, now())
on conflict (meeting_id, user_id) do nothing;

-- 카운트를 실제 행 집계로 맞춘다.
select public._sync_meeting_counts(m.id) from public.meetings m where m.id::text like 'd2000000-%';

commit;
