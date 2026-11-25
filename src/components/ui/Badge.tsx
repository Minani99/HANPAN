import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

/**
 * genre: 장르 라벨(#F1F3F5/#4F5964), status: 중립 상태(#ECEFF1/#555E68)
 * danger/success/warning: 의미 색 — 반드시 문구로 상태를 함께 전달한다.
 */
export type BadgeTone = 'genre' | 'status' | 'danger' | 'success' | 'warning';

const TONE_CLASS: Record<BadgeTone, string> = {
  genre: 'bg-genre-bg text-genre-text',
  status: 'bg-status-bg text-status-text',
  danger: 'bg-danger-soft text-danger',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({ tone = 'status', className, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center rounded-sm px-2 py-1.25 text-xs leading-tight font-semibold tracking-normal text-wrap-ko',
        TONE_CLASS[tone],
        className,
      )}
      {...rest}
    />
  );
}
