/**
 * 개발 전용 mock 어댑터.
 * src/data/index.ts에서 `import.meta.env.DEV || MODE === 'e2e'`일 때만 동적 import 된다. 정적 import 금지.
 *
 * - 규칙은 ./rules.ts(DB RPC 흉내), 초기 데이터는 ./seed.ts.
 * - 브라우저에서는 상태(모임·신청·프로필·로그인 계정)를 localStorage `hanpan.mock.v1`에 저장해
 *   새로고침·라우트 이동 후에도 유지한다. 단위 테스트(MODE=test)에서는 메모리에만 둔다.
 * - 로그인은 실제 OAuth가 아니라 개발용 테스트 계정 선택이다(auth.listDevAccounts / signInAsDev).
 */
import { isCategoryId, sortCategories } from '../../domain/categories';
import { REGIONS, sortRegions } from '../../domain/regions';
import { consumeReturnTo } from '../../lib/returnTo';
import { DataAdapterError, type AuthAdapter, type DataAdapter } from '../adapter';
import type { Category, DevAccount, ErrorCode, SessionUser } from '../types';
import { queryMeetings } from './query';
import { cloneJson, type MockDb, type MockMeetingRecord } from './records';
import * as rules from './rules';
import { DEV_SEED_MARKER, createSeedDb } from './seed';

export type MockMethod =
  | 'listMeetings'
  | 'getMeeting'
  | 'listCategories'
  | 'listRegions'
  | 'getMyParticipation'
  | 'applyToMeeting'
  | 'cancelMyApplication'
  | 'createMeeting'
  | 'updateMeeting'
  | 'cancelMeeting'
  | 'setMeetingRecruiting'
  | 'listMyMeetings'
  | 'listParticipants'
  | 'decideParticipant'
  | 'markAttendance'
  | 'getMyProfile'
  | 'updateMyProfile'
  | 'requestAccountDeletion'
  | 'listVenues'
  | 'getVenue'
  | 'submitReport'
  | 'adminListReports'
  | 'adminUpdateReport'
  | 'adminListMeetings'
  | 'adminSetMeetingHidden'
  | 'adminCancelMeeting'
  | 'adminSearchUsers'
  | 'adminSetUserStatus'
  | 'adminListVenues'
  | 'adminSaveVenue'
  | 'adminSetVenuePublic'
  | 'adminListCategories'
  | 'adminSetCategoryActive'
  | 'getSessionUser'
  | 'signInAsDev'
  | 'signOut'
  | 'completeOAuthCallback';

export interface MockFailureOptions {
  /** 실패시킬 메서드. 생략하면 모든 메서드 */
  methods?: readonly MockMethod[];
  /** 남은 실패 횟수. 생략하면 해제할 때까지 계속 실패 */
  times?: number;
  /** 던질 오류 코드. 기본 NETWORK_ERROR */
  code?: ErrorCode;
  detail?: string;
  message?: string;
}

interface FailureState {
  methods: ReadonlySet<MockMethod> | null;
  remaining: number;
  code: ErrorCode;
  detail?: string;
  message: string;
}

let failureState: FailureState | null = null;

/**
 * 테스트·수동 확인용 오류 주입.
 * - `__setMockFailure(true)` 모든 호출 실패(NETWORK_ERROR)
 * - `__setMockFailure({ methods: ['listMeetings'], times: 1 })` 다음 목록 요청 1회만 실패
 * - `__setMockFailure({ methods: ['applyToMeeting'], times: 1, code: 'MEETING_FULL' })` 규칙 오류 흉내
 * - `__setMockFailure(false | null)` 해제
 */
export function __setMockFailure(options: MockFailureOptions | boolean | null): void {
  if (!options) {
    failureState = null;
    return;
  }
  const config = options === true ? {} : options;
  failureState = {
    methods: config.methods ? new Set(config.methods) : null,
    remaining: config.times ?? Number.POSITIVE_INFINITY,
    code: config.code ?? 'NETWORK_ERROR',
    ...(config.detail !== undefined ? { detail: config.detail } : {}),
    message: config.message ?? '개발용 오류 시뮬레이션입니다.',
  };
}

function consumeFailure(method: MockMethod): void {
  const state = failureState;
  if (!state) return;
  if (state.methods && !state.methods.has(method)) return;
  state.remaining -= 1;
  if (state.remaining <= 0) failureState = null;
  throw new DataAdapterError(state.code, {
    message: state.message,
    ...(state.detail !== undefined ? { detail: state.detail } : {}),
  });
}

/**
 * localStorage 키. 구조가 바뀌면 버전을 올린다(이전 값은 무시하고 새로 만든다).
 * v2(Phase 4): 공간·신고·카테고리 추가
 */
