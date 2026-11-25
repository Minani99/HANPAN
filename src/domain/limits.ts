/**
 * 서버(DB RPC, docs/DB_SCHEMA.md §2·§9·§11)와 같은 입력 한도.
 * 클라이언트 Zod 스키마와 개발용 mock 규칙이 함께 쓴다. 값을 바꿀 때는 DB_SCHEMA를 먼저 고친다.
 */

export const MEETING_LIMITS = {
  titleMin: 2,
  titleMax: 60,
  descriptionMax: 2000,
  noticeMax: 1000,
  gameNameMax: 40,
  venueNoteMax: 60,
  durationMin: 30,
  durationMax: 720,
  /** 소요 시간 선택 단위(분) */
  durationStep: 30,
  /** 모임장 포함 */
  participantsMin: 2,
  participantsMax: 30,
  /** 시작 시각은 지금부터 30분 뒤 이후 */
  startLeadMinutes: 30,
  /** 시작 시각은 지금부터 90일 이내 */
  startMaxDays: 90,
  applyMessageMax: 200,
  cancelReasonMax: 200,
  /** 관리자 숨김 사유(admin_set_meeting_hidden) */
  hiddenReasonMax: 200,
} as const;

/** 관리자 입력 한도 (DB §9.15) */
export const ADMIN_LIMITS = {
  /** 신고 관리자 메모(admin_update_report) */
  adminNoteMax: 1000,
  /** 계정 상태 변경 메모(admin_set_user_status → audit meta.note) */
  userStatusNoteMax: 200,
} as const;

export const PROFILE_LIMITS = {
  nicknameMin: 2,
  nicknameMax: 20,
  bioMax: 200,
  favoriteCategoriesMax: 6,
} as const;

export const RATE_LIMITS = {
  /** 롤링 24시간 동안 만들 수 있는 모임 수(취소 포함) */
  meetingsPer24h: 5,
  /** 동시에 열어 둘 수 있는 진행 예정 모임 수(open·closed + 시작 전) */
  openMeetings: 10,
} as const;

/** 출석 체크 가능 기간: 시작 ~ 종료 후 7일 */
export const ATTENDANCE_WINDOW_DAYS = 7;

/** 닉네임: 한글·영문·숫자·밑줄·하이픈 2~20자 (DB §9.12) */
export const NICKNAME_PATTERN = /^[가-힣A-Za-z0-9_-]{2,20}$/;

/**
 * 운영자·서비스로 오인될 수 있는 닉네임 규칙 (DB `_is_reserved_nickname`과 같은 규칙,
 * supabase/migrations/20261124000800_nickname_rules_v2.sql — 마이그레이션 5에 '운영진'을 더한 규칙).
 * 공백·밑줄(_)·하이픈(-)을 지우고 소문자로 바꾼 값으로 비교한다.
 * - 포함 금지: 아래 단어가 어디에든 들어가면 금지 (예: '관리자김', 'superAdmin')
 * - 완전 일치 금지: 값 전체가 같을 때만 금지 (예: '한판'은 금지, '한판승부'는 허용)
 */
export const RESERVED_NICKNAME_SUBSTRINGS = ['관리자', '운영자', '운영진', '운영팀', 'admin', 'hanpan'] as const;
export const RESERVED_NICKNAME_EXACT = ['한판', '탈퇴한사용자'] as const;

export const DELETED_USER_NICKNAME = '탈퇴한 사용자';

/** 예약어 비교용 정규화: 소문자 + 공백·_·- 제거 */
export function normalizeNicknameForReservedCheck(nickname: string): string {
  return nickname.toLowerCase().replace(/[\s_-]/g, '');
}

export function isReservedNickname(nickname: string): boolean {
  const normalized = normalizeNicknameForReservedCheck(nickname);
  return (
    RESERVED_NICKNAME_SUBSTRINGS.some((word) => normalized.includes(word)) ||
    (RESERVED_NICKNAME_EXACT as readonly string[]).includes(normalized)
  );
}

/** Postgres char_length와 같은 기준(코드 포인트 수)으로 글자 수를 센다. */
export function charLength(value: string): number {
  return Array.from(value).length;
}
