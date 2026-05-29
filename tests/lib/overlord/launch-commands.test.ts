import {
  buildAgentLaunchCommand,
  buildDirectAgentCommand,
  buildLaunchCommands,
  buildNativeResumeCommand,
  buildRawLaunchCommand
} from '@/lib/overlord/launch-commands';

describe('buildAgentLaunchCommand', () => {
  it('builds a local ovld launch command with model, thinking, and repeated flags', () => {
    expect(
      buildAgentLaunchCommand('codex', 'ticket-123', {
        workingDirectory: '/tmp/repo',
        model: 'gpt-5.4',
        thinking: 'high',
        flags: ['--sandbox workspace-write', '--profile product']
      })
    ).toBe(
      "ovld launch codex --ticket-id 'ticket-123' --working-directory '/tmp/repo' --model 'gpt-5.4' --thinking 'high' --flag '--sandbox workspace-write' --flag '--profile product'"
    );
  });

  it('builds a remote ovld launch command with ssh and tmux options', () => {
    expect(
      buildAgentLaunchCommand('claude', 'ticket-123', {
        sshCommand: 'ssh devbox',
        remoteWorkingDirectory: '/srv/app',
        serverMultiplexer: {
          enabled: true,
          tmuxCommand: 'tmux new-session -A -s overlord bash {script}'
        }
      })
    ).toBe(
      "ovld launch claude --ticket-id 'ticket-123' --ssh-command 'ssh devbox' --remote-working-directory '/srv/app' --server-multiplexer tmux --tmux-command 'tmux new-session -A -s overlord bash {script}'"
    );
  });
});

describe('buildDirectAgentCommand', () => {
  it('shows the native Claude invocation with pre-command, placeholders, and flags', () => {
    expect(
      buildDirectAgentCommand('claude', {
        preCommand: 'ai-pod',
        flags: ['--dangerously-skip-permissions']
      })
    ).toBe(
      'ai-pod claude --model <model> --effort <effort> --dangerously-skip-permissions <prompt>'
    );
  });

  it('uses agent-specific prompt and effort conventions', () => {
    expect(buildDirectAgentCommand('codex')).toBe(
      'codex --model <model> -c model_reasoning_effort="<effort>" <prompt>'
    );
    expect(buildDirectAgentCommand('opencode')).toBe('opencode --model <model> --prompt <prompt>');
    expect(buildDirectAgentCommand('antigravity')).toBe('agy --prompt-interactive <prompt>');
  });
});

describe('buildLaunchCommands', () => {
  it('threads assigned-agent defaults into the matching copy-command surface', () => {
    const commands = buildLaunchCommands({
      ticketId: 'ticket-123',
      platformUrl: 'https://www.ovld.ai',
      workingDirectory: '/Users/jake/Development/Cooperativ/Overlord',
      sshCommand: 'ssh devbox',
      remoteWorkingDirectory: '/srv/app',
      serverMultiplexer: {
        enabled: true,
        tmuxCommand: 'tmux new-session bash {script}'
      },
      agentFlags: {
        codex: ['--profile product'],
        claude: ['--verbose']
      },
      assignedAgent: {
        agent: 'codex',
        model: 'gpt-5.4',
        thinking: 'max'
      }
    });

    expect(commands.codex).toContain("ovld launch codex --ticket-id 'ticket-123'");
    expect(commands.codex).toContain(
      "--working-directory '/Users/jake/Development/Cooperativ/Overlord'"
    );
    expect(commands.codex).toContain("--model 'gpt-5.4'");
    expect(commands.codex).toContain("--thinking 'max'");
    expect(commands.codex).toContain("--flag '--profile product'");
    expect(commands.codex).toContain("--ssh-command 'ssh devbox'");
    expect(commands.codex).toContain("--remote-working-directory '/srv/app'");
    expect(commands.codex).toContain('--server-multiplexer tmux');
    expect(commands.claudeCode).not.toContain("--model 'gpt-5.4'");
    expect(commands.claudeCode).toContain("--flag '--verbose'");
  });
});

describe('buildNativeResumeCommand', () => {
  it('uses agy --conversation for Antigravity session ids', () => {
    expect(buildNativeResumeCommand('antigravity', 'conv-42')).toBe('agy --conversation conv-42');
    expect(buildNativeResumeCommand('agy', 'conv-42')).toBe('agy --conversation conv-42');
  });
});

describe('buildRawLaunchCommand', () => {
  it('uses ovld launch for env-prefixed fallback commands', () => {
    expect(
      buildRawLaunchCommand('antigravity', {
        ticketId: 'ticket-123',
        platformUrl: 'https://www.ovld.ai',
        oauthAccessToken: 'token-123',
        organizationId: 7
      })
    ).toBe(
      "OVERLORD_URL=https://www.ovld.ai OVERLORD_ACCESS_TOKEN=token-123 OVERLORD_ORGANIZATION_ID=7 ovld launch antigravity --ticket-id 'ticket-123'"
    );
  });
});
