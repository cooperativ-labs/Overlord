import { Link } from '@tanstack/react-router';

import { Button } from '@/components/ui.tsx';
import {
  useAllProjects,
  useDeleteInboxItem,
  useInboxItems,
  usePromoteInboxItem
} from '@/lib/queries.ts';

export function InboxPage() {
  const inbox = useInboxItems();
  const projects = useAllProjects();
  const promote = usePromoteInboxItem();
  const remove = useDeleteInboxItem();

  if (inbox.isLoading)
    return <div className="p-6 text-sm text-muted-foreground">Loading Inbox…</div>;
  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 overflow-auto p-6">
      <div>
        <h1 className="text-xl font-semibold">Inbox</h1>
        <p className="text-sm text-muted-foreground">
          Unassigned tasks stay private until you assign a project.
        </p>
      </div>
      {(inbox.data ?? []).map(item => (
        <article key={item.id} className="space-y-3 rounded-lg border p-4">
          <div>
            <h2 className="font-medium">{item.title}</h2>
            <p className="text-sm text-muted-foreground">{item.objectives[0]}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {projects.data
              ?.filter(project => project.status === 'active')
              .map(project => (
                <Button
                  key={project.id}
                  variant="secondary"
                  disabled={promote.isPending}
                  onClick={() => promote.mutate({ id: item.id, projectId: project.id })}
                >
                  Assign to {project.name}
                </Button>
              ))}
            <Button
              variant="secondary"
              disabled={remove.isPending}
              onClick={() => remove.mutate(item.id)}
            >
              Delete
            </Button>
          </div>
        </article>
      ))}
      {(inbox.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Your Inbox is empty. Create a task without a project to capture it here.
        </p>
      ) : null}
      <Link to="/user" className="text-sm text-primary hover:underline">
        Back to My Missions
      </Link>
    </main>
  );
}
