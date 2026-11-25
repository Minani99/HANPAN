import { describe, expect, it } from 'vitest';
import { DataAdapterError, getErrorCode } from '../data/adapter';
import { ERROR_CODES } from '../data/types';
import { ERROR_MESSAGES, RATE_LIMIT_MESSAGES, getErrorMessage } from './errorMessages';

const HANGUL = /[가-힣]/;

describe('domain/errorMessages', () => {
  it('모든 ErrorCode에 한국어 문구가 있다(해요체, 원문 코드 노출 없음)', () => {
    for (const code of ERROR_CODES) {
      const message = ERROR_MESSAGES[code];
      expect(message, code).toBeTruthy();
      expect(message, code).toMatch(HANGUL);
      expect(message, code).not.toContain(code);
      expect(message.trim(), code).toMatch(/[.요]$/);
    }
    expect(Object.keys(ERROR_MESSAGES).sort()).toEqual([...ERROR_CODES].sort());
  });

  it('DB_SCHEMA §10 코드와 클라이언트 코드(NETWORK_ERROR, UNKNOWN)를 포함한다', () => {
    for (const code of ['MEETING_FULL', 'ALREADY_APPLIED', 'RATE_LIMITED', 'NETWORK_ERROR', 'UNKNOWN', 'SERVICE_UNCONFIGURED']) {
      expect(ERROR_CODES).toContain(code);
    }
  });

  it('DataAdapterError는 code·detail을 갖고, 다른 오류는 UNKNOWN으로 분류한다', () => {
    const error = new DataAdapterError('VALIDATION_FAILED', { detail: 'title' });
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.detail).toBe('title');
    expect(getErrorCode(error)).toBe('VALIDATION_FAILED');
    expect(getErrorCode(new TypeError('Failed to fetch'))).toBe('UNKNOWN');
    expect(getErrorCode('oops')).toBe('UNKNOWN');
  });

  it('getErrorMessage: 코드별 문구, RATE_LIMITED는 detail별 문구', () => {
    expect(getErrorMessage(new DataAdapterError('MEETING_FULL'))).toBe('자리가 모두 찼어요.');
    expect(getErrorMessage(new DataAdapterError('RATE_LIMITED', { detail: 'create_24h' }))).toBe(RATE_LIMIT_MESSAGES.create_24h);
    expect(getErrorMessage(new DataAdapterError('RATE_LIMITED', { detail: 'unknown_limit' }))).toBe(ERROR_MESSAGES.RATE_LIMITED);
    expect(getErrorMessage(new Error('internal stack detail'))).toBe(ERROR_MESSAGES.UNKNOWN);
    expect(getErrorMessage(new DataAdapterError('SERVICE_UNCONFIGURED'))).toBe('서비스 연결 설정이 아직 완료되지 않았어요.');
  });
});
