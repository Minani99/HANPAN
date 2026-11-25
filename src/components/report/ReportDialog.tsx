import { useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link } from 'react-router';
import { useDataAdapter } from '../../data';
import type { ReportReason, ReportTargetType } from '../../data/types';
import { charLength } from '../../domain/limits';
import {
  REPORT_LIMITS,
  REPORT_REASONS,
  REPORT_REASON_LABEL,
  getReportErrorMessage,
  validateReportForm,
  type ReportFormErrors,
} from '../../domain/reports';
import { Button } from '../ui/Button';
import { ChoiceGroup, type ChoiceOption } from '../ui/ChoiceGroup';
import { Dialog } from '../ui/Dialog';
import { ErrorText, Notice } from '../ui/Notice';
import { Textarea } from '../ui/Textarea';
import { useToast } from '../ui/Toast';

export interface ReportTarget {
  type: ReportTargetType;
  id: string;
  /** 선택지 문구(예: '이 모임', '모임장 예시모임장A') */
  label: string;
}

export interface ReportDialogProps {
  open: boolean;
  onClose: () => void;
  /** 신고 대상. 둘 이상이면 고르게 하고, 하나면 고정한다 */
  targets: readonly ReportTarget[];
  /** 접수 성공 후(토스트는 이 대화상자가 띄운다) */
  onSubmitted?: (reportId: string) => void;
}

export const REPORT_SUCCESS_MESSAGE = '신고가 접수됐어요';
export const REPORT_REVIEW_NOTICE = '신고는 운영자가 직접 검토해요. 신고만으로 자동 제재되지 않아요.';

const REASON_OPTIONS: readonly ChoiceOption<ReportReason>[] = REPORT_REASONS.map((reason) => ({
  value: reason,
  label: REPORT_REASON_LABEL[reason],
}));

/**
 * 신고 대화상자(submit_report). 사유(필수) + 상세 내용(기타면 필수, 1000자).
 * 접수가 실제로 성공했을 때만 '신고가 접수됐어요' 토스트를 띄운다. 실패하면 입력을 유지하고 오류를 보여준다.
 */
export function ReportDialog(props: ReportDialogProps) {
  if (!props.open || props.targets.length === 0) return null;
  return <ReportDialogBody {...props} />;
}

function ReportDialogBody({ open, onClose, targets, onSubmitted }: ReportDialogProps) {
  const adapter = useDataAdapter();
  const toast = useToast();
  const [targetKey, setTargetKey] = useState(() => keyOf(targets[0]!));
  const [reason, setReason] = useState<ReportReason | ''>('');
  const [body, setBody] = useState('');
  const [errors, setErrors] = useState<ReportFormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
  const noticeId = useId();

  const target = targets.find((item) => keyOf(item) === targetKey) ?? targets[0]!;
  const bodyRequired = reason === 'other';

  const submit = async () => {
    if (busy) return;
    setSubmitError(null);
    const result = validateReportForm({ reason, body });
    if (!result.ok) {
      flushSync(() => setErrors(result.errors));
      const field = result.errors.reason ? 'reason' : 'body';
      formRef.current?.querySelector<HTMLElement>(`[data-report-field="${field}"] input, [data-report-field="${field}"] textarea`)?.focus();
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const reportId = await adapter.submitReport({
        targetType: target.type,
        targetId: target.id,
        reason: result.reason,
        body: result.body,
      });
      toast.show(REPORT_SUCCESS_MESSAGE, { tone: 'success' });
      onSubmitted?.(reportId);
      onClose();
    } catch (error) {
      setSubmitError(getReportErrorMessage(error));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={busy ? () => {} : onClose}
      title="신고하기"
      description={<span id={noticeId}>{REPORT_REVIEW_NOTICE}</span>}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            닫기
          </Button>
          <Button onClick={submit} loading={busy} loadingLabel="신고를 보내는 중" data-testid="report-submit">
            {busy ? '보내는 중…' : '신고하기'}
          </Button>
        </>
      }
    >
      <div ref={formRef} className="space-y-5" data-testid="report-form">
        {targets.length > 1 ? (
          <ChoiceGroup
            legend="신고 대상"
            name="report-target"
            layout="list"
            options={targets.map((item) => ({ value: keyOf(item), label: item.label }))}
            value={targetKey}
            onChange={setTargetKey}
          />
        ) : (
          <p className="text-md text-text">
            신고 대상: <strong className="font-bold text-ink text-wrap-ko">{target.label}</strong>
          </p>
        )}
        <div data-report-field="reason">
          <ChoiceGroup
            legend="신고 사유"
            name="report-reason"
            layout="list"
            options={REASON_OPTIONS}
            value={reason}
            onChange={(value) => {
              setReason(value);
              setErrors((prev) => (prev.reason || prev.body ? {} : prev));
            }}
            error={errors.reason}
            required
          />
        </div>
        <div data-report-field="body">
          <Textarea
            label={bodyRequired ? '상세 내용 (필수)' : '상세 내용 (선택)'}
            rows={4}
            value={body}
            onChange={(event) => {
              setBody(event.target.value);
              if (errors.body) setErrors((prev) => ({ ...prev, body: undefined }));
            }}
            maxLength={REPORT_LIMITS.bodyMax}
            placeholder="언제, 어떤 일이 있었는지 사실 위주로 적어 주세요."
            hint={`${charLength(body.trim())}/${REPORT_LIMITS.bodyMax}자 · 연락처 등 개인정보는 적지 마세요. 신고한 사람의 정보는 상대방에게 알리지 않아요.`}
            error={errors.body}
            required={bodyRequired}
            disabled={busy}
          />
        </div>
        <Notice tone="info" plain>
          위급한 상황이면 112(경찰)·119(구조·구급)에 먼저 연락해 주세요. 신고 기준은{' '}
          <Link to="/policies/operations" className="font-bold text-ink underline underline-offset-4">
            운영정책
          </Link>
          에서 볼 수 있어요.
        </Notice>
        <ErrorText message={submitError} />
      </div>
    </Dialog>
  );
}

function keyOf(target: ReportTarget): string {
  return `${target.type}:${target.id}`;
}
