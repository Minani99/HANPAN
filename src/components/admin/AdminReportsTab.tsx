import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { ADMIN_PAGE_SIZE } from '../../data/adapter';
import { useDataAdapter } from '../../data';
import type { AdminReport, ReportStatus } from '../../data/types';
import { useAsyncData } from '../../data/useAsyncData';
import { ADMIN_LIMITS, charLength } from '../../domain/limits';
import { REPORT_REASON_LABEL, REPORT_STATUSES, REPORT_STATUS_LABEL, REPORT_TARGET_LABEL } from '../../domain/reports';
import { formatFullDateTime } from '../../lib/date';
import { meetingPath } from '../meeting/MeetingRow';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState } from '../ui/ErrorState';
import { ErrorText } from '../ui/Notice';
import { Select } from '../ui/Select';
import { Skeleton } from '../ui/Skeleton';
import { Textarea } from '../ui/Textarea';
import { useToast } from '../ui/Toast';
import { Pager, adminErrorMessage } from './adminShared';

type StatusFilter = ReportStatus | 'all';

const STATUS_TONE: Record<ReportStatus, 'warning' | 'status' | 'success'> = {
  received: 'warning',
  reviewing: 'warning',
  resolved: 'success',
  dismissed: 'status',
};

/** 관리자 · 신고: 상태 필터, 목록, 상태 변경 + 관리자 메모(admin_update_report — 서버가 audit 기록) */
export function AdminReportsTab() {
  const adapter = useDataAdapter();
  const { userKey } = useAuth();
  const [status, setStatus] = useState<StatusFilter>('received');
  const [offset, setOffset] = useState(0);
  const reports = useAsyncData(`admin-reports:${status}:${offset}:${userKey}`, () =>
    adapter.adminListReports(status === 'all' ? {} : { status }, { limit: ADMIN_PAGE_SIZE, offset }),
  );

  const changeStatus = (next: StatusFilter) => {
    setStatus(next);
    setOffset(0);
  };

  return (
    <div data-testid="admin-reports">
      <div role="group" aria-label="신고 상태" className="scrollbar-none -m-1.5 flex gap-1.75 overflow-x-auto p-1.5 md:gap-2.25">
        {REPORT_STATUSES.map((value) => (
          <Chip key={value} selected={status === value} onClick={() => changeStatus(value)}>
            {REPORT_STATUS_LABEL[value]}
          </Chip>
        ))}
        <Chip selected={status === 'all'} onClick={() => changeStatus('all')}>
          전체
        </Chip>
      </div>
      <p className="mt-3 text-sm text-muted">
        신고만으로 자동 제재하지 않아요. 내용을 직접 확인한 뒤 모임 숨김·취소나 계정 제한은 각 탭에서 따로 처리해요.
      </p>

      {reports.status === 'loading' ? (
        <div aria-busy="true" className="mt-4 space-y-3">
          <p role="status" className="sr-only">
            신고 목록을 불러오는 중이에요.
          </p>
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : null}
      {reports.status === 'error' ? (
        <ErrorState title="신고 목록을 불러오지 못했어요." description={adminErrorMessage(reports.error)} onRetry={reports.retry} />
      ) : null}
      {reports.status === 'success' && reports.data ? (
        reports.data.items.length === 0 ? (
          <EmptyState title="이 상태의 신고가 없어요." />
        ) : (
          <>
            <ul role="list" className="mt-4 border-t border-border" data-testid="admin-report-list">
              {reports.data.items.map((report) => (
                <ReportItem key={report.id} report={report} onSaved={() => reports.refresh().catch(() => reports.retry())} />
              ))}
            </ul>
            <Pager offset={offset} limit={ADMIN_PAGE_SIZE} total={reports.data.total} onChange={setOffset} label="신고" />
          </>
        )
      ) : null}
    </div>
  );
}

function ReportItem({ report, onSaved }: { report: AdminReport; onSaved: () => void }) {
  const adapter = useDataAdapter();
  const toast = useToast();
  const [status, setStatus] = useState<ReportStatus>(report.status);
  const [note, setNote] = useState(report.adminNote ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const noteTooLong = charLength(note.trim()) > ADMIN_LIMITS.adminNoteMax;
  const changed = status !== report.status || note.trim() !== (report.adminNote ?? '');

  const save = async () => {
    if (busy || noteTooLong) return;
    setError(null);
    setBusy(true);
    try {
      await adapter.adminUpdateReport(report.id, status, note.trim() || null);
      toast.show('신고 처리 상태를 저장했어요.', { tone: 'success' });
      onSaved();
    } catch (caught) {
      setError(adminErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const target =
    report.targetType === 'meeting' ? (
      report.targetId ? (
        <Link to={meetingPath(report.targetId)} className="font-bold text-ink underline underline-offset-4 text-wrap-ko">
          {report.targetLabel ?? '(제목 없음)'}
        </Link>
      ) : (
        <span className="text-muted">삭제된 모임</span>
      )
    ) : (
      <strong className="font-bold text-ink text-wrap-ko">{report.targetLabel ?? '삭제된 사용자'}</strong>
    );

  return (
    <li className="border-b border-border py-5" data-testid="admin-report">
      <p className="flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[report.status]}>{REPORT_STATUS_LABEL[report.status]}</Badge>
        <Badge tone="genre">{REPORT_TARGET_LABEL[report.targetType]}</Badge>
        <span className="text-md font-bold text-ink">{REPORT_REASON_LABEL[report.reason]}</span>
        {report.targetHidden ? <Badge tone="status">숨김 중인 모임</Badge> : null}
      </p>
      <p className="mt-2 text-base leading-relaxed text-text">대상: {target}</p>
      <p className="mt-2 text-md leading-relaxed whitespace-pre-wrap text-text text-wrap-ko" data-testid="admin-report-body">
        {report.body ? report.body : <span className="text-muted">상세 내용 없음</span>}
      </p>
      <p className="mt-2 text-sm text-muted">
        접수 {formatFullDateTime(report.createdAt)} · 신고자 {report.reporterNickname ?? '탈퇴한 사용자'}
        {report.handledAt ? ` · 처리 ${formatFullDateTime(report.handledAt)}` : ''}
      </p>

      <div className="mt-4 grid gap-3 md:grid-cols-[12rem_minmax(0,1fr)] md:items-start">
        <Select
          label="처리 상태"
          inputSize="sm"
          value={status}
          onChange={(event) => setStatus(event.target.value as ReportStatus)}
          data-testid="admin-report-status"
        >
          {REPORT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {REPORT_STATUS_LABEL[value]}
            </option>
          ))}
        </Select>
        <Textarea
          label="관리자 메모 (신고자에게 보이지 않아요)"
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={ADMIN_LIMITS.adminNoteMax}
          hint={`${charLength(note.trim())}/${ADMIN_LIMITS.adminNoteMax}자 · 판단 근거를 사실 위주로 적고 불필요한 개인정보는 적지 마세요.`}
          error={noteTooLong ? `${ADMIN_LIMITS.adminNoteMax}자까지 쓸 수 있어요.` : undefined}
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          onClick={save}
          loading={busy}
          loadingLabel="저장하는 중"
          disabled={!changed || noteTooLong}
          data-testid="admin-report-save"
        >
          처리 상태 저장
        </Button>
        <ErrorText message={error} />
      </div>
    </li>
  );
}
