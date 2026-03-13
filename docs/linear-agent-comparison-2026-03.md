# Linear AI Agent Features vs. Overlord: Competitive Analysis

**Date:** March 12, 2026
**Ticket:** ee570ced-5912-464b-af05-523cb757e935
**Sources:** [Linear Changelog (Mar 12, 2026)](https://linear.app/changelog/2026-03-12-ui-refresh), [Linear Docs: Agents in Linear](https://linear.app/docs/agents-in-linear), [Linear Developer Docs](https://linear.app/developers/agents)

---

## 1. Linear's AI Agent Features (March 2026)

### 1.1 Agents as First-Class Users

Linear treats agents as full workspace members with complete profiles. Agents can be:

- **@mentioned** in comments, just like human teammates
- **Assigned to teams and projects** by workspace admins
- **Listed in member directories** so users can see what they're working on
- **Not billed as seats** — agents don't count toward workspace licensing costs

Each agent has a visible identity in the workspace, making agent activity transparent and auditable by the entire team.

### 1.2 Delegation Model (Human Ownership Preserved)

Linear's core agent workflow is built around **delegation**, not assignment transfer:

- Assigning an issue to an agent sets the agent as a **delegate**, not the primary assignee
- The **human remains responsible** and the issue continues to appear in their "My Issues" view
- Users can see delegated work clearly distinguished from self-assigned work
- This preserves human accountability while enabling AI assistance

### 1.3 Agent Sessions — Lifecycle Abstraction

The `AgentSession` is Linear's central abstraction for tracking agent work:


| State           | Meaning                                   |
| --------------- | ----------------------------------------- |
| `pending`       | Session created, not yet started          |
| `active`        | Agent is actively working                 |
| `error`         | Agent encountered an error                |
| `awaitingInput` | Agent is blocked, waiting for human input |
| `complete`      | Work finished                             |


Key session features:

- Sessions are created automatically on **delegation or @mention**
- State transitions happen automatically based on agent activity emissions
- Agents can set `externalUrls` to link sessions to their own dashboards
- **Thought items render as full rich text** in the session sheet (not truncated)
- **Mobile app support**: users can view reasoning and send steering messages from iOS/Android

### 1.4 `promptContext` — Auto-Assembled Agent Context

When an `AgentSessionEvent` webhook fires, it includes a `promptContext` field: a pre-formatted string containing:

- Full issue description and metadata
- Comments thread
- **Workspace and team-level guidance** (automatically injected)
- Related context from linked issues

This means agents receive a single, ready-to-use context block — no custom assembly required.

### 1.5 Structured Agent Guidance System

Linear provides **two levels of standing instructions** for agents:

- **Workspace-level guidance**: applies to all teams, authored in a markdown editor with full revision history
- **Team-level guidance**: team-specific overrides; takes priority over workspace guidance when both exist

Guidance is versioned and editable over time, giving organizations a way to refine agent behavior without changing the agent code.

### 1.6 Webhooks and API Improvements (March 2026)

Recent API additions:

- `**promptContext`** field in `AgentSessionEvent` `"created"` webhooks
- `**issueRepositorySuggestions` query**: confidence-ranked list of repos for an issue/session, using guidance + LLM signals (PR history, linked issues)
- `**save_issue` tool**: combined `create_issue` + `update_issue` into one tool
- `**PermissionChange` webhooks**: fired when workspace admins change agent access
- Full `user` object (not just `userId`) in `AgentActivityWebhookPayload`
- `AgentSession.type` deprecated (to be removed)
- `userId` in `AgentActivityWebhookPayload` is now non-nullable

### 1.7 Deeplink to Coding Tools with Custom Templates

Linear lets users **launch coding agents directly from an issue**:

- One-click launch of Claude Code, Cursor, Codex Desktop, and other tools
- Pre-fills a prompt with issue ID, description, comments, updates, linked references, and images
- **Customizable prompt templates**: workspace admins can define standing instructions (e.g., "always provide a detailed plan before writing code")

### 1.8 Customer Support → Issue Automation

The Linear AI agent can convert support conversations to actionable issues:

- Integrates with **Intercom**, **Zendesk**, and **Gong**
- Single button click converts a support ticket into a Linear issue
- Handles multi-topic threads — parses and files bugs or feature requests intelligently

### 1.9 Linear MCP Server for Product Managers

Linear's MCP server has been extended to cover:

- Initiatives, project milestones, and progress updates
- Allows PMs to manage Linear from tools like Cursor and Claude Code
- Enables agents to keep plans current without switching contexts

### 1.10 Agent Integration Directory

Third-party agents can be:

- **Built for internal use** within a single workspace
- **Published to the Integration Directory** for distribution to the broader Linear community
- Installed by workspace admins without counting as billable seats

---

## 2. Overlord's Current Capabilities

### Strengths


| Feature                          | Overlord                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------- |
| Ticket lifecycle                 | ✅ draft → execute → review → deliver → complete                                  |
| Agent protocol (REST + MCP)      | ✅ attach, update, deliver, ask, spawn, connect, read/write-context               |
| Session tracking                 | ✅ `agent_sessions` with states: attached, idle, blocked, completed, disconnected |
| Permission request notifications | ✅ Electron hook detects agent permission prompts → notifies UI                   |
| Change rationale tracking        | ✅ Structured explanations with file paths and diff hunks                         |
| Artifact management              | ✅ File uploads, storage, deliverable tracking                                    |
| Shared context (multi-agent)     | ✅ `shared_state` table for cross-session context sharing                         |
| Multiple agent types             | ✅ Claude Code, Codex, Cursor, Gemini                                             |
| OAuth 2.1 / device code auth     | ✅ Full OIDC provider for agent authorization                                     |
| Change Explorer (Electron)       | ✅ Browse uncommitted diffs, see which ticket caused each change                  |
| Full-text search                 | ✅ Search vector on tickets                                                       |
| Blocking questions               | ✅ `ask` protocol call pauses agent, waits for human answer                       |


### Current Limitations vs. Linear


| Feature                            | Linear                         | Overlord                      | Gap    |
| ---------------------------------- | ------------------------------ | ----------------------------- | ------ |
| Agent guidance (workspace + team)  | ✅ Markdown, versioned          | ❌ None                        | High   |
| `promptContext` auto-assembly      | ✅ Pre-formatted on webhook     | ❌ Raw markdown only           | High   |
| Explicit `awaitingInput` state     | ✅                              | ⚠️ Uses `blocked` (ambiguous) | Medium |
| Rich thought/reasoning display     | ✅ Rich text in session sheet   | ❌ Flat event log              | Medium |
| Delegation model (human ownership) | ✅ Human stays as owner         | ⚠️ No clear distinction       | Medium |
| `externalUrls` on sessions         | ✅ Link to agent dashboard      | ❌                             | Medium |
| Repo/project suggestions (AI)      | ✅ `issueRepositorySuggestions` | ❌                             | Medium |
| Custom prompt templates            | ✅ Per-workspace                | ❌                             | Medium |
| Mobile session viewer              | ✅ iOS/Android                  | ❌ Electron only               | Low    |
| Customer support integrations      | ✅ Intercom, Zendesk, Gong      | ❌                             | Low    |
| Agent Integration Directory        | ✅                              | ❌                             | Low    |
| Agents as first-class users        | ✅ Full profile, @mention       | ⚠️ Token-based identity       | Low    |


---

## 3. Prioritized Opportunities for Overlord

### Tier 1 — High Impact, Achievable Near-Term

#### OPP-1: Structured Agent Guidance System

**What**: Add workspace-level and project-level guidance as versioned markdown documents. Automatically inject them into the agent context when `attach` is called.

**Why it matters**: Linear's `promptContext` works so well because guidance is co-located with the context. Overlord agents currently rely on the ticket's `context` and `constraints` fields, but there's no standing-instruction layer. This means every ticket has to re-specify common behavioral rules.

**Implementation sketch**:

- New `guidance` table: `organization_id`, `project_id` (nullable), `content` (markdown), `version`, `updated_at`
- `attach` handler injects applicable guidance into the response
- UI: markdown editor at org and project settings level, with edit history

---

#### OPP-2: `promptContext` Auto-Assembly in `attach`

**What**: When `attach` is called, return a pre-formatted `promptContext` string that combines: ticket fields + recent events + guidance + shared state.

**Why it matters**: Currently agents receive raw ticket data as separate JSON fields. They must self-assemble context from `ticket.objective`, `ticket.context`, `ticket.constraints`, etc. A single ready-to-use string reduces boilerplate in every agent system prompt.

**Implementation sketch**:

- `attach` response adds `promptContext: string` field
- Assembled server-side: title, objective, status, constraints, acceptance criteria, recent events, guidance
- Agents use this directly as their context block

---

#### OPP-3: Session State — Add `awaiting_input`

**What**: Add an explicit `awaiting_input` state to `agent_sessions`, distinct from `blocked`.

**Why it matters**: Currently, when an agent calls `ask`, the session shows as `blocked`. But "blocked" is ambiguous — it could mean the agent is stuck on a bug, or it could mean it's waiting for user input. `awaiting_input` makes the state visible and meaningful in the UI.

**Implementation sketch**:

- Migration: add `awaiting_input` to the `session_state` enum
- `ask` handler: transition session to `awaiting_input` instead of `blocked`
- UI: show a distinct icon/color for `awaiting_input` in the Kanban and session views

---

#### OPP-4: Customizable Handoff Prompt Templates

**What**: Let users define per-project or per-organization templates for how tickets are handed off to coding agents (the context markdown that gets passed to Claude/Codex).

**Why it matters**: The agent launcher currently uses a fixed template to assemble context from ticket fields. Customizable templates (with standing instructions like "always run tests before marking complete") would let teams encode their engineering standards once.

**Implementation sketch**:

- `project_agent_templates` table with `template_markdown` (supports `{{ticket.title}}`, `{{ticket.objective}}` interpolation)
- Electron launcher uses project template if present, falls back to default
- Template editor in project settings UI

---

### Tier 2 — Medium Impact

#### OPP-5: Rich Thought/Reasoning Display in Session View

**What**: Surface agent reasoning (from `update` calls) as rich text in a dedicated session panel, not just as flat event log entries.

**Why it matters**: When agents submit `update` events with a summary, it's currently shown as a raw text entry in the event log. A dedicated "session sheet" with rich text rendering (like Linear's) would make agent reasoning legible and scannable.

