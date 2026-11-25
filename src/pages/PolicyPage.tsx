import { NavLink, useParams } from 'react-router';
import { Markdown } from '../components/content/Markdown';
import { PageContainer } from '../components/layout/PageContainer';
import { PageTitle } from '../components/layout/PageTitle';
import { Notice } from '../components/ui/Notice';
import { POLICIES, POLICY_DRAFT_NOTICE, findPolicy } from '../content/policies';
import { cn } from '../lib/cn';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { NotFoundPage } from './NotFoundPage';

/**
 * 정책 문서 (`/policies/:slug` — terms·privacy·operations). 그 밖의 slug는 404.
 * 모든 문서는 운영자·법률 검토 전 초안이며 화면 맨 위에 그 사실을 표시한다.
 */
export function PolicyPage() {
  const { slug } = useParams();
  const policy = findPolicy(slug);
  useDocumentTitle(policy ? policy.title : '페이지를 찾을 수 없어요');
  if (!policy) return <NotFoundPage />;

  return (
    <PageContainer className="pt-2 pb-12 md:pt-4 md:pb-20">
      <div className="max-w-3xl">
        <nav aria-label="정책 문서" className="scrollbar-none -mx-1 mt-2 flex gap-1 overflow-x-auto px-1 md:mt-4">
          {POLICIES.map((item) => (
            <NavLink
              key={item.slug}
              to={`/policies/${item.slug}`}
              className={({ isActive }) =>
                cn(
                  'inline-flex min-h-touch shrink-0 items-center rounded-lg px-3 text-md font-bold whitespace-nowrap',
                  isActive ? 'bg-ink text-white' : 'text-text hover:bg-soft hover:text-ink',
                )
              }
            >
              {item.title.replace('(초안)', '')}
            </NavLink>
          ))}
        </nav>
        <PageTitle title={policy.title} description={policy.summary} />
        <Notice tone="warning" title="초안" className="mb-8" data-testid="policy-draft-banner">
          {POLICY_DRAFT_NOTICE}
        </Notice>
        <Markdown source={policy.source} />
      </div>
    </PageContainer>
  );
}
