'use client';

import { CheckCircle2, Layers3, MessageSquareText } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';

import { DemoFeedShowcase } from '../../../../example-content/demo-frames/DemoFeedShowcase';
import { DemoTicketDetails } from '../../../../example-content/demo-frames/DemoTicketDetails';

function Benefit({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-6 p2k:p-8 p4k:p-10">
      <div className="flex items-start gap-4 p2k:gap-5 p4k:gap-6">
        <div className="mt-1 rounded-2xl border border-sky-400/20 bg-sky-400/10 p-3 text-sky-300 p2k:p-4 p4k:p-5">
          {icon}
        </div>
        <div>
          <h4 className="text-2xl font-semibold text-white p2k:text-4xl p4k:text-6xl">{title}</h4>
          <p className="mt-2 text-base leading-relaxed text-slate-300 p2k:text-2xl p4k:text-4xl">
            {body}
          </p>
        </div>
      </div>
    </div>
  );
}

const TABS = [
  { id: 'ticket', label: 'Ticket & Objectives' },
  { id: 'feed', label: 'The Feed' }
] as const;
type TabId = (typeof TABS)[number]['id'];

export default function Slide03() {
  const [activeTab, setActiveTab] = useState<TabId>('ticket');

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-[#020817] text-white">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-full bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(56,189,248,0.12),_transparent_26%)]" />

      <div className="relative z-10 flex h-full w-full gap-8 px-12 py-10 lg:px-16 p1080:gap-10 p1080:px-20 p1080:py-12 p2k:gap-14 p2k:px-28 p2k:py-16 p4k:gap-20 p4k:px-40 p4k:py-24">
        <div className="flex w-[36rem] shrink-0 flex-col justify-center p1080:w-[40rem] p2k:w-[52rem] p4k:w-[68rem]">
          <p className="font-mono text-base uppercase tracking-[0.28em] text-sky-400 p2k:text-xl p4k:text-4xl">
            The basic idea
          </p>
          <h3 className="mt-5 font-display text-5xl font-semibold leading-[0.95] tracking-tight p1080:text-6xl p2k:text-8xl p4k:text-[10rem]">
            Organize work and digest outcomes.
          </h3>

          <div className="mt-10 space-y-4 p2k:mt-14 p2k:space-y-6 p4k:mt-20 p4k:space-y-8">
            <Benefit
              icon={<MessageSquareText className="h-5 w-5 p2k:h-7 p2k:w-7 p4k:h-10 p4k:w-10" />}
              title="Objectives"
              body="The unit of work: instructions, agent choice, and delivery record."
            />
            <Benefit
              icon={<Layers3 className="h-5 w-5 p2k:h-7 p2k:w-7 p4k:h-10 p4k:w-10" />}
              title="Tickets"
              body="A group of objectives with shared context, often a feature or bug."
            />

            <Benefit
              icon={<CheckCircle2 className="h-5 w-5 p2k:h-7 p2k:w-7 p4k:h-10 p4k:w-10" />}
              title="The Feed"
              body="A stream of posts, one per ticket, with a mutable summary and objective-level timeline."
            />
          </div>
        </div>

        <div className="flex min-w-0 flex-[0.85] items-stretch justify-center">
          <div className="flex w-[90%] flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 backdrop-blur-sm p2k:p-7 p4k:p-10">
            {/* Header row */}
            <div className="mb-4 flex shrink-0 items-center justify-between gap-4 p2k:mb-6">
              <h2 className="font-display text-3xl font-semibold tracking-tight text-white p1080:text-4xl p2k:text-6xl p4k:text-8xl">
                Tickets, Objectives, & The Feed
              </h2>

              <div className="flex shrink-0 gap-2 p2k:gap-3">
                {TABS.map(tab => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={[
                      'rounded-xl px-5 py-2 text-sm font-medium transition-colors p2k:px-7 p2k:py-3 p2k:text-lg p4k:px-10 p4k:py-4 p4k:text-3xl',
                      activeTab === tab.id
                        ? 'bg-sky-400/15 text-white ring-1 ring-sky-400/30'
                        : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                    ].join(' ')}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Scrollable demo content */}
            <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl ">
              {activeTab === 'feed' ? (
                <DemoFeedShowcase numberOfPosts={3} />
              ) : (
                <DemoTicketDetails />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
