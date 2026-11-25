/**
 * PGlite가 Supabase 테스트에 필요한 기능을 지원하는지 기록하는 테스트(Phase 2 스파이크 결과).
 * 실패하면 하네스 전제가 깨진 것이므로 다른 DB 테스트 결과도 믿을 수 없다.
 * 결과 요약은 docs/TEST_PLAN.md §5.1.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite, type PGliteInterface } from '@electric-sql/pglite';
import { SUPABASE_STUB_SQL, expectPermissionDenied } from './harness';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';

let db: PGliteInterface;

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(SUPABASE_STUB_SQL);
  await db.exec(`
    create table public.notes (id int primary key, owner uuid, body text, secret text);
    alter table public.notes enable row level security;
    create policy notes_own on public.notes for select to authenticated using (owner = (select auth.uid()));
    revoke all on public.notes from anon, authenticated;
    grant select (id, owner, body) on public.notes to authenticated;
    insert into public.notes values (1, '${A}', 'a', 's1'), (2, '${B}', 'b', 's2');

    create function public.count_all_notes() returns bigint
      language sql stable security definer set search_path = public, pg_temp
      as $$ select count(*) from public.notes $$;
    revoke all on function public.count_all_notes() from public, anon, authenticated;
    grant execute on function public.count_all_notes() to authenticated;

    create function public.lock_note(p int) returns text
      language plpgsql security definer set search_path = public, pg_temp
      as $$ declare v text; begin select body into v from public.notes where id = p for update; return v; end $$;

    create table public.signups (id uuid primary key);
    create function public.on_signup() returns trigger
      language plpgsql security definer set search_path = public, pg_temp
      as $$ begin insert into public.signups values (new.id); return new; end $$;
    revoke all on function public.on_signup() from public, anon, authenticated, supabase_auth_admin;
    create trigger on_signup after insert on auth.users for each row execute function public.on_signup();

    create table public.gen (a int, b int, c int generated always as (a - b) stored);
  `);
});

afterAll(async () => {
  await db.close();
});

describe('PGlite 기능 확인', () => {
  it('PostgreSQL 버전을 기록한다(Supabase와 메이저 버전이 다를 수 있음)', async () => {
    const { rows } = await db.query<{ v: string; su: boolean }>(
      `select version() as v, (select rolsuper from pg_roles where rolname = current_user) as su`,
    );
    expect(rows[0]?.v).toMatch(/PostgreSQL \d+/);
    expect(rows[0]?.su).toBe(true);
  });

  it('set local role로 역할을 바꾸고 트랜잭션이 끝나면 돌아온다', async () => {
    const inside = await db.transaction(async (tx) => {
      await tx.query('set local role anon');
      return (await tx.query<{ u: string }>('select current_user as u')).rows[0]?.u;
    });
    expect(inside).toBe('anon');
    const after = (await db.query<{ u: string }>('select current_user as u')).rows[0]?.u;
    expect(after).toBe('postgres');
  });

  it('auth.uid()는 request.jwt.claims(JSON)와 request.jwt.claim.sub 둘 다 읽는다', async () => {
    const fromClaims = await db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: A, role: 'authenticated' })]);
      return (await tx.query<{ u: string; r: string }>('select auth.uid() as u, auth.role() as r')).rows[0];
    });
    expect(fromClaims).toEqual({ u: A, r: 'authenticated' });

    const fromClaimSub = await db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [B]);
      return (await tx.query<{ u: string }>('select auth.uid() as u')).rows[0]?.u;
    });
    expect(fromClaimSub).toBe(B);

    // 롤백 뒤 GUC는 ''로 남는다 → nullif 처리가 없으면 다음 요청의 claims를 가린다(스파이크에서 발견).
    const afterRollback = await db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: A })]);
      return (await tx.query<{ u: string }>('select auth.uid() as u')).rows[0]?.u;
    });
    expect(afterRollback).toBe(A);
    const none = (await db.query<{ u: string | null }>('select auth.uid() as u')).rows[0]?.u;
    expect(none).toBeNull();
  });

  it('RLS가 비소유자 역할에 적용되고 컬럼 단위 grant가 동작한다', async () => {
    const rows = await db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: A })]);
      await tx.query('set local role authenticated');
      return (await tx.query('select id, owner, body from public.notes order by id')).rows;
    });
    expect(rows).toEqual([{ id: 1, owner: A, body: 'a' }]);

    await expectPermissionDenied(
      db.transaction(async (tx) => {
        await tx.query('set local role authenticated');
        await tx.query('select secret from public.notes');
      }),
    );
    await expectPermissionDenied(
      db.transaction(async (tx) => {
        await tx.query('set local role anon');
        await tx.query('select id from public.notes');
      }),
    );
  });

  it('security definer 함수는 소유자 권한으로 실행되고(RLS 우회) EXECUTE 회수가 적용된다', async () => {
    const count = await db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: A })]);
      await tx.query('set local role authenticated');
      return (await tx.query<{ n: number }>('select public.count_all_notes() as n')).rows[0]?.n;
    });
    expect(Number(count)).toBe(2);
    await expectPermissionDenied(
      db.transaction(async (tx) => {
        await tx.query('set local role anon');
        await tx.query('select public.count_all_notes()');
      }),
    );
  });

  it('auth.users after insert 트리거가 비소유자 역할(supabase_auth_admin)의 insert에서도 실행된다', async () => {
    await db.transaction(async (tx) => {
      await tx.query('set local role supabase_auth_admin');
      await tx.query(`insert into auth.users (id, email) values ($1, 'x@example.test')`, [A]);
    });
    const { rows } = await db.query('select id from public.signups');
    expect(rows).toEqual([{ id: A }]);
  });

  it('함수 안의 select ... for update가 실행되고 pg_get_functiondef로 확인할 수 있다', async () => {
    const { rows } = await db.query<{ v: string; has: boolean }>(
      `select public.lock_note(1) as v,
              position('for update' in pg_get_functiondef('public.lock_note(int)'::regprocedure)) > 0 as has`,
    );
    expect(rows[0]).toEqual({ v: 'a', has: true });
  });

  it('pg_advisory_xact_lock, gen_random_uuid, STORED 생성 컬럼, P0001 오류 코드·detail', async () => {
    await db.query(`select pg_advisory_xact_lock(hashtext('a'), hashtext('b'))`);
    const uuid = (await db.query<{ u: string }>('select gen_random_uuid()::text as u')).rows[0]?.u;
    expect(uuid).toMatch(/^[0-9a-f-]{36}$/);
    await db.query('insert into public.gen (a, b) values (5, 2)');
    expect((await db.query('select c from public.gen')).rows).toEqual([{ c: 3 }]);
    await expect(
      db.query(`do $$ begin raise exception using errcode = 'P0001', message = 'NOT_HOST', detail = 'x'; end $$`),
    ).rejects.toMatchObject({ code: 'P0001', message: 'NOT_HOST', detail: 'x' });
  });
});
