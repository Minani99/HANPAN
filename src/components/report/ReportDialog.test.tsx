import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setMockFailure, createMockAdapter } from '../../data/mock/adapter';
import { DEV_ACCOUNT_IDS } from '../../data/mock/seed';
import type { ErrorCode } from '../../data/types';
import { REPORT_FIELD_MESSAGES } from '../../domain/reports';
import { renderRoutes } from '../../test/renderWithProviders';
import { REPORT_SUCCESS_MESSAGE, ReportDialog, type ReportTarget } from './ReportDialog';

afterEach(() => {
  __setMockFailure(null);
});

const MEETING_TARGET: ReportTarget = { type: 'meeting', id: 'seed-meeting-01', label: '이 모임' };

function renderDialog(targets: readonly ReportTarget[] = [MEETING_TARGET], onClose = vi.fn()) {
  const adapter = createMockAdapter({ delayMs: 0, persist: false, sessionUserId: DEV_ACCOUNT_IDS.userB });
  renderRoutes([{ path: '*', element: <ReportDialog open targets={targets} onClose={onClose} /> }], { adapter });
  return { adapter, onClose, dialog: screen.getByRole('dialog', { name: '신고하기' }) };
}

describe('ReportDialog', () => {
  it('사유 7종 라디오 + 자동 제재 없음 안내, 사유를 고르지 않으면 요청하지 않는다', async () => {
    const user = userEvent.setup();
    const { adapter, dialog } = renderDialog();
    const submit = vi.spyOn(adapter, 'submitReport');
    expect(within(dialog).getAllByRole('radio')).toHaveLength(7);
    for (const label of ['스팸·광고', '부적절한 내용', '금전성 도박(홀덤 등)', '괴롭힘·불쾌한 행동', '노쇼', '상업적 권유', '기타']) {
      expect(within(dialog).getByRole('radio', { name: label })).toBeInTheDocument();
    }
    expect(dialog).toHaveTextContent('신고는 운영자가 직접 검토해요. 신고만으로 자동 제재되지 않아요.');
    await user.click(within(dialog).getByRole('button', { name: '신고하기' }));
    expect(dialog).toHaveTextContent(REPORT_FIELD_MESSAGES.reason);
    expect(within(dialog).getByRole('radio', { name: '스팸·광고' })).toHaveFocus();
    expect(submit).not.toHaveBeenCalled();
    expect(screen.queryByText(REPORT_SUCCESS_MESSAGE)).not.toBeInTheDocument();
  });

  it("'기타'는 상세 내용이 필수(공백만 있으면 안 됨), 1000자를 넘길 수 없다", async () => {
    const user = userEvent.setup();
    const { adapter, dialog } = renderDialog();
    const submit = vi.spyOn(adapter, 'submitReport');
    await user.click(within(dialog).getByRole('radio', { name: '기타' }));
    expect(within(dialog).getByLabelText('상세 내용 (필수)')).toBeRequired();
    await user.type(within(dialog).getByLabelText('상세 내용 (필수)'), '   ');
    await user.click(within(dialog).getByRole('button', { name: '신고하기' }));
    expect(dialog).toHaveTextContent(REPORT_FIELD_MESSAGES.bodyRequired);
    expect(within(dialog).getByLabelText('상세 내용 (필수)')).toHaveFocus();
    expect(submit).not.toHaveBeenCalled();
    expect(within(dialog).getByLabelText('상세 내용 (필수)')).toHaveAttribute('maxLength', '1000');
  });

  it('접수가 실제로 성공했을 때만 "신고가 접수됐어요" 토스트 + 닫힘, 본문은 앞뒤 공백 제거', async () => {
    const user = userEvent.setup();
    const { adapter, onClose, dialog } = renderDialog();
    const submit = vi.spyOn(adapter, 'submitReport');
    await user.click(within(dialog).getByRole('radio', { name: '금전성 도박(홀덤 등)' }));
    await user.type(within(dialog).getByLabelText('상세 내용 (선택)'), '  칩을 현금으로 바꿔 준대요  ');
    await user.click(within(dialog).getByRole('button', { name: '신고하기' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(submit).toHaveBeenCalledWith({
      targetType: 'meeting',
      targetId: 'seed-meeting-01',
      reason: 'gambling',
      body: '칩을 현금으로 바꿔 준대요',
    });
    expect(screen.getByRole('status')).toHaveTextContent(REPORT_SUCCESS_MESSAGE);
  });

  it.each<[ErrorCode, string | undefined, string]>([
    ['DUPLICATE_REPORT', undefined, '이미 접수된 신고가 있어요.'],
    ['RATE_LIMITED', 'report_24h', '신고는 하루 10건까지 할 수 있어요.'],
    ['CANNOT_REPORT_SELF', undefined, '나 자신이나 내가 연 모임은 신고할 수 없어요.'],
    ['NOT_FOUND', undefined, '신고할 대상을 찾을 수 없어요.'],
    ['NETWORK_ERROR', undefined, '연결이 불안정해요.'],
  ])('오류 %s → 대화상자 안 안내, 입력 유지, 토스트 없음', async (code, detail, message) => {
    const user = userEvent.setup();
    const { onClose, dialog } = renderDialog();
    __setMockFailure({ methods: ['submitReport'], times: 1, code, ...(detail ? { detail } : {}) });
    await user.click(within(dialog).getByRole('radio', { name: '노쇼' }));
    await user.type(within(dialog).getByLabelText('상세 내용 (선택)'), '두 번 안 왔어요');
    await user.click(within(dialog).getByRole('button', { name: '신고하기' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(message);
    expect(onClose).not.toHaveBeenCalled();
    expect(within(dialog).getByLabelText('상세 내용 (선택)')).toHaveValue('두 번 안 왔어요');
    expect(screen.queryByText(REPORT_SUCCESS_MESSAGE)).not.toBeInTheDocument();
  });

  it('대상이 둘 이상이면 고를 수 있고, 고른 대상으로 접수한다', async () => {
    const user = userEvent.setup();
    const { adapter, dialog } = renderDialog([
      MEETING_TARGET,
      { type: 'user', id: 'seed-host-01', label: '모임장 예시모임장A' },
    ]);
    const submit = vi.spyOn(adapter, 'submitReport');
    await user.click(within(dialog).getByRole('radio', { name: '모임장 예시모임장A' }));
    await user.click(within(dialog).getByRole('radio', { name: '괴롭힘·불쾌한 행동' }));
    await user.click(within(dialog).getByRole('button', { name: '신고하기' }));
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({ targetType: 'user', targetId: 'seed-host-01', reason: 'harassment', body: null }),
    );
  });
});
