import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'Terminal & IDE'
};

export default function TerminalAndIdePage() {
  return (
    <DocsMarkdownPage
      title="Terminal & IDE"
      lead="Choose which terminal Overlord opens for each execution target, and configure how it launches the generated agent command in that terminal."
    >
      {`
## Per-target terminal settings

Terminal launch settings are configured **per execution target**. That means each target can use a different terminal app and a different launch style.

This is intentional:

- your laptop may launch differently from a remote server
- one execution target may use tmux while another opens a native terminal window
- custom launch behavior can be tuned for the shell or terminal app on that specific machine

Open the **Execution Targets** page in Settings and edit the target you want to change.

## Choose the terminal

Each execution target can use one of the supported terminal profiles:

- **System Default**
- **Terminal**
- **iTerm2**
- **Warp**
- **tmux**
- **Ghostty**
- **Alacritty**
- **Kitty**
- **Hyper**
- **cmux**
- **Custom**

If you choose **Custom**, enter the terminal name or path that Overlord should use for that target.

## Choose how it launches

For terminals that support it, Overlord lets you choose how a launch opens:

- **New window**
- **New tab**
- **Custom**

Use **Custom** when the terminal needs a specific keyboard shortcut or other launcher behavior. Overlord sends the configured hotkey, then types the launch command into the active terminal.

## Configure tmux launches

When the selected terminal profile is \`tmux\` or \`cmux\`, Overlord also exposes tmux-specific launch settings for that execution target:

- choose which host terminal tmux should run inside
- optionally provide a custom host terminal name or path
- edit the tmux launch command template

The default tmux command template is:

\`\`\`bash
tmux new-session bash {script}
\`\`\`

Use \`{script}\` where Overlord should insert the generated launch script.

## Configure launch commands

The launch command is generated from the selected target settings and the agent-specific command Overlord needs to run.

When you use a custom command template, keep these placeholders intact:

- \`{script}\` for the generated launch script in tmux-style profiles
- \`{command}\` for the generated agent launch command in the mobile server-terminal flow
- \`{window}\` for the ticket window name in that same flow

Do not remove a placeholder unless the UI for that specific setting no longer requires it.

## How this affects launches

When Overlord creates an execution request, it stores the chosen execution target and any target-specific launch settings alongside the work item. The runner then uses those settings when it opens the terminal and starts the agent.

That is why terminal configuration lives on the execution target:

- the same project can launch differently on two machines
- the same user can keep different launch behavior for local and remote targets
- target-specific launch settings stay with the machine that actually runs the work

## Related pages

- [Execution Targets & Resources](/docs/workflow/execution-targets)
- [Agent Execution & Runner](/docs/workflow/agent-execution)
- [Workflow overview](/docs/workflow)
      `}
    </DocsMarkdownPage>
  );
}
