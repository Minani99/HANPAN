import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useAuth } from '../../auth/AuthProvider';
import { createMockAdapter } from '../../data/mock/adapter';
import { createSeedDb, DEV_ACCOUNT_IDS } from '../../data/mock/seed';
import type { AccountStatus } from '../../data/types';
import { renderRoutes } from '../../test/renderWithProviders';
import { AccountStatusBanner } from './AccountStatusBanner';

const NOW = new Date('2026-11-23T03:00:00Z');

/** 세션 확인이 끝났는지(띠가 '없음'을 확인하기 전에 기다린다) */
function AuthProbe() {
  const { status, user } = useAuth();
  return <p data-testid="auth-probe">{`${status}:${user?.status ?? 'anon'}`}</p>;
}

/** 개발용 테스트 계정(예시사용자B)의 계정 상태를 바꾼 mock 저장소로 띠를 렌더한다 */
function renderBanner(sessionUserId: string | null, status: AccountStatus = 'active') {
  const db = createSeedDb(NOW);
  const profile = db.profiles.find((item) => item.id === DEV_ACCOUNT_IDS.userB);
  if (!profile) throw new Error('테스트 계정 없음');
  profile.status = status;
  const adapter = createMockAdapter({ delayMs: 0, persist: false, now: () => NOW, db, sessionUserId });
  return renderRoutes(
    [
      {
        path: '*',
        element: (
          <>
            <AccountStatusBanner />
            <AuthProbe />
          </>
        ),
      },
    ],
    { adapter },
  );
}

describe('AccountStatusBanner (계정 상태 안내 띠)', () => {
  it('이용 제한 계정: 제한 안내 문구', async () => {
    renderBanner(DEV_ACCOUNT_IDS.userB, 'restricted');
    const banner = await screen.findByTestId('account-status-banner');
    expect(banner).toHaveAttribute('role', 'note');
    expect(banner).toHaveTextContent('이용이 제한된 계정이에요. 모임 신청과 만들기를 할 수 없어요.');
  });

  it('탈퇴 요청 계정: 탈퇴 요청 안내 문구', async () => {
    renderBanner(DEV_ACCOUNT_IDS.userB, 'deletion_requested');
    expect(await screen.findByTestId('account-status-banner')).toHaveTextContent(
      '탈퇴 요청된 계정이에요. 모임 신청과 만들기를 할 수 없어요.',
    );
  });

  it('정상(active) 계정: 띠가 없다', async () => {
    renderBanner(DEV_ACCOUNT_IDS.userB, 'active');
    // 세션 확인이 끝난 뒤에 확인한다(로딩 중에는 원래 띠가 없으므로)
    await waitFor(() => expect(screen.getByTestId('auth-probe')).toHaveTextContent('ready:active'));
    expect(screen.queryByTestId('account-status-banner')).not.toBeInTheDocument();
  });

  it('비로그인: 띠가 없다(계정 상태와 무관)', async () => {
    renderBanner(null, 'restricted');
    await waitFor(() => expect(screen.getByTestId('auth-probe')).toHaveTextContent('ready:anon'));
    expect(screen.queryByTestId('account-status-banner')).not.toBeInTheDocument();
  });
});
