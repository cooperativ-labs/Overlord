import type { Metadata } from "next";
import Link from "next/link";

import "./globals.css";

export const metadata: Metadata = {
  title: "Orchestrator",
  description: "Local-first AI agent orchestration dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <header className="topbar">
            <div>
              <h1 className="topbar-title">
                <Link href="/tickets">Orchestrator</Link>
              </h1>
              <p className="topbar-subtitle">
                Ticket orchestration for external AI agents
              </p>
            </div>
            <Link className="btn btn-primary" href="/tickets/new">
              New Ticket
            </Link>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
