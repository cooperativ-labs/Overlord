import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const entryFile = path.join(repoRoot, 'mcp-apps/ticket-card/src/main.tsx');
const outputFile = path.join(
  repoRoot,
  'supabase/functions/mcp/ui/ticket-card-resource.ts'
);

const styles = `
:root {
  color-scheme: light dark;
}

* {
  box-sizing: border-box;
}

html,
body,
#root {
  margin: 0;
  min-height: 100%;
}

body {
  background:
    radial-gradient(circle at top left, rgba(251, 191, 36, 0.22), transparent 32%),
    radial-gradient(circle at bottom right, rgba(16, 185, 129, 0.2), transparent 28%),
    linear-gradient(180deg, rgba(250, 250, 249, 0.98), rgba(245, 245, 244, 0.98));
  color: #1c1917;
  font-family:
    "Iowan Old Style",
    "Palatino Linotype",
    "Book Antiqua",
    Georgia,
    serif;
  padding: 14px;
}

body[data-theme='dark'] {
  background:
    radial-gradient(circle at top left, rgba(251, 191, 36, 0.18), transparent 30%),
    radial-gradient(circle at bottom right, rgba(16, 185, 129, 0.18), transparent 28%),
    linear-gradient(180deg, rgba(28, 25, 23, 0.98), rgba(17, 24, 39, 0.98));
  color: #f5f5f4;
}

.ticket-card-shell {
  width: 100%;
}

.ticket-card-panel {
  backdrop-filter: blur(18px);
  background: rgba(255, 255, 255, 0.76);
  border: 1px solid rgba(28, 25, 23, 0.08);
  border-radius: 24px;
  box-shadow: 0 18px 60px rgba(28, 25, 23, 0.12);
  overflow: hidden;
  position: relative;
}

body[data-theme='dark'] .ticket-card-panel {
  background: rgba(28, 25, 23, 0.72);
  border-color: rgba(255, 255, 255, 0.12);
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.34);
}

.ticket-card-panel::before {
  background: linear-gradient(90deg, #f59e0b, #10b981);
  content: '';
  display: block;
  height: 4px;
  width: 100%;
}

.ticket-card-header,
.ticket-card-grid,
.ticket-card-aside,
.ticket-card-footer {
  padding-left: 18px;
  padding-right: 18px;
}

.ticket-card-header {
  align-items: flex-start;
  display: flex;
  gap: 16px;
  justify-content: space-between;
  padding-top: 18px;
}

.ticket-card-eyebrow {
  font-family:
    ui-sans-serif,
    system-ui,
    sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  margin: 0 0 8px;
  text-transform: uppercase;
}

.ticket-card-header h1 {
  font-size: clamp(1.35rem, 2vw, 1.72rem);
  line-height: 1.06;
  margin: 0;
}

.ticket-card-intro {
  color: rgba(28, 25, 23, 0.72);
  font-family:
    ui-sans-serif,
    system-ui,
    sans-serif;
  font-size: 0.95rem;
  line-height: 1.45;
  margin: 12px 18px 0;
}

body[data-theme='dark'] .ticket-card-intro {
  color: rgba(245, 245, 244, 0.72);
}

.ticket-card-priority {
  border-radius: 999px;
  font-family:
    ui-sans-serif,
    system-ui,
    sans-serif;
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 8px 12px;
  text-transform: uppercase;
  white-space: nowrap;
}

.ticket-card-priority-low {
  background: rgba(148, 163, 184, 0.14);
  color: #475569;
}

.ticket-card-priority-medium {
  background: rgba(59, 130, 246, 0.14);
  color: #1d4ed8;
}

.ticket-card-priority-high {
  background: rgba(249, 115, 22, 0.14);
  color: #c2410c;
}

.ticket-card-priority-urgent {
  background: rgba(220, 38, 38, 0.14);
  color: #b91c1c;
}

.ticket-card-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  padding-top: 18px;
}

.ticket-card-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ticket-card-field-full {
  grid-column: 1 / -1;
}

.ticket-card-field > span,
.ticket-card-meta-label {
  color: rgba(28, 25, 23, 0.68);
  font-family:
    ui-sans-serif,
    system-ui,
    sans-serif;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

body[data-theme='dark'] .ticket-card-field > span,
body[data-theme='dark'] .ticket-card-meta-label {
  color: rgba(245, 245, 244, 0.66);
}

.ticket-card-input,
.ticket-card-select,
.ticket-card-textarea {
  appearance: none;
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(28, 25, 23, 0.12);
  border-radius: 16px;
  color: inherit;
  font: inherit;
  padding: 13px 14px;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.2s ease;
  width: 100%;
}

body[data-theme='dark'] .ticket-card-input,
body[data-theme='dark'] .ticket-card-select,
body[data-theme='dark'] .ticket-card-textarea {
  background: rgba(17, 24, 39, 0.72);
  border-color: rgba(255, 255, 255, 0.14);
}

.ticket-card-input:focus,
.ticket-card-select:focus,
.ticket-card-textarea:focus {
  border-color: rgba(16, 185, 129, 0.7);
  box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.14);
  outline: none;
  transform: translateY(-1px);
}

.ticket-card-textarea {
  min-height: 190px;
  resize: vertical;
}

.ticket-card-field small {
  color: rgba(28, 25, 23, 0.58);
  font-family:
    ui-sans-serif,
    system-ui,
    sans-serif;
  font-size: 0.82rem;
  line-height: 1.35;
}

body[data-theme='dark'] .ticket-card-field small {
  color: rgba(245, 245, 244, 0.6);
}

.ticket-card-aside {
  background: rgba(28, 25, 23, 0.04);
  border-top: 1px solid rgba(28, 25, 23, 0.08);
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-top: 18px;
  padding-bottom: 16px;
  padding-top: 16px;
}

body[data-theme='dark'] .ticket-card-aside {
  background: rgba(255, 255, 255, 0.04);
  border-top-color: rgba(255, 255, 255, 0.1);
}

.ticket-card-meta-value {
  font-family:
    ui-sans-serif,
    system-ui,
    sans-serif;
  font-size: 0.93rem;
  line-height: 1.5;
  margin: 4px 0 0;
}

.ticket-card-summary {
  color: rgba(28, 25, 23, 0.74);
}

body[data-theme='dark'] .ticket-card-summary {
  color: rgba(245, 245, 244, 0.74);
}

.ticket-card-footer {
  align-items: center;
  display: flex;
  gap: 16px;
  justify-content: space-between;
  padding-bottom: 18px;
  padding-top: 18px;
}

.ticket-card-status {
  color: rgba(28, 25, 23, 0.78);
  flex: 1;
  font-family:
    ui-sans-serif,
    system-ui,
    sans-serif;
  font-size: 0.9rem;
  line-height: 1.4;
}

body[data-theme='dark'] .ticket-card-status {
  color: rgba(245, 245, 244, 0.8);
}

.ticket-card-button {
  background: linear-gradient(135deg, #111827, #065f46);
  border: 0;
  border-radius: 999px;
  color: white;
  cursor: pointer;
  font-family:
    ui-sans-serif,
    system-ui,
    sans-serif;
  font-size: 0.94rem;
  font-weight: 700;
  min-height: 46px;
  padding: 0 18px;
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.ticket-card-button:hover:not(:disabled) {
  transform: translateY(-1px);
}

.ticket-card-button:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

@media (max-width: 720px) {
  body {
    padding: 10px;
  }

  .ticket-card-header,
  .ticket-card-footer {
    flex-direction: column;
    align-items: stretch;
  }

  .ticket-card-grid,
  .ticket-card-aside {
    grid-template-columns: 1fr;
  }

  .ticket-card-button {
    width: 100%;
  }
}
`;

const result = await build({
  entryPoints: [entryFile],
  bundle: true,
  format: 'iife',
  jsx: 'automatic',
  legalComments: 'none',
  minify: true,
  platform: 'browser',
  target: ['es2020'],
  write: false
});

const js = result.outputFiles[0]?.text;

if (!js) {
  throw new Error('esbuild did not return an output file for the ticket card app.');
}

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, viewport-fit=cover"
    />
    <title>Overlord Ticket Draft</title>
    <style>${styles}</style>
  </head>
  <body>
    <div id="root"></div>
    <script>${js.replaceAll('</script>', '<\\/script>')}</script>
  </body>
</html>`;

const fileContents = `export const TICKET_CARD_RESOURCE_URI = 'ui://overlord/ticket-card';
export const TICKET_CARD_MIME_TYPE = 'text/html;profile=mcp-app';
export const TICKET_CARD_HTML = ${JSON.stringify(html)};
`;

await mkdir(path.dirname(outputFile), { recursive: true });
await writeFile(outputFile, fileContents, 'utf8');

process.stdout.write(`Wrote ${path.relative(repoRoot, outputFile)}\n`);
