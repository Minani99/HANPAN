/**
 * 개발용 mock의 비즈니스 규칙 (docs/DB_SCHEMA.md §4~§11의 RPC 규칙을 흉내 낸다).
 *
 * - 모든 함수는 입력 db를 바꾸지 않는다. 쓰기 함수는 복사본을 고쳐 `{ db, value }`로 돌려주고,
 *   규칙 위반은 DataAdapterError(code, detail)를 던진다. 현재 시각은 인자로 받는다(테스트 가능).
 * - mock은 보안 경계가 아니다. 규칙의 정답은 DB(RPC·RLS)와 DB 테스트다.
 * - 이 파일은 mock 어댑터와 함께 개발/e2e 모드에서만 동적 import 된다. 정적 import 금지.
 */
import { isCategoryId } from '../../domain/categories';
import {
  ADMIN_LIMITS,
  DELETED_USER_NICKNAME,
  MEETING_LIMITS,
  NICKNAME_PATTERN,
  PROFILE_LIMITS,
  RATE_LIMITS,
  charLength,
  isReservedNickname,
} from '../../domain/limits';
import { isAttendanceWindowOpen } from '../../domain/participation';
import { isRegionCode } from '../../domain/regions';
import { REPORT_LIMITS, REPORT_REASONS, REPORT_STATUSES } from '../../domain/reports';
import { VENUE_LIMITS, VENUE_TYPES } from '../../domain/venues';
import { normalizeQuery } from '../../lib/filters';
import { safeExternalUrl } from '../../lib/externalUrl';
import { DataAdapterError, normalizePageRequest } from '../adapter';
import type {
  AdminCategory,
  AdminMeeting,
  AdminMeetingQuery,
  AdminReport,
  AdminReportQuery,
  AdminSettableAccountStatus,
  AdminUser,
  ApprovalMode,
  AttendanceStatus,
  CategoryId,
  ErrorCode,
  Meeting,
  MeetingInput,
  MyMeetings,
  MyParticipation,
  MyProfile,
  Participant,
  ParticipantDecision,
  ParticipantStatus,
  PageRequest,
  PageResult,
  ProfileUpdate,
  ReportInput,
  ReportStatus,
  SessionUser,
  SkillLevel,
  Venue,
  VenueFilters,
  VenueInput,
} from '../types';
import { toPublicMeeting, type PublicMeetingOptions } from './query';
import {
  cloneJson,
  type MockDb,
  type MockMeetingRecord,
  type MockParticipantRecord,
  type MockProfileRecord,
  type MockReportRecord,
  type MockVenueRecord,
} from './records';

export interface RuleResult<T> {
  db: MockDb;
  value: T;
}

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const ACTIVE_STATUSES: readonly ParticipantStatus[] = ['pending', 'confirmed', 'waitlisted'];
const SKILL_LEVELS: readonly SkillLevel[] = ['beginner_welcome', 'anyone', 'experienced'];
const APPROVAL_MODES: readonly ApprovalMode[] = ['auto', 'manual'];
const ATTENDANCE_VALUES: readonly AttendanceStatus[] = ['unknown', 'attended', 'absent'];

export const MEETING_DELETED_HOST_REASON = '모임장 탈퇴';

function fail(code: ErrorCode, detail?: string): never {
  throw new DataAdapterError(code, detail === undefined ? {} : { detail });
}

