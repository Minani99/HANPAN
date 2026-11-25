import { useMemo } from 'react';
import { Link } from 'react-router';
import { cn } from '../../lib/cn';
import { parseMarkdown, type MarkdownBlock, type MarkdownInline } from '../../lib/markdown';

/**
 * 정책 문서 렌더러. src/lib/markdown.ts가 만든 블록을 React 요소로만 그린다.
 * HTML 문자열을 삽입하지 않는다(dangerouslySetInnerHTML 금지) — 원문의 '<script>' 등은 글자로 보인다.
 * 원문의 '#'(1단계) 제목은 화면 제목(h1)과 겹치지 않도록 h2로 내려 그린다.
 */
function Inline({ nodes }: { nodes: readonly MarkdownInline[] }) {
  return (
    <>
      {nodes.map((node, index) => {
        switch (node.type) {
          case 'strong':
            return (
              <strong key={index} className="font-bold text-ink">
                {node.value}
              </strong>
            );
          case 'code':
            return (
              <code key={index} className="rounded-sm bg-soft px-1 py-0.5 text-[0.92em] text-text">
                {node.value}
              </code>
            );
          case 'link':
            return (
              <Link key={index} to={node.href} className="font-bold text-ink underline underline-offset-4">
                {node.value}
              </Link>
            );
          default:
            return <span key={index}>{node.value}</span>;
        }
      })}
    </>
  );
}

function Block({ block }: { block: MarkdownBlock }) {
  switch (block.type) {
    case 'heading': {
      if (block.level === 3) {
        return (
          <h3 className="mt-7 text-lg leading-snug font-heavy text-ink text-wrap-ko">
            <Inline nodes={block.children} />
          </h3>
        );
      }
      return (
        <h2 className="mt-10 border-t border-border pt-6 text-xl leading-snug font-heavy text-ink text-wrap-ko first:mt-0 first:border-t-0 first:pt-0">
          <Inline nodes={block.children} />
        </h2>
      );
    }
    case 'paragraph':
      return (
        <p className="mt-3 text-base leading-loose text-text text-wrap-ko">
          <Inline nodes={block.children} />
        </p>
      );
    case 'quote':
      return (
        <blockquote className="mt-4 rounded-lg border border-border bg-soft px-4 py-3 text-md leading-relaxed text-text text-wrap-ko">
          <Inline nodes={block.children} />
        </blockquote>
      );
    case 'list': {
      const ListTag = block.ordered ? 'ol' : 'ul';
      return (
        <ListTag
          className={cn(
            'mt-3 space-y-1.5 pl-5 text-base leading-relaxed text-text',
            block.ordered ? 'list-decimal' : 'list-disc',
          )}
        >
          {block.items.map((item, index) => (
            <li key={index} className="text-wrap-ko">
              <Inline nodes={item} />
            </li>
          ))}
        </ListTag>
      );
    }
    case 'table':
      return (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-left text-md leading-relaxed">
            <thead>
              <tr>
                {block.header.map((cell, index) => (
                  <th key={index} scope="col" className="border-b border-ink px-3 py-2 font-bold text-ink first:min-w-[5.5em]">
                    <Inline nodes={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, index) => (
                    <td key={index} className="border-b border-border px-3 py-2 align-top text-text text-wrap-ko first:min-w-[5.5em]">
                      <Inline nodes={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'rule':
      return <hr className="mt-8 border-border" />;
  }
}

export interface MarkdownProps {
  source: string;
  className?: string;
}

export function Markdown({ source, className }: MarkdownProps) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return (
    <div className={cn('min-w-0', className)} data-testid="markdown">
      {blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </div>
  );
}
