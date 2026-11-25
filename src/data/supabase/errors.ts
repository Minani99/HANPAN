/**
 * Supabase(PostgREST·Auth·네트워크) 오류 → DataAdapterError.
 *
 * | 원인 | 결과 |
 * |---|---|
 * | RPC가 던진 오류: SQLSTATE `P0001` + message=코드 | 그 코드(ERROR_CODES에 없으면 UNKNOWN). details → detail |
 * | 권한 없음: SQLSTATE `42501` | PERMISSION_DENIED |
 * | PostgREST JWT 오류(PGRST301·302·303 — 만료·위조 토큰) | AUTH_REQUIRED |
 * | fetch 실패(TypeError, status 0), 시간 초과·중단, 게이트웨이 오류(502·503·504·520~527) | NETWORK_ERROR |
 * | Auth: 재시도 가능한 fetch 오류 | NETWORK_ERROR |
 * | Auth: 세션 없음·PKCE 코드 교환 실패·4xx | AUTH_REQUIRED (429는 RATE_LIMITED/auth) |
 * | 그 외 | UNKNOWN |
 *
 * 개인정보 보호: 원본 오류 객체(cause)나 메시지·details를 그대로 보관하지 않는다.
 * details는 우리 RPC가 던진 P0001일 때만(필드 이름·사유 코드) detail로 옮긴다 —
 * 다른 오류의 details에는 입력값(예: unique 위반 키 값)이 들어 있을 수 있다.
 * `미확인:` PGRST3xx 코드와 HTTP 상태는 PostgREST 문서 기준이며 실제 Supabase 응답으로 확인하지 않았다.
 */
import { isAuthError, isAuthRetryableFetchError } from '@supabase/supabase-js';
import { DataAdapterError, isDataAdapterError } from '../adapter';
import { ERROR_CODES, type ErrorCode } from '../types';

/** 서버(RPC)가 직접 던질 수 있는 코드. 클라이언트 분류용 코드는 서버 메시지로 받아들이지 않는다 */
const CLIENT_ONLY_CODES: ReadonlySet<ErrorCode> = new Set(['PERMISSION_DENIED', 'SERVICE_UNCONFIGURED', 'NETWORK_ERROR']);
const SERVER_CODES: ReadonlySet<string> = new Set(ERROR_CODES.filter((code) => !CLIENT_ONLY_CODES.has(code)));

const JWT_ERROR_CODES: ReadonlySet<string> = new Set(['PGRST301', 'PGRST302', 'PGRST303']);
const NETWORK_ERROR_NAMES: ReadonlySet<string> = new Set(['TypeError', 'AbortError', 'TimeoutError', 'FetchError']);

/** detail은 필드 이름·사유 코드 형식만 허용한다(긴 문장·입력값이 섞이지 않게) */
const DETAIL_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

