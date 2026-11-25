import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { createMemoryRouter, type RouteObject } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { AuthProvider } from '../auth/AuthProvider';
import { ToastProvider } from '../components/ui/Toast';
import { DataAdapterProvider, type DataAdapter } from '../data';
import { createMockAdapter } from '../data/mock/adapter';

export interface RenderRoutesOptions {
  initialEntries?: string[];
  adapter?: DataAdapter;
}

/** 메모리 라우터 + 데이터 어댑터 + 토스트 + 인증 상태로 감싸 렌더한다. */
export function renderRoutes(routes: RouteObject[], { initialEntries = ['/'], adapter }: RenderRoutesOptions = {}) {
  const dataAdapter = adapter ?? createMockAdapter({ delayMs: 0 });
  const router = createMemoryRouter(routes, { initialEntries });
  const result = render(
    <DataAdapterProvider adapter={dataAdapter}>
      <ToastProvider>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </ToastProvider>
    </DataAdapterProvider>,
  );
  return { ...result, router, adapter: dataAdapter };
}

/** 라우터 없이 단일 요소를 렌더할 때(링크가 있으면 라우터가 필요하므로 같이 감싼다). */
export function renderInRouter(element: ReactElement, path = '/') {
  return renderRoutes([{ path: '*', element }], { initialEntries: [path] });
}
