import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

/** 로딩 자리 표시. 장식이므로 aria-hidden — 로딩 상태는 감싸는 영역의 aria-busy와 문구로 알린다. */
export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn('animate-skeleton rounded-md bg-skeleton', className)} {...rest} />;
}
