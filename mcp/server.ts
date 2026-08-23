import { missionDisplayIdFromObjectiveRef } from '@overlord/contract';
import type { NextFunction, Request, Response } from 'express';

import type { ProtocolRequestBody } from '../backend/protocol.ts';
import { runProtocolSubcommand } from '../backend/protocol.ts';

import { compactRunQueueResponse } from './run-queue-detail.ts';
import { compactSearchResponse } from './search-detail.ts';
import { hostedMcpToolDefinitions, type ToolDefinition } from './tool-catalog.ts';
import { hostedMcpWidgetResources, readHostedMcpWidget } from './widgets.ts';

const MCP_PROTOCOL_VERSION = '2025-11-25';

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
};

type JsonRpcError = {
  code: number;
  message: string;
  data?: unknown;
};

type ToolCallResult = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: unknown;
  isError?: boolean;
};

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

type ToolEntry = ToolDefinition & {
  handler: ToolHandler;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(args: Record<string, unknown>, name: string): string | null {
  const value = args[name];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requiredString(args: Record<string, unknown>, name: string): string {
  const value = optionalString(args, name);
  if (!value) throw new Error(`Missing required argument: ${name}`);
  return value;
}

/**
 * Project references travel to the backend as the user wrote them.
 *
 * A hosted MCP client is talking to a person, and people name projects the way
 * they say them out loud. The protocol surface resolves a UUID, slug, or name
 * against the caller's live memberships and answers an ambiguous name with a
 * `project_selection_required` result, so gating this to UUIDs here would only
 * deny the agent a resolver that already exists — and leave it with a bare 404
 * and nothing to ask the user about.
 */
function optionalProjectRef(args: Record<string, unknown>): string | null {
  return optionalString(args, 'projectId') ? requiredString(args, 'projectId') : null;
}

/**
 * Mission/objective addressing shared by every mission-scoped tool.
 *
 * A hosted MCP client is often handed one identifier — usually the objective
 * display id, because that is what names a unit of execution — so `missionId`
 * is optional whenever `objectiveId` spells its parent mission. The backend
 * derives the same thing from the request body, but emitting `--mission-id`
 * here keeps the flags a caller would have typed by hand identical to the ones
 * the tool sends.
 */
function missionScopeFlags(args: Record<string, unknown>): Record<string, string> {
  const objectiveId = optionalString(args, 'objectiveId');
  const missionId =
    optionalString(args, 'missionId') ?? missionDisplayIdFromObjectiveRef(objectiveId);
  if (!missionId) {
    throw new Error(
      'Missing required argument: missionId (pass it, or an objective display id such as coo:756.k7xm as objectiveId)'
    );
  }
  return {
    '--mission-id': missionId,
    ...(objectiveId ? { '--objective-id': objectiveId } : {})
  };
}

function autoAdvanceFlags(args: Record<string, unknown>): Record<string, true> {
  if (args.autoAdvance === true) return { '--auto-advance': true };
  if (args.autoAdvance === false) return { '--no-auto-advance': true };
  return {};
}

function protocolBody(flags: Record<string, string | boolean>): ProtocolRequestBody {
  return { flags };
}

type RunQueueMcpProtocolCall = {
  subcommand:
    | 'run-queue'
    | 'reorder-run-queue'
    | 'queue-objective'
    | 'dequeue-objective'
    | 'create-run-queue'
    | 'update-run-queue'
    | 'delete-run-queue'
    | 'reorder-project-run-queues';
  body: ProtocolRequestBody;
};

/** Maps entry-level Run Queue MCP arguments to the authoritative Protocol surface. */
export function runQueueMcpProtocolCall(
  name: string,
  args: Record<string, unknown>
): RunQueueMcpProtocolCall {
  if (name === 'overlord_list_run_queues') {
    return {
      subcommand: 'run-queue',
      body: protocolBody({
        ...(optionalProjectRef(args) ? { '--project-id': optionalProjectRef(args)! } : {}),
        ...(optionalString(args, 'objectiveId')
          ? { '--objective-id': requiredString(args, 'objectiveId') }
          : {}),
        ...(optionalString(args, 'missionId')
          ? { '--mission-id': requiredString(args, 'missionId') }
          : {}),
        ...(optionalString(args, 'queue') ? { '--queue': requiredString(args, 'queue') } : {})
      })
    };
  }

  if (name === 'overlord_reorder_run_queue') {
    if (
      !Array.isArray(args.orderedObjectives) ||
      !args.orderedObjectives.every(item => typeof item === 'string')
    ) {
      throw new Error('orderedObjectives must be an array of strings');
    }
    return {
      subcommand: 'reorder-run-queue',
      body: protocolBody({
        '--queue': requiredString(args, 'queue'),
        '--ordered-entries-json': JSON.stringify(args.orderedObjectives),
        ...(optionalProjectRef(args) ? { '--project-id': optionalProjectRef(args)! } : {})
      })
    };
  }

  if (name === 'overlord_queue_objective') {
    const hasAfter = optionalString(args, 'after') !== null;
    const hasFront = args.front === true;
    const hasPosition = args.position !== undefined;
    if (Number(hasAfter) + Number(hasFront) + Number(hasPosition) > 1) {
      throw new Error('Choose only one placement option: after, front, or position');
    }
    if (hasPosition && (!Number.isInteger(args.position) || (args.position as number) < 1)) {
      throw new Error('position must be a positive integer');
    }
    if (args.remove === true) {
      return {
        subcommand: 'dequeue-objective',
        body: protocolBody({ '--objective-id': requiredString(args, 'objectiveId') })
      };
    }
    return {
      subcommand: 'queue-objective',
      body: protocolBody({
        '--objective-id': requiredString(args, 'objectiveId'),
        ...(optionalString(args, 'queue') ? { '--queue': requiredString(args, 'queue') } : {}),
        ...(hasAfter ? { '--after': requiredString(args, 'after') } : {}),
        ...(hasFront ? { '--front': true } : {}),
        ...(hasPosition ? { '--position': String(args.position) } : {})
      })
    };
  }

  if (name === 'overlord_manage_run_queue') {
    const action = optionalString(args, 'action');
    if (action === null) throw new Error('action is required');
    const projectRef = optionalProjectRef(args);
    const queue = optionalString(args, 'queue');
    const queueName = optionalString(args, 'name');

    if (action === 'create') {
      if (!projectRef) throw new Error("action 'create' requires projectId");
      if (!queueName) throw new Error("action 'create' requires name");
      return {
        subcommand: 'create-run-queue',
        body: protocolBody({ '--project-id': projectRef, '--name': queueName })
      };
    }

    if (action === 'update') {
      if (!queue) throw new Error("action 'update' requires queue");
      const paused = args.paused;
      if (paused !== undefined && typeof paused !== 'boolean') {
        throw new Error('paused must be a boolean');
      }
      if (!queueName && paused === undefined) {
        throw new Error("action 'update' requires name or paused");
      }
      return {
        subcommand: 'update-run-queue',
        body: protocolBody({
          '--queue': queue,
          ...(projectRef ? { '--project-id': projectRef } : {}),
          ...(queueName ? { '--name': queueName } : {}),
          ...(paused === true ? { '--pause': true } : {}),
          ...(paused === false ? { '--resume': true } : {})
        })
      };
    }

    if (action === 'delete') {
      if (!queue) throw new Error("action 'delete' requires queue");
      const moveEntriesTo = optionalString(args, 'moveEntriesTo');
      return {
        subcommand: 'delete-run-queue',
        body: protocolBody({
          '--queue': queue,
          ...(projectRef ? { '--project-id': projectRef } : {}),
          ...(moveEntriesTo ? { '--move-entries-to': moveEntriesTo } : {})
        })
      };
    }

    if (action === 'reorder_queues') {
      if (!projectRef) throw new Error("action 'reorder_queues' requires projectId");
      if (
        !Array.isArray(args.orderedQueues) ||
        args.orderedQueues.length === 0 ||
        !args.orderedQueues.every(item => typeof item === 'string')
      ) {
        throw new Error("action 'reorder_queues' requires orderedQueues as an array of strings");
      }
      return {
        subcommand: 'reorder-project-run-queues',
        body: protocolBody({
          '--project-id': projectRef,
          '--ordered-queues-json': JSON.stringify(args.orderedQueues)
        })
      };
    }

    throw new Error(`Unsupported Run Queue action: ${action}`);
  }

  throw new Error(`Unsupported Run Queue MCP tool: ${name}`);
}

function jsonText(value: unknown): ToolCallResult {
  // Every tool declares an object outputSchema, and MCP clients validate the
  // result's `structuredContent` against it. A bare array or primitive (e.g. the
  // add-objectives / search-missions handlers return `ObjectiveSummary[]` /
  // `MissionSummary[]`) fails client-side with
  // "structuredContent: Input should be a valid dictionary" even though the write
  // succeeded server-side. Wrap non-dictionary results so structuredContent is
  // always a dictionary; the text content mirrors it.
  const structured = isRecord(value) ? value : { results: value };
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(structured, null, 2)
      }
    ],
    structuredContent: structured
  };
}

