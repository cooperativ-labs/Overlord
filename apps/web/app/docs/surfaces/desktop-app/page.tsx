import type { Metadata } from 'next';
import Image from 'next/image';

export const metadata: Metadata = {
  title: 'Desktop App'
};

function Screenshot({
  src,
  alt,
  width,
  height
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
}) {
  return (
    <figure className="space-y-2">
      <div className="overflow-hidden rounded-xl border bg-card">
        <Image src={src} alt={alt} width={width} height={height} className="h-auto w-full" />
      </div>
      <figcaption className="text-sm text-muted-foreground">{alt}</figcaption>
    </figure>
  );
}

export default function DesktopAppPage() {
  return (
    <main className="flex max-w-5xl flex-1 flex-col gap-8 p-6 md:p-10">
      <div className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">Desktop App</h1>
        <p className="text-lg leading-7 text-muted-foreground">
          The desktop app is a thin local wrapper around the web app with access to your machine.
        </p>
      </div>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">What it adds</h2>
        <p className="leading-7 text-muted-foreground">
          The desktop app provides local capabilities that a browser cannot.
        </p>
        <ul className="list-disc space-y-2 pl-6 text-sm leading-7">
          <li>Direct connection to your local terminal.</li>
          <li>Linking Overlord projects to repository folders on your machine.</li>
          <li>Launching agents into those repositories.</li>
          <li>Embedded terminal sessions with configurable tmux profiles.</li>
          <li>AI-assisted Git commit messages and push from the Current Changes view.</li>
          <li>Per-user agent configuration synced through Overlord.</li>
          <li>Local notifications.</li>
        </ul>
      </section>

      <section className="space-y-6">
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold tracking-tight">Product Surfaces</h2>
          <p className="leading-7 text-muted-foreground">
            The desktop app also packages local agent connectors so Claude and Codex can work on
            Overlord tickets without leaving their native app surfaces.
          </p>
        </div>

        <div className="grid gap-6">
          <div className="space-y-4 rounded-xl border bg-card p-6">
            <div className="space-y-2">
              <h3 className="text-xl font-semibold tracking-tight">Claude Desktop</h3>
              <p className="text-sm leading-6 text-muted-foreground">
                Use the Claude desktop app as an idea-to-ticket and ticket-to-execution surface.
                Overlord keeps the workflow centered on tickets while Claude handles the live
                conversation and repository work.
              </p>
            </div>
            <ul className="list-disc space-y-2 pl-6 text-sm leading-7">
              <li>Brainstorm an idea, then ask Claude to turn it into an Overlord ticket.</li>
              <li>Ask Claude to review an existing Overlord ticket and tighten the scope.</li>
              <li>Ask Claude to execute a ticket and stream updates back into Overlord.</li>
              <li>Ask Claude to draft acceptance criteria, rollout notes, or next steps.</li>
              <li>
                Ask Claude to summarize the diff before delivery so the ticket handoff is clean.
              </li>
            </ul>
          </div>

          <div className="space-y-4 rounded-xl border bg-card p-6">
            <div className="space-y-2">
              <h3 className="text-xl font-semibold tracking-tight">Codex Desktop</h3>
              <p className="text-sm leading-6 text-muted-foreground">
                Codex works well as the hands-on execution surface for linked repositories. The
                bundled Overlord plugin gives Codex durable ticket lifecycle instructions plus a
                local bridge into the installed <code>ovld</code> CLI.
              </p>
            </div>
            <ul className="list-disc space-y-2 pl-6 text-sm leading-7">
              <li>Brainstorm an idea, then ask Codex to make an Overlord ticket.</li>
              <li>
                Ask Codex to inspect a ticket and suggest implementation changes before launch.
              </li>
              <li>
                Ask Codex to execute a ticket, run checks, and deliver the result back to Overlord.
              </li>
              <li>
                Ask Codex to review the current branch and attach a clearer rationale to the work.
              </li>
              <li>
                Ask Codex to turn feedback from a review thread into a follow-up Overlord ticket.
              </li>
            </ul>
            <Screenshot
              src="/images/screenshots/codex-plugin-screenshot.png"
              alt="Codex desktop app with the Overlord plugin installed and available in chat."
              width={2138}
              height={1970}
            />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">Local agent connectors</h2>
        <p className="leading-7 text-muted-foreground">
          Overlord packages these connectors in both the desktop app and the CLI. In the desktop
          app, install them from{' '}
          <span className="font-medium">Settings → Agents &amp; Plugins</span>. If you already use
          the CLI, the equivalent commands are <code>ovld setup claude</code> and{' '}
          <code>ovld setup codex</code>.
        </p>
        <p className="leading-7 text-muted-foreground">
          For Codex, the desktop app manages <code>~/.codex/plugins/overlord</code>,{' '}
          <code>~/.agents/plugins/marketplace.json</code>, and{' '}
          <code>~/.codex/rules/default.rules</code>. Claude follows the same bundled install model
          through <code>ovld setup claude</code> or the desktop app settings flow.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">Change Viewer</h2>
        <p className="leading-7 text-muted-foreground">
          The desktop app also includes a built-in diff browser for linked repositories.
        </p>
        <ol className="list-decimal space-y-2 pl-6 text-sm leading-7">
          <li>Open the project&apos;s Current Changes view.</li>
          <li>Inspect uncommitted files and their status.</li>
          <li>View the unified diff for any file.</li>
          <li>Inspect the rationale attached to changed hunks.</li>
        </ol>
        <p className="leading-7 text-muted-foreground">
          That rationale comes from agent deliveries and helps explain why a change was made.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-2xl font-semibold tracking-tight">Related pages</h2>
        <ul className="list-disc space-y-2 pl-6 text-sm leading-7">
          <li>
            <a className="underline-offset-2 hover:underline" href="/docs/agent-plugins">
              Agent Plugins
            </a>
          </li>
          <li>
            <a className="underline-offset-2 hover:underline" href="/docs/surfaces/web-app">
              Web app
            </a>
          </li>
          <li>
            <a className="underline-offset-2 hover:underline" href="/docs/workflow/review">
              Workflow review
            </a>
          </li>
          <li>
            <a className="underline-offset-2 hover:underline" href="/docs/security/data-boundaries">
              Data boundaries
            </a>
          </li>
        </ul>
      </section>
    </main>
  );
}
