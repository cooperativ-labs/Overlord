'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { type AppFeatureDefinition, type AppFeatureKey, getAppFeatures } from '@/lib/app-features';
import { isAdminEmail } from '@/lib/auth/admin';
import { createClientForRequest } from '@/supabase/utils/server';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

const createAppFeatureSchema = z.object({
  description: z
    .string({ error: 'Description is required.' })
    .trim()
    .min(1, { error: 'Description is required.' })
    .max(240, { error: 'Description must be 240 characters or fewer.' }),
  isEnabled: z.boolean(),
  key: z
    .string({ error: 'Feature key is required.' })
    .trim()
    .min(1, { error: 'Feature key is required.' })
    .max(64, { error: 'Feature key must be 64 characters or fewer.' })
    .transform(value => value.toLowerCase())
    .refine(value => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value), {
      error: 'Use lowercase letters, numbers, and hyphens only.'
    }),
  name: z
    .string({ error: 'Feature name is required.' })
    .trim()
    .min(1, { error: 'Feature name is required.' })
    .max(80, { error: 'Feature name must be 80 characters or fewer.' })
});

async function requireAdminUser(): Promise<void> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user || !isAdminEmail(user.email)) {
    throw new Error('Unauthorized');
  }
}

export async function getAdminAppFeaturesAction(): Promise<AppFeatureDefinition[]> {
  await requireAdminUser();
  return getAppFeatures();
}

export async function updateAppFeatureAction(
  key: AppFeatureKey,
  isEnabled: boolean
): Promise<AppFeatureDefinition> {
  await requireAdminUser();

  const current = (await getAppFeatures()).find(feature => feature.key === key);
  if (!current) {
    throw new Error(`Unknown feature: ${key}`);
  }

  const service = createServiceRoleClient();
  const { data, error } = await service
    .from('app_features')
    .upsert(
      {
        key,
        name: current.name,
        description: current.description,
        is_enabled: isEnabled,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'key' }
    )
    .select('*')
    .single();

  if (error || !data) {
    throw error ?? new Error('Failed to update app feature.');
  }

  revalidatePath('/admin');
  revalidatePath('/projects', 'layout');
  revalidatePath('/u');

  return {
    key: data.key,
    name: data.name,
    description: data.description,
    isEnabled: data.is_enabled,
    updatedAt: data.updated_at
  };
}

export async function createAppFeatureAction(input: unknown): Promise<AppFeatureDefinition> {
  await requireAdminUser();

  const parsed = createAppFeatureSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(z.prettifyError(parsed.error));
  }

  const service = createServiceRoleClient();
  const { data, error } = await service
    .from('app_features')
    .insert({
      key: parsed.data.key,
      name: parsed.data.name,
      description: parsed.data.description,
      is_enabled: parsed.data.isEnabled,
      updated_at: new Date().toISOString()
    })
    .select('*')
    .single();

  if (error || !data) {
    if (error?.code === '23505') {
      throw new Error(`Feature "${parsed.data.key}" already exists.`);
    }

    throw error ?? new Error('Failed to create app feature.');
  }

  revalidatePath('/admin');
  revalidatePath('/projects', 'layout');
  revalidatePath('/u');

  return {
    key: data.key,
    name: data.name,
    description: data.description,
    isEnabled: data.is_enabled,
    updatedAt: data.updated_at
  };
}
