  
**Orchestrator**  
**AI Agent Orchestration Platform**  
Product Specification Document  

## 1. Vision & Overview  
**AgentDesk is a project management platform purpose-built for orchestrating AI agents. It replaces the paradigm of managing human workers with tickets (Jira, Linear) with an interface designed around the unique characteristics of AI agent workflows: structured prompts instead of story points, clarification loops instead of standups, and real-time execution monitoring instead of status updates.**  
**The core insight is that AI agents have fundamentally different needs than human workers. They don’t need sprint planning or story estimation. They need clear specifications, tool access, defined constraints, and a structured feedback loop. AgentDesk provides this through a direct-messaging-first interface where each ticket becomes a focused conversation between the project manager and an AI agent.**  
**Critically, AgentDesk is a coordination layer and shared brain — not an execution environment. Agents live wherever they are most effective: Claude Code in a terminal with full repo access, the Claude desktop or mobile app, ChatGPT, Cursor, or any other AI tool. AgentDesk is the connective tissue that holds the tickets, shared context, conversation history, and overlap detection. External agents attach to tickets and communicate through AgentDesk’s protocol.**  
## 2. Core Concepts  
**2.1 Tickets as Structured Prompts**  
**Each ticket in AgentDesk is more than a task description. It is a structured specification that includes:**  
**Each ticket in AgentDesk is more than a task description. It is a structured specification that includes:**  
* Objective — a clear statement of what needs to be accomplished  
* Context & Reference Files — relevant documentation, code, schemas, or prior work  
* Constraints — boundaries on approach, technology choices, or scope  
* Available Tools — what the agent has access to (APIs, databases, file systems)  
* Acceptance Criteria — measurable conditions for completion  
* Output Format — expected deliverables (code, summaries, demo links, diffs)  
  
This structured format ensures agents receive the information they need to execute effectively, reducing ambiguity and wasted computation.  
**2.2 The Clarification Phase**  
**The most critical differentiator of AgentDesk is the mandatory clarification phase before task execution. When a ticket is submitted, the assigned agent reviews it and returns with structured questions before beginning work. This mirrors what a senior engineer does when receiving a vague ticket — they push back with smart questions before writing code.**  
**The most critical differentiator of AgentDesk is the mandatory clarification phase before task execution. When a ticket is submitted, the assigned agent reviews it and returns with structured questions before beginning work. This mirrors what a senior engineer does when receiving a vague ticket — they push back with smart questions before writing code.**  
  
**The agent’s review should surface:**  
* Ambiguities in the specification that could lead to incorrect assumptions  
* Missing context such as schemas, dependencies, or configuration details  
* Tradeoff decisions that require human judgment (e.g., “This could be done with a cron job or a webhook — which do you prefer?”)  
* Contradictions in the acceptance criteria  
  
**2.3 Confidence Threshold**  
**Not every ticket requires extensive clarification. AgentDesk implements a confidence threshold system: when a ticket is sufficiently clear, the agent can present its execution plan and auto-proceed after a timeout or single click of approval. This prevents bottlenecking trivial tasks behind unnecessary Q&A cycles.**  
## 3. Ticket Lifecycle  
**Every ticket moves through five phases:**  
##   

| Phase | Status | Description |
| ------- | ----------- | ------------------------------------------------------------------------------------------- |
| Draft | Created | PM writes the ticket with structured fields |
| Review | Clarifying | Agent analyzes the ticket and returns questions, identifies ambiguities and missing context |
| Refine | Iterating | PM answers questions; agent may ask follow-ups until confident |
| Execute | In Progress | Agent proceeds with full clarity, streams progress updates |
| Deliver | Complete | Agent provides summary, artifacts, code diffs, and/or demo links |
  
## 4. Messaging Interface  
**4.1 Direct Messages as Primary Interface**  
**AgentDesk uses a direct messaging model rather than a channel-based approach. Each ticket spawns a 1:1 conversation between the PM and the assigned agent. The PM’s inbox is a list of these conversations, each displaying the ticket thumbnail, current status, and a preview of the last message.**  
  
