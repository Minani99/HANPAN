import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { ONBOARDING_PATH } from '../auth/RequireAuth';
import { BackLink } from '../components/layout/BackLink';
import { useMobileCtaBar } from '../components/layout/mobileBottomBar';
import { PageContainer } from '../components/layout/PageContainer';
import { MeetingNotFoundState, PageErrorState, PageSkeleton } from '../components/layout/PageStates';
import { ApplyDialog } from '../components/meeting/ApplyDialog';
import { CategoryPlaceholder } from '../components/meeting/CategoryPlaceholder';
import { DetailCtaContent } from '../components/meeting/DetailCtaContent';
import { HoldemNotice } from '../components/meeting/HoldemNotice';
import { MeetingInfoList } from '../components/meeting/MeetingInfoList';
import { meetingPath } from '../components/meeting/MeetingRow';
import { hostDisplayName } from '../components/meeting/meetingText';
import { PeopleSummary } from '../components/meeting/PeopleSummary';
import { ReportDialog, type ReportTarget } from '../components/report/ReportDialog';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { ExternalLink } from '../components/ui/ExternalLink';
import { Icon } from '../components/ui/Icon';
import { Notice } from '../components/ui/Notice';
import { useToast } from '../components/ui/Toast';
import { useDataAdapter } from '../data';
import type { Meeting, MyParticipation, ParticipantStatus, Venue } from '../data/types';
import { useAsyncData } from '../data/useAsyncData';
import { getCategoryName } from '../domain/categories';
import { getDetailCta, type DetailCta } from '../domain/detailCta';
import { HOLDEM_CATEGORY_ID } from '../domain/meetingSchema';
import { getRegionName } from '../domain/regions';
import { getSkillLevelLabel } from '../domain/skillLevels';
import { VENUE_NOTICE, VENUE_TYPE_LABEL, venuePath } from '../domain/venues';
import { readPublicEnv } from '../lib/env';
import { saveReturnTo } from '../lib/returnTo';
import { useDocumentTitle } from '../lib/useDocumentTitle';

interface DetailData {
  meeting: Meeting | null;
  participation: MyParticipation | null;
  /** 연결된 공개 공간(없거나 비공개면 null). 외부 예약 링크는 여기서만 보여준다 */
  venue: Venue | null;
  /** 상태 계산 기준 시각(응답을 받은 시각) */
  loadedAt: Date;
}

const APPLY_SUCCESS_MESSAGE: Partial<Record<ParticipantStatus, string>> = {
  confirmed: '참가가 확정됐어요.',
  pending: '참가 신청을 보냈어요. 모임장이 확인하면 확정돼요.',
  waitlisted: '대기 신청을 했어요. 자리가 나면 모임장이 확인 후 확정해요.',
};

function shareUrl(id: string): string {
  const base = readPublicEnv().siteUrl ?? window.location.origin;
  return `${base}${meetingPath(id)}`;
}

/**
 * 모임 상세 (`/meetings/:id`). 비로그인도 내용을 볼 수 있고, 신청은 로그인 후.
 * 데스크톱: 본문 + 우측 sticky 패널(인원 + CTA) / 모바일: 하단 고정 CTA 바(하단 내비 대신)
 * 쓰기 요청은 응답을 받은 뒤에만 화면에 반영한다(낙관적 업데이트 없음). 실패하면 이전 상태 그대로 오류를 안내한다.
 */
