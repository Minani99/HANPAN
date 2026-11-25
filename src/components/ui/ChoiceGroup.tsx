import { useId, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { FieldMessages } from './field';

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  /** list 배치에서 라벨 아래 설명 */
  description?: string;
}

export interface ChoiceGroupProps<T extends string> {
  /** 그룹 이름(legend, 13px 700) */
  legend: string;
  name: string;
  options: readonly ChoiceOption<T>[];
  /** 선택 값. ''이면 선택 없음 */
  value: T | '';
  onChange: (value: T) => void;
  hint?: ReactNode;
  error?: ReactNode;
  /** chips: 칩 모양(줄바꿈), list: 설명이 있는 세로 목록 */
  layout?: 'chips' | 'list';
  /**
   * 폼 필드 이름. fieldset에 data-field로 붙고, 선택된 항목(없으면 첫 항목)에 data-focus-target이 붙는다.
   * 오류 시 폼이 이 표시로 포커스할 요소를 찾는다(focusFormField).
   */
  fieldName?: string;
  required?: boolean;
  className?: string;
}

/**
 * 네이티브 라디오 그룹(fieldset + legend). 화살표 키 이동·폼 제출은 브라우저 기본 동작을 따른다.
 * 칩 모양: 모바일 42px / 데스크톱 44px, 선택 시 ink 배경. 포커스 링은 라벨에 표시한다.
 */
export function ChoiceGroup<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
  hint,
  error,
  layout = 'chips',
  fieldName,
  required,
  className,
}: ChoiceGroupProps<T>) {
  const baseId = useId();
  const hintId = hint ? `${baseId}-hint` : undefined;
  const errorId = error ? `${baseId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  // 포커스 대상: 선택된 항목, 없으면 첫 항목 (라디오 그룹의 기본 탭 정지 위치와 같다)
  const focusValue = value !== '' && options.some((option) => option.value === value) ? value : options[0]?.value;

  return (
    <fieldset className={cn('min-w-0', className)} aria-describedby={describedBy} data-field={fieldName}>
      <legend className="mb-2 text-sm font-bold text-ink">
        {legend}
        {required ? <span className="sr-only"> (필수)</span> : null}
      </legend>
      <div className={layout === 'chips' ? 'flex flex-wrap gap-2' : 'grid gap-2'}>
        {options.map((option) => {
          const checked = option.value === value;
          const input = (
            <input
              data-focus-target={option.value === focusValue ? true : undefined}
              type="radio"
              name={name}
              value={option.value}
              checked={checked}
              onChange={() => onChange(option.value)}
              aria-invalid={error ? true : undefined}
              required={required}
              className={layout === 'chips' ? 'sr-only' : 'mt-0.5 size-5 shrink-0 accent-ink'}
            />
          );
          if (layout === 'chips') {
            return (
              <label
                key={option.value}
                className={cn(
                  'inline-flex min-h-chip-sm cursor-pointer items-center rounded-lg border px-3.25 py-2.5 text-chip-sm leading-tight font-strong whitespace-nowrap transition-colors duration-150 md:min-h-chip md:px-4.25 md:text-sm',
                  'has-focus-visible:outline-3 has-focus-visible:outline-offset-3',
                  checked ? 'border-ink bg-ink text-white' : 'border-border bg-surface text-ink hover:bg-soft',
                  error && !checked ? 'border-danger' : null,
                )}
              >
                {input}
                {option.label}
              </label>
            );
          }
          return (
            <label
              key={option.value}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3.5 transition-colors duration-150',
                'has-focus-visible:outline-3 has-focus-visible:outline-offset-3',
                checked ? 'border-ink' : 'border-border hover:bg-soft',
                error && !checked ? 'border-danger' : null,
              )}
            >
              {input}
              <span className="min-w-0">
                <span className="block text-base leading-snug font-bold text-ink">{option.label}</span>
                {option.description ? (
                  <span className="mt-1 block text-sm leading-normal text-muted text-wrap-ko">{option.description}</span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
      <FieldMessages hint={hint} hintId={hintId} error={error} errorId={errorId} />
    </fieldset>
  );
}
