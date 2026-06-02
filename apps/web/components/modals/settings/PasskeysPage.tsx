'use client';

import { ArrowUpRight, Fingerprint, Info } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { PasskeysList } from '@/components/features/account/passkeys-list';
import { RegisterPasskeyButton } from '@/components/features/account/register-passkey-button';
import { ExternalLink } from '@/components/features/ExternalLink';
import { useElectron } from '@/components/features/terminal/useElectron';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { listPasskeysAction, type PasskeyEntry } from '@/lib/actions/passkeys';
import { getPlatformUrl } from '@/lib/env';

type PasskeysPageProps = {
  open: boolean;
};

export function PasskeysPage({ open }: PasskeysPageProps) {
  const { isElectron } = useElectron();
  const [passkeys, setPasskeys] = useState<PasskeyEntry[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadPasskeys = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const loaded = await listPasskeysAction();
      setPasskeys(loaded);
    } catch (err) {
      console.error('Failed to load passkeys:', err);
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load passkeys.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || isElectron) {
      setErrorMessage(null);
      return;
    }
    void loadPasskeys();
  }, [open, isElectron, loadPasskeys]);

  if (isElectron) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Passkeys</h2>
          <p className="text-muted-foreground text-sm">
            Passkeys let you sign in with your device&apos;s biometrics or security key instead of a
            password.
          </p>
        </div>

        <div className="relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-amber-500/[0.03] to-orange-500/[0.03] dark:from-amber-500/[0.06] dark:to-orange-500/[0.06] p-6 shadow-sm">
          {/* Subtle background glow effect */}
          <div className="absolute -right-12 -top-12 h-32 w-32 rounded-full bg-amber-500/10 blur-3xl" />
          <div className="absolute -left-12 -bottom-12 h-32 w-32 rounded-full bg-orange-500/10 blur-3xl" />

          <div className="relative flex gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
              <Fingerprint className="h-6 w-6" />
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <h3 className="text-base font-semibold tracking-tight">
                  Configure Passkeys in the Web App
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Passkey registration and authentication require a standard browser environment to
                  securely communicate with your operating system&apos;s authenticator (WebAuthn).
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  To add a fingerprint, face, or security key for passwordless sign-in, please open
                  Overlord in your web browser.
                </p>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <Button
                  asChild
                  variant="default"
                  className="shadow-md shadow-amber-500/5 hover:shadow-lg transition-all duration-300"
                >
                  <ExternalLink href={getPlatformUrl()}>
                    Open Web App
                    <ArrowUpRight className="ml-2 h-4 w-4" />
                  </ExternalLink>
                </Button>

                <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/40 px-3 py-1.5 rounded-lg border border-border/50">
                  <Info className="h-3.5 w-3.5" />
                  <span>Your active desktop session remains fully authenticated.</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading && !passkeys) {
    return <p className="text-sm text-muted-foreground">Loading passkeys...</p>;
  }

  if (!passkeys) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">
          {errorMessage ?? 'Passkeys are unavailable right now.'}
        </p>
        <Button variant="outline" onClick={() => void loadPasskeys()} disabled={isLoading}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}

      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Passkeys</h2>
          <p className="text-muted-foreground text-sm">
            Passkeys let you sign in with your device&apos;s biometrics or security key instead of a
            password.
          </p>
        </div>

        <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
          <div>
            <p className="text-sm font-medium">Add a passkey</p>
            <p className="text-sm text-muted-foreground">
              Register a fingerprint, face, or security key for fast, passwordless sign-in.
            </p>
          </div>
          <RegisterPasskeyButton onRegistered={loadPasskeys} />
        </div>
      </div>

      <Separator />

      <div className="space-y-4">
        <div>
          <h3 className="text-base font-semibold tracking-tight">Registered passkeys</h3>
          <p className="text-muted-foreground text-sm">
            Manage the passkeys linked to your account. You can rename or remove them at any time.
          </p>
        </div>
        <PasskeysList passkeys={passkeys} onChanged={loadPasskeys} />
      </div>
    </div>
  );
}
