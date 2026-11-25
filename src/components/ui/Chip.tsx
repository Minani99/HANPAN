import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { cn } from '../../lib/cn';

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed'> {
  /** 선택 상태. aria-pressed로 노출된다 */
  selected?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  /** true면 칸을 가득 채운다(대화상자 그리드 등) */
  fullWidth?: boolean;
  /**
   * false면 토글이 아닌 일반 동작 버튼(예: 필터 해제 칩)으로 쓰여 aria-pressed를 붙이지 않는다.
   * 이때 selected는 모양만 결정한다.
   */
  toggle?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

/**
 * 필터 칩 (토글 버튼).
 * 모바일 42px / 12.5px / 10px 13px, 데스크톱(761px~) 44px / 13px / 10px 17px.
 */
export function Chip({
  selected = false,
  leadingIcon,
  trailingIcon,
  fullWidth,
  toggle = true,
  type = 'button',
  className,
  children,
  ref,
  ...rest
}: ChipProps) {
  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={toggle ? selected : undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border font-strong leading-tight whitespace-nowrap transition-colors duration-150',
        'min-h-chip-sm px-3.25 py-2.5 text-chip-sm md:min-h-chip md:px-4.25 md:text-sm',
        selected ? 'border-ink bg-ink text-white' : 'border-border bg-surface text-ink hover:bg-soft',
        'disabled:cursor-not-allowed disabled:border-disabled-bg disabled:bg-disabled-bg disabled:text-disabled-text',
        fullWidth ? 'w-full' : null,
        className,
      )}
      {...rest}
    >
      {leadingIcon}
      {children}
      {trailingIcon}
    </button>
  );
}
