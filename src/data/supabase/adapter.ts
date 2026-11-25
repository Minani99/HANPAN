/**
 * Supabase DataAdapter: 모든 조회·쓰기를 RPC로(기준 데이터만 테이블 select).
 * 매핑표: docs/DB_SCHEMA.md §17. 규칙의 최종 판단은 DB(RLS·RPC)다 — 여기서는 요청 전 명백한 경우만 거른다.
 *
 * - 클라이언트는 주입받는다(SupabaseClientLike). 계약 테스트는 PGlite로 실제 SQL 함수를 실행하는 가짜 클라이언트를 넣는다.
 * - 세션이 없으면 로그인 필요 RPC를 부르지 않는다: getMyParticipation·getMyProfile은 null,
 *   그 밖의 로그인 필요 메서드는 AUTH_REQUIRED (비로그인 호출은 서버에서 42501이 되기 때문).
 * - uuid가 아닌 id는 요청하지 않는다: 조회는 null, 쓰기는 NOT_FOUND.
 * - 응답은 mapping.ts의 Zod 스키마로 검증한다. 오류는 errors.ts가 DataAdapterError로 바꾼다.
 */
import { normalizeQuery } from '../../lib/filters';
import { DataAdapterError, isDataAdapterError, type DataAdapter } from '../adapter';
import { createSupabaseAuthAdapter, type BrowserLike } from './auth';
import {
  callRpc,
  readSessionUserId,
  type AdminWritableTable,
  type PostgrestResultLike,
  type SupabaseClientLike,
} from './client';
import { toDataAdapterError, toTableWriteError } from './errors';
import {
  isUuid,
  parseAdminCategories,
  parseAdminMeetingPage,
  parseAdminReportPage,
  parseAdminUsers,
  parseReportId,
  parseVenueOrNull,
  parseVenues,
  parseWrittenIds,
  parseApplyStatus,
  parseCategories,
  parseCreatedMeetingId,
  parseDecision,
  parseMeetingOrNull,
  parseMeetingPage,
  parseMyMeetings,
  parseParticipants,
  parseParticipationOrNull,
  parseProfileOrNull,
  parseRegions,
  toMyProfile,
} from './mapping';
import {
  toAdminMeetingArgs,
  toAdminReportArgs,
  toListMeetingsArgs,
  toListVenuesArgs,
  toMeetingPayload,
  toProfilePayload,
  toVenueRow,
} from './rpcArgs';

const CATEGORY_ID_PATTERN = /^[a-z_]{2,40}$/;

export interface SupabaseAdapterOptions {
  client: SupabaseClientLike;
  kakaoAuthEnabled: boolean;
  /** 테스트용: window 의존 부분 */
  browser?: BrowserLike;
}

