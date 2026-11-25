/**
 * npm run db:bundle(scripts/bundle-migrations.mjs) 결과를 빈 DB에 한 번에 실행해도 마이그레이션을 순서대로 적용한 것과
 * 같은 결과가 되는지 확인한다(SQL Editor 붙여 넣기용). seed는 포함하지 않는다.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, describe, expect, it } from 'vitest';
import { SUPABASE_DIR, SUPABASE_STUB_SQL, migrationFiles } from './harness';

const ROOT = join(SUPABASE_DIR, '..');
const tempDir = mkdtempSync(join(tmpdir(), 'hanpan-bundle-'));

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('db:bundle', () => {
  it('마이그레이션을 파일명 순서로 이어 붙이고(seed 제외), 빈 DB에 한 번에 적용된다', async () => {
    const output = join(tempDir, 'all-migrations.sql');
    const run = spawnSync(process.execPath, [join(ROOT, 'scripts', 'bundle-migrations.mjs'), output], { encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);

    const bundle = readFileSync(output, 'utf8');
    const names = migrationFiles().map((file) => basename(file));
    const positions = names.map((name) => bundle.indexOf(`-- ${name}`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(bundle).not.toContain('HANPAN_DEV_SEED_MARKER');
    expect(bundle).not.toContain('[예시]');

    const pg = await PGlite.create();
    try {
      await pg.exec(SUPABASE_STUB_SQL);
      await pg.exec(bundle);
      const result = await pg.query<{ regions: number; categories: number; relaxed: boolean; blocked: boolean }>(
        `select (select count(*)::int from public.regions) as regions,
                (select count(*)::int from public.categories) as categories,
                public._is_reserved_nickname('한판승부') as relaxed,
                public._is_reserved_nickname('한판') as blocked`,
      );
      expect(result.rows[0]).toEqual({ regions: 6, categories: 6, relaxed: false, blocked: true });
    } finally {
      await pg.close();
    }
  }, 60_000);
});