interface PostgrestErrorShape {
  code?: unknown;
  message?: unknown;
  details?: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isGatewayStatus(status: number | undefined): boolean {
  return status === 502 || status === 503 || status === 504 || (status !== undefined && status >= 520 && status <= 527);
}

function safeDetail(value: unknown): string | undefined {
  return typeof value === 'string' && DETAIL_PATTERN.test(value) ? value : undefined;
}

function make(code: ErrorCode, source: string, extra: { detail?: string; sqlState?: string; status?: number } = {}) {
  const parts = [`source=${source}`];
  if (extra.sqlState) parts.push(`code=${extra.sqlState}`);
  if (extra.status !== undefined) parts.push(`status=${extra.status}`);
  return new DataAdapterError(code, {
    ...(extra.detail !== undefined ? { detail: extra.detail } : {}),
    // 개발자용 요약만 남긴다(원본 메시지·details·토큰 없음)
    message: `${code}${extra.detail ? `: ${extra.detail}` : ''} (${parts.join(', ')})`,
  });
}

function fromAuthError(error: { status?: number; code?: unknown; name?: string }): DataAdapterError {
  const status = typeof error.status === 'number' ? error.status : undefined;
  const authCode = typeof error.code === 'string' ? error.code : undefined;
  if (isAuthRetryableFetchError(error) || status === 0) return make('NETWORK_ERROR', 'auth', { status });
  if (status === 429) return make('RATE_LIMITED', 'auth', { detail: 'auth', status });
  if (isGatewayStatus(status)) return make('NETWORK_ERROR', 'auth', { status });
  if (
    error.name === 'AuthSessionMissingError' ||
    error.name === 'AuthPKCEGrantCodeExchangeError' ||
    error.name === 'AuthPKCECodeVerifierMissingError' ||
    error.name === 'AuthInvalidTokenResponseError' ||
    (status !== undefined && status >= 400 && status < 500)
  ) {
    return make('AUTH_REQUIRED', 'auth', { ...(authCode && DETAIL_PATTERN.test(authCode) ? { detail: authCode } : {}), status });
  }
  return make('UNKNOWN', 'auth', { status });
}

function fromPostgrestError(error: PostgrestErrorShape, status: number | undefined): DataAdapterError {
  const sqlState = typeof error.code === 'string' ? error.code : '';
  const message = typeof error.message === 'string' ? error.message : '';

  if (sqlState === 'P0001') {
    const code = SERVER_CODES.has(message) ? (message as ErrorCode) : 'UNKNOWN';
    const detail = code === 'UNKNOWN' ? undefined : safeDetail(error.details);
    return make(code, 'rpc', { sqlState, status, ...(detail !== undefined ? { detail } : {}) });
  }
  if (sqlState === '42501') return make('PERMISSION_DENIED', 'postgrest', { sqlState, status });
  if (JWT_ERROR_CODES.has(sqlState)) return make('AUTH_REQUIRED', 'postgrest', { sqlState, status });
  // supabase-js는 fetch 실패를 code '' + status 0 + 'TypeError: …' 같은 메시지로 돌려준다
  if (status === 0 || (sqlState === '' && /^(TypeError|FetchError|AbortError|TimeoutError)\b/.test(message))) {
    return make('NETWORK_ERROR', 'postgrest', { status });
  }
  if (isGatewayStatus(status)) return make('NETWORK_ERROR', 'postgrest', { sqlState, status });
  return make('UNKNOWN', 'postgrest', { ...(sqlState ? { sqlState } : {}), status });
}

/**
 * 어떤 오류든 DataAdapterError로. 이미 DataAdapterError면 그대로 돌려준다.
 * status: supabase-js 결과의 HTTP 상태(있으면)
 */
export function toDataAdapterError(error: unknown, context: { status?: number } = {}): DataAdapterError {
  if (isDataAdapterError(error)) return error;
  if (isAuthError(error)) return fromAuthError(error);
  // TypeError(fetch 실패), AbortError·TimeoutError(DOMException — 환경에 따라 Error를 상속하지 않는다)
  if (isObject(error) && typeof error.name === 'string' && NETWORK_ERROR_NAMES.has(error.name)) {
    return make('NETWORK_ERROR', 'fetch');
  }
  if (isObject(error) && ('code' in error || 'message' in error)) {
    return fromPostgrestError(error, context.status);
  }
  return make('UNKNOWN', 'unknown', { status: context.status });
}

/* ------------------------------------------------------------------ */
/* 관리자 테이블 직접 쓰기(venues·categories) 오류                        */
/* ------------------------------------------------------------------ */

/** 입력값 문제로 보는 SQLSTATE: check·not null·FK 위반, 잘못된 enum/형식, 문자열 길이 */
const TABLE_VALIDATION_STATES: ReadonlySet<string> = new Set(['23514', '23502', '23503', '22P02', '22001', '22007', '22008']);

/** check 제약 이름 → 입력 필드(snake_case, 폼이 detail로 필드를 찾는다) */
const CONSTRAINT_FIELDS: Readonly<Record<string, string>> = {
  venues_name_length: 'name',
  venues_address_length: 'address',
  venues_website_url_format: 'website_url',
  venues_booking_url_format: 'booking_url',
  venues_description_length: 'description',
  categories_name_length: 'name',
  categories_description_length: 'description',
};

/**
 * venues·categories 직접 쓰기 실패 → DataAdapterError.
 * - 제약 위반·형식 오류 → VALIDATION_FAILED. detail은 오류 메시지의 제약/컬럼 '이름'에서만 뽑는다
 *   (details에는 입력 행 값이 들어 있으므로 쓰지 않는다).
 * - 권한 오류(42501: RLS with check 거부 등) → NOT_ADMIN(관리자 전용 기능이므로)
 * - 그 밖은 toDataAdapterError와 같다.
 */
export function toTableWriteError(error: unknown, context: { status?: number } = {}): DataAdapterError {
  if (isObject(error) && typeof error.code === 'string' && TABLE_VALIDATION_STATES.has(error.code)) {
    const message = typeof error.message === 'string' ? error.message : '';
    const constraint = /constraint "([a-z0-9_]+)"/.exec(message)?.[1];
    const column = /column "([a-z0-9_]+)"/.exec(message)?.[1];
    const fromConstraint = constraint ? CONSTRAINT_FIELDS[constraint] : undefined;
    const fromColumn = error.code === '23503' ? 'region_code' : column;
    const detail = fromConstraint ?? (fromColumn && DETAIL_PATTERN.test(fromColumn) ? fromColumn : undefined);
    return make('VALIDATION_FAILED', 'table', {
      sqlState: error.code,
      ...(context.status !== undefined ? { status: context.status } : {}),
      ...(detail ? { detail } : {}),
    });
  }
  const mapped = toDataAdapterError(error, context);
  if (mapped.code === 'PERMISSION_DENIED') return make('NOT_ADMIN', 'table', { sqlState: '42501', status: context.status });
  return mapped;
}
