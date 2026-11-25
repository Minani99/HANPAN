-- HANPAN 마이그레이션 5: 닉네임 예약어 규칙 완화
-- 명세: docs/DB_SCHEMA.md §9.12. 프론트 src/domain/limits.ts(isReservedNickname)와 같은 규칙이어야 한다.
--
-- 이미 적용된 환경을 고려해 기존 마이그레이션(20261124000300_functions.sql)은 고치지 않고 함수만 교체한다.
-- update_my_profile은 이 함수를 이름으로 호출하므로 다시 만들 필요가 없다.
--
-- 규칙: 소문자로 바꾸고 공백·`_`·`-`를 지운 값으로 비교한다.
--   - 포함 금지: 관리자, 운영자, 운영팀, admin, hanpan
--   - 완전 일치 금지: 한판, 탈퇴한사용자  (예: '한판'은 금지, '한판승부'는 허용)

create or replace function public._is_reserved_nickname(p_nickname text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  with n as (
    select regexp_replace(lower(coalesce(p_nickname, '')), '[[:space:]_-]', '', 'g') as v
  )
  select exists (
           select 1
           from n, unnest(array['관리자', '운영자', '운영팀', 'admin', 'hanpan']) as w(word)
           where position(w.word in n.v) > 0
         )
      or (select n.v from n) = any (array['한판', '탈퇴한사용자']);
$$;

-- create or replace는 기존 권한을 유지하지만, 내부 함수임을 분명히 하려고 다시 회수한다.
revoke all on function public._is_reserved_nickname(text) from public, anon, authenticated;
