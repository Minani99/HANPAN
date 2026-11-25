import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Dialog } from './Dialog';

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button">앞 버튼</button>
      <button type="button" onClick={() => setOpen(true)}>
        지역 선택 열기
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="지역 선택" description="권역을 골라주세요.">
        <button type="button">둔산·탄방</button>
        <button type="button">궁동·봉명</button>
      </Dialog>
    </div>
  );
}

async function openDialog() {
  const user = userEvent.setup();
  render(<Harness />);
  const trigger = screen.getByRole('button', { name: '지역 선택 열기' });
  await user.click(trigger);
  const dialog = screen.getByRole('dialog', { name: '지역 선택' });
  return { user, trigger, dialog };
}

describe('Dialog', () => {
  it('role/aria 속성을 갖추고 본문 첫 요소에 포커스한다', async () => {
    const { dialog } = await openDialog();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('권역을 골라주세요.');
    expect(within(dialog).getByRole('button', { name: '둔산·탄방' })).toHaveFocus();
    expect(within(dialog).getByRole('button', { name: '닫기' })).toBeInTheDocument();
    // portal: 대화상자는 body 바로 아래에 붙는다
    expect(dialog.closest('[data-testid="dialog-overlay"]')?.parentElement).toBe(document.body);
  });

  it('Tab/Shift+Tab 포커스가 대화상자 안에서 순환한다', async () => {
    const { user, dialog } = await openDialog();
    const close = within(dialog).getByRole('button', { name: '닫기' });
    const first = within(dialog).getByRole('button', { name: '둔산·탄방' });
    const last = within(dialog).getByRole('button', { name: '궁동·봉명' });

    await user.tab();
    expect(last).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus(); // 마지막 → 처음(닫기 버튼이 DOM상 첫 요소)
    await user.tab({ shift: true });
    expect(last).toHaveFocus(); // 처음 → 마지막
    await user.tab({ shift: true });
    expect(first).toHaveFocus();
  });

  it('ESC로 닫히고 트리거로 포커스가 돌아간다', async () => {
    const { user, trigger } = await openDialog();
    expect(document.body.style.overflow).toBe('hidden');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
  });

  it('오버레이 클릭으로 닫히고, 대화상자 안 클릭으로는 닫히지 않는다', async () => {
    const { user, dialog, trigger } = await openDialog();
    await user.click(within(dialog).getByText('권역을 골라주세요.'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByTestId('dialog-overlay'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('닫기 버튼으로 닫힌다', async () => {
    const { user, dialog, trigger } = await openDialog();
    await user.click(within(dialog).getByRole('button', { name: '닫기' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
