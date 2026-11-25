import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Chip } from './Chip';

function ToggleChip() {
  const [on, setOn] = useState(false);
  return (
    <Chip selected={on} onClick={() => setOn((value) => !value)}>
      모집 중만
    </Chip>
  );
}

describe('Chip', () => {
  it('선택 상태를 aria-pressed로 노출한다', async () => {
    const user = userEvent.setup();
    render(<ToggleChip />);
    const chip = screen.getByRole('button', { name: '모집 중만' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    await user.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    await user.keyboard('{Enter}');
    expect(chip).toHaveAttribute('aria-pressed', 'false');
  });

  it('toggle={false}면 aria-pressed를 붙이지 않는다(해제용 칩)', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Chip toggle={false} selected onClick={onClick} aria-label="날짜 필터 해제">
        날짜: 12.05
      </Chip>,
    );
    const chip = screen.getByRole('button', { name: '날짜 필터 해제' });
    expect(chip).not.toHaveAttribute('aria-pressed');
    await user.click(chip);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
