/**
 * 공개 조회: 비로그인(anon) 목록·상세, 숨김 모임 노출 범위, list_public_meetings 필터·정렬·페이지·검색.
 * 마스터 프롬프트 8장 #1(미로그인 목록·상세), TEST_PLAN §2 #1·#13.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  apply,
  createMeetingRpc,
  createTestDb,
  daysFromNow,
  expectPermissionDenied,
  expectRpcError,
  hoursFromNow,
  type TestDb,
} from './harness';

interface MeetingJson {
  id: string;
  hostId: string | null;
  hostNickname: string | null;
  title: string;
  gameName: string | null;
  venueName: string | null;
  confirmedCount: number;
  remainingSeats: number;
  status: string;
  isHidden: boolean;
  hiddenReason: string | null;
  startAt: string;
  createdAt: string;
  imageUrl: null;
}

interface ListResult {
  items: MeetingJson[];
  total: number;
}

interface ListArgs {
  dateFrom?: string | null;
  dateTo?: string | null;
  category?: string | null;
  region?: string | null;
  q?: string | null;
  recruiting?: boolean;
  sort?: string;
  limit?: number;
  offset?: number;
}

function list(db: TestDb, userId: string | null, args: ListArgs = {}): Promise<ListResult> {
  return db.rpc<ListResult>(
    userId,
    `select public.list_public_meetings(
       p_date_from => $1::timestamptz, p_date_to => $2::timestamptz, p_category => $3, p_region => $4, p_q => $5,
       p_recruiting => $6, p_sort => $7, p_limit => $8, p_offset => $9)`,
    [
      args.dateFrom ?? null,
      args.dateTo ?? null,
      args.category ?? null,
      args.region ?? null,
      args.q ?? null,
      args.recruiting ?? false,
      args.sort ?? 'soonest',
      args.limit ?? 20,
      args.offset ?? 0,
    ],
  );
}

function getMeeting(db: TestDb, userId: string | null, id: string): Promise<MeetingJson | null> {
  return db.rpc<MeetingJson | null>(userId, 'select public.get_meeting($1)', [id]);
}

let db: TestDb;
beforeEach(async () => {
  db = await createTestDb();
});
afterEach(async () => {
  await db.close();
});

describe('비로그인 조회', () => {
  it('anon이 공개 모임 목록과 상세를 볼 수 있고 Meeting 모양 필드를 받는다', async () => {
    const host = await db.createUser({ nickname: '모임장A' });
    const meetingId = await createMeetingRpc(db, host, { title: '공개 모임', game_name: '스플렌더' });

    const result = await list(db, null);
    expect(result.total).toBe(1);
    const item = result.items[0];
    expect(item).toMatchObject({
      id: meetingId,
      hostId: host,
      hostNickname: '모임장A',
      title: '공개 모임',
      gameName: '스플렌더',
      venueName: null,
      confirmedCount: 1,
      remainingSeats: 3,
      status: 'open',
      isHidden: false,
      imageUrl: null,
    });
    expect(item?.startAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?\+00:00$/);

    const detail = await getMeeting(db, null, meetingId);
    expect(detail?.id).toBe(meetingId);

    const direct = await db.asAnon((q) => q.query('select id, title from public.meetings'));
    expect(direct).toHaveLength(1);
  });

  it('anon은 profiles의 공개 컬럼만 읽고 status는 읽을 수 없다', async () => {
    await db.createUser({ nickname: '공개닉' });
    const rows = await db.asAnon((q) => q.query('select id, nickname, region_code, bio, favorite_category_ids, created_at from public.profiles'));
    expect(rows).toHaveLength(1);
    await expectPermissionDenied(db.asAnon((q) => q.query('select status from public.profiles')));
    await expectPermissionDenied(db.asAnon((q) => q.query('select * from public.profiles')));
  });

  it('취소·종료된 모임도 상세는 반환하고, 없는 모임은 null', async () => {
    const host = await db.createUser();
    const cancelled = await db.insertMeeting({ hostId: host, status: 'cancelled' });
    const ended = await db.insertMeeting({ hostId: host, startAt: daysFromNow(-3) });
    expect((await getMeeting(db, null, cancelled))?.status).toBe('cancelled');
    expect((await getMeeting(db, null, ended))?.id).toBe(ended);
    expect(await getMeeting(db, null, '00000000-0000-4000-8000-000000000000')).toBeNull();
  });
});

describe('숨김 모임 노출 범위', () => {
  it('숨김 모임은 anon·다른 사용자에게 안 보이고, 모임장·관리자에게만 보인다', async () => {
    const host = await db.createUser();
    const other = await db.createUser();
    const admin = await db.createUser({ admin: true });
    const hidden = await db.insertMeeting({ hostId: host, isHidden: true, title: '숨김 모임' });
    await db.insertMeeting({ hostId: host, title: '보이는 모임' });

    expect(await getMeeting(db, null, hidden)).toBeNull();
    expect(await getMeeting(db, other, hidden)).toBeNull();
    expect((await getMeeting(db, host, hidden))?.isHidden).toBe(true);
    expect((await getMeeting(db, admin, hidden))?.isHidden).toBe(true);

    const anonRows = await db.asAnon((q) => q.query<{ title: string }>('select title from public.meetings'));
    expect(anonRows.map((r) => r.title)).toEqual(['보이는 모임']);
    const otherRows = await db.asUser(other, (q) => q.query('select id from public.meetings where id = $1', [hidden]));
    expect(otherRows).toEqual([]);
    const hostRows = await db.asUser(host, (q) => q.query('select id from public.meetings where id = $1', [hidden]));
    expect(hostRows).toHaveLength(1);

    // 공개 목록에는 모임장·관리자에게도 숨김 모임이 나오지 않는다(명시 필터)
    for (const viewer of [null, other, host, admin]) {
      const result = await list(db, viewer);
      expect(result.items.map((i) => i.title)).toEqual(['보이는 모임']);
    }
  });
});

describe('list_public_meetings 필터·정렬·페이지', () => {
  it('취소·시작된·지난 모임을 제외한다', async () => {
    const host = await db.createUser();
    await db.insertMeeting({ hostId: host, title: '예정', startAt: hoursFromNow(5) });
    await db.insertMeeting({ hostId: host, title: '취소', status: 'cancelled' });
    await db.insertMeeting({ hostId: host, title: '진행 중', startAt: hoursFromNow(-1) });
    await db.insertMeeting({ hostId: host, title: '지남', startAt: daysFromNow(-2) });
    await db.insertMeeting({ hostId: host, title: '마감', status: 'closed' });
    const result = await list(db, null);
    expect(result.items.map((i) => i.title).sort()).toEqual(['마감', '예정']);
    expect(result.total).toBe(2);
  });

  it('날짜 범위 [from, to), 카테고리, 권역 필터', async () => {
    const host = await db.createUser();
    const day1 = new Date('2030-01-01T00:00:00Z');
    const inDay = new Date(Date.now() + 3 * 86_400_000);
    const from = new Date(inDay.getTime() - 3_600_000).toISOString();
    const to = new Date(inDay.getTime() + 3_600_000).toISOString();
    await db.insertMeeting({ hostId: host, title: '범위 안', startAt: inDay, categoryId: 'strategy', regionCode: 'noeun_jijok' });
    await db.insertMeeting({ hostId: host, title: '범위 끝(제외)', startAt: to, categoryId: 'strategy' });
    await db.insertMeeting({ hostId: host, title: '범위 시작(포함)', startAt: from, categoryId: 'party' });
    await db.insertMeeting({ hostId: host, title: '먼 미래', startAt: day1 });

    const byDate = await list(db, null, { dateFrom: from, dateTo: to });
    expect(byDate.items.map((i) => i.title)).toEqual(['범위 시작(포함)', '범위 안']);

    const byCategory = await list(db, null, { category: 'strategy' });
    expect(byCategory.items.map((i) => i.title)).toEqual(['범위 안', '범위 끝(제외)']);

    const byRegion = await list(db, null, { region: 'noeun_jijok' });
    expect(byRegion.items.map((i) => i.title)).toEqual(['범위 안']);

    const unknown = await list(db, null, { category: 'no_such_category' });
    expect(unknown).toEqual({ items: [], total: 0 });
  });

  it('recruiting=true면 status=open이고 남은 자리가 있는 모임만', async () => {
    const host = await db.createUser();
    const guest = await db.createUser();
    await db.insertMeeting({ hostId: host, title: '모집 중', maxParticipants: 4 });
    await db.insertMeeting({ hostId: host, title: '모임장 마감', status: 'closed' });
    const full = await db.insertMeeting({ hostId: host, title: '정원 마감', maxParticipants: 2 });
    await db.insertParticipant(full, guest, 'confirmed');

    const all = await list(db, null);
    expect(all.total).toBe(3);
    const recruiting = await list(db, null, { recruiting: true });
    expect(recruiting.items.map((i) => i.title)).toEqual(['모집 중']);
    const fullItem = all.items.find((i) => i.title === '정원 마감');
    expect(fullItem?.remainingSeats).toBe(0);
  });

  it('정렬: soonest(시작 시각 오름차순), newest(생성 시각 내림차순), 동률은 id', async () => {
    const host = await db.createUser();
    await db.insertMeeting({ hostId: host, title: 'BB', startAt: hoursFromNow(10), createdAt: hoursFromNow(-1) });
    await db.insertMeeting({ hostId: host, title: 'AA', startAt: hoursFromNow(5), createdAt: hoursFromNow(-3) });
    await db.insertMeeting({ hostId: host, title: 'CC', startAt: hoursFromNow(20), createdAt: hoursFromNow(-2) });

    expect((await list(db, null, { sort: 'soonest' })).items.map((i) => i.title)).toEqual(['AA', 'BB', 'CC']);
    expect((await list(db, null, { sort: 'newest' })).items.map((i) => i.title)).toEqual(['BB', 'CC', 'AA']);
    await expectRpcError(list(db, null, { sort: 'popular' }), 'VALIDATION_FAILED', 'sort');
  });

  it('페이지: limit/offset, total은 전체 개수, limit은 1~50으로 보정, offset 음수는 0', async () => {
    const host = await db.createUser();
    for (let i = 0; i < 5; i += 1) {
      await db.insertMeeting({ hostId: host, title: `모임${i}`, startAt: hoursFromNow(10 + i) });
    }
    const page2 = await list(db, null, { limit: 2, offset: 2 });
    expect(page2.total).toBe(5);
    expect(page2.items.map((i) => i.title)).toEqual(['모임2', '모임3']);

    const zero = await list(db, null, { limit: 0 });
    expect(zero.items).toHaveLength(1);
    const negativeOffset = await list(db, null, { limit: 2, offset: -10 });
    expect(negativeOffset.items.map((i) => i.title)).toEqual(['모임0', '모임1']);
    const beyond = await list(db, null, { offset: 100 });
    expect(beyond).toEqual({ items: [], total: 5 });
  });

  it('limit 상한 50', async () => {
    const host = await db.createUser();
    await db.asOwner((q) =>
      q.query(
        `insert into public.meetings (host_id, category_id, title, start_at, end_at, duration_minutes, region_code,
           min_participants, max_participants, skill_level, approval_mode)
         select $1, 'party', '대량' || g, now() + make_interval(hours => g), now() + make_interval(hours => g + 2), 120,
           'dunsan_tanbang', 2, 4, 'anyone', 'auto'
         from generate_series(1, 55) g`,
        [host],
      ),
    );
    const result = await list(db, null, { limit: 1000 });
    expect(result.items).toHaveLength(50);
    expect(result.total).toBe(55);
  });
});

describe('list_public_meetings 검색어', () => {
  async function seedSearch(): Promise<void> {
    const host = await db.createUser();
    const venueId = await db.asOwner((q) =>
      q.value<string>(
        `insert into public.venues (name, region_code, address, venue_type, is_public)
         values ('보드카페 큐브', 'gung_bongmyeong', '대전 유성구', 'board_game_cafe', true) returning id`,
      ),
    );
    await db.insertMeeting({ hostId: host, title: '100% 초보 환영', startAt: hoursFromNow(10) });
    await db.insertMeeting({ hostId: host, title: '초보 환영 1000', startAt: hoursFromNow(11) });
    await db.insertMeeting({ hostId: host, title: 'under_score 모임', startAt: hoursFromNow(12) });
    await db.insertMeeting({ hostId: host, title: 'underXscore 모임', startAt: hoursFromNow(13) });
    await db.insertMeeting({ hostId: host, title: '역슬래시 a\\b', startAt: hoursFromNow(14) });
    await db.insertMeeting({ hostId: host, title: '게임 검색', gameName: 'Terraforming Mars', startAt: hoursFromNow(15) });
    await db.insertMeeting({
      hostId: host,
      title: '장소 검색',
      venueId,
      regionCode: 'gung_bongmyeong',
      startAt: hoursFromNow(16),
    });
    await db.insertMeeting({ hostId: host, title: '장소 메모', venueNote: '탄방역 근처 카페', startAt: hoursFromNow(17) });
    await db.insertMeeting({ hostId: host, title: '권역 검색', regionCode: 'gwanjeo_gasuwon', startAt: hoursFromNow(18) });
  }

  it('제목·게임명·장소명·장소 메모·권역명을 대소문자 무시 부분 일치로 찾는다', async () => {
    await seedSearch();
    const titles = async (q: string) => (await list(db, null, { q })).items.map((i) => i.title);
    expect(await titles('초보')).toEqual(['100% 초보 환영', '초보 환영 1000']);
    expect(await titles('terraforming')).toEqual(['게임 검색']);
    expect(await titles('큐브')).toEqual(['장소 검색']);
    expect(await titles('탄방역')).toEqual(['장소 메모']);
    expect(await titles('관저')).toEqual(['권역 검색']);
    expect(await titles('   ')).toHaveLength(9);
  });

  it('%, _, \\ 입력은 와일드카드가 아니라 문자 그대로 찾는다', async () => {
    await seedSearch();
    const titles = async (q: string) => (await list(db, null, { q })).items.map((i) => i.title);
    expect(await titles('%')).toEqual(['100% 초보 환영']);
    expect(await titles('100%')).toEqual(['100% 초보 환영']);
    expect(await titles('_')).toEqual(['under_score 모임']);
    expect(await titles('under_score')).toEqual(['under_score 모임']);
    expect(await titles('\\')).toEqual(['역슬래시 a\\b']);
    expect(await titles('%%%')).toEqual([]);
  });

  it('검색어는 50자로 잘린다', async () => {
    const host = await db.createUser();
    const longTitle = '가'.repeat(50) + '끝';
    await db.insertMeeting({ hostId: host, title: longTitle.slice(0, 60) });
    // 51자 검색어 중 앞 50자('가'*50)만 쓰이므로 일치한다
    const result = await list(db, null, { q: '가'.repeat(50) + '없는글자' });
    expect(result.total).toBe(1);
  });
});

describe('탈퇴(계정 삭제)한 모임장', () => {
  it('auth.users 삭제 시 모임은 host_id = null로 남고 다른 참가자 기록이 보존된다', async () => {
    const host = await db.createUser({ nickname: '떠날모임장' });
    const guest = await db.createUser();
    const meetingId = await db.insertMeeting({ hostId: host, startAt: daysFromNow(-5) });
    await db.insertParticipant(meetingId, guest, 'confirmed');

    await db.asOwner((q) => q.query('delete from auth.users where id = $1', [host]));

    const detail = await getMeeting(db, null, meetingId);
    expect(detail?.hostId).toBeNull();
    expect(detail?.hostNickname).toBeNull();
    const guestRow = await db.participantStatus(meetingId, guest);
    expect(guestRow).toBe('confirmed');
  });

  it('모임장이 없는 미래 모임에는 신청할 수 없다', async () => {
    const host = await db.createUser();
    const guest = await db.createUser();
    const meetingId = await createMeetingRpc(db, host);
    await db.asOwner((q) => q.query('delete from auth.users where id = $1', [host]));
    await expectRpcError(apply(db, guest, meetingId), 'MEETING_NOT_OPEN', 'host_missing');
  });
});

describe('공간 이름 노출', () => {
  it('공개 공간 이름은 보이고, 비공개로 바뀐 공간 이름은 anon에게 null(관리자에게는 보임)', async () => {
    const host = await db.createUser();
    const admin = await db.createUser({ admin: true });
    const venueId = await db.asOwner((q) =>
      q.value<string>(
        `insert into public.venues (name, region_code, address, venue_type, is_public)
         values ('공개 카페', 'dunsan_tanbang', '주소', 'board_game_cafe', true) returning id`,
      ),
    );
    const meetingId = await createMeetingRpc(db, host, { venue_id: venueId });
    expect((await getMeeting(db, null, meetingId))?.venueName).toBe('공개 카페');
    await db.asOwner((q) => q.query('update public.venues set is_public = false where id = $1', [venueId]));
    expect((await getMeeting(db, null, meetingId))?.venueName).toBeNull();
    expect((await getMeeting(db, admin, meetingId))?.venueName).toBe('공개 카페');
  });
});
