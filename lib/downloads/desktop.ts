import packageJson from '../../package.json';

export type DesktopPlatform = 'linux' | 'macos';
export type DesktopVariant = {
  id: string;
  label: string;
  description: string;
  fileName: string;
  formatLabel: string;
  supportLabel?: string;
  isRecommended?: boolean;
};

export type DesktopPlatformEntry = {
  id: DesktopPlatform;
  label: string;
  description: string;
  betaLabel?: string;
  manifestFileName: string;
  variants: DesktopVariant[];
};

export const CURRENT_DESKTOP_VERSION = (packageJson as { version: string }).version;

export const PUBLIC_STORAGE_BASE =
  (process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '') ??
    'https://zitmmhvbilhjjdwgxlfm.supabase.co') +
  '/storage/v1/object/public/app-downloads/electron';

export const desktopPlatforms: DesktopPlatformEntry[] = [
  {
    id: 'macos',
    label: 'macOS',
    description: 'Apple Silicon builds with signed DMG and ZIP artifacts.',
    manifestFileName: 'latest-mac.yml',
    variants: [
      {
        id: 'dmg',
        label: 'Download .dmg',
        description: 'Standard macOS installer for Apple Silicon machines.',
        fileName: `Overlord-${CURRENT_DESKTOP_VERSION}-mac-arm64.dmg`,
        formatLabel: '.dmg',
        supportLabel: 'Apple Silicon',
        isRecommended: true
      },
      {
        id: 'zip',
        label: 'Download .zip',
        description: 'Portable archive for manual installs or debugging.',
        fileName: `Overlord-${CURRENT_DESKTOP_VERSION}-mac-arm64.zip`,
        formatLabel: '.zip',
        supportLabel: 'Apple Silicon'
      }
    ]
  },
  {
    id: 'linux',
    label: 'Linux',
    description: 'Broad distro support with a portable AppImage and Debian package.',
    betaLabel: 'Beta',
    manifestFileName: 'latest-linux.yml',
    variants: [
      {
        id: 'appimage',
        label: 'Download AppImage',
        description: 'Portable build with the broadest compatibility across distros.',
        fileName: `Overlord-${CURRENT_DESKTOP_VERSION}-linux-x64.AppImage`,
        formatLabel: 'AppImage',
        supportLabel: 'x64',
        isRecommended: true
      },
      {
        id: 'deb',
        label: 'Download .deb',
        description: 'Better desktop integration for Debian and Ubuntu systems.',
        fileName: `Overlord-${CURRENT_DESKTOP_VERSION}-linux-amd64.deb`,
        formatLabel: '.deb',
        supportLabel: 'Debian/Ubuntu'
      }
    ]
  }
];

export function getDesktopPlatform(platform: DesktopPlatform): DesktopPlatformEntry {
  return desktopPlatforms.find(entry => entry.id === platform) ?? desktopPlatforms[0];
}

export function getDesktopVariantUrl(fileName: string) {
  return `${PUBLIC_STORAGE_BASE}/${CURRENT_DESKTOP_VERSION}/${fileName}`;
}

export function getDesktopManifestUrl(fileName: string) {
  return `${PUBLIC_STORAGE_BASE}/${fileName}`;
}
