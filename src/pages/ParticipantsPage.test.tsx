import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RouteObject } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { createMockAdapter } from '../data/mock/adapter';
import { DEV_ACCOUNT_IDS } from '../data/mock/seed';
import { renderRoutes } from '../test/renderWithProviders';
import { ParticipantsPage } from './ParticipantsPage';

const routes: RouteObject[] = [
  { path: '/', element: <p>홈 화면</p> },
  { path: '/meetings/:id', element: <p>상세 화면</p> },
  { path: '/meetings/:id/edit', element: <p>수정 화면</p> },
  { path: '/meetings/:id/participants', Component: ParticipantsPage },
];

function renderPage(id: string, sessionUserId: string) {
  const adapter = createMockAdapter({ delayMs: 0, persist: false, sessionUserId });
  const listSpy = vi.spyOn(adapter, 'listParticipants');
  renderRoutes(routes, { initialEntries: [`/meetings/${id}/participants`], adapter });
  return { adapter, listSpy };
}

describe('ParticipantsPage', () => {
  it('모임장이 아니면 권한 없음 화면이고 참가자 목록을 요청하지 않는다', async () => {
    const { listSpy } = renderPage('seed-meeting-13', DEV_ACCOUNT_IDS.userB);
    expect(await screen.findByRole('heading', { level: 1, name: '접근 권한이 없어요.' })).toBeInTheDocument();
    expect(screen.getByText('참가자 관리는 모임장만 할 수 있어요.')).toBeInTheDocument();
    expect(listSpy).not.toHaveBeenCalled();
    expect(screen.queryByText('예시참가자02')).not.toBeInTheDocument();
  });

  it('모임장: 승인 대기·대기자·확정(모임장 맨 위) 구역', async () => {
    renderPage('seed-meeting-13', DEV_ACCOUNT_IDS.hostA);
    expect(await screen.findByRole('heading', { level: 1, name: '참가자 관리' })).toBeInTheDocument();
    expect(screen.getByTestId('participants-counts')).toHaveTextContent('확정 2/6명 · 승인 대기 2명 · 대기 0명');
    const pending = screen.getByTestId('pending-list');
    expect(within(pending).getAllByTestId('participant-row')).toHaveLength(2);
    expect(within(pending).getByText('[예시] 처음인데 참여해도 괜찮을까요?')).toBeInTheDocument();
    const confirmed = within(screen.getByTestId('confirmed-list')).getAllByTestId('participant-row');
    expect(confirmed[0]).toHaveTextContent('예시사용자A');
    expect(confirmed[0]).toHaveTextContent('모임장');
  });

  it('승인하면 확정으로 옮겨지고 인원이 갱신된다', async () => {
    const user = userEvent.setup();
    renderPage('seed-meeting-13', DEV_ACCOUNT_IDS.hostA);
    await user.click(await screen.findByRole('button', { name: '예시참가자02님 승인' }));
    await waitFor(() => expect(screen.getByTestId('participants-counts')).toHaveTextContent('확정 3/6명 · 승인 대기 1명'));
    expect(within(screen.getByTestId('confirmed-list')).getByText('예시참가자02')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('예시참가자02님을 확정했어요.');
  });

  it('거절은 확인 대화상자를 거친다', async () => {
    const user = userEvent.setup();
    renderPage('seed-meeting-13', DEV_ACCOUNT_IDS.hostA);
    await user.click(await screen.findByRole('button', { name: '예시참가자03님 거절' }));
    const dialog = screen.getByRole('dialog', { name: '예시참가자03님의 신청을 거절할까요?' });
    expect(dialog).toHaveTextContent('거절하면 이 모임에 다시 신청할 수 없어요.');
    await user.click(within(dialog).getByRole('button', { name: '거절하기' }));
    await waitFor(() => expect(screen.getByTestId('participants-counts')).toHaveTextContent('승인 대기 1명'));
    expect(within(screen.getByTestId('past-list')).getByText('예시참가자03')).toBeInTheDocument();
  });

  it('자리가 없으면 승인 버튼은 비활성(포커스 유지) + 사유, 대기자는 자동 확정되지 않음을 안내', async () => {
    renderPage('seed-meeting-03', 'seed-host-03'); // 정원 4 · 확정 4 · 대기 1
    const waitlist = await screen.findByTestId('waitlist-list');
    const approve = within(waitlist).getByRole('button', { name: '예시사용자A님 승인' });
    expect(approve).toHaveAttribute('aria-disabled', 'true');
    expect(approve).not.toBeDisabled();
    expect(approve).toHaveAccessibleDescription(expect.stringContaining('남은 자리가 없어 승인할 수 없어요.'));
    expect(screen.getByText('자리가 나면 직접 승인해 주세요. 자동으로 확정되지 않아요.')).toBeInTheDocument();
  });

  it('모임 취소: 자동 알림이 없음을 안내하고, 취소 후 상태를 보여준다', async () => {
    const user = userEvent.setup();
    renderPage('seed-meeting-13', DEV_ACCOUNT_IDS.hostA);
    await user.click(await screen.findByRole('button', { name: '모임 취소하기' }));
    const dialog = screen.getByRole('dialog', { name: '모임을 취소할까요?' });
    expect(dialog).toHaveTextContent('참가자에게 자동 알림(이메일·푸시)이 가지 않으니 별도로 알려 주세요.');
    await user.type(within(dialog).getByLabelText('취소 사유 (선택)'), '인원 부족');
    await user.click(within(dialog).getByRole('button', { name: '모임 취소하기' }));
    expect(await screen.findByTestId('participants-cancelled')).toHaveTextContent('취소 사유: 인원 부족');
    expect(screen.getByTestId('participants-counts')).toHaveTextContent('확정 1/6명 · 승인 대기 0명 · 대기 0명');
    expect(screen.queryByRole('button', { name: '모임 취소하기' })).not.toBeInTheDocument();
  });

  it('진행 중 모임: 확정 게스트 출석 체크(aria-pressed 토글)', async () => {
    const user = userEvent.setup();
    renderPage('seed-meeting-12', DEV_ACCOUNT_IDS.hostA);
    const group = await screen.findByRole('group', { name: '예시참가자01님 출석' });
    const attended = within(group).getByRole('button', { name: '참석' });
    expect(attended).toHaveAttribute('aria-pressed', 'false');
    await user.click(attended);
    await waitFor(() => expect(within(screen.getByRole('group', { name: '예시참가자01님 출석' })).getByRole('button', { name: '참석' })).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.queryByRole('button', { name: '모집 마감하기' })).not.toBeInTheDocument();
  });
});