**This design choice provides several advantages:**  
**This design choice provides several advantages:**  
* Context isolation — no noise from unrelated tickets bleeding into view  
* Conversation history is ticket history — every clarification, decision, and deliverable lives in one thread  
* Natural mental model — context-switching per conversation mirrors how people already use messaging apps  
* Clean mobile/notification UX — “Agent-3 needs your input” feels like a text message, not a firehose  
  
**4.2 Message Anatomy**  
**Every message in the interface carries metadata that links it to its context:**  
* Agent avatar and identifier  
* Ticket thumbnail with title, status, and ID  
* Timestamp and phase indicator (Review, Execute, Deliver, etc.)  
* Quick actions where applicable (Approve Plan, Answer Question, Pause, Cancel)  
  
Clicking the ticket thumbnail opens a side panel or full view with the complete ticket details, execution plan, and artifacts.  
**4.3 Group Conversations**  
**While DMs are the default, AgentDesk supports group conversations for situations where multiple agents are working on related tasks. A PM can create a group thread and pull in relevant agents to coordinate work that crosses ticket boundaries.**  
**While DMs are the default, AgentDesk supports group conversations for situations where multiple agents are working on related tasks. A PM can create a group thread and pull in relevant agents to coordinate work that crosses ticket boundaries.**  
  
**Example: Agent A working on a frontend ticket and Agent B working on the corresponding API ticket can be brought into the same conversation with the PM to align on schemas and contracts.**  
## 5. Multi-Agent Coordination  
**5.1 The Turn-Taking Problem**  
**Current LLMs lack a natural sense of conversational turn-taking. In multi-agent conversations, common failure modes include over-responding (both agents reply when only one was addressed), echo chambers (agents restating each other’s points), and an inability to remain silent when appropriate.**  
  
**AgentDesk addresses this through explicit orchestration rather than free-form agent chat. The system routes messages to the appropriate agent(s), and when both agents’ input is needed, the system explicitly invokes both. A lightweight classifier determines whether a message is directed at one agent or multiple. The UX feels like a natural group chat, but the routing is structured underneath.**  
**5.2 Cross-Ticket Overlap Detection**  
**One of the more challenging problems in multi-agent orchestration is detecting when Agent A’s work unexpectedly intersects with Agent B’s task. AgentDesk implements a layered approach:**  
**One of the more challenging problems in multi-agent orchestration is detecting when Agent A’s work unexpectedly intersects with Agent B’s task. AgentDesk implements a layered approach:**  
  
**Layer 1: Shared State Store (MVP). Each agent writes structured updates to a shared knowledge base as it works — files touched, decisions made, assumptions held. Before each major step, the system queries this store for overlaps with other active tickets. This provides deterministic, reliable collision detection at the resource level.**  
**Layer 1: Shared State Store (MVP). Each agent writes structured updates to a shared knowledge base as it works — files touched, decisions made, assumptions held. Before each major step, the system queries this store for overlaps with other active tickets. This provides deterministic, reliable collision detection at the resource level.**  
  
**Layer 2: Event-Based Triggers (MVP). Overlap rules are defined based on ticket specifications. If Agent A’s ticket involves the auth module and Agent B begins modifying auth-related files, the system fires an alert. Agents register their working domains at the start of execution, and the overlord watches for intersections.**  
  
**Layer 3: Coordinator LLM (V2). At phase transitions or regular intervals, a lightweight coordinator model reviews summaries from all active agents, looking for higher-level conceptual overlaps that keyword or file-level matching would miss. For example: “Agent A is building a notification system for payments, and Agent B is building a notification system for invites — these should share infrastructure.”**  
**Layer 3: Coordinator LLM (V2). At phase transitions or regular intervals, a lightweight coordinator model reviews summaries from all active agents, looking for higher-level conceptual overlaps that keyword or file-level matching would miss. For example: “Agent A is building a notification system for payments, and Agent B is building a notification system for invites — these should share infrastructure.”**  
  
**Layer 4: Embedding Similarity (V2). Agent work logs are continuously embedded and compared. When semantic similarity between two agents’ work crosses a threshold, the system flags it for review. This catches overlaps that neither file-level nor keyword-level detection would surface.**  
**Layer 4: Embedding Similarity (V2). Agent work logs are continuously embedded and compared. When semantic similarity between two agents’ work crosses a threshold, the system flags it for review. This catches overlaps that neither file-level nor keyword-level detection would surface.**  
  
