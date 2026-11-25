import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cn } from '../../lib/cn';
import { Icon } from './Icon';

export type ToastTone = 'default' | 'success' | 'error';

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

export interface ToastOptions {
  tone?: ToastTone;
  /** 표시 시간(ms). 기본 2400 */
  duration?: number;
}

interface ToastContextValue {
  show: (message: string, options?: ToastOptions) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);
ToastContext.displayName = 'ToastContext';

const TONE_LABEL: Record<ToastTone, string | null> = {
  default: null,
  success: '완료',
  error: '오류',
};

export function ToastProvider({ children, defaultDuration = 2400 }: { children?: ReactNode; defaultDuration?: number }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((items) => items.filter((item) => item.id !== id));
  }, []);

  const show = useCallback(
    (message: string, options: ToastOptions = {}) => {
      const id = nextId.current;
      nextId.current += 1;
      // 동시에 너무 많이 쌓이지 않도록 최근 3개만 유지한다.
      setToasts((items) => [...items.slice(-2), { id, message, tone: options.tone ?? 'default' }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), options.duration ?? defaultDuration),
      );
    },
    [defaultDuration, dismiss],
  );

  useEffect(() => {
    const activeTimers = timers.current;
    return () => {
      activeTimers.forEach((timer) => clearTimeout(timer));
      activeTimers.clear();
    };
  }, []);

  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* 라이브 영역은 항상 DOM에 있어야 새 메시지가 읽힌다. 모바일에서는 하단 내비 위에 뜬다. */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--bottom-nav-offset)+0.75rem)] z-60 flex flex-col items-center gap-2 px-4 md:bottom-8.5"
      >
        {toasts.map((toast) => {
          const toneLabel = TONE_LABEL[toast.tone];
          return (
            <div
              key={toast.id}
              className={cn(
                'pointer-events-auto flex max-w-[min(90vw,28rem)] items-start gap-2 rounded-lg bg-ink px-4.75 py-3.25 text-sm leading-normal font-bold text-white',
              )}
            >
              {toast.tone === 'success' ? <Icon name="check-circle" size="1.15em" className="mt-[0.1em]" /> : null}
              {toast.tone === 'error' ? <Icon name="alert-circle" size="1.15em" className="mt-[0.1em]" /> : null}
              <span>
                {toneLabel ? <span className="sr-only">{toneLabel}: </span> : null}
                {toast.message}
              </span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast는 ToastProvider 안에서만 사용할 수 있습니다.');
  return context;
}