**Implementation sketch**:

- New UI component: `SessionSheet` that renders `update` events as formatted markdown
- Distinguish `thought` updates (reasoning) from `change` updates (code changes)
- Show in ticket detail view alongside the event timeline

---

#### OPP-6: Session External URL

**What**: Allow agents to set a URL on their session that links to their own dashboard (e.g., a Claude Code web session, a Cursor session link).

**Why it matters**: Agents may have their own UI for tracking work. Surfacing an `externalUrl` in Overlord lets users jump directly to the agent's interface when they want deeper visibility.

**Implementation sketch**:

- Add `external_url` column to `agent_sessions`
- `update` protocol call accepts optional `externalUrl` field
- Shown as a "View in [Agent]" button in session UI

---

#### OPP-7: Delegation Model Clarity

**What**: Add UI distinction between "delegated to agent" and "assigned to human". Show delegated tickets in a separate section or with a visual indicator.

**Why it matters**: Currently there's no UX difference between a ticket an agent is working on and one a human is working on. Linear's model — where humans retain ownership of delegated work — is more transparent and accountability-preserving.

**Implementation sketch**:

- `execution_target` field already exists (`agent` | `human`)
- Update Kanban and ticket list to show visual distinction (icon, color, section grouping)
- "Delegated" label when `execution_target = 'agent'` and session is `attached`/`active`

