import { useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { AdminCategoriesTab } from '../components/admin/AdminCategoriesTab';
import { AdminMeetingsTab } from '../components/admin/AdminMeetingsTab';
import { AdminReportsTab } from '../components/admin/AdminReportsTab';
import { AdminUsersTab } from '../components/admin/AdminUsersTab';
import { AdminVenuesTab } from '../components/admin/AdminVenuesTab';
import { PageContainer } from '../components/layout/PageContainer';
import { ForbiddenState } from '../components/layout/PageStates';
import { PageTitle } from '../components/layout/PageTitle';
import { ButtonLink } from '../components/ui/Button';
import { Tabs, tabId, tabPanelId, type TabItem } from '../components/ui/Tabs';
import { useDocumentTitle } from '../lib/useDocumentTitle';

export type AdminTab = 'reports' | 'meetings' | 'users' | 'venues' | 'categories';

const TABS: readonly TabItem<AdminTab>[] = [
  { value: 'reports', label: '신고' },
  { value: 'meetings', label: '모임' },
  { value: 'users', label: '사용자' },
  { value: 'venues', label: '공간' },
  { value: 'categories', label: '카테고리' },
];

function isAdminTab(value: string | null): value is AdminTab {
  return TABS.some((tab) => tab.value === value);
}

const ID_PREFIX = 'admin';

/**
 * 관리자 도구 (`/admin`). 라우트 가드(RequireAuth)가 로그인·최초 설정을 확인하고, 이 화면이 관리자 여부를 확인한다.
 *
 * 중요: 여기의 isAdmin 확인은 사용성(권한 없는 사람에게 빈 화면 대신 안내)용일 뿐이다. 권한의 진짜 경계는 서버다 —
 * 모든 관리자 조회·쓰기는 RPC 안의 is_admin()(admin_roles 행) 또는 RLS 정책이 다시 확인하고, 관리자가 아니면
 * NOT_ADMIN/권한 오류로 실패한다. 클라이언트 값(SessionUser.isAdmin)을 바꿔도 관리자 데이터는 받을 수 없다(docs/SECURITY.md §3).
 * 헤더·하단 내비에는 이 화면을 노출하지 않고, 관리자에게만 프로필 화면에 링크를 둔다.
 */
export function AdminPage() {
  useDocumentTitle('관리자 도구');
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab: AdminTab = isAdminTab(tabParam) ? tabParam : 'reports';

  if (!user?.isAdmin) {
    return (
      <ForbiddenState
        description="관리자 도구는 운영자 계정만 쓸 수 있어요."
        actions={<ButtonLink to="/">홈으로 가기</ButtonLink>}
      />
    );
  }

  const changeTab = (next: AdminTab) => {
    setSearchParams(next === 'reports' ? new URLSearchParams() : new URLSearchParams({ tab: next }), { replace: true });
  };

  return (
    <PageContainer className="pt-2 pb-12 md:pt-4 md:pb-20">
      <PageTitle
        title="관리자 도구"
        description="운영자 전용 화면이에요. 모든 변경은 서버에서 권한을 다시 확인하고 감사 기록에 남아요."
      />
      {/* 좁은 화면에서는 탭 줄만 가로로 스크롤한다(밑줄이 잘리지 않게 바깥에서 스크롤) */}
      <div className="scrollbar-none -mx-gutter-sm overflow-x-auto px-gutter-sm md:mx-0 md:px-0">
        <Tabs label="관리 항목" items={TABS} value={tab} onChange={changeTab} idPrefix={ID_PREFIX} className="w-max min-w-full" />
      </div>
      <div
        role="tabpanel"
        id={tabPanelId(ID_PREFIX)}
        aria-labelledby={tabId(ID_PREFIX, tab)}
        tabIndex={0}
        className="pt-6 focus-visible:outline-offset-4"
      >
        {tab === 'reports' ? <AdminReportsTab /> : null}
        {tab === 'meetings' ? <AdminMeetingsTab /> : null}
        {tab === 'users' ? <AdminUsersTab /> : null}
        {tab === 'venues' ? <AdminVenuesTab /> : null}
        {tab === 'categories' ? <AdminCategoriesTab /> : null}
      </div>
    </PageContainer>
  );
}
