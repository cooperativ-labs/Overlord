import Link from 'next/link';

import { FieldDescription, FieldGroup } from '@/components/ui/field';

type ConfirmEmailPageProps = {
  searchParams: Promise<{ email?: string }>;
};

export default async function ConfirmEmailPage({ searchParams }: ConfirmEmailPageProps) {
  const { email } = await searchParams;

  return (
    <div className="w-full max-w-md">
      <FieldGroup>
        <div className="rounded-lg border bg-card px-6 py-5 shadow-sm">
          <h1 className="text-xl font-semibold tracking-tight">Check your email</h1>
          <FieldDescription className="mt-2">
            We&apos;ve sent a confirmation link
            {email ? (
              <>
                {' '}
                to <span className="font-medium">{email}</span>
              </>
            ) : null}
            . Click the link to confirm your account and continue to Overlord.
          </FieldDescription>
          <FieldDescription className="mt-4 text-xs">
            If you don&apos;t see the email after a few minutes, check your spam folder or try a
            different address.
          </FieldDescription>
          <div className="mt-6 text-sm">
            <Link href="/(auth)/login" className="underline underline-offset-4">
              Back to sign in
            </Link>
          </div>
        </div>
      </FieldGroup>
    </div>
  );
}
