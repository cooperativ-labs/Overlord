import {
  mergeAgentLaunchConfig,
  normalizeAgentLaunchConfig,
  parseObjectiveLaunchConfig,
  parseTargetAgentConfigs
} from '@/lib/schemas/target-agent-config';

describe('parseTargetAgentConfigs', () => {
  it('parses valid per-agent config', () => {
    const result = parseTargetAgentConfigs({
      claude: { flags: ['--foo'], preCommand: 'ollama' },
      codex: { flags: [] }
    });
    expect(result.claude).toEqual({ flags: ['--foo'], preCommand: 'ollama' });
    expect(result.codex).toEqual({ flags: [] });
  });

  it('returns an empty object for non-object input', () => {
    expect(parseTargetAgentConfigs(null)).toEqual({});
    expect(parseTargetAgentConfigs('nope')).toEqual({});
    expect(parseTargetAgentConfigs(['x'])).toEqual({});
  });

  it('drops entries that do not match the shape', () => {
    expect(parseTargetAgentConfigs({ claude: 123, codex: { flags: ['ok'] } })).toEqual({
      codex: { flags: ['ok'] }
    });
  });
});

describe('normalizeAgentLaunchConfig', () => {
  it('trims, dedupes and drops blank flags, and drops an empty pre-command', () => {
    expect(
      normalizeAgentLaunchConfig({ flags: [' --a ', '--a', '', '--b'], preCommand: '   ' })
    ).toEqual({ flags: ['--a', '--b'] });
  });

  it('keeps a non-empty pre-command trimmed', () => {
    expect(normalizeAgentLaunchConfig({ flags: [], preCommand: ' ollama ' })).toEqual({
      flags: [],
      preCommand: 'ollama'
    });
  });
});

describe('parseObjectiveLaunchConfig', () => {
  it('returns null when there is no override', () => {
    expect(parseObjectiveLaunchConfig(null)).toBeNull();
    expect(parseObjectiveLaunchConfig(undefined)).toBeNull();
  });

  it('parses a populated override', () => {
    expect(parseObjectiveLaunchConfig({ flags: ['--foo'], preCommand: 'ollama' })).toEqual({
      flags: ['--foo'],
      preCommand: 'ollama'
    });
  });

  it('preserves a present-but-empty override (explicit "none")', () => {
    expect(parseObjectiveLaunchConfig({ flags: [] })).toEqual({ flags: [] });
  });

  it('returns null for malformed input rather than throwing', () => {
    expect(parseObjectiveLaunchConfig({ flags: 'nope' })).toBeNull();
    expect(parseObjectiveLaunchConfig('nope')).toBeNull();
  });
});

describe('mergeAgentLaunchConfig', () => {
  it('clears pre-command when update sends null (server-action JSON)', () => {
    expect(
      mergeAgentLaunchConfig({ flags: ['--x'], preCommand: 'ollama' }, { preCommand: null })
    ).toEqual({ flags: ['--x'] });
  });

  it('clears pre-command when update sends a blank string', () => {
    expect(
      mergeAgentLaunchConfig({ flags: [], preCommand: 'ollama' }, { preCommand: '   ' })
    ).toEqual({ flags: [] });
  });

  it('leaves pre-command unchanged when update omits preCommand', () => {
    expect(
      mergeAgentLaunchConfig({ flags: ['--x'], preCommand: 'ollama' }, { flags: ['--y'] })
    ).toEqual({ flags: ['--y'], preCommand: 'ollama' });
  });

  it('sets a new pre-command when provided', () => {
    expect(mergeAgentLaunchConfig({ flags: [] }, { preCommand: ' agent-pod ' })).toEqual({
      flags: [],
      preCommand: 'agent-pod'
    });
  });
});
