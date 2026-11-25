import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthProvider';
import { DataAdapterProvider } from './index';
import { createMockAdapter } from './mock/adapter';
import { DEV_ACCOUNT_IDS } from './mock/seed';
import { useMeetingList } from './useMeetingList';

function Probe() {
  const list = useMeetingList({});
  return <p data-testid="probe">{list.status === 'success' ? `ok:${list.total}` : list.status}</p>;
}

describe('useMeetingList', () => {
  it('로그인·로그아웃(사용자 키 변경) 때 목록을 다시 불러온다', async () => {
    const adapter = createMockAdapter({ delayMs: 0, persist: false });
    const listMeetings = vi.spyOn(adapter, 'listMeetings');
    render(
      <DataAdapterProvider adapter={adapter}>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </DataAdapterProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toMatch(/^ok:/));
    const afterAnon = listMeetings.mock.calls.length;
    expect(afterAnon).toBeGreaterThanOrEqual(1);

    await act(async () => {
      await adapter.auth.signInAsDev(DEV_ACCOUNT_IDS.admin);
    });
    await waitFor(() => expect(listMeetings.mock.calls.length).toBe(afterAnon + 1));
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toMatch(/^ok:/));

    await act(async () => {
      await adapter.auth.signOut();
    });
    await waitFor(() => expect(listMeetings.mock.calls.length).toBe(afterAnon + 2));
  });
});
