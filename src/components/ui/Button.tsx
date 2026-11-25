import {
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { Link, type LinkProps } from 'react-router';
import { cn } from '../../lib/cn';
import { Spinner } from './Spinner';
import { VisuallyHidden } from './VisuallyHidden';

/** danger: 위험 동작 — 보조 버튼 모양 + 위험 글자색(빨간 배경을 쓰지 않는다, UI_SPEC §3.1) */
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'text';
/** lg 52px(CTA) / md 48px / sm 44px */
export type ButtonSize = 'lg' | 'md' | 'sm';

type ButtonState = 'idle' | 'disabled' | 'busy';

const SIZE_CLASS: Record<ButtonSize, string> = {
  lg: 'min-h-cta px-5.5 text-base',
  md: 'min-h-control px-4.5 text-md',
  sm: 'min-h-control-sm px-4 text-md',
};

const VARIANT_CLASS: Record<ButtonVariant, Record<ButtonState, string>> = {
  primary: {
    idle: 'border border-ink bg-ink text-white hover:border-ink-hover hover:bg-ink-hover',
    busy: 'border border-ink bg-ink text-white opacity-85 cursor-progress',
    disabled: 'border border-disabled-bg bg-disabled-bg text-disabled-text cursor-not-allowed',
  },
  secondary: {
    idle: 'border border-border bg-surface text-ink hover:bg-soft',
    busy: 'border border-border bg-surface text-ink opacity-85 cursor-progress',
    disabled: 'border border-disabled-bg bg-disabled-bg text-disabled-text cursor-not-allowed',
  },
  danger: {
    idle: 'border border-border bg-surface text-danger hover:bg-danger-soft',
    busy: 'border border-border bg-surface text-danger opacity-85 cursor-progress',
    disabled: 'border border-disabled-bg bg-disabled-bg text-disabled-text cursor-not-allowed',
  },
  text: {
    idle: 'border border-transparent bg-transparent text-ink underline-offset-4 hover:underline',
    busy: 'border border-transparent bg-transparent text-ink opacity-85 cursor-progress',
    disabled: 'border border-transparent bg-transparent text-disabled-text cursor-not-allowed',
  },
};

const DEFAULT_SIZE: Record<ButtonVariant, ButtonSize> = { primary: 'lg', secondary: 'md', danger: 'md', text: 'sm' };

export interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  state?: ButtonState;
}

/** 링크 등 다른 요소에 버튼 모양을 입힐 때 사용 */
export function buttonClassName({ variant = 'primary', size, fullWidth, state = 'idle' }: ButtonStyleOptions = {}) {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-lg text-center font-bold leading-tight text-wrap-ko transition-colors duration-150 select-none',
    variant === 'text' ? 'px-2' : null,
    SIZE_CLASS[size ?? DEFAULT_SIZE[variant]],
    VARIANT_CLASS[variant][state],
    fullWidth ? 'w-full' : null,
  );
}

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  /** 요청 중. 클릭을 막고 Spinner + aria-busy를 표시한다(포커스는 유지). */
  loading?: boolean;
  /** 로딩 중 스크린리더에 덧붙일 문구 */
  loadingLabel?: string;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  /**
   * true면 비활성일 때 네이티브 disabled 대신 aria-disabled를 써서 포커스를 유지한다.
   * 사유 문구를 aria-describedby로 연결할 때 사용한다(UI_SPEC §3.1 Disabled).
   */
  focusableWhenDisabled?: boolean;
  /**
   * Promise를 반환하면 완료될 때까지 자동으로 로딩 상태가 되어 중복 실행을 막는다.
   */
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void | Promise<unknown>;
  ref?: Ref<HTMLButtonElement>;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as PromiseLike<unknown>).then === 'function';
}

export function Button({
  variant = 'primary',
  size,
  fullWidth,
  loading = false,
  loadingLabel = '처리 중',
  leadingIcon,
  trailingIcon,
  disabled = false,
  focusableWhenDisabled = false,
  type = 'button',
  className,
  children,
  onClick,
  ref,
  ...rest
}: ButtonProps) {
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const busy = loading || pending;
  const state: ButtonState = disabled ? 'disabled' : busy ? 'busy' : 'idle';
  const nativeDisabled = disabled && !focusableWhenDisabled;

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (disabled || busy || pendingRef.current) {
      event.preventDefault();
      return;
    }
    const result = onClick?.(event);
    if (isPromiseLike(result)) {
      pendingRef.current = true;
      setPending(true);
      const settle = () => {
        pendingRef.current = false;
        setPending(false);
      };
      result.then(settle, settle);
    }
  };

  return (
    <button
      ref={ref}
      type={type}
      disabled={nativeDisabled}
      aria-disabled={(busy && !disabled) || (disabled && focusableWhenDisabled) ? true : undefined}
      aria-busy={busy ? true : undefined}
      className={cn(buttonClassName({ variant, size, fullWidth, state }), className)}
      onClick={handleClick}
      {...rest}
    >
      {busy ? <Spinner size="1.05em" /> : leadingIcon}
      {children}
      {busy ? <VisuallyHidden>{loadingLabel}</VisuallyHidden> : trailingIcon}
    </button>
  );
}

export interface ButtonLinkProps extends LinkProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

/** 페이지 이동은 버튼이 아니라 링크로. 모양만 버튼과 같다. */
export function ButtonLink({ variant = 'primary', size, fullWidth, className, ...rest }: ButtonLinkProps) {
  return <Link className={cn(buttonClassName({ variant, size, fullWidth }), className)} {...rest} />;
}
