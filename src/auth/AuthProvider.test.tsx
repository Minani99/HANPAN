import { act, screen, waitFor, within } from '@testing-library/react';
import type { RouteObject } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import type { AuthAdapter, DataAdapter } from '../data/adapter';
import { createMockAdapter } from '../data/mock/adapter';
import { DEV_ACCOUNT_IDS } from '../data/mock/seed';
import type { SessionUser } from '../data/types';
import { createUnconfiguredAdapter } from '../data/unconfigured';
import { RETURN_TO_STORAGE_KEY, saveReturnTo } from '../lib/returnTo';
import { MeetingDetailPage } from '../pages/MeetingDetailPage';
import { renderRoutes } from '../test/renderWithProviders';
import { useAuth } from './AuthProvider';

function AuthProbe() {
  const { status, user, userKey } = useAuth();
  return (
    <p data-testid="auth-probe" data-status={status} data-user-key={userKey}>
      {user ? `${user.nickname}` : '비로그인'}
    </p>
  );
}

const probeRoutes: RouteObject[] = [{ path: '*', element: <AuthProbe /> }];

function probe() {
  return screen.getByTestId('auth-probe');
}

afterEach(() => {
  window.sessionStorage.clear();
});

describe('AuthProvider 사용자 전환', () => {
  it('다른 탭의 로그인·계정 전환·로그아웃 이벤트를 따라가고 userKey가 바뀐다(로그아웃 시 returnTo 삭제)', async () => {
    const adapter = createMockAdapter({ delayMs: 0, persist: false });
    renderRoutes(probeRoutes, { adapter });
    await waitFor(() => expect(probe()).toHaveAttribute('data-status', 'ready'));
    expect(probe()).toHaveAttribute('data-user-key', 'anon');

    await act(() => adapter.auth.signInAsDev(DEV_ACCOUNT_IDS.hostA));
    expect(probe()).toHaveAttribute('data-user-key', `user:${DEV_ACCOUNT_IDS.hostA}`);
    expect(probe()).toHaveTextContent('예시사용자A');

    await act(() => adapter.auth.signInAsDev(DEV_ACCOUNT_IDS.userB));
    expect(probe()).toHaveAttribute('data-user-key', `user:${DEV_ACCOUNT_IDS.userB}`);

    saveReturnTo('/my/meetings');
    await act(() => adapter.auth.signOut());
    expect(probe()).toHaveAttribute('data-user-key', 'anon');
    expect(probe()).toHaveTextContent('비로그인');
    expect(window.sessionStorage.getItem(RETURN_TO_STORAGE_KEY)).toBeNull();
  });

  it('처음 세션 확인보다 상태 변화 이벤트가 먼저 오면, 늦게 도착한 처음 응답(이전 사용자)은 버린다', async () => {
    let resolveInitial!: (user: SessionUser | null) => void;
    let emit!: (user: SessionUser | null) => void;
    const auth: AuthAdapter = {
      getSessionUser: () =>
        new Promise((resolve) => {
          resolveInitial = resolve;
        }),
      onAuthStateChange(callback) {
        emit = callback;
        return () => {};
      },
      signInWithOAuth: async () => {},
      completeOAuthCallback: async () => ({ returnTo: '/' }),
      signOut: async () => {},
    };
    const adapter: DataAdapter = { ...createUnconfiguredAdapter(), mode: 'supabase', auth };
    renderRoutes(probeRoutes, { adapter });
    const userB: SessionUser = { id: 'user-b', nickname: '새사용자', onboarded: true, status: 'active', isAdmin: false };
    act(() => emit(userB));
    expect(probe()).toHaveAttribute('data-user-key', 'user:user-b');
    await act(async () => resolveInitial({ ...userB, id: 'user-a', nickname: '이전사용자' }));
    expect(probe()).toHaveAttribute('data-user-key', 'user:user-b');
    expect(probe()).toHaveTextContent('새사용자');
  });

  it('로그아웃·다른 계정 로그인 시 보던 상세 화면이 이전 사용자의 신청·모임장 정보를 버리고 다시 불러온다', async () => {
    const adapter = createMockAdapter({ delayMs: 0, persist: false, sessionUserId: DEV_ACCOUNT_IDS.hostA });
    const routes: RouteObject[] = [
      { path: '/meetings/:id', Component: MeetingDetailPage },
      { path: '*', element: <p>다른 화면</p> },
    ];
    renderRoutes(routes, { initialEntries: ['/meetings/seed-meeting-13'], adapter });
    const hostCta = await screen.findByTestId('detail-cta-content');
    expect(hostCta).toHaveAttribute('data-kind', 'host');

    await act(() => adapter.auth.signOut());
    await waitFor(() => expect(screen.getByTestId('detail-cta-content')).toHaveAttribute('data-kind', 'login'));
    expect(within(screen.getByTestId('detail-cta-content')).queryByRole('link', { name: '참가자 관리' })).not.toBeInTheDocument();

    await act(() => adapter.auth.signInAsDev(DEV_ACCOUNT_IDS.userB));
    await waitFor(() => expect(screen.getByTestId('detail-cta-content')).toHaveAttribute('data-kind', 'apply'));
  });
});
