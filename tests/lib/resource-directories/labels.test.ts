import {
  defaultDirectoryLabel,
  labelFromDirectoryPath,
  uniqueDirectoryLabel
} from '@/lib/resource-directories/labels';

describe('labelFromDirectoryPath', () => {
  it('returns the last path segment', () => {
    expect(labelFromDirectoryPath('/Users/jake/Dev/Overlord')).toBe('Overlord');
    expect(labelFromDirectoryPath('/Users/jake/Dev/Overlord/')).toBe('Overlord');
    expect(labelFromDirectoryPath('C:\\Users\\jake\\Dev\\Overlord')).toBe('Overlord');
  });

  it('returns null for empty or root-only paths', () => {
    expect(labelFromDirectoryPath('')).toBeNull();
    expect(labelFromDirectoryPath('/')).toBeNull();
  });
});

describe('uniqueDirectoryLabel', () => {
  it('returns the base when unused', () => {
    expect(uniqueDirectoryLabel({ baseLabel: 'Overlord', existingLabels: ['other'] })).toBe(
      'Overlord'
    );
  });

  it('appends a numeric suffix on clash', () => {
    expect(
      uniqueDirectoryLabel({ baseLabel: 'Overlord', existingLabels: ['Overlord', 'Overlord-2'] })
    ).toBe('Overlord-3');
  });
});

describe('defaultDirectoryLabel', () => {
  it('derives and uniquifies from a directory path', () => {
    expect(
      defaultDirectoryLabel({
        directoryPath: '/workspace/Overlord',
        existingLabels: ['Overlord']
      })
    ).toBe('Overlord-2');
  });
});
