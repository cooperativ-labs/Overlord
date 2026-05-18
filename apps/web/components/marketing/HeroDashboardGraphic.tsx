import { Bot, TerminalSquare } from 'lucide-react';

const heroBoardColumns = [
  {
    title: 'Next Up',
    count: 2,
    cards: [
      { title: 'Plan billing export', color: '#60a5fa', active: false },
      { title: 'Review MCP auth flow', color: '#38bdf8', active: false }
    ]
  },
  {
    title: 'Execute',
    count: 1,
    cards: [{ title: 'Codex: implement docs nav', color: '#34d399', active: true }]
  },
  {
    title: 'Review',
    count: 1,
    cards: [{ title: 'Claude Code: checkout fixes', color: '#f59e0b', active: false }]
  }
] as const;

const heroTerminalLines = [
  '$ ovld protocol attach --ticket-id 1:184',
  'Objective loaded with repo context',
  'Agent update: editing docs navigation',
  'Delivery will include file-change rationales'
] as const;

export function HeroDashboardGraphic() {
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-5xl pt-2">
      <div className="absolute inset-x-10 top-8 h-40 rounded-full bg-sky-400/12 blur-3xl" />
      <div className="relative rounded-[2rem] border border-white/10 bg-white/[0.045] p-3 shadow-[0_30px_120px_-60px_rgba(56,189,248,0.55)] backdrop-blur">
        <div className="grid gap-3 lg:grid-cols-[1.3fr_0.9fr]">
          <div className="overflow-hidden rounded-[1.5rem] border border-white/10 bg-[#07101d]/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
            <div className="flex items-center gap-2 border-b border-white/10 bg-white/[0.03] px-4 py-3">
              <span className="size-2.5 rounded-full bg-[#ff5f57]" />
              <span className="size-2.5 rounded-full bg-[#febc2e]" />
              <span className="size-2.5 rounded-full bg-[#28c840]" />
              <span className="ml-2 font-mono text-[14px] uppercase tracking-wider text-slate-500">
                Agent Work Board
              </span>
            </div>

            <div className="grid gap-3 p-3 sm:grid-cols-3">
              {heroBoardColumns.map(column => (
                <div
                  key={column.title}
                  className="rounded-[1.1rem] border border-white/8 bg-white/[0.03] p-2.5 text-left"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="font-mono text-[14px] font-medium uppercase tracking-wide text-slate-400">
                      {column.title}
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-slate-500">
                      {column.count}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {column.cards.map(card => (
                      <div
                        key={card.title}
                        className="relative rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5 overflow-hidden"
                      >
                        {card.active && (
                          <div className="pointer-events-none absolute inset-0 -translate-x-full animate-[shimmer_3s_linear_infinite] bg-linear-to-r from-transparent via-emerald-400/15 to-transparent" />
                        )}
                        <div className="relative flex items-start gap-2.5">
                          <span
                            className="mt-1 block size-2.5 shrink-0 rounded-[3px]"
                            style={{ backgroundColor: card.color }}
                          />
                          <div className="min-w-0">
                            <p className="text-sm leading-snug text-slate-100">{card.title}</p>
                            <div className="mt-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-slate-500">
                              {card.active ? (
                                <>
                                  <Bot className="size-3 text-emerald-300" />
                                  <span>Agent running</span>
                                </>
                              ) : (
                                <span>Ready for handoff</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-[1.5rem] border border-white/10 bg-[#050b15]/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-white/[0.03] px-4 py-3">
              <div className="flex items-center gap-2">
                <TerminalSquare className="size-4 text-sky-300" />
                <span className="font-mono text-[14px] uppercase tracking-wider text-slate-500">
                  Terminal
                </span>
              </div>
              <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-emerald-200">
                Live
              </span>
            </div>

            <div className="space-y-3 p-4 text-left font-mono text-[12px] leading-6 text-slate-300">
              {heroTerminalLines.map((line, index) => (
                <div key={line} className="flex items-center gap-3">
                  <span className="w-4 text-right text-slate-600">{index + 1}</span>
                  <span className={index === 0 ? 'text-sky-300' : ''}>{line}</span>
                </div>
              ))}

              <div className="mt-4 rounded-xl border border-sky-400/15 bg-sky-400/10 px-3 py-2 text-[14px] text-sky-100">
                The prompt, execution, updates, delivery, and review record stay together.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
