'use client';

import Link from 'next/link';

import { Button } from '@/components/ui/button';

type UserTokensPageProps = {
  open: boolean;
  onViewAgentsAndMcp: () => void;
};

export function UserTokensPage({ open: _open, onViewAgentsAndMcp }: UserTokensPageProps) {
  return (
    <div className="max-w-2xl space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">Agent tokens</h2>
        <p className="text-sm text-muted-foreground">
          User tokens are no longer managed on this page. Open MCP & Cloud Agents to select an
          organization, view the active token for that workspace, and rotate it when needed.
        </p>
      </div>
      <div className="rounded-lg border bg-muted/20 p-4">
        <p className="text-sm text-foreground">
          Find your user tokens in the MCP & Cloud Agents settings page.
        </p>
        <div className="mt-3">
          <Button asChild>
            <Link
              href="#"
              onClick={event => {
                event.preventDefault();
                onViewAgentsAndMcp();
              }}
            >
              Go to MCP & Cloud Agents
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
