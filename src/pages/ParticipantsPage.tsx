import { useId, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { BackLink } from '../components/layout/BackLink';
import { PageContainer } from '../components/layout/PageContainer';
import { ForbiddenState, MeetingNotFoundState, PageErrorState, PageSkeleton } from '../components/layout/PageStates';
import { PageTitle } from '../components/layout/PageTitle';
import { meetingEditPath } from '../components/meeting/meetingText';
import { meetingPath } from '../components/meeting/MeetingRow';
import { ReportDialog } from '../components/report/ReportDialog';
import { Badge } from '../components/ui/Badge';
import { Button, ButtonLink } from '../components/ui/Button';
import { Chip } from '../components/ui/Chip';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Icon } from '../components/ui/Icon';
import { ErrorText, Notice } from '../components/ui/Notice';
import { Textarea } from '../components/ui/Textarea';
import { useToast } from '../components/ui/Toast';
import { useDataAdapter } from '../data';
import type { AttendanceStatus, Meeting, Participant } from '../data/types';
import { useAsyncData } from '../data/useAsyncData';
import { getErrorMessage } from '../domain/errorMessages';
import { MEETING_LIMITS, charLength } from '../domain/limits';
import { getMeetingPhase, remainingSeats } from '../domain/meetingPhase';
import { PARTICIPANT_STATUS_LABEL, isAttendanceWindowOpen } from '../domain/participation';
import { formatMeetingDateTime, formatMeetingSchedule } from '../lib/date';
import { useDocumentTitle } from '../lib/useDocumentTitle';

interface ParticipantsData {
  meeting: Meeting | null;
  /** 모임장이 아니면 null (요청하지 않는다) */
  participants: Participant[] | null;
  loadedAt: Date;
}

/** 참가자 관리 (`/meetings/:id/participants`, 모임장 전용) */
export function ParticipantsPage() {
  useDocumentTitle('참가자 관리');
  const { id = '' } = useParams();
  const adapter = useDataAdapter();
  const { user, userKey } = useAuth();

  const data = useAsyncData<ParticipantsData>(`participants:${id}:${userKey}`, async () => {
    const meeting = await adapter.getMeeting(id);
    if (!meeting || !user || meeting.hostId !== user.id) return { meeting, participants: null, loadedAt: new Date() };
    const participants = await adapter.listParticipants(id);
    return { meeting, participants, loadedAt: new Date() };
  });

  if (data.status === 'loading') return <PageSkeleton label="참가자 정보를 불러오는 중이에요." />;
  if (data.status === 'error' || !data.data) {
    return <PageErrorState title="참가자 정보를 불러오지 못했어요." onRetry={data.retry} />;
  }
  const { meeting, participants, loadedAt } = data.data;
  if (!meeting) return <MeetingNotFoundState />;
  if (!participants) {
    return (
      <ForbiddenState
        description="참가자 관리는 모임장만 할 수 있어요."
        actions={<ButtonLink to={meetingPath(meeting.id)}>모임 상세로 가기</ButtonLink>}
      />
    );
  }

  return (
    <ParticipantsView
      meeting={meeting}
      participants={participants}
      now={loadedAt}
      refresh={async () => {
        await data.refresh();
      }}
    />
  );
}

interface ParticipantsViewProps {
  meeting: Meeting;
  participants: Participant[];
  now: Date;
  refresh: () => Promise<void>;
}

function Section({ title, count, note, children }: { title: string; count: number; note?: ReactNode; children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="mt-9 border-t border-border pt-6">
      <h2 id={headingId} className="text-lg leading-snug font-heavy text-ink">
        {title} <span className="text-muted">{count}명</span>
      </h2>
      {note ? <div className="mt-1.5 text-sm leading-normal text-muted">{note}</div> : null}
      {children}
    </section>
  );
}

