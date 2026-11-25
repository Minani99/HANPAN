import { getErrorCode, isDataAdapterError } from '../../data/adapter';
import { getErrorMessage } from '../../domain/errorMessages';
import { Button } from '../ui/Button';

/**
 * 관리자 화면 공통. 관리자 화면의 권한 확인은 사용성용이다 — 진짜 경계는 서버(RPC의 is_admin()·RLS)이며,
 * 관리자가 아니면 어떤 요청이든 NOT_ADMIN/권한 오류로 실패한다(docs/SECURITY.md §3·§9).
 */

const DETAIL_MESSAGES: Readonly<Record<string, string>> = {
  reason: '숨김 사유를 1~200자로 적어 주세요.',
  user_id: '내 계정의 상태는 여기서 바꿀 수 없어요.',
  status: '탈퇴 요청된 계정은 상태를 바꿀 수 없어요.',
  note: '메모는 200자까지 쓸 수 있어요.',
  admin_note: '관리자 메모는 1000자까지 쓸 수 있어요.',
};

/** 관리자 동작 오류 → 문구(대상이 모임만이 아니므로 NOT_FOUND 등을 일반 문구로) */
export function adminErrorMessage(error: unknown): string {
  const code = getErrorCode(error);
  const detail = isDataAdapterError(error) ? error.detail : undefined;
  if (code === 'NOT_FOUND') return '대상을 찾을 수 없어요. 새로고침해 주세요.';
  if (code === 'NOT_ADMIN' || code === 'PERMISSION_DENIED') return '관리자 권한이 없어요. 권한이 바뀌었다면 다시 로그인해 주세요.';
  if (code === 'MEETING_STARTED' && detail === 'ended') return '이미 끝난 모임은 취소할 수 없어요.';
  if (code === 'MEETING_CANCELLED') return '이미 취소된 모임이에요.';
  if (code === 'VALIDATION_FAILED' && detail && DETAIL_MESSAGES[detail]) return DETAIL_MESSAGES[detail];
  return getErrorMessage(error);
}

export interface PagerProps {
  offset: number;
  limit: number;
  total: number;
  onChange: (offset: number) => void;
  label: string;
}

/** 이전·다음 페이지 버튼 + '1–20 / 총 N건' */
export function Pager({ offset, limit, total, onChange, label }: PagerProps) {
  if (total <= limit && offset === 0) return null;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <nav aria-label={`${label} 페이지`} className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted">
        {from}–{to} / 총 {total}건
      </p>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
          이전
        </Button>
        <Button variant="secondary" size="sm" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>
          다음
        </Button>
      </div>
    </nav>
  );
}
