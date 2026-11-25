/**
 * Supabase Auth(PKCE) 기반 AuthAdapter.
 *
 * - 로그인 시작: returnTo를 sessionStorage에 저장(검증된 내부 경로만) → signInWithOAuth.
 *   redirectTo는 `window.location.origin + '/auth/callback'`. VITE_SITE_URL을 쓰지 않는다 —
 *   프리뷰 배포에서 로그인하면 운영 주소로 돌아가 버리는 문제를 막기 위해서다.
 * - 콜백: URL의 code를 exchangeCodeForSession으로 교환(detectSessionInUrl은 끔). code·error 쿼리는
 *   history.replaceState로 주소창·방문 기록에서 지운다. 성공하면 저장했던 returnTo를 꺼내 돌려준다.
 * - 세션 사용자: 세션이 있으면 get_my_profile RPC로 닉네임·온보딩·계정 상태·관리자 여부를 읽는다.
 * - 오류 메시지·로그에 토큰·인가 코드·이메일을 남기지 않는다.
 */
import { consumeReturnTo, saveReturnTo } from '../../lib/returnTo';
import { DataAdapterError, type AuthAdapter } from '../adapter';
import type { OAuthProvider, SessionUser } from '../types';
import { callRpc, readSessionUserId, type SupabaseClientLike } from './client';
import { toDataAdapterError } from './errors';
import { parseProfileOrNull, toSessionUser } from './mapping';

/** 브라우저 의존 부분(테스트에서 바꿔 끼운다) */
export interface BrowserLike {
  /** 예: 'https://hanpan.pages.dev' */
  origin(): string;
  /** 현재 전체 주소 */
  href(): string;
  /** 방문 기록을 남기지 않고 주소만 바꾼다 */
  replaceUrl(url: string): void;
  /** 다음 틱에 실행(auth 이벤트 콜백 안에서 다른 supabase 호출을 하지 않기 위해) */
  defer(task: () => void): void;
}

export const AUTH_CALLBACK_PATH = '/auth/callback';

/** 콜백 주소에서 지울 쿼리·해시 키 */
const CALLBACK_SENSITIVE_KEYS = [
  'code',
  'error',
  'error_code',
  'error_description',
  'state',
  'sb_flow_id',
  'access_token',
  'refresh_token',
  'provider_token',
  'provider_refresh_token',
  'expires_at',
  'expires_in',
  'token_type',
] as const;

export function defaultBrowser(): BrowserLike {
  return {
    origin: () => window.location.origin,
    href: () => window.location.href,
    // 라우터가 history.state에 둔 값(idx 등)을 지우지 않도록 현재 state를 그대로 넘긴다.
    replaceUrl: (url) => window.history.replaceState(window.history.state, '', url),
    defer: (task) => {
      setTimeout(task, 0);
    },
  };
}

