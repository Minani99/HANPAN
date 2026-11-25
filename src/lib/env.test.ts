import { describe, expect, it } from 'vitest';
import { parsePublicEnv } from './env';

describe('lib/env', () => {
  it('URL과 anon 키가 모두 있어야 supabase 설정으로 본다', () => {
    expect(parsePublicEnv({}).supabase).toBeNull();
    expect(parsePublicEnv({ VITE_SUPABASE_URL: 'https://abc.supabase.co' }).supabase).toBeNull();
    expect(parsePublicEnv({ VITE_SUPABASE_ANON_KEY: 'key' }).supabase).toBeNull();
    expect(
      parsePublicEnv({ VITE_SUPABASE_URL: ' https://abc.supabase.co/ ', VITE_SUPABASE_ANON_KEY: ' key ' }).supabase,
    ).toEqual({ url: 'https://abc.supabase.co', anonKey: 'key' });
  });

  it('http(s)가 아닌 URL은 무시한다', () => {
    expect(
      parsePublicEnv({ VITE_SUPABASE_URL: 'javascript:alert(1)', VITE_SUPABASE_ANON_KEY: 'key' }).supabase,
    ).toBeNull();
    expect(parsePublicEnv({ VITE_SUPABASE_URL: 'not a url', VITE_SUPABASE_ANON_KEY: 'key' }).supabase).toBeNull();
  });

  it('카카오 로그인은 명시적으로 true일 때만 켠다', () => {
    expect(parsePublicEnv({}).kakaoAuthEnabled).toBe(false);
    expect(parsePublicEnv({ VITE_AUTH_KAKAO_ENABLED: 'TRUE' }).kakaoAuthEnabled).toBe(true);
    expect(parsePublicEnv({ VITE_AUTH_KAKAO_ENABLED: '1' }).kakaoAuthEnabled).toBe(false);
  });

  it('사이트 URL', () => {
    expect(parsePublicEnv({ VITE_SITE_URL: 'http://localhost:5173' }).siteUrl).toBe('http://localhost:5173');
    expect(parsePublicEnv({ VITE_SITE_URL: '' }).siteUrl).toBeNull();
  });
});
