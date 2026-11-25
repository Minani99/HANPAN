import type { DataMode, Meeting, MyParticipation, SessionUser } from '../data/types';
import { getMeetingPhase, type MeetingPhase } from './meetingPhase';

/**
 * 모임 상세 CTA 상태 (docs/UI_SPEC.md §4.2 상세 CTA 상태표).
 * 데스크톱 우측 패널과 모바일 하단 바가 같은 결과를 쓴다. '요청 중'·'실패'는 화면 상태(버튼 busy·오류 문구)로 표현한다.
 */
export type DetailCtaKind =
  | 'unconfigured'
  | 'host'
  | 'cancelled'
  | 'finished'
  | 'in_progress'
  | 'login'
  | 'confirmed'
  | 'pending'
  | 'waitlisted'
  | 'rejected'
  | 'account_blocked'
  | 'onboarding'
  | 'closed'
  | 'full'
  | 'waitlist'
  | 'apply';

export interface DetailCta {
  kind: DetailCtaKind;
  phase: MeetingPhase;
  /** 주 버튼 또는 상태 표시 문구 */
  label: string;
  /**
   * button: 누를 수 있는 Primary(action 참고) / status: 버튼이 아닌 현재 상태 표시 / disabled: 비활성 버튼 + 사유
   */
  display: 'button' | 'status' | 'disabled';
  action: 'login' | 'onboarding' | 'apply' | 'manage' | null;
  /** 안내 문구(사유·설명). 비활성 버튼의 aria-describedby로도 쓴다 */
  note: string | null;
  /** 보조 '신청 취소' */
  canCancel: boolean;
  /** 보조 '모임 수정'(모임장, 시작 전·취소 전) */
  canEdit: boolean;
}

export interface DetailCtaInput {
  mode: DataMode;
  meeting: Meeting;
  participation: MyParticipation | null;
  user: SessionUser | null;
  now: Date;
}

const HOST_NOTE: Record<MeetingPhase, string> = {
  open: '내가 연 모임이에요.',
  full: '내가 연 모임이에요. 정원이 모두 찼어요.',
  closed: '내가 연 모임이에요. 모집을 마감했어요.',
  in_progress: '내가 연 모임이에요. 지금 진행 중이에요.',
  finished: '내가 연 모임이에요. 종료된 모임이에요.',
  cancelled: '내가 연 모임이에요. 취소된 모임이에요.',
};

function make(
  kind: DetailCtaKind,
  phase: MeetingPhase,
  label: string,
  display: DetailCta['display'],
  options: Partial<Pick<DetailCta, 'action' | 'note' | 'canCancel' | 'canEdit'>> = {},
): DetailCta {
  return {
    kind,
    phase,
    label,
    display,
    action: options.action ?? null,
    note: options.note ?? null,
    canCancel: options.canCancel ?? false,
    canEdit: options.canEdit ?? false,
  };
}

/** 모집이 닫혀 신청 자체가 불가능한 상태(로그인·최초 설정을 권하지 않는다) */
function closedCta(phase: MeetingPhase, meeting: Meeting): DetailCta | null {
  if (phase === 'closed') return make('closed', phase, '모집 마감', 'disabled', { note: '모임장이 모집을 마감했어요.' });
  // 모임장 계정이 삭제된 모임: 서버가 신청을 받지 않는다(MEETING_NOT_OPEN / host_missing)
  if (meeting.hostId === null && (phase === 'open' || phase === 'full')) {
    return make('closed', phase, '모집 마감', 'disabled', { note: '모임장이 탈퇴해 신청을 받지 않아요.' });
  }
  if (phase === 'full' && !meeting.allowWaitlist) {
    return make('full', phase, '모집 마감', 'disabled', { note: '자리가 모두 찼어요.' });
  }
  return null;
}

export function getDetailCta({ mode, meeting, participation, user, now }: DetailCtaInput): DetailCta {
  const phase = getMeetingPhase(meeting, now);

  if (mode === 'unconfigured') {
    return make('unconfigured', phase, '서비스 준비 중', 'disabled', {
      note: '서비스 연결 설정이 아직 완료되지 않았어요.',
    });
  }

  if (user && meeting.hostId === user.id) {
    return make('host', phase, '참가자 관리', 'button', {
      action: 'manage',
      note: HOST_NOTE[phase],
      canEdit: phase === 'open' || phase === 'full' || phase === 'closed',
    });
  }

  if (phase === 'cancelled') {
    return make('cancelled', phase, '취소된 모임', 'disabled', {
      note: meeting.cancelReason ? `취소 사유: ${meeting.cancelReason}` : '모임장이 모임을 취소했어요.',
    });
  }
  const status = participation?.role === 'guest' ? participation.status : null;
  if (phase === 'finished') {
    return make('finished', phase, '종료된 모임', 'disabled', {
      note: status === 'confirmed' ? '참가가 확정됐던 모임이에요.' : null,
    });
  }
  if (phase === 'in_progress') {
    return make('in_progress', phase, '진행 중인 모임', 'disabled', {
      note: status === 'confirmed' ? '참가가 확정된 모임이에요.' : null,
    });
  }

  if (!user) {
    return closedCta(phase, meeting) ?? make('login', phase, '로그인하고 신청하기', 'button', { action: 'login' });
  }

  if (user.status === 'deletion_requested') {
    return make('account_blocked', phase, '신청할 수 없는 계정이에요', 'disabled', {
      note: '탈퇴 요청된 계정은 참가 신청을 할 수 없어요.',
    });
  }

  if (status === 'confirmed') {
    return make('confirmed', phase, '참가 확정', 'status', { note: '시작 전까지 취소할 수 있어요.', canCancel: true });
  }
  if (status === 'pending') {
    return make('pending', phase, '승인 대기 중', 'status', {
      note: '모임장이 확인하면 확정돼요. 결과는 내 모임에서 확인할 수 있어요.',
      canCancel: true,
    });
  }
  if (status === 'waitlisted') {
    return make('waitlisted', phase, '대기 중', 'status', {
      note: '자리가 나면 모임장이 확인 후 확정해요. 자동으로 확정되지 않아요.',
      canCancel: true,
    });
  }
  if (status === 'rejected') {
    return make('rejected', phase, '신청할 수 없어요', 'disabled', { note: '이 모임은 참가가 확정되지 않았어요.' });
  }

  if (user.status === 'restricted') {
    return make('account_blocked', phase, '신청할 수 없는 계정이에요', 'disabled', {
      note: '이용이 제한된 계정은 참가 신청을 할 수 없어요.',
    });
  }

  const closed = closedCta(phase, meeting);
  if (closed) return closed;

  if (!user.onboarded) {
    return make('onboarding', phase, '닉네임 설정하고 신청하기', 'button', {
      action: 'onboarding',
      note: '처음 한 번 닉네임 설정과 약관 동의가 필요해요.',
    });
  }

  if (phase === 'full') {
    return make('waitlist', phase, '대기 신청하기', 'button', {
      action: 'apply',
      note: '지금은 자리가 다 찼어요. 자리가 나면 모임장이 확인 후 확정해요.',
    });
  }

  return meeting.approvalMode === 'manual'
    ? make('apply', phase, '참가 신청하기 (승인제)', 'button', { action: 'apply', note: '모임장이 확인한 뒤 확정돼요.' })
    : make('apply', phase, '참가 신청하기', 'button', { action: 'apply', note: '신청하면 바로 참가가 확정돼요.' });
}
