import { ArrowUpRight, Download } from 'lucide-react';
import { headers } from 'next/headers';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  CURRENT_DESKTOP_VERSION,
  desktopPlatforms,
  getDesktopManifestUrl,
  getDesktopPlatform,
  getDesktopVariantUrl
} from '@/lib/downloads/desktop';
import { detectDesktopPlatform } from '@/lib/downloads/platform';
import { cn } from '@/lib/utils';

const recommendedMessages = {
  macos: 'We detected macOS and highlighted the Apple Silicon installer first.',
  linux:
    'We detected Linux and highlighted the portable AppImage first. Linux downloads are currently in beta.',
  windows:
    'Windows builds are not published yet, so all currently available desktop downloads are shown below.',
  unknown:
    'We could not confidently detect your platform, so all available desktop downloads are shown below.'
} as const;

function getRecommendedPlatform(platform: ReturnType<typeof detectDesktopPlatform>) {
  if (platform === 'macos' || platform === 'linux') {
    return getDesktopPlatform(platform);
  }

  return null;
}

export default async function DownloadsPage() {
  const headerStore = await headers();
  const userAgent = headerStore.get('user-agent') ?? '';
  const detectedPlatform = detectDesktopPlatform(userAgent);
  const recommendedPlatform = getRecommendedPlatform(detectedPlatform);
  const recommendedVariant = recommendedPlatform?.variants.find(variant => variant.isRecommended);

  return (
    <div className="mx-auto w-full max-w-4xl p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Downloads</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Get the latest Overlord desktop app for macOS or Linux.
        </p>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>Recommended for your device</CardTitle>
            {recommendedPlatform?.betaLabel ? (
              <Badge variant="secondary" className="rounded-full">
                {recommendedPlatform.betaLabel}
              </Badge>
            ) : null}
          </div>
          <CardDescription>{recommendedMessages[detectedPlatform]}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {recommendedPlatform && recommendedVariant ? (
            <>
              <div>
                <p className="text-sm font-medium">
                  {recommendedPlatform.label}, version {CURRENT_DESKTOP_VERSION}
                </p>
                <p className="text-muted-foreground mt-1 text-sm">
                  {recommendedVariant.description}
                </p>
                {recommendedPlatform.id === 'macos' ? (
                  <p className="text-muted-foreground mt-2 text-sm">
                    Intel mac builds are not published yet.
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-3">
                <Button asChild>
                  <a href={getDesktopVariantUrl(recommendedVariant.fileName)}>
                    <Download />
                    {recommendedVariant.label}
                  </a>
                </Button>
                <Button variant="outline" asChild>
                  <a href={getDesktopManifestUrl(recommendedPlatform.manifestFileName)}>
                    <ArrowUpRight />
                    View {recommendedPlatform.manifestFileName}
                  </a>
                </Button>
              </div>
            </>
          ) : (
            <div className="text-muted-foreground text-sm">
              Pick the installer that matches your machine from the full list below.
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {desktopPlatforms.map(platform => (
          <Card key={platform.id} className={cn(platform.id === 'linux' && 'border-dashed')}>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>{platform.label}</CardTitle>
                {platform.betaLabel ? (
                  <Badge variant="secondary" className="rounded-full">
                    {platform.betaLabel}
                  </Badge>
                ) : null}
              </div>
              <CardDescription>{platform.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {platform.variants.map(variant => (
                <div key={variant.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{variant.formatLabel}</p>
                    {variant.supportLabel ? (
                      <Badge variant="outline" className="rounded-full">
                        {variant.supportLabel}
                      </Badge>
                    ) : null}
                    {variant.isRecommended ? (
                      <Badge variant="secondary" className="rounded-full">
                        Recommended
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground mt-2 text-sm">{variant.description}</p>
                  <div className="mt-3 flex flex-wrap gap-3">
                    <Button variant="outline" asChild>
                      <a href={getDesktopVariantUrl(variant.fileName)}>
                        <Download />
                        {variant.label}
                      </a>
                    </Button>
                  </div>
                </div>
              ))}
              <Button variant="ghost" asChild>
                <a href={getDesktopManifestUrl(platform.manifestFileName)}>
                  <ArrowUpRight />
                  View {platform.manifestFileName}
                </a>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Compatibility notes</CardTitle>
          <CardDescription>Current desktop packaging support by platform.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>macOS downloads currently target Apple Silicon only.</p>
          <p>
            Linux downloads are in beta. AppImage is the recommended default; `.deb` is available
            for Debian-based systems.
          </p>
          <p>Windows installers are not published yet.</p>
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
