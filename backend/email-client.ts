import { Resend } from 'resend';

let resendClient: Resend | null = null;

/** Lazily constructed Resend client shared by the transactional email senders. */
export function requireResendClient(): Resend {
  resendClient ??= new Resend(process.env.RESEND_API_KEY);
  return resendClient;
}
