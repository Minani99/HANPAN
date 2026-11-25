import { Link, useLocation } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { cn } from '../../lib/cn';
import { saveReturnTo } from '../../lib/returnTo';
import { Icon, type IconName } from '../ui/Icon';
import { isExploreSection, isPathWithin } from './navigation';

interface BottomNavItem {
  to: string;
  label: string;
  icon: IconName;
  isActive: (pathname: string) => boolean;
}

const ITEMS: readonly BottomNavItem[] = [
  { to: '/', label: '모임 찾기', icon: 'search', isActive: isExploreSection },
  { to: '/my/meetings', label: '내 모임', icon: 'calendar-check', isActive: (p) => isPathWithin(p, '/my/meetings') },
  { to: '/meetings/new', label: '모임 만들기', icon: 'plus-square', isActive: (p) => isPathWithin(p, '/meetings/new') },
  {
    to: '/profile',
    label: '마이',
    icon: 'user',
    isActive: (p) => isPathWithin(p, '/profile') || isPathWithin(p, '/login'),
  },
];

/**
 * 모바일(760px 이하) 하단 고정 내비.
 * 높이 72px + safe-area. 본문은 AppLayout에서 같은 높이만큼 하단 여백을 둔다.
 */
export function MobileBottomNav() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  return (
    <nav
      aria-label="하단 메뉴"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface pb-[env(safe-area-inset-bottom,0px)] md:hidden"
      data-testid="mobile-bottom-nav"
    >
      <ul role="list" className="grid min-h-bottom-nav grid-cols-4 items-stretch">
        {ITEMS.map((item) => {
          const active = item.isActive(pathname);
          // '마이'는 로그인 여부에 따라 프로필 또는 로그인으로 간다.
          const to = item.to === '/profile' && !user ? '/login' : item.to;
          return (
            <li key={item.to} className="flex">
              <Link
                to={to}
                onClick={to === '/login' ? () => saveReturnTo(pathname) : undefined}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex min-h-bottom-nav-item w-full flex-col items-center justify-center gap-1 px-1 text-center text-xs leading-tight font-bold',
                  active
                    ? 'text-ink before:absolute before:inset-x-5 before:top-0 before:h-0.5 before:rounded-full before:bg-ink'
                    : 'text-muted hover:text-ink',
                )}
              >
                <Icon name={item.icon} size="1.375rem" strokeWidth={active ? 2 : 1.7} />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
