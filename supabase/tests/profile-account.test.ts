/**
 * 프로필·온보딩(update_my_profile, get_my_profile)과 탈퇴 요청(request_account_deletion).
 * TEST_PLAN §5(탈퇴 요청), DB_SCHEMA §9.12~9.13.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  apply,
  createMeetingRpc,
  createTestDb,
  daysFromNow,
  expectRpcError,
  hoursFromNow,
  type TestDb,
} from './harness';
import { isReservedNickname } from '../../src/domain/limits';

let db: TestDb;
beforeEach(async () => {
  db = await createTestDb();
});
afterEach(async () => {
  await db.close();
});

interface Profile {
  id: string;
  nickname: string;
  regionCode: string | null;
  bio: string;
  favoriteCategoryIds: string[];
  status: string;
  termsAgreedAt: string | null;
  privacyAgreedAt: string | null;
  deletionRequestedAt: string | null;
  onboarded: boolean;
  isAdmin: boolean;
}

const me = (userId: string) => db.rpc<Profile>(userId, 'select public.get_my_profile()');
const updateProfile = (userId: string, patch: Record<string, unknown>) =>
  db.rpc(userId, 'select public.update_my_profile($1::jsonb)', [JSON.stringify(patch)]);

describe('온보딩', () => {
  it('가입 직후 onboarded=false, 닉네임·약관·개인정보 동의가 모두 있어야 완료된다', async () => {
    const user = await db.createUser({ onboarded: false });
    expect(await me(user)).toMatchObject({ onboarded: false, termsAgreedAt: null, status: 'active', isAdmin: false });
    await expectRpcError(updateProfile(user, { nickname: '새닉네임' }), 'PROFILE_INCOMPLETE');
    await expectRpcError(updateProfile(user, { nickname: '새닉네임', agree_terms: true }), 'PROFILE_INCOMPLETE');
    await expectRpcError(updateProfile(user, { agree_terms: true, agree_privacy: true }), 'PROFILE_INCOMPLETE');
    await expectRpcError(
      updateProfile(user, { nickname: '새닉네임', agree_terms: 'true', agree_privacy: true }),
      'VALIDATION_FAILED',
      'agree_terms',
    );
    await updateProfile(user, { nickname: '새닉네임', agree_terms: true, agree_privacy: true, region_code: 'noeun_jijok' });
    const profile = await me(user);
    expect(profile).toMatchObject({ onboarded: true, nickname: '새닉네임', regionCode: 'noeun_jijok' });
    expect(profile.termsAgreedAt).not.toBeNull();
    expect(profile.privacyAgreedAt).not.toBeNull();
  });

  it('동의 시각은 처음 한 번만 기록하고 false는 무시한다', async () => {
    const user = await db.createUser();
    const first = await me(user);
    await db.asOwner((q) =>
      q.query(`update public.user_private set terms_agreed_at = now() - interval '10 days' where user_id = $1`, [user]),
    );
    const before = (await me(user)).termsAgreedAt;
    await updateProfile(user, { agree_terms: true, agree_privacy: false, bio: '소개' });
    const after = await me(user);
    expect(after.termsAgreedAt).toBe(before);
    expect(after.privacyAgreedAt).toBe(first.privacyAgreedAt);
    expect(after.bio).toBe('소개');
  });

  it('get_my_profile은 비로그인 상태(sub 없음, authenticated 역할)에서 AUTH_REQUIRED', async () => {
    await expectRpcError(
      db.pg.transaction(async (tx) => {
        await tx.query('set local role authenticated');
        await tx.query('select public.get_my_profile()');
      }),
      'AUTH_REQUIRED',
    );
  });
});

describe('닉네임 규칙', () => {
  it('형식: 한글·영문·숫자·_·- 2~20자', async () => {
    const user = await db.createUser();
    for (const bad of ['가', 'a'.repeat(21), '공백 있음', '<script>', '이모지😀', 'dot.name', '']) {
      await expectRpcError(updateProfile(user, { nickname: bad }), 'VALIDATION_FAILED', 'nickname');
    }
    await expectRpcError(updateProfile(user, { nickname: null }), 'VALIDATION_FAILED', 'nickname');
    await expectRpcError(updateProfile(user, { nickname: 12345 }), 'VALIDATION_FAILED', 'nickname');
    for (const ok of ['가나', 'Board_Gamer-01', 'a'.repeat(20), '  공백제거  ']) {
      await updateProfile(user, { nickname: ok });
    }
    expect((await me(user)).nickname).toBe('공백제거');
  });

  it('예약어 포함 금지(관리자·운영자·운영팀·admin·hanpan, 대소문자·_·- 무시)', async () => {
    const user = await db.createUser();
    for (const reserved of ['관리자', '관리자김', '운영자3', '운영팀장', 'ADMIN', 'superAdmin', 'HanPan', 'han_pan', 'han-pan01']) {
      await expectRpcError(updateProfile(user, { nickname: reserved }), 'VALIDATION_FAILED', 'nickname');
    }
  });

  it('예약어 완전 일치 금지(한판·탈퇴한사용자): "한판승부"처럼 단어에 들어간 경우는 허용', async () => {
    const user = await db.createUser();
    for (const reserved of ['한판', '한_판', '한-판', '탈퇴한사용자', '탈퇴한_사용자']) {
      await expectRpcError(updateProfile(user, { nickname: reserved }), 'VALIDATION_FAILED', 'nickname');
    }
    for (const allowed of ['한판승부', '오늘도한판', '한-판왕']) {
      await updateProfile(user, { nickname: allowed });
      expect((await me(user)).nickname).toBe(allowed);
    }
  });

  it('예약어 함수는 프론트(src/domain/limits.ts)와 같은 결과를 낸다', async () => {
    const cases = ['관리자김', '한판', '한판승부', 'Han_Pan', '운영팀', '탈퇴한사용자', '탈퇴한사용자아님', '보드게임러'];
    const rows = await db.asOwner((q) =>
      q.query<{ nickname: string; reserved: boolean }>(
        'select n as nickname, public._is_reserved_nickname(n) as reserved from unnest($1::text[]) as n',
        [cases],
      ),
    );
    expect(Object.fromEntries(rows.map((row) => [row.nickname, row.reserved]))).toEqual(
      Object.fromEntries(cases.map((nickname) => [nickname, isReservedNickname(nickname)])),
    );
  });

  it('중복(대소문자 무시) NICKNAME_TAKEN, 본인 닉네임 대소문자 변경은 허용, 변경 시 audit', async () => {
    const a = await db.createUser({ nickname: 'MeepleKing' });
    const b = await db.createUser({ nickname: 'other' });
    await expectRpcError(updateProfile(b, { nickname: 'meepleking' }), 'NICKNAME_TAKEN');
    await updateProfile(a, { nickname: 'meepleKING' });
    expect((await me(a)).nickname).toBe('meepleKING');
    const audits = await db.asOwner((q) =>
      q.value<number>(
        `select count(*)::int from public.audit_logs where action = 'profile.nickname_change' and actor_id = $1`,
        [a],
      ),
    );
    // 온보딩 1회 + 변경 1회
    expect(audits).toBe(2);
  });
});

describe('기타 프로필 필드', () => {
  it('관심 장르: 활성 카테고리만, 중복 제거, 배열만', async () => {
    const user = await db.createUser();
    await updateProfile(user, { favorite_category_ids: ['party', 'party', 'strategy'] });
    expect((await me(user)).favoriteCategoryIds).toEqual(['party', 'strategy']);
    await expectRpcError(updateProfile(user, { favorite_category_ids: ['casino'] }), 'VALIDATION_FAILED', 'favorite_category_ids');
    await expectRpcError(updateProfile(user, { favorite_category_ids: 'party' }), 'VALIDATION_FAILED', 'favorite_category_ids');
    await expectRpcError(updateProfile(user, { favorite_category_ids: [1] }), 'VALIDATION_FAILED', 'favorite_category_ids');
    await updateProfile(user, {
      favorite_category_ids: ['party', 'deduction', 'strategy', 'murder_mystery', 'mahjong_etc', 'holdem_social', 'party'],
    });
    expect((await me(user)).favoriteCategoryIds).toHaveLength(6);
    await updateProfile(user, { favorite_category_ids: null });
    expect((await me(user)).favoriteCategoryIds).toEqual([]);
  });

  it('권역: 활성 권역 또는 null, 소개 200자 이하, 키가 없으면 그대로', async () => {
    const user = await db.createUser();
    await updateProfile(user, { region_code: 'gung_bongmyeong', bio: '안녕하세요' });
    await expectRpcError(updateProfile(user, { region_code: 'seoul' }), 'VALIDATION_FAILED', 'region_code');
    await expectRpcError(updateProfile(user, { bio: '가'.repeat(201) }), 'VALIDATION_FAILED', 'bio');
    await updateProfile(user, { favorite_category_ids: ['party'] });
    expect(await me(user)).toMatchObject({ regionCode: 'gung_bongmyeong', bio: '안녕하세요' });
    await updateProfile(user, { region_code: null, bio: null });
    expect(await me(user)).toMatchObject({ regionCode: null, bio: '' });
  });

  it('이용 제한 계정은 프로필을 바꿀 수 없다', async () => {
    const user = await db.createUser({ status: 'restricted' });
    await expectRpcError(updateProfile(user, { bio: '변경' }), 'ACCOUNT_RESTRICTED');
  });
});

describe('request_account_deletion', () => {
  it('상태 변경·미래 신청 취소·주최 모임 취소·닉네임 비식별화, 지난 기록 유지', async () => {
    const leaver = await db.createUser({ nickname: '떠나는사람' });
    const otherHost = await db.createUser();
    const guest = await db.createUser();
    await db.rpc(leaver, 'select public.update_my_profile($1::jsonb)', [
      JSON.stringify({ bio: '자기소개', region_code: 'dunsan_tanbang', favorite_category_ids: ['party'] }),
    ]);

    // 떠나는 사람의 게스트 신청: 미래 확정, 미래 대기, 지난 모임 확정
    const futureConfirmed = await createMeetingRpc(db, otherHost, { max_participants: 3 });
    const futureFull = await db.insertMeeting({ hostId: otherHost, maxParticipants: 2 });
    await db.insertParticipant(futureFull, await db.createUser(), 'confirmed');
    const past = await db.insertMeeting({ hostId: otherHost, startAt: daysFromNow(-3) });
    await apply(db, leaver, futureConfirmed);
    expect(await apply(db, leaver, futureFull)).toBe('waitlisted');
    await db.insertParticipant(past, leaver, 'confirmed');

    // 떠나는 사람이 주최: 미래 모임(게스트 있음), 지난 모임
    const hostedFuture = await createMeetingRpc(db, leaver);
    await apply(db, guest, hostedFuture);
    const hostedPast = await db.insertMeeting({ hostId: leaver, startAt: daysFromNow(-2) });

    await db.rpc(leaver, 'select public.request_account_deletion()');

    const profile = await me(leaver);
    expect(profile).toMatchObject({
      status: 'deletion_requested',
      nickname: '탈퇴한 사용자',
      bio: '',
      regionCode: null,
      favoriteCategoryIds: [],
    });
    expect(profile.deletionRequestedAt).not.toBeNull();

    expect(await db.participantStatus(futureConfirmed, leaver)).toBe('cancelled');
    expect(await db.participantStatus(futureFull, leaver)).toBe('cancelled');
    expect(await db.participantStatus(past, leaver)).toBe('confirmed');
    expect(await db.meetingCounts(futureConfirmed)).toMatchObject({ confirmed: 1 });
    expect(await db.meetingCounts(futureFull)).toMatchObject({ waitlisted: 0 });

    const hosted = await db.asOwner((q) =>
      q.one<{ status: string; cancel_reason: string }>('select status, cancel_reason from public.meetings where id = $1', [
        hostedFuture,
      ]),
    );
    expect(hosted).toEqual({ status: 'cancelled', cancel_reason: '모임장 탈퇴' });
    expect(await db.participantStatus(hostedFuture, guest)).toBe('meeting_cancelled');
    const pastStatus = await db.asOwner((q) =>
      q.value<string>('select status::text from public.meetings where id = $1', [hostedPast]),
    );
    expect(pastStatus).toBe('open');

    // 공개 화면에는 "탈퇴한 사용자"로 보인다
    const detail = await db.rpc<{ hostNickname: string }>(null, 'select public.get_meeting($1)', [hostedPast]);
    expect(detail.hostNickname).toBe('탈퇴한 사용자');

    const audit = await db.asOwner((q) =>
      q.value<Record<string, number>>(
        `select meta from public.audit_logs where action = 'account.deletion_requested' and actor_id = $1`,
        [leaver],
      ),
    );
    expect(audit).toEqual({ cancelled_applications: 2, cancelled_meetings: 1 });
    expect(await db.countMismatches()).toEqual([]);
  }, 60_000);

  it('멱등이며 이후 쓰기 RPC는 ACCOUNT_DELETION_REQUESTED', async () => {
    const leaver = await db.createUser();
    const host = await db.createUser();
    const target = await db.createUser();
    const meetingId = await createMeetingRpc(db, host, { start_at: hoursFromNow(30).toISOString() });
    await db.rpc(leaver, 'select public.request_account_deletion()');
    await db.rpc(leaver, 'select public.request_account_deletion()');
    const logs = await db.asOwner((q) =>
      q.value<number>(`select count(*)::int from public.audit_logs where action = 'account.deletion_requested'`),
    );
    expect(logs).toBe(1);

    await expectRpcError(apply(db, leaver, meetingId), 'ACCOUNT_DELETION_REQUESTED');
    await expectRpcError(createMeetingRpc(db, leaver), 'ACCOUNT_DELETION_REQUESTED');
    await expectRpcError(updateProfile(leaver, { nickname: '복귀' }), 'ACCOUNT_DELETION_REQUESTED');
    await expectRpcError(
      db.rpc(leaver, `select public.submit_report('user', $1, 'spam', null)`, [target]),
      'ACCOUNT_DELETION_REQUESTED',
    );
    await expectRpcError(db.rpc(leaver, 'select public.cancel_my_application($1)', [meetingId]), 'ACCOUNT_DELETION_REQUESTED');
  });

  it('탈퇴한 사용자 여러 명이 같은 표시명을 갖고, 옛 닉네임은 다른 사람이 쓸 수 있다', async () => {
    const a = await db.createUser({ nickname: '옛닉네임' });
    const b = await db.createUser();
    const c = await db.createUser();
    await db.rpc(a, 'select public.request_account_deletion()');
    await db.rpc(b, 'select public.request_account_deletion()');
    const names = await db.asOwner((q) =>
      q.query<{ nickname: string }>(`select nickname from public.profiles where status = 'deletion_requested'`),
    );
    expect(names.map((n) => n.nickname)).toEqual(['탈퇴한 사용자', '탈퇴한 사용자']);
    await updateProfile(c, { nickname: '옛닉네임' });
    expect((await me(c)).nickname).toBe('옛닉네임');
  });
});
