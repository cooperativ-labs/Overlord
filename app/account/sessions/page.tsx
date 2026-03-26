import { redirect } from 'next/navigation';

export default async function AccountSessionsPage() {
  redirect('/u?settings=Sessions');
}
