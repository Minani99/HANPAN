import { Component, type ErrorInfo, type ReactNode } from 'react';
import { getUnexpectedErrorDescription } from '../../domain/errorMessages';
import { devError } from '../../lib/devConsole';

interface AppErrorBoundaryState {
  hasError: boolean;
  error: unknown;
}

/**
 * 앱 전역 오류 경계(라우터 바깥). 라우트 안의 오류는 RouteErrorPage가 먼저 잡고, 여기서는 그 밖
 * (인증·토스트 컨텍스트, 라우터 자체 등)에서 터진 오류를 친절한 화면으로 바꾼다.
 * - 라우터 바깥이라 Link 대신 일반 링크를 쓴다.
 * - 오류 상세(메시지·스택)는 화면에 쓰지 않고, 개발 모드 콘솔에만 남긴다.
 */
export class AppErrorBoundary extends Component<{ children?: ReactNode }, AppErrorBoundaryState> {
  override state: AppErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    devError('[HANPAN] app error', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <main className="mx-auto flex min-h-[70vh] w-full max-w-page items-center justify-center px-gutter-sm md:px-gutter">
        <div role="alert" className="max-w-xl text-center">
          <p className="font-brand text-md font-black tracking-tight text-muted">HANPAN.</p>
          <h1 className="mt-3 text-3xl leading-tight font-heavy tracking-section text-ink text-wrap-ko md:text-4xl">
            화면을 표시하지 못했어요.
          </h1>
          <p className="mt-3 text-base leading-relaxed text-muted text-wrap-ko">
            {getUnexpectedErrorDescription(this.state.error)}
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex min-h-cta items-center justify-center rounded-lg border border-ink bg-ink px-5.5 text-base font-bold text-white hover:bg-ink-hover"
            >
              새로고침
            </button>
            <a
              href="/"
              className="inline-flex min-h-control items-center justify-center rounded-lg border border-border bg-surface px-4.5 text-md font-bold text-ink hover:bg-soft"
            >
              홈으로 가기
            </a>
          </div>
        </div>
      </main>
    );
  }
}
