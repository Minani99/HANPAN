import { getErrorCode, isDataAdapterError } from '../data/adapter';
import type { ReportReason, ReportStatus, ReportTargetType } from '../data/types';
import { getErrorMessage } from './errorMessages';
import { charLength } from './limits';

/**
 * 신고 사유·상태·한도 (DB enum report_reason·report_status, submit_report §9.14).
 * 신고는 운영자가 직접 검토한다 — 신고만으로 자동 제재하지 않는다(docs/OPERATIONS.md §3).
 */

export const REPORT_LIMITS = {
  /** 상세 내용 최대 글자 수 */
  bodyMax: 1000,
  /** 롤링 24시간 신고 수 */
  per24h: 10,
} as const;

export const REPORT_REASONS: readonly ReportReason[] = [
  'spam',
  'inappropriate',
  'gambling',
  'harassment',
  'no_show',
  'commercial',
  'other',
];

export const REPORT_REASON_LABEL: Readonly<Record<ReportReason, string>> = {
  spam: '스팸·광고',
  inappropriate: '부적절한 내용',
  gambling: '금전성 도박(홀덤 등)',
  harassment: '괴롭힘·불쾌한 행동',
  no_show: '노쇼',
  commercial: '상업적 권유',
  other: '기타',
};

export const REPORT_STATUSES: readonly ReportStatus[] = ['received', 'reviewing', 'resolved', 'dismissed'];

export const REPORT_STATUS_LABEL: Readonly<Record<ReportStatus, string>> = {
  received: '접수',
  reviewing: '검토 중',
  resolved: '처리 완료',
  dismissed: '기각',
};

export const REPORT_TARGET_LABEL: Readonly<Record<ReportTargetType, string>> = {
  meeting: '모임',
  user: '사용자',
};

export function isReportReason(value: unknown): value is ReportReason {
  return typeof value === 'string' && (REPORT_REASONS as readonly string[]).includes(value);
}

export function isReportStatus(value: unknown): value is ReportStatus {
  return typeof value === 'string' && (REPORT_STATUSES as readonly string[]).includes(value);
}

export const REPORT_FIELD_MESSAGES = {
  reason: '신고 사유를 골라 주세요.',
  bodyRequired: '기타 사유를 고르면 상세 내용을 적어 주세요.',
  bodyTooLong: `상세 내용은 ${REPORT_LIMITS.bodyMax}자까지 쓸 수 있어요.`,
} as const;

export interface ReportFormValues {
  reason: ReportReason | '';
  body: string;
}

export type ReportFormErrors = Partial<Record<keyof ReportFormValues, string>>;

export type ReportFormResult =
  | { ok: true; reason: ReportReason; body: string | null }
  | { ok: false; errors: ReportFormErrors };

/** 신고 폼 검증(서버 submit_report와 같은 규칙): 사유 필수, 본문 ≤1000자(앞뒤 공백 제거), 기타면 본문 필수 */
export function validateReportForm(values: ReportFormValues): ReportFormResult {
  const errors: ReportFormErrors = {};
  const body = values.body.trim();
  if (!isReportReason(values.reason)) errors.reason = REPORT_FIELD_MESSAGES.reason;
  if (charLength(body) > REPORT_LIMITS.bodyMax) errors.body = REPORT_FIELD_MESSAGES.bodyTooLong;
  else if (values.reason === 'other' && body === '') errors.body = REPORT_FIELD_MESSAGES.bodyRequired;
  if (!isReportReason(values.reason) || errors.body) return { ok: false, errors };
  return { ok: true, reason: values.reason, body: body === '' ? null : body };
}

/** 신고 접수 오류 → 사용자 문구(신고 대상 맥락에 맞게) */
export function getReportErrorMessage(error: unknown): string {
  switch (getErrorCode(error)) {
    case 'DUPLICATE_REPORT':
      return '이미 접수된 신고가 있어요. 운영자가 검토하고 있어요.';
    case 'CANNOT_REPORT_SELF':
      return '나 자신이나 내가 연 모임은 신고할 수 없어요.';
    case 'RATE_LIMITED':
      return `신고는 하루 ${REPORT_LIMITS.per24h}건까지 할 수 있어요. 급한 위험 상황이면 112·119에 먼저 연락해 주세요.`;
    case 'NOT_FOUND':
      return '신고할 대상을 찾을 수 없어요. 삭제되었거나 비공개 처리됐을 수 있어요.';
    case 'VALIDATION_FAILED':
      if (isDataAdapterError(error) && error.detail === 'body') return REPORT_FIELD_MESSAGES.bodyRequired;
      return '입력한 내용을 다시 확인해 주세요.';
    case 'PROFILE_INCOMPLETE':
      return '닉네임 설정과 약관 동의를 마친 뒤 신고할 수 있어요.';
    default:
      return getErrorMessage(error);
  }
}
