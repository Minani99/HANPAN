import { useEffect, useRef, useState, type RefObject } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { AuthPending, ONBOARDING_PATH } from '../auth/RequireAuth';
import { PageContainer } from '../components/layout/PageContainer';
import { Button } from '../components/ui/Button';
import { ErrorText, Notice } from '../components/ui/Notice';
import { Spinner } from '../components/ui/Spinner';
import { useToast } from '../components/ui/Toast';
import { useDataAdapter } from '../data';
import type { OAuthProvider } from '../data/types';
import { useAsyncData } from '../data/useAsyncData';
import { getErrorMessage } from '../domain/errorMessages';
import { readPublicEnv } from '../lib/env';
import { consumeReturnTo, peekReturnTo } from '../lib/returnTo';
import { useDocumentTitle } from '../lib/useDocumentTitle';

const PROVIDER_LABEL: Record<OAuthProvider, string> = {
  google: 'Google로 계속하기',
  kakao: '카카오로 계속하기',
};

/**
 * 로그인 (`/login`).
 * - 로그인 상태가 되면(이미 로그인했거나 방금 로그인) returnTo로, 최초 설정 전이면 /profile?onboarding=1로 간다.
 * - mock 모드(개발·e2e)에서만 '개발용 테스트 계정' 섹션을 보여준다. 이 섹션은 어댑터의 선택 메서드가 있을 때만 렌더된다.
 */
