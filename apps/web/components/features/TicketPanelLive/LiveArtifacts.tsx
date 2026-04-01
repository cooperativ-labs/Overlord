import { ExternalLink } from '@/components/features/ExternalLink';
import { MarkdownContent } from '@/components/features/MarkdownContent';
import type { Database } from '@/types/database.types';

type Artifact = Database['public']['Tables']['artifacts']['Row'];

export function LiveArtifacts({
  artifacts,
  editorScheme,
  workspaceRoot
}: {
  artifacts: Artifact[];
  editorScheme?: string | null;
  workspaceRoot?: string | null;
}) {
  const visibleArtifacts = artifacts.filter(artifact => artifact.artifact_type !== 'file_changes');

  if (!visibleArtifacts.length) return null;

  return (
    <section>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Artifacts
      </h2>
      <div className="grid gap-4">
        {visibleArtifacts.map(artifact => (
          <div key={artifact.id} className="min-w-0">
            <p className="mb-0.5 break-words text-xs font-medium">{artifact.label}</p>
            <p className="mb-1 text-xs text-muted-foreground">{artifact.artifact_type}</p>
            {artifact.uri ? (
              <ExternalLink
                className="break-all text-xs text-primary underline-offset-4 hover:underline"
                href={artifact.uri}
              >
                {artifact.uri}
              </ExternalLink>
            ) : null}
            {artifact.content ? (
              <MarkdownContent
                compact
                className="mt-1 text-xs text-muted-foreground"
                editorScheme={editorScheme}
                workspaceRoot={workspaceRoot}
              >
                {artifact.content}
              </MarkdownContent>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
