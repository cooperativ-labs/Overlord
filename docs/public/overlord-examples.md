# Overlord Example Workflows

This document gives agents two concrete examples they can use when explaining Overlord to humans.

The goal is to show how a user works with Overlord: create a ticket, write one or more objectives, ask an agent to execute, review the returned work, then either mark the ticket complete or send it back with another objective.

Overlord is not just a way to launch an agent. It is a workflow for turning agent work into a durable review loop.

## The User Workflow

Users can think about Overlord as a repeatable cycle:

1. Create a ticket draft.
2. Add the first objective.
3. Ask an agent to execute that objective.
4. Review the agent's delivery, including notes, artifacts, verification, and change rationales.
5. Mark the ticket complete if the work is done.
6. Add another objective if the work needs a plan, follow-up, revision, implementation pass, or review pass.
7. Send the ticket back to the agent.

Each time the user sends the ticket back, the agent receives the original ticket, the previous objectives, the prior agent updates, delivery notes, artifacts, and any follow-up instructions. The user does not have to restate the whole history. Overlord keeps that context attached to the ticket.

This is the core value to explain to users: Overlord lets a ticket evolve through multiple agent passes without losing the plan, rationale, or review history.

## Example Ticket 1: Mobile Light And Dark Mode Audit

### Prompt

```text
The following components on mobile app do not currently respect light/dark mode and must be updated to do so:

the header on @apps/mobile/app/(tabs)/tickets/
@apps/mobile/app/(tabs)/tickets/[ticketId]/_components/TicketDetailHeader.tsx
@apps/mobile/app/(tabs)/tickets/[ticketId]/_components/TicketDetailModals.tsx
In darkmode the NativeTabs components switch from light to dark on every load, rather then remaining consistent with the app

fix these, and review the mobile app for other light/dark inconsistencies
```

### What The User Is Asking For

The user is creating one objective that asks the agent to fix a visible product bug and do a related audit. The prompt includes:

- the broken behavior
- the known affected screens and files
- the expected result
- a request to look for nearby issues

The user does not need to write a technical plan. They only need to give enough context for the agent to start safely.

### How The User Uses Overlord

The user creates a ticket draft with this objective, assigns it to a project, and asks an agent to execute it.

While the ticket is running, Overlord gives the user a place to watch progress. The agent can post updates such as:

- it has started reviewing the mobile ticket screens
- it found the theme system used by the app
- it is checking the named files and related native tab behavior
- it is running verification

The important user-facing point is that the work is visible while it is happening. The user does not need to keep a terminal open or ask the agent repeatedly what it is doing.

### What The User Reviews

When the agent returns the ticket, the user reviews the delivery:

- what files changed
- why those files changed
- what the agent says it verified
- whether the visible bug is fixed
- whether the audit found follow-up work

For this example, a good delivery would tell the user that the ticket list header, ticket detail header, modals, and native tabs now respect the selected app theme. It should also say whether any other mobile light/dark inconsistencies were found.

The user can then choose:

- mark the ticket complete if the app behaves correctly
- return the ticket with another objective if review finds a gap

### Possible Follow-Up Objective

If review finds another mobile theme issue, the user can add a second objective instead of creating a new unrelated chat:

```text
Objective 2:
The ticket detail modal now respects dark mode, but the ticket list search field still flashes light on app load. Fix that remaining issue and verify the ticket list in both light and dark mode.
```

When the agent receives this second objective, it also receives the first objective, previous updates, delivery notes, and file-change history. The user can be brief because Overlord preserves the context.

### What This Example Demonstrates

This example demonstrates a simple one-pass Overlord workflow:

- the user writes one clear objective
- the agent executes and returns the ticket
- the user reviews the result
- the user either completes the ticket or adds a follow-up objective

It is a good example for bugs, audits, small features, and polish work where the user knows the problem but wants the agent to handle the investigation and implementation details.

## Example Ticket 2: Organization-Scoped Ticket Identifiers

### Objective 1 Prompt

```text
We have often presented ticket_sequence as the ticket number, but this is misleading because that number changes based on the order of the tickets. We need a real ticket_number column that is unique per organization. create a ticket_id column that is [organization_id]:[ticket number sequentially by creation date], Examples: the first ticket in organization 1 would be "1:1". The third ticket created in the 2nd organization would be "2:3"

Instructions: Create a migration that ads ticket_id to the DB and populates it based on the formula above. ticket_id must be unique. There should be a db function that creates each new ticket_id for each new ticket. We may at some point use this as the primary key for tickets, but lets do that later.

Create the plan for this migration
```

### Objective 2 Prompt

```text
Execute the plan according to your recommendations
```

### What The User Is Asking For

This example shows a common Overlord workflow: the user separates planning from execution.

The first objective asks the agent to investigate and create a plan. The user is not asking the agent to change the database yet. That matters because database migrations are risky and often deserve review before implementation.

The second objective comes later, after the user has reviewed the plan and decided to proceed.

### How The User Uses Objectives

