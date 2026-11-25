import { useNavigate, useParams } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { BackLink } from '../components/layout/BackLink';
import { PageContainer } from '../components/layout/PageContainer';
import { PageTitle } from '../components/layout/PageTitle';
import {
  ForbiddenState,
  InfoState,
  MeetingNotFoundState,
  PageErrorState,
  PageSkeleton,
} from '../components/layout/PageStates';
import { MeetingForm } from '../components/meeting/MeetingForm';
import { meetingPath } from '../components/meeting/MeetingRow';
import { useMeetingFormOptions } from '../components/meeting/useMeetingFormOptions';
import { ButtonLink } from '../components/ui/Button';
import { Notice } from '../components/ui/Notice';
import { useToast } from '../components/ui/Toast';
import { useDataAdapter } from '../data';
import type { MeetingInput } from '../data/types';
import { useAsyncData } from '../data/useAsyncData';
import { getMeetingPhase } from '../domain/meetingPhase';
import { meetingToFormValues } from '../domain/meetingSchema';
import { useDocumentTitle } from '../lib/useDocumentTitle';

/** 모임 수정 (`/meetings/:id/edit`). 모임장만, 시작 전·취소 전에만 */
export function MeetingEditPage() {
  useDocumentTitle('모임 수정');
  const { id = '' } = useParams();
  const adapter = useDataAdapter();
  const { user, userKey } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const detail = useAsyncData(`edit:${id}:${userKey}`, async () => ({
    meeting: await adapter.getMeeting(id),
    loadedAt: new Date(),
  }));
  const options = useMeetingFormOptions();

  if (detail.status === 'loading' || options.status === 'loading') return <PageSkeleton label="모임 정보를 불러오는 중이에요." />;
  if (detail.status === 'error' || !detail.data) {
    return <PageErrorState title="모임 정보를 불러오지 못했어요." onRetry={detail.retry} />;
  }
  const { meeting, loadedAt } = detail.data;
  if (!meeting) return <MeetingNotFoundState />;
  if (!user || meeting.hostId !== user.id) {
    return <ForbiddenState description="모임 정보는 모임장만 수정할 수 있어요." />;
  }

  const phase = getMeetingPhase(meeting, loadedAt);
  if (phase === 'cancelled' || phase === 'in_progress' || phase === 'finished') {
    const reason =
      phase === 'cancelled'
        ? '취소된 모임은 수정할 수 없어요.'
        : '이미 시작했거나 끝난 모임은 수정할 수 없어요.';
    return (
      <InfoState
        title="이 모임은 더 이상 수정할 수 없어요"
        description={reason}
        actions={<ButtonLink to={meetingPath(meeting.id)}>상세로 가기</ButtonLink>}
      />
    );
  }

  const handleSubmit = async (input: MeetingInput) => {
    await adapter.updateMeeting(meeting.id, input);
    navigate(meetingPath(meeting.id), { replace: true });
    toast.show('수정한 내용을 저장했어요.', { tone: 'success' });
  };

  return (
    <PageContainer className="pt-2 pb-12 md:pt-4 md:pb-20">
      <BackLink to={meetingPath(meeting.id)} label="모임 상세" />
      <PageTitle title="모임 수정" description={meeting.title} />
      <MeetingForm
        key={meeting.id}
        mode="edit"
        initialValues={meetingToFormValues(meeting)}
        originalStartAt={meeting.startAt}
        confirmedCount={meeting.confirmedCount}
        venueName={meeting.venueName}
        venues={options.data?.venues ?? []}
        venuesUnavailable={options.data?.venuesUnavailable ?? true}
        activeCategoryIds={options.data?.activeCategoryIds ?? undefined}
        onSubmit={handleSubmit}
        cancelTo={meetingPath(meeting.id)}
        intro={
          <Notice tone="info" className="mb-6" data-testid="edit-notice">
            일정이나 장소를 바꿔도 참가자에게 자동 알림이 가지 않아요. 참가자는 모임 상세에서 바뀐 내용을 확인해요.
          </Notice>
        }
      />
    </PageContainer>
  );
}
