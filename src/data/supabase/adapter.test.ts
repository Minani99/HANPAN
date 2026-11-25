import { describe, expect, it } from 'vitest';
import { kstDateTimeToIso } from '../../lib/date';
import { createFakeSupabaseClient, profileResponse } from '../../test/fakeSupabaseClient';
import type { MeetingInput } from '../types';
import { createSupabaseAdapter } from './adapter';

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MEETING_ID = '11111111-1111-4111-8111-111111111111';

function setup(sessionUserId: string | null = null) {
  const client = createFakeSupabaseClient();
  client.setSession(sessionUserId);
  const adapter = createSupabaseAdapter({ client, kakaoAuthEnabled: false });
  return { client, adapter };
}

const INPUT: MeetingInput = {
  categoryId: 'party',
  gameName: null,
  title: '퇴근 후 한 판',
  description: '',
  notice: null,
  startAt: kstDateTimeToIso('2026-12-01', '19:00'),
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
};

describe('supabase/adapter 세션이 없을 때', () => {
  it('getMyParticipation·getMyProfile은 RPC 없이 null', async () => {
    const { client, adapter } = setup(null);
    await expect(adapter.getMyParticipation(MEETING_ID)).resolves.toBeNull();
    await expect(adapter.getMyProfile()).resolves.toBeNull();
    expect(client.rpcCalls).toEqual([]);
  });

  it('로그인 필요 메서드는 RPC 없이 AUTH_REQUIRED', async () => {
    const { client, adapter } = setup(null);
    const calls: [string, () => Promise<unknown>][] = [
      ['applyToMeeting', () => adapter.applyToMeeting(MEETING_ID, null)],
      ['cancelMyApplication', () => adapter.cancelMyApplication(MEETING_ID)],
      ['createMeeting', () => adapter.createMeeting(INPUT)],
      ['updateMeeting', () => adapter.updateMeeting(MEETING_ID, INPUT)],
      ['cancelMeeting', () => adapter.cancelMeeting(MEETING_ID, null)],
      ['setMeetingRecruiting', () => adapter.setMeetingRecruiting(MEETING_ID, false)],
      ['listMyMeetings', () => adapter.listMyMeetings()],
      ['listParticipants', () => adapter.listParticipants(MEETING_ID)],
      ['decideParticipant', () => adapter.decideParticipant(MEETING_ID, 'approve')],
      ['markAttendance', () => adapter.markAttendance(MEETING_ID, 'attended')],
      ['updateMyProfile', () => adapter.updateMyProfile({ bio: '' })],
      ['requestAccountDeletion', () => adapter.requestAccountDeletion()],
    ];
    for (const [name, call] of calls) {
      await expect(call(), name).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    }
    expect(client.rpcCalls).toEqual([]);
  });
});

describe('supabase/adapter 요청 모양', () => {
  it('uuid가 아닌 id: 조회는 RPC 없이 null, 쓰기는 NOT_FOUND', async () => {
    const { client, adapter } = setup(USER);
    await expect(adapter.getMeeting('seed-meeting-01')).resolves.toBeNull();
    await expect(adapter.getMyParticipation('../x')).resolves.toBeNull();
    await expect(adapter.applyToMeeting('not-a-uuid', null)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(client.rpcCalls).toEqual([]);
  });

  it('탐색 목록은 list_public_meetings에 변환한 인자로', async () => {
    const { client, adapter } = setup(null);
    client.rpcResponses.set('list_public_meetings', { data: { items: [], total: 0 }, error: null });
    await expect(adapter.listMeetings({ date: '2026-11-28', recruiting: true }, { limit: 20, offset: 20 })).resolves.toEqual({
      items: [],
      total: 0,
    });
    expect(client.rpcCalls).toEqual([
      {
        fn: 'list_public_meetings',
        args: {
          p_date_from: '2026-11-27T15:00:00.000Z',
          p_date_to: '2026-11-28T15:00:00.000Z',
          p_recruiting: true,
          p_sort: 'soonest',
          p_limit: 20,
          p_offset: 20,
        },
      },
    ]);
  });

  it('쓰기 RPC 인자: 신청 메시지·취소 사유 null 기본값, 모임 입력은 p(jsonb)', async () => {
    const { client, adapter } = setup(USER);
    client.rpcResponses.set('apply_to_meeting', { data: 'pending', error: null });
    client.rpcResponses.set('create_meeting', { data: MEETING_ID, error: null });
    await expect(adapter.applyToMeeting(MEETING_ID)).resolves.toBe('pending');
    await adapter.cancelMeeting(MEETING_ID);
    await expect(adapter.createMeeting(INPUT)).resolves.toBe(MEETING_ID);
    await adapter.updateMeeting(MEETING_ID, INPUT);
    expect(client.rpcCalls.map((call) => call.fn)).toEqual(['apply_to_meeting', 'cancel_meeting', 'create_meeting', 'update_meeting']);
    expect(client.rpcCalls[0]?.args).toEqual({ p_meeting_id: MEETING_ID, p_message: null });
    expect(client.rpcCalls[1]?.args).toEqual({ p_meeting_id: MEETING_ID, p_reason: null });
    expect(client.rpcCalls[2]?.args).toMatchObject({ p: { title: '퇴근 후 한 판', start_at: '2026-12-01T10:00:00.000Z' } });
    expect(client.rpcCalls[3]?.args).toMatchObject({ p_meeting_id: MEETING_ID, p: { allow_waitlist: true, notice: null } });
  });

  it('RPC 오류는 코드·detail을 그대로 전달한다', async () => {
    const { client, adapter } = setup(USER);
    client.rpcResponses.set('create_meeting', {
      data: null,
      error: { code: 'P0001', message: 'RATE_LIMITED', details: 'create_24h', hint: null },
      status: 400,
    });
    await expect(adapter.createMeeting(INPUT)).rejects.toMatchObject({ code: 'RATE_LIMITED', detail: 'create_24h' });
  });

  it('응답 모양이 계약과 다르면 UNKNOWN', async () => {
    const { client, adapter } = setup(USER);
    client.rpcResponses.set('get_my_profile', { data: { id: USER }, error: null });
    await expect(adapter.getMyProfile()).rejects.toMatchObject({ code: 'UNKNOWN', detail: 'contract:get_my_profile' });
    client.rpcResponses.set('get_my_profile', profileResponse(USER, { favoriteCategoryIds: ['party'] }));
    await expect(adapter.getMyProfile()).resolves.toMatchObject({ id: USER, favoriteCategoryIds: ['party'] });
  });

  it('기준 데이터는 테이블 select(활성 항목, sort_order 순)', async () => {
    const { client, adapter } = setup(null);
    client.rpcResponses.set('table:regions', {
      data: [
        { code: 'dunsan_tanbang', name: '둔산·탄방', sort_order: 10 },
        { code: 'etc_daejeon', name: '그 외 대전', sort_order: 90 },
      ],
      error: null,
    });
    await expect(adapter.listRegions()).resolves.toEqual([
      { code: 'dunsan_tanbang', name: '둔산·탄방', sortOrder: 10 },
      { code: 'etc_daejeon', name: '그 외 대전', sortOrder: 90 },
    ]);
    await adapter.listCategories();
    expect(client.selectCalls).toEqual([
      ['regions', 'code, name, sort_order', 'is_active', true, 'sort_order'],
      ['categories', 'id, name, sort_order', 'is_active', true, 'sort_order'],
    ]);
  });
});
