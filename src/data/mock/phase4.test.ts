import { describe, expect, it } from 'vitest';
import type { MeetingInput, VenueInput } from '../types';
import { createMockAdapter } from './adapter';
import { createSeedDb, createSeedMeetings, DEV_ACCOUNT_IDS, SEED_VENUES } from './seed';

const NOW = new Date('2026-11-23T03:00:00Z'); // KST 11-23(월) 12:00

function adapterAs(sessionUserId: string | null) {
  return createMockAdapter({ delayMs: 0, persist: false, now: () => NOW, sessionUserId });
}

const VENUE_INPUT: VenueInput = {
  name: '새 예시 공간',
  regionCode: 'dunsan_tanbang',
  address: '대전 서구 예시로 1 (가상 주소)',
  venueType: 'other',
  websiteUrl: null,
  bookingUrl: null,
  description: '',
  isPublic: false,
  infoVerifiedAt: null,
};

describe('mock seed: 공간', () => {
  it('모임의 공간 이름·권역과 예시 공간이 일관된다(가상 이름·example.com 링크만)', () => {
    const meetings = createSeedMeetings(NOW);
    const venues = createSeedDb(NOW).venues;
    for (const meeting of meetings.filter((m) => m.venueId)) {
      const venue = venues.find((v) => v.id === meeting.venueId);
      expect(venue, meeting.id).toBeDefined();
      expect(venue?.name).toBe(meeting.venueName);
      expect(venue?.regionCode, meeting.id).toBe(meeting.regionCode);
    }
    for (const venue of SEED_VENUES) {
      for (const url of [venue.websiteUrl, venue.bookingUrl]) {
        if (url !== null) expect(url).toMatch(/^https:\/\/example\.com\//);
      }
      expect(venue.address).toContain('예시');
      expect(venue.address).toContain('가상 주소');
    }
    expect(SEED_VENUES.some((venue) => !venue.isPublic)).toBe(true);
    expect(SEED_VENUES.some((venue) => venue.verifiedDaysAgo === null)).toBe(true);
  });
});

describe('mock: 공간 조회 규칙', () => {
  it('공개 공간만(관리자도), 권역·유형 필터, 비공개 상세는 null', async () => {
    for (const viewer of [null, DEV_ACCOUNT_IDS.admin]) {
      const adapter = adapterAs(viewer);
      const venues = await adapter.listVenues({});
      expect(venues.every((venue) => venue.isPublic)).toBe(true);
      expect(venues.map((venue) => venue.id)).not.toContain('seed-venue-11');
      expect(await adapter.getVenue('seed-venue-11')).toBeNull();
    }
    const adapter = adapterAs(null);
    expect((await adapter.listVenues({ region: 'noeun_jijok', type: 'party_room' })).map((v) => v.name)).toEqual(['파티룸 G']);
    expect(await adapter.listMeetings({ venueId: 'seed-venue-01' }, { limit: 20, offset: 0 })).toMatchObject({ total: 2 });
  });

  it('비공개로 바뀐 공간: 연결된 모임의 공간 이름은 일반 사용자에게 null, 관리자에게는 보인다', async () => {
    const admin = adapterAs(DEV_ACCOUNT_IDS.admin);
    await admin.adminSetVenuePublic('seed-venue-01', false);
    const db = admin.snapshot();
    const anon = createMockAdapter({ delayMs: 0, persist: false, now: () => NOW, db });
    expect((await anon.getMeeting('seed-meeting-01'))?.venueName).toBeNull();
    const adminView = createMockAdapter({ delayMs: 0, persist: false, now: () => NOW, db, sessionUserId: DEV_ACCOUNT_IDS.admin });
    expect((await adminView.getMeeting('seed-meeting-01'))?.venueName).toBe('보드게임 카페 A');
  });
});

describe('mock: 모임 입력의 공간·게임 규칙(DB와 같다)', () => {
  const base = (overrides: Partial<MeetingInput> = {}): MeetingInput => ({
    categoryId: 'party',
    gameName: null,
    title: '공간 규칙 확인',
    description: '',
    notice: null,
    startAt: '2026-11-25T10:00:00.000Z',
    durationMinutes: 120,
    regionCode: 'dunsan_tanbang',
    venueId: null,
    venueNote: null,
    minParticipants: 2,
    maxParticipants: 4,
    skillLevel: 'anyone',
    approvalMode: 'auto',
    allowWaitlist: true,
    holdemPolicyAgreed: false,
    ...overrides,
  });

  it('공개 공간 + 권역 일치만, 비공개·권역 불일치·없는 공간은 VALIDATION_FAILED(venue_id)', async () => {
    const adapter = adapterAs(DEV_ACCOUNT_IDS.userB);
    const id = await adapter.createMeeting(base({ venueId: 'seed-venue-01' }));
    expect((await adapter.getMeeting(id))?.venueName).toBe('보드게임 카페 A');
    for (const venueId of ['seed-venue-11', 'seed-venue-03', 'no-such-venue']) {
      await expect(adapter.createMeeting(base({ venueId }))).rejects.toMatchObject({ code: 'VALIDATION_FAILED', detail: 'venue_id' });
    }
  });

  it('비활성 카테고리는 새 모임에서 거부, 기존 모임은 유지', async () => {
    const admin = adapterAs(DEV_ACCOUNT_IDS.admin);
    await admin.adminSetCategoryActive('party', false);
    expect((await admin.listCategories()).map((c) => c.id)).not.toContain('party');
    const user = createMockAdapter({ delayMs: 0, persist: false, now: () => NOW, db: admin.snapshot(), sessionUserId: DEV_ACCOUNT_IDS.userB });
    await expect(user.createMeeting(base())).rejects.toMatchObject({ code: 'VALIDATION_FAILED', detail: 'category_id' });
    expect(await user.getMeeting('seed-meeting-01')).toMatchObject({ categoryId: 'party' });
  });

  it('게임 연결 유지: 같은 gameId만 허용, gameId와 gameName을 함께 보내면 VALIDATION_FAILED(game)', async () => {
    const db = createSeedDb(NOW);
    const meeting = db.meetings.find((m) => m.id === 'seed-meeting-13')!;
    meeting.gameId = 'game-1';
    meeting.gameName = '카탄';
    const host = createMockAdapter({ delayMs: 0, persist: false, now: () => NOW, db, sessionUserId: DEV_ACCOUNT_IDS.hostA });
    const current = (await host.getMeeting('seed-meeting-13'))!;
    const input = base({
      categoryId: current.categoryId,
      title: current.title,
      startAt: current.startAt,
      durationMinutes: current.durationMinutes,
      regionCode: current.regionCode,
      venueId: current.venueId,
      minParticipants: current.minParticipants,
      maxParticipants: current.maxParticipants,
      approvalMode: current.approvalMode,
    });
    await host.updateMeeting('seed-meeting-13', { ...input, gameId: 'game-1', gameName: null });
    expect(await host.getMeeting('seed-meeting-13')).toMatchObject({ gameId: 'game-1', gameName: '카탄' });
    await expect(host.updateMeeting('seed-meeting-13', { ...input, gameId: 'game-1', gameName: '카탄' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      detail: 'game',
    });
    await expect(host.updateMeeting('seed-meeting-13', { ...input, gameId: 'game-2', gameName: null })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      detail: 'game_id',
    });
    await host.updateMeeting('seed-meeting-13', { ...input, gameId: null, gameName: '카탄 확장' });
    expect(await host.getMeeting('seed-meeting-13')).toMatchObject({ gameId: null, gameName: '카탄 확장' });
  });
});

describe('mock: 신고 규칙(submit_report와 같다)', () => {
  it('접수·중복·자기 신고·기타 본문·없는 대상·숨김 모임·하루 10건', async () => {
    const adapter = adapterAs(DEV_ACCOUNT_IDS.userB);
    const id = await adapter.submitReport({ targetType: 'meeting', targetId: 'seed-meeting-01', reason: 'spam', body: '  ' });
    expect(adapter.snapshot().reports.find((r) => r.id === id)).toMatchObject({ body: '', status: 'received', reporterId: DEV_ACCOUNT_IDS.userB });
    await expect(
      adapter.submitReport({ targetType: 'meeting', targetId: 'seed-meeting-01', reason: 'other', body: '다시' }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_REPORT' });
    await expect(adapter.submitReport({ targetType: 'user', targetId: DEV_ACCOUNT_IDS.userB, reason: 'spam', body: null })).rejects.toMatchObject({
      code: 'CANNOT_REPORT_SELF',
    });
    await expect(adapter.submitReport({ targetType: 'user', targetId: 'seed-host-01', reason: 'other', body: ' ' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      detail: 'body',
    });
    await expect(adapter.submitReport({ targetType: 'meeting', targetId: 'seed-meeting-16', reason: 'spam', body: null })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const host = adapterAs(DEV_ACCOUNT_IDS.hostA);
    await expect(host.submitReport({ targetType: 'meeting', targetId: 'seed-meeting-13', reason: 'spam', body: null })).rejects.toMatchObject({
      code: 'CANNOT_REPORT_SELF',
    });

    const limited = adapterAs(DEV_ACCOUNT_IDS.userB);
    for (let index = 0; index < 10; index += 1) {
      await limited.submitReport({ targetType: 'user', targetId: `seed-guest-${String(index + 1).padStart(2, '0')}`, reason: 'spam', body: null });
    }
    await expect(limited.submitReport({ targetType: 'user', targetId: 'seed-host-01', reason: 'spam', body: null })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      detail: 'report_24h',
    });
  });

  it('비로그인 AUTH_REQUIRED, 최초 설정 전 PROFILE_INCOMPLETE', async () => {
    await expect(adapterAs(null).submitReport({ targetType: 'user', targetId: 'seed-host-01', reason: 'spam', body: null })).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    });
    await expect(
      adapterAs(DEV_ACCOUNT_IDS.newcomer).submitReport({ targetType: 'user', targetId: 'seed-host-01', reason: 'spam', body: null }),
    ).rejects.toMatchObject({ code: 'PROFILE_INCOMPLETE' });
  });
});

describe('mock: 관리자 — 관리자 dev 계정만, 나머지는 NOT_ADMIN', () => {
  it('일반 계정은 모든 관리자 메서드가 NOT_ADMIN', async () => {
    const adapter = adapterAs(DEV_ACCOUNT_IDS.userB);
    const page = { limit: 20, offset: 0 };
    const calls: Promise<unknown>[] = [
      adapter.adminListReports({}, page),
      adapter.adminUpdateReport('seed-report-01', 'resolved', null),
      adapter.adminListMeetings({}, page),
      adapter.adminSetMeetingHidden('seed-meeting-01', true, '사유'),
      adapter.adminCancelMeeting('seed-meeting-01', null),
      adapter.adminSearchUsers(''),
      adapter.adminSetUserStatus('seed-host-01', 'restricted', null),
      adapter.adminListVenues(),
      adapter.adminSaveVenue(null, VENUE_INPUT),
      adapter.adminSetVenuePublic('seed-venue-01', false),
      adapter.adminListCategories(),
      adapter.adminSetCategoryActive('party', false),
    ];
    for (const call of calls) await expect(call).rejects.toMatchObject({ code: 'NOT_ADMIN' });
    await expect(adapterAs(null).adminListVenues()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it.each(['restricted', 'deletion_requested'] as const)(
    '%s 상태인 관리자 계정은 관리자 권한을 잃고(DB is_admin()과 같음 — 마이그레이션 9), active로 되돌리면 복구된다',
    async (status) => {
      const db = createSeedDb(NOW);
      db.profiles.find((p) => p.id === DEV_ACCOUNT_IDS.admin)!.status = status;
      const blocked = createMockAdapter({ delayMs: 0, persist: false, now: () => NOW, db, sessionUserId: DEV_ACCOUNT_IDS.admin });
      const page = { limit: 20, offset: 0 };
      await expect(blocked.adminListReports({}, page)).rejects.toMatchObject({ code: 'NOT_ADMIN' });
      await expect(blocked.adminListMeetings({}, page)).rejects.toMatchObject({ code: 'NOT_ADMIN' });
      await expect(blocked.adminSetMeetingHidden('seed-meeting-01', true, '사유')).rejects.toMatchObject({ code: 'NOT_ADMIN' });
      await expect(blocked.adminSaveVenue(null, VENUE_INPUT)).rejects.toMatchObject({ code: 'NOT_ADMIN' });
      await expect(blocked.adminSetCategoryActive('party', false)).rejects.toMatchObject({ code: 'NOT_ADMIN' });
      expect(await blocked.auth.getSessionUser()).toMatchObject({ status, isAdmin: false });
      expect(await blocked.getMyProfile()).toMatchObject({ isAdmin: false });
      expect(await blocked.getMeeting('seed-meeting-16')).toBeNull(); // 숨김 모임

      db.profiles.find((p) => p.id === DEV_ACCOUNT_IDS.admin)!.status = 'active';
      const restored = createMockAdapter({ delayMs: 0, persist: false, now: () => NOW, db, sessionUserId: DEV_ACCOUNT_IDS.admin });
      expect(await restored.auth.getSessionUser()).toMatchObject({ isAdmin: true });
      expect((await restored.adminListMeetings({}, page)).total).toBeGreaterThan(0);
      expect(await restored.getMeeting('seed-meeting-16')).toMatchObject({ id: 'seed-meeting-16' });
    },
  );

  it('신고 처리(handled 기록)·모임 숨김 → 탐색에서 사라짐 → 해제·관리자 취소', async () => {
    const admin = adapterAs(DEV_ACCOUNT_IDS.admin);
    const received = await admin.adminListReports({ status: 'received' }, { limit: 20, offset: 0 });
    expect(received.items.map((r) => r.id)).toEqual(['seed-report-01']);
    expect(received.items[0]).toMatchObject({ targetLabel: '[예시] 칩만 쓰는 비금전 홀덤 친목 모임', reporterNickname: '예시참가자01' });
    await admin.adminUpdateReport('seed-report-01', 'resolved', ' 숨김 처리 ');
    expect(admin.snapshot().reports.find((r) => r.id === 'seed-report-01')).toMatchObject({
      status: 'resolved',
      adminNote: '숨김 처리',
      handledBy: DEV_ACCOUNT_IDS.admin,
    });

    await expect(admin.adminSetMeetingHidden('seed-meeting-06', true, '   ')).rejects.toMatchObject({ detail: 'reason' });
    await admin.adminSetMeetingHidden('seed-meeting-06', true, '금전성 홀덤 의심');
    const visible = await admin.listMeetings({}, { limit: 50, offset: 0 });
    expect(visible.items.map((m) => m.id)).not.toContain('seed-meeting-06');
    expect((await admin.adminListMeetings({ hiddenOnly: true }, { limit: 20, offset: 0 })).items.map((m) => m.id)).toEqual(
      expect.arrayContaining(['seed-meeting-06', 'seed-meeting-16']),
    );
    await admin.adminSetMeetingHidden('seed-meeting-06', false, null);
    expect((await admin.listMeetings({}, { limit: 50, offset: 0 })).items.map((m) => m.id)).toContain('seed-meeting-06');

    await admin.adminCancelMeeting('seed-meeting-12', '진행 중 취소');
    expect(await admin.getMeeting('seed-meeting-12')).toMatchObject({ status: 'cancelled' });
    await expect(admin.adminCancelMeeting('seed-meeting-11', null)).rejects.toMatchObject({ code: 'MEETING_STARTED', detail: 'ended' });
  });

  it('사용자 상태: 본인·탈퇴 요청 불가, 제한해도 모임은 그대로', async () => {
    const admin = adapterAs(DEV_ACCOUNT_IDS.admin);
    await expect(admin.adminSetUserStatus(DEV_ACCOUNT_IDS.admin, 'restricted', null)).rejects.toMatchObject({ detail: 'user_id' });
    await admin.adminSetUserStatus(DEV_ACCOUNT_IDS.hostA, 'restricted', '반복 노쇼');
    expect((await admin.adminSearchUsers('예시사용자A'))[0]).toMatchObject({ status: 'restricted' });
    expect(await admin.getMeeting('seed-meeting-13')).toMatchObject({ status: 'open' });
    const db = admin.snapshot();
    db.profiles.find((p) => p.id === DEV_ACCOUNT_IDS.userB)!.status = 'deletion_requested';
    const again = createMockAdapter({ delayMs: 0, persist: false, now: () => NOW, db, sessionUserId: DEV_ACCOUNT_IDS.admin });
    await expect(again.adminSetUserStatus(DEV_ACCOUNT_IDS.userB, 'active', null)).rejects.toMatchObject({ detail: 'status' });
  });

  it('공간 등록·수정·공개 전환(https만), 카테고리 활성 전환', async () => {
    const admin = adapterAs(DEV_ACCOUNT_IDS.admin);
    const id = await admin.adminSaveVenue(null, { ...VENUE_INPUT, name: '  새 예시 공간  ' });
    expect((await admin.adminListVenues()).find((v) => v.id === id)).toMatchObject({ name: '새 예시 공간', isPublic: false });
    expect(await admin.getVenue(id)).toBeNull();
    await expect(admin.adminSaveVenue(id, { ...VENUE_INPUT, websiteUrl: 'javascript:alert(1)' })).rejects.toMatchObject({
      detail: 'website_url',
    });
    await admin.adminSaveVenue(id, { ...VENUE_INPUT, bookingUrl: 'https://example.com/book' });
    await admin.adminSetVenuePublic(id, true);
    expect(await admin.getVenue(id)).toMatchObject({ bookingUrl: 'https://example.com/book', isPublic: true });
    await expect(admin.adminSetVenuePublic('no-such', true)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await admin.adminSetCategoryActive('mahjong_etc', false);
    expect((await admin.adminListCategories()).find((c) => c.id === 'mahjong_etc')?.isActive).toBe(false);
  });
});
