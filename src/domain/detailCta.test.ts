import { describe, expect, it } from 'vitest';
import type { Meeting, MyParticipation, ParticipantStatus, SessionUser } from '../data/types';
import { getDetailCta } from './detailCta';

const NOW = new Date('2026-11-23T03:00:00Z');

function meeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'm-1',
    hostId: 'host',
    hostNickname: '예시모임장',
    categoryId: 'party',
    gameName: null,
    title: '[예시] 모임',
    description: '',
    notice: null,
    startAt: '2026-11-25T10:00:00Z',
    endAt: '2026-11-25T12:00:00Z',
    durationMinutes: 120,
    regionCode: 'dunsan_tanbang',
    venueId: null,
    venueName: null,
    venueNote: null,
    minParticipants: 2,
    maxParticipants: 6,
    confirmedCount: 3,
    pendingCount: 0,
    waitlistCount: 0,
    skillLevel: 'anyone',
    approvalMode: 'auto',
    allowWaitlist: false,
    status: 'open',
    cancelReason: null,
    imageUrl: null,
    createdAt: '2026-11-20T00:00:00Z',
    ...overrides,
  };
}

const USER: SessionUser = { id: 'me', nickname: '나', onboarded: true, status: 'active', isAdmin: false };

function participation(status: ParticipantStatus): MyParticipation {
  return {
    id: 'p-1',
    meetingId: 'm-1',
    role: 'guest',
    status,
    attendance: 'unknown',
    message: null,
    appliedAt: '2026-11-21T00:00:00Z',
    confirmedAt: null,
    cancelledAt: null,
  };
}

function cta(options: { m?: Partial<Meeting>; p?: ParticipantStatus | null; user?: SessionUser | null; mode?: 'mock' | 'unconfigured' }) {
  return getDetailCta({
    mode: options.mode ?? 'mock',
    meeting: meeting(options.m),
    participation: options.p ? participation(options.p) : null,
    user: options.user === undefined ? USER : options.user,
    now: NOW,
  });
}

describe('domain/detailCta (UI_SPEC 상세 CTA 상태표)', () => {
  it('비로그인 → 로그인하고 신청하기 (마감이면 마감 표시)', () => {
    expect(cta({ user: null })).toMatchObject({ kind: 'login', label: '로그인하고 신청하기', action: 'login' });
    expect(cta({ user: null, m: { status: 'closed' } })).toMatchObject({ kind: 'closed', display: 'disabled' });
  });

  it('신청 가능: auto / manual 문구', () => {
    expect(cta({})).toMatchObject({ kind: 'apply', label: '참가 신청하기', note: '신청하면 바로 참가가 확정돼요.' });
    expect(cta({ m: { approvalMode: 'manual' } })).toMatchObject({
      label: '참가 신청하기 (승인제)',
      note: '모임장이 확인한 뒤 확정돼요.',
    });
  });

  it('정원 마감: 대기 허용이면 대기 신청, 아니면 비활성 + 사유', () => {
    expect(cta({ m: { confirmedCount: 6, allowWaitlist: true } })).toMatchObject({ kind: 'waitlist', label: '대기 신청하기' });
    expect(cta({ m: { confirmedCount: 6 } })).toMatchObject({ kind: 'full', display: 'disabled', note: '자리가 모두 찼어요.' });
    expect(cta({ m: { status: 'closed' } })).toMatchObject({ kind: 'closed', note: '모임장이 모집을 마감했어요.' });
  });

  it('내 신청 상태: 확정·승인 대기·대기(자동 확정 약속 없음)·거절', () => {
    expect(cta({ p: 'confirmed' })).toMatchObject({ kind: 'confirmed', label: '참가 확정', display: 'status', canCancel: true });
    expect(cta({ p: 'pending' })).toMatchObject({ kind: 'pending', label: '승인 대기 중', canCancel: true });
    const waitlisted = cta({ p: 'waitlisted', m: { confirmedCount: 6, allowWaitlist: true } });
    expect(waitlisted).toMatchObject({ kind: 'waitlisted', label: '대기 중', canCancel: true });
    expect(waitlisted.note).toContain('자동으로 확정되지 않아요');
    expect(cta({ p: 'rejected' })).toMatchObject({ kind: 'rejected', display: 'disabled' });
    // 본인이 취소한 신청은 다시 신청할 수 있다
    expect(cta({ p: 'cancelled' }).kind).toBe('apply');
    // 모임장이 마감해도 확정 상태는 그대로 보여준다
    expect(cta({ p: 'confirmed', m: { status: 'closed' } }).kind).toBe('confirmed');
  });

  it('진행 중·종료·취소됨 (취소 사유 표시)', () => {
    expect(cta({ m: { startAt: '2026-11-23T02:00:00Z', endAt: '2026-11-23T05:00:00Z' } })).toMatchObject({
      kind: 'in_progress',
      label: '진행 중인 모임',
    });
    expect(cta({ m: { startAt: '2026-11-22T02:00:00Z', endAt: '2026-11-22T05:00:00Z' } }).label).toBe('종료된 모임');
    expect(cta({ m: { status: 'cancelled', cancelReason: '비 소식' } })).toMatchObject({
      kind: 'cancelled',
      label: '취소된 모임',
      note: '취소 사유: 비 소식',
    });
    expect(cta({ user: null, m: { status: 'cancelled' } }).kind).toBe('cancelled');
  });

  it('본인 모임 → 참가자 관리 + 수정(시작 전·취소 전만)', () => {
    const host = { ...USER, id: 'host' };
    expect(cta({ user: host })).toMatchObject({ kind: 'host', label: '참가자 관리', action: 'manage', canEdit: true });
    expect(cta({ user: host, m: { status: 'cancelled' } }).canEdit).toBe(false);
    expect(cta({ user: host, m: { startAt: '2026-11-23T02:00:00Z', endAt: '2026-11-23T05:00:00Z' } }).canEdit).toBe(false);
  });

  it('최초 설정 전 → 닉네임 설정하고 신청하기, 이용 제한·탈퇴 요청 → 신청할 수 없는 계정', () => {
    expect(cta({ user: { ...USER, onboarded: false } })).toMatchObject({ kind: 'onboarding', action: 'onboarding' });
    expect(cta({ user: { ...USER, status: 'restricted' } })).toMatchObject({ kind: 'account_blocked', display: 'disabled' });
    expect(cta({ user: { ...USER, status: 'restricted' }, p: 'confirmed' }).kind).toBe('confirmed');
    expect(cta({ user: { ...USER, status: 'deletion_requested' }, p: 'confirmed' }).kind).toBe('account_blocked');
  });

  it('모임장 계정이 삭제된 모임(hostId null): 신청 대신 마감 표시, 내 확정 상태는 그대로', () => {
    expect(cta({ m: { hostId: null, hostNickname: null } })).toMatchObject({
      kind: 'closed',
      display: 'disabled',
      note: '모임장이 탈퇴해 신청을 받지 않아요.',
    });
    expect(cta({ user: null, m: { hostId: null, hostNickname: null } }).kind).toBe('closed');
    expect(cta({ p: 'confirmed', m: { hostId: null, hostNickname: null } }).kind).toBe('confirmed');
  });

  it('서비스 설정 전 → 서비스 준비 중', () => {
    expect(cta({ mode: 'unconfigured' })).toMatchObject({ kind: 'unconfigured', label: '서비스 준비 중', display: 'disabled' });
  });
});
