import type { Metadata } from "next";
import Link from "next/link";

import { createClient } from "@/supabase/utils/server";
import { signOut } from "@/lib/actions/auth";

import "./globals.css";

export const metadata: Metadata = {
  title: "Orchestrator",
  description: "Local-first AI agent orchestration dashboard",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
            {user ? (
              <div className="topbar-user">
                <span className="topbar-email">{user.email}</span>
                <form action={signOut}>
                  <button type="submit" className="btn btn-ghost">
                    Sign out
                  </button>
                </form>
                <Link className="btn btn-primary" href="/tickets/new">
                  New Ticket
                </Link>
              </div>
            ) : (
              <Link className="btn btn-primary" href="/login">
                Sign in
              </Link>
            )}
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
