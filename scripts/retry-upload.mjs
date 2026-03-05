#!/usr/bin/env node
/**
 * Re-upload existing release artifacts without rebuilding or bumping version.
 * Usage: yarn electron:upload:retry
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BUCKET = 'app-downloads';
const PREFIX = 'electron';

// Load .env.prod
try {
  const content = readFileSync(join(ROOT, '.env.prod'), 'utf8');
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    process.env[key] = val;
  }
} catch {}

const supabaseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '').trim();
if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Set in .env.prod or environment.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const releaseDir = join(ROOT, 'release');
const files = readdirSync(releaseDir, { withFileTypes: true })
  .filter((e) => e.isFile())
  .map((e) => ({ path: join(releaseDir, e.name), name: e.name }));

const versionPrefix = `${PREFIX}/${version}`;

function prefixLatestYamlPaths(content, ver) {
  return content
    .split('\n')
    .map((line) => {
      for (const key of ['url', 'path']) {
        const regex = new RegExp(`^(\\s*(?:-\\s+)?${key}:\\s*)(['"]?)([^'"\\n]+)\\2(\\s*)$`);
        const match = line.match(regex);
        if (match) {
          const [, prefix, quote, value, suffix] = match;
          const trimmed = value.trim();
          if (trimmed && !trimmed.startsWith('http') && !trimmed.startsWith(`${ver}/`)) {
            line = `${prefix}${quote}${ver}/${trimmed}${quote}${suffix}`;
          }
        }
      }
      return line;
    })
    .join('\n');
}

async function main() {
  console.log(`Uploading ${files.length} file(s) to ${BUCKET}/${versionPrefix}/...`);

  for (const { path: filePath, name } of files) {
    const storagePath = `${versionPrefix}/${name}`;
    process.stdout.write(`  ${name} ... `);
    const buffer = readFileSync(filePath);
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, buffer, { upsert: true, contentType: 'application/octet-stream' });
    if (error) {
      console.log(`FAIL: ${error.message}`);
      process.exit(1);
    }
    console.log('ok');
  }

  // Upload latest*.yml to electron/ root with version-prefixed paths
  const latestFiles = files.filter((f) => f.name.startsWith('latest') && f.name.endsWith('.yml'));
  for (const { path: filePath, name } of latestFiles) {
    const storagePath = `${PREFIX}/${name}`;
    const raw = readFileSync(filePath, 'utf8');
    const content = prefixLatestYamlPaths(raw, version);
    process.stdout.write(`  ${name} -> ${storagePath} ... `);
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, Buffer.from(content, 'utf8'), {
        upsert: true,
        contentType: 'application/octet-stream',
      });
    if (error) {
      console.log(`FAIL: ${error.message}`);
      process.exit(1);
    }
    console.log('ok');
  }

  console.log(`Done. Version ${version} uploaded.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
