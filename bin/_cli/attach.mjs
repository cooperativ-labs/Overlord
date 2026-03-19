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

const AGENTS = ['claude', 'cursor', 'codex', 'gemini', 'opencode'];
const MAX_VISIBLE = 8;
const SEARCH_DEBOUNCE_MS = 120;

// ─── ANSI helpers ─────────────────────────────────────────────────────────────

const hide = '\x1b[?25l';
const show = '\x1b[?25h';

function clearLines(n) {
  // After rendering N lines without a trailing newline, the cursor sits on the
  // last rendered line. Move back to column 1, then up N-1 lines so erasing
  // starts at the first prompt line instead of the line above it.
  return n > 0 ? `\r\x1b[${Math.max(0, n - 1)}A\x1b[J` : '';
}

const dim = s => `\x1b[2m${s}\x1b[0m`;
const bold = s => `\x1b[1m${s}\x1b[0m`;
const cyan = s => `\x1b[36m${s}\x1b[0m`;
const green = s => `\x1b[32m${s}\x1b[0m`;
const gray = s => `\x1b[90m${s}\x1b[0m`;
const yellow = s => `\x1b[33m${s}\x1b[0m`;
const red = s => `\x1b[31m${s}\x1b[0m`;

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

function statusColor(status) {
  switch (status) {
    case 'draft':
      return dim(status);
    case 'execute':
      return cyan(status);
    case 'review':
      return yellow(status);
    case 'complete':
      return green(status);
    case 'blocked':
      return red(status);
    default:
      return gray(status ?? '?');
  }
}

// ─── API ──────────────────────────────────────────────────────────────────────

async function searchTickets(platformUrl, agentToken, localSecret, query) {
  const res = await fetch(`${platformUrl}/api/protocol/search-tickets`, {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(agentToken, localSecret),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      includeCompleted: false,
      query,
      limit: MAX_VISIBLE
    })
  });

  if (!res.ok) {
    throw new Error(`Failed to search tickets (${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  return data.tickets ?? [];
}

// ─── Interactive prompt ───────────────────────────────────────────────────────

/**
 * Run an interactive list selector.
 *
 * In ticket mode (search callback provided), shows a search-as-you-type menu.
 * In items mode (items array provided), shows a fixed list selector.
 *
 * @param {object}   opts
 * @param {string}   opts.label    - Label shown before the search input
 * @param {string[]} [opts.items]  - Fixed list of choices (agent picker)
 * @param {(query: string) => Promise<object[]>} [opts.search] - Ticket search callback
 * @param {string}   [opts.prefix] - Text prepended to the input line (for UX context)
 * @returns {Promise<string|object|null>} - Selected item/value, or null if cancelled
 */
function runInteractivePrompt({ label, items = [], search, prefix = '' }) {
  return new Promise(resolve => {
    const isTicketMode = typeof search === 'function';
    let query = '';
    let selectedIdx = 0;
    let linesRendered = 0;
    let loading = isTicketMode;
    let errorMessage = '';
    let filteredItems = isTicketMode ? [] : items;
    let activeRequestId = 0;
    let debounceTimer = null;

    function getFiltered() {
      return filteredItems;
    }

    function renderTicketRow(t, active) {
      const seq = String(t.ticket_sequence ?? '?').padStart(3, ' ');
      const status = t.status ?? '?';
      const title = truncate(t.title || t.objective || '(no title)', 55);
      const marker = active ? cyan('▶') : ' ';
      return `  ${marker} ${gray('#' + seq)} ${gray('[')}${statusColor(status)}${gray(']')} ${active ? bold(title) : title}`;
    }

    function renderAgentRow(agent, active) {
      const marker = active ? cyan('▶') : ' ';
      return `  ${marker} ${active ? bold(agent) : agent}`;
    }

    function render() {
      const filtered = getFiltered();
      const count = Math.min(filtered.length, MAX_VISIBLE);
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

      if (loading) {
        lines.push(gray('  Searching tickets…'));
      } else if (errorMessage) {
        lines.push(red(`  ${errorMessage}`));
      } else if (filtered.length === 0) {
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

    async function loadMatches(nextQuery) {
      if (!isTicketMode) return;
      const requestId = ++activeRequestId;
      loading = true;
      errorMessage = '';
      render();

      try {
        const nextItems = await search(nextQuery);
        if (requestId !== activeRequestId) return;
        filteredItems = nextItems;
      } catch (error) {
        if (requestId !== activeRequestId) return;
        filteredItems = [];
        errorMessage = error instanceof Error ? error.message : 'Ticket search failed.';
      } finally {
        if (requestId !== activeRequestId) return;
        loading = false;
        render();
      }
    }

    function scheduleLoad() {
      if (!isTicketMode) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void loadMatches(query);
      }, SEARCH_DEBOUNCE_MS);
    }

    function cleanup() {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
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
    scheduleLoad();

    process.stdin.on('data', key => {
      const filtered = getFiltered();
      const count = Math.min(filtered.length, MAX_VISIBLE);

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
        if (loading || filtered.length === 0) return;
        const item = filtered[selectedIdx] ?? filtered[0];
        cleanup();
        resolve(item);
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
          if (isTicketMode) scheduleLoad();
          else render();
        }
        return;
      }

      // Printable character → append to query
      if (key.length === 1 && key >= ' ') {
        query += key;
        selectedIdx = 0;
        if (isTicketMode) scheduleLoad();
        else render();
      }
    });
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runAttachCommand(args) {
  const [ticketIdArg, agentArg] = args;

  const { platformUrl, agentToken, localSecret } = resolveAuth();

  // ── Phase 1: Ticket selection ──────────────────────────────────────────────

  let ticketId = ticketIdArg;
  let ticketTitle = '';

  if (!ticketId) {
    process.stdout.write('\n');
    process.stdout.write(bold('  ovld attach\n'));
    process.stdout.write('\n');

    const selectedTicket = await runInteractivePrompt({
      label: 'Search tickets',
      search: nextQuery => searchTickets(platformUrl, agentToken, localSecret, nextQuery)
    });

    if (!selectedTicket) {
      process.stdout.write(dim('\n  Cancelled.\n\n'));
      process.exit(0);
    }

    ticketId = selectedTicket.id;
    ticketTitle = selectedTicket.title || selectedTicket.objective || '';
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
      label: 'Agent',
      items: AGENTS,
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
