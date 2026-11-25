import type { MouseEvent } from 'react';
import { Outlet, ScrollRestoration } from 'react-router';
import { AccountStatusBanner } from './AccountStatusBanner';
import { DevDataBanner } from './DevDataBanner';
import { useHasMobileCtaBar } from './mobileBottomBar';
import { MobileBottomNav } from './MobileBottomNav';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';

export const MAIN_CONTENT_ID = 'main-content';

function focusMainContent(event: MouseEvent<HTMLAnchorElement>) {
  // 해시 이동 대신 직접 포커스를 옮겨 라우터 히스토리를 건드리지 않는다.
  event.preventDefault();
  const main = document.getElementById(MAIN_CONTENT_ID);
  main?.focus();
  main?.scrollIntoView({ block: 'start' });
}

/**
 * 공통 레이아웃: (개발용 안내 띠) → (계정 상태 안내) → 헤더 → 본문 → 푸터 → 모바일 하단 내비
 * 모바일에서는 하단 내비 높이 + safe-area 만큼 아래 여백을 확보해 콘텐츠가 가려지지 않게 한다.
 * 상세 화면처럼 하단 고정 CTA 바가 있으면 하단 내비 대신 바를 보여주고, 여백은 바 높이(--bottom-nav-offset)를 따른다.
 */
export function AppLayout() {
  const hasCtaBar = useHasMobileCtaBar();
  return (
    <div className="flex min-h-dvh flex-col pb-(--bottom-nav-offset) md:pb-0">
      <a
        href={`#${MAIN_CONTENT_ID}`}
        onClick={focusMainContent}
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-70 focus:rounded-lg focus:bg-ink focus:px-4 focus:py-3 focus:text-md focus:font-bold focus:text-white"
      >
        본문 바로가기
      </a>
      <DevDataBanner />
      <AccountStatusBanner />
      <SiteHeader />
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="flex-1 focus-visible:outline-none">
        <Outlet />
      </main>
      <SiteFooter />
      {hasCtaBar ? null : <MobileBottomNav />}
      <ScrollRestoration />
    </div>
  );
}
