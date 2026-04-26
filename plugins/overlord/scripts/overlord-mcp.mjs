#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const OVLD_BIN = process.env.OVLD_BIN?.trim() || 'ovld';
const PROTOCOL_VERSION = '2025-06-18';

function execFileWithOptionalInput(file, args, options, input) {
  if (input === undefined) {
    return execFileAsync(file, args, options);
  }

  return new Promise((resolve, reject) => {
    const child = execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }

      resolve({ stdout, stderr });
    });

    child.stdin?.end(input);
  });
}

const tools = [
  {
    name: 'discover_project',
    description: 'Resolve the Overlord project that matches a working directory.',
    inputSchema: {
      type: 'object',
      properties: {
        working_directory: { type: 'string', description: 'Directory to match. Defaults to the current workspace.' }
      }
    },
    toCliFlags: args => ({
      'working-directory': args.working_directory
    }),
    subcommand: 'discover-project'
  },
  {
    name: 'attach_ticket',
    description: 'Attach an agent session to an existing Overlord ticket and return the working context.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket_id: { type: 'string', description: 'Target ticket ID' },
        agent: { type: 'string' },
        method: { type: 'string' },
        external_session_id: { type: ['string', 'null'] }
      },
      required: ['ticket_id']
    },
    toCliFlags: args => ({
      'ticket-id': args.ticket_id,
      agent: args.agent,
      method: args.method,
      'external-session-id': args.external_session_id
    }),
    subcommand: 'attach'
  },
  {
    name: 'connect_ticket',
    description: 'Create a lightweight Overlord session without loading the full ticket context.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket_id: { type: 'string' },
        agent: { type: 'string' },
        method: { type: 'string' }
      },
      required: ['ticket_id']
    },
    toCliFlags: args => ({
      'ticket-id': args.ticket_id,
      agent: args.agent,
      method: args.method
    }),
    subcommand: 'connect'
  },
  {
    name: 'load_ticket_context',
    description: 'Fetch Overlord ticket context without creating a session.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket_id: { type: 'string' }
      },
      required: ['ticket_id']
    },
    toCliFlags: args => ({
      'ticket-id': args.ticket_id
    }),
    subcommand: 'load-context'
  },
  {
    name: 'spawn_ticket',
    description: 'Create a follow-up ticket and attach to it immediately.',
    inputSchema: {
      type: 'object',
      properties: {
        objective: { type: 'string' },
        title: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
        project_id: { type: 'string' },
        working_directory: { type: 'string' },
        acceptance_criteria: { type: 'string' },
        available_tools: { type: 'string' },
        execution_target: { type: 'string', enum: ['agent', 'human'] },
        delegate: { type: 'string' },
        parent_session_key: { type: 'string' },
        parent_ticket_id: { type: 'string' },
        agent: { type: 'string' },
        method: { type: 'string' }
      },
      required: ['objective']
    },
    toCliFlags: args => ({
      objective: args.objective,
      title: args.title,
      priority: args.priority,
      'project-id': args.project_id,
      'working-directory': args.working_directory,
      'acceptance-criteria': args.acceptance_criteria,
      'available-tools': args.available_tools,
      'execution-target': args.execution_target,
      delegate: args.delegate,
      'parent-session-key': args.parent_session_key,
      'parent-ticket-id': args.parent_ticket_id,
      agent: args.agent,
      method: args.method
    }),
    subcommand: 'spawn'
  },
  {
    name: 'post_update',
    description: 'Post an Overlord progress update or activity event.',
    inputSchema: {
      type: 'object',
      properties: {
        session_key: { type: 'string' },
        ticket_id: { type: 'string' },
        summary: { type: 'string' },
        phase: { type: 'string', enum: ['draft', 'execute', 'review', 'deliver', 'complete', 'blocked', 'cancelled'] },
        event_type: { type: 'string', enum: ['update', 'user_follow_up', 'alert'] },
        external_url: { type: ['string', 'null'] },
        external_session_id: { type: ['string', 'null'] },
        payload: { type: 'object' },
        change_rationales: { type: 'array' }
      },
      required: ['session_key', 'ticket_id', 'summary']
    },
    toCliFlags: args => ({
      'session-key': args.session_key,
      'ticket-id': args.ticket_id,
      summary: args.summary,
      phase: args.phase,
      'event-type': args.event_type,
      'external-url': args.external_url,
      'external-session-id': args.external_session_id,
      'payload-json': args.payload,
      'change-rationales-json': args.change_rationales
    }),
    subcommand: 'update'
  },
  {
    name: 'record_change_rationales',
    description: 'Persist structured change rationale rows without posting a separate update.',
    inputSchema: {
      type: 'object',
      properties: {
        session_key: { type: 'string' },
        ticket_id: { type: 'string' },
        summary: { type: 'string' },
        phase: { type: 'string', enum: ['draft', 'execute', 'review', 'deliver', 'complete', 'blocked', 'cancelled'] },
        change_rationales: { type: 'array' }
      },
      required: ['session_key', 'ticket_id', 'change_rationales']
    },
    toCliFlags: args => ({
      'session-key': args.session_key,
      'ticket-id': args.ticket_id,
      summary: args.summary,
      phase: args.phase,
      'change-rationales-json': args.change_rationales
    }),
    subcommand: 'record-change-rationales'
  },
  {
    name: 'ask_blocking_question',
    description: 'Send a blocking question to the human reviewer or PM.',
    inputSchema: {
      type: 'object',
      properties: {
        session_key: { type: 'string' },
        ticket_id: { type: 'string' },
        question: { type: 'string' },
        phase: { type: 'string', enum: ['draft', 'execute', 'review', 'deliver', 'complete', 'blocked', 'cancelled'] },
        payload: { type: 'object' }
      },
      required: ['session_key', 'ticket_id', 'question']
    },
    toCliFlags: args => ({
      'session-key': args.session_key,
      'ticket-id': args.ticket_id,
      question: args.question,
      phase: args.phase,
      'payload-json': args.payload
    }),
    subcommand: 'ask'
  },
  {
    name: 'read_shared_context',
    description: 'Read persistent shared context entries for a ticket.',
    inputSchema: {
      type: 'object',
      properties: {
        session_key: { type: 'string' },
        ticket_id: { type: 'string' },
        query: { type: 'string' },
        limit: { type: 'number' }
      },
      required: ['session_key', 'ticket_id']
    },
    toCliFlags: args => ({
      'session-key': args.session_key,
      'ticket-id': args.ticket_id,
      query: args.query,
      limit: args.limit
    }),
    subcommand: 'read-context'
  },
  {
    name: 'write_shared_context',
    description: 'Write a persistent shared context entry for future Overlord sessions.',
    inputSchema: {
      type: 'object',
      properties: {
        session_key: { type: 'string' },
        ticket_id: { type: 'string' },
        key: { type: 'string' },
        value: {},
        tags: { type: 'array', items: { type: 'string' } }
      },
      required: ['session_key', 'ticket_id', 'key', 'value']
    },
    toCliFlags: args => ({
      'session-key': args.session_key,
      'ticket-id': args.ticket_id,
      key: args.key,
      value: typeof args.value === 'string' ? args.value : JSON.stringify(args.value),
      tags: Array.isArray(args.tags) ? args.tags.join(',') : args.tags
    }),
    subcommand: 'write-context'
  },
  {
    name: 'deliver_ticket',
    description:
      'Deliver final work back into Overlord with summary, artifacts, and change rationales. Large payloads are streamed to the CLI through stdin, so this tool does not create delivery scratch files.',
    inputSchema: {
      type: 'object',
      properties: {
        session_key: { type: 'string' },
        ticket_id: { type: 'string' },
        summary: { type: 'string' },
        artifacts: { type: 'array' },
        change_rationales: { type: 'array' },
        skip_file_change_check: { type: 'boolean' }
      },
      required: ['session_key', 'ticket_id', 'summary']
    },
    toCliFlags: args => ({
      'session-key': args.session_key,
      'ticket-id': args.ticket_id,
      'payload-file': '-',
      'skip-file-change-check': args.skip_file_change_check
    }),
    toCliStdin: args => JSON.stringify({
      summary: args.summary,
      ...(Array.isArray(args.artifacts) ? { artifacts: args.artifacts } : {}),
      ...(Array.isArray(args.change_rationales) ? { changeRationales: args.change_rationales } : {})
    }),
    subcommand: 'deliver'
  },
  {
    name: 'prepare_artifact_upload',
    description: 'Prepare an Overlord artifact upload and return a signed upload URL.',
    inputSchema: {
      type: 'object',
      properties: {
        session_key: { type: 'string' },
        ticket_id: { type: 'string' },
        file_name: { type: 'string' },
        label: { type: 'string' },
        artifact_type: { type: 'string' },
        content_type: { type: 'string' },
        file_size: { type: 'number' },
        metadata: { type: 'object' }
      },
      required: ['session_key', 'ticket_id', 'file_name']
    },
    toCliFlags: args => ({
      'session-key': args.session_key,
      'ticket-id': args.ticket_id,
      'file-name': args.file_name,
      label: args.label,
      'artifact-type': args.artifact_type,
      'content-type': args.content_type,
      'file-size': args.file_size,
      'metadata-json': args.metadata
    }),
    subcommand: 'artifact-prepare-upload'
  },
  {
    name: 'finalize_artifact_upload',
    description: 'Finalize an artifact after uploading bytes to the signed storage URL.',
    inputSchema: {
      type: 'object',
      properties: {
        session_key: { type: 'string' },
        ticket_id: { type: 'string' },
        storage_path: { type: 'string' },
        label: { type: 'string' },
        artifact_type: { type: 'string' },
        content_type: { type: 'string' },
        file_size: { type: 'number' },
        metadata: { type: 'object' }
      },
      required: ['session_key', 'ticket_id', 'storage_path', 'label']
    },
    toCliFlags: args => ({
      'session-key': args.session_key,
      'ticket-id': args.ticket_id,
      'storage-path': args.storage_path,
      label: args.label,
      'artifact-type': args.artifact_type,
      'content-type': args.content_type,
      'file-size': args.file_size,
      'metadata-json': args.metadata
    }),
    subcommand: 'artifact-finalize-upload'
  },
  {
    name: 'get_artifact_download_url',
    description: 'Create a signed download URL for an uploaded Overlord artifact.',
    inputSchema: {
      type: 'object',
      properties: {
        session_key: { type: 'string' },
        ticket_id: { type: 'string' },
        artifact_id: { type: 'string' },
        storage_path: { type: 'string' },
        expires_in: { type: 'number' }
      },
      required: ['session_key', 'ticket_id']
    },
    toCliFlags: args => ({
      'session-key': args.session_key,
      'ticket-id': args.ticket_id,
      'artifact-id': args.artifact_id,
      'storage-path': args.storage_path,
      'expires-in': args.expires_in
    }),
    subcommand: 'artifact-download-url'
  },
  {
    name: 'upload_artifact_file',
    description: 'Prepare, upload, and finalize a local file as an Overlord artifact in one step.',
    inputSchema: {
      type: 'object',
      properties: {
        session_key: { type: 'string' },
        ticket_id: { type: 'string' },
        file: { type: 'string' },
        file_name: { type: 'string' },
        label: { type: 'string' },
        artifact_type: { type: 'string' },
        content_type: { type: 'string' },
        metadata: { type: 'object' }
      },
      required: ['session_key', 'ticket_id', 'file']
    },
    toCliFlags: args => ({
      'session-key': args.session_key,
      'ticket-id': args.ticket_id,
      file: args.file,
      'file-name': args.file_name,
      label: args.label,
      'artifact-type': args.artifact_type,
      'content-type': args.content_type,
      'metadata-json': args.metadata
    }),
    subcommand: 'artifact-upload-file'
  }
];

