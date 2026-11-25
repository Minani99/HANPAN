-- HANPAN 마이그레이션 6: 공간 공개 조회 RPC + 탐색 목록의 공간 필터
-- 명세: docs/DB_SCHEMA.md §9.16·§9.17
--
-- 이미 적용된 환경을 고려해 기존 마이그레이션은 고치지 않는다.
-- - venue_to_json / list_public_venues / get_venue: 공개 공간만(관리자도 공개 화면에서는 공개 공간만 본다).
--   security invoker(RLS 적용) + 명시 필터 is_public.
-- - list_public_meetings: 인자 p_venue_id(uuid, 기본 null)를 맨 뒤에 추가한다.
--   create or replace로 인자를 추가하면 오버로드가 하나 더 생겨 이름 지정 호출이 모호해지므로(42725)
--   기존 함수를 지우고 같은 본문 + 공간 조건으로 다시 만든다. 기존 호출(인자 9개 이하)은 그대로 동작한다.

-- ---------------------------------------------------------------------------
-- 1. 공간 한 건 → 프론트 Venue 모양(jsonb, camelCase). 순수 변환 함수(security invoker).
--    실시간 영업 상태·좌석·가격 필드는 없다(테이블에도 없음).
-- ---------------------------------------------------------------------------
create or replace function public.venue_to_json(v public.venues)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
set timezone to 'UTC'
as $$
  select case when v.id is null then null else jsonb_build_object(
    'id', v.id,
    'name', v.name,
    'regionCode', v.region_code,
    'address', v.address,
    'venueType', v.venue_type,
    'websiteUrl', v.website_url,
    'bookingUrl', v.booking_url,
    'description', v.description,
    'isPublic', v.is_public,
    'infoVerifiedAt', v.info_verified_at,
    'createdAt', v.created_at,
    'updatedAt', v.updated_at
  ) end;
$$;

-- ---------------------------------------------------------------------------
-- 2. 공개 공간 목록. 권역 정렬 순서 → 이름 순, 최대 200개.
--    p_region·p_type이 없는 값이면 0건(오류 아님 — enum 캐스팅 오류를 피하려고 text로 비교).
-- ---------------------------------------------------------------------------
create or replace function public.list_public_venues(
  p_region text default null,
  p_type text default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(public.venue_to_json(s.vrow) order by s.region_order, s.name, s.id),
    '[]'::jsonb
  )
  from (
    select v as vrow, rg.sort_order as region_order, v.name, v.id
    from public.venues v
    join public.regions rg on rg.code = v.region_code
    where v.is_public
      and (p_region is null or v.region_code = p_region)
      and (p_type is null or v.venue_type::text = p_type)
    order by rg.sort_order, v.name, v.id
    limit 200
  ) s;
$$;

-- 공개 공간 한 건. 없거나 비공개면 null.
create or replace function public.get_venue(p_venue_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select public.venue_to_json(v) from public.venues v where v.id = p_venue_id and v.is_public;
$$;

-- ---------------------------------------------------------------------------
-- 3. list_public_meetings + p_venue_id (공간 상세의 '이 공간에서 열리는 예정 모임')
-- ---------------------------------------------------------------------------
drop function if exists public.list_public_meetings(timestamptz, timestamptz, text, text, text, boolean, text, int, int);

create function public.list_public_meetings(
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_category text default null,
  p_region text default null,
  p_q text default null,
  p_recruiting boolean default false,
  p_sort text default 'soonest',
  p_limit int default 20,
  p_offset int default 0,
  p_venue_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_sort text := coalesce(p_sort, 'soonest');
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_q text;
  v_pattern text;
  v_result jsonb;
begin
  if v_sort not in ('soonest', 'newest') then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED', detail = 'sort';
  end if;

  -- 검색어: 앞뒤 공백 제거, 최대 50자, LIKE 메타문자(\ % _) 이스케이프
  v_q := left(nullif(regexp_replace(coalesce(p_q, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''), 50);
  if v_q is not null then
    v_pattern := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  with filtered as (
    select m as mrow, m.id, m.start_at, m.created_at
    from public.meetings m
    join public.regions rg on rg.code = m.region_code
    left join public.venues v on v.id = m.venue_id
    left join public.games g on g.id = m.game_id
    where m.is_hidden = false
      and m.status <> 'cancelled'
      and m.start_at > now()
      and (p_date_from is null or m.start_at >= p_date_from)
      and (p_date_to is null or m.start_at < p_date_to)
      and (p_category is null or m.category_id = p_category)
      and (p_region is null or m.region_code = p_region)
      and (p_venue_id is null or m.venue_id = p_venue_id)
      and (not coalesce(p_recruiting, false) or (m.status = 'open' and m.remaining_seats > 0))
      and (
        v_pattern is null
        or m.title ilike v_pattern escape '\'
        or m.game_name ilike v_pattern escape '\'
        or g.name ilike v_pattern escape '\'
        or m.venue_note ilike v_pattern escape '\'
        or v.name ilike v_pattern escape '\'
        or rg.name ilike v_pattern escape '\'
      )
  ),
  ordered as (
    select f.mrow,
           row_number() over (
             order by
               case when v_sort = 'soonest' then f.start_at end asc,
               case when v_sort = 'newest' then f.created_at end desc,
               f.id asc
           ) as rn
    from filtered f
  ),
  page as (
    select o.mrow, o.rn from ordered o
    order by o.rn
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(public.meeting_to_json(pg.mrow) order by pg.rn) from page pg), '[]'::jsonb),
    'total', (select count(*) from filtered)
  )
  into v_result;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. EXECUTE 권한 (공개 조회: anon·authenticated)
-- ---------------------------------------------------------------------------
revoke all on function public.venue_to_json(public.venues) from public, anon, authenticated;
revoke all on function public.list_public_venues(text, text) from public, anon, authenticated;
revoke all on function public.get_venue(uuid) from public, anon, authenticated;
revoke all on function public.list_public_meetings(timestamptz, timestamptz, text, text, text, boolean, text, int, int, uuid)
  from public, anon, authenticated;

grant execute on function public.venue_to_json(public.venues) to anon, authenticated;
grant execute on function public.list_public_venues(text, text) to anon, authenticated;
grant execute on function public.get_venue(uuid) to anon, authenticated;
grant execute on function public.list_public_meetings(timestamptz, timestamptz, text, text, text, boolean, text, int, int, uuid)
  to anon, authenticated;