export function LoginPage() {
  useDocumentTitle('로그인');
  const adapter = useDataAdapter();
  const { auth } = adapter;
  const { status, user, refresh } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [showDevGuidance, setShowDevGuidance] = useState(false);
  const devHeadingRef = useRef<HTMLHeadingElement>(null);
  const redirected = useRef(false);
  const kakaoEnabled = readPublicEnv().kakaoAuthEnabled;
  const devAuth = typeof auth.listDevAccounts === 'function' && typeof auth.signInAsDev === 'function';
  const unavailable = adapter.mode === 'unconfigured';

  useEffect(() => {
    if (status !== 'ready' || !user || redirected.current) return;
    redirected.current = true;
    // 최초 설정 전이면 returnTo는 남겨 두고(설정을 마친 뒤 사용) 설정 화면으로 간다.
    navigate(user.onboarded ? consumeReturnTo() : ONBOARDING_PATH, { replace: true });
  }, [status, user, navigate]);

  if (status === 'loading' || user) return <AuthPending />;

  const startOAuth = async (provider: OAuthProvider) => {
    setError(null);
    if (devAuth) {
      // 개발 모드에는 OAuth 공급자가 연결되어 있지 않다. 오류 대신 테스트 계정 선택을 안내한다.
      setShowDevGuidance(true);
      devHeadingRef.current?.focus();
      return;
    }
    try {
      await auth.signInWithOAuth(provider, peekReturnTo() ?? '/');
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  };

  return (
    <PageContainer className="py-10 md:py-16">
      <div className="mx-auto max-w-md">
        <h1 className="text-3xl leading-tight font-heavy tracking-detail text-ink md:text-4xl">로그인</h1>
        <p className="mt-2 text-base leading-relaxed text-text text-wrap-ko">
          참가 신청과 모임 만들기는 로그인 후 이용할 수 있어요.
        </p>

        {unavailable ? (
          <Notice tone="warning" title="지금은 로그인을 사용할 수 없어요" className="mt-6">
            서비스 연결 설정이 아직 완료되지 않았어요.
          </Notice>
        ) : null}

        <div className="mt-7 space-y-2.5">
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            disabled={unavailable}
            focusableWhenDisabled
            onClick={() => startOAuth('google')}
          >
            {PROVIDER_LABEL.google}
          </Button>
          {kakaoEnabled ? (
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              disabled={unavailable}
              focusableWhenDisabled
              onClick={() => startOAuth('kakao')}
            >
              {PROVIDER_LABEL.kakao}
            </Button>
          ) : null}
        </div>
        <ErrorText message={error} className="mt-3" />

        <ul role="list" className="mt-6 space-y-2 text-sm leading-relaxed text-text text-wrap-ko">
          <li>HANPAN에서는 닉네임으로 활동해요. 실명·이메일·연락처는 다른 이용자에게 공개되지 않아요.</li>
          <li>
            처음 로그인하면 닉네임을 정하고{' '}
            <Link to="/policies/terms" className="font-bold text-ink underline underline-offset-4">
              이용약관(초안)
            </Link>
            과{' '}
            <Link to="/policies/privacy" className="font-bold text-ink underline underline-offset-4">
              개인정보처리방침(초안)
            </Link>
            에 동의하는 단계가 있어요.
          </li>
        </ul>

        {devAuth ? (
          <DevAccountsSection headingRef={devHeadingRef} showGuidance={showDevGuidance} onError={setError} refreshAuth={refresh} />
        ) : null}
      </div>
    </PageContainer>
  );
}

interface DevAccountsSectionProps {
  headingRef: RefObject<HTMLHeadingElement | null>;
  showGuidance: boolean;
  onError: (message: string | null) => void;
  refreshAuth: () => Promise<unknown>;
}

/** 개발용 테스트 계정 (mock 어댑터에만 있는 auth.listDevAccounts / signInAsDev / resetDevData 사용) */
function DevAccountsSection({ headingRef, showGuidance, onError, refreshAuth }: DevAccountsSectionProps) {
  const { auth } = useDataAdapter();
  const toast = useToast();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const accounts = useAsyncData('dev-accounts', () => auth.listDevAccounts?.() ?? Promise.resolve([]));

  const signIn = async (accountId: string) => {
    if (pendingId || !auth.signInAsDev) return;
    onError(null);
    setPendingId(accountId);
    try {
      await auth.signInAsDev(accountId);
      await refreshAuth();
    } catch (caught) {
      onError(getErrorMessage(caught));
      setPendingId(null);
    }
  };

  const reset = async () => {
    if (!auth.resetDevData) return;
    await auth.resetDevData();
    await accounts.refresh().catch(() => {});
    toast.show('개발 데이터를 처음 상태로 되돌렸어요.');
  };

  return (
    <section aria-labelledby="dev-accounts-heading" className="mt-10 border-t border-border pt-7" data-testid="dev-accounts">
      <h2
        id="dev-accounts-heading"
        ref={headingRef}
        tabIndex={-1}
        className="text-lg leading-snug font-heavy text-ink focus-visible:outline-none"
      >
        개발용 테스트 계정
      </h2>
      <p className="mt-1.5 text-sm leading-relaxed text-text text-wrap-ko">
        개발 모드에서만 보이는 예시 계정이에요. 실제 로그인이 아니며, 데이터는 이 브라우저에만 저장돼요.
      </p>
      {showGuidance ? (
        <Notice tone="info" role="status" className="mt-4" data-testid="dev-oauth-guidance">
          개발 모드에서는 Google·카카오 로그인이 연결되어 있지 않아요. 아래 테스트 계정 중 하나로 로그인해 주세요.
        </Notice>
      ) : null}

      {accounts.status === 'loading' ? (
        <div className="mt-4 flex justify-center text-muted">
          <Spinner label="테스트 계정을 불러오는 중이에요." />
        </div>
      ) : null}
      {accounts.status === 'error' ? (
        <ErrorText className="mt-4" message="테스트 계정을 불러오지 못했어요. 새로고침해 주세요." />
      ) : null}
      {accounts.data ? (
        <ul role="list" className="mt-4 space-y-2">
          {accounts.data.map((account) => (
            <li key={account.id}>
              <button
                type="button"
                onClick={() => signIn(account.id)}
                aria-busy={pendingId === account.id || undefined}
                className="flex min-h-cta w-full items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors duration-150 hover:bg-soft"
                data-testid="dev-account"
              >
                <span className="min-w-0">
                  <span className="block text-base font-bold text-ink">{account.nickname}</span>
                  <span className="mt-0.5 block text-sm text-muted text-wrap-ko">{account.description}</span>
                </span>
                {pendingId === account.id ? <Spinner label="로그인하는 중" /> : <span aria-hidden="true">→</span>}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <Button variant="text" className="mt-4" onClick={reset} data-testid="dev-reset">
        개발 데이터 초기화
      </Button>
    </section>
  );
}
