import { describe, expect, it } from 'vitest';
import { createSeedDb, DEV_ACCOUNT_IDS } from '../data/mock/seed';
import { viewMyMeetings } from '../data/mock/rules';
import { classifyHosted, classifyJoined, parseMyMeetingsRole, parseMyMeetingsTab } from './myMeetings';

const NOW = new Date('2026-11-23T03:00:00Z');

describe('domain/myMeetings', () => {
  const mine = viewMyMeetings(createSeedDb(NOW), DEV_ACCOUNT_IDS.hostA);

  it('참가한 모임: 예정·대기·완료·취소 분류', () => {
    const tabOf = (meetingId: string) => {
      const entry = mine.joined.find((item) => item.participation.meetingId === meetingId);
      if (!entry) throw new Error(meetingId);
      return classifyJoined(entry, NOW);
    };
    expect(tabOf('seed-meeting-02')).toBe('upcoming'); // confirmed, 시작 전
    expect(tabOf('seed-meeting-03')).toBe('waiting'); // waitlisted
    expect(tabOf('seed-meeting-11')).toBe('done'); // confirmed, 종료
    expect(tabOf('seed-meeting-10')).toBe('cancelled'); // meeting_cancelled
    expect(tabOf('seed-meeting-09')).toBe('cancelled'); // rejected
  });

  it('시작 때까지 확정되지 않은 신청은 취소, 읽을 수 없는 모임은 신청 상태로만 분류', () => {
    const entry = mine.joined.find((item) => item.participation.meetingId === 'seed-meeting-03')!;
    const started = { ...entry, meeting: { ...entry.meeting!, startAt: '2026-11-23T02:00:00Z', endAt: '2026-11-23T05:00:00Z' } };
    expect(classifyJoined(started, NOW)).toBe('cancelled');
    expect(classifyJoined({ ...entry, meeting: null }, NOW)).toBe('waiting');
  });

  it('내가 연 모임: 진행 중은 예정, 승인 대기가 있으면 대기에도 나온다', () => {
    const byId = new Map(mine.hosted.map((m) => [m.id, m]));
    expect(classifyHosted(byId.get('seed-meeting-12')!, NOW)).toEqual(['upcoming']);
    expect(classifyHosted(byId.get('seed-meeting-13')!, NOW)).toEqual(['upcoming', 'waiting']);
    expect(classifyHosted({ ...byId.get('seed-meeting-13')!, status: 'cancelled' }, NOW)).toEqual(['cancelled']);
  });

  it('URL 값 파싱(잘못된 값은 기본값)', () => {
    expect(parseMyMeetingsRole('hosted')).toBe('hosted');
    expect(parseMyMeetingsRole('x')).toBe('applied');
    expect(parseMyMeetingsTab('done')).toBe('done');
    expect(parseMyMeetingsTab(null)).toBe('upcoming');
  });
});
