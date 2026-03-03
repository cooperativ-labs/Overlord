export function getSupabaseUrl(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  if (!value) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL.');
  }
  return value;
}

export function getSupabasePublishableKey(): string {
  const value =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;
  if (!value) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY).'
    );
  }
  return value;
}

export function getPlatformUrl(providedURL?: string | null): string {
  const value =
    providedURL ??
    process.env.OVERLORD_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    (typeof window !== 'undefined' && window.location?.origin ? window.location.origin : undefined);

  if (!value) {
    throw new Error('Missing platform URL. Set OVERLORD_URL or NEXT_PUBLIC_SITE_URL.');
  }
  return value;
}

export function getOverlordMcpUrl(): string {
  const value = process.env.NEXT_PUBLIC_OVERLORD_MCP_URL;
  if (!value) {
    throw new Error('Missing NEXT_PUBLIC_OVERLORD_MCP_URL.');
  }
  return value;
}

export function getSupabaseSecretKey(): string {
  const value = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value) {
    throw new Error('Missing SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY).');
  }
  return value;
}

/** Absolute path to the local workspace root, used to construct editor deep-links. */
export function getWorkspaceRoot(): string {
  return process.env.WORKSPACE_ROOT ?? '';
}

/**
 * URI scheme for opening files in the user's code editor.
 * Set CODE_EDITOR env var to: vscode (default), cursor, idea, webstorm, or a full custom scheme.
 * Examples: "vscode://file", "cursor://file", "idea://open?file="
 */
export function getEditorScheme(): string {
  const editor = process.env.CODE_EDITOR ?? 'vscode';
  switch (editor.toLowerCase()) {
    case 'cursor':
      return 'cursor://file';
    case 'idea':
    case 'webstorm':
    case 'phpstorm':
    case 'intellij':
      return 'idea://open?file=';
    case 'vscode':
      return 'vscode://file';
    default:
      // Allow a fully custom scheme like "mine://open?path="
      return editor;
  }
}
