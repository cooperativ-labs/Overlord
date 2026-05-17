'use client';

import {
  Bot,
  Check,
  Copy,
  Edit3,
  Info,
  Keyboard,
  Link2,
  Monitor,
  Palette,
  Terminal,
  User,
  X
} from 'lucide-react';
import { useState } from 'react';

import { MarkdownContent } from '@/components/features/MarkdownContent';
import { Badge } from '@/components/ui/badge';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider
} from '@/components/ui/sidebar';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { LAUNCH_AGENT_VALUES, type LaunchAgentType } from '@/lib/helpers/agent-types';

type NavItem = { name: string; icon: React.ElementType };

const workflowNavItems: NavItem[] = [
  { name: 'Terminal & IDE', icon: Monitor },
  { name: 'MCP & Cloud Agents', icon: Bot },
  { name: 'CLI & Local Agents', icon: Terminal },
  { name: 'Customization', icon: Edit3 }
];

const appNavItems: NavItem[] = [
  { name: 'Application', icon: Palette },
  { name: 'Hotkeys', icon: Keyboard },
  { name: 'Integrations', icon: Link2 },
  { name: 'About', icon: Info }
];

const userNavItems: NavItem[] = [
  { name: 'Profile', icon: User },
  { name: 'Linked Accounts', icon: Link2 }
];

const allNavItems = [...workflowNavItems, ...appNavItems, ...userNavItems];

function DemoTerminalSettings() {
  const [terminalApp, setTerminalApp] = useState('iterm');
  const [launchMode, setLaunchMode] = useState('tab');
  const [editorScheme, setEditorScheme] = useState('vscode');

  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <Label>Where to run terminal commands</Label>
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">External terminal</div>
        <p className="text-xs text-muted-foreground">
          Overlord launches agents in your system terminal.
        </p>
      </div>
      <div className="grid gap-2">
        <Label>External terminal application</Label>
        <Select value={terminalApp} onValueChange={setTerminalApp}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">System Default</SelectItem>
            <SelectItem value="terminal">Terminal</SelectItem>
            <SelectItem value="iterm">iTerm2</SelectItem>
            <SelectItem value="warp">Warp</SelectItem>
            <SelectItem value="ghostty">Ghostty</SelectItem>
            <SelectItem value="alacritty">Alacritty</SelectItem>
            <SelectItem value="kitty">Kitty</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label>When opening a terminal</Label>
        <Select value={launchMode} onValueChange={setLaunchMode}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="window">New window</SelectItem>
            <SelectItem value="tab">New tab</SelectItem>
            <SelectItem value="custom">Custom</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label>File links</Label>
        <Select value={editorScheme} onValueChange={setEditorScheme}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="vscode">VS Code</SelectItem>
            <SelectItem value="cursor">Cursor</SelectItem>
            <SelectItem value="sublime">Sublime Text</SelectItem>
            <SelectItem value="vim">Vim</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          File links in ticket artifacts will open in your editor.
        </p>
      </div>
    </div>
  );
}

