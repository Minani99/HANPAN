/**
 * 브라우저에 넣으면 안 되는 Supabase 키(service_role / secret)를 거르는 가드.
 *
 * - 의존성이 없는 순수 함수만 둔다. 브라우저(src/data/supabase/client.ts)와 빌드 설정(vite.config.ts)이 함께 쓴다.
 * - 키 값은 어떤 메시지·로그에도 넣지 않는다(이름·사유만).
 *
 * 판단 기준
 * 1) 공개(VITE_) 환경 변수 이름에 SERVICE_ROLE이 들어 있으면 거부 — 이름만 봐도 실수가 분명하다.
 * 2) 키가 JWT이고 payload의 role이 `service_role`이면 거부 — 기존 형식의 service_role 키.
 * 3) 키가 `sb_secret_`로 시작하면 거부 — 새 형식의 secret 키.
 */

export type UnsafeSupabaseConfigReason = 'service_role_env' | 'service_role_jwt' | 'secret_key';

export type PublicSupabaseConfigCheck =
  | { ok: true }
  | { ok: false; reason: UnsafeSupabaseConfigReason; envNames: string[] };

const SERVICE_ROLE_NAME = /SERVICE[_-]?ROLE/i;
const SECRET_KEY_PREFIX = /^sb_secret_/i;

/** JWT(header.payload.signature)의 payload를 객체로 읽는다. JWT가 아니거나 읽을 수 없으면 null(서명은 검증하지 않음) */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.trim().split('.');
  if (parts.length !== 3) return null;
  const payload = parts[1] ?? '';
  if (!/^[A-Za-z0-9_-]+$/.test(payload)) return null;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const parsed: unknown = JSON.parse(atob(padded));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** 이름에 SERVICE_ROLE(SERVICE-ROLE, SERVICEROLE 포함)이 들어간 환경 변수 */
export function findServiceRoleEnvNames(names: Iterable<string>): string[] {
  return [...names].filter((name) => SERVICE_ROLE_NAME.test(name));
}

/** 키 자체가 비밀 키로 보이면 사유를, 공개 키로 보이면 null */
export function inspectSupabaseKey(key: string): Exclude<UnsafeSupabaseConfigReason, 'service_role_env'> | null {
  const trimmed = key.trim();
  if (SECRET_KEY_PREFIX.test(trimmed)) return 'secret_key';
  const payload = decodeJwtPayload(trimmed);
  if (payload && payload.role === 'service_role') return 'service_role_jwt';
  return null;
}

export function checkPublicSupabaseConfig(input: {
  anonKey: string;
  /** 브라우저에 노출되는(VITE_) 환경 변수 이름 목록 */
  envNames?: Iterable<string>;
}): PublicSupabaseConfigCheck {
  const envNames = findServiceRoleEnvNames(input.envNames ?? []);
  if (envNames.length > 0) return { ok: false, reason: 'service_role_env', envNames };
  const keyReason = inspectSupabaseKey(input.anonKey);
  if (keyReason) return { ok: false, reason: keyReason, envNames: [] };
  return { ok: true };
}

/** 사람이 읽을 안내 문구(키 값은 넣지 않는다) */
export function describeUnsafeSupabaseConfig(check: Extract<PublicSupabaseConfigCheck, { ok: false }>): string {
  switch (check.reason) {
    case 'service_role_env':
      return `[HANPAN] 공개 환경 변수에 service_role 키로 보이는 이름이 있습니다(${check.envNames.join(', ')}). 브라우저 번들에 들어가므로 즉시 지우고 키를 재발급하세요. Supabase 연결을 사용하지 않습니다.`;
    case 'service_role_jwt':
      return '[HANPAN] VITE_SUPABASE_ANON_KEY가 service_role 키로 보입니다(JWT role=service_role). anon(publishable) 키만 쓰세요. 노출됐다면 키를 재발급하세요. Supabase 연결을 사용하지 않습니다.';
    case 'secret_key':
      return '[HANPAN] VITE_SUPABASE_ANON_KEY가 secret 키(sb_secret_)로 보입니다. publishable 키만 쓰세요. 노출됐다면 키를 재발급하세요. Supabase 연결을 사용하지 않습니다.';
  }
}
