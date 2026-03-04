import { AuthForm } from '@/components/forms/auth-form';

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; message?: string; next?: string }>;
}) {
  const { error, message, next } = await searchParams;

  return (
    <div className="w-full max-w-md">
      <AuthForm error={error} message={message} next={next} defaultMode="login" />
    </div>
  );
}
