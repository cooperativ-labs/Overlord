type SharedStateItem = {
  id: string;
  state_key: string;
  state_value: unknown;
};

export function SharedStateSection({ sharedState }: { sharedState: SharedStateItem[] }) {
  if (!sharedState.length) return null;

  return (
    <section>
      <h2 className="eyebrow mb-3">Shared State</h2>
      <div className="grid gap-3">
        {sharedState.map(item => (
          <div key={item.id}>
            <p className="mb-1 text-xs font-medium">{item.state_key}</p>
            <code className="block max-h-32 overflow-auto whitespace-pre-wrap break-all rounded border bg-muted p-2 text-xs">
              {JSON.stringify(item.state_value, null, 2)}
            </code>
          </div>
        ))}
      </div>
    </section>
  );
}
