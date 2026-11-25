/**
 * 공개 환경 변수(VITE_*) 읽기.
 * VITE_ 값은 빌드 결과에 포함되어 누구나 볼 수 있다. service_role 키 같은 비밀 값은 절대 넣지 않는다.
 */

export interface SupabasePublicConfig {
  url: string;
  anonKey: string;
}

export interface PublicEnv {
  /** URL과 anon 키가 모두 유효할 때만 값이 있다. */
  supabase: SupabasePublicConfig | null;
  kakaoAuthEnabled: boolean;
  siteUrl: string | null;
}

type RawEnv = Partial<Record<keyof ImportMetaEnv, string | undefined>>;

function readHttpUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin + url.pathname.replace(/\/$/, '');
  } catch {
    return null;
  }
}

export function parsePublicEnv(raw: RawEnv): PublicEnv {
  const supabaseUrl = readHttpUrl(raw.VITE_SUPABASE_URL);
  const anonKey = raw.VITE_SUPABASE_ANON_KEY?.trim() ?? '';
  return {
    supabase: supabaseUrl && anonKey ? { url: supabaseUrl, anonKey } : null,
    kakaoAuthEnabled: raw.VITE_AUTH_KAKAO_ENABLED?.trim().toLowerCase() === 'true',
    siteUrl: readHttpUrl(raw.VITE_SITE_URL),
  };
}

export function readPublicEnv(): PublicEnv {
  return parsePublicEnv({
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
    VITE_AUTH_KAKAO_ENABLED: import.meta.env.VITE_AUTH_KAKAO_ENABLED,
    VITE_SITE_URL: import.meta.env.VITE_SITE_URL,
  });
}
