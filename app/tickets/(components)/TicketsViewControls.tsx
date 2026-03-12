'use client';

import TicketsViewToggle from './TicketsViewToggle';

export default function TicketsViewControls({
  initialView,
  projectId
}: {
  initialView: string;
  projectId?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <TicketsViewToggle initialView={initialView} projectId={projectId} />
    </div>
  );
}
