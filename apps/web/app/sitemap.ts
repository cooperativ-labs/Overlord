import type { MetadataRoute } from 'next';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const SITE_URL = 'https://www.ovld.ai';
const APP_DIR = path.join(process.cwd(), 'app');

const EXCLUDED_GROUPS = new Set(['(app)', '(auth)']);
const EXTRA_PUBLIC_PATHS = ['/llms.txt', '/llms-full.txt'] as const;

function isDynamicSegment(segment: string): boolean {
  return segment.startsWith('[') && segment.endsWith(']');
}

function toRoutePath(pageFile: string): string | null {
  const relativePath = pageFile
    .replace(APP_DIR, '')
    .replace(/^\//, '')
    .replace(/\/page\.tsx$/, '');

  if (!relativePath) {
    return '/';
  }

  const segments = relativePath.split('/');

  if (
    segments.some(
      segment =>
        EXCLUDED_GROUPS.has(segment) || isDynamicSegment(segment) || segment.startsWith('_')
    )
  ) {
    return null;
  }

  const cleanSegments = segments.filter(
    segment => !segment.startsWith('(') || !segment.endsWith(')')
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

    if (entry.isFile() && entry.name === 'page.tsx') {
      pageFiles.push(entryPath);
    }
  }

  return pageFiles;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const pageFiles = await getPageFiles(APP_DIR);
  const routes = new Set<string>(EXTRA_PUBLIC_PATHS);

  for (const pageFile of pageFiles) {
    const routePath = toRoutePath(pageFile);
    if (routePath) {
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
