import { getMeetingPhase } from '../../domain/meetingPhase';
import { getRegionName } from '../../domain/regions';
import { kstDayRange, isValidDateKey } from '../../lib/date';
import { normalizeQuery } from '../../lib/filters';
import { normalizePageRequest } from '../adapter';
import type { Meeting, MeetingFilters, PageRequest, PageResult } from '../types';
import type { MockMeetingRecord, MockVenueRecord } from './records';

export interface PublicMeetingOptions {
  /** 모임장·관리자가 볼 때 숨김 여부와 사유를 채운다(RLS로 숨김 모임을 읽을 수 있는 사람) */
  includeHidden?: boolean;
  /** 공간 테이블. 있으면 공간 이름을 여기서 읽는다(비공개 공간은 관리자만 이름이 보인다 — DB RLS와 같다) */
  venues?: readonly MockVenueRecord[];
  /** 보는 사람이 관리자인지(비공개 공간 이름 노출 여부) */
  viewerIsAdmin?: boolean;
}

/**
 * 공간 이름: 공간 테이블에 있으면 공개 공간(또는 관리자)일 때만 이름, 아니면 null.
 * 공간 테이블에 없는 id(테스트가 직접 만든 모임)는 레코드의 venueName을 그대로 쓴다.
 */
function resolveVenueName(record: MockMeetingRecord, options: PublicMeetingOptions): string | null {
  if (!record.venueId || !options.venues) return record.venueName;
  const venue = options.venues.find((item) => item.id === record.venueId);
  if (!venue) return record.venueName;
  return venue.isPublic || options.viewerIsAdmin ? venue.name : null;
}

/**
 * 공개 응답에서 mock 전용 필드를 제거하고 복사본을 만든다(호출자가 원본을 바꾸지 못하게).
 */
export function toPublicMeeting(record: MockMeetingRecord, options: PublicMeetingOptions = {}): Meeting {
  const { hidden, hiddenReason, cancelledAt: _cancelledAt, ...meeting } = record;
  const result: Meeting = { ...meeting, venueName: resolveVenueName(record, options) };
  if (options.includeHidden && hidden) {
    result.isHidden = true;
    result.hiddenReason = hiddenReason ?? null;
  }
  return result;
}

function matchesQuery(meeting: Meeting, q: string): boolean {
  const needle = q.toLocaleLowerCase('ko-KR');
  const haystack = [
    meeting.title,
    meeting.gameName,
    meeting.venueName,
    meeting.venueNote,
    getRegionName(meeting.regionCode),
  ];
  return haystack.some((value) => value != null && value.toLocaleLowerCase('ko-KR').includes(needle));
}

/**
 * 탐색 목록 규칙 (Supabase 구현도 같은 규칙을 따라야 한다)
 * 1) 숨김·취소·이미 시작한(startAt <= now) 모임 제외
 * 2) date: KST 하루 범위, category/region/venueId: 일치, q: 제목·게임명·장소명·장소 메모·권역명 부분 일치(대소문자 무시)
 * 3) recruiting: phase가 open인 모임만
 * 4) 정렬 soonest(startAt ↑), newest(createdAt ↓), 동률이면 id
 */
export function queryMeetings(
  records: readonly MockMeetingRecord[],
  filters: MeetingFilters,
  page: PageRequest,
  now: Date,
  options: Pick<PublicMeetingOptions, 'venues' | 'viewerIsAdmin'> = {},
): PageResult<Meeting> {
  const nowMs = now.getTime();
  const range = filters.date && isValidDateKey(filters.date) ? kstDayRange(filters.date) : null;
  const rangeStart = range ? Date.parse(range.startIso) : null;
  const rangeEnd = range ? Date.parse(range.endIso) : null;
  const q = normalizeQuery(filters.q);

  const filtered = records
    .map((record) => ({ record, view: toPublicMeeting(record, options) }))
    .filter(({ record, view }) => {
      if (record.hidden) return false;
      if (record.status === 'cancelled') return false;
      const startMs = Date.parse(record.startAt);
      if (!(startMs > nowMs)) return false;
      if (rangeStart !== null && rangeEnd !== null && (startMs < rangeStart || startMs >= rangeEnd)) return false;
      if (filters.category && record.categoryId !== filters.category) return false;
      if (filters.region && record.regionCode !== filters.region) return false;
      if (filters.venueId && record.venueId !== filters.venueId) return false;
      if (filters.recruiting && getMeetingPhase(record, now) !== 'open') return false;
      if (q && !matchesQuery(view, q)) return false;
      return true;
    });

  const sorted = [...filtered].sort(({ record: a }, { record: b }) => {
    const diff =
      filters.sort === 'newest'
        ? Date.parse(b.createdAt) - Date.parse(a.createdAt)
        : Date.parse(a.startAt) - Date.parse(b.startAt);
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });

  const { limit, offset } = normalizePageRequest(page);
  return {
    items: sorted.slice(offset, offset + limit).map(({ view }) => view),
    total: sorted.length,
  };
}
