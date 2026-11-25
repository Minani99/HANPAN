import { describe, expect, it } from 'vitest';
import { getMeetingPhase, isBelowMinimum, isRecruiting, remainingSeats } from './meetingPhase';

const NOW = new Date('2026-11-28T10:00:00Z');

function meeting(overrides: Partial<Parameters<typeof getMeetingPhase>[0]> = {}) {
  return {
    status: 'open' as const,
    startAt: '2026-11-29T10:00:00Z',
    endAt: '2026-11-29T12:00:00Z',
    confirmedCount: 3,
    maxParticipants: 6,
    ...overrides,
  };
}

describe('domain/meetingPhase', () => {
  it('기본은 open', () => {
    expect(getMeetingPhase(meeting(), NOW)).toBe('open');
    expect(isRecruiting(meeting(), NOW)).toBe(true);
  });

  it('정원이 차면 full', () => {
    expect(getMeetingPhase(meeting({ confirmedCount: 6 }), NOW)).toBe('full');
    expect(getMeetingPhase(meeting({ confirmedCount: 7 }), NOW)).toBe('full');
  });

  it('모임장이 마감하면 closed (full보다 우선)', () => {
    expect(getMeetingPhase(meeting({ status: 'closed', confirmedCount: 6 }), NOW)).toBe('closed');
  });

  it('시작 시각이 되면 in_progress (closed보다 우선)', () => {
    const started = meeting({ status: 'closed', startAt: '2026-11-28T10:00:00Z', endAt: '2026-11-28T12:00:00Z' });
    expect(getMeetingPhase(started, NOW)).toBe('in_progress');
  });

  it('종료 시각이 지나면 finished (in_progress보다 우선)', () => {
    const ended = meeting({ startAt: '2026-11-28T07:00:00Z', endAt: '2026-11-28T10:00:00Z' });
    expect(getMeetingPhase(ended, NOW)).toBe('finished');
  });

  it('취소는 모든 상태보다 우선', () => {
    const cancelledPast = meeting({ status: 'cancelled', startAt: '2026-11-20T07:00:00Z', endAt: '2026-11-20T10:00:00Z' });
    expect(getMeetingPhase(cancelledPast, NOW)).toBe('cancelled');
    expect(getMeetingPhase(meeting({ status: 'cancelled', confirmedCount: 6 }), NOW)).toBe('cancelled');
    expect(isRecruiting(meeting({ status: 'cancelled' }), NOW)).toBe(false);
  });

  it('remainingSeats는 음수가 되지 않는다', () => {
    expect(remainingSeats({ confirmedCount: 5, maxParticipants: 8 })).toBe(3);
    expect(remainingSeats({ confirmedCount: 8, maxParticipants: 8 })).toBe(0);
    expect(remainingSeats({ confirmedCount: 9, maxParticipants: 8 })).toBe(0);
  });

  it('isBelowMinimum', () => {
    expect(isBelowMinimum({ confirmedCount: 2, minParticipants: 4 })).toBe(true);
    expect(isBelowMinimum({ confirmedCount: 4, minParticipants: 4 })).toBe(false);
  });
});
