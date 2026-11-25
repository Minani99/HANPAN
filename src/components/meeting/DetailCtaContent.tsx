import { useId, type Ref } from 'react';
import { ONBOARDING_PATH } from '../../auth/RequireAuth';
import type { DetailCta } from '../../domain/detailCta';
import { Button, ButtonLink } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { meetingEditPath, meetingParticipantsPath } from './meetingText';

export interface DetailCtaContentProps {
  cta: DetailCta;
  meetingId: string;
  onApply: () => void;
  onCancelApplication: () => void;
  /** 로그인·최초 설정으로 가기 전에 returnTo를 저장한다 */
  onBeforeAuthNavigate: () => void;
  /** 상태가 바뀐 뒤 포커스를 옮길 컨테이너 */
  focusRef?: Ref<HTMLDivElement>;
}

const PRIMARY_LAYOUT = 'min-w-0 flex-1 md:w-full md:flex-none';
const SECONDARY_LAYOUT = 'shrink-0 md:w-full';

/**
 * 상세 CTA 내용: 안내 문구 한 줄 + Primary(또는 상태 표시) + 보조 버튼.
 * 모바일 하단 바에서는 가로(Primary 넓게), 데스크톱 패널에서는 세로로 쌓는다.
 */
export function DetailCtaContent({
  cta,
  meetingId,
  onApply,
  onCancelApplication,
  onBeforeAuthNavigate,
  focusRef,
}: DetailCtaContentProps) {
  const noteId = useId();
  const describedBy = cta.note ? noteId : undefined;

  let primary;
  if (cta.display === 'status') {
    primary = (
      <p
        className={`${PRIMARY_LAYOUT} flex min-h-cta items-center justify-center gap-2 rounded-lg border border-border bg-soft px-4 text-center text-base leading-tight font-bold text-ink`}
        data-testid="cta-status"
      >
        <Icon name={cta.kind === 'confirmed' ? 'check-circle' : 'clock'} size="1.15em" />
        {cta.label}
      </p>
    );
  } else if (cta.display === 'disabled') {
    primary = (
      <Button disabled focusableWhenDisabled aria-describedby={describedBy} className={PRIMARY_LAYOUT}>
        {cta.label}
      </Button>
    );
  } else if (cta.action === 'login') {
    primary = (
      <ButtonLink to="/login" onClick={onBeforeAuthNavigate} className={PRIMARY_LAYOUT}>
        {cta.label}
      </ButtonLink>
    );
  } else if (cta.action === 'onboarding') {
    primary = (
      <ButtonLink to={ONBOARDING_PATH} onClick={onBeforeAuthNavigate} className={PRIMARY_LAYOUT}>
        {cta.label}
      </ButtonLink>
    );
  } else if (cta.action === 'manage') {
    primary = (
      <ButtonLink to={meetingParticipantsPath(meetingId)} className={PRIMARY_LAYOUT}>
        {cta.label}
      </ButtonLink>
    );
  } else {
    primary = (
      <Button onClick={onApply} aria-describedby={describedBy} className={PRIMARY_LAYOUT} aria-haspopup="dialog">
        {cta.label}
      </Button>
    );
  }

  return (
    <div
      ref={focusRef}
      tabIndex={-1}
      className="focus-visible:outline-none"
      data-testid="detail-cta-content"
      data-kind={cta.kind}
    >
      {cta.note ? (
        <p id={noteId} className="mb-2.5 text-sm leading-snug text-text text-wrap-ko md:mb-4">
          {cta.note}
        </p>
      ) : null}
      <div className="flex items-stretch gap-2 md:flex-col">
        {primary}
        {cta.canCancel ? (
          <Button variant="secondary" onClick={onCancelApplication} className={SECONDARY_LAYOUT} aria-haspopup="dialog">
            신청 취소
          </Button>
        ) : null}
        {cta.canEdit ? (
          <ButtonLink to={meetingEditPath(meetingId)} variant="secondary" className={SECONDARY_LAYOUT}>
            모임 수정
          </ButtonLink>
        ) : null}
      </div>
    </div>
  );
}
