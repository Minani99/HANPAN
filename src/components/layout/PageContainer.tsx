import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export interface PageContainerProps extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'section' | 'header' | 'footer' | 'nav';
}

/** 최대 폭 1190px(여백 포함), 좌우 여백 모바일 18px / 데스크톱 28px */
export function PageContainer({ as: Component = 'div', className, ...rest }: PageContainerProps) {
  return <Component className={cn('mx-auto w-full max-w-page px-gutter-sm md:px-gutter', className)} {...rest} />;
}
