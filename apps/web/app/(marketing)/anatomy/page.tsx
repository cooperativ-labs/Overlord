import { ArrowRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Overlord | App Anatomy',
  description: 'The anatomy of Overlord, the management layer for people running coding agents.'
};

const anatomyNarrative = [
  {
    id: '01',
    name: 'Project',
    phase: 'Setup',
    description:
      'A project maps Overlord to a repository and working directory so work always has a concrete execution target.'
  },
  {
    id: '06',
    name: 'Project Resource',
    phase: 'Setup',
    description:
      'Resources define where an agent can operate, such as a local directory, SSH host, or other typed execution surface.'
  },
  {
    id: '05',
    name: 'Connector',
    phase: 'Setup',
    description:
      'Connectors translate the same Overlord protocol into Codex, Claude Code, Cursor, OpenCode, and similar agent environments.'
  },
  {
    id: '02',
    name: 'Ticket',
    phase: 'Define and Execute',
    description:
      'A ticket is the durable work record. It holds the shared context, prompt history, progress, delivery, and review.'
  },
  {
    id: '03',
    name: 'Objective',
    phase: 'Define and Execute',
    description:
      'Objectives are sequential steps inside a ticket. Each agent prompt becomes one objective with its own lifecycle.'
  },
  {
    id: '04',
    name: 'Agent Session',
    phase: 'Define and Execute',
    description:
      'The attached session is the live execution thread for one objective, including updates, questions, and delivery.'
  },
  {
    id: '07',
    name: 'Shared Context',
    phase: 'Persist',
    description:
      'Shared context survives across objectives so the next agent inherits prior decisions, files, artifacts, and discussion.'
  },
  {
    id: '08',
    name: 'Change Rationale',
    phase: 'Persist',
    description:
      'Every meaningful file change can carry a rationale that records what changed, why it changed, and the expected impact.'
  }
] as const;

const phases = [
  {
    name: 'Setup',
    description: 'Configured once per project before ticket work starts.',
    items: anatomyNarrative.filter(item => item.phase === 'Setup')
  },
  {
    name: 'Define and Execute',
    description: 'Repeated for each ticket as objectives move from prompt to delivery.',
    items: anatomyNarrative.filter(item => item.phase === 'Define and Execute')
  },
  {
    name: 'Persist',
    description:
      'Information that stays durable so handoffs and follow-up work do not reset context.',
    items: anatomyNarrative.filter(item => item.phase === 'Persist')
  }
] as const;

function NumberBadge({ id }: { id: string }) {
  return (
    <span className="inline-flex size-9 items-center justify-center rounded-full border border-stone-300 bg-white font-mono text-[11px] font-semibold tracking-[0.18em] text-stone-700 shadow-sm dark:border-white/15 dark:bg-slate-950 dark:text-stone-100">
      {id}
    </span>
  );
}

function LegendCard({ id, name, description }: { id: string; name: string; description: string }) {
  return (
    <article className="flex h-full flex-col gap-4 rounded-[1.5rem] border border-stone-200/80 bg-white/85 p-5 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5">
      <div className="flex items-center gap-3">
        <NumberBadge id={id} />
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-stone-500 dark:text-slate-400">
            Anatomy
          </div>
          <h3 className="font-display text-xl font-semibold tracking-tight text-stone-900 dark:text-white">
            {name}
          </h3>
        </div>
      </div>
      <p className="text-sm leading-7 text-stone-600 dark:text-slate-300">{description}</p>
    </article>
  );
}

