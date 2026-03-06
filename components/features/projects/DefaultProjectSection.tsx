'use client';

import { DefaultProjectChooser } from '@/components/features/projects/DefaultProjectChooser';

export function DefaultProjectSection() {
  return (
    <section className="px-5 pt-5">
      <div className="flex flex-wrap items-center gap-2">
        <DefaultProjectChooser />
      </div>
    </section>
  );
}
