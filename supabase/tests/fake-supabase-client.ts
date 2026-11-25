/**
 * PGlite로 실제 SQL 함수를 실행하는 가짜 Supabase 클라이언트(계약 테스트용).
 *
 * src/data/supabase/client.ts의 SupabaseClientLike를 구현해 실제 어댑터(createSupabaseAdapter)에 주입한다.
 * PostgREST가 하는 일을 최소한으로 흉내 낸다:
 * - `.rpc(fn, args)` → 현재 세션의 역할(anon 또는 authenticated + JWT sub)로
 *   `select public.<fn>(p_a => $1::<타입>, ...)`(지정 인자)를 실행한다. 인자 타입은 pg_proc에서 읽는다.
 *   인자 이름이 함수에 없으면 PostgREST처럼 PGRST202. jsonb 인자는 JSON 값 그대로(JSON.stringify) 넘긴다.
 * - 결과는 `{ data, error: { code, message, details, hint } | null, status }`. void 함수는 data null.
 *   setof/table을 돌려주는 함수는 PostgREST처럼 행 객체 배열(jsonb_agg(to_jsonb(row)))로 돌려준다.
 * - `.from('categories'|'regions').select(cols).eq(col, v).order(col)`만 지원.
 * - `.table('venues'|'categories')`: insert(row).select(cols) / update(patch).eq(col, v).select(cols) —
 *   PostgREST와 같이 jsonb_populate_record로 형 변환하고, 현재 역할(RLS 적용)로 실행해 returning 행을 돌려준다.
 *   RLS에 막힌 update는 0행([])이다.
 * - auth는 메모리 세션(signInAs/signOut)과 이벤트만.
 *
 * 흉내 내지 않는 것(= 계약 테스트로 검증되지 않는 것): HTTP·JSON 직렬화, PostgREST의 함수 선택·인자 변환 세부,
 * 응답 헤더·상태 코드의 정확한 값, JWT 검증, 실제 Supabase Auth. → docs/TEST_PLAN.md §6
 */
import type {
  AuthSessionLike,
  PostgrestErrorLike,
  PostgrestResultLike,
  SupabaseClientLike,
} from '../../src/data/supabase/client';
import type { Q, TestDb } from './harness';

interface FunctionInfo {
  argNames: string[];
  argTypes: string[];
  returnType: string;
  returnsSet: boolean;
}

type AuthListener = (event: string, session: AuthSessionLike | null) => void;