const searchTicketsTool = {
  name: 'search_tickets',
  description:
    'Search Overlord tickets by keyword and/or filter by status. Leave query empty to list all tickets matching the status filter. Useful when the user asks to find tickets related to a subject or in a specific workflow state.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Keyword or phrase to search for in ticket titles and objectives. Leave empty to list without text filtering.'
      },
      statuses: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Filter by one or more ticket statuses (e.g. ["next-up", "execute", "review"]). Omit to include all non-completed statuses.'
      },
      include_completed: {
        type: 'boolean',
        description: 'Whether to include completed tickets in results. Defaults to false.'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (1–20, default 8).'
      }
    }
  },
  toCliFlags: args => ({
    query: args.query,
    statuses: Array.isArray(args.statuses) ? args.statuses.join(',') : args.statuses,
    'include-completed': args.include_completed,
    limit: args.limit
  }),
  subcommand: 'search-tickets'
};

const toolMap = new Map([
  ...tools.map(tool => [tool.name, tool]),
  [searchTicketsTool.name, searchTicketsTool]
]);
let buffer = Buffer.alloc(0);

function serializeMessage(message) {
  const json = JSON.stringify(message);
  const body = Buffer.from(json, 'utf8');
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8');
  return Buffer.concat([header, body]);
}

function send(message) {
  process.stdout.write(serializeMessage(message));
}

