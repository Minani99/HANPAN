import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { BackLink } from '../components/layout/BackLink';
import { PageContainer } from '../components/layout/PageContainer';
import { PageTitle } from '../components/layout/PageTitle';
import { InfoState, PageSkeleton } from '../components/layout/PageStates';
import { MeetingForm } from '../components/meeting/MeetingForm';
import { meetingPath } from '../components/meeting/MeetingRow';
import { useMeetingFormOptions } from '../components/meeting/useMeetingFormOptions';
import { ButtonLink } from '../components/ui/Button';
import { useToast } from '../components/ui/Toast';
import { useDataAdapter } from '../data';
import type { MeetingInput } from '../data/types';
import { createDefaultMeetingValues } from '../domain/meetingSchema';
import { useDocumentTitle } from '../lib/useDocumentTitle';

/** 모임 만들기 (`/meetings/new`, 로그인·최초 설정 필요 — RequireAuth) */
export function MeetingCreatePage() {
  useDocumentTitle('모임 만들기');
  const adapter = useDataAdapter();
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [initialValues] = useState(() => createDefaultMeetingValues(new Date()));
  const options = useMeetingFormOptions();

  if (user && user.status !== 'active') {
    return (
      <InfoState
        title="지금은 모임을 만들 수 없어요."
        description={
          user.status === 'restricted' ? '이용이 제한된 계정이에요.' : '탈퇴 요청된 계정은 모임을 만들 수 없어요.'
        }
        actions={<ButtonLink to="/">홈으로 가기</ButtonLink>}
      />
    );
  }

  if (options.status === 'loading') return <PageSkeleton label="모임 만들기 화면을 준비하는 중이에요." />;

  const handleSubmit = async (input: MeetingInput) => {
    const id = await adapter.createMeeting(input);
    navigate(meetingPath(id), { replace: true });
    toast.show('모임을 만들었어요.', { tone: 'success' });
  };

  return (
    <PageContainer className="pt-2 pb-12 md:pt-4 md:pb-20">
      <BackLink label="돌아가기" />
      <PageTitle title="모임 만들기" description="필수 항목만 채우면 바로 모임을 열 수 있어요. 정원은 모임장을 포함한 전체 인원이에요." />
      <MeetingForm
        mode="create"
        initialValues={initialValues}
        venues={options.data?.venues ?? []}
        venuesUnavailable={options.data?.venuesUnavailable ?? true}
        activeCategoryIds={options.data?.activeCategoryIds ?? undefined}
        onSubmit={handleSubmit}
        cancelTo="/"
      />
    </PageContainer>
  );
}
