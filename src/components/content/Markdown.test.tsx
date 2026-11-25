import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from '../../lib/markdown';
import { renderInRouter } from '../../test/renderWithProviders';
import { Markdown } from './Markdown';

describe('lib/markdown 파서', () => {
  it('제목·문단·목록·인용·표·구분선을 블록으로 나눈다', () => {
    const blocks = parseMarkdown(
      ['## 제1조', '첫 줄', '이어지는 줄', '', '- 가', '- 나', '', '1. 하나', '2. 둘', '', '> 안내', '', '| a | b |', '|---|---|', '| 1 | 2 |', '', '---'].join(
        '\n',
      ),
    );
    expect(blocks.map((block) => block.type)).toEqual(['heading', 'paragraph', 'list', 'list', 'quote', 'table', 'rule']);
    expect(blocks[1]).toEqual({ type: 'paragraph', children: [{ type: 'text', value: '첫 줄 이어지는 줄' }] });
    expect(blocks[3]).toMatchObject({ type: 'list', ordered: true });
  });

  it('인라인: 굵게·코드·내부 링크만 링크로(외부·javascript: 링크는 글자로)', () => {
    expect(parseInline('**확정 전** 값')).toEqual([
      { type: 'strong', value: '확정 전' },
      { type: 'text', value: ' 값' },
    ]);
    expect(parseInline('[방침](/policies/privacy)')).toEqual([{ type: 'link', href: '/policies/privacy', value: '방침' }]);
    expect(parseInline('[나쁜](javascript:alert(1))')[0]).toMatchObject({ type: 'text' });
    expect(parseInline('[외부](https://example.com)')).toEqual([{ type: 'text', value: '외부' }]);
    expect(parseInline('[이중](//evil.example)')).toEqual([{ type: 'text', value: '이중' }]);
  });
});

describe('Markdown 렌더러', () => {
  it('HTML은 문자열로만 다룬다: <script>·<img onerror>가 요소가 되지 않는다', () => {
    const source = '## 제목 <b>굵게</b>\n\n<script>window.__x = 1</script>\n\n- <img src=x onerror=alert(1)>';
    const { container } = renderInRouter(<Markdown source={source} />);
    const root = screen.getByTestId('markdown');
    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('b')).toBeNull();
    expect(root).toHaveTextContent('<script>window.__x = 1</script>');
    expect(root).toHaveTextContent('<img src=x onerror=alert(1)>');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('제목 <b>굵게</b>');
    expect((window as unknown as { __x?: number }).__x).toBeUndefined();
    expect(container.innerHTML).not.toContain('<script');
  });

  it('제목(#은 h2로), 목록, 표(머리글 scope), 내부 링크를 그린다', () => {
    renderInRouter(
      <Markdown source={'# 큰 제목\n\n### 작은 제목\n\n- 항목\n\n| 구분 | 내용 |\n|---|---|\n| 가 | [약관](/policies/terms) |'} />,
    );
    expect(screen.getAllByRole('heading', { level: 2 })[0]).toHaveTextContent('큰 제목');
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('작은 제목');
    expect(screen.getByRole('listitem')).toHaveTextContent('항목');
    expect(screen.getAllByRole('columnheader').map((cell) => cell.getAttribute('scope'))).toEqual(['col', 'col']);
    expect(screen.getByRole('link', { name: '약관' })).toHaveAttribute('href', '/policies/terms');
  });
});