export const MOCK_STORAGE_KEY = 'hanpan.mock.v2';

/** 저장된 예시 데이터가 이보다 오래되면 새로 만든다(예시 일정이 모두 지난 상태를 피하려고) */
const SEED_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type MockStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

interface PersistedState {
  version: 2;
  seededAt: string;
  sessionUserId: string | null;
  db: MockDb;
}

function isPersistedState(value: unknown): value is PersistedState {
  if (typeof value !== 'object' || value === null) return false;
  const state = value as Partial<PersistedState>;
  return (
    state.version === 2 &&
    typeof state.seededAt === 'string' &&
    (state.sessionUserId === null || typeof state.sessionUserId === 'string') &&
    typeof state.db === 'object' &&
    state.db !== null &&
    Array.isArray(state.db.meetings) &&
    Array.isArray(state.db.participants) &&
    Array.isArray(state.db.profiles) &&
    Array.isArray(state.db.venues) &&
    Array.isArray(state.db.reports) &&
    Array.isArray(state.db.categories) &&
    typeof state.db.seq === 'number'
  );
}

export interface MockAdapterOptions {
  /** 응답 지연(ms). 기본 300ms, 테스트 모드 0ms */
  delayMs?: number;
  /** 기준 시각. 기본 현재 시각 */
  now?: () => Date;
  /** 기본 seed 모임 대신 사용할 모임(참가 행은 인원 수에 맞춰 생성된다) */
  records?: readonly MockMeetingRecord[];
  /** 저장소 전체를 직접 지정(테스트용). records보다 우선 */
  db?: MockDb;
  /** 시작할 때 로그인된 계정 id(테스트용) */
  sessionUserId?: string | null;
  /** localStorage에 저장할지. 기본: 브라우저이면서 단위 테스트가 아닐 때 */
  persist?: boolean;
  /** 저장소 구현(테스트용). 기본 window.localStorage */
  storage?: MockStorage;
}

export interface MockDataAdapter extends DataAdapter {
  readonly mode: 'mock';
  readonly marker: typeof DEV_SEED_MARKER;
  readonly auth: Required<AuthAdapter>;
  /** 테스트용: 현재 저장소 복사본 */
  snapshot(): MockDb;
}

const DEFAULT_DELAY_MS = import.meta.env.MODE === 'test' ? 0 : 300;

