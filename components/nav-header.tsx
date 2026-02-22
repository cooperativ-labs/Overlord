import Link from 'next/link';

import { NewTicketButton } from '@/components/features/NewTicketButton';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { signOut } from '@/lib/actions/auth';

type NavHeaderProps = {
  userEmail: string;
};

export function NavHeader({ userEmail }: NavHeaderProps) {
  return (
    <header className="electron-drag-region flex flex-col gap-4 border-b bg-card px-4 py-2 text-card-foreground md:flex-row md:items-center md:justify-between">
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger className="-ml-1 electron-no-drag" />
        <Separator orientation="vertical" className="h-4" />
        <h1 className="text-lg leading-tight font-semibold electron-no-drag">
          <Link href="/">Overlord</Link>
        </h1>
      </div>
      <div className="flex flex-wrap items-center gap-2 electron-no-drag">
        <span className="text-muted-foreground max-w-full truncate text-sm">{userEmail}</span>
        <form action={signOut}>
          <Button type="submit" variant="ghost">
            Sign out
          </Button>
        </form>
        <NewTicketButton />
      </div>
    </header>
  );
}
