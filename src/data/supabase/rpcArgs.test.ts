import { describe, expect, it } from 'vitest';
import { kstDateTimeToIso } from '../../lib/date';
import { DataAdapterError } from '../adapter';
import type { MeetingInput } from '../types';
import { toListMeetingsArgs, toMeetingPayload, toOffsetIso, toProfilePayload } from './rpcArgs';

const PAGE = { limit: 20, offset: 0 };

function input(overrides: Partial<MeetingInput> = {}): MeetingInput {
  return {
    categoryId: 'holdem_social',
    gameName: null,
    title: '비금전 홀덤',
    description: '',
    notice: null,
    startAt: kstDateTimeToIso('2026-11-28', '19:30'),
    durationMinutes: 150,
    regionCode: 'noeun_jijok',
    venueId: null,
    venueNote: null,
    minParticipants: 4,
    maxParticipants: 8,
    skillLevel: 'anyone',
    approvalMode: 'manual',
    allowWaitlist: false,
    holdemPolicyAgreed: true,
    ...overrides,
  };
}

describe('supabase/rpcArgs 탐색 필터 → list_public_meetings 인자', () => {
  it('빈 필터: 정렬·페이지만 보낸다(빈 값 생략)', () => {
    expect(toListMeetingsArgs({}, PAGE)).toEqual({ p_sort: 'soonest', p_limit: 20, p_offset: 0 });
    expect(toListMeetingsArgs({ q: '   ', recruiting: false }, PAGE)).toEqual({ p_sort: 'soonest', p_limit: 20, p_offset: 0 });
  });

  it('date는 KST 하루 범위 [00:00, 다음 날 00:00)를 UTC로 보낸다', () => {
    expect(toListMeetingsArgs({ date: '2026-11-28' }, PAGE)).toMatchObject({
      p_date_from: '2026-11-27T15:00:00.000Z',
      p_date_to: '2026-11-28T15:00:00.000Z',
    });
    // 월말·연말 경계
    expect(toListMeetingsArgs({ date: '2026-12-31' }, PAGE)).toMatchObject({
      p_date_from: '2026-12-30T15:00:00.000Z',
      p_date_to: '2026-12-31T15:00:00.000Z',
    });
    // 실존하지 않는 날짜는 무시
    expect(toListMeetingsArgs({ date: '2026-02-30' }, PAGE)).not.toHaveProperty('p_date_from');
  });

  it('category·region·q·recruiting·sort 변환, 잘못된 값은 생략', () => {
    expect(
      toListMeetingsArgs(
        { category: 'strategy', region: 'etc_daejeon', q: '  카탄   모임 ', recruiting: true, sort: 'newest' },
        { limit: 10, offset: 40 },
      ),
    ).toEqual({
      p_category: 'strategy',
      p_region: 'etc_daejeon',
      p_q: '카탄 모임',
      p_recruiting: true,
      p_sort: 'newest',
      p_limit: 10,
      p_offset: 40,
    });
    const invalid = toListMeetingsArgs({ category: 'casino' as never, region: 'seoul' as never }, PAGE);
    expect(invalid).not.toHaveProperty('p_category');
    expect(invalid).not.toHaveProperty('p_region');
  });

  it('검색어는 50자로 자르고, 페이지는 1~50·0 이상으로 보정한다', () => {
    const args = toListMeetingsArgs({ q: '가'.repeat(80) }, { limit: 500, offset: -3 });
    expect(args.p_q).toBe('가'.repeat(50));
    expect(args).toMatchObject({ p_limit: 50, p_offset: 0 });
  });
});

describe('supabase/rpcArgs 모임 입력 → p(jsonb)', () => {
  it('snake_case 전체 키를 항상 보낸다(수정도 전체 값 — 빠진 선택 키는 DB 기본값으로 바뀌므로)', () => {
    const payload = toMeetingPayload(input());
    expect(Object.keys(payload).sort()).toEqual(
      [
        'allow_waitlist',
        'approval_mode',
        'category_id',
        'description',
        'duration_minutes',
        'game_id',
        'game_name',
        'holdem_policy_agreed',
        'max_participants',
        'min_participants',
        'notice',
        'region_code',
        'skill_level',
        'start_at',
        'title',
        'venue_id',
        'venue_note',
      ].sort(),
    );
    expect(payload).toMatchObject({
      category_id: 'holdem_social',
      game_name: null,
      notice: null,
      venue_id: null,
      venue_note: null,
      allow_waitlist: false,
      holdem_policy_agreed: true,
      start_at: '2026-11-28T10:30:00.000Z',
    });
    // 게임 연결이 없으면 game_id는 null(직접 입력 이름만)
    expect(payload.game_id).toBeNull();
  });

  it('등록된 게임 연결을 유지하면 game_id만 보내고 game_name은 null(동시 지정 금지 규칙)', () => {
    const gameId = '7c1e0e2a-4b8f-4a3e-9d1a-2f6b5c4d3e21';
    expect(toMeetingPayload(input({ gameId, gameName: null }))).toMatchObject({ game_id: gameId, game_name: null });
    // 형식이 아닌 id는 보내지 않고 직접 입력 이름으로 둔다
    expect(toMeetingPayload(input({ gameId: 'not-a-uuid', gameName: '카탄' }))).toMatchObject({ game_id: null, game_name: '카탄' });
    // gameId가 있으면 이름이 함께 와도 game_name은 보내지 않는다(서버 VALIDATION_FAILED/game 방지)
    expect(toMeetingPayload(input({ gameId, gameName: '카탄' }))).toMatchObject({ game_id: gameId, game_name: null });
  });

  it('start_at은 오프셋 포함 ISO만: +09:00은 UTC로 바꾸고, 오프셋이 없으면 보내지 않는다', () => {
    expect(toOffsetIso('2026-11-28T19:30:00+09:00')).toBe('2026-11-28T10:30:00.000Z');
    expect(toOffsetIso('2026-11-28T10:30:00.000Z')).toBe('2026-11-28T10:30:00.000Z');
    for (const bad of ['2026-11-28T19:30:00', '2026-11-28', '내일', '']) {
      expect(() => toOffsetIso(bad), bad).toThrow(DataAdapterError);
    }
    expect(() => toMeetingPayload(input({ startAt: '2026-11-28T19:30' }))).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED', detail: 'start_at' }),
    );
  });
});

describe('supabase/rpcArgs 프로필 → p(jsonb)', () => {
  it('바꿀 키만 보내고 null(지움)은 그대로 보낸다', () => {
    expect(toProfilePayload({})).toEqual({});
    expect(toProfilePayload({ nickname: '한판승부', agreeTerms: true, agreePrivacy: true })).toEqual({
      nickname: '한판승부',
      agree_terms: true,
      agree_privacy: true,
    });
    expect(toProfilePayload({ regionCode: null, bio: '', favoriteCategoryIds: ['party'] })).toEqual({
      region_code: null,
      bio: '',
      favorite_category_ids: ['party'],
    });
  });
});