**5.3 Overlap Resolution UX**  
**When an overlap is detected, the system pauses the later agent and surfaces the conflict in the PM’s chat: “Agent B is about to modify the payments module that Agent A is also working on. Would you like to create a group thread?” The PM can then choose to merge the work, create a coordination thread, reassign one ticket, or dismiss the alert.**  
  
**In the MVP, all overlaps are surfaced to the PM for human decision-making. As usage data accumulates, common resolution patterns can be automated.**  
## 6. Architecture: External Agent Model  
**6.1 Coordination Layer, Not Execution Environment**  
**AgentDesk is architecturally designed as an orchestration and context layer rather than an agent runtime. Agents execute in whatever environment is most effective for the task — Claude Code in a terminal with full repository access, the Claude desktop app with conversational flexibility, ChatGPT for tasks suited to its strengths, or Cursor with deep IDE integration. AgentDesk provides the shared brain: tickets, context, conversation history, and overlap detection.**  
  
**This agent-agnostic design means a PM is never locked into a single LLM provider. Ticket A might be handled by Claude Code because it needs deep repo context, while Ticket B is handled by a ChatGPT custom GPT because the PM prefers its reasoning style for that task type. AgentDesk doesn’t care about the runtime — it only requires structured status updates through its protocol.**  
**This agent-agnostic design means a PM is never locked into a single LLM provider. Ticket A might be handled by Claude Code because it needs deep repo context, while Ticket B is handled by a ChatGPT custom GPT because the PM prefers its reasoning style for that task type. AgentDesk doesn’t care about the runtime — it only requires structured status updates through its protocol.**  
**6.2 The Attach Flow**  
**External agents connect to AgentDesk by attaching to a ticket. The attach operation binds an agent session to a specific ticket, pulls down the full specification and context, and establishes a bidirectional communication channel. As the agent works, it pushes updates back — questions, progress summaries, artifacts — which appear in the PM’s messaging interface.**  
**External agents connect to AgentDesk by attaching to a ticket. The attach operation binds an agent session to a specific ticket, pulls down the full specification and context, and establishes a bidirectional communication channel. As the agent works, it pushes updates back — questions, progress summaries, artifacts — which appear in the PM’s messaging interface.**  
  
**The attach flow is the same regardless of the agent’s runtime environment. A Claude Code session in a terminal, a Claude mobile conversation, and a ChatGPT custom GPT all use the same protocol to bind to a ticket and participate in the AgentDesk workflow.**  
**The attach flow is the same regardless of the agent’s runtime environment. A Claude Code session in a terminal, a Claude mobile conversation, and a ChatGPT custom GPT all use the same protocol to bind to a ticket and participate in the AgentDesk workflow.**  
**6.3 Shared Context as the Killer Feature**  
**In the external agent model, the shared state store becomes the single most valuable component. Agent A working in Claude Code writes “I’ve defined the payments schema as X.” Agent B working in Cursor, building the frontend, can query that context before constructing its UI. The agents don’t need to communicate directly — they read from and write to a shared knowledge graph mediated by AgentDesk.**  
  
**Because agents are heterogeneous and external, the shared state store is the single source of truth for what is happening across all active work, regardless of which agent or runtime is performing it. This is what makes cross-ticket overlap detection possible even when agents have no awareness of each other.**  
**Because agents are heterogeneous and external, the shared state store is the single source of truth for what is happening across all active work, regardless of which agent or runtime is performing it. This is what makes cross-ticket overlap detection possible even when agents have no awareness of each other.**  
## 7. Agent Communication Protocol  
**7.1 Protocol Overview**  
**AgentDesk defines a lightweight protocol for agent-to-platform communication. This protocol is exposed through multiple interfaces (MCP server, REST API, CLI) but the operations are the same regardless of transport:**  
**AgentDesk defines a lightweight protocol for agent-to-platform communication. This protocol is exposed through multiple interfaces (MCP server, REST API, CLI) but the operations are the same regardless of transport:**  
  

