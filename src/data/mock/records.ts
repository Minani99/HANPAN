/**
 * mock 저장소의 레코드 형태 (개발 전용).
 * DB 테이블(meetings, meeting_participants, profiles + user_private + admin_roles, venues, reports, categories)을
 * 단순화해 흉내 낸다.
 * 이 파일은 mock 어댑터와 함께 동적 import 된다. 정적 import 금지.
 */
import type {
  AccountStatus,
  AttendanceStatus,
  CategoryId,
  Meeting,
  ParticipantRole,
  ParticipantStatus,
  RegionCode,
  ReportReason,
  ReportStatus,
  ReportTargetType,
  Venue,
} from '../types';

/** 공개 Meeting 타입에 없는 운영 필드(숨김·취소 시각)를 mock에서만 흉내 낸다. */
export interface MockMeetingRecord extends Meeting {
  hidden?: boolean;
  hiddenReason?: string | null;
  cancelledAt?: string | null;
}

export interface MockParticipantRecord {
  id: string;
  meetingId: string;
  userId: string;
  role: ParticipantRole;
  status: ParticipantStatus;
  attendance: AttendanceStatus;
  message: string | null;
  appliedAt: string;
  decidedAt: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  attendanceMarkedAt: string | null;
}

export interface MockProfileRecord {
  id: string;
  nickname: string;
  regionCode: RegionCode | null;
  bio: string;
  favoriteCategoryIds: CategoryId[];
  status: AccountStatus;
  termsAgreedAt: string | null;
  privacyAgreedAt: string | null;
  deletionRequestedAt: string | null;
  isAdmin: boolean;
  createdAt: string;
  /** 로그인 화면의 개발용 테스트 계정이면 설명이 있다 */
  devAccountDescription?: string;
}

/** venues 테이블 흉내. created_by는 관리자 화면에도 내보내지 않는다 */
export interface MockVenueRecord extends Venue {
  createdBy: string | null;
}

/** reports 테이블 흉내. adminNote·handledBy는 관리자에게만 */
export interface MockReportRecord {
  id: string;
  reporterId: string | null;
  targetType: ReportTargetType;
  targetMeetingId: string | null;
  targetUserId: string | null;
  reason: ReportReason;
  body: string;
  status: ReportStatus;
  adminNote: string | null;
  handledBy: string | null;
  handledAt: string | null;
  createdAt: string;
}

/** categories 테이블 흉내(활성 여부만 바뀐다) */
export interface MockCategoryRecord {
  id: CategoryId;
  name: string;
  description: string;
  sortOrder: number;
  isActive: boolean;
}

export interface MockDb {
  meetings: MockMeetingRecord[];
  participants: MockParticipantRecord[];
  profiles: MockProfileRecord[];
  venues: MockVenueRecord[];
  reports: MockReportRecord[];
  categories: MockCategoryRecord[];
  /** 새 id 발급용 일련번호 */
  seq: number;
}

/** 레코드는 JSON 직렬화 가능한 값만 가진다. 깊은 복사로 호출자와 저장소를 분리한다. */
export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
