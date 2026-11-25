import { describe, expect, it } from 'vitest';
import { externalUrlHost, safeExternalUrl } from './externalUrl';

describe('lib/externalUrl', () => {
  it('https 주소만 통과한다(정규화된 주소를 돌려준다)', () => {
    expect(safeExternalUrl('https://example.com/venues/a')).toBe('https://example.com/venues/a');
    expect(safeExternalUrl('  https://Example.com  ')).toBe('https://example.com/');
    expect(externalUrlHost('https://www.example.com/a')).toBe('example.com');
  });

  it('javascript:·data:·http:·프로토콜 상대·사용자 정보·빈 값·긴 주소는 거부한다', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JAVASCRIPT:alert(1)',
      ' javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'http://example.com',
      '//example.com/a',
      'https://user:pass@example.com',
      'https://',
      'ftp://example.com',
      'example.com',
      '',
      `https://example.com/${'a'.repeat(500)}`,
    ]) {
      expect(safeExternalUrl(bad), bad).toBeNull();
    }
    expect(safeExternalUrl(null)).toBeNull();
    expect(safeExternalUrl(undefined)).toBeNull();
  });
});
