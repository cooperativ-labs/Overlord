#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const OVLD_BIN = process.env.OVLD_BIN?.trim() || 'ovld';
const PROTOCOL_VERSION = '2025-06-18';

const OBJECTIVES_ARRAY_SCHEMA = {
  type: 'array',
  description:
    'Ordered objective objects. Index 0 is the first objective to execute; later indexes queue after it.',
  items: {
    type: 'object',
    properties: {
      objective: { type: 'string' },
      title: { type: 'string' },
      auto_advance: { type: 'boolean' },
      assigned_agent: { type: 'object' }
    },
    required: ['objective']
  }
};

function toCliObjectives(objectives) {
  if (!Array.isArray(objectives)) return undefined;
  return objectives.map(item => ({
    objective: item.objective,
    ...(item.title ? { title: item.title } : {}),
    ...(typeof item.auto_advance === 'boolean' ? { autoAdvance: item.auto_advance } : {}),
    ...(item.assigned_agent ? { assignedAgent: item.assigned_agent } : {})
  }));
}

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
    description:
      'Resolve an Overlord project by explicit project_id or by matching a working directory.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description:
            'Project UUID or name to resolve directly. Skips working-directory matching. Names are unique per organization and matched case-insensitively.'
        },
        working_directory: {
          type: 'string',
          description: 'Directory to match. Defaults to the current workspace.'
        },
        device_fingerprint: {
          type: 'string',
          description:
            'Optional stable device fingerprint. When provided, matching prefers resource directories for this registered device.'
        },
        device_hostname: {
          type: 'string',
          description: 'Optional hostname to register/update with device_fingerprint.'
        },
        device_platform: {
          type: 'string',
          description: 'Optional platform string, e.g. darwin, linux, or windows.'
        }
      }
    },
    toCliFlags: args => ({
      'project-id': args.project_id,
      'working-directory': args.working_directory,
      'device-fingerprint': args.device_fingerprint,
      'device-hostname': args.device_hostname,
      'device-platform': args.device_platform
    }),
    subcommand: 'discover-project'
  },
  {
    name: 'attach',
    description:
      'Attach an agent session to an existing Overlord ticket and return the working context.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket_id: {
          type: 'string',
          description: 'Ticket identifier (e.g. 1:899). Also accepts UUID.'
        },
        agent: { type: 'string' },
        method: { type: 'string' },
        external_session_id: { type: ['string', 'null'] },
        metadata: {
          type: 'object',
          description:
            'Optional extra metadata merged into the attach request (same as --metadata-json on the CLI).'
        }
      },
      required: ['ticket_id']
    },
    toCliFlags: args => ({
      'ticket-id': args.ticket_id,
      agent: args.agent,
      method: args.method,
      'external-session-id': args.external_session_id,
      ...(args.metadata && typeof args.metadata === 'object' && !Array.isArray(args.metadata)
        ? { 'metadata-json': args.metadata }
        : {})
    }),
    subcommand: 'attach'
  },
  {
    name: 'connect',
    description: 'Create a lightweight Overlord session without loading the full ticket context.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket_id: {
          type: 'string',
          description: 'Ticket identifier (e.g. 1:899). Also accepts UUID.'
        },
        agent: { type: 'string' },
        method: { type: 'string' },
        external_session_id: { type: ['string', 'null'] },
        metadata: {
          type: 'object',
          description:
            'Optional extra metadata merged into the connect request (same as --metadata-json on the CLI).'
        }
      },
      required: ['ticket_id']
    },
    toCliFlags: args => ({
      'ticket-id': args.ticket_id,
      agent: args.agent,
      method: args.method,
      'external-session-id': args.external_session_id,
      ...(args.metadata && typeof args.metadata === 'object' && !Array.isArray(args.metadata)
        ? { 'metadata-json': args.metadata }
        : {})
    }),
    subcommand: 'connect'
  },
  {
    name: 'load_ticket_context',
    description:
      'Fetch Overlord ticket context without creating a session (maps to ovld protocol load-context; not the same as read_context).',
    inputSchema: {
      type: 'object',
      properties: {
        ticket_id: {
          type: 'string',
          description: 'Ticket identifier (e.g. 1:899). Also accepts UUID.'
        }
      },
      required: ['ticket_id']
    },
    toCliFlags: args => ({
      'ticket-id': args.ticket_id
    }),
    subcommand: 'load-context'
  },
  {
    name: 'revert',
    description:
      'Restore the local working tree to the recorded objective state (maps to ovld protocol revert).',
    inputSchema: {
      type: 'object',
      properties: {
        objective_id: { type: 'string' },
        working_directory: {
          type: 'string',
          description: 'Repository to restore. Defaults to the current workspace.'
        }
      },
      required: ['objective_id']
    },
    toCliFlags: args => ({
      'objective-id': args.objective_id,
      'working-directory': args.working_directory
    }),
    subcommand: 'revert'
  },
  {
    name: 'discuss_objective',
    description:
      'Mark a draft objective as "submitted", indicating the ticket is in active discussion with an agent but not yet being executed. Does NOT start execution — use attach for that.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket_id: {
          type: 'string',
          description: 'Ticket identifier (e.g. 1:899). Also accepts UUID.'
        },
        objective_id: {
          type: 'string',
          description:
            'Optional UUID of a specific draft objective to submit. Defaults to the latest draft.'
        }
      },
      required: ['ticket_id']
    },
    toCliFlags: args => ({
      'ticket-id': args.ticket_id,
      'objective-id': args.objective_id
    }),
    subcommand: 'discuss-objective'
  },
  {
    name: 'prompt',
    description: 'Create a ticket and attach to it immediately (ovld protocol prompt).',
    inputSchema: {
      type: 'object',
      properties: {
        objectives: OBJECTIVES_ARRAY_SCHEMA,
        title: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
        project_id: { type: 'string' },
        working_directory: { type: 'string' },
        personal: {
          type: 'boolean',
          description: 'Create without assigning a project (private ticket).'
        },
        acceptance_criteria: { type: 'string' },
        available_tools: { type: 'string' },
        for_human: { type: 'boolean' },
        delegate: { type: 'string' },
        assigned_to: {
          type: 'string',
          description:
            'Assign the ticket to a member: username, email, user-id, or orgid:username (defaults to creator).'
        },
        parent_session_key: { type: 'string' },
        parent_ticket_id: { type: 'string' },
        agent: { type: 'string' },
        method: { type: 'string' }
      },
      required: ['objectives']
    },
    toCliFlags: args => ({
      'objectives-json': toCliObjectives(args.objectives),
      title: args.title,
      priority: args.priority,
      'project-id': args.project_id,
      'working-directory': args.working_directory,
      personal: args.personal === true ? true : undefined,
      'acceptance-criteria': args.acceptance_criteria,
      'available-tools': args.available_tools,
      'for-human': args.for_human === true ? true : undefined,
      delegate: args.delegate,
      'assigned-to': args.assigned_to,
      'parent-session-key': args.parent_session_key,
      'parent-ticket-id': args.parent_ticket_id,
      agent: args.agent,
      method: args.method
    }),
    subcommand: 'prompt'
  },
  {
    name: 'create_ticket',
    description:
      'Create a draft ticket without attaching (ovld protocol create). When session_key/ticket_id are provided, this creates a follow-up draft and project_id can override the current ticket project.',
    inputSchema: {
      type: 'object',
      properties: {
        objectives: OBJECTIVES_ARRAY_SCHEMA,
        title: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
        project_id: { type: 'string' },
        working_directory: { type: 'string' },
        personal: { type: 'boolean' },
        acceptance_criteria: { type: 'string' },
        available_tools: { type: 'string' },
        for_human: { type: 'boolean' },
        delegate: { type: 'string' },
        assigned_to: {
          type: 'string',
          description:
            'Assign the ticket to a member: username, email, user-id, or orgid:username (defaults to creator).'
        },
        session_key: { type: 'string' },
        ticket_id: { type: 'string' },
        agent: { type: 'string' }
      },
      required: ['objectives']
    },
    toCliFlags: args => ({
      'objectives-json': toCliObjectives(args.objectives),
      title: args.title,
      priority: args.priority,
      'project-id': args.project_id,
      'working-directory': args.working_directory,
      personal: args.personal === true ? true : undefined,
      'acceptance-criteria': args.acceptance_criteria,
      'available-tools': args.available_tools,
      'for-human': args.for_human === true ? true : undefined,
      delegate: args.delegate,
      'assigned-to': args.assigned_to,
      'session-key': args.session_key,
      'ticket-id': args.ticket_id,
      agent: args.agent
    }),
    subcommand: 'create'
  },
  {
    name: 'add_objectives',
    description: 'Append ordered objectives to an existing ticket.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket_id: {
          type: 'string',
          description: 'Ticket identifier (e.g. 1:899). Also accepts UUID.'
        },
        objectives: OBJECTIVES_ARRAY_SCHEMA
      },
      required: ['ticket_id', 'objectives']
    },
    toCliFlags: args => ({
      'ticket-id': args.ticket_id,
      'objectives-json': toCliObjectives(args.objectives)
    }),
    subcommand: 'add-objectives'
  },
  {
    name: 'update',
    description:
      'Post an Overlord progress update or activity event. Use begin_follow_up_work to explicitly reopen delivered/review tickets for follow-up execution.',
    inputSchema: {
      type: 'object',
      properties: {
        session_key: { type: 'string' },
        ticket_id: {
          type: 'string',
          description: 'Ticket identifier (e.g. 1:899). Also accepts UUID.'
        },
        summary: { type: 'string' },
        phase: {
          type: 'string',
          enum: ['draft', 'execute', 'review', 'deliver', 'complete', 'blocked', 'cancelled']
        },
        event_type: {
          type: 'string',
          enum: ['update', 'user_follow_up', 'alert', 'discussion_summary', 'decision']
        },
        begin_follow_up_work: { type: 'boolean' },
        follow_up_intent: {
          type: 'string',
          enum: ['discussion', 'execution', 'pending_delivery']
        },
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
      ...(args.begin_follow_up_work ? { 'begin-follow-up-work': true } : {}),
      'follow-up-intent': args.follow_up_intent,
      'external-url': args.external_url,
      'external-session-id': args.external_session_id,
      'payload-json': args.payload,
      'change-rationales-json': args.change_rationales
    }),
    subcommand: 'update'
  },
  {
    name: 'heartbeat',
    description:
      'Send a lightweight Overlord liveness ping without posting a ticket event. Optional phase/percent/note telemetry is stored on the session row.',
    inputSchema: {
      type: 'object',
      properties: {
        session_key: { type: 'string' },
        ticket_id: {
          type: 'string',
          description: 'Ticket identifier (e.g. 1:899). Also accepts UUID.'
        },
        phase: {
          type: 'string',
          enum: ['draft', 'execute', 'review', 'deliver', 'complete', 'blocked', 'cancelled']
        },
        percent: { type: 'number' },
        note: { type: 'string' },
        external_url: { type: ['string', 'null'] },
        external_session_id: { type: ['string', 'null'] }
      },
      required: ['session_key', 'ticket_id']
    },
    toCliFlags: args => ({
      'session-key': args.session_key,
      'ticket-id': args.ticket_id,
      phase: args.phase,
      percent: args.percent,
      note: args.note,
      'external-url': args.external_url,
      'external-session-id': args.external_session_id
    }),
    subcommand: 'heartbeat'
  },
  {
    name: 'record_change_rationales',
    description: 'Persist structured change rationale rows without posting a separate update.',
    inputSchema: {
      type: 'object',
      properties: {
        session_key: { type: 'string' },
        ticket_id: {
          type: 'string',
          description: 'Ticket identifier (e.g. 1:899). Also accepts UUID.'
        },
        summary: { type: 'string' },
        phase: {
          type: 'string',
          enum: ['draft', 'execute', 'review', 'deliver', 'complete', 'blocked', 'cancelled']
        },
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
    name: 'record_hook_event',
    description:
      "Record a hook lifecycle event for a ticket. Use hookType='Stop' with a session_key to check whether delivery is needed after a turn ends.",
    inputSchema: {
      type: 'object',
      properties: {
        hook_type: { type: 'string', enum: ['UserPromptSubmit', 'Stop'] },
        ticket_id: {
          type: 'string',
          description: 'Ticket identifier (e.g. 1:899). Also accepts UUID.'
        },
        prompt: { type: 'string' },
        turn_index: { type: 'number' },
        follow_up_intent: {
          type: 'string',
          enum: ['discussion', 'execution', 'pending_delivery']
        },
        external_session_id: {
          type: ['string', 'null'],
          description:
            'Optional native agent resume/session id to persist on the attached Overlord session.'
        },
        session_key: {
          type: 'string',
          description:
            'Optional session key for Stop hooks. When provided, the response includes deliveryStatus indicating whether delivery is needed.'
        }
      },
      required: ['hook_type', 'ticket_id']
    },
    toCliFlags: args => ({
      'hook-type': args.hook_type,
      'ticket-id': args.ticket_id,
      prompt: args.prompt,
      'turn-index': args.turn_index,
      'follow-up-intent': args.follow_up_intent,
      'external-session-id': args.external_session_id,
      'session-key': args.session_key
    }),
    subcommand: 'hook-event'
  },
  {
    name: 'ask',
    description: 'Send a blocking question to the human reviewer or PM.',
    inputSchema: {
      type: 'object',
      properties: {
        session_key: { type: 'string' },
        ticket_id: {
          type: 'string',
          description: 'Ticket identifier (e.g. 1:899). Also accepts UUID.'
        },
        question: { type: 'string' },
        phase: {
          type: 'string',
          enum: ['draft', 'execute', 'review', 'deliver', 'complete', 'blocked', 'cancelled']
        },
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
    name: 'read_context',
    description: 'Read persistent shared context entries for a ticket.',
    inputSchema: {
      type: 'object',
      properties: {
        session_key: { type: 'string' },
        ticket_id: {
          type: 'string',
          description: 'Ticket identifier (e.g. 1:899). Also accepts UUID.'
        },
        query: { type: 'string' },
        limit: { type: 'number' }
      },
      required: ['session_key']
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
    name: 'write_context',
    description: 'Write a persistent shared context entry for future Overlord sessions.',
    inputSchema: {
      type: 'object',
      properties: {
        session_key: { type: 'string' },
        ticket_id: {
          type: 'string',
          description: 'Ticket identifier (e.g. 1:899). Also accepts UUID.'
        },
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
    name: 'deliver',
    description:
      'Deliver final work back into Overlord with summary, optional artifacts, and optional change rationales (matches POST /api/protocol/deliver). Large payloads are streamed to the CLI through stdin, so this tool does not create delivery scratch files.',
    inputSchema: {
      type: 'object',
      properties: {
        session_key: { type: 'string' },
        ticket_id: {
          type: 'string',
          description: 'Ticket identifier (e.g. 1:899). Also accepts UUID.'
        },
        summary: { type: 'string' },
        artifacts: { type: 'array' },
        change_rationales: { type: 'array' },
        snapshot: {
          type: 'object',
          description:
            'Optional snapshot metadata (jj/git-worktree, workspace, jj ids). Merged with OVERLORD_SNAPSHOT_JSON when both are set.'
        },
        checkpoint: {
          type: 'object',
          description:
            'Optional checkpoint metadata. Local git checkpoints are created on `attach`, not deliver; this field is only for callers forwarding pre-recorded checkpoint provenance.'
        },
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
    toCliStdin: args =>
      JSON.stringify({
        summary: args.summary,
        ...(Array.isArray(args.artifacts) ? { artifacts: args.artifacts } : {}),
        ...(Array.isArray(args.change_rationales)
          ? { changeRationales: args.change_rationales }
          : {}),
        ...(args.snapshot && typeof args.snapshot === 'object' ? { snapshot: args.snapshot } : {}),
        ...(args.checkpoint && typeof args.checkpoint === 'object'
          ? { checkpoint: args.checkpoint }
          : {})
      }),
    subcommand: 'deliver'
  },
  {
    name: 'record_work',
    description: 'Record completed-from-chat work as a ticket in review + feed post (no attach).',
    inputSchema: {
      type: 'object',
      properties: {
        objectives: OBJECTIVES_ARRAY_SCHEMA,
        summary: { type: 'string' },
        title: { type: 'string' },
        artifacts: { type: 'array' },
        change_rationales: { type: 'array' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
        project_id: { type: 'string' },
        working_directory: { type: 'string' },
        personal: { type: 'boolean' },
        acceptance_criteria: { type: 'string' },
        available_tools: { type: 'string' },
        delegate: { type: 'string' },
        assigned_to: {
          type: 'string',
          description:
            'Assign the ticket to a member: username, email, user-id, or orgid:username (defaults to creator).'
        },
        agent: { type: 'string' },
        skip_file_change_check: { type: 'boolean' }
      },
      required: ['objectives', 'summary']
    },
    toCliFlags: args => ({
      'payload-file': '-',
      title: args.title,
      priority: args.priority,
      'project-id': args.project_id,
      'working-directory': args.working_directory,
      personal: args.personal === true ? true : undefined,
      'acceptance-criteria': args.acceptance_criteria,
      'available-tools': args.available_tools,
      delegate: args.delegate,
      'assigned-to': args.assigned_to,
      agent: args.agent,
      'skip-file-change-check': args.skip_file_change_check
    }),
    toCliStdin: args =>
      JSON.stringify({
        objectives: toCliObjectives(args.objectives),
        summary: args.summary,
        ...(Array.isArray(args.artifacts) ? { artifacts: args.artifacts } : {}),
        ...(Array.isArray(args.change_rationales)
          ? { changeRationales: args.change_rationales }
          : {})
      }),
    subcommand: 'record-work'
  },
  {
    name: 'list_attachments',
    description:
      'List objective attachments visible to the current ticket session. Returns attachment IDs needed by get_attachment_download_url, plus their objective_id, label, content_type, file_size, and storage_path.',
    inputSchema: {
      type: 'object',
      properties: {
        session_key: { type: 'string' },
        ticket_id: {
          type: 'string',
          description: 'Ticket identifier (e.g. 1:899). Also accepts UUID.'
        },
        objective_id: { type: 'string' }
      },
      required: ['session_key']
    },
    toCliFlags: args => ({
      'session-key': args.session_key,
      'ticket-id': args.ticket_id,
      'objective-id': args.objective_id
    }),
    subcommand: 'attachment-list'
  },
  {
    name: 'prepare_attachment_upload',
    description: 'Prepare an objective attachment upload and return a signed upload URL.',
    inputSchema: {
      type: 'object',
      properties: {
        session_key: { type: 'string' },
        ticket_id: {
          type: 'string',
          description: 'Ticket identifier (e.g. 1:899). Also accepts UUID.'
        },
        objective_id: { type: 'string' },
        file_name: { type: 'string' },
        label: { type: 'string' },
        content_type: { type: 'string' },
        file_size: { type: 'number' },
        metadata: { type: 'object' }
      },
      required: ['session_key', 'objective_id', 'file_name']
    },
    toCliFlags: args => ({
      'session-key': args.session_key,
      'ticket-id': args.ticket_id,
      'objective-id': args.objective_id,
      'file-name': args.file_name,
      label: args.label,
      'content-type': args.content_type,
      'file-size': args.file_size,
      'metadata-json': args.metadata
    }),
    subcommand: 'attachment-prepare-upload'
  },
  {
    name: 'finalize_attachment_upload',
    description:
      'Finalize an objective attachment after uploading bytes to the signed storage URL.',
    inputSchema: {
      type: 'object',
      properties: {
        session_key: { type: 'string' },
        ticket_id: {
          type: 'string',
          description: 'Ticket identifier (e.g. 1:899). Also accepts UUID.'
        },
        objective_id: { type: 'string' },
        storage_path: { type: 'string' },
        label: { type: 'string' },
        content_type: { type: 'string' },
        file_size: { type: 'number' },
        metadata: { type: 'object' }
      },
      required: ['session_key', 'objective_id', 'storage_path', 'label']
    },
    toCliFlags: args => ({
      'session-key': args.session_key,
      'ticket-id': args.ticket_id,
      'objective-id': args.objective_id,
      'storage-path': args.storage_path,
      label: args.label,
      'content-type': args.content_type,
      'file-size': args.file_size,
      'metadata-json': args.metadata
    }),
    subcommand: 'attachment-finalize-upload'
  },
  {
    name: 'get_attachment_download_url',
    description: 'Create a signed download URL for an uploaded objective attachment.',
    inputSchema: {
      type: 'object',
      properties: {
        session_key: { type: 'string' },
        ticket_id: {
          type: 'string',
          description: 'Ticket identifier (e.g. 1:899). Also accepts UUID.'
        },
        objective_id: { type: 'string' },
        attachment_id: { type: 'string' },
        storage_path: { type: 'string' },
        expires_in: { type: 'number' }
      },
      required: ['session_key']
    },
    toCliFlags: args => ({
      'session-key': args.session_key,
      'ticket-id': args.ticket_id,
      'objective-id': args.objective_id,
      'attachment-id': args.attachment_id,
      'storage-path': args.storage_path,
      'expires-in': args.expires_in
    }),
    subcommand: 'attachment-download-url'
  },
  {
    name: 'upload_attachment_file',
    description:
      'Prepare, upload, and finalize a local file as an objective attachment in one step.',
    inputSchema: {
      type: 'object',
      properties: {
        session_key: { type: 'string' },
        ticket_id: {
          type: 'string',
          description: 'Ticket identifier (e.g. 1:899). Also accepts UUID.'
        },
        objective_id: { type: 'string' },
        file: { type: 'string' },
        file_name: { type: 'string' },
        label: { type: 'string' },
        content_type: { type: 'string' },
        metadata: { type: 'object' }
      },
      required: ['session_key', 'objective_id', 'file']
    },
    toCliFlags: args => ({
      'session-key': args.session_key,
      'ticket-id': args.ticket_id,
      'objective-id': args.objective_id,
      file: args.file,
      'file-name': args.file_name,
      label: args.label,
      'content-type': args.content_type,
      'metadata-json': args.metadata
    }),
    subcommand: 'attachment-upload-file'
  },

  // ---------------------------------------------------------------------------
  // Device + project resources (hosted MCP parity; maps to ovld protocol)
  // ---------------------------------------------------------------------------
  {
    name: 'get_device',
    description:
      'Register or refresh the caller device (pass a stable fingerprint and optional hostname/platform). Prefer calling before add_project_resource.',
    inputSchema: {
      type: 'object',
      properties: {
        device_fingerprint: {
          type: 'string',
          description: 'Stable UUID or token stored locally for this workstation.'
        },
        device_hostname: { type: 'string' },
        device_platform: {
          type: 'string',
          description: 'e.g. darwin, linux, win32.'
        }
      },
      required: ['device_fingerprint']
    },
    toCliFlags: args => ({
      'device-fingerprint': args.device_fingerprint,
      ...(typeof args.device_hostname === 'string' && args.device_hostname.trim().length > 0
        ? { 'device-hostname': args.device_hostname }
        : {}),
      ...(typeof args.device_platform === 'string' && args.device_platform.trim().length > 0
        ? { 'device-platform': args.device_platform }
        : {})
    }),
    subcommand: 'get-device'
  },
  {
    name: 'update_device',
    description:
      'Rename this device label (lowercase kebab-case, unique per organization). Requires the same device_fingerprint.',
    inputSchema: {
      type: 'object',
      properties: {
        device_fingerprint: { type: 'string' },
        label: { type: 'string' }
      },
      required: ['device_fingerprint', 'label']
    },
    toCliFlags: args => ({
      'device-fingerprint': args.device_fingerprint,
      label: args.label
    }),
    subcommand: 'update-device'
  },
  {
    name: 'create_project',
    description:
      'Create a new project. By default the current working directory is registered as the project\'s primary resource in one step; pass no_directory:true for a bare project, or directory_path to link a specific directory.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Project name.' },
        color: { type: 'string', description: 'Optional hex color like #d4d4d8.' },
        directory_path: {
          type: 'string',
          description: 'Absolute path to register as primary; omit to use cwd.'
        },
        no_directory: {
          type: 'boolean',
          description: 'Create a bare project without registering any directory.'
        },
        device_fingerprint: { type: 'string' },
        label: { type: 'string' },
        is_primary: { type: 'boolean' },
        device_hostname: { type: 'string' },
        device_platform: { type: 'string' },
        organization_id: { type: 'string' }
      },
      required: ['name']
    },
    toCliFlags: args => ({
      name: args.name,
      ...(typeof args.color === 'string' && args.color.trim().length > 0
        ? { color: args.color.trim() }
        : {}),
      ...(args.no_directory === true || args.no_directory === 'true'
        ? { directory: 'false' }
        : typeof args.directory_path === 'string' && args.directory_path.trim().length > 0
          ? { directory: args.directory_path }
          : {}),
      ...(typeof args.device_fingerprint === 'string' && args.device_fingerprint.trim().length > 0
        ? { 'device-fingerprint': args.device_fingerprint.trim() }
        : {}),
      ...(typeof args.label === 'string' ? { label: args.label } : {}),
      ...(args.is_primary !== undefined
        ? { 'is-primary': args.is_primary === true || args.is_primary === 'true' }
        : {}),
      ...(typeof args.device_hostname === 'string' && args.device_hostname.trim().length > 0
        ? { 'device-hostname': args.device_hostname }
        : {}),
      ...(typeof args.device_platform === 'string' && args.device_platform.trim().length > 0
        ? { 'device-platform': args.device_platform }
        : {}),
      ...(typeof args.organization_id === 'string' && args.organization_id.trim().length > 0
        ? { 'organization-id': args.organization_id.trim() }
        : {})
    }),
    subcommand: 'create-project'
  },
  {
    name: 'list_project_resources',
    description:
      'List directories registered as resources for a project. Optionally filter by device_fingerprint to the device registered for this org session.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Project UUID.' },
        device_fingerprint: {
          type: 'string',
          description:
            'When set with this org scope, restricts results to directories for this org + user device.'
        }
      },
      required: ['project_id']
    },
    toCliFlags: args => ({
      'project-id': args.project_id,
      ...(typeof args.device_fingerprint === 'string' && args.device_fingerprint.trim().length > 0
        ? { 'device-fingerprint': args.device_fingerprint.trim() }
        : {})
    }),
    subcommand: 'list-project-resources'
  },
  {
    name: 'add_project_resource',
    description:
      'Attach a filesystem directory to this project on the current machine. Directory must exist; device is keyed by fingerprint (per org).',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        directory_path: {
          type: 'string',
          description: 'Absolute path; omit to use cwd (CLI verifies existence).'
        },
        device_fingerprint: { type: 'string' },
        label: { type: 'string' },
        is_primary: { type: 'boolean' },
        device_hostname: { type: 'string' },
        device_platform: { type: 'string' }
      },
      required: ['project_id', 'device_fingerprint']
    },
    toCliFlags: args => ({
      'project-id': args.project_id,
      ...(typeof args.directory_path === 'string' && args.directory_path.trim().length > 0
        ? { directory: args.directory_path }
        : {}),
      'device-fingerprint': args.device_fingerprint,
      ...(typeof args.label === 'string' ? { label: args.label } : {}),
      ...(args.is_primary === true || args.is_primary === 'true' ? { 'is-primary': true } : {}),
      ...(typeof args.device_hostname === 'string' && args.device_hostname.trim().length > 0
        ? { 'device-hostname': args.device_hostname }
        : {}),
      ...(typeof args.device_platform === 'string' && args.device_platform.trim().length > 0
        ? { 'device-platform': args.device_platform }
        : {})
    }),
    subcommand: 'add-project-resource'
  },
  {
    name: 'update_project_resource',
    description:
      'Update path / label / primary flag for one resource directory. Must belong to the device fingerprint in this org.',
    inputSchema: {
      type: 'object',
      properties: {
        resource_id: { type: 'string' },
        device_fingerprint: { type: 'string' },
        directory_path: { type: 'string' },
        label: {
          oneOf: [{ type: 'string' }, { type: 'null' }],
          description: 'Use string "null" to clear via CLI shim pass-through.'
        },
        is_primary: { type: 'boolean' }
      },
      required: ['resource_id', 'device_fingerprint']
    },
    toCliFlags: args => ({
      'resource-id': args.resource_id,
      'device-fingerprint': args.device_fingerprint,
      ...(typeof args.directory_path === 'string' ? { directory: args.directory_path.trim() } : {}),
      ...(typeof args.label === 'undefined'
        ? {}
        : { label: args.label === null ? 'null' : String(args.label) }),
      ...(args.is_primary !== undefined
        ? { 'is-primary': args.is_primary === true || args.is_primary === 'true' }
        : {})
    }),
    subcommand: 'update-project-resource'
  },
  {
    name: 'request_execution',
    description:
      'Queue an objective for local or remote runner execution. Manual Run and auto-advance use this durable queue.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket_id: { type: 'string' },
        objective_id: { type: 'string' },
        requested_from: { type: 'string' },
        idempotency_key: { type: 'string' },
        agent: { type: 'string' },
        model: { type: 'string' },
        thinking: { type: 'string' },
        launch_mode: { type: 'string', enum: ['run', 'ask'] },
        working_directory: { type: 'string' },
        ssh_command: { type: 'string' },
        remote_working_directory: { type: 'string' },
        server_multiplexer: { type: 'string', enum: ['none', 'tmux'] },
        tmux_command: { type: 'string' },
        target_kind: { type: 'string', enum: ['any', 'local', 'ssh'] },
        target_device_id: { type: 'string' },
        target_resource_id: { type: 'string' }
      },
      required: ['ticket_id']
    },
    toCliFlags: args => ({
      'ticket-id': args.ticket_id,
      'objective-id': args.objective_id,
      'requested-from': args.requested_from,
      'idempotency-key': args.idempotency_key,
      agent: args.agent,
      model: args.model,
      thinking: args.thinking,
      'launch-mode': args.launch_mode,
      'working-directory': args.working_directory,
      'ssh-command': args.ssh_command,
      'remote-working-directory': args.remote_working_directory,
      'server-multiplexer': args.server_multiplexer,
      'tmux-command': args.tmux_command,
      'target-kind': args.target_kind,
      'target-device-id': args.target_device_id,
      'target-resource-id': args.target_resource_id
    }),
    subcommand: 'request-execution'
  },
  {
    name: 'claim_execution',
    description: 'Claim one queued execution request for this device.',
    inputSchema: {
      type: 'object',
      properties: {
        device_fingerprint: { type: 'string' },
        device_hostname: { type: 'string' },
        device_platform: { type: 'string' },
        lease_seconds: { type: 'number' },
        project_id: { type: 'string' }
      },
      required: ['device_fingerprint']
    },
    toCliFlags: args => ({
      'device-fingerprint': args.device_fingerprint,
      'device-hostname': args.device_hostname,
      'device-platform': args.device_platform,
      'lease-seconds': args.lease_seconds,
      'project-id': args.project_id
    }),
    subcommand: 'claim-execution'
  },
  {
    name: 'list_execution_requests',
    description: 'List active execution requests in the local runner queue.',
    inputSchema: {
      type: 'object',
      properties: {
        device_fingerprint: { type: 'string' },
        project_id: { type: 'string' }
      }
    },
    toCliFlags: args => ({
      'device-fingerprint': args.device_fingerprint,
      'project-id': args.project_id
    }),
    subcommand: 'list-execution-requests'
  },
  {
    name: 'list_execution_targets',
    description: 'List execution targets (runner devices) the authenticated user has access to, including their label and id.',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    toCliFlags: () => ({}),
    subcommand: 'list-execution-targets'
  },
  {
    name: 'clear_execution_requests',
    description: 'Clear active execution requests from the local runner queue.',
    inputSchema: {
      type: 'object',
      properties: {
        objective_id: { type: 'string' },
        clear_all: { type: 'boolean' },
        project_id: { type: 'string' }
      }
    },
    toCliFlags: args => ({
      'objective-id': args.objective_id,
      ...(args.clear_all ? { 'clear-all': true } : {}),
      'project-id': args.project_id
    }),
    subcommand: 'clear-execution-requests'
  },
  {
    name: 'complete_execution_launch',
    description: 'Mark a claimed execution request as launched.',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: { type: 'string' },
        device_fingerprint: { type: 'string' },
        launched_session_id: { type: 'string' }
      },
      required: ['request_id', 'device_fingerprint']
    },
    toCliFlags: args => ({
      'request-id': args.request_id,
      'device-fingerprint': args.device_fingerprint,
      'launched-session-id': args.launched_session_id
    }),
    subcommand: 'complete-execution-launch'
  },
  {
    name: 'fail_execution_launch',
    description: 'Mark a claimed execution request failed and record the launch error.',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: { type: 'string' },
        device_fingerprint: { type: 'string' },
        error: { type: 'string' }
      },
      required: ['request_id', 'device_fingerprint', 'error']
    },
    toCliFlags: args => ({
      'request-id': args.request_id,
      'device-fingerprint': args.device_fingerprint,
      error: args.error
    }),
    subcommand: 'fail-execution-launch'
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
        description: 'Maximum number of results to return (1–50, default 8).'
      },
      project_id: {
        type: 'string',
        description:
          'Optional project UUID or name to restrict results. Names are matched case-insensitively.'
      }
    }
  },
  toCliFlags: args => ({
    query: args.query,
    statuses: Array.isArray(args.statuses) ? args.statuses.join(',') : args.statuses,
    'include-completed': args.include_completed,
    limit: args.limit,
    'project-id': args.project_id
  }),
  subcommand: 'search-tickets'
};

const allListedTools = [...tools, searchTicketsTool];

const toolMap = new Map(allListedTools.map(tool => [tool.name, tool]));
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
      headerText.split('\r\n').map(line => {
        const separatorIndex = line.indexOf(':');
        return [
          line.slice(0, separatorIndex).trim().toLowerCase(),
          line.slice(separatorIndex + 1).trim()
        ];
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
      typeof value === 'string' || typeof value === 'number'
        ? String(value)
        : JSON.stringify(value);
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
          AGENT_IDENTIFIER: process.env.AGENT_IDENTIFIER ?? 'codex'
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
        version: '0.1.6'
      },
      instructions:
        'Use these tools to drive Overlord ticket workflows through the installed ovld CLI. Names mirror hosted MCP tools (attach, update, deliver, get_device, list_project_resources, …). Session tools need attach/connect. Devices are scoped to organization + user + fingerprint — call get_device before add_project_resource.'
    });
    return;
  }

  if (method === 'ping') {
    success(id, {});
    return;
  }

  if (method === 'tools/list') {
    success(id, {
      tools: allListedTools.map(tool => ({
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
