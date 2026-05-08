import { ConfirmEmailForm } from './confirm-email-form';

type ConfirmEmailPageProps = {
  searchParams: Promise<{ email?: string; message?: string; next?: string }>;
};

export default async function ConfirmEmailPage({ searchParams }: ConfirmEmailPageProps) {
  const { email, message, next } = await searchParams;

  return <ConfirmEmailForm email={email} initialMessage={message} next={next} />;
}
