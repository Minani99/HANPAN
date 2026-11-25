import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';

export type AsyncStatus = 'loading' | 'error' | 'success';

export interface AsyncData<T> {
  status: AsyncStatus;
  data: T | undefined;
  error: unknown;
  /** 로딩 상태로 바꾸고 처음부터 다시 요청한다(오류 후 '다시 시도'). */
  retry: () => void;
  /**
   * 화면을 그대로 둔 채 다시 불러와 반영한다(쓰기 요청 성공 후 등).
   * 실패하면 이전 데이터를 유지하고 reject 한다. 그사이 키가 바뀌었으면 결과를 버린다.
   */
  refresh: () => Promise<T>;
}

type Loaded<T> = { key: string; status: 'success'; data: T } | { key: string; status: 'error'; error: unknown };

/**
 * 키 단위 비동기 조회. key가 바뀌면 이전 응답을 버리고(경쟁 상태 방지) 다시 요청한다.
 * 키에는 조회 대상 id와 사용자 키(useAuth().userKey)를 함께 넣어, 로그인 사용자가 바뀌면 다시 불러오게 한다.
 * key가 null이면 요청하지 않고 loading 상태를 유지한다.
 * 로딩 여부는 '현재 요청 키와 마지막 응답 키가 다른가'로 계산해 effect 안에서 동기 setState를 하지 않는다.
 * 키가 바뀌는 즉시 이전 키의 응답을 메모리에서도 지운다 — 로그아웃·계정 전환 후 같은 키로 돌아와도
 * 이전 사용자의 응답을 다시 보여주지 않는다.
 */
export function useAsyncData<T>(key: string | null, load: () => Promise<T>): AsyncData<T> {
  const [attempt, setAttempt] = useState(0);
  const requestKey = key === null ? null : `${key}#${attempt}`;
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null);
  // 렌더 중 상태 보정: 이전 키의 응답은 보관하지 않는다(다음 렌더 전에 즉시 반영된다).
  if (loaded !== null && loaded.key !== requestKey) setLoaded(null);
  const latestKey = useRef(requestKey);

  const runLoad = useEffectEvent(() => load());

  useEffect(() => {
    latestKey.current = requestKey;
    if (requestKey === null) return undefined;
    let active = true;
    runLoad().then(
      (data) => {
        if (active) setLoaded({ key: requestKey, status: 'success', data });
      },
      (error: unknown) => {
        if (active) setLoaded({ key: requestKey, status: 'error', error });
      },
    );
    return () => {
      active = false;
    };
  }, [requestKey]);

  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  const refresh = useCallback(async () => {
    const keyAtStart = latestKey.current;
    const data = await loadRef.current();
    if (keyAtStart !== null && latestKey.current === keyAtStart) {
      setLoaded({ key: keyAtStart, status: 'success', data });
    }
    return data;
  }, []);

  const current = loaded && loaded.key === requestKey ? loaded : null;
  return {
    status: current ? current.status : 'loading',
    data: current?.status === 'success' ? current.data : undefined,
    error: current?.status === 'error' ? current.error : null,
    retry,
    refresh,
  };
}
