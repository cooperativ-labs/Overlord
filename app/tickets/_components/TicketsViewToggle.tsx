"use client";

import { LayoutGrid, List } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

export default function TicketsViewToggle() {
  const searchParams = useSearchParams();
  const view = searchParams.get("view") ?? "board";

  return (
    <div className="view-toggle">
      <Link
        href="/tickets?view=board"
        className={view === "board" ? "active" : ""}
        title="Board view"
      >
        <LayoutGrid size={16} />
      </Link>
      <Link
        href="/tickets?view=list"
        className={view === "list" ? "active" : ""}
        title="List view"
      >
        <List size={16} />
      </Link>
    </div>
  );
}