function AnatomyDiagram() {
  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-stone-200/80 bg-[linear-gradient(135deg,#f3ddcf_0%,#ead2c3_25%,#db835a_100%)] p-3 shadow-[0_30px_90px_-52px_rgba(120,53,15,0.55)] dark:border-white/10 dark:bg-[linear-gradient(135deg,#1f2025_0%,#111827_45%,#0f172a_100%)] dark:shadow-[0_30px_90px_-52px_rgba(15,23,42,0.9)] sm:p-5">
      <div className="overflow-hidden rounded-[1.6rem] border border-white/45 bg-white/55 shadow-inner backdrop-blur dark:border-white/10 dark:bg-slate-950/70">
        <svg
          viewBox="0 0 1400 860"
          className="h-auto w-full"
          role="img"
          aria-labelledby="anatomy-diagram-title anatomy-diagram-description"
        >
          <title id="anatomy-diagram-title">Overlord anatomy diagram</title>
          <desc id="anatomy-diagram-description">
            The overlord workflow, described in one image.
          </desc>
          <defs>
            <linearGradient id="boardGlow" x1="0%" x2="100%" y1="0%" y2="100%">
              <stop offset="0%" stopColor="rgba(255,255,255,0.92)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0.72)" />
            </linearGradient>
          </defs>

          <rect x="0" y="0" width="1400" height="860" fill="transparent" />

          <g>
            <rect x="58" y="54" width="1284" height="752" rx="36" fill="url(#boardGlow)" />
            <rect
              x="58"
              y="54"
              width="1284"
              height="752"
              rx="36"
              fill="none"
              stroke="rgba(255,255,255,0.45)"
              strokeWidth="2"
            />
          </g>

          <g>
            <rect x="92" y="88" width="220" height="684" rx="24" fill="rgba(255,255,255,0.55)" />
            <rect x="334" y="88" width="668" height="684" rx="24" fill="rgba(255,255,255,0.42)" />
            <rect x="1024" y="88" width="284" height="684" rx="24" fill="rgba(255,255,255,0.55)" />
          </g>

          <g fill="rgba(68,64,60,0.72)" fontFamily="ui-monospace, SFMono-Regular, monospace">
            <text x="122" y="126" fontSize="14" letterSpacing="3.2">
              PROJECT
            </text>
            <text x="366" y="126" fontSize="14" letterSpacing="3.2">
              TICKET BOARD
            </text>
            <text x="1054" y="126" fontSize="14" letterSpacing="3.2">
              OBJECTIVE DETAIL
            </text>
          </g>

          <g>
            <rect x="118" y="156" width="166" height="112" rx="20" fill="rgba(255,255,255,0.82)" />
            <rect x="136" y="178" width="112" height="10" rx="5" fill="rgba(68,64,60,0.72)" />
            <rect x="136" y="196" width="84" height="8" rx="4" fill="rgba(120,113,108,0.45)" />
            <rect x="136" y="226" width="92" height="28" rx="14" fill="rgba(217,119,87,0.18)" />
            <rect x="236" y="226" width="28" height="28" rx="14" fill="rgba(56,189,248,0.22)" />
          </g>

          <g>
            <rect x="118" y="290" width="166" height="144" rx="20" fill="rgba(255,255,255,0.82)" />
            <rect x="136" y="314" width="90" height="10" rx="5" fill="rgba(68,64,60,0.72)" />
            <rect x="136" y="338" width="126" height="8" rx="4" fill="rgba(120,113,108,0.45)" />
            <rect x="136" y="364" width="126" height="8" rx="4" fill="rgba(120,113,108,0.45)" />
            <rect x="136" y="390" width="70" height="24" rx="12" fill="rgba(15,23,42,0.08)" />
            <rect x="214" y="390" width="48" height="24" rx="12" fill="rgba(217,119,87,0.18)" />
          </g>

          <g>
            <rect x="118" y="462" width="166" height="166" rx="20" fill="rgba(255,255,255,0.82)" />
            <rect x="136" y="486" width="104" height="10" rx="5" fill="rgba(68,64,60,0.72)" />
            <rect x="136" y="512" width="126" height="8" rx="4" fill="rgba(120,113,108,0.45)" />
            <rect x="136" y="536" width="126" height="8" rx="4" fill="rgba(120,113,108,0.45)" />
            <rect x="136" y="572" width="126" height="24" rx="12" fill="rgba(56,189,248,0.18)" />
            <rect x="136" y="606" width="126" height="24" rx="12" fill="rgba(15,23,42,0.08)" />
          </g>

          <g>
            <rect x="366" y="156" width="156" height="58" rx="18" fill="rgba(255,255,255,0.65)" />
            <text
              x="444"
              y="191"
              textAnchor="middle"
              fill="rgba(68,64,60,0.6)"
              fontFamily="ui-monospace, SFMono-Regular, monospace"
              fontSize="13"
              letterSpacing="2.2"
            >
              BACKLOG
            </text>

            <rect x="544" y="156" width="156" height="58" rx="18" fill="rgba(255,255,255,0.65)" />
            <text
              x="622"
              y="191"
              textAnchor="middle"
              fill="rgba(68,64,60,0.6)"
              fontFamily="ui-monospace, SFMono-Regular, monospace"
              fontSize="13"
              letterSpacing="2.2"
            >
              READY
            </text>

            <rect x="722" y="156" width="156" height="58" rx="18" fill="rgba(255,255,255,0.9)" />
            <text
              x="800"
              y="191"
              textAnchor="middle"
              fill="rgba(68,64,60,0.75)"
              fontFamily="ui-monospace, SFMono-Regular, monospace"
              fontSize="13"
              letterSpacing="2.2"
            >
              EXECUTE
            </text>

            <rect x="900" y="156" width="68" height="58" rx="18" fill="rgba(255,255,255,0.65)" />
          </g>

          <g>
            <rect x="366" y="246" width="156" height="112" rx="22" fill="rgba(255,255,255,0.75)" />
            <rect x="384" y="270" width="96" height="9" rx="4.5" fill="rgba(68,64,60,0.72)" />
            <rect x="384" y="288" width="68" height="7" rx="3.5" fill="rgba(120,113,108,0.45)" />
            <rect x="384" y="322" width="66" height="24" rx="12" fill="rgba(217,119,87,0.16)" />

            <rect x="544" y="246" width="156" height="112" rx="22" fill="rgba(255,255,255,0.75)" />
            <rect x="562" y="270" width="100" height="9" rx="4.5" fill="rgba(68,64,60,0.72)" />
            <rect x="562" y="288" width="82" height="7" rx="3.5" fill="rgba(120,113,108,0.45)" />
            <rect x="562" y="322" width="72" height="24" rx="12" fill="rgba(15,23,42,0.08)" />

            <rect x="722" y="246" width="156" height="112" rx="22" fill="rgba(255,255,255,0.96)" />
            <rect
              x="722"
              y="246"
              width="156"
              height="112"
              rx="22"
              fill="none"
              stroke="rgba(217,119,87,0.55)"
              strokeWidth="3"
            />
            <rect x="740" y="270" width="108" height="9" rx="4.5" fill="rgba(68,64,60,0.8)" />
            <rect x="740" y="288" width="92" height="7" rx="3.5" fill="rgba(120,113,108,0.45)" />
            <rect x="740" y="322" width="80" height="24" rx="12" fill="rgba(56,189,248,0.18)" />

            <rect x="722" y="378" width="156" height="112" rx="22" fill="rgba(255,255,255,0.82)" />
            <rect x="740" y="402" width="90" height="9" rx="4.5" fill="rgba(68,64,60,0.72)" />
            <rect x="740" y="420" width="110" height="7" rx="3.5" fill="rgba(120,113,108,0.45)" />

            <rect x="722" y="510" width="156" height="112" rx="22" fill="rgba(255,255,255,0.82)" />
            <rect x="740" y="534" width="96" height="9" rx="4.5" fill="rgba(68,64,60,0.72)" />
            <rect x="740" y="552" width="78" height="7" rx="3.5" fill="rgba(120,113,108,0.45)" />

            <rect x="900" y="246" width="68" height="112" rx="22" fill="rgba(255,255,255,0.75)" />
            <rect x="900" y="378" width="68" height="112" rx="22" fill="rgba(255,255,255,0.75)" />
            <rect x="900" y="510" width="68" height="112" rx="22" fill="rgba(255,255,255,0.75)" />
          </g>

          <g>
            <rect x="1054" y="156" width="224" height="44" rx="16" fill="rgba(255,255,255,0.82)" />
            <rect x="1076" y="173" width="82" height="9" rx="4.5" fill="rgba(68,64,60,0.78)" />
            <rect x="1176" y="166" width="82" height="22" rx="11" fill="rgba(217,119,87,0.18)" />

            <rect x="1054" y="220" width="224" height="82" rx="22" fill="rgba(255,255,255,0.82)" />
            <rect x="1076" y="244" width="152" height="9" rx="4.5" fill="rgba(68,64,60,0.78)" />
            <rect x="1076" y="264" width="118" height="7" rx="3.5" fill="rgba(120,113,108,0.45)" />

            <rect x="1054" y="324" width="224" height="122" rx="22" fill="rgba(255,255,255,0.82)" />
            <rect x="1076" y="350" width="96" height="8" rx="4" fill="rgba(68,64,60,0.72)" />
            <rect x="1076" y="380" width="170" height="8" rx="4" fill="rgba(120,113,108,0.45)" />
            <rect x="1076" y="404" width="182" height="8" rx="4" fill="rgba(120,113,108,0.45)" />
            <rect x="1076" y="428" width="160" height="8" rx="4" fill="rgba(120,113,108,0.45)" />

            <rect x="1054" y="468" width="224" height="98" rx="22" fill="rgba(255,255,255,0.82)" />
            <rect x="1076" y="494" width="126" height="8" rx="4" fill="rgba(68,64,60,0.72)" />
            <rect x="1076" y="520" width="80" height="24" rx="12" fill="rgba(15,23,42,0.08)" />
            <rect x="1166" y="520" width="90" height="24" rx="12" fill="rgba(217,119,87,0.18)" />

            <rect x="1054" y="588" width="224" height="148" rx="22" fill="rgba(255,255,255,0.82)" />
            <rect x="1076" y="614" width="110" height="8" rx="4" fill="rgba(68,64,60,0.72)" />
            <rect x="1076" y="642" width="182" height="8" rx="4" fill="rgba(120,113,108,0.45)" />
            <rect x="1076" y="666" width="170" height="8" rx="4" fill="rgba(120,113,108,0.45)" />
            <rect x="1076" y="690" width="142" height="8" rx="4" fill="rgba(120,113,108,0.45)" />
          </g>

          {[
            { id: '01', x: 196, y: 448 },
            { id: '06', x: 268, y: 606 },
            { id: '05', x: 246, y: 272 },
            { id: '02', x: 892, y: 302 },
            { id: '03', x: 1012, y: 302 },
            { id: '04', x: 1012, y: 486 },
            { id: '07', x: 1288, y: 576 },
            { id: '08', x: 1288, y: 682 }
          ].map(badge => (
            <g key={badge.id} transform={`translate(${badge.x} ${badge.y})`}>
              <circle
                r="19"
                fill="rgba(255,255,255,0.92)"
                stroke="rgba(68,64,60,0.22)"
                strokeWidth="1.5"
              />
              <text
                textAnchor="middle"
                y="5"
                fill="rgba(68,64,60,0.82)"
                fontFamily="ui-monospace, SFMono-Regular, monospace"
                fontSize="13"
                fontWeight="700"
                letterSpacing="1.2"
              >
                {badge.id}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

export default function AnatomyPage() {
  return (
    <section className="mx-auto flex w-full max-w-7xl flex-col gap-10 py-16 sm:gap-14 sm:py-20">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-5 text-center">
        <div className="rounded-full border border-stone-200 bg-white px-4 py-1.5 font-mono text-[12px] font-medium uppercase tracking-[0.2em] text-stone-600 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
          Anatomy Diagram
        </div>
        <div className="space-y-4">
          <h1 className="font-display text-4xl font-semibold tracking-tight text-stone-900 dark:text-white sm:text-5xl lg:text-6xl">
            Eight parts, one durable workflow.
          </h1>
          <p className="text-base leading-7 text-stone-600 dark:text-slate-300 sm:text-lg">
            The overlord workflow, described in one image.
          </p>
        </div>
        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <Button
            asChild
            variant="outline"
            className="rounded-full border-stone-300 bg-white text-stone-900 shadow-sm hover:bg-stone-50 dark:border-white/15 dark:bg-white/5 dark:text-white dark:hover:bg-white/10 dark:hover:text-white"
          >
            <Link href="/">Back to homepage</Link>
          </Button>
          <Button
            asChild
            className="rounded-full bg-stone-900 text-[#fafaf7] hover:bg-stone-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
          >
            <Link href="/docs">
              Read the docs
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </div>

      <AnatomyDiagram />

      <div className="mx-auto max-w-4xl rounded-[2rem] border border-stone-200/80 bg-white/80 p-6 text-base leading-8 text-stone-700 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5 dark:text-slate-200 sm:p-8">
        A <strong>Project</strong> <span className="font-mono text-[0.82em]">01</span> anchors the
        repository. A <strong>Ticket</strong> <span className="font-mono text-[0.82em]">02</span>{' '}
        carries the durable work record. Inside it, each agent prompt becomes an{' '}
        <strong>Objective</strong> <span className="font-mono text-[0.82em]">03</span>, executed
        through an <strong>Agent Session</strong>{' '}
        <span className="font-mono text-[0.82em]">04</span> via a <strong>Connector</strong>{' '}
        <span className="font-mono text-[0.82em]">05</span>, against a configured{' '}
        <strong>Project Resource</strong> <span className="font-mono text-[0.82em]">06</span>. The
        resulting work accumulates into <strong>Shared Context</strong>{' '}
        <span className="font-mono text-[0.82em]">07</span>, with <strong>Change Rationales</strong>{' '}
        <span className="font-mono text-[0.82em]">08</span> to explain why files changed.
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        {phases.map(phase => (
          <section
            key={phase.name}
            className="rounded-[2rem] border border-stone-200/80 bg-white/80 p-6 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5"
          >
            <div className="mb-6 space-y-3">
              <div className="font-mono text-[11px] uppercase tracking-[0.24em] text-stone-500 dark:text-slate-400">
                {phase.name}
              </div>
              <p className="text-sm leading-7 text-stone-600 dark:text-slate-300">
                {phase.description}
              </p>
            </div>
            <div className="grid gap-4">
              {phase.items.map(item => (
                <LegendCard
                  key={item.id}
                  id={item.id}
                  name={item.name}
                  description={item.description}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
