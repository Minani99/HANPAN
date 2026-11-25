import { afterAll, describe, expect, it } from 'vitest';
import {
  addDaysToDateKey,
  formatDuration,
  formatKstClock,
  formatMeetingSchedule,
  formatDateKeyLong,
  formatDateKeyShort,
  formatFullDateTime,
  formatKstTime,
  formatMeetingDateTime,
  isValidDateKey,
  kstDateTimeToIso,
  kstDayRange,
  nextKstDays,
  toKstDateKey,
} from './date';

const ORIGINAL_TZ = process.env.TZ;

afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

/** 시스템 시간대를 바꿔 실행. 실제로 바뀌었는지(오프셋) 먼저 확인해 테스트가 헛돌지 않게 한다. */
function inTimeZone(timeZone: string, expectedJanOffsetMinutes: number, run: () => void) {
  process.env.TZ = timeZone;
  expect(new Date('2026-01-15T00:00:00Z').getTimezoneOffset()).toBe(expectedJanOffsetMinutes);
  run();
}

function runCoreAssertions() {
  // UTC 15:00 = KST 다음 날 00:00 경계
  expect(toKstDateKey('2026-11-28T14:59:59Z')).toBe('2026-11-28');
  expect(toKstDateKey('2026-11-28T15:00:00Z')).toBe('2026-11-29');
  expect(toKstDateKey('2026-11-28T15:30:00Z')).toBe('2026-11-29');
  expect(toKstDateKey(new Date('2026-12-31T15:00:00Z'))).toBe('2027-01-01');

  expect(kstDayRange('2026-11-29')).toEqual({
    startIso: '2026-11-28T15:00:00.000Z',
    endIso: '2026-11-29T15:00:00.000Z',
  });

  expect(formatMeetingDateTime('2026-11-28T10:00:00Z')).toBe('11.28 (토) · 19:00');
  expect(formatMeetingDateTime('2026-11-28T15:30:00Z')).toBe('11.29 (일) · 00:30');
  expect(formatFullDateTime('2026-11-28T10:00:00Z')).toBe('2026년 11월 28일 (토) 오후 7:00');
  expect(formatFullDateTime('2026-11-28T15:05:00Z')).toBe('2026년 11월 29일 (일) 오전 12:05');
  expect(formatFullDateTime('2026-11-29T03:00:00Z')).toBe('2026년 11월 29일 (일) 오후 12:00');
  expect(formatKstTime('2026-11-28T23:45:00Z')).toBe('08:45');

  expect(kstDateTimeToIso('2026-11-28', '19:00')).toBe('2026-11-28T10:00:00.000Z');
  expect(kstDateTimeToIso('2026-11-29', '00:30')).toBe('2026-11-28T15:30:00.000Z');

  const days = nextKstDays(new Date('2026-11-28T15:30:00Z'), 7);
  expect(days.map((day) => day.key)).toEqual([
    '2026-11-29',
    '2026-11-30',
    '2026-12-01',
    '2026-12-02',
    '2026-12-03',
    '2026-12-04',
    '2026-12-05',
  ]);
  expect(days[0]).toMatchObject({ weekday: '일', label: '11.29', isToday: true });
  expect(days[1]).toMatchObject({ weekday: '월', label: '11.30', isToday: false });
}

