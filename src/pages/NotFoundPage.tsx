import { PageContainer } from '../components/layout/PageContainer';
import { ButtonLink } from '../components/ui/Button';
import { useDocumentTitle } from '../lib/useDocumentTitle';

export function NotFoundPage() {
  useDocumentTitle('페이지를 찾을 수 없어요');
  return (
    <PageContainer className="py-16 md:py-24">
      <div className="mx-auto max-w-xl text-center">
        <p className="font-brand text-md font-black tracking-tight text-muted">404</p>
        <h1 className="mt-3 text-hero-sm leading-hero font-extrabold tracking-hero-sm text-ink text-wrap-ko">
          페이지를 찾을 수 없어요
        </h1>
        <p className="mt-3 text-base leading-relaxed text-muted text-wrap-ko">
          주소가 바뀌었거나 삭제된 페이지일 수 있어요.
        </p>
        <div className="mt-8 flex justify-center">
          <ButtonLink to="/">모임 찾기로 가기</ButtonLink>
        </div>
      </div>
    </PageContainer>
  );
}