| Operation | Description |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| list_tickets | Returns available and assigned tickets for the authenticated user |
| attach(ticket_id) | Binds the current session to a ticket. Returns the full ticket specification, context files, conversation history, and shared state relevant to the task. |
| ask(question) | Surfaces a clarification question to the PM in the messaging interface. Blocks execution until the PM responds. |
| update(summary) | Pushes a progress update that appears in the PM’s conversation stream. Non-blocking. |
| read_context(query) | Queries the shared state store for information written by other active agents. Returns relevant key-value pairs. |
| write_context(key, value) | Contributes a structured update to the shared state store, making it available to other agents and the overlap detection system. |
| deliver(artifacts) | Marks the ticket as complete and attaches output artifacts: code diffs, generated files, demo links, summaries. |
  
**This protocol is conceptually similar to MCP (Model Context Protocol) but oriented around project management rather than tool use. In practice, it can be implemented as an MCP server, making it natively compatible with Claude’s desktop and mobile apps.**  
**7.2 Session Persistence**  
**Agent sessions are inherently ephemeral — a Claude mobile conversation may be closed and reopened, a terminal session may time out, or a user may switch devices. AgentDesk handles this by treating the cloud as the sole source of truth. All ticket state, conversation history, and shared context live in the AgentDesk backend.**  
  
**When a session is lost and re-established, the user simply says “resume TICKET-042” (or runs the equivalent CLI command). The agent calls attach again, receives the full history, and picks up where it left off. No work is lost because no critical state ever lived solely in the local session.**  
**When a session is lost and re-established, the user simply says “resume TICKET-042” (or runs the equivalent CLI command). The agent calls attach again, receives the full history, and picks up where it left off. No work is lost because no critical state ever lived solely in the local session.**  
## 8. Connection Methods  
**8.1 MCP Server (Claude Desktop & Mobile)**  
**The primary connection method for Claude’s desktop and mobile apps is a cloud-hosted MCP server. The user adds the AgentDesk MCP server URL to their Claude configuration once. From that point on, every Claude conversation has access to AgentDesk tools: agentdesk_list_tickets, agentdesk_attach, agentdesk_ask, agentdesk_update, agentdesk_read_context, agentdesk_write_context, and agentdesk_deliver.**  
**The primary connection method for Claude’s desktop and mobile apps is a cloud-hosted MCP server. The user adds the AgentDesk MCP server URL to their Claude configuration once. From that point on, every Claude conversation has access to AgentDesk tools: agentdesk_list_tickets, agentdesk_attach, agentdesk_ask, agentdesk_update, agentdesk_read_context, agentdesk_write_context, and agentdesk_deliver.**  
  
**The user starts a new Claude conversation and says “attach to TICKET-042.” Claude calls the MCP tool, pulls the full ticket spec and context into the conversation, and begins the clarification phase. All subsequent updates flow back through the MCP server to the AgentDesk dashboard in real time.**  
**8.2 CLI (Claude Code & Terminal Agents)**  
**For terminal-based agents like Claude Code, AgentDesk provides a CLI tool. The typical workflow is:**  
**For terminal-based agents like Claude Code, AgentDesk provides a CLI tool. The typical workflow is:**  
  
1. The user runs agentdesk attach TICKET-042 in their terminal  
2. The CLI authenticates and fetches the ticket spec from the AgentDesk cloud  
3. The CLI starts a local MCP server that exposes AgentDesk tools to Claude Code  
4. Claude Code automatically gains access to ticket context and can push updates as it works  
5. On completion, the user runs agentdesk deliver (or Claude Code calls the tool directly) to ship artifacts  
  
Under the hood, the CLI hits the same cloud API as the MCP server. It acts as a local bridge, translating the AgentDesk protocol into whatever format the local agent runtime expects.  
**8.3 REST API (Universal Fallback)**  
**For agents and environments that don’t support MCP — including ChatGPT custom GPTs, third-party agent frameworks, and custom integrations — AgentDesk exposes a standard REST API. Any agent that can make HTTP calls can participate in the AgentDesk workflow. The REST API implements the same operations as the MCP server and CLI.**  
  
