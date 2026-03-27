import { buildEditorHref, normalizeFileLinkPath } from '@/lib/helpers/file-changes';

const FILE_LINK_WITH_EXTENSION_REGEX =
  /^(?:\.{1,2}\/|~\/)?(?:[^/?#]+\/)*[^/?#]+\.[A-Za-z0-9]{1,10}(?:[:#].*)?$/;
const ABSOLUTE_FILE_PATH_REGEX = /^(?:\/[^?#]+|[A-Za-z]:[\\/][^?#]*|\\\\[^?#]+)(?:[:#].*)?$/;

export function isHttpUrl(href: string): boolean {
  return href.startsWith('http://') || href.startsWith('https://');
}

export function hasCustomProtocol(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(href);
}

export function isLikelyFileLink(href: string): boolean {
  const trimmed = href.trim();
  if (!trimmed || isHttpUrl(trimmed) || hasCustomProtocol(trimmed)) return false;
  if (trimmed.startsWith('#') || trimmed.startsWith('?')) return false;

  return FILE_LINK_WITH_EXTENSION_REGEX.test(trimmed) || ABSOLUTE_FILE_PATH_REGEX.test(trimmed);
}

export function resolveExternalLinkHref({
  editorScheme,
  href,
  isElectron,
  workspaceRoot
}: {
  editorScheme?: string | null;
  href: string;
  isElectron: boolean;
  workspaceRoot?: string | null;
}) {
  const trimmedHref = href.trim();
  const normalizedWorkspaceRoot = workspaceRoot?.trim() ?? '';
  const normalizedEditorScheme = editorScheme?.trim() ?? '';
  const hasEditorContext = Boolean(normalizedWorkspaceRoot && normalizedEditorScheme);
  const isFileLink = isLikelyFileLink(trimmedHref);

  const resolvedHref =
    hasEditorContext && isFileLink
      ? buildEditorHref(
          normalizeFileLinkPath(trimmedHref),
          normalizedWorkspaceRoot,
          normalizedEditorScheme
        )
      : trimmedHref;

  const shouldOpenViaApp =
    isElectron && (isHttpUrl(resolvedHref) || hasCustomProtocol(resolvedHref));
  const suppressInWeb =
    !isElectron && (hasCustomProtocol(resolvedHref) || (hasEditorContext && isFileLink));

  return {
    resolvedHref,
    shouldOpenViaApp,
    suppressInWeb
  };
}
