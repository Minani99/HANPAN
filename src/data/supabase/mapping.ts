/**
 * RPC jsonb 응답 → 프론트 타입 변환 + 런타임 검증(Zod).
 *
 * 응답 모양은 supabase/migrations/20261124000300_functions.sql의 meeting_to_json·_participation_json·
 * get_my_profile·list_* 출력(키 camelCase, 시각 UTC ISO 8601)과 같아야 한다(docs/DB_SCHEMA.md §17).
 * 필수 키가 없거나 타입·값이 다르면 UNKNOWN 오류를 던진다 — 서버/클라이언트 계약 불일치를 조용히 넘기지 않는다.
 * 모르는 키는 버린다(서버가 키를 추가해도 깨지지 않게).
 *
 * 예외: listCategories/listRegions는 프론트 상수에 없는 코드(DB에 새로 추가한 항목)를 버리고 콘솔에 경고한다.
 * 모임·프로필에 프론트가 모르는 카테고리·권역이 오면 계약 위반(UNKNOWN)이다 — 기준 데이터는 프론트 상수를 먼저 배포한다.
 */
import { z } from 'zod';
import { isCategoryId } from '../../domain/categories';
import { isRegionCode } from '../../domain/regions';
import { devWarn } from '../../lib/devConsole';
import { safeExternalUrl } from '../../lib/externalUrl';
import { DataAdapterError } from '../adapter';
import type {
  AdminCategory,
  AdminMeeting,
  AdminReport,
  AdminUser,
  Category,
  CategoryId,
  Meeting,
  MyMeetings,
  MyParticipation,
  MyProfile,
  PageResult,
  Participant,
  ParticipantStatus,
  Region,
  RegionCode,
  SessionUser,
  Venue,
} from '../types';

/* ------------------------------------------------------------------ */
/* 공통 값                                                              */
/* ------------------------------------------------------------------ */

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/**
 * Postgres timestamptz JSON(예: '2026-11-24T08:12:05.231456+00:00')을 'YYYY-MM-DDTHH:mm:ss.sssZ'(UTC)로.
 * 소수점 이하는 밀리초까지 자른다(브라우저별 Date.parse 차이를 피하려고). 형식이 다르면 null.
 */
export function normalizeTimestamp(value: string): string | null {
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match) return null;
  const [, date, time, fraction = '', zone = 'Z'] = match;
  const millis = fraction.padEnd(3, '0').slice(0, 3);
  let offset = zone.toUpperCase();
  if (offset !== 'Z') {
    const digits = offset.slice(1).replace(':', '');
    offset = `${offset[0]}${digits.slice(0, 2)}:${digits.slice(2, 4).padEnd(2, '0')}`;
  }
  const ms = Date.parse(`${date}T${time}.${millis}${offset}`);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

const uuid = z.string().regex(UUID_PATTERN);
const timestamp = z.string().transform((value, ctx) => {
  const normalized = normalizeTimestamp(value);
  if (normalized === null) {
    ctx.addIssue({ code: 'custom', message: 'timestamp' });
    return z.NEVER;
  }
  return normalized;
});
const int = z.number().int();
const nonNegativeInt = int.min(0);
const categoryId = z.custom<CategoryId>((value) => isCategoryId(value), { message: 'categoryId' });
const regionCode = z.custom<RegionCode>((value) => isRegionCode(value), { message: 'regionCode' });
const participantStatus = z.enum(['pending', 'confirmed', 'waitlisted', 'rejected', 'cancelled', 'meeting_cancelled']);
const accountStatus = z.enum(['active', 'restricted', 'deletion_requested']);

/* ------------------------------------------------------------------ */
/* 스키마 (DB 출력 모양)                                                 */
/* ------------------------------------------------------------------ */

