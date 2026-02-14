import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { signIn, signUp } from '@/lib/actions/auth';

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const { error, message } = await searchParams;

  return (
    <div className="mx-auto mt-10 w-full max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>Sign in to Orchestrator</CardTitle>
          <CardDescription>Use your email and password to access your tickets.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {message ? (
            <Alert>
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          ) : null}

          <form className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" required minLength={6} />
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button formAction={signUp} variant="outline">
                Sign up
              </Button>
              <Button formAction={signIn}>Sign in</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
