import {
  hasCustomProtocol,
  isHttpUrl,
  isLikelyFileLink,
  resolveExternalLinkHref
} from '@/lib/helpers/external-links';

describe('external link helpers', () => {
  it('keeps http links browser-safe and externalizable in Electron', () => {
    expect(isHttpUrl('https://ovld.ai')).toBe(true);
    expect(hasCustomProtocol('https://ovld.ai')).toBe(true);

    expect(
      resolveExternalLinkHref({
        href: 'https://ovld.ai',
        isElectron: true
      })
    ).toEqual({
      resolvedHref: 'https://ovld.ai',
      shouldOpenViaApp: true,
      suppressInWeb: false
    });
  });

  it('recognizes repo-style file links and converts them to editor links in Electron', () => {
    expect(isLikelyFileLink('docs/CODEX_PLUGIN_UPGRADE_REVIEW.md')).toBe(true);

    expect(
      resolveExternalLinkHref({
        editorScheme: 'cursor://file',
        href: 'docs/CODEX_PLUGIN_UPGRADE_REVIEW.md#L12',
        isElectron: true,
        workspaceRoot: '/Users/jake/Development/Cooperativ/Overlord'
      })
    ).toEqual({
      resolvedHref:
        'cursor://file/Users/jake/Development/Cooperativ/Overlord/docs/CODEX_PLUGIN_UPGRADE_REVIEW.md',
      shouldOpenViaApp: true,
      suppressInWeb: false
    });
  });

  it('suppresses file links in web when editor context is available', () => {
    expect(
      resolveExternalLinkHref({
        editorScheme: 'cursor://file',
        href: 'docs/CODEX_PLUGIN_UPGRADE_REVIEW.md',
        isElectron: false,
        workspaceRoot: '/Users/jake/Development/Cooperativ/Overlord'
      })
    ).toEqual({
      resolvedHref:
        'cursor://file/Users/jake/Development/Cooperativ/Overlord/docs/CODEX_PLUGIN_UPGRADE_REVIEW.md',
      shouldOpenViaApp: false,
      suppressInWeb: true
    });
  });

  it('suppresses custom editor schemes in web', () => {
    expect(
      resolveExternalLinkHref({
        href: 'cursor://file/Users/jake/Development/Cooperativ/Overlord/docs/CODEX_PLUGIN_UPGRADE_REVIEW.md',
        isElectron: false
      })
    ).toEqual({
      resolvedHref:
        'cursor://file/Users/jake/Development/Cooperativ/Overlord/docs/CODEX_PLUGIN_UPGRADE_REVIEW.md',
      shouldOpenViaApp: false,
      suppressInWeb: true
    });
  });
});