function toolErrorText(error: unknown): ToolCallResult {
  const message =
    error instanceof Error ? error.message : 'Overlord could not complete this tool call.';
  return {
    content: [{ type: 'text', text: message }],
    isError: true
  };
}

const toolHandlers: Record<string, ToolHandler> = {
  overlord_resolve_project: args =>
    runProtocolSubcommand(
      'discover-project',
      protocolBody({
        ...(optionalString(args, 'projectId')
          ? { '--project-id': requiredString(args, 'projectId') }
          : {}),
        ...(optionalString(args, 'workspaceId')
          ? { '--workspace-id': requiredString(args, 'workspaceId') }
          : {}),
        ...(optionalString(args, 'directory')
          ? { '--directory': requiredString(args, 'directory') }
          : {})
      })
    ),
  overlord_create_project: args =>
    runProtocolSubcommand(
      'create-project',
      protocolBody({
        '--name': requiredString(args, 'name'),
        ...(optionalString(args, 'workspaceId')
          ? { '--workspace-id': requiredString(args, 'workspaceId') }
          : {}),
        ...(optionalString(args, 'description')
          ? { '--description': requiredString(args, 'description') }
          : {}),
        ...(optionalString(args, 'slug') ? { '--slug': requiredString(args, 'slug') } : {})
      })
    ),
  overlord_list_project_statuses: args =>
    runProtocolSubcommand(
      'statuses',
      protocolBody({
        '--project-id': requiredString(args, 'projectId'),
        ...(optionalString(args, 'workspaceId')
          ? { '--workspace-id': requiredString(args, 'workspaceId') }
          : {})
      })
    ),
  overlord_search_missions: async args => {
    const detail = optionalString(args, 'detail') ?? 'compact';
    if (detail !== 'compact' && detail !== 'full') {
      throw new Error("detail must be 'compact' or 'full'");
    }
    const result = await runProtocolSubcommand(
      'search',
      protocolBody({
        '--response-version': '3',
        ...(optionalString(args, 'query') ? { '--query': requiredString(args, 'query') } : {}),
        ...(optionalString(args, 'status') ? { '--status': requiredString(args, 'status') } : {}),
        ...(optionalProjectRef(args) ? { '--project-id': optionalProjectRef(args)! } : {}),
        ...(optionalString(args, 'workspaceId')
          ? { '--workspace-id': requiredString(args, 'workspaceId') }
          : {}),
        ...(optionalString(args, 'resourceKey')
          ? { '--resource-key': requiredString(args, 'resourceKey') }
          : {}),
        ...(optionalString(args, 'dateField')
          ? { '--date-field': requiredString(args, 'dateField') }
          : {}),
        ...(optionalString(args, 'from') ? { '--from': requiredString(args, 'from') } : {}),
        ...(optionalString(args, 'to') ? { '--to': requiredString(args, 'to') } : {}),
        ...(typeof args.limit === 'number' && Number.isFinite(args.limit)
          ? { '--limit': String(Math.trunc(args.limit)) }
          : {}),
        ...(optionalString(args, 'entityTypes')
          ? { '--entity-types': requiredString(args, 'entityTypes') }
          : {}),
        ...(optionalString(args, 'objectiveStates')
          ? { '--objective-states': requiredString(args, 'objectiveStates') }
          : {}),
        ...(typeof args.matchesPerResult === 'number' && Number.isFinite(args.matchesPerResult)
          ? {
              '--matches-per-result': String(Math.trunc(args.matchesPerResult))
            }
          : {})
      })
    );
    return detail === 'compact' ? compactSearchResponse(result) : result;
  },
  overlord_create_mission: args =>
    runProtocolSubcommand(
      'create',
      protocolBody({
        ...(optionalString(args, 'projectId')
          ? { '--project-id': requiredString(args, 'projectId') }
          : { '--inbox': true }),
        '--objective': requiredString(args, 'objective'),
        ...(optionalString(args, 'title') ? { '--title': requiredString(args, 'title') } : {}),
        ...(optionalString(args, 'resourceKey')
          ? { '--resource': requiredString(args, 'resourceKey') }
          : {}),
        ...(optionalString(args, 'assignedTo')
          ? { '--assigned-to': requiredString(args, 'assignedTo') }
          : {}),
        ...autoAdvanceFlags(args)
      })
    ),
  overlord_create_inbox_item: args =>
    runProtocolSubcommand(
      'create',
      protocolBody({
        '--inbox': true,
        '--title': requiredString(args, 'title'),
        '--objective': requiredString(args, 'objective')
      })
    ),
  overlord_load_mission_context: args =>
    runProtocolSubcommand(
      'load-context',
      protocolBody({
        ...missionScopeFlags(args),
        ...(optionalString(args, 'executionTargetId')
          ? { '--execution-target-id': requiredString(args, 'executionTargetId') }
          : {})
      })
    ),
  overlord_list_deliveries: args =>
    runProtocolSubcommand('list-deliveries', protocolBody(missionScopeFlags(args))),
  overlord_launch_objective: args =>
    runProtocolSubcommand(
      'launch-objective',
      protocolBody({
        '--objective-id': requiredString(args, 'objectiveId'),
        '--agent': requiredString(args, 'agent'),
        ...(optionalString(args, 'model') ? { '--model': requiredString(args, 'model') } : {}),
        ...(optionalString(args, 'reasoningEffort')
          ? { '--reasoning-effort': requiredString(args, 'reasoningEffort') }
          : {}),
        ...(optionalString(args, 'executionTargetId')
          ? { '--execution-target-id': requiredString(args, 'executionTargetId') }
          : {})
      })
    ),
  overlord_reorder_future_objectives: args => {
    if (!Array.isArray(args.orderedObjectiveIds)) {
      throw new Error('orderedObjectiveIds must be an array');
    }
    return runProtocolSubcommand(
      'reorder-future-objectives',
      protocolBody({
        '--mission-id': requiredString(args, 'missionId'),
        '--ordered-objective-ids-json': JSON.stringify(args.orderedObjectiveIds)
      })
    );
  },
  overlord_add_objectives: args => {
    if (!Array.isArray(args.objectives)) {
      throw new Error('objectives must be an array');
    }
    return runProtocolSubcommand('add-objectives', {
      flags: {
        ...missionScopeFlags(args),
        '--objectives-file': true
      },
      fileInputs: { '--objectives-file': JSON.stringify(args.objectives) }
    });
  },
  overlord_update_objective: args => {
    const hasAutoAdvance = typeof args.autoAdvance === 'boolean';
    const hasInstructionText = typeof args.instructionText === 'string';
    if (!hasAutoAdvance && !hasInstructionText) {
      throw new Error('Provide autoAdvance and/or instructionText');
    }
    return runProtocolSubcommand(
      'update-objective',
      protocolBody({
        '--objective-id': requiredString(args, 'objectiveId'),
        ...(hasAutoAdvance ? autoAdvanceFlags(args) : {}),
        ...(hasInstructionText
          ? { '--instruction-text': requiredString(args, 'instructionText') }
          : {})
      })
    );
  },
  overlord_list_run_queues: async args => {
    const detail = optionalString(args, 'detail') ?? 'compact';
    if (detail !== 'compact' && detail !== 'full') {
      throw new Error("detail must be 'compact' or 'full'");
    }
    const request = runQueueMcpProtocolCall('overlord_list_run_queues', args);
    const result = await runProtocolSubcommand(request.subcommand, request.body);
    return detail === 'compact' ? compactRunQueueResponse(result) : result;
  },
  overlord_reorder_run_queue: args => {
    const request = runQueueMcpProtocolCall('overlord_reorder_run_queue', args);
    return runProtocolSubcommand(request.subcommand, request.body);
  },
  overlord_queue_objective: args => {
    const request = runQueueMcpProtocolCall('overlord_queue_objective', args);
    return runProtocolSubcommand(request.subcommand, request.body);
  },
  overlord_manage_run_queue: args => {
    const request = runQueueMcpProtocolCall('overlord_manage_run_queue', args);
    return runProtocolSubcommand(request.subcommand, request.body);
  },
  overlord_attach_session: args =>
    runProtocolSubcommand(
      'attach',
      protocolBody({
        ...missionScopeFlags(args),
        '--agent': optionalString(args, 'agent') ?? 'hosted-mcp',
        ...(optionalString(args, 'model') ? { '--model': requiredString(args, 'model') } : {}),
        ...(optionalString(args, 'executionTargetId')
          ? { '--execution-target-id': requiredString(args, 'executionTargetId') }
          : {})
      })
    ),
  overlord_update_session: args =>
    runProtocolSubcommand('update', {
      flags: {
        ...missionScopeFlags(args),
        '--session-key': requiredString(args, 'sessionKey'),
        '--summary': requiredString(args, 'summary'),
        ...(optionalString(args, 'phase') ? { '--phase': requiredString(args, 'phase') } : {}),
        ...(optionalString(args, 'eventType')
          ? { '--event-type': requiredString(args, 'eventType') }
          : {}),
        ...(Array.isArray(args.changeRationales) ? { '--change-rationales-file': true } : {})
      },
      fileInputs: Array.isArray(args.changeRationales)
        ? { '--change-rationales-file': JSON.stringify(args.changeRationales) }
        : undefined
    }),
  overlord_deliver_session: args =>
    runProtocolSubcommand('deliver', {
      flags: {
        ...missionScopeFlags(args),
        '--session-key': requiredString(args, 'sessionKey'),
        '--summary': requiredString(args, 'summary'),
        ...(Array.isArray(args.artifacts) ? { '--artifacts-file': true } : {}),
        ...(Array.isArray(args.changeRationales) ? { '--change-rationales-file': true } : {}),
        ...(Array.isArray(args.humanActions) ||
        Array.isArray(args.tradeoffsMade) ||
        Array.isArray(args.knownRisks) ||
        Array.isArray(args.deferredWork) ||
        Array.isArray(args.assumptions)
          ? {
              '--payload-json': JSON.stringify({
                deliveryReport: {
                  schemaVersion: 1,
                  agentReport: {
                    ...(Array.isArray(args.humanActions)
                      ? { humanActions: args.humanActions }
                      : {}),
                    ...(Array.isArray(args.tradeoffsMade)
                      ? { tradeoffsMade: args.tradeoffsMade }
                      : {}),
                    ...(Array.isArray(args.knownRisks) ? { knownRisks: args.knownRisks } : {}),
                    ...(Array.isArray(args.deferredWork)
                      ? { deferredWork: args.deferredWork }
                      : {}),
                    ...(Array.isArray(args.assumptions) ? { assumptions: args.assumptions } : {})
                  }
                }
              })
            }
          : {})
      },
      fileInputs:
        Array.isArray(args.artifacts) || Array.isArray(args.changeRationales)
          ? {
              ...(Array.isArray(args.artifacts)
                ? { '--artifacts-file': JSON.stringify(args.artifacts) }
                : {}),
              ...(Array.isArray(args.changeRationales)
                ? { '--change-rationales-file': JSON.stringify(args.changeRationales) }
                : {})
            }
          : undefined
    }),
  overlord_add_artifact: args => {
    const hasContentText = typeof args.contentText === 'string' && args.contentText.trim() !== '';
    const hasExternalUrl = typeof args.externalUrl === 'string' && args.externalUrl.trim() !== '';
    if (!hasContentText && !hasExternalUrl) {
      throw new Error('Provide at least one of contentText or externalUrl');
    }
    const sessionKey = optionalString(args, 'sessionKey');
    return runProtocolSubcommand('add-artifact', {
      flags: {
        ...missionScopeFlags(args),
        '--type': requiredString(args, 'type'),
        '--label': requiredString(args, 'label'),
        ...(hasContentText ? { '--content-text-file': true } : {}),
        ...(hasExternalUrl ? { '--external-url': args.externalUrl as string } : {}),
        ...(sessionKey ? { '--session-key': sessionKey } : {})
      },
      fileInputs: hasContentText ? { '--content-text-file': args.contentText as string } : undefined
    });
  },
  overlord_update_artifact: args => {
    if (typeof args.expectedRevision !== 'number' || !Number.isInteger(args.expectedRevision)) {
      throw new Error('expectedRevision must be an integer');
    }
    const hasLabel = typeof args.label === 'string';
    const hasContentText = typeof args.contentText === 'string';
    const hasExternalUrl = typeof args.externalUrl === 'string';
    if (!hasLabel && !hasContentText && !hasExternalUrl) {
      throw new Error('Provide at least one of label, contentText, or externalUrl');
    }
    return runProtocolSubcommand('update-artifact', {
      flags: {
        ...missionScopeFlags(args),
        '--artifact-id': requiredString(args, 'artifactId'),
        '--expected-revision': String(Math.trunc(args.expectedRevision)),
        ...(hasLabel ? { '--label': args.label as string } : {}),
        ...(hasContentText ? { '--content-text-file': true } : {}),
        ...(hasExternalUrl ? { '--external-url': args.externalUrl as string } : {})
      },
      fileInputs: hasContentText ? { '--content-text-file': args.contentText as string } : undefined
    });
  },
  overlord_record_work: args => {
    // record-work takes one payload-file envelope so objective/summary/title and
    // file-change arrays travel as one unambiguous JSON object.
    const payload: Record<string, unknown> = {
      objective: requiredString(args, 'objective'),
      summary: requiredString(args, 'summary'),
      ...(optionalString(args, 'title') ? { title: requiredString(args, 'title') } : {}),
      ...(Array.isArray(args.changeRationales) ? { changeRationales: args.changeRationales } : {}),
      ...(Array.isArray(args.changedFiles) ? { changedFiles: args.changedFiles } : {}),
      ...(Array.isArray(args.artifacts) ? { artifacts: args.artifacts } : {})
    };
    return runProtocolSubcommand('record-work', {
      flags: {
        '--project-id': requiredString(args, 'projectId'),
        '--payload-file': true
      },
      fileInputs: { '--payload-file': JSON.stringify(payload) }
    });
  }
};

