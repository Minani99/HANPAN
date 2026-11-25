import { afterEach, describe, expect, it, vi } from 'vitest';
import { RETURN_TO_STORAGE_KEY, saveReturnTo } from '../../lib/returnTo';
import { createFakeSupabaseClient, profileResponse } from '../../test/fakeSupabaseClient';
import type { SessionUser } from '../types';
import { createSupabaseAuthAdapter, stripCallbackParams, type BrowserLike } from './auth';

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function fakeBrowser(href = 'https://preview-123.hanpan.pages.dev/login') {
  const state = { href, replaced: [] as string[] };
  const browser: BrowserLike = {
    origin: () => new URL(state.href).origin,
    href: () => state.href,
    replaceUrl: (url) => {
      state.replaced.push(url);
      state.href = new URL(url, state.href).href;
    },
    defer: (task) => task(),
  };
  return { browser, state };
}

function setup(options: { kakao?: boolean; href?: string } = {}) {
  const client = createFakeSupabaseClient();
  const { browser, state } = fakeBrowser(options.href);
  const auth = createSupabaseAuthAdapter({ client, kakaoAuthEnabled: options.kakao ?? false, browser });
  return { client, auth, state };
}

async function flush() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

afterEach(() => {
  window.sessionStorage.clear();
});

describe('supabase/auth 로그인 시작 (signInWithOAuth)', () => {
  it('returnTo를 저장하고 redirectTo는 현재 origin + /auth/callback (VITE_SITE_URL을 쓰지 않음)', async () => {
    vi.stubEnv('VITE_SITE_URL', 'https://hanpan.example');
    const { client, auth } = setup();
    await auth.signInWithOAuth('google', '/meetings/abc?tab=1');
    expect(window.sessionStorage.getItem(RETURN_TO_STORAGE_KEY)).toBe('/meetings/abc?tab=1');
    expect(client.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: 'https://preview-123.hanpan.pages.dev/auth/callback' },
    });
  });

  it('외부 주소 returnTo는 저장하지 않는다(열린 리디렉션 방지)', async () => {
    const { auth } = setup();
    await auth.signInWithOAuth('google', '//evil.example');
    expect(window.sessionStorage.getItem(RETURN_TO_STORAGE_KEY)).toBeNull();
  });

  it('카카오는 VITE_AUTH_KAKAO_ENABLED=true일 때만: 꺼져 있으면 공급자 호출 없이 SERVICE_UNCONFIGURED', async () => {
    const disabled = setup({ kakao: false });
    await expect(disabled.auth.signInWithOAuth('kakao', '/')).rejects.toMatchObject({
      code: 'SERVICE_UNCONFIGURED',
      detail: 'kakao_disabled',
    });
    expect(disabled.client.auth.signInWithOAuth).not.toHaveBeenCalled();

    const enabled = setup({ kakao: true });
    await enabled.auth.signInWithOAuth('kakao', '/');
    expect(enabled.client.auth.signInWithOAuth).toHaveBeenCalledWith(expect.objectContaining({ provider: 'kakao' }));
  });

  it('공급자 호출 오류는 DataAdapterError로', async () => {
    const { client, auth } = setup();
    vi.mocked(client.auth.signInWithOAuth).mockResolvedValueOnce({ error: new TypeError('Failed to fetch') });
    await expect(auth.signInWithOAuth('google', '/')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});

describe('supabase/auth 콜백 (completeOAuthCallback)', () => {
  it('code를 교환하고 주소창에서 code를 지운 뒤 저장했던 returnTo를 돌려준다(한 번 쓰고 삭제)', async () => {
    saveReturnTo('/my/meetings?tab=done');
    const { client, auth, state } = setup({ href: 'https://hanpan.pages.dev/auth/callback?code=secret-code-123&state=x' });
    await expect(auth.completeOAuthCallback()).resolves.toEqual({ returnTo: '/my/meetings?tab=done' });
    expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith('secret-code-123');
    expect(state.replaced).toEqual(['/auth/callback']);
    expect(window.sessionStorage.getItem(RETURN_TO_STORAGE_KEY)).toBeNull();
  });

  it('공급자 오류(error·error_description): 교환하지 않고 AUTH_REQUIRED, 설명 문구는 담지 않음, 주소 정리', async () => {
    saveReturnTo('/meetings/abc');
    const { client, auth, state } = setup({
      href: 'https://hanpan.pages.dev/auth/callback?error=access_denied&error_description=User%20denied%20me%40example.com',
    });
    const error = await auth.completeOAuthCallback().catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'AUTH_REQUIRED', detail: 'oauth_access_denied' });
    expect(String((error as Error).message)).not.toContain('example.com');
    expect(client.auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(state.replaced).toEqual(['/auth/callback']);
    // 다시 로그인하면 원래 화면으로 돌아갈 수 있게 returnTo는 남긴다
    expect(window.sessionStorage.getItem(RETURN_TO_STORAGE_KEY)).toBe('/meetings/abc');
  });

  it('해시로 온 오류도 처리한다', async () => {
    const { auth } = setup({ href: 'https://hanpan.pages.dev/auth/callback#error=server_error&error_description=x' });
    await expect(auth.completeOAuthCallback()).rejects.toMatchObject({ code: 'AUTH_REQUIRED', detail: 'oauth_server_error' });
  });

  it('code가 없으면: 세션이 있으면 그대로 진행, 없으면 AUTH_REQUIRED(missing_code)', async () => {
    const { client, auth } = setup({ href: 'https://hanpan.pages.dev/auth/callback' });
    await expect(auth.completeOAuthCallback()).rejects.toMatchObject({ code: 'AUTH_REQUIRED', detail: 'missing_code' });
    client.setSession(USER_A);
    await expect(auth.completeOAuthCallback()).resolves.toEqual({ returnTo: '/' });
  });

  it('교환 실패(PKCE 검증값 없음 등)는 AUTH_REQUIRED, returnTo는 남긴다', async () => {
    saveReturnTo('/meetings/abc');
    const { client, auth } = setup({ href: 'https://hanpan.pages.dev/auth/callback?code=used-code' });
    const { AuthPKCECodeVerifierMissingError } = await import('@supabase/supabase-js');
    vi.mocked(client.auth.exchangeCodeForSession).mockResolvedValueOnce({
      data: { session: null },
      error: new AuthPKCECodeVerifierMissingError(),
    });
    await expect(auth.completeOAuthCallback()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(window.sessionStorage.getItem(RETURN_TO_STORAGE_KEY)).toBe('/meetings/abc');
  });

  it('stripCallbackParams: code·error·토큰류만 지우고 나머지 쿼리·해시는 유지', () => {
    expect(stripCallbackParams('https://x.dev/auth/callback?code=1&keep=2#access_token=t&other=1')).toBe(
      '/auth/callback?keep=2#other=1',
    );
    expect(stripCallbackParams('https://x.dev/auth/callback#section')).toBe('/auth/callback#section');
  });
});

describe('supabase/auth 세션 사용자와 상태 변화', () => {
  it('세션이 없으면 RPC 없이 null, 있으면 get_my_profile로 닉네임·온보딩·상태·관리자 여부', async () => {
    const { client, auth } = setup();
    await expect(auth.getSessionUser()).resolves.toBeNull();
    expect(client.rpcCalls).toEqual([]);
    client.setSession(USER_A);
    client.rpcResponses.set('get_my_profile', profileResponse(USER_A, { nickname: '플레이어123456', onboarded: false, termsAgreedAt: null }));
    await expect(auth.getSessionUser()).resolves.toEqual({
      id: USER_A,
      nickname: '플레이어123456',
      onboarded: false,
      status: 'active',
      isAdmin: false,
    } satisfies SessionUser);
    expect(client.rpcCalls).toEqual([{ fn: 'get_my_profile', args: {} }]);
  });

  it('세션은 있는데 프로필 행이 없으면 PROFILE_INCOMPLETE(profile_missing)', async () => {
    const { client, auth } = setup();
    client.setSession(USER_A);
    await expect(auth.getSessionUser()).rejects.toMatchObject({ code: 'PROFILE_INCOMPLETE', detail: 'profile_missing' });
  });

  it('SIGNED_IN·USER_UPDATED는 프로필을 다시 읽어 알리고, 같은 사용자의 TOKEN_REFRESHED·INITIAL_SESSION은 무시, SIGNED_OUT은 null', async () => {
    const { client, auth } = setup();
    const seen: (SessionUser | null)[] = [];
    const unsubscribe = auth.onAuthStateChange((user) => seen.push(user));
    client.rpcResponses.set('get_my_profile', profileResponse(USER_A));

    client.setSession(USER_A);
    client.emit('INITIAL_SESSION', USER_A);
    await flush();
    expect(seen).toEqual([]);

    client.emit('TOKEN_REFRESHED', USER_A);
    client.emit('SIGNED_IN', USER_A); // 탭 복귀 등으로 같은 사용자 SIGNED_IN이 다시 와도 무시
    await flush();
    expect(seen).toEqual([]);

    client.rpcResponses.set('get_my_profile', profileResponse(USER_A, { nickname: '바뀐닉네임' }));
    client.emit('USER_UPDATED', USER_A);
    await flush();
    expect(seen.map((user) => user?.nickname)).toEqual(['바뀐닉네임']);

    client.setSession(null);
    client.emit('SIGNED_OUT', null);
    expect(seen.at(-1)).toBeNull();

    client.setSession(USER_B);
    client.rpcResponses.set('get_my_profile', profileResponse(USER_B, { nickname: '다른사람' }));
    client.emit('SIGNED_IN', USER_B);
    await flush();
    expect(seen.at(-1)).toMatchObject({ id: USER_B, nickname: '다른사람' });

    unsubscribe();
    expect(client.listenerCount).toBe(0);
    client.emit('SIGNED_OUT', null);
    expect(seen).toHaveLength(3);
  });

  it('다른 사용자로 바뀌었는데 프로필을 읽지 못하면 이전 사용자 화면을 남기지 않도록 null', async () => {
    const { client, auth } = setup();
    const seen: (SessionUser | null)[] = [];
    auth.onAuthStateChange((user) => seen.push(user));
    client.setSession(USER_A);
    client.emit('INITIAL_SESSION', USER_A);
    client.setSession(USER_B);
    client.rpcResponses.set('get_my_profile', { data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 });
    client.emit('SIGNED_IN', USER_B);
    await flush();
    expect(seen).toEqual([null]);
  });

  it('로그아웃: 전역 로그아웃이 실패하면(오프라인) 이 기기만이라도 로그아웃한다', async () => {
    const { client, auth } = setup();
    const { AuthRetryableFetchError } = await import('@supabase/supabase-js');
    vi.mocked(client.auth.signOut).mockResolvedValueOnce({ error: new AuthRetryableFetchError('offline', 0) });
    await auth.signOut();
    expect(client.auth.signOut).toHaveBeenNthCalledWith(1);
    expect(client.auth.signOut).toHaveBeenNthCalledWith(2, { scope: 'local' });
  });
});
