import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';
import { IconButton } from './IconButton';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hasAttribute('inert') && element.getAttribute('aria-hidden') !== 'true',
  );
}

let scrollLockCount = 0;
let savedBodyStyle: { overflow: string; paddingRight: string } | null = null;

function lockBodyScroll() {
  if (scrollLockCount === 0) {
    const { body, documentElement } = document;
    savedBodyStyle = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
    const scrollbarWidth = window.innerWidth - documentElement.clientWidth;
    body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;
  }
  scrollLockCount += 1;
}

function unlockBodyScroll() {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0 && savedBodyStyle) {
    document.body.style.overflow = savedBodyStyle.overflow;
    document.body.style.paddingRight = savedBodyStyle.paddingRight;
    savedBodyStyle = null;
  }
}

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** 제목 아래 설명. aria-describedby로 연결된다 */
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** 열릴 때 포커스할 요소. 없으면 본문의 첫 포커스 가능 요소 → 닫기 버튼 순 */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** md 550px(기본) / sm 440px */
  size?: 'md' | 'sm';
  closeLabel?: string;
}

/**
 * 모달 대화상자.
 * portal · role="dialog" aria-modal · 포커스 트랩 · ESC/오버레이 클릭 닫기 · 닫힐 때 트리거로 포커스 복귀 · 배경 스크롤 잠금
 */
export function Dialog(props: DialogProps) {
  if (!props.open || typeof document === 'undefined') return null;
  return createPortal(<DialogPanel {...props} />, document.body);
}

function DialogPanel({
  onClose,
  title,
  description,
  children,
  footer,
  initialFocusRef,
  size = 'md',
  closeLabel = '닫기',
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const pointerDownOnOverlay = useRef(false);

  const requestClose = useEffectEvent(() => onClose());
  const getInitialFocusTarget = useEffectEvent((): HTMLElement | null => {
    if (initialFocusRef?.current) return initialFocusRef.current;
    const inBody = bodyRef.current ? getFocusable(bodyRef.current)[0] : undefined;
    return inBody ?? closeButtonRef.current ?? panelRef.current;
  });

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return undefined;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    lockBodyScroll();
    getInitialFocusTarget()?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        requestClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = getFocusable(panel);
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      const insidePanel = active instanceof Node && panel.contains(active);

      if (event.shiftKey) {
        if (!insidePanel || active === first || active === panel) {
          event.preventDefault();
          last.focus();
        }
      } else if (!insidePanel || active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    // 포커스가 대화상자 밖으로 나가면(마우스 등) 다시 안으로 가져온다.
    const handleFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && !panel.contains(event.target)) {
        (getFocusable(panel)[0] ?? panel).focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('focusin', handleFocusIn);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('focusin', handleFocusIn);
      unlockBodyScroll();
      if (previouslyFocused && previouslyFocused.isConnected) previouslyFocused.focus();
    };
  }, []);

  const handleOverlayMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    pointerDownOnOverlay.current = event.target === event.currentTarget;
  };

  const handleOverlayClick = (event: MouseEvent<HTMLDivElement>) => {
    // 대화상자 안에서 눌러 밖에서 뗀 드래그는 닫지 않는다.
    if (pointerDownOnOverlay.current && event.target === event.currentTarget) onClose();
    pointerDownOnOverlay.current = false;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-5"
      onMouseDown={handleOverlayMouseDown}
      onClick={handleOverlayClick}
      data-testid="dialog-overlay"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          'max-h-[min(92dvh,830px)] w-full overflow-auto rounded-dialog bg-surface px-5 pt-5 pb-6 focus-visible:outline-none md:px-7.75 md:pt-7 md:pb-7.25',
          'shadow-[0_12px_50px_rgb(0_0_0/0.13)]',
          size === 'sm' ? 'max-w-dialog-sm' : 'max-w-dialog',
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
          <h2 id={titleId} className="text-2xl leading-tight font-heavy tracking-tight text-ink">
            {title}
          </h2>
          <IconButton ref={closeButtonRef} label={closeLabel} icon="close" onClick={onClose} className="-mr-2.5" />
        </div>
        {description ? (
          <p id={descriptionId} className="mt-4 text-sm leading-relaxed text-muted">
            {description}
          </p>
        ) : null}
        <div ref={bodyRef} className="mt-5">
          {children}
        </div>
        {footer ? <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}