function parseMessages(chunk) {
  buffer = Buffer.concat([buffer, chunk]);
  const messages = [];

  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;

    const headerText = buffer.subarray(0, headerEnd).toString('utf8');
    const headers = Object.fromEntries(
      headerText
        .split('\r\n')
        .map(line => {
          const separatorIndex = line.indexOf(':');
          return [line.slice(0, separatorIndex).trim().toLowerCase(), line.slice(separatorIndex + 1).trim()];
        })
    );

    const contentLength = Number(headers['content-length']);
    if (!Number.isFinite(contentLength)) {
      throw new Error('Missing Content-Length header');
    }

    const totalLength = headerEnd + 4 + contentLength;
    if (buffer.length < totalLength) break;

    const body = buffer.subarray(headerEnd + 4, totalLength).toString('utf8');
    buffer = buffer.subarray(totalLength);
    messages.push(JSON.parse(body));
  }

  return messages;
}

function success(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function failure(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function cliArgsFromFlags(flags) {
  const args = [];

  for (const [key, value] of Object.entries(flags)) {
    if (value === undefined || value === null) continue;

    if (typeof value === 'boolean') {
      if (value) args.push(`--${key}`);
      continue;
    }

    const serialized =
      typeof value === 'string' || typeof value === 'number' ? String(value) : JSON.stringify(value);
    args.push(`--${key}`, serialized);
  }

  return args;
}

async function runProtocol(tool, args) {
  const toolArgs = args ?? {};
  const cliArgs = ['protocol', tool.subcommand, ...cliArgsFromFlags(tool.toCliFlags(toolArgs))];
  const stdin = typeof tool.toCliStdin === 'function' ? tool.toCliStdin(toolArgs) : undefined;

  try {
    const { stdout, stderr } = await execFileWithOptionalInput(
      OVLD_BIN,
      cliArgs,
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          AGENT_IDENTIFIER: process.env.AGENT_IDENTIFIER ?? 'codex-overlord-plugin'
        },
        maxBuffer: 20 * 1024 * 1024
      },
      stdin
    );

    const trimmed = stdout.trim();
    const data = trimmed ? JSON.parse(trimmed) : {};

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              subcommand: tool.subcommand,
              data,
              stderr: stderr.trim() || undefined
            },
            null,
            2
          )
        }
      ],
      structuredContent: data
    };
  } catch (error) {
    const stdout = typeof error?.stdout === 'string' ? error.stdout.trim() : '';
    const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
    const message = error instanceof Error ? error.message : String(error);

    let parsedStdout = stdout;
    if (stdout) {
      try {
        parsedStdout = JSON.parse(stdout);
      } catch {
        // keep raw stdout
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              subcommand: tool.subcommand,
              error: message,
              stdout: parsedStdout || undefined,
              stderr: stderr || undefined
            },
            null,
            2
          )
        }
      ],
      isError: true
    };
  }
}

