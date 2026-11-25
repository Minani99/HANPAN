import type {
  AdminCategory,
  AdminMeeting,
  AdminMeetingQuery,
  AdminReport,
  AdminReportQuery,
  AdminSettableAccountStatus,
  AdminUser,
  AttendanceStatus,
  Category,
  DataMode,
  DevAccount,
  ErrorCode,
  Meeting,
  MeetingFilters,
  MeetingInput,
  MyMeetings,
  MyParticipation,
  MyProfile,
  OAuthProvider,
  PageRequest,
  PageResult,
  Participant,
  ParticipantDecision,
  ParticipantStatus,
  ProfileUpdate,
  Region,
  ReportInput,
  ReportStatus,
  SessionUser,
  Venue,
  VenueFilters,
  VenueInput,
} from './types';

/**
 * 인증 계약. `DataAdapter.auth`로 노출한다.
 * Supabase 구현은 supabase-js Auth(PKCE)로, mock 구현은 개발용 테스트 계정으로 동작한다.
 */
export interface AuthAdapter {
  /** 현재 세션 사용자. 없으면 null */
  getSessionUser(): Promise<SessionUser | null>;

  /**
   * 로그인·로그아웃(다른 탭 포함) 시 호출된다. 반환값은 구독 해제 함수.
   * 프로필 수정은 이벤트를 보내지 않는다 — 화면이 AuthProvider.refresh()를 호출한다.
   */
  onAuthStateChange(callback: (user: SessionUser | null) => void): () => void;

  /**
   * OAuth 로그인 시작. returnTo(검증된 내부 경로)를 보관한 뒤 공급자 화면으로 이동한다.
   * redirectTo는 `{origin}/auth/callback` 고정.
   */
  signInWithOAuth(provider: OAuthProvider, returnTo: string): Promise<void>;

  /** `/auth/callback`에서 세션을 확정하고, 보관했던 returnTo(없으면 '/')를 돌려준다. 실패 시 throw */
  completeOAuthCallback(): Promise<{ returnTo: string }>;

  signOut(): Promise<void>;

  /** mock 전용(프로덕션 어댑터에는 없음): 개발용 테스트 계정 목록 */
  listDevAccounts?(): Promise<DevAccount[]>;
  /** mock 전용: 테스트 계정으로 로그인 */
  signInAsDev?(accountId: string): Promise<SessionUser>;
  /** mock 전용: 개발 데이터(모임·신청·세션)를 처음 상태로 되돌린다 */
  resetDevData?(): Promise<void>;
}

/**
 * 화면이 의존하는 데이터 접근 계약.
 * 구현체: mock(개발 전용), supabase(Phase 2 예정), unconfigured(설정 없음 → 빈 데이터).
 *
 * 확장 규칙: 새 기능은 메서드를 추가하고 세 구현체(mock/unconfigured/supabase) 모두에 구현한다.
 * 실패는 DataAdapterError를 throw 하고, 화면은 코드별 문구(src/domain/errorMessages.ts)와 재시도를 제공한다.
 * 쓰기 메서드의 규칙·오류 코드는 docs/DB_SCHEMA.md §9(RPC 명세)를 따른다.
 */
export interface DataAdapter {
  readonly mode: DataMode;
  readonly auth: AuthAdapter;

  /**
   * 탐색 목록.
   * 숨김·취소·이미 시작한(startAt <= now) 모임은 제외한다.
   * 정렬 기본값은 soonest(startAt 오름차순), newest는 createdAt 내림차순.
   */
  listMeetings(filters: MeetingFilters, page: PageRequest): Promise<PageResult<Meeting>>;

  /**
   * 모임 하나. 없거나 볼 수 없으면 null (취소/종료된 모임도 반환한다).
   * 숨김 모임은 모임장·관리자에게만 반환하고 `isHidden: true`를 채운다.
   */
  getMeeting(id: string): Promise<Meeting | null>;

  /** 정렬 순서대로 */
  listCategories(): Promise<Category[]>;

  /** 정렬 순서대로 */
  listRegions(): Promise<Region[]>;

  /** 이 모임에 대한 내 신청. 비로그인이거나 신청한 적 없으면 null (모임장이면 role='host' 행) */
  getMyParticipation(meetingId: string): Promise<MyParticipation | null>;

