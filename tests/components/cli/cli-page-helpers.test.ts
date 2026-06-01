import {
  emptyDraft,
  getBundleActionMeta,
  getSlashActionMeta,
  parseOptionsText,
  placeholdersToOptionsText,
  slugify
} from '@/components/modals/settings/cli/cli-page-helpers';
import type { CustomAgentPlaceholder } from '@/lib/schemas/agent-config';

describe('getBundleActionMeta', () => {
  it('maps each bundle status to the right action verb', () => {
    expect(getBundleActionMeta('installed').label).toBe('Remove');
    expect(getBundleActionMeta('partial').label).toBe('Repair');
    expect(getBundleActionMeta('error').label).toBe('Repair');
    expect(getBundleActionMeta('stale').label).toBe('Update');
    expect(getBundleActionMeta('not_installed').label).toBe('Install');
    expect(getBundleActionMeta(undefined).label).toBe('Install');
  });

  it('derives consistent loading/success/error copy', () => {
    expect(getBundleActionMeta('stale')).toEqual({
      label: 'Update',
      loadingText: 'Updating...',
      successText: 'Updated',
      errorText: 'Update failed'
    });
    expect(getBundleActionMeta('installed')).toEqual({
      label: 'Remove',
      loadingText: 'Removing...',
      successText: 'Removed',
      errorText: 'Remove failed'
    });
  });
});

describe('getSlashActionMeta', () => {
  it('toggles between Remove and Install based on status', () => {
    expect(getSlashActionMeta('installed').label).toBe('Remove');
    expect(getSlashActionMeta('partial').label).toBe('Remove');
    expect(getSlashActionMeta('not_installed').label).toBe('Install');
    expect(getSlashActionMeta(undefined)).toEqual({
      label: 'Install',
      loadingText: 'Installing...',
      successText: 'Installed',
      errorText: 'Install failed'
    });
  });
});

describe('slugify', () => {
  it('lowercases and hyphenates, trimming stray separators', () => {
    expect(slugify('Claude via Ollama')).toBe('claude-via-ollama');
    expect(slugify('  --Weird__Name!! ')).toBe('weird-name');
  });

  it('falls back to a default slug when nothing usable remains', () => {
    expect(slugify('!!!')).toBe('custom-agent');
    expect(slugify('')).toBe('custom-agent');
  });
});

describe('parseOptionsText / placeholdersToOptionsText round-trip', () => {
  it('parses value | label lines, defaulting the label to the value', () => {
    expect(parseOptionsText('sonnet | Sonnet\nopus\n  \nhaiku|Haiku')).toEqual([
      { value: 'sonnet', label: 'Sonnet' },
      { value: 'opus', label: 'opus' },
      { value: 'haiku', label: 'Haiku' }
    ]);
  });

  it('serializes back to text, omitting redundant labels', () => {
    const placeholder: CustomAgentPlaceholder = {
      token: 'model',
      label: 'Model',
      role: 'model',
      options: [
        { value: 'sonnet', label: 'Sonnet' },
        { value: 'opus', label: 'opus' }
      ]
    };
    expect(placeholdersToOptionsText(placeholder)).toBe('sonnet | Sonnet\nopus');
  });

  it('round-trips text through parse and serialize', () => {
    const text = 'sonnet | Sonnet\nopus';
    const placeholder: CustomAgentPlaceholder = {
      token: 'model',
      label: 'Model',
      role: 'model',
      options: parseOptionsText(text)
    };
    expect(placeholdersToOptionsText(placeholder)).toBe(text);
  });
});

describe('emptyDraft', () => {
  it('returns a blank draft', () => {
    expect(emptyDraft()).toEqual({
      id: '',
      name: '',
      commandTemplate: '',
      placeholders: {}
    });
  });
});