**This ensures AgentDesk is never locked into a single ecosystem. As new agent runtimes and LLM providers emerge, they can integrate through the REST API immediately.**  
**This ensures AgentDesk is never locked into a single ecosystem. As new agent runtimes and LLM providers emerge, they can integrate through the REST API immediately.**  
**8.4 System Architecture**  
**The complete architecture layers as follows:**  
**The complete architecture layers as follows:**  
  

| Layer | Components |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AgentDesk Cloud | Supabase (tickets, threads, messages, shared state) with realtime subscriptions. API server handling authentication, protocol operations, and overlap detection. |
| MCP Server | Cloud-hosted MCP endpoint. Claude Desktop and Mobile connect directly. Claude Code connects via CLI-spawned local proxy. |
| REST API | Standard HTTP API for ChatGPT custom GPTs, third-party agents, and custom integrations. |
| CLI Tool | Local command-line tool for terminal workflows. Authenticates against the cloud, can spawn a local MCP server for Claude Code integration. |
| Web Dashboard | Next.js application providing the PM’s view: messaging interface, ticket management, agent monitoring, shared context explorer, and overlap alerts. |
  
## 9. Deep Linking & Ticket Launch  
**9.1 The Goal**  
**Ideally, clicking an “Open” button on a ticket in the AgentDesk dashboard should launch a new agent session in the user’s preferred environment with all relevant context pre-loaded. The feasibility of this depends on each platform’s support for deep links and session initialization.**  
**9.2 Platform-Specific Deep Linking**  
  
**Claude Desktop & Mobile. There is currently no public deep link scheme for Claude’s apps that would allow opening a new conversation with pre-loaded context. However, because the MCP server is already configured, the workflow is lightweight: the dashboard copies “Attach to TICKET-042” to the clipboard and opens the Claude app (via URL scheme if available). The user pastes the command, and the MCP server handles injecting the full context. This is one extra step beyond the ideal but remains practical. As Anthropic expands its platform APIs, direct deep linking with pre-populated tool calls or system prompts may become possible.**  
  
**ChatGPT (Custom GPTs). OpenAI supports custom GPTs with pre-configured tools and instructions. An “AgentDesk Agent” custom GPT can be created with the AgentDesk REST API tools built in. The dashboard generates a deep link in the format https://chat.openai.com/g/agentdesk-agent?q=attach+TICKET-042 which opens the custom GPT with the attach command pre-filled. This is the closest to a true one-click deep link available today.**  
**ChatGPT (Custom GPTs). OpenAI supports custom GPTs with pre-configured tools and instructions. An “AgentDesk Agent” custom GPT can be created with the AgentDesk REST API tools built in. The dashboard generates a deep link in the format https://chat.openai.com/g/agentdesk-agent?q=attach+TICKET-042 which opens the custom GPT with the attach command pre-filled. This is the closest to a true one-click deep link available today.**  
  
