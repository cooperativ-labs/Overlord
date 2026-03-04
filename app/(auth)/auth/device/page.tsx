import { redirect } from 'next/navigation';

import { createClient } from '@/supabase/utils/server';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

import { DeviceApproveForm } from './device-approve-form';

export default async function DeviceAuthPage({
  searchParams
}: {
  searchParams: Promise<{ code?: string; error?: string; approved?: string }>;
}) {
  const { code, error, approved } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    const next = code
      ? `/(auth)/auth/device?code=${encodeURIComponent(code)}`
      : '/(auth)/auth/device';
    redirect(`/(auth)/login?next=${encodeURIComponent(next)}`);
  }

  if (approved === '1') {
    return (
      <div className="w-full max-w-md space-y-4 text-center">
        <div className="text-4xl">✓</div>
        <h1 className="text-2xl font-semibold">CLI Authorized</h1>
        <p className="text-muted-foreground">
          Your CLI has been authorized. You can close this window and return to the terminal.
        </p>
      </div>
    );
  }

  const errorMessages: Record<string, string> = {
    not_found: 'Device code not found. Please run ovld auth login again.',
    expired: 'This authorization request has expired. Please run ovld auth login again.',
    already_approved: 'This device code has already been used.',
    no_organization: 'Your account has no organization. Please complete onboarding first.',
    token_creation_failed: 'Failed to create token. Please try again.',
    approval_failed: 'Failed to approve device. Please try again.'
  };

  if (error) {
    const message = errorMessages[error] ?? 'An unexpected error occurred.';
    return (
      <div className="w-full max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-semibold">Authorization Failed</h1>
        <p className="text-muted-foreground">{message}</p>
      </div>
    );
  }

  if (!code) {
    return (
      <div className="w-full max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-semibold">Authorize CLI</h1>
        <p className="text-muted-foreground">
          Run{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-sm">ovld auth login</code> in
          your terminal to start the authorization process.
        </p>
      </div>
    );
  }

  // Validate the code exists and isn't expired
  const service = createServiceRoleClient();
  const { data: deviceCode } = await service
    .from('device_auth_codes')
    .select('user_code, expires_at, approved_at')
    .eq('user_code', code)
    .single();

  if (!deviceCode) {
    return (
      <div className="w-full max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-semibold">Code Not Found</h1>
        <p className="text-muted-foreground">
          This authorization code was not found. Please run{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-sm">ovld auth login</code>{' '}
          again.
        </p>
      </div>
    );
  }

  if (new Date(deviceCode.expires_at) < new Date() || deviceCode.approved_at) {
    return (
      <div className="w-full max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-semibold">Code Expired</h1>
        <p className="text-muted-foreground">
          This authorization code has expired or already been used. Please run{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-sm">ovld auth login</code>{' '}
          again.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold">Authorize CLI Access</h1>
        <p className="text-muted-foreground">
          A CLI session is requesting access to your Overlord account as{' '}
          <span className="font-medium">{user.email}</span>.
        </p>
      </div>

      <div className="rounded-lg border bg-muted/50 p-6 text-center">
        <p className="mb-2 text-sm text-muted-foreground">Your authorization code</p>
        <p className="font-mono text-3xl font-bold tracking-widest">{code}</p>
      </div>

      <p className="text-center text-sm text-muted-foreground">
        Only approve this if you initiated this request from your terminal.
      </p>

      <DeviceApproveForm code={code} />
    </div>
  );
}
