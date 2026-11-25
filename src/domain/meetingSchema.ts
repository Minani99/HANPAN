import { z } from 'zod';
import { getErrorCode, isDataAdapterError } from '../data/adapter';
import type { ApprovalMode, CategoryId, Meeting, MeetingInput, RegionCode, SkillLevel } from '../data/types';
import { addDaysToDateKey, formatKstTime, isValidDateKey, kstDateTimeToIso, toKstDateKey } from '../lib/date';
import { isCategoryId } from './categories';
import { MEETING_LIMITS as L, charLength } from './limits';
import { isRegionCode } from './regions';
import { validateVenueSelection, type VenueSelectionContext } from './venues';

/**
 * 모임 생성·수정 폼 검증 (서버 RPC create_meeting / update_meeting과 같은 규칙, docs/DB_SCHEMA.md §2.4·§9.4·§9.5).
 * 서버도 같은 규칙을 다시 검사한다. 클라이언트 검증은 빠른 안내용이다.
 */

/** 폼 입력 상태 (입력란 값 그대로: 문자열·불리언) */
export interface MeetingFormValues {
  categoryId: CategoryId | '';
  gameName: string;
  /**
   * 수정 화면: 관리자가 등록한 게임(games)에 연결된 모임이면 그 id와 이름.
   * 게임명 입력이 이 이름 그대로면 연결(game_id)을 유지하고, 바꾸면 직접 입력(game_name)으로 보낸다.
   */
  linkedGame: { id: string; name: string } | null;
  title: string;
  /** KST 날짜 'YYYY-MM-DD' */
  date: string;
  /** KST 시각 'HH:mm' */
  time: string;
  durationMinutes: string;
  regionCode: RegionCode | '';
  /** 공개 공간 선택(없으면 '장소 미정'). 선택한 권역의 공간만 고를 수 있다 */
  venueId: string | null;
  venueNote: string;
  minParticipants: string;
  maxParticipants: string;
  skillLevel: SkillLevel;
  approvalMode: ApprovalMode;
  allowWaitlist: boolean;
  description: string;
  notice: string;
  holdemPolicyAgreed: boolean;
}

export type MeetingFormField = keyof MeetingFormValues;
export type MeetingFormErrors = Partial<Record<MeetingFormField, string>>;

export interface MeetingSchemaContext {
  now: Date;
  /** 수정: 원래 시작 시각. 바뀌지 않았으면 30분~90일 규칙을 적용하지 않는다(서버와 동일) */
  originalStartAt?: string | null;
  /** 수정: 현재 확정 인원(모임장 포함). 정원을 이보다 줄일 수 없다 */
  confirmedCount?: number;
  /** 공간 선택 검사용(공개 공간 목록·원래 공간). 없으면 공간 검사를 건너뛴다(서버가 다시 검사) */
  venueSelection?: VenueSelectionContext;
}

export const HOLDEM_CATEGORY_ID: CategoryId = 'holdem_social';

export const MEETING_FIELD_MESSAGES = {
  categoryId: '게임 장르를 골라 주세요.',
  gameName: `게임명은 ${L.gameNameMax}자까지 쓸 수 있어요.`,
  titleRequired: '모임 제목을 입력해 주세요.',
  titleRange: `제목은 ${L.titleMin}자 이상 ${L.titleMax}자 이하로 써 주세요.`,
  date: '날짜를 골라 주세요.',
  time: '시작 시간을 골라 주세요.',
  startWindow: `시작 시각은 지금부터 ${L.startLeadMinutes}분 뒤부터 ${L.startMaxDays}일 안으로 정해 주세요.`,
  durationMinutes: '예상 소요 시간은 30분부터 12시간까지 고를 수 있어요.',
  regionCode: '모임 권역을 골라 주세요.',
  venueNote: `장소 메모는 ${L.venueNoteMax}자까지 쓸 수 있어요.`,
  maxParticipants: `정원은 모임장을 포함해 ${L.participantsMin}명부터 ${L.participantsMax}명까지 정할 수 있어요.`,
  minParticipants: `최소 인원은 ${L.participantsMin}명 이상, 정원 이하로 정해 주세요.`,
  description: `소개는 ${L.descriptionMax}자까지 쓸 수 있어요.`,
  notice: `유의사항은 ${L.noticeMax}자까지 쓸 수 있어요.`,
  holdemPolicyAgreed: '베팅·환전·상금·경품이 없는 비금전 모임으로 진행한다는 안내에 동의해 주세요.',
  capacity: (confirmed: number) => `현재 확정 인원 ${confirmed}명보다 적게 줄일 수 없어요.`,
  skillLevel: '진행 수준을 골라 주세요.',
  approvalMode: '참가 승인 방식을 골라 주세요.',
} as const;

