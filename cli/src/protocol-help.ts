/** Backend and local-only protocol subcommands exposed by the CLI. */
export const SUPPORTED_PROTOCOL_SUBCOMMANDS = [
  'add-artifact',
  'add-objectives',
  'ask',
  'attach',
  'attachment-download-url',
  'attachment-list',
  'auth-status',
  'changes',
  'connect',
  'create',
  'deliver',
  'discover-project',
  'discuss-objective',
  'heartbeat',
  'hook-event',
  'list-organizations',
  'load-context',
  'prompt',
  'read-context',
  'record-touched',
  'record-work',
  'resume-follow-up',
  'search-missions',
  'update',
  'update-artifact',
  'update-objective',
  'write-context'
] as const;

const DEFAULT_TIMEOUT_MS = 30_000;

export function printProtocolHelp({ primaryCommand }: { primaryCommand: string }): void {
  const subcommands = SUPPORTED_PROTOCOL_SUBCOMMANDS.join(', ');

  console.log(`${primaryCommand} protocol [flags]

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
  list-organizations     Legacy name; returns only the caller's current workspace context (not organizations)
  attach                 Start a mission session and return full working context
  connect                Start a lightweight session without full context assembly
  load-context           Read mission context without creating a session
  search-missions         Find missions by keyword, status, or project
  discuss-objective      Mark a draft objective as submitted (does not start execution)
  add-objectives         Append ordered objectives to an existing mission
  update-objective       Set auto-advance and/or instruction text on an objective
  create                 Create a draft mission without attaching
  prompt                 Create a mission and attach to it immediately
  record-work            Record completed-from-chat work as a review mission (no attach)
  update                 Post progress, activity events, and optional change rationales
  heartbeat              Send a liveness ping without creating a mission event
  ask                    Post a blocking question and move the mission to review
  deliver                Finish work, send artifacts, and move the mission to review
  resume-follow-up       Reopen a completed objective for post-delivery follow-up work
  hook-event             Record a connector lifecycle hook (e.g. UserPromptSubmit)
  record-touched         Local-only: append an edit hook's touched files to the session log
  changes                Local-only: preflight — print classified mine/claimed/unclaimed
                         paths and drafted rationales before delivering; run this instead
                         of hand-triaging \`git status\`
  read-context           Read shared persistent context for this mission
  write-context          Write shared persistent context for future sessions
  add-artifact           Create a mission artifact during a turn (no delivery required)
  update-artifact        Update an existing mission artifact in place
  attachment-list        List all attachments for the mission
  attachment-download-url  Get the download URL for a specific attachment

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
  Notes:
    The client CLI records a VCS baseline at attach so deliver can report the
    run-attributable changed-file delta automatically.

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

search-missions:
  Purpose:
    Find missions by keyword, status type, or project.
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
    --response-version <1|2>    1 (default) returns the legacy array; 2 returns
                                SearchMissionsResponseV2 with snippets, match
                                evidence, appliedFilters, and truncation counts
  Returns:
    JSON with matching missions (v1) or the versioned search envelope (v2).

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
    Each item is { "objective": "...", "title": "...", "autoAdvance": true|false,
    "resourceKey": "..." }. Per-item autoAdvance wins over the flag.

update-objective:
  Purpose:
    Turn auto-advance on or off and/or edit instruction text on an existing objective.
  Required:
    --objective-id <id>
    At least one of:
      --auto-advance or --no-auto-advance
      --instruction-text <text> or --instruction-text-file <path|->
  Rules:
    Instruction text may be edited only when the objective is in draft or future state.
    Blank instruction text is allowed in those states.
  Returns:
    The updated objective JSON, including autoAdvance and instructionText.

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
        Queue the next objective after this one is delivered. Defaults to off.
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
        Queue the next objective after this one is delivered. Defaults to off.
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
    (file_path, label, summary, why, impact; summary is named "summary", not "rationale").
    Every rationale's file_path is recorded as a changed file (shown "covered" in
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
    --changed-files-json / --changed-files-file <path|->
    --change-rationales-json / --change-rationales-file <path|->
  Notes:
    Pass --summary-file - to read the summary from stdin and avoid shell quoting issues.
    Inline --*-json values larger than ~8 KB are rejected; use the paired --*-file - flag.
    After delivery, pass --begin-follow-up-work before posting execution updates.
    Change-rationale entries use the same shape documented under \`deliver\`
    (file_path, label, summary, why, impact; summary is named "summary", not "rationale").

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
    --changed-files-json / --changed-files-file <path|->
    --no-file-changes             Assert this run changed no files
    --skip-rationale-for-json / --skip-rationale-for-file <path|->
    --verification-summary <text>
    --follow-up-notes <text>
  Change-rationale entry shape (each item in --change-rationales-json / -file):
    {
      "file_path": "src/api.ts",   // required. repo-relative path. "filePath" also accepted; no "path" field.
      "label":     "Add retry",     // required. short reviewer-facing title.
      "summary":   "Added retry.",  // required. WHAT changed. The field is named "summary", NOT "rationale".
      "why":       "Flaky calls.",  // required. WHY it changed.
      "impact":    "Retries 3x.",   // required. behavioral impact.
      "hunks":     [{ "header": "@@ -10,6 +10,14 @@" }]  // optional.
    }
    Pass an array of these. Do NOT wrap entries under a "rationale" key and do not send a
    top-level "file_changes" artifact. label/summary/why/impact must be non-empty strings.
  Skip-rationale-for entry shape (each item in --skip-rationale-for-json / -file):
    {
      "file_path": "webapp/package.json",  // required. repo-relative path. "filePath" also accepted.
      "reason":    "Concurrent host-side edit; not made by this mission."
    }
    Use when deliver would fail missing_rationale for a file you did not change. Do not
    fabricate a change rationale and do not revert the file.
  Notes:
    Changed files are captured mechanically: the CLI records a VCS baseline at attach
    and injects the run-attributable delta at deliver. Meaningful tracked changes
    require rationales unless --no-file-changes is passed or the file is listed in
    --skip-rationale-for-*. Do not continue
    implementation after delivery without explicit follow-up.
    Inline --*-json values larger than ~8 KB are rejected; use --change-rationales-file -
    (or --payload-file -) and stream JSON on stdin. Keep --summary inline.
    Run \`${primaryCommand} protocol changes --mission-id <id>\` first instead of hand-
    triaging \`git status\` — it prints the same mine/claimed/unclaimed classification
    deliver uses, plus drafted rationales. If deliver still rejects with
    missing_rationale, the error includes a per-path classification and a ready-to-use
    --skip-rationale-for-json value for every non-'mine' path — one mechanical retry.

changes:
  Purpose:
    Local-only preflight: print every currently dirty path classified as 'mine'
    (confirmed by this session's touched-files log), 'claimed' (confirmed by another
    active session's log), or 'unclaimed' (dirty, but confirmed by nobody), plus
    draft rationales from local edit notes and ready-to-use --skip-rationale-for-json
    entries for 'claimed' paths. Makes no backend call; safe to run at any time.
  Required:
    --mission-id <id>

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
`);
}