function isActive(status: ParticipantStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

function iso(now: Date): string {
  return now.toISOString();
}

function nextId(db: MockDb, prefix: string): string {
  const id = `${prefix}-${String(db.seq).padStart(4, '0')}`;
  db.seq += 1;
  return id;
}

/* ------------------------------------------------------------------ */
/* 조회 보조                                                            */
/* ------------------------------------------------------------------ */

function findProfile(db: MockDb, userId: string | null): MockProfileRecord | undefined {
  return userId ? db.profiles.find((profile) => profile.id === userId) : undefined;
}

function findMeeting(db: MockDb, meetingId: string): MockMeetingRecord | undefined {
  return db.meetings.find((meeting) => meeting.id === meetingId);
}

export function isOnboarded(profile: Pick<MockProfileRecord, 'termsAgreedAt'>): boolean {
  return profile.termsAgreedAt !== null;
}

/**
 * DB의 is_admin()과 같은 규칙(마이그레이션 9): 관리자 역할(`isAdmin` = admin_roles 행)이 있고 계정이 active일 때만 관리자 권한.
 * 이용 제한·탈퇴 요청 상태인 관리자는 관리자 메서드(NOT_ADMIN)·숨김 모임·비공개 공간 이름·세션의 isAdmin을 모두 잃는다.
 */
export function hasAdminPower(profile: Pick<MockProfileRecord, 'isAdmin' | 'status'> | undefined | null): boolean {
  return Boolean(profile?.isAdmin && profile.status === 'active');
}

/** RLS: 숨김 모임은 모임장·관리자만 읽는다 */
function canSeeMeeting(meeting: MockMeetingRecord, viewer: MockProfileRecord | undefined): boolean {
  if (!meeting.hidden) return true;
  return Boolean(viewer && (viewer.id === meeting.hostId || hasAdminPower(viewer)));
}

/** 9.0 공통: 로그인 + 탈퇴 요청 계정 거부 */
function requireActor(db: MockDb, actorId: string | null): MockProfileRecord {
  const actor = findProfile(db, actorId);
  if (!actor) fail('AUTH_REQUIRED');
  if (actor.status === 'deletion_requested') fail('ACCOUNT_DELETION_REQUESTED');
  return actor;
}

function rejectRestricted(actor: MockProfileRecord): void {
  if (actor.status === 'restricted') fail('ACCOUNT_RESTRICTED');
}

function requireOnboarded(actor: MockProfileRecord): void {
  if (!isOnboarded(actor)) fail('PROFILE_INCOMPLETE');
}

function hasStarted(meeting: Pick<MockMeetingRecord, 'startAt'>, now: Date): boolean {
  return Date.parse(meeting.startAt) <= now.getTime();
}

/** §4: 카운트 = 실제 행 집계 (모임장 포함) */
function recount(db: MockDb, meetingId: string): void {
  const meeting = findMeeting(db, meetingId);
  if (!meeting) return;
  const rows = db.participants.filter((row) => row.meetingId === meetingId);
  meeting.confirmedCount = rows.filter((row) => row.status === 'confirmed').length;
  meeting.pendingCount = rows.filter((row) => row.status === 'pending').length;
  meeting.waitlistCount = rows.filter((row) => row.status === 'waitlisted').length;
}

export function toMyParticipation(row: MockParticipantRecord): MyParticipation {
  return {
    id: row.id,
    meetingId: row.meetingId,
    role: row.role,
    status: row.status,
    attendance: row.attendance,
    message: row.message,
    appliedAt: row.appliedAt,
    confirmedAt: row.confirmedAt,
    cancelledAt: row.cancelledAt,
  };
}

export function toSessionUser(profile: MockProfileRecord): SessionUser {
  return {
    id: profile.id,
    nickname: profile.nickname,
    onboarded: isOnboarded(profile),
    status: profile.status,
    isAdmin: hasAdminPower(profile),
  };
}

/* ------------------------------------------------------------------ */
/* 읽기                                                                 */
/* ------------------------------------------------------------------ */

/** 공개 응답 변환 옵션: 공간 이름은 공간 테이블 기준(RLS와 같이 비공개 공간은 관리자에게만 이름이 보인다) */
export function meetingViewOptions(db: MockDb, viewer: MockProfileRecord | undefined): PublicMeetingOptions {
  return { includeHidden: true, venues: db.venues, viewerIsAdmin: hasAdminPower(viewer) };
}

export function viewMeeting(db: MockDb, viewerId: string | null, meetingId: string): Meeting | null {
  const meeting = findMeeting(db, meetingId);
  if (!meeting) return null;
  const viewer = findProfile(db, viewerId);
  if (!canSeeMeeting(meeting, viewer)) return null;
  return toPublicMeeting(meeting, meetingViewOptions(db, viewer));
}

export function viewMyParticipation(db: MockDb, viewerId: string | null, meetingId: string): MyParticipation | null {
  if (!viewerId) return null;
  const row = db.participants.find((item) => item.meetingId === meetingId && item.userId === viewerId);
  return row ? toMyParticipation(row) : null;
}

export function viewMyMeetings(db: MockDb, viewerId: string | null): MyMeetings {
  const viewer = findProfile(db, viewerId);
  if (!viewer) fail('AUTH_REQUIRED');
  const hosted = db.meetings
    .filter((meeting) => meeting.hostId === viewer.id)
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
    .map((meeting) => toPublicMeeting(meeting, meetingViewOptions(db, viewer)));
  const joined = db.participants
    .filter((row) => row.userId === viewer.id && row.role === 'guest')
    .map((row) => {
      const meeting = findMeeting(db, row.meetingId);
      return {
        meeting:
          meeting && canSeeMeeting(meeting, viewer) ? toPublicMeeting(meeting, meetingViewOptions(db, viewer)) : null,
        participation: toMyParticipation(row),
      };
    });
  return { hosted, joined };
}

/** 참가자 목록: 모임장(맨 위) → 신청 시각 순. 모임장·관리자만 */
export function viewParticipants(db: MockDb, viewerId: string | null, meetingId: string): Participant[] {
  const viewer = findProfile(db, viewerId);
  if (!viewer) fail('AUTH_REQUIRED');
  const meeting = findMeeting(db, meetingId);
  if (!meeting || !canSeeMeeting(meeting, viewer)) fail('NOT_FOUND');
  if (meeting.hostId !== viewer.id && !hasAdminPower(viewer)) fail('NOT_HOST');
  return db.participants
    .filter((row) => row.meetingId === meetingId)
    .sort((a, b) => {
      if (a.role !== b.role) return a.role === 'host' ? -1 : 1;
      return Date.parse(a.appliedAt) - Date.parse(b.appliedAt) || a.id.localeCompare(b.id);
    })
    .map((row) => ({
      ...toMyParticipation(row),
      userId: row.userId,
      nickname: findProfile(db, row.userId)?.nickname ?? DELETED_USER_NICKNAME,
    }));
}

export function viewMyProfile(db: MockDb, viewerId: string | null): MyProfile | null {
  const profile = findProfile(db, viewerId);
  if (!profile) return null;
  return {
    id: profile.id,
    nickname: profile.nickname,
    regionCode: profile.regionCode,
    bio: profile.bio,
    favoriteCategoryIds: [...profile.favoriteCategoryIds],
    status: profile.status,
    termsAgreedAt: profile.termsAgreedAt,
    privacyAgreedAt: profile.privacyAgreedAt,
    isAdmin: hasAdminPower(profile),
  };
}

/* ------------------------------------------------------------------ */
/* 모임 입력 검증 (§9.4·§9.5)                                            */
/* ------------------------------------------------------------------ */

function optionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function isIntegerBetween(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/**
 * 입력을 정규화(앞뒤 공백 제거, 빈 문자열 → null)하고 범위를 검사한다.
 * 위반하면 VALIDATION_FAILED(detail = DB 필드 이름).
 * checkStart: 시작 시각 30분~90일 규칙을 적용할지(생성 또는 수정에서 시작 시각이 바뀐 경우)
 * current: 수정 중인 모임(활성·공개 검사는 값이 바뀐 경우에만 — DB _meeting_input과 같다)
 */
export function normalizeMeetingInput(
  db: MockDb,
  input: MeetingInput,
  now: Date,
  { checkStart, current }: { checkStart: boolean; current?: MockMeetingRecord },
): MeetingInput {
  const L = MEETING_LIMITS;
  if (!isCategoryId(input.categoryId)) fail('VALIDATION_FAILED', 'category_id');
  const category = db.categories.find((item) => item.id === input.categoryId);
  if (!category || (!category.isActive && current?.categoryId !== input.categoryId)) {
    fail('VALIDATION_FAILED', 'category_id');
  }

  // 게임 연결: mock에는 games 테이블이 없어, 이미 연결된 게임을 유지하는 경우만 허용한다.
  const gameId = optionalText(input.gameId);
  const gameName = optionalText(input.gameName);
  if (gameId !== null && gameName !== null) fail('VALIDATION_FAILED', 'game');
  if (gameId !== null && (!current || current.gameId !== gameId)) fail('VALIDATION_FAILED', 'game_id');
  if (gameName !== null && charLength(gameName) > L.gameNameMax) fail('VALIDATION_FAILED', 'game_name');

  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (charLength(title) < L.titleMin || charLength(title) > L.titleMax) fail('VALIDATION_FAILED', 'title');

  const description = typeof input.description === 'string' ? input.description.trim() : '';
  if (charLength(description) > L.descriptionMax) fail('VALIDATION_FAILED', 'description');

  const notice = optionalText(input.notice);
  if (notice !== null && charLength(notice) > L.noticeMax) fail('VALIDATION_FAILED', 'notice');

  const startMs = typeof input.startAt === 'string' ? Date.parse(input.startAt) : Number.NaN;
  if (Number.isNaN(startMs)) fail('VALIDATION_FAILED', 'start_at');
  if (checkStart) {
    const earliest = now.getTime() + L.startLeadMinutes * MINUTE_MS;
    const latest = now.getTime() + L.startMaxDays * DAY_MS;
    if (startMs < earliest || startMs > latest) fail('VALIDATION_FAILED', 'start_at');
  }

  if (!isIntegerBetween(input.durationMinutes, L.durationMin, L.durationMax)) {
    fail('VALIDATION_FAILED', 'duration_minutes');
  }
  if (!isRegionCode(input.regionCode)) fail('VALIDATION_FAILED', 'region_code');

  const venueId = optionalText(input.venueId);
  if (venueId !== null) {
    // DB와 같은 규칙: 없는 공간 거부, 새로 고르거나 바꾼 공간은 공개여야 함, 권역은 항상 일치
    const venue = db.venues.find((item) => item.id === venueId);
    const changed = !current || current.venueId !== venueId;
    if (!venue || (!venue.isPublic && changed) || venue.regionCode !== input.regionCode) {
      fail('VALIDATION_FAILED', 'venue_id');
    }
  }
  const venueNote = optionalText(input.venueNote);
  if (venueNote !== null && charLength(venueNote) > L.venueNoteMax) fail('VALIDATION_FAILED', 'venue_note');

  if (!isIntegerBetween(input.maxParticipants, L.participantsMin, L.participantsMax)) {
    fail('VALIDATION_FAILED', 'max_participants');
  }
  if (!isIntegerBetween(input.minParticipants, L.participantsMin, input.maxParticipants)) {
    fail('VALIDATION_FAILED', 'min_participants');
  }
  if (!SKILL_LEVELS.includes(input.skillLevel)) fail('VALIDATION_FAILED', 'skill_level');
  if (!APPROVAL_MODES.includes(input.approvalMode)) fail('VALIDATION_FAILED', 'approval_mode');
  if (typeof input.allowWaitlist !== 'boolean') fail('VALIDATION_FAILED', 'allow_waitlist');

  return {
    categoryId: input.categoryId,
    gameId,
    gameName,
    title,
    description,
    notice,
    startAt: new Date(startMs).toISOString(),
    durationMinutes: input.durationMinutes,
    regionCode: input.regionCode,
    venueId,
    venueNote,
    minParticipants: input.minParticipants,
    maxParticipants: input.maxParticipants,
    skillLevel: input.skillLevel,
    approvalMode: input.approvalMode,
    allowWaitlist: input.allowWaitlist,
    holdemPolicyAgreed: input.holdemPolicyAgreed === true,
  };
}

/** 레코드에 저장해 두는 공간 이름(응답 때는 공간 테이블 기준으로 다시 정한다 — query.ts) */
function venueNameFor(db: MockDb, venueId: string | null): string | null {
  if (!venueId) return null;
  return db.venues.find((venue) => venue.id === venueId)?.name ?? null;
}

const HOLDEM: CategoryId = 'holdem_social';

/* ------------------------------------------------------------------ */
/* 쓰기                                                                 */
/* ------------------------------------------------------------------ */

/** §9.4 create_meeting */
export function createMeeting(db: MockDb, actorId: string | null, input: MeetingInput, now: Date): RuleResult<string> {
  const next = cloneJson(db);
  const actor = requireActor(next, actorId);
  rejectRestricted(actor);
  requireOnboarded(actor);
  const value = normalizeMeetingInput(next, input, now, { checkStart: true });
  if (value.categoryId === HOLDEM && !value.holdemPolicyAgreed) fail('HOLDEM_AGREEMENT_REQUIRED', 'holdem_policy_agreed');

  const nowMs = now.getTime();
  const hosted = next.meetings.filter((meeting) => meeting.hostId === actor.id);
  const createdRecently = hosted.filter((meeting) => Date.parse(meeting.createdAt) > nowMs - DAY_MS).length;
  if (createdRecently >= RATE_LIMITS.meetingsPer24h) fail('RATE_LIMITED', 'create_24h');
  const openUpcoming = hosted.filter((meeting) => meeting.status !== 'cancelled' && Date.parse(meeting.startAt) > nowMs);
  if (openUpcoming.length >= RATE_LIMITS.openMeetings) fail('RATE_LIMITED', 'open_meetings');

  const id = nextId(next, 'mock-meeting');
  const createdAt = iso(now);
  next.meetings.push({
    id,
    hostId: actor.id,
    hostNickname: actor.nickname,
    categoryId: value.categoryId,
    gameId: null,
    gameName: value.gameName,
    title: value.title,
    description: value.description,
    notice: value.notice,
    startAt: value.startAt,
    endAt: new Date(Date.parse(value.startAt) + value.durationMinutes * MINUTE_MS).toISOString(),
    durationMinutes: value.durationMinutes,
    regionCode: value.regionCode,
    venueId: value.venueId,
    venueName: venueNameFor(next, value.venueId),
    venueNote: value.venueNote,
    minParticipants: value.minParticipants,
    maxParticipants: value.maxParticipants,
    confirmedCount: 1,
    pendingCount: 0,
    waitlistCount: 0,
    skillLevel: value.skillLevel,
    approvalMode: value.approvalMode,
    allowWaitlist: value.allowWaitlist,
    status: 'open',
    cancelReason: null,
    imageUrl: null,
    createdAt,
  });
  next.participants.push({
    id: nextId(next, 'mock-participant'),
    meetingId: id,
    userId: actor.id,
    role: 'host',
    status: 'confirmed',
    attendance: 'unknown',
    message: null,
    appliedAt: createdAt,
    decidedAt: null,
    confirmedAt: createdAt,
    cancelledAt: null,
    attendanceMarkedAt: null,
  });
  recount(next, id);
  return { db: next, value: id };
}

/** 모임장 전용 쓰기의 공통 검사: 없음/숨김 → NOT_FOUND, 모임장 아님 → NOT_HOST */
function requireHostedMeeting(db: MockDb, actor: MockProfileRecord, meetingId: string): MockMeetingRecord {
  const meeting = findMeeting(db, meetingId);
  if (!meeting || !canSeeMeeting(meeting, actor)) fail('NOT_FOUND');
  if (meeting.hostId !== actor.id) fail('NOT_HOST');
  return meeting;
}

/** §9.5 update_meeting: 시작 전·취소 전, 시작 시각이 바뀐 경우에만 30분~90일 규칙 */
export function updateMeeting(
  db: MockDb,
  actorId: string | null,
  meetingId: string,
  input: MeetingInput,
  now: Date,
): RuleResult<void> {
  const next = cloneJson(db);
  const actor = requireActor(next, actorId);
  const meeting = requireHostedMeeting(next, actor, meetingId);
  rejectRestricted(actor);
  if (meeting.status === 'cancelled') fail('MEETING_CANCELLED');
  if (hasStarted(meeting, now)) fail('MEETING_STARTED');

  const startChanged = Date.parse(input.startAt) !== Date.parse(meeting.startAt);
  const value = normalizeMeetingInput(next, input, now, { checkStart: startChanged, current: meeting });
  if (value.maxParticipants < meeting.confirmedCount) fail('CAPACITY_BELOW_CONFIRMED', 'max_participants');
  if (value.categoryId === HOLDEM && meeting.categoryId !== HOLDEM && !value.holdemPolicyAgreed) {
    fail('HOLDEM_AGREEMENT_REQUIRED', 'holdem_policy_agreed');
  }

  // 게임 연결을 유지하면 이름도 그대로(DB: meeting_to_json이 games.name을 채운다), 아니면 직접 입력 이름
  const keepGame = value.gameId !== null && value.gameId !== undefined;
  Object.assign(meeting, {
    categoryId: value.categoryId,
    gameId: keepGame ? value.gameId : null,
    gameName: keepGame ? meeting.gameName : value.gameName,
    title: value.title,
    description: value.description,
    notice: value.notice,
    startAt: value.startAt,
    endAt: new Date(Date.parse(value.startAt) + value.durationMinutes * MINUTE_MS).toISOString(),
    durationMinutes: value.durationMinutes,
    regionCode: value.regionCode,
    venueId: value.venueId,
    venueName: venueNameFor(next, value.venueId),
    venueNote: value.venueNote,
    minParticipants: value.minParticipants,
    maxParticipants: value.maxParticipants,
    skillLevel: value.skillLevel,
    // 승인 방식·정원을 바꿔도 기존 pending·waitlisted는 그대로 둔다(자동 확정 없음).
    approvalMode: value.approvalMode,
    allowWaitlist: value.allowWaitlist,
  } satisfies Partial<MockMeetingRecord>);
  return { db: next, value: undefined };
}

function cancelMeetingInPlace(db: MockDb, meeting: MockMeetingRecord, reason: string | null, now: Date): void {
  meeting.status = 'cancelled';
  meeting.cancelledAt = iso(now);
  meeting.cancelReason = reason;
  for (const row of db.participants) {
    if (row.meetingId === meeting.id && row.role === 'guest' && isActive(row.status)) {
      row.status = 'meeting_cancelled';
      row.cancelledAt = iso(now);
    }
  }
  recount(db, meeting.id);
}

/** §9.6 cancel_meeting: 모임장(시작 전) 또는 관리자(종료 전). restricted 모임장도 허용 */
export function cancelMeeting(
  db: MockDb,
  actorId: string | null,
  meetingId: string,
  reason: string | null | undefined,
  now: Date,
): RuleResult<void> {
  const next = cloneJson(db);
  const actor = requireActor(next, actorId);
  const meeting = findMeeting(next, meetingId);
  if (!meeting || !canSeeMeeting(meeting, actor)) fail('NOT_FOUND');
  const isHost = meeting.hostId === actor.id;
  const isAdmin = hasAdminPower(actor);
  if (!isHost && !isAdmin) fail('NOT_HOST');
  if (meeting.status === 'cancelled') fail('MEETING_CANCELLED');
  // DB와 같은 규칙: 관리자는 종료 전까지(종료 후 MEETING_STARTED/ended), 모임장은 시작 전까지
  if (isAdmin) {
    if (Date.parse(meeting.endAt) <= now.getTime()) fail('MEETING_STARTED', 'ended');
  } else if (hasStarted(meeting, now)) {
    fail('MEETING_STARTED');
  }
  const normalizedReason = optionalText(reason);
  if (normalizedReason !== null && charLength(normalizedReason) > MEETING_LIMITS.cancelReasonMax) {
    fail('VALIDATION_FAILED', 'reason');
  }
  cancelMeetingInPlace(next, meeting, normalizedReason, now);
  return { db: next, value: undefined };
}

/** §9.7 set_meeting_recruiting: open ↔ closed */
export function setMeetingRecruiting(
  db: MockDb,
  actorId: string | null,
  meetingId: string,
  open: boolean,
  now: Date,
): RuleResult<void> {
  const next = cloneJson(db);
  const actor = requireActor(next, actorId);
  const meeting = requireHostedMeeting(next, actor, meetingId);
  rejectRestricted(actor);
  if (meeting.status === 'cancelled') fail('MEETING_CANCELLED');
  if (hasStarted(meeting, now)) fail('MEETING_STARTED');
  meeting.status = open ? 'open' : 'closed';
  return { db: next, value: undefined };
}

/** §9.8 apply_to_meeting */
export function applyToMeeting(
  db: MockDb,
  actorId: string | null,
  meetingId: string,
  message: string | null | undefined,
  now: Date,
): RuleResult<ParticipantStatus> {
  const next = cloneJson(db);
  const actor = requireActor(next, actorId);
  rejectRestricted(actor);
  requireOnboarded(actor);
  const normalizedMessage = optionalText(message);
  if (normalizedMessage !== null && charLength(normalizedMessage) > MEETING_LIMITS.applyMessageMax) {
    fail('VALIDATION_FAILED', 'message');
  }

  const meeting = findMeeting(next, meetingId);
  if (!meeting || meeting.hidden) fail('NOT_FOUND');
  if (meeting.hostId === actor.id) fail('OWN_MEETING');
  if (meeting.status === 'cancelled') fail('MEETING_CANCELLED');
  if (meeting.status === 'closed') fail('MEETING_NOT_OPEN');
  // 모임장 계정이 삭제된 모임(hostId null)은 신청을 받지 않는다(DB와 같은 순서)
  if (meeting.hostId === null) fail('MEETING_NOT_OPEN', 'host_missing');
  if (hasStarted(meeting, now)) fail('MEETING_STARTED');

  const existing = next.participants.find((row) => row.meetingId === meetingId && row.userId === actor.id);
  if (existing && isActive(existing.status)) fail('ALREADY_APPLIED');
  if (existing && existing.status === 'rejected') fail('APPLICATION_REJECTED');
  if (existing && existing.status !== 'cancelled') fail('INVALID_STATE');

  const seats = meeting.maxParticipants - meeting.confirmedCount;
  let status: ParticipantStatus;
  if (seats > 0) status = meeting.approvalMode === 'auto' ? 'confirmed' : 'pending';
  else if (meeting.allowWaitlist) status = 'waitlisted';
  else fail('MEETING_FULL');

  const at = iso(now);
  const fields = {
    status,
    message: normalizedMessage,
    appliedAt: at,
    decidedAt: status === 'confirmed' ? at : null,
    confirmedAt: status === 'confirmed' ? at : null,
    cancelledAt: null,
    attendance: 'unknown' as const,
    attendanceMarkedAt: null,
  };
  if (existing) {
    // 본인이 취소했던 신청은 같은 행을 갱신해 다시 신청한다.
    Object.assign(existing, fields);
  } else {
    next.participants.push({
      id: nextId(next, 'mock-participant'),
      meetingId,
      userId: actor.id,
      role: 'guest',
      ...fields,
    });
  }
  recount(next, meetingId);
  return { db: next, value: status };
}

/** §9.9 cancel_my_application: 시작 전, 대기자 자동 승격 없음, restricted 허용 */
export function cancelMyApplication(
  db: MockDb,
  actorId: string | null,
  meetingId: string,
  now: Date,
): RuleResult<void> {
  const next = cloneJson(db);
  const actor = requireActor(next, actorId);
  const meeting = findMeeting(next, meetingId);
  if (!meeting) fail('NOT_FOUND');
  if (meeting.hostId === actor.id) fail('OWN_MEETING');
  const row = next.participants.find((item) => item.meetingId === meetingId && item.userId === actor.id);
  if (!row || !isActive(row.status)) fail('NOT_APPLIED');
  if (hasStarted(meeting, now)) fail('MEETING_STARTED');
  row.status = 'cancelled';
  row.cancelledAt = iso(now);
  recount(next, meetingId);
  return { db: next, value: undefined };
}

function requireHostedParticipant(
  db: MockDb,
  actor: MockProfileRecord,
  participantId: string,
): { row: MockParticipantRecord; meeting: MockMeetingRecord } {
  const row = db.participants.find((item) => item.id === participantId);
  if (!row) fail('NOT_FOUND');
  const meeting = requireHostedMeeting(db, actor, row.meetingId);
  return { row, meeting };
}

/** §9.10 decide_participant: pending/waitlisted 게스트만, 승인 시 자리 재검사 */
export function decideParticipant(
  db: MockDb,
  actorId: string | null,
  participantId: string,
  decision: ParticipantDecision,
  now: Date,
): RuleResult<ParticipantStatus> {
  if (decision !== 'approve' && decision !== 'reject') fail('VALIDATION_FAILED', 'decision');
  const next = cloneJson(db);
  const actor = requireActor(next, actorId);
  const { row, meeting } = requireHostedParticipant(next, actor, participantId);
  rejectRestricted(actor);
  if (meeting.status === 'cancelled') fail('MEETING_CANCELLED');
  if (hasStarted(meeting, now)) fail('MEETING_STARTED');
  if (row.role !== 'guest' || (row.status !== 'pending' && row.status !== 'waitlisted')) fail('INVALID_STATE');

  const at = iso(now);
  if (decision === 'approve') {
    if (meeting.confirmedCount >= meeting.maxParticipants) fail('MEETING_FULL');
    row.status = 'confirmed';
    row.decidedAt = at;
    row.confirmedAt = at;
  } else {
    row.status = 'rejected';
    row.decidedAt = at;
  }
  recount(next, meeting.id);
  return { db: next, value: row.status };
}

/** §9.11 mark_attendance: 확정 게스트만 */
export function markAttendance(
  db: MockDb,
  actorId: string | null,
  participantId: string,
  attendance: AttendanceStatus,
  now: Date,
): RuleResult<void> {
  if (!ATTENDANCE_VALUES.includes(attendance)) fail('VALIDATION_FAILED', 'attendance');
  const next = cloneJson(db);
  const actor = requireActor(next, actorId);
  const { row, meeting } = requireHostedParticipant(next, actor, participantId);
  rejectRestricted(actor);
  if (meeting.status === 'cancelled') fail('MEETING_CANCELLED');
  if (!isAttendanceWindowOpen(meeting, now)) fail('ATTENDANCE_WINDOW_CLOSED');
  if (row.role !== 'guest' || row.status !== 'confirmed') fail('INVALID_STATE');
  row.attendance = attendance;
  row.attendanceMarkedAt = iso(now);
  return { db: next, value: undefined };
}

/** 닉네임 형식·예약어 검사 (DB §9.12 update_my_profile·_is_reserved_nickname과 같은 규칙) */
export function isValidNickname(nickname: string): boolean {
  return NICKNAME_PATTERN.test(nickname) && !isReservedNickname(nickname);
}

/** §9.12 update_my_profile */
export function updateMyProfile(db: MockDb, actorId: string | null, patch: ProfileUpdate, now: Date): RuleResult<void> {
  const next = cloneJson(db);
  const actor = requireActor(next, actorId);
  rejectRestricted(actor);

  if (!isOnboarded(actor)) {
    const complete = patch.nickname !== undefined && patch.agreeTerms === true && patch.agreePrivacy === true;
    if (!complete) fail('PROFILE_INCOMPLETE');
  }

  let nickname = actor.nickname;
  if (patch.nickname !== undefined) {
    nickname = typeof patch.nickname === 'string' ? patch.nickname.trim() : '';
    if (!isValidNickname(nickname)) fail('VALIDATION_FAILED', 'nickname');
    const lower = nickname.toLowerCase();
    const taken = next.profiles.some(
      (profile) =>
        profile.id !== actor.id && profile.status !== 'deletion_requested' && profile.nickname.toLowerCase() === lower,
    );
    if (taken) fail('NICKNAME_TAKEN', 'nickname');
  }

  let regionCode = actor.regionCode;
  if (patch.regionCode !== undefined) {
    if (patch.regionCode !== null && !isRegionCode(patch.regionCode)) fail('VALIDATION_FAILED', 'region_code');
    regionCode = patch.regionCode;
  }

  let bio = actor.bio;
  if (patch.bio !== undefined) {
    bio = typeof patch.bio === 'string' ? patch.bio.trim() : '';
    if (charLength(bio) > PROFILE_LIMITS.bioMax) fail('VALIDATION_FAILED', 'bio');
  }

  let favoriteCategoryIds = actor.favoriteCategoryIds;
  if (patch.favoriteCategoryIds !== undefined) {
    if (!Array.isArray(patch.favoriteCategoryIds) || !patch.favoriteCategoryIds.every(isCategoryId)) {
      fail('VALIDATION_FAILED', 'favorite_category_ids');
    }
    favoriteCategoryIds = [...new Set(patch.favoriteCategoryIds)];
    if (favoriteCategoryIds.length > PROFILE_LIMITS.favoriteCategoriesMax) {
      fail('VALIDATION_FAILED', 'favorite_category_ids');
    }
  }

  const at = iso(now);
  Object.assign(actor, {
    nickname,
    regionCode,
    bio,
    favoriteCategoryIds,
    termsAgreedAt: actor.termsAgreedAt ?? (patch.agreeTerms === true ? at : null),
    privacyAgreedAt: actor.privacyAgreedAt ?? (patch.agreePrivacy === true ? at : null),
  } satisfies Partial<MockProfileRecord>);

  if (nickname !== db.profiles.find((profile) => profile.id === actor.id)?.nickname) {
    for (const meeting of next.meetings) if (meeting.hostId === actor.id) meeting.hostNickname = nickname;
  }
  return { db: next, value: undefined };
}

/**
 * §9.13 request_account_deletion (멱등)
 * 시작 전 게스트 신청 → cancelled, 주최 중인 시작 전 모임 → 취소("모임장 탈퇴"), 닉네임 비식별화.
 */
export function requestAccountDeletion(db: MockDb, actorId: string | null, now: Date): RuleResult<void> {
  const next = cloneJson(db);
  const actor = findProfile(next, actorId);
  if (!actor) fail('AUTH_REQUIRED');
  if (actor.status === 'deletion_requested') return { db, value: undefined };

  const at = iso(now);
  const touched = new Set<string>();
  for (const row of next.participants) {
    if (row.userId !== actor.id || row.role !== 'guest' || !isActive(row.status)) continue;
    const meeting = findMeeting(next, row.meetingId);
    if (!meeting || hasStarted(meeting, now)) continue;
    row.status = 'cancelled';
    row.cancelledAt = at;
    touched.add(row.meetingId);
  }
  for (const meeting of next.meetings) {
    if (meeting.hostId !== actor.id) continue;
    meeting.hostNickname = DELETED_USER_NICKNAME;
    if (meeting.status !== 'cancelled' && !hasStarted(meeting, now)) {
      cancelMeetingInPlace(next, meeting, MEETING_DELETED_HOST_REASON, now);
    }
  }
  for (const meetingId of touched) recount(next, meetingId);

  Object.assign(actor, {
    status: 'deletion_requested',
    deletionRequestedAt: at,
    nickname: DELETED_USER_NICKNAME,
    bio: '',
    regionCode: null,
    favoriteCategoryIds: [],
  } satisfies Partial<MockProfileRecord>);
  return { db: next, value: undefined };
}

/** 테스트·디버그용: 모든 모임의 카운트가 실제 행 집계와 같은지 */
export function findCountMismatches(db: MockDb): string[] {
  return db.meetings
    .filter((meeting) => {
      const rows = db.participants.filter((row) => row.meetingId === meeting.id);
      return (
        meeting.confirmedCount !== rows.filter((row) => row.status === 'confirmed').length ||
        meeting.pendingCount !== rows.filter((row) => row.status === 'pending').length ||
        meeting.waitlistCount !== rows.filter((row) => row.status === 'waitlisted').length
      );
    })
    .map((meeting) => meeting.id);
}

/* ------------------------------------------------------------------ */
/* 공간 (공개 조회) — list_public_venues / get_venue                     */
/* ------------------------------------------------------------------ */

const REGION_ORDER = new Map<string, number>(
  ['dunsan_tanbang', 'gung_bongmyeong', 'eunhaeng_daeheung', 'noeun_jijok', 'gwanjeo_gasuwon', 'etc_daejeon'].map(
    (code, index) => [code, index],
  ),
);

function toVenue(record: MockVenueRecord): Venue {
  const { createdBy: _createdBy, ...venue } = record;
  return { ...venue };
}

function sortVenues(venues: readonly MockVenueRecord[]): MockVenueRecord[] {
  return [...venues].sort(
    (a, b) =>
      (REGION_ORDER.get(a.regionCode) ?? 99) - (REGION_ORDER.get(b.regionCode) ?? 99) ||
      a.name.localeCompare(b.name, 'ko-KR') ||
      a.id.localeCompare(b.id),
  );
}

/** 공개 공간만(관리자도). 권역 정렬 → 이름 순 */
export function viewVenues(db: MockDb, filters: VenueFilters): Venue[] {
  return sortVenues(
    db.venues.filter(
      (venue) =>
        venue.isPublic &&
        (!filters.region || venue.regionCode === filters.region) &&
        (!filters.type || venue.venueType === filters.type),
    ),
  ).map(toVenue);
}

export function viewVenue(db: MockDb, venueId: string): Venue | null {
  const venue = db.venues.find((item) => item.id === venueId && item.isPublic);
  return venue ? toVenue(venue) : null;
}

/* ------------------------------------------------------------------ */
/* 신고 — submit_report (§9.14)                                         */
/* ------------------------------------------------------------------ */

const OPEN_REPORT_STATUSES: readonly ReportStatus[] = ['received', 'reviewing'];

export function submitReport(db: MockDb, actorId: string | null, input: ReportInput, now: Date): RuleResult<string> {
  const next = cloneJson(db);
  // 이용 제한 계정도 신고는 허용(안전 신고 경로 유지). 탈퇴 요청 계정·온보딩 전은 불가
  const actor = requireActor(next, actorId);
  requireOnboarded(actor);
  if (input.targetType !== 'meeting' && input.targetType !== 'user') fail('VALIDATION_FAILED', 'target_type');
  if (typeof input.targetId !== 'string' || input.targetId === '') fail('VALIDATION_FAILED', 'target_id');
  if (!REPORT_REASONS.includes(input.reason)) fail('VALIDATION_FAILED', 'reason');
  const body = optionalText(input.body) ?? '';
  if (charLength(body) > REPORT_LIMITS.bodyMax) fail('VALIDATION_FAILED', 'body');
  if (input.reason === 'other' && body === '') fail('VALIDATION_FAILED', 'body');

  if (input.targetType === 'meeting') {
    const meeting = findMeeting(next, input.targetId);
    if (!meeting || !canSeeMeeting(meeting, actor)) fail('NOT_FOUND');
    if (meeting.hostId === actor.id) fail('CANNOT_REPORT_SELF');
  } else {
    if (!findProfile(next, input.targetId)) fail('NOT_FOUND');
    if (input.targetId === actor.id) fail('CANNOT_REPORT_SELF');
  }

  const nowMs = now.getTime();
  const recent = next.reports.filter(
    (report) => report.reporterId === actor.id && Date.parse(report.createdAt) > nowMs - DAY_MS,
  ).length;
  if (recent >= REPORT_LIMITS.per24h) fail('RATE_LIMITED', 'report_24h');
  const duplicate = next.reports.some(
    (report) =>
      report.reporterId === actor.id &&
      report.targetType === input.targetType &&
      (report.targetMeetingId ?? report.targetUserId) === input.targetId &&
      OPEN_REPORT_STATUSES.includes(report.status),
  );
  if (duplicate) fail('DUPLICATE_REPORT');

  const id = nextId(next, 'mock-report');
  next.reports.push({
    id,
    reporterId: actor.id,
    targetType: input.targetType,
    targetMeetingId: input.targetType === 'meeting' ? input.targetId : null,
    targetUserId: input.targetType === 'user' ? input.targetId : null,
    reason: input.reason,
    body,
    status: 'received',
    adminNote: null,
    handledBy: null,
    handledAt: null,
    createdAt: iso(now),
  });
  return { db: next, value: id };
}

/* ------------------------------------------------------------------ */
/* 관리자 (§9.15·§9.18) — 관리자가 아니면 NOT_ADMIN                       */
/* mock은 보안 경계가 아니다. 실제 경계는 DB(is_admin()·RLS)다.            */
/* ------------------------------------------------------------------ */

function requireAdmin(db: MockDb, actorId: string | null): MockProfileRecord {
  const actor = findProfile(db, actorId);
  if (!actor) fail('AUTH_REQUIRED');
  if (!hasAdminPower(actor)) fail('NOT_ADMIN');
  return actor;
}

function page<T>(items: readonly T[], request: PageRequest): PageResult<T> {
  const { limit, offset } = normalizePageRequest(request);
  return { items: items.slice(offset, offset + limit), total: items.length };
}

function toAdminReport(db: MockDb, report: MockReportRecord): AdminReport {
  const meeting = report.targetMeetingId ? findMeeting(db, report.targetMeetingId) : undefined;
  const target = report.targetUserId ? findProfile(db, report.targetUserId) : undefined;
  return {
    id: report.id,
    targetType: report.targetType,
    targetId: report.targetMeetingId ?? report.targetUserId,
    targetLabel: report.targetType === 'meeting' ? (meeting?.title ?? null) : (target?.nickname ?? null),
    targetHidden: report.targetType === 'meeting' ? Boolean(meeting?.hidden) : null,
    reason: report.reason,
    body: report.body,
    status: report.status,
    adminNote: report.adminNote,
    reporterId: report.reporterId,
    reporterNickname: findProfile(db, report.reporterId)?.nickname ?? null,
    handledAt: report.handledAt,
    createdAt: report.createdAt,
  };
}

export function adminViewReports(
  db: MockDb,
  actorId: string | null,
  query: AdminReportQuery,
  request: PageRequest,
): PageResult<AdminReport> {
  requireAdmin(db, actorId);
  const reports = db.reports
    .filter((report) => !query.status || report.status === query.status)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id));
  return page(reports.map((report) => toAdminReport(db, report)), request);
}