The user starts by creating a ticket draft with only Objective 1:

```text
Create the plan for this migration.
```

Then the user asks the agent to execute the ticket.

The agent investigates the codebase, posts progress to the ticket, and delivers a plan. The ticket returns to review. At this point, the user is in control. They can:

- mark the ticket complete if all they wanted was the plan
- edit the plan manually outside the agent flow
- ask a clarifying question
- add another objective that asks the agent to execute the plan

If the user chooses to continue, they add Objective 2:

```text
Execute the plan according to your recommendations.
```

Then they send the same ticket back to the agent.

This is the key behavior to explain: the agent receives the full ticket history when it starts Objective 2. That includes the original migration prompt, the plan it delivered for Objective 1, the progress updates it posted while planning, any artifacts or notes, and the user's new instruction to proceed.

The user does not need to copy the plan into a new prompt. Overlord carries the context forward.

### What The User Reviews After Objective 1

After the first delivery, the user reviews the plan. A useful plan should answer questions like:

- what new database column or table will be added
- how existing tickets will be backfilled
- how new tickets will receive identifiers
- how uniqueness will be enforced
- what application code needs to stop relying on `ticket_sequence`
- what verification will be run
- what is intentionally deferred

For this example, the plan should also call out the naming question in the prompt: the user mentions `ticket_number` and `ticket_id`. The plan should recommend one human-facing identifier name while preserving the existing UUID primary key.

The user's decision point is simple:

- if the plan looks wrong, add a new objective asking the agent to revise it
- if the plan looks right, add Objective 2 and send it back for implementation

### What The User Reviews After Objective 2

After Objective 2, the ticket returns again with implementation details. The user reviews:

- the migration file or files
- generated type updates
- code paths that display or search ticket identifiers
- test and verification notes
- change rationales explaining why each meaningful file changed

For this example, a good delivery would say that existing tickets are backfilled by organization creation order, new tickets receive organization-scoped identifiers, and `ticket_sequence` is no longer presented as the stable ticket number where the code was updated.

The user can then choose:

- mark the ticket complete
- add Objective 3 for a missing UI update
- add Objective 3 for more tests
- add Objective 3 asking another agent to review the migration
- reopen the ticket later if production review finds a problem

### Example Objective 3 Prompts

The same ticket can continue if the user needs more work:

```text
Objective 3:
Review the implementation for migration safety and concurrency issues. Do not change code unless you find a concrete bug.
```

```text
Objective 3:
The migration is in place, but the mobile ticket list still displays ticket_sequence. Update the mobile UI to show ticket_id where available and keep the fallback behavior for older records.
```

```text
Objective 3:
Write a short release note for this identifier change and mention that UUID primary keys are unchanged.
```

This is how users should think about objectives: each objective is the next instruction in the same durable work thread.

### What This Example Demonstrates

This example demonstrates the staged Overlord workflow:

- the user creates a ticket with a planning objective
- the agent completes that objective and delivers the ticket
- the user reviews the plan
- the user submits a second objective on the same ticket
- the agent receives all prior ticket information and starts from that context
- the user reviews the implementation
- the user completes the ticket or adds more objectives

This pattern is useful for migrations, architecture changes, security-sensitive work, large refactors, and any task where the user wants a plan before code changes.

## How Agents Should Explain Overlord To Users

When explaining Overlord, describe the user's control loop:

```text
Create a ticket as a draft, add the first objective, and send it to an agent. The agent works the objective and returns the ticket with notes, artifacts, verification, and change rationales. You review it. If it is done, mark it complete. If it needs another pass, add the next objective and send the same ticket back. The agent will receive the previous ticket history, so you do not have to start over.
```

For a one-pass bug fix, say:

```text
Use one objective when you know the outcome you want and trust the agent to investigate the implementation details. Review the delivery, then complete the ticket or add a follow-up objective for anything missed.
```

For risky or staged work, say:

```text
Use multiple objectives when you want control points. Objective 1 can ask for a plan. After reviewing that plan, Objective 2 can ask the agent to execute it. Objective 3 can ask for review, tests, documentation, or cleanup.
```

For review, say:

```text
The ticket keeps the original prompt, every objective, the agent's updates, delivery notes, artifacts, and change rationales in one place. That gives you a durable record of what happened and why.
```

## Prompt Template For Users

Users do not need to know the Overlord protocol. They only need to write clear objectives.

For a single-pass task:

```text
Objective:
Describe the outcome you want.

Context:
Describe the current behavior, affected users, known files, screenshots, logs, or related tickets.

Verification:
Describe what should be true when the work is done.
```

For a staged task:

```text
Objective 1:
Investigate the current implementation and create a plan. Do not implement yet.

Objective 2:
Execute the plan according to your recommendations.
```

For a review pass:

```text
Objective 3:
Review the delivered implementation for risks, missing tests, and incorrect assumptions. Only make changes if you find a concrete issue.
```

The main lesson: users can keep adding objectives to the same ticket as the work evolves. Overlord keeps the context, the agent work, and the review history together.
