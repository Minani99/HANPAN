import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataAdapterError } from '../../data/adapter';
import { getUnexpectedErrorDescription } from '../../domain/errorMessages';
import { AppErrorBoundary } from './AppErrorBoundary';

function Boom({ error }: { error: unknown }): never {
  throw error;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AppErrorBoundary', () => {
  it('데이터 계층 오류는 코드별 문구로, 원본 메시지는 화면에 쓰지 않는다', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <AppErrorBoundary>
        <Boom error={new DataAdapterError('NETWORK_ERROR', { message: 'secret-token-123 fetch failed' })} />
      </AppErrorBoundary>,
    );
    expect(screen.getByRole('heading', { level: 1, name: '화면을 표시하지 못했어요.' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('연결이 불안정해요. 잠시 후 다시 시도해 주세요.');
    expect(document.body).not.toHaveTextContent('secret-token-123');
    expect(screen.getByRole('button', { name: '새로고침' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '홈으로 가기' })).toHaveAttribute('href', '/');
  });

  it('그 밖의 오류는 일반 안내', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <AppErrorBoundary>
        <Boom error={new TypeError('Cannot read properties of undefined (reading "x")')} />
      </AppErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('잠시 후 다시 시도해 주세요.');
    expect(document.body).not.toHaveTextContent('Cannot read properties');
  });

  it('getUnexpectedErrorDescription: SERVICE_UNCONFIGURED·UNKNOWN 구분', () => {
    expect(getUnexpectedErrorDescription(new DataAdapterError('SERVICE_UNCONFIGURED'))).toBe(
      '서비스 연결 설정이 아직 완료되지 않았어요.',
    );
    expect(getUnexpectedErrorDescription(new DataAdapterError('UNKNOWN'))).toContain('새로고침');
  });
});
