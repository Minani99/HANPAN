import { useState, type ReactNode } from 'react';
import { getErrorMessage } from '../../domain/errorMessages';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { ErrorText } from './Notice';

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  /** 요청 중 스크린리더 문구 */
  confirmLoadingLabel?: string;
  cancelLabel?: string;
  /** danger: 위험 동작(보조 버튼 + 위험 글자색, 빨간 배경 없음) */
  tone?: 'default' | 'danger';
  /** 확인 동작. Promise가 끝날 때까지 버튼이 잠기고, 실패하면 대화상자 안에 오류 문구를 보여준다. */
  onConfirm: () => Promise<unknown> | void;
  /** 확인 버튼을 막을 조건(예: 확인 체크 전) */
  confirmDisabled?: boolean;
  /** 실패 문구 만들기. 기본 getErrorMessage(코드별 문구) */
  errorMessage?: (error: unknown) => string;
}

/**
 * 확인 대화상자. 확인 동작이 성공하면 부모가 open=false로 닫는다(onConfirm 안에서).
 * 실패하면 열린 채로 오류를 안내하고 다시 시도할 수 있다.
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  if (!props.open) return null;
  return <ConfirmDialogBody {...props} />;
}

function ConfirmDialogBody({
  open,
  onClose,
  title,
  description,
  children,
  confirmLabel,
  confirmLoadingLabel = '처리 중',
  cancelLabel = '닫기',
  tone = 'default',
  onConfirm,
  confirmDisabled,
  errorMessage = getErrorMessage,
}: ConfirmDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    setError(null);
    setBusy(true);
    try {
      await onConfirm();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={busy ? () => {} : onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={handleConfirm}
            loading={busy}
            loadingLabel={confirmLoadingLabel}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children ? <div className="text-md leading-relaxed text-text">{children}</div> : null}
      <ErrorText message={error} className={children ? 'mt-4' : undefined} />
    </Dialog>
  );
}
