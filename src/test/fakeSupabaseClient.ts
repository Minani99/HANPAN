import { vi } from 'vitest';
import type { AuthSessionLike, PostgrestResultLike, SupabaseClientLike } from '../data/supabase/client';

type AuthListener = (event: string, session: AuthSessionLike | null) => void;

/** exchangeCodeForSession이 만드는 세션의 사용자 id */
export const EXCHANGED_USER_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

export interface FakeSupabaseClient extends SupabaseClientLike {
  /** RPC 응답을 이름별로 정한다(없으면 data: null) */
  rpcResponses: Map<string, PostgrestResultLike | ((args: Record<string, unknown>) => PostgrestResultLike)>;
  rpcCalls: { fn: string; args: Record<string, unknown> }[];
  /** 기준 데이터 조회 호출 기록: [table, columns, eqColumn, eqValue, orderColumn] */
  selectCalls: unknown[][];
  /** 관리자 테이블 쓰기 호출 기록. 응답은 rpcResponses의 'insert:<table>' / 'update:<table>' 키로 정한다(없으면 data: []) */
  tableCalls: { table: string; op: 'insert' | 'update'; values: Record<string, unknown>; eq?: [string, string]; columns: string }[];
  setSession(userId: string | null): void;
  emit(event: string, userId: string | null): void;
  readonly listenerCount: number;
}

/** 단위 테스트용 가짜 Supabase 클라이언트(네트워크 없음). PGlite 계약 테스트용은 supabase/tests/adapter-contract.test.ts */
export function createFakeSupabaseClient(): FakeSupabaseClient {
  let session: AuthSessionLike | null = null;
  const listeners = new Set<AuthListener>();
  const rpcResponses: FakeSupabaseClient['rpcResponses'] = new Map();
  const rpcCalls: FakeSupabaseClient['rpcCalls'] = [];
  const selectCalls: unknown[][] = [];
  const tableCalls: FakeSupabaseClient['tableCalls'] = [];
  const tableResponse = (key: string, args: Record<string, unknown>) => {
    const response = rpcResponses.get(key);
    return typeof response === 'function' ? response(args) : (response ?? { data: [], error: null, status: 200 });
  };

  const client: FakeSupabaseClient = {
    rpcResponses,
    rpcCalls,
    selectCalls,
    tableCalls,
    setSession(userId) {
      session = userId ? { user: { id: userId } } : null;
    },
    emit(event, userId) {
      const value = userId ? { user: { id: userId } } : null;
      for (const listener of [...listeners]) listener(event, value);
    },
    get listenerCount() {
      return listeners.size;
    },
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      const response = rpcResponses.get(fn);
      if (typeof response === 'function') return response(args);
      return response ?? { data: null, error: null, status: 200 };
    }),
    from: vi.fn((table: 'categories' | 'regions') => ({
      select: (columns: string) => ({
        eq: (eqColumn: string, eqValue: boolean) => ({
          order: async (orderColumn: string) => {
            selectCalls.push([table, columns, eqColumn, eqValue, orderColumn]);
            const response = rpcResponses.get(`table:${table}`);
            return typeof response === 'function' ? response({}) : (response ?? { data: [], error: null, status: 200 });
          },
        }),
      }),
    })),
    table: vi.fn((table: 'categories' | 'venues') => ({
      insert: (values: Record<string, unknown>) => ({
        select: async (columns: string) => {
          tableCalls.push({ table, op: 'insert', values, columns });
          return tableResponse(`insert:${table}`, values);
        },
      }),
      update: (values: Record<string, unknown>) => ({
        eq: (column: string, value: string) => ({
          select: async (columns: string) => {
            tableCalls.push({ table, op: 'update', values, eq: [column, value], columns });
            return tableResponse(`update:${table}`, values);
          },
        }),
      }),
    })),
    auth: {
      getSession: vi.fn(async () => ({ data: { session }, error: null })),
      onAuthStateChange: vi.fn((callback: AuthListener) => {
        listeners.add(callback);
        return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
      }),
      signInWithOAuth: vi.fn(async () => ({ error: null })),
      exchangeCodeForSession: vi.fn(async () => {
        session = { user: { id: EXCHANGED_USER_ID } };
        return { data: { session }, error: null };
      }),
      signOut: vi.fn(async () => {
        session = null;
        return { error: null };
      }),
    },
  };
  return client;
}

/** get_my_profile 응답(필요한 키만 덮어쓴다) */
export function profileResponse(id: string, overrides: Record<string, unknown> = {}): PostgrestResultLike {
  return {
    data: {
      id,
      nickname: '보드게임러',
      regionCode: null,
      bio: '',
      favoriteCategoryIds: [],
      status: 'active',
      termsAgreedAt: '2026-11-20T00:00:00+00:00',
      privacyAgreedAt: '2026-11-20T00:00:00+00:00',
      deletionRequestedAt: null,
      onboarded: true,
      isAdmin: false,
      createdAt: '2026-11-20T00:00:00+00:00',
      ...overrides,
    },
    error: null,
    status: 200,
  };
}