export function adminUpdateReport(
  db: MockDb,
  actorId: string | null,
  reportId: string,
  status: ReportStatus,
  adminNote: string | null,
  now: Date,
): RuleResult<void> {
  const next = cloneJson(db);
  const actor = requireAdmin(next, actorId);
  if (!REPORT_STATUSES.includes(status)) fail('VALIDATION_FAILED', 'status');
  const note = optionalText(adminNote);
  if (note !== null && charLength(note) > ADMIN_LIMITS.adminNoteMax) fail('VALIDATION_FAILED', 'admin_note');
  const report = next.reports.find((item) => item.id === reportId);
  if (!report) fail('NOT_FOUND');
  const handled = status === 'resolved' || status === 'dismissed';
  Object.assign(report, {
    status,
    adminNote: note,
    handledBy: handled ? actor.id : null,
    handledAt: handled ? iso(now) : null,
  } satisfies Partial<MockReportRecord>);
  return { db: next, value: undefined };
}

function toAdminMeeting(db: MockDb, record: MockMeetingRecord): AdminMeeting {
  const meeting = toPublicMeeting(record, { venues: db.venues, viewerIsAdmin: true });
  return { ...meeting, isHidden: Boolean(record.hidden), hiddenReason: record.hidden ? (record.hiddenReason ?? null) : null };
}

