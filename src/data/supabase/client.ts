/**
 * Supabase 클라이언트 생성과, 어댑터가 쓰는 최소 클라이언트 계약(SupabaseClientLike).
 *
 * - 어댑터는 supabase-js 전체가 아니라 아래 인터페이스만 쓴다. 실제 클라이언트는 이 모양을 그대로 만족하고,
 *   계약 테스트(supabase/tests/adapter-contract.test.ts)는 PGlite로 SQL을 실행하는 가짜 클라이언트를 주입한다.
 * - anon(publishable) 키만 쓴다. service_role/secret 키로 보이면 경고 후 거부한다(./keyGuard.ts).
 * - 세션 감지는 끄고(detectSessionInUrl: false) `/auth/callback` 화면에서 코드를 명시적으로 교환한다(PKCE).
 */
import { createClient } from '@supabase/supabase-js';
import { DataAdapterError } from '../adapter';
import { devWarn } from '../../lib/devConsole';
import { checkPublicSupabaseConfig, describeUnsafeSupabaseConfig } from './keyGuard';
import { toDataAdapterError } from './errors';

/** PostgREST 오류 응답 본문(supabase-js가 돌려주는 error 객체)의 필드 */
export interface PostgrestErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

/** supabase-js 조회·RPC 결과({ data, error, status }) */
export interface PostgrestResultLike {
  data: unknown;
  error: PostgrestErrorLike | null;
  status?: number;
}

export interface AuthSessionLike {
  user: { id: string };
}

/** supabase-js `auth`에서 쓰는 메서드만 */
export interface SupabaseAuthLike {
  getSession(): Promise<{ data: { session: AuthSessionLike | null }; error: unknown }>;
  onAuthStateChange(callback: (event: string, session: AuthSessionLike | null) => void): {
    data: { subscription: { unsubscribe(): void } };
  };
  signInWithOAuth(credentials: {
    provider: 'google' | 'kakao';
    options: { redirectTo: string };
  }): Promise<{ error: unknown }>;
  exchangeCodeForSession(authCode: string): Promise<{ data: { session: AuthSessionLike | null }; error: unknown }>;
  signOut(options?: { scope?: 'global' | 'local' | 'others' }): Promise<{ error: unknown }>;
}

/** 기준 데이터 조회: from(table).select(columns).eq(column, value).order(column, options) */
export interface ReferenceSelectLike {
  eq(column: string, value: boolean): {
    order(column: string, options: { ascending: boolean }): PromiseLike<PostgrestResultLike>;
  };
}

/**
 * 관리자 테이블 직접 쓰기(venues·categories, RLS is_admin — docs/DB_SCHEMA.md §7·§8).
 * insert(row).select(cols) / update(patch).eq(col, value).select(cols): 쓴 행의 지정 컬럼을 배열로 돌려받는다.
 * RLS에 막힌 update는 오류 없이 0행이다(호출한 쪽이 판단).
 */
export interface TableWriteLike {
  insert(row: Record<string, unknown>): { select(columns: string): PromiseLike<PostgrestResultLike> };
  update(patch: Record<string, unknown>): {
    eq(column: string, value: string): { select(columns: string): PromiseLike<PostgrestResultLike> };
  };
}

export type ReferenceTable = 'categories' | 'regions';
export type AdminWritableTable = 'categories' | 'venues';

export interface SupabaseClientLike {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<PostgrestResultLike>;
  from(relation: ReferenceTable): { select(columns: string): ReferenceSelectLike };
  /** 관리자 쓰기 전용 */
  table(relation: AdminWritableTable): TableWriteLike;
  auth: SupabaseAuthLike;
}

/** 공개 연결 정보(src/lib/env.ts의 SupabasePublicConfig와 같은 모양). 이 모듈은 import.meta.env를 읽지 않는다 */
export interface SupabaseConnectionConfig {
  url: string;
  anonKey: string;
}

