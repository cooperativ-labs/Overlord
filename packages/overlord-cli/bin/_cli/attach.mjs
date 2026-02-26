#!/usr/bin/env node

/**
 * `ovld attach` — interactive ticket search + agent launcher.
 *
 * Usage:
 *   ovld attach                         # interactive: search tickets, pick agent
 *   ovld attach <ticketId>              # skip ticket search, pick agent interactively
 *   ovld attach <ticketId> <agent>      # non-interactive: launch immediately
 */

import { buildAuthHeaders, resolveAuth } from './credentials.mjs';
import { runLauncherCommand } from './launcher.mjs';

const AGENTS = ['claude', 'cursor', 'codex', 'gemini'];
const MAX_VISIBLE = 8;

// ─── ANSI helpers ─────────────────────────────────────────────────────────────

const hide = '\x1b[?25l';
const show = '\x1b[?25h';

function clearLines(n) {
  // Move cursor up n lines, then erase from cursor to end of screen
  return n > 0 ? `\x1b[${n}A\x1b[J` : '';
}

const dim    = (s) => `\x1b[2m${s}\x1b[0m`;
const bold   = (s) => `\x1b[1m${s}\x1b[0m`;
const cyan   = (s) => `\x1b[36m${s}\x1b[0m`;
const green  = (s) => `\x1b[32m${s}\x1b[0m`;
const gray   = (s) => `\x1b[90m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const red    = (s) => `\x1b[31m${s}\x1b[0m`;

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

function statusColor(status) {
  switch (status) {
    case 'draft':    return dim(status);
    case 'execute':  return cyan(status);
    case 'review':   return yellow(status);
    case 'complete': return green(status);
    case 'blocked':  return red(status);
    default:         return gray(status ?? '?');
  }
}

// ─── API ──────────────────────────────────────────────────────────────────────

async function fetchTickets(platformUrl, agentToken, localSecret) {
  const res = await fetch(`${platformUrl}/api/protocol/list-tickets`, {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(agentToken, localSecret),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ includeCompleted: false })
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch tickets (${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  return data.tickets ?? [];
}

// ─── Interactive prompt ───────────────────────────────────────────────────────

/**
 * Run an interactive list selector.
 *
 * In ticket mode (tickets array provided), shows a search-as-you-type menu.
 * In items mode (items array provided), shows a fixed list selector.
 *
 * @param {object}   opts
 * @param {string}   opts.label    - Label shown before the search input
 * @param {string[]} [opts.items]  - Fixed list of choices (agent picker)
 * @param {object[]} [opts.tickets] - Ticket objects for ticket search mode
 * @param {string}   [opts.prefix] - Text prepended to the input line (for UX context)
 * @returns {Promise<string|null>} - Selected id/value, or null if cancelled
 */
function runInteractivePrompt({ label, items = [], tickets, prefix = '' }) {
  return new Promise((resolve) => {
    const isTicketMode = Boolean(tickets);
    let query = '';
    let selectedIdx = 0;
    let linesRendered = 0;

    function getFiltered() {
      if (!isTicketMode) return items;
      if (!query.trim()) return tickets.slice(0, MAX_VISIBLE * 3);
      const q = query.toLowerCase();
      return tickets.filter((t) => {
        const title = (t.title || t.objective || '').toLowerCase();
        const ref   = (t.id || '').toLowerCase();
        return title.includes(q) || ref.includes(q);
      });
    }

    function renderTicketRow(t, active) {
      const seq    = String(t.ticket_sequence ?? '?').padStart(3, ' ');
      const status = t.status ?? '?';
      const title  = truncate(t.title || t.objective || '(no title)', 55);
      const marker = active ? cyan('▶') : ' ';
      return `  ${marker} ${gray('#' + seq)} ${gray('[')}${statusColor(status)}${gray(']')} ${active ? bold(title) : title}`;
    }

    function renderAgentRow(agent, active) {
      const marker = active ? cyan('▶') : ' ';
      return `  ${marker} ${active ? bold(agent) : agent}`;
    }

    function render() {
      const filtered = getFiltered();
      const count    = Math.min(filtered.length, MAX_VISIBLE);
      // Clamp selected within visible range
      if (selectedIdx >= count) selectedIdx = Math.max(0, count - 1);

      const lines = [];

      // Input line
      if (prefix) {
        lines.push(`  ${dim(prefix)}${query}${cyan('│')}`);
      } else {
        lines.push(`  ${gray(label + ':')} ${query}${cyan('│')}`);
      }
      lines.push('');

      if (filtered.length === 0) {
        lines.push(gray('  No matches'));
      } else {
        for (let i = 0; i < count; i++) {
          lines.push(
            isTicketMode
              ? renderTicketRow(filtered[i], i === selectedIdx)
              : renderAgentRow(filtered[i], i === selectedIdx)
          );
        }
        if (filtered.length > MAX_VISIBLE) {
          lines.push(gray(`  … ${filtered.length - MAX_VISIBLE} more — keep typing to narrow`));
        }
      }

      lines.push('');
      lines.push(dim('  ↑↓ navigate · type to filter · Enter select · Esc cancel'));

      if (linesRendered > 0) {
        process.stdout.write(clearLines(linesRendered));
      }
      process.stdout.write(lines.join('\n'));
      linesRendered = lines.length;
    }

    function cleanup() {
      if (linesRendered > 0) {
        process.stdout.write(clearLines(linesRendered));
      }
      process.stdin.setRawMode(false);
      process.stdin.removeAllListeners('data');
      process.stdout.write(show);
    }

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdout.write(hide);
    render();

    process.stdin.on('data', (key) => {
      const filtered = getFiltered();
      const count    = Math.min(filtered.length, MAX_VISIBLE);

      // Ctrl-C / Ctrl-D → exit
      if (key === '\x03' || key === '\x04') {
        cleanup();
        process.exit(0);
      }

      // Escape (lone \x1b, not a sequence like \x1b[A)
      if (key === '\x1b') {
        cleanup();
        resolve(null);
        return;
      }

      // Enter → confirm selection
      if (key === '\r' || key === '\n') {
        if (filtered.length === 0) return;
        const item = filtered[selectedIdx] ?? filtered[0];
        cleanup();
        resolve(isTicketMode ? item.id : item);
        return;
      }

      // Arrow up
      if (key === '\x1b[A') {
        selectedIdx = (selectedIdx - 1 + count) % Math.max(1, count);
        render();
        return;
      }

      // Arrow down
      if (key === '\x1b[B') {
        selectedIdx = (selectedIdx + 1) % Math.max(1, count);
        render();
        return;
      }

      // Backspace
      if (key === '\x7f' || key === '\b') {
        if (query.length > 0) {
          query = query.slice(0, -1);
          selectedIdx = 0;
          render();
        }
        return;
      }

      // Printable character → append to query
      if (key.length === 1 && key >= ' ') {
        query += key;
        selectedIdx = 0;
        render();
      }
    });
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runAttachCommand(args) {
  const [ticketIdArg, agentArg] = args;

  const { platformUrl, agentToken, localSecret } = resolveAuth();

  // ── Phase 1: Ticket selection ──────────────────────────────────────────────

  let ticketId    = ticketIdArg;
  let ticketTitle = '';

  if (!ticketId) {
    let tickets;
    try {
      process.stdout.write(gray('  Loading tickets…\n'));
      tickets = await fetchTickets(platformUrl, agentToken, localSecret);
      // Clear the loading line
      process.stdout.write(clearLines(1));
    } catch (err) {
      console.error(`\nError: ${err.message}`);
      process.exit(1);
    }

    if (tickets.length === 0) {
      console.error('  No tickets found. Create one with:\n    ovld tickets create --objective "..."');
      process.exit(1);
    }

    process.stdout.write('\n');
    process.stdout.write(bold('  ovld attach\n'));
    process.stdout.write('\n');

    ticketId = await runInteractivePrompt({ label: 'Search tickets', tickets });

    if (!ticketId) {
      process.stdout.write(dim('\n  Cancelled.\n\n'));
      process.exit(0);
    }

    const found = tickets.find((t) => t.id === ticketId);
    ticketTitle = found?.title || found?.objective || '';
  }

  // ── Phase 2: Agent selection ───────────────────────────────────────────────

  const shortId = ticketId.slice(-8).toUpperCase();

  let agent = agentArg;

  if (!agent) {
    process.stdout.write('\n');
    process.stdout.write(bold(`  ovld attach `) + cyan(shortId) + '\n');
    if (ticketTitle) {
      process.stdout.write(gray(`  ${truncate(ticketTitle, 60)}\n`));
    }
    process.stdout.write('\n');

    agent = await runInteractivePrompt({
      label:  'Agent',
      items:  AGENTS,
      prefix: `ovld attach ${shortId} `
    });

    if (!agent) {
      process.stdout.write(dim('\n  Cancelled.\n\n'));
      process.exit(0);
    }
  }

  if (!AGENTS.includes(agent)) {
    console.error(`\nUnknown agent: "${agent}". Must be one of: ${AGENTS.join(', ')}`);
    process.exit(1);
  }

  // ── Launch ─────────────────────────────────────────────────────────────────

  process.stdout.write('\n');
  process.stdout.write(
    `  ${green('✓')} ${bold(agent)} ← ${truncate(ticketTitle || shortId, 55)}\n\n`
  );

  process.env.TICKET_ID = ticketId;
  await runLauncherCommand('run', [agent]);
}
