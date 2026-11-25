import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  /** 버튼·링크 (Primary는 하나만) */
  actions?: ReactNode;
  /** 추가 안내 (예: 후속 기능 안내) */
  footnote?: ReactNode;
  headingLevel?: 'h2' | 'h3';
  className?: string;
}

export function EmptyState({ title, description, actions, footnote, headingLevel = 'h3', className }: EmptyStateProps) {
  const Heading = headingLevel;
  return (
    <div className={cn('px-2.5 py-16 text-center', className)}>
      <Heading className="text-lg leading-snug font-bold tracking-tight text-ink text-wrap-ko">{title}</Heading>
      {description ? <p className="mt-2 text-md leading-relaxed text-muted text-wrap-ko">{description}</p> : null}
      {actions ? <div className="mt-6 flex flex-wrap items-center justify-center gap-2">{actions}</div> : null}
      {footnote ? <p className="mt-4 text-sm text-muted">{footnote}</p> : null}
    </div>
  );
}
