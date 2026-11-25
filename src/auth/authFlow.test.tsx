import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RouteObject } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { createMockAdapter } from '../data/mock/adapter';
import { DEV_ACCOUNT_IDS } from '../data/mock/seed';
import { createUnconfiguredAdapter } from '../data/unconfigured';
import { RETURN_TO_STORAGE_KEY } from '../lib/returnTo';
import { LoginPage } from '../pages/LoginPage';
import { ProfilePage } from '../pages/ProfilePage';
import { renderRoutes } from '../test/renderWithProviders';
import { RequireAuth, RequireSignedIn } from './RequireAuth';

const routes: RouteObject[] = [
  { path: '/', element: <p>홈 화면</p> },
  { path: '/login', Component: LoginPage },
  { Component: RequireSignedIn, children: [{ path: '/profile', Component: ProfilePage }] },
  {
    Component: RequireAuth,
    children: [
      { path: '/my/meetings', element: <h1>내 모임 화면</h1> },
      { path: '/meetings/new', element: <h1>만들기 화면</h1> },
    ],
  },
  { path: '/policies/:slug', element: <p>정책</p> },
];

afterEach(() => {
  window.sessionStorage.clear();
});

describe('인증 흐름 (RequireAuth · 로그인 · 최초 설정)', () => {
  it('비로그인으로 보호된 화면에 오면 returnTo를 저장하고 /login → 테스트 계정 로그인 후 원래 화면으로', async () => {
    const user = userEvent.setup();
    const adapter = createMockAdapter({ delayMs: 0, persist: false });
    const { router } = renderRoutes(routes, { initialEntries: ['/my/meetings?tab=done'], adapter });
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(window.sessionStorage.getItem(RETURN_TO_STORAGE_KEY)).toBe('/my/meetings?tab=done');

    const section = await screen.findByTestId('dev-accounts');
    await user.click(await within(section).findByRole('button', { name: /예시사용자B/ }));
    expect(await screen.findByRole('heading', { name: '내 모임 화면' })).toBeInTheDocument();
    expect(router.state.location.search).toBe('?tab=done');
    expect(window.sessionStorage.getItem(RETURN_TO_STORAGE_KEY)).toBeNull();
  });

  it('최초 설정 전 사용자는 /profile?onboarding=1 → 동의 없이 제출하면 오류 → 완료 후 returnTo', async () => {
    const user = userEvent.setup();
    const adapter = createMockAdapter({ delayMs: 0, persist: false, sessionUserId: DEV_ACCOUNT_IDS.newcomer });
    const { router } = renderRoutes(routes, { initialEntries: ['/meetings/new'], adapter });
    await waitFor(() => expect(router.state.location.pathname).toBe('/profile'));
    expect(router.state.location.search).toBe('?onboarding=1');
    expect(await screen.findByRole('heading', { level: 1, name: '처음 설정' })).toBeInTheDocument();

    const nickname = screen.getByLabelText('닉네임');
    expect(nickname).toHaveValue('예시신규사용자');
    await user.click(screen.getByRole('button', { name: '시작하기' }));
    const terms = screen.getByRole('checkbox', { name: '이용약관에 동의해요 (필수)' });
    expect(terms).toHaveFocus();
    expect(terms).toHaveAttribute('aria-invalid', 'true');

    await user.clear(nickname);
    await user.type(nickname, '관리자');
    await user.click(terms);
    await user.click(screen.getByRole('checkbox', { name: '개인정보 수집·이용에 동의해요 (필수)' }));
    await user.click(screen.getByRole('button', { name: '시작하기' }));
    expect(nickname).toHaveFocus();
    expect(nickname).toHaveAccessibleDescription(expect.stringContaining('운영자나 서비스로 오해할 수 있는 닉네임'));

    await user.clear(nickname);
    await user.type(nickname, '보드게임러');
    await user.click(screen.getByRole('button', { name: '시작하기' }));
    expect(await screen.findByRole('heading', { name: '만들기 화면' })).toBeInTheDocument();
    expect((await adapter.auth.getSessionUser())?.onboarded).toBe(true);
  });

  it('mock 모드에서 Google 버튼은 오류 대신 테스트 계정 선택을 안내한다', async () => {
    const user = userEvent.setup();
    renderRoutes(routes, { initialEntries: ['/login'], adapter: createMockAdapter({ delayMs: 0, persist: false }) });
    await user.click(await screen.findByRole('button', { name: 'Google로 계속하기' }));
    expect(screen.getByTestId('dev-oauth-guidance')).toHaveTextContent('아래 테스트 계정 중 하나로 로그인해 주세요.');
    expect(screen.getByRole('heading', { name: '개발용 테스트 계정' })).toHaveFocus();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('서비스 설정 전(unconfigured): 테스트 계정 섹션 없음, 로그인 불가 안내', async () => {
    renderRoutes(routes, { initialEntries: ['/login'], adapter: createUnconfiguredAdapter() });
    expect(await screen.findByText('지금은 로그인을 사용할 수 없어요')).toBeInTheDocument();
    expect(screen.queryByTestId('dev-accounts')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Google로 계속하기' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('로그아웃하면 홈으로 가고 보호된 화면은 다시 로그인을 요구한다', async () => {
    const user = userEvent.setup();
    const adapter = createMockAdapter({ delayMs: 0, persist: false, sessionUserId: DEV_ACCOUNT_IDS.userB });
    const { router } = renderRoutes(routes, { initialEntries: ['/profile'], adapter });
    await user.click(await screen.findByRole('button', { name: '로그아웃' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(await adapter.auth.getSessionUser()).toBeNull();
    await router.navigate('/my/meetings');
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });
});
