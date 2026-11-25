import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
}

export interface TabsProps<T extends string> {
  /** tablist 이름(스크린리더) */
  label: string;
  items: readonly TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  /** 탭·패널 id 접두사 */
  idPrefix: string;
  className?: string;
}

export function tabId(prefix: string, value: string): string {
  return `${prefix}-tab-${value}`;
}

export function tabPanelId(prefix: string): string {
  return `${prefix}-panel`;
}

/**
 * 탭 목록 (WAI-ARIA Tabs, 자동 활성화).
 * ←/→ 로 이동하며 선택, Home/End 처음/끝. 선택된 탭만 Tab 키 정지점(roving tabindex).
 * 패널은 호출한 쪽에서 `role="tabpanel" id={tabPanelId(prefix)} aria-labelledby={tabId(prefix, value)}`로 둔다.
 */
export function Tabs<T extends string>({ label, items, value, onChange, idPrefix, className }: TabsProps<T>) {
  const refs = useRef(new Map<T, HTMLButtonElement>());

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % items.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = items.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = items[nextIndex];
    if (!next) return;
    onChange(next.value);
    refs.current.get(next.value)?.focus();
  };

  return (
    <div role="tablist" aria-label={label} className={cn('flex border-b border-border', className)}>
      {items.map((item, index) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            ref={(element) => {
              if (element) refs.current.set(item.value, element);
              else refs.current.delete(item.value);
            }}
            type="button"
            role="tab"
            id={tabId(idPrefix, item.value)}
            aria-selected={selected}
            aria-controls={tabPanelId(idPrefix)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={(event) => move(event, index)}
            className={cn(
              'relative -mb-px inline-flex min-h-touch flex-1 items-center justify-center px-3 py-3 text-base leading-tight font-bold transition-colors duration-150 md:flex-none md:px-5',
              selected
                ? 'text-ink after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-ink'
                : 'text-muted hover:text-ink',
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