export function MeetingDetailPage() {
  const { id = '' } = useParams();
  const adapter = useDataAdapter();
  const { status: authStatus, user, userKey } = useAuth();

  const detail = useAsyncData<DetailData>(authStatus === 'loading' ? null : `detail:${id}:${userKey}`, async () => {
    const [meeting, participation] = await Promise.all([
      adapter.getMeeting(id),
      user ? adapter.getMyParticipation(id) : Promise.resolve(null),
    ]);
    // 공간 정보는 부가 정보라 실패해도 상세는 보여준다(링크만 빠진다)
    const venue = meeting?.venueId ? await adapter.getVenue(meeting.venueId).catch(() => null) : null;
    return { meeting, participation, venue, loadedAt: new Date() };
  });

  const meeting = detail.data?.meeting ?? null;
  useDocumentTitle(detail.status === 'success' ? (meeting ? meeting.title : '모임을 찾을 수 없어요') : '모임 상세');

  if (detail.status === 'loading') return <PageSkeleton label="모임 정보를 불러오는 중이에요." />;
  if (detail.status === 'error' || !detail.data) {
    return <PageErrorState title="모임 정보를 불러오지 못했어요." onRetry={detail.retry} />;
  }
  if (!meeting) return <MeetingNotFoundState />;

  return (
    <MeetingDetailView
      meeting={meeting}
      participation={detail.data.participation}
      venue={detail.data.venue}
      now={detail.data.loadedAt}
      refresh={detail.refresh}
      retry={detail.retry}
    />
  );
}

interface MeetingDetailViewProps {
  meeting: Meeting;
  participation: MyParticipation | null;
  venue: Venue | null;
  now: Date;
  refresh: () => Promise<DetailData>;
  retry: () => void;
}

