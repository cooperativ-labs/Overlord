export type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
};

function objectSchema(
  properties: Record<string, unknown>,
  required: string[] = []
): Record<string, unknown> {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false
  };
}

const stringProperty = (description: string): Record<string, unknown> => ({
  type: 'string',
  description
});

const booleanProperty = (description: string): Record<string, unknown> => ({
  type: 'boolean',
  description
});

const protocolOutputSchema = (description: string): Record<string, unknown> => ({
  type: 'object',
  description,
  additionalProperties: true
});

const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const writeAction = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

function widget(uri: string): Record<string, unknown> {
  return {
    'openai/outputTemplate': uri,
    ui: { resourceUri: uri }
  };
}

export const hostedMcpToolDefinitions: ToolDefinition[] = [
  {
    name: 'overlord_resolve_project',
    title: 'Resolve Overlord project',
    description:
      'Use this when the user identifies an Overlord project by id, slug, name, or exposed repository metadata. ' +
      'Names are matched case-insensitively across every workspace the caller can reach; when a name ' +
      "matches in more than one, this returns a 'project_selection_required' result listing the candidates " +
      'with their workspaces — ask the user which one, then retry with workspaceId set. When resolving ' +
      'from .overlord/project.json, the result is the isPrimary project if the checkout is linked to more ' +
      'than one project; linkedProjects lists every linked project.',
    inputSchema: objectSchema({
      projectId: stringProperty('Explicit Overlord project id, slug, or project name.'),
      workspaceId: stringProperty(
        'Optional workspace (id, slug, or name) that narrows an ambiguous projectId. Use this to ' +
          "retry after a 'project_selection_required' result."
      ),
      directory: stringProperty(
        'Optional repository directory path when the MCP client can expose one with .overlord/project.json.'
      )
    }),
    outputSchema: protocolOutputSchema(
      "Resolved Overlord project metadata, or a 'project_selection_required' result listing candidate projects."
    ),
    annotations: readOnly,
    _meta: widget('ui://overlord/project-selector.html')
  },
  {
    name: 'overlord_create_project',
    title: 'Create Overlord project',
    description:
      'Use this only when the user explicitly asks to create a new Overlord project (workspace project). ' +
      'If the user belongs to more than one workspace and none is specified, this returns a ' +
      "'workspace_selection_required' result listing the workspaces — ask the user which one, then " +
      'call again with workspaceId set to the chosen id, slug, or name.',
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
    ),
    outputSchema: protocolOutputSchema(
      "The created project (status 'created'), or a 'workspace_selection_required' result listing candidate workspaces."
    ),
    annotations: writeAction
  },
  {
    name: 'overlord_list_project_statuses',
    title: 'List Overlord project statuses',
    description:
      "Use this to read one project's board columns. Status names and order are defined per " +
      'project, so two projects in the same workspace can label the same lifecycle differently; ' +
      'this is the only way to discover a specific board\u2019s columns. Each status carries a ' +
      'stable type (draft, next, execute, review, complete, blocked, cancelled) that does not vary by ' +
      'project — use the type for filtering and the name only for display.',
    inputSchema: objectSchema(
      {
        projectId: stringProperty(
          'Overlord project id, slug, or name. An ambiguous name returns ' +
            "'project_selection_required'; retry with workspaceId."
        ),
        workspaceId: stringProperty(
          'Optional workspace (id, slug, or name) that narrows an ambiguous projectId.'
        )
      },
      ['projectId']
    ),
    outputSchema: protocolOutputSchema(
      "The project's statuses ordered by board position, each with id, projectId, key, name, type, position, isDefault, and isTerminal."
    ),
    annotations: readOnly
  },
  {
    name: 'overlord_search_missions',
    title: 'Search Overlord missions',
    description:
      "Use this to find missions across the caller's authorized workspaces. Results are mission anchors with only the matching objectives and deliveries in matches; an objective displayId (for example coo:789.2nnh) can be passed directly to overlord_load_mission_context. matches is never the mission's complete objective list. Artifacts are not indexed; load mission context after locating the mission to read them. There is no relative-date parsing or implicit time window: compute absolute ISO bounds and pass from/to. Raise limit for broad questions and inspect workspaceCounts, entityCounts, and truncatedCandidates before claiming a list is complete. appliedFilters.mode 'fallback' means the query contributed nothing and results are a recency listing, not an answer. Compact detail is the default and retains navigation identity while reducing child payload; request full for snippets and child metadata.",
    inputSchema: objectSchema({
      query: stringProperty('Search query text.'),
      status: stringProperty(
        'Comma-separated status TYPES, such as draft,execute,review. Types are workspace-invariant ' +
          '(draft, next, execute, review, complete, blocked, cancelled). Project-defined status names — the ' +
          'board column labels read by overlord_list_project_statuses — are not accepted here.'
      ),
      projectId: stringProperty(
        'Optional project reference: a stable UUID, a slug, or the project name as the user said ' +
          'it. Names are matched case-insensitively against the projects the caller can reach. If ' +
          "the name matches in more than one workspace the call returns a 'project_selection_required' " +
          'result listing the candidates with their workspaces — ask the user which one, then retry ' +
          'with workspaceId set.'
      ),
      workspaceId: stringProperty(
        'Optional workspace (id, slug, or name) that narrows an ambiguous projectId. Use this to ' +
          "retry after a 'project_selection_required' result."
      ),
      resourceKey: stringProperty(
        'Optional logical resource key. Keys are matched by name within every selected project.'
      ),
      dateField: stringProperty(
        'Date column for an explicit range: createdAt, updatedAt, or dueDatetime. Defaults to ' +
          'updatedAt only when from or to is supplied. Use dueDatetime for questions about what is ' +
          'scheduled or due — a mission is scheduled by its due date, not by an execution timer. ' +
          'Missions with no due date are excluded from a dueDatetime range.'
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
          'Result detail: compact (default) keeps child navigation fields and removes child snippets/metadata; full returns the complete v3 child matches.'
      }
    }),
    outputSchema: protocolOutputSchema(
      'SearchResponseV3: mission-anchored results with matched objective/delivery children, appliedFilters, entityCounts, ' +
        "totalMatchedBeforeLimit, workspaceCounts, and truncatedCandidates. Or a 'project_selection_required' " +
        'result when projectId names a project in more than one workspace.'
    ),
    annotations: readOnly,
    _meta: widget('ui://overlord/mission-list.html')
  },
  {
    name: 'overlord_create_mission',
    title: 'Create Overlord mission',
    description:
      'Use this to create a draft mission in projectId, or an account-owned inbox item when projectId is omitted. Hosted MCP never chooses a project implicitly.',
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
    ),
    outputSchema: protocolOutputSchema(
      'The newly created draft mission, or an explicit unassigned inbox item.'
    ),
    annotations: writeAction
  },
  {
    name: 'overlord_create_inbox_item',
    title: 'Create inbox item',
    description: 'Use this to create a private, account-owned unassigned task capture.',
    inputSchema: objectSchema(
      {
        title: stringProperty('Inbox item title.'),
        objective: stringProperty('The one objective captured in v1.')
      },
      ['title', 'objective']
    ),
    outputSchema: protocolOutputSchema('The new explicit unassigned inbox item.'),
    annotations: writeAction
  },
  {
    name: 'overlord_load_mission_context',
    title: 'Load mission context',
    description:
      'Use this when the user wants to inspect one mission, its objectives, history, artifacts, or shared context.',
    inputSchema: objectSchema({
      missionId: stringProperty(
        'Mission UUID or workspace display id. Optional when objectiveId is a display id such as coo:756.k7xm, which already names its mission.'
      ),
      objectiveId: stringProperty(
        'Objective UUID or display id such as coo:756.k7xm. Returns that objective as the current one instead of rediscovering the mission active objective — required on a mission running objectives in parallel.'
      ),
      executionTargetId: stringProperty(
        'Optional local execution target id for resolving sibling project resource paths.'
      )
    }),
    outputSchema: protocolOutputSchema('Structured context for the requested mission.'),
    annotations: readOnly,
    _meta: widget('ui://overlord/objective-viewer.html')
  },
  {
    name: 'overlord_list_deliveries',
    title: 'List mission deliveries',
    description:
      "Use this to read a mission's delivered work after locating it. Returns newest-first normalized delivery records including summary, verification, follow-up notes, and authoritative human-action, tradeoff, risk, deferred-work, and assumption evidence; it never exposes raw delivery payloads.",
    inputSchema: objectSchema({
      missionId: stringProperty(
        'Mission UUID or workspace display id. Optional when objectiveId is a display id such as coo:756.k7xm, which already names its mission.'
      ),
      objectiveId: stringProperty(
        'Objective UUID or display id such as coo:756.k7xm. Use a display id when that is the only identifier available.'
      )
    }),
    outputSchema: protocolOutputSchema(
      "The mission's newest-first normalized DeliveryDto records."
    ),
    annotations: readOnly
  },
  {
    name: 'overlord_launch_objective',
    title: 'Launch objective execution',
    description:
      'Use this only when the user explicitly asks to start a particular objective. It queues the normal Overlord execution request; it does not attach this MCP agent to perform the work. The objective must be launchable, its workspace must authorize execution, and an existing active request is returned instead of duplicated.',
    inputSchema: objectSchema(
      {
        objectiveId: stringProperty('Objective UUID or display id such as coo:756.k7xm.'),
        agent: stringProperty('Agent identifier to launch, such as codex or claude.'),
        model: stringProperty('Optional model identifier to snapshot onto the execution request.'),
        reasoningEffort: stringProperty(
          'Optional reasoning-effort setting to snapshot onto the execution request.'
        ),
        executionTargetId: stringProperty(
          "Optional eligible execution target id. Omit to use the project's normal target selection."
        )
      },
      ['objectiveId', 'agent']
    ),
    outputSchema: protocolOutputSchema('The queued or already-active ExecutionRequestDto.'),
    annotations: writeAction
  },
  {
    name: 'overlord_reorder_future_objectives',
    title: 'Reorder future objectives',
    description:
      'Use this only when the user explicitly asks to change the order of future objectives in one mission. Supply every future objective UUID in its complete desired top-to-bottom order; draft, active, and completed objectives cannot be moved by this tool.',
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
    ),
    outputSchema: protocolOutputSchema("The mission's full ObjectiveDto list in its new order."),
    annotations: writeAction
  },
  {
    name: 'overlord_add_objectives',
    title: 'Add objectives',
    description:
      'Use this only when the user explicitly asks to append draft objectives to an existing mission.',
    inputSchema: objectSchema(
      {
        missionId: stringProperty(
          'Mission UUID or workspace display id. Optional when objectiveId is a display id such as coo:756.k7xm, which already names its mission.'
        ),
        objectiveId: stringProperty(
          'Objective UUID or display id such as coo:756.k7xm. Used only to supply missionId when it is omitted; the new objectives are appended to that objective mission.'
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
    ),
    outputSchema: protocolOutputSchema('The mission with the appended draft objectives.'),
    annotations: writeAction
  },
  {
    name: 'overlord_update_objective',
    title: 'Update objective',
    description:
      'Use this to turn auto-advance on or off and/or edit instruction text on a draft or future objective.',
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
    ),
    outputSchema: protocolOutputSchema(
      'The updated objective, including autoAdvance and instructionText.'
    ),
    annotations: writeAction
  },
  {
    name: 'overlord_list_run_queues',
    title: 'List Run Queues',
    description:
      "Use this to read a project's authoritative Run Queues before adding, moving, removing, or bulk-reordering entries. Compact detail is the default and includes ordering and blocking state; request full for the complete ProjectRunQueuesDto.",
    inputSchema: objectSchema({
      projectId: stringProperty('Optional project UUID, slug, or name.'),
      objectiveId: stringProperty(
        'Optional objective UUID or display id; derives the project when projectId is omitted.'
      ),
      missionId: stringProperty(
        'Optional mission UUID or display id; derives the project when projectId is omitted.'
      ),
      queue: stringProperty('Optional Run Queue UUID or unambiguous name to return by itself.'),
      detail: {
        type: 'string',
        enum: ['compact', 'full'],
        description:
          'Result detail: compact (default) returns queue ordering state; full returns the raw ProjectRunQueuesDto.'
      }
    }),
    outputSchema: protocolOutputSchema(
      'Compact queue state by default, or the raw ProjectRunQueuesDto when detail is full.'
    ),
    annotations: readOnly
  },
  {
    name: 'overlord_reorder_run_queue',
    title: 'Reorder Run Queue entries',
    description:
      'Use this only when the user explicitly asks to reorder every entry in one Run Queue. Supply every live entry exactly once, using entry UUIDs, objective UUIDs, or objective display ids. Running and dispatched entries cannot move. On a mismatch, the error returns the current order; re-read the queue and retry.',
    inputSchema: objectSchema(
      {
        queue: stringProperty('Run Queue UUID or unambiguous name.'),
        orderedObjectives: {
          type: 'array',
          description:
            'Complete desired top-to-bottom entry order. Each item may be an entry UUID, objective UUID, or objective display id.',
          items: stringProperty('Run Queue entry UUID, objective UUID, or objective display id.')
        },
        projectId: stringProperty(
          'Optional project UUID, slug, or name; disambiguates queue names.'
        )
      },
      ['queue', 'orderedObjectives']
    ),
    outputSchema: protocolOutputSchema('The reordered RunQueueDto.'),
    annotations: writeAction
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
        front: booleanProperty('When true, place this objective first in the selected queue.'),
        position: {
          type: 'number',
          description: 'Optional one-based insertion position in the selected queue.'
        },
        remove: booleanProperty(
          'When true, remove this objective from the Run Queue instead of adding or moving it.'
        )
      },
      ['objectiveId']
    ),
    outputSchema: protocolOutputSchema('The queued entry, or removal confirmation.'),
    annotations: writeAction
  },
  {
    name: 'overlord_manage_run_queue',
    title: 'Manage Run Queues',
    description:
      "Use this only when the user explicitly asks to create, rename, pause, resume, delete, or reorder the project's Run Queue definitions. These are administrative project-configuration actions and require a full-scope token; adding, moving, or removing objectives inside a queue uses overlord_queue_objective and overlord_reorder_run_queue instead.",
    inputSchema: objectSchema(
      {
        action: {
          type: 'string',
          enum: ['create', 'update', 'delete', 'reorder_queues'],
          description:
            'create a queue, update (rename/pause/resume) one, delete one, or reorder the queue definitions.'
        },
        projectId: stringProperty(
          'Project UUID, slug, or name. Required for create and reorder_queues.'
        ),
        queue: stringProperty(
          'Run Queue UUID or unambiguous name. Required for update and delete.'
        ),
        name: stringProperty('New queue name for create, or the replacement name for update.'),
        paused: booleanProperty(
          'update only: true pauses dispatching from the queue, false resumes it.'
        ),
        moveEntriesTo: stringProperty(
          'delete only: destination queue UUID or unambiguous name. Required when the queue still holds entries.'
        ),
        orderedQueues: {
          type: 'array',
          description:
            'reorder_queues only: every live queue exactly once, top to bottom, by UUID or unambiguous name. The default queue must stay first.',
          items: stringProperty('Run Queue UUID or unambiguous name.')
        }
      },
      ['action']
    ),
    outputSchema: protocolOutputSchema(
      'The created or updated RunQueueDto, a removal confirmation, or the reordered ProjectRunQueuesDto.'
    ),
    annotations: writeAction
  },
  {
    name: 'overlord_attach_session',
    title: 'Attach to mission',
    description:
      'Use this only after the user asks the connected agent to begin work on a mission. It opens an MCP-hosted session for later updates and delivery. Pass objectiveId when the caller already knows which objective to execute so attach does not rediscover another one.',
    inputSchema: objectSchema(
      {
        missionId: stringProperty(
          'Mission UUID or workspace display id. Optional when objectiveId is a display id such as coo:756.k7xm, which already names its mission.'
        ),
        objectiveId: stringProperty(
          'Objective UUID or display id such as coo:756.k7xm. Pins attach to that objective, and supplies missionId when it is omitted.'
        ),
        agent: stringProperty('Agent identifier. Defaults to hosted-mcp.'),
        model: stringProperty('Optional model identifier.'),
        executionTargetId: stringProperty(
          'Optional local execution target id for resolving sibling project resource paths.'
        )
      },
      []
    ),
    outputSchema: protocolOutputSchema(
      'Attached session context, including the session key required for lifecycle calls.'
    ),
    annotations: writeAction
  },
  {
    name: 'overlord_update_session',
    title: 'Update mission session',
    description:
      'Use this only to post the user-requested work update, alert, decision, or discussion summary to an attached mission session.',
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
    ),
    outputSchema: protocolOutputSchema('The recorded mission activity event.'),
    annotations: writeAction
  },
  {
    name: 'overlord_deliver_session',
    title: 'Deliver mission session',
    description:
      'Use this only when the user-requested mission work is complete. It delivers the attached session with an explicit summary, optional file-change rationales, and optional authoritative human-action/tradeoff evidence.',
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
          description:
            'Optional mission artifacts to persist with this delivery. Each artifact has type, label, optional content, and optional HTTP(S) url.',
          items: objectSchema(
            {
              type: stringProperty(
                'Artifact type, such as note, next_steps, test_results, decision, migration, or url.'
              ),
              label: stringProperty('Human-facing artifact label.'),
              content: stringProperty('Optional text or Markdown content.'),
              url: stringProperty('Optional HTTP(S) URL.')
            },
            ['type', 'label']
          )
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
            'Concrete actions a human must perform outside completed agent work. Exclude Git operations and routine review/testing.',
          items: objectSchema({
            action: stringProperty('The required human action.'),
            reason: stringProperty('Why the action is required.'),
            category: stringProperty(
              'environment, database, deployment, codegen, packaging, external_service, or other.'
            ),
            blocking: { type: 'boolean', description: 'Whether this blocks the intended outcome.' }
          })
        },
        tradeoffsMade: {
          type: 'array',
          description: 'Implementation decisions and why the chosen approach was preferred.',
          items: objectSchema({
            decision: stringProperty('The chosen implementation decision.'),
            alternativesConsidered: {
              type: 'array',
              items: stringProperty('Alternative considered.')
            },
            rationale: stringProperty('Why this approach was chosen.'),
            impact: stringProperty('Resulting limitation or consequence.')
          })
        },
        knownRisks: { type: 'array', items: stringProperty('Residual risk or limitation.') },
        deferredWork: { type: 'array', items: stringProperty('Intentionally deferred work.') },
        assumptions: { type: 'array', items: stringProperty('Material implementation assumption.') }
      },
      ['sessionKey', 'summary']
    ),
    outputSchema: protocolOutputSchema(
      'The completed delivery record and any recorded file changes.'
    ),
    annotations: writeAction,
    _meta: widget('ui://overlord/file-changes.html')
  },
  {
    name: 'overlord_add_artifact',
    title: 'Add mission artifact',
    description:
      'Use this to create a mission artifact during a turn without delivering — for example a plan, notes, ' +
      'decision, or URL the reviewer should see while work continues. Provide type, label, and at ' +
      'least one of contentText or externalUrl. Optional sessionKey stamps session/objective ' +
      'provenance. Revise later with overlord_update_artifact. Delivery may still attach more artifacts.',
    inputSchema: objectSchema(
      {
        missionId: stringProperty(
          'Mission UUID or workspace display id. Optional when objectiveId is a display id such as coo:756.k7xm, which already names its mission.'
        ),
        objectiveId: stringProperty(
          'Objective UUID or display id such as coo:756.k7xm. Stamps objective provenance when no live sessionKey is available; sessionKey wins when both are given.'
        ),
        type: stringProperty(
          'Artifact type: test_results, next_steps, note, url, decision, or migration.'
        ),
        label: stringProperty('Human-facing label for the artifact.'),
        contentText: stringProperty('Optional Markdown/text content.'),
        externalUrl: stringProperty('Optional HTTP(S) URL.'),
        sessionKey: stringProperty(
          'Optional live session key from attach; stamps session/objective provenance when present.'
        )
      },
      ['type', 'label']
    ),
    outputSchema: protocolOutputSchema('The created artifact DTO (revision 1).'),
    annotations: writeAction
  },
  {
    name: 'overlord_update_artifact',
    title: 'Update mission artifact',
    description:
      'Use this when an existing mission artifact must be revised in place (for example a plan ' +
      'written in an earlier objective) rather than delivering a duplicate. Requires the current ' +
      'artifact revision for optimistic concurrency. Provide at least one of label, contentText, or externalUrl.',
    inputSchema: objectSchema(
      {
        missionId: stringProperty(
          'Mission UUID or workspace display id. Optional when objectiveId is a display id such as coo:756.k7xm, which already names its mission.'
        ),
        objectiveId: stringProperty(
          'Objective UUID or display id such as coo:756.k7xm. Used only to supply missionId when it is omitted.'
        ),
        artifactId: stringProperty('Artifact id from mission context or load-context artifacts.'),
        expectedRevision: {
          type: 'number',
          description: 'Current artifact.revision. Stale values return a conflict error.'
        },
        label: stringProperty('Optional new human-facing label.'),
        contentText: stringProperty(
          'Optional new Markdown/text content. Pass an empty string to clear text content.'
        ),
        externalUrl: stringProperty(
          'Optional HTTP(S) URL. Pass an empty string to clear the external URL.'
        )
      },
      ['artifactId', 'expectedRevision']
    ),
    outputSchema: protocolOutputSchema('The updated artifact DTO including the new revision.'),
    annotations: writeAction
  },
  {
    name: 'overlord_record_work',
    title: 'Record completed work as a mission',
    description:
      'Use this to log work already finished in this chat as a completed Overlord mission — one call, no attach/deliver cycle. ' +
      'It creates a mission and a single completed objective, records the file changes and their rationales, lands the mission in ' +
      'the review column, and runs the delivery through the standard Gemini summarizer so it reads like any other delivered mission. ' +
      'Provide an objective (what was asked/done), a reviewer-facing summary, and one changeRationale per meaningful file change. ' +
      'Only use this when the work is genuinely complete; use overlord_create_mission for work still to be done.',
    inputSchema: objectSchema(
      {
        projectId: stringProperty(
          'Overlord project id, slug, or name. Hosted MCP never chooses a project implicitly.'
        ),
        objective: stringProperty(
          'What was asked and done, phrased as a completed objective (1-3 sentences).'
        ),
        summary: stringProperty('Reviewer-facing narrative of what changed and why.'),
        title: stringProperty(
          'Optional mission title; defaults to a title derived from the objective.'
        ),
        changeRationales: {
          type: 'array',
          description:
            'One entry per meaningful file change. Each: filePath, label, summary, why, impact (all strings).',
          items: objectSchema(
            {
              filePath: stringProperty('Repository-relative path of the changed file.'),
              label: stringProperty('Short reviewer title for the change.'),
              summary: stringProperty('What changed in this file.'),
              why: stringProperty('Why the change was made.'),
              impact: stringProperty('Behavioral impact of the change.')
            },
            ['filePath', 'label', 'summary', 'why', 'impact']
          )
        },
        changedFiles: {
          type: 'array',
          description:
            'Optional extra touched files without a full rationale (surface as missing_rationale in review).',
          items: objectSchema(
            {
              filePath: stringProperty('Repository-relative path.'),
              vcsStatus: stringProperty('Optional VCS status such as M, A, or D.')
            },
            ['filePath']
          )
        },
        artifacts: {
          type: 'array',
          description: 'Optional artifacts: next_steps, test_results, decision, note, or url.'
        }
      },
      ['projectId', 'objective', 'summary']
    ),
    outputSchema: protocolOutputSchema(
      'The created review-column mission and the delivery id whose Gemini summary is composing.'
    ),
    annotations: writeAction,
    _meta: widget('ui://overlord/file-changes.html')
  }
];