export interface FakeSupabase extends SupabaseClientLike {
  /** 로그인(세션 설정 + SIGNED_IN 이벤트) */
  signInAs(userId: string): void;
  /** 로그아웃(세션 삭제 + SIGNED_OUT 이벤트) */
  signOutNow(): void;
  readonly sessionUserId: string | null;
  /** 실행한 RPC 이름 기록 */
  readonly rpcLog: string[];
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const COLUMN_LIST = /^[a-z_]+(\s*,\s*[a-z_]+)*$/;

interface PgErrorLike {
  code?: string;
  message?: string;
  detail?: string;
  hint?: string;
}

function toPostgrestError(error: unknown): PostgrestErrorLike {
  const e = (typeof error === 'object' && error !== null ? error : {}) as PgErrorLike;
  return {
    code: e.code ?? '',
    message: e.message ?? String(error),
    details: e.detail ?? null,
    hint: e.hint ?? null,
  };
}

function statusFor(code: string | null | undefined, anon: boolean): number {
  if (code === '42501') return anon ? 401 : 403;
  if (code === 'PGRST202') return 404;
  return 400;
}

/** PostgREST처럼 JSON 값을 함수 인자 텍스트로 바꾼다(jsonb는 JSON 그대로) */
function serializeArg(value: unknown, type: string): unknown {
  if (value === null) return null;
  if (type === 'jsonb' || type === 'json') return JSON.stringify(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function createFakeSupabase(db: TestDb): FakeSupabase {
  let sessionUserId: string | null = null;
  const listeners = new Set<AuthListener>();
  const functions = new Map<string, FunctionInfo | null>();
  const rpcLog: string[] = [];

  function emit(event: string) {
    const session = sessionUserId ? { user: { id: sessionUserId } } : null;
    for (const listener of [...listeners]) listener(event, session);
  }

  /** 현재 세션의 역할로 실행(트랜잭션 단위로 역할·claims 전환 — harness와 같은 방식) */
  function asCurrentRole<T>(work: (q: Q) => Promise<T>): Promise<T> {
    return sessionUserId ? db.asUser(sessionUserId, work) : db.asAnon(work);
  }

  async function functionInfo(name: string): Promise<FunctionInfo | null> {
    if (functions.has(name)) return functions.get(name) ?? null;
    const rows = await db.asOwner((q) =>
      q.query<{ argnames: string[] | null; argtypes: string[]; rettype: string; retset: boolean }>(
        `select p.proargnames as argnames,
                array(select format_type(t.oid, null) from unnest(p.proargtypes::oid[]) with ordinality as t(oid, n) order by t.n) as argtypes,
                format_type(p.prorettype, null) as rettype,
                p.proretset as retset
         from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
         where ns.nspname = 'public' and p.proname = $1`,
        [name],
      ),
    );
    if (rows.length > 1) throw new Error(`fake: 오버로드된 함수는 지원하지 않습니다: ${name}`);
    const row = rows[0];
    const info = row
      ? { argNames: row.argnames ?? [], argTypes: row.argtypes, returnType: row.rettype, returnsSet: row.retset }
      : null;
    functions.set(name, info);
    return info;
  }

  async function rpc(fn: string, args: Record<string, unknown>): Promise<PostgrestResultLike> {
    rpcLog.push(fn);
    const anon = sessionUserId === null;
    const notFound = (): PostgrestResultLike => ({
      data: null,
      error: { code: 'PGRST202', message: `Could not find the function public.${fn}`, details: null, hint: null },
      status: 404,
    });
    if (!IDENTIFIER.test(fn)) return notFound();
    const info = await functionInfo(fn);
    if (!info) return notFound();

    const entries = Object.entries(args).filter(([, value]) => value !== undefined);
    const params: unknown[] = [];
    const named: string[] = [];
    for (const [name, value] of entries) {
      const index = info.argNames.indexOf(name);
      if (index < 0) return notFound();
      const type = info.argTypes[index] ?? 'text';
      params.push(serializeArg(value, type));
      named.push(`${name} => $${params.length}::${type}`);
    }
    const call = `public.${fn}(${named.join(', ')})`;
    const sql = info.returnsSet
      ? `select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) as result from ${call} r`
      : `select ${call} as result`;
    try {
      const value = await asCurrentRole((q) => q.value<unknown>(sql, params));
      return { data: info.returnType === 'void' ? null : (value ?? null), error: null, status: 200 };
    } catch (error) {
      const pgError = toPostgrestError(error);
      return { data: null, error: pgError, status: statusFor(pgError.code, anon) };
    }
  }

  const client: FakeSupabase = {
    get sessionUserId() {
      return sessionUserId;
    },
    rpcLog,
    signInAs(userId) {
      sessionUserId = userId;
      emit('SIGNED_IN');
    },
    signOutNow() {
      sessionUserId = null;
      emit('SIGNED_OUT');
    },
    rpc,
    from(relation) {
      if (relation !== 'categories' && relation !== 'regions') throw new Error(`fake: 지원하지 않는 테이블 ${String(relation)}`);
      return {
        select(columns) {
          if (!COLUMN_LIST.test(columns)) throw new Error(`fake: 지원하지 않는 select ${columns}`);
          return {
            eq(eqColumn, eqValue) {
              if (!IDENTIFIER.test(eqColumn)) throw new Error('fake: 잘못된 컬럼');
              return {
                async order(orderColumn, options) {
                  if (!IDENTIFIER.test(orderColumn)) throw new Error('fake: 잘못된 컬럼');
                  const direction = options.ascending ? 'asc' : 'desc';
                  const sql = `select ${columns} from public.${relation} where ${eqColumn} = $1 order by ${orderColumn} ${direction}`;
                  try {
                    const rows = await asCurrentRole((q) => q.query(sql, [eqValue]));
                    return { data: rows, error: null, status: 200 };
                  } catch (error) {
                    const pgError = toPostgrestError(error);
                    return { data: null, error: pgError, status: statusFor(pgError.code, sessionUserId === null) };
                  }
                },
              };
            },
          };
        },
      };
    },
    table(relation) {
      if (relation !== 'venues' && relation !== 'categories') throw new Error(`fake: 지원하지 않는 테이블 ${String(relation)}`);
      const columnsOf = (values: Record<string, unknown>) => {
        const keys = Object.keys(values);
        if (keys.length === 0 || !keys.every((key) => IDENTIFIER.test(key))) throw new Error('fake: 잘못된 컬럼');
        return keys;
      };
      const run = async (sql: string, params: unknown[]): Promise<PostgrestResultLike> => {
        try {
          const rows = await asCurrentRole((q) => q.query(sql, params));
          return { data: rows, error: null, status: 201 };
        } catch (error) {
          const pgError = toPostgrestError(error);
          return { data: null, error: pgError, status: statusFor(pgError.code, sessionUserId === null) };
        }
      };
      return {
        insert(values) {
          return {
            async select(columns) {
              if (!COLUMN_LIST.test(columns)) throw new Error(`fake: 지원하지 않는 select ${columns}`);
              const keys = columnsOf(values).join(', ');
              return run(
                `insert into public.${relation} (${keys})
                 select ${keys} from jsonb_populate_record(null::public.${relation}, $1::jsonb)
                 returning ${columns}`,
                [JSON.stringify(values)],
              );
            },
          };
        },
        update(values) {
          return {
            eq(eqColumn, eqValue) {
              if (!IDENTIFIER.test(eqColumn)) throw new Error('fake: 잘못된 컬럼');
              return {
                async select(columns) {
                  if (!COLUMN_LIST.test(columns)) throw new Error(`fake: 지원하지 않는 select ${columns}`);
                  const keys = columnsOf(values).join(', ');
                  return run(
                    `update public.${relation} set (${keys}) = (
                       select ${keys} from jsonb_populate_record(null::public.${relation}, $1::jsonb)
                     )
                     where ${eqColumn}::text = $2
                     returning ${columns}`,
                    [JSON.stringify(values), eqValue],
                  );
                },
              };
            },
          };
        },
      };
    },
    auth: {
      async getSession() {
        return { data: { session: sessionUserId ? { user: { id: sessionUserId } } : null }, error: null };
      },
      onAuthStateChange(callback) {
        listeners.add(callback);
        return { data: { subscription: { unsubscribe: () => void listeners.delete(callback) } } };
      },
      async signInWithOAuth() {
        return { error: null };
      },
      async exchangeCodeForSession() {
        return { data: { session: null }, error: { name: 'AuthPKCEGrantCodeExchangeError', message: 'fake' } };
      },
      async signOut() {
        sessionUserId = null;
        emit('SIGNED_OUT');
        return { error: null };
      },
    },
  };
  return client;
}
