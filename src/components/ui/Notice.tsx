import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Icon, type IconName } from './Icon';

/**
 * 안내 상자 (1px 테두리 또는 옅은 면, radius 8). 그림자·강한 배경색 없음.
 * - info: 옅은 면(soft) + text 색(soft 위에서 muted는 대비 부족)
 * - warning / danger / success: 의미 색 글자 + 옅은 의미 배경. 항상 문구로 상태를 함께 전달한다.
 */
export type NoticeTone = 'info' | 'warning' | 'danger' | 'success';

const TONE_CLASS: Record<NoticeTone, string> = {
  info: 'border-border bg-soft text-text',
  warning: 'border-transparent bg-warning-soft text-warning',
  danger: 'border-transparent bg-danger-soft text-danger',
  success: 'border-transparent bg-success-soft text-success',
};

const TONE_ICON: Record<NoticeTone, IconName> = {
  info: 'info',
  warning: 'alert-circle',
  danger: 'alert-circle',
  success: 'check-circle',
};

export interface NoticeProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  tone?: NoticeTone;
  title?: ReactNode;
  /** 아이콘 숨김 */
  plain?: boolean;
}

export function Notice({ tone = 'info', title, plain, className, children, ...rest }: NoticeProps) {
  return (
    <div
      className={cn('flex items-start gap-2.5 rounded-lg border px-4 py-3.5 text-sm leading-relaxed', TONE_CLASS[tone], className)}
      {...rest}
    >
      {plain ? null : <Icon name={TONE_ICON[tone]} size="1.15em" className="mt-[0.22em]" />}
      <div className="min-w-0 flex-1 text-wrap-ko">
        {title ? <p className="font-bold">{title}</p> : null}
        {children ? <div className={title ? 'mt-1' : undefined}>{children}</div> : null}
      </div>
    </div>
  );
}

/** 폼·대화상자의 오류 요약 (role="alert"로 즉시 읽힘). message가 없으면 렌더하지 않는다. */
export function ErrorText({ message, className, id }: { message: ReactNode; className?: string; id?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className={cn('flex items-start gap-1.5 text-sm leading-normal font-semibold text-danger', className)}>
      <Icon name="alert-circle" size="1.15em" className="mt-[0.15em]" />
      <span className="text-wrap-ko">
        <span className="sr-only">오류: </span>
        {message}
      </span>
    </p>
  );
}
