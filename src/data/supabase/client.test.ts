import type * as SupabaseJs from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createClientMock = vi.hoisted(() => vi.fn());
vi.mock('@supabase/supabase-js', async (importOriginal) => ({
  ...(await importOriginal<typeof SupabaseJs>()),
  createClient: createClientMock,
}));

import { DataAdapterError } from '../adapter';
import { callRpc, createSupabaseBrowserClient, readSessionUserId, type SupabaseClientLike } from './client';
import { checkPublicSupabaseConfig, decodeJwtPayload, findServiceRoleEnvNames, inspectSupabaseKey } from './keyGuard';

function base64url(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 서명은 가짜. 가드는 서명을 검증하지 않고 payload의 role만 본다 */
function fakeJwt(payload: Record<string, unknown>): string {
  return `${base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${base64url(JSON.stringify(payload))}.c2lnbmF0dXJl`;
}

const ANON_JWT = fakeJwt({ iss: 'supabase', ref: 'example', role: 'anon' });
const SERVICE_JWT = fakeJwt({ iss: 'supabase', ref: 'example', role: 'service_role' });
const CONFIG = { url: 'https://example.supabase.co', anonKey: ANON_JWT };

function fakeSupabase() {
  return {
    rpc: vi.fn(),
    from: vi.fn(),
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
      signInWithOAuth: vi.fn(),
      exchangeCodeForSession: vi.fn(),
      signOut: vi.fn(),
    },
  };
}

beforeEach(() => {
  createClientMock.mockReset();
  createClientMock.mockImplementation(() => fakeSupabase());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('supabase/keyGuard (service_role 키 가드)', () => {
  it('JWT payload를 읽는다(서명 검증 없음), JWT가 아니면 null', () => {
    expect(decodeJwtPayload(SERVICE_JWT)).toMatchObject({ role: 'service_role' });
    expect(decodeJwtPayload('not-a-jwt')).toBeNull();
    expect(decodeJwtPayload('a.!!!.c')).toBeNull();
    expect(decodeJwtPayload(`${base64url('{}')}.${base64url('"string"')}.x`)).toBeNull();
  });

  it('service_role JWT·sb_secret_ 키는 거부, anon JWT·publishable 키는 통과', () => {
    expect(inspectSupabaseKey(SERVICE_JWT)).toBe('service_role_jwt');
    expect(inspectSupabaseKey(` ${SERVICE_JWT} `)).toBe('service_role_jwt');
    expect(inspectSupabaseKey('sb_secret_abc123')).toBe('secret_key');
    expect(inspectSupabaseKey(ANON_JWT)).toBeNull();
    expect(inspectSupabaseKey('sb_publishable_abc123')).toBeNull();
    expect(inspectSupabaseKey('fake-anon-key')).toBeNull();
  });

  it('공개 환경 변수 이름에 SERVICE_ROLE이 있으면 거부', () => {
    expect(findServiceRoleEnvNames(['VITE_SUPABASE_URL', 'VITE_SUPABASE_SERVICE_ROLE_KEY', 'VITE_service-role'])).toEqual([
      'VITE_SUPABASE_SERVICE_ROLE_KEY',
      'VITE_service-role',
    ]);
    expect(checkPublicSupabaseConfig({ anonKey: ANON_JWT, envNames: ['VITE_SUPABASE_SERVICE_ROLE_KEY'] })).toEqual({
      ok: false,
      reason: 'service_role_env',
      envNames: ['VITE_SUPABASE_SERVICE_ROLE_KEY'],
    });
    expect(checkPublicSupabaseConfig({ anonKey: ANON_JWT, envNames: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] })).toEqual({
      ok: true,
    });
  });
});

describe('supabase/client createSupabaseBrowserClient', () => {
  it('PKCE·세션 저장·자동 갱신, URL 세션 감지는 끔(콜백 화면에서 명시적으로 교환)', () => {
    const client = createSupabaseBrowserClient(CONFIG);
    expect(createClientMock).toHaveBeenCalledTimes(1);
    expect(createClientMock).toHaveBeenCalledWith('https://example.supabase.co', ANON_JWT, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
    expect(typeof client.rpc).toBe('function');
    expect(typeof client.auth.exchangeCodeForSession).toBe('function');
  });

  it('service_role 키·SERVICE_ROLE 이름이면 개발 콘솔 경고 후 거부(클라이언트를 만들지 않음, 키 값은 출력 안 함)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => createSupabaseBrowserClient({ ...CONFIG, anonKey: SERVICE_JWT })).toThrow(
      expect.objectContaining({ code: 'SERVICE_UNCONFIGURED', detail: 'service_role_jwt' }),
    );
    expect(() => createSupabaseBrowserClient(CONFIG, { envNames: ['VITE_SUPABASE_SERVICE_ROLE_KEY'] })).toThrow(
      expect.objectContaining({ code: 'SERVICE_UNCONFIGURED', detail: 'service_role_env' }),
    );
    expect(() => createSupabaseBrowserClient({ ...CONFIG, anonKey: 'sb_secret_abc' })).toThrow(DataAdapterError);
    expect(createClientMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(3);
    for (const [message] of warn.mock.calls) {
      expect(String(message)).not.toContain(SERVICE_JWT);
      expect(String(message)).not.toContain('sb_secret_abc');
    }
  });

  it('rpc·auth 호출을 실제 supabase-js 클라이언트에 그대로 위임한다', async () => {
    const supabase = fakeSupabase();
    supabase.rpc.mockResolvedValue({ data: 'ok', error: null, status: 200 });
    supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null });
    createClientMock.mockReturnValue(supabase);
    const client = createSupabaseBrowserClient(CONFIG);
    await expect(callRpc(client, 'get_meeting', { p_meeting_id: 'x' })).resolves.toBe('ok');
    expect(supabase.rpc).toHaveBeenCalledWith('get_meeting', { p_meeting_id: 'x' });
    await expect(readSessionUserId(client)).resolves.toBe('u1');
  });
});

describe('supabase/client callRpc · readSessionUserId', () => {
  function stub(partial: Partial<SupabaseClientLike>): SupabaseClientLike {
    return partial as SupabaseClientLike;
  }

  it('RPC 오류 응답·예외를 DataAdapterError로', async () => {
    const failing = stub({
      rpc: async () => ({ data: null, error: { code: 'P0001', message: 'MEETING_FULL', details: '', hint: null }, status: 400 }),
    });
    await expect(callRpc(failing, 'apply_to_meeting')).rejects.toMatchObject({ code: 'MEETING_FULL' });
    const throwing = stub({
      rpc: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    await expect(callRpc(throwing, 'get_meeting')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('세션 오류: 네트워크면 NETWORK_ERROR, 그 밖(만료·폐기)은 비로그인(null)', async () => {
    const { AuthRetryableFetchError, AuthApiError } = await import('@supabase/supabase-js');
    const offline = stub({
      auth: { getSession: async () => ({ data: { session: null }, error: new AuthRetryableFetchError('offline', 0) }) } as never,
    });
    await expect(readSessionUserId(offline)).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    const revoked = stub({
      auth: { getSession: async () => ({ data: { session: null }, error: new AuthApiError('revoked', 400, 'refresh_token_not_found') }) } as never,
    });
    await expect(readSessionUserId(revoked)).resolves.toBeNull();
  });
});
