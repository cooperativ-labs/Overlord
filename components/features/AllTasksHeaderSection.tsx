'use client';

import { DefaultProjectChooser } from '@/components/features/projects/DefaultProjectChooser';

type AllTasksHeaderSectionProps = {
  selectedOrgId?: number;
};

export function AllTasksHeaderSection({ selectedOrgId }: AllTasksHeaderSectionProps) {
  const title = selectedOrgId ? 'Team Tasks' : 'All Tasks';
  const description = selectedOrgId
    ? 'Showing tasks for the selected workspace.'
    : 'Tasks from all your workspaces.';

  return (
    <section className="px-5 py-5 border-b">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DefaultProjectChooser />
        </div>
      </div>
    </section>
  );
}
