import { CATEGORIES, sortCategories } from '../domain/categories';
import { REGIONS, sortRegions } from '../domain/regions';
import { DataAdapterError, type AuthAdapter, type DataAdapter } from './adapter';

function unconfigured(): Promise<never> {
  return Promise.reject(
    new DataAdapterError('SERVICE_UNCONFIGURED', { message: '데이터 연결(Supabase) 설정이 없어 요청을 처리할 수 없습니다.' }),
  );
}

const unconfiguredAuth: AuthAdapter = {
  async getSessionUser() {
    return null;
  },
  onAuthStateChange() {
    return () => {};
  },
  signInWithOAuth: unconfigured,
  completeOAuthCallback: unconfigured,
  async signOut() {},
};

/**
 * 데이터 연결이 설정되지 않은 환경(예: 프로덕션 빌드에 Supabase 설정이 없을 때)용.
 * 가짜 모임을 만들지 않는다. 조회는 항상 빈 결과, 쓰기·로그인은 SERVICE_UNCONFIGURED로 실패한다.
 * 카테고리·권역은 서비스 기준값이므로 그대로 제공한다.
 */
export function createUnconfiguredAdapter(): DataAdapter {
  return {
    mode: 'unconfigured',
    auth: unconfiguredAuth,
    async listMeetings() {
      return { items: [], total: 0 };
    },
    async getMeeting() {
      return null;
    },
    async listCategories() {
      return sortCategories(CATEGORIES);
    },
    async listRegions() {
      return sortRegions(REGIONS);
    },
    async getMyParticipation() {
      return null;
    },
    async listMyMeetings() {
      return { hosted: [], joined: [] };
    },
    async listParticipants() {
      return [];
    },
    async getMyProfile() {
      return null;
    },
    applyToMeeting: unconfigured,
    cancelMyApplication: unconfigured,
    createMeeting: unconfigured,
    updateMeeting: unconfigured,
    cancelMeeting: unconfigured,
    setMeetingRecruiting: unconfigured,
    decideParticipant: unconfigured,
    markAttendance: unconfigured,
    updateMyProfile: unconfigured,
    requestAccountDeletion: unconfigured,
    async listVenues() {
      return [];
    },
    async getVenue() {
      return null;
    },
    submitReport: unconfigured,
    // 관리자: 로그인 자체가 불가능한 모드라 조회는 빈 결과, 쓰기는 SERVICE_UNCONFIGURED
    async adminListReports() {
      return { items: [], total: 0 };
    },
    adminUpdateReport: unconfigured,
    async adminListMeetings() {
      return { items: [], total: 0 };
    },
    adminSetMeetingHidden: unconfigured,
    adminCancelMeeting: unconfigured,
    async adminSearchUsers() {
      return [];
    },
    adminSetUserStatus: unconfigured,
    async adminListVenues() {
      return [];
    },
    adminSaveVenue: unconfigured,
    adminSetVenuePublic: unconfigured,
    async adminListCategories() {
      return [];
    },
    adminSetCategoryActive: unconfigured,
  };
}
