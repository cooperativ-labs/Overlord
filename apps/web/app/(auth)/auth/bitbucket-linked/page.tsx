import Link from 'next/link';

import { BitbucketIcon } from '@/components/brand-icons/bitbucket-icon';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/components/ui/card';

export default function BitbucketLinkedPage() {
  return (
    <div className="w-full max-w-lg">
      <Card className="border-border/70 shadow-md">
        <CardHeader className="space-y-4 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-emerald-500/12 text-emerald-600">
            <BitbucketIcon className="size-7" />
          </div>
          <div className="space-y-2">
            <CardTitle className="text-2xl">Bitbucket integration successful</CardTitle>
            <CardDescription className="text-base leading-6">
              Your Bitbucket account is now linked to Overlord.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 text-sm leading-6 text-muted-foreground">
          <div className="rounded-lg border bg-muted/30 p-4 text-foreground">
            <p className="font-medium">Next step</p>
            <p className="mt-1">
              Go to organization settings and set <span className="font-medium">Bitbucket</span> as
              your git provider.
            </p>
          </div>

          <p>
            If you started this flow from the desktop app, you can close this window and return to
            Overlord.
          </p>
        </CardContent>

        <CardFooter className="justify-center">
          <Button asChild variant="outline">
            <Link href="/login">Open Overlord</Link>
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