function DemoMcpSettings() {
  const [copied, setCopied] = useState<string | null>(null);

  function handleCopy(key: string, text: string) {
    void navigator.clipboard.writeText(text).catch(() => undefined);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  const mcpUrl = 'https://mcp.ovld.ai/sse';
  const sessionPlaceholder = 'oauth_session_active';

  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <Label>MCP Server Address</Label>
        <div className="flex items-center gap-2">
          <Input value={mcpUrl} readOnly className="font-mono text-xs" />
          <Button
            variant="outline"
            size="icon"
            className="shrink-0"
            onClick={() => handleCopy('mcp-url', mcpUrl)}
          >
            {copied === 'mcp-url' ? (
              <Check className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Use this URL to connect cloud agents via MCP.
        </p>
      </div>

      <div className="grid gap-2">
        <Label>Signed-in session</Label>
        <div className="flex items-center gap-2">
          <Input value={sessionPlaceholder} readOnly className="font-mono text-xs" />
          <Button
            variant="outline"
            size="icon"
            className="shrink-0"
            onClick={() => handleCopy('token', 'demo-session')}
          >
            {copied === 'token' ? (
              <Check className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Agents use your shared OAuth session to authenticate with your workspace.
        </p>
      </div>

      <div className="grid gap-2">
        <Label>Environment snippet</Label>
        <div className="rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed">
          <div>export OVERLORD_URL=&quot;https://ovld.ai&quot;</div>
          <div># Sign in with Desktop or `ovld auth login` to populate shared credentials</div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-fit gap-1.5"
          onClick={() => handleCopy('env', 'demo-oauth-session')}
        >
          {copied === 'env' ? (
            <Check className="h-3.5 w-3.5 text-emerald-500" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          Copy snippet
        </Button>
      </div>
    </div>
  );
}

function DemoApplicationSettings() {
  const [theme, setTheme] = useState('system');
  const [aiTitlesEnabled, setAiTitlesEnabled] = useState(true);

  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <Label>Theme</Label>
        <Select value={theme} onValueChange={setTheme}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="dark">Dark</SelectItem>
            <SelectItem value="system">System</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Choose between light and dark mode, or follow your system setting.
        </p>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-md border p-4">
        <div className="space-y-1">
          <Label className="text-sm font-medium">AI ticket titles</Label>
          <p className="text-xs text-muted-foreground">
            When enabled, longer objectives are summarised into concise titles automatically.
          </p>
        </div>
        <Switch checked={aiTitlesEnabled} onCheckedChange={setAiTitlesEnabled} />
      </div>
    </div>
  );
}

function DemoProfileSettings() {
  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <Label>Email</Label>
        <Input value="demo@example.com" readOnly />
      </div>
      <div className="grid gap-2">
        <Label>Display name</Label>
        <Input defaultValue="Demo User" />
      </div>
    </div>
  );
}

function DemoCliSettings() {
  const [selectedLocalAgent, setSelectedLocalAgent] = useState('claude');
  const [flagInput, setFlagInput] = useState('');
  const [agentFlags, setAgentFlags] = useState<Record<string, string[]>>({
    claude: ['--enable-auto-mode'],
    cursor: [],
    codex: [],
    opencode: []
  });
  const [commandCopied, setCommandCopied] = useState(false);

  const agents: readonly LaunchAgentType[] = LAUNCH_AGENT_VALUES;
  const agentLabels: Record<string, string> = {
    claude: 'Claude',
    cursor: 'Cursor',
    codex: 'Codex',
    opencode: 'OpenCode'
  };

  const pluginGroups = [
    {
      key: 'claude',
      label: 'Claude Code',
      plugins: [
        {
          label: 'Prompt / skills',
          description:
            'Installs the durable Overlord workflow bundle, including the Claude skill and permission hook integration.',
          supportNote: 'Managed by the desktop app in your local ~/.claude configuration.',
          status: 'installed' as const,
          installFiles:
            '~/.claude/skills/overlord-local/SKILL.md, ~/.claude/overlord-permission-hook.sh, ~/.claude/settings.json, ~/.claude/commands/connect.md, ~/.claude/commands/load.md, ~/.claude/commands/prompt.md, ~/.claude/commands/record-work.md'
        },
        {
          label: '/connect /load /prompt /record-work',
          description: 'Installs global slash commands for mid-session Overlord ticket operations.',
          supportNote:
            'Creates `/connect`, `/load`, `/prompt`, and `/record-work` in `~/.claude/commands/`.',
          status: 'installed' as const,
          installFiles:
            '~/.claude/commands/connect.md, ~/.claude/commands/load.md, ~/.claude/commands/prompt.md, ~/.claude/commands/record-work.md'
        }
      ]
    },
    {
      key: 'codex',
      label: 'Codex CLI',
      plugins: [
        {
          label: 'Chat plugin',
          description:
            'Installs the Overlord chat plugin into your home-local Codex plugin directories, bundles the Codex workflow skill, migrates any legacy Codex bundle config, and manages the Codex permission rules used for Overlord protocol commands.',
          supportNote:
            'Managed by the desktop app in ~/.agents/plugins, ~/.codex/plugins, and ~/.codex/rules/default.rules.',
          status: 'not_installed' as const,
          installFiles:
            '~/.agents/plugins/marketplace.json, ~/.codex/plugins/overlord, ~/.codex/rules/default.rules'
        }
      ]
    },
    {
      key: 'cursor',
      label: 'Cursor',
      plugins: [
        {
          label: 'Chat plugin + hooks',
          description:
            'Installs the Overlord Cursor plugin (skill, rules, MCP, commands) and merges a beforeSubmitPrompt hook into ~/.cursor/hooks.json so user follow-ups reach the ticket activity feed.',
          supportNote:
            'Managed by the desktop app or `ovld setup cursor` under ~/.cursor/plugins/local/overlord, ~/.cursor/hooks.json, and ~/.cursor/settings.json.',
          status: 'not_installed' as const,
          installFiles:
            '~/.cursor/plugins/local/overlord/**, ~/.cursor/hooks.json, ~/.cursor/settings.json'
        }
      ]
    },
    {
      key: 'gemini',
      label: 'Gemini CLI',
      plugins: [
        {
          label: '/connect /load /prompt /record-work',
          description: 'Installs global slash commands for mid-session Overlord ticket operations.',
          supportNote:
            'Creates `/connect`, `/load`, `/prompt`, and `/record-work` in `~/.gemini/commands/`. Run `/commands reload` in Gemini CLI after installing.',
          status: 'not_installed' as const,
          installFiles:
            '~/.gemini/commands/connect.toml, ~/.gemini/commands/load.toml, ~/.gemini/commands/prompt.toml, ~/.gemini/commands/record-work.toml'
        }
      ]
    },
    {
      key: 'opencode',
      label: 'OpenCode',
      plugins: [
        {
          label: 'Prompt / skills',
          description:
            'Installs durable Overlord workflow instructions and OpenCode config so ticket lifecycle rules, permissions, and slash commands live in local config.',
          supportNote: 'Managed by the desktop app in your local ~/.config/opencode configuration.',
          status: 'not_installed' as const,
          installFiles:
            '~/.config/opencode/AGENTS.md, ~/.config/opencode/opencode.json, ~/.config/opencode/commands/connect.md, ~/.config/opencode/commands/load.md, ~/.config/opencode/commands/prompt.md, ~/.config/opencode/commands/record-work.md'
        },
        {
          label: '/connect /load /prompt /record-work',
          description: 'Installs global slash commands for mid-session Overlord ticket operations.',
          supportNote:
            'Creates `/connect`, `/load`, `/prompt`, and `/record-work` in `~/.config/opencode/commands/`.',
          status: 'not_installed' as const,
          installFiles:
            '~/.config/opencode/commands/connect.md, ~/.config/opencode/commands/load.md, ~/.config/opencode/commands/prompt.md, ~/.config/opencode/commands/record-work.md'
        }
      ]
    }
  ];

  const statusBadge = (status: 'installed' | 'not_installed') => {
    if (status === 'installed') {
      return (
        <Badge variant="default" className="bg-green-600 text-xs">
          Installed
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-xs">
        Not installed
      </Badge>
    );
  };

  function handleAddFlag() {
    if (!flagInput.trim()) return;
    const flag = flagInput.trim();
    setAgentFlags(prev => ({
      ...prev,
      [selectedLocalAgent]: [...(prev[selectedLocalAgent] ?? []), flag]
    }));
    setFlagInput('');
  }

  function handleRemoveFlag(agent: string, index: number) {
    setAgentFlags(prev => ({
      ...prev,
      [agent]: (prev[agent] ?? []).filter((_, i) => i !== index)
    }));
  }

  function handleCopyCommand() {
    const flags = (agentFlags[selectedLocalAgent] ?? []).join(' ');
    const command = `ovld restart ${selectedLocalAgent}${flags ? ` ${flags}` : ''}`;
    void navigator.clipboard.writeText(command).catch(() => undefined);
    setCommandCopied(true);
    setTimeout(() => setCommandCopied(false), 2000);
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <p className="text-sm font-medium">Terminal agents & CLI</p>
        <p className="text-xs text-muted-foreground">
          Agents running in your terminal communicate with the Overlord Desktop App via CLI.
        </p>
      </div>

      <div className="grid gap-4">
        <div className="grid gap-1">
          <p className="text-sm font-medium">Default agent</p>
          <p className="text-xs text-muted-foreground">
            Choose your default agent, model, and thinking level for launching tasks.
          </p>
        </div>
        <div className="rounded-md border bg-muted/30 p-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Terminal className="h-4 w-4" />
            <span>Claude Code</span>
            <span className="text-xs">·</span>
            <span className="text-xs">opus-4-6</span>
            <span className="text-xs">·</span>
            <span className="text-xs">Extended thinking</span>
          </div>
        </div>
        <div className="grid gap-2">
          <p className="text-xs text-muted-foreground">
            Default quick-launch target for the Run menu.
          </p>
          <Select value="claude" onValueChange={() => {}}>
            <SelectTrigger>
              <SelectValue placeholder="Select default agent" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="claude">Claude Code</SelectItem>
              <SelectItem value="cursor">Cursor</SelectItem>
              <SelectItem value="codex">Codex CLI</SelectItem>
              <SelectItem value="opencode">OpenCode</SelectItem>
              <SelectItem value="copy-local">Copy Local</SelectItem>
              <SelectItem value="copy-cloud">Copy Cloud</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4">
        <div className="grid gap-1">
          <p className="text-sm font-medium">Local agent configuration</p>
          <p className="text-xs text-muted-foreground">
            Add custom flags to the agent command when running locally. Claude has
            --enable-auto-mode enabled by default.
          </p>
        </div>
        <Select value={selectedLocalAgent} onValueChange={setSelectedLocalAgent}>
          <SelectTrigger>
            <SelectValue placeholder="Select agent" />
          </SelectTrigger>
          <SelectContent>
            {agents.map(agent => (
              <SelectItem key={agent} value={agent}>
                {agentLabels[agent]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-xs font-medium text-foreground">Command flags</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="e.g., --enable-auto-mode"
                value={flagInput}
                onChange={e => setFlagInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddFlag();
                  }
                }}
                className="flex-1 rounded border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                type="button"
                onClick={handleAddFlag}
                className="rounded border bg-muted px-3 py-2 text-xs font-medium hover:bg-muted/80"
              >
                Add
              </button>
            </div>
          </div>
          {(agentFlags[selectedLocalAgent] ?? []).length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {(agentFlags[selectedLocalAgent] ?? []).map((flag, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 rounded-md bg-muted px-2.5 py-1"
                  >
                    <code className="text-xs font-medium">{flag}</code>
                    <button
                      type="button"
                      onClick={() => handleRemoveFlag(selectedLocalAgent, index)}
                      className="rounded p-0.5 hover:bg-muted-foreground/20"
                      title="Remove flag"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-foreground">Command</p>
              <button
                type="button"
                onClick={handleCopyCommand}
                className="shrink-0 rounded p-1 hover:bg-muted"
                title="Copy command"
              >
                {commandCopied ? (
                  <Check className="h-3.5 w-3.5 text-green-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </button>
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs">
              {`ovld restart ${selectedLocalAgent}${
                (agentFlags[selectedLocalAgent] ?? []).length > 0
                  ? ` ${(agentFlags[selectedLocalAgent] ?? []).join(' ')}`
                  : ''
              }`}
            </pre>
          </div>
        </div>
      </div>

      <div className="grid gap-4">
        <div className="grid gap-1">
          <p className="text-sm font-medium">Agent plugins</p>
          <p className="text-xs text-muted-foreground">
            Install durable prompt and skill config where supported, plus mid-session ticket
            commands for agents that can handle{' '}
            <code className="rounded bg-muted px-1">/connect</code>,{' '}
            <code className="rounded bg-muted px-1">/load</code>, and{' '}
            <code className="rounded bg-muted px-1">/prompt</code>.
          </p>
        </div>
        <div className="space-y-2">
          {pluginGroups.map(group => (
            <div key={group.key} className="flex flex-col gap-3 rounded-md border bg-muted/30 p-3">
              <div className="grid gap-1">
                <p className="text-xs font-medium">{group.label}</p>
                <p className="text-xs text-muted-foreground">
                  {group.plugins.map(p => p.label).join(' • ')}
                </p>
              </div>
              <div className="grid gap-3">
                {group.plugins.map(plugin => (
                  <div key={plugin.label} className="rounded-md border bg-background p-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="grid gap-2">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-medium">{plugin.label}</p>
                          {statusBadge(plugin.status)}
                        </div>
                        <p className="text-xs text-muted-foreground">{plugin.description}</p>
                        <p className="text-xs text-muted-foreground">{plugin.supportNote}</p>
                        <p className="break-all text-xs text-muted-foreground">
                          Install updates:{' '}
                          <code className="rounded bg-muted px-1">{plugin.installFiles}</code>
                        </p>
                      </div>
                      <Button variant="outline" size="sm" className="shrink-0">
                        {plugin.status === 'installed' ? 'Remove' : 'Install'}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-1">
        <p className="text-sm font-medium">Overlord CLI (ovld)</p>
        <p className="text-xs text-muted-foreground">
          The CLI lets agents in Claude Code, Codex, Cursor, Gemini, and OpenCode work with Overlord
          tickets. Available commands:
        </p>
      </div>

      <div className="rounded-md border bg-muted/30 p-3 font-mono text-xs">
        <p className="mb-2 font-sans font-medium text-foreground">Top-level</p>
        <ul className="grid gap-1 text-muted-foreground">
          <li className="break-words">
            <code className="break-all rounded bg-muted px-1">ovld attach [ticketId] [agent]</code>{' '}
            interactive ticket picker + agent launcher
          </li>
          <li className="break-words">
            <code className="break-all rounded bg-muted px-1">
              ovld create &quot;&lt;objective&gt;&quot;
            </code>{' '}
            create a ticket with interactive project selection
          </li>
          <li className="break-words">
            <code className="break-all rounded bg-muted px-1">
              ovld prompt &quot;&lt;objective&gt;&quot;
            </code>{' '}
            create a ticket, then pick and launch an agent
          </li>
          <li className="break-words">
            <code className="rounded bg-muted px-1">ovld auth</code> login, status, logout
          </li>
          <li className="break-words">
            <code className="rounded bg-muted px-1">ovld tickets</code> create, list
          </li>
          <li className="break-words">
            <code className="rounded bg-muted px-1">ovld ticket</code> context
          </li>
          <li className="break-words">
            <code className="break-all rounded bg-muted px-1">
              ovld protocol &lt;subcommand&gt;
            </code>{' '}
            discover-project, attach, connect, load-context, prompt, update,
            record-change-rationales, ask, read-context, write-context, deliver,
            attachment-upload-file
          </li>
          <li className="break-words">
            <code className="break-all rounded bg-muted px-1">ovld launch &lt;agent&gt;</code>{' '}
            launch agent on a ticket
          </li>
          <li className="break-words">
            <code className="break-all rounded bg-muted px-1">ovld restart &lt;agent&gt;</code>{' '}
            resume an agent session
          </li>
          <li className="break-words">
            <code className="rounded bg-muted px-1">ovld context</code> print ticket context
            (requires TICKET_ID)
          </li>
          <li className="break-words">
            <code className="rounded bg-muted px-1">ovld setup &lt;agent|all&gt;</code> install
            local agent integrations
          </li>
          <li className="break-words">
            <code className="rounded bg-muted px-1">ovld doctor</code> validate installed connectors
            and check for CLI updates
          </li>
        </ul>
        <p className="mt-3 mb-2 font-sans font-medium text-foreground">Examples</p>
        <ul className="grid gap-1 text-muted-foreground">
          <li className="break-words">
            <code className="rounded bg-muted px-1">ovld attach</code> — interactive: search
            tickets, pick agent
          </li>
          <li className="break-words">
            <code className="break-all rounded bg-muted px-1">ovld protocol discover-project</code>{' '}
            — resolve the project from the current working directory
          </li>
          <li className="break-words">
            <code className="break-all rounded bg-muted px-1">
              ovld protocol connect --ticket-id &lt;ticketId&gt;
            </code>{' '}
            — connect to an existing ticket without loading full context
          </li>
          <li className="break-words">
            <code className="break-all rounded bg-muted px-1">
              ovld protocol load-context --ticket-id &lt;ticketId&gt;
            </code>{' '}
            — read-only ticket context fetch
          </li>
          <li className="break-words">
            <code className="break-all rounded bg-muted px-1">
              ovld protocol prompt --agent codex --objective &quot;...&quot; --execution-target
              agent
            </code>{' '}
            — create and attach to a ticket in one call
          </li>
          <li className="break-words">
            <code className="break-all rounded bg-muted px-1">
              ovld protocol attachment-upload-file --session-key &lt;key&gt; --ticket-id &lt;id&gt;
              --objective-id &lt;objective-id&gt; --file ./spec.pdf --content-type application/pdf
            </code>
          </li>
        </ul>
        <p className="mt-2 text-muted-foreground">
          Run <code className="break-all rounded bg-muted px-1">ovld &lt;command&gt; --help</code>{' '}
          for more detail.
        </p>
      </div>

      <div className="rounded-md border p-3">
        <p className="text-sm font-medium text-green-600 dark:text-green-400">
          ovld v1.2.0 installed at /usr/local/bin/ovld
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Automatically updated when the desktop app updates.
        </p>
      </div>
    </div>
  );
}

function DemoCustomizationSettings() {
  const [customInstructions, setCustomInstructions] = useState(
    'Always prioritize security fixes. Ask for missing context before making assumptions. Avoid pushing changes without tests.'
  );

  const previewText = customInstructions.trim() || '_No custom instructions have been saved yet._';

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="demo-custom-instructions">Custom instructions</Label>
        <Textarea
          id="demo-custom-instructions"
          placeholder="Example: Always prioritize security fixes, ask for missing context, and avoid pushing changes without tests."
          rows={8}
          value={customInstructions}
          onChange={event => setCustomInstructions(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          These instructions support Markdown and are inserted at the beginning of every agent
          prompt whenever someone attaches to a ticket. Use them to share team conventions or
          priorities.
        </p>
        <p className="text-xs text-muted-foreground">
          Last refreshed {new Date().toLocaleString()}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Preview</p>
        <Button variant="outline" size="sm">
          Save instructions
        </Button>
      </div>
      <div className="rounded-md border bg-muted/30 p-3">
        <MarkdownContent compact>{previewText}</MarkdownContent>
      </div>
    </div>
  );
}

function DemoPlaceholder({ name }: { name: string }) {
  return (
    <div className="flex items-center justify-center rounded-lg border border-dashed p-12 text-sm text-muted-foreground">
      {name} settings would appear here.
    </div>
  );
}

function getPageContent(activeNav: string) {
  switch (activeNav) {
    case 'Terminal & IDE':
      return <DemoTerminalSettings />;
    case 'MCP & Cloud Agents':
      return <DemoMcpSettings />;
    case 'CLI & Local Agents':
      return <DemoCliSettings />;
    case 'Customization':
      return <DemoCustomizationSettings />;
    case 'Application':
      return <DemoApplicationSettings />;
    case 'Profile':
      return <DemoProfileSettings />;
    default:
      return <DemoPlaceholder name={activeNav} />;
  }
}

export function DemoSettings() {
  const [activeNav, setActiveNav] = useState('Terminal & IDE');

  return (
    <div className="overflow-hidden rounded-lg border bg-background shadow-sm">
      <SidebarProvider className="items-start">
        <Sidebar collapsible="none" className="hidden md:flex md:w-52">
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Workflow</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {workflowNavItems.map(item => (
                    <SidebarMenuItem key={item.name}>
                      <SidebarMenuButton
                        isActive={item.name === activeNav}
                        onClick={() => setActiveNav(item.name)}
                      >
                        <item.icon />
                        <span>{item.name}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarGroup>
              <SidebarGroupLabel>Application</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {appNavItems.map(item => (
                    <SidebarMenuItem key={item.name}>
                      <SidebarMenuButton
                        isActive={item.name === activeNav}
                        onClick={() => setActiveNav(item.name)}
                      >
                        <item.icon />
                        <span>{item.name}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarGroup>
              <SidebarGroupLabel>User</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {userNavItems.map(item => (
                    <SidebarMenuItem key={item.name}>
                      <SidebarMenuButton
                        isActive={item.name === activeNav}
                        onClick={() => setActiveNav(item.name)}
                      >
                        <item.icon />
                        <span>{item.name}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
        <main className="flex max-h-[600px] flex-1 flex-col overflow-hidden">
          <header className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
            {/* Mobile select */}
            <div className="flex w-full items-center md:hidden">
              <Select value={activeNav} onValueChange={setActiveNav}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allNavItems.map(item => (
                    <SelectItem key={item.name} value={item.name}>
                      <div className="flex items-center gap-2">
                        <item.icon className="h-4 w-4" />
                        <span>{item.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Desktop breadcrumb */}
            <div className="hidden items-center gap-2 md:flex">
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem>
                    <BreadcrumbLink href="#">Settings</BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage>{activeNav}</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            </div>
          </header>
          <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-6">
            {getPageContent(activeNav)}
          </div>
        </main>
      </SidebarProvider>
    </div>
  );
}
