import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
  it('loading이면 클릭을 무시하고 aria-busy·aria-disabled를 표시하며 포커스는 유지된다', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        참가 신청
      </Button>,
    );
    const button = screen.getByRole('button', { name: /참가 신청/ });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();
    await user.click(button);
    await user.dblClick(button);
    expect(onClick).not.toHaveBeenCalled();
    button.focus();
    expect(button).toHaveFocus();
    expect(screen.getByText('처리 중')).toHaveClass('sr-only');
  });

  it('Promise를 반환하는 onClick은 끝날 때까지 중복 실행되지 않는다', async () => {
    const user = userEvent.setup();
    let resolve: () => void = () => {};
    const onClick = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    render(<Button onClick={onClick}>저장</Button>);
    const button = screen.getByRole('button', { name: '저장' });

    await user.dblClick(button);
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute('aria-busy', 'true');

    await act(async () => {
      resolve();
    });
    expect(button).not.toHaveAttribute('aria-busy');
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('Promise가 실패해도 다시 누를 수 있다', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn(() => Promise.reject(new Error('fail')));
    render(<Button onClick={onClick}>재시도</Button>);
    const button = screen.getByRole('button', { name: '재시도' });
    await user.click(button);
    await act(async () => {});
    expect(button).not.toHaveAttribute('aria-busy');
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('disabled면 클릭되지 않는다', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        모집 마감
      </Button>,
    );
    await user.click(screen.getByRole('button', { name: '모집 마감' }));
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '모집 마감' })).toBeDisabled();
  });

  it('기본 type은 button (폼 안에서 의도치 않은 제출 방지)', () => {
    render(<Button>확인</Button>);
    expect(screen.getByRole('button', { name: '확인' })).toHaveAttribute('type', 'button');
  });
});
