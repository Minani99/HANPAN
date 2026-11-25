import { afterEach, describe, expect, it } from 'vitest';
import {
  RETURN_TO_STORAGE_KEY,
  clearReturnTo,
  consumeReturnTo,
  parseReturnTo,
  peekReturnTo,
  sanitizeReturnTo,
  saveReturnTo,
} from './returnTo';

afterEach(() => {
  window.sessionStorage.clear();
});

describe('lib/returnTo', () => {
  it('내부 경로(쿼리·해시 포함)는 그대로 허용한다', () => {
    expect(sanitizeReturnTo('/')).toBe('/');
    expect(sanitizeReturnTo('/meetings/seed-meeting-01')).toBe('/meetings/seed-meeting-01');
    expect(sanitizeReturnTo('/?category=strategy&recruiting=1')).toBe('/?category=strategy&recruiting=1');
    expect(sanitizeReturnTo('/my/meetings?role=hosted#top')).toBe('/my/meetings?role=hosted#top');
    expect(sanitizeReturnTo('/profile?onboarding=1')).toBe('/profile?onboarding=1');
  });

  it('외부 주소·프로토콜 상대 경로·백슬래시는 거부한다(열린 리디렉션 방지)', () => {
    for (const value of [
      '//evil.example',
      '//evil.example/meetings',
      '/\\evil.example',
      '/\\/evil.example',
      '\\\\evil.example',
      'https://evil.example',
      'http://localhost/meetings',
      'javascript:alert(1)',
      'meetings/1',
      ' /meetings/1',
      '/meetings\\1',
    ]) {
      expect(sanitizeReturnTo(value), value).toBe('/');
    }
  });

  it('제어문자·빈 값·문자열이 아닌 값·너무 긴 값은 거부한다', () => {
    expect(sanitizeReturnTo('/a\nb')).toBe('/');
    expect(sanitizeReturnTo('/a\tb')).toBe('/');
    expect(sanitizeReturnTo('/a\u0000')).toBe('/');
    expect(sanitizeReturnTo('')).toBe('/');
    expect(sanitizeReturnTo(null)).toBe('/');
    expect(sanitizeReturnTo(undefined)).toBe('/');
    expect(sanitizeReturnTo(42)).toBe('/');
    expect(sanitizeReturnTo(`/${'a'.repeat(3000)}`)).toBe('/');
  });

  it('로그인 흐름 자체로는 돌아가지 않는다', () => {
    expect(parseReturnTo('/login')).toBeNull();
    expect(parseReturnTo('/login?x=1')).toBeNull();
    expect(parseReturnTo('/login/')).toBeNull();
    expect(parseReturnTo('/auth/callback?code=abc')).toBeNull();
    expect(parseReturnTo('/loginx')).toBe('/loginx');
  });

  it('fallback을 바꿀 수 있다', () => {
    expect(sanitizeReturnTo('//evil', '/my/meetings')).toBe('/my/meetings');
  });

  it('sessionStorage에 안전한 값만 저장하고, consume은 읽은 뒤 지운다', () => {
    expect(saveReturnTo('//evil.example')).toBe(false);
    expect(peekReturnTo()).toBeNull();
    expect(saveReturnTo('/meetings/1?x=1')).toBe(true);
    expect(window.sessionStorage.getItem(RETURN_TO_STORAGE_KEY)).toBe('/meetings/1?x=1');
    expect(peekReturnTo()).toBe('/meetings/1?x=1');
    expect(consumeReturnTo()).toBe('/meetings/1?x=1');
    expect(peekReturnTo()).toBeNull();
    expect(consumeReturnTo('/fallback')).toBe('/fallback');
  });

  it('저장소 값이 조작돼도 읽을 때 다시 검증한다', () => {
    window.sessionStorage.setItem(RETURN_TO_STORAGE_KEY, 'https://evil.example');
    expect(peekReturnTo()).toBeNull();
    expect(consumeReturnTo()).toBe('/');
    saveReturnTo('/a');
    clearReturnTo();
    expect(peekReturnTo()).toBeNull();
  });
});
