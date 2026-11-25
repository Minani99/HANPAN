import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ExternalLink } from './ExternalLink';

describe('ExternalLink', () => {
  it('https 링크는 새 창 + rel="noopener noreferrer" + 외부 표시', () => {
    render(<ExternalLink href="https://example.com/booking">예약 페이지(외부)</ExternalLink>);
    const link = screen.getByRole('link', { name: /예약 페이지\(외부\)/ });
    expect(link).toHaveAttribute('href', 'https://example.com/booking');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveTextContent('(새 창에서 열림)');
  });

  it('javascript:·http:·형식이 틀린 주소는 링크를 렌더하지 않는다', () => {
    for (const href of ['javascript:alert(1)', 'http://example.com', 'data:text/html,x', '//evil.example', null]) {
      const { container, unmount } = render(<ExternalLink href={href}>공식 홈페이지(외부)</ExternalLink>);
      expect(container.querySelector('a')).toBeNull();
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });
});
