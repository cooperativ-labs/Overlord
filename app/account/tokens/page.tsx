import { redirect } from 'next/navigation';

export default async function AccountTokensPage() {
  redirect('/u?settings=Agent%20tokens');
}