async function handleRequest(message) {
  const { id, method, params } = message;

  if (method === 'initialize') {
    success(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {
        tools: {
          listChanged: false
        }
      },
      serverInfo: {
        name: 'overlord',
        version: '0.1.1'
      },
      instructions:
        'Use these tools to drive Overlord ticket workflows through the installed ovld CLI. Most operations expect a session key from attach or connect.'
    });
    return;
  }

  if (method === 'ping') {
    success(id, {});
    return;
  }

  if (method === 'tools/list') {
    success(id, {
      tools: [...tools, searchTicketsTool].map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      }))
    });
    return;
  }

  if (method === 'tools/call') {
    const tool = toolMap.get(params?.name);
    if (!tool) {
      failure(id, -32602, `Unknown tool: ${params?.name ?? 'undefined'}`);
      return;
    }

    success(id, await runProtocol(tool, params?.arguments ?? {}));
    return;
  }

  failure(id, -32601, `Method not found: ${method}`);
}

process.stdin.on('data', async chunk => {
  try {
    for (const message of parseMessages(chunk)) {
      if (!message || typeof message !== 'object') continue;
      if ('method' in message && 'id' in message) {
        await handleRequest(message);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Overlord MCP server failed: ${message}\n`);
    process.exit(1);
  }
});

process.stdin.resume();
