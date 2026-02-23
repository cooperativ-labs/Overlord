import { ArrowUpRight, Download } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import packageJson from '../../package.json';

const CURRENT_DESKTOP_VERSION = (packageJson as { version: string }).version;
const PUBLIC_STORAGE_BASE =
  (process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '') ??
    'https://zitmmhvbilhjjdwgxlfm.supabase.co') +
  '/storage/v1/object/public/app-downloads/electron';

const desktopDownloads = {
  dmg: `${PUBLIC_STORAGE_BASE}/${CURRENT_DESKTOP_VERSION}/Overlord-${CURRENT_DESKTOP_VERSION}-mac-arm64.dmg`,
  zip: `${PUBLIC_STORAGE_BASE}/${CURRENT_DESKTOP_VERSION}/Overlord-${CURRENT_DESKTOP_VERSION}-mac-arm64.zip`,
  latestMacManifest: `${PUBLIC_STORAGE_BASE}/latest-mac.yml`
};

export default function DownloadsPage() {
  return (
    <div className="mx-auto w-full max-w-4xl p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Downloads</h1>
        <p className="text-muted-foreground mt-1 text-sm">Get the latest Overlord desktop app.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Desktop App</CardTitle>
          <CardDescription>
            macOS (Apple Silicon), version {CURRENT_DESKTOP_VERSION}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button asChild>
            <a href={desktopDownloads.dmg}>
              <Download />
              Download .dmg
            </a>
          </Button>
          <Button variant="outline" asChild>
            <a href={desktopDownloads.zip}>
              <Download />
              Download .zip
            </a>
          </Button>
          <Button variant="ghost" asChild>
            <a href={desktopDownloads.latestMacManifest}>
              <ArrowUpRight />
              View latest-mac.yml
            </a>
          </Button>
        </CardContent>
      </Card>

      <p className="text-muted-foreground mt-6 text-sm">
        Looking for account settings?{' '}
        <Link href="/account" className="text-foreground underline underline-offset-4">
          Go to account
        </Link>
        .
      </p>
    </div>
  );
}
