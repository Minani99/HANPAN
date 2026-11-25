/**
 * HANPAN 도메인 타입.
 * 이 파일의 이름·필드는 다른 작업자와 공유하는 계약이다. 필드를 추가할 수는 있지만 이름을 바꾸지 않는다.
 */

export type CategoryId =
  | 'party'
  | 'deduction'
  | 'strategy'
  | 'murder_mystery'
  | 'mahjong_etc'
  | 'holdem_social';

export type RegionCode =
  | 'dunsan_tanbang'
  | 'gung_bongmyeong'
  | 'eunhaeng_daeheung'
  | 'noeun_jijok'
  | 'gwanjeo_gasuwon'
  | 'etc_daejeon';

/** 초보 환영 / 누구나 / 경험자 우대 */
export type SkillLevel = 'beginner_welcome' | 'anyone' | 'experienced';

/** auto: 신청 즉시 확정, manual: 모임장 승인 후 확정 */
export type ApprovalMode = 'auto' | 'manual';

/** closed = 모임장이 수동으로 모집을 마감한 상태 */
export type MeetingStatus = 'open' | 'closed' | 'cancelled';

export interface Category {
  id: CategoryId;
  /** 화면 표시명 */
  name: string;
  sortOrder: number;
}

export interface Region {
  code: RegionCode;
  /** 화면 표시명 */
  name: string;
  sortOrder: number;
}

export interface Meeting {
  id: string;
  /** 모임장 계정이 삭제되면(탈퇴 처리 완료) null. 화면에는 '탈퇴한 사용자' */
  hostId: string | null;
  /** null이면 '탈퇴한 사용자'(hostDisplayName). 탈퇴 요청 중인 모임장은 DB가 '탈퇴한 사용자'로 바꿔 준다 */
  hostNickname: string | null;
  categoryId: CategoryId;
  /**
   * 관리자가 등록한 게임(games)에 연결된 모임이면 그 id. gameName에는 게임 이름이 채워져 온다.
   * (선택 필드: mock 예시 데이터에는 없다) 수정 때 게임명을 바꾸지 않으면 이 연결을 유지한다.
   */
  gameId?: string | null;
  gameName: string | null;
  title: string;
  description: string;
  notice: string | null;
  /** ISO 8601, UTC */
  startAt: string;
  /** ISO 8601, UTC */
  endAt: string;
  durationMinutes: number;
  regionCode: RegionCode;
  venueId: string | null;
  /** null이면 '장소 미정' */
  venueName: string | null;
  venueNote: string | null;
  minParticipants: number;
  /** 모임장을 포함한 전체 정원 */
  maxParticipants: number;
  /** 모임장을 포함한 확정 인원 */
  confirmedCount: number;
  pendingCount: number;
  waitlistCount: number;
  skillLevel: SkillLevel;
  approvalMode: ApprovalMode;
  allowWaitlist: boolean;
  status: MeetingStatus;
  cancelReason: string | null;
  imageUrl: string | null;
  /** ISO 8601, UTC */
  createdAt: string;
  /**
   * 운영자가 숨긴 모임인지. 숨긴 모임은 모임장·관리자에게만 조회되므로 그 외에는 항상 false/생략.
   * (선택 필드: 목록 응답에는 없어도 된다)
   */
  isHidden?: boolean;
  hiddenReason?: string | null;
}

export type MeetingSort = 'soonest' | 'newest';

export interface MeetingFilters {
  /** YYYY-MM-DD, KST 기준 */
  date?: string;
  category?: CategoryId;
  region?: RegionCode;
  q?: string;
  /** true면 지금 신청 가능한(phase=open) 모임만 */
  recruiting?: boolean;
  /** 기본값 soonest */
  sort?: MeetingSort;
  /**
   * 이 공간에서 열리는 모임만(공간 상세 화면용). 탐색 URL 쿼리에는 쓰지 않는다(src/lib/filters.ts).
   */
  venueId?: string;
}

export interface PageRequest {
  limit: number;
  offset: number;
}

export interface PageResult<T> {
  items: T[];
  total: number;
}

export type DataMode = 'mock' | 'supabase' | 'unconfigured';

/* ------------------------------------------------------------------ */
/* 참가·프로필·인증 (Phase 1 후반에 추가. Supabase 어댑터도 같은 이름을 쓴다) */
/* ------------------------------------------------------------------ */

/** restricted: 운영자가 이용 제한, deletion_requested: 본인이 탈퇴 요청 */
export type AccountStatus = 'active' | 'restricted' | 'deletion_requested';

/** 참가 상태. 전이 규칙은 docs/DB_SCHEMA.md §6 */
export type ParticipantStatus =
  | 'pending'
  | 'confirmed'
  | 'waitlisted'
  | 'rejected'
  | 'cancelled'
  | 'meeting_cancelled';

