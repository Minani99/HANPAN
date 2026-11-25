import type { ReactNode } from 'react';
import { ButtonLink } from '../ui/Button';
import { ErrorState } from '../ui/ErrorState';
import { Skeleton } from '../ui/Skeleton';
import { PageContainer } from './PageContainer';

/** 화면 단위 상태(권한 없음·없음·오류·로딩). 각 화면은 h1을 하나 가진다. */

function StateLayout({ eyebrow, title, description, actions }: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <PageContainer className="py-16 md:py-24">
      <div className="mx-auto max-w-xl text-center">
        {eyebrow ? <p className="text-md font-bold text-muted">{eyebrow}</p> : null}
        <h1 className="mt-3 text-3xl leading-tight font-heavy tracking-section text-ink text-wrap-ko md:text-4xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-3 text-base leading-relaxed text-muted text-wrap-ko">{description}</p>
        ) : null}
        {actions ? <div className="mt-8 flex flex-wrap justify-center gap-2">{actions}</div> : null}
      </div>
    </PageContainer>
  );
}

export function ForbiddenState({
  description = '이 화면은 모임장만 볼 수 있어요.',
  actions,
}: {
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <StateLayout
      title="접근 권한이 없어요."
      description={description}
      actions={actions ?? <ButtonLink to="/">홈으로 가기</ButtonLink>}
    />
  );
}

export function MeetingNotFoundState() {
  return (
    <StateLayout
      eyebrow="모임 없음"
      title="모임을 찾을 수 없어요."
      description="삭제되었거나 비공개 처리됐을 수 있어요."
      actions={<ButtonLink to="/">모임 찾기로 가기</ButtonLink>}
    />
  );
}

export function InfoState({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return <StateLayout title={title} description={description} actions={actions} />;
}

export function PageErrorState({ title = '정보를 불러오지 못했어요.', onRetry }: { title?: string; onRetry: () => void }) {
  return (
    <PageContainer>
      <ErrorState headingLevel="h2" title={title} onRetry={onRetry} />
    </PageContainer>
  );
}

/** 제목·본문 모양 스켈레톤 */
export function PageSkeleton({ label = '정보를 불러오는 중이에요.' }: { label?: string }) {
  return (
    <PageContainer className="py-6 md:py-10" data-testid="page-loading">
      <div aria-busy="true">
        <p role="status" className="sr-only">
          {label}
        </p>
        <div aria-hidden="true" className="max-w-3xl space-y-4">
          <Skeleton className="h-5 w-40 rounded-sm" />
          <Skeleton className="h-8 w-11/12 md:h-9" />
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="mt-8 h-32 w-full" />
          <Skeleton className="h-5 w-1/2" />
        </div>
      </div>
    </PageContainer>
  );
}
