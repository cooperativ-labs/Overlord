import { getAgentSelectorLabel } from '@/components/modals/settings/cli/cli-page-constants';

describe('CliPage helper labels', () => {
  it('returns labels for copy prompt selector values', () => {
    expect(getAgentSelectorLabel('copy-local')).toBe('For Local');
    expect(getAgentSelectorLabel('copy-cloud')).toBe('For Cloud');
    expect(getAgentSelectorLabel('copy-terminal')).toBe('For Terminal');
  });
});
