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

function compactSearchResponse(response) {
  const value = response?.structuredContent;
  if (!value || value.version !== 3 || !Array.isArray(value.results)) return response;
  const compact = {
    ...value,
    results: value.results.map(result => ({
      ...result,
      matches: Array.isArray(result.matches)
        ? result.matches.slice(0, 2).map(match => {
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

function compactRunQueueResponse(response) {
  const value = response?.structuredContent;
  if (!value || !Array.isArray(value.queues)) return response;
  const compact = {
    projectId: value.projectId,
    queues: value.queues.map(queue => ({
      id: queue.id,
      name: queue.name,
      isDefault: queue.isDefault,
      paused: queue.paused,
      entries: Array.isArray(queue.entries)
        ? queue.entries.map(entry => ({
            position: entry.position,
            state: entry.state,
            objectiveDisplayId: entry.objectiveDisplayId,
            objectiveTitle: entry.objectiveTitle,
            missionTitle: entry.missionTitle,
            blockedReason: entry.blockedReason
          }))
        : []
    }))
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(compact, null, 2) }],
    structuredContent: compact
  };
}

// BEGIN GENERATED MCP TOOL CATALOG
// Generated from packages/contract/src/mcp-tools.ts — do not edit.
// Regenerate with `yarn connectors:mcp-tools`.
const tools = [
  {
    name: 'overlord_resolve_project',
    title: 'Resolve Overlord project',
    description:
      "Use this when the user identifies an Overlord project by id, slug, name, or exposed repository metadata. Names are matched case-insensitively across every workspace the caller can reach; when a name matches in more than one, this returns a 'project_selection_required' result listing the candidates with their workspaces — ask the user which one, then retry with workspaceId set. When resolving from .overlord/project.json, the result is the isPrimary project if the checkout is linked to more than one project; linkedProjects lists every linked project.",
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Explicit Overlord project id, slug, or project name.'
        },
        workspaceId: {
          type: 'string',
          description:
            "Optional workspace (id, slug, or name) that narrows an ambiguous projectId. Use this to retry after a 'project_selection_required' result."
        },
        directory: {
          type: 'string',
          description:
            'Optional repository directory path when the MCP client can expose one with .overlord/project.json.'
        }
      },
      required: [],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false
    }
  },
  {
    name: 'overlord_create_project',
    title: 'Create Overlord project',
    description:
      "Use this only when the user explicitly asks to create a new Overlord project (workspace project). If the user belongs to more than one workspace and none is specified, this returns a 'workspace_selection_required' result listing the workspaces — ask the user which one, then call again with workspaceId set to the chosen id, slug, or name.",
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'New project name.'
        },
        workspaceId: {
          type: 'string',
          description:
            'Workspace to create the project in (id, slug, or name). Required only when the caller belongs to multiple workspaces.'
        },
        description: {
          type: 'string',
          description: 'Optional project description.'
        },
        slug: {
          type: 'string',
          description: 'Optional project slug; defaults to a slug derived from the name.'
        }
      },
      required: ['name'],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false
    }
  },
  {
    name: 'overlord_list_project_statuses',
    title: 'List Overlord project statuses',
    description:
      "Use this to read one project's board columns. Status names and order are defined per project, so two projects in the same workspace can label the same lifecycle differently; this is the only way to discover a specific board’s columns. Each status carries a stable type (draft, next, execute, review, complete, blocked, cancelled) that does not vary by project — use the type for filtering and the name only for display.",
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description:
            "Overlord project id, slug, or name. An ambiguous name returns 'project_selection_required'; retry with workspaceId."
        },
        workspaceId: {
          type: 'string',
          description: 'Optional workspace (id, slug, or name) that narrows an ambiguous projectId.'
        }
      },
      required: ['projectId'],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false
    }
  },
  {
    name: 'overlord_search_missions',
    title: 'Search Overlord missions',
    description:
      "Use this to find missions across the caller's authorized workspaces. Results are mission anchors with only the matching objectives and deliveries in matches; an objective displayId (for example coo:789.2nnh) can be passed directly to overlord_load_mission_context. matches is never the mission's complete objective list. Artifacts are not indexed; load mission context after locating the mission to read them. There is no relative-date parsing or implicit time window: compute absolute ISO bounds and pass from/to. Raise limit for broad questions and inspect workspaceCounts, entityCounts, and truncatedCandidates before claiming a list is complete. appliedFilters.mode 'fallback' means the query contributed nothing and results are a recency listing, not an answer. Compact detail is the default and retains navigation identity while reducing child payload; request full for snippets and child metadata. Ranked results can never prove that no mission mentions something. To prove absence or presence of an exact token (for example a canonical kb-feature: Knowledgebase Feature reference), pass reference with projectId instead: that mode is exhaustive, returns every mission in the project whose live objective text contains the exact token with its statusType, and pages with cursor until complete is true; it accepts only projectId, workspaceId, limit (1-100, default 50) and cursor.",
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query text.'
        },
        reference: {
          type: 'string',
          description:
            'Exact-reference mode: a case-sensitive token of 8-512 characters with no whitespace, matched as a whole token in live objective instruction text. Requires projectId; cannot be combined with query or other ranked filters. Returns MissionReferenceSearchResponse { results, nextCursor, complete }. Absence is proven only after following nextCursor to a page with complete: true.'
        },
        cursor: {
          type: 'string',
          description:
            'Exact-reference mode only: the nextCursor from the previous page for the same reference and projectId.'
        },
        status: {
          type: 'string',
          description:
            'Comma-separated status TYPES, such as draft,execute,review. Types are workspace-invariant (draft, next, execute, review, complete, blocked, cancelled). Project-defined status names — the board column labels read by overlord_list_project_statuses — are not accepted here.'
        },
        projectId: {
          type: 'string',
          description:
            "Optional project reference: a stable UUID, a slug, or the project name as the user said it. Names are matched case-insensitively against the projects the caller can reach. If the name matches in more than one workspace the call returns a 'project_selection_required' result listing the candidates with their workspaces — ask the user which one, then retry with workspaceId set."
        },
        workspaceId: {
          type: 'string',
          description:
            "Optional workspace (id, slug, or name) that narrows an ambiguous projectId. Use this to retry after a 'project_selection_required' result."
        },
        resourceKey: {
          type: 'string',
          description:
            'Optional logical resource key. Keys are matched by name within every selected project.'
        },
        dateField: {
          type: 'string',
          enum: ['createdAt', 'updatedAt', 'dueDatetime'],
          description:
            'Date column for an explicit range: createdAt, updatedAt, or dueDatetime. Defaults to updatedAt only when from or to is supplied. Use dueDatetime for questions about what is scheduled or due — a mission is scheduled by its due date, not by an execution timer. Missions with no due date are excluded from a dueDatetime range.'
        },
        from: {
          type: 'string',
          description: 'Optional inclusive ISO-8601 date/time lower bound.'
        },
        to: {
          type: 'string',
          description: 'Optional exclusive ISO-8601 date/time upper bound.'
        },
        limit: {
          type: 'number',
          description: 'Maximum result count. Defaults to 25.'
        },
        entityTypes: {
          type: 'string',
          description: 'Optional comma-separated v3 entity types: mission, objective, delivery.'
        },
        objectiveStates: {
          type: 'string',
          description: 'Optional comma-separated v3 objective states for matching objectives.'
        },
        matchesPerResult: {
          type: 'number',
          description:
            'Optional v3 child-match cap per mission (default 3, max 10; compact returns at most 2).'
        },
        detail: {
          type: 'string',
          enum: ['compact', 'full'],
          description:
            'Result detail: compact (default) keeps child navigation fields and removes child snippets/metadata; full returns the complete v3 child matches.'
        }
      },
      required: [],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false
    }
  },
  {
    name: 'overlord_create_mission',
    title: 'Create Overlord mission',
    description:
      'Use this to create a draft mission with projectId. To intentionally create an account-owned inbox item, set unassignedToProject to true; omission of both is rejected.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description:
            'Overlord project id, slug, or name. Required unless unassignedToProject is true.'
        },
        unassignedToProject: {
          type: 'boolean',
          description:
            'Set true only to intentionally create an account-owned inbox item instead of a project mission. Cannot be combined with projectId.'
        },
        objective: {
          type: 'string',
          description: 'Initial objective text.'
        },
        title: {
          type: 'string',
          description: 'Optional mission title.'
        },
        resourceKey: {
          type: 'string',
          description: 'Optional logical project resource key for the objective.'
        },
        agent: {
          type: 'string',
          description:
            'Optional agent identifier to assign to the initial objective, such as codex or claude. Omitted leaves the project launch-preference default; set it here instead of appending a second objective just to name an agent.'
        },
        model: {
          type: 'string',
          description:
            'Optional model identifier for the assigned agent. Requires agent; rejected without it.'
        },
        assignedTo: {
          type: 'string',
          description:
            'Optional workspace member to own the mission (workspace_users.id, profile UUID, orgid:username, bare username, or email). Rejected when the member is not in the workspace; meaningless for an unassigned inbox item.'
        },
        autoAdvance: {
          type: 'boolean',
          description:
            'When true, Overlord queues the next objective for execution after this one is delivered. Defaults to false.'
        }
      },
      required: ['objective'],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false
    }
  },
  {
    name: 'overlord_create_inbox_item',
    title: 'Create inbox item',
    description: 'Use this to create a private, account-owned unassigned task capture.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Inbox item title.'
        },
        objective: {
          type: 'string',
          description: 'The one objective captured in v1.'
        }
      },
      required: ['title', 'objective'],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false
    }
  },
  {
    name: 'overlord_load_mission_context',
    title: 'Load mission context',
    description:
      'Use this when the user wants to inspect one mission, its objectives, history, artifacts, or shared context.',
    inputSchema: {
      type: 'object',
      properties: {
        missionId: {
          type: 'string',
          description:
            'Mission UUID or workspace display id. Optional when objectiveId is a display id such as coo:756.k7xm, which already names its mission.'
        },
        objectiveId: {
          type: 'string',
          description:
            'Objective UUID or display id such as coo:756.k7xm. Returns that objective as the current one instead of rediscovering the mission active objective — required on a mission running objectives in parallel.'
        },
        executionTargetId: {
          type: 'string',
          description:
            'Optional local execution target id for resolving sibling project resource paths.'
        }
      },
      required: [],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false
    }
  },
  {
    name: 'overlord_list_deliveries',
    title: 'List mission deliveries',
    description:
      "Use this to read a mission's delivered work after locating it. Returns a newest-first MissionDeliveriesDto page { items, total, limit } of normalized delivery records including summary, verification, follow-up notes, and authoritative human-action, tradeoff, risk, deferred-work, and assumption evidence; items are capped at 200 and total is the matching count before that cap. It never exposes raw delivery payloads.",
    inputSchema: {
      type: 'object',
      properties: {
        missionId: {
          type: 'string',
          description:
            'Mission UUID or workspace display id. Optional when objectiveId is a display id such as coo:756.k7xm, which already names its mission.'
        },
        objectiveId: {
          type: 'string',
          description:
            'Objective UUID or display id such as coo:756.k7xm. Use a display id when that is the only identifier available.'
        }
      },
      required: [],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false
    }
  },
  {
    name: 'overlord_changes',
    title: 'List objective file changes',
    description:
      'Use this to read the synchronized changed-file evidence of one objective across every session, resource, and device. Returns ObjectiveFileChangesDto { scope: "server_objective", items, total, limit, truncated, capture }: compact rows (resourceKey, filePath, source declared_edit | agent_declared | null for unknown, observedAt, hookHealth) ordered by resource then path and capped at 200, total as the pre-cap count, and persisted capture diagnostics with warnings. It never includes unsynchronized local evidence, needs no attached session, and does not mutate anything.',
    inputSchema: {
      type: 'object',
      properties: {
        missionId: {
          type: 'string',
          description:
            'Mission UUID or workspace display id. Optional when objectiveId is a display id such as coo:756.k7xm, which already names its mission.'
        },
        objectiveId: {
          type: 'string',
          description:
            'Required objective UUID or display id such as coo:756.k7xm. An objective that does not belong to missionId is rejected.'
        }
      },
      required: [],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false
    }
  },
  {
    name: 'overlord_launch_objective',
    title: 'Launch objective execution',
    description:
      'Use this only when the user explicitly asks to start a particular objective. It queues the normal Overlord execution request; it does not attach this MCP agent to perform the work. The objective must be launchable, its workspace must authorize execution, and an existing active request is returned instead of duplicated.',
    inputSchema: {
      type: 'object',
      properties: {
        objectiveId: {
          type: 'string',
          description: 'Objective UUID or display id such as coo:756.k7xm.'
        },
        agent: {
          type: 'string',
          description: 'Agent identifier to launch, such as codex or claude.'
        },
        model: {
          type: 'string',
          description: 'Optional model identifier to snapshot onto the execution request.'
        },
        reasoningEffort: {
          type: 'string',
          description: 'Optional reasoning-effort setting to snapshot onto the execution request.'
        },
        executionTargetId: {
          type: 'string',
          description:
            "Optional eligible execution target id. Omit to use the project's normal target selection."
        }
      },
      required: ['objectiveId', 'agent'],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false
    }
  },
  {
    name: 'overlord_reorder_future_objectives',
    title: 'Reorder future objectives',
    description:
      'Use this only when the user explicitly asks to change the order of future objectives in one mission. Supply every future objective UUID in its complete desired top-to-bottom order; draft, active, and completed objectives cannot be moved by this tool.',
    inputSchema: {
      type: 'object',
      properties: {
        missionId: {
          type: 'string',
          description: 'Mission UUID.'
        },
        orderedObjectiveIds: {
          type: 'array',
          description:
            'Complete desired top-to-bottom UUID order of every objective currently in the future state.',
          items: {
            type: 'string',
            description: 'Future objective UUID.'
          }
        }
      },
      required: ['missionId', 'orderedObjectiveIds'],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false
    }
  },
  {
    name: 'overlord_add_objectives',
    title: 'Add objectives',
    description:
      'Use this only when the user explicitly asks to append draft objectives to an existing mission.',
    inputSchema: {
      type: 'object',
      properties: {
        missionId: {
          type: 'string',
          description:
            'Mission UUID or workspace display id. Optional when objectiveId is a display id such as coo:756.k7xm, which already names its mission.'
        },
        objectiveId: {
          type: 'string',
          description:
            'Objective UUID or display id such as coo:756.k7xm. Used only to supply missionId when it is omitted; the new objectives are appended to that objective mission.'
        },
        objectives: {
          type: 'array',
          description:
            'Objective objects with objective text and optional title, agent/model launch selection, resourceKey, and autoAdvance.',
          items: {
            type: 'object',
            properties: {
              objective: {
                type: 'string',
                description: 'Objective text.'
              },
              title: {
                type: 'string',
                description: 'Optional objective title.'
              },
              agent: {
                type: 'string',
                description:
                  'Optional agent identifier to assign to this objective, such as codex or claude.'
              },
              model: {
                type: 'string',
                description: 'Optional model identifier for this objective. Requires agent.'
              },
              resourceKey: {
                type: 'string',
                description: 'Optional logical project resource key.'
              },
              autoAdvance: {
                type: 'boolean',
                description:
                  'When true, Overlord queues the next objective for execution after this one is delivered. Defaults to false.'
              }
            },
            required: [],
            additionalProperties: false
          }
        }
      },
      required: ['objectives'],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false
    }
  },
  {
    name: 'overlord_update_objective',
    title: 'Update objective',
    description:
      'Use this to rewrite an objective title in any state, turn auto-advance on or off, and/or edit instruction text on a draft or future objective.',
    inputSchema: {
      type: 'object',
      properties: {
        objectiveId: {
          type: 'string',
          description: 'Objective UUID or display id.'
        },
        title: {
          type: 'string',
          description:
            'Replacement objective title. An empty string clears the custom title and restores instruction-derived presentation.'
        },
        autoAdvance: {
          type: 'boolean',
          description:
            'When true, Overlord queues the next objective after this one is delivered. When false, delivery waits for approval.'
        },
        instructionText: {
          type: 'string',
          description:
            'Replacement instruction text. Allowed only when the objective is in draft or future state; blank clears the text in those states.'
        }
      },
      required: ['objectiveId'],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false
    }
  },
  {
    name: 'overlord_delete_missions',
    title: 'Delete missions',
    description:
      'Use this only after showing the resolved mission list to the user and receiving an affirmative response. Soft-deletes one to 100 missions atomically; any missing, duplicate, deleted, or unauthorized target rejects the entire request. Deleting a mission also soft-deletes its live objectives.',
    inputSchema: {
      type: 'object',
      properties: {
        missionIds: {
          type: 'array',
          description: 'One to 100 unique mission UUIDs or display IDs to delete.',
          items: {
            type: 'string',
            description: 'Mission UUID or workspace display ID.'
          }
        },
        confirm: {
          type: 'boolean',
          description:
            'Must be true only after the user has reviewed the resolved mission list and affirmatively approved deletion.'
        }
      },
      required: ['missionIds', 'confirm'],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false
    }
  },
  {
    name: 'overlord_delete_objectives',
    title: 'Delete objectives',
    description:
      'Use this only after showing the resolved objective list to the user and receiving an affirmative response. Soft-deletes one to 100 objectives atomically; any missing, duplicate, deleted, or unauthorized target rejects the entire request. Deleting an objective also removes its live Run Queue membership.',
    inputSchema: {
      type: 'object',
      properties: {
        objectiveIds: {
          type: 'array',
          description: 'One to 100 unique objective UUIDs or display IDs to delete.',
          items: {
            type: 'string',
            description: 'Objective UUID or display ID.'
          }
        },
        confirm: {
          type: 'boolean',
          description:
            'Must be true only after the user has reviewed the resolved objective list and affirmatively approved deletion.'
        }
      },
      required: ['objectiveIds', 'confirm'],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false
    }
  },
  {
    name: 'overlord_list_run_queues',
    title: 'List Run Queues',
    description:
      "Use this to read a project's authoritative Run Queues before adding, moving, removing, or bulk-reordering entries. Compact detail is the default and includes ordering and blocking state; request full for the complete ProjectRunQueuesDto.",
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Optional project UUID, slug, or name.'
        },
        objectiveId: {
          type: 'string',
          description:
            'Optional objective UUID or display id; derives the project when projectId is omitted.'
        },
        missionId: {
          type: 'string',
          description:
            'Optional mission UUID or display id; derives the project when projectId is omitted.'
        },
        queue: {
          type: 'string',
          description: 'Optional Run Queue UUID or unambiguous name to return by itself.'
        },
        detail: {
          type: 'string',
          enum: ['compact', 'full'],
          description:
            'Result detail: compact (default) returns queue ordering state; full returns the raw ProjectRunQueuesDto.'
        }
      },
      required: [],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false
    }
  },
  {
    name: 'overlord_reorder_run_queue',
    title: 'Reorder Run Queue entries',
    description:
      'Use this only when the user explicitly asks to reorder every entry in one Run Queue. Supply every live entry exactly once, using entry UUIDs, objective UUIDs, or objective display ids. Running and dispatched entries cannot move. On a mismatch, the error returns the current order; re-read the queue and retry.',
    inputSchema: {
      type: 'object',
      properties: {
        queue: {
          type: 'string',
          description: 'Run Queue UUID or unambiguous name.'
        },
        orderedObjectives: {
          type: 'array',
          description:
            'Complete desired top-to-bottom entry order. Each item may be an entry UUID, objective UUID, or objective display id.',
          items: {
            type: 'string',
            description: 'Run Queue entry UUID, objective UUID, or objective display id.'
          }
        },
        projectId: {
          type: 'string',
          description: 'Optional project UUID, slug, or name; disambiguates queue names.'
        }
      },
      required: ['queue', 'orderedObjectives'],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false
    }
  },
  {
    name: 'overlord_queue_objective',
    title: 'Queue objective',
    description:
      'Use this only when the user explicitly asks to add, move, or remove an objective in the project Run Queue. Queue membership is target-neutral and sequences delivery-driven launches; it does not directly launch the objective. Adding an objective also queues every not-yet-started objective after it in the mission; a removed objective moves to the end of its mission.',
    inputSchema: {
      type: 'object',
      properties: {
        objectiveId: {
          type: 'string',
          description: 'Objective UUID or display id such as coo:756.k7xm.'
        },
        queue: {
          type: 'string',
          description: 'Optional Run Queue UUID or unambiguous queue name.'
        },
        after: {
          type: 'string',
          description:
            'Optional queued predecessor entry id, objective UUID, or objective display id. Its queue is used when queue is omitted.'
        },
        front: {
          type: 'boolean',
          description: 'When true, place this objective first in the selected queue.'
        },
        position: {
          type: 'number',
          description: 'Optional one-based insertion position in the selected queue.'
        },
        remove: {
          type: 'boolean',
          description:
            'When true, remove this objective from the Run Queue instead of adding or moving it.'
        }
      },
      required: ['objectiveId'],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false
    }
  },
  {
    name: 'overlord_manage_run_queue',
    title: 'Manage Run Queues',
    description:
      "Use this only when the user explicitly asks to create, rename, pause, resume, delete, or reorder the project's Run Queue definitions, or to retry one held queue entry. The queue-definition actions are administrative project-configuration and require a full-scope token; adding, moving, or removing objectives inside a queue uses overlord_queue_objective and overlord_reorder_run_queue instead.",
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'update', 'delete', 'reorder_queues', 'retry_entry'],
          description:
            "create a queue, update (rename/pause/resume) one, delete one, reorder the queue definitions, or retry_entry to clear one held entry's hold and attempt budget so the dispatcher tries it again."
        },
        projectId: {
          type: 'string',
          description: 'Project UUID, slug, or name. Required for create and reorder_queues.'
        },
        queue: {
          type: 'string',
          description: 'Run Queue UUID or unambiguous name. Required for update and delete.'
        },
        name: {
          type: 'string',
          description: 'New queue name for create, or the replacement name for update.'
        },
        paused: {
          type: 'boolean',
          description: 'update only: true pauses dispatching from the queue, false resumes it.'
        },
        moveEntriesTo: {
          type: 'string',
          description:
            'delete only: destination queue UUID or unambiguous name. Required when the queue still holds entries.'
        },
        entry: {
          type: 'string',
          description:
            'retry_entry only: entry UUID, objective UUID, or objective display id. One of entry or objectiveId is required.'
        },
        objectiveId: {
          type: 'string',
          description:
            'retry_entry only: objective UUID or display id whose live entry should be retried.'
        },
        orderedQueues: {
          type: 'array',
          description:
            'reorder_queues only: every live queue exactly once, top to bottom, by UUID or unambiguous name. The default queue must stay first.',
          items: {
            type: 'string',
            description: 'Run Queue UUID or unambiguous name.'
          }
        }
      },
      required: ['action'],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false
    }
  },
  {
    name: 'overlord_attach_session',
    title: 'Attach to mission',
    description:
      'Use this only after the user asks the connected agent to begin work on a mission. It opens an MCP-hosted session for later updates and delivery. Pass objectiveId when the caller already knows which objective to execute so attach does not rediscover another one.',
    inputSchema: {
      type: 'object',
      properties: {
        missionId: {
          type: 'string',
          description:
            'Mission UUID or workspace display id. Optional when objectiveId is a display id such as coo:756.k7xm, which already names its mission.'
        },
        objectiveId: {
          type: 'string',
          description:
            'Objective UUID or display id such as coo:756.k7xm. Pins attach to that objective, and supplies missionId when it is omitted.'
        },
        agent: {
          type: 'string',
          description: 'Agent identifier. Defaults to __OVERLORD_ADAPTER_KEY__.'
        },
        model: {
          type: 'string',
          description: 'Optional model identifier.'
        },
        executionTargetId: {
          type: 'string',
          description:
            'Optional local execution target id for resolving sibling project resource paths.'
        }
      },
      required: [],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false
    }
  },
  {
    name: 'overlord_update_session',
    title: 'Update mission session',
    description:
      'Use this only to post the user-requested work update, alert, decision, or discussion summary to an attached mission session.',
    inputSchema: {
      type: 'object',
      properties: {
        missionId: {
          type: 'string',
          description:
            'Mission UUID or workspace display id. Optional when objectiveId is a display id such as coo:756.k7xm, which already names its mission.'
        },
        objectiveId: {
          type: 'string',
          description:
            'Objective UUID or display id such as coo:756.k7xm. Supplies missionId when it is omitted; the session key still determines which objective the event lands on.'
        },
        sessionKey: {
          type: 'string',
          description: 'Session key returned by overlord_attach_session.'
        },
        summary: {
          type: 'string',
          description: 'Update text.'
        },
        phase: {
          type: 'string',
          description: 'Optional protocol phase.'
        },
        eventType: {
          type: 'string',
          description: 'Optional event type. Defaults to update.'
        },
        declaredPaths: {
          type: 'array',
          description:
            'Optional paths written by shell commands, generators, or scripts that native capture could not name. Recorded as agent_declared evidence; never an exhaustive list.',
          items: {
            type: 'string',
            description:
              'Canonical repository-relative path. Deleted and renamed paths (both endpoints) are valid.'
          }
        }
      },
      required: ['sessionKey', 'summary'],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false
    }
  },
  {
    name: 'overlord_deliver_session',
    title: 'Deliver mission session',
    description:
      'Use this only when the user-requested mission work is complete. It delivers the attached session with an explicit summary, optional declared shell/script output paths, and optional authoritative human-action/tradeoff evidence.',
    inputSchema: {
      type: 'object',
      properties: {
        missionId: {
          type: 'string',
          description:
            'Mission UUID or workspace display id. Optional when objectiveId is a display id such as coo:756.k7xm, which already names its mission.'
        },
        objectiveId: {
          type: 'string',
          description:
            'Objective UUID or display id such as coo:756.k7xm. Supplies missionId when it is omitted; the session key still determines which objective is delivered.'
        },
        sessionKey: {
          type: 'string',
          description: 'Session key returned by overlord_attach_session.'
        },
        summary: {
          type: 'string',
          description: 'Delivery summary.'
        },
        artifacts: {
          type: 'array',
          description:
            'Optional mission artifacts to persist with this delivery. Each artifact has type, label, optional content, and optional HTTP(S) url.',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                description:
                  'Artifact type, such as note, next_steps, test_results, decision, migration, or url.'
              },
              label: {
                type: 'string',
                description: 'Human-facing artifact label.'
              },
              content: {
                type: 'string',
                description: 'Optional text or Markdown content.'
              },
              url: {
                type: 'string',
                description: 'Optional HTTP(S) URL.'
              }
            },
            required: ['type', 'label'],
            additionalProperties: false
          }
        },
        declaredPaths: {
          type: 'array',
          description:
            'Optional paths written by shell commands, generators, or scripts that native capture could not name. Recorded as agent_declared evidence; never an exhaustive list and never required.',
          items: {
            type: 'string',
            description:
              'Canonical repository-relative path. Deleted and renamed paths (both endpoints) are valid.'
          }
        },
        humanActions: {
          type: 'array',
          description:
            'Concrete actions a human must perform outside completed agent work. Exclude Git operations and routine review/testing. Each item is read on its own from the delivery card, so give every one an action, reason, and category, plus command, verify, and link whenever they exist. Vague: { action: "Set up the env var for Gemini." }. Good: { action: "Add GEMINI_API_KEY to the production backend service on Railway.", reason: "Compose falls back to the raw summary without it.", category: "environment", command: "railway variables set GEMINI_API_KEY=<key> --service backend", verify: "The next delivery card shows a composed presentation.", link: ".env.example" }.',
          items: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                description:
                  'Required. One imperative sentence naming what to do, where, and with which value.'
              },
              reason: {
                type: 'string',
                description:
                  'Expected. Why the step is needed and what stays broken until it is done.'
              },
              category: {
                type: 'string',
                description:
                  'Expected. environment, database, deployment, codegen, packaging, external_service, or other.'
              },
              blocking: {
                type: 'boolean',
                description: 'True when the delivered work does not function until this is done.'
              },
              command: {
                type: 'string',
                description:
                  'The exact command, setting name, or value to apply, verbatim; placeholders in <angle brackets>.'
              },
              verify: {
                type: 'string',
                description:
                  'How the operator confirms it worked: a command, a URL, or the state to observe.'
              },
              link: {
                type: 'string',
                description:
                  'An HTTP(S) URL or repository-relative file path relevant to the action. No other URI schemes.'
              }
            },
            required: ['action'],
            additionalProperties: false
          }
        },
        tradeoffsMade: {
          type: 'array',
          description: 'Implementation decisions and why the chosen approach was preferred.',
          items: {
            type: 'object',
            properties: {
              decision: {
                type: 'string',
                description: 'The chosen implementation decision.'
              },
              alternativesConsidered: {
                type: 'array',
                items: {
                  type: 'string',
                  description: 'Alternative considered.'
                }
              },
              rationale: {
                type: 'string',
                description: 'Why this approach was chosen.'
              },
              impact: {
                type: 'string',
                description: 'Resulting limitation or consequence.'
              }
            },
            required: [],
            additionalProperties: false
          }
        },
        knownRisks: {
          type: 'array',
          items: {
            type: 'string',
            description: 'Residual risk or limitation.'
          }
        },
        deferredWork: {
          type: 'array',
          description:
            'Each deferredWork item is one recommended objective outside this mission. Be very concise. title names the work in an imperative phrase. change states only the specific change that is needed. location says where to find it in the code: the file, function, component, or command. doneWhen states the observable result in one sentence. Do not add instructions on how to do the work, background, or rationale. The operator turns the item into an objective or a mission as written, so it must read as a task, not as a note. Omit queued future objectives, leftover current-objective work, and human follow-up (those belong in humanActions). Vague: { title: "Fix flaky test", change: "The sync worker has a flaky test.", location: "backend", doneWhen: "It passes." }. Good: { title: "Advance the fake clock before the second retry", change: "The test asserts the retry fired but never advances the fake clock between attempts, so it passes or fails on real time.", location: "backend/sync-worker.test.ts › retries after a 503", doneWhen: "The test passes 20 consecutive runs with the fake clock driving both attempts." }.',
          items: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: 'Required. The work as an imperative phrase, at most 80 characters.'
              },
              change: {
                type: 'string',
                description:
                  'Required. The specific change that is needed, one or two sentences, at most 400 characters.'
              },
              location: {
                type: 'string',
                description:
                  'Required. Where to find it: file, function, component, or command, at most 200 characters.'
              },
              doneWhen: {
                type: 'string',
                description:
                  'Required. The observable result in one sentence, at most 200 characters.'
              }
            },
            required: ['title', 'change', 'location', 'doneWhen'],
            additionalProperties: false
          }
        },
        assumptions: {
          type: 'array',
          items: {
            type: 'string',
            description: 'Material implementation assumption.'
          }
        }
      },
      required: ['sessionKey', 'summary'],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false
    }
  },
  {
    name: 'overlord_add_artifact',
    title: 'Add mission artifact',
    description:
      'Use this to create a mission artifact during a turn without delivering — for example a plan, notes, decision, or URL the reviewer should see while work continues. Provide type, label, and at least one of contentText or externalUrl. Optional sessionKey stamps session/objective provenance. Revise later with overlord_update_artifact. Delivery may still attach more artifacts.',
    inputSchema: {
      type: 'object',
      properties: {
        missionId: {
          type: 'string',
          description:
            'Mission UUID or workspace display id. Optional when objectiveId is a display id such as coo:756.k7xm, which already names its mission.'
        },
        objectiveId: {
          type: 'string',
          description:
            'Objective UUID or display id such as coo:756.k7xm. Stamps objective provenance when no live sessionKey is available; sessionKey wins when both are given.'
        },
        type: {
          type: 'string',
          description: 'Artifact type: test_results, next_steps, note, url, decision, or migration.'
        },
        label: {
          type: 'string',
          description: 'Human-facing label for the artifact.'
        },
        contentText: {
          type: 'string',
          description: 'Optional Markdown/text content.'
        },
        externalUrl: {
          type: 'string',
          description: 'Optional HTTP(S) URL.'
        },
        sessionKey: {
          type: 'string',
          description:
            'Optional live session key from attach; stamps session/objective provenance when present.'
        }
      },
      required: ['type', 'label'],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false
    }
  },
  {
    name: 'overlord_update_artifact',
    title: 'Update mission artifact',
    description:
      'Use this when an existing mission artifact must be revised in place (for example a plan written in an earlier objective) rather than delivering a duplicate. Requires the current artifact revision for optimistic concurrency. Provide at least one of label, contentText, or externalUrl.',
    inputSchema: {
      type: 'object',
      properties: {
        missionId: {
          type: 'string',
          description:
            'Mission UUID or workspace display id. Optional when objectiveId is a display id such as coo:756.k7xm, which already names its mission.'
        },
        objectiveId: {
          type: 'string',
          description:
            'Objective UUID or display id such as coo:756.k7xm. Used only to supply missionId when it is omitted.'
        },
        artifactId: {
          type: 'string',
          description: 'Artifact id from mission context or load-context artifacts.'
        },
        expectedRevision: {
          type: 'number',
          description: 'Current artifact.revision. Stale values return a conflict error.'
        },
        label: {
          type: 'string',
          description: 'Optional new human-facing label.'
        },
        contentText: {
          type: 'string',
          description:
            'Optional new Markdown/text content. Pass an empty string to clear text content.'
        },
        externalUrl: {
          type: 'string',
          description: 'Optional HTTP(S) URL. Pass an empty string to clear the external URL.'
        }
      },
      required: ['artifactId', 'expectedRevision'],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false
    }
  },
  {
    name: 'overlord_record_work',
    title: 'Record completed work as a mission',
    description:
      'Use this to log work already finished in this chat as a completed Overlord mission — one call, no attach/deliver cycle. It creates a mission and a single completed objective, records the explicitly declared changed paths, lands the mission in the review column, and runs the delivery through the standard Gemini summarizer so it reads like any other delivered mission. Provide an objective (what was asked/done) and a reviewer-facing summary; optional declaredPaths lists the files the work changed. Only use this when the work is genuinely complete; use overlord_create_mission for work still to be done.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description:
            'Overlord project id, slug, or name. Overlord never chooses a project implicitly.'
        },
        objective: {
          type: 'string',
          description: 'What was asked and done, phrased as a completed objective (1-3 sentences).'
        },
        summary: {
          type: 'string',
          description: 'Reviewer-facing narrative of what changed and why.'
        },
        title: {
          type: 'string',
          description: 'Optional mission title; defaults to a title derived from the objective.'
        },
        declaredPaths: {
          type: 'array',
          description:
            'Optional repository-relative paths this work changed, recorded as agent_declared evidence for the completed objective.',
          items: {
            type: 'string',
            description:
              'Canonical repository-relative path. Deleted and renamed paths (both endpoints) are valid.'
          }
        },
        artifacts: {
          type: 'array',
          description: 'Optional artifacts: next_steps, test_results, decision, note, or url.'
        }
      },
      required: ['projectId', 'objective', 'summary'],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false
    }
  }
];
// END GENERATED MCP TOOL CATALOG

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
    const reference = optionalString(args, 'reference');
    if (reference) {
      // Exact-reference mode: ranked filters are forwarded so Protocol rejects them.
      const ranked = {};
      for (const [key, flag] of [
        ['query', 'query'],
        ['status', 'status'],
        ['resourceKey', 'resource-key'],
        ['dateField', 'date-field'],
        ['from', 'from'],
        ['to', 'to'],
        ['entityTypes', 'entity-types'],
        ['objectiveStates', 'objective-states']
      ]) {
        if (optionalString(args, key)) ranked[flag] = requiredString(args, key);
      }
      if (typeof args.matchesPerResult === 'number') {
        ranked['matches-per-result'] = String(args.matchesPerResult);
      }
      return runProtocol('search', {
        reference,
        ...(optionalString(args, 'projectId')
          ? { 'project-id': requiredString(args, 'projectId') }
          : {}),
        ...(optionalString(args, 'workspaceId')
          ? { 'workspace-id': requiredString(args, 'workspaceId') }
          : {}),
        ...(optionalString(args, 'cursor') ? { cursor: requiredString(args, 'cursor') } : {}),
        ...(typeof args.limit === 'number' && Number.isFinite(args.limit)
          ? { limit: String(Math.trunc(args.limit)) }
          : {}),
        ...ranked
      });
    }
    if (optionalString(args, 'cursor')) {
      throw new Error('cursor applies only to an exact reference search');
    }
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
        : {}),
      ...(args.unassignedToProject === true ? { 'unassigned-to-project': true } : {}),
      objective: requiredString(args, 'objective'),
      ...(optionalString(args, 'title') ? { title: requiredString(args, 'title') } : {}),
      ...(optionalString(args, 'resourceKey')
        ? { resource: requiredString(args, 'resourceKey') }
        : {}),
      ...(optionalString(args, 'agent')
        ? { 'objective-agent': requiredString(args, 'agent') }
        : {}),
      ...(optionalString(args, 'model')
        ? { 'objective-model': requiredString(args, 'model') }
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
      'unassigned-to-project': true,
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
  if (name === 'overlord_changes') {
    return runProtocol('objective-changes', missionScopeFlags(args));
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
    const hasTitle = typeof args.title === 'string';
    const hasAutoAdvance = typeof args.autoAdvance === 'boolean';
    const hasInstructionText = typeof args.instructionText === 'string';
    if (!hasTitle && !hasAutoAdvance && !hasInstructionText) {
      throw new Error('Provide title, autoAdvance, and/or instructionText');
    }
    return runProtocol('update-objective', {
      'objective-id': requiredString(args, 'objectiveId'),
      ...(hasTitle ? { title: args.title } : {}),
      ...(hasAutoAdvance
        ? args.autoAdvance
          ? { 'auto-advance': true }
          : { 'no-auto-advance': true }
        : {}),
      ...(hasInstructionText ? { 'instruction-text': requiredString(args, 'instructionText') } : {})
    });
  }
  if (name === 'overlord_delete_missions') {
    if (!Array.isArray(args.missionIds) || !args.missionIds.every(id => typeof id === 'string')) {
      throw new Error('missionIds must be an array of strings');
    }
    if (args.confirm !== true) {
      throw new Error('confirm must be true after the user has affirmatively approved deletion');
    }
    return runProtocol('delete-missions', {
      'mission-ids-json': args.missionIds,
      confirm: true
    });
  }
  if (name === 'overlord_delete_objectives') {
    if (
      !Array.isArray(args.objectiveIds) ||
      !args.objectiveIds.every(id => typeof id === 'string')
    ) {
      throw new Error('objectiveIds must be an array of strings');
    }
    if (args.confirm !== true) {
      throw new Error('confirm must be true after the user has affirmatively approved deletion');
    }
    return runProtocol('delete-objectives', {
      'objective-ids-json': args.objectiveIds,
      confirm: true
    });
  }
  if (name === 'overlord_list_run_queues') {
    const detail = optionalString(args, 'detail') || 'compact';
    if (detail !== 'compact' && detail !== 'full') {
      throw new Error("detail must be 'compact' or 'full'");
    }
    const response = await runProtocol('run-queue', {
      ...(optionalString(args, 'projectId')
        ? { 'project-id': requiredString(args, 'projectId') }
        : {}),
      ...(optionalString(args, 'objectiveId')
        ? { 'objective-id': requiredString(args, 'objectiveId') }
        : {}),
      ...(optionalString(args, 'missionId')
        ? { 'mission-id': requiredString(args, 'missionId') }
        : {}),
      ...(optionalString(args, 'queue') ? { queue: requiredString(args, 'queue') } : {})
    });
    return detail === 'compact' ? compactRunQueueResponse(response) : response;
  }
  if (name === 'overlord_reorder_run_queue') {
    if (
      !Array.isArray(args.orderedObjectives) ||
      !args.orderedObjectives.every(item => typeof item === 'string')
    ) {
      throw new Error('orderedObjectives must be an array of strings');
    }
    return runProtocol('reorder-run-queue', {
      queue: requiredString(args, 'queue'),
      'ordered-entries-json': args.orderedObjectives,
      ...(optionalString(args, 'projectId')
        ? { 'project-id': requiredString(args, 'projectId') }
        : {})
    });
  }
  if (name === 'overlord_queue_objective') {
    const hasAfter = optionalString(args, 'after') !== null;
    const hasFront = args.front === true;
    const hasPosition = args.position !== undefined;
    if (Number(hasAfter) + Number(hasFront) + Number(hasPosition) > 1) {
      throw new Error('Choose only one placement option: after, front, or position');
    }
    if (hasPosition && (!Number.isInteger(args.position) || args.position < 1)) {
      throw new Error('position must be a positive integer');
    }
    return runProtocol(args.remove === true ? 'dequeue-objective' : 'queue-objective', {
      'objective-id': requiredString(args, 'objectiveId'),
      ...(args.remove === true
        ? {}
        : {
            ...(optionalString(args, 'queue') ? { queue: requiredString(args, 'queue') } : {}),
            ...(hasAfter ? { after: requiredString(args, 'after') } : {}),
            ...(hasFront ? { front: true } : {}),
            ...(hasPosition ? { position: String(args.position) } : {})
          })
    });
  }
  if (name === 'overlord_manage_run_queue') {
    const action = optionalString(args, 'action');
    if (action === null) throw new Error('action is required');
    const projectRef = optionalString(args, 'projectId');
    const queue = optionalString(args, 'queue');
    const queueName = optionalString(args, 'name');

    if (action === 'create') {
      if (!projectRef) throw new Error("action 'create' requires projectId");
      if (!queueName) throw new Error("action 'create' requires name");
      return runProtocol('create-run-queue', { 'project-id': projectRef, name: queueName });
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
      return runProtocol('update-run-queue', {
        queue,
        ...(projectRef ? { 'project-id': projectRef } : {}),
        ...(queueName ? { name: queueName } : {}),
        ...(paused === true ? { pause: true } : {}),
        ...(paused === false ? { resume: true } : {})
      });
    }

    if (action === 'delete') {
      if (!queue) throw new Error("action 'delete' requires queue");
      const moveEntriesTo = optionalString(args, 'moveEntriesTo');
      return runProtocol('delete-run-queue', {
        queue,
        ...(projectRef ? { 'project-id': projectRef } : {}),
        ...(moveEntriesTo ? { 'move-entries-to': moveEntriesTo } : {})
      });
    }

    if (action === 'retry_entry') {
      const entry = optionalString(args, 'entry');
      const objectiveRef = optionalString(args, 'objectiveId');
      if (!entry && !objectiveRef) {
        throw new Error("action 'retry_entry' requires entry or objectiveId");
      }
      return runProtocol('retry-queue-entry', {
        ...(entry ? { entry } : {}),
        ...(objectiveRef ? { 'objective-id': objectiveRef } : {}),
        ...(projectRef ? { 'project-id': projectRef } : {})
      });
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
      return runProtocol('reorder-project-run-queues', {
        'project-id': projectRef,
        'ordered-queues-json': args.orderedQueues
      });
    }

    throw new Error(`Unsupported Run Queue action: ${action}`);
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
        : {}),
      ...(Array.isArray(args.declaredPaths) ? { 'declared-paths-json': args.declaredPaths } : {})
    });
  }
  if (name === 'overlord_deliver_session') {
    return runProtocol('deliver', {
      ...missionScopeFlags(args),
      'session-key': requiredString(args, 'sessionKey'),
      summary: requiredString(args, 'summary'),
      ...(Array.isArray(args.artifacts) ? { 'artifacts-json': args.artifacts } : {}),
      ...(Array.isArray(args.declaredPaths) ? { 'declared-paths-json': args.declaredPaths } : {}),
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
        ...(Array.isArray(args.declaredPaths) ? { declaredPaths: args.declaredPaths } : {}),
        ...(Array.isArray(args.artifacts) ? { artifacts: args.artifacts } : {})
      }
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
          serverInfo: { name: 'overlord-__OVERLORD_ADAPTER_KEY__', version: '0.3.58' }
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
