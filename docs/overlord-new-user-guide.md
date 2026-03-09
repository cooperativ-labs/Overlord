# Overlord for New Users

Overlord is a ticketing and coordination layer for AI-assisted engineering work. It gives you a structured place to create prompts, track progress, review outputs, and manage handoffs between humans and agents without forcing you into a brand-new chat interface.

The core idea is simple: you keep using your existing agent tools where you already work, and Overlord keeps the work organized as tickets.

## What Overlord Does

Overlord helps teams turn agent work into a repeatable workflow:

- Create tickets that describe what needs to be done.
- Organize tickets by project.
- Launch work in your preferred agent environment.
- Stream progress, questions, and deliverables back into the ticket.
- Keep a durable record of decisions, artifacts, and follow-ups.

Instead of replacing Claude Code, Codex, Cursor, Gemini, or other agent environments, Overlord coordinates work across them.

## Very Simple Architecture

Overlord is made of four user-facing pieces:

### 1. Web App

The web app is the main place where you manage projects and tickets. It stores ticket state, shows live updates, and gives everyone a shared view of ongoing work.

Use it to:

- create and edit tickets
- organize work by project
- review ticket activity and artifacts
- answer agent questions
- manage account settings and agent tokens

### 2. Electron Desktop App

The desktop app is a thin local wrapper around the web app. It adds local machine capabilities that a browser alone cannot provide.

Its main jobs are:

- connecting directly to your local terminal
- letting you associate Overlord projects with local repository folders
- launching agents from the desktop into those repositories
- supporting embedded terminal sessions and local notifications

This is what lets Overlord coordinate work in real repositories on your machine without becoming your coding environment itself.

### 3. CLI

The CLI is the command-line interface for Overlord tickets and agent runs. Agents use it to interact with ticket context and report progress.

The CLI handles things like:

- starting work on a ticket
- fetching the latest ticket prompt/context
- attaching an agent session to a ticket
- posting progress updates
- asking blocking questions
- delivering final results back to the ticket

This is important because it gives agents one stable way to work with Overlord from the terminal.

### 4. MCP Server

The MCP server gives cloud-based agents a standard tool surface for interacting with Overlord. This is the part that allows hosted or remote agent runtimes to work with tickets without needing the desktop app.

Use cases include:

- listing and reading tickets
- creating tickets from agent workflows
- posting updates and deliverables from cloud agents
- integrating Overlord into broader agent orchestration systems

## The Workflow Overlord Enables

Overlord is built around tickets, not chats.

The normal workflow looks like this:

1. A user creates a ticket that describes an engineering task, bug, feature, or investigation.
2. The ticket becomes the structured prompt and tracking record for that work.
3. The user sends the ticket to an agent in the tool they already use, such as Claude Code or Codex.
4. The agent reads the ticket context, works in the repository, and reports progress back to Overlord.
5. The user reviews updates, answers questions, and evaluates deliverables inside the ticket.
6. The ticket remains as a durable record of what was asked, what happened, and what was delivered.

This is the main product principle:

Overlord does not try to invent a new agent interface. It communicates with your agents where you already use them, then brings the work back into a shared ticket workflow.

## Key Features

### Ticket-Centered Prompt Management

Tickets are the unit of work in Overlord. A ticket can include:

- a title
- an objective
- acceptance criteria
- execution target information
- status and priority
- project assignment

This makes prompts easier to reuse, refine, review, and hand off than if they only lived inside a chat thread.

### Project Organization

Tickets are grouped into projects so work stays organized. Projects can also be linked to local working directories in the desktop app, which makes it easier to run agents in the correct repository.

### Agent Launching Without Agent Lock-In

Overlord can prepare and launch ticket work for multiple agent environments. The product is designed to coordinate those environments, not replace them.

This gives teams a consistent workflow even if they use different agents for different tasks.

### Live Ticket Activity

As agents work, tickets can receive:

- session state updates
- progress summaries
- blocking questions
- follow-up messages
- final delivery events

This gives humans a live view of what the agent is doing without needing to sit inside the terminal session the whole time.

### Artifacts and Deliverables

Agents can attach structured outputs to tickets, such as:

- file change summaries
- notes
- next steps
- links
- uploaded files

This makes the final output easier to review than digging through raw terminal logs.

### Shared Context Across Sessions

Overlord supports ticket-specific shared context so useful facts can persist across agent sessions. That helps when work pauses, gets resumed later, or moves between different agent runtimes.

### Human-in-the-Loop Review

When an agent is blocked, it can ask a question directly through the ticket workflow. Users can respond in the ticket and keep the work moving without losing context.

### Local Repository Integration

The desktop app can connect a project to a local repository folder and launch work in the local terminal. This is what makes Overlord useful for real engineering work instead of only abstract planning.

### Cloud Agent Integration Through MCP

For teams using hosted agents or orchestrated agent workflows, the MCP server provides a standard way to work with the same tickets and processes from the cloud.

## Why This Model Matters

Many AI workflows break down because prompts, progress, and outputs are scattered across chat windows, terminals, and personal notes.

Overlord gives that work a system of record:

- the ticket is the prompt
- the ticket is the progress log
- the ticket is the review surface
- the ticket is the delivery record

That makes agent work easier to manage as real operational work, not just ad hoc conversations.

## Security and Privacy

Overlord is designed so that the contents of your local files are not sent to Overlord's servers just because you connect a repository or use the desktop app.

Important boundaries:

- The content of your files is never sent to Overlord's servers as part of repository connection or terminal integration.
- The content Overlord stores is the content of tickets and ticket-related updates.
- That includes anything agents write into tickets, such as plans, summaries, questions, deliverables, and proposed engineering approaches.

That means users should treat ticket contents as intentional shared records. If an agent writes proprietary or sensitive information into a ticket, that ticket content is part of what Overlord stores.

Our privacy policy forbids using that ticket data for any purpose beyond what is necessary to provide the service. It is never shared with third parties and is never used for advertising.

In short:

- your repository contents stay on your machine unless you or your agent explicitly put information into a ticket
- ticket content is stored so Overlord can provide workflow, tracking, and delivery features
- you should assume anything written into a ticket becomes part of the persistent record for that work

## Who Overlord Is For

Overlord is for teams and individuals who already use coding agents and want more structure around the work:

- engineering teams coordinating agent-driven implementation
- founders or product teams turning requests into trackable engineering tickets
- developers who want a durable workflow around local and cloud agents
- teams that want agent flexibility without building process around a single vendor UI

## Summary

Overlord is not another chat tool. It is a coordination layer for agent work.

It combines:

- a web app for managing tickets
- a desktop app for local terminal and repository access
- a CLI for terminal-based ticket interaction
- an MCP server for cloud-based agent integration

If you already work with AI coding agents, Overlord gives that work structure, visibility, and continuity without asking you to leave the tools you already use.
