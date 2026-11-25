import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { safeExternalUrl } from '../../lib/externalUrl';
import { Icon } from './Icon';

export interface ExternalLinkProps {
  /** 외부 주소. https://가 아니거나 형식이 틀리면 아무것도 렌더하지 않는다 */
  href: string | null | undefined;
  /** 링크 문구(예: '공식 홈페이지(외부)') — '외부'임을 문구에 함께 적는다 */
  children: ReactNode;
  className?: string;
  'data-testid'?: string;
}

/**
 * 외부 사이트 링크(새 창). docs/SECURITY.md §6
 * - https만 링크로 만든다(javascript:·data:·http: 등은 렌더하지 않음 — src/lib/externalUrl.ts)
 * - target="_blank" + rel="noopener noreferrer"(window.opener·리퍼러 차단)
 * - 외부 아이콘 + 스크린리더용 '새 창에서 열림'
 */
export function ExternalLink({ href, children, className, 'data-testid': testId }: ExternalLinkProps) {
  const safe = safeExternalUrl(href);
  if (!safe) return null;
  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      data-testid={testId}
      className={cn(
        'inline-flex min-h-touch items-center gap-1.5 rounded-lg font-bold text-ink underline underline-offset-4 hover:text-text',
        className,
      )}
    >
      {children}
      <Icon name="external-link" size="1.05em" />
      <span className="sr-only">(새 창에서 열림)</span>
    </a>
  );
}
