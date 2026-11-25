/**
 * 개발 seed(supabase/seed.sql) 점검. 마스터 프롬프트 8장 #14(개발 seed가 운영 DB에 자동 유입되지 않음).
 * - seed.sql 첫 줄의 운영 적용 금지 주석·마커
 * - 마이그레이션에 seed가 섞이지 않음(schema.test.ts에서도 0행 확인)
 * - seed.sql이 마이그레이션 위에서 오류 없이·멱등하게 적용되고 카운트 불변식을 지킴
 */
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SUPABASE_DIR, createTestDb, readSql, type TestDb } from './harness';

const SEED_PATH = join(SUPABASE_DIR, 'seed.sql');

let db: TestDb;
beforeEach(async () => {
  db = await createTestDb();
});
afterEach(async () => {
  await db.close();
});

describe('supabase/seed.sql', () => {
  it('첫 줄에 "운영 DB 적용 금지" 주석과 seed 마커가 있다', () => {
    const firstLine = readSql(SEED_PATH).split(/\r?\n/, 1)[0] ?? '';
    expect(firstLine.startsWith('--')).toBe(true);
    expect(firstLine).toContain('운영 DB 적용 금지');
    expect(firstLine).toContain('HANPAN_DEV_SEED_MARKER');
  });

  it('마이그레이션 위에 오류 없이 적용되고, 두 번 실행해도 중복되지 않으며 카운트가 맞다', async () => {
    const sql = readSql(SEED_PATH);
    await db.pg.exec(sql);
    const first = await db.asOwner((q) =>
      q.one<{ users: number; meetings: number; participants: number }>(
        `select (select count(*)::int from auth.users) as users,
                (select count(*)::int from public.meetings) as meetings,
                (select count(*)::int from public.meeting_participants) as participants`,
      ),
    );
    expect(first.users).toBeGreaterThan(0);
    expect(first.meetings).toBeGreaterThan(0);
    await db.pg.exec(sql);
    const second = await db.asOwner((q) =>
      q.one(
        `select (select count(*)::int from auth.users) as users,
                (select count(*)::int from public.meetings) as meetings,
                (select count(*)::int from public.meeting_participants) as participants`,
      ),
    );
    expect(second).toEqual(first);
    expect(await db.countMismatches()).toEqual([]);
  });

  it('예시 모임·공간은 모두 [예시] 표시가 있고, 공개 목록에서 조회된다', async () => {
    await db.pg.exec(readSql(SEED_PATH));
    const titles = await db.asOwner((q) => q.query<{ title: string }>('select title from public.meetings'));
    expect(titles.every((t) => t.title.startsWith('[예시]'))).toBe(true);
    const venues = await db.asOwner((q) => q.query<{ name: string }>('select name from public.venues'));
    expect(venues.every((v) => v.name.startsWith('[예시]'))).toBe(true);
    const list = await db.rpc<{ total: number }>(null, 'select public.list_public_meetings()');
    expect(list.total).toBeGreaterThan(0);
  });
});
