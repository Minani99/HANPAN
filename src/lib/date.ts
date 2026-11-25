/**
 * 한국 표준시(Asia/Seoul) 기준 날짜 유틸.
 * 모든 계산은 Intl.DateTimeFormat에 timeZone을 명시해 실행 환경(브라우저/서버/CI)의 시간대와 무관하게 동작한다.
 * 서버에는 timestamptz(UTC ISO)로 저장하고, 화면 표시와 날짜 필터만 KST로 해석한다.
 */

export const KST_TIME_ZONE = 'Asia/Seoul';

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'] as const;
const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const kstPartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: KST_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
});

export interface KstParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  second: number;
  weekday: number; // 0(일) - 6(토)
}

function toDate(input: string | Date): Date {
  const date = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`유효하지 않은 날짜입니다: ${String(input)}`);
  }
  return date;
}

/** 주어진 시각을 KST 달력/시계 값으로 분해한다. */
export function getKstParts(input: string | Date): KstParts {
  const parts = kstPartsFormatter.formatToParts(toDate(input));
  const lookup = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';

  return {
    year: Number(lookup('year')),
    month: Number(lookup('month')),
    day: Number(lookup('day')),
    hour: Number(lookup('hour')) % 24,
    minute: Number(lookup('minute')),
    second: Number(lookup('second')),
    weekday: WEEKDAY_INDEX[lookup('weekday')] ?? 0,
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function toDateKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

/** 'YYYY-MM-DD' 형식이면서 실제 달력에 있는 날짜인지 */
export function isValidDateKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE_KEY_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day
  );
}

function parseDateKey(dateKey: string): { year: number; month: number; day: number } {
  if (!isValidDateKey(dateKey)) {
    throw new RangeError(`유효하지 않은 날짜 키입니다: ${dateKey}`);
  }
  const [year, month, day] = dateKey.split('-').map(Number) as [number, number, number];
  return { year, month, day };
}

/** 시각(ISO 또는 Date)이 KST로 어느 날짜인지 'YYYY-MM-DD'로 반환 */
export function toKstDateKey(input: string | Date): string {
  const { year, month, day } = getKstParts(input);
  return toDateKey(year, month, day);
}

/** 달력 날짜 키에 일 수를 더한다(시간대와 무관한 순수 달력 연산). */
export function addDaysToDateKey(dateKey: string, days: number): string {
  const { year, month, day } = parseDateKey(dateKey);
  const probe = new Date(Date.UTC(year, month - 1, day + days));
  return toDateKey(probe.getUTCFullYear(), probe.getUTCMonth() + 1, probe.getUTCDate());
}