export function adminViewMeetings(
  db: MockDb,
  actorId: string | null,
  query: AdminMeetingQuery,
  request: PageRequest,
): PageResult<AdminMeeting> {
  requireAdmin(db, actorId);
  const q = normalizeQuery(query.q)?.toLocaleLowerCase('ko-KR');
  const meetings = db.meetings
    .filter((meeting) => !query.hiddenOnly || meeting.hidden)
    .filter(
      (meeting) =>
        !q ||
        [meeting.title, meeting.gameName].some((value) => value != null && value.toLocaleLowerCase('ko-KR').includes(q)),
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id));
  return page(meetings.map((meeting) => toAdminMeeting(db, meeting)), request);
}

export function adminSetMeetingHidden(
  db: MockDb,
  actorId: string | null,
  meetingId: string,
  hidden: boolean,
  reason: string | null,
): RuleResult<void> {
  const next = cloneJson(db);
  requireAdmin(next, actorId);
  if (typeof hidden !== 'boolean') fail('VALIDATION_FAILED', 'hidden');
  const normalized = optionalText(reason);
  if (hidden && (normalized === null || charLength(normalized) > MEETING_LIMITS.hiddenReasonMax)) {
    fail('VALIDATION_FAILED', 'reason');
  }
  const meeting = findMeeting(next, meetingId);
  if (!meeting) fail('NOT_FOUND');
  meeting.hidden = hidden;
  meeting.hiddenReason = hidden ? normalized : null;
  return { db: next, value: undefined };
}