  /** 참가 신청(apply_to_meeting). 결정된 상태(confirmed/pending/waitlisted)를 돌려준다. message ≤ 200자 */
  applyToMeeting(meetingId: string, message?: string | null): Promise<ParticipantStatus>;

  /** 내 신청 취소(cancel_my_application). 대기자 자동 승격 없음 */
  cancelMyApplication(meetingId: string): Promise<void>;

  /** 모임 생성(create_meeting). 새 모임 id */
  createMeeting(input: MeetingInput): Promise<string>;

  /** 모임 수정(update_meeting). 전체 필드 */
  updateMeeting(id: string, input: MeetingInput): Promise<void>;

  /** 모임 취소(cancel_meeting). reason ≤ 200자 */
  cancelMeeting(id: string, reason?: string | null): Promise<void>;

  /** 모집 마감/재개(set_meeting_recruiting) */
  setMeetingRecruiting(id: string, open: boolean): Promise<void>;

  /** 내가 연 모임 + 신청한 모임 (로그인 필요) */
  listMyMeetings(): Promise<MyMeetings>;

  /** 참가자 목록 (모임장·관리자만). 모임장 행 포함 */
  listParticipants(meetingId: string): Promise<Participant[]>;

  /** 승인/거절(decide_participant). 결정된 상태 */
  decideParticipant(participantId: string, decision: ParticipantDecision): Promise<ParticipantStatus>;

  /** 출석 체크(mark_attendance). 시작 후 ~ 종료 7일 */
  markAttendance(participantId: string, attendance: AttendanceStatus): Promise<void>;

  /** 내 프로필. 비로그인이면 null */
  getMyProfile(): Promise<MyProfile | null>;

  /** 프로필 수정·최초 설정(update_my_profile) */
  updateMyProfile(patch: ProfileUpdate): Promise<void>;

  /** 탈퇴 요청(request_account_deletion). 멱등 */
  requestAccountDeletion(): Promise<void>;

  /* ---------------------------------------------------------------- */
  /* 공간 (공개 조회)                                                    */
  /* ---------------------------------------------------------------- */

  /** 공개 공간 목록(list_public_venues). 관리자도 공개 공간만 받는다. 권역 정렬 → 이름 순 */
  listVenues(filters: VenueFilters): Promise<Venue[]>;

  /** 공개 공간 하나(get_venue). 없거나 비공개면 null */
  getVenue(id: string): Promise<Venue | null>;

  /* ---------------------------------------------------------------- */
  /* 신고                                                               */
  /* ---------------------------------------------------------------- */

  /**
   * 신고 접수(submit_report). 접수된 신고 id.
   * 오류: CANNOT_REPORT_SELF(본인·본인 모임), DUPLICATE_REPORT(같은 대상 미처리 신고), RATE_LIMITED(report_24h),
   * NOT_FOUND(대상 없음·숨김), VALIDATION_FAILED(body — 기타 사유 본문 누락·1000자 초과)
   */
  submitReport(input: ReportInput): Promise<string>;

  /* ---------------------------------------------------------------- */
  /* 관리자 — 서버(RPC의 is_admin()·RLS)가 권한의 경계다.                 */
  /* 관리자가 아니면 NOT_ADMIN(mock·supabase 공통). 화면의 관리자 확인은 사용성용이다. */
  /* ---------------------------------------------------------------- */

  /** 신고 목록(admin_list_report_items). 최신순 */
  adminListReports(query: AdminReportQuery, page: PageRequest): Promise<PageResult<AdminReport>>;

  /** 신고 상태·관리자 메모 저장(admin_update_report). 메모는 매번 덮어쓴다(≤1000자). audit 기록 */
  adminUpdateReport(reportId: string, status: ReportStatus, adminNote: string | null): Promise<void>;

  /** 모임 목록(admin_list_meetings). 숨김·취소·종료 포함, 최근 등록순 */
  adminListMeetings(query: AdminMeetingQuery, page: PageRequest): Promise<PageResult<AdminMeeting>>;

  /** 모임 숨김/해제(admin_set_meeting_hidden). 숨길 때 사유 필수(≤200자). audit 기록 */
  adminSetMeetingHidden(meetingId: string, hidden: boolean, reason: string | null): Promise<void>;