**Claude Code (CLI). This is the most seamless path. The dashboard can trigger a custom URL scheme (agentdesk://ticket/042) that opens a terminal and runs agentdesk attach TICKET-042. On macOS, custom URL handlers can be registered by the CLI installer. The CLI fetches the ticket, spawns a local MCP server, and Claude Code is ready to work immediately.**  
**Claude Code (CLI). This is the most seamless path. The dashboard can trigger a custom URL scheme (agentdesk://ticket/042) that opens a terminal and runs agentdesk attach TICKET-042. On macOS, custom URL handlers can be registered by the CLI installer. The CLI fetches the ticket, spawns a local MCP server, and Claude Code is ready to work immediately.**  
  
**Cursor & Other IDEs. Many IDEs support URL schemes (e.g., cursor:// for Cursor, vscode:// for VS Code). The dashboard can generate IDE-specific deep links that open the relevant project and run the attach command. Integration depth depends on each IDE’s extension API.**  
  
**9.3 The “Open In...” Menu**  
**Each ticket in the AgentDesk dashboard includes an “Open in…” dropdown with platform-specific launch options. Each option performs the best available action for its platform:**  
  
* **Open in Claude** — copies attach command to clipboard and opens the app  
* **Open in ChatGPT** — opens the custom GPT deep link with the attach command pre-filled  
* **Open in Terminal** — triggers the CLI URL scheme or copies the terminal command  
* **Open in Cursor** — opens the IDE with the project context via URL scheme  
  
As platform APIs evolve toward supporting conversation initialization (creating a new session with pre-loaded system prompts, tools, and context via an API call that returns a joinable URL), the “Open in…” menu can be upgraded to true one-click launch without changing the underlying architecture.  
**9.4 Per-Ticket Claude Configuration (Power Users)**  
**For long-running or complex tickets, AgentDesk can generate a per-ticket MCP configuration snippet for Claude Desktop. This snippet includes the MCP server URL with ticket-specific parameters baked in, so every new conversation in that Claude profile automatically has the ticket context available without needing to manually attach. This is overkill for one-off tasks but valuable for tickets that span days or weeks of iterative work.**  
**For long-running or complex tickets, AgentDesk can generate a per-ticket MCP configuration snippet for Claude Desktop. This snippet includes the MCP server URL with ticket-specific parameters baked in, so every new conversation in that Claude profile automatically has the ticket context available without needing to manually attach. This is overkill for one-off tasks but valuable for tickets that span days or weeks of iterative work.**  
## 10. Agent Features  
* Execution plan presentation — agents propose their step-by-step approach before executing, allowing the PM to course-correct early  
* Progress streaming — real-time updates during execution so the PM can monitor without polling  
* Cost tracking per ticket — token usage, API calls, and time elapsed  
* Replay/retry — re-run any ticket with tweaked instructions without starting from scratch  
* Artifact management — structured output including code diffs, demo links, summaries, and generated files  
* Dependency awareness — Agent A’s output can automatically feed into Agent B’s ticket as input context  
  
## 11. PM Workflow  
**The daily workflow for a PM using AgentDesk:**  
##   
1. Open inbox and review which agents need input (blocked agents surface to the top)  
2. Answer clarification questions and approve execution plans  
3. Review completed deliverables and provide feedback or accept  
4. Fire off new tickets for the next batch of work  
5. Monitor active agents via the conversation stream  
  
Key dashboard features include filtering by ticket status, agent, or priority; an activity stream with real-time updates; and an audit trail of every decision and handoff linked to its ticket.  
## 12. Core Data Model  
##   

| Entity | Description |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Ticket | The unit of work. Contains structured fields (objective, context, constraints, criteria), status, assigned agent, and links to its primary thread. |
| Thread | A conversation context. Can be 1:1 (one PM, one agent) or group (one PM, multiple agents). Linked to one or more tickets. |
| Message | A single message within a thread. Authored by the PM or an agent. Optionally references a specific ticket. Carries metadata for rendering (agent avatar, ticket thumbnail, quick actions). |
| Agent Session | A bound connection between an external agent runtime and a ticket. Tracks the connection method (MCP, CLI, REST), session state, and heartbeat for liveness detection. |
| Artifact | An output produced by an agent: code diffs, files, demo links, summaries. Linked to a ticket and message. |
| Shared State | A key-value store of structured updates written by agents during execution. Used for overlap detection and cross-ticket context sharing. |
| Connection | Records a user’s configured agent environments (Claude MCP, ChatGPT GPT, CLI installations) for the “Open in…” menu and deep linking. |
  
## 13. Technical Considerations  
**The MVP can be built with a relatively lean stack: Supabase for the data store with realtime subscriptions for live updates, a Next.js frontend for the messaging interface and ticket management, and the agent communication protocol served as both a cloud MCP endpoint and a REST API. Supabase’s row-level security and realtime capabilities make it well-suited for the multi-agent messaging pattern.**  
##   
**Key technical decisions for future exploration:**  
* Automatic subtask decomposition — high-level tickets are broken into sub-tickets by a planning agent  
* Skill/capability matching — routing tickets to agents with the right tools and context (potential integration point with a skills marketplace)  
* Concurrent execution limits and queueing strategy  
* Sandboxing and security boundaries for agent tool access  
* Token budget management across long-running multi-turn tickets  
* MCP server scaling — handling many concurrent agent connections with low latency  
* Offline agent detection — heartbeat monitoring for CLI-attached agents that may lose connectivity  
  
  
*— End of Document —*  
