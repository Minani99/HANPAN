/**
 * 아주 작은 마크다운 부분집합 파서(정책 문서 전용, 의존성 없음).
 *
 * 지원: 제목(#, ##, ###), 문단, 목록(-, *, 1.), 인용(>), 표(| a | b | + 구분 줄), 구분선(---),
 *       인라인 굵게(**…**), 코드(`…`), 내부 링크([글](/경로)).
 * 보안: HTML을 해석하지 않는다. `<script>` 같은 문자열도 그대로 '글자'로 남고, 렌더러(Markdown.tsx)는
 *       React 요소만 만든다(dangerouslySetInnerHTML·innerHTML 없음). 링크는 '/'로 시작하는 내부 경로만 링크로 만들고
 *       그 밖의 주소(javascript:, http(s):// 등)는 링크 없이 글자로 둔다.
 */

export type MarkdownInline =
  | { type: 'text'; value: string }
  | { type: 'strong'; value: string }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; value: string };

export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3; children: MarkdownInline[] }
  | { type: 'paragraph'; children: MarkdownInline[] }
  | { type: 'list'; ordered: boolean; items: MarkdownInline[][] }
  | { type: 'quote'; children: MarkdownInline[] }
  | { type: 'table'; header: MarkdownInline[][]; rows: MarkdownInline[][][] }
  | { type: 'rule' };

/** 내부 경로만 링크로 만든다: '/policies/privacy', '/policies/terms#제5조' 등 */
const INTERNAL_PATH = /^\/(?!\/)[^\s\\<>"']*$/;

const INLINE_PATTERN = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseInline(text: string): MarkdownInline[] {
  const result: MarkdownInline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? 0;
    if (index > last) result.push({ type: 'text', value: text.slice(last, index) });
    const [, strong, code, linkText, href] = match;
    if (strong !== undefined) result.push({ type: 'strong', value: strong });
    else if (code !== undefined) result.push({ type: 'code', value: code });
    else if (linkText !== undefined && href !== undefined) {
      if (INTERNAL_PATH.test(href)) result.push({ type: 'link', href, value: linkText });
      else result.push({ type: 'text', value: linkText });
    }
    last = index + match[0].length;
  }
  if (last < text.length) result.push({ type: 'text', value: text.slice(last) });
  return result;
}

const HEADING = /^(#{1,3})\s+(.+)$/;
const UNORDERED_ITEM = /^[-*]\s+(.+)$/;
const ORDERED_ITEM = /^\d+[.)]\s+(.+)$/;
const QUOTE = /^>\s?(.*)$/;
const RULE = /^(-{3,}|\*{3,})$/;
const TABLE_ROW = /^\|.*\|$/;
const TABLE_SEPARATOR = /^\|(\s*:?-{3,}:?\s*\|)+$/;

function splitTableRow(line: string): string[] {
  return line
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());
}

export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  const isBlockStart = (line: string) =>
    HEADING.test(line) ||
    UNORDERED_ITEM.test(line) ||
    ORDERED_ITEM.test(line) ||
    QUOTE.test(line) ||
    RULE.test(line) ||
    TABLE_ROW.test(line);

  while (index < lines.length) {
    const line = (lines[index] ?? '').trim();
    if (line === '') {
      index += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = Math.min(heading[1]?.length ?? 1, 3) as 1 | 2 | 3;
      blocks.push({ type: 'heading', level, children: parseInline(heading[2] ?? '') });
      index += 1;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ type: 'rule' });
      index += 1;
      continue;
    }

    if (TABLE_ROW.test(line) && TABLE_SEPARATOR.test((lines[index + 1] ?? '').trim())) {
      const header = splitTableRow(line).map(parseInline);
      const rows: MarkdownInline[][][] = [];
      index += 2;
      while (index < lines.length && TABLE_ROW.test((lines[index] ?? '').trim())) {
        rows.push(splitTableRow((lines[index] ?? '').trim()).map(parseInline));
        index += 1;
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }

    const unordered = UNORDERED_ITEM.test(line);
    if (unordered || ORDERED_ITEM.test(line)) {
      const pattern = unordered ? UNORDERED_ITEM : ORDERED_ITEM;
      const items: MarkdownInline[][] = [];
      while (index < lines.length) {
        const current = (lines[index] ?? '').trim();
        const item = pattern.exec(current);
        if (!item) break;
        items.push(parseInline(item[1] ?? ''));
        index += 1;
      }
      blocks.push({ type: 'list', ordered: !unordered, items });
      continue;
    }

    if (QUOTE.test(line)) {
      const parts: string[] = [];
      while (index < lines.length) {
        const quote = QUOTE.exec((lines[index] ?? '').trim());
        if (!quote) break;
        if (quote[1]) parts.push(quote[1]);
        index += 1;
      }
      blocks.push({ type: 'quote', children: parseInline(parts.join(' ')) });
      continue;
    }

    // 문단: 빈 줄이나 다른 블록이 나올 때까지 이어 붙인다
    const parts: string[] = [line];
    index += 1;
    while (index < lines.length) {
      const next = (lines[index] ?? '').trim();
      if (next === '' || isBlockStart(next)) break;
      parts.push(next);
      index += 1;
    }
    blocks.push({ type: 'paragraph', children: parseInline(parts.join(' ')) });
  }
  return blocks;
}
