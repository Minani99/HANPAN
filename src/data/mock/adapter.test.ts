import { afterEach, describe, expect, it } from 'vitest';
import { kstDateTimeToIso } from '../../lib/date';
import { DataAdapterError } from '../adapter';
import { __setMockFailure, createMockAdapter } from './adapter';
import { queryMeetings } from './query';
import { createSeedMeetings } from './seed';

const NOW = new Date('2026-11-23T03:00:00Z'); // KST 11-23(월) 12:00
const records = createSeedMeetings(NOW);
const ALL = { limit: 50, offset: 0 };

function ids(filters: Parameters<typeof queryMeetings>[1], page = ALL) {
  return queryMeetings(records, filters, page, NOW).items.map((m) => m.id.replace('seed-meeting-', ''));
}

afterEach(() => {
  __setMockFailure(null);
});

describe('mock query (탐색 목록 규칙)', () => {
  it('숨김·취소·이미 시작/종료된 모임을 제외하고 가까운 순으로 정렬한다', () => {
    const result = queryMeetings(records, {}, ALL, NOW);
    expect(result.total).toBe(12);
    const list = ids({});
    for (const excluded of ['10', '11', '12', '16']) expect(list).not.toContain(excluded);
    const starts = result.items.map((m) => Date.parse(m.startAt));
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    expect(list[0]).toBe('01'); // 오늘 15:00
  });

  it('최근 등록순은 createdAt 내림차순', () => {
    const result = queryMeetings(records, { sort: 'newest' }, ALL, NOW);
    const created = result.items.map((m) => Date.parse(m.createdAt));
    expect([...created].sort((a, b) => b - a)).toEqual(created);
    expect(result.items[0]?.id).toBe('seed-meeting-07');
  });

  it('날짜 필터는 KST 하루 범위', () => {
    expect(ids({ date: '2026-11-23' })).toEqual(['01']);
    expect(ids({ date: '2026-11-25' })).toEqual(['03', '04']); // 16은 숨김
    expect(ids({ date: '2026-12-25' })).toEqual([]);
  });

  it('KST 자정 경계: 00:00 시작 모임은 그날, 23:59는 전날', () => {
    const base = records[0]!;
    const edge = [
      { ...base, id: 'edge-midnight', startAt: kstDateTimeToIso('2026-11-26', '00:00') },
      { ...base, id: 'edge-2359', startAt: kstDateTimeToIso('2026-11-25', '23:59') },
    ];
    const run = (date: string) => queryMeetings(edge, { date }, ALL, NOW).items.map((m) => m.id);
    expect(run('2026-11-26')).toEqual(['edge-midnight']);
    expect(run('2026-11-25')).toEqual(['edge-2359']);
  });

  it('카테고리·권역 필터', () => {
    expect(ids({ category: 'strategy' })).toEqual(['03', '09', '14']);
    expect(ids({ region: 'noeun_jijok' })).toEqual(['06', '13']);
    expect(ids({ category: 'party', region: 'dunsan_tanbang' })).toEqual(['01', '07']);
  });

  it('모집 중만: 정원 마감(full)·모집 마감(closed) 제외', () => {
    const list = ids({ recruiting: true });
    expect(list).toHaveLength(10);
    expect(list).not.toContain('03');
    expect(list).not.toContain('09');
  });

  it('검색어: 제목·게임명·장소명·권역명 부분 일치, 대소문자 무시', () => {
    expect(ids({ q: '카탄' })).toEqual(['14']);
    expect(ids({ q: '테라' })).toEqual(['03', '09']); // 게임명 '테라 미스티카' + 제목
    expect(ids({ q: '노은' })).toEqual(['06', '13']); // 권역명
    expect(ids({ q: '파티룸' })).toEqual(['04', '13']); // 장소명
    expect(ids({ q: '보드게임 카페 a' })).toEqual(ids({ q: '보드게임 카페 A' }));
    expect(ids({ q: '보드게임 카페 a' })).toContain('07');
    expect(ids({ q: '없는검색어' })).toEqual([]);
  });

  it('페이지네이션: total은 전체, items는 구간', () => {
    const page1 = queryMeetings(records, {}, { limit: 5, offset: 0 }, NOW);
    const page3 = queryMeetings(records, {}, { limit: 5, offset: 10 }, NOW);
    expect(page1.total).toBe(12);
    expect(page1.items).toHaveLength(5);
    expect(page3.items).toHaveLength(2);
    const all = queryMeetings(records, {}, ALL, NOW).items.map((m) => m.id);
    expect(page3.items.map((m) => m.id)).toEqual(all.slice(10));
  });

  it('페이지 값은 안전한 범위로 보정한다', () => {
    expect(queryMeetings(records, {}, { limit: 1000, offset: -5 }, NOW).items).toHaveLength(12);
    expect(queryMeetings(records, {}, { limit: 0, offset: 0 }, NOW).items).toHaveLength(1);
  });

  it('응답에는 mock 전용 필드가 없고 원본과 분리된 복사본이다', () => {
    const [first] = queryMeetings(records, {}, ALL, NOW).items;
    expect(first).toBeDefined();
    expect(first).not.toHaveProperty('hidden');
    first!.title = '변경';
    expect(records.find((m) => m.id === first!.id)?.title).not.toBe('변경');
  });
});

