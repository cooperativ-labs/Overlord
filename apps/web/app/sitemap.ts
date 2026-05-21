import type { MetadataRoute } from 'next';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { getPublishedChangelogSitemapPaths } from '@/lib/marketing/changelog-sitemap';
import { problemPages } from '@/lib/marketing/problem-pages';

const SITE_URL = 'https://www.ovld.ai';
const APP_DIR = path.join(process.cwd(), 'app');

const EXCLUDED_GROUPS = new Set(['(app)', '(auth)', '(quick)']);
const EXCLUDED_PATHS = new Set(['/onboarding']);
const EXTRA_PUBLIC_PATHS = [
  '/changelog',
  '/llms.txt',
  '/llms-full.txt',
  '/overlord-context',
  ...problemPages.map(page => `/problems/${page.slug}`)
] as const;

function isDynamicSegment(segment: string): boolean {
  return segment.startsWith('[') && segment.endsWith(']');
}

function isAppPageFile({ fileName }: { fileName: string }): boolean {
  return fileName === 'page.tsx' || fileName === 'page.ts';
}

function toRoutePath(pageFile: string): string | null {
  const relFromApp = path.relative(APP_DIR, pageFile);
  const normalized = relFromApp.split(path.sep).join('/');

  if (!/^\/?page\.(tsx|ts)$/.test(normalized) && !/\/page\.(tsx|ts)$/.test(normalized)) {
    return null;
  }

  const dirPart = normalized.replace(/\/?page\.(tsx|ts)$/, '');
  const segments = dirPart === '' ? [] : dirPart.split('/').filter(Boolean);

  if (
    segments.some(
      segment =>
        EXCLUDED_GROUPS.has(segment) || isDynamicSegment(segment) || segment.startsWith('_')
    )
  ) {
    return null;
  }

  const cleanSegments = segments.filter(
    segment => !(segment.startsWith('(') && segment.endsWith(')'))
  );

  if (cleanSegments.length === 0) {
    return '/';
  }

  return `/${cleanSegments.join('/')}`;
}

async function getPageFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const pageFiles: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const nestedPageFiles = await getPageFiles(entryPath);
      pageFiles.push(...nestedPageFiles);
      continue;
    }

    if (entry.isFile() && isAppPageFile({ fileName: entry.name })) {
      pageFiles.push(entryPath);
    }
  }

  return pageFiles;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const pageFiles = await getPageFiles(APP_DIR);
  const changelogPaths = await getPublishedChangelogSitemapPaths();
  const routes = new Set<string>([...EXTRA_PUBLIC_PATHS, ...changelogPaths]);

  for (const pageFile of pageFiles) {
    const routePath = toRoutePath(pageFile);
    if (routePath && !EXCLUDED_PATHS.has(routePath)) {
      routes.add(routePath);
    }
  }

  return Array.from(routes)
    .sort((a, b) => a.localeCompare(b))
    .map(routePath => ({
      url: `${SITE_URL}${routePath}`,
      lastModified: now,
      changeFrequency: routePath.startsWith('/docs') ? 'weekly' : 'monthly',
      priority: routePath === '/' ? 1 : 0.7
    }));
}