export type ParticipantRole = 'host' | 'guest';

export type AttendanceStatus = 'unknown' | 'attended' | 'absent';

/** 내 참가 신청 한 건 (본인에게만 보인다) */
export interface MyParticipation {
  id: string;
  meetingId: string;
  role: ParticipantRole;
  status: ParticipantStatus;
  attendance: AttendanceStatus;
  /** 신청할 때 모임장에게 남긴 말 */
  message: string | null;
  /** ISO 8601, UTC */
  appliedAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
}

/** 참가자 관리 화면의 한 행 (모임장·관리자만 조회) */
export interface Participant extends MyParticipation {
  userId: string;
  /** 탈퇴 요청한 사용자는 '탈퇴한 사용자' */
  nickname: string;
}

/** 내 프로필. 이메일·실명은 포함하지 않는다. */
export interface MyProfile {
  id: string;
  nickname: string;
  regionCode: RegionCode | null;
  bio: string;
  favoriteCategoryIds: CategoryId[];
  status: AccountStatus;
  /** null이면 최초 설정(약관 동의) 전 */
  termsAgreedAt: string | null;
  privacyAgreedAt: string | null;
  isAdmin: boolean;
}

/** 화면이 알고 있는 로그인 사용자 요약 */
export interface SessionUser {
  id: string;
  nickname: string;
  /** 닉네임 설정·약관 동의(최초 설정)를 마쳤는지 */
  onboarded: boolean;
  status: AccountStatus;
  isAdmin: boolean;
}

/** 모임 생성·수정 입력 (수정도 전체 필드를 보낸다 — 부분 수정 아님) */
export interface MeetingInput {
  categoryId: CategoryId;
  /**
   * 등록된 게임 연결을 유지할 때만 채운다(수정 화면에서 게임명을 바꾸지 않은 경우). 이때 gameName은 null이어야 한다 —
   * 서버는 game_id와 game_name을 동시에 받지 않는다(VALIDATION_FAILED, detail 'game').
   */
  gameId?: string | null;
  gameName: string | null;
  title: string;
  description: string;
  notice: string | null;
  /** ISO 8601 (UTC 또는 오프셋 포함) */
  startAt: string;
  durationMinutes: number;
  regionCode: RegionCode;
  venueId: string | null;
  venueNote: string | null;
  /** 모임장 포함 */
  minParticipants: number;
  /** 모임장 포함 전체 정원 */
  maxParticipants: number;
  skillLevel: SkillLevel;
  approvalMode: ApprovalMode;
  allowWaitlist: boolean;
  /** 홀덤(비금전) 카테고리일 때 필수 동의 */
  holdemPolicyAgreed: boolean;
}

export interface MyJoinedMeeting {
  /** 숨김 처리 등으로 모임을 읽을 수 없으면 null */
  meeting: Meeting | null;
  participation: MyParticipation;
}

export interface MyMeetings {
  /** 내가 연 모임 (숨김 포함) */
  hosted: Meeting[];
  /** 게스트로 신청한 모임 (모든 상태) */
  joined: MyJoinedMeeting[];
}

/** 프로필 부분 수정. 최초 설정 전에는 nickname + agreeTerms + agreePrivacy가 모두 필요하다. */
export interface ProfileUpdate {
  nickname?: string;
  regionCode?: RegionCode | null;
  bio?: string;
  favoriteCategoryIds?: CategoryId[];
  agreeTerms?: boolean;
  agreePrivacy?: boolean;
}

export type OAuthProvider = 'google' | 'kakao';

/* ------------------------------------------------------------------ */
/* 공간·신고·관리자 (Phase 4)                                            */
/* ------------------------------------------------------------------ */

export type VenueType = 'board_game_cafe' | 'party_room' | 'other';

/**
 * 공간 정보(관리자가 공식 출처를 확인해 등록). 실시간 영업 상태·좌석·가격·예약 가능 시간은 다루지 않는다.
 * websiteUrl·bookingUrl은 DB check로 https://만 저장되고, 화면은 렌더링 전에 다시 확인한다(src/lib/externalUrl.ts).
 */
