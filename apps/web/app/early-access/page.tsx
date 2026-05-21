import type { Metadata } from 'next';

import { EarlyAccessForm } from '@/components/forms/early-access-form';

export const metadata: Metadata = {
  title: 'Get Early Access | Overlord',
  description: 'Request early access to Overlord and tell us a bit about your professional role.'
};

export default function EarlyAccessPage() {
  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#f6f4ef] text-stone-900 dark:bg-[#020817] dark:text-white">
      <div className="pointer-events-none absolute inset-0 hidden dark:block dark:bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.2),_transparent_28%),radial-gradient(circle_at_80%_20%,_rgba(56,189,248,0.16),_transparent_22%),radial-gradient(circle_at_bottom,_rgba(15,23,42,0.85),_transparent_48%)]" />
      <div className="relative mx-auto flex min-h-dvh max-w-6xl items-center justify-center px-6 py-16 sm:px-8">
        <EarlyAccessForm />
      </div>
    </div>
  );
}
