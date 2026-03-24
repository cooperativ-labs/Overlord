'use server';

import * as Sentry from '@sentry/nextjs';
import { Resend } from 'resend';

import { createClient } from '@/supabase/utils/server';

function getResendClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('Missing RESEND_API_KEY.');
  }
  return new Resend(apiKey);
}

function getFromEmail(): string {
  return (
    process.env.RESEND_FROM_EMAIL?.trim() || 'Overlord Feedback <ovld@notifications.cooperativ.io>'
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export type SubmitFeedbackResult = {
  error?: string;
  success?: string;
};

export async function submitFeedbackAction(
  description: string,
  screenshotPaths: string[]
): Promise<SubmitFeedbackResult> {
  if (!description.trim()) {
    return { error: 'Please enter a description.' };
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: 'You must be logged in to submit feedback.' };
  }

  // Save to database
  const { error: dbError } = await supabase.from('feedback').insert({
    user_id: user.id,
    description: description.trim(),
    screenshot_paths: screenshotPaths
  });

  if (dbError) {
    console.error('Failed to save feedback', dbError);
    Sentry.captureException(dbError);
    return { error: 'Could not save feedback. Please try again.' };
  }

  // Send email notification
  try {
    const resend = getResendClient();
    const screenshotSection =
      screenshotPaths.length > 0
        ? `<p><strong>Screenshots:</strong> ${screenshotPaths.length} attached</p><ul>${screenshotPaths.map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul>`
        : '';

    await resend.emails.send({
      from: getFromEmail(),
      to: ['ovld-feedback@cooperativ.io'],
      replyTo: user.email ?? undefined,
      subject: `Feedback from ${user.email ?? 'Unknown user'}`,
      text: [
        'New feedback submission',
        `From: ${user.email}`,
        `Description: ${description.trim()}`,
        screenshotPaths.length > 0 ? `Screenshots: ${screenshotPaths.join(', ')}` : ''
      ]
        .filter(Boolean)
        .join('\n'),
      html: `
        <h1>New feedback submission</h1>
        <p><strong>From:</strong> ${escapeHtml(user.email ?? 'Unknown')}</p>
        <p><strong>Description:</strong></p>
        <p>${escapeHtml(description.trim()).replace(/\n/g, '<br>')}</p>
        ${screenshotSection}
      `
    });
  } catch (error) {
    // Don't fail the whole submission if email fails — feedback is already saved
    console.error('Failed to send feedback email', error);
    Sentry.captureException(error);
  }

  return { success: 'Thank you for your feedback!' };
}

export async function uploadFeedbackScreenshot(
  formData: FormData
): Promise<{ path?: string; error?: string }> {
  const file = formData.get('file') as File | null;
  if (!file) {
    return { error: 'No file provided.' };
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: 'You must be logged in.' };
  }

  const ext = file.name.split('.').pop() ?? 'png';
  const path = `${user.id}/${Date.now()}.${ext}`;

  const { error } = await supabase.storage.from('feedback-screenshots').upload(path, file);

  if (error) {
    console.error('Failed to upload screenshot', error);
    Sentry.captureException(error);
    return { error: 'Failed to upload screenshot.' };
  }

  return { path };
}
