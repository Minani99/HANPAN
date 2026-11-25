import { Link } from 'react-router';
import { Icon } from '../ui/Icon';

const ACTION_CLASS =
  'flex min-h-15.75 items-center justify-between gap-2 rounded-xl border border-border bg-surface p-3.25 text-left text-sm leading-tight font-heavy text-ink transition-colors duration-150 hover:bg-soft';

/** 모바일 전용 빠른 메뉴 2칸 */
export function QuickActions({ onFindMeetings }: { onFindMeetings: () => void }) {
  return (
    <div className="grid grid-cols-2 gap-2.25 pt-2 pb-6.25 md:hidden">
      <button type="button" onClick={onFindMeetings} className={ACTION_CLASS}>
        <span className="flex items-center gap-2">
          <Icon name="grid" size="1.25rem" />
          모임 찾기
        </span>
        <span aria-hidden="true" className="text-lg leading-none font-normal text-muted">
          ›
        </span>
      </button>
      <Link to="/venues" className={ACTION_CLASS}>
        <span className="flex items-center gap-2">
          <Icon name="store" size="1.25rem" />
          공간 찾기
        </span>
        <span aria-hidden="true" className="text-lg leading-none font-normal text-muted">
          ›
        </span>
      </Link>
    </div>
  );
}
