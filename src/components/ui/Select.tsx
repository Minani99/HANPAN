import type { Ref, SelectHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';
import { FieldLabel, FieldMessages, fieldControlClassName, useFieldIds, type FieldBaseProps } from './field';
import { Icon } from './Icon';

export interface SelectProps extends FieldBaseProps, Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  inputSize?: 'md' | 'sm';
  ref?: Ref<HTMLSelectElement>;
}

/** 네이티브 select (모바일 OS 선택기를 그대로 사용) */
export function Select({
  label,
  hideLabel,
  hint,
  error,
  containerClassName,
  inputSize = 'md',
  id,
  className,
  children,
  'aria-describedby': ariaDescribedBy,
  ref,
  ...rest
}: SelectProps) {
  const ids = useFieldIds(id, hint, error, ariaDescribedBy);
  return (
    <div className={containerClassName}>
      <FieldLabel htmlFor={ids.controlId} hidden={hideLabel}>
        {label}
      </FieldLabel>
      <div className="relative">
        <select
          ref={ref}
          id={ids.controlId}
          aria-invalid={error ? true : undefined}
          aria-describedby={ids.describedBy}
          className={cn(fieldControlClassName({ invalid: Boolean(error), size: inputSize }), 'appearance-none pr-10', className)}
          {...rest}
        >
          {children}
        </select>
        <Icon
          name="chevron-down"
          size="1.125rem"
          className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-muted"
        />
      </div>
      <FieldMessages hint={hint} hintId={ids.hintId} error={error} errorId={ids.errorId} />
    </div>
  );
}
