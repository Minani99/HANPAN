import type { InputHTMLAttributes, ReactNode, Ref } from 'react';
import { cn } from '../../lib/cn';
import { FieldLabel, FieldMessages, fieldControlClassName, useFieldIds, type FieldBaseProps } from './field';

export interface TextFieldProps extends FieldBaseProps, Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** 모바일(760px 이하)은 항상 16px. 데스크톱 md 15px(기본) / sm 14px */
  inputSize?: 'md' | 'sm';
  /** 입력칸 왼쪽 장식 아이콘 */
  leading?: ReactNode;
  ref?: Ref<HTMLInputElement>;
}

export function TextField({
  label,
  hideLabel,
  hint,
  error,
  containerClassName,
  inputSize = 'md',
  leading,
  id,
  className,
  type = 'text',
  'aria-describedby': ariaDescribedBy,
  ref,
  ...rest
}: TextFieldProps) {
  const ids = useFieldIds(id, hint, error, ariaDescribedBy);
  return (
    <div className={containerClassName}>
      <FieldLabel htmlFor={ids.controlId} hidden={hideLabel}>
        {label}
      </FieldLabel>
      <div className="relative">
        {leading ? (
          <span className="pointer-events-none absolute top-1/2 left-3.5 flex -translate-y-1/2 text-muted">{leading}</span>
        ) : null}
        <input
          ref={ref}
          id={ids.controlId}
          type={type}
          aria-invalid={error ? true : undefined}
          aria-describedby={ids.describedBy}
          className={cn(fieldControlClassName({ invalid: Boolean(error), size: inputSize }), leading ? 'pl-10' : null, className)}
          {...rest}
        />
      </div>
      <FieldMessages hint={hint} hintId={ids.hintId} error={error} errorId={ids.errorId} />
    </div>
  );
}
