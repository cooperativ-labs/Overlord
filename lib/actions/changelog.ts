'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { isAdminEmail } from '@/lib/auth/admin';
import { createClientForRequest } from '@/supabase/utils/server';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export type ChangelogStatus = 'draft' | 'published' | 'archived';

export type ChangelogEntry = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  body_markdown: string;
  body_html: string | null;
  status: ChangelogStatus;
  version: string | null;
  source_window_start: string | null;
  source_window_end: string | null;
  source_feed_post_ids: string[];
  drafted_by: string | null;
  published_by: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ChangelogEntrySummary = Pick<
  ChangelogEntry,
  'id' | 'slug' | 'title' | 'summary' | 'status' | 'version' | 'published_at' | 'updated_at'
>;

const updateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
        message: 'Slug must be lowercase letters, numbers, and hyphens only.'
      })
      .optional(),
    summary: z.string().trim().max(500).nullable().optional(),
    body_markdown: z.string().optional(),
    version: z.string().trim().max(60).nullable().optional()
  })
  .strict();

export type UpdateChangelogDraftInput = z.infer<typeof updateSchema>;

async function requireAdmin(): Promise<{ userId: string }> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    throw new Error('Unauthorized');
  }
  return { userId: user.id };
}

function makeSlugCandidate(base: string): string {
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (cleaned) return cleaned;
  const now = new Date();
  return `entry-${now.toISOString().slice(0, 10)}-${now.getTime()}`;
}

export async function listChangelogEntriesAction(): Promise<ChangelogEntry[]> {
  await requireAdmin();
  const service = createServiceRoleClient();
  const { data, error } = await service
    .from('changelog_entries')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ChangelogEntry[];
}

export async function listPublishedChangelogEntriesAction(limit = 20): Promise<ChangelogEntry[]> {
  const supabase = await createClientForRequest();
  const { data, error } = await supabase
    .from('changelog_entries')
    .select('*')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as ChangelogEntry[];
}

export async function getChangelogEntryBySlugAction(slug: string): Promise<ChangelogEntry | null> {
  const supabase = await createClientForRequest();
  const { data, error } = await supabase
    .from('changelog_entries')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'published')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as ChangelogEntry | null;
}

export async function getLatestPublishedChangelogEntryAction(): Promise<ChangelogEntry | null> {
  const supabase = await createClientForRequest();
  const { data, error } = await supabase
    .from('changelog_entries')
    .select('*')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as ChangelogEntry | null;
}

type GenerateDraftResult = {
  id: string;
  empty: boolean;
  windowStart: string | null;
  windowEnd: string | null;
};

export async function generateChangelogDraftAction(): Promise<GenerateDraftResult> {
  const { userId } = await requireAdmin();
  const service = createServiceRoleClient();

  const { data: invokeData, error: invokeError } = await service.functions.invoke(
    'generate-changelog-draft',
    { body: {} }
  );
  if (invokeError) {
    throw new Error(`Draft generation failed: ${invokeError.message}`);
  }
  const result = invokeData as {
    ok: boolean;
    empty: boolean;
    window_start: string | null;
    window_end: string | null;
    draft: {
      title: string;
      summary: string;
      body_markdown: string;
      suggested_slug: string;
      used_feed_post_ids: string[];
    };
  };

  // Ensure unique slug.
  let slug = makeSlugCandidate(result.draft.suggested_slug || result.draft.title);
  const { data: existing } = await service
    .from('changelog_entries')
    .select('slug')
    .like('slug', `${slug}%`);
  const taken = new Set((existing ?? []).map((r: { slug: string }) => r.slug));
  if (taken.has(slug)) {
    let n = 2;
    while (taken.has(`${slug}-${n}`)) n += 1;
    slug = `${slug}-${n}`;
  }

  const { data: inserted, error: insertError } = await service
    .from('changelog_entries')
    .insert({
      slug,
      title: result.draft.title,
      summary: result.draft.summary,
      body_markdown: result.draft.body_markdown,
      status: 'draft',
      source_window_start: result.window_start,
      source_window_end: result.window_end,
      source_feed_post_ids: result.draft.used_feed_post_ids,
      drafted_by: userId
    })
    .select('id')
    .single();
  if (insertError) throw new Error(insertError.message);

  revalidatePath('/admin');
  return {
    id: inserted.id as string,
    empty: result.empty,
    windowStart: result.window_start,
    windowEnd: result.window_end
  };
}

export async function updateChangelogDraftAction(
  id: string,
  fields: UpdateChangelogDraftInput
): Promise<ChangelogEntry> {
  await requireAdmin();
  const parsed = updateSchema.parse(fields);
  const service = createServiceRoleClient();
  const { data, error } = await service
    .from('changelog_entries')
    .update(parsed)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  revalidatePath('/admin');
  return data as ChangelogEntry;
}

export async function publishChangelogEntryAction(id: string): Promise<ChangelogEntry> {
  const { userId } = await requireAdmin();
  const service = createServiceRoleClient();
  const { data, error } = await service
    .from('changelog_entries')
    .update({
      status: 'published',
      published_at: new Date().toISOString(),
      published_by: userId
    })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  revalidatePath('/admin');
  revalidatePath('/changelog');
  revalidatePath(`/changelog/${data.slug}`);
  return data as ChangelogEntry;
}

export async function archiveChangelogEntryAction(id: string): Promise<ChangelogEntry> {
  await requireAdmin();
  const service = createServiceRoleClient();
  const { data, error } = await service
    .from('changelog_entries')
    .update({ status: 'archived' })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  revalidatePath('/admin');
  revalidatePath('/changelog');
  return data as ChangelogEntry;
}

/** Used by the in-app toast: any published entries the current user has not yet seen. */
export async function getUnreadChangelogEntriesAction(limit = 2): Promise<ChangelogEntrySummary[]> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: profile } = await supabase
    .from('profiles')
    .select('last_changelog_read_at')
    .eq('id', user.id)
    .maybeSingle();

  const since = profile?.last_changelog_read_at ?? new Date(0).toISOString();

  const { data, error } = await supabase
    .from('changelog_entries')
    .select('id, slug, title, summary, status, version, published_at, updated_at')
    .eq('status', 'published')
    .gt('published_at', since)
    .order('published_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as ChangelogEntrySummary[];
}

export async function markChangelogAsReadAction(): Promise<void> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase
    .from('profiles')
    .update({ last_changelog_read_at: new Date().toISOString() })
    .eq('id', user.id);
  if (error) throw new Error(error.message);
}