function wait(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function copy<T>(value: T): T {
  return value === undefined ? value : cloneJson(value);
}

declare global {
  interface Window {
    /** 개발/e2e 모드에서만 존재. 브라우저 콘솔이나 Playwright에서 오류 상태를 재현할 때 사용 */
    __HANPAN_MOCK__?: {
      marker: string;
      storageKey: string;
      setFailure: typeof __setMockFailure;
      reset: () => Promise<void>;
    };
  }
}

function defaultStorage(): MockStorage | undefined {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

export function createMockAdapter(options: MockAdapterOptions = {}): MockDataAdapter {
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const now = options.now ?? (() => new Date());
  const persist = options.persist ?? (typeof window !== 'undefined' && import.meta.env.MODE !== 'test');
  const storage = persist ? (options.storage ?? defaultStorage()) : undefined;
  const fresh = (): MockDb => options.db ? cloneJson(options.db) : createSeedDb(now(), options.records);

  let state: PersistedState = loadState();
  const listeners = new Set<(user: SessionUser | null) => void>();

  function loadState(): PersistedState {
    const initial = (): PersistedState => ({
      version: 2,
      seededAt: now().toISOString(),
      sessionUserId: options.sessionUserId ?? null,
      db: fresh(),
    });
    if (!storage || options.db || options.records) return initial();
    try {
      const raw = storage.getItem(MOCK_STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (isPersistedState(parsed)) {
        const age = now().getTime() - Date.parse(parsed.seededAt);
        if (age >= 0 && age < SEED_MAX_AGE_MS) return parsed;
        // 오래된 예시 데이터는 새로 만들되, 로그인한 테스트 계정은 유지한다.
        return { ...initial(), sessionUserId: parsed.sessionUserId };
      }
    } catch {
      // 손상된 값은 버리고 새로 만든다.
    }
    return initial();
  }

  function save(): void {
    if (!storage) return;
    try {
      storage.setItem(MOCK_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // 저장 공간 부족·사생활 보호 모드: 메모리 상태로만 계속 동작한다.
    }
  }
  save();

  function sessionUser(): SessionUser | null {
    const profile = state.db.profiles.find((item) => item.id === state.sessionUserId);
    return profile ? rules.toSessionUser(profile) : null;
  }

  function emit(): void {
    const user = sessionUser();
    for (const listener of listeners) listener(copy(user));
  }

  async function read<T>(method: MockMethod, work: (db: MockDb, viewerId: string | null) => T): Promise<T> {
    await wait(delayMs);
    consumeFailure(method);
    return copy(work(state.db, state.sessionUserId));
  }

  async function write<T>(
    method: MockMethod,
    work: (db: MockDb, actorId: string | null, at: Date) => rules.RuleResult<T>,
  ): Promise<T> {
    await wait(delayMs);
    consumeFailure(method);
    // 기다리는 동안 다른 요청이 저장소를 바꿨을 수 있으므로 최신 상태로 동기 실행한다(행 잠금 흉내).
    const { db, value } = work(state.db, state.sessionUserId, now());
    state = { ...state, db };
    save();
    return copy(value);
  }

  async function resetDevData(): Promise<void> {
    await wait(delayMs);
    state = { version: 2, seededAt: now().toISOString(), sessionUserId: null, db: fresh() };
    save();
    emit();
  }

  // 다른 탭에서 로그인·로그아웃·데이터 변경이 일어나면 따라간다.
  if (storage && typeof window !== 'undefined') {
    window.addEventListener('storage', (event) => {
      if (event.key !== MOCK_STORAGE_KEY) return;
      const previousUser = state.sessionUserId;
      try {
        const parsed: unknown = event.newValue ? JSON.parse(event.newValue) : null;
        if (isPersistedState(parsed)) state = parsed;
      } catch {
        return;
      }
      if (previousUser !== state.sessionUserId) emit();
    });
  }

  const auth: Required<AuthAdapter> = {
    getSessionUser() {
      return read('getSessionUser', () => sessionUser());
    },
    onAuthStateChange(callback) {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    async signInWithOAuth() {
      // 개발 모드에는 OAuth 공급자 연결이 없다. 로그인 화면이 테스트 계정 선택을 안내한다.
      throw new DataAdapterError('SERVICE_UNCONFIGURED', {
        detail: 'use_dev_account',
        message: '개발 모드에서는 개발용 테스트 계정으로 로그인합니다.',
      });
    },
    async completeOAuthCallback() {
      await wait(delayMs);
      consumeFailure('completeOAuthCallback');
      if (!sessionUser()) throw new DataAdapterError('AUTH_REQUIRED');
      return { returnTo: consumeReturnTo() };
    },
    async signOut() {
      await wait(delayMs);
      consumeFailure('signOut');
      state = { ...state, sessionUserId: null };
      save();
      emit();
    },
    listDevAccounts() {
      return read('getSessionUser', (db) =>
        db.profiles
          .filter((profile) => profile.devAccountDescription)
          .map(
            (profile): DevAccount => ({
              id: profile.id,
              nickname: profile.nickname,
              description: profile.devAccountDescription ?? '',
              onboarded: rules.isOnboarded(profile),
              // 관리자 역할 여부(개발용 계정 목록 표시용 — 계정 상태와 무관). 실제 관리자 권한은 rules.hasAdminPower
              isAdmin: profile.isAdmin,
              status: profile.status,
            }),
          ),
      );
    },
    async signInAsDev(accountId) {
      await wait(delayMs);
      consumeFailure('signInAsDev');
      const profile = state.db.profiles.find((item) => item.id === accountId && item.devAccountDescription);
      if (!profile) throw new DataAdapterError('NOT_FOUND', { detail: 'dev_account' });
      state = { ...state, sessionUserId: profile.id };
      save();
      emit();
      return rules.toSessionUser(profile);
    },
    resetDevData,
  };

  if (typeof window !== 'undefined') {
    window.__HANPAN_MOCK__ = {
      marker: DEV_SEED_MARKER,
      storageKey: MOCK_STORAGE_KEY,
      setFailure: __setMockFailure,
      reset: resetDevData,
    };
  }

  return {
    mode: 'mock',
    marker: DEV_SEED_MARKER,
    auth,
    snapshot() {
      return cloneJson(state.db);
    },
    listMeetings(filters, page) {
      return read('listMeetings', (db, viewerId) =>
        queryMeetings(db.meetings, filters, page, now(), {
          venues: db.venues,
          viewerIsAdmin: rules.hasAdminPower(db.profiles.find((profile) => profile.id === viewerId)),
        }),
      );
    },
    getMeeting(id) {
      return read('getMeeting', (db, viewerId) => rules.viewMeeting(db, viewerId, id));
    },
    listCategories() {
      // DB와 같이 활성 카테고리만(관리자가 비활성화하면 빠진다)
      return read('listCategories', (db) =>
        sortCategories(
          db.categories.flatMap((category): Category[] =>
            category.isActive && isCategoryId(category.id)
              ? [{ id: category.id, name: category.name, sortOrder: category.sortOrder }]
              : [],
          ),
        ),
      );
    },
    listRegions() {
      return read('listRegions', () => sortRegions(REGIONS));
    },
    getMyParticipation(meetingId) {
      return read('getMyParticipation', (db, viewerId) => rules.viewMyParticipation(db, viewerId, meetingId));
    },
    applyToMeeting(meetingId, message) {
      return write('applyToMeeting', (db, actorId, at) => rules.applyToMeeting(db, actorId, meetingId, message, at));
    },
    cancelMyApplication(meetingId) {
      return write('cancelMyApplication', (db, actorId, at) => rules.cancelMyApplication(db, actorId, meetingId, at));
    },
    createMeeting(input) {
      return write('createMeeting', (db, actorId, at) => rules.createMeeting(db, actorId, input, at));
    },
    updateMeeting(id, input) {
      return write('updateMeeting', (db, actorId, at) => rules.updateMeeting(db, actorId, id, input, at));
    },
    cancelMeeting(id, reason) {
      return write('cancelMeeting', (db, actorId, at) => rules.cancelMeeting(db, actorId, id, reason, at));
    },
    setMeetingRecruiting(id, open) {
      return write('setMeetingRecruiting', (db, actorId, at) => rules.setMeetingRecruiting(db, actorId, id, open, at));
    },
    listMyMeetings() {
      return read('listMyMeetings', (db, viewerId) => rules.viewMyMeetings(db, viewerId));
    },
    listParticipants(meetingId) {
      return read('listParticipants', (db, viewerId) => rules.viewParticipants(db, viewerId, meetingId));
    },
    decideParticipant(participantId, decision) {
      return write('decideParticipant', (db, actorId, at) =>
        rules.decideParticipant(db, actorId, participantId, decision, at),
      );
    },
    markAttendance(participantId, attendance) {
      return write('markAttendance', (db, actorId, at) =>
        rules.markAttendance(db, actorId, participantId, attendance, at),
      );
    },
    getMyProfile() {
      return read('getMyProfile', (db, viewerId) => rules.viewMyProfile(db, viewerId));
    },
    updateMyProfile(patch) {
      return write('updateMyProfile', (db, actorId, at) => rules.updateMyProfile(db, actorId, patch, at));
    },
    requestAccountDeletion() {
      return write('requestAccountDeletion', (db, actorId, at) => rules.requestAccountDeletion(db, actorId, at));
    },
    listVenues(filters) {
      return read('listVenues', (db) => rules.viewVenues(db, filters));
    },
    getVenue(id) {
      return read('getVenue', (db) => rules.viewVenue(db, id));
    },
    submitReport(input) {
      return write('submitReport', (db, actorId, at) => rules.submitReport(db, actorId, input, at));
    },
    adminListReports(query, page) {
      return read('adminListReports', (db, viewerId) => rules.adminViewReports(db, viewerId, query, page));
    },
    adminUpdateReport(reportId, status, adminNote) {
      return write('adminUpdateReport', (db, actorId, at) =>
        rules.adminUpdateReport(db, actorId, reportId, status, adminNote, at),
      );
    },
    adminListMeetings(query, page) {
      return read('adminListMeetings', (db, viewerId) => rules.adminViewMeetings(db, viewerId, query, page));
    },
    adminSetMeetingHidden(meetingId, hidden, reason) {
      return write('adminSetMeetingHidden', (db, actorId) =>
        rules.adminSetMeetingHidden(db, actorId, meetingId, hidden, reason),
      );
    },
    adminCancelMeeting(meetingId, reason) {
      return write('adminCancelMeeting', (db, actorId, at) => rules.adminCancelMeeting(db, actorId, meetingId, reason, at));
    },
    adminSearchUsers(query) {
      return read('adminSearchUsers', (db, viewerId) => rules.adminSearchUsers(db, viewerId, query, now()));
    },
    adminSetUserStatus(userId, status, note) {
      return write('adminSetUserStatus', (db, actorId) => rules.adminSetUserStatus(db, actorId, userId, status, note));
    },
    adminListVenues() {
      return read('adminListVenues', (db, viewerId) => rules.adminViewVenues(db, viewerId));
    },
    adminSaveVenue(id, input) {
      return write('adminSaveVenue', (db, actorId, at) => rules.adminSaveVenue(db, actorId, id, input, at));
    },
    adminSetVenuePublic(id, isPublic) {
      return write('adminSetVenuePublic', (db, actorId, at) => rules.adminSetVenuePublic(db, actorId, id, isPublic, at));
    },
    adminListCategories() {
      return read('adminListCategories', (db, viewerId) => rules.adminViewCategories(db, viewerId));
    },
    adminSetCategoryActive(id, isActive) {
      return write('adminSetCategoryActive', (db, actorId) => rules.adminSetCategoryActive(db, actorId, id, isActive));
    },
  };
}
