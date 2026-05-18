import { redirect } from 'next/navigation';

import { AgentModelOfferingsPanel } from '@/components/features/admin/AgentModelOfferingsPanel';
import { AppFeaturesPanel } from '@/components/features/admin/AppFeaturesPanel';
import { ChangelogPanel } from '@/components/features/admin/ChangelogPanel';
import { SentryTestPanel } from '@/components/features/admin/SentryTestPanel';
import { getAdminAgentModelsAction } from '@/lib/actions/admin-agent-models';
import { getAdminAppFeaturesAction } from '@/lib/actions/admin-features';
import { listChangelogEntriesAction } from '@/lib/actions/changelog';
import { ADMIN_EMAIL, isAdminEmail } from '@/lib/auth/admin';
import { createClientForRequest } from '@/supabase/utils/server';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

type AccessRequestRow = {
  created_at: string;
  email: string;
  id: string;
  name: string;
  role: string;
};

type FeedbackRow = {
  created_at: string;
  description: string;
  id: string;
  screenshot_paths: string[] | null;
  userEmail: string | null;
};

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

async function loadAdminData(): Promise<{
  accessRequests: AccessRequestRow[];
  feedbackItems: FeedbackRow[];
  agentModels: Awaited<ReturnType<typeof getAdminAgentModelsAction>>;
  appFeatures: Awaited<ReturnType<typeof getAdminAppFeaturesAction>>;
}> {
  const service = createServiceRoleClient();

  const [
    { data: accessRequests, error: accessError },
    { data: feedbackItems, error: feedbackError },
    agentModels,
    appFeatures
  ] = await Promise.all([
    service
      .from('early_access_requests')
      .select('id, name, email, role, created_at')
      .order('created_at', { ascending: false }),
    service
      .from('feedback')
      .select('id, description, screenshot_paths, user_id, created_at')
      .order('created_at', { ascending: false }),
    getAdminAgentModelsAction(),
    getAdminAppFeaturesAction()
  ]);

  if (accessError) {
    throw new Error(accessError.message ?? 'Failed to load early access requests.');
  }

  if (feedbackError) {
    throw new Error(feedbackError.message ?? 'Failed to load feedback items.');
  }

  const feedbackWithEmails = await Promise.all(
    (feedbackItems ?? []).map(async item => {
      const { data, error } = await service.auth.admin.getUserById(item.user_id);

      if (error) {
        return {
          created_at: item.created_at,
          description: item.description,
          id: item.id,
          screenshot_paths: item.screenshot_paths,
          userEmail: null
        };
      }

      return {
        created_at: item.created_at,
        description: item.description,
        id: item.id,
        screenshot_paths: item.screenshot_paths,
        userEmail: data.user.email ?? null
      };
    })
  );

  return {
    agentModels,
    appFeatures,
    accessRequests: accessRequests ?? [],
    feedbackItems: feedbackWithEmails
  };
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-muted/40 px-6 py-10 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

export default async function AdminPage() {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  if (!isAdminEmail(user.email)) {
    redirect('/');
  }

  const [{ accessRequests, feedbackItems, agentModels, appFeatures }, changelogEntries] =
    await Promise.all([loadAdminData(), listChangelogEntriesAction()]);

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-8 lg:px-8">
        <section className="rounded-[2rem] border border-border bg-card p-8 shadow-sm">
          <p className="font-mono text-xs font-semibold uppercase tracking-widest text-sky-600 dark:text-sky-400">
            Admin
          </p>
          <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-foreground">
            Internal submissions
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            This page is restricted to {ADMIN_EMAIL}. It shows incoming early access requests and
            product feedback in one place.
          </p>
        </section>

        <SentryTestPanel />
        <AppFeaturesPanel initialFeatures={appFeatures} />
        <ChangelogPanel initialEntries={changelogEntries} />

        <section className="rounded-[2rem] border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-5">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Access requests</h2>
              <p className="text-sm text-muted-foreground">
                {accessRequests.length} total submissions
              </p>
            </div>
          </div>
          {accessRequests.length === 0 ? (
            <div className="p-6">
              <EmptyState message="No early access requests have been submitted yet." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-muted/60 text-muted-foreground">
                  <tr>
                    <th className="px-6 py-3 font-medium">Submitted</th>
                    <th className="px-6 py-3 font-medium">Name</th>
                    <th className="px-6 py-3 font-medium">Email</th>
                    <th className="px-6 py-3 font-medium">Role</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {accessRequests.map(request => (
                    <tr key={request.id} className="align-top text-foreground/90">
                      <td className="whitespace-nowrap px-6 py-4">
                        {formatDateTime(request.created_at)}
                      </td>
                      <td className="px-6 py-4 font-medium text-foreground">{request.name}</td>
                      <td className="px-6 py-4">
                        <a
                          href={`mailto:${request.email}`}
                          className="text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300"
                        >
                          {request.email}
                        </a>
                      </td>
                      <td className="px-6 py-4">{request.role}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-[2rem] border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-5">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Feedback</h2>
              <p className="text-sm text-muted-foreground">
                {feedbackItems.length} total submissions
              </p>
            </div>
          </div>
          {feedbackItems.length === 0 ? (
            <div className="p-6">
              <EmptyState message="No feedback has been submitted yet." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-muted/60 text-muted-foreground">
                  <tr>
                    <th className="px-6 py-3 font-medium">Submitted</th>
                    <th className="px-6 py-3 font-medium">User</th>
                    <th className="px-6 py-3 font-medium">Description</th>
                    <th className="px-6 py-3 font-medium">Screenshots</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {feedbackItems.map(item => (
                    <tr key={item.id} className="align-top text-foreground/90">
                      <td className="whitespace-nowrap px-6 py-4">
                        {formatDateTime(item.created_at)}
                      </td>
                      <td className="px-6 py-4 font-medium text-foreground">
                        {item.userEmail ?? 'Unknown user'}
                      </td>
                      <td className="max-w-2xl px-6 py-4 whitespace-pre-wrap break-words">
                        {item.description}
                      </td>
                      <td className="px-6 py-4">{item.screenshot_paths?.length ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <AgentModelOfferingsPanel initialModels={agentModels} />
      </div>
    </div>
  );
}
