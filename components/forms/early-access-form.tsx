'use client';

import { ArrowLeft, GalleryVerticalEnd } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { type ButtonLoadingState, LoadingButton } from '@/components/ui/loading-button';
import { requestEarlyAccess } from '@/lib/actions/early-access';
import { earlyAccessRoles } from '@/lib/data/early-access';

export function EarlyAccessForm() {
  const [buttonState, setButtonState] = React.useState<ButtonLoadingState>('default');
  const [formError, setFormError] = React.useState<string>();
  const [successMessage, setSuccessMessage] = React.useState<string>();

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setButtonState('loading');
    setFormError(undefined);
    setSuccessMessage(undefined);

    const result = await requestEarlyAccess(new FormData(event.currentTarget));

    if (result.error) {
      setFormError(result.error);
      setButtonState('error');
      return;
    }

    setSuccessMessage(result.success ?? 'Thanks for your interest. We will get back to you soon.');
    setButtonState('success');
    event.currentTarget.reset();
  };

  return (
    <div className="w-full max-w-xl rounded-[2rem] border border-white/10 bg-white/5 p-8 shadow-[0_30px_120px_-56px_rgba(15,23,42,0.85)] backdrop-blur">
      <div className="mb-8 flex items-center justify-between gap-4">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-slate-300 transition hover:text-white"
        >
          <ArrowLeft className="size-4" />
          Back to home
        </Link>
        <div className="flex items-center gap-2 text-sm font-medium text-white">
          <GalleryVerticalEnd className="size-4" />
          Overlord
        </div>
      </div>

      <FieldGroup>
        <div className="space-y-3 text-left">
          <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.24em] text-sky-400">
            Early Access
          </p>
          <h1 className="font-[family-name:var(--font-display)] text-4xl font-semibold tracking-[-0.04em] text-white">
            Get early access to Overlord
          </h1>
          <FieldDescription className="text-base leading-7 text-slate-300">
            Tell us who you are and what role you play. We&apos;ll review your request and follow up
            soon.
          </FieldDescription>
        </div>

        {formError ? (
          <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {formError}
          </div>
        ) : null}

        {successMessage ? (
          <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-50">
            {successMessage}
          </div>
        ) : null}

        <form className="space-y-6" onSubmit={handleSubmit}>
          <Field>
            <FieldLabel htmlFor="early-access-name">Name</FieldLabel>
            <Input
              id="early-access-name"
              name="name"
              type="text"
              placeholder="Ada Lovelace"
              required
              autoComplete="name"
              className="border-white/10 bg-slate-950/40 text-white placeholder:text-slate-500"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="early-access-email">Email</FieldLabel>
            <Input
              id="early-access-email"
              name="email"
              type="email"
              placeholder="ada@company.com"
              required
              autoComplete="email"
              className="border-white/10 bg-slate-950/40 text-white placeholder:text-slate-500"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="early-access-role">Professional role</FieldLabel>
            <select
              id="early-access-role"
              name="role"
              required
              defaultValue=""
              className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-10 w-full rounded-md border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-white shadow-xs outline-none focus-visible:ring-[3px]"
            >
              <option value="" disabled className="text-slate-500">
                Select your role
              </option>
              {earlyAccessRoles.map(role => (
                <option key={role} value={role} className="bg-slate-950 text-white">
                  {role}
                </option>
              ))}
            </select>
          </Field>

          <Field className="pt-2">
            <LoadingButton
              type="submit"
              buttonState={buttonState}
              setButtonState={setButtonState}
              text="Request early access"
              loadingText="Sending request..."
              successText="Request received"
              errorText="Try again"
              className="h-12 w-full rounded-full bg-white text-slate-950 hover:bg-slate-100"
            />
          </Field>
        </form>
      </FieldGroup>
    </div>
  );
}