function MeetingDetailView({ meeting, participation, venue, now, refresh, retry }: MeetingDetailViewProps) {
  const adapter = useDataAdapter();
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [applyOpen, setApplyOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const ctaFocusRef = useRef<HTMLDivElement>(null);
  useMobileCtaBar(barRef);

  const cta: DetailCta = getDetailCta({ mode: adapter.mode, meeting, participation, user, now });
  const here = meetingPath(meeting.id);
  const isHost = Boolean(user && user.id === meeting.hostId);

  /** 쓰기 요청 성공 후: 최신 상태 반영 → 대화상자 닫기 → CTA로 포커스 */
  const settleAfterWrite = async (close: () => void) => {
    try {
      await refresh();
    } catch {
      retry();
    }
    flushSync(close);
    ctaFocusRef.current?.focus();
  };

  const handleApply = async (message: string | null) => {
    try {
      const status = await adapter.applyToMeeting(meeting.id, message);
      await settleAfterWrite(() => setApplyOpen(false));
      toast.show(APPLY_SUCCESS_MESSAGE[status] ?? '신청을 보냈어요.', { tone: 'success' });
    } catch (error) {
      // 상태가 바뀌었을 수 있으니(마감·취소 등) 화면 정보는 조용히 다시 읽고, 오류는 대화상자가 보여준다.
      refresh().catch(() => {});
      throw error;
    }
  };

  const handleCancelApplication = async () => {
    await adapter.cancelMyApplication(meeting.id);
    await settleAfterWrite(() => setCancelOpen(false));
    toast.show('신청을 취소했어요.', { tone: 'success' });
  };

  const handleShare = async () => {
    const url = shareUrl(meeting.id);
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: meeting.title, url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        // 공유 시트를 쓸 수 없으면 링크 복사로 넘어간다.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.show('링크를 복사했어요.');
    } catch {
      toast.show('링크를 복사하지 못했어요. 주소창의 주소를 복사해 주세요.', { tone: 'error' });
    }
  };

  const handleReport = () => {
    if (!user) {
      saveReturnTo(here);
      navigate('/login');
      return;
    }
    if (!user.onboarded) {
      saveReturnTo(here);
      navigate(ONBOARDING_PATH);
      return;
    }
    setReportOpen(true);
  };

  // 신고 대상: 이 모임 / 모임장(탈퇴한 모임장은 사용자 신고 불가). 본인 모임이면 버튼 자체가 없다.
  const reportTargets: ReportTarget[] = [
    { type: 'meeting', id: meeting.id, label: '이 모임' },
    ...(meeting.hostId ? [{ type: 'user' as const, id: meeting.hostId, label: `모임장 ${hostDisplayName(meeting)}` }] : []),
  ];

  const categoryName = getCategoryName(meeting.categoryId);
  const condition = meeting.approvalMode === 'manual' ? '승인제' : '바로 확정';

  return (
    <PageContainer className="pt-2 pb-10 md:pt-4 md:pb-20">
      <BackLink label="모임 목록" />

      <div className="mt-2 md:mt-3 md:grid md:grid-cols-[minmax(0,1fr)_20rem] md:items-start md:gap-12">
        <article aria-labelledby="meeting-title" className="min-w-0">
          {meeting.imageUrl ? (
            <div className="mb-5 aspect-[16/7] w-full overflow-hidden rounded-lg md:mb-6 md:aspect-[16/6]">
              <img
                src={meeting.imageUrl}
                alt={`${categoryName} 모임 사진`}
                decoding="async"
                className="h-full w-full object-cover saturate-70"
              />
            </div>
          ) : null}

          {/* 사진이 없으면 큰 배너 대신 목록 썸네일과 같은 비율의 작은 장르 플레이스홀더(모바일 86x96, 데스크톱 183x105) */}
          <div className="flex flex-col items-start gap-4 md:flex-row md:items-center md:gap-6.5">
            {meeting.imageUrl ? null : (
              <div
                className="h-[96px] w-[86px] shrink-0 overflow-hidden rounded-md md:h-[105px] md:w-[183px]"
                data-testid="detail-thumbnail"
              >
                <CategoryPlaceholder categoryId={meeting.categoryId} decorative />
              </div>
            )}
            <div className="min-w-0 md:flex-1">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-snug font-semibold text-muted">
                <Badge tone="genre">{categoryName}</Badge>
                <span aria-hidden="true">·</span>
                <span>{getSkillLevelLabel(meeting.skillLevel)}</span>
                <span aria-hidden="true">·</span>
                <span>{condition}</span>
              </p>
              <h1
                id="meeting-title"
                className="mt-2.5 text-3xl leading-tight font-heavy tracking-detail text-ink text-wrap-ko md:mt-3 md:text-4xl"
                data-testid="detail-title"
              >
                {meeting.title}
              </h1>
            </div>
          </div>

          {meeting.isHidden ? (
            <Notice tone="warning" title="운영 정책에 따라 숨김 처리된 모임이에요" className="mt-4">
              {meeting.hiddenReason ? `사유: ${meeting.hiddenReason}` : '다른 사람에게는 보이지 않아요.'}
            </Notice>
          ) : null}
          {cta.phase === 'cancelled' ? (
            <Notice tone="danger" title="취소된 모임이에요" className="mt-4" data-testid="cancelled-notice">
              {meeting.cancelReason ? `취소 사유: ${meeting.cancelReason}` : '모임장이 모임을 취소했어요.'}
            </Notice>
          ) : null}
          {cta.phase === 'in_progress' ? (
            <Notice tone="info" className="mt-4">
              지금 진행 중인 모임이에요.
            </Notice>
          ) : null}
          {cta.phase === 'finished' ? (
            <Notice tone="info" className="mt-4">
              종료된 모임이에요.
            </Notice>
          ) : null}

          <MeetingInfoList
            meeting={meeting}
            venueHref={venue ? venuePath(venue.id) : undefined}
            className="mt-5 border-y border-border md:mt-6"
          />

          <PeopleSummary meeting={meeting} now={now} variant="row" className="mt-6 md:hidden" />

          <section aria-labelledby="meeting-description" className="mt-8">
            <h2 id="meeting-description" className="text-lg leading-snug font-heavy text-ink">
              모임 소개
            </h2>
            {meeting.description ? (
              <p className="mt-3 text-base leading-loose whitespace-pre-wrap text-text text-wrap-ko" data-testid="meeting-description">
                {meeting.description}
              </p>
            ) : (
              <p className="mt-3 text-base text-muted">모임장이 아직 소개를 쓰지 않았어요.</p>
            )}
          </section>

          {meeting.notice ? (
            <section aria-labelledby="meeting-notice" className="mt-8">
              <h2 id="meeting-notice" className="text-lg leading-snug font-heavy text-ink">
                유의사항
              </h2>
              <p className="mt-3 text-base leading-loose whitespace-pre-wrap text-text text-wrap-ko" data-testid="meeting-notice">
                {meeting.notice}
              </p>
            </section>
          ) : null}

          {meeting.categoryId === HOLDEM_CATEGORY_ID ? <HoldemNotice className="mt-8" /> : null}

          {venue ? (
            <section aria-labelledby="meeting-venue" className="mt-8" data-testid="meeting-venue">
              <h2 id="meeting-venue" className="text-lg leading-snug font-heavy text-ink">
                공간 정보
              </h2>
              <div className="mt-3 rounded-lg border border-border px-4 py-4 md:px-5">
                <p className="text-xs font-semibold text-muted">
                  {VENUE_TYPE_LABEL[venue.venueType]} · {getRegionName(venue.regionCode)}
                </p>
                <Link
                  to={venuePath(venue.id)}
                  className="mt-1 inline-block text-base leading-snug font-bold text-ink text-wrap-ko underline-offset-4 hover:underline"
                >
                  {venue.name}
                </Link>
                <p className="mt-1 text-md leading-relaxed text-text text-wrap-ko">{venue.address}</p>
                {venue.bookingUrl ? (
                  <ExternalLink href={venue.bookingUrl} className="mt-1 text-md" data-testid="meeting-venue-booking">
                    예약 페이지(외부)
                  </ExternalLink>
                ) : null}
                <p className="mt-2 text-sm leading-relaxed text-muted text-wrap-ko">{VENUE_NOTICE}</p>
              </div>
            </section>
          ) : null}

          <div className="mt-8 flex flex-wrap items-center gap-x-2 border-t border-border pt-3">
            <Button variant="text" leadingIcon={<Icon name="share" size="1.1em" />} onClick={handleShare}>
              공유하기
            </Button>
            {isHost ? null : (
              <Button variant="text" leadingIcon={<Icon name="flag" size="1.1em" />} onClick={handleReport} aria-haspopup="dialog">
                신고하기
              </Button>
            )}
          </div>
        </article>

        <aside
          aria-label="참가 신청"
          className="md:sticky md:top-6 md:rounded-lg md:border md:border-border md:p-6"
          data-testid="detail-aside"
        >
          <PeopleSummary meeting={meeting} now={now} variant="panel" className="hidden md:block md:pb-5" />
          <div
            ref={barRef}
            className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface px-gutter-sm pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] md:static md:z-auto md:border-t md:bg-transparent md:px-0 md:pt-5 md:pb-0"
            data-testid="detail-cta"
          >
            <DetailCtaContent
              cta={cta}
              meetingId={meeting.id}
              focusRef={ctaFocusRef}
              onApply={() => setApplyOpen(true)}
              onCancelApplication={() => setCancelOpen(true)}
              onBeforeAuthNavigate={() => saveReturnTo(here)}
            />
          </div>
        </aside>
      </div>

      <ApplyDialog
        open={applyOpen}
        meeting={meeting}
        waitlist={cta.kind === 'waitlist'}
        onClose={() => setApplyOpen(false)}
        onSubmit={handleApply}
      />

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="신청을 취소할까요?"
        confirmLabel="신청 취소하기"
        confirmLoadingLabel="신청을 취소하는 중"
        cancelLabel="그대로 두기"
        tone="danger"
        onConfirm={handleCancelApplication}
      >
        <p>시작 전까지는 다시 신청할 수 있어요. 승인제 모임은 다시 신청하면 모임장 확인을 기다려야 해요.</p>
      </ConfirmDialog>

      <ReportDialog open={reportOpen} onClose={() => setReportOpen(false)} targets={isHost ? [] : reportTargets} />
    </PageContainer>
  );
}
