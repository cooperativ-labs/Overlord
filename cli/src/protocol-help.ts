/** Backend and local-only protocol subcommands exposed by the CLI. */
export const SUPPORTED_PROTOCOL_SUBCOMMANDS = [
  'add-artifact',
  'add-objectives',
  'ask',
  'attach',
  'attachment-download-url',
  'attachment-list',
  'auth-status',
  'capture-change',
  'changes',
  'connect',
  'create',
  'create-project',
  'create-run-queue',
  'dequeue-objective',
  'delete-missions',
  'delete-objectives',
  'delete-run-queue',
  'deliver',
  'discover-project',
  'discuss-objective',
  'heartbeat',
  'hook-event',
  'launch-objective',
  'list-deliveries',
  'list-organizations',
  'load-context',
  'prompt',
  'read-context',
  'record-work',
  'register-target',
  'reorder-future-objectives',
  'reorder-project-run-queues',
  'reorder-run-queue',
  'run-queue',
  'queue-objective',
  'resume-follow-up',
  'retry-queue-entry',
  'search',
  'search-missions',
  'statuses',
  'sync-changes',
  'update',
  'update-artifact',
  'update-objective',
  'update-run-queue',
  'write-context'
] as const;

const PROTOCOL_HELP_ALIASES: Readonly<Record<string, string>> = {
  'search-missions': 'search'
};

export function hasProtocolSubcommandHelp(subcommand: string): boolean {
  return (SUPPORTED_PROTOCOL_SUBCOMMANDS as readonly string[]).includes(subcommand);
}

const DEFAULT_TIMEOUT_MS = 30_000;

