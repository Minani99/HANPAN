import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RouteObject } from 'react-router';
import { describe, expect, it } from 'vitest';
import { createMockAdapter } from '../data/mock/adapter';
import { DEV_ACCOUNT_IDS } from '../data/mock/seed';
import { renderRoutes } from '../test/renderWithProviders';
import { MyMeetingsPage } from './MyMeetingsPage';

const routes: RouteObject[] = [
  { path: '/', element: <p>홈 화면</p> },
  { path: '/meetings/new', element: <p>만들기 화면</p> },
  { path: '/meetings/:id', element: <p>상세 화면</p> },
  { path: '/meetings/:id/participants', element: <p>참가자 관리 화면</p> },
  { path: '/my/meetings', Component: MyMeetingsPage },
];

function renderPage(sessionUserId: string, entry = '/my/meetings') {
  const adapter = createMockAdapter({ delayMs: 0, persist: false, sessionUserId });
  return renderRoutes(routes, { initialEntries: [entry], adapter });
}

function titles() {
  return within(screen.getByTestId('my-meeting-list'))
    .getAllByTestId('meeting-title')
    .map((element) => element.textContent);
}

describe('MyMeetingsPage', () => {
  it('참가한 모임 · 예정: 내 신청 상태 배지(문구)와 상세 링크', async () => {
    renderPage(DEV_ACCOUNT_IDS.hostA);
    await screen.findByTestId('my-meeting-list');
    expect(screen.getByRole('tab', { name: '참가한 모임' })).toHaveAttribute('aria-selected', 'true');
    expect(titles()).toEqual(['[예시] 저녁에 아발론 같이 하실 분']);
    expect(screen.getByTestId('my-status-badge')).toHaveTextContent('참가 확정');
    expect(screen.getByTestId('meeting-row')).toHaveAttribute('href', '/meetings/seed-meeting-02');
  });

  it('상태 칩(예정/대기/완료/취소) 전환은 URL에 반영된다', async () => {
    const user = userEvent.setup();
    const { router } = renderPage(DEV_ACCOUNT_IDS.hostA);
    await screen.findByTestId('my-meeting-list');
    await user.click(screen.getByRole('button', { name: /^대기/ }));
    expect(router.state.location.search).toBe('?tab=waiting');
    expect(screen.getByTestId('my-status-badge')).toHaveTextContent('대기 중');
    await user.click(screen.getByRole('button', { name: /^취소/ }));
    const badges = screen.getAllByTestId('my-status-badge').map((element) => element.textContent);
    expect(badges.sort()).toEqual(['거절됨', '모임 취소']);
    await user.click(screen.getByRole('button', { name: /^완료/ }));
    expect(screen.getByText('출석: 참석')).toBeInTheDocument();
  });

  it('탭 전환(클릭·화살표 키): 내가 연 모임에는 "참가자 관리" 링크', async () => {
    const user = userEvent.setup();
    const { router } = renderPage(DEV_ACCOUNT_IDS.hostA);
    await screen.findByTestId('my-meeting-list');
    const appliedTab = screen.getByRole('tab', { name: '참가한 모임' });
    appliedTab.focus();
    await user.keyboard('{ArrowRight}');
    const hostedTab = screen.getByRole('tab', { name: '내가 연 모임' });
    expect(hostedTab).toHaveAttribute('aria-selected', 'true');
    expect(hostedTab).toHaveFocus();
    expect(hostedTab).toHaveAttribute('tabindex', '0');
    expect(appliedTab).toHaveAttribute('tabindex', '-1');
    expect(router.state.location.search).toBe('?role=hosted');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', hostedTab.id);
    await waitFor(() => expect(titles()).toEqual(['[예시] 지금 진행 중인 할리갈리 모임', '[예시] 머더미스터리 입문 시나리오']));
    const links = screen.getAllByRole('link', { name: '참가자 관리' });
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/meetings/seed-meeting-12/participants',
      '/meetings/seed-meeting-13/participants',
    ]);
    expect(screen.getByText('승인 대기 2명')).toBeInTheDocument();

    await user.keyboard('{ArrowLeft}');
    expect(appliedTab).toHaveAttribute('aria-selected', 'true');
    await user.click(hostedTab);
    expect(hostedTab).toHaveAttribute('aria-selected', 'true');
  });

  it('빈 상태: 참가한 모임이 없으면 모임 찾기, 연 모임이 없으면 모임 만들기를 권한다', async () => {
    const user = userEvent.setup();
    renderPage(DEV_ACCOUNT_IDS.userB);
    expect(await screen.findByText('예정된 참가 모임이 없어요.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '모임 찾기' })).toHaveAttribute('href', '/');
    await user.click(screen.getByRole('tab', { name: '내가 연 모임' }));
    expect(screen.getByText('예정된 내 모임이 없어요.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '모임 만들기' })).toHaveAttribute('href', '/meetings/new');
  });
});
