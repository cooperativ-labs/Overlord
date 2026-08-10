import { Fragment, type ReactNode } from 'react';

/**
 * Minimal, dependency-free markdown renderer for short event summaries.
 *
 * The webapp ships no markdown library, and event summaries are authored by
 * agents/CLI using a small, predictable subset of markdown (headings, bold,
 * italics, inline code, fenced code, lists, blockquotes, links, rules, tables).
 * This
 * renderer covers that subset and deliberately ignores exotic syntax rather
 * than pulling in a full CommonMark parser. Output is real React elements
 * (no `dangerouslySetInnerHTML`), so untrusted text can never inject markup.
 */

type InlineToken =
  | { kind: 'text'; value: string }
  | { kind: 'code'; value: string }
  | { kind: 'strong'; value: string }
  | { kind: 'em'; value: string }
  | { kind: 'link'; value: string; href: string };

// Ordered so the earliest match at each position wins (code before emphasis so
// `**` inside backticks is left literal).
const INLINE_PATTERNS: Array<{ kind: InlineToken['kind']; re: RegExp }> = [
  { kind: 'code', re: /`([^`]+)`/ },
  { kind: 'link', re: /\[([^\]]+)\]\(([^)\s]+)\)/ },
  { kind: 'strong', re: /\*\*([^*]+)\*\*/ },
  { kind: 'strong', re: /__([^_]+)__/ },
  { kind: 'em', re: /\*([^*]+)\*/ },
  { kind: 'em', re: /_([^_]+)_/ }
];

function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let rest = text;

  while (rest.length > 0) {
    let best: { index: number; length: number; token: InlineToken } | null = null;

    for (const { kind, re } of INLINE_PATTERNS) {
      const match = re.exec(rest);
      if (!match) continue;
      if (best && match.index >= best.index) continue;
      const token: InlineToken =
        kind === 'link'
          ? { kind: 'link', value: match[1], href: match[2] }
          : ({ kind, value: match[1] } as InlineToken);
      best = { index: match.index, length: match[0].length, token };
    }

    if (!best) {
      tokens.push({ kind: 'text', value: rest });
      break;
    }

    if (best.index > 0) {
      tokens.push({ kind: 'text', value: rest.slice(0, best.index) });
    }
    tokens.push(best.token);
    rest = rest.slice(best.index + best.length);
  }

  return tokens;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return parseInline(text).map((token, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (token.kind) {
      case 'strong':
        return (
          <strong key={key} className="font-semibold">
            {token.value}
          </strong>
        );
      case 'em':
        return (
          <em key={key} className="italic">
            {token.value}
          </em>
        );
      case 'code':
        return (
          <code
            key={key}
            className="rounded-sm bg-(--color-surface-2) px-1 py-0.5 font-mono text-[0.85em]"
          >
            {token.value}
          </code>
        );
      case 'link':
        if (!isSafeLinkHref(token.href)) {
          return <Fragment key={key}>{token.value}</Fragment>;
        }
        return (
          <a
            key={key}
            href={token.href}
            target="_blank"
            rel="noreferrer"
            className="text-sky-600 underline underline-offset-2 dark:text-sky-400"
          >
            {token.value}
          </a>
        );
      default:
        return <Fragment key={key}>{token.value}</Fragment>;
    }
  });
}

function isSafeLinkHref(href: string): boolean {
  if (href.startsWith('/') && !href.startsWith('//')) return true;
  if (href.startsWith('./') || href.startsWith('../') || href.startsWith('#')) return true;
  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:';
  } catch {
    return false;
  }
}

type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'code'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'hr' }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'p'; text: string };

function parseTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
  return trimmed.split('|').map(cell => cell.trim());
}

function isTableSeparator(line: string): boolean {
  const cells = parseTableRow(line);
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
}

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block.
    if (/^```/.test(line.trim())) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1; // skip closing fence
      blocks.push({ type: 'code', text: code.join('\n') });
      continue;
    }

    // Blank line.
    if (line.trim() === '') {
      i += 1;
      continue;
    }

    // Horizontal rule.
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }

    // Heading.
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() });
      i += 1;
      continue;
    }

    // Unordered list.
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
        i += 1;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    // Ordered list.
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
        i += 1;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    // GFM table — header row, separator row, then body rows.
    if (line.includes('|')) {
      const tableLines: string[] = [];
      let j = i;
      while (j < lines.length && lines[j].includes('|') && lines[j].trim() !== '') {
        tableLines.push(lines[j]);
        j += 1;
      }
      if (tableLines.length >= 2 && isTableSeparator(tableLines[1])) {
        const headers = parseTableRow(tableLines[0]);
        const rows = tableLines.slice(2).map(parseTableRow);
        blocks.push({ type: 'table', headers, rows });
        i = j;
        continue;
      }
    }

    // Blockquote.
    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      blocks.push({ type: 'quote', text: quote.join('\n') });
      continue;
    }

    // Paragraph — gather consecutive non-blank lines that don't start a block.
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== '') {
      const l = lines[i];
      if (
        /^```/.test(l.trim()) ||
        /^(#{1,6})\s+/.test(l) ||
        /^\s*[-*+]\s+/.test(l) ||
        /^\s*\d+[.)]\s+/.test(l) ||
        /^\s*>\s?/.test(l) ||
        /^(-{3,}|\*{3,}|_{3,})$/.test(l.trim()) ||
        (l.includes('|') &&
          i + 1 < lines.length &&
          lines[i + 1].includes('|') &&
          isTableSeparator(lines[i + 1]))
      ) {
        break;
      }
      para.push(l);
      i += 1;
    }
    blocks.push({ type: 'p', text: para.join('\n') });
  }

  return blocks;
}

/**
 * Renders a markdown string as styled React elements. Intended for the
 * expanded "detail" state of an activity-feed event, where formatting should
 * be visible and legible.
 */
export function Markdown({ text }: { text: string }) {
  const blocks = parseBlocks(text);

  return (
    <div className="grid gap-2 text-sm leading-relaxed text-(--color-ink)">
      {blocks.map((block, i) => {
        const key = `b-${i}`;
        switch (block.type) {
          case 'heading': {
            const size =
              block.level <= 1
                ? 'text-base font-semibold'
                : block.level === 2
                  ? 'text-sm font-semibold'
                  : 'text-sm font-medium';
            return (
              <div key={key} className={size}>
                {renderInline(block.text, key)}
              </div>
            );
          }
          case 'code':
            return (
              <pre
                key={key}
                className="overflow-x-auto rounded-sm bg-(--color-surface-2) p-2 font-mono text-[0.8rem] leading-snug"
              >
                <code>{block.text}</code>
              </pre>
            );
          case 'ul':
            return (
              <ul key={key} className="ml-4 list-disc space-y-0.5">
                {block.items.map((item, j) => (
                  <li key={`${key}-${j}`}>{renderInline(item, `${key}-${j}`)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={key} className="ml-4 list-decimal space-y-0.5">
                {block.items.map((item, j) => (
                  <li key={`${key}-${j}`}>{renderInline(item, `${key}-${j}`)}</li>
                ))}
              </ol>
            );
          case 'quote':
            return (
              <blockquote
                key={key}
                className="border-l-2 border-(--color-border) pl-3 italic text-(--color-ink-dim)"
              >
                {renderInline(block.text, key)}
              </blockquote>
            );
          case 'hr':
            return <hr key={key} className="border-(--color-border)" />;
          case 'table':
            return (
              <div key={key} className="overflow-x-auto">
                <table className="w-full min-w-max border-collapse text-sm">
                  <thead>
                    <tr>
                      {block.headers.map((header, j) => (
                        <th
                          key={`${key}-h-${j}`}
                          className="border border-(--color-border) bg-(--color-surface-2) px-2 py-1 text-left font-semibold"
                        >
                          {renderInline(header, `${key}-h-${j}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={`${key}-r-${r}`}>
                        {block.headers.map((_, c) => (
                          <td
                            key={`${key}-r-${r}-c-${c}`}
                            className="border border-(--color-border) px-2 py-1 align-top"
                          >
                            {renderInline(row[c] ?? '', `${key}-r-${r}-c-${c}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return (
              <p key={key} className="whitespace-pre-wrap wrap-anywhere">
                {renderInline(block.text, key)}
              </p>
            );
        }
      })}
    </div>
  );
}
