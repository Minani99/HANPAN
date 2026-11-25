-- HANPAN 마이그레이션 8: 닉네임 예약어에 '운영진'(포함 금지) 추가
-- 명세: docs/DB_SCHEMA.md §9.12. 프론트 src/domain/limits.ts(isReservedNickname)와 같은 규칙이어야 한다.
--
-- 마이그레이션 5의 규칙을 그대로 두고 포함 금지 목록에 '운영진'만 더한다(기존 파일은 고치지 않는다).
-- 규칙: 소문자로 바꾸고 공백·`_`·`-`를 지운 값으로 비교한다.
--   - 포함 금지: 관리자, 운영자, 운영진, 운영팀, admin, hanpan
--   - 완전 일치 금지: 한판, 탈퇴한사용자
-- 이미 '운영진'이 들어간 닉네임을 쓰는 계정은 그대로 두며(소급 변경 없음), 다음에 닉네임을 바꿀 때부터 적용된다.

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
           from n, unnest(array['관리자', '운영자', '운영진', '운영팀', 'admin', 'hanpan']) as w(word)
           where position(w.word in n.v) > 0
         )
      or (select n.v from n) = any (array['한판', '탈퇴한사용자']);
$$;

revoke all on function public._is_reserved_nickname(text) from public, anon, authenticated;
