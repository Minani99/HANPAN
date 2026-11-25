import type { ApprovalMode, Meeting } from '../../data/types';
import { DELETED_USER_NICKNAME } from '../../domain/limits';
import { getRegionName } from '../../domain/regions';

export const UNDECIDED_VENUE = '장소 미정';

/** 상세·신청 화면의 승인 방식 설명 */
export const APPROVAL_DESCRIPTION: Readonly<Record<ApprovalMode, string>> = {
  auto: '신청 즉시 확정',
  manual: '모임장 확인 후 확정',
};

/** 모임장 표시 이름. 탈퇴 등으로 비어 있으면 '탈퇴한 사용자' */
export function hostDisplayName(meeting: Pick<Meeting, 'hostNickname'>): string {
  return meeting.hostNickname?.trim() || DELETED_USER_NICKNAME;
}

/** '둔산·탄방 · 보드게임 카페 A' / '둔산·탄방 · 장소 미정' */
export function placeLabel(meeting: Pick<Meeting, 'regionCode' | 'venueName'>): string {
  return `${getRegionName(meeting.regionCode)} · ${meeting.venueName ?? UNDECIDED_VENUE}`;
}

export function meetingParticipantsPath(id: string): string {
  return `/meetings/${encodeURIComponent(id)}/participants`;
}

export function meetingEditPath(id: string): string {
  return `/meetings/${encodeURIComponent(id)}/edit`;
}
