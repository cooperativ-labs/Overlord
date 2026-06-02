#!/usr/bin/env node
/**
 * Prebuild sync for docs/public:
 * - Captures `ovld protocol help` → docs/public/ovld-protocol-help.txt
 * - Scans docs/public/*.md → lib/agent-docs-manifest.json
 *
 * Exits 0 when ovld is unavailable so Vercel builds still succeed (existing files kept).
 */
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const docsPublicDir = resolve(repoRoot, 'docs', 'public');
const protocolHelpPath = resolve(docsPublicDir, 'ovld-protocol-help.txt');
const manifestPath = resolve(repoRoot, 'lib', 'agent-docs-manifest.json');

const MANIFEST_ORDER = [
  'value-proposition.md',
  'new-user-onboarding.md',
  'users-guide.md',
  'overlord-examples.md',
  'feed-page-functionality.md',
  'auto-advance-flow.md',
  'execution-targets-resources-runner.md'
];

function parseMarkdownDoc({ content, filename }) {
  const slug = filename.replace(/\.md$/, '');
  const lines = content.split('\n');
  let title = slug;
  let description = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('# ')) {
      continue;
    }

    title = line.slice(2).trim();

    for (let j = i + 1; j < lines.length; j++) {
      const candidate = lines[j].trim();
      if (!candidate) {
        continue;
      }
      if (candidate.startsWith('#')) {
        break;
      }
      description = candidate.replace(/^>\s*/, '');
      break;
    }
    break;
  }

  if (description.length > 200) {
    description = `${description.slice(0, 197)}...`;
  }

  return { slug, filename, title, description };
}

function syncAgentDocsManifest() {
  const markdownFiles = readdirSync(docsPublicDir)
    .filter(name => name.endsWith('.md'))
    .sort((a, b) => {
      const aIndex = MANIFEST_ORDER.indexOf(a);
      const bIndex = MANIFEST_ORDER.indexOf(b);
      const aRank = aIndex === -1 ? MANIFEST_ORDER.length : aIndex;
      const bRank = bIndex === -1 ? MANIFEST_ORDER.length : bIndex;
      if (aRank !== bRank) {
        return aRank - bRank;
      }
      return a.localeCompare(b);
    });

  const manifest = markdownFiles.map(filename => {
    const content = readFileSync(resolve(docsPublicDir, filename), 'utf8');
    return parseMarkdownDoc({ content, filename });
  });

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(
    '[generate-protocol-help] Agent docs manifest:',
    manifest.map(doc => doc.filename).join(', ')
  );
}

try {
  const help = execSync('ovld protocol help', {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  });
  writeFileSync(protocolHelpPath, help, 'utf8');
  console.log('[generate-protocol-help] Written to', protocolHelpPath);
} catch {
  console.log(
    '[generate-protocol-help] ovld not available, skipping protocol help (existing file kept).'
  );
}

syncAgentDocsManifest();
console.log('[generate-protocol-help] Written to', manifestPath);
