import { isRouteErrorResponse, useRouteError } from 'react-router';
import { PageContainer } from '../components/layout/PageContainer';
import { ErrorState } from '../components/ui/ErrorState';
import { getUnexpectedErrorDescription } from '../domain/errorMessages';
import { devError } from '../lib/devConsole';
import { NotFoundPage } from './NotFoundPage';

/**
 * 라우트 오류 경계. 화면 코드(lazy 청크) 로딩 실패, 렌더 오류, 화면이 처리하지 못한 데이터 계층 오류(DataAdapterError)를
 * 사용자 문구로 보여준다(데이터 오류는 코드별 문구 — 연결 불안정·서비스 준비 중 등).
 * 오류 상세는 화면에 노출하지 않고 개발 모드 콘솔에만 남긴다(운영 빌드 콘솔에는 남기지 않는다).
 */
export function RouteErrorPage() {
  const error = useRouteError();

  if (isRouteErrorResponse(error) && error.status === 404) {
    return <NotFoundPage />;
  }

  devError('[HANPAN] route error', error);

  return (
    <PageContainer>
      <ErrorState
        headingLevel="h2"
        title="화면을 불러오지 못했어요."
        description={getUnexpectedErrorDescription(error)}
        retryLabel="새로고침"
        onRetry={() => window.location.reload()}
      />
    </PageContainer>
  );
}