describe('createMockAdapter', () => {
  const adapter = createMockAdapter({ delayMs: 0, now: () => NOW, records });

  it('mode와 마커', () => {
    expect(adapter.mode).toBe('mock');
    expect(adapter.marker).toBe('HANPAN_DEV_SEED_MARKER');
  });

  it('getMeeting: 숨김은 null, 취소·지난 모임은 상세 조회 가능', async () => {
    expect(await adapter.getMeeting('seed-meeting-16')).toBeNull();
    expect(await adapter.getMeeting('nope')).toBeNull();
    expect((await adapter.getMeeting('seed-meeting-10'))?.status).toBe('cancelled');
    expect((await adapter.getMeeting('seed-meeting-11'))?.id).toBe('seed-meeting-11');
  });

  it('카테고리·권역을 정렬 순서대로 돌려준다', async () => {
    const categories = await adapter.listCategories();
    expect(categories.map((c) => c.id)).toEqual([
      'party',
      'deduction',
      'strategy',
      'murder_mystery',
      'mahjong_etc',
      'holdem_social',
    ]);
    expect(categories.find((c) => c.id === 'holdem_social')?.name).toBe('홀덤(비금전)');
    expect((await adapter.listRegions()).map((r) => r.name)).toEqual([
      '둔산·탄방',
      '궁동·봉명',
      '은행·대흥',
      '노은·지족',
      '관저·가수원',
      '그 외 대전',
    ]);
  });

  it('__setMockFailure로 지정 횟수만큼 실패시킬 수 있다', async () => {
    __setMockFailure({ methods: ['listMeetings'], times: 1 });
    await expect(adapter.listMeetings({}, ALL)).rejects.toBeInstanceOf(DataAdapterError);
    await expect(adapter.listMeetings({}, ALL)).resolves.toMatchObject({ total: 12 });
  });

  it('지정하지 않은 메서드는 실패하지 않고, true는 해제 전까지 모두 실패', async () => {
    __setMockFailure({ methods: ['getMeeting'] });
    await expect(adapter.listMeetings({}, ALL)).resolves.toBeDefined();
    __setMockFailure(true);
    await expect(adapter.listCategories()).rejects.toThrow();
    await expect(adapter.listRegions()).rejects.toThrow();
    __setMockFailure(false);
    await expect(adapter.listRegions()).resolves.toHaveLength(6);
  });
});

