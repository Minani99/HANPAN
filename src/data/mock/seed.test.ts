import { describe, expect, it } from 'vitest';
import needles from '../../../scripts/seed-needles.json';
import { CATEGORY_IDS } from '../../domain/categories';
import { getMeetingPhase, isBelowMinimum } from '../../domain/meetingPhase';
import { nextKstDays, toKstDateKey } from '../../lib/date';
import { findCountMismatches } from './rules';
import { DEV_ACCOUNT_IDS, DEV_SEED_MARKER, createSeedDb, createSeedMeetings } from './seed';

const NOW = new Date('2026-11-23T03:00:00Z'); // KST 11-23(월) 12:00

describe('mock seed', () => {
  const records = createSeedMeetings(NOW);
  const visible = records.filter(
    (m) => !m.hidden && m.status !== 'cancelled' && Date.parse(m.startAt) > NOW.getTime(),
  );

  it('12~16개, 같은 기준 시각이면 같은 결과', () => {
    expect(records.length).toBeGreaterThanOrEqual(12);
    expect(records.length).toBeLessThanOrEqual(16);
    expect(createSeedMeetings(NOW)).toEqual(records);
    expect(new Set(records.map((m) => m.id)).size).toBe(records.length);
  });

  it('목록에 보이는 모임은 모두 앞으로 7일(KST) 안에 있다', () => {
    const window = new Set(nextKstDays(NOW, 7).map((day) => day.key));
    for (const meeting of visible) expect(window.has(toKstDateKey(meeting.startAt))).toBe(true);
  });

  it('필수 시나리오를 모두 포함한다', () => {
    expect(records.some((m) => m.title.length === 35)).toBe(true);
    expect(records.some((m) => (m.venueName ?? '').length === 30)).toBe(true);
    expect(records.some((m) => getMeetingPhase(m, NOW) === 'full')).toBe(true);
    expect(records.some((m) => getMeetingPhase(m, NOW) === 'open' && isBelowMinimum(m))).toBe(true);
    expect(records.some((m) => getMeetingPhase(m, NOW) === 'closed')).toBe(true);
    expect(records.some((m) => m.status === 'cancelled')).toBe(true);
    expect(records.some((m) => getMeetingPhase(m, NOW) === 'finished')).toBe(true);
    expect(records.some((m) => getMeetingPhase(m, NOW) === 'in_progress')).toBe(true);
    expect(records.some((m) => m.venueName === null)).toBe(true);
    expect(records.some((m) => m.hidden)).toBe(true);
    for (const categoryId of CATEGORY_IDS) {
      expect(visible.some((m) => m.categoryId === categoryId)).toBe(true);
    }
    expect(visible.filter((m) => m.categoryId === 'holdem_social').length).toBeGreaterThanOrEqual(1);
  });

  it('예시임이 분명한 제목·닉네임만 쓴다', () => {
    for (const meeting of records) {
      expect(meeting.title.startsWith('[예시]')).toBe(true);
      expect(meeting.hostNickname).toMatch(/^예시/);
      expect(meeting.imageUrl).toBeNull();
    }
  });

  it('정원·인원 값이 일관된다 (정원은 모임장 포함)', () => {
    for (const meeting of records) {
      expect(meeting.minParticipants).toBeGreaterThanOrEqual(2);
      expect(meeting.minParticipants).toBeLessThanOrEqual(meeting.maxParticipants);
      expect(meeting.confirmedCount).toBeGreaterThanOrEqual(1);
      expect(meeting.confirmedCount).toBeLessThanOrEqual(meeting.maxParticipants);
      expect(Date.parse(meeting.endAt) - Date.parse(meeting.startAt)).toBe(meeting.durationMinutes * 60_000);
    }
  });

  it('check:seed가 찾는 문자열과 seed가 동기화되어 있다', () => {
    expect(needles.marker).toBe(DEV_SEED_MARKER);
    const db = createSeedDb(NOW);
    const texts = [
      ...records.flatMap((m) => [m.title, m.venueName ?? '']),
      ...db.profiles.flatMap((p) => [p.nickname, p.devAccountDescription ?? '']),
    ];
    for (const value of needles.uniqueStrings) expect(texts).toContain(value);
  });

  it('개발용 테스트 계정 4개(일반 2·최초 설정 전 1·관리자 1), 닉네임은 예시임이 분명하다', () => {
    const db = createSeedDb(NOW);
    const accounts = db.profiles.filter((p) => p.devAccountDescription);
    expect(accounts.map((p) => p.id).sort()).toEqual(Object.values(DEV_ACCOUNT_IDS).sort());
    for (const account of accounts) expect(account.nickname).toMatch(/^예시/);
    expect(accounts.filter((p) => p.termsAgreedAt === null).map((p) => p.id)).toEqual([DEV_ACCOUNT_IDS.newcomer]);
    expect(accounts.filter((p) => p.isAdmin).map((p) => p.id)).toEqual([DEV_ACCOUNT_IDS.admin]);
    // 예시 게스트·모임장도 모두 '예시'로 시작한다
    for (const profile of db.profiles) expect(profile.nickname).toMatch(/^예시/);
  });

  it('참가 행이 인원 수와 정확히 맞는다(취소된 모임은 1/0/0)', () => {
    const db = createSeedDb(NOW);
    expect(findCountMismatches(db)).toEqual([]);
    const cancelled = db.meetings.find((m) => m.status === 'cancelled');
    expect(cancelled).toMatchObject({ confirmedCount: 1, pendingCount: 0, waitlistCount: 0 });
    expect(createSeedDb(NOW)).toEqual(db);
  });
});
