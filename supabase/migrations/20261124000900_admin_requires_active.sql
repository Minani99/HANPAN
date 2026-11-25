-- 20261124000900_admin_requires_active.sql
-- 관리자 권한에 계정 상태 반영 (Phase 5 검수 결정 — docs/SECURITY.md §3.1, docs/DB_SCHEMA.md §7)
--
-- 이전: is_admin()은 admin_roles 행만 봤다 → 이용 제한(restricted)·탈퇴 요청(deletion_requested) 상태인 관리자도
--       관리자 RPC·관리자 테이블 쓰기·숨김 모임 조회 등을 쓸 수 있었다("탈퇴 요청 계정은 모든 쓰기 거부" 규칙과 어긋남).
-- 이후: admin_roles 행이 있고 **그리고** profiles.status = 'active'일 때만 true.
--
-- - 기존 파일(마이그레이션 2)은 고치지 않고 create or replace로 함수 본문만 바꾼다. 시그니처·stable·security definer·
--   search_path는 그대로 둔다.
-- - RLS 정책은 함수를 OID로 참조하므로 create or replace(같은 시그니처)면 정책을 다시 만들 필요가 없다.
--   is_admin()을 부르는 RPC(관리자 RPC 전부, cancel_meeting 관리자 취소, get_meeting·list_meeting_participants 등의
--   숨김 모임 확인, list_my_meetings, get_my_profile의 isAdmin)도 함수 이름으로 호출하므로 그대로 새 규칙을 따른다.
-- - 영향: 관리자 RPC → NOT_ADMIN, venues·categories·games 쓰기 RLS 거부(insert 42501, update·delete 0행),
--   숨김 모임·비공개 공간·남의 신고·감사 로그 조회 불가, get_my_profile().isAdmin = false.
--   상태를 active로 되돌리면 admin_roles 행이 그대로 있으므로 권한이 즉시 돌아온다.
-- - 관리자가 자기 계정을 이용 제한해 권한을 잃는 일은 없다: admin_set_user_status는 본인 대상을 거부한다(VALIDATION_FAILED/user_id).
-- - 관리자 해제는 지금처럼 admin_roles 행 삭제(SQL Editor, docs/DEPLOYMENT.md §3.4).

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.admin_roles ar
    join public.profiles p on p.id = ar.user_id
    where ar.user_id = (select auth.uid())
      and p.status = 'active'
  );
$$;

-- 권한은 마이그레이션 2와 같게 다시 명시한다(정책 평가 때 anon·authenticated가 호출).
revoke all on function public.is_admin() from public, anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;