export interface Venue {
  id: string;
  name: string;
  regionCode: RegionCode;
  address: string;
  venueType: VenueType;
  websiteUrl: string | null;
  bookingUrl: string | null;
  description: string;
  /** 공개 화면에는 true인 공간만 나온다. false는 관리자 화면에서만 보인다 */
  isPublic: boolean;
  /** 공식 출처로 정보를 확인한 시각(ISO 8601, UTC). 없으면 null */
  infoVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VenueFilters {
  region?: RegionCode;
  type?: VenueType;
}

/** 관리자 공간 등록·수정 입력(전체 필드) */
export interface VenueInput {
  name: string;
  regionCode: RegionCode;
  address: string;
  venueType: VenueType;
  websiteUrl: string | null;
  bookingUrl: string | null;
  description: string;
  isPublic: boolean;
  /** ISO 8601(오프셋 포함). 없으면 null */
  infoVerifiedAt: string | null;
}

export type ReportTargetType = 'meeting' | 'user';

export type ReportReason = 'spam' | 'inappropriate' | 'gambling' | 'harassment' | 'no_show' | 'commercial' | 'other';

export type ReportStatus = 'received' | 'reviewing' | 'resolved' | 'dismissed';

export interface ReportInput {
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  /** 상세 내용(1000자 이하). reason이 other면 필수 */
  body: string | null;
}

/** 관리자 신고 목록의 한 건. 신고자에게는 보이지 않는 adminNote를 포함한다(관리자 전용) */
export interface AdminReport {
  id: string;
  targetType: ReportTargetType;
  /** 대상이 삭제됐으면 null */
  targetId: string | null;
  /** 모임 제목 또는 사용자 닉네임. 대상이 삭제됐으면 null */
  targetLabel: string | null;
  /** 대상 모임이 숨김 상태인지(모임 신고만) */
  targetHidden: boolean | null;
  reason: ReportReason;
  body: string;
  status: ReportStatus;
  adminNote: string | null;
  reporterId: string | null;
  reporterNickname: string | null;
  handledAt: string | null;
  createdAt: string;
}

export interface AdminReportQuery {
  status?: ReportStatus;
}

/** 관리자 모임 목록의 한 건(숨김·취소·종료 포함) */
export interface AdminMeeting extends Meeting {
  isHidden: boolean;
  hiddenReason: string | null;
}

export interface AdminMeetingQuery {
  /** 제목·게임명 부분 일치 */
  q?: string;
  hiddenOnly?: boolean;
}

/** 관리자 사용자 검색 결과. 이메일·실명은 없다 */
export interface AdminUser {
  id: string;
  nickname: string;
  status: AccountStatus;
  createdAt: string;
  /** 최근 30일 이 사용자를 대상으로 한 신고 수 */
  recentReportCount: number;
}

/** 관리자가 바꿀 수 있는 계정 상태(탈퇴 요청은 본인만) */
export type AdminSettableAccountStatus = Extract<AccountStatus, 'active' | 'restricted'>;

/** 관리자 카테고리 목록(비활성 포함). DB에만 있는 새 카테고리도 보이도록 id는 string */
export interface AdminCategory {
  id: string;
  name: string;
  description: string;
  sortOrder: number;
  isActive: boolean;
}

export type ParticipantDecision = 'approve' | 'reject';

/** mock 전용: 로그인 화면의 개발용 테스트 계정 */
export interface DevAccount {
  id: string;
  nickname: string;
  /** 계정 용도 설명 (예: '일반 사용자 · 주최 중인 예시 모임 있음') */
  description: string;
  onboarded: boolean;
  isAdmin: boolean;
  status: AccountStatus;
}

/**
 * 어댑터 오류 코드. DB RPC가 던지는 코드(docs/DB_SCHEMA.md §10) + 클라이언트 분류용 코드.
 * - SERVICE_UNCONFIGURED: 데이터 연결 설정 전(unconfigured 모드)
 * - PERMISSION_DENIED: Postgres 권한 오류(42501) 등 RLS/GRANT 거부
 * - NETWORK_ERROR: 요청이 서버에 닿지 못함
 */
export const ERROR_CODES = [
  'AUTH_REQUIRED',
  'ACCOUNT_RESTRICTED',
  'ACCOUNT_DELETION_REQUESTED',
  'PROFILE_INCOMPLETE',
  'VALIDATION_FAILED',
  'HOLDEM_AGREEMENT_REQUIRED',
  'NOT_FOUND',
  'NOT_HOST',
  'NOT_ADMIN',
  'OWN_MEETING',
  'MEETING_NOT_OPEN',
  'MEETING_CANCELLED',
  'MEETING_STARTED',
  'MEETING_FULL',
  'ALREADY_APPLIED',
  'APPLICATION_REJECTED',
  'NOT_APPLIED',
  'INVALID_STATE',
  'CAPACITY_BELOW_CONFIRMED',
  'ATTENDANCE_WINDOW_CLOSED',
  'NICKNAME_TAKEN',
  'CANNOT_REPORT_SELF',
  'DUPLICATE_REPORT',
  'RATE_LIMITED',
  'PERMISSION_DENIED',
  'SERVICE_UNCONFIGURED',
  'NETWORK_ERROR',
  'UNKNOWN',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
