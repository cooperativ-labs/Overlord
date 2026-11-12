#!/usr/bin/env node
// Runs a test command with REST conformance recording switched on and fails the run
// on any non-conforming response or any invalid request a handler accepted (ADR 0051).
//
//   node scripts/api-conformance-report.mjs [--uncovered] [--keep <file>] -- <command> [args...]
//
// The command runs with OVERLORD_API_CONFORMANCE_REPORT pointing at a fresh JSON-lines
// file. The backend (backend/http/request-validation.ts and response-conformance.ts)
// appends one record per checked response and per invalid request. Afterwards this
// script prints how many distinct operations had a response checked, lists every
// problem, and exits non-zero when the command failed or any problem was recorded.
// `--uncovered` also lists the operations no response was checked for.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parse } from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OPERATION_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

export function operationIds(document) {
  const ids = [];
  for (const item of Object.values(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(item)) {
      if (OPERATION_METHODS.includes(method) && operation?.operationId) {
        ids.push(operation.operationId);
      }
    }
  }
  return ids.sort();
}

/** Summarises report records; `problems` is empty when the run conformed. */
export function summarise(records, allOperationIds) {
  const responseOperations = new Set();
  const problems = new Map();
  let responses = 0;
  let invalidRequests = 0;
  for (const record of records) {
    if (record.kind === 'response') {
      responses += 1;
      responseOperations.add(record.operationId);
      for (const problem of record.problems ?? []) {
        const key = `response ${record.operationId} ${record.method} ${record.status}: ${problem}`;
        problems.set(key, (problems.get(key) ?? 0) + 1);
      }
    } else if (record.kind === 'request') {
      invalidRequests += 1;
      if (record.outcome === 'accepted') {
        const where = (record.issues ?? [])
          .map(issue => `${issue.in}${issue.path ? `.${issue.path}` : ''} (${issue.code})`)
          .join(', ');
        const key = `request ${record.operationId} ${record.method}: answered ${record.status} to a request the description refuses: ${where}`;
        problems.set(key, (problems.get(key) ?? 0) + 1);
      }
    }
  }
  return {
    responses,
    invalidRequests,
    covered: [...responseOperations].sort(),
    uncovered: allOperationIds.filter(id => !responseOperations.has(id)),
    problems: [...problems.entries()].map(([text, count]) => (count > 1 ? `${text} (x${count})` : text))
  };
}

export function readRecords(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line));
}

function main(argv) {
  const separator = argv.indexOf('--');
  if (separator === -1 || separator === argv.length - 1) {
    console.error('usage: api-conformance-report.mjs [--uncovered] [--keep <file>] -- <command> [args...]');
    return 2;
  }
  const options = argv.slice(0, separator);
  const command = argv.slice(separator + 1);
  const keepIndex = options.indexOf('--keep');
  const directory = mkdtempSync(path.join(tmpdir(), 'overlord-api-conformance-'));
  const report = keepIndex === -1 ? path.join(directory, 'report.jsonl') : path.resolve(options[keepIndex + 1]);
  rmSync(report, { force: true });

  const run = spawnSync(command[0], command.slice(1), {
    stdio: 'inherit',
    env: { ...process.env, OVERLORD_API_CONFORMANCE_REPORT: report }
  });
  const document = parse(readFileSync(path.join(ROOT, 'contract/api/openapi.yaml'), 'utf8'));
  const summary = summarise(readRecords(report), operationIds(document));
  if (keepIndex === -1) rmSync(directory, { recursive: true, force: true });

  const total = summary.covered.length + summary.uncovered.length;
  const lines = [
    `\nAPI conformance: ${summary.responses} responses checked across ${summary.covered.length} of ${total} operations; ${summary.invalidRequests} invalid requests observed.`
  ];
  if (options.includes('--uncovered')) {
    lines.push(`Operations without a checked response (${summary.uncovered.length}):`);
    for (const id of summary.uncovered) lines.push(`  ${id}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
  if (summary.problems.length > 0) {
    console.error(`API conformance problems (${summary.problems.length}):`);
    for (const problem of summary.problems) console.error(`  ${problem}`);
  }
  if (run.error) {
    console.error(run.error.message);
    return 1;
  }
  if (run.status !== 0) return run.status ?? 1;
  return summary.problems.length > 0 ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main(process.argv.slice(2));
}
