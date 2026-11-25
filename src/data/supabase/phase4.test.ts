import { describe, expect, it } from 'vitest';
import { createFakeSupabaseClient } from '../../test/fakeSupabaseClient';
import { createMockAdapter } from '../mock/adapter';
import { DEV_ACCOUNT_IDS } from '../mock/seed';
import type { VenueInput } from '../types';
import { createSupabaseAdapter } from './adapter';
import { toTableWriteError } from './errors';
import { parseVenueOrNull, parseVenues } from './mapping';
import { toAdminMeetingArgs, toAdminReportArgs, toListMeetingsArgs, toListVenuesArgs, toVenueRow } from './rpcArgs';

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VENUE_ID = '22222222-2222-4222-8222-222222222222';

function setup(sessionUserId: string | null = USER) {
  const client = createFakeSupabaseClient();
  client.setSession(sessionUserId);
  const adapter = createSupabaseAdapter({ client, kakaoAuthEnabled: false });
  return { client, adapter };
}

const VENUE_INPUT: VenueInput = {
  name: '공간',
  regionCode: 'dunsan_tanbang',
  address: '대전 서구 예시로 1',
  venueType: 'party_room',
  websiteUrl: 'https://example.com/a',
  bookingUrl: null,
  description: '',
  isPublic: true,
  infoVerifiedAt: '2026-11-20T00:00:00+09:00',
};

function venueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: VENUE_ID,
    name: '공간',
    regionCode: 'dunsan_tanbang',
    address: '대전 서구 예시로 1',
    venueType: 'board_game_cafe',
    websiteUrl: 'https://example.com/a',
    bookingUrl: null,
    description: '',
    isPublic: true,
    infoVerifiedAt: '2026-11-19T15:00:00+00:00',
    createdAt: '2026-11-01T00:00:00+00:00',
    updatedAt: '2026-11-01T00:00:00+00:00',
    ...overrides,
  };
}

describe('supabase/rpcArgs Phase 4', () => {
  it('list_public_venues·list_public_meetings(p_venue_id)·관리자 목록 인자', () => {
    expect(toListVenuesArgs({})).toEqual({});
    expect(toListVenuesArgs({ region: 'noeun_jijok', type: 'party_room' })).toEqual({ p_region: 'noeun_jijok', p_type: 'party_room' });
    expect(toListVenuesArgs({ region: 'seoul' as never, type: 'casino' as never })).toEqual({});
    expect(toListMeetingsArgs({ venueId: VENUE_ID }, { limit: 10, offset: 0 })).toMatchObject({ p_venue_id: VENUE_ID });
    expect(toListMeetingsArgs({ venueId: 'not-uuid' }, { limit: 10, offset: 0 })).not.toHaveProperty('p_venue_id');
    expect(toAdminReportArgs({ status: 'reviewing' }, { limit: 500, offset: -1 })).toEqual({ p_status: 'reviewing', p_limit: 50, p_offset: 0 });
    expect(toAdminMeetingArgs({ q: '  카탄  ', hiddenOnly: true }, { limit: 20, offset: 40 })).toEqual({
      p_q: '카탄',
      p_hidden_only: true,
      p_limit: 20,
      p_offset: 40,
    });
  });

  it('venues 행: snake_case 전체 필드, created_by·created_at 없음, 확인일은 UTC', () => {
    expect(toVenueRow(VENUE_INPUT)).toEqual({
      name: '공간',
      region_code: 'dunsan_tanbang',
      address: '대전 서구 예시로 1',
      venue_type: 'party_room',
      website_url: 'https://example.com/a',
      booking_url: null,
      description: '',
      is_public: true,
      info_verified_at: '2026-11-19T15:00:00.000Z',
    });
    expect(() => toVenueRow({ ...VENUE_INPUT, infoVerifiedAt: '2026-11-20' })).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED', detail: 'info_verified_at' }),
    );
  });
});

