import { useId, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Icon } from './Icon';

/** TextField / Select / Textarea / Checkbox 공통: 라벨·도움말·오류 영역과 aria 연결 */

export interface FieldBaseProps {
  /** 화면 라벨 (13px 700) */
  label: string;
  /** true면 라벨을 시각적으로 숨긴다(스크린리더에는 읽힘) */
  hideLabel?: boolean;
  /** 도움말 — 오류와 별도로 항상 표시 */
  hint?: ReactNode;
  /** 오류 문구 — 있으면 aria-invalid, 아이콘과 함께 표시 */
  error?: ReactNode;
  /** 바깥 래퍼 className (레이아웃용) */
  containerClassName?: string;
}

export function useFieldIds(id: string | undefined, hint: ReactNode, error: ReactNode, describedBy?: string) {
  const autoId = useId();
  const controlId = id ?? `field-${autoId}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedByIds = [hintId, errorId, describedBy].filter(Boolean).join(' ') || undefined;
  return { controlId, hintId, errorId, describedBy: describedByIds };
}

export function FieldLabel({ htmlFor, hidden, children }: { htmlFor: string; hidden?: boolean; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className={hidden ? 'sr-only' : 'mb-2 block text-sm font-bold text-ink'}>
      {children}
    </label>
  );
}

export function FieldMessages({
  hint,
  hintId,
  error,
  errorId,
}: {
  hint?: ReactNode;
  hintId?: string;
  error?: ReactNode;
  errorId?: string;
}) {
  return (
    <>
      {hint ? (
        <p id={hintId} className="mt-1.5 text-sm leading-normal text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="mt-1.5 flex items-start gap-1.5 text-sm font-semibold leading-normal text-danger">
          <Icon name="alert-circle" size="1.15em" className="mt-[0.15em]" />
          <span>
            <span className="sr-only">오류: </span>
            {error}
          </span>
        </p>
      ) : null}
    </>
  );
}

export function fieldControlClassName({ invalid, size = 'md' }: { invalid?: boolean; size?: 'md' | 'sm' }) {
  return cn(
    'block w-full min-h-control rounded-lg border bg-surface px-3.5 py-2.5 text-ink leading-snug',
    'placeholder:text-muted transition-colors duration-150',
    'disabled:cursor-not-allowed disabled:bg-disabled-bg disabled:text-disabled-text',
    // 모바일(760px 이하)은 16px로 고정해 iOS Safari의 포커스 자동 확대를 막는다. 데스크톱 15px(sm은 14px).
    'text-input-mobile',
    size === 'sm' ? 'md:text-md' : 'md:text-base',
    invalid ? 'border-danger' : 'border-border hover:border-border-strong',
  );
}
