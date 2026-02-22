#!/usr/bin/env node

import process from 'node:process';

const baseUrl = process.env.OVERLORD_BASE_URL ?? 'http://localhost:3000';
const token = process.env.OVERLORD_AGENT_TOKEN ?? 'overlord-local-dev-token';

async function request(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body ?? {})
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed with ${response.status}.`);
  }
  return payload;
}

function printUsage() {
  console.log(`overlord CLI

Usage:
  yarn overlord list
  yarn overlord attach <ticketId> "<agentIdentifier>" [connectionMethod]
  yarn overlord update <sessionKey> <ticketId> "<summary>" [phase]
  yarn overlord decision <sessionKey> <ticketId> "<title>" ["<rationale>"] ["<impact>"] [phase]
  yarn overlord ask <sessionKey> <ticketId> "<question>" [phase]
`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (command === 'list') {
    const result = await request('/api/protocol/list-tickets', {});
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'attach') {
    const [ticketId, agentIdentifier, connectionMethod = 'cli'] = args;
    if (!ticketId || !agentIdentifier) {
      printUsage();
      process.exitCode = 1;
      return;
    }
    const result = await request('/api/protocol/attach', {
      ticketId,
      agentIdentifier,
      connectionMethod
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'update') {
    const [sessionKey, ticketId, summary, phase] = args;
    if (!sessionKey || !ticketId || !summary) {
      printUsage();
      process.exitCode = 1;
      return;
    }
    const result = await request('/api/protocol/update', {
      sessionKey,
      ticketId,
      summary,
      ...(phase ? { phase } : {})
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'decision') {
    const [sessionKey, ticketId, title, rationale, impact, phase] = args;
    if (!sessionKey || !ticketId || !title) {
      printUsage();
      process.exitCode = 1;
      return;
    }
    const result = await request('/api/protocol/decision', {
      sessionKey,
      ticketId,
      title,
      ...(rationale ? { rationale } : {}),
      ...(impact ? { impact } : {}),
      ...(phase ? { phase } : {})
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'ask') {
    const [sessionKey, ticketId, question, phase] = args;
    if (!sessionKey || !ticketId || !question) {
      printUsage();
      process.exitCode = 1;
      return;
    }
    const result = await request('/api/protocol/ask', {
      sessionKey,
      ticketId,
      question,
      ...(phase ? { phase } : {})
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printUsage();
  process.exitCode = 1;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