/**
 * 관리자 모임 취소: cancel_meeting과 같은 규칙(관리자는 종료 전까지). 관리자가 아니면 NOT_ADMIN.
 * 판단 순서도 DB cancel_meeting과 같다: 계정 확인(_require_actor — 로그인·탈퇴 요청이면 ACCOUNT_DELETION_REQUESTED)
 * → 모임 존재(없거나 볼 수 없는 숨김 모임이면 NOT_FOUND) → 권한(관리자가 아니면 NOT_ADMIN — Supabase 어댑터가 DB의 NOT_HOST를 바꾼 코드).
 */
export function adminCancelMeeting(
  db: MockDb,
  actorId: string | null,
  meetingId: string,
  reason: string | null,
  now: Date,
): RuleResult<void> {
  const actor = requireActor(db, actorId);
  const meeting = findMeeting(db, meetingId);
  if (!meeting || !canSeeMeeting(meeting, actor)) fail('NOT_FOUND');
  requireAdmin(db, actorId);
  return cancelMeeting(db, actorId, meetingId, reason, now);
}

export function adminSearchUsers(db: MockDb, actorId: string | null, query: string, now: Date): AdminUser[] {
  requireAdmin(db, actorId);
  const q = normalizeQuery(query);
  const lower = q?.toLocaleLowerCase('ko-KR');
  const since = now.getTime() - 30 * DAY_MS;
  return db.profiles
    .filter((profile) => !lower || profile.nickname.toLocaleLowerCase('ko-KR').includes(lower) || profile.id === q)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id))
    .slice(0, 20)
    .map((profile) => ({
      id: profile.id,
      nickname: profile.nickname,
      status: profile.status,
      createdAt: profile.createdAt,
      recentReportCount: db.reports.filter(
        (report) => report.targetUserId === profile.id && Date.parse(report.createdAt) > since,
      ).length,
    }));
}

