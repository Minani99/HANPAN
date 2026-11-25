import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useDataAdapter } from '../data';
import type { SessionUser } from '../data/types';
import { clearReturnTo } from '../lib/returnTo';

export type AuthStatus = 'loading' | 'ready';

export interface AuthContextValue {
  /** 처음 세션을 확인하는 동안 'loading' */
  status: AuthStatus;
  user: SessionUser | null;
  /**
   * 이 탭에서 signOut()을 직접 호출해 비로그인이 됐는지.
   * 보호된 화면 가드는 이때 /login으로 보내지 않고, 로그아웃을 호출한 쪽이 화면을 옮긴다.
   */
  signedOut: boolean;
  /**
   * 사용자 단위 캐시 키. 로그인·로그아웃·계정 전환 때 바뀐다.
   * 화면의 조회 훅은 이 값을 요청 키에 넣어, 사용자가 바뀌면 이전 사용자의 데이터를 버리고 다시 불러온다.
   */
  userKey: string;
  /** 세션 사용자를 다시 읽는다(프로필 수정·최초 설정 후). 실패하면 기존 값을 유지하고 throw */
  refresh: () => Promise<SessionUser | null>;
  /** 로그아웃: 세션·사용자 상태·returnTo를 비운다. 화면 이동은 호출한 쪽에서(useSignOut) */
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
AuthContext.displayName = 'AuthContext';

/**
 * 인증 상태 컨텍스트. DataAdapterProvider 안, 라우터 바깥에 둔다.
 * - 최초 진입 시 getSessionUser()로 세션을 확인한다.
 * - onAuthStateChange(다른 탭 포함)로 로그인·로그아웃을 따라간다.
 * - 별도 데이터 캐시는 두지 않는다. 화면 훅이 userKey를 요청 키에 포함해 사용자 변경 시 다시 요청한다.
 */
export function AuthProvider({ children }: { children?: ReactNode }) {
  const adapter = useDataAdapter();
  const { auth } = adapter;
  const [state, setState] = useState<{ status: AuthStatus; user: SessionUser | null; signedOut: boolean }>({
    status: 'loading',
    user: null,
    signedOut: false,
  });
  const requestSeq = useRef(0);
  const currentUserId = useRef<string | null>(null);

  const apply = useCallback((user: SessionUser | null) => {
    // 로그인돼 있던 사용자가 로그아웃되면(다른 탭 포함) 저장된 returnTo도 버린다.
    if (!user && currentUserId.current) clearReturnTo();
    currentUserId.current = user?.id ?? null;
    setState((prev) => ({ status: 'ready', user, signedOut: user ? false : prev.signedOut }));
  }, []);

  useEffect(() => {
    let active = true;
    const seq = ++requestSeq.current;
    auth.getSessionUser().then(
      (user) => {
        if (active && seq === requestSeq.current) apply(user);
      },
      () => {
        // 세션을 확인하지 못하면 비로그인으로 취급한다(보호된 화면은 로그인으로 안내).
        if (active && seq === requestSeq.current) apply(null);
      },
    );
    const unsubscribe = auth.onAuthStateChange((user) => {
      requestSeq.current += 1;
      if (active) apply(user);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [auth, apply]);

  const refresh = useCallback(async () => {
    const seq = ++requestSeq.current;
    const user = await auth.getSessionUser();
    if (seq === requestSeq.current) apply(user);
    return user;
  }, [auth, apply]);

  const signOut = useCallback(async () => {
    requestSeq.current += 1;
    await auth.signOut();
    clearReturnTo();
    currentUserId.current = null;
    setState({ status: 'ready', user: null, signedOut: true });
  }, [auth]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status: state.status,
      user: state.user,
      signedOut: state.signedOut,
      userKey: state.user ? `user:${state.user.id}` : 'anon',
      refresh,
      signOut,
    }),
    [state, refresh, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth는 AuthProvider 안에서만 사용할 수 있습니다.');
  return context;
}
