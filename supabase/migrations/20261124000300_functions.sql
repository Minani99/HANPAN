-- HANPAN 마이그레이션 3/4: 함수·RPC·트리거
-- 명세: docs/DB_SCHEMA.md §9~§12
--
-- 공통 규칙
-- - 쓰기 RPC는 security definer + `set search_path = public, pg_temp`. 소유자는 마이그레이션 실행 역할.
-- - 첫 단계에서 auth.uid()·계정 상태·온보딩을 확인한다(_require_actor).
-- - jsonb 입력은 정의된 키만 읽고 나머지는 무시한다. 타입·길이·범위를 모두 다시 검사한다.
-- - 오류: raise exception using errcode = 'P0001', message = '<CODE>', detail = '<필드명 또는 사유>'.
-- - 잠금 순서는 항상 meetings 행 → meeting_participants 행.
-- - 카운트(confirmed/pending/waitlist)는 모임 행을 잠근 트랜잭션 안에서 실제 행 집계로 다시 맞춘다.
-- - `_`로 시작하는 함수는 내부용이다. anon/authenticated에 EXECUTE를 주지 않는다.
-- - jsonb 출력 키는 camelCase(src/data/types.ts와 같은 이름), 시각은 UTC ISO 8601 문자열.

-- ===========================================================================
-- 1. 내부 보조 함수
-- ===========================================================================

create or replace function public._err(p_code text, p_detail text default null)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = p_code,
    detail = coalesce(p_detail, '');
end;
$$;

