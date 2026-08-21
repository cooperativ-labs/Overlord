#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const OVLD_BIN = process.env.OVLD_BIN?.trim() || 'ovld';
const PROTOCOL_VERSION = '2025-06-18';
const DEFAULT_AGENT = '__OVERLORD_ADAPTER_KEY__';
let buffer = Buffer.alloc(0);

function send(message) {
  const json = JSON.stringify(message);
  const body = Buffer.from(json, 'utf8');
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8');
  process.stdout.write(Buffer.concat([header, body]));
}

function parseMessages(chunk) {
  buffer = Buffer.concat([buffer, chunk]);
  const messages = [];
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;
    const headerText = buffer.subarray(0, headerEnd).toString('utf8');
    const lengthMatch = headerText.match(/Content-Length:\s*(\d+)/i);
    if (!lengthMatch) throw new Error('Missing Content-Length header');
    const contentLength = Number(lengthMatch[1]);
    const totalLength = headerEnd + 4 + contentLength;
    if (buffer.length < totalLength) break;
    const body = buffer.subarray(headerEnd + 4, totalLength).toString('utf8');
    buffer = buffer.subarray(totalLength);
    messages.push(JSON.parse(body));
  }
  return messages;
}

async function runProtocol(subcommand, args = {}) {
  const flags = Object.entries(args).flatMap(([key, value]) => {
    if (value === undefined || value === null) return [];
    if (typeof value === 'boolean') return value ? [`--${key}`] : [];
    if (Array.isArray(value)) return [`--${key}`, JSON.stringify(value)];
    if (typeof value === 'object') return [`--${key}-json`, JSON.stringify(value)];
    return [`--${key}`, String(value)];
  });

  try {
    const { stdout } = await execFileAsync(OVLD_BIN, ['protocol', subcommand, ...flags], {
      env: {
        ...process.env,
        AGENT_IDENTIFIER: process.env.AGENT_IDENTIFIER ?? DEFAULT_AGENT
      },
      maxBuffer: 20 * 1024 * 1024
    });
    const data = stdout.trim() ? JSON.parse(stdout) : {};
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      structuredContent: data
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: [{ type: 'text', text: message }], isError: true };
  }
}

function objectSchema(properties, required = []) {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false
  };
}

function stringProperty(description) {
  return { type: 'string', description };
}

function booleanProperty(description) {
  return { type: 'boolean', description };
}

function compactSearchResponse(response) {
  const value = response?.structuredContent;
  if (!value || value.version !== 3 || !Array.isArray(value.results)) return response;
  const compact = {
    ...value,
    results: value.results.map(result => ({
      ...result,
      matches: Array.isArray(result.matches)
        ? result.matches
            .slice(0, 2)
            .map(match => {
              const compactMatch = { ...match };
              delete compactMatch.snippet;
              delete compactMatch.matchedTerms;
              delete compactMatch.createdAt;
              delete compactMatch.updatedAt;
              return compactMatch;
            })
        : result.matches
    }))
  };
  return {
    ...response,
    content: [{ type: 'text', text: JSON.stringify(compact, null, 2) }],
    structuredContent: compact
  };
}

