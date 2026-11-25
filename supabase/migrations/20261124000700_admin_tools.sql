-- HANPAN 마이그레이션 7: 관리자 도구 — 조회 RPC, 공간 쓰기 보정 트리거, 관리자 테이블 쓰기 감사 로그
-- 명세: docs/DB_SCHEMA.md §9.15·§9.18·§12
--
-- 관리자 권한의 경계는 여기(DB)다. 화면의 관리자 확인(SessionUser.isAdmin)은 사용성용일 뿐이다.
-- - 조회 RPC는 모두 security definer + is_admin() 아니면 NOT_ADMIN.
-- - 공간·카테고리·게임 쓰기는 기존 설계(§7·§8)대로 테이블 직접 DML(authenticated grant + RLS is_admin())이다.
--   RPC를 거치지 않으므로 감사 기록은 after 트리거가 남긴다(SQL Editor에서 고친 경우도 actor_id null로 남는다).

-- ===========================================================================
-- 1. 관리자 모임 목록: 숨김·취소·종료 포함
-- ===========================================================================
-- 반환: { items: [Meeting...(isHidden·hiddenReason 포함)], total }. 최근 등록순.
-- p_q: 제목·게임명 부분 일치(앞뒤 공백 제거, 50자, LIKE 메타문자 이스케이프). p_hidden_only: 숨김만.
create or replace function public.admin_list_meetings(
  p_q text default null,
  p_hidden_only boolean default false,
  p_limit int default 20,
  p_offset int default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_q text;
  v_pattern text;
  v_result jsonb;
begin
  if not public.is_admin() then
    perform public._err('NOT_ADMIN');
  end if;
  v_q := left(public._clean_text(p_q), 50);
  if v_q is not null then
    v_pattern := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  with filtered as (
    select m as mrow, m.id, m.created_at
    from public.meetings m
    left join public.games g on g.id = m.game_id
    where (not coalesce(p_hidden_only, false) or m.is_hidden)
      and (
        v_pattern is null
        or m.title ilike v_pattern escape '\'
        or m.game_name ilike v_pattern escape '\'
        or g.name ilike v_pattern escape '\'
      )
  ),
  page as (
    select f.mrow, f.created_at, f.id from filtered f
    order by f.created_at desc, f.id
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(public.meeting_to_json(p.mrow) order by p.created_at desc, p.id) from page p), '[]'::jsonb),
    'total', (select count(*) from filtered)
  )
  into v_result;
  return v_result;
end;
$$;

-- ===========================================================================
-- 2. 관리자 신고 목록(대상 이름 포함). admin_list_reports(행 그대로)는 그대로 두고 화면용으로 추가한다.
-- ===========================================================================
-- 반환: { items: [{ id, targetType, targetId, targetLabel, targetHidden, reason, body, status, adminNote,
--                    reporterId, reporterNickname, handledAt, createdAt }], total }. 최신순, limit 1~100.
-- targetLabel: 모임 제목 또는 대상 사용자 닉네임(대상이 삭제됐으면 null).
create or replace function public.admin_list_report_items(
  p_status public.report_status default null,
  p_limit int default 50,
  p_offset int default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
set timezone to 'UTC'
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_result jsonb;
begin
  if not public.is_admin() then
    perform public._err('NOT_ADMIN');
  end if;

  with filtered as (
    select r.*
    from public.reports r
    where p_status is null or r.status = p_status
  ),
  page as (
    select f.* from filtered f
    order by f.created_at desc, f.id
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'targetType', p.target_type,
          'targetId', coalesce(p.target_meeting_id, p.target_user_id),
          'targetLabel', case when p.target_type = 'meeting' then m.title else tp.nickname end,
          'targetHidden', case when p.target_type = 'meeting' then m.is_hidden end,
          'reason', p.reason,
          'body', p.body,
          'status', p.status,
          'adminNote', p.admin_note,
          'reporterId', p.reporter_id,
          'reporterNickname', rp.nickname,
          'handledAt', p.handled_at,
          'createdAt', p.created_at
        )
        order by p.created_at desc, p.id
      )
      from page p
      left join public.meetings m on m.id = p.target_meeting_id
      left join public.profiles tp on tp.id = p.target_user_id
      left join public.profiles rp on rp.id = p.reporter_id
    ), '[]'::jsonb),
    'total', (select count(*) from filtered)
  )
  into v_result;
  return v_result;
end;
$$;

-- ===========================================================================
-- 3. 관리자 공간·카테고리 목록 (비공개·비활성 포함)
-- ===========================================================================
create or replace function public.admin_list_venues()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    perform public._err('NOT_ADMIN');
  end if;
  return coalesce((
    select jsonb_agg(public.venue_to_json(s.vrow) order by s.region_order, s.name, s.id)
    from (
      select v as vrow, rg.sort_order as region_order, v.name, v.id
      from public.venues v
      join public.regions rg on rg.code = v.region_code
      order by rg.sort_order, v.name, v.id
      limit 500
    ) s
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_list_categories()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    perform public._err('NOT_ADMIN');
  end if;
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'description', c.description,
        'sortOrder', c.sort_order,
        'isActive', c.is_active
      )
      order by c.sort_order, c.id
    )
    from public.categories c
  ), '[]'::jsonb);