describe('supabase/mapping Phase 4', () => {
  it('공간 응답: 시각 UTC 정규화, https가 아닌 링크는 버린다(화면 전체는 실패시키지 않음)', () => {
    expect(parseVenueOrNull(venueRow())).toMatchObject({ infoVerifiedAt: '2026-11-19T15:00:00.000Z', websiteUrl: 'https://example.com/a' });
    expect(parseVenueOrNull(venueRow({ websiteUrl: 'javascript:alert(1)', bookingUrl: 'http://x.example' }))).toMatchObject({
      websiteUrl: null,
      bookingUrl: null,
    });
    expect(parseVenueOrNull(null)).toBeNull();
    expect(() => parseVenues([venueRow({ venueType: 'casino' })])).toThrow(expect.objectContaining({ code: 'UNKNOWN' }));
    expect(() => parseVenues([venueRow({ regionCode: 'seoul' })])).toThrow(expect.objectContaining({ code: 'UNKNOWN' }));
  });
});

describe('supabase/errors toTableWriteError', () => {
  it('check·not null·FK·enum 위반 → VALIDATION_FAILED(제약 이름에서만 detail), 행 값(details)은 남기지 않는다', () => {
    const check = toTableWriteError({
      code: '23514',
      message: 'new row for relation "venues" violates check constraint "venues_website_url_format"',
      details: 'Failing row contains (secret-value, http://evil.example)',
    });
    expect(check).toMatchObject({ code: 'VALIDATION_FAILED', detail: 'website_url' });
    expect(check.message).not.toContain('secret-value');
    expect(toTableWriteError({ code: '23503', message: 'insert or update violates foreign key constraint "venues_region_code_fkey"' })).toMatchObject({
      code: 'VALIDATION_FAILED',
      detail: 'region_code',
    });
    expect(toTableWriteError({ code: '23502', message: 'null value in column "address" violates not-null constraint' })).toMatchObject({
      code: 'VALIDATION_FAILED',
      detail: 'address',
    });
    expect(toTableWriteError({ code: '22P02', message: 'invalid input value for enum venue_type: "casino"' })).toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('권한 오류(42501, RLS with check) → NOT_ADMIN, 그 밖은 기존 분류', () => {
    expect(toTableWriteError({ code: '42501', message: 'new row violates row-level security policy for table "venues"' })).toMatchObject({
      code: 'NOT_ADMIN',
    });
    expect(toTableWriteError({ code: 'PGRST301', message: 'JWT expired' })).toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(toTableWriteError(new TypeError('Failed to fetch'))).toMatchObject({ code: 'NETWORK_ERROR' });
  });
});

describe('supabase/adapter Phase 4', () => {
  it('공개 조회는 세션 없이 RPC, 잘못된 공간 id는 요청하지 않는다', async () => {
    const { client, adapter } = setup(null);
    client.rpcResponses.set('list_public_venues', { data: [venueRow()], error: null, status: 200 });
    expect(await adapter.listVenues({ type: 'board_game_cafe' })).toHaveLength(1);
    expect(client.rpcCalls).toEqual([{ fn: 'list_public_venues', args: { p_type: 'board_game_cafe' } }]);
    expect(await adapter.getVenue('not-a-uuid')).toBeNull();
    expect(client.rpcCalls).toHaveLength(1);
  });

  it('신고·관리자 메서드는 세션이 없으면 요청 없이 AUTH_REQUIRED', async () => {
    const { client, adapter } = setup(null);
    await expect(adapter.submitReport({ targetType: 'user', targetId: USER, reason: 'spam', body: null })).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    });
    await expect(adapter.adminListVenues()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    await expect(adapter.adminSaveVenue(null, VENUE_INPUT)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(client.rpcCalls).toEqual([]);
    expect(client.tableCalls).toEqual([]);
  });

  it('공간 등록: venues insert(select id) → id, 수정: update eq(id)', async () => {
    const { client, adapter } = setup();
    client.rpcResponses.set('insert:venues', { data: [{ id: VENUE_ID }], error: null, status: 201 });
    client.rpcResponses.set('update:venues', { data: [{ id: VENUE_ID }], error: null, status: 200 });
    expect(await adapter.adminSaveVenue(null, VENUE_INPUT)).toBe(VENUE_ID);
    expect(await adapter.adminSaveVenue(VENUE_ID, VENUE_INPUT)).toBe(VENUE_ID);
    await adapter.adminSetVenuePublic(VENUE_ID, false);
    expect(client.tableCalls.map((call) => [call.table, call.op, call.eq ?? null, call.columns])).toEqual([
      ['venues', 'insert', null, 'id'],
      ['venues', 'update', ['id', VENUE_ID], 'id'],
      ['venues', 'update', ['id', VENUE_ID], 'id'],
    ]);
    expect(client.tableCalls[2]?.values).toEqual({ is_public: false });
  });

  it('RLS에 막힌 update(0행): is_admin()으로 NOT_ADMIN / NOT_FOUND를 가른다', async () => {
    const { client, adapter } = setup();
    client.rpcResponses.set('update:categories', { data: [], error: null, status: 200 });
    client.rpcResponses.set('is_admin', { data: false, error: null, status: 200 });
    await expect(adapter.adminSetCategoryActive('party', false)).rejects.toMatchObject({ code: 'NOT_ADMIN' });
    client.rpcResponses.set('is_admin', { data: true, error: null, status: 200 });
    await expect(adapter.adminSetCategoryActive('party', false)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // 형식이 아닌 id는 요청하지 않는다
    const before = client.tableCalls.length;
    await expect(adapter.adminSetCategoryActive('DROP TABLE', true)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(adapter.adminSetVenuePublic('not-uuid', true)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(client.tableCalls.length).toBe(before);
  });

  it('adminCancelMeeting: cancel_meeting의 NOT_HOST → NOT_ADMIN(cause 보존, mock과 같은 코드), 다른 코드는 그대로', async () => {
    const { client, adapter } = setup();
    const rpcError = (message: string, details = '') => ({
      data: null,
      error: { code: 'P0001', message, details, hint: null },
      status: 400,
    });
    client.rpcResponses.set('cancel_meeting', rpcError('NOT_HOST'));
    const error = await adapter.adminCancelMeeting(VENUE_ID, null).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'NOT_ADMIN', cause: { code: 'NOT_HOST' } });
    expect(client.rpcCalls.at(-1)).toEqual({ fn: 'cancel_meeting', args: { p_meeting_id: VENUE_ID, p_reason: null } });

    const mock = createMockAdapter({ delayMs: 0, persist: false, sessionUserId: DEV_ACCOUNT_IDS.userB });
    await expect(mock.adminCancelMeeting('seed-meeting-01', null)).rejects.toMatchObject({ code: (error as { code: string }).code });

    client.rpcResponses.set('cancel_meeting', rpcError('MEETING_STARTED', 'ended'));
    await expect(adapter.adminCancelMeeting(VENUE_ID, null)).rejects.toMatchObject({ code: 'MEETING_STARTED', detail: 'ended' });
    client.rpcResponses.set('cancel_meeting', rpcError('NOT_FOUND'));
    await expect(adapter.adminCancelMeeting(VENUE_ID, null)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    client.rpcResponses.set('cancel_meeting', { data: null, error: null, status: 204 });
    await expect(adapter.adminCancelMeeting(VENUE_ID, '운영 정책 위반')).resolves.toBeUndefined();
  });

  it('insert 권한 오류(RLS) → NOT_ADMIN, 제약 위반 → VALIDATION_FAILED(detail)', async () => {
    const { client, adapter } = setup();
    client.rpcResponses.set('insert:venues', {
      data: null,
      error: { code: '42501', message: 'new row violates row-level security policy', details: null, hint: null },
      status: 403,
    });
    await expect(adapter.adminSaveVenue(null, VENUE_INPUT)).rejects.toMatchObject({ code: 'NOT_ADMIN' });
    client.rpcResponses.set('insert:venues', {
      data: null,
      error: { code: '23514', message: 'violates check constraint "venues_name_length"', details: 'Failing row', hint: null },
      status: 400,
    });
    await expect(adapter.adminSaveVenue(null, VENUE_INPUT)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', detail: 'name' });
  });
});