export function adminSetUserStatus(
  db: MockDb,
  actorId: string | null,
  userId: string,
  status: AdminSettableAccountStatus,
  note: string | null,
): RuleResult<void> {
  const next = cloneJson(db);
  const actor = requireAdmin(next, actorId);
  if (status !== 'active' && status !== 'restricted') fail('VALIDATION_FAILED', 'status');
  if (!userId || userId === actor.id) fail('VALIDATION_FAILED', 'user_id');
  const normalized = optionalText(note);
  if (normalized !== null && charLength(normalized) > ADMIN_LIMITS.userStatusNoteMax) fail('VALIDATION_FAILED', 'note');
  const target = findProfile(next, userId);
  if (!target) fail('NOT_FOUND');
  if (target.status === 'deletion_requested') fail('VALIDATION_FAILED', 'status');
  // 해당 사용자의 모임을 자동 취소하지 않는다(DB와 같다)
  target.status = status;
  return { db: next, value: undefined };
}

export function adminViewVenues(db: MockDb, actorId: string | null): Venue[] {
  requireAdmin(db, actorId);
  return sortVenues(db.venues).map(toVenue);
}

/** DB check 제약·트리거와 같은 규칙(앞뒤 공백 제거, 길이, https만) */
function normalizeVenueInput(input: VenueInput): VenueInput {
  const V = VENUE_LIMITS;
  const name = (optionalText(input.name) ?? '');
  if (charLength(name) < 1 || charLength(name) > V.nameMax) fail('VALIDATION_FAILED', 'name');
  if (!isRegionCode(input.regionCode)) fail('VALIDATION_FAILED', 'region_code');
  const address = optionalText(input.address) ?? '';
  if (charLength(address) < 1 || charLength(address) > V.addressMax) fail('VALIDATION_FAILED', 'address');
  if (!VENUE_TYPES.includes(input.venueType)) fail('VALIDATION_FAILED', 'venue_type');
  const websiteUrl = optionalText(input.websiteUrl);
  if (websiteUrl !== null && safeExternalUrl(websiteUrl) === null) fail('VALIDATION_FAILED', 'website_url');
  const bookingUrl = optionalText(input.bookingUrl);
  if (bookingUrl !== null && safeExternalUrl(bookingUrl) === null) fail('VALIDATION_FAILED', 'booking_url');
  const description = optionalText(input.description) ?? '';
  if (charLength(description) > V.descriptionMax) fail('VALIDATION_FAILED', 'description');
  if (typeof input.isPublic !== 'boolean') fail('VALIDATION_FAILED', 'is_public');
  const verifiedMs = input.infoVerifiedAt === null ? null : Date.parse(input.infoVerifiedAt);
  if (verifiedMs !== null && Number.isNaN(verifiedMs)) fail('VALIDATION_FAILED', 'info_verified_at');
  return {
    name,
    regionCode: input.regionCode,
    address,
    venueType: input.venueType,
    websiteUrl,
    bookingUrl,
    description,
    isPublic: input.isPublic,
    infoVerifiedAt: verifiedMs === null ? null : new Date(verifiedMs).toISOString(),
  };
}

