import { useState } from 'react';
import type { Meeting } from '../../data/types';
import { getErrorMessage } from '../../domain/errorMessages';
import { MEETING_LIMITS, charLength } from '../../domain/limits';
import { HOLDEM_CATEGORY_ID } from '../../domain/meetingSchema';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { ErrorText } from '../ui/Notice';
import { Textarea } from '../ui/Textarea';
import { HoldemNotice } from './HoldemNotice';
import { MeetingInfoList } from './MeetingInfoList';

export interface ApplyDialogProps {
  open: boolean;
  meeting: Meeting;
  /** 자리가 없어 대기 신청인지 */
  waitlist: boolean;
  onClose: () => void;
  /** 신청 요청. 실패하면 throw — 대화상자가 오류를 보여주고 다시 시도할 수 있게 한다 */
  onSubmit: (message: string | null) => Promise<void>;
}

function approvalText(meeting: Meeting, waitlist: boolean): string {
  if (waitlist) {
    return '지금은 자리가 다 찼어요. 대기 신청을 하면 자리가 났을 때 모임장이 확인 후 확정해요. 자동으로 확정되지 않아요.';
  }
  return meeting.approvalMode === 'auto'
    ? '신청하면 바로 참가가 확정돼요. 시작 전까지 취소할 수 있어요.'
    : '모임장이 확인한 뒤 확정돼요. 결과는 내 모임에서 확인할 수 있어요.';
}

export function ApplyDialog(props: ApplyDialogProps) {
  if (!props.open) return null;
  return <ApplyDialogBody {...props} />;
}

function ApplyDialogBody({ open, meeting, waitlist, onClose, onSubmit }: ApplyDialogProps) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tooLong = charLength(message.trim()) > MEETING_LIMITS.applyMessageMax;

  const submit = async () => {
    if (tooLong) return;
    setError(null);
    setBusy(true);
    try {
      await onSubmit(message.trim() || null);
    } catch (caught) {
      // 실패: 대화상자를 그대로 두고(입력 유지) 오류를 알린다. 버튼은 다시 누를 수 있다.
      setError(getErrorMessage(caught));
      setBusy(false);
    }
  };

  const submitLabel = waitlist ? '대기 신청하기' : '신청하기';

  return (
    <Dialog
      open={open}
      onClose={busy ? () => {} : onClose}
      title={waitlist ? '대기 신청' : '참가 신청'}
      description={approvalText(meeting, waitlist)}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            닫기
          </Button>
          <Button onClick={submit} loading={busy} loadingLabel="신청을 보내는 중" disabled={tooLong} data-testid="apply-submit">
            {busy ? '신청 중…' : submitLabel}
          </Button>
        </>
      }
    >
      <p className="text-lg leading-snug font-bold text-ink text-wrap-ko">{meeting.title}</p>
      <MeetingInfoList meeting={meeting} compact className="mt-2 border-y border-border" />
      {meeting.categoryId === HOLDEM_CATEGORY_ID ? <HoldemNotice className="mt-4" /> : null}
      <Textarea
        label="모임장에게 남길 말 (선택)"
        containerClassName="mt-5"
        rows={3}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        maxLength={MEETING_LIMITS.applyMessageMax}
        placeholder="예: 처음인데 룰 설명 부탁드려요."
        hint={`${charLength(message)}/${MEETING_LIMITS.applyMessageMax}자 · 모임장에게만 보여요. 연락처는 적지 마세요.`}
        error={tooLong ? `${MEETING_LIMITS.applyMessageMax}자까지 쓸 수 있어요.` : undefined}
        disabled={busy}
      />
      <ErrorText message={error} className="mt-4" />
    </Dialog>
  );
}
