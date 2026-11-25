import { describe, expect, it } from 'vitest';
import {
  FONT_CDN_SOURCE,
  HeadersConfigError,
  MAX_HEADERS_LINE_LENGTH,
  buildCsp,
  buildHeaderRules,
  cspDirectives,
  headersForPath,
  parseCsp,
  parseHeadersFile,
  parseSupabaseOrigin,
  pathMatches,
  renderHeadersFile,
} from './lib/security-headers.mjs';

/** 보안 헤더 생성(scripts/write-headers.mjs가 쓰는 순수 함수). 정책 근거: docs/SECURITY.md §7 */

function reasonOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(HeadersConfigError);
    return (error as HeadersConfigError).reason;
  }
}

describe('parseSupabaseOrigin (VITE_SUPABASE_URL → connect-src origin)', () => {
  it('값이 없거나 공백뿐이면 null(설정 없음)', () => {
    expect(parseSupabaseOrigin(undefined)).toBeNull();
    expect(parseSupabaseOrigin(null)).toBeNull();
    expect(parseSupabaseOrigin('')).toBeNull();
    expect(parseSupabaseOrigin('   ')).toBeNull();
  });

  it('https origin만 받고 정리된 origin을 돌려준다(대문자 호스트·끝의 / 하나·앞뒤 공백·기본 포트)', () => {
    expect(parseSupabaseOrigin('https://example-ref.supabase.co')).toBe('https://example-ref.supabase.co');
    expect(parseSupabaseOrigin('https://Example-Ref.Supabase.co/')).toBe('https://example-ref.supabase.co');
    expect(parseSupabaseOrigin('  https://example-ref.supabase.co \n')).toBe('https://example-ref.supabase.co');
    expect(parseSupabaseOrigin('https://example-ref.supabase.co:443')).toBe('https://example-ref.supabase.co');
    expect(parseSupabaseOrigin('https://db.example.test:8443')).toBe('https://db.example.test:8443');
  });

  it('https가 아니면 거부(not_https)', () => {
    expect(reasonOf(() => parseSupabaseOrigin('http://example-ref.supabase.co'))).toBe('not_https');
    expect(reasonOf(() => parseSupabaseOrigin('http://127.0.0.1:54321'))).toBe('not_https');
    expect(reasonOf(() => parseSupabaseOrigin('ftp://example-ref.supabase.co'))).toBe('not_https');
    expect(reasonOf(() => parseSupabaseOrigin('javascript:alert(1)'))).toBe('not_https');
  });

  it('경로·쿼리·해시가 있으면 거부(has_path)', () => {
    expect(reasonOf(() => parseSupabaseOrigin('https://example-ref.supabase.co/rest/v1'))).toBe('has_path');
    expect(reasonOf(() => parseSupabaseOrigin('https://example-ref.supabase.co//'))).toBe('has_path');
    expect(reasonOf(() => parseSupabaseOrigin('https://example-ref.supabase.co?x=1'))).toBe('has_path');
    expect(reasonOf(() => parseSupabaseOrigin('https://example-ref.supabase.co?'))).toBe('has_path');
    expect(reasonOf(() => parseSupabaseOrigin('https://example-ref.supabase.co#frag'))).toBe('has_path');
  });

  it('형식 오류는 거부(format): 스킴 없음·사용자 정보·잘못된 호스트·포트', () => {
    for (const value of [
      'example-ref.supabase.co',
      'https//example-ref.supabase.co',
      'https://',
      'https://user:pass@example-ref.supabase.co',
      'https://exa_mple.supabase.co',
      'https://-bad.supabase.co',
      'https://한글.supabase.co',
      'https://example-ref.supabase.co:0',
      'https://example-ref.supabase.co:99999',
    ]) {
      expect(reasonOf(() => parseSupabaseOrigin(value)), value).toBe('format');
    }
  });

  it('줄바꿈·세미콜론·공백·따옴표로 헤더·CSP를 조작하려는 입력은 거부(URL 파서가 지우기 전에 막는다)', () => {
    for (const value of [
      'https://example-ref.supabase.co\nX-Injected: 1',
      'https://example-ref.supabase.co\r\n  Content-Security-Policy: default-src *',
      'https://exa\nmple-ref.supabase.co',
      'https://exa\tmple-ref.supabase.co',
      "https://example-ref.supabase.co; script-src 'unsafe-inline'",
      'https://example-ref.supabase.co;',
      'https://example-ref.supabase.co https://evil.example',
      "https://example-ref.supabase.co'",
      'https://example-ref.supabase.co,https://evil.example',
      'https://example-ref.supabase.co\\evil',
      'https://example-ref.supabase.co\u0000',
    ]) {
      expect(reasonOf(() => parseSupabaseOrigin(value)), JSON.stringify(value)).toBe('format');
    }
  });

  it('오류 메시지에 입력값을 넣지 않는다', () => {
    let caught: unknown = null;
    try {
      parseSupabaseOrigin('https://example-ref.supabase.co\nX-Secret: zzz');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HeadersConfigError);
    expect((caught as Error).message).not.toContain('zzz');
    expect((caught as Error).message).not.toContain('example-ref');
  });
});

