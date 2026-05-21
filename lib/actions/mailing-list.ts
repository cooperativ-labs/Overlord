'use server';

import * as Sentry from '@sentry/nextjs';

import { createClientForRequest } from '@/supabase/utils/server';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export type MailingListPreferences = {
  new_features: boolean;
};

export type MailingListEntry = {
  id: string;
  user_id: string;
  email: string;
  new_features: boolean;
  created_at: string;
  updated_at: string;
};

export async function getMailingListPreferencesAction(): Promise<{
  data?: MailingListPreferences;
  error?: string;
}> {
  try {
    const supabase = await createClientForRequest();
    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (!user) return { error: 'Not authenticated' };

    const { data, error } = await supabase
      .from('mailing_list')
      .select('new_features')
      .eq('user_id', user.id)
      .single();

    if (error) return { error: error.message };
    return { data: { new_features: data.new_features } };
  } catch (err) {
    Sentry.captureException(err);
    return { error: 'Failed to load mailing list preferences' };
  }
}

export async function updateMailingListPreferencesAction(
  preferences: Partial<MailingListPreferences>
): Promise<{ error?: string }> {
  try {
    const supabase = await createClientForRequest();
    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (!user) return { error: 'Not authenticated' };

    const { error } = await supabase
      .from('mailing_list')
      .upsert({ user_id: user.id, ...preferences }, { onConflict: 'user_id' });

    if (error) return { error: error.message };
    return {};
  } catch (err) {
    Sentry.captureException(err);
    return { error: 'Failed to update mailing list preferences' };
  }
}

// Admin: get all subscribers for a given email type.
export async function getMailingListSubscribersAction(
  emailType: keyof MailingListPreferences = 'new_features'
): Promise<{ data?: MailingListEntry[]; error?: string }> {
  try {
    const supabase = await createClientForRequest();
    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (!user?.email || user.email !== 'jake@cooperativ.io') {
      return { error: 'Unauthorized' };
    }

    const serviceClient = createServiceRoleClient();
    const { data, error } = await serviceClient
      .from('mailing_list')
      .select('*')
      .eq(emailType, true)
      .order('created_at', { ascending: false });

    if (error) return { error: error.message };
    return { data: data as MailingListEntry[] };
  } catch (err) {
    Sentry.captureException(err);
    return { error: 'Failed to load mailing list subscribers' };
  }
}

// Unsubscribe a user by email address anonymously (from footer unsubscribe link)
export async function unsubscribeEmailAction(
  email: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!email || !email.trim()) {
      return { success: false, error: 'Email address is required.' };
    }

    const serviceClient = createServiceRoleClient();
    const normalized = email.trim();
    const { data, error } = await serviceClient
      .from('mailing_list')
      .update({ new_features: false })
      .eq('email', normalized)
      .select('id');

    if (error) return { success: false, error: error.message };
    if (!data?.length) {
      return {
        success: false,
        error:
          'We could not find that email on our update list. Check the spelling or use the link from your email.'
      };
    }
    return { success: true };
  } catch (err) {
    Sentry.captureException(err);
    return { success: false, error: 'Failed to process unsubscribe request.' };
  }
}