describe('createMockAdapter: 인증·저장·동시성', () => {
  function memoryStorage() {
    const map = new Map<string, string>();
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
      map,
    };
  }

  it('테스트 계정 목록·로그인·로그아웃과 상태 변경 알림', async () => {
    const adapter = createMockAdapter({ delayMs: 0, now: () => NOW, persist: false });
    const events: (string | null)[] = [];
    const unsubscribe = adapter.auth.onAuthStateChange((user) => events.push(user?.id ?? null));
    const accounts = await adapter.auth.listDevAccounts();
    expect(accounts.map((a) => a.nickname)).toEqual(['예시사용자A', '예시사용자B', '예시신규사용자', '예시관리계정']);
    expect(await adapter.auth.getSessionUser()).toBeNull();
    const user = await adapter.auth.signInAsDev('dev-user-new');
    expect(user).toMatchObject({ id: 'dev-user-new', onboarded: false, isAdmin: false });
    expect(await adapter.getMyProfile()).toMatchObject({ termsAgreedAt: null });
    await adapter.auth.signOut();
    expect(await adapter.auth.getSessionUser()).toBeNull();
    expect(events).toEqual(['dev-user-new', null]);
    unsubscribe();
    await expect(adapter.auth.signInAsDev('seed-guest-01')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('OAuth는 mock에서 연결되지 않는다(테스트 계정 안내용 오류)', async () => {
    const adapter = createMockAdapter({ delayMs: 0, now: () => NOW, persist: false });
    await expect(adapter.auth.signInWithOAuth('google', '/')).rejects.toMatchObject({
      code: 'SERVICE_UNCONFIGURED',
      detail: 'use_dev_account',
    });
  });

  it('상태를 저장소(localStorage 대체)에 저장해 새 어댑터에서도 유지된다', async () => {
    const storage = memoryStorage();
    const first = createMockAdapter({ delayMs: 0, now: () => NOW, persist: true, storage });
    await first.auth.signInAsDev('dev-user-b');
    expect(await first.applyToMeeting('seed-meeting-01', null)).toBe('confirmed');
    expect(storage.map.has('hanpan.mock.v2')).toBe(true);

    const second = createMockAdapter({ delayMs: 0, now: () => NOW, persist: true, storage });
    expect((await second.auth.getSessionUser())?.id).toBe('dev-user-b');
    expect((await second.getMyParticipation('seed-meeting-01'))?.status).toBe('confirmed');
    expect((await second.getMeeting('seed-meeting-01'))?.confirmedCount).toBe(3);

    // 개발 데이터 초기화: 처음 상태 + 로그아웃
    await second.auth.resetDevData();
    expect(await second.auth.getSessionUser()).toBeNull();
    expect((await second.getMeeting('seed-meeting-01'))?.confirmedCount).toBe(2);
  });

  it('저장된 예시 데이터가 24시간보다 오래되면 새로 만든다', async () => {
    const storage = memoryStorage();
    const first = createMockAdapter({ delayMs: 0, now: () => NOW, persist: true, storage });
    await first.auth.signInAsDev('dev-user-b');
    await first.applyToMeeting('seed-meeting-01', null);
    const later = new Date(NOW.getTime() + 25 * 60 * 60 * 1000);
    const second = createMockAdapter({ delayMs: 0, now: () => later, persist: true, storage });
    expect(await second.getMyParticipation('seed-meeting-01')).toBeNull();
    expect((await second.auth.getSessionUser())?.id).toBe('dev-user-b');
  });

  it('같은 계정이 동시에 두 번 신청해도 1건만 반영된다(두 번째는 ALREADY_APPLIED)', async () => {
    const adapter = createMockAdapter({ delayMs: 5, now: () => NOW, persist: false, sessionUserId: 'dev-user-b' });
    const results = await Promise.allSettled([
      adapter.applyToMeeting('seed-meeting-01', null),
      adapter.applyToMeeting('seed-meeting-01', null),
    ]);
    const outcomes = results.map((r) => (r.status === 'fulfilled' ? r.value : (r.reason as DataAdapterError).code));
    expect(outcomes.sort()).toEqual(['ALREADY_APPLIED', 'confirmed']);
    expect((await adapter.getMeeting('seed-meeting-01'))?.confirmedCount).toBe(3);
  });

  it('남은 1자리: 먼저 처리된 신청만 확정되고 다음 신청은 MEETING_FULL', async () => {
    const base = createMockAdapter({ delayMs: 0, now: () => NOW, persist: false });
    const db = base.snapshot();
    db.meetings = db.meetings.map((m) => (m.id === 'seed-meeting-04' ? { ...m, approvalMode: 'auto' as const } : m));
    const asB = createMockAdapter({ delayMs: 0, now: () => NOW, persist: false, db, sessionUserId: 'dev-user-b' });
    expect(await asB.applyToMeeting('seed-meeting-04', null)).toBe('confirmed');
    const asAdmin = createMockAdapter({ delayMs: 0, now: () => NOW, persist: false, db: asB.snapshot(), sessionUserId: 'dev-user-admin' });
    await expect(asAdmin.applyToMeeting('seed-meeting-04', null)).rejects.toMatchObject({ code: 'MEETING_FULL' });
  });

  it('오류 주입은 지정한 코드로 실패한다(신청 실패 화면 확인용)', async () => {
    const adapter = createMockAdapter({ delayMs: 0, now: () => NOW, persist: false, sessionUserId: 'dev-user-b' });
    __setMockFailure({ methods: ['applyToMeeting'], times: 1, code: 'MEETING_FULL' });
    await expect(adapter.applyToMeeting('seed-meeting-01', null)).rejects.toMatchObject({ code: 'MEETING_FULL' });
    expect(await adapter.getMyParticipation('seed-meeting-01')).toBeNull();
    expect(await adapter.applyToMeeting('seed-meeting-01', null)).toBe('confirmed');
  });
});