const M = MEETING_FIELD_MESSAGES;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const SKILL_LEVELS = ['beginner_welcome', 'anyone', 'experienced'] as const;
const APPROVAL_MODES = ['auto', 'manual'] as const;

const maxChars = (max: number, message: string) =>
  z
    .string()
    .transform((value) => value.trim())
    .refine((value) => charLength(value) <= max, { message });

const integerString = (message: string) =>
  z
    .string()
    .trim()
    .regex(/^\d{1,4}$/, { message })
    .transform((value) => Number(value));

/** 날짜·시간 입력을 KST로 해석한 시작 시각(ms). 형식이 틀리면 null */
export function startMsFromForm(date: string, time: string): number | null {
  if (!isValidDateKey(date) || !TIME_PATTERN.test(time)) return null;
  return Date.parse(kstDateTimeToIso(date, time));
}

interface CrossFieldInput {
  categoryId: string;
  regionCode: string;
  venueId: string | null;
  date: string;
  time: string;
  minParticipants: number;
  maxParticipants: number;
  holdemPolicyAgreed: boolean;
}

/**
 * 여러 필드를 함께 보는 규칙(최소 ≤ 정원, 정원 ≥ 확정 인원, 시작 시각 범위, 홀덤 동의).
 * Zod는 필드 오류가 있으면 superRefine을 건너뛰므로, validateMeetingForm에서도 같은 함수를 호출해
 * 한 번 제출로 모든 오류를 보여준다.
 */
function crossFieldIssues(value: CrossFieldInput, context: MeetingSchemaContext): { path: [MeetingFormField]; message: string }[] {
  const issues: { path: [MeetingFormField]; message: string }[] = [];
  const { minParticipants: min, maxParticipants: max } = value;
  if (!Number.isInteger(min) || min < L.participantsMin || (Number.isInteger(max) && min > max)) {
    issues.push({ path: ['minParticipants'], message: M.minParticipants });
  }
  if (context.confirmedCount !== undefined && Number.isInteger(max) && max < context.confirmedCount) {
    issues.push({ path: ['maxParticipants'], message: M.capacity(context.confirmedCount) });
  }
  const startMs = startMsFromForm(value.date, value.time);
  if (startMs !== null) {
    const unchanged = context.originalStartAt != null && Date.parse(context.originalStartAt) === startMs;
    const nowMs = context.now.getTime();
    const earliest = nowMs + L.startLeadMinutes * 60_000;
    const latest = nowMs + L.startMaxDays * 24 * 60 * 60_000;
    if (!unchanged && (startMs < earliest || startMs > latest)) {
      // 날짜 자체가 고를 수 있는 범위 안이면 시간 문제로 안내한다.
      const range = selectableDateRange(context.now);
      const dateInRange = value.date >= range.min && value.date <= range.max;
      issues.push({ path: [dateInRange ? 'time' : 'date'], message: M.startWindow });
    }
  }
  if (value.categoryId === HOLDEM_CATEGORY_ID && !value.holdemPolicyAgreed) {
    issues.push({ path: ['holdemPolicyAgreed'], message: M.holdemPolicyAgreed });
  }
  if (context.venueSelection && value.venueId) {
    const region = isRegionCode(value.regionCode) ? value.regionCode : '';
    const message = validateVenueSelection(value.venueId, region, context.venueSelection);
    if (message) issues.push({ path: ['venueId'], message });
  }
  return issues;
}

