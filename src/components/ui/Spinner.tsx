import { cn } from '../../lib/cn';
import { VisuallyHidden } from './VisuallyHidden';

export interface SpinnerProps {
  /** CSS 길이. 기본 1.125rem(18px) */
  size?: string;
  /** 지정하면 role="status"로 상태를 알린다. 버튼 안처럼 다른 곳에서 상태를 알리면 생략 */
  label?: string;
  className?: string;
}

export function Spinner({ size = '1.125rem', label, className }: SpinnerProps) {
  return (
    <span role={label ? 'status' : undefined} className={cn('inline-flex shrink-0', className)}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
        className="animate-spin"
        style={{ width: size, height: size }}
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      {label ? <VisuallyHidden>{label}</VisuallyHidden> : null}
    </span>
  );
}
