'use server';

import { revalidatePath } from 'next/cache';

import {
  createBoardColumnSchema,
  reorderBoardColumnsSchema,
  updateBoardColumnSchema,
} from '@/lib/orchestrator/validation';
import { createClient } from '@/supabase/utils/server';

export async function createBoardColumnAction(formData: FormData) {
  const parsed = createBoardColumnSchema.safeParse({
    title: formData.get('title'),
    slug: formData.get('slug'),
    statuses: formData.getAll('statuses'),
    position: Number(formData.get('position')),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid board column.');
  }

  const supabase = await createClient();
  const { error } = await supabase.from('board_columns').insert({
    title: parsed.data.title,
    slug: parsed.data.slug,
    statuses: parsed.data.statuses,
    position: parsed.data.position,
  });

  if (error) {
    throw new Error(error.message ?? 'Failed to create board column.');
  }

  revalidatePath('/tickets');
}

export async function updateBoardColumnAction(columnId: string, formData: FormData) {
  const raw: Record<string, unknown> = {};
  if (formData.has('title')) raw.title = formData.get('title');
  if (formData.has('slug')) raw.slug = formData.get('slug');
  if (formData.has('statuses')) raw.statuses = formData.getAll('statuses');
  if (formData.has('position')) raw.position = Number(formData.get('position'));

  const parsed = updateBoardColumnSchema.safeParse(raw);

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid board column update.');
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('board_columns')
    .update(parsed.data)
    .eq('id', columnId);

  if (error) {
    throw new Error(error.message ?? 'Failed to update board column.');
  }

  revalidatePath('/tickets');
}

export async function deleteBoardColumnAction(columnId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from('board_columns').delete().eq('id', columnId);

  if (error) {
    throw new Error(error.message ?? 'Failed to delete board column.');
  }

  revalidatePath('/tickets');
}

export async function reorderBoardColumnsAction(orderedIds: string[]) {
  const parsed = reorderBoardColumnsSchema.safeParse({ orderedIds });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid reorder data.');
  }

  const supabase = await createClient();

  for (let i = 0; i < parsed.data.orderedIds.length; i++) {
    const { error } = await supabase
      .from('board_columns')
      .update({ position: i })
      .eq('id', parsed.data.orderedIds[i]);

    if (error) {
      throw new Error(error.message ?? 'Failed to reorder board columns.');
    }
  }

  revalidatePath('/tickets');
}