function parseIntegerField(value: string): number {
  return /^\d{1,4}$/.test(value.trim()) ? Number(value.trim()) : Number.NaN;
}

export function createMeetingFormSchema(context: MeetingSchemaContext) {
  return z
    .object({
      categoryId: z.custom<CategoryId>((value) => isCategoryId(value), { message: M.categoryId }),
      gameName: maxChars(L.gameNameMax, M.gameName),
      linkedGame: z.object({ id: z.string().min(1), name: z.string() }).nullable(),
      title: z
        .string()
        .transform((value) => value.trim())
        .refine((value) => value.length > 0, { message: M.titleRequired, abort: true })
        .refine((value) => charLength(value) >= L.titleMin && charLength(value) <= L.titleMax, { message: M.titleRange }),
      date: z.string().refine((value) => isValidDateKey(value), { message: M.date }),
      time: z.string().regex(TIME_PATTERN, { message: M.time }),
      durationMinutes: integerString(M.durationMinutes).refine(
        (value) => value >= L.durationMin && value <= L.durationMax,
        { message: M.durationMinutes },
      ),
      regionCode: z.custom<RegionCode>((value) => isRegionCode(value), { message: M.regionCode }),
      venueId: z.string().min(1).nullable(),
      venueNote: maxChars(L.venueNoteMax, M.venueNote),
      minParticipants: integerString(M.minParticipants),
      maxParticipants: integerString(M.maxParticipants).refine(
        (value) => value >= L.participantsMin && value <= L.participantsMax,
        { message: M.maxParticipants },
      ),
      skillLevel: z.enum(SKILL_LEVELS, { message: M.skillLevel }),
      approvalMode: z.enum(APPROVAL_MODES, { message: M.approvalMode }),
      allowWaitlist: z.boolean(),
      description: maxChars(L.descriptionMax, M.description),
      notice: maxChars(L.noticeMax, M.notice),
      holdemPolicyAgreed: z.boolean(),
    })
    .superRefine((value, ctx) => {
      for (const issue of crossFieldIssues(value, context)) ctx.addIssue({ code: 'custom', ...issue });
    })
    .transform(
      (value): MeetingInput => ({
        categoryId: value.categoryId,
        // 게임명을 바꾸지 않았으면 등록된 게임 연결을 유지(game_id), 바꿨으면 직접 입력 이름(game_name)
        ...(value.linkedGame && value.gameName === value.linkedGame.name.trim()
          ? { gameId: value.linkedGame.id, gameName: null }
          : { gameId: null, gameName: value.gameName || null }),
        title: value.title,
        description: value.description,
        notice: value.notice || null,
        startAt: kstDateTimeToIso(value.date, value.time),
        durationMinutes: value.durationMinutes,
        regionCode: value.regionCode,
        venueId: value.venueId,
        venueNote: value.venueNote || null,
        minParticipants: value.minParticipants,
        maxParticipants: value.maxParticipants,
        skillLevel: value.skillLevel,
        approvalMode: value.approvalMode,
        allowWaitlist: value.allowWaitlist,
        holdemPolicyAgreed: value.categoryId === HOLDEM_CATEGORY_ID ? value.holdemPolicyAgreed : false,
      }),
    );
}

export type MeetingFormResult = { ok: true; input: MeetingInput } | { ok: false; errors: MeetingFormErrors };

/** 폼 값 검증 → 서버로 보낼 입력 또는 필드별 첫 오류 문구 */
export function validateMeetingForm(values: MeetingFormValues, context: MeetingSchemaContext): MeetingFormResult {
  const result = createMeetingFormSchema(context).safeParse(values);
  if (result.success) return { ok: true, input: result.data };
  const issues: { path: PropertyKey[]; message: string }[] = [
    ...result.error.issues,
    // 필드 오류 때문에 건너뛴 교차 검사도 함께 보여준다(같은 필드는 먼저 나온 문구만).
    ...crossFieldIssues(
      {
        ...values,
        minParticipants: parseIntegerField(values.minParticipants),
        maxParticipants: parseIntegerField(values.maxParticipants),
      },
      context,
    ),
  ];
  const errors: MeetingFormErrors = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field === 'string' && field in values && !errors[field as MeetingFormField]) {
      errors[field as MeetingFormField] = issue.message;
    }
  }
  return { ok: false, errors };
}

