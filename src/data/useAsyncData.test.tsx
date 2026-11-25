import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useAsyncData } from './useAsyncData';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** 키별 요청을 수동으로 끝낼 수 있는 로더 */
function controlledLoader() {
  const pending = new Map<string, Deferred<string>[]>();
  const load = (key: string) => () => {
    const d = deferred<string>();
    pending.set(key, [...(pending.get(key) ?? []), d]);
    return d.promise;
  };
  const resolveLatest = async (key: string, value: string) => {
    const list = pending.get(key) ?? [];
    const latest = list[list.length - 1];
    if (!latest) throw new Error(`대기 중인 요청이 없습니다: ${key}`);
    await act(async () => {
      latest.resolve(value);
      await latest.promise;
    });
  };
  const resolveFirst = async (key: string, value: string) => {
    const first = pending.get(key)?.[0];
    if (!first) throw new Error(`대기 중인 요청이 없습니다: ${key}`);
    await act(async () => {
      first.resolve(value);
      await first.promise;
    });
  };
  return { load, resolveLatest, resolveFirst, count: (key: string) => pending.get(key)?.length ?? 0 };
}

describe('useAsyncData 사용자 전환', () => {
  it('키(사용자)가 바뀌면 이전 데이터를 즉시 버리고 loading → 새 키로 다시 불러온다', async () => {
    const loader = controlledLoader();
    const { result, rerender } = renderHook(({ k }: { k: string }) => useAsyncData(k, loader.load(k)), {
      initialProps: { k: 'profile:user:A' },
    });
    await loader.resolveLatest('profile:user:A', 'A의 프로필');
    expect(result.current).toMatchObject({ status: 'success', data: 'A의 프로필' });

    rerender({ k: 'profile:anon' });
    expect(result.current).toMatchObject({ status: 'loading', data: undefined });
    await loader.resolveLatest('profile:anon', '비로그인');
    expect(result.current).toMatchObject({ status: 'success', data: '비로그인' });
  });

  it('A → B → A로 빠르게 바뀌어도 A의 옛 응답을 다시 보여주지 않고 새로 불러온다', async () => {
    const loader = controlledLoader();
    const { result, rerender } = renderHook(({ k }: { k: string }) => useAsyncData(k, loader.load(k)), {
      initialProps: { k: 'my:user:A' },
    });
    await loader.resolveLatest('my:user:A', 'A 데이터(옛)');
    rerender({ k: 'my:user:B' });
    rerender({ k: 'my:user:A' });
    expect(result.current).toMatchObject({ status: 'loading', data: undefined });
    expect(loader.count('my:user:A')).toBe(2);
    await loader.resolveLatest('my:user:A', 'A 데이터(새)');
    expect(result.current.data).toBe('A 데이터(새)');
  });

  it('늦게 도착한 이전 키의 응답은 버린다(경쟁 상태)', async () => {
    const loader = controlledLoader();
    const { result, rerender } = renderHook(({ k }: { k: string }) => useAsyncData(k, loader.load(k)), {
      initialProps: { k: 'detail:1:user:A' },
    });
    rerender({ k: 'detail:1:user:B' });
    await loader.resolveFirst('detail:1:user:A', 'A가 볼 데이터');
    expect(result.current).toMatchObject({ status: 'loading', data: undefined });
    await loader.resolveLatest('detail:1:user:B', 'B가 볼 데이터');
    expect(result.current.data).toBe('B가 볼 데이터');
  });

  it('refresh 도중 키가 바뀌면 refresh 결과를 반영하지 않는다', async () => {
    const loader = controlledLoader();
    const { result, rerender } = renderHook(({ k }: { k: string }) => useAsyncData(k, loader.load(k)), {
      initialProps: { k: 'p:user:A' },
    });
    await loader.resolveLatest('p:user:A', 'A1');
    let refreshed: Promise<string> | undefined;
    act(() => {
      refreshed = result.current.refresh();
    });
    rerender({ k: 'p:user:B' });
    await loader.resolveLatest('p:user:A', 'A2(refresh)');
    await refreshed;
    expect(result.current).toMatchObject({ status: 'loading', data: undefined });
    await loader.resolveLatest('p:user:B', 'B1');
    await waitFor(() => expect(result.current.data).toBe('B1'));
  });
});