-- 앞뒤 공백 제거, 빈 문자열 → null
create or replace function public._clean_text(p text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select nullif(regexp_replace(p, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
$$;

-- jsonb 필드 읽기: 키가 없거나 JSON null이면 null, 타입이 다르면 VALIDATION_FAILED(detail=키)
create or replace function public._j_text(p jsonb, p_key text)
returns text
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v jsonb := p -> p_key;
begin
  if v is null or jsonb_typeof(v) = 'null' then
    return null;
  end if;
  if jsonb_typeof(v) <> 'string' then
    perform public._err('VALIDATION_FAILED', p_key);
  end if;
  return public._clean_text(v #>> '{}');
end;
$$;

create or replace function public._j_int(p jsonb, p_key text)
returns int
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v jsonb := p -> p_key;
  n numeric;
begin
  if v is null or jsonb_typeof(v) = 'null' then
    return null;
  end if;
  if jsonb_typeof(v) <> 'number' then
    perform public._err('VALIDATION_FAILED', p_key);
  end if;
  n := (v #>> '{}')::numeric;
  if n <> trunc(n) or n < -2147483648 or n > 2147483647 then
    perform public._err('VALIDATION_FAILED', p_key);
  end if;
  return n::int;
end;
$$;

create or replace function public._j_bool(p jsonb, p_key text)
returns boolean
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v jsonb := p -> p_key;
begin
  if v is null or jsonb_typeof(v) = 'null' then
    return null;
  end if;
  if jsonb_typeof(v) <> 'boolean' then
    perform public._err('VALIDATION_FAILED', p_key);
  end if;
  return (v #>> '{}')::boolean;
end;
$$;

create or replace function public._j_uuid(p jsonb, p_key text)
returns uuid
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_text text := public._j_text(p, p_key);
begin
  if v_text is null then
    return null;
  end if;
  if v_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    perform public._err('VALIDATION_FAILED', p_key);
  end if;
  return v_text::uuid;
end;
$$;

-- 오프셋(Z 또는 ±HH:MM)이 있는 ISO 8601만 허용한다(세션 시간대에 따라 해석이 달라지지 않게).
create or replace function public._j_timestamptz(p jsonb, p_key text)
returns timestamptz
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_text text := public._j_text(p, p_key);
  v_ts timestamptz;
begin
  if v_text is null then
    return null;
  end if;
  if v_text !~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?([Zz]|[+-]\d{2}(:?\d{2})?)$' then
    perform public._err('VALIDATION_FAILED', p_key);
  end if;
  begin
    v_ts := v_text::timestamptz;
  exception when others then
    perform public._err('VALIDATION_FAILED', p_key);
  end;
  return v_ts;
end;
$$;

-- 호출자 확인. 반환: auth.uid()
--   로그인 안 됨 → AUTH_REQUIRED, 프로필 없음 → PROFILE_INCOMPLETE,
--   탈퇴 요청 → ACCOUNT_DELETION_REQUESTED, 이용 제한(허용 안 할 때) → ACCOUNT_RESTRICTED,
--   온보딩 필요한데 약관 동의 전 → PROFILE_INCOMPLETE
create or replace function public._require_actor(p_require_onboarded boolean, p_allow_restricted boolean)
returns uuid
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_status public.account_status;
  v_terms timestamptz;
begin
  if v_uid is null then
    perform public._err('AUTH_REQUIRED');
  end if;
  select p.status, up.terms_agreed_at
    into v_status, v_terms
  from public.profiles p
  left join public.user_private up on up.user_id = p.id
  where p.id = v_uid;
  if not found then
    perform public._err('PROFILE_INCOMPLETE', 'profile_missing');
  end if;
  if v_status = 'deletion_requested' then
    perform public._err('ACCOUNT_DELETION_REQUESTED');
  end if;
  if v_status = 'restricted' and not p_allow_restricted then
    perform public._err('ACCOUNT_RESTRICTED');
  end if;
  if p_require_onboarded and v_terms is null then
    perform public._err('PROFILE_INCOMPLETE');
  end if;
  return v_uid;
end;
$$;

create or replace function public._audit(
  p_actor uuid,
  p_action text,
  p_target_type text,
  p_target_id text,
  p_meta jsonb default '{}'::jsonb
)
returns void
language sql
set search_path = public, pg_temp
as $$
  insert into public.audit_logs (actor_id, action, target_type, target_id, meta)
  values (p_actor, p_action, p_target_type, p_target_id, coalesce(p_meta, '{}'::jsonb));
$$;

-- 카운트를 실제 행 집계로 맞춘다. 호출자가 모임 행을 이미 잠갔어야 한다.
-- confirmed_count > max_participants가 되면 check 제약(meetings_confirmed_count_range)이 거부한다.
create or replace function public._sync_meeting_counts(p_meeting_id uuid)
returns void
language sql
set search_path = public, pg_temp
as $$
  update public.meetings m
  set confirmed_count = c.confirmed,
      pending_count = c.pending,
      waitlist_count = c.waitlisted
  from (
    select
      count(*) filter (where mp.status = 'confirmed')::int as confirmed,
      count(*) filter (where mp.status = 'pending')::int as pending,
      count(*) filter (where mp.status = 'waitlisted')::int as waitlisted
    from public.meeting_participants mp
    where mp.meeting_id = p_meeting_id
  ) c
  where m.id = p_meeting_id
    and (m.confirmed_count, m.pending_count, m.waitlist_count)
        is distinct from (c.confirmed, c.pending, c.waitlisted);
$$;

-- 모임 취소 공통 처리. 호출자가 모임 행을 잠그고 권한을 확인했어야 한다. 반환: 정리된 게스트 수
create or replace function public._cancel_meeting_core(p_meeting_id uuid, p_reason text)
returns int
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_affected int;
begin
  update public.meetings
  set status = 'cancelled',
      cancelled_at = now(),
      cancel_reason = p_reason
  where id = p_meeting_id;

  update public.meeting_participants
  set status = 'meeting_cancelled',
      cancelled_at = now()
  where meeting_id = p_meeting_id
    and role = 'guest'
    and status in ('pending', 'confirmed', 'waitlisted');
  get diagnostics v_affected = row_count;

  perform public._sync_meeting_counts(p_meeting_id);
  return v_affected;
end;
$$;

-- 닉네임 예약어: 소문자화하고 `_`·`-`를 지운 뒤 아래 단어를 포함하면 금지.
create or replace function public._is_reserved_nickname(p_nickname text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from unnest(array['관리자', '운영자', '운영진', 'admin', 'hanpan', '한판', '탈퇴한사용자']) as w(word)
    where position(w.word in translate(lower(p_nickname), '_-', '')) > 0
  );
$$;

-- 생성·수정 입력 검증. 정규화한 값을 meetings 행 모양으로 돌려준다.
-- p_current가 null이면 생성, 아니면 수정(전체 필드 교체). 수정 때는
--   - start_at이 바뀐 경우에만 30분~90일 규칙을 적용하고,
--   - 카테고리·권역·게임·공간의 활성/공개 검사는 값이 바뀐 경우에만 한다(기존 값 유지 허용).
create or replace function public._meeting_input(p jsonb, p_current public.meetings)
returns public.meetings
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  r public.meetings;
  v_is_create boolean := (p_current.id is null);
  v_venue public.venues;
  v_text text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    perform public._err('VALIDATION_FAILED', 'input');
  end if;
  if not v_is_create then
    r := p_current;
  end if;

  -- 카테고리
  r.category_id := public._j_text(p, 'category_id');
  if r.category_id is null or not exists (
    select 1 from public.categories c
    where c.id = r.category_id
      and (c.is_active or (not v_is_create and c.id = p_current.category_id))
  ) then
    perform public._err('VALIDATION_FAILED', 'category_id');
  end if;

  -- 게임: game_id와 game_name은 동시에 지정할 수 없다
  r.game_id := public._j_uuid(p, 'game_id');
  r.game_name := public._j_text(p, 'game_name');
  if r.game_id is not null and r.game_name is not null then
    perform public._err('VALIDATION_FAILED', 'game');
  end if;
  if r.game_name is not null and char_length(r.game_name) > 40 then
    perform public._err('VALIDATION_FAILED', 'game_name');
  end if;
  if r.game_id is not null and not exists (
    select 1 from public.games g
    where g.id = r.game_id
      and (g.is_active or (not v_is_create and g.id is not distinct from p_current.game_id))
  ) then
    perform public._err('VALIDATION_FAILED', 'game_id');
  end if;

  -- 제목·소개·유의사항
  r.title := public._j_text(p, 'title');
  if r.title is null or char_length(r.title) < 2 or char_length(r.title) > 60 then
    perform public._err('VALIDATION_FAILED', 'title');
  end if;
  r.description := coalesce(public._j_text(p, 'description'), '');
  if char_length(r.description) > 2000 then
    perform public._err('VALIDATION_FAILED', 'description');
  end if;
  r.notice := public._j_text(p, 'notice');
  if r.notice is not null and char_length(r.notice) > 1000 then
    perform public._err('VALIDATION_FAILED', 'notice');
  end if;

  -- 일시
  r.start_at := public._j_timestamptz(p, 'start_at');
  if r.start_at is null then
    perform public._err('VALIDATION_FAILED', 'start_at');
  end if;
  r.duration_minutes := public._j_int(p, 'duration_minutes');
  if r.duration_minutes is null or r.duration_minutes < 30 or r.duration_minutes > 720 then
    perform public._err('VALIDATION_FAILED', 'duration_minutes');
  end if;
  if v_is_create or r.start_at <> p_current.start_at then
    if r.start_at < now() + interval '30 minutes' or r.start_at > now() + interval '90 days' then
      perform public._err('VALIDATION_FAILED', 'start_at');
    end if;
  end if;
  r.end_at := r.start_at + make_interval(mins => r.duration_minutes);

  -- 권역·장소
  r.region_code := public._j_text(p, 'region_code');
  if r.region_code is null or not exists (
    select 1 from public.regions rg
    where rg.code = r.region_code
      and (rg.is_active or (not v_is_create and rg.code = p_current.region_code))
  ) then
    perform public._err('VALIDATION_FAILED', 'region_code');
  end if;
  r.venue_id := public._j_uuid(p, 'venue_id');
  if r.venue_id is not null then
    select * into v_venue from public.venues v where v.id = r.venue_id;
    if not found
      or (not v_venue.is_public and (v_is_create or r.venue_id is distinct from p_current.venue_id))
      or v_venue.region_code <> r.region_code
    then
      perform public._err('VALIDATION_FAILED', 'venue_id');
    end if;
  end if;
  r.venue_note := public._j_text(p, 'venue_note');
  if r.venue_note is not null and char_length(r.venue_note) > 60 then
    perform public._err('VALIDATION_FAILED', 'venue_note');
  end if;

  -- 인원 (모임장 포함)
  r.min_participants := public._j_int(p, 'min_participants');
  r.max_participants := public._j_int(p, 'max_participants');
  if r.min_participants is null or r.min_participants < 2 or r.min_participants > 30 then
    perform public._err('VALIDATION_FAILED', 'min_participants');
  end if;
  if r.max_participants is null or r.max_participants < 2 or r.max_participants > 30 then
    perform public._err('VALIDATION_FAILED', 'max_participants');
  end if;
  if r.min_participants > r.max_participants then
    perform public._err('VALIDATION_FAILED', 'min_participants');
  end if;

  -- 난이도·승인 방식·대기
  v_text := public._j_text(p, 'skill_level');
  if v_text is null or not (v_text = any (enum_range(null::public.skill_level)::text[])) then
    perform public._err('VALIDATION_FAILED', 'skill_level');
  end if;
  r.skill_level := v_text::public.skill_level;
  v_text := public._j_text(p, 'approval_mode');
  if v_text is null or not (v_text = any (enum_range(null::public.approval_mode)::text[])) then
    perform public._err('VALIDATION_FAILED', 'approval_mode');
  end if;
  r.approval_mode := v_text::public.approval_mode;
  r.allow_waitlist := coalesce(public._j_bool(p, 'allow_waitlist'), true);

  -- 홀덤(비금전) 동의: 생성 시 또는 홀덤으로 바꿀 때
  if r.category_id = 'holdem_social'
     and (v_is_create or p_current.category_id <> 'holdem_social')
     and coalesce(public._j_bool(p, 'holdem_policy_agreed'), false) = false
  then
    perform public._err('HOLDEM_AGREEMENT_REQUIRED');
  end if;

  return r;
end;
$$;

create or replace function public._participation_json(mp public.meeting_participants)
returns jsonb
language sql
stable
set search_path = public, pg_temp
set timezone to 'UTC'
as $$
  select case when mp.id is null then null else jsonb_build_object(
    'id', mp.id,
    'meetingId', mp.meeting_id,
    'userId', mp.user_id,
    'role', mp.role,
    'status', mp.status,
    'attendance', mp.attendance,
    'message', mp.message,
    'appliedAt', mp.applied_at,
    'decidedAt', mp.decided_at,
    'confirmedAt', mp.confirmed_at,
    'cancelledAt', mp.cancelled_at,
    'attendanceMarkedAt', mp.attendance_marked_at,
    'updatedAt', mp.updated_at
  ) end;
$$;

-- ===========================================================================
-- 2. 트리거
-- ===========================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger venues_set_updated_at before update on public.venues
  for each row execute function public.set_updated_at();
create trigger meetings_set_updated_at before update on public.meetings
  for each row execute function public.set_updated_at();
create trigger meeting_participants_set_updated_at before update on public.meeting_participants
  for each row execute function public.set_updated_at();

-- 가입 시 프로필·비공개 행 생성. OAuth 메타데이터(이름·사진 등)는 복사하지 않는다.
-- 임시 닉네임 '플레이어' + 6자리 난수, 충돌 시 최대 5회 재시도 후 id 기반 값.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_try int;
begin
  for v_try in 1..5 loop
    begin
      insert into public.profiles (id, nickname)
      values (new.id, '플레이어' || lpad((floor(random() * 1000000))::int::text, 6, '0'));
      exit;
    exception when unique_violation then
      if v_try = 5 then
        insert into public.profiles (id, nickname)
        values (new.id, '플레이어' || substr(replace(new.id::text, '-', ''), 1, 12));
      end if;
    end;
  end loop;
  insert into public.user_private (user_id) values (new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ===========================================================================
-- 3. 조회 RPC
-- ===========================================================================

-- 모임 한 건을 프론트 Meeting 모양(jsonb)으로. security invoker:
-- 호출자 권한으로 profiles(공개 컬럼)·venues(RLS)·games를 읽는다.
-- 탈퇴(계정 삭제)한 모임장은 hostId/hostNickname = null.
create or replace function public.meeting_to_json(m public.meetings)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
set timezone to 'UTC'
as $$
  select case when m.id is null then null else jsonb_build_object(
    'id', m.id,
    'hostId', m.host_id,
    'hostNickname', (select p.nickname from public.profiles p where p.id = m.host_id),
    'categoryId', m.category_id,
    'gameId', m.game_id,
    'gameName', coalesce(m.game_name, (select g.name from public.games g where g.id = m.game_id)),
    'title', m.title,
    'description', m.description,
    'notice', m.notice,
    'startAt', m.start_at,
    'endAt', m.end_at,
    'durationMinutes', m.duration_minutes,
    'regionCode', m.region_code,
    'venueId', m.venue_id,
    'venueName', (select v.name from public.venues v where v.id = m.venue_id),
    'venueNote', m.venue_note,
    'minParticipants', m.min_participants,
    'maxParticipants', m.max_participants,
    'confirmedCount', m.confirmed_count,
    'pendingCount', m.pending_count,
    'waitlistCount', m.waitlist_count,
    'remainingSeats', m.remaining_seats,
    'skillLevel', m.skill_level,
    'approvalMode', m.approval_mode,
    'allowWaitlist', m.allow_waitlist,
    'status', m.status,
    'isHidden', m.is_hidden,
    'hiddenReason', m.hidden_reason,
    'cancelReason', m.cancel_reason,
    'cancelledAt', m.cancelled_at,
    'imageUrl', null,
    'createdAt', m.created_at,
    'updatedAt', m.updated_at
  ) end;
$$;

-- 공개 탐색 목록. security invoker(RLS 적용) + 명시 필터(숨김·취소·시작된 모임 제외).
-- 반환: { "items": [Meeting...], "total": int }
create or replace function public.list_public_meetings(
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_category text default null,
  p_region text default null,
  p_q text default null,
  p_recruiting boolean default false,
  p_sort text default 'soonest',
  p_limit int default 20,
  p_offset int default 0
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

-- 모임 상세 1건(RLS 적용). 없거나 볼 수 없으면 null. 취소·종료된 모임도 반환한다.
create or replace function public.get_meeting(p_meeting_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select public.meeting_to_json(m) from public.meetings m where m.id = p_meeting_id;
$$;

-- 내 프로필(본인 상태·온보딩 여부 포함). 프로필이 없으면 null.
create or replace function public.get_my_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
set timezone to 'UTC'
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then
    perform public._err('AUTH_REQUIRED');
  end if;
  select jsonb_build_object(
    'id', p.id,
    'nickname', p.nickname,
    'regionCode', p.region_code,
    'bio', p.bio,
    'favoriteCategoryIds', to_jsonb(p.favorite_category_ids),
    'status', p.status,
    'termsAgreedAt', up.terms_agreed_at,
    'privacyAgreedAt', up.privacy_agreed_at,
    'deletionRequestedAt', up.deletion_requested_at,
    'onboarded', up.terms_agreed_at is not null,
    'isAdmin', public.is_admin(),
    'createdAt', p.created_at
  )
  into v_result
  from public.profiles p
  left join public.user_private up on up.user_id = p.id
  where p.id = v_uid;
  return v_result;
end;
$$;

-- 이 모임에 대한 내 참가 행(모임장이면 role=host). 없으면 null.
create or replace function public.get_my_participation(p_meeting_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    perform public._err('AUTH_REQUIRED');
  end if;
  return (
    select public._participation_json(mp)
    from public.meeting_participants mp
    where mp.meeting_id = p_meeting_id and mp.user_id = v_uid
  );
end;
$$;

-- 내 모임: { hosted: [Meeting...], joined: [{ meeting: Meeting|null, participation }] }
-- 시작 시각 내림차순, 각 200개 상한. 숨김 모임은 hosted에는 포함, joined에서는 meeting = null(관리자 제외).
create or replace function public.list_my_meetings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_admin boolean;
begin
  if v_uid is null then
    perform public._err('AUTH_REQUIRED');
  end if;
  v_admin := public.is_admin();
  return jsonb_build_object(
    'hosted', coalesce((
      select jsonb_agg(public.meeting_to_json(h.mrow) order by h.start_at desc, h.id)
      from (
        select m as mrow, m.start_at, m.id
        from public.meetings m
        where m.host_id = v_uid
        order by m.start_at desc, m.id
        limit 200
      ) h
    ), '[]'::jsonb),
    'joined', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'meeting', case when not j.is_hidden or v_admin then public.meeting_to_json(j.mrow) end,
          'participation', public._participation_json(j.prow)
        )
        order by j.start_at desc, j.id
      )
      from (
        select m as mrow, mp as prow, m.is_hidden, m.start_at, mp.id
        from public.meeting_participants mp
        join public.meetings m on m.id = mp.meeting_id
        where mp.user_id = v_uid and mp.role = 'guest'
        order by m.start_at desc, mp.id
        limit 200
      ) j
    ), '[]'::jsonb)
  );
end;
$$;

-- 참가자 관리(모임장·관리자만). 반환: [Participant...] (모임장 행 먼저, 그다음 신청 순)
create or replace function public.list_meeting_participants(p_meeting_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_meeting public.meetings;
begin
  if v_uid is null then
    perform public._err('AUTH_REQUIRED');
  end if;
  select * into v_meeting from public.meetings where id = p_meeting_id;
  if not found then
    perform public._err('NOT_FOUND');
  end if;
  if v_meeting.host_id is distinct from v_uid and not public.is_admin() then
    if v_meeting.is_hidden then
      perform public._err('NOT_FOUND');
    end if;
    perform public._err('NOT_HOST');
  end if;
  return coalesce((
    select jsonb_agg(
      public._participation_json(mp) || jsonb_build_object('nickname', coalesce(p.nickname, '탈퇴한 사용자'))
      order by (mp.role = 'host') desc, mp.applied_at, mp.id
    )
    from public.meeting_participants mp
    left join public.profiles p on p.id = mp.user_id
    where mp.meeting_id = p_meeting_id
  ), '[]'::jsonb);
end;
$$;

-- ===========================================================================
-- 4. 모임 쓰기 RPC
-- ===========================================================================

create or replace function public.create_meeting(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  r public.meetings;
  v_id uuid;
begin
  v_uid := public._require_actor(true, false);
  -- 같은 사용자의 동시 생성이 레이트 리밋 집계를 빠져나가지 않게 사용자 단위로 직렬화한다.
  perform pg_advisory_xact_lock(hashtext('hanpan.create_meeting'), hashtext(v_uid::text));

  r := public._meeting_input(p, null::public.meetings);

  if (select count(*) from public.meetings m
      where m.host_id = v_uid and m.created_at > now() - interval '24 hours') >= 5 then
    perform public._err('RATE_LIMITED', 'create_24h');
  end if;
  if (select count(*) from public.meetings m
      where m.host_id = v_uid and m.status in ('open', 'closed') and m.start_at > now()) >= 10 then
    perform public._err('RATE_LIMITED', 'open_meetings');
  end if;

  insert into public.meetings (
    host_id, category_id, game_id, game_name, title, description, notice,
    start_at, end_at, duration_minutes, region_code, venue_id, venue_note,
    min_participants, max_participants, skill_level, approval_mode, allow_waitlist,
    status, confirmed_count, pending_count, waitlist_count
  ) values (
    v_uid, r.category_id, r.game_id, r.game_name, r.title, r.description, r.notice,
    r.start_at, r.end_at, r.duration_minutes, r.region_code, r.venue_id, r.venue_note,
    r.min_participants, r.max_participants, r.skill_level, r.approval_mode, r.allow_waitlist,
    'open', 1, 0, 0
  )
  returning id into v_id;

  insert into public.meeting_participants (meeting_id, user_id, role, status, applied_at, decided_at, confirmed_at)
  values (v_id, v_uid, 'host', 'confirmed', now(), now(), now());

  perform public._audit(v_uid, 'meeting.create', 'meeting', v_id::text,
    jsonb_build_object('category_id', r.category_id, 'start_at', r.start_at));
  return v_id;
end;
$$;

create or replace function public.update_meeting(p_meeting_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_meeting public.meetings;
  r public.meetings;
  v_fields text[];
  v_meta jsonb;
begin
  v_uid := public._require_actor(false, false);

  select * into v_meeting from public.meetings where id = p_meeting_id for update;
  if not found or (v_meeting.is_hidden and v_meeting.host_id is distinct from v_uid and not public.is_admin()) then
    perform public._err('NOT_FOUND');
  end if;
  if v_meeting.host_id is distinct from v_uid then
    perform public._err('NOT_HOST');
  end if;
  if v_meeting.status = 'cancelled' then
    perform public._err('MEETING_CANCELLED');
  end if;
  if v_meeting.start_at <= now() then
    perform public._err('MEETING_STARTED');
  end if;

  r := public._meeting_input(p, v_meeting);

  if r.max_participants < v_meeting.confirmed_count then
    perform public._err('CAPACITY_BELOW_CONFIRMED', 'max_participants');
  end if;

  v_fields := array_remove(array[
    case when r.category_id is distinct from v_meeting.category_id then 'category_id' end,
    case when r.game_id is distinct from v_meeting.game_id then 'game_id' end,
    case when r.game_name is distinct from v_meeting.game_name then 'game_name' end,
    case when r.title is distinct from v_meeting.title then 'title' end,
    case when r.description is distinct from v_meeting.description then 'description' end,
    case when r.notice is distinct from v_meeting.notice then 'notice' end,
    case when r.start_at is distinct from v_meeting.start_at then 'start_at' end,
    case when r.duration_minutes is distinct from v_meeting.duration_minutes then 'duration_minutes' end,
    case when r.region_code is distinct from v_meeting.region_code then 'region_code' end,
    case when r.venue_id is distinct from v_meeting.venue_id then 'venue_id' end,
    case when r.venue_note is distinct from v_meeting.venue_note then 'venue_note' end,
    case when r.min_participants is distinct from v_meeting.min_participants then 'min_participants' end,
    case when r.max_participants is distinct from v_meeting.max_participants then 'max_participants' end,
    case when r.skill_level is distinct from v_meeting.skill_level then 'skill_level' end,
    case when r.approval_mode is distinct from v_meeting.approval_mode then 'approval_mode' end,
    case when r.allow_waitlist is distinct from v_meeting.allow_waitlist then 'allow_waitlist' end
  ], null);

  -- 승인 방식·정원을 바꿔도 기존 pending·waitlisted는 그대로 둔다(자동 확정 없음).
  update public.meetings
  set category_id = r.category_id,
      game_id = r.game_id,
      game_name = r.game_name,
      title = r.title,
      description = r.description,
      notice = r.notice,
      start_at = r.start_at,
      end_at = r.end_at,
      duration_minutes = r.duration_minutes,
      region_code = r.region_code,
      venue_id = r.venue_id,
      venue_note = r.venue_note,
      min_participants = r.min_participants,
      max_participants = r.max_participants,
      skill_level = r.skill_level,
      approval_mode = r.approval_mode,
      allow_waitlist = r.allow_waitlist
  where id = p_meeting_id;

  v_meta := jsonb_build_object('fields', to_jsonb(v_fields));
  if r.start_at is distinct from v_meeting.start_at then
    v_meta := v_meta || jsonb_build_object('start_at_before', v_meeting.start_at, 'start_at_after', r.start_at);
  end if;
  perform public._audit(v_uid, 'meeting.update', 'meeting', p_meeting_id::text, v_meta);
end;
$$;

-- 모임장(시작 전) 또는 관리자(종료 전). 이용 제한된 모임장도 취소는 허용(피해 축소).
create or replace function public.cancel_meeting(p_meeting_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_meeting public.meetings;
  v_reason text;
  v_is_host boolean;
  v_is_admin boolean;
  v_affected int;
begin
  v_uid := public._require_actor(false, true);
  v_reason := public._clean_text(p_reason);
  if v_reason is not null and char_length(v_reason) > 200 then
    perform public._err('VALIDATION_FAILED', 'reason');
  end if;

  select * into v_meeting from public.meetings where id = p_meeting_id for update;
  if not found then
    perform public._err('NOT_FOUND');
  end if;
  v_is_host := v_meeting.host_id is not distinct from v_uid;
  v_is_admin := public.is_admin();
  if not v_is_host and not v_is_admin then
    if v_meeting.is_hidden then
      perform public._err('NOT_FOUND');
    end if;
    perform public._err('NOT_HOST');
  end if;
  if v_meeting.status = 'cancelled' then
    perform public._err('MEETING_CANCELLED');
  end if;
  if v_is_admin then
    if v_meeting.end_at <= now() then
      perform public._err('MEETING_STARTED', 'ended');
    end if;
  elsif v_meeting.start_at <= now() then
    perform public._err('MEETING_STARTED');
  end if;

  v_affected := public._cancel_meeting_core(p_meeting_id, v_reason);
  perform public._audit(v_uid, 'meeting.cancel', 'meeting', p_meeting_id::text,
    jsonb_build_object('by_admin', v_is_admin and not v_is_host, 'affected_guests', v_affected));
end;
$$;

create or replace function public.set_meeting_recruiting(p_meeting_id uuid, p_open boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_meeting public.meetings;
  v_next public.meeting_status;
begin
  v_uid := public._require_actor(false, false);
  if p_open is null then
    perform public._err('VALIDATION_FAILED', 'open');
  end if;

  select * into v_meeting from public.meetings where id = p_meeting_id for update;
  if not found or (v_meeting.is_hidden and v_meeting.host_id is distinct from v_uid and not public.is_admin()) then
    perform public._err('NOT_FOUND');
  end if;
  if v_meeting.host_id is distinct from v_uid then
    perform public._err('NOT_HOST');
  end if;
  if v_meeting.status = 'cancelled' then
    perform public._err('MEETING_CANCELLED');
  end if;
  if v_meeting.start_at <= now() then
    perform public._err('MEETING_STARTED');
  end if;

  v_next := case when p_open then 'open' else 'closed' end;
  if v_meeting.status = v_next then
    return;
  end if;
  update public.meetings set status = v_next where id = p_meeting_id;
  perform public._audit(v_uid, 'meeting.recruiting', 'meeting', p_meeting_id::text,
    jsonb_build_object('from', v_meeting.status, 'to', v_next));
end;
$$;

-- ===========================================================================
-- 5. 참가 RPC (동시성: 모임 행 for update → 참가 행 for update)
-- ===========================================================================

create or replace function public.apply_to_meeting(p_meeting_id uuid, p_message text default null)
returns public.participant_status
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_message text;
  v_meeting public.meetings;
  v_existing public.meeting_participants;
  v_status public.participant_status;
begin
  v_uid := public._require_actor(true, false);
  v_message := public._clean_text(p_message);
  if v_message is not null and char_length(v_message) > 200 then
    perform public._err('VALIDATION_FAILED', 'message');
  end if;

  -- 모임 행 잠금: 같은 모임에 대한 동시 신청은 여기서 한 줄로 선다.
  select * into v_meeting from public.meetings where id = p_meeting_id for update;
  if not found or v_meeting.is_hidden then
    perform public._err('NOT_FOUND');
  end if;
  if v_meeting.host_id = v_uid then
    perform public._err('OWN_MEETING');
  end if;
  if v_meeting.status = 'cancelled' then
    perform public._err('MEETING_CANCELLED');
  end if;
  if v_meeting.status = 'closed' then
    perform public._err('MEETING_NOT_OPEN');
  end if;
  if v_meeting.host_id is null then
    -- 모임장 계정이 삭제된 모임
    perform public._err('MEETING_NOT_OPEN', 'host_missing');
  end if;
  if v_meeting.start_at <= now() then
    perform public._err('MEETING_STARTED');
  end if;

  select * into v_existing
  from public.meeting_participants
  where meeting_id = p_meeting_id and user_id = v_uid
  for update;
  if found then
    if v_existing.status in ('pending', 'confirmed', 'waitlisted') then
      perform public._err('ALREADY_APPLIED');
    elsif v_existing.status = 'rejected' then
      perform public._err('APPLICATION_REJECTED');
    elsif v_existing.status <> 'cancelled' then
      perform public._err('INVALID_STATE', v_existing.status::text);
    end if;
  end if;

  -- 자리 판단은 잠근 모임 행의 카운트로 한다. pending은 자리를 차지하지 않는다.
  if v_meeting.confirmed_count < v_meeting.max_participants then
    v_status := case when v_meeting.approval_mode = 'auto' then 'confirmed' else 'pending' end;
  elsif v_meeting.allow_waitlist then
    v_status := 'waitlisted';
  else
    perform public._err('MEETING_FULL');
  end if;

  if v_existing.id is null then
    begin
      insert into public.meeting_participants (
        meeting_id, user_id, role, status, message, applied_at, confirmed_at
      ) values (
        p_meeting_id, v_uid, 'guest', v_status, v_message, now(),
        case when v_status = 'confirmed' then now() end
      );
    exception when unique_violation then
      perform public._err('ALREADY_APPLIED');
    end;
  else
    -- cancelled 행 재사용(재신청)
    update public.meeting_participants
    set status = v_status,
        message = v_message,
        applied_at = now(),
        decided_at = null,
        cancelled_at = null,
        confirmed_at = case when v_status = 'confirmed' then now() end,
        attendance = 'unknown',
        attendance_marked_at = null
    where id = v_existing.id;
  end if;

  perform public._sync_meeting_counts(p_meeting_id);
  perform public._audit(v_uid, 'participant.apply', 'meeting', p_meeting_id::text,
    jsonb_build_object('status', v_status, 'reapply', v_existing.id is not null));
  return v_status;
end;
$$;

-- 본인 신청 취소. 대기자 자동 승격 없음. 이용 제한 계정도 허용.
create or replace function public.cancel_my_application(p_meeting_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_meeting public.meetings;
  v_row public.meeting_participants;
begin
  v_uid := public._require_actor(false, true);

  select * into v_meeting from public.meetings where id = p_meeting_id for update;
  if not found then
    perform public._err('NOT_FOUND');
  end if;
  if v_meeting.host_id = v_uid then
    perform public._err('OWN_MEETING');
  end if;

  select * into v_row
  from public.meeting_participants
  where meeting_id = p_meeting_id and user_id = v_uid
  for update;
  if not found or v_row.role <> 'guest' or v_row.status not in ('pending', 'confirmed', 'waitlisted') then
    perform public._err('NOT_APPLIED');
  end if;
  if v_meeting.start_at <= now() then
    perform public._err('MEETING_STARTED');
  end if;

  update public.meeting_participants
  set status = 'cancelled',
      cancelled_at = now()
  where id = v_row.id;

  perform public._sync_meeting_counts(p_meeting_id);
  perform public._audit(v_uid, 'participant.cancel', 'meeting', p_meeting_id::text,
    jsonb_build_object('from', v_row.status));
end;
$$;

create or replace function public.decide_participant(p_participant_id uuid, p_decision text)
returns public.participant_status
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_meeting_id uuid;
  v_meeting public.meetings;
  v_target public.meeting_participants;
  v_next public.participant_status;
begin
  v_uid := public._require_actor(false, false);
  if p_decision is null or p_decision not in ('approve', 'reject') then
    perform public._err('VALIDATION_FAILED', 'decision');
  end if;

  select mp.meeting_id into v_meeting_id from public.meeting_participants mp where mp.id = p_participant_id;
  if not found then
    perform public._err('NOT_FOUND');
  end if;
  -- 잠금 순서: 모임 → 참가 행
  select * into v_meeting from public.meetings where id = v_meeting_id for update;
  select * into v_target from public.meeting_participants where id = p_participant_id for update;
  if not found then
    perform public._err('NOT_FOUND');
  end if;

  if v_meeting.host_id is distinct from v_uid then
    perform public._err('NOT_HOST');
  end if;
  if v_meeting.status = 'cancelled' then
    perform public._err('MEETING_CANCELLED');
  end if;
  if v_meeting.start_at <= now() then
    perform public._err('MEETING_STARTED');
  end if;
  if v_target.role <> 'guest' or v_target.status not in ('pending', 'waitlisted') then
    perform public._err('INVALID_STATE', v_target.status::text);
  end if;

  if p_decision = 'approve' then
    -- 자리 재검사
    if v_meeting.confirmed_count >= v_meeting.max_participants then
      perform public._err('MEETING_FULL');
    end if;
    v_next := 'confirmed';
    update public.meeting_participants
    set status = v_next, decided_at = now(), confirmed_at = now()
    where id = p_participant_id;
  else
    v_next := 'rejected';
    update public.meeting_participants
    set status = v_next, decided_at = now()
    where id = p_participant_id;
  end if;

  perform public._sync_meeting_counts(v_meeting_id);
  perform public._audit(v_uid, 'participant.decide', 'participant', p_participant_id::text,
    jsonb_build_object('meeting_id', v_meeting_id, 'from', v_target.status, 'to', v_next));
  return v_next;
end;
$$;

-- 출석 체크: 모임장만, 시작 후 ~ 종료 7일, 확정된 게스트만.
create or replace function public.mark_attendance(p_participant_id uuid, p_attendance public.attendance_status)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_meeting_id uuid;
  v_meeting public.meetings;
  v_target public.meeting_participants;
begin
  v_uid := public._require_actor(false, false);
  if p_attendance is null then
    perform public._err('VALIDATION_FAILED', 'attendance');
  end if;

  select mp.meeting_id into v_meeting_id from public.meeting_participants mp where mp.id = p_participant_id;
  if not found then
    perform public._err('NOT_FOUND');
  end if;
  select * into v_meeting from public.meetings where id = v_meeting_id for update;
  select * into v_target from public.meeting_participants where id = p_participant_id for update;
  if not found then
    perform public._err('NOT_FOUND');
  end if;

  if v_meeting.host_id is distinct from v_uid then
    perform public._err('NOT_HOST');
  end if;
  if v_meeting.status = 'cancelled' then
    perform public._err('MEETING_CANCELLED');
  end if;
  if now() < v_meeting.start_at or now() > v_meeting.end_at + interval '7 days' then
    perform public._err('ATTENDANCE_WINDOW_CLOSED');
  end if;
  if v_target.role <> 'guest' or v_target.status <> 'confirmed' then
    perform public._err('INVALID_STATE', v_target.status::text);
  end if;

  update public.meeting_participants
  set attendance = p_attendance,
      attendance_marked_at = case when p_attendance = 'unknown' then null else now() end
  where id = p_participant_id;

  perform public._audit(v_uid, 'participant.attendance', 'participant', p_participant_id::text,
    jsonb_build_object('meeting_id', v_meeting_id, 'attendance', p_attendance));
end;
$$;

-- ===========================================================================
-- 6. 프로필·계정 RPC
-- ===========================================================================

-- 키: nickname?, region_code?, bio?, favorite_category_ids?, agree_terms?, agree_privacy?
-- 그 외 키(is_admin, status 등)는 무시한다. 있는 키만 바꾼다(부분 수정).
create or replace function public.update_my_profile(p jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_private public.user_private;
  v_next public.profiles;
  v_onboarding boolean;
  v_agree_terms boolean;
  v_agree_privacy boolean;
  v_nickname text;
  v_region text;
  v_bio text;
  v_favs text[];
  v_elem jsonb;
begin
  if v_uid is null then
    perform public._err('AUTH_REQUIRED');
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    perform public._err('VALIDATION_FAILED', 'input');
  end if;

  select * into v_profile from public.profiles where id = v_uid for update;
  if not found then
    perform public._err('NOT_FOUND');
  end if;
  if v_profile.status = 'deletion_requested' then
    perform public._err('ACCOUNT_DELETION_REQUESTED');
  end if;
  if v_profile.status = 'restricted' then
    perform public._err('ACCOUNT_RESTRICTED');
  end if;

  select * into v_private from public.user_private where user_id = v_uid for update;
  if not found then
    insert into public.user_private (user_id) values (v_uid) returning * into v_private;
  end if;
  v_onboarding := v_private.terms_agreed_at is null;

  v_agree_terms := coalesce(public._j_bool(p, 'agree_terms'), false);
  v_agree_privacy := coalesce(public._j_bool(p, 'agree_privacy'), false);
  if v_onboarding and (
    public._j_text(p, 'nickname') is null or not v_agree_terms or not v_agree_privacy
  ) then
    perform public._err('PROFILE_INCOMPLETE');
  end if;

  v_next := v_profile;

  if p ? 'nickname' then
    v_nickname := public._j_text(p, 'nickname');
    if v_nickname is null
      or v_nickname !~ '^[가-힣A-Za-z0-9_-]{2,20}$'
      or public._is_reserved_nickname(v_nickname)
    then
      perform public._err('VALIDATION_FAILED', 'nickname');
    end if;
    if exists (
      select 1 from public.profiles o
      where lower(o.nickname) = lower(v_nickname)
        and o.status <> 'deletion_requested'
        and o.id <> v_uid
    ) then
      perform public._err('NICKNAME_TAKEN');
    end if;
    v_next.nickname := v_nickname;
  end if;

  if p ? 'region_code' then
    v_region := public._j_text(p, 'region_code');
    if v_region is not null and not exists (
      select 1 from public.regions rg where rg.code = v_region and rg.is_active
    ) then
      perform public._err('VALIDATION_FAILED', 'region_code');
    end if;
    v_next.region_code := v_region;
  end if;

  if p ? 'bio' then
    v_bio := coalesce(public._j_text(p, 'bio'), '');
    if char_length(v_bio) > 200 then
      perform public._err('VALIDATION_FAILED', 'bio');
    end if;
    v_next.bio := v_bio;
  end if;

  if p ? 'favorite_category_ids' then
    if jsonb_typeof(p -> 'favorite_category_ids') = 'null' then
      v_favs := '{}';
    elsif jsonb_typeof(p -> 'favorite_category_ids') <> 'array' then
      perform public._err('VALIDATION_FAILED', 'favorite_category_ids');
    else
      v_favs := '{}';
      for v_elem in select value from jsonb_array_elements(p -> 'favorite_category_ids') loop
        if jsonb_typeof(v_elem) <> 'string' then
          perform public._err('VALIDATION_FAILED', 'favorite_category_ids');
        end if;
        if not exists (
          select 1 from public.categories c where c.id = (v_elem #>> '{}') and c.is_active
        ) then
          perform public._err('VALIDATION_FAILED', 'favorite_category_ids');
        end if;
        if not ((v_elem #>> '{}') = any (v_favs)) then
          v_favs := v_favs || (v_elem #>> '{}');
        end if;
      end loop;
      if cardinality(v_favs) > 6 then
        perform public._err('VALIDATION_FAILED', 'favorite_category_ids');
      end if;
    end if;
    v_next.favorite_category_ids := v_favs;
  end if;

  begin
    update public.profiles
    set nickname = v_next.nickname,
        region_code = v_next.region_code,
        bio = v_next.bio,
        favorite_category_ids = v_next.favorite_category_ids
    where id = v_uid;
  exception when unique_violation then
    perform public._err('NICKNAME_TAKEN');
  end;

  -- 동의 시각은 비어 있을 때만 기록한다(false는 무시 — 동의 철회는 탈퇴 요청으로).
  update public.user_private
  set terms_agreed_at = case when v_agree_terms and terms_agreed_at is null then now() else terms_agreed_at end,
      privacy_agreed_at = case when v_agree_privacy and privacy_agreed_at is null then now() else privacy_agreed_at end
  where user_id = v_uid;

  if v_next.nickname is distinct from v_profile.nickname then
    perform public._audit(v_uid, 'profile.nickname_change', 'user', v_uid::text,
      jsonb_build_object('onboarding', v_onboarding));
  end if;
end;
$$;

-- 탈퇴 요청(멱등). 시작 전 신청 취소, 주최 중인 시작 전 모임 취소, 공개 프로필 비식별화.
-- auth.users 삭제는 하지 않는다(운영자가 대시보드에서 처리, docs/OPERATIONS.md §5).
create or replace function public.request_account_deletion()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_status public.account_status;
  v_meeting_id uuid;
  v_apps int := 0;
  v_hosted int := 0;
  v_affected int;
begin
  if v_uid is null then
    perform public._err('AUTH_REQUIRED');
  end if;
  select status into v_status from public.profiles where id = v_uid for update;
  if not found then
    perform public._err('NOT_FOUND');
  end if;
  if v_status = 'deletion_requested' then
    return;
  end if;

  -- 1) 시작 전 모임의 본인 게스트 신청 → cancelled (모임 행 잠금 후 정리)
  for v_meeting_id in
    select mp.meeting_id
    from public.meeting_participants mp
    join public.meetings m on m.id = mp.meeting_id
    where mp.user_id = v_uid
      and mp.role = 'guest'
      and mp.status in ('pending', 'confirmed', 'waitlisted')
      and m.status <> 'cancelled'
      and m.start_at > now()
    order by mp.meeting_id
  loop
    perform 1 from public.meetings where id = v_meeting_id for update;
    update public.meeting_participants
    set status = 'cancelled', cancelled_at = now()
    where meeting_id = v_meeting_id
      and user_id = v_uid
      and status in ('pending', 'confirmed', 'waitlisted');
    perform public._sync_meeting_counts(v_meeting_id);
    v_apps := v_apps + 1;
  end loop;

  -- 2) 주최 중인 시작 전 모임 → cancel_meeting과 같은 처리
  for v_meeting_id in
    select m.id from public.meetings m
    where m.host_id = v_uid and m.status <> 'cancelled' and m.start_at > now()
    order by m.id
  loop
    perform 1 from public.meetings where id = v_meeting_id for update;
    v_affected := public._cancel_meeting_core(v_meeting_id, '모임장 탈퇴');
    perform public._audit(v_uid, 'meeting.cancel', 'meeting', v_meeting_id::text,
      jsonb_build_object('by_admin', false, 'affected_guests', v_affected, 'source', 'account_deletion'));
    v_hosted := v_hosted + 1;
  end loop;

  -- 3) 공개 프로필 비식별화
  update public.profiles
  set status = 'deletion_requested',
      nickname = '탈퇴한 사용자',
      bio = '',
      region_code = null,
      favorite_category_ids = '{}'
  where id = v_uid;
  update public.user_private
  set deletion_requested_at = now()
  where user_id = v_uid;

  perform public._audit(v_uid, 'account.deletion_requested', 'user', v_uid::text,
    jsonb_build_object('cancelled_applications', v_apps, 'cancelled_meetings', v_hosted));
end;
$$;

-- ===========================================================================
-- 7. 신고 RPC
-- ===========================================================================

create or replace function public.submit_report(
  p_target_type public.report_target,
  p_target_id uuid,
  p_reason public.report_reason,
  p_body text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_body text;
  v_meeting public.meetings;
  v_id uuid;
begin
  -- 이용 제한 계정도 신고는 허용(안전 신고 경로 유지)
  v_uid := public._require_actor(true, true);
  if p_target_type is null then
    perform public._err('VALIDATION_FAILED', 'target_type');
  end if;
  if p_target_id is null then
    perform public._err('VALIDATION_FAILED', 'target_id');
  end if;
  if p_reason is null then
    perform public._err('VALIDATION_FAILED', 'reason');
  end if;
  v_body := coalesce(public._clean_text(p_body), '');
  if char_length(v_body) > 1000 then
    perform public._err('VALIDATION_FAILED', 'body');
  end if;
  if p_reason = 'other' and v_body = '' then
    perform public._err('VALIDATION_FAILED', 'body');
  end if;

  if p_target_type = 'meeting' then
    select * into v_meeting from public.meetings where id = p_target_id;
    if not found or (v_meeting.is_hidden and v_meeting.host_id is distinct from v_uid and not public.is_admin()) then
      perform public._err('NOT_FOUND');
    end if;
    if v_meeting.host_id = v_uid then
      perform public._err('CANNOT_REPORT_SELF');
    end if;
  else
    if not exists (select 1 from public.profiles where id = p_target_id) then
      perform public._err('NOT_FOUND');
    end if;
    if p_target_id = v_uid then
      perform public._err('CANNOT_REPORT_SELF');
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('hanpan.submit_report'), hashtext(v_uid::text));
  if (select count(*) from public.reports r
      where r.reporter_id = v_uid and r.created_at > now() - interval '24 hours') >= 10 then
    perform public._err('RATE_LIMITED', 'report_24h');
  end if;
  if exists (
    select 1 from public.reports r
    where r.reporter_id = v_uid
      and r.target_type = p_target_type
      and coalesce(r.target_meeting_id, r.target_user_id) = p_target_id
      and r.status in ('received', 'reviewing')
  ) then
    perform public._err('DUPLICATE_REPORT');
  end if;

  begin
    insert into public.reports (reporter_id, target_type, target_meeting_id, target_user_id, reason, body)
    values (
      v_uid,
      p_target_type,
      case when p_target_type = 'meeting' then p_target_id end,
      case when p_target_type = 'user' then p_target_id end,
      p_reason,
      v_body
    )
    returning id into v_id;
  exception when unique_violation then
    perform public._err('DUPLICATE_REPORT');
  end;
  return v_id;
end;
$$;

-- ===========================================================================
-- 8. 관리자 RPC (모두 is_admin() 아니면 NOT_ADMIN). 행 반환 함수는 snake_case 컬럼.
-- ===========================================================================

create or replace function public.admin_list_reports(
  p_status public.report_status default null,
  p_limit int default 50,
  p_offset int default 0
)
returns setof public.reports
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    perform public._err('NOT_ADMIN');
  end if;
  return query
    select r.*
    from public.reports r
    where p_status is null or r.status = p_status
    order by r.created_at desc, r.id
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.admin_update_report(
  p_report_id uuid,
  p_status public.report_status,
  p_admin_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_report public.reports;
  v_note text;
begin
  if not public.is_admin() then
    perform public._err('NOT_ADMIN');
  end if;
  if p_status is null then
    perform public._err('VALIDATION_FAILED', 'status');
  end if;
  v_note := public._clean_text(p_admin_note);
  if v_note is not null and char_length(v_note) > 1000 then
    perform public._err('VALIDATION_FAILED', 'admin_note');
  end if;
  select * into v_report from public.reports where id = p_report_id for update;
  if not found then
    perform public._err('NOT_FOUND');
  end if;

  update public.reports
  set status = p_status,
      admin_note = v_note,
      handled_by = case when p_status in ('resolved', 'dismissed') then v_uid end,
      handled_at = case when p_status in ('resolved', 'dismissed') then now() end
  where id = p_report_id;

  perform public._audit(v_uid, 'admin.report_update', 'report', p_report_id::text,
    jsonb_build_object('from', v_report.status, 'to', p_status));
end;
$$;

create or replace function public.admin_set_meeting_hidden(
  p_meeting_id uuid,
  p_hidden boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_reason text;
begin
  if not public.is_admin() then
    perform public._err('NOT_ADMIN');
  end if;
  if p_hidden is null then
    perform public._err('VALIDATION_FAILED', 'hidden');
  end if;
  v_reason := public._clean_text(p_reason);
  if p_hidden and (v_reason is null or char_length(v_reason) > 200) then
    perform public._err('VALIDATION_FAILED', 'reason');
  end if;
  perform 1 from public.meetings where id = p_meeting_id for update;
  if not found then
    perform public._err('NOT_FOUND');
  end if;

  update public.meetings
  set is_hidden = p_hidden,
      hidden_reason = case when p_hidden then v_reason end
  where id = p_meeting_id;

  perform public._audit(v_uid, 'admin.meeting_hidden', 'meeting', p_meeting_id::text,
    jsonb_build_object('hidden', p_hidden));
end;
$$;

-- active·restricted만. 본인 대상·탈퇴 요청 계정 변경 불가. 해당 사용자의 모임을 자동 취소하지 않는다.
-- p_note(관리자 작성 메모, ≤200)는 감사 로그 meta.note에 남긴다(이용자 입력이 아님).
create or replace function public.admin_set_user_status(
  p_user_id uuid,
  p_status public.account_status,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_current public.account_status;
  v_note text;
begin
  if not public.is_admin() then
    perform public._err('NOT_ADMIN');
  end if;
  if p_status is null or p_status not in ('active', 'restricted') then
    perform public._err('VALIDATION_FAILED', 'status');
  end if;
  if p_user_id is null or p_user_id = v_uid then
    perform public._err('VALIDATION_FAILED', 'user_id');
  end if;
  v_note := public._clean_text(p_note);
  if v_note is not null and char_length(v_note) > 200 then
    perform public._err('VALIDATION_FAILED', 'note');
  end if;

  select status into v_current from public.profiles where id = p_user_id for update;
  if not found then
    perform public._err('NOT_FOUND');
  end if;
  if v_current = 'deletion_requested' then
    perform public._err('VALIDATION_FAILED', 'status');
  end if;
  if v_current = p_status then
    return;
  end if;

  update public.profiles set status = p_status where id = p_user_id;
  perform public._audit(v_uid, 'admin.user_status', 'user', p_user_id::text,
    jsonb_build_object('from', v_current, 'to', p_status, 'note', v_note));
end;
$$;

-- 사용자 검색(닉네임 부분 일치 또는 id 정확 일치). 최근 30일 해당 사용자 대상 신고 수 포함.
create or replace function public.admin_search_users(p_query text default null, p_limit int default 20)
returns table (
  id uuid,
  nickname text,
  status public.account_status,
  created_at timestamptz,
  recent_report_count int
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_q text;
  v_pattern text;
begin
  if not public.is_admin() then
    perform public._err('NOT_ADMIN');
  end if;
  v_q := left(public._clean_text(p_query), 50);
  if v_q is not null then
    v_pattern := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  return query
    select
      p.id,
      p.nickname,
      p.status,
      p.created_at,
      (
        select count(*)::int from public.reports r
        where r.target_user_id = p.id and r.created_at > now() - interval '30 days'
      ) as recent_report_count
    from public.profiles p
    where v_pattern is null
       or p.nickname ilike v_pattern escape '\'
       or p.id::text = lower(v_q)
    order by p.created_at desc, p.id
    limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

-- ===========================================================================
-- 9. EXECUTE 권한 — 함수마다 회수 후 필요한 역할에만 다시 준다.
-- ===========================================================================

-- 내부용: 누구에게도 주지 않는다(security definer RPC 안에서 소유자 권한으로 호출된다).
revoke all on function public._err(text, text) from public, anon, authenticated;
revoke all on function public._clean_text(text) from public, anon, authenticated;
revoke all on function public._j_text(jsonb, text) from public, anon, authenticated;
revoke all on function public._j_int(jsonb, text) from public, anon, authenticated;
revoke all on function public._j_bool(jsonb, text) from public, anon, authenticated;
revoke all on function public._j_uuid(jsonb, text) from public, anon, authenticated;
revoke all on function public._j_timestamptz(jsonb, text) from public, anon, authenticated;
revoke all on function public._require_actor(boolean, boolean) from public, anon, authenticated;
revoke all on function public._audit(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public._sync_meeting_counts(uuid) from public, anon, authenticated;
revoke all on function public._cancel_meeting_core(uuid, text) from public, anon, authenticated;
revoke all on function public._is_reserved_nickname(text) from public, anon, authenticated;
revoke all on function public._meeting_input(jsonb, public.meetings) from public, anon, authenticated;
revoke all on function public._participation_json(public.meeting_participants) from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- 공개 조회(anon 포함)
revoke all on function public.meeting_to_json(public.meetings) from public, anon, authenticated;
revoke all on function public.list_public_meetings(timestamptz, timestamptz, text, text, text, boolean, text, int, int) from public, anon, authenticated;
revoke all on function public.get_meeting(uuid) from public, anon, authenticated;
grant execute on function public.meeting_to_json(public.meetings) to anon, authenticated;
grant execute on function public.list_public_meetings(timestamptz, timestamptz, text, text, text, boolean, text, int, int) to anon, authenticated;
grant execute on function public.get_meeting(uuid) to anon, authenticated;

-- 로그인 사용자 전용
revoke all on function public.get_my_profile() from public, anon, authenticated;
revoke all on function public.get_my_participation(uuid) from public, anon, authenticated;
revoke all on function public.list_my_meetings() from public, anon, authenticated;
revoke all on function public.list_meeting_participants(uuid) from public, anon, authenticated;
revoke all on function public.create_meeting(jsonb) from public, anon, authenticated;
revoke all on function public.update_meeting(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.cancel_meeting(uuid, text) from public, anon, authenticated;
revoke all on function public.set_meeting_recruiting(uuid, boolean) from public, anon, authenticated;
revoke all on function public.apply_to_meeting(uuid, text) from public, anon, authenticated;
revoke all on function public.cancel_my_application(uuid) from public, anon, authenticated;
revoke all on function public.decide_participant(uuid, text) from public, anon, authenticated;
revoke all on function public.mark_attendance(uuid, public.attendance_status) from public, anon, authenticated;
revoke all on function public.update_my_profile(jsonb) from public, anon, authenticated;
revoke all on function public.request_account_deletion() from public, anon, authenticated;
revoke all on function public.submit_report(public.report_target, uuid, public.report_reason, text) from public, anon, authenticated;
revoke all on function public.admin_list_reports(public.report_status, int, int) from public, anon, authenticated;
revoke all on function public.admin_update_report(uuid, public.report_status, text) from public, anon, authenticated;
revoke all on function public.admin_set_meeting_hidden(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.admin_set_user_status(uuid, public.account_status, text) from public, anon, authenticated;
revoke all on function public.admin_search_users(text, int) from public, anon, authenticated;

grant execute on function public.get_my_profile() to authenticated;
grant execute on function public.get_my_participation(uuid) to authenticated;
grant execute on function public.list_my_meetings() to authenticated;
grant execute on function public.list_meeting_participants(uuid) to authenticated;
grant execute on function public.create_meeting(jsonb) to authenticated;
grant execute on function public.update_meeting(uuid, jsonb) to authenticated;
grant execute on function public.cancel_meeting(uuid, text) to authenticated;
grant execute on function public.set_meeting_recruiting(uuid, boolean) to authenticated;
grant execute on function public.apply_to_meeting(uuid, text) to authenticated;
grant execute on function public.cancel_my_application(uuid) to authenticated;
grant execute on function public.decide_participant(uuid, text) to authenticated;
grant execute on function public.mark_attendance(uuid, public.attendance_status) to authenticated;
grant execute on function public.update_my_profile(jsonb) to authenticated;
grant execute on function public.request_account_deletion() to authenticated;
grant execute on function public.submit_report(public.report_target, uuid, public.report_reason, text) to authenticated;
grant execute on function public.admin_list_reports(public.report_status, int, int) to authenticated;
grant execute on function public.admin_update_report(uuid, public.report_status, text) to authenticated;
grant execute on function public.admin_set_meeting_hidden(uuid, boolean, text) to authenticated;
grant execute on function public.admin_set_user_status(uuid, public.account_status, text) to authenticated;
grant execute on function public.admin_search_users(text, int) to authenticated;