const tools = [
  {
    name: 'overlord_resolve_project',
    title: 'Resolve Overlord project',
    description:
      "Resolve a project by id, slug, name, or linked repository directory metadata exposed to the MCP client. Names are matched case-insensitively across every workspace the caller can reach; a name matching in more than one returns a 'project_selection_required' result listing the candidates with their workspaces — ask the user, then retry with workspaceId.",
    inputSchema: objectSchema({
      projectId: stringProperty('Explicit Overlord project id, slug, or project name.'),
      workspaceId: stringProperty(
        "Optional workspace (id, slug, or name) narrowing an ambiguous projectId. Use this to retry after a 'project_selection_required' result."
      ),
      directory: stringProperty(
        'Optional repository directory path when the MCP client can expose one with .overlord/project.json.'
      )
    })
  },
  {
    name: 'overlord_create_project',
    title: 'Create Overlord project',
    description:
      'Create a new Overlord project. If the caller belongs to more than one workspace and none is given, returns a workspace_selection_required result listing the workspaces for the user to choose.',
    inputSchema: objectSchema(
      {
        name: stringProperty('New project name.'),
        workspaceId: stringProperty(
          'Workspace to create the project in (id, slug, or name). Required only when the caller belongs to multiple workspaces.'
        ),
        description: stringProperty('Optional project description.'),
        slug: stringProperty('Optional project slug; defaults to a slug derived from the name.')
      },
      ['name']
    )
  },
  {
    name: 'overlord_list_project_statuses',
    title: 'List Overlord project statuses',
    description:
      "Read one project's board columns. Status names and order are defined per project, so two projects in the same workspace can label the same lifecycle differently; each status also carries a stable type (draft, next, execute, review, complete, blocked, cancelled) that does not vary by project.",
    inputSchema: objectSchema(
      {
        projectId: stringProperty(
          "Overlord project id, slug, or name. An ambiguous name returns 'project_selection_required'; retry with workspaceId."
        ),
        workspaceId: stringProperty(
          'Optional workspace (id, slug, or name) narrowing an ambiguous projectId.'
        )
      },
      ['projectId']
    )
  },
  {
    name: 'overlord_search_missions',
    title: 'Search Overlord missions',
    description:
      "Search mission anchors with their matching objectives and deliveries across authorized workspaces. An objective displayId can be passed directly to overlord_load_mission_context; matches are matched-only, not the full objective list. Artifacts are not indexed. Use absolute ISO from/to bounds (no relative dates or implicit window), inspect workspaceCounts, entityCounts, and truncatedCandidates before claiming completeness, and treat appliedFilters.mode 'fallback' as a recency listing. Compact detail is default; request full for child snippets and metadata.",
    inputSchema: objectSchema({
      query: stringProperty('Search query text.'),
      status: stringProperty(
        'Comma-separated status TYPES, such as draft,next,execute,review. Types are workspace-invariant (draft, next, execute, review, complete, blocked, cancelled). Project-defined status names are not accepted here.'
      ),
      projectId: stringProperty(
        "Optional project reference: a stable UUID, a slug, or the project name as the user said it. Names are matched case-insensitively against the projects the caller can reach. If the name matches in more than one workspace the call returns a 'project_selection_required' result listing the candidates with their workspaces — ask the user which one, then retry with workspaceId set."
      ),
      workspaceId: stringProperty(
        "Optional workspace (id, slug, or name) narrowing an ambiguous projectId. Use this to retry after a 'project_selection_required' result."
      ),
      resourceKey: stringProperty(
        'Optional logical resource key, matched by name within selected projects.'
      ),
      dateField: stringProperty(
        'Date column for an explicit range: createdAt, updatedAt, or dueDatetime. Use dueDatetime for questions about what is scheduled or due; missions with no due date are excluded from a dueDatetime range.'
      ),
      from: stringProperty('Optional inclusive ISO-8601 date/time lower bound.'),
      to: stringProperty('Optional exclusive ISO-8601 date/time upper bound.'),
      limit: {
        type: 'number',
        description: 'Maximum result count. Defaults to 25.'
      },
      entityTypes: stringProperty(
        'Optional comma-separated v3 entity types: mission, objective, delivery.'
      ),
      objectiveStates: stringProperty(
        'Optional comma-separated v3 objective states for matching objectives.'
      ),
      matchesPerResult: {
        type: 'number',
        description:
          'Optional v3 child-match cap per mission (default 3, max 10; compact returns at most 2).'
      },
      detail: {
        type: 'string',
        enum: ['compact', 'full'],
        description:
          'Result detail: compact (default) keeps child navigation fields and removes child snippets/metadata; full returns complete v3 child matches.'
      }
    })
  },
  {
    name: 'overlord_create_mission',
    title: 'Create Overlord mission',
    description:
      'Create a draft mission in projectId, or an account-owned inbox item when projectId is omitted. This connector never chooses a project implicitly.',
    inputSchema: objectSchema(
      {
        projectId: stringProperty('Optional Overlord project id, slug, or name.'),
        objective: stringProperty('Initial objective text.'),
        title: stringProperty('Optional mission title.'),
        resourceKey: stringProperty('Optional logical project resource key for the objective.'),
        assignedTo: stringProperty(
          'Optional workspace member to own the mission (workspace_users.id, profile UUID, orgid:username, bare username, or email). Rejected when the member is not in the workspace; meaningless on the inbox fallback.'
        ),
        autoAdvance: booleanProperty(
          'When true, Overlord queues the next objective for execution after this one is delivered. Defaults to false.'
        )
      },
      ['objective']
    )
  },
  {
    name: 'overlord_create_inbox_item',
    title: 'Create inbox item',
    description: 'Create a private, account-owned unassigned task capture.',
    inputSchema: objectSchema(
      {
        title: stringProperty('Inbox item title.'),
        objective: stringProperty('The one objective captured in v1.')
      },
      ['title', 'objective']
    )
  },
  {
    name: 'overlord_load_mission_context',
    title: 'Load mission context',
    description:
      'Load structured mission context, objectives, history, artifacts, and shared context.',
    inputSchema: objectSchema(
      {
        missionId: stringProperty(
          'Mission UUID or workspace display id. Optional when objectiveId is a display id such as coo:756.k7xm, which already names its mission.'
        ),
        objectiveId: stringProperty(
          'Objective UUID or display id such as coo:756.k7xm. Returns that objective as the current one instead of rediscovering the mission active objective.'
        ),
        executionTargetId: stringProperty(
          'Optional local execution target id for resolving sibling project resource paths.'
        )
      },
      []
    )
  },
  {
    name: 'overlord_list_deliveries',
    title: 'List mission deliveries',
    description:
      'Use this to read a mission\'s delivered work after locating it. Returns newest-first normalized delivery records including summary, verification, follow-up notes, and authoritative delivery evidence; it never exposes raw delivery payloads.',
    inputSchema: objectSchema({
      missionId: stringProperty(
        'Mission UUID or workspace display id. Optional when objectiveId is a display id such as coo:756.k7xm, which already names its mission.'
      ),
      objectiveId: stringProperty(
        'Objective UUID or display id such as coo:756.k7xm. Use a display id when that is the only identifier available.'
      )
    })
  },
  {
    name: 'overlord_launch_objective',
    title: 'Launch objective execution',
    description:
      'Use this only when the user explicitly asks to start a particular objective. It queues the normal Overlord execution request; it does not attach this MCP agent to perform the work. An existing active request is returned instead of duplicated.',
    inputSchema: objectSchema(
      {
        objectiveId: stringProperty('Objective UUID or display id such as coo:756.k7xm.'),
        agent: stringProperty('Agent identifier to launch, such as codex or claude.'),
        model: stringProperty('Optional model identifier to snapshot onto the execution request.'),
        reasoningEffort: stringProperty(
          'Optional reasoning-effort setting to snapshot onto the execution request.'
        ),
        executionTargetId: stringProperty(
          'Optional eligible execution target id. Omit to use the project\'s normal target selection.'
        )
      },
      ['objectiveId', 'agent']
    )
  },
  {
    name: 'overlord_reorder_future_objectives',
    title: 'Reorder future objectives',
    description:
      'Use this only when the user explicitly asks to change future-objective order in one mission. Supply every future objective UUID in its complete desired top-to-bottom order; draft, active, and completed objectives cannot be moved by this tool.',
    inputSchema: objectSchema(
      {
        missionId: stringProperty('Mission UUID.'),
        orderedObjectiveIds: {
          type: 'array',
          description:
            'Complete desired top-to-bottom UUID order of every objective currently in the future state.',
          items: stringProperty('Future objective UUID.')
        }
      },
      ['missionId', 'orderedObjectiveIds']
    )
  },
  {
    name: 'overlord_add_objectives',
    title: 'Add objectives',
    description: 'Append one or more draft objectives to an existing mission.',
    inputSchema: objectSchema(
      {
        missionId: stringProperty(
          'Mission UUID or workspace display id. Optional when objectiveId is a display id such as coo:756.k7xm, which already names its mission.'
        ),
        objectiveId: stringProperty(
          'Objective UUID or display id such as coo:756.k7xm. Used only to supply missionId when it is omitted.'
        ),
        objectives: {
          type: 'array',
          description:
            'Objective objects with objective text and optional title, resourceKey, and autoAdvance.',
          items: objectSchema({
            objective: stringProperty('Objective text.'),
            title: stringProperty('Optional objective title.'),
            resourceKey: stringProperty('Optional logical project resource key.'),
            autoAdvance: booleanProperty(
              'When true, Overlord queues the next objective for execution after this one is delivered. Defaults to false.'
            )
          })
        }
      },
      ['objectives']
    )
  },
  {
    name: 'overlord_update_objective',
    title: 'Update objective',
    description:
      'Turn auto-advance on or off and/or edit instruction text on a draft or future objective.',
    inputSchema: objectSchema(
      {
        objectiveId: stringProperty('Objective UUID or display id.'),
        autoAdvance: booleanProperty(
          'When true, Overlord queues the next objective after this one is delivered. When false, delivery waits for approval.'
        ),
        instructionText: stringProperty(
          'Replacement instruction text. Allowed only when the objective is in draft or future state; blank clears the text in those states.'
        )
      },
      ['objectiveId']
    )
  },
  {
    name: 'overlord_queue_objective',
    title: 'Queue objective',
    description:
      'Use this only when the user explicitly asks to add, move, or remove an objective in the project Run Queue. Queue membership is target-neutral and sequences delivery-driven launches; it does not directly launch the objective.',
    inputSchema: objectSchema(
      {
        objectiveId: stringProperty('Objective UUID or display id such as coo:756.k7xm.'),
        queue: stringProperty('Optional Run Queue UUID or unambiguous queue name.'),
        after: stringProperty(
          'Optional queued predecessor entry id, objective UUID, or objective display id. Its queue is used when queue is omitted.'
        ),
        remove: booleanProperty(
          'When true, remove this objective from the Run Queue instead of adding or moving it.'
        )
      },
      ['objectiveId']
    )
  },
  {
    name: 'overlord_attach_session',
    title: 'Attach to mission',
    description:
      'Attach an MCP-hosted agent session to a mission before update/ask/deliver. Pass objectiveId when the caller already knows which objective to execute.',
    inputSchema: objectSchema(
      {
        missionId: stringProperty(
          'Mission UUID or workspace display id. Optional when objectiveId is a display id such as coo:756.k7xm, which already names its mission.'
        ),
        objectiveId: stringProperty(
          'Optional objective UUID or display id (e.g. coo:756.k7xm). Pins attach to that objective.'
        ),
        agent: stringProperty(`Agent identifier. Defaults to ${DEFAULT_AGENT}.`),
        model: stringProperty('Optional model identifier.'),
        executionTargetId: stringProperty(
          'Optional local execution target id for resolving sibling project resource paths.'
        )
      },
      []
    )
  },
  {
    name: 'overlord_update_session',
    title: 'Update mission session',
    description: 'Post an update, alert, decision, or discussion summary for an attached session.',
    inputSchema: objectSchema(
      {
        missionId: stringProperty(
          'Mission UUID or workspace display id. Optional when objectiveId is a display id such as coo:756.k7xm, which already names its mission.'
        ),
        objectiveId: stringProperty(
          'Objective UUID or display id such as coo:756.k7xm. Supplies missionId when it is omitted; the session key still determines which objective the event lands on.'
        ),
        sessionKey: stringProperty('Session key returned by overlord_attach_session.'),
        summary: stringProperty('Update text.'),
        phase: stringProperty('Optional protocol phase.'),
        eventType: stringProperty('Optional event type. Defaults to update.')
      },
      ['sessionKey', 'summary']
    )
  },
  {
    name: 'overlord_deliver_session',
    title: 'Deliver mission session',
    description:
      'Deliver an attached session with explicit summary, optional change rationales, and optional human-action/tradeoff evidence.',
    inputSchema: objectSchema(
      {
        missionId: stringProperty(
          'Mission UUID or workspace display id. Optional when objectiveId is a display id such as coo:756.k7xm, which already names its mission.'
        ),
        objectiveId: stringProperty(
          'Objective UUID or display id such as coo:756.k7xm. Supplies missionId when it is omitted; the session key still determines which objective is delivered.'
        ),
        sessionKey: stringProperty('Session key returned by overlord_attach_session.'),
        summary: stringProperty('Delivery summary.'),
        artifacts: {
          type: 'array',
          description: 'Optional mission artifacts to persist with this delivery.'
        },
        noFileChanges: {
          type: 'boolean',
          description: 'Set true when the MCP run changed no files.'
        },
        changeRationales: {
          type: 'array',
          description: 'Explicit change rationale objects, if files were changed.'
        },
        humanActions: {
          type: 'array',
          description:
            'Concrete actions a human must perform; exclude Git operations and routine review/testing.'
        },
        tradeoffsMade: {
          type: 'array',
          description: 'Implementation decisions, alternatives considered, and rationale.'
        },
        knownRisks: { type: 'array', description: 'Residual risks or limitations.' },
        deferredWork: { type: 'array', description: 'Intentionally deferred work.' },
        assumptions: { type: 'array', description: 'Material implementation assumptions.' }
      },
      ['sessionKey', 'summary']
    )
  },
  {
    name: 'overlord_add_artifact',
    title: 'Add mission artifact',
    description:
      'Create a mission artifact during a turn without delivering (plan, notes, decision, URL). Provide type, label, and at least one of contentText or externalUrl. Optional sessionKey stamps provenance. Revise later with overlord_update_artifact.',
    inputSchema: objectSchema(
      {
        missionId: stringProperty(
          'Mission UUID or workspace display id. Optional when objectiveId is a display id such as coo:756.k7xm, which already names its mission.'
        ),
        objectiveId: stringProperty(
          'Objective UUID or display id such as coo:756.k7xm. Stamps objective provenance when no live sessionKey is available.'
        ),
        type: stringProperty(
          'Artifact type: test_results, next_steps, note, url, decision, or migration.'
        ),
        label: stringProperty('Human-facing label.'),
        contentText: stringProperty('Optional Markdown/text content.'),
        externalUrl: stringProperty('Optional HTTP(S) URL.'),
        sessionKey: stringProperty('Optional live session key from attach.')
      },
      ['type', 'label']
    )
  },
  {
    name: 'overlord_update_artifact',
    title: 'Update mission artifact',
    description:
      'Revise an existing mission artifact in place (label, Markdown content, and/or URL) using optimistic concurrency via expectedRevision.',
    inputSchema: objectSchema(
      {
        missionId: stringProperty(
          'Mission UUID or workspace display id. Optional when objectiveId is a display id such as coo:756.k7xm, which already names its mission.'
        ),
        objectiveId: stringProperty(
          'Objective UUID or display id such as coo:756.k7xm. Used only to supply missionId when it is omitted.'
        ),
        artifactId: stringProperty('Artifact id from mission context.'),
        expectedRevision: {
          type: 'number',
          description: 'Current artifact.revision. Stale values return a conflict error.'
        },
        label: stringProperty('Optional new human-facing label.'),
        contentText: stringProperty('Optional new Markdown/text content.'),
        externalUrl: stringProperty('Optional HTTP(S) URL.')
      },
      ['artifactId', 'expectedRevision']
    )
  },
  {
    name: 'overlord_record_work',
    title: 'Record completed work as a mission',
    description:
      'Record work already completed in this chat as a mission that lands in review — one call, no attach/deliver cycle. Records file-change rationales and runs the delivery through the standard Gemini summarizer.',
    inputSchema: objectSchema(
      {
        projectId: stringProperty('Overlord project id, slug, or name.'),
        objective: stringProperty('What was asked and done, phrased as a completed objective.'),
        summary: stringProperty('Reviewer-facing narrative of what changed and why.'),
        title: stringProperty('Optional mission title.'),
        changeRationales: {
          type: 'array',
          description:
            'One entry per meaningful file change (filePath, label, summary, why, impact).'
        },
        changedFiles: {
          type: 'array',
          description: 'Optional extra touched files without a full rationale.'
        },
        artifacts: {
          type: 'array',
          description: 'Optional artifacts: next_steps, test_results, decision, note, or url.'
        }
      },
      ['projectId', 'objective', 'summary']
    )
  }
];

