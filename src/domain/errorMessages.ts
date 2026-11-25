import { getErrorCode, isDataAdapterError } from '../data/adapter';
import type { ErrorCode } from '../data/types';

/**
 * 오류 코드별 사용자 문구 (docs/UI_SPEC.md §6).
 * 원본 오류 메시지는 화면에 노출하지 않는다. 문구는 해요체, 짧고 사실만.
 */
export const ERROR_MESSAGES: Readonly<Record<ErrorCode, string>> = {
  AUTH_REQUIRED: '로그인이 필요해요.',
  ACCOUNT_RESTRICTED: '이용이 제한된 계정이에요.',
  ACCOUNT_DELETION_REQUESTED: '탈퇴 요청된 계정이에요.',
  PROFILE_INCOMPLETE: '닉네임 설정과 약관 동의를 먼저 해 주세요.',
  VALIDATION_FAILED: '입력한 내용을 다시 확인해 주세요.',
  HOLDEM_AGREEMENT_REQUIRED: '비금전 모임 안내에 동의해 주세요.',
  NOT_FOUND: '모임을 찾을 수 없어요.',
  NOT_HOST: '이 작업을 할 권한이 없어요.',
  NOT_ADMIN: '이 작업을 할 권한이 없어요.',
  PERMISSION_DENIED: '이 작업을 할 권한이 없어요.',
  OWN_MEETING: '내가 연 모임에는 신청할 수 없어요.',
  MEETING_NOT_OPEN: '모집이 마감된 모임이에요.',
  MEETING_CANCELLED: '취소된 모임이에요.',
  MEETING_STARTED: '이미 시작한 모임이에요.',
  MEETING_FULL: '자리가 모두 찼어요.',
  ALREADY_APPLIED: '이미 신청한 모임이에요.',
  APPLICATION_REJECTED: '이 모임에는 다시 신청할 수 없어요.',
  NOT_APPLIED: '취소할 신청이 없어요.',
  INVALID_STATE: '지금 상태에서는 할 수 없는 작업이에요. 새로고침해 주세요.',
  CAPACITY_BELOW_CONFIRMED: '확정 인원보다 적게 정원을 줄일 수 없어요.',
  ATTENDANCE_WINDOW_CLOSED: '출석 체크는 모임 시작 후부터 종료 7일 뒤까지 할 수 있어요.',
  NICKNAME_TAKEN: '이미 쓰고 있는 닉네임이에요.',
  CANNOT_REPORT_SELF: '나 자신이나 내 모임은 신고할 수 없어요.',
  DUPLICATE_REPORT: '이미 접수된 신고가 처리 중이에요.',
  RATE_LIMITED: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.',
  SERVICE_UNCONFIGURED: '서비스 연결 설정이 아직 완료되지 않았어요.',
  NETWORK_ERROR: '연결이 불안정해요. 잠시 후 다시 시도해 주세요.',
  UNKNOWN: '문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
};

/** RATE_LIMITED의 detail별 문구 */
export const RATE_LIMIT_MESSAGES: Readonly<Record<string, string>> = {
  create_24h: '24시간 동안 모임은 5개까지 만들 수 있어요.',
  open_meetings: '진행 예정인 모임은 10개까지 열 수 있어요.',
  report_24h: '신고는 하루 10건까지 할 수 있어요.',
};

/** 오류 → 사용자 문구. 알 수 없는 오류는 UNKNOWN 문구 */
export function getErrorMessage(error: unknown): string {
  const code = getErrorCode(error);
  if (code === 'RATE_LIMITED' && isDataAdapterError(error) && error.detail) {
    return RATE_LIMIT_MESSAGES[error.detail] ?? ERROR_MESSAGES.RATE_LIMITED;
  }
  return ERROR_MESSAGES[code];
}

/**
 * 예상하지 못한 오류(오류 경계에서 잡힌 오류)의 설명 문구. 데이터 계층 오류면 코드별 문구,
 * 그 밖(렌더 오류·청크 로딩 실패 등)은 일반 안내. 원본 메시지·스택은 화면에 쓰지 않는다.
 */
export function getUnexpectedErrorDescription(error: unknown): string {
  if (isDataAdapterError(error) && error.code !== 'UNKNOWN') return getErrorMessage(error);
  return '잠시 후 다시 시도해 주세요. 문제가 계속되면 페이지를 새로고침해 주세요.';
}
