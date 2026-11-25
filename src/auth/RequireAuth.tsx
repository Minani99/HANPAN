import { useEffect, useState, type ReactNode } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { PageContainer } from '../components/layout/PageContainer';
import { Spinner } from '../components/ui/Spinner';
import { saveReturnTo } from '../lib/returnTo';
import { useAuth } from './AuthProvider';

export const LOGIN_PATH = '/login';
export const ONBOARDING_PATH = '/profile?onboarding=1';

export function AuthPending({ label = '로그인 정보를 확인하는 중이에요.' }: { label?: string }) {
  return (
    <PageContainer className="flex min-h-[50vh] items-center justify-center text-muted">
      <Spinner label={label} size="1.5rem" />
    </PageContainer>
  );
}

/**
 * returnTo를 저장한 뒤 다른 경로로 바꿔 이동한다(히스토리를 쌓지 않음).
 * 렌더 중 부수효과를 피하려고 effect에서 처리한다.
 */
export function RedirectWithReturnTo({ to, returnTo }: { to: string; returnTo: string }) {
  const navigate = useNavigate();
  useEffect(() => {
    saveReturnTo(returnTo);
    navigate(to, { replace: true });
  }, [navigate, to, returnTo]);
  return <AuthPending label="화면을 옮기는 중이에요." />;
}

export interface RequireAuthProps {
  /** 최초 설정(닉네임·약관 동의)까지 마쳐야 하는지. 기본 true */
  requireOnboarded?: boolean;
  /** 없으면 <Outlet /> (레이아웃 라우트로 사용) */
  children?: ReactNode;
}

/**
 * 로그인 필요 라우트 가드.
 * - 비로그인 → 현재 경로(쿼리 포함)를 returnTo로 저장하고 /login
 * - 최초 설정 전 → returnTo 저장 후 /profile?onboarding=1 (설정을 마치면 returnTo로 돌아온다)
 * 화면 가드는 편의일 뿐이며 실제 권한 검사는 서버(RPC·RLS)가 한다.
 */
export function RequireAuth({ requireOnboarded = true, children }: RequireAuthProps) {
  const { status, user, signedOut } = useAuth();
  const location = useLocation();
  const here = `${location.pathname}${location.search}${location.hash}`;
  // 이 가드가 로그인 상태로 화면을 보여준 적이 있는지 (렌더 중 상태 보정 패턴)
  const [shownToUser, setShownToUser] = useState(Boolean(user));
  if (user && !shownToUser) setShownToUser(true);

  if (status === 'loading') return <AuthPending />;
  // 보던 화면에서 직접 로그아웃했다면 로그아웃을 호출한 쪽(useSignOut 등)이 화면을 옮긴다.
  if (!user && signedOut && shownToUser) return <AuthPending label="로그아웃하는 중이에요." />;
  if (!user) return <RedirectWithReturnTo to={LOGIN_PATH} returnTo={here} />;
  if (requireOnboarded && !user.onboarded) return <RedirectWithReturnTo to={ONBOARDING_PATH} returnTo={here} />;
  return children ?? <Outlet />;
}

/** /profile처럼 로그인만 필요한(최초 설정 전에도 열리는) 화면 */
export function RequireSignedIn({ children }: { children?: ReactNode }) {
  return <RequireAuth requireOnboarded={false}>{children}</RequireAuth>;
}
