---
name: Drift Review
description: Reviews product surface alignment across API routes, CLI commands, MCP tools, and agent plugins to identify drift in functions, parameters, and capabilities.
allowed-tools: Read, Bash, Grep, Glob, Task
user-invocable: true
---

# Drift Review

<drift-review>

Review all Overlord product surfaces for alignment drift. The goal is to ensure that API routes, CLI commands, MCP tools, and agent plugins expose the same operations with matching parameters, so that agents can use any surface interchangeably.

## Product Surfaces

Overlord exposes its protocol through four parallel surfaces:

| Surface | Location | Convention |
|---------|----------|------------|
| **API routes** | `apps/web/app/api/protocol/*/route.ts` | REST endpoints, kebab-case paths |
| **CLI commands** | `packages/overlord-cli/bin/_cli/protocol.mjs` | `ovld protocol <subcommand>`, `--kebab-case` flags |
| **MCP tools** | `plugins/overlord/scripts/overlord-mcp.mjs` | `snake_case` tool names, `snake_case` parameters |
| **Agent plugins** | `plugins/{claude,cursor,overlord}/skills/overlord-ticket/` | Skill instructions referencing CLI/MCP |

## Review Process

### Phase 1: Extract the Surface Maps

Build an inventory of every operation exposed by each surface. For each operation, record:
- **Name** (as it appears in that surface)
- **Parameters** (names, types, required/optional)
- **HTTP method** (API only)
- **Description/purpose**

#### 1. API Routes
Read each `route.ts` under `apps/web/app/api/protocol/`. Extract:
- The route path (e.g., `/api/protocol/attach`)
- Exported HTTP methods (`POST`, `GET`, etc.)
- Expected request body or query parameters (look for destructuring of `await request.json()` or `searchParams`)

#### 2. CLI Commands
Read `packages/overlord-cli/bin/_cli/protocol.mjs`. Extract:
- Each subcommand from the dispatch block (the `if (subcommand === '...')` section)
- The flags each handler function reads via `parseFlags()`
- Any flag aliases or defaults

#### 3. MCP Tools
Read `plugins/overlord/scripts/overlord-mcp.mjs`. Extract:
- Each tool object in the `tools` array and `searchTicketsTool`
- `name`, `inputSchema.properties`, `inputSchema.required`
- The `subcommand` it maps to and the `toCliFlags` mapping

#### 4. Agent Plugin Skills
Read the `overlord-ticket` skill in each plugin directory:
- `plugins/claude/skills/overlord-ticket/SKILL.md`
- `plugins/cursor/skills/overlord-ticket/SKILL.md`
- `plugins/overlord/skills/overlord-ticket/SKILL.md`

Extract which operations and parameters are documented for agents to use.

### Phase 2: Build the Alignment Matrix

Create a matrix comparing operations across all four surfaces:

```
| Operation         | API Route              | CLI Subcommand         | MCP Tool               | Plugin Docs |
|-------------------|------------------------|------------------------|------------------------|-------------|
| Attach            | POST /protocol/attach  | ovld protocol attach   | attach_ticket          | Y / N       |
| Discover Project  | POST /protocol/disc... | ovld protocol disc...  | discover_project       | Y / N       |
| ...               | ...                    | ...                    | ...                    | ...         |
```

### Phase 3: Identify Drift

Check for these categories of drift:

#### 3a. Missing Operations
An operation exists in one surface but not another:
- API route with no corresponding CLI subcommand
- CLI subcommand with no corresponding MCP tool
- MCP tool with no corresponding API route
- Operations not documented in agent plugin skills

#### 3b. Parameter Drift
An operation exists in multiple surfaces but parameters differ:
- **Missing parameters**: A parameter accepted by the API but not exposed in the CLI or MCP tool
- **Extra parameters**: A parameter in one surface that doesn't exist in another
- **Type mismatches**: Different types for the same parameter across surfaces
- **Required vs optional**: A parameter required in one surface but optional in another
- **Naming inconsistencies**: Beyond expected convention differences (kebab-case CLI vs snake_case MCP), check for semantic name mismatches (e.g., `ticket_id` vs `ticketId` vs `id`)

#### 3c. Behavioral Drift
- Different default values for the same parameter across surfaces
- Different validation rules
- Different response shapes for the same operation

#### 3d. Documentation Drift
- Agent plugin skills referencing operations or parameters that no longer exist
- Agent plugin skills missing documentation for operations that do exist
- Inconsistent descriptions of the same operation across surfaces

### Phase 4: Generate the Drift Report

Produce a structured report:

```markdown
# Overlord Surface Drift Report

## Summary
- Surfaces audited: API, CLI, MCP, Agent Plugins
- Total operations found: N
- Fully aligned operations: N
- Operations with drift: N
- Missing operations: N

## Alignment Matrix
[The full matrix from Phase 2]

## Drift Findings

### Critical Drift (missing operations)
[Operations that exist in some surfaces but not others]

### Parameter Drift
[Operations where parameters don't match across surfaces]

### Documentation Drift
[Agent plugin documentation that is out of sync]

### Recommendations
[Specific, actionable fixes ordered by impact]
```

## Naming Convention Reference

When comparing names across surfaces, these are the expected transformations (not drift):

| Concept | API Route Path | CLI Flag | MCP Parameter |
|---------|---------------|----------|---------------|
| Ticket ID | `ticket_id` in body | `--ticket-id` | `ticket_id` |
| Session Key | `session_key` in body | `--session-key` | `session_key` |
| Working Dir | `working_directory` | `--working-directory` | `working_directory` |

Flag any naming that deviates from this pattern.

## Output

Present the drift report directly to the user. Prioritize actionable drift over cosmetic differences. When parameter drift is found, include the specific parameter names and types from each surface so the fix is unambiguous.

If no drift is found, confirm alignment and note the operation count.

</drift-review>

<!-- version: 1.0.0 -->