/** meeting_to_json */
export const meetingRowSchema = z.object({
  id: uuid,
  hostId: uuid.nullable(),
  hostNickname: z.string().nullable(),
  categoryId,
  gameId: uuid.nullable(),
  gameName: z.string().nullable(),
  title: z.string(),
  description: z.string(),
  notice: z.string().nullable(),
  startAt: timestamp,
  endAt: timestamp,
  durationMinutes: int.positive(),
  regionCode,
  venueId: uuid.nullable(),
  venueName: z.string().nullable(),
  venueNote: z.string().nullable(),
  minParticipants: int.positive(),
  maxParticipants: int.positive(),
  confirmedCount: nonNegativeInt,
  pendingCount: nonNegativeInt,
  waitlistCount: nonNegativeInt,
  remainingSeats: int,
  skillLevel: z.enum(['beginner_welcome', 'anyone', 'experienced']),
  approvalMode: z.enum(['auto', 'manual']),
  allowWaitlist: z.boolean(),
  status: z.enum(['open', 'closed', 'cancelled']),
  isHidden: z.boolean(),
  hiddenReason: z.string().nullable(),
  cancelReason: z.string().nullable(),
  cancelledAt: timestamp.nullable(),
  // 이미지 업로드 미구현: 서버는 항상 null. 값이 오면 https만 허용한다.
  imageUrl: z.string().regex(/^https:\/\//).nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

/** 외부 링크: https만. 그 밖의 값(계약 위반)은 링크를 버린다(null) — 화면 전체를 실패시키지 않는다 */
const externalUrl = z
  .string()
  .nullable()
  .transform((value) => (value === null ? null : safeExternalUrl(value)));

/** venue_to_json */
export const venueRowSchema = z.object({
  id: uuid,
  name: z.string().min(1),
  regionCode,
  address: z.string(),
  venueType: z.enum(['board_game_cafe', 'party_room', 'other']),
  websiteUrl: externalUrl,
  bookingUrl: externalUrl,
  description: z.string(),
  isPublic: z.boolean(),
  infoVerifiedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

const reportReason = z.enum(['spam', 'inappropriate', 'gambling', 'harassment', 'no_show', 'commercial', 'other']);
const reportStatus = z.enum(['received', 'reviewing', 'resolved', 'dismissed']);

/** admin_list_report_items 원소 */
export const adminReportRowSchema = z.object({
  id: uuid,
  targetType: z.enum(['meeting', 'user']),
  targetId: uuid.nullable(),
  targetLabel: z.string().nullable(),
  targetHidden: z.boolean().nullable(),
  reason: reportReason,
  body: z.string(),
  status: reportStatus,
  adminNote: z.string().nullable(),
  reporterId: uuid.nullable(),
  reporterNickname: z.string().nullable(),
  handledAt: timestamp.nullable(),
  createdAt: timestamp,
});

/** admin_search_users 행(테이블 컬럼 이름 그대로, snake_case) */
export const adminUserRowSchema = z.object({
  id: uuid,
  nickname: z.string(),
  status: accountStatus,
  created_at: timestamp,
  recent_report_count: nonNegativeInt,
});

/** admin_list_categories 원소 */
export const adminCategoryRowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  sortOrder: int,
  isActive: z.boolean(),
});

/** venues·categories 직접 쓰기 응답(select('id')) */
const writtenRowsSchema = z.array(z.object({ id: z.string().min(1) }));

/** _participation_json */
export const participationRowSchema = z.object({
  id: uuid,
  meetingId: uuid,
  userId: uuid,
  role: z.enum(['host', 'guest']),
  status: participantStatus,
  attendance: z.enum(['unknown', 'attended', 'absent']),
  message: z.string().nullable(),
  appliedAt: timestamp,
  decidedAt: timestamp.nullable(),
  confirmedAt: timestamp.nullable(),
  cancelledAt: timestamp.nullable(),
  attendanceMarkedAt: timestamp.nullable(),
  updatedAt: timestamp,
});

/** list_meeting_participants 원소 */
export const participantRowSchema = participationRowSchema.extend({ nickname: z.string() });

/** get_my_profile */
export const profileRowSchema = z.object({
  id: uuid,
  nickname: z.string(),
  regionCode: regionCode.nullable(),
  bio: z.string(),
  favoriteCategoryIds: z.array(categoryId),
  status: accountStatus,
  termsAgreedAt: timestamp.nullable(),
  privacyAgreedAt: timestamp.nullable(),
  deletionRequestedAt: timestamp.nullable(),
  onboarded: z.boolean(),
  isAdmin: z.boolean(),
  createdAt: timestamp,
});

export const meetingPageSchema = z.object({ items: z.array(meetingRowSchema), total: nonNegativeInt });

export const myMeetingsSchema = z.object({
  hosted: z.array(meetingRowSchema),
  joined: z.array(z.object({ meeting: meetingRowSchema.nullable(), participation: participationRowSchema })),
});

const referenceRowSchema = z.object({ name: z.string().min(1), sort_order: int });
const categoryRowsSchema = z.array(referenceRowSchema.extend({ id: z.string().min(1) }));
const regionRowsSchema = z.array(referenceRowSchema.extend({ code: z.string().min(1) }));

export type MeetingRow = z.output<typeof meetingRowSchema>;
export type ParticipationRow = z.output<typeof participationRowSchema>;
export type ProfileRow = z.output<typeof profileRowSchema>;

/* ------------------------------------------------------------------ */
/* 검증 실행                                                            */
/* ------------------------------------------------------------------ */

/**
 * 스키마 검증. 실패하면 UNKNOWN(detail=`contract:<rpc>`). 메시지에는 문제 위치(경로)만 담고 값은 담지 않는다.
 */
export function parseResponse<S extends z.ZodType>(schema: S, data: unknown, rpc: string): z.output<S> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const paths = result.error.issues
    .slice(0, 3)
    .map((issue) => issue.path.map(String).join('.') || '(root)')
    .join(', ');
  throw new DataAdapterError('UNKNOWN', {
    detail: `contract:${rpc}`,
    message: `서버 응답이 계약과 다릅니다(${rpc}: ${paths})`,
  });
}

/* ------------------------------------------------------------------ */
/* 변환                                                                 */
/* ------------------------------------------------------------------ */

export function toMeeting(row: MeetingRow): Meeting {
  return {
    id: row.id,
    hostId: row.hostId,
    hostNickname: row.hostNickname,
    categoryId: row.categoryId,
    gameId: row.gameId,
    gameName: row.gameName,
    title: row.title,
    description: row.description,
    notice: row.notice,
    startAt: row.startAt,
    endAt: row.endAt,
    durationMinutes: row.durationMinutes,
    regionCode: row.regionCode,
    venueId: row.venueId,
    venueName: row.venueName,
    venueNote: row.venueNote,
    minParticipants: row.minParticipants,
    maxParticipants: row.maxParticipants,
    confirmedCount: row.confirmedCount,
    pendingCount: row.pendingCount,
    waitlistCount: row.waitlistCount,
    skillLevel: row.skillLevel,
    approvalMode: row.approvalMode,
    allowWaitlist: row.allowWaitlist,
    status: row.status,
    cancelReason: row.cancelReason,
    imageUrl: row.imageUrl,
    createdAt: row.createdAt,
    isHidden: row.isHidden,
    hiddenReason: row.isHidden ? row.hiddenReason : null,
  };
}

export function toMyParticipation(row: ParticipationRow): MyParticipation {
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

export function toMyProfile(row: ProfileRow): MyProfile {
  return {
    id: row.id,
    nickname: row.nickname,
    regionCode: row.regionCode,
    bio: row.bio,
    favoriteCategoryIds: [...row.favoriteCategoryIds],
    status: row.status,
    termsAgreedAt: row.termsAgreedAt,
    privacyAgreedAt: row.privacyAgreedAt,
    isAdmin: row.isAdmin,
  };
}

export function toSessionUser(row: ProfileRow): SessionUser {
  return {
    id: row.id,
    nickname: row.nickname,
    onboarded: row.onboarded,
    status: row.status,
    isAdmin: row.isAdmin,
  };
}

/* ------------------------------------------------------------------ */
/* RPC별 파서                                                            */
/* ------------------------------------------------------------------ */

export function parseMeetingPage(data: unknown): PageResult<Meeting> {
  const page = parseResponse(meetingPageSchema, data, 'list_public_meetings');
  return { items: page.items.map(toMeeting), total: page.total };
}

export function parseMeetingOrNull(data: unknown): Meeting | null {
  const row = parseResponse(meetingRowSchema.nullable(), data ?? null, 'get_meeting');
  return row ? toMeeting(row) : null;
}

export function parseParticipationOrNull(data: unknown): MyParticipation | null {
  const row = parseResponse(participationRowSchema.nullable(), data ?? null, 'get_my_participation');
  return row ? toMyParticipation(row) : null;
}

export function parseProfileOrNull(data: unknown): ProfileRow | null {
  return parseResponse(profileRowSchema.nullable(), data ?? null, 'get_my_profile');
}

export function parseMyMeetings(data: unknown): MyMeetings {
  const value = parseResponse(myMeetingsSchema, data, 'list_my_meetings');
  return {
    hosted: value.hosted.map(toMeeting),
    joined: value.joined.map((item) => ({
      meeting: item.meeting ? toMeeting(item.meeting) : null,
      participation: toMyParticipation(item.participation),
    })),
  };
}

export function parseParticipants(data: unknown): Participant[] {
  return parseResponse(z.array(participantRowSchema), data, 'list_meeting_participants').map((row) => ({
    ...toMyParticipation(row),
    userId: row.userId,
    nickname: row.nickname,
  }));
}

export function parseApplyStatus(data: unknown): ParticipantStatus {
  return parseResponse(z.enum(['confirmed', 'pending', 'waitlisted']), data, 'apply_to_meeting');
}

export function parseDecision(data: unknown): ParticipantStatus {
  return parseResponse(z.enum(['confirmed', 'rejected']), data, 'decide_participant');
}

export function parseCreatedMeetingId(data: unknown): string {
  return parseResponse(uuid, data, 'create_meeting');
}

function warnUnknownReference(table: string, codes: string[]): void {
  if (codes.length > 0) {
    devWarn(`[HANPAN] ${table}에 프론트가 모르는 코드가 있어 목록에서 뺐습니다: ${codes.join(', ')}`);
  }
}

function bySortOrder<T extends { sortOrder: number }>(key: (item: T) => string) {
  return (a: T, b: T) => a.sortOrder - b.sortOrder || key(a).localeCompare(key(b));
}

export function parseCategories(data: unknown): Category[] {
  const rows = parseResponse(categoryRowsSchema, data, 'categories');
  const unknown = rows.filter((row) => !isCategoryId(row.id)).map((row) => row.id);
  warnUnknownReference('categories', unknown);
  return rows
    .flatMap((row): Category[] => (isCategoryId(row.id) ? [{ id: row.id, name: row.name, sortOrder: row.sort_order }] : []))
    .sort(bySortOrder((item) => item.id));
}

export function parseRegions(data: unknown): Region[] {
  const rows = parseResponse(regionRowsSchema, data, 'regions');
  const unknown = rows.filter((row) => !isRegionCode(row.code)).map((row) => row.code);
  warnUnknownReference('regions', unknown);
  return rows
    .flatMap((row): Region[] => (isRegionCode(row.code) ? [{ code: row.code, name: row.name, sortOrder: row.sort_order }] : []))
    .sort(bySortOrder((item) => item.code));
}

/* ------------------------------------------------------------------ */
/* 공간·신고·관리자 (Phase 4)                                            */
/* ------------------------------------------------------------------ */

export type VenueRow = z.output<typeof venueRowSchema>;

export function toVenue(row: VenueRow): Venue {
  return {
    id: row.id,
    name: row.name,
    regionCode: row.regionCode,
    address: row.address,
    venueType: row.venueType,
    websiteUrl: row.websiteUrl,
    bookingUrl: row.bookingUrl,
    description: row.description,
    isPublic: row.isPublic,
    infoVerifiedAt: row.infoVerifiedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function parseVenues(data: unknown, rpc = 'list_public_venues'): Venue[] {
  return parseResponse(z.array(venueRowSchema), data, rpc).map(toVenue);
}

export function parseVenueOrNull(data: unknown): Venue | null {
  const row = parseResponse(venueRowSchema.nullable(), data ?? null, 'get_venue');
  return row ? toVenue(row) : null;
}

export function parseReportId(data: unknown): string {
  return parseResponse(uuid, data, 'submit_report');
}

export function parseAdminReportPage(data: unknown): PageResult<AdminReport> {
  const page = parseResponse(
    z.object({ items: z.array(adminReportRowSchema), total: nonNegativeInt }),
    data,
    'admin_list_report_items',
  );
  return { items: page.items.map((row) => ({ ...row })), total: page.total };
}

export function parseAdminMeetingPage(data: unknown): PageResult<AdminMeeting> {
  const page = parseResponse(meetingPageSchema, data, 'admin_list_meetings');
  return {
    items: page.items.map((row) => ({ ...toMeeting(row), isHidden: row.isHidden, hiddenReason: row.isHidden ? row.hiddenReason : null })),
    total: page.total,
  };
}

export function parseAdminUsers(data: unknown): AdminUser[] {
  return parseResponse(z.array(adminUserRowSchema), data ?? [], 'admin_search_users').map((row) => ({
    id: row.id,
    nickname: row.nickname,
    status: row.status,
    createdAt: row.created_at,
    recentReportCount: row.recent_report_count,
  }));
}

export function parseAdminCategories(data: unknown): AdminCategory[] {
  return parseResponse(z.array(adminCategoryRowSchema), data, 'admin_list_categories').map((row) => ({ ...row }));
}

/** 직접 쓰기 응답 → 쓴 행 id 목록(RLS에 막힌 update는 빈 배열) */
export function parseWrittenIds(data: unknown, table: string): string[] {
  return parseResponse(writtenRowsSchema, data ?? [], table).map((row) => row.id);
}
