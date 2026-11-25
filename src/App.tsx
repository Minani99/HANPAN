import { createBrowserRouter, type RouteObject } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { AuthProvider } from './auth/AuthProvider';
import { RequireAuth, RequireSignedIn } from './auth/RequireAuth';
import { AppErrorBoundary } from './components/layout/AppErrorBoundary';
import { AppLayout } from './components/layout/AppLayout';
import { PageContainer } from './components/layout/PageContainer';
import { Spinner } from './components/ui/Spinner';
import { ToastProvider } from './components/ui/Toast';
import { DataAdapterProvider, type DataAdapter } from './data';
import { NotFoundPage } from './pages/NotFoundPage';
import { RouteErrorPage } from './pages/RouteErrorPage';

type AppRouter = ReturnType<typeof createBrowserRouter>;

async function loadExplore() {
  const { ExplorePage } = await import('./pages/ExplorePage');
  return { Component: ExplorePage };
}

async function loadMeetingDetail() {
  const { MeetingDetailPage } = await import('./pages/MeetingDetailPage');
  return { Component: MeetingDetailPage };
}

async function loadMeetingCreate() {
  const { MeetingCreatePage } = await import('./pages/MeetingCreatePage');
  return { Component: MeetingCreatePage };
}

async function loadMeetingEdit() {
  const { MeetingEditPage } = await import('./pages/MeetingEditPage');
  return { Component: MeetingEditPage };
}

async function loadParticipants() {
  const { ParticipantsPage } = await import('./pages/ParticipantsPage');
  return { Component: ParticipantsPage };
}

async function loadMyMeetings() {
  const { MyMeetingsPage } = await import('./pages/MyMeetingsPage');
  return { Component: MyMeetingsPage };
}

async function loadLogin() {
  const { LoginPage } = await import('./pages/LoginPage');
  return { Component: LoginPage };
}

async function loadAuthCallback() {
  const { AuthCallbackPage } = await import('./pages/AuthCallbackPage');
  return { Component: AuthCallbackPage };
}

async function loadProfile() {
  const { ProfilePage } = await import('./pages/ProfilePage');
  return { Component: ProfilePage };
}

async function loadDeletionRequested() {
  const { AccountDeletionRequestedPage } = await import('./pages/AccountDeletionRequestedPage');
  return { Component: AccountDeletionRequestedPage };
}

async function loadVenues() {
  const { VenuesPage } = await import('./pages/VenuesPage');
  return { Component: VenuesPage };
}

async function loadVenueDetail() {
  const { VenueDetailPage } = await import('./pages/VenueDetailPage');
  return { Component: VenueDetailPage };
}

async function loadAdmin() {
  const { AdminPage } = await import('./pages/AdminPage');
  return { Component: AdminPage };
}

async function loadPolicy() {
  const { PolicyPage } = await import('./pages/PolicyPage');
  return { Component: PolicyPage };
}

/** 처음 진입할 때 화면 코드(lazy 청크)를 받는 동안 헤더는 그대로 두고 본문에만 표시 */
function PageFallback() {
  return (
    <PageContainer className="flex min-h-[50vh] items-center justify-center text-muted">
      <Spinner label="화면을 불러오는 중이에요." size="1.5rem" />
    </PageContainer>
  );
}

export const routes: RouteObject[] = [
  {
    path: '/',
    Component: AppLayout,
    ErrorBoundary: RouteErrorPage,
    children: [
      {
        // 경로 없는 래퍼: 초기 lazy 로딩 표시와 화면 단위 오류 경계를 레이아웃 안쪽에 둔다.
        HydrateFallback: PageFallback,
        ErrorBoundary: RouteErrorPage,
        children: [
          { index: true, lazy: loadExplore },
          {
            path: 'meetings',
            children: [
              { index: true, lazy: loadExplore },
              { path: ':id', lazy: loadMeetingDetail },
              {
                // 로그인 + 최초 설정 필요 (가드는 편의일 뿐 — 권한의 최종 판단은 서버)
                Component: RequireAuth,
                children: [
                  { path: 'new', lazy: loadMeetingCreate },
                  { path: ':id/edit', lazy: loadMeetingEdit },
                  { path: ':id/participants', lazy: loadParticipants },
                ],
              },
            ],
          },
          { Component: RequireAuth, children: [{ path: 'my/meetings', lazy: loadMyMeetings }] },
          { Component: RequireSignedIn, children: [{ path: 'profile', lazy: loadProfile }] },
          { path: 'login', lazy: loadLogin },
          { path: 'auth/callback', lazy: loadAuthCallback },
          { path: 'account/deletion-requested', lazy: loadDeletionRequested },
          { path: 'venues', lazy: loadVenues },
          { path: 'venues/:id', lazy: loadVenueDetail },
          // 로그인 + 최초 설정은 가드가, 관리자 여부는 화면이 확인한다. 둘 다 사용성용 — 권한의 경계는 서버(is_admin()·RLS)
          { Component: RequireAuth, children: [{ path: 'admin', lazy: loadAdmin }] },
          { path: 'policies/:slug', lazy: loadPolicy },
          // 404는 오류 경계에서도 쓰이므로 메인 청크에 둔다(크기가 작다).
          { path: '*', Component: NotFoundPage },
        ],
      },
    ],
  },
];

export function createAppRouter(): AppRouter {
  return createBrowserRouter(routes);
}

export interface AppProps {
  adapter: DataAdapter;
  router: AppRouter;
}

export function App({ adapter, router }: AppProps) {
  return (
    <AppErrorBoundary>
      <DataAdapterProvider adapter={adapter}>
        <ToastProvider>
          <AuthProvider>
            <RouterProvider router={router} />
          </AuthProvider>
        </ToastProvider>
      </DataAdapterProvider>
    </AppErrorBoundary>
  );
}
