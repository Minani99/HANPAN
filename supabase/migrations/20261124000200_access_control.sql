-- HANPAN 마이그레이션 2/4: 권한(REVOKE/GRANT), 정책용 보조 함수, RLS 정책
-- 명세: docs/DB_SCHEMA.md §7~§8, docs/SECURITY.md §3
--
-- Supabase는 public 스키마에 만들어지는 테이블·함수·시퀀스에 anon/authenticated/service_role
-- 권한을 기본으로 부여한다(default privileges). 그래서 먼저 전부 회수한 뒤 필요한 것만 다시 준다.
-- service_role 권한은 건드리지 않는다(브라우저에 없는 서버 전용 키).

-- ---------------------------------------------------------------------------
-- 1. 일괄 회수 + 이후 생성 객체의 기본 권한 회수
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
-- 참고: 함수의 PUBLIC EXECUTE는 PostgreSQL 전역 기본값이라 스키마 단위로 회수할 수 없다.
--       마이그레이션 3에서 함수마다 `revoke all ... from public, anon, authenticated` 후 다시 grant 한다.

grant usage on schema public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. 정책 평가용 보조 함수 (security definer: 정책 안에서 다른 테이블 정책과 얽히지 않게)
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.admin_roles where user_id = (select auth.uid())
  );
$$;

create or replace function public.is_meeting_host(p_meeting_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.meetings
    where id = p_meeting_id and host_id = (select auth.uid())
  );
$$;

revoke all on function public.is_admin() from public, anon, authenticated;
revoke all on function public.is_meeting_host(uuid) from public, anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.is_meeting_host(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. 테이블 권한
-- ---------------------------------------------------------------------------
-- 기준 데이터: 누구나 조회. categories·games 쓰기는 RLS로 관리자만. regions 쓰기는 마이그레이션·SQL Editor만.
grant select on public.regions to anon, authenticated;
grant select on public.categories to anon, authenticated;
grant insert, update, delete on public.categories to authenticated;
grant select on public.games to anon, authenticated;
grant insert, update, delete on public.games to authenticated;

-- 공간: 공개 공간만 조회, 쓰기는 RLS로 관리자만.
grant select on public.venues to anon, authenticated;
grant insert, update, delete on public.venues to authenticated;

-- 프로필: 공개 컬럼만(컬럼 단위 grant). status·updated_at은 제외 — 본인 상태는 get_my_profile()로.
grant select (id, nickname, region_code, bio, favorite_category_ids, created_at)
  on public.profiles to anon, authenticated;

-- 비공개 정보: 본인 행만(RLS).
grant select on public.user_private to authenticated;

-- admin_roles: anon/authenticated 권한 없음.

-- 모임: 조회만. 쓰기는 RPC(security definer)만.
grant select on public.meetings to anon, authenticated;

-- 참가 행: 로그인 사용자만, RLS로 본인·모임장·관리자.
grant select on public.meeting_participants to authenticated;

-- 신고: admin_note·handled_by 제외. 관리자는 admin_list_reports()로 전체 컬럼 조회.
grant select (id, reporter_id, target_type, target_meeting_id, target_user_id, reason, body, status, created_at, handled_at)
  on public.reports to authenticated;

-- 감사 로그: RLS로 관리자만.
grant select on public.audit_logs to authenticated;

-- ---------------------------------------------------------------------------
-- 4. RLS 정책 — 정책 안에서는 (select auth.uid()) / (select public.is_admin()) 형태로 써서
--    행마다 재평가하지 않게 한다.
-- ---------------------------------------------------------------------------
-- regions
create policy regions_select_all on public.regions
  for select to anon, authenticated
  using (true);

-- categories
create policy categories_select_all on public.categories
  for select to anon, authenticated
  using (true);
create policy categories_insert_admin on public.categories
  for insert to authenticated
  with check ((select public.is_admin()));
create policy categories_update_admin on public.categories
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy categories_delete_admin on public.categories
  for delete to authenticated
  using ((select public.is_admin()));

-- games
create policy games_select_all on public.games
  for select to anon, authenticated
  using (true);
create policy games_insert_admin on public.games
  for insert to authenticated
  with check ((select public.is_admin()));
create policy games_update_admin on public.games
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy games_delete_admin on public.games
  for delete to authenticated
  using ((select public.is_admin()));

-- venues
create policy venues_select_public_or_admin on public.venues
  for select to anon, authenticated
  using (is_public or (select public.is_admin()));
create policy venues_insert_admin on public.venues
  for insert to authenticated
  with check ((select public.is_admin()));
create policy venues_update_admin on public.venues
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy venues_delete_admin on public.venues
  for delete to authenticated
  using ((select public.is_admin()));

-- profiles: 공개 컬럼만 grant되어 있으므로 행은 모두 조회 가능. 쓰기 정책 없음(RPC·트리거만).
create policy profiles_select_all on public.profiles
  for select to anon, authenticated
  using (true);

-- user_private: 본인만.
create policy user_private_select_own on public.user_private
  for select to authenticated
  using (user_id = (select auth.uid()));

-- admin_roles: 정책 없음(RLS 활성 + 권한 없음 → 접근 불가).

-- meetings: 숨김은 모임장·관리자만.
create policy meetings_select_visible on public.meetings
  for select to anon, authenticated
  using (
    is_hidden = false
    or host_id = (select auth.uid())
    or (select public.is_admin())
  );

-- meeting_participants: 본인 행, 모임장(본인 모임), 관리자.
create policy meeting_participants_select_scoped on public.meeting_participants
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_meeting_host(meeting_id)
    or (select public.is_admin())
  );

-- reports: 신고자 본인, 관리자.
create policy reports_select_own_or_admin on public.reports
  for select to authenticated
  using (
    reporter_id = (select auth.uid())
    or (select public.is_admin())
  );

-- audit_logs: 관리자만.
create policy audit_logs_select_admin on public.audit_logs
  for select to authenticated
  using ((select public.is_admin()));
