#!/usr/bin/env node
/**
 * supabase/migrations/*.sql을 파일명 순서로 이어 붙여 한 파일로 만든다(Supabase CLI 없이 SQL Editor에 붙여 넣기용).
 *
 *   npm run db:bundle            → supabase/.bundle/all-migrations.sql (Git 제외)
 *   node scripts/bundle-migrations.mjs <출력 경로>
 *
 * - 개발용 seed(supabase/seed.sql)는 넣지 않는다. 마이그레이션 파일에 seed 마커가 있으면 실패한다.
 * - 파일 이름 형식(YYYYMMDDHHMMSS_name.sql)이 아닌 파일은 건너뛴다(테스트 하네스와 같은 규칙).
 * - 이미 적용한 마이그레이션을 다시 실행하면 실패할 수 있다(create table 등). 처음 설정하는 빈 프로젝트에만 통째로 쓰고,
 *   이후에는 새로 추가된 파일만 실행한다(docs/DEPLOYMENT.md §3.2).
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');
const migrationsDir = join(projectRoot, 'supabase', 'migrations');
const outputFile = resolve(projectRoot, process.argv[2] ?? join('supabase', '.bundle', 'all-migrations.sql'));

const MIGRATION_NAME = /^\d{14}_[a-z0-9_]+\.sql$/;
const SEED_MARKER = 'HANPAN_DEV_SEED_MARKER';

const files = readdirSync(migrationsDir)
  .filter((name) => MIGRATION_NAME.test(name))
  .sort();

if (files.length === 0) {
  console.error(`[db:bundle] 마이그레이션 파일이 없습니다: ${relative(projectRoot, migrationsDir)}`);
  process.exit(1);
}

const parts = [
  '-- HANPAN 마이그레이션 묶음 (scripts/bundle-migrations.mjs가 생성 — 직접 고치지 말 것)',
  '-- 빈 Supabase 프로젝트의 SQL Editor에서 한 번에 실행한다. 개발용 seed는 들어 있지 않다.',
  `-- 포함 파일(순서대로): ${files.join(', ')}`,
  '',
];

for (const name of files) {
  const sql = readFileSync(join(migrationsDir, name), 'utf8');
  if (sql.includes(SEED_MARKER)) {
    console.error(`[db:bundle] 실패: ${name}에 개발용 seed 마커가 있습니다. seed는 마이그레이션에 넣지 않습니다.`);
    process.exit(1);
  }
  parts.push(`-- ===========================================================================`);
  parts.push(`-- ${name}`);
  parts.push(`-- ===========================================================================`);
  parts.push(sql.trimEnd());
  parts.push('');
}

mkdirSync(dirname(outputFile), { recursive: true });
writeFileSync(outputFile, `${parts.join('\n')}\n`, 'utf8');
console.log(`[db:bundle] ${files.length}개 파일 → ${relative(projectRoot, outputFile)}`);
for (const name of files) console.log(`  - ${name}`);
