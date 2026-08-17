#!/usr/bin/env node
/**
 * Repeatable measurement of the Overlord Desktop process tree and its memory.
 *
 * Every Electron child is called `Overlord Helper` in Activity Monitor, so
 * "a generic Overlord Helper is using a lot of memory" is not by itself enough
 * to tell an embedded backend apart from a renderer or the GPU process. This
 * script reads each process's actual command line and classifies it, which is
 * what makes a before/after comparison of a fix meaningful.
 *
 * Usage:
 *   node desktop/scripts/desktop-process-report.mjs                 # human table
 *   node desktop/scripts/desktop-process-report.mjs --json          # machine readable
 *   node desktop/scripts/desktop-process-report.mjs --label before \
 *     --out /tmp/overlord-processes.jsonl                           # append a snapshot
 *   node desktop/scripts/desktop-process-report.mjs --ps-file capture.txt
 *
 * The app writes its own authoritative inventory (which knows each utility
 * process's `serviceName`) to `<userData>/diagnostics/process-inventory.jsonl`;
 * this script is the external, no-instrumentation counterpart.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const label = readOption('--label') ?? 'snapshot';
const outFile = readOption('--out');
const matchName = readOption('--match') ?? 'Overlord';
const psFile = readOption('--ps-file');

function readOption(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function readPsOutput() {
  if (psFile) return readFileSync(psFile, 'utf8');
  try {
    return execFileSync('ps', ['-axo', 'pid=,ppid=,rss=,command='], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024
    });
  } catch (error) {
    process.stderr.write(
      `Could not run \`ps\`: ${error instanceof Error ? error.message : String(error)}\n` +
        'Run this on the machine where the Desktop app is running, or pass ' +
        '--ps-file <captured `ps -axo pid=,ppid=,rss=,command=` output>.\n'
    );
    process.exit(1);
  }
}

function listProcesses() {
  return readPsOutput()
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const match = /^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
      if (!match) return null;
      return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        rssKb: Number(match[3]),
        command: match[4]
      };
    })
    .filter(Boolean);
}

function classify(command) {
  const type = /--type=([^\s]+)/.exec(command)?.[1];
  const subType = /--utility-sub-type=([^\s]+)/.exec(command)?.[1];

  // The embedded web/REST server is forked from the server bundle, so its
  // command line names the bundle even though its process name does not.
  if (/dist-server[/\\]index\.cjs|[/\\]server[/\\]index\.cjs/.test(command)) {
    return { role: 'embedded-backend', detail: 'overlord web/REST server bundle' };
  }
  if (!type) return { role: 'main', detail: 'Electron browser process' };
  if (type === 'renderer') return { role: 'renderer', detail: 'SPA / window renderer' };
  if (type === 'gpu-process') return { role: 'gpu', detail: 'GPU process' };
  if (type === 'utility') {
    return {
      role: subType === 'node.mojom.NodeService' ? 'node-utility' : 'utility',
      detail: subType ?? 'utility process'
    };
  }
  return { role: type, detail: subType ?? type };
}

const all = listProcesses();
const appProcesses = all.filter(entry => entry.command.includes(matchName));
const processes = appProcesses
  .map(entry => ({ ...entry, ...classify(entry.command) }))
  .sort((a, b) => b.rssKb - a.rssKb);

const snapshot = {
  label,
  at: new Date().toISOString(),
  platform: process.platform,
  processCount: processes.length,
  totalRssKb: processes.reduce((total, entry) => total + entry.rssKb, 0),
  embeddedBackends: processes.filter(entry => entry.role === 'embedded-backend').length,
  nodeUtilities: processes.filter(entry => entry.role === 'node-utility').length,
  processes: processes.map(({ pid, ppid, rssKb, role, detail }) => ({
    pid,
    ppid,
    rssKb,
    role,
    detail
  }))
};

if (outFile) appendFileSync(outFile, `${JSON.stringify(snapshot)}\n`);

if (asJson) {
  process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
} else {
  const mb = kb => `${(kb / 1024).toFixed(1)} MB`;
  process.stdout.write(
    `Overlord Desktop process report — ${snapshot.label} (${snapshot.at})\n` +
      `  processes: ${snapshot.processCount}   total RSS: ${mb(snapshot.totalRssKb)}\n` +
      `  embedded backend processes: ${snapshot.embeddedBackends}` +
      `   node utility processes: ${snapshot.nodeUtilities}\n\n`
  );
  for (const entry of snapshot.processes) {
    process.stdout.write(
      `  ${String(entry.pid).padStart(7)}  ${mb(entry.rssKb).padStart(9)}  ` +
        `${entry.role.padEnd(17)} ${entry.detail}\n`
    );
  }
  if (snapshot.processCount === 0) {
    process.stdout.write(`  (no process matching ${JSON.stringify(matchName)} is running)\n`);
  }
}
