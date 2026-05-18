import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

import { isAdminEmail } from '@/lib/auth/admin';
import { createClientForRequest } from '@/supabase/utils/server';

import { SLIDESHOWS } from '../(components)/registry';
import { SlideshowViewer } from '../(components)/SlideshowViewer';

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ slide?: string }>;
}

function isLocalhost(host: string | null): boolean {
  return host?.split(':')[0] === 'localhost' || host?.split(':')[0] === '127.0.0.1';
}

export default async function SlideshowPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { slide } = await searchParams;

  const entry = SLIDESHOWS[slug];
  if (!entry) notFound();

  const headersList = await headers();
  const host = headersList.get('host');

  if (!entry.public && !isLocalhost(host)) {
    const supabase = await createClientForRequest();
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user || !isAdminEmail(user.email)) {
      redirect('/');
    }
  }

  const initialSlide = slide ? parseInt(slide, 10) : 1;

  return <SlideshowViewer slug={slug} initialSlide={initialSlide} />;
}
