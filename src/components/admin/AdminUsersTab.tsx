import { useState, type FormEvent } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { useDataAdapter } from '../../data';
import type { AccountStatus, AdminUser } from '../../data/types';
import { useAsyncData } from '../../data/useAsyncData';
import { ADMIN_LIMITS, charLength } from '../../domain/limits';
import { formatFullDate } from '../../lib/date';
import { normalizeQuery } from '../../lib/filters';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState } from '../ui/ErrorState';
import { Icon } from '../ui/Icon';
import { Notice } from '../ui/Notice';
import { Skeleton } from '../ui/Skeleton';
import { TextField } from '../ui/TextField';
import { Textarea } from '../ui/Textarea';
import { useToast } from '../ui/Toast';
import { adminErrorMessage } from './adminShared';

const STATUS_LABEL: Record<AccountStatus, string> = {
  active: '이용 중',
  restricted: '이용 제한',
  deletion_requested: '탈퇴 요청',
};

/**
 * 관리자 · 사용자: 닉네임(또는 id) 검색 → 이용 중 ↔ 이용 제한 전환(메모).
 * 본인·탈퇴 요청 계정은 바꿀 수 없다(서버 admin_set_user_status와 같은 규칙, audit admin.user_status).
 */
export function AdminUsersTab() {
  const adapter = useDataAdapter();
  const toast = useToast();
  const { user, userKey } = useAuth();
  const [searchText, setSearchText] = useState('');
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState<AdminUser | null>(null);
  const [note, setNote] = useState('');

  const users = useAsyncData(`admin-users:${query}:${userKey}`, () => adapter.adminSearchUsers(query));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setQuery(normalizeQuery(searchText) ?? '');
  };

  const noteTrimmed = note.trim();
  const noteTooLong = charLength(noteTrimmed) > ADMIN_LIMITS.userStatusNoteMax;
  const nextStatus = target?.status === 'restricted' ? 'active' : 'restricted';

  const confirm = async () => {
    if (!target) return;
    await adapter.adminSetUserStatus(target.id, nextStatus, noteTrimmed || null);
    toast.show(nextStatus === 'restricted' ? `${target.nickname}님의 이용을 제한했어요.` : `${target.nickname}님의 제한을 풀었어요.`, {
      tone: 'success',
    });
    setTarget(null);
    await users.refresh().catch(() => users.retry());
  };

  return (
    <div data-testid="admin-users">
      <Notice tone="info">
        이용 제한은 영구 제재가 아니며 이의제기를 검토해요. 제한된 계정은 모임 만들기·신청을 할 수 없지만 신고와 기존 신청 취소는 할
        수 있어요. 제한해도 그 사용자의 모임은 자동으로 취소되지 않아요.
      </Notice>
      <form role="search" aria-label="사용자 검색" onSubmit={submit} className="mt-4 flex gap-2">
        <TextField
          type="search"
          label="닉네임 또는 사용자 id"
          hideLabel
          placeholder="닉네임 또는 사용자 id"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          maxLength={50}
          inputSize="sm"
          containerClassName="min-w-0 flex-1"
          leading={<Icon name="search" size="1.1rem" />}
        />
        <Button type="submit" variant="secondary">
          검색
        </Button>
      </form>
      <p className="mt-2 text-sm text-muted">검색어가 없으면 최근 가입한 순서로 20명까지 보여요. 이메일은 이 화면에서 볼 수 없어요.</p>

      {users.status === 'loading' ? (
        <div aria-busy="true" className="mt-4 space-y-3">
          <p role="status" className="sr-only">
            사용자를 찾는 중이에요.
          </p>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : null}
      {users.status === 'error' ? (
        <ErrorState title="사용자를 불러오지 못했어요." description={adminErrorMessage(users.error)} onRetry={users.retry} />
      ) : null}
      {users.status === 'success' && users.data ? (
        users.data.length === 0 ? (
          <EmptyState title="찾는 사용자가 없어요." />
        ) : (
          <ul role="list" className="mt-4 border-t border-border" data-testid="admin-user-list">
            {users.data.map((item) => {
              const self = item.id === user?.id;
              const locked = self || item.status === 'deletion_requested';
              return (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border py-4" data-testid="admin-user">
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="flex flex-wrap items-center gap-2">
                      <strong className="text-base font-bold text-ink text-wrap-ko">{item.nickname}</strong>
                      <Badge tone={item.status === 'active' ? 'status' : 'warning'}>{STATUS_LABEL[item.status]}</Badge>
                      {self ? <Badge tone="genre">나</Badge> : null}
                    </p>
                    <p className="mt-0.5 text-sm text-muted">
                      가입 {formatFullDate(item.createdAt)} · 최근 30일 신고 {item.recentReportCount}건
                    </p>
                  </div>
                  {locked ? (
                    <p className="text-sm text-muted">{self ? '내 계정은 바꿀 수 없어요' : '탈퇴 요청 계정은 바꿀 수 없어요'}</p>
                  ) : (
                    <Button
                      variant={item.status === 'restricted' ? 'secondary' : 'danger'}
                      size="sm"
                      onClick={() => {
                        setNote('');
                        setTarget(item);
                      }}
                      aria-haspopup="dialog"
                      aria-label={`${item.nickname}님 ${item.status === 'restricted' ? '제한 해제' : '이용 제한'}`}
                    >
                      {item.status === 'restricted' ? '제한 해제' : '이용 제한'}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )
      ) : null}

      <ConfirmDialog
        open={target !== null}
        onClose={() => setTarget(null)}
        title={nextStatus === 'restricted' ? `${target?.nickname ?? ''}님의 이용을 제한할까요?` : `${target?.nickname ?? ''}님의 제한을 풀까요?`}
        confirmLabel={nextStatus === 'restricted' ? '이용 제한' : '제한 해제'}
        confirmLoadingLabel="처리하는 중"
        cancelLabel="그대로 두기"
        tone={nextStatus === 'restricted' ? 'danger' : 'default'}
        onConfirm={confirm}
        confirmDisabled={noteTooLong}
        errorMessage={adminErrorMessage}
      >
        <p>
          {nextStatus === 'restricted'
            ? '제한은 영구 제재가 아니에요. 이용자에게는 로그인했을 때 화면 위 안내로 보이고, 이의제기를 받으면 다시 검토해요.'
            : '다시 모임을 만들고 신청할 수 있게 돼요.'}
        </p>
        <Textarea
          label="처리 메모 (선택, 감사 기록에 남아요)"
          containerClassName="mt-4"
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={ADMIN_LIMITS.userStatusNoteMax}
          hint={`${charLength(noteTrimmed)}/${ADMIN_LIMITS.userStatusNoteMax}자 · 판단 근거를 사실 위주로 적어 주세요.`}
          error={noteTooLong ? `${ADMIN_LIMITS.userStatusNoteMax}자까지 쓸 수 있어요.` : undefined}
        />
      </ConfirmDialog>
    </div>
  );
}