const tools: ToolEntry[] = hostedMcpToolDefinitions.map(definition => {
  const handler = toolHandlers[definition.name];
  if (!handler) throw new Error(`Missing MCP tool handler: ${definition.name}`);
  return { ...definition, handler };
});

const extraHandlers = Object.keys(toolHandlers).filter(
  name => !hostedMcpToolDefinitions.some(definition => definition.name === name)
);
if (extraHandlers.length > 0) {
  throw new Error(`MCP tool handlers without catalog entries: ${extraHandlers.join(', ')}`);
}

function toolDefinitions(): ToolDefinition[] {
  return tools.map(({ handler: _handler, ...definition }) => definition);
}

function success(id: JsonRpcId | undefined, result: unknown): Record<string, unknown> {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function failure(id: JsonRpcId | undefined, error: JsonRpcError): Record<string, unknown> {
  return { jsonrpc: '2.0', id: id ?? null, error };
}

async function callTool(params: unknown): Promise<ToolCallResult> {
  if (!isRecord(params) || !isRecord(params.arguments)) {
    throw new Error('tools/call requires params.name and params.arguments');
  }
  const name = typeof params.name === 'string' ? params.name : '';
  const tool = tools.find(candidate => candidate.name === name);
  if (!tool) throw new Error(`Unknown MCP tool: ${name}`);
  try {
    return jsonText(await tool.handler(params.arguments));
  } catch (error) {
    return toolErrorText(error);
  }
}

function readResource(params: unknown): Record<string, unknown> {
  if (!isRecord(params) || typeof params.uri !== 'string') {
    throw new Error('resources/read requires params.uri');
  }
  const resource = readHostedMcpWidget(params.uri);
  if (!resource) throw new Error(`Unknown MCP resource: ${params.uri}`);
  return {
    contents: [
      {
        uri: resource.uri,
        name: resource.name,
        mimeType: resource.mimeType,
        text: resource.text,
        _meta: resource._meta
      }
    ]
  };
}

async function dispatch(request: JsonRpcRequest): Promise<Record<string, unknown> | null> {
  if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    return failure(request.id, { code: -32600, message: 'Invalid JSON-RPC request' });
  }

  try {
    switch (request.method) {
      case 'initialize':
        return success(request.id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          serverInfo: { name: 'overlord', version: '0.1.0' },
          instructions:
            'Overlord manages explicit user-authorized work. Resolve project identity before creating work, use read tools before writes, and call session lifecycle tools only when the user explicitly asks to begin, update, or deliver mission work.',
          capabilities: { tools: {}, resources: {} }
        });
      case 'notifications/initialized':
        return null;
      case 'ping':
        return success(request.id, {});
      case 'tools/list':
        return success(request.id, { tools: toolDefinitions() });
      case 'tools/call':
        return success(request.id, await callTool(request.params));
      case 'resources/list':
        return success(request.id, { resources: hostedMcpWidgetResources });
      case 'resources/read':
        return success(request.id, readResource(request.params));
      default:
        return failure(request.id, {
          code: -32601,
          message: `Method not found: ${request.method}`
        });
    }
  } catch (err) {
    return failure(request.id, {
      code: -32000,
      message: err instanceof Error ? err.message : 'MCP tool failed'
    });
  }
}

export function mcpServerInfo(req: Request): Record<string, unknown> {
  const resource = new URL(
    '/mcp',
    `${req.protocol}://${req.get('host') ?? 'localhost'}`
  ).toString();
  return {
    name: 'overlord',
    protocolVersion: MCP_PROTOCOL_VERSION,
    endpoint: resource,
    capabilities: { tools: toolDefinitions(), resources: hostedMcpWidgetResources },
    instructions:
      'Resolve project identity before creating work. Use read tools before writes. Mission and session writes require explicit user intent.'
  };
}

export async function handleMcpPost(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body = req.body;
    const requests = Array.isArray(body) ? body : [body];
    const responses: Array<Record<string, unknown>> = [];
    for (const item of requests) {
      const response = await dispatch(isRecord(item) ? item : {});
      if (response) responses.push(response);
    }
    if (Array.isArray(body)) {
      res.json(responses);
      return;
    }
    res.json(responses[0] ?? { jsonrpc: '2.0', result: null });
  } catch (err) {
    next(err);
  }
}