/** 콜백 주소에서 code·error·토큰류 파라미터를 지운 주소(경로·나머지 쿼리는 유지) */
export function stripCallbackParams(href: string): string {
  const url = new URL(href);
  for (const key of CALLBACK_SENSITIVE_KEYS) url.searchParams.delete(key);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const hadHashParams = CALLBACK_SENSITIVE_KEYS.some((key) => hash.has(key));
  for (const key of CALLBACK_SENSITIVE_KEYS) hash.delete(key);
  const hashText = hadHashParams ? hash.toString() : url.hash.replace(/^#/, '');
  return `${url.pathname}${url.search}${hashText ? `#${hashText}` : ''}`;
}

/** 공급자 오류 코드(예: access_denied)만 detail로. 설명 문구(error_description)는 담지 않는다 */
function oauthErrorDetail(value: string): string {
  return /^[a-z0-9_]{1,40}$/i.test(value) ? `oauth_${value.toLowerCase()}` : 'oauth_error';
}

export interface SupabaseAuthAdapterOptions {
  client: SupabaseClientLike;
  /** VITE_AUTH_KAKAO_ENABLED=true일 때만 카카오 로그인을 허용한다 */
  kakaoAuthEnabled: boolean;
  browser?: BrowserLike;
}

export function createSupabaseAuthAdapter({
  client,
  kakaoAuthEnabled,
  browser = defaultBrowser(),
}: SupabaseAuthAdapterOptions): AuthAdapter {
  /** 세션이 있을 때 get_my_profile로 화면용 사용자 요약을 만든다 */
  async function loadSessionUser(): Promise<SessionUser | null> {
    const userId = await readSessionUserId(client);
    if (!userId) return null;
    const profile = parseProfileOrNull(await callRpc(client, 'get_my_profile'));
    // 가입 트리거(handle_new_user)가 프로필을 만들지 못한 계정. 운영자 확인이 필요하다.
    if (!profile) throw new DataAdapterError('PROFILE_INCOMPLETE', { detail: 'profile_missing' });
    return toSessionUser(profile);
  }

  return {
    getSessionUser: loadSessionUser,

    onAuthStateChange(callback) {
      let active = true;
      /** 마지막으로 알린(또는 초기 세션의) 사용자 id. undefined = 아직 모름 */
      let knownUserId: string | null | undefined;
      let seq = 0;

      const resolveAndNotify = (userId: string) => {
        const mySeq = ++seq;
        const previous = knownUserId;
        knownUserId = userId;
        // supabase-js 권고: 이벤트 콜백 안에서 다른 supabase 호출을 기다리지 않는다(교착 방지) → 다음 틱에 실행
        browser.defer(() => {
          if (!active || mySeq !== seq) return;
          loadSessionUser().then(
            (user) => {
              if (active && mySeq === seq) callback(user);
            },
            () => {
              if (!active || mySeq !== seq) return;
              // 프로필을 읽지 못했다: 다른 사용자로 바뀐 경우에는 이전 사용자 화면을 남기지 않도록 비로그인으로 알리고,
              // 같은 사용자면 화면을 그대로 둔다(다음 이벤트·새로고침 때 다시 읽는다).
              knownUserId = undefined;
              if (previous !== userId) callback(null);
            },
          );
        });
      };

      const { data } = client.auth.onAuthStateChange((event, session) => {
        if (!active) return;
        const userId = session?.user.id ?? null;
        switch (event) {
          case 'INITIAL_SESSION':
            // 처음 상태는 AuthProvider가 getSessionUser()로 따로 읽는다. 중복 알림을 막으려고 기억만 한다.
            knownUserId = userId;
            return;
          case 'SIGNED_OUT':
            seq += 1;
            knownUserId = null;
            callback(null);
            return;
          case 'SIGNED_IN':
          case 'TOKEN_REFRESHED':
          case 'USER_UPDATED':
            if (!userId) {
              seq += 1;
              if (knownUserId !== null) callback(null);
              knownUserId = null;
              return;
            }
            // 같은 사용자의 토큰 갱신·탭 복귀(SIGNED_IN 재발생)는 다시 불러오지 않는다.
            if (event !== 'USER_UPDATED' && userId === knownUserId) return;
            resolveAndNotify(userId);
            return;
          default:
            // PASSWORD_RECOVERY, MFA_CHALLENGE_VERIFIED: 이 서비스에서 쓰지 않는다.
            return;
        }
      });

      return () => {
        active = false;
        data.subscription.unsubscribe();
      };
    },

    async signInWithOAuth(provider: OAuthProvider, returnTo: string) {
      if (provider !== 'google' && provider !== 'kakao') {
        throw new DataAdapterError('VALIDATION_FAILED', { detail: 'provider' });
      }
      if (provider === 'kakao' && !kakaoAuthEnabled) {
        throw new DataAdapterError('SERVICE_UNCONFIGURED', { detail: 'kakao_disabled' });
      }
      saveReturnTo(returnTo);
      let result: { error: unknown };
      try {
        result = await client.auth.signInWithOAuth({
          provider,
          options: { redirectTo: `${browser.origin()}${AUTH_CALLBACK_PATH}` },
        });
      } catch (error) {
        throw toDataAdapterError(error);
      }
      if (result.error) throw toDataAdapterError(result.error);
      // 성공하면 supabase-js가 브라우저를 공급자 화면으로 이동시킨다.
    },

    async completeOAuthCallback() {
      const href = browser.href();
      const url = new URL(href);
      const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
      const providerError = url.searchParams.get('error') ?? hash.get('error');
      const code = url.searchParams.get('code');

      // 인가 코드·오류 파라미터는 처리 전에 주소창과 방문 기록에서 지운다(일회용 코드라 재시도에도 쓸 수 없다).
      const cleaned = stripCallbackParams(href);
      if (cleaned !== `${url.pathname}${url.search}${url.hash}`) browser.replaceUrl(cleaned);

      if (providerError !== null) {
        throw new DataAdapterError('AUTH_REQUIRED', { detail: oauthErrorDetail(providerError) });
      }
      if (!code) {
        // 이미 세션이 있으면(콜백 화면 새로고침 등) 그대로 진행한다.
        if (await readSessionUserId(client)) return { returnTo: consumeReturnTo() };
        throw new DataAdapterError('AUTH_REQUIRED', { detail: 'missing_code' });
      }

      let result: Awaited<ReturnType<SupabaseClientLike['auth']['exchangeCodeForSession']>>;
      try {
        result = await client.auth.exchangeCodeForSession(code);
      } catch (error) {
        throw toDataAdapterError(error);
      }
      if (result.error) throw toDataAdapterError(result.error);
      if (!result.data.session) throw new DataAdapterError('AUTH_REQUIRED', { detail: 'no_session' });
      // 실패하면 returnTo를 남겨 두어 다시 로그인했을 때 원래 화면으로 돌아가게 한다.
      return { returnTo: consumeReturnTo() };
    },

    async signOut() {
      // 기본(global) 로그아웃은 오프라인이면 실패하고 세션을 남긴다 → 이 기기만이라도(local) 로그아웃한다.
      let global: { error: unknown };
      try {
        global = await client.auth.signOut();
      } catch (error) {
        global = { error };
      }
      if (!global.error) return;
      let local: { error: unknown };
      try {
        local = await client.auth.signOut({ scope: 'local' });
      } catch (error) {
        local = { error };
      }
      if (local.error) throw toDataAdapterError(local.error);
    },
  };
}
