import { ConfirmEmailForm } from './confirm-email-form';

type ConfirmEmailPageProps = {
  searchParams: Promise<{ email?: string; next?: string }>;
};

export default async function ConfirmEmailPage({ searchParams }: ConfirmEmailPageProps) {
  const { email, next } = await searchParams;

  return <ConfirmEmailForm email={email} next={next} />;
}