export function printProtocolHelp({
  primaryCommand,
  subcommand
}: {
  primaryCommand: string;
  subcommand?: string;
}): void {
  const subcommands = SUPPORTED_PROTOCOL_SUBCOMMANDS.join(', ');

  const fullHelp = `${primaryCommand} protocol [flags]

Use this for mission lifecycle work from an agent runtime: create a standalone
draft with \`${primaryCommand} protocol create\`, create-and-attach with
\`${primaryCommand} protocol prompt\`, or attach to an existing mission with
\`${primaryCommand} protocol attach --mission-id <mission_id>\` or
\`${primaryCommand} protocol attach --objective-id <mission_id.objective_key>\`.

Backend and auth:
  Configure the REST backend before protocol calls:
  ${primaryCommand} init                         Create overlord.toml with a local backend URL
  ${primaryCommand} config set local [url]       Point at a local backend (default: http://127.0.0.1:4310)
  ${primaryCommand} config set cloud <url>       Point at a hosted backend URL
  ${primaryCommand} auth login                   Choose backend interactively when needed, then log in
  ${primaryCommand} doctor                       Validate backend reachability and connector installs

  To check credentials machine-readably from a script, use
  \`${primaryCommand} protocol auth-status\` (returns ok=true|false).

Project discovery:
  When prompting or creating missions, the CLI resolves the project from your
  working directory when --project-id is omitted. Discover it explicitly with:

  ${primaryCommand} protocol discover-project
  ${primaryCommand} protocol discover-project --project-id <id-or-name>
  ${primaryCommand} protocol discover-project --directory /path/to/repo

  Humans can also link checkouts with \`${primaryCommand} add-cwd\` and create
  projects with \`${primaryCommand} create-project --name "<name>"\`.

Agent workflow (required):
  1. Attach first with \`${primaryCommand} protocol attach --mission-id <id>\` or a full
     objective display id via \`--objective-id <id>\`.
  2. Post progress with \`${primaryCommand} protocol update\` or liveness with
     \`${primaryCommand} protocol heartbeat\`.
  3. Ask blocking questions with \`${primaryCommand} protocol ask\` and stop work.
  4. Deliver with \`${primaryCommand} protocol deliver\` when work is complete.
  5. Do not continue implementation after delivery without
     \`${primaryCommand} protocol resume-follow-up\` or \`--begin-follow-up-work\`
     on a still-live session.

Subcommands:
  auth-status            Return machine-readable auth/backend readiness
  discover-project       Resolve a project from the working directory or explicit id
  create-project         Create a project in one authorized workspace
  register-target        Register this machine as an execution target
  list-organizations     Legacy name; returns only the caller's current workspace context (not organizations)
  attach                 Start a mission session and return full working context
  connect                Start a lightweight session without full context assembly
  load-context           Read mission context without creating a session
  list-deliveries        List normalized deliveries for one mission
  launch-objective       Queue an objective for execution
  reorder-future-objectives
                         Reorder all future objectives in one mission
  search                  Find grouped mission/objective/delivery matches (canonical)
  search-missions         Compatibility alias for search
  statuses                List one project's ordered board columns
  discuss-objective      Mark a draft objective as submitted (does not start execution)
  add-objectives         Append ordered objectives to an existing mission
  update-objective       Set auto-advance and/or instruction text on an objective
  delete-missions        Confirmed bulk soft-delete of missions
  delete-objectives      Confirmed bulk soft-delete of objectives
  create                 Create a draft mission without attaching
  prompt                 Create a mission and attach to it immediately
  record-work            Record completed-from-chat work as a review mission (no attach)
  update                 Post progress, activity events, and optional change rationales
  heartbeat              Send a liveness ping without creating a mission event
  ask                    Post a blocking question and move the mission to review
  deliver                Finish work, send artifacts, and move the mission to review
  resume-follow-up       Reopen a completed objective for post-delivery follow-up work
  hook-event             Record a connector lifecycle hook (e.g. UserPromptSubmit)
  capture-change         Local-only: append direct-path hook evidence to an objective ledger
  changes                Sync and inspect the attached objective's local change ledger
                         (source, overlap, and hook-health evidence); never arbitrate peers
  read-context           Read shared persistent context for this mission
  write-context          Write shared persistent context for future sessions
  add-artifact           Create a mission artifact during a turn (no delivery required)
  update-artifact        Update an existing mission artifact in place
  attachment-list        List all attachments for the mission
  attachment-download-url  Get the download URL for a specific attachment
  sync-changes           Retry synchronization of local objective-ledger evidence
  run-queue              Read the project's authoritative Run Queues
  queue-objective        Add or move an objective in a Run Queue
  dequeue-objective      Remove an objective from a Run Queue
  retry-queue-entry      Retry a held Run Queue entry
  reorder-run-queue      Atomically reorder every entry in one Run Queue
  create-run-queue       Create an additional Run Queue in a project
  update-run-queue       Rename, pause, or resume one Run Queue
  delete-run-queue       Delete a Run Queue, optionally moving its entries
  reorder-project-run-queues
                         Reorder the project's Run Queue definitions

Runner queue (management commands, not protocol):
  ${primaryCommand} runner once|start|status|clear|clear-all [--branch <name>] [--no-worktree]
  ${primaryCommand} launch <agent> --mission-id <missionId> [--branch <name>] [--no-worktree]

Environment fallback:
  --session-key  <- SESSION_KEY printed on stderr after attach/connect/prompt/resume-follow-up
  --mission-id    <- mission display id (e.g. coo:8) or UUID
  --objective-id  <- OVERLORD_OBJECTIVE_ID (objective display id, e.g. coo:8.k7xm)
  backend URL    <- overlord.toml backend_url, OVERLORD_BACKEND_URL, or dev OVERLORD_BACKEND_URL_DEV
  auth token     <- OVERLORD_USER_TOKEN, OVLD_USER_TOKEN, or USER_TOKEN

Common flags:
  --mission-id <id>         Mission identifier when operating on an existing mission
  --objective-id <id>       Objective UUID or display id (coo:756.k7xm). Accepted anywhere
                            --mission-id is; a display id supplies --mission-id on its own,
                            so \`${primaryCommand} protocol update --objective-id coo:756.k7xm\`
                            needs no mission flag. An objective UUID names no mission, so it
                            still needs --mission-id beside it. Pass it whenever you know
                            which objective you are running — a mission may run several at
                            once, and unpinned commands cannot tell them apart.
  --session-key <key>      Session key returned by attach/connect/prompt/resume-follow-up
  --agent <identifier>     Agent identifier sent to Overlord (default: unknown)
  --model <identifier>     Model identifier to snapshot on executing objectives
  --timeout <ms>           Request timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS})

auth-status:
  Purpose:
    Check whether the local runtime can reach the configured backend.
  Returns:
    JSON with ok=true|false plus backend URL metadata. Does not print secrets.

discover-project:
  Purpose:
    Resolve the Overlord project for the current or given working directory.
  Optional:
    --project-id <id-or-name>   Resolve this project directly
    --directory <path>          Directory to match (default: current working directory)
  Returns:
    Project JSON with projectId, projectName, resourceId, resourcePath, isPrimary,
    and additive linkedProjects (every project this checkout is linked to).
    When the checkout is linked to more than one project, projectId is the
    isPrimary entry — the project that most recently set this resource as primary.

create-project:
  Purpose:
    Create a project through the parentless Protocol surface. Unlike the top-level
    \`${primaryCommand} create-project\` convenience command, this does not link a local directory.
  Required:
    --name <text>               Project name
  Optional:
    --workspace-id <id|slug|name>
                                Workspace to create it in
    --description <text>        Project description
    --slug <text>               Explicit project slug
  Returns:
    { status: "created", project, workspace }, or workspace_selection_required
    with the authorized choices when --workspace-id is needed.

register-target:
  Purpose:
    Register or reuse this CLI machine as an execution target in one authorized
    workspace. The CLI supplies its device identity in request headers.
  Optional:
    --workspace-id <id|slug|name>
                                Workspace to register it in
    --name <text>               Execution-target label
  Returns:
    { status: "registered", executionTarget, workspace }, or
    workspace_selection_required with the authorized choices.

attach:
  Purpose:
    Create the working session for an agent on an existing mission. Call this first.
  Required:
    --mission-id <id>            Display id (e.g. coo:8) or UUID. May be omitted when
                                 --objective-id is a display id such as coo:756.k7xm.
  Optional:
    --session-key <key>         Reuse an existing session key
    --agent <identifier>
    --model <identifier>
    --execution-request-id <id> Link this attach to a runner execution request
    --objective-id <id>         Pin attach to this objective (UUID or coo:756.k7xm)
    --external-session-id <id>  Native agent thread/session id for resume
  Returns:
    Full JSON including session.sessionKey, mission, history, artifacts, sharedState,
    and agentInstructions with required workflow instructions and structured-field pointers.

connect:
  Purpose:
    Create a lightweight session when you only need a session key, not full context.
  Required:
    --mission-id <id>            Or --objective-id with a display id
  Optional:
    --objective-id <id>         Pin the session to this objective
    --agent <identifier>
    --external-session-id <id>
  Returns:
    Session JSON, SESSION_KEY on stderr, and the pinned objectiveDisplayId.

load-context:
  Purpose:
    Read mission details without creating a session.
  Required:
    --mission-id <id>            Or --objective-id with a display id
  Optional:
    --objective-id <id>         Return this objective as the current one instead of
                                rediscovering the mission's active objective. Required
                                on a mission running objectives in parallel.

list-deliveries:
  Purpose:
    Read one mission's newest-first normalized delivery records without exposing
    arbitrary stored payload JSON.
  Required:
    --mission-id <id>            Or --objective-id with a display id
  Optional:
    --objective-id <id>         Supplies mission addressing when it is a display id
  Returns:
    DeliveryDto[] including summary, verification, follow-up notes, and normalized
    delivery report evidence.

launch-objective:
  Purpose:
    Queue the normal execution request for one objective. This does not attach the
    calling agent; a runner or eligible execution target performs the requested launch.
  Required:
    --objective-id <id>         Objective UUID or display id
    --agent <identifier>
  Optional:
    --model <identifier>
    --reasoning-effort <value>
    --execution-target-id <id>
  Returns:
    The queued or already-active ExecutionRequestDto. Existing launchability,
    authorization, target resolution, sibling, and idempotency rules apply.

reorder-future-objectives:
  Purpose:
    Change the order of one mission's future objectives without moving draft,
    active, or complete objectives.
  Required:
    --mission-id <uuid>
    --ordered-objective-ids-json <json>
  Returns:
    The mission's full ObjectiveDto[] list in its new order.
  Rules:
    Supply every future objective UUID in the complete desired top-to-bottom order.
    Duplicate, missing, and non-future objective ids are rejected.

run-queue:
  Purpose:
    Read every live Run Queue in one project, including queued, held, and running entries.
  Optional:
    --project-id <id|slug|name> Project UUID, slug, or name
    --objective-id <id>          Derive the project from this objective
    --mission-id <id>            Derive the project from this mission
    --queue <id|name>            Return only this queue by UUID or unambiguous name
  Returns:
    ProjectRunQueuesDto JSON. This reads sequencing state; it does not launch work.
  Rules:
    Supply --project-id, --objective-id, or --mission-id. When --project-id and
    --objective-id are both supplied, they must name the same project.

reorder-run-queue:
  Purpose:
    Atomically replace one Run Queue's complete entry order without selecting an
    execution target.
  Required:
    --queue <id|name>             Queue UUID or unambiguous name
    --ordered-entries-json <json> Complete top-to-bottom entry order
  Optional:
    --ordered-entries-file <path|->
                                  Read the JSON order from a file or stdin
    --project-id <id|slug|name>   Project UUID, slug, or name
    --objective-id <id>           Derive the project from this objective
    --mission-id <id>             Derive the project from this mission
  Returns:
    The reordered RunQueueDto.
  Rules:
    Each item may be an entry UUID, objective UUID, or objective display id.
    Supply every live entry exactly once. Running and dispatched entries cannot
    move. A rejected order returns currentOrder and runningEntryId so callers can
    re-read the queue and retry.

create-run-queue:
  Purpose:
    Create an additional Run Queue alongside the project's default queue.
  Required:
    --project-id <id|slug|name> Project UUID, slug, or name
    --name <text>               Name for the new queue
  Optional:
    --objective-id <id>         Derive the project from this objective
    --mission-id <id>           Derive the project from this mission
  Returns:
    The created RunQueueDto, unpaused and positioned after the existing queues.
  Rules:
    Queue definitions are project configuration and require the project:update
    permission, so a mission_lifecycle-scoped agent token cannot run this. Entry
    operations (queue-objective, dequeue-objective, reorder-run-queue) are
    unaffected.

update-run-queue:
  Purpose:
    Rename one Run Queue, or pause and resume its dispatching.
  Required:
    --queue <id|name>           Queue UUID or unambiguous name
  Optional:
    --project-id <id|slug|name> Project UUID, slug, or name
    --objective-id <id>         Derive the project from this objective
    --mission-id <id>           Derive the project from this mission
    --name <text>               New queue name
    --pause                     Stop dispatching from this queue
    --resume                    Resume dispatching from this queue
  Returns:
    The updated RunQueueDto.
  Rules:
    --pause and --resume are mutually exclusive. Supplying neither a --name nor a
    pause state is rejected rather than silently succeeding. Requires
    project:update, so a mission_lifecycle-scoped agent token cannot run this.

delete-run-queue:
  Purpose:
    Delete one Run Queue, optionally relocating the entries it still holds.
  Required:
    --queue <id|name>           Queue UUID or unambiguous name
  Optional:
    --project-id <id|slug|name> Project UUID, slug, or name
    --objective-id <id>         Derive the project from this objective
    --mission-id <id>           Derive the project from this mission
    --move-entries-to <id|name> Destination queue for the entries being displaced
  Returns:
    { removed, projectId }.
  Rules:
    The default queue cannot be deleted, and a non-empty queue requires
    --move-entries-to. Requires project:update, so a mission_lifecycle-scoped
    agent token cannot run this.

reorder-project-run-queues:
  Purpose:
    Reorder the project's Run Queue definitions without touching entry
    membership or entry order.
  Required:
    --project-id <id|slug|name> Project UUID, slug, or name
    --ordered-queues-json <json> Complete top-to-bottom queue order
  Optional:
    --ordered-queues-file <path|->
                                Read the JSON order from a file or stdin
    --objective-id <id>         Derive the project from this objective
    --mission-id <id>           Derive the project from this mission
  Returns:
    ProjectRunQueuesDto in its new order.
  Rules:
    Each item may be a queue UUID or an unambiguous queue name. Supply every live
    queue exactly once, and keep the default queue first. Requires
    project:update, so a mission_lifecycle-scoped agent token cannot run this.

queue-objective:
  Purpose:
    Add or move one objective in the authoritative Run Queue without choosing a target.
  Required:
    --objective-id <id>         Objective UUID or display id
  Optional:
    --project-id <id|slug|name> Confirms the objective's project
    --queue <id|name>           Queue UUID or unambiguous queue name
    --after <entry|objective>   Queue after this queued entry/objective
    --front                     Place first in the selected/default queue
    --position <n>              One-based insertion rank
  Rules:
    Choose at most one of --after, --front, and --position. Without --queue,
    --after selects its queue; otherwise the default queue is used. Re-running
    without placement is idempotent.

dequeue-objective:
  Purpose:
    Remove one objective from the authoritative Run Queue.
  Required:
    --objective-id <id>         Objective UUID or display id
  Optional:
    --project-id <id|slug|name> Confirms the objective's project
  Returns:
    { removed, objectiveId }. Already-unqueued objectives return removed: false.

retry-queue-entry:
  Purpose:
    Retry one held Run Queue entry: clears its hold and resets the attempt
    budget so the dispatcher tries it again on the next tick.
  Required (one of):
    --objective-id <id>         Objective UUID or display id with a live entry
    --entry <id>                Entry UUID, objective UUID, or display id
  Optional:
    --project-id <id|slug|name> Confirms the entry's project
  Returns:
    The RunQueueEntryDto, back in waiting with attempt_count reset to 0.
  Rules:
    An entry already dispatched or running cannot be retried — remove it with
    \`dequeue-objective\` (or a forced entry delete) first.

search:
  Purpose:
    Find grouped mission, objective, and delivery matches by keyword, status type, or project.
  Optional:
    --query <text>              Free-text search
    --status <csv>              Comma-separated status TYPES (e.g. execute,review).
                                Types are workspace-invariant: draft, next, execute, review,
                                complete, blocked, cancelled. Project-defined status
                                names (board column labels) are not accepted here —
                                use \`statuses\` to read one project's names.
    --project-id <id|slug|name> Restrict to one project. Names are matched
                                case-insensitively across the workspaces you can reach;
                                a name matching in two workspaces returns
                                project_selection_required listing the candidates.
    --workspace-id <id|slug|name>
                                Narrow an ambiguous --project-id
    --resource-key <csv>        Restrict to logical resource key names
    --date-field <createdAt|updatedAt|dueDatetime>
                                Date column for explicit range filtering. Use dueDatetime
                                for "scheduled"/"due" questions; missions with no due date
                                are excluded from a dueDatetime range.
    --from <ISO-8601>           Inclusive date/time lower bound
    --to <ISO-8601>             Exclusive date/time upper bound
    --limit <n>                 Max results (default: 25)
    --response-version <1|2|3>  1 (default) returns the legacy array; 2 returns
                                SearchMissionsResponseV2 with snippets, match
                                evidence, appliedFilters, and truncation counts;
                                3 returns SearchResponseV3 with grouped objective
                                and delivery matches
    --entity-types <csv>        V3 only: mission,objective,delivery (default all)
    --objective-states <csv>    V3 only: restrict matching objective states
    --matches-per-result <n>    V3 only: child matches per mission (default 3, max 10)
  Returns:
    JSON with matching missions (v1) or the versioned search envelope (v2/v3).

statuses:
  Purpose:
    List one project's board columns. Statuses are defined per project, so their
    names and order vary between projects in the same workspace; the status TYPE
    of each column does not.
  Required:
    --project-id <id>           Project id, slug, or name
  Returns:
    JSON array of statuses ordered by position, each with id, projectId, key,
    name, type, position, isDefault, and isTerminal.

discuss-objective:
  Purpose:
    Mark the latest draft objective as submitted. Does not start execution — use attach.
  Required:
    --mission-id <id>
  Optional:
    --objective-id <id>         Submit this draft instead of the first one found. Must
                                belong to the mission and be in draft state. Never
                                inherited from OVERLORD_OBJECTIVE_ID, which points at
                                the objective already executing.

add-objectives:
  Purpose:
    Append ordered objectives to an existing mission.
  Required:
    --mission-id <id>
    --objectives-json <json> or --objectives-file <path|->
  Optional:
    --auto-advance / --no-auto-advance
        Default auto-advance for items that omit "autoAdvance". Defaults to off.
  Notes:
    Each item is { "objective": "...", "title": "...", "agent": "codex",
    "model": "gpt-5.6-terra", "autoAdvance": true|false, "resourceKey": "..." }.
    model requires agent. Per-item autoAdvance wins over the flag.

update-objective:
  Purpose:
    Queue or dequeue compatibility auto-advance and/or edit instruction text on an existing objective.
  Required:
    --objective-id <id>
    At least one of:
      --auto-advance or --no-auto-advance
      --instruction-text <text> or --instruction-text-file <path|->
  Rules:
    Instruction text may be edited only when the objective is in draft or future state.
    Blank instruction text is allowed in those states.
  Returns:
    The updated objective JSON. autoAdvance is deprecated and derived from live queueEntry membership.

delete-missions:
  Purpose:
    Soft-delete one to 100 missions atomically.
  Required:
    --mission-ids-json <json> or --mission-ids-file <path|->
    --confirm
  Rules:
    Before passing --confirm, show every resolved target to the user and obtain
    their affirmative response. Each item may be a mission UUID or display id.
    Any duplicate, missing, deleted, or unauthorized mission rejects the entire
    request; mission deletion also soft-deletes live child objectives.
  Returns:
    { "deletedMissionIds": ["…"] }

delete-objectives:
  Purpose:
    Soft-delete one to 100 objectives atomically.
  Required:
    --objective-ids-json <json> or --objective-ids-file <path|->
    --confirm
  Rules:
    Before passing --confirm, show every resolved target to the user and obtain
    their affirmative response. Each item may be an objective UUID or display id.
    Any duplicate, missing, deleted, or unauthorized objective rejects the entire
    request; deletion also removes live Run Queue membership.
  Returns:
    { "deletedObjectiveIds": ["…"] }

create:
  Purpose:
    Create a draft mission without attaching. Without --project-id and
    without a resolvable working-directory project, falls back to an
    account-owned inbox item instead of failing.
  Required:
    --objective "<text>" or --objectives-json / --objectives-file <path|->
  Optional:
    --title <text>
    --project-id <id>           Skips working-directory project resolution
    --inbox                     Force an account-owned inbox item instead of a project mission
    --assigned-to <id>          Workspace member to own the mission (meaningless on the inbox fallback)
    --auto-advance / --no-auto-advance
        Add matching objectives to the authoritative Run Queue. Defaults to off.
        Per-item override: "autoAdvance": true|false in --objectives-json items.

prompt:
  Purpose:
    Create a mission and attach to it in one call.
  Required:
    --objective "<text>" or --objectives-json / --objectives-file <path|->
  Optional:
    --title <text>
    --project-id <id>
    --agent <identifier>
    --model <identifier>
    --external-session-id <id>
    --assigned-to <id>          Workspace member to own the mission
    --auto-advance / --no-auto-advance
        Add matching objectives to the authoritative Run Queue. Defaults to off.
        Per-item override: "autoAdvance": true|false in --objectives-json items.
  Returns:
    New mission/session JSON plus SESSION_KEY on stderr when available.

record-work:
  Purpose:
    Record work already completed in chat as a completed mission in review, in one
    call — no attach/deliver cycle. Creates a mission with a single completed
    objective, records the file changes and their rationales, lands it in the review
    column, and runs the delivery through the standard Gemini summarizer so it reads
    like any other delivered mission. Use instead of create + attach + deliver.
  Required:
    --objective "<text>" (or positional, or an "objective" field in --payload-json)
    --summary or --summary-file <path|->
  Optional:
    --title <text>
    --project-id <id>
    --assigned-to <id>          Workspace member to own the mission
    --artifacts-json / --artifacts-file <path|->
    --change-rationales-json / --change-rationales-file <path|->
    --changed-files-json / --changed-files-file <path|->
    --payload-json / --payload-file <path|->   (single envelope; see Notes)
  Notes:
    Efficient form: stream one JSON object on stdin via \`--payload-file -\` carrying
    { objective, summary, title?, changeRationales, changedFiles?, artifacts? }.
    Explicit flags always win over fields inside --payload-json.
    Change-rationale entries use the same shape documented under \`deliver\`
    (filePath, label, summary, why, impact; summary is named "summary", not "rationale").
    Every rationale's filePath is recorded as a changed file (shown "covered" in
    review); add --changed-files-json for touched files without a rationale. The
    full submission format lives in reference/record-work.md.

update:
  Purpose:
    Post progress or activity events during execution.
  Required:
    --session-key <key>
    --mission-id <id>
    --summary or --summary-file <path|->
  Optional:
    --phase draft | execute | review | deliver | complete | blocked | cancelled
    --event-type update | user_follow_up | alert | discussion_summary | decision
    --begin-follow-up-work      Reopen a delivered/review mission for execution
    --follow-up-intent discussion | execution | pending_delivery
    --payload-json / --payload-file <path|->
    --external-url <url|null>
    --external-session-id <id|null>
    --change-rationales-json / --change-rationales-file <path|->
  Notes:
    Pass --summary-file - to read the summary from stdin and avoid shell quoting issues.
    Inline --*-json values larger than ~8 KB are rejected; use the paired --*-file - flag.
    After delivery, pass --begin-follow-up-work before posting execution updates.
    Change-rationale entries use the same shape documented under \`deliver\`
    (filePath, label, summary, why, impact; summary is named "summary", not "rationale").

heartbeat:
  Purpose:
    Send a liveness ping without creating a mission event.
  Required:
    --session-key <key>
    --mission-id <id>
  Optional:
    --phase <phase>
    --note <text>

ask:
  Purpose:
    Raise a blocking question for a human reviewer. Stop work after ask succeeds.
  Required:
    --session-key <key>
    --mission-id <id>
    --question or --question-file <path|->
  Optional:
    --options-json <json> / --options-file <path|->
    --no-free-text (requires options; creates a structured choice)
    --json

deliver:
  Purpose:
    Conclude the session and submit the final narrative plus artifacts/change rationales.
  Required:
    --session-key <key>
    --mission-id <id>
    --summary or --summary-file <path|->
    or: --payload-json / --payload-file <path|-> with { summary, artifacts, changeRationales }
    The payload may also include deliveryReport: { schemaVersion: 1, agentReport: {
      humanActions, tradeoffsMade, knownRisks, deferredWork, assumptions } }. Use empty arrays
    when none apply. Human actions exclude Git operations and routine review/testing.
  Optional:
    --artifacts-json / --artifacts-file <path|->
    --change-rationales-json / --change-rationales-file <path|->
    --verification-summary <text>
    --follow-up-notes <text>
  Change-rationale entry shape (each item in --change-rationales-json / -file):
    {
      "filePath":  "src/api.ts",   // required repo-relative path.
      "label":     "Add retry",     // required. short reviewer-facing title.
      "summary":   "Added retry.",  // required. WHAT changed. The field is named "summary", NOT "rationale".
      "why":       "Flaky calls.",  // required. WHY it changed.
      "impact":    "Retries 3x.",   // required. behavioral impact.
      "hunks":     [{ "header": "@@ -10,6 +10,14 @@" }]  // optional.
    }
    Pass an array of these. Do NOT wrap entries under a "rationale" key and do not send a
    top-level "file_changes" artifact. label/summary/why/impact must be non-empty strings.
  Notes:
    A normal delivery requires only --summary. The CLI syncs objective-bound ledger
    evidence automatically before update, changes, and deliver. Optional rationales,
    hook health, and path attribution cannot fail delivery. Do not continue implementation
    after delivery without explicit follow-up.

    --paths <a,b,c> is optional, metadata-only evidence for outputs of a generator,
    migration, or script. It is batched into this existing call, never inspects VCS,
    and is not an instruction to list every changed or opened file.
    Inline --*-json values larger than ~8 KB are rejected; use --change-rationales-file -
    (or --payload-file -) and stream JSON on stdin. Keep --summary inline.
    Run \`${primaryCommand} protocol changes --objective-id <id>\` to inspect the attached
    objective ledger and retry any advisory sync. It never claims or excludes another
    objective's paths.

capture-change:
  Purpose:
    Normalize one raw native callback with the named connector codec and append only
    declared Write/Edit paths to the exact objective/session ledger. The raw payload
    remains local and input is bounded to 1 MiB.
  Required:
    --agent <connector-key>
    --objective-id <id>
    native callback JSON on stdin
  Notes:
    Read/search/fetch callbacks are silent. Shell, unknown, unmapped, and pathless
    mutation callbacks record bounded unavailable health without claiming a path.

changes:
  Purpose:
    Sync and inspect the attached objective's local ledger. Reports whether evidence
    remains unsynced, but never scans the shared worktree, claims peer paths, or drafts
    rationale/skip payloads. Sync failure is advisory.
  Required:
    --objective-id <id>
  Optional:
    --mission-id <id>           Required when objective id does not encode mission scope
    --session-key <key>         Validate one exact binding; every matching live/retry ledger drains

sync-changes:
  Purpose:
    Retry synchronization of bounded metadata-only evidence from the local
    objective ledger. Normal update, changes, and deliver calls synchronize this
    evidence automatically, so use this command only for diagnostics or recovery.
  Required:
    --session-key <key>         Must identify an attached objective session in this checkout
  Optional:
    --mission-id <id>           Mission UUID or display id
    --objective-id <id>         Objective UUID or display id
    --changes-json <json> or --changes-file <path|->
                                Explicit evidence batch; normally omitted so the CLI drains its ledger
  Returns:
    Per-item accepted, ignored, or warning results. Synchronization failures are
    advisory and never block update or delivery.

resume-follow-up:
  Purpose:
    Reopen a completed objective for post-delivery implementation follow-up.
  Required:
    --mission-id <id>
  Optional:
    --objective-id <id>
    --agent <identifier>
    --model <identifier>
    --summary or --summary-file <path|->
    --external-session-id <id>
  Returns:
    attach-response-v3 JSON with a new session key.

hook-event:
  Purpose:
    Record a connector lifecycle hook without requiring a live session key.
  Required:
    --hook-type UserPromptSubmit
    --mission-id <id>
  Optional:
    --prompt or --prompt-file <path|->
    --session-key <key>
    --external-session-id <id>
    --turn-index <n>

read-context:
  Purpose:
    Read persistent shared context written by earlier sessions.
  Required:
    --mission-id <id>
  Optional:
    --key <substring>           Filter by key substring
    --limit <n>                 Max entries (default: 50)

write-context:
  Purpose:
    Save shared facts for future sessions.
  Required:
    --mission-id <id>
    --key <name>
    --value <text> or --value-json / --value-file <path|->

update-artifact:
  Purpose:
    Update an existing mission artifact's label, Markdown content, and/or URL in
    place (same rules as PATCH /api/missions/:id/artifacts/:artifactId). Use this
    when a later objective or follow-up must revise an artifact created earlier,
    instead of delivering a duplicate. No session key is required.
  Required:
    --mission-id <id>
    --artifact-id <id>
    --expected-revision <n>     Current artifact.revision (409 if stale)
  Optional (at least one required):
    --label <text>
    --content-text <text> or --content-text-file <path|->
    --external-url <url>        Empty string clears the URL
  Returns:
    Updated ArtifactDto JSON (includes the new revision).

add-artifact:
  Purpose:
    Create a mission artifact during a turn without delivering (same rules as
    POST /api/missions/:id/artifacts). Use this to publish a plan, notes, URL,
    or similar record mid-session; revise later with update-artifact. Delivery
    may still attach additional artifacts. Optional --session-key (auto-injected
    from the attach cache when present) stamps session/objective provenance.
  Required:
    --mission-id <id>
    --type <type>               test_results | next_steps | note | url | decision | migration
    --label <text>
  Content (at least one required):
    --content-text <text> or --content-text-file <path|->
    --external-url <url>
  Optional:
    --session-key <key>
    --objective-id <id>         Stamp objective provenance with no live session key.
                                --session-key wins when both are present.
  Returns:
    Created ArtifactDto JSON (revision 1).

attachment-list:
  Purpose:
    List attachments for the mission (across all objectives, or one objective
    with --objective-id).
    Each entry includes id, filename, mimeType, sizeBytes, status, storageKey, and url.
    The url field is a server-relative path; prepend the backend base URL to download.
  Required:
    --mission-id <id>
  Optional:
    --objective-id <id>         Restrict the listing to one objective

attachment-download-url:
  Purpose:
    Return the download URL for a specific attachment on the mission.
  Required:
    --mission-id <id>
    --attachment-id <id>  (use the id from attachment-list output)
  Optional:
    --objective-id <id>         Restrict the lookup to one objective

list-organizations:
  Purpose:
    Legacy name predating the real organizations hierarchy (coo:135) — despite the
    name, returns only the caller's current *workspace* context, not organization
    data. Kept as-is to avoid a breaking protocol rename.
  Returns:
    JSON array with a single { id, slug, name } entry for the active workspace.

Supported subcommands: ${subcommands}
Run \`${primaryCommand} help\` for management commands and \`${primaryCommand} protocol help\` for this reference.
`;

  if (!subcommand) {
    console.log(fullHelp);
    return;
  }

  const canonical = PROTOCOL_HELP_ALIASES[subcommand] ?? subcommand;
  const marker = `\n${canonical}:\n`;
  const sectionStart = fullHelp.indexOf(marker);
  if (sectionStart === -1) {
    throw new Error(`Protocol help is missing documentation for ${subcommand}.`);
  }
  const contentStart = sectionStart + 1;
  const remaining = fullHelp.slice(contentStart);
  const nextSection = remaining.slice(marker.length - 1).search(/\n[a-z][a-z-]+:\n/);
  const sectionEnd =
    nextSection === -1
      ? remaining.indexOf('\nSupported subcommands:')
      : marker.length - 1 + nextSection;
  const section = (sectionEnd === -1 ? remaining : remaining.slice(0, sectionEnd)).trimEnd();
  const aliasNote = canonical === subcommand ? '' : `Alias for \`${canonical}\`.\n\n`;

  console.log(`${primaryCommand} protocol ${subcommand}\n\n${aliasNote}${section}`);
}
