'use server';

import * as Sentry from '@sentry/nextjs';
import { Resend } from 'resend';
import { z } from 'zod';

import { EARLY_ACCESS_ROLES } from '@/lib/data/early-access';
import { createClientForRequest } from '@/supabase/utils/server';

const earlyAccessSchema = z.object({
  name: z
    .string({ error: 'Name is required.' })
    .trim()
    .min(1, { error: 'Name is required.' })
    .max(120, { error: 'Name is too long.' }),
  email: z.email({ error: 'Enter a valid email address.' }),
  role: z.enum(EARLY_ACCESS_ROLES, {
    error: 'Select your professional role.'
  })
});

export type EarlyAccessResult = {
  error?: string;
  success?: string;
};

function getResendClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY?.trim();

  if (!apiKey) {
    throw new Error('Missing RESEND_API_KEY.');
  }

  return new Resend(apiKey);
}

function getFromEmail(): string {
  return (
    process.env.RESEND_FROM_EMAIL?.trim() || 'Overlord Access <ovld@notifications.cooperativ.io>'
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

export async function requestEarlyAccess(formData: FormData): Promise<EarlyAccessResult> {
  const parsed = earlyAccessSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    role: formData.get('role')
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: issue?.message ?? 'Enter your details and try again.' };
  }

  const { name, email, role } = parsed.data;

  try {
    const supabase = await createClientForRequest();
    const { error: insertError } = await supabase.from('early_access_requests').insert({
      name,
      email,
      role
    });

    if (insertError) {
      console.error('Failed to save early access request', insertError);
      Sentry.captureException(insertError);
      return { error: 'We could not submit your request right now. Please try again soon.' };
    }

    try {
      const resend = getResendClient();

      await resend.emails.send({
        from: getFromEmail(),
        to: ['ovld-access@cooperativ.io'],
        replyTo: email,
        subject: `Early access request from ${name}`,
        text: [
          'New early access request',
          `Name: ${name}`,
          `Email: ${email}`,
          `Role: ${role}`
        ].join('\n'),
        html: `
          <h1>New early access request</h1>
          <p><strong>Name:</strong> ${escapeHtml(name)}</p>
          <p><strong>Email:</strong> ${escapeHtml(email)}</p>
          <p><strong>Professional role:</strong> ${escapeHtml(role)}</p>
        `
      });
    } catch (error) {
      console.error('Failed to send early access email', error);
      Sentry.captureException(error);
    }
  } catch (error) {
    console.error('Failed to save early access request', error);
    Sentry.captureException(error);
    return { error: 'We could not submit your request right now. Please try again soon.' };
  }

  return { success: 'Thanks for your interest. We will get back to you soon.' };
}
