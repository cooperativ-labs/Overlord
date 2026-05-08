import {
  AppWindowMac,
  Bot,
  ClipboardList,
  Eye,
  Monitor,
  Plug,
  ServerCog,
  TerminalSquare,
  Workflow
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Introduction'
};

export default function DocsPage() {
  return (
    <>
      <div className="flex flex-1 flex-col gap-8 p-6 md:p-10 max-w-4xl">
        <div className="space-y-4">
          <h1 className="text-3xl font-bold tracking-tight">Introduction</h1>
          <p className="text-lg text-muted-foreground leading-7">
            Overlord is a coordination layer for AI-assisted engineering work. It keeps the ticket,
            progress, review, and delivery record in one place while your agents keep working in the
            tools you already use.
          </p>
        </div>

        <div className="space-y-3">
          <h2 className="text-xl font-semibold tracking-tight">The mental model</h2>
          <div className="grid gap-3">
            <div className="rounded-lg border bg-card p-4">
              <p className="font-medium">The ticket is the prompt.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                It defines the work, captures progress, and holds the delivery record.
              </p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <p className="font-medium">The agent stays where it already works.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Overlord coordinates Claude Code, Codex, Cursor, OpenCode, and other setups instead
                of replacing them.
              </p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <p className="font-medium">Humans stay in the loop.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Progress, questions, artifacts, and review decisions come back to the same ticket.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="text-xl font-semibold tracking-tight">Product surfaces</h2>
          <p className="text-muted-foreground">
            Five parts serve the same ticket-centered workflow.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <SurfaceCard
              icon={AppWindowMac}
              title="Web App"
              description="Manage tickets, projects, activity, artifacts, and review in one shared place."
            />
            <SurfaceCard
              icon={Monitor}
              title="Desktop App"
              description="Adds local machine capabilities so Overlord can work with real repositories and terminal sessions."
            />
            <SurfaceCard
              icon={TerminalSquare}
              title="CLI"
              description="Gives agents and humans a stable terminal interface for attaching, updating, asking questions, and delivering work."
            />
            <SurfaceCard
              icon={ServerCog}
              title="MCP Server"
              description="Lets remote or hosted agents work with the same tickets and protocol without depending on the desktop app."
            />
            <SurfaceCard
              icon={Plug}
              title="Agent Plugins"
              description="Connects local and cloud agents directly into your ticket workflow from the tools they already run in."
            />
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="text-xl font-semibold tracking-tight">How it works</h2>
          <div className="space-y-4">
            <WorkflowStep
              step={1}
              icon={ClipboardList}
              title="A ticket defines the job"
              description="The ticket is the durable unit of work, not a disposable chat thread. It keeps the objective, structure, and delivery record in one place."
            />
            <WorkflowStep
              step={2}
              icon={Bot}
              title="An agent executes in its own environment"
              description="Overlord works with the tools you already use, including terminal agents and hosted agents. It coordinates them instead of replacing them."
            />
            <WorkflowStep
              step={3}
              icon={Workflow}
              title="Progress streams back into the ticket"
              description="Updates, blocking questions, artifacts, and session state flow back into the same ticket so humans can stay involved without hovering in the terminal."
            />
            <WorkflowStep
              step={4}
              icon={Eye}
              title="Humans review before work lands"
              description="Review the output, inspect diffs and rationales, answer questions, and decide what should happen next."
            />
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="text-xl font-semibold tracking-tight">Quick start</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border bg-card p-4">
              <p className="text-sm font-medium">1. Create a project</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Projects group related tickets. Link a project to a local repository in the desktop
                app.
              </p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <p className="text-sm font-medium">2. Write a ticket</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Give it a clear objective, optional acceptance criteria, and enough context for an
                agent.
              </p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <p className="text-sm font-medium">3. Launch the agent</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Use the desktop app or the CLI and MCP workflow for a terminal-first flow.
              </p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <p className="text-sm font-medium">4. Review what comes back</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Watch updates, answer blocking questions, and review artifacts and diffs.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="text-xl font-semibold tracking-tight">Next steps</h2>
          <div className="grid gap-2">
            <Link
              href="/docs/surfaces/desktop-app"
              className="rounded-lg border bg-card p-4 text-sm hover:bg-accent transition-colors"
            >
              Getting started with the desktop app &rarr;
            </Link>
            <Link
              href="/docs/protocol"
              className="rounded-lg border bg-card p-4 text-sm hover:bg-accent transition-colors"
            >
              CLI and protocol reference &rarr;
            </Link>
            <Link
              href="/docs/surfaces/mcp-server"
              className="rounded-lg border bg-card p-4 text-sm hover:bg-accent transition-colors"
            >
              MCP and cloud-agent integration &rarr;
            </Link>
            <Link
              href="/docs/security"
              className="rounded-lg border bg-card p-4 text-sm hover:bg-accent transition-colors"
            >
              Security and data boundaries &rarr;
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}

function SurfaceCard({
  icon: Icon,
  title,
  description
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="size-4" />
        </div>
        <p className="font-medium">{title}</p>
      </div>
      <p className="mt-2 text-sm text-muted-foreground leading-6">{description}</p>
    </div>
  );
}

function WorkflowStep({
  step,
  icon: Icon,
  title,
  description
}: {
  step: number;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-4 rounded-lg border bg-card p-4">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="size-4" />
      </div>
      <div>
        <p className="font-medium">
          <span className="text-muted-foreground mr-2 text-sm">Step {step}</span>
          {title}
        </p>
        <p className="mt-1 text-sm text-muted-foreground leading-6">{description}</p>
      </div>
    </div>
  );
}
