import type { InputHTMLAttributes, ReactNode, Ref } from 'react';
import { cn } from '../../lib/cn';
import { FieldMessages, useFieldIds } from './field';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  containerClassName?: string;
  ref?: Ref<HTMLInputElement>;
}

/** 네이티브 체크박스 + 44px 이상 클릭 영역의 라벨 */
export function Checkbox({
  label,
  hint,
  error,
  containerClassName,
  id,
  className,
  'aria-describedby': ariaDescribedBy,
  ref,
  ...rest
}: CheckboxProps) {
  const ids = useFieldIds(id, hint, error, ariaDescribedBy);
  return (
    <div className={containerClassName}>
      <label
        htmlFor={ids.controlId}
        className="inline-flex min-h-touch cursor-pointer items-center gap-2.5 text-base text-ink has-disabled:cursor-not-allowed has-disabled:text-disabled-text"
      >
        <input
          ref={ref}
          id={ids.controlId}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={ids.describedBy}
          className={cn('size-5 shrink-0 accent-ink', className)}
          {...rest}
        />
        <span>{label}</span>
      </label>
      <FieldMessages hint={hint} hintId={ids.hintId} error={error} errorId={ids.errorId} />
    </div>
  );
}
