import { createContext, createElement, useContext, type ReactNode } from 'react';
import { readPublicEnv } from '../lib/env';
import { isDataAdapterError, type DataAdapter } from './adapter';
import { createUnconfiguredAdapter } from './unconfigured';

export type { DataAdapter } from './adapter';
export { DataAdapterError, MEETING_PAGE_SIZE } from './adapter';

/** 브라우저에 노출되는 VITE_ 환경 변수 '이름' 목록(값 없음). vite.config.ts의 define으로 주입한다 */
const PUBLIC_ENV_NAMES: readonly string[] =
  typeof __HANPAN_PUBLIC_ENV_NAMES__ !== 'undefined' ? __HANPAN_PUBLIC_ENV_NAMES__ : [];

/**
 * 실행 환경에 맞는 데이터 어댑터를 만든다.
 *
 * 1. e2e 모드: 항상 mock (테스트 결과가 로컬 .env 설정에 흔들리지 않도록)
 * 2. VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY 설정됨: supabase (동적 import — supabase-js는 별도 청크)
 *    - 키가 service_role/secret으로 보이거나 공개 환경 변수 이름에 SERVICE_ROLE이 있으면 경고 후 unconfigured
 * 3. 개발 서버(DEV): mock
 * 4. 그 외(프로덕션 + 설정 없음): unconfigured — 가짜 데이터 없이 빈 상태
 *
 * mock 모듈은 아래 조건 안에서만 동적 import 한다. 프로덕션 빌드에서는 조건이 상수 false로 치환되어
 * mock/seed 청크가 생성되지 않는다(`npm run check:seed`로 검증). 이 조건식을 함수 인자 등으로 바꾸지 말 것.
 */
export async function createDataAdapter(): Promise<DataAdapter> {
  const env = readPublicEnv();

  if (import.meta.env.DEV || import.meta.env.MODE === 'e2e') {
    if (import.meta.env.MODE === 'e2e' || !env.supabase) {
      const { createMockAdapter } = await import('./mock/adapter');
      return createMockAdapter();
    }
  }

  if (env.supabase) {
    // service_role 키는 절대 사용하지 않는다. anon(publishable) 키 + RLS로만 접근한다.
    const { createSupabaseDataAdapter } = await import('./supabase');
    try {
      return createSupabaseDataAdapter({ supabase: env.supabase, kakaoAuthEnabled: env.kakaoAuthEnabled }, PUBLIC_ENV_NAMES);
    } catch (error) {
      // 키 가드가 거부한 경우(경고는 이미 출력됨): 비밀 키로 요청하지 않고 빈 상태로 띄운다.
      if (isDataAdapterError(error) && error.code === 'SERVICE_UNCONFIGURED') return createUnconfiguredAdapter();
      throw error;
    }
  }

  return createUnconfiguredAdapter();
}

const DataAdapterContext = createContext<DataAdapter | null>(null);
DataAdapterContext.displayName = 'DataAdapterContext';

export interface DataAdapterProviderProps {
  adapter: DataAdapter;
  children?: ReactNode;
}

export function DataAdapterProvider({ adapter, children }: DataAdapterProviderProps) {
  return createElement(DataAdapterContext.Provider, { value: adapter }, children);
}

export function useDataAdapter(): DataAdapter {
  const adapter = useContext(DataAdapterContext);
  if (!adapter) {
    throw new Error('useDataAdapter는 DataAdapterProvider 안에서만 사용할 수 있습니다.');
  }
  return adapter;
}
