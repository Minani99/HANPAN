-- HANPAN 마이그레이션 4/4: 기준 데이터(권역·카테고리)
-- 명세: docs/DB_SCHEMA.md §3
-- 멱등: 이미 있는 행은 건드리지 않는다(운영 중 이름·순서를 바꿨다면 그대로 유지).
-- 예시 사용자·모임은 여기에 넣지 않는다(개발용은 supabase/seed.sql).
-- games는 기준 데이터를 넣지 않는다(게임명 직접 입력 우선, 관리자가 추가).

insert into public.regions (code, name, sort_order) values
  ('dunsan_tanbang', '둔산·탄방', 10),
  ('gung_bongmyeong', '궁동·봉명', 20),
  ('eunhaeng_daeheung', '은행·대흥', 30),
  ('noeun_jijok', '노은·지족', 40),
  ('gwanjeo_gasuwon', '관저·가수원', 50),
  ('etc_daejeon', '그 외 대전', 90)
on conflict (code) do nothing;

insert into public.categories (id, name, description, sort_order) values
  ('party', '파티·캐주얼', '', 10),
  ('deduction', '추리·마피아', '', 20),
  ('strategy', '전략', '', 30),
  ('murder_mystery', '머더미스터리', '', 40),
  ('mahjong_etc', '마작·기타', '', 50),
  ('holdem_social', '홀덤(비금전)', '금전·경품을 걸지 않는 홀덤 모임만 열 수 있어요.', 60)
on conflict (id) do nothing;
