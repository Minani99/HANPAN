import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RouteObject } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { RequireAuth } from '../auth/RequireAuth';
import { createMockAdapter } from '../data/mock/adapter';
import { DEV_ACCOUNT_IDS } from '../data/mock/seed';
import { RETURN_TO_STORAGE_KEY } from '../lib/returnTo';
import { renderRoutes } from '../test/renderWithProviders';
import { AdminPage } from './AdminPage';

const routes: RouteObject[] = [
  { path: '/', element: <p>홈 화면</p> },
  { path: '/login', element: <p>로그인 화면</p> },
  { path: '/profile', element: <p>프로필 화면</p> },
  { path: '/meetings/:id', element: <p>모임 상세</p> },
  { path: '/venues/:id', element: <p>공간 상세</p> },
  { Component: RequireAuth, children: [{ path: '/admin', Component: AdminPage }] },
];

function renderAdmin(sessionUserId: string | null, path = '/admin') {
  const adapter = createMockAdapter({ delayMs: 0, persist: false, sessionUserId });
  return renderRoutes(routes, { initialEntries: [path], adapter });
}

describe('AdminPage 접근', () => {
  it('비로그인: returnTo(/admin)를 저장하고 로그인으로', async () => {
    const { router } = renderAdmin(null);
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(window.sessionStorage.getItem(RETURN_TO_STORAGE_KEY)).toBe('/admin');
    window.sessionStorage.clear();
  });

  it('일반 계정: 권한 없음 화면, 관리자 데이터 요청을 하지 않는다', async () => {
    const adapter = createMockAdapter({ delayMs: 0, persist: false, sessionUserId: DEV_ACCOUNT_IDS.userB });
    const listReports = vi.spyOn(adapter, 'adminListReports');
    renderRoutes(routes, { initialEntries: ['/admin'], adapter });
    expect(await screen.findByRole('heading', { level: 1, name: '접근 권한이 없어요.' })).toBeInTheDocument();
    expect(screen.getByText('관리자 도구는 운영자 계정만 쓸 수 있어요.')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(listReports).not.toHaveBeenCalled();
    // 클라이언트 확인을 건너뛰어도 데이터 계층이 NOT_ADMIN으로 막는다(mock — 실제 경계는 DB)
    await expect(adapter.adminListReports({}, { limit: 20, offset: 0 })).rejects.toMatchObject({ code: 'NOT_ADMIN' });
  });
});

describe('AdminPage 관리자', () => {
  it('탭 5개(키보드 이동), 기본은 신고 탭(접수 상태)', async () => {
    const user = userEvent.setup();
    const { router } = renderAdmin(DEV_ACCOUNT_IDS.admin);
    const tablist = await screen.findByRole('tablist', { name: '관리 항목' });
    expect(within(tablist).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['신고', '모임', '사용자', '공간', '카테고리']);
    expect(within(tablist).getByRole('tab', { name: '신고' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByTestId('admin-report-list')).toHaveTextContent('[예시] 칩만 쓰는 비금전 홀덤 친목 모임');

    within(tablist).getByRole('tab', { name: '신고' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(within(tablist).getByRole('tab', { name: '모임' })).toHaveAttribute('aria-selected', 'true');
    expect(router.state.location.search).toBe('?tab=meetings');
    expect(await screen.findByTestId('admin-meeting-list')).toBeInTheDocument();
  });

  it('신고 상태 변경 + 메모 저장 → 접수 목록에서 빠진다', async () => {
    const user = userEvent.setup();
    const { adapter } = renderAdmin(DEV_ACCOUNT_IDS.admin);
    const item = await screen.findByTestId('admin-report');
    await user.selectOptions(within(item).getByTestId('admin-report-status'), 'resolved');
    await user.type(within(item).getByLabelText('관리자 메모 (신고자에게 보이지 않아요)'), '숨김 처리');
    await user.click(within(item).getByTestId('admin-report-save'));
    expect(await screen.findByText('신고 처리 상태를 저장했어요.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('admin-report')).not.toBeInTheDocument());
    const saved = (adapter as ReturnType<typeof createMockAdapter>).snapshot().reports.find((r) => r.id === 'seed-report-01');
    expect(saved).toMatchObject({ status: 'resolved', adminNote: '숨김 처리', handledBy: DEV_ACCOUNT_IDS.admin });
  });

  it('모임 숨김은 사유가 있어야 확인 버튼이 눌린다', async () => {
    const user = userEvent.setup();
    renderAdmin(DEV_ACCOUNT_IDS.admin, '/admin?tab=meetings');
    const rows = await screen.findAllByTestId('admin-meeting');
    const target = rows.find((row) => row.textContent?.includes('[예시] 퇴근하고 코드네임 한 판'));
    if (!target) throw new Error('대상 모임 행 없음');
    await user.click(within(target).getByRole('button', { name: '숨기기' }));
    const dialog = screen.getByRole('dialog', { name: '이 모임을 숨길까요?' });
    const confirm = within(dialog).getByRole('button', { name: '숨기기' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText('숨김 사유 (필수)'), '스팸 신고 확인');
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(await screen.findByText('모임을 숨겼어요.')).toBeInTheDocument();
  });

  it('사용자 탭: 본인은 바꿀 수 없고, 제한은 영구 제재가 아니라는 안내', async () => {
    renderAdmin(DEV_ACCOUNT_IDS.admin, '/admin?tab=users');
    expect(await screen.findByText(/이용 제한은 영구 제재가 아니며 이의제기를 검토해요/)).toBeInTheDocument();
    const rows = await screen.findAllByTestId('admin-user');
    const self = rows.find((row) => row.textContent?.includes('예시관리계정'));
    expect(self).toHaveTextContent('내 계정은 바꿀 수 없어요');
  });
});