/** 화면 위→아래 순서(첫 오류 포커스용). MeetingForm의 배치와 같게 유지한다. */
export const MEETING_FIELD_ORDER: readonly MeetingFormField[] = [
  'categoryId',
  'holdemPolicyAgreed',
  'gameName',
  'title',
  'date',
  'time',
  'durationMinutes',
  'regionCode',
  'venueId',
  'venueNote',
  'maxParticipants',
  'skillLevel',
  'approvalMode',
  'description',
  'minParticipants',
  'allowWaitlist',
  'notice',
];

/** '추가 설정'(접힘)에 있는 필드 */
export const ADVANCED_MEETING_FIELDS: ReadonlySet<MeetingFormField> = new Set([
  'minParticipants',
  'allowWaitlist',
  'notice',
]);

export function firstErrorField(errors: MeetingFormErrors): MeetingFormField | null {
  return MEETING_FIELD_ORDER.find((field) => errors[field]) ?? null;
}

/** 서버 오류 detail(DB 필드 이름, snake_case 또는 camelCase) → 폼 필드 */
const SERVER_FIELD_MAP: Readonly<Record<string, MeetingFormField>> = {
  category_id: 'categoryId',
  game_name: 'gameName',
  title: 'title',
  description: 'description',
  notice: 'notice',
  start_at: 'date',
  duration_minutes: 'durationMinutes',
  region_code: 'regionCode',
  venue_id: 'venueId',
  venue_note: 'venueNote',
  game: 'gameName',
  game_id: 'gameName',
  min_participants: 'minParticipants',
  max_participants: 'maxParticipants',
  skill_level: 'skillLevel',
  approval_mode: 'approvalMode',
  allow_waitlist: 'allowWaitlist',
  holdem_policy_agreed: 'holdemPolicyAgreed',
};

const SERVER_FIELD_MESSAGES: Partial<Record<MeetingFormField, string>> = {
  categoryId: M.categoryId,
  gameName: M.gameName,
  title: M.titleRange,
  description: M.description,
  notice: M.notice,
  date: M.startWindow,
  durationMinutes: M.durationMinutes,
  regionCode: M.regionCode,
  venueId: '선택한 공간을 지금은 고를 수 없어요. 공간이 비공개로 바뀌었거나 권역이 다를 수 있어요.',
  venueNote: M.venueNote,
  minParticipants: M.minParticipants,
  maxParticipants: M.maxParticipants,
  skillLevel: M.skillLevel,
  approvalMode: M.approvalMode,
  allowWaitlist: '대기 신청 허용 여부를 다시 확인해 주세요.',
  holdemPolicyAgreed: M.holdemPolicyAgreed,
};

function toCamel(value: string): string {
  return value.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
}

/**
 * 서버(mock 포함) 오류를 폼 필드 오류로 바꾼다. 필드에 연결할 수 없으면 null(폼 전체 오류로 보여준다).
 * confirmedCount는 정원 축소 오류 문구에 쓴다.
 */
