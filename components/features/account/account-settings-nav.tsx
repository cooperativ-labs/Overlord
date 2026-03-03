'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

const accountLinks = [
  { href: '/account', label: 'Profile' },
  { href: '/account/sessions', label: 'Sessions' },
  { href: '/account/tokens', label: 'Agent tokens' }
] as const;

export function AccountSettingsNav() {
  const pathname = usePathname();

  return (
    <nav
      className="mb-6 flex flex-wrap gap-2 border-b pb-4"
      aria-label="Account settings navigation"
    >
      {accountLinks.map(link => {
        const isActive =
          pathname === link.href ||
          (link.href !== '/account' && pathname.startsWith(`${link.href}/`));

        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              'inline-flex h-8 items-center rounded-md px-3 text-sm font-medium transition-colors',
              isActive
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