describe('lib/date (KST)', () => {
  it('UTC 15:00 경계와 형식을 KST 기준으로 계산한다 (현재 시스템 시간대)', () => {
    runCoreAssertions();
  });

  it('시스템 시간대가 UTC여도 결과가 같다', () => {
    inTimeZone('UTC', 0, runCoreAssertions);
  });

  it('시스템 시간대가 America/Los_Angeles여도 결과가 같다', () => {
    inTimeZone('America/Los_Angeles', 480, runCoreAssertions);
  });

  it('시스템 시간대가 Asia/Seoul이어도 결과가 같다', () => {
    inTimeZone('Asia/Seoul', -540, runCoreAssertions);
  });

  it('LA 서머타임 기간(여름)에도 KST 계산이 흔들리지 않는다', () => {
    inTimeZone('America/Los_Angeles', 480, () => {
      expect(new Date('2026-07-01T00:00:00Z').getTimezoneOffset()).toBe(420);
      expect(toKstDateKey('2026-07-01T15:00:00Z')).toBe('2026-07-02');
      expect(kstDayRange('2026-07-02').startIso).toBe('2026-07-01T15:00:00.000Z');
    });
  });

  it('날짜 키를 검증한다', () => {
    expect(isValidDateKey('2026-11-28')).toBe(true);
    expect(isValidDateKey('2028-02-29')).toBe(true);
    expect(isValidDateKey('2026-02-29')).toBe(false);
    expect(isValidDateKey('2026-13-01')).toBe(false);
    expect(isValidDateKey('2026-1-1')).toBe(false);
    expect(isValidDateKey('')).toBe(false);
    expect(isValidDateKey(null)).toBe(false);
    expect(isValidDateKey('2026-11-28T00:00')).toBe(false);
  });

  it('달력 연산과 짧은/긴 표기', () => {
    expect(addDaysToDateKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToDateKey('2026-03-01', -1)).toBe('2026-02-28');
    expect(formatDateKeyShort('2026-12-05')).toBe('12.05');
    expect(formatDateKeyLong('2026-12-05')).toBe('12월 5일 토요일');
  });

  it('잘못된 입력은 RangeError', () => {
    expect(() => toKstDateKey('not-a-date')).toThrow(RangeError);
    expect(() => kstDayRange('2026-02-30')).toThrow(RangeError);
    expect(() => kstDateTimeToIso('2026-11-28', '24:00')).toThrow(RangeError);
  });

  it('kstDateTimeToIso: 날짜·시각 입력을 KST로 해석한다 (시스템 시간대 무관)', () => {
    const assertions = () => {
      expect(kstDateTimeToIso('2026-11-28', '19:00')).toBe('2026-11-28T10:00:00.000Z');
      expect(kstDateTimeToIso('2026-11-29', '00:00')).toBe('2026-11-28T15:00:00.000Z');
      expect(kstDateTimeToIso('2026-11-28', '08:59')).toBe('2026-11-27T23:59:00.000Z');
      expect(kstDateTimeToIso('2027-01-01', '00:30')).toBe('2026-12-31T15:30:00.000Z');
      expect(kstDateTimeToIso('2028-02-29', '12:00')).toBe('2028-02-29T03:00:00.000Z');
      // 미국 서머타임 전환일에도 영향을 받지 않는다
      expect(kstDateTimeToIso('2026-03-08', '10:00')).toBe('2026-03-08T01:00:00.000Z');
      // 왕복: KST 날짜 키·시각으로 되돌리면 같은 값
      const iso = kstDateTimeToIso('2026-12-05', '21:30');
      expect(toKstDateKey(iso)).toBe('2026-12-05');
      expect(formatKstTime(iso)).toBe('21:30');
    };
    for (const [tz, offset] of [
      ['UTC', 0],
      ['America/Los_Angeles', 480],
      ['Asia/Seoul', -540],
      ['Pacific/Kiritimati', -840],
    ] as const) {
      inTimeZone(tz, offset, assertions);
    }
    expect(() => kstDateTimeToIso('2026-11-28', '7:00')).toThrow(RangeError);
    expect(() => kstDateTimeToIso('2026-11-31', '07:00')).toThrow(RangeError);
  });

  it('상세 일정·소요 시간 표기', () => {
    expect(formatKstClock('2026-11-28T10:00:00Z')).toBe('오후 7:00');
    expect(formatMeetingSchedule('2026-11-28T10:00:00Z', '2026-11-28T13:00:00Z')).toEqual({
      date: '2026년 11월 28일 (토)',
      time: '오후 7:00 ~ 오후 10:00',
    });
    expect(formatMeetingSchedule('2026-11-28T14:00:00Z', '2026-11-28T16:00:00Z')).toEqual({
      date: '2026년 11월 28일 (토)',
      time: '오후 11:00 ~ 11월 29일 (일) 오전 1:00',
    });
    expect(formatDuration(30)).toBe('30분');
    expect(formatDuration(120)).toBe('2시간');
    expect(formatDuration(150)).toBe('2시간 30분');
    expect(formatDuration(720)).toBe('12시간');
  });
});