/** 날짜 키의 요일(0=일 ~ 6=토) */
export function getDateKeyWeekday(dateKey: string): number {
  const { year, month, day } = parseDateKey(dateKey);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function getWeekdayLabel(weekday: number): string {
  return WEEKDAY_KO[weekday] ?? '';
}

/**
 * KST 벽시계 시각을 UTC epoch(ms)로 변환한다.
 * Intl로 해당 시점의 KST 오프셋을 구해 보정한다(오프셋이 바뀌는 시간대도 견디도록 2회 보정).
 */
function kstWallTimeToEpoch(year: number, month: number, day: number, hour: number, minute: number): number {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wallAsUtc;
  for (let i = 0; i < 2; i += 1) {
    const p = getKstParts(new Date(guess));
    const observedAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess += wallAsUtc - observedAsUtc;
  }
  return guess;
}

/** KST 날짜 키 + 'HH:MM'을 UTC ISO 문자열로 변환 */
export function kstDateTimeToIso(dateKey: string, time: string): string {
  const { year, month, day } = parseDateKey(dateKey);
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) throw new RangeError(`유효하지 않은 시각입니다: ${time}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new RangeError(`유효하지 않은 시각입니다: ${time}`);
  return new Date(kstWallTimeToEpoch(year, month, day, hour, minute)).toISOString();
}

/** KST 하루 범위: 해당 날짜 00:00(포함) ~ 다음 날 00:00(제외), UTC ISO */
export function kstDayRange(dateKey: string): { startIso: string; endIso: string } {
  const { year, month, day } = parseDateKey(dateKey);
  const start = kstWallTimeToEpoch(year, month, day, 0, 0);
  const next = parseDateKey(addDaysToDateKey(dateKey, 1));
  const end = kstWallTimeToEpoch(next.year, next.month, next.day, 0, 0);
  return { startIso: new Date(start).toISOString(), endIso: new Date(end).toISOString() };
}

export interface KstDay {
  /** 'YYYY-MM-DD' */
  key: string;
  /** '월' */
  weekday: string;
  /** '11.28' */
  label: string;
  /** '11월 28일 토요일' (스크린리더용) */
  longLabel: string;
  isToday: boolean;
}

/** 오늘(KST)부터 count일 */
export function nextKstDays(now: Date, count: number): KstDay[] {
  const todayKey = toKstDateKey(now);
  return Array.from({ length: Math.max(0, count) }, (_, index) => {
    const key = addDaysToDateKey(todayKey, index);
    return {
      key,
      weekday: getWeekdayLabel(getDateKeyWeekday(key)),
      label: formatDateKeyShort(key),
      longLabel: formatDateKeyLong(key),
      isToday: index === 0,
    };
  });
}

/** '2026-12-05' → '12.05' */
export function formatDateKeyShort(dateKey: string): string {
  const { month, day } = parseDateKey(dateKey);
  return `${pad2(month)}.${pad2(day)}`;
}

/** '2026-12-05' → '12월 5일 토요일' */
export function formatDateKeyLong(dateKey: string): string {
  const { month, day } = parseDateKey(dateKey);
  return `${month}월 ${day}일 ${getWeekdayLabel(getDateKeyWeekday(dateKey))}요일`;
}

/** 'HH:MM' (KST) */
export function formatKstTime(input: string | Date): string {
  const { hour, minute } = getKstParts(input);
  return `${pad2(hour)}:${pad2(minute)}`;
}

/** 목록용: '11.28 (토) · 19:00' (KST) */
export function formatMeetingDateTime(input: string | Date): string {
  const p = getKstParts(input);
  return `${pad2(p.month)}.${pad2(p.day)} (${getWeekdayLabel(p.weekday)}) · ${pad2(p.hour)}:${pad2(p.minute)}`;
}

function formatClockParts(p: Pick<KstParts, 'hour' | 'minute'>): string {
  const period = p.hour < 12 ? '오전' : '오후';
  const hour12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${period} ${hour12}:${pad2(p.minute)}`;
}

/** '오후 7:00' (KST) */
export function formatKstClock(input: string | Date): string {
  return formatClockParts(getKstParts(input));
}

/** '2026년 11월 28일 (토)' (KST) */
export function formatFullDate(input: string | Date): string {
  const p = getKstParts(input);
  return `${p.year}년 ${p.month}월 ${p.day}일 (${getWeekdayLabel(p.weekday)})`;
}

/** 상세용: '2026년 11월 28일 (토) 오후 7:00' (KST) */
export function formatFullDateTime(input: string | Date): string {
  return `${formatFullDate(input)} ${formatKstClock(input)}`;
}

/** 소요 시간: 30 → '30분', 120 → '2시간', 150 → '2시간 30분' */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest}분`;
  return rest === 0 ? `${hours}시간` : `${hours}시간 ${rest}분`;
}

/**
 * 상세 일정: { date: '2026년 11월 28일 (토)', time: '오후 7:00 ~ 오후 10:00' }
 * 종료가 다음 날(KST)이면 time에 날짜를 붙인다: '오후 11:00 ~ 11월 29일 (일) 오전 1:00'
 */
export function formatMeetingSchedule(startAt: string, endAt: string): { date: string; time: string } {
  const start = getKstParts(startAt);
  const end = getKstParts(endAt);
  const sameDay = start.year === end.year && start.month === end.month && start.day === end.day;
  const endLabel = sameDay
    ? formatClockParts(end)
    : `${end.month}월 ${end.day}일 (${getWeekdayLabel(end.weekday)}) ${formatClockParts(end)}`;
  return { date: formatFullDate(startAt), time: `${formatClockParts(start)} ~ ${endLabel}` };
}

/** 두 시각 차이(분) */
export function minutesBetween(startIso: string, endIso: string): number {
  return Math.round((Date.parse(endIso) - Date.parse(startIso)) / 60000);
}

export { DAY_MS };
