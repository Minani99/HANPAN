/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_AUTH_KAKAO_ENABLED?: string;
  readonly VITE_SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** vite.config.ts의 define으로 주입. public/images/hero.jpg가 있으면 그 경로, 없으면 빈 문자열. */
declare const __HERO_IMAGE_URL__: string;

/** vite.config.ts의 define으로 주입. 브라우저에 노출되는 VITE_ 환경 변수의 이름 목록(값은 넣지 않는다). */
declare const __HANPAN_PUBLIC_ENV_NAMES__: readonly string[];
