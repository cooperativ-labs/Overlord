import {
  getObjectiveLaunchConfigOverride,
  mergeAgentLaunchConfig,
  normalizeAgentLaunchConfig,
  parseObjectiveLaunchConfigOverrides,
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

describe('parseObjectiveLaunchConfigOverrides', () => {
  it('returns an empty map when there are no overrides', () => {
    expect(parseObjectiveLaunchConfigOverrides(null)).toEqual({});
    expect(parseObjectiveLaunchConfigOverrides(undefined)).toEqual({});
  });

  it('parses populated target and agent scoped overrides', () => {
    expect(
      parseObjectiveLaunchConfigOverrides({
        targetA: {
          claude: { flags: ['--foo'], preCommand: 'ollama' },
          codex: { flags: [] }
        }
      })
    ).toEqual({
      targetA: {
        claude: { flags: ['--foo'], preCommand: 'ollama' },
        codex: { flags: [] }
      }
    });
  });

  it('preserves a present-but-empty override (explicit "none")', () => {
    expect(
      getObjectiveLaunchConfigOverride({ targetA: { claude: { flags: [] } } }, 'targetA', 'claude')
    ).toEqual({ flags: [] });
  });

  it('returns null when the exact target and agent do not have an override', () => {
    const overrides = { targetA: { claude: { flags: ['--foo'] } } };
    expect(getObjectiveLaunchConfigOverride(overrides, 'targetB', 'claude')).toBeNull();
    expect(getObjectiveLaunchConfigOverride(overrides, 'targetA', 'codex')).toBeNull();
  });

  it('drops malformed entries rather than throwing', () => {
    expect(
      parseObjectiveLaunchConfigOverrides({
        targetA: { claude: { flags: 'nope' }, codex: { flags: ['ok'] } },
        targetB: 123
      })
    ).toEqual({ targetA: { codex: { flags: ['ok'] } } });
    expect(parseObjectiveLaunchConfigOverrides('nope')).toEqual({});
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
