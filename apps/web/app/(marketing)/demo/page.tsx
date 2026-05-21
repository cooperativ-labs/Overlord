import type { Metadata } from 'next';

import { DemoContent } from './DemoContent';

export const metadata: Metadata = {
  title: 'Overlord | Interactive Demo',
  description:
    'Explore the Overlord AI workflow: ticket boards, agent controls, settings, and CLI — all interactive, no sign-up required.',
  alternates: {
    canonical: 'https://www.ovld.ai/demo'
  }
};

export default function DemoPage() {
  return <DemoContent />;
}