end;
$$;

-- ===========================================================================
-- 4. 공간 쓰기 보정(before insert/update, security invoker)
-- ===========================================================================
-- - 텍스트 앞뒤 공백 제거(빈 링크는 null). 형식·길이 위반은 기존 check 제약(23514)이 거부한다.
-- - created_by: API 요청(auth.uid() 있음)이면 항상 요청자. 수정 때는 원래 값 유지. created_at도 유지.
--   SQL Editor(auth.uid() 없음)에서 넣은 값은 그대로 둔다.
-- - updated_at은 기존 트리거 venues_set_updated_at이 갱신한다.
create or replace function public._venues_before_write()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  new.name := coalesce(nullif(regexp_replace(new.name, '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''), '');
  new.address := coalesce(nullif(regexp_replace(new.address, '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''), '');
  new.description := coalesce(nullif(regexp_replace(new.description, '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''), '');
  new.website_url := nullif(regexp_replace(new.website_url, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  new.booking_url := nullif(regexp_replace(new.booking_url, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  if tg_op = 'INSERT' then
    if v_uid is not null then
      new.created_by := v_uid;
    end if;
  else
    new.id := old.id;
    new.created_at := old.created_at;
    if v_uid is not null then
      new.created_by := old.created_by;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists venues_before_write on public.venues;
create trigger venues_before_write
  before insert or update on public.venues
  for each row execute function public._venues_before_write();

-- ===========================================================================
-- 5. 관리자 테이블(venues·categories·games) 쓰기 감사 로그 (after, security definer)
-- ===========================================================================
-- action: admin.venue_create|update|delete, admin.category_*, admin.game_*
-- meta: 바뀐 컬럼 이름 배열(fields, updated_at 제외), 공개·활성 여부. 값(이름·주소·링크 등)은 남기지 않는다.
-- 수정했지만 바뀐 컬럼이 없으면 기록하지 않는다.
create or replace function public._audit_admin_table_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entity text := case tg_table_name
    when 'venues' then 'venue'
    when 'categories' then 'category'
    when 'games' then 'game'
    else tg_table_name
  end;
  v_row jsonb;
  v_fields text[];
  v_meta jsonb := '{}'::jsonb;
begin
  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
  else
    v_row := to_jsonb(new);
  end if;
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(n.key order by n.key), '{}')
      into v_fields
    from jsonb_each(to_jsonb(new)) as n(key, value)
    where n.key <> 'updated_at'
      and n.value is distinct from (to_jsonb(old) -> n.key);
    if cardinality(v_fields) = 0 then
      return null;
    end if;
    v_meta := jsonb_build_object('fields', to_jsonb(v_fields));
  end if;
  if tg_op <> 'DELETE' then
    if v_entity = 'venue' then
      v_meta := v_meta || jsonb_build_object('is_public', v_row -> 'is_public');
    elsif v_entity in ('category', 'game') then
      v_meta := v_meta || jsonb_build_object('is_active', v_row -> 'is_active');
    end if;
  end if;

  perform public._audit(
    auth.uid(),
    'admin.' || v_entity || '_' || case tg_op when 'INSERT' then 'create' when 'UPDATE' then 'update' else 'delete' end,
    v_entity,
    v_row ->> 'id',
    v_meta
  );
  return null;
end;
$$;

drop trigger if exists venues_audit on public.venues;
create trigger venues_audit
  after insert or update or delete on public.venues
  for each row execute function public._audit_admin_table_change();
drop trigger if exists categories_audit on public.categories;
create trigger categories_audit
  after insert or update or delete on public.categories
  for each row execute function public._audit_admin_table_change();
drop trigger if exists games_audit on public.games;
create trigger games_audit
  after insert or update or delete on public.games
  for each row execute function public._audit_admin_table_change();

-- ===========================================================================
-- 6. EXECUTE 권한
-- ===========================================================================
revoke all on function public.admin_list_meetings(text, boolean, int, int) from public, anon, authenticated;
revoke all on function public.admin_list_report_items(public.report_status, int, int) from public, anon, authenticated;
revoke all on function public.admin_list_venues() from public, anon, authenticated;
revoke all on function public.admin_list_categories() from public, anon, authenticated;
revoke all on function public._venues_before_write() from public, anon, authenticated;
revoke all on function public._audit_admin_table_change() from public, anon, authenticated;

grant execute on function public.admin_list_meetings(text, boolean, int, int) to authenticated;
grant execute on function public.admin_list_report_items(public.report_status, int, int) to authenticated;
grant execute on function public.admin_list_venues() to authenticated;
grant execute on function public.admin_list_categories() to authenticated;