export function adminSaveVenue(
  db: MockDb,
  actorId: string | null,
  venueId: string | null,
  input: VenueInput,
  now: Date,
): RuleResult<string> {
  const next = cloneJson(db);
  const actor = requireAdmin(next, actorId);
  const value = normalizeVenueInput(input);
  const at = iso(now);
  if (venueId === null) {
    const id = nextId(next, 'mock-venue');
    next.venues.push({ id, ...value, createdAt: at, updatedAt: at, createdBy: actor.id });
    return { db: next, value: id };
  }
  const venue = next.venues.find((item) => item.id === venueId);
  if (!venue) fail('NOT_FOUND');
  Object.assign(venue, { ...value, updatedAt: at });
  for (const meeting of next.meetings) if (meeting.venueId === venue.id) meeting.venueName = venue.name;
  return { db: next, value: venue.id };
}

export function adminSetVenuePublic(
  db: MockDb,
  actorId: string | null,
  venueId: string,
  isPublic: boolean,
  now: Date,
): RuleResult<void> {
  const next = cloneJson(db);
  requireAdmin(next, actorId);
  const venue = next.venues.find((item) => item.id === venueId);
  if (!venue) fail('NOT_FOUND');
  if (venue.isPublic !== isPublic) {
    venue.isPublic = isPublic;
    venue.updatedAt = iso(now);
  }
  return { db: next, value: undefined };
}

export function adminViewCategories(db: MockDb, actorId: string | null): AdminCategory[] {
  requireAdmin(db, actorId);
  return [...db.categories]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
    .map((category) => ({ ...category }));
}

export function adminSetCategoryActive(
  db: MockDb,
  actorId: string | null,
  categoryId: string,
  isActive: boolean,
): RuleResult<void> {
  const next = cloneJson(db);
  requireAdmin(next, actorId);
  const category = next.categories.find((item) => item.id === categoryId);
  if (!category) fail('NOT_FOUND');
  category.isActive = isActive;
  return { db: next, value: undefined };
}
