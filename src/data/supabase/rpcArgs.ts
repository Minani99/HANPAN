/**
 * 프론트 입력 → RPC 인자 변환 (docs/DB_SCHEMA.md §17).
 * - RPC 인자 이름은 `p_...`, jsonb 입력 키는 snake_case.
 * - 탐색 필터는 빈 값을 생략한다(DB 기본값 사용). 정렬·페이지는 항상 보낸다.
 */
import { isCategoryId } from '../../domain/categories';
import { isRegionCode } from '../../domain/regions';
import { isValidDateKey, kstDayRange } from '../../lib/date';
import { normalizeQuery } from '../../lib/filters';
import { DataAdapterError, normalizePageRequest } from '../adapter';
import type {
  AdminMeetingQuery,
  AdminReportQuery,
  MeetingFilters,
  MeetingInput,
  PageRequest,
  ProfileUpdate,
  VenueFilters,
  VenueInput,
} from '../types';
import { isUuid } from './mapping';

const VENUE_TYPES = new Set(['board_game_cafe', 'party_room', 'other']);
const REPORT_STATUSES = new Set(['received', 'reviewing', 'resolved', 'dismissed']);

/** list_public_meetings 인자. date는 KST 하루 범위 [00:00, 다음 날 00:00)로 바꾼다 */
export function toListMeetingsArgs(filters: MeetingFilters, page: PageRequest): Record<string, unknown> {
  const { limit, offset } = normalizePageRequest(page);
  const args: Record<string, unknown> = {};
  if (filters.date && isValidDateKey(filters.date)) {
    const range = kstDayRange(filters.date);
    args.p_date_from = range.startIso;
    args.p_date_to = range.endIso;
  }
  if (filters.category && isCategoryId(filters.category)) args.p_category = filters.category;
  if (filters.region && isRegionCode(filters.region)) args.p_region = filters.region;
  const q = normalizeQuery(filters.q);
  if (q) args.p_q = q;
  if (filters.recruiting === true) args.p_recruiting = true;
  if (filters.venueId && isUuid(filters.venueId)) args.p_venue_id = filters.venueId;
  args.p_sort = filters.sort === 'newest' ? 'newest' : 'soonest';
  args.p_limit = limit;
  args.p_offset = offset;
  return args;
}

const OFFSET_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i;

/**
 * 오프셋(Z 또는 ±HH:MM)이 있는 ISO 문자열만 받아 UTC ISO('…Z')로 보낸다.
 * 오프셋이 없으면 브라우저 시간대에 따라 해석이 달라지므로 보내지 않고 VALIDATION_FAILED(start_at).
 */
export function toOffsetIso(value: string, detail = 'start_at'): string {
  const ms = OFFSET_ISO_PATTERN.test(value) ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(ms)) throw new DataAdapterError('VALIDATION_FAILED', { detail });
  return new Date(ms).toISOString();
}

/**
 * create_meeting / update_meeting의 p(jsonb). 수정도 항상 전체 값을 보낸다 —
 * update_meeting은 빠진 선택 키를 기본값(allow_waitlist=true, 나머지 null/'')으로 바꾸기 때문이다.
 * game_id: 등록된 게임 연결을 유지할 때만(수정 화면에서 게임명을 바꾸지 않은 경우) 보내고, 그때 game_name은 null이다.
 * 그 밖에는 game_id = null + game_name(직접 입력). 둘을 동시에 보내면 서버가 VALIDATION_FAILED(game)로 거부한다.
 */
export function toMeetingPayload(input: MeetingInput): Record<string, unknown> {
  const gameId = typeof input.gameId === 'string' && isUuid(input.gameId) ? input.gameId : null;
  return {
    category_id: input.categoryId,
    game_id: gameId,
    game_name: gameId ? null : input.gameName,
    title: input.title,
    description: input.description,
    notice: input.notice,
    start_at: toOffsetIso(input.startAt),
    duration_minutes: input.durationMinutes,
    region_code: input.regionCode,
    venue_id: input.venueId,
    venue_note: input.venueNote,
    min_participants: input.minParticipants,
    max_participants: input.maxParticipants,
    skill_level: input.skillLevel,
    approval_mode: input.approvalMode,
    allow_waitlist: input.allowWaitlist,
    holdem_policy_agreed: input.holdemPolicyAgreed,
  };
}

/** update_my_profile의 p(jsonb). 부분 수정: 바꿀 키만 보낸다(null은 '지움'으로 그대로 보낸다) */
export function toProfilePayload(patch: ProfileUpdate): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (patch.nickname !== undefined) payload.nickname = patch.nickname;
  if (patch.regionCode !== undefined) payload.region_code = patch.regionCode;
  if (patch.bio !== undefined) payload.bio = patch.bio;
  if (patch.favoriteCategoryIds !== undefined) payload.favorite_category_ids = [...patch.favoriteCategoryIds];
  if (patch.agreeTerms !== undefined) payload.agree_terms = patch.agreeTerms;
  if (patch.agreePrivacy !== undefined) payload.agree_privacy = patch.agreePrivacy;
  return payload;
}

/** list_public_venues 인자. 모르는 값은 보내지 않는다(전체) */
export function toListVenuesArgs(filters: VenueFilters): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  if (filters.region && isRegionCode(filters.region)) args.p_region = filters.region;
  if (filters.type && VENUE_TYPES.has(filters.type)) args.p_type = filters.type;
  return args;
}

/** admin_list_report_items 인자 */
export function toAdminReportArgs(query: AdminReportQuery, page: PageRequest): Record<string, unknown> {
  const { limit, offset } = normalizePageRequest(page);
  const args: Record<string, unknown> = { p_limit: limit, p_offset: offset };
  if (query.status && REPORT_STATUSES.has(query.status)) args.p_status = query.status;
  return args;
}

/** admin_list_meetings 인자 */
export function toAdminMeetingArgs(query: AdminMeetingQuery, page: PageRequest): Record<string, unknown> {
  const { limit, offset } = normalizePageRequest(page);
  const args: Record<string, unknown> = { p_hidden_only: query.hiddenOnly === true, p_limit: limit, p_offset: offset };
  const q = normalizeQuery(query.q);
  if (q) args.p_q = q;
  return args;
}

/**
 * venues insert/update 행(snake_case 컬럼). 전체 필드를 보낸다.
 * created_by·created_at·updated_at은 보내지 않는다 — DB 트리거가 정한다(요청자로 고정).
 */
export function toVenueRow(input: VenueInput): Record<string, unknown> {
  return {
    name: input.name,
    region_code: input.regionCode,
    address: input.address,
    venue_type: input.venueType,
    website_url: input.websiteUrl,
    booking_url: input.bookingUrl,
    description: input.description,
    is_public: input.isPublic,
    info_verified_at: input.infoVerifiedAt === null ? null : toOffsetIso(input.infoVerifiedAt, 'info_verified_at'),
  };
}