describe('CSP와 _headers 생성', () => {
  it('Supabase 설정이 있으면 connect-src에 그 origin만 더하고, 없으면 self만', () => {
    const withSupabase = parseCsp(buildCsp('https://example-ref.supabase.co'));
    const without = parseCsp(buildCsp(null));
    expect(withSupabase['connect-src']).toEqual(["'self'", 'https://example-ref.supabase.co']);
    expect(without['connect-src']).toEqual(["'self'"]);
    // connect-src 말고는 같다
    expect({ ...withSupabase, 'connect-src': [] }).toEqual({ ...without, 'connect-src': [] });
  });

  it('정책 전체(바꾸면 docs/SECURITY.md §7과 함께 고친다)', () => {
    expect(buildCsp(null)).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self' https://cdn.jsdelivr.net/gh/sun-typeface/; " +
        "font-src https://cdn.jsdelivr.net/gh/sun-typeface/; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; " +
        "base-uri 'self'; form-action 'self'; object-src 'none'",
    );
    const csp = parseCsp(buildCsp('https://example-ref.supabase.co'));
    // 인라인·eval·와일드카드를 허용하지 않는다
    for (const values of Object.values(csp)) {
      for (const value of values) {
        expect(value).not.toMatch(/unsafe-|^\*$|^https:$|^data:$|^blob:$|^wss?:/);
      }
    }
    expect(FONT_CDN_SOURCE.endsWith('/')).toBe(true);
    expect(cspDirectives(null).every(([, , reason]) => reason.length > 0)).toBe(true);
  });

  it('_headers 파일: 경로 규칙 2개(/*, /assets/*)와 보안 헤더, 되읽으면 같은 규칙', () => {
    const rules = buildHeaderRules({ supabaseOrigin: 'https://example-ref.supabase.co' });
    const text = renderHeadersFile(rules, ['생성 파일']);
    expect(text.startsWith('# 생성 파일\n/*\n  Content-Security-Policy: ')).toBe(true);
    expect(parseHeadersFile(text)).toEqual(rules);
    for (const line of text.split('\n')) expect(line.length).toBeLessThanOrEqual(MAX_HEADERS_LINE_LENGTH);

    const page = headersForPath(rules, '/meetings/abc');
    expect(Object.keys(page)).toEqual([
      'Content-Security-Policy',
      'X-Content-Type-Options',
      'Referrer-Policy',
      'Permissions-Policy',
      'X-Frame-Options',
      'Cross-Origin-Opener-Policy',
      'Strict-Transport-Security',
    ]);
    expect(page['X-Frame-Options']).toBe('DENY');
    expect(page['Strict-Transport-Security']).toBe('max-age=31536000');
    expect(page['Permissions-Policy']).toBe('camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    expect(page['Cache-Control']).toBeUndefined();
    const asset = headersForPath(rules, '/assets/index-abc123.js');
    expect(asset['Cache-Control']).toBe('public, max-age=31536000, immutable');
    expect(asset['Content-Security-Policy']).toBeDefined();
  });

  it('헤더 값에 줄바꿈이 있거나 줄이 너무 길면 파일을 만들지 않는다', () => {
    expect(() => renderHeadersFile([{ path: '/*', headers: [['X-Test', 'a\nb']] }])).toThrow(/줄바꿈/);
    expect(() => renderHeadersFile([{ path: '/*', headers: [['X-Test', 'a\rb']] }])).toThrow(/줄바꿈/);
    expect(() => renderHeadersFile([{ path: '/*', headers: [['X Bad', 'v']] }])).toThrow(/이름/);
    expect(() => renderHeadersFile([{ path: '/*\n/x', headers: [] }])).toThrow(/경로/);
    expect(() => renderHeadersFile([{ path: '/*', headers: [['X-Long', 'a'.repeat(MAX_HEADERS_LINE_LENGTH)]] }])).toThrow(/2000/);
  });

  it('경로 패턴: *는 아무 글자나(0개 이상), 나머지는 글자 그대로', () => {
    expect(pathMatches('/*', '/')).toBe(true);
    expect(pathMatches('/*', '/admin')).toBe(true);
    expect(pathMatches('/assets/*', '/assets/a.js')).toBe(true);
    expect(pathMatches('/assets/*', '/assetsx/a.js')).toBe(false);
    expect(pathMatches('/assets/*', '/meetings/assets/a.js')).toBe(false);
    expect(pathMatches('/a.b', '/axb')).toBe(false);
  });

  it('parseHeadersFile: 주석·빈 줄 무시, 경로 없이 시작하는 헤더 줄·콜론 없는 줄은 오류', () => {
    expect(parseHeadersFile('# c\n\n/x\n  A: 1\n  B: a: b\n')).toEqual([{ path: '/x', headers: [['A', '1'], ['B', 'a: b']] }]);
    expect(() => parseHeadersFile('  A: 1\n')).toThrow();
    expect(() => parseHeadersFile('/x\n  broken\n')).toThrow();
  });
});
