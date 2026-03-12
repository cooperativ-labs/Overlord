import { FileCode2 } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';

type UnavailableStateCardProps = {
  backHref: string;
  description: string;
};

export function UnavailableStateCard({ backHref, description }: UnavailableStateCardProps) {
  return (
    <div className="rounded-xl border p-6">
      <div className="flex items-center gap-2 text-foreground">
        <FileCode2 className="h-5 w-5" />
        <h2 className="text-lg font-semibold">Current Changes</h2>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      <Button asChild className="mt-4" variant="outline">
        <Link href={backHref}>Back to project</Link>
      </Button>
    </div>
  );
}
