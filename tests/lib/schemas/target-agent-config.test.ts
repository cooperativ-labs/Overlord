import {
  normalizeAgentLaunchConfig,
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