export interface CreateBrowserClientOptions {
  /** 브라우저에 노출되는(VITE_) 환경 변수 이름. 이름에 SERVICE_ROLE이 있으면 거부한다 */
  envNames?: readonly string[];
}

/**
 * 브라우저용 Supabase 클라이언트. 키가 비밀 키로 보이면 개발 콘솔에 경고하고 SERVICE_UNCONFIGURED로 거부한다.
 * (호출한 쪽은 unconfigured 어댑터로 대신한다 — src/data/index.ts)
 */
export function createSupabaseBrowserClient(
  config: SupabaseConnectionConfig,
  options: CreateBrowserClientOptions = {},
): SupabaseClientLike {
  const check = checkPublicSupabaseConfig({ anonKey: config.anonKey, envNames: options.envNames ?? [] });
  if (!check.ok) {
    // 변수 이름·사유만 담긴 경고(키 값 없음). 운영 빌드는 vite.config.ts의 키 가드가 빌드 자체를 멈춘다
    devWarn(describeUnsafeSupabaseConfig(check));
    throw new DataAdapterError('SERVICE_UNCONFIGURED', { detail: check.reason });
  }
  const supabase = createClient(config.url, config.anonKey, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  // supabase-js의 제네릭 타입을 그대로 대입하면 타입 계산이 너무 깊어져(TS2589) 얇게 감싼다. 동작은 그대로 위임한다.
  const auth = supabase.auth;
  return {
    rpc: (fn, args) => supabase.rpc(fn, args),
    from: (relation) => ({
      select: (columns) => ({
        eq: (column, value) => ({
          order: (orderColumn, orderOptions) =>
            supabase.from(relation).select(columns).eq(column, value).order(orderColumn, orderOptions),
        }),
      }),
    }),
    table: (relation) => ({
      insert: (row) => ({
        select: (columns) => supabase.from(relation).insert(row).select(columns),
      }),
      update: (patch) => ({
        eq: (column, value) => ({
          select: (columns) => supabase.from(relation).update(patch).eq(column, value).select(columns),
        }),
      }),
    }),
    auth: {
      getSession: () => auth.getSession(),
      onAuthStateChange: (callback) => auth.onAuthStateChange((event, session) => callback(event, session)),
      signInWithOAuth: (credentials) => auth.signInWithOAuth(credentials),
      exchangeCodeForSession: (code) => auth.exchangeCodeForSession(code),
      signOut: (signOutOptions) => auth.signOut(signOutOptions),
    },
  };
}

/**
 * RPC 한 번 호출. 실패는 DataAdapterError로 바꾼다(응답 모양 검증은 호출한 쪽에서 mapping.ts로).
 * 인자가 없어도 빈 객체를 보낸다(PostgREST는 POST 본문의 키를 지정 인자로 넘긴다).
 */
export async function callRpc(
  client: SupabaseClientLike,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  let result: PostgrestResultLike;
  try {
    result = await client.rpc(fn, args);
  } catch (error) {
    throw toDataAdapterError(error);
  }
  if (result.error) throw toDataAdapterError(result.error, { status: result.status });
  return result.data;
}

/**
 * 저장된 세션의 사용자 id(없으면 null). 서버 요청 없이 저장소를 읽는다(만료가 가까우면 supabase-js가 갱신).
 * 갱신이 네트워크 문제로 실패하면 NETWORK_ERROR, 그 밖의 세션 오류(만료·폐기)는 비로그인으로 본다.
 */
export async function readSessionUserId(client: SupabaseClientLike): Promise<string | null> {
  let result: Awaited<ReturnType<SupabaseAuthLike['getSession']>>;
  try {
    result = await client.auth.getSession();
  } catch (error) {
    throw toDataAdapterError(error);
  }
  if (result.error) {
    const mapped = toDataAdapterError(result.error);
    if (mapped.code === 'NETWORK_ERROR') throw mapped;
    return null;
  }
  return result.data.session?.user.id ?? null;
}
