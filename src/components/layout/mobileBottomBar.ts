import { useEffect, useSyncExternalStore, type RefObject } from 'react';

/**
 * 모바일 하단 고정 CTA 바(모임 상세 등) ↔ 공통 레이아웃 연결.
 * - CTA 바가 화면에 있으면 하단 내비를 숨긴다(UI_SPEC §3.2 "하단 내비 대신 표시").
 * - CTA 바 높이를 `--bottom-nav-offset`에 써서 본문 하단 여백과 토스트 위치가 바를 피하게 한다.
 */

let mountedBars = 0;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return mountedBars > 0;
}

/** 레이아웃용: 하단 CTA 바가 떠 있는지 */
export function useHasMobileCtaBar(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

const OFFSET_VAR = '--bottom-nav-offset';

/** CTA 바 컴포넌트용: 마운트 동안 하단 내비를 숨기고, 바 높이만큼 하단 여백을 잡는다. */
export function useMobileCtaBar(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    mountedBars += 1;
    notify();
    const root = document.documentElement;
    const element = ref.current;
    const update = () => {
      if (!element) return;
      const height = element.getBoundingClientRect().height;
      // 데스크톱에서는 바가 정적 패널이 되므로(높이와 무관하게) md:pb-0 등이 우선한다.
      root.style.setProperty(OFFSET_VAR, `${Math.ceil(height)}px`);
    };
    update();
    const observer = typeof ResizeObserver !== 'undefined' && element ? new ResizeObserver(update) : null;
    if (observer && element) observer.observe(element);
    return () => {
      observer?.disconnect();
      mountedBars = Math.max(0, mountedBars - 1);
      if (mountedBars === 0) root.style.removeProperty(OFFSET_VAR);
      notify();
    };
  }, [ref]);
}