export function createSupabaseAdapter({ client, kakaoAuthEnabled, browser }: SupabaseAdapterOptions): DataAdapter {
  const auth = createSupabaseAuthAdapter({ client, kakaoAuthEnabled, ...(browser ? { browser } : {}) });

  async function requireSession(): Promise<void> {
    if (!(await readSessionUserId(client))) throw new DataAdapterError('AUTH_REQUIRED');
  }

  /** 쓰기·로그인 필요 RPC: 세션 확인 → id 형식 확인 → 호출 */
  async function callAuthed(fn: string, args: Record<string, unknown> = {}, ids: unknown[] = []): Promise<unknown> {
    await requireSession();
    if (!ids.every(isUuid)) throw new DataAdapterError('NOT_FOUND', { detail: 'invalid_id' });
    return callRpc(client, fn, args);
  }

  async function selectReference(table: 'categories' | 'regions', columns: string): Promise<unknown> {
    let result: PostgrestResultLike;
    try {
      result = await client.from(table).select(columns).eq('is_active', true).order('sort_order', { ascending: true });
    } catch (error) {
      throw toDataAdapterError(error);
    }
    if (result.error) throw toDataAdapterError(result.error, { status: result.status });
    return result.data;
  }

  /**
   * 관리자 테이블 직접 쓰기(venues·categories). RLS(is_admin)가 권한의 경계다.
   * 쓴 행 id 목록을 돌려준다. RLS에 막힌 update는 오류 없이 0행이므로 호출한 쪽이 notWritten()으로 판단한다.
   */
  async function writeTable(table: AdminWritableTable, op: () => PromiseLike<PostgrestResultLike>): Promise<string[]> {
    await requireSession();
    let result: PostgrestResultLike;
    try {
      result = await op();
    } catch (error) {
      throw toDataAdapterError(error);
    }
    if (result.error) throw toTableWriteError(result.error, { status: result.status });
    return parseWrittenIds(result.data, table);
  }

  /** 0행 update의 원인 구분: 관리자가 아니면 NOT_ADMIN, 관리자면 대상 없음(NOT_FOUND). 안내용이며 보호 경계가 아니다 */
  async function notWritten(): Promise<DataAdapterError> {
    const admin = await callRpc(client, 'is_admin');
    return new DataAdapterError(admin === true ? 'NOT_FOUND' : 'NOT_ADMIN');
  }

  async function updateOne(table: AdminWritableTable, id: string, patch: Record<string, unknown>): Promise<void> {
    const ids = await writeTable(table, () => client.table(table).update(patch).eq('id', id).select('id'));
    if (ids.length === 0) throw await notWritten();
  }

  return {
    mode: 'supabase',
    auth,

    async listMeetings(filters, page) {
      return parseMeetingPage(await callRpc(client, 'list_public_meetings', toListMeetingsArgs(filters, page)));
    },

    async getMeeting(id) {
      if (!isUuid(id)) return null;
      return parseMeetingOrNull(await callRpc(client, 'get_meeting', { p_meeting_id: id }));
    },

    async listCategories() {
      return parseCategories(await selectReference('categories', 'id, name, sort_order'));
    },

    async listRegions() {
      return parseRegions(await selectReference('regions', 'code, name, sort_order'));
    },

    async getMyParticipation(meetingId) {
      if (!isUuid(meetingId) || !(await readSessionUserId(client))) return null;
      return parseParticipationOrNull(await callRpc(client, 'get_my_participation', { p_meeting_id: meetingId }));
    },

    async applyToMeeting(meetingId, message) {
      const data = await callAuthed('apply_to_meeting', { p_meeting_id: meetingId, p_message: message ?? null }, [meetingId]);
      return parseApplyStatus(data);
    },

    async cancelMyApplication(meetingId) {
      await callAuthed('cancel_my_application', { p_meeting_id: meetingId }, [meetingId]);
    },

    async createMeeting(input) {
      const payload = toMeetingPayload(input);
      return parseCreatedMeetingId(await callAuthed('create_meeting', { p: payload }));
    },

    async updateMeeting(id, input) {
      const payload = toMeetingPayload(input);
      await callAuthed('update_meeting', { p_meeting_id: id, p: payload }, [id]);
    },

    async cancelMeeting(id, reason) {
      await callAuthed('cancel_meeting', { p_meeting_id: id, p_reason: reason ?? null }, [id]);
    },

    async setMeetingRecruiting(id, open) {
      await callAuthed('set_meeting_recruiting', { p_meeting_id: id, p_open: open }, [id]);
    },

    async listMyMeetings() {
      return parseMyMeetings(await callAuthed('list_my_meetings'));
    },

    async listParticipants(meetingId) {
      return parseParticipants(await callAuthed('list_meeting_participants', { p_meeting_id: meetingId }, [meetingId]));
    },

    async decideParticipant(participantId, decision) {
      const data = await callAuthed(
        'decide_participant',
        { p_participant_id: participantId, p_decision: decision },
        [participantId],
      );
      return parseDecision(data);
    },

    async markAttendance(participantId, attendance) {
      await callAuthed('mark_attendance', { p_participant_id: participantId, p_attendance: attendance }, [participantId]);
    },

    async getMyProfile() {
      if (!(await readSessionUserId(client))) return null;
      const row = parseProfileOrNull(await callRpc(client, 'get_my_profile'));
      return row ? toMyProfile(row) : null;
    },

    async updateMyProfile(patch) {
      await callAuthed('update_my_profile', { p: toProfilePayload(patch) });
    },

    async requestAccountDeletion() {
      await callAuthed('request_account_deletion');
    },

    async listVenues(filters) {
      return parseVenues(await callRpc(client, 'list_public_venues', toListVenuesArgs(filters)));
    },

    async getVenue(id) {
      if (!isUuid(id)) return null;
      return parseVenueOrNull(await callRpc(client, 'get_venue', { p_venue_id: id }));
    },

    async submitReport(input) {
      const data = await callAuthed(
        'submit_report',
        { p_target_type: input.targetType, p_target_id: input.targetId, p_reason: input.reason, p_body: input.body },
        [input.targetId],
      );
      return parseReportId(data);
    },

    async adminListReports(query, page) {
      return parseAdminReportPage(await callAuthed('admin_list_report_items', toAdminReportArgs(query, page)));
    },

    async adminUpdateReport(reportId, status, adminNote) {
      await callAuthed(
        'admin_update_report',
        { p_report_id: reportId, p_status: status, p_admin_note: adminNote },
        [reportId],
      );
    },

    async adminListMeetings(query, page) {
      return parseAdminMeetingPage(await callAuthed('admin_list_meetings', toAdminMeetingArgs(query, page)));
    },

    async adminSetMeetingHidden(meetingId, hidden, reason) {
      await callAuthed(
        'admin_set_meeting_hidden',
        { p_meeting_id: meetingId, p_hidden: hidden, p_reason: reason },
        [meetingId],
      );
    },

    async adminCancelMeeting(meetingId, reason) {
      // cancel_meeting은 관리자에게 종료 전까지 허용된다(by_admin으로 audit).
      // 모임장·관리자 공용 RPC라 관리자가 아니면 NOT_HOST를 돌려준다 → 관리자 메서드 계약(mock과 같음)에 맞춰 NOT_ADMIN으로.
      // 그 밖의 코드(MEETING_STARTED·MEETING_CANCELLED·NOT_FOUND 등)는 그대로 둔다.
      try {
        await callAuthed('cancel_meeting', { p_meeting_id: meetingId, p_reason: reason }, [meetingId]);
      } catch (error) {
        if (isDataAdapterError(error) && error.code === 'NOT_HOST') {
          throw new DataAdapterError('NOT_ADMIN', { message: 'NOT_ADMIN (source=rpc, from=NOT_HOST)', cause: error });
        }
        throw error;
      }
    },

    async adminSearchUsers(query) {
      const q = normalizeQuery(query);
      return parseAdminUsers(await callAuthed('admin_search_users', { p_query: q ?? null, p_limit: 20 }));
    },

    async adminSetUserStatus(userId, status, note) {
      await callAuthed('admin_set_user_status', { p_user_id: userId, p_status: status, p_note: note }, [userId]);
    },

    async adminListVenues() {
      return parseVenues(await callAuthed('admin_list_venues'), 'admin_list_venues');
    },

    async adminSaveVenue(id, input) {
      if (id !== null && !isUuid(id)) throw new DataAdapterError('NOT_FOUND', { detail: 'invalid_id' });
      const row = toVenueRow(input);
      if (id === null) {
        const ids = await writeTable('venues', () => client.table('venues').insert(row).select('id'));
        const created = ids[0];
        if (!created) throw await notWritten();
        return created;
      }
      await updateOne('venues', id, row);
      return id;
    },

    async adminSetVenuePublic(id, isPublic) {
      if (!isUuid(id)) throw new DataAdapterError('NOT_FOUND', { detail: 'invalid_id' });
      await updateOne('venues', id, { is_public: isPublic });
    },

    async adminListCategories() {
      return parseAdminCategories(await callAuthed('admin_list_categories'));
    },

    async adminSetCategoryActive(id, isActive) {
      if (!CATEGORY_ID_PATTERN.test(id)) throw new DataAdapterError('NOT_FOUND', { detail: 'invalid_id' });
      await updateOne('categories', id, { is_active: isActive });
    },
  };
}
