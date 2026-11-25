import { Link } from 'react-router';
import { PageContainer } from './PageContainer';

const POLICY_LINKS = [
  { to: '/policies/terms', label: '이용약관(초안)' },
  { to: '/policies/privacy', label: '개인정보처리방침(초안)' },
  { to: '/policies/operations', label: '운영정책' },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-t border-border pt-4.5 pb-8 text-xs leading-normal text-muted md:pt-3 md:pb-8 md:text-sm">
      <PageContainer className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between md:gap-6">
        <p className="py-1.5">HANPAN. — 대전 보드게임 모임 서비스</p>
        <nav aria-label="약관 및 정책">
          <ul role="list" className="-mx-1.5 flex flex-wrap">
            {POLICY_LINKS.map((link) => (
              <li key={link.to}>
                <Link
                  to={link.to}
                  className="inline-flex min-h-touch items-center px-1.5 hover:text-ink hover:underline hover:underline-offset-4"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </PageContainer>
    </footer>
  );
}
