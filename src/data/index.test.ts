import type * as SupabaseJs from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

// 실제 supabase-js 클라이언트(타이머·저장소 사용) 대신 빈 객체를 돌려준다. 팩토리 분기만 확인한다.
const createClientMock = vi.hoisted(() =>
  vi.fn(() => ({ rpc: vi.fn(), from: vi.fn(), auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } })),
);
vi.mock('@supabase/supabase-js', async (importOriginal) => ({
  ...(await importOriginal<typeof SupabaseJs>()),
  createClient: createClientMock,
}));

import { createDataAdapter } from './index';

function base64url(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const jwt = (role: string) => `${base64url('{"alg":"HS256"}')}.${base64url(JSON.stringify({ role }))}.sig`;

afterEach(() => {
  createClientMock.mockClear();
});

describe('data/index createDataAdapter (모드 판별)', () => {
  it('Supabase 설정이 없으면 개발·테스트에서는 mock', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    expect((await createDataAdapter()).mode).toBe('mock');
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it('URL·anon 키가 있으면 supabase 어댑터(동적 import)', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', jwt('anon'));
    expect((await createDataAdapter()).mode).toBe('supabase');
    expect(createClientMock).toHaveBeenCalledWith('https://example.supabase.co', jwt('anon'), expect.anything());
  });

  it('키가 service_role이면 경고 후 클라이언트를 만들지 않고 unconfigured(가짜 데이터도 없음)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', jwt('service_role'));
    const adapter = await createDataAdapter();
    expect(adapter.mode).toBe('unconfigured');
    expect(createClientMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('service_role'));
    await expect(adapter.listMeetings({}, { limit: 20, offset: 0 })).resolves.toEqual({ items: [], total: 0 });
  });
});
