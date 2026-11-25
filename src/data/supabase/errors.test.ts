import {
  AuthApiError,
  AuthPKCECodeVerifierMissingError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  PostgrestError,
} from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { DataAdapterError } from '../adapter';
import { toDataAdapterError } from './errors';

function pg(code: string, message: string, details: string | null = null) {
  return { code, message, details, hint: null };
}

describe('supabase/errors → DataAdapterError', () => {
  it('RPC 오류(P0001): message가 ERROR_CODES에 있으면 그 코드, details는 detail로 보존', () => {
    const error = toDataAdapterError(pg('P0001', 'VALIDATION_FAILED', 'start_at'), { status: 400 });
    expect(error).toBeInstanceOf(DataAdapterError);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.detail).toBe('start_at');
    expect(toDataAdapterError(pg('P0001', 'RATE_LIMITED', 'create_24h')).detail).toBe('create_24h');
    expect(toDataAdapterError(pg('P0001', 'MEETING_NOT_OPEN', 'host_missing'))).toMatchObject({
      code: 'MEETING_NOT_OPEN',
      detail: 'host_missing',
    });
    // detail이 빈 문자열·null이면 없음
    expect(toDataAdapterError(pg('P0001', 'NOT_FOUND', '')).detail).toBeUndefined();
    expect(toDataAdapterError(pg('P0001', 'NOT_FOUND', null)).detail).toBeUndefined();
  });

  it('P0001이지만 모르는 코드·클라이언트 전용 코드면 UNKNOWN(detail 버림)', () => {
    expect(toDataAdapterError(pg('P0001', 'SOMETHING_NEW', 'x'))).toMatchObject({ code: 'UNKNOWN', detail: undefined });
    expect(toDataAdapterError(pg('P0001', 'NETWORK_ERROR')).code).toBe('UNKNOWN');
    expect(toDataAdapterError(pg('P0001', 'PERMISSION_DENIED')).code).toBe('UNKNOWN');
  });

  it('detail은 필드 이름·사유 코드 형식만 옮긴다(문장·입력값은 버림)', () => {
    expect(toDataAdapterError(pg('P0001', 'VALIDATION_FAILED', 'user@example.com 은 잘못됨')).detail).toBeUndefined();
  });

  it('42501 → PERMISSION_DENIED, PostgREST JWT 오류 → AUTH_REQUIRED', () => {
    expect(toDataAdapterError(pg('42501', 'permission denied for function apply_to_meeting'), { status: 401 }).code).toBe(
      'PERMISSION_DENIED',
    );
    expect(toDataAdapterError(pg('PGRST301', 'JWT expired'), { status: 401 }).code).toBe('AUTH_REQUIRED');
    expect(toDataAdapterError(pg('PGRST303', 'JWT claims validation failed')).code).toBe('AUTH_REQUIRED');
  });

  it('네트워크: fetch 실패(code 빈 값·status 0), TypeError, 게이트웨이 오류 → NETWORK_ERROR', () => {
    // supabase-js가 fetch 실패를 돌려주는 모양
    expect(toDataAdapterError(pg('', 'TypeError: Failed to fetch', 'TypeError: Failed to fetch\n  at ...'), { status: 0 }).code).toBe(
      'NETWORK_ERROR',
    );
    expect(toDataAdapterError(pg('', 'FetchError: request failed')).code).toBe('NETWORK_ERROR');
    expect(toDataAdapterError(new TypeError('Failed to fetch')).code).toBe('NETWORK_ERROR');
    expect(toDataAdapterError(new DOMException('aborted', 'AbortError')).code).toBe('NETWORK_ERROR');
    expect(toDataAdapterError(pg('', 'Service Unavailable'), { status: 503 }).code).toBe('NETWORK_ERROR');
    expect(toDataAdapterError(pg('', 'origin error'), { status: 522 }).code).toBe('NETWORK_ERROR');
  });

  it('PostgrestError 인스턴스(throwOnError)도 같은 규칙', () => {
    const error = new PostgrestError({ message: 'NICKNAME_TAKEN', details: '', hint: '', code: 'P0001' });
    expect(toDataAdapterError(error).code).toBe('NICKNAME_TAKEN');
  });

  it('Auth 오류: 재시도 가능한 fetch 오류 → NETWORK_ERROR, 세션 없음·PKCE 실패·4xx → AUTH_REQUIRED, 429 → RATE_LIMITED', () => {
    expect(toDataAdapterError(new AuthRetryableFetchError('Failed to fetch', 0)).code).toBe('NETWORK_ERROR');
    expect(toDataAdapterError(new AuthSessionMissingError()).code).toBe('AUTH_REQUIRED');
    expect(toDataAdapterError(new AuthPKCECodeVerifierMissingError()).code).toBe('AUTH_REQUIRED');
    expect(toDataAdapterError(new AuthApiError('invalid grant', 400, 'bad_code_verifier'))).toMatchObject({
      code: 'AUTH_REQUIRED',
      detail: 'bad_code_verifier',
    });
    expect(toDataAdapterError(new AuthApiError('too many', 429, 'over_request_rate_limit'))).toMatchObject({
      code: 'RATE_LIMITED',
      detail: 'auth',
    });
    expect(toDataAdapterError(new AuthApiError('server', 500, undefined)).code).toBe('UNKNOWN');
  });

  it('그 밖의 오류는 UNKNOWN. 원본 메시지·details(개인정보 가능)는 남기지 않는다', () => {
    const error = toDataAdapterError(
      pg('23505', 'duplicate key value violates unique constraint', 'Key (email)=(someone@example.com) already exists.'),
      { status: 409 },
    );
    expect(error.code).toBe('UNKNOWN');
    expect(error.detail).toBeUndefined();
    expect(error.message).toContain('code=23505');
    expect(error.message).not.toContain('example.com');
    expect(error.message).not.toContain('duplicate key');
    expect(error.cause).toBeUndefined();
    expect(toDataAdapterError('문자열 오류').code).toBe('UNKNOWN');
    expect(toDataAdapterError(null).code).toBe('UNKNOWN');
  });

  it('이미 DataAdapterError면 그대로', () => {
    const original = new DataAdapterError('MEETING_FULL');
    expect(toDataAdapterError(original)).toBe(original);
  });
});
