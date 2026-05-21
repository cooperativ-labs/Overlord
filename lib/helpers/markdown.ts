/**
 * A lightweight, robust utility to convert GFM (GitHub Flavored Markdown) to HTML.
 * Used primarily for generating email-safe HTML bodies from changelog markdown.
 */
export function markdownToHtml(markdown: string | null | undefined): string {
  if (!markdown) return '';

  // 1. Normalize line endings
  let html = markdown.replace(/\r\n/g, '\n');

  // 2. Escape basic HTML tags to prevent cross-site scripting/broken HTML
  html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // 3. Extract and protect code blocks
  const placeholders: { [key: string]: string } = {};
  let placeholderId = 0;

  html = html.replace(/```(\w*)\n([\s\S]*?)\n```/g, (_, lang, code) => {
    const id = `__PLACEHOLDER_CODE_BLOCK_${placeholderId++}__`;
    placeholders[id] =
      `<pre style="background:#fafafa;padding:16px;border-radius:6px;border:1px solid #e4e4e7;overflow-x:auto;margin:16px 0;"><code class="${lang ? `language-${lang}` : ''}" style="font-family:monospace;font-size:13px;color:#18181b;">${code}</code></pre>`;
    return id;
  });

  // Protect inline code
  html = html.replace(/`([^`\n]+)`/g, (_, code) => {
    const id = `__PLACEHOLDER_INLINE_CODE_${placeholderId++}__`;
    placeholders[id] =
      `<code style="background:#fafafa;padding:2px 6px;border-radius:4px;border:1px solid #e4e4e7;font-family:monospace;font-size:13px;color:#18181b;">${code}</code>`;
    return id;
  });

  // 4. Headers
  html = html.replace(/^(#{1,6})\s+(.+)$/gm, (_, hashes, content) => {
    const level = hashes.length;
    const fontSizes: { [key: number]: string } = {
      1: 'font-size:22px;margin:24px 0 12px;font-weight:700;color:#09090b;',
      2: 'font-size:18px;margin:20px 0 10px;font-weight:600;color:#09090b;',
      3: 'font-size:16px;margin:16px 0 8px;font-weight:600;color:#09090b;',
      4: 'font-size:14px;margin:14px 0 6px;font-weight:600;color:#09090b;',
      5: 'font-size:13px;margin:12px 0 6px;font-weight:600;color:#09090b;',
      6: 'font-size:12px;margin:10px 0 4px;font-weight:600;color:#71717a;'
    };
    return `<h${level} style="${fontSizes[level] || ''}">${content}</h${level}>`;
  });

  // 5. Unordered lists
  html = html.replace(/(?:^\s*[-*]\s+.+(?:\n\s*[-*]\s+.+)*)/gm, listBlock => {
    const items = listBlock
      .split('\n')
      .map(line => {
        const match = line.match(/^\s*[-*]\s+(.+)$/);
        return match ? `<li style="margin:4px 0;">${match[1]}</li>` : '';
      })
      .filter(Boolean)
      .join('');
    return `<ul style="padding-left:20px;margin:12px 0 16px;color:#27272a;">${items}</ul>`;
  });

  // 6. Ordered lists
  html = html.replace(/(?:^\s*\d+\.\s+.+(?:\n\s*\d+\.\s+.+)*)/gm, listBlock => {
    const items = listBlock
      .split('\n')
      .map(line => {
        const match = line.match(/^\s*\d+\.\s+(.+)$/);
        return match ? `<li style="margin:4px 0;">${match[1]}</li>` : '';
      })
      .filter(Boolean)
      .join('');
    return `<ol style="padding-left:20px;margin:12px 0 16px;color:#27272a;">${items}</ol>`;
  });

  // 7. Blockquotes
  html = html.replace(/^(?:&gt;\s*.+(?:\n&gt;\s*.+)*)/gm, quoteBlock => {
    const content = quoteBlock
      .split('\n')
      .map(line => line.replace(/^\s*&gt;\s*/, ''))
      .join('<br />');
    return `<blockquote style="border-left:4px solid #e4e4e7;padding-left:16px;margin:16px 0;color:#71717a;font-style:italic;">${content}</blockquote>`;
  });

  // 8. Paragraphs
  const blockTags = /^(?:<ul|<ol|<h\d|<blockquote|<pre|<hr|__PLACEHOLDER_CODE_BLOCK_)/;
  html = html
    .split(/\n{2,}/)
    .map(block => {
      const trimmed = block.trim();
      if (!trimmed) return '';
      if (blockTags.test(trimmed)) return trimmed;
      const withBreaks = trimmed.replace(/\n/g, '<br />');
      return `<p style="margin:0 0 16px;line-height:1.6;color:#27272a;">${withBreaks}</p>`;
    })
    .filter(Boolean)
    .join('\n');

  // 9. Inline formatting (Bold, Italic, Links, Images)
  // Bold
  html = html.replace(
    /\*\*([^*]+)\*\*/g,
    '<strong style="font-weight:600;color:#09090b;">$1</strong>'
  );
  html = html.replace(/__([^_]+)__/g, '<strong style="font-weight:600;color:#09090b;">$1</strong>');

  // Italic
  html = html.replace(/\*([^*]+)\*/g, '<em style="font-style:italic;">$1</em>');
  html = html.replace(/_([^_]+)_/g, '<em style="font-style:italic;">$1</em>');

  // Images
  html = html.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    '<img src="$2" alt="$1" style="max-width:100%;height:auto;border-radius:6px;margin:16px 0;" />'
  );

  // Links
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" style="color:#0284c7;text-decoration:underline;">$1</a>'
  );

  // Horizontal Rule
  html = html.replace(
    /^---$/gm,
    '<hr style="border:0;border-top:1px solid #e4e4e7;margin:24px 0;" />'
  );

  // 10. Restore code blocks and inline code
  for (const id in placeholders) {
    html = html.replace(id, placeholders[id]);
  }

  return html;
}