---

#### OPP-8: Repo/Project Suggestions for Tickets

**What**: Given a ticket's title and objective, suggest which linked local projects/repos the agent should focus on.

**Why it matters**: As teams manage multiple repos, agents currently must guess or be told which project to work in. An `issueRepositorySuggestions`-equivalent would use ticket content + past patterns to rank projects by relevance.

**Implementation sketch**:

- Analyze linked projects' recent change_rationale history for keyword overlap with new ticket
- Return ranked suggestions in `attach` response as `suggestedProjects: [{projectId, confidence, reason}]`
- Initially heuristic (keyword match); can add LLM ranking later

---

### Tier 3 — Longer-Term Investment

#### OPP-9: Mobile Session Viewer (PWA)

**What**: A mobile-friendly PWA view for monitoring and steering agent sessions.

**Why it matters**: Linear now offers native mobile session tracking. Overlord's Electron-first approach works for desktop but leaves mobile users without visibility into running agents.

**Implementation sketch**:

- Leverage existing PWA config (already in place)
- Mobile-optimized ticket detail and session event stream views
- Push notifications for `ask` (blocking questions) and `deliver` events

---

#### OPP-10: Customer Support Integration

**What**: Connect Intercom or Zendesk to auto-create Overlord tickets from support conversations.

**Why it matters**: Linear is using AI to bridge the gap between customer feedback and engineering work. Overlord could offer a similar bridge — letting support agents or automation create development tickets from customer conversations.

**Implementation sketch**:

- Webhook receiver edge function for Intercom/Zendesk events
- AI summarization of conversation → ticket `objective` and `context`
- UI for reviewing and approving auto-created tickets before they enter the queue

---

## 4. Summary Table


| Priority | Opportunity                           | Effort | Impact     |
| -------- | ------------------------------------- | ------ | ---------- |
| 1        | OPP-1: Structured Agent Guidance      | Medium | Very High  |
| 2        | OPP-2: `promptContext` Auto-Assembly  | Low    | High       |
| 3        | OPP-3: `awaiting_input` Session State | Low    | Medium     |
| 4        | OPP-4: Customizable Handoff Templates | Medium | High       |
| 5        | OPP-5: Rich Thought/Reasoning Display | Medium | Medium     |
| 6        | OPP-6: Session External URL           | Low    | Medium     |
| 7        | OPP-7: Delegation Model Clarity       | Low    | Medium     |
| 8        | OPP-8: Repo/Project Suggestions       | Medium | Medium     |
| 9        | OPP-9: Mobile Session Viewer (PWA)    | High   | Medium     |
| 10       | OPP-10: Customer Support Integration  | High   | Low-Medium |


---

## 5. References

- [Linear Changelog — UI refresh (Mar 12, 2026)](https://linear.app/changelog/2026-03-12-ui-refresh)
- [Linear Docs — Agents in Linear](https://linear.app/docs/agents-in-linear)
- [Linear Developers — Getting Started with Agents](https://linear.app/developers/agents)
- [Linear Developers — Agent Interaction](https://linear.app/developers/agent-interaction)
- [Linear Changelog — Deeplink to AI Coding Tools (Feb 26, 2026)](https://linear.app/changelog/2026-02-26-deeplink-to-ai-coding-tools)
- [Linear Changelog — Linear for Agents (May 20, 2025)](https://linear.app/changelog/2025-05-20-linear-for-agents)
- [Why Linear Built an API For Agents — The New Stack](https://thenewstack.io/why-linear-built-an-api-for-agents/)

