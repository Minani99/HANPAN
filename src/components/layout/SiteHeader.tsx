import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import type { RegionCode } from '../../data/types';
import { REGIONS, getRegionName } from '../../domain/regions';
import { cn } from '../../lib/cn';
import { parseFilters, serializeFilters, updateFilters } from '../../lib/filters';
import { saveReturnTo } from '../../lib/returnTo';
import { RegionDialog } from '../meeting/RegionDialog';
import { Icon } from '../ui/Icon';
import { VisuallyHidden } from '../ui/VisuallyHidden';
import { isExplorePath, isExploreSection, isPathWithin } from './navigation';
import { PageContainer } from './PageContainer';

interface NavItem {
  to: string;
  label: string;
  isActive: (pathname: string) => boolean;
}

const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', label: '모임 찾기', isActive: isExploreSection },
  { to: '/venues', label: '공간 찾기', isActive: (p) => isPathWithin(p, '/venues') },
  { to: '/meetings/new', label: '모임 만들기', isActive: (p) => isPathWithin(p, '/meetings/new') },
];

/** 닉네임 첫 글자(영문은 대문자). 이모지 등 조합 문자도 한 글자로 자른다. */
export function profileInitial(nickname: string): string {
  const first = Array.from(nickname.trim())[0] ?? '?';
  return first.toLocaleUpperCase('ko-KR');
}

export function SiteHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [regionOpen, setRegionOpen] = useState(false);
  const { status: authStatus, user } = useAuth();

  const onExplore = isExplorePath(location.pathname);
  const currentRegion = onExplore ? parseFilters(searchParams).region : undefined;
  const regionLabel = currentRegion ? getRegionName(currentRegion) : '전체 지역';

  const selectRegion = (region: RegionCode | undefined) => {
    setRegionOpen(false);
    if (onExplore) {
      const next = serializeFilters(updateFilters(parseFilters(searchParams), { region }));
      const search = next.toString();
      navigate(
        { pathname: location.pathname, search: search ? `?${search}` : '' },
        { replace: true, preventScrollReset: true },
      );
    } else {
      navigate(region ? `/?region=${region}` : '/');
    }
  };

  return (
    <header className="border-b border-border bg-surface">
      {/* 글자를 크게 키운 환경에서도 가로로 넘치지 않도록 줄바꿈을 허용한다(기본 크기에서는 한 줄). */}
      <PageContainer className="flex min-h-header-sm flex-wrap items-center gap-x-4 md:min-h-header md:gap-x-10">
        <Link
          to="/"
          aria-label="HANPAN 홈"
          className="shrink-0 font-brand text-brand-sm leading-none font-black tracking-brand whitespace-nowrap text-ink md:text-brand"
        >
          HANPAN.
        </Link>

        <nav aria-label="주요 메뉴" className="hidden self-stretch md:flex">
          <ul role="list" className="flex items-stretch gap-8.5">
            {NAV_ITEMS.map((item) => {
              const active = item.isActive(location.pathname);
              return (
                <li key={item.to} className="flex">
                  <Link
                    to={item.to}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'relative flex items-center text-md font-strong whitespace-nowrap transition-colors duration-150',
                      active
                        ? 'text-ink after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-ink'
                        : 'text-text hover:text-ink',
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-x-5">
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => setRegionOpen(true)}
            className="-mr-1.5 inline-flex min-h-touch min-w-0 items-center gap-1 rounded-lg px-1.5 text-left text-sm leading-snug font-bold text-ink hover:bg-soft md:mr-0 md:text-md"
            data-testid="region-button"
          >
            <Icon name="pin" size="1.1em" />
            <VisuallyHidden>지역 선택: </VisuallyHidden>
            <span className="min-w-0 text-wrap-ko">대전 · {regionLabel}</span>
            <Icon name="chevron-down" size="1em" />
          </button>
          {user ? (
            <Link
              to="/profile"
              aria-current={isPathWithin(location.pathname, '/profile') ? 'page' : undefined}
              className="hidden size-touch shrink-0 place-items-center rounded-full md:grid"
              data-testid="profile-button"
            >
              <span
                aria-hidden="true"
                className="grid size-8 place-items-center rounded-full border border-ink bg-surface text-sm leading-none font-bold text-ink"
              >
                {profileInitial(user.nickname)}
              </span>
              <VisuallyHidden>내 프로필 ({user.nickname})</VisuallyHidden>
            </Link>
          ) : (
            <>
              {authStatus === 'ready' ? (
                <Link
                  to="/login"
                  onClick={() => saveReturnTo(`${location.pathname}${location.search}`)}
                  className="hidden min-h-touch items-center text-md font-bold whitespace-nowrap text-ink hover:underline hover:underline-offset-4 md:inline-flex"
                >
                  로그인
                </Link>
              ) : null}
              <span
                aria-hidden="true"
                className="hidden size-8 shrink-0 place-items-center rounded-full border border-border-strong text-muted md:grid"
              >
                <Icon name="user" size="1rem" />
              </span>
            </>
          )}
        </div>
      </PageContainer>

      <RegionDialog
        open={regionOpen}
        onClose={() => setRegionOpen(false)}
        regions={REGIONS}
        selected={currentRegion}
        onSelect={selectRegion}
      />
    </header>
  );
}
