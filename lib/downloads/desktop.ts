import packageJson from '../../package.json';

export type DesktopPlatform = 'linux' | 'macos';
export type DesktopVariant = {
  id: string;
  label: string;
  description: string;
  fileName: string;
  formatLabel: string;
  manifestFileName?: string;
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
    description: 'Signed macOS builds for both Apple Silicon and Intel Macs.',
    manifestFileName: 'latest-mac-arm64.yml',
    variants: [
      {
        id: 'dmg-arm64',
        label: 'Download Apple Silicon .dmg',
        description: 'Standard macOS installer for M-series and other Apple Silicon machines.',
        fileName: `Overlord-${CURRENT_DESKTOP_VERSION}-mac-arm64.dmg`,
        formatLabel: '.dmg',
        manifestFileName: 'latest-mac-arm64.yml',
        supportLabel: 'Apple Silicon',
        isRecommended: true
      },
      {
        id: 'zip-arm64',
        label: 'Download Apple Silicon .zip',
        description: 'Portable Apple Silicon archive for manual installs or debugging.',
        fileName: `Overlord-${CURRENT_DESKTOP_VERSION}-mac-arm64.zip`,
        formatLabel: '.zip',
        manifestFileName: 'latest-mac-arm64.yml',
        supportLabel: 'Apple Silicon'
      },
      {
        id: 'dmg-x64',
        label: 'Download Intel .dmg',
        description: 'Standard macOS installer for Intel-based Macs.',
        fileName: `Overlord-${CURRENT_DESKTOP_VERSION}-mac-x64.dmg`,
        formatLabel: '.dmg',
        manifestFileName: 'latest-mac-x64.yml',
        supportLabel: 'Intel'
      },
      {
        id: 'zip-x64',
        label: 'Download Intel .zip',
        description: 'Portable Intel archive for manual installs or debugging.',
        fileName: `Overlord-${CURRENT_DESKTOP_VERSION}-mac-x64.zip`,
        formatLabel: '.zip',
        manifestFileName: 'latest-mac-x64.yml',
        supportLabel: 'Intel'
      }
    ]
  },
  {
    id: 'linux',
    label: 'Linux',
    description: 'Linux amd64 (x86_64) builds with a portable AppImage and Debian package.',
    betaLabel: 'Beta',
    manifestFileName: 'latest-linux.yml',
    variants: [
      {
        id: 'appimage',
        label: 'Download amd64 AppImage',
        description: 'Portable amd64 build with the broadest compatibility across x86_64 distros.',
        fileName: `Overlord-${CURRENT_DESKTOP_VERSION}-linux-x86_64.AppImage`,
        formatLabel: 'AppImage',
        manifestFileName: 'latest-linux-amd64.yml',
        supportLabel: 'amd64 / x86_64',
        isRecommended: true
      },
      {
        id: 'deb',
        label: 'Download amd64 .deb',
        description: 'amd64 package with better desktop integration for Debian and Ubuntu systems.',
        fileName: `Overlord-${CURRENT_DESKTOP_VERSION}-linux-amd64.deb`,
        formatLabel: '.deb',
        manifestFileName: 'latest-linux-amd64.yml',
        supportLabel: 'amd64 Debian/Ubuntu'
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