function ParticipantsView({ meeting, participants, now, refresh }: ParticipantsViewProps) {
  const adapter = useDataAdapter();
  const toast = useToast();
  const [actionError, setActionError] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Participant | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [reportTarget, setReportTarget] = useState<Participant | null>(null);
  const noSeatId = useId();

  const phase = getMeetingPhase(meeting, now);
  const beforeStart = phase === 'open' || phase === 'full' || phase === 'closed';
  const canDecide = beforeStart;
  const seats = remainingSeats(meeting);
  const attendanceOpen = isAttendanceWindowOpen(meeting, now);

  const pending = participants.filter((p) => p.status === 'pending');
  const waitlisted = participants.filter((p) => p.status === 'waitlisted');
  const confirmed = participants.filter((p) => p.status === 'confirmed');
  const past = participants.filter((p) => p.status === 'rejected' || p.status === 'cancelled' || p.status === 'meeting_cancelled');

  /** 동작 공통: 성공하면 목록 갱신 + 안내, 실패하면 오류 문구(필요하면 목록도 다시 읽는다) */
  const run = async (work: () => Promise<unknown>, success: string) => {
    setActionError(null);
    try {
      await work();
    } catch (error) {
      setActionError(getErrorMessage(error));
      await refresh().catch(() => {});
      return;
    }
    await refresh().catch(() => {});
    toast.show(success, { tone: 'success' });
  };

  const approve = (participant: Participant) =>
    run(() => adapter.decideParticipant(participant.id, 'approve'), `${participant.nickname}님을 확정했어요.`);

  const reject = async (participant: Participant) => {
    await adapter.decideParticipant(participant.id, 'reject');
    setRejectTarget(null);
    setActionError(null);
    await refresh().catch(() => {});
    toast.show(`${participant.nickname}님의 신청을 거절했어요.`, { tone: 'success' });
  };

  const setAttendance = (participant: Participant, value: AttendanceStatus) =>
    run(
      () => adapter.markAttendance(participant.id, participant.attendance === value ? 'unknown' : value),
      '출석 정보를 저장했어요.',
    );

  const toggleRecruiting = () =>
    run(
      () => adapter.setMeetingRecruiting(meeting.id, meeting.status === 'closed'),
      meeting.status === 'closed' ? '모집을 다시 열었어요.' : '모집을 마감했어요.',
    );

  const cancelMeeting = async () => {
    if (charLength(cancelReason.trim()) > MEETING_LIMITS.cancelReasonMax) return;
    await adapter.cancelMeeting(meeting.id, cancelReason.trim() || null);
    setCancelOpen(false);
    setActionError(null);
    await refresh().catch(() => {});
    toast.show('모임을 취소했어요. 참가자에게 따로 알려 주세요.', { tone: 'success' });
  };

  const schedule = formatMeetingSchedule(meeting.startAt, meeting.endAt);

  const decisionButtons = (participant: Participant) =>
    canDecide ? (
      <div className="flex shrink-0 gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => approve(participant)}
          disabled={seats <= 0}
          focusableWhenDisabled
          aria-describedby={seats <= 0 ? noSeatId : undefined}
          aria-label={`${participant.nickname}님 승인`}
        >
          승인
        </Button>
        <Button
          variant="danger"
          size="sm"
          onClick={() => setRejectTarget(participant)}
          aria-haspopup="dialog"
          aria-label={`${participant.nickname}님 거절`}
        >
          거절
        </Button>
      </div>
    ) : null;

  const noSeatNote =
    canDecide && seats <= 0 ? (
      <p id={noSeatId} className="mt-4 text-sm font-semibold text-text">
        남은 자리가 없어 승인할 수 없어요. 정원을 늘리거나 확정 인원이 줄면 승인할 수 있어요.
      </p>
    ) : null;

  return (
    <PageContainer className="pt-2 pb-12 md:pt-4 md:pb-20">
      <BackLink to={meetingPath(meeting.id)} label="모임 상세" />
      <PageTitle title="참가자 관리" />

      <div className="max-w-3xl">
        <div className="border-y border-border py-4" data-testid="participants-summary">
          <Link
            to={meetingPath(meeting.id)}
            className="text-lg leading-snug font-heavy text-ink text-wrap-ko underline-offset-4 hover:underline"
          >
            {meeting.title}
          </Link>
          <p className="mt-1 text-md text-text">
            {schedule.date} {schedule.time}
          </p>
          <p className="mt-2 text-base font-bold text-ink" data-testid="participants-counts">
            확정 {meeting.confirmedCount}/{meeting.maxParticipants}명 · 승인 대기 {meeting.pendingCount}명 · 대기{' '}
            {meeting.waitlistCount}명
          </p>
        </div>

        <div className="mt-4 space-y-3">
          {meeting.isHidden ? (
            <Notice tone="warning" title="운영 정책에 따라 숨김 처리된 모임이에요">
              {meeting.hiddenReason ? `사유: ${meeting.hiddenReason}` : '다른 사람에게는 보이지 않아요.'}
            </Notice>
          ) : null}
          {phase === 'cancelled' ? (
            <Notice tone="danger" title="취소된 모임이에요" data-testid="participants-cancelled">
              {meeting.cancelReason ? `취소 사유: ${meeting.cancelReason}. ` : ''}참가자 신청은 모두 '모임 취소' 상태로
              바뀌었어요.
            </Notice>
          ) : null}
          {phase === 'in_progress' || phase === 'finished' ? (
            <Notice tone="info">모임이 시작돼 신청을 승인하거나 거절할 수 없어요.</Notice>
          ) : null}
          {phase === 'closed' ? <Notice tone="info">모집을 마감했어요. 새 신청을 받지 않아요.</Notice> : null}
          <ErrorText message={actionError} />
        </div>

        {beforeStart ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={toggleRecruiting} data-testid="recruiting-toggle">
              {meeting.status === 'closed' ? '모집 다시 열기' : '모집 마감하기'}
            </Button>
            <ButtonLink to={meetingEditPath(meeting.id)} variant="secondary">
              모임 수정
            </ButtonLink>
          </div>
        ) : null}

        {noSeatNote}

        <Section title="승인 대기" count={pending.length}>
          {pending.length === 0 ? (
            <p className="mt-3 text-md text-muted">승인을 기다리는 신청이 없어요.</p>
          ) : (
            <ul role="list" className="mt-2" data-testid="pending-list">
              {pending.map((participant) => (
                <ParticipantRow
                  key={participant.id}
                  participant={participant}
                  actions={decisionButtons(participant)}
                  onReport={setReportTarget}
                />
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="대기자"
          count={waitlisted.length}
          note="자리가 나면 직접 승인해 주세요. 자동으로 확정되지 않아요."
        >
          {waitlisted.length === 0 ? (
            <p className="mt-3 text-md text-muted">대기 중인 신청이 없어요.</p>
          ) : (
            <ul role="list" className="mt-2" data-testid="waitlist-list">
              {waitlisted.map((participant) => (
                <ParticipantRow
                  key={participant.id}
                  participant={participant}
                  actions={decisionButtons(participant)}
                  onReport={setReportTarget}
                />
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="확정"
          count={confirmed.length}
          note={
            attendanceOpen
              ? '모임 시작 후부터 종료 7일 뒤까지 출석을 기록할 수 있어요.'
              : '출석 체크는 모임이 시작된 뒤에 할 수 있어요.'
          }
        >
          <ul role="list" className="mt-2" data-testid="confirmed-list">
            {confirmed.map((participant) => (
              <ParticipantRow
                key={participant.id}
                participant={participant}
                onReport={setReportTarget}
                actions={
                  attendanceOpen && participant.role === 'guest' ? (
                    <AttendanceToggle participant={participant} onChange={(value) => setAttendance(participant, value)} />
                  ) : null
                }
              />
            ))}
          </ul>
        </Section>

        {past.length > 0 ? (
          <details className="group mt-9 border-t border-border pt-6">
            <summary className="flex min-h-touch cursor-pointer items-center text-lg font-heavy text-ink">
              지난 신청 <span className="ml-1 text-muted">{past.length}명</span>
              <span className="ml-2 text-sm font-semibold text-muted">거절·취소</span>
            </summary>
            <ul role="list" className="mt-2" data-testid="past-list">
              {past.map((participant) => (
                <ParticipantRow
                  key={participant.id}
                  participant={participant}
                  onReport={setReportTarget}
                  actions={<Badge tone="status">{PARTICIPANT_STATUS_LABEL[participant.status]}</Badge>}
                />
              ))}
            </ul>
          </details>
        ) : null}

        {beforeStart ? (
          <section aria-labelledby="danger-zone" className="mt-12 rounded-lg border border-border px-5 py-5 md:px-6">
            <h2 id="danger-zone" className="text-lg font-heavy text-ink">
              모임 취소
            </h2>
            <p className="mt-2 text-md leading-relaxed text-text text-wrap-ko">
              취소하면 되돌릴 수 없어요. 참가자에게 자동 알림이 가지 않으니 별도로 알려 주세요.
            </p>
            <Button variant="danger" className="mt-4" onClick={() => setCancelOpen(true)} aria-haspopup="dialog">
              모임 취소하기
            </Button>
          </section>
        ) : null}
      </div>

      <ReportDialog
        open={reportTarget !== null}
        onClose={() => setReportTarget(null)}
        targets={reportTarget ? [{ type: 'user', id: reportTarget.userId, label: reportTarget.nickname }] : []}
      />

      <ConfirmDialog
        open={rejectTarget !== null}
        onClose={() => setRejectTarget(null)}
        title={rejectTarget ? `${rejectTarget.nickname}님의 신청을 거절할까요?` : '신청 거절'}
        confirmLabel="거절하기"
        confirmLoadingLabel="거절하는 중"
        tone="danger"
        onConfirm={() => (rejectTarget ? reject(rejectTarget) : undefined)}
      >
        <p>거절하면 이 모임에 다시 신청할 수 없어요. 신청한 사람에게 자동 알림은 가지 않아요.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="모임을 취소할까요?"
        confirmLabel="모임 취소하기"
        confirmLoadingLabel="모임을 취소하는 중"
        cancelLabel="그대로 두기"
        tone="danger"
        onConfirm={cancelMeeting}
        confirmDisabled={charLength(cancelReason.trim()) > MEETING_LIMITS.cancelReasonMax}
      >
        <p>
          참가자 신청은 모두 &lsquo;모임 취소&rsquo; 상태로 바뀌고, 참가자는 내 모임에서 확인할 수 있어요.
        </p>
        <p className="mt-2 font-semibold text-ink">
          참가자에게 자동 알림(이메일·푸시)이 가지 않으니 별도로 알려 주세요.
        </p>
        <Textarea
          label="취소 사유 (선택)"
          containerClassName="mt-4"
          rows={3}
          value={cancelReason}
          onChange={(event) => setCancelReason(event.target.value)}
          maxLength={MEETING_LIMITS.cancelReasonMax}
          hint={`${charLength(cancelReason.trim())}/${MEETING_LIMITS.cancelReasonMax}자 · 모임 상세에 공개돼요.`}
        />
      </ConfirmDialog>
    </PageContainer>
  );
}

function ParticipantRow({
  participant,
  actions,
  onReport,
}: {
  participant: Participant;
  actions?: ReactNode;
  /** 게스트 신고(모임장이 참가자를 신고). 모임장 본인 행에는 없다 */
  onReport?: (participant: Participant) => void;
}) {
  const isHost = participant.role === 'host';
  return (
    <li className="border-b border-border py-4 last:border-b-0" data-testid="participant-row">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-48">
          <p className="flex flex-wrap items-center gap-2">
            <strong className="text-base font-bold text-ink text-wrap-ko">{participant.nickname}</strong>
            {isHost ? <Badge tone="genre">모임장</Badge> : null}
          </p>
          {isHost ? null : (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted">
              <span>{formatMeetingDateTime(participant.appliedAt)} 신청</span>
              {onReport ? (
                <>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={() => onReport(participant)}
                    aria-haspopup="dialog"
                    aria-label={`${participant.nickname}님 신고`}
                    className="-my-2.5 inline-flex min-h-touch items-center gap-1 rounded-lg px-1 font-semibold text-text underline-offset-4 hover:text-ink hover:underline"
                    data-testid="participant-report"
                  >
                    <Icon name="flag" size="1em" />
                    신고
                  </button>
                </>
              ) : null}
            </p>
          )}
          {participant.message ? (
            <p className="mt-2 text-md leading-relaxed whitespace-pre-wrap text-text text-wrap-ko">
              <span className="sr-only">남긴 말: </span>
              {participant.message}
            </p>
          ) : null}
        </div>
        {actions}
      </div>
    </li>
  );
}

function AttendanceToggle({
  participant,
  onChange,
}: {
  participant: Participant;
  onChange: (value: AttendanceStatus) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const handle = async (value: AttendanceStatus) => {
    if (busy) return;
    setBusy(true);
    try {
      await onChange(value);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div role="group" aria-label={`${participant.nickname}님 출석`} aria-busy={busy || undefined} className="flex shrink-0 gap-2">
      {(['attended', 'absent'] as const).map((value) => (
        <Chip key={value} selected={participant.attendance === value} onClick={() => handle(value)}>
          {value === 'attended' ? '참석' : '불참'}
        </Chip>
      ))}
    </div>
  );
}
