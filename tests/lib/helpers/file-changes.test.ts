import {
  buildDiffHref,
  parseFileChanges,
  toAttributionFilePaths
} from '@/lib/helpers/file-changes';

describe('file change helpers', () => {
  it('parses markdown file references and strips location suffixes', () => {
    expect(
      parseFileChanges(
        [
          '- [TicketPanelLive.tsx](/Users/jake/Development/Cooperativ/Overlord/components/features/TicketPanelLive.tsx#L157)',
          '1. [route.ts](/Users/jake/Development/Cooperativ/Overlord/app/api/foo/route.ts:12:3) - API update'
        ].join('\n')
      )
    ).toEqual([
      {
        label: 'TicketPanelLive.tsx',
        note: null,
        path: '/Users/jake/Development/Cooperativ/Overlord/components/features/TicketPanelLive.tsx'
      },
      {
        label: 'route.ts',
        note: 'API update',
        path: '/Users/jake/Development/Cooperativ/Overlord/app/api/foo/route.ts'
      }
    ]);
  });

  it('strips trailing file annotations from plain file lines', () => {
    expect(parseFileChanges('layout.tsx (new)\npage.tsx (deleted)')).toEqual([
      { label: null, note: null, path: 'layout.tsx' },
      { label: null, note: null, path: 'page.tsx' }
    ]);
  });

  it('keeps diff links for VS Code on relative workspace files', () => {
    expect(
      buildDiffHref(
        'components/features/FileChangesArtifact.tsx',
        '/Users/jake/Development/Cooperativ/Overlord',
        'vscode://file'
      )
    ).toBe(
      'vscode://vscode.git/openChange?path=file%3A%2F%2F%2FUsers%2Fjake%2FDevelopment%2FCooperativ%2FOverlord%2Fcomponents%2Ffeatures%2FFileChangesArtifact.tsx'
    );
  });

  it('falls back to file opens for JetBrains and absolute paths', () => {
    expect(
      buildDiffHref(
        '/Users/jake/Development/Cooperativ/Overlord/components/features/FileChangesArtifact.tsx',
        '/Users/jake/Development/Cooperativ/Overlord',
        'idea://open?file='
      )
    ).toBe(
      'idea://open?file=/Users/jake/Development/Cooperativ/Overlord/components/features/FileChangesArtifact.tsx'
    );
  });

  it('extracts file path from line with description text (no delimiter)', () => {
    expect(
      parseFileChanges(
        'Added docs/sunpeak-mcp-gap-analysis.md with a comparison of the current MCP implementation versus Sunpeak recommendations'
      )
    ).toEqual([
      {
        label: null,
        note: 'with a comparison of the current MCP implementation versus Sunpeak recommendations',
        path: 'docs/sunpeak-mcp-gap-analysis.md'
      }
    ]);
  });

  it('extracts file path from bulleted line with trailing description', () => {
    expect(
      parseFileChanges('- components/features/FileChangesArtifact.tsx updated rendering logic')
    ).toEqual([
      {
        label: null,
        note: 'updated rendering logic',
        path: 'components/features/FileChangesArtifact.tsx'
      }
    ]);
  });

  it('still handles plain file paths without description', () => {
    expect(parseFileChanges('lib/helpers/file-changes.ts')).toEqual([
      { label: null, note: null, path: 'lib/helpers/file-changes.ts' }
    ]);
  });

  it('extracts attribution paths from mixed artifact content', () => {
    expect(
      toAttributionFilePaths(
        [
          '2 files changed, 10 insertions(+), 4 deletions(-)',
          '- [FileChangesArtifact.tsx](/Users/jake/Development/Cooperativ/Overlord/components/features/FileChangesArtifact.tsx)',
          'lib/helpers/file-changes.ts | 42 ++++++++++++++++++++++++++++++++++',
          'tests/lib/helpers/file-changes.test.ts — added coverage'
        ].join('\n')
      )
    ).toEqual([
      '/Users/jake/Development/Cooperativ/Overlord/components/features/FileChangesArtifact.tsx',
      'lib/helpers/file-changes.ts',
      'tests/lib/helpers/file-changes.test.ts'
    ]);
  });
});
