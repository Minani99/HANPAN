import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { ADMIN_PAGE_SIZE } from '../../data/adapter';
import { useDataAdapter } from '../../data';
import type { AdminMeeting } from '../../data/types';
import { useAsyncData } from '../../data/useAsyncData';
import { getCategoryName } from '../../domain/categories';
import { MEETING_LIMITS, charLength } from '../../domain/limits';
import { getMeetingPhase } from '../../domain/meetingPhase';
import { formatMeetingDateTime } from '../../lib/date';
import { normalizeQuery } from '../../lib/filters';
import { hostDisplayName } from '../meeting/meetingText';
import { meetingPath } from '../meeting/MeetingRow';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState } from '../ui/ErrorState';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { TextField } from '../ui/TextField';
import { Textarea } from '../ui/Textarea';
import { useToast } from '../ui/Toast';
import { Pager, adminErrorMessage } from './adminShared';

type PendingAction = { kind: 'hide' | 'unhide' | 'cancel'; meeting: AdminMeeting } | null;

const PHASE_LABEL = {
  cancelled: '취소됨',
  finished: '종료',
  in_progress: '진행 중',
  closed: '모집 마감',
  full: '정원 마감',
  open: '모집 중',
} as const;

/**
 * 관리자 · 모임: 제목·게임명 검색, 숨김만 보기, 숨김/해제(사유 필수), 관리자 취소.
 * 숨김·취소는 서버 RPC가 권한(is_admin)을 확인하고 audit에 남긴다(admin.meeting_hidden, meeting.cancel).
 */
