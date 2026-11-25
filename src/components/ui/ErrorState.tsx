import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Button } from './Button';
import { Icon } from './Icon';

export interface ErrorStateProps {
  title: ReactNode;
  description?: ReactNode;
  /** 있으면 '다시 시도' 보조 버튼을 보여준다. Promise를 반환하면 완료될 때까지 중복 실행을 막는다. */
  onRetry?: () => void | Promise<unknown>;
  retryLabel?: string;
  headingLevel?: 'h2' | 'h3';
  className?: string;
}

export function ErrorState({
  title,
  description = '네트워크 연결을 확인한 뒤 다시 시도해 주세요.',
  onRetry,
  retryLabel = '다시 시도',
  headingLevel = 'h3',
  className,
}: ErrorStateProps) {
  const Heading = headingLevel;
  return (
    <div role="alert" className={cn('px-2.5 py-16 text-center', className)}>
      <Icon name="alert-circle" size="1.75rem" className="mx-auto text-danger" />
      <Heading className="mt-3 text-lg leading-snug font-bold tracking-tight text-ink text-wrap-ko">{title}</Heading>
      {description ? <p className="mt-2 text-md leading-relaxed text-muted text-wrap-ko">{description}</p> : null}
      {onRetry ? (
        <div className="mt-6 flex justify-center">
          <Button variant="secondary" onClick={onRetry}>
            {retryLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
