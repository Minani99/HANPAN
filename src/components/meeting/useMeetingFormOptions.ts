import { useDataAdapter } from '../../data';
import type { Venue } from '../../data/types';
import { useAsyncData } from '../../data/useAsyncData';

export interface MeetingFormOptions {
  /** 공개 공간(listVenues). 불러오지 못하면 빈 목록 + venuesUnavailable */
  venues: Venue[];
  venuesUnavailable: boolean;
  /** 활성 카테고리 id(listCategories). 불러오지 못하면 null(= 전체 허용, 서버가 다시 검사) */
  activeCategoryIds: ReadonlySet<string> | null;
}

/**
 * 모임 만들기·수정 폼의 선택지(공개 공간·활성 카테고리). 실패해도 폼은 쓸 수 있게 한다(서버가 최종 검사).
 * 공개 데이터라 사용자 키를 넣지 않는다.
 */
export function useMeetingFormOptions() {
  const adapter = useDataAdapter();
  return useAsyncData<MeetingFormOptions>('meeting-form-options', async () => {
    const [venues, categories] = await Promise.all([
      adapter.listVenues({}).then(
        (items) => ({ items, failed: false }),
        () => ({ items: [] as Venue[], failed: true }),
      ),
      adapter.listCategories().then(
        (items) => new Set<string>(items.map((category) => category.id)),
        () => null,
      ),
    ]);
    return { venues: venues.items, venuesUnavailable: venues.failed, activeCategoryIds: categories };
  });
}