export function AdminMeetingsTab() {
  const adapter = useDataAdapter();
  const toast = useToast();
  const { userKey } = useAuth();
  const [searchText, setSearchText] = useState('');
  const [query, setQuery] = useState<string | undefined>(undefined);
  const [hiddenOnly, setHiddenOnly] = useState(false);
  const [offset, setOffset] = useState(0);
  const [pending, setPending] = useState<PendingAction>(null);
  const [reason, setReason] = useState('');
  const [now] = useState(() => new Date());

  const meetings = useAsyncData(`admin-meetings:${query ?? ''}:${hiddenOnly}:${offset}:${userKey}`, () =>
    adapter.adminListMeetings({ ...(query ? { q: query } : {}), hiddenOnly }, { limit: ADMIN_PAGE_SIZE, offset }),
  );

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setQuery(normalizeQuery(searchText));
    setOffset(0);
  };

  const open = (kind: 'hide' | 'unhide' | 'cancel', meeting: AdminMeeting) => {
    setReason('');
    setPending({ kind, meeting });
  };

  const reasonTrimmed = reason.trim();
  const reasonTooLong = charLength(reasonTrimmed) > MEETING_LIMITS.hiddenReasonMax;
  const confirmDisabled = pending?.kind === 'hide' ? reasonTrimmed === '' || reasonTooLong : reasonTooLong;

  const confirm = async () => {
    if (!pending) return;
    // 실패하면 throw → ConfirmDialog가 adminErrorMessage 문구를 보여주고 열린 채로 둔다
    if (pending.kind === 'cancel') {
      await adapter.adminCancelMeeting(pending.meeting.id, reasonTrimmed || null);
      toast.show('모임을 취소했어요.', { tone: 'success' });
    } else {
      await adapter.adminSetMeetingHidden(pending.meeting.id, pending.kind === 'hide', pending.kind === 'hide' ? reasonTrimmed : null);
      toast.show(pending.kind === 'hide' ? '모임을 숨겼어요.' : '모임 숨김을 해제했어요.', { tone: 'success' });
    }
    setPending(null);
    await meetings.refresh().catch(() => meetings.retry());
  };

  return (
    <div data-testid="admin-meetings">
      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <form role="search" aria-label="모임 검색" onSubmit={submitSearch} className="flex min-w-0 flex-1 gap-2">
          <TextField
            type="search"
            label="모임 제목·게임명 검색"
            hideLabel
            placeholder="모임 제목·게임명"
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
        <Chip
          selected={hiddenOnly}
          onClick={() => {
            setHiddenOnly((value) => !value);
            setOffset(0);
          }}
          className="self-start md:self-auto"
        >
          숨김만 보기
        </Chip>
      </div>

      {meetings.status === 'loading' ? (
        <div aria-busy="true" className="mt-4 space-y-3">
          <p role="status" className="sr-only">
            모임 목록을 불러오는 중이에요.
          </p>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : null}
      {meetings.status === 'error' ? (
        <ErrorState title="모임 목록을 불러오지 못했어요." description={adminErrorMessage(meetings.error)} onRetry={meetings.retry} />
      ) : null}
      {meetings.status === 'success' && meetings.data ? (
        meetings.data.items.length === 0 ? (
          <EmptyState title={hiddenOnly ? '숨긴 모임이 없어요.' : '조건에 맞는 모임이 없어요.'} />
        ) : (
          <>
            <ul role="list" className="mt-4 border-t border-border" data-testid="admin-meeting-list">
              {meetings.data.items.map((meeting) => {
                const phase = getMeetingPhase(meeting, now);
                const canCancel = phase !== 'cancelled' && phase !== 'finished';
                return (
                  <li key={meeting.id} className="border-b border-border py-4" data-testid="admin-meeting">
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
                      <div className="min-w-0 flex-1 basis-64">
                        <p className="flex flex-wrap items-center gap-2">
                          {meeting.isHidden ? <Badge tone="warning">숨김</Badge> : null}
                          <Badge tone="status">{PHASE_LABEL[phase]}</Badge>
                          <Badge tone="genre">{getCategoryName(meeting.categoryId)}</Badge>
                        </p>
                        <Link
                          to={meetingPath(meeting.id)}
                          className="mt-1.5 block text-base leading-snug font-bold text-ink text-wrap-ko underline-offset-4 hover:underline"
                        >
                          {meeting.title}
                        </Link>
                        <p className="mt-1 text-sm text-muted">
                          {formatMeetingDateTime(meeting.startAt)} · 모임장 {hostDisplayName(meeting)} · 확정 {meeting.confirmedCount}/
                          {meeting.maxParticipants}명
                        </p>
                        {meeting.isHidden && meeting.hiddenReason ? (
                          <p className="mt-1 text-sm text-text text-wrap-ko">숨김 사유: {meeting.hiddenReason}</p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        {meeting.isHidden ? (
                          <Button variant="secondary" size="sm" onClick={() => open('unhide', meeting)} aria-haspopup="dialog">
                            숨김 해제
                          </Button>
                        ) : (
                          <Button variant="secondary" size="sm" onClick={() => open('hide', meeting)} aria-haspopup="dialog">
                            숨기기
                          </Button>
                        )}
                        {canCancel ? (
                          <Button variant="danger" size="sm" onClick={() => open('cancel', meeting)} aria-haspopup="dialog">
                            모임 취소
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            <Pager offset={offset} limit={ADMIN_PAGE_SIZE} total={meetings.data.total} onChange={setOffset} label="모임" />
          </>
        )
      ) : null}

      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title={
          pending?.kind === 'hide' ? '이 모임을 숨길까요?' : pending?.kind === 'unhide' ? '숨김을 해제할까요?' : '이 모임을 취소할까요?'
        }
        description={pending?.meeting.title}
        confirmLabel={pending?.kind === 'hide' ? '숨기기' : pending?.kind === 'unhide' ? '숨김 해제' : '모임 취소하기'}
        confirmLoadingLabel="처리하는 중"
        cancelLabel="그대로 두기"
        tone={pending?.kind === 'unhide' ? 'default' : 'danger'}
        onConfirm={confirm}
        confirmDisabled={confirmDisabled}
        errorMessage={adminErrorMessage}
      >
        {pending?.kind === 'hide' ? (
          <>
            <p>숨긴 모임은 탐색 목록과 상세에서 모임장·관리자 외에는 보이지 않아요. 참가 신청 상태는 바뀌지 않아요.</p>
            <Textarea
              label="숨김 사유 (필수)"
              containerClassName="mt-4"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={MEETING_LIMITS.hiddenReasonMax}
              hint={`${charLength(reasonTrimmed)}/${MEETING_LIMITS.hiddenReasonMax}자 · 모임장에게 보여요.`}
              error={reasonTooLong ? `${MEETING_LIMITS.hiddenReasonMax}자까지 쓸 수 있어요.` : undefined}
              required
            />
          </>
        ) : pending?.kind === 'unhide' ? (
          <p>다시 탐색 목록과 상세에 공개돼요.</p>
        ) : pending ? (
          <>
            <p>
              참가자 신청은 모두 &lsquo;모임 취소&rsquo; 상태로 바뀌고 되돌릴 수 없어요. 참가자에게 자동 알림은 가지 않아요.
            </p>
            <Textarea
              label="취소 사유 (선택)"
              containerClassName="mt-4"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={MEETING_LIMITS.cancelReasonMax}
              hint={`${charLength(reasonTrimmed)}/${MEETING_LIMITS.cancelReasonMax}자 · 모임 상세에 공개돼요.`}
            />
          </>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
