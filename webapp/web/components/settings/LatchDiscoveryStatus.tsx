import { Button } from '@/components/ui/button';
import type { LatchDiscoveryView } from '@/lib/latch-discovery-client';

type LatchDiscoveryStatusProps = {
  discovery: LatchDiscoveryView | undefined;
  isLoading: boolean;
  deviceLabel: string | null;
  onRecheck: () => void;
  recheckPending: boolean;
};

/**
 * Inline capability report for the Session setting (coo:702). Renders the three
 * discovery states distinguishably — found (version + path), not installed (the
 * standalone install command, never an auto-install), incompatible (naming the
 * missing capability) — plus the honest fourth case where Overlord cannot reach
 * the device to check at all. Direct execution stays selectable in every state.
 */
export function LatchDiscoveryStatus({
  discovery,
  isLoading,
  deviceLabel,
  onRecheck,
  recheckPending
}: LatchDiscoveryStatusProps) {
  const device = deviceLabel ?? 'this machine';

  if (isLoading && !discovery) {
    return <p className="text-xs text-muted-foreground">Checking Latch on {device}…</p>;
  }
  if (!discovery) return null;

  const recheck = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-6 px-2 text-xs"
      onClick={onRecheck}
      disabled={recheckPending}
    >
      {recheckPending ? 'Checking…' : 'Check again'}
    </Button>
  );

  if (discovery.state === 'found') {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>
          Latch {discovery.productVersion} (protocol {discovery.protocolVersion}) on {device}
        </span>
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
          {discovery.resolvedPath}
        </code>
        {recheck}
      </div>
    );
  }

  if (discovery.state === 'not_installed') {
    return (
      <div className="space-y-1 text-xs text-muted-foreground">
        <p>
          Latch is not installed on {device}, so persistent sessions are unavailable there. Install
          the standalone CLI yourself — Overlord never installs or upgrades it:
        </p>
        <code className="block overflow-x-auto rounded bg-muted px-2 py-1 font-mono text-[11px]">
          {discovery.installCommand}
        </code>
        {recheck}
      </div>
    );
  }

  if (discovery.state === 'incompatible') {
    return (
      <div className="space-y-1 text-xs text-muted-foreground">
        <p>
          The Latch on {device}
          {discovery.productVersion ? ` (${discovery.productVersion})` : ''} cannot host Overlord
          sessions: missing{' '}
          <code className="font-mono text-[11px]">{discovery.missingCapability}</code>.
        </p>
        <p>{discovery.detail}</p>
        {recheck}
      </div>
    );
  }

  return (
    <p className="text-xs text-muted-foreground">
      Overlord could not check Latch on {device} from here ({discovery.code}). {discovery.message}{' '}
      The setting is still yours to make; runs fall back to direct execution if Latch turns out to
      be unavailable.
    </p>
  );
}
