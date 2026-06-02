type SequenceStep = {
  n: number;
  from: string;
  to: string;
  action: string;
};

const STEPS: SequenceStep[] = [
  { n: 1, from: 'Current agent', to: 'Backend', action: 'POST /api/protocol/deliver' },
  {
    n: 2,
    from: 'Backend',
    to: 'Backend',
    action: 'Complete session; evaluate draft queue'
  },
  {
    n: 3,
    from: 'Backend',
    to: 'Backend',
    action:
      'If auto_advance: move next objective to submitted, insert execution_request, emit execution_requested'
  },
  {
    n: 4,
    from: 'Backend',
    to: 'Backend',
    action: 'Else: emit awaiting_approval and notify user (no queue row)'
  },
  {
    n: 5,
    from: 'ovld runner',
    to: 'Backend',
    action: 'POST /api/protocol/claim-execution (fingerprint, hostname)'
  },
  {
    n: 6,
    from: 'Backend',
    to: 'ovld runner',
    action: 'Return launch params (agent, model, working directory, …)'
  },
  {
    n: 7,
    from: 'ovld runner',
    to: 'Next agent',
    action: 'Spawn: ovld launch <agent> --ticket-id <id> [options]'
  },
  {
    n: 8,
    from: 'ovld runner',
    to: 'Backend',
    action: 'POST /api/protocol/complete-execution-launch'
  },
  {
    n: 9,
    from: 'Next agent',
    to: 'Backend',
    action: 'POST /api/protocol/attach — load context and begin execution'
  }
];

/** HTML sequence diagram as an accessible table (no Mermaid). */
export function RunnerSequenceDiagram() {
  return (
    <figure className="not-prose my-6 w-full overflow-x-auto">
      <figcaption className="mb-3 text-sm text-muted-foreground">
        Lifecycle from deliver through claim, launch, and attach.
      </figcaption>
      <table className="w-full min-w-[32rem] border-collapse text-sm" aria-label="Runner sequence">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left">
            <th className="w-10 px-3 py-2 font-semibold text-foreground" scope="col">
              #
            </th>
            <th className="px-3 py-2 font-semibold text-foreground" scope="col">
              From
            </th>
            <th className="w-8 px-1 py-2 text-center font-normal text-muted-foreground" scope="col">
              <span className="sr-only">to</span>
            </th>
            <th className="px-3 py-2 font-semibold text-foreground" scope="col">
              To
            </th>
            <th className="px-3 py-2 font-semibold text-foreground" scope="col">
              Action
            </th>
          </tr>
        </thead>
        <tbody>
          {STEPS.map(step => (
            <tr key={step.n} className="border-b border-border/60 even:bg-muted/15">
              <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{step.n}</td>
              <td className="px-3 py-2.5 whitespace-nowrap text-foreground">{step.from}</td>
              <td className="px-1 py-2.5 text-center text-muted-foreground" aria-hidden="true">
                →
              </td>
              <td className="px-3 py-2.5 whitespace-nowrap text-foreground">{step.to}</td>
              <td className="px-3 py-2.5 text-foreground">
                <code className="rounded bg-muted px-1 py-0.5 text-xs font-normal">
                  {step.action}
                </code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
