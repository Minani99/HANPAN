import { z } from 'zod';
import type { RegionCode, Venue, VenueInput, VenueType } from '../data/types';
import { getKstParts, isValidDateKey, kstDateTimeToIso, toKstDateKey } from '../lib/date';
import { EXTERNAL_URL_MAX_LENGTH, safeExternalUrl } from '../lib/externalUrl';
import { charLength } from './limits';
import { isRegionCode } from './regions';

/**
 * 공간(venues) 기준값·검증. 한도는 DB check 제약(docs/DB_SCHEMA.md §2.3)과 같다.
 * 실시간 영업 상태·좌석·가격·예약 가능 시간은 다루지 않는다.
 */

export const VENUE_LIMITS = {
  nameMax: 60,
  addressMax: 200,
  descriptionMax: 1000,
  urlMax: EXTERNAL_URL_MAX_LENGTH,
} as const;

export const VENUE_TYPES: readonly VenueType[] = ['board_game_cafe', 'party_room', 'other'];

export const VENUE_TYPE_LABEL: Readonly<Record<VenueType, string>> = {
  board_game_cafe: '보드게임 카페',
  party_room: '파티룸',
  other: '기타 공간',
};

export function isVenueType(value: unknown): value is VenueType {
  return typeof value === 'string' && (VENUE_TYPES as readonly string[]).includes(value);
}

export function venuePath(id: string): string {
  return `/venues/${encodeURIComponent(id)}`;
}

/** 공간 목록·상세의 고정 안내(실시간 정보·예약 대행 없음) */
export const VENUE_NOTICE = '영업시간·좌석·가격은 공간에 직접 확인해 주세요. HANPAN은 예약·결제를 대행하지 않아요.';

/** '2026.11.20' (KST 날짜) */
export function formatVerifiedDay(iso: string): string {
  const p = getKstParts(iso);
  return `${p.year}.${String(p.month).padStart(2, '0')}.${String(p.day).padStart(2, '0')}`;
}

/** '정보 확인일 2026.11.20' (KST) / 없으면 '확인일 없음' */
export function formatVerifiedDate(iso: string | null): string {
  return iso ? `정보 확인일 ${formatVerifiedDay(iso)}` : '확인일 없음';
}

/* ------------------------------------------------------------------ */
/* 공간 탐색 필터 <-> URL 쿼리 (region, type)                             */
/* ------------------------------------------------------------------ */

export interface VenueQuery {
  region?: RegionCode;
  type?: VenueType;
}

export function parseVenueQuery(params: URLSearchParams): VenueQuery {
  const query: VenueQuery = {};
  const region = params.get('region');
  if (isRegionCode(region)) query.region = region;
  const type = params.get('type');
  if (isVenueType(type)) query.type = type;
  return query;
}

export function serializeVenueQuery(query: VenueQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.region && isRegionCode(query.region)) params.set('region', query.region);
  if (query.type && isVenueType(query.type)) params.set('type', query.type);
  return params;
}

/* ------------------------------------------------------------------ */
/* 모임 폼의 공간 선택 검증 (서버 _meeting_input과 같은 규칙)               */
/* ------------------------------------------------------------------ */

export interface VenueSelectionContext {
  /** 공개 공간 목록(listVenues) */
  venues: readonly Pick<Venue, 'id' | 'regionCode'>[];
  /** 수정: 원래 연결된 공간 id와 그때의 권역(비공개로 바뀐 공간도 그대로 두는 것은 허용) */
  original?: { venueId: string | null; regionCode: RegionCode };
}

export const VENUE_SELECTION_MESSAGES = {
  unavailable: '선택한 공간을 지금은 고를 수 없어요. 다른 공간을 고르거나 장소 미정으로 두세요.',
  regionMismatch: '선택한 공간이 모임 권역과 달라요. 권역에 맞는 공간을 골라 주세요.',
} as const;

/**
 * 공간 선택 검사. 통과하면 null, 아니면 오류 문구.
 * - 새로 고르거나 바꾼 공간: 공개 공간 목록에 있어야 하고 권역이 같아야 한다
 * - 수정에서 원래 공간을 그대로 두면 공개 여부는 보지 않는다(서버도 같다). 권역은 항상 같아야 한다
 */
export function validateVenueSelection(
  venueId: string | null,
  regionCode: RegionCode | '',
  context: VenueSelectionContext,
): string | null {
  if (!venueId) return null;
  const venue = context.venues.find((item) => item.id === venueId);
  if (venue) return venue.regionCode === regionCode ? null : VENUE_SELECTION_MESSAGES.regionMismatch;
  const original = context.original;
  if (original && original.venueId === venueId) {
    return original.regionCode === regionCode ? null : VENUE_SELECTION_MESSAGES.regionMismatch;
  }
  return VENUE_SELECTION_MESSAGES.unavailable;
}

/* ------------------------------------------------------------------ */
/* 관리자 공간 등록·수정 폼                                               */
/* ------------------------------------------------------------------ */

