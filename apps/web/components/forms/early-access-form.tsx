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
    <div className="w-full max-w-xl rounded-[2rem] border border-stone-200 bg-white p-8 shadow-lg dark:border-white/10 dark:bg-white/5 dark:shadow-[0_30px_120px_-56px_rgba(15,23,42,0.85)] dark:backdrop-blur">
      <div className="mb-8 flex items-center justify-between gap-4">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-stone-600 transition hover:text-stone-900 dark:text-slate-300 dark:hover:text-white"
        >
          <ArrowLeft className="size-4" />
          Back to home
        </Link>
        <div className="flex items-center gap-2 text-sm font-medium text-stone-900 dark:text-white">
          <GalleryVerticalEnd className="size-4" />
          Overlord
        </div>
      </div>

      <FieldGroup>
        <div className="space-y-3 text-left">
          <p className="font-mono text-[11px] tracking-widest text-sky-600 uppercase dark:text-sky-400">
            Early Access
          </p>
          <h1 className="font-display text-4xl font-semibold tracking-tight text-stone-900 dark:text-white">
            Get early access to Overlord
          </h1>
          <FieldDescription className="text-base leading-7 text-stone-600 dark:text-slate-300">
            Tell us who you are and what role you play. We&apos;ll review your request and follow up
            soon.
          </FieldDescription>
        </div>

        {formError ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-100">
            {formError}
          </div>
        ) : null}

        {successMessage ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-50">
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
              className="border-stone-200 bg-stone-50 text-stone-900 placeholder:text-stone-400 dark:border-white/10 dark:bg-slate-950/40 dark:text-white dark:placeholder:text-slate-500"
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
              className="border-stone-200 bg-stone-50 text-stone-900 placeholder:text-stone-400 dark:border-white/10 dark:bg-slate-950/40 dark:text-white dark:placeholder:text-slate-500"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="early-access-role">Professional role</FieldLabel>
            <select
              id="early-access-role"
              name="role"
              required
              defaultValue=""
              className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-10 w-full rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-900 shadow-xs outline-none focus-visible:ring-[3px] dark:border-white/10 dark:bg-slate-950/40 dark:text-white"
            >
              <option value="" disabled className="text-stone-500 dark:text-slate-500">
                Select your role
              </option>
              {earlyAccessRoles.map(role => (
                <option
                  key={role}
                  value={role}
                  className="bg-white text-stone-900 dark:bg-slate-950 dark:text-white"
                >
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
              className="h-12 w-full rounded-full bg-stone-900 text-white hover:bg-stone-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
            />
          </Field>
        </form>
      </FieldGroup>
    </div>
  );
}
