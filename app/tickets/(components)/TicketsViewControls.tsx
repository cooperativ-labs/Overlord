'use client';

import TicketsViewToggle from './TicketsViewToggle';

export default function TicketsViewControls({ initialView }: { initialView: string }) {
  return (
    <div className="flex items-center gap-2">
      <TicketsViewToggle initialView={initialView} />
    </div>
  );
}
