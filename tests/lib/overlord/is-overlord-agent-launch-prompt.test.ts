import { isLikelyOverlordAgentLaunchPrompt } from '@/lib/overlord/is-overlord-agent-launch-prompt';

describe('isLikelyOverlordAgentLaunchPrompt', () => {
  it('returns false for short or normal user text', () => {
    expect(isLikelyOverlordAgentLaunchPrompt('fix the bug')).toBe(false);
    expect(isLikelyOverlordAgentLaunchPrompt('x'.repeat(79))).toBe(false);
  });

  it('detects Overlord desktop ticket bootstrap', () => {
    const text = `
# Overlord Agent Instructions

You are an AI coding agent working on ticket **1:2** via Overlord.

## Task

- **Title:** Example
`.trim();
    expect(isLikelyOverlordAgentLaunchPrompt(text)).toBe(true);
  });

  it('detects bootstrap without hash heading when markers match', () => {
    const text = `${'x'.repeat(40)}
You are an AI coding agent working on ticket **1:2** via Overlord.

## Task

- **Title:** Example
`.trim();
    expect(isLikelyOverlordAgentLaunchPrompt(text)).toBe(true);
  });

  it('detects the context-file launch prompt used by AgentPod', () => {
    const text =
      'Begin working on this ticket.\n\nRead the Overlord launch context from ' +
      '/Users/jake/Development/Cooperativ/Overlord/.overlord/tmp/overlord-1-1430-context.md ' +
      'before taking action. Follow the ticket workflow and objective described in that file.';
    expect(isLikelyOverlordAgentLaunchPrompt(text)).toBe(true);
  });

  it('detects the context-file markers even when the prompt is short', () => {
    expect(
      isLikelyOverlordAgentLaunchPrompt('Read the Overlord launch context from /tmp/x-context.md')
    ).toBe(true);
    expect(
      isLikelyOverlordAgentLaunchPrompt(
        'Follow the ticket workflow and objective described in that file.'
      )
    ).toBe(true);
  });
});