export function mapServerErrorToField(
  error: unknown,
  confirmedCount?: number,
): { field: MeetingFormField; message: string } | null {
  const code = getErrorCode(error);
  if (code === 'HOLDEM_AGREEMENT_REQUIRED') return { field: 'holdemPolicyAgreed', message: M.holdemPolicyAgreed };
  if (code === 'CAPACITY_BELOW_CONFIRMED') {
    return {
      field: 'maxParticipants',
      message: confirmedCount !== undefined ? M.capacity(confirmedCount) : '확정 인원보다 적게 정원을 줄일 수 없어요.',
    };
  }
  if (code !== 'VALIDATION_FAILED' || !isDataAdapterError(error) || !error.detail) return null;
  const detail = error.detail.trim();
  const field = SERVER_FIELD_MAP[detail] ?? (toCamel(detail) as MeetingFormField);
  if ((detail === 'game' || detail === 'game_id') && field === 'gameName') {
    return { field, message: '게임 정보를 다시 확인해 주세요. 게임명을 직접 입력해도 돼요.' };
  }
  const message = SERVER_FIELD_MESSAGES[field];
  return message ? { field, message } : null;
}

/* ------------------------------------------------------------------ */
/* 기본값·선택지                                                         */
/* ------------------------------------------------------------------ */

/** 날짜 입력에서 고를 수 있는 범위(KST): 오늘 ~ 오늘 + 90일 */
export function selectableDateRange(now: Date): { min: string; max: string } {
  const today = toKstDateKey(now);
  return { min: today, max: addDaysToDateKey(today, L.startMaxDays) };
}

/** 30분 단위 시각 선택지 '00:00' ~ '23:30' (+ 격자 밖의 기존 값) */
export function timeOptions(extra?: string): string[] {
  const options = Array.from({ length: 48 }, (_, index) => {
    const hour = Math.floor(index / 2);
    return `${String(hour).padStart(2, '0')}:${index % 2 === 0 ? '00' : '30'}`;
  });
  if (extra && TIME_PATTERN.test(extra) && !options.includes(extra)) {
    options.push(extra);
    options.sort();
  }
  return options;
}

/** 소요 시간 선택지(분): 30 ~ 720, 30분 단위 */
export function durationOptions(): number[] {
  const count = (L.durationMax - L.durationMin) / L.durationStep + 1;
  return Array.from({ length: count }, (_, index) => L.durationMin + index * L.durationStep);
}

/** 정원 선택지: 2 ~ 30 */
export function participantOptions(): number[] {
  return Array.from({ length: L.participantsMax - L.participantsMin + 1 }, (_, index) => L.participantsMin + index);
}

/** 새 모임 기본값: 내일(KST) 19:00, 2시간, 정원 6명(모임장 포함), 최소 2명, 대기 허용 */
export function createDefaultMeetingValues(now: Date): MeetingFormValues {
  return {
    categoryId: '',
    gameName: '',
    linkedGame: null,
    title: '',
    date: addDaysToDateKey(toKstDateKey(now), 1),
    time: '19:00',
    durationMinutes: '120',
    regionCode: '',
    venueId: null,
    venueNote: '',
    minParticipants: '2',
    maxParticipants: '6',
    skillLevel: 'beginner_welcome',
    approvalMode: 'auto',
    allowWaitlist: true,
    description: '',
    notice: '',
    holdemPolicyAgreed: false,
  };
}

/** 수정 화면 초기값. 이미 홀덤 모임이면 생성 때 동의했으므로 동의 상태로 시작한다. */
export function meetingToFormValues(meeting: Meeting): MeetingFormValues {
  return {
    categoryId: meeting.categoryId,
    gameName: meeting.gameName ?? '',
    linkedGame: meeting.gameId && meeting.gameName ? { id: meeting.gameId, name: meeting.gameName } : null,
    title: meeting.title,
    date: toKstDateKey(meeting.startAt),
    time: formatKstTime(meeting.startAt),
    durationMinutes: String(meeting.durationMinutes),
    regionCode: meeting.regionCode,
    venueId: meeting.venueId,
    venueNote: meeting.venueNote ?? '',
    minParticipants: String(meeting.minParticipants),
    maxParticipants: String(meeting.maxParticipants),
    skillLevel: meeting.skillLevel,
    approvalMode: meeting.approvalMode,
    allowWaitlist: meeting.allowWaitlist,
    description: meeting.description,
    notice: meeting.notice ?? '',
    holdemPolicyAgreed: meeting.categoryId === HOLDEM_CATEGORY_ID,
  };
}
