import type { MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { cn } from '../../lib/cn';
import { Icon } from '../ui/Icon';

function canGoBack(): boolean {
  // React Router data router는 history.state.idx에 앱 안에서의 위치를 기록한다.
  const state = typeof window !== 'undefined' ? (window.history.state as { idx?: unknown } | null) : null;
  return typeof state?.idx === 'number' && state.idx > 0;
}

/**
 * '← 목록으로' 링크. 앱 안에서 들어왔으면 뒤로 가기(탐색 필터·스크롤 유지), 직접 들어왔으면 fallback 경로로 간다.
 */
export function BackLink({ to = '/', label, className }: { to?: string; label: string; className?: string }) {
  const navigate = useNavigate();
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    if (canGoBack()) {
      event.preventDefault();
      navigate(-1);
    }
  };
  return (
    <Link
      to={to}
      onClick={handleClick}
      className={cn(
        '-ml-1 inline-flex min-h-touch items-center gap-1.5 rounded-lg px-1 text-md font-bold text-text hover:text-ink',
        className,
      )}
    >
      <Icon name="arrow-left" size="1.1em" />
      {label}
    </Link>
  );
}
