import { screen, waitFor } from '@testing-library/react';
import type { RouteObject } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { createMockAdapter } from '../data/mock/adapter';
import { createSupabaseAdapter } from '../data/supabase/adapter';
import { RETURN_TO_STORAGE_KEY, saveReturnTo } from '../lib/returnTo';
import { EXCHANGED_USER_ID, createFakeSupabaseClient, profileResponse } from '../test/fakeSupabaseClient';
import { renderRoutes } from '../test/renderWithProviders';
import { AuthCallbackPage } from './AuthCallbackPage';

const routes: RouteObject[] = [
  { path: '/auth/callback', Component: AuthCallbackPage },
  { path: '/login', element: <p>로그인 화면</p> },
  { path: '/profile', element: <p>프로필 화면</p> },
  { path: '/meetings/:id', element: <p>상세 화면</p> },
  { path: '/', element: <p>홈 화면</p> },
];

function supabaseSetup(href: string, profile: Record<string, unknown> = {}) {
  const client = createFakeSupabaseClient();
  client.rpcResponses.set('get_my_profile', profileResponse(EXCHANGED_USER_ID, profile));
  const replaced: string[] = [];
  const adapter = createSupabaseAdapter({
    client,
    kakaoAuthEnabled: false,
    browser: {
      origin: () => 'https://hanpan.pages.dev',
      href: () => href,
      replaceUrl: (url) => replaced.push(url),
      defer: (task) => task(),
    },
  });
  return { client, adapter, replaced };
}

afterEach(() => {
  window.sessionStorage.clear();
});

describe('AuthCallbackPage (Supabase PKCE 콜백)', () => {
  it('code 교환 → 세션 사용자 확인 → 저장했던 returnTo로 이동, 주소창의 code 제거', async () => {
    saveReturnTo('/meetings/abc');
    const { client, adapter, replaced } = supabaseSetup('https://hanpan.pages.dev/auth/callback?code=one-time-code');
    const { router } = renderRoutes(routes, { initialEntries: ['/auth/callback?code=one-time-code'], adapter });
    await waitFor(() => expect(router.state.location.pathname).toBe('/meetings/abc'));
    expect(client.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith('one-time-code');
    expect(replaced).toEqual(['/auth/callback']);
    expect(window.sessionStorage.getItem(RETURN_TO_STORAGE_KEY)).toBeNull();
  });

  it('최초 설정 전 사용자는 returnTo를 남겨 두고 /profile?onboarding=1', async () => {
    saveReturnTo('/meetings/abc');
    const { adapter } = supabaseSetup('https://hanpan.pages.dev/auth/callback?code=c', { onboarded: false, termsAgreedAt: null });
    const { router } = renderRoutes(routes, { initialEntries: ['/auth/callback?code=c'], adapter });
    await waitFor(() => expect(router.state.location.pathname).toBe('/profile'));
    expect(router.state.location.search).toBe('?onboarding=1');
    expect(window.sessionStorage.getItem(RETURN_TO_STORAGE_KEY)).toBe('/meetings/abc');
  });

  it('교환 실패·code 없음이면 실패 안내와 다시 로그인 링크', async () => {
    const { client, adapter } = supabaseSetup('https://hanpan.pages.dev/auth/callback');
    renderRoutes(routes, { initialEntries: ['/auth/callback'], adapter });
    expect(await screen.findByRole('heading', { name: '로그인을 완료하지 못했어요' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '다시 로그인하기' })).toHaveAttribute('href', '/login');
    expect(client.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('공급자가 error를 돌려주면(mock 포함) 교환 없이 실패 안내', async () => {
    renderRoutes(routes, {
      initialEntries: ['/auth/callback?error=access_denied&error_description=denied'],
      adapter: createMockAdapter({ delayMs: 0, persist: false }),
    });
    expect(await screen.findByRole('heading', { name: '로그인을 완료하지 못했어요' })).toBeInTheDocument();
  });
});
