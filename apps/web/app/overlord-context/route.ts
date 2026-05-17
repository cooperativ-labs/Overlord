import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { NextResponse } from 'next/server';

export const dynamic = 'force-static';

const marketingPositioningPath = path.join(
  process.cwd(),
  '..',
  '..',
  'docs',
  'public',
  'Marketing-and-positioning.md'
);

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export async function GET() {
  const content = await readFile(marketingPositioningPath, 'utf8');

  return new NextResponse(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Overlord Marketing and Positioning Context</title>
</head>
<body>
<pre>${escapeHtml(content)}</pre>
</body>
</html>
`,
    {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=300, s-maxage=3600'
      }
    }
  );
}
