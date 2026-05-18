import { notFound } from 'next/navigation';

import { SLIDESHOWS } from '../(components)/registry';
import { SlideshowViewer } from '../(components)/SlideshowViewer';

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ slide?: string }>;
}

export default async function SlideshowPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { slide } = await searchParams;

  if (!SLIDESHOWS[slug]) notFound();

  const initialSlide = slide ? parseInt(slide, 10) : 1;

  return <SlideshowViewer slug={slug} initialSlide={initialSlide} />;
}
