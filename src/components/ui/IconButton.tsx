import type { ButtonHTMLAttributes, Ref } from 'react';
import { cn } from '../../lib/cn';
import { Icon, type IconName } from './Icon';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  /** 필수: 스크린리더가 읽을 이름 (aria-label) */
  label: string;
  icon: IconName;
  /** CSS 길이. 기본 1.375rem(22px) */
  iconSize?: string;
  variant?: 'ghost' | 'outline';
  ref?: Ref<HTMLButtonElement>;
}

/** 최소 44x44px 터치 영역의 아이콘 전용 버튼 */
export function IconButton({
  label,
  icon,
  iconSize = '1.375rem',
  variant = 'ghost',
  type = 'button',
  className,
  ref,
  ...rest
}: IconButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={cn(
        'inline-flex size-touch shrink-0 items-center justify-center rounded-lg text-ink transition-colors duration-150',
        'hover:bg-soft disabled:cursor-not-allowed disabled:text-disabled-text',
        variant === 'outline' ? 'border border-border bg-surface' : 'bg-transparent',
        className,
      )}
      {...rest}
    >
      <Icon name={icon} size={iconSize} />
    </button>
  );
}
