import { redirect } from 'next/navigation';

import { createClient } from '@/supabase/utils/server';

import { approveAuthorization, denyAuthorization } from './actions';

export default async function OAuthConsentPage({
  searchParams
}: {
  searchParams: Promise<{ authorization_id?: string; error?: string }>;
}) {
  const { authorization_id, error } = await searchParams;

  const errorMessages: Record<string, string> = {
    approval_failed: 'Failed to approve authorization. Please try again.',
    denial_failed: 'Failed to deny authorization. Please try again.'
  };

  if (error) {
    const message = errorMessages[error] ?? 'An unexpected error occurred.';
    return (
      <div className="flex min-h-dvh w-full items-center justify-center px-4">
        <div className="w-full max-w-md space-y-4 text-center">
          <h1 className="text-2xl font-semibold">Authorization Failed</h1>
          <p className="text-muted-foreground">{message}</p>
        </div>
      </div>
    );
  }

  if (!authorization_id) {
    return (
      <div className="flex min-h-dvh w-full items-center justify-center px-4">
        <div className="w-full max-w-md space-y-4 text-center">
          <h1 className="text-2xl font-semibold">Authorize Access</h1>
          <p className="text-muted-foreground">No authorization request found.</p>
        </div>
      </div>
    );
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    const next = `/oauth/consent?authorization_id=${encodeURIComponent(authorization_id)}`;
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  const { data: authDetails, error: detailsError } =
    await supabase.auth.oauth.getAuthorizationDetails(authorization_id);

  if (detailsError || !authDetails) {
    return (
      <div className="flex min-h-dvh w-full items-center justify-center px-4">
        <div className="w-full max-w-md space-y-4 text-center">
          <h1 className="text-2xl font-semibold">Request Not Found</h1>
          <p className="text-muted-foreground">
            This authorization request was not found or has expired.
          </p>
        </div>
      </div>
    );
  }

  // User already consented — redirect immediately
  if (!('authorization_id' in authDetails)) {
    redirect(authDetails.redirect_url);
  }

  const { client, scope } = authDetails;
  const scopes = scope ? scope.split(' ').filter(Boolean) : [];

  const approveWithId = approveAuthorization.bind(null, authorization_id);
  const denyWithId = denyAuthorization.bind(null, authorization_id);

  return (
    <div className="flex min-h-dvh w-full items-center justify-center px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-2 text-center">
          {client.logo_uri && (
            <img
              src={client.logo_uri}
              alt={`${client.name} logo`}
              className="mx-auto mb-4 h-12 w-12 rounded-lg object-contain"
            />
          )}
          <h1 className="text-2xl font-semibold">Authorize {client.name}</h1>
          <p className="text-muted-foreground">
            Signed in as <span className="font-medium">{user.email}</span>
          </p>
        </div>

        <div className="rounded-lg border bg-muted/50 p-4 space-y-2">
          <p className="text-sm font-medium">
            <span className="font-semibold">{client.name}</span> is requesting access to:
          </p>
          <ul className="space-y-1">
            {scopes.length > 0 ? (
              scopes.map(s => (
                <li key={s} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="text-xs">•</span>
                  <span className="font-mono">{s}</span>
                </li>
              ))
            ) : (
              <li className="text-sm text-muted-foreground">Basic account access</li>
            )}
          </ul>
        </div>

        {client.uri && (
          <p className="text-center text-xs text-muted-foreground">
            Only approve if you initiated this request from{' '}
            <span className="font-medium">{client.name}</span>.
          </p>
        )}

        <div className="flex gap-3">
          <form action={denyWithId} className="flex-1">
            <button
              type="submit"
              className="w-full rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
            >
              Deny
            </button>
          </form>
          <form action={approveWithId} className="flex-1">
            <button
              type="submit"
              className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring"
            >
              Approve
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