function optionalString(args, name) {
  const value = args?.[name];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requiredString(args, name) {
  const value = optionalString(args, name);
  if (!value) throw new Error(`Missing required argument: ${name}`);
  return value;
}

/**
 * Forward mission/objective addressing to the CLI. The CLI owns the shared
 * `@overlord/contract` parser and derives a mission from a display id before it
 * performs local bookkeeping or calls the backend, so this standalone shim
 * does not carry a second copy of the public-id regex.
 */
function missionScopeFlags(args) {
  const objectiveId = optionalString(args, 'objectiveId');
  const missionId = optionalString(args, 'missionId');
  if (!missionId && !objectiveId) {
    throw new Error(
      'Missing required argument: missionId (pass it, or an objective display id such as coo:756.k7xm as objectiveId)'
    );
  }
  return {
    ...(missionId ? { 'mission-id': missionId } : {}),
    ...(objectiveId ? { 'objective-id': objectiveId } : {})
  };
}

async function callOverlordTool(name, args) {
  if (name === 'overlord_resolve_project') {
    return runProtocol('discover-project', {
      ...(optionalString(args, 'projectId')
        ? { 'project-id': requiredString(args, 'projectId') }
        : {}),
      ...(optionalString(args, 'workspaceId')
        ? { 'workspace-id': requiredString(args, 'workspaceId') }
        : {}),
      ...(optionalString(args, 'directory') ? { directory: requiredString(args, 'directory') } : {})
    });
  }
  if (name === 'overlord_create_project') {
    return runProtocol('create-project', {
      name: requiredString(args, 'name'),
      ...(optionalString(args, 'workspaceId')
        ? { 'workspace-id': requiredString(args, 'workspaceId') }
        : {}),
      ...(optionalString(args, 'description')
        ? { description: requiredString(args, 'description') }
        : {}),
      ...(optionalString(args, 'slug') ? { slug: requiredString(args, 'slug') } : {})
    });
  }
  if (name === 'overlord_list_project_statuses') {
    return runProtocol('statuses', {
      'project-id': requiredString(args, 'projectId'),
      ...(optionalString(args, 'workspaceId')
        ? { 'workspace-id': requiredString(args, 'workspaceId') }
        : {})
    });
  }
  if (name === 'overlord_search_missions') {
    const detail = optionalString(args, 'detail') || 'compact';
    if (detail !== 'compact' && detail !== 'full') {
      throw new Error("detail must be 'compact' or 'full'");
    }
    const response = await runProtocol('search', {
      'response-version': '3',
      ...(optionalString(args, 'query') ? { query: requiredString(args, 'query') } : {}),
      ...(optionalString(args, 'status') ? { status: requiredString(args, 'status') } : {}),
      ...(optionalString(args, 'projectId')
        ? { 'project-id': requiredString(args, 'projectId') }
        : {}),
      ...(optionalString(args, 'workspaceId')
        ? { 'workspace-id': requiredString(args, 'workspaceId') }
        : {}),
      ...(optionalString(args, 'resourceKey')
        ? { 'resource-key': requiredString(args, 'resourceKey') }
        : {}),
      ...(optionalString(args, 'dateField')
        ? { 'date-field': requiredString(args, 'dateField') }
        : {}),
      ...(optionalString(args, 'from') ? { from: requiredString(args, 'from') } : {}),
      ...(optionalString(args, 'to') ? { to: requiredString(args, 'to') } : {}),
      ...(typeof args.limit === 'number' && Number.isFinite(args.limit)
        ? { limit: String(Math.trunc(args.limit)) }
        : {}),
      ...(optionalString(args, 'entityTypes')
        ? { 'entity-types': requiredString(args, 'entityTypes') }
        : {}),
      ...(optionalString(args, 'objectiveStates')
        ? { 'objective-states': requiredString(args, 'objectiveStates') }
        : {}),
      ...(typeof args.matchesPerResult === 'number' && Number.isFinite(args.matchesPerResult)
        ? { 'matches-per-result': String(Math.trunc(args.matchesPerResult)) }
        : {})
    });
    return detail === 'compact' ? compactSearchResponse(response) : response;
  }
  if (name === 'overlord_create_mission') {
    return runProtocol('create', {
      ...(optionalString(args, 'projectId')
        ? { 'project-id': requiredString(args, 'projectId') }
        : { inbox: true }),
      objective: requiredString(args, 'objective'),
      ...(optionalString(args, 'title') ? { title: requiredString(args, 'title') } : {}),
      ...(optionalString(args, 'resourceKey')
        ? { resource: requiredString(args, 'resourceKey') }
        : {}),
      ...(optionalString(args, 'assignedTo')
        ? { 'assigned-to': requiredString(args, 'assignedTo') }
        : {}),
      ...(args.autoAdvance === true ? { 'auto-advance': true } : {}),
      ...(args.autoAdvance === false ? { 'no-auto-advance': true } : {})
    });
  }
  if (name === 'overlord_create_inbox_item') {
    return runProtocol('create', {
      inbox: true,
      title: requiredString(args, 'title'),
      objective: requiredString(args, 'objective')
    });
  }
  if (name === 'overlord_load_mission_context') {
    return runProtocol('load-context', {
      ...missionScopeFlags(args),
      ...(optionalString(args, 'executionTargetId')
        ? { 'execution-target-id': requiredString(args, 'executionTargetId') }
        : {})
    });
  }
  if (name === 'overlord_list_deliveries') {
    return runProtocol('list-deliveries', missionScopeFlags(args));
  }
  if (name === 'overlord_launch_objective') {
    return runProtocol('launch-objective', {
      'objective-id': requiredString(args, 'objectiveId'),
      agent: requiredString(args, 'agent'),
      ...(optionalString(args, 'model') ? { model: requiredString(args, 'model') } : {}),
      ...(optionalString(args, 'reasoningEffort')
        ? { 'reasoning-effort': requiredString(args, 'reasoningEffort') }
        : {}),
      ...(optionalString(args, 'executionTargetId')
        ? { 'execution-target-id': requiredString(args, 'executionTargetId') }
        : {})
    });
  }
  if (name === 'overlord_reorder_future_objectives') {
    if (!Array.isArray(args.orderedObjectiveIds)) {
      throw new Error('orderedObjectiveIds must be an array');
    }
    return runProtocol('reorder-future-objectives', {
      'mission-id': requiredString(args, 'missionId'),
      'ordered-objective-ids-json': args.orderedObjectiveIds
    });
  }
  if (name === 'overlord_add_objectives') {
    if (!Array.isArray(args.objectives)) throw new Error('objectives must be an array');
    return runProtocol('add-objectives', {
      ...missionScopeFlags(args),
      'objectives-json': args.objectives
    });
  }
  if (name === 'overlord_update_objective') {
    const hasAutoAdvance = typeof args.autoAdvance === 'boolean';
    const hasInstructionText = typeof args.instructionText === 'string';
    if (!hasAutoAdvance && !hasInstructionText) {
      throw new Error('Provide autoAdvance and/or instructionText');
    }
    return runProtocol('update-objective', {
      'objective-id': requiredString(args, 'objectiveId'),
      ...(hasAutoAdvance
        ? args.autoAdvance
          ? { 'auto-advance': true }
          : { 'no-auto-advance': true }
        : {}),
      ...(hasInstructionText ? { 'instruction-text': requiredString(args, 'instructionText') } : {})
    });
  }
  if (name === 'overlord_queue_objective') {
    return runProtocol(args.remove === true ? 'dequeue-objective' : 'queue-objective', {
      'objective-id': requiredString(args, 'objectiveId'),
      ...(args.remove === true
        ? {}
        : {
            ...(optionalString(args, 'queue') ? { queue: requiredString(args, 'queue') } : {}),
            ...(optionalString(args, 'after') ? { after: requiredString(args, 'after') } : {})
          })
    });
  }
  if (name === 'overlord_attach_session') {
    return runProtocol('attach', {
      ...missionScopeFlags(args),
      agent: optionalString(args, 'agent') ?? DEFAULT_AGENT,
      ...(optionalString(args, 'model') ? { model: requiredString(args, 'model') } : {}),
      ...(optionalString(args, 'executionTargetId')
        ? { 'execution-target-id': requiredString(args, 'executionTargetId') }
        : {})
    });
  }
  if (name === 'overlord_update_session') {
    return runProtocol('update', {
      ...missionScopeFlags(args),
      'session-key': requiredString(args, 'sessionKey'),
      summary: requiredString(args, 'summary'),
      ...(optionalString(args, 'phase') ? { phase: requiredString(args, 'phase') } : {}),
      ...(optionalString(args, 'eventType')
        ? { 'event-type': requiredString(args, 'eventType') }
        : {})
    });
  }
  if (name === 'overlord_deliver_session') {
    return runProtocol('deliver', {
      ...missionScopeFlags(args),
      'session-key': requiredString(args, 'sessionKey'),
      summary: requiredString(args, 'summary'),
      ...(args.noFileChanges === true ? { 'no-file-changes': true } : {}),
      ...(Array.isArray(args.artifacts) ? { 'artifacts-json': args.artifacts } : {}),
      ...(Array.isArray(args.changeRationales)
        ? { 'change-rationales-json': args.changeRationales }
        : {}),
      ...(Array.isArray(args.humanActions) ||
      Array.isArray(args.tradeoffsMade) ||
      Array.isArray(args.knownRisks) ||
      Array.isArray(args.deferredWork) ||
      Array.isArray(args.assumptions)
        ? {
            payload: {
              deliveryReport: {
                schemaVersion: 1,
                agentReport: {
                  ...(Array.isArray(args.humanActions) ? { humanActions: args.humanActions } : {}),
                  ...(Array.isArray(args.tradeoffsMade)
                    ? { tradeoffsMade: args.tradeoffsMade }
                    : {}),
                  ...(Array.isArray(args.knownRisks) ? { knownRisks: args.knownRisks } : {}),
                  ...(Array.isArray(args.deferredWork) ? { deferredWork: args.deferredWork } : {}),
                  ...(Array.isArray(args.assumptions) ? { assumptions: args.assumptions } : {})
                }
              }
            }
          }
        : {})
    });
  }
  if (name === 'overlord_add_artifact') {
    const hasContentText = typeof args.contentText === 'string' && args.contentText.trim() !== '';
    const hasExternalUrl = typeof args.externalUrl === 'string' && args.externalUrl.trim() !== '';
    if (!hasContentText && !hasExternalUrl) {
      throw new Error('Provide at least one of contentText or externalUrl');
    }
    return runProtocol('add-artifact', {
      ...missionScopeFlags(args),
      type: requiredString(args, 'type'),
      label: requiredString(args, 'label'),
      ...(hasContentText ? { 'content-text': args.contentText } : {}),
      ...(hasExternalUrl ? { 'external-url': args.externalUrl } : {}),
      ...(optionalString(args, 'sessionKey')
        ? { 'session-key': requiredString(args, 'sessionKey') }
        : {})
    });
  }
  if (name === 'overlord_update_artifact') {
    if (typeof args.expectedRevision !== 'number' || !Number.isInteger(args.expectedRevision)) {
      throw new Error('expectedRevision must be an integer');
    }
    const hasLabel = typeof args.label === 'string';
    const hasContentText = typeof args.contentText === 'string';
    const hasExternalUrl = typeof args.externalUrl === 'string';
    if (!hasLabel && !hasContentText && !hasExternalUrl) {
      throw new Error('Provide at least one of label, contentText, or externalUrl');
    }
    return runProtocol('update-artifact', {
      ...missionScopeFlags(args),
      'artifact-id': requiredString(args, 'artifactId'),
      'expected-revision': String(Math.trunc(args.expectedRevision)),
      ...(hasLabel ? { label: args.label } : {}),
      ...(hasContentText ? { 'content-text': args.contentText } : {}),
      ...(hasExternalUrl ? { 'external-url': args.externalUrl } : {})
    });
  }
  if (name === 'overlord_record_work') {
    return runProtocol('record-work', {
      'project-id': requiredString(args, 'projectId'),
      payload: {
        objective: requiredString(args, 'objective'),
        summary: requiredString(args, 'summary'),
        ...(optionalString(args, 'title') ? { title: requiredString(args, 'title') } : {}),
        ...(Array.isArray(args.changeRationales)
          ? { changeRationales: args.changeRationales }
          : {}),
        ...(Array.isArray(args.changedFiles) ? { changedFiles: args.changedFiles } : {}),
        ...(Array.isArray(args.artifacts) ? { artifacts: args.artifacts } : {})
      }
    });
  }
  if (name === 'attach') {
    return runProtocol('attach', { 'mission-id': args.mission_id });
  }
  if (name === 'update') {
    return runProtocol('update', {
      'session-key': args.session_key,
      'mission-id': args.mission_id,
      summary: args.summary,
      phase: args.phase && String(args.phase).trim() ? String(args.phase).trim() : 'execute'
    });
  }
  if (name === 'deliver') {
    return runProtocol('deliver', {
      'session-key': args.session_key,
      'mission-id': args.mission_id,
      summary: args.summary
    });
  }
  throw new Error(`Unknown tool: ${name}`);
}

process.stdin.on('data', async chunk => {
  for (const message of parseMessages(chunk)) {
    if (!message || typeof message !== 'object' || !('id' in message)) continue;
    if (message.method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'overlord-__OVERLORD_ADAPTER_KEY__', version: '0.3.32' }
        }
      });
      continue;
    }
    if (message.method === 'tools/list') {
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: { tools }
      });
      continue;
    }
    if (message.method === 'tools/call') {
      const toolName = message.params?.name;
      const args = message.params?.arguments ?? {};
      try {
        send({
          jsonrpc: '2.0',
          id: message.id,
          result: await callOverlordTool(toolName, args)
        });
      } catch (error) {
        send({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32602, message: error instanceof Error ? error.message : String(error) }
        });
      }
      continue;
    }
    if (message.method === 'ping') {
      send({ jsonrpc: '2.0', id: message.id, result: {} });
      continue;
    }
    send({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32601, message: `Method not found: ${message.method}` }
    });
  }
});

process.stdin.resume();