  /** 관리자 모임 취소(cancel_meeting — 관리자는 종료 전까지 허용). audit 기록(by_admin) */
  adminCancelMeeting(meetingId: string, reason: string | null): Promise<void>;

  /** 사용자 검색(admin_search_users). 닉네임 부분 일치 또는 id 정확 일치, 빈 검색어면 최근 가입순 */
  adminSearchUsers(query: string): Promise<AdminUser[]>;

  /** 계정 상태 변경(admin_set_user_status). 본인·탈퇴 요청 계정은 VALIDATION_FAILED. 메모 ≤200자. audit 기록 */
  adminSetUserStatus(userId: string, status: AdminSettableAccountStatus, note: string | null): Promise<void>;

  /** 공간 목록(admin_list_venues). 비공개 포함 */
  adminListVenues(): Promise<Venue[]>;

  /**
   * 공간 등록(id null) 또는 수정(venues 테이블 직접 쓰기, RLS is_admin). 저장된 공간 id.
   * created_by·created_at·updated_at은 DB 트리거가 정한다. audit은 트리거(admin.venue_create|update)
   */
  adminSaveVenue(id: string | null, input: VenueInput): Promise<string>;

  /** 공개/비공개 전환(삭제 대신). audit은 트리거 */
  adminSetVenuePublic(id: string, isPublic: boolean): Promise<void>;

  /** 카테고리 목록(admin_list_categories). 비활성 포함 */
  adminListCategories(): Promise<AdminCategory[]>;

  /** 카테고리 활성/비활성(categories 테이블 직접 쓰기, RLS is_admin). 삭제 대신 비활성. audit은 트리거 */
  adminSetCategoryActive(id: string, isActive: boolean): Promise<void>;
}

/** 관리자 목록 한 번에 불러오는 개수 */
export const ADMIN_PAGE_SIZE = 20;

/** 탐색 목록 한 번에 불러오는 개수 */
export const MEETING_PAGE_SIZE = 20;

/** 한 번에 요청할 수 있는 최대 개수 (과도한 조회 방지) */
export const MAX_PAGE_SIZE = 50;

/** @deprecated ErrorCode를 사용한다 */
export type DataAdapterErrorCode = ErrorCode;

export interface DataAdapterErrorOptions {
  /** 세부 사유. VALIDATION_FAILED면 필드 이름(예: 'title', 'start_at'), RATE_LIMITED면 'create_24h' 등 */
  detail?: string;
  /** 개발자용 메시지(화면에 그대로 노출하지 않는다). 기본값은 code */
  message?: string;
  cause?: unknown;
}

/**
 * 어댑터가 던지는 유일한 오류 형식.
 * 화면은 message가 아니라 code(+detail)로 사용자 문구를 고른다(src/domain/errorMessages.ts).
 */
export class DataAdapterError extends Error {
  readonly code: ErrorCode;
  readonly detail?: string;

  constructor(code: ErrorCode, options: DataAdapterErrorOptions = {}) {
    super(options.message ?? (options.detail ? `${code}: ${options.detail}` : code), { cause: options.cause });
    this.name = 'DataAdapterError';
    this.code = code;
    if (options.detail !== undefined) this.detail = options.detail;
  }
}

export function isDataAdapterError(error: unknown): error is DataAdapterError {
  return error instanceof DataAdapterError;
}

/** 어떤 오류든 ErrorCode로 분류한다. 어댑터 밖의 오류(TypeError 등)는 UNKNOWN */
export function getErrorCode(error: unknown): ErrorCode {
  return isDataAdapterError(error) ? error.code : 'UNKNOWN';
}

/** 페이지 요청 값을 안전한 범위로 보정 */
export function normalizePageRequest(page: PageRequest): PageRequest {
  const limit = Number.isFinite(page.limit) ? Math.trunc(page.limit) : MEETING_PAGE_SIZE;
  const offset = Number.isFinite(page.offset) ? Math.trunc(page.offset) : 0;
  return {
    limit: Math.min(Math.max(limit, 1), MAX_PAGE_SIZE),
    offset: Math.max(offset, 0),
  };
}
