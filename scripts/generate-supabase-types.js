#!/usr/bin/env node
const { spawn } = require('child_process');
const { writeFileSync, mkdirSync } = require('fs');
const { dirname } = require('path');

// Output path for generated types
const OUTPUT_PATH = './types/database.types.ts';

function parseProjectRefFromUrl(urlString) {
  try {
    const u = new URL(urlString);
    const hostParts = u.hostname.split('.');
    // <project-ref>.supabase.co
    return hostParts[0];
  } catch (e) {
    return null;
  }
}

async function run() {
  const mode = process.argv[2];
  if (!mode || !['local', 'prod'].includes(mode)) {
    console.error('Usage: node scripts/generate-supabase-types.js <local|prod>');
    process.exit(1);
  }

  // Ensure output directory exists
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });

  let args = ['dlx', 'supabase', 'gen', 'types', 'typescript'];

  if (mode === 'local') {
    args.push('--local');
  } else {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) {
      console.error('NEXT_PUBLIC_SUPABASE_URL is not set in env.');
      process.exit(1);
    }

    const projectRef = parseProjectRefFromUrl(supabaseUrl);
    if (!projectRef) {
      console.error('Unable to parse project ref from NEXT_PUBLIC_SUPABASE_URL.');
      process.exit(1);
    }

    // Requires `supabase login` beforehand for remote generation
    args.push('--project-id', projectRef);
  }

  const child = spawn('yarn', args, { stdio: ['ignore', 'pipe', 'inherit'] });

  let stdout = '';
  child.stdout.on('data', chunk => {
    stdout += chunk.toString();
  });

  child.on('close', code => {
    if (code !== 0) {
      console.error(`Command failed with exit code ${code}`);
      process.exit(code);
    }
    try {
      // Remove any Yarn/NPM install noise and keep only the TS types
      let cleaned = stdout;
      const markers = ['export type Json', 'export type Database'];
      let startIndex = -1;
      for (const marker of markers) {
        const idx = cleaned.indexOf(marker);
        if (idx !== -1) {
          startIndex = startIndex === -1 ? idx : Math.min(startIndex, idx);
        }
      }
      if (startIndex > 0) {
        cleaned = cleaned.slice(startIndex);
      }

      writeFileSync(OUTPUT_PATH, cleaned.trimStart(), { encoding: 'utf8' });
      // eslint-disable-next-line no-console
      console.log(`Supabase types written to ${OUTPUT_PATH}`);
    } catch (err) {
      console.error('Failed to write types file:', err);
      process.exit(1);
    }
  });
}

run();
