/**
 * Supabase 어댑터 진입점. src/data/index.ts가 VITE_SUPABASE_URL·VITE_SUPABASE_ANON_KEY가 있을 때만 동적 import 한다.
 * (supabase-js와 어댑터 코드는 별도 청크로 나뉜다)
 */
import type { PublicEnv, SupabasePublicConfig } from '../../lib/env';
import type { DataAdapter } from '../adapter';
import { createSupabaseAdapter } from './adapter';
import { createSupabaseBrowserClient } from './client';

export interface SupabaseDataAdapterEnv {
  supabase: SupabasePublicConfig;
  kakaoAuthEnabled: PublicEnv['kakaoAuthEnabled'];
}

/**
 * 브라우저용 Supabase 어댑터. 키가 service_role/secret으로 보이거나 공개 환경 변수 이름에 SERVICE_ROLE이 있으면
 * 경고 후 DataAdapterError(SERVICE_UNCONFIGURED)를 던진다.
 */
export function createSupabaseDataAdapter(env: SupabaseDataAdapterEnv, envNames: readonly string[] = []): DataAdapter {
  const client = createSupabaseBrowserClient(env.supabase, { envNames });
  return createSupabaseAdapter({ client, kakaoAuthEnabled: env.kakaoAuthEnabled });
}
