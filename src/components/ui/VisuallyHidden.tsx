import type { HTMLAttributes, LabelHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

type VisuallyHiddenProps =
  | ({ as?: 'span' | 'div' } & HTMLAttributes<HTMLElement>)
  | ({ as: 'label' } & LabelHTMLAttributes<HTMLLabelElement>);

/** 화면에는 보이지 않고 스크린리더에만 읽히는 텍스트 */
export function VisuallyHidden({ as = 'span', className, ...rest }: VisuallyHiddenProps) {
  const Component = as;
  return <Component className={cn('sr-only', className)} {...(rest as HTMLAttributes<HTMLElement>)} />;
}