export interface VenueFormValues {
  name: string;
  regionCode: RegionCode | '';
  address: string;
  venueType: VenueType | '';
  websiteUrl: string;
  bookingUrl: string;
  description: string;
  isPublic: boolean;
  /** KST 날짜 'YYYY-MM-DD' 또는 '' */
  infoVerifiedOn: string;
}

export type VenueFormField = keyof VenueFormValues;
export type VenueFormErrors = Partial<Record<VenueFormField, string>>;

export const VENUE_FIELD_MESSAGES = {
  name: `공간 이름은 1자 이상 ${VENUE_LIMITS.nameMax}자 이하로 써 주세요.`,
  regionCode: '권역을 골라 주세요.',
  address: `주소는 1자 이상 ${VENUE_LIMITS.addressMax}자 이하로 써 주세요.`,
  venueType: '공간 유형을 골라 주세요.',
  url: `https://로 시작하는 주소만 쓸 수 있어요(${VENUE_LIMITS.urlMax}자 이하).`,
  description: `소개는 ${VENUE_LIMITS.descriptionMax}자까지 쓸 수 있어요.`,
  infoVerifiedOn: '정보 확인일은 오늘이거나 그 이전 날짜여야 해요.',
} as const;

const M = VENUE_FIELD_MESSAGES;

const optionalUrl = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value === '' || safeExternalUrl(value) !== null, { message: M.url });

/** 서버 오류 detail(snake_case) → 폼 필드 */
export const VENUE_SERVER_FIELD_MAP: Readonly<Record<string, VenueFormField>> = {
  name: 'name',
  region_code: 'regionCode',
  address: 'address',
  venue_type: 'venueType',
  website_url: 'websiteUrl',
  booking_url: 'bookingUrl',
  description: 'description',
  info_verified_at: 'infoVerifiedOn',
};

export function createVenueFormSchema(now: Date) {
  const today = toKstDateKey(now);
  return z
    .object({
      name: z
        .string()
        .transform((value) => value.trim())
        .refine((value) => charLength(value) >= 1 && charLength(value) <= VENUE_LIMITS.nameMax, { message: M.name }),
      regionCode: z.custom<RegionCode>((value) => isRegionCode(value), { message: M.regionCode }),
      address: z
        .string()
        .transform((value) => value.trim())
        .refine((value) => charLength(value) >= 1 && charLength(value) <= VENUE_LIMITS.addressMax, {
          message: M.address,
        }),
      venueType: z.custom<VenueType>((value) => isVenueType(value), { message: M.venueType }),
      websiteUrl: optionalUrl,
      bookingUrl: optionalUrl,
      description: z
        .string()
        .transform((value) => value.trim())
        .refine((value) => charLength(value) <= VENUE_LIMITS.descriptionMax, { message: M.description }),
      isPublic: z.boolean(),
      infoVerifiedOn: z
        .string()
        .refine((value) => value === '' || (isValidDateKey(value) && value <= today), { message: M.infoVerifiedOn }),
    })
    .transform(
      (value): VenueInput => ({
        name: value.name,
        regionCode: value.regionCode,
        address: value.address,
        venueType: value.venueType,
        websiteUrl: value.websiteUrl === '' ? null : safeExternalUrl(value.websiteUrl),
        bookingUrl: value.bookingUrl === '' ? null : safeExternalUrl(value.bookingUrl),
        description: value.description,
        isPublic: value.isPublic,
        // 날짜만 받으므로 KST 00:00으로 저장한다(표시도 KST 날짜)
        infoVerifiedAt: value.infoVerifiedOn === '' ? null : kstDateTimeToIso(value.infoVerifiedOn, '00:00'),
      }),
    );
}

export type VenueFormResult = { ok: true; input: VenueInput } | { ok: false; errors: VenueFormErrors };

export function validateVenueForm(values: VenueFormValues, now: Date): VenueFormResult {
  const result = createVenueFormSchema(now).safeParse(values);
  if (result.success) return { ok: true, input: result.data };
  const errors: VenueFormErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (typeof field === 'string' && field in values && !errors[field as VenueFormField]) {
      errors[field as VenueFormField] = issue.message;
    }
  }
  return { ok: false, errors };
}

export function emptyVenueFormValues(): VenueFormValues {
  return {
    name: '',
    regionCode: '',
    address: '',
    venueType: '',
    websiteUrl: '',
    bookingUrl: '',
    description: '',
    isPublic: false,
    infoVerifiedOn: '',
  };
}

export function venueToFormValues(venue: Venue): VenueFormValues {
  return {
    name: venue.name,
    regionCode: venue.regionCode,
    address: venue.address,
    venueType: venue.venueType,
    websiteUrl: venue.websiteUrl ?? '',
    bookingUrl: venue.bookingUrl ?? '',
    description: venue.description,
    isPublic: venue.isPublic,
    infoVerifiedOn: venue.infoVerifiedAt ? toKstDateKey(venue.infoVerifiedAt) : '',
  };
}
