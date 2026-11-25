import type { Ref, TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';
import { FieldLabel, FieldMessages, fieldControlClassName, useFieldIds, type FieldBaseProps } from './field';

export interface TextareaProps extends FieldBaseProps, TextareaHTMLAttributes<HTMLTextAreaElement> {
  ref?: Ref<HTMLTextAreaElement>;
}

export function Textarea({
  label,
  hideLabel,
  hint,
  error,
  containerClassName,
  id,
  className,
  rows = 4,
  'aria-describedby': ariaDescribedBy,
  ref,
  ...rest
}: TextareaProps) {
  const ids = useFieldIds(id, hint, error, ariaDescribedBy);
  return (
    <div className={containerClassName}>
      <FieldLabel htmlFor={ids.controlId} hidden={hideLabel}>
        {label}
      </FieldLabel>
      <textarea
        ref={ref}
        id={ids.controlId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={ids.describedBy}
        className={cn(fieldControlClassName({ invalid: Boolean(error) }), 'resize-y leading-relaxed', className)}
        {...rest}
      />
      <FieldMessages hint={hint} hintId={ids.hintId} error={error} errorId={ids.errorId} />
    </div>
  );
}
