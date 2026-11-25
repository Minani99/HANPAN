import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { AuthPending, ONBOARDING_PATH } from '../auth/RequireAuth';
import { InfoState } from '../components/layout/PageStates';
import { ButtonLink } from '../components/ui/Button';
import { useDataAdapter } from '../data';
import { sanitizeReturnTo, saveReturnTo } from '../lib/returnTo';
import { useDocumentTitle } from '../lib/useDocumentTitle';

/**
 * OAuth 콜백 (`/auth/callback`).
 * 세션을 확정한 뒤 returnTo(검증된 내부 경로)로, 최초 설정 전이면 /profile?onboarding=1로 간다.
 * 공급자가 error를 돌려주거나 세션을 만들지 못하면 안내 + 다시 로그인. 코드·토큰은 로그에 남기지 않는다.
 */
export function AuthCallbackPage() {
  useDocumentTitle('로그인 처리');
  const { auth } = useDataAdapter();
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const providerError = searchParams.has('error');
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    // 코드 교환은 한 번만(StrictMode 이중 실행·재렌더 대비)
    if (providerError || started.current) return;
    started.current = true;
    (async () => {
      try {
        const { returnTo } = await auth.completeOAuthCallback();
        const user = await refresh();
        if (!user) throw new Error('세션이 없습니다.');
        if (!user.onboarded) {
          saveReturnTo(returnTo);
          navigate(ONBOARDING_PATH, { replace: true });
        } else {
          navigate(sanitizeReturnTo(returnTo), { replace: true });
        }
      } catch {
        setFailed(true);
      }
    })();
  }, [auth, refresh, navigate, providerError]);

  if (providerError || failed) {
    return (
      <InfoState
        title="로그인을 완료하지 못했어요"
        description="로그인 창을 닫았거나 연결이 끊겼을 수 있어요. 잠시 후 다시 시도해 주세요."
        actions={<ButtonLink to="/login">다시 로그인하기</ButtonLink>}
      />
    );
  }
  return <AuthPending label="로그인 중이에요…" />;
}
