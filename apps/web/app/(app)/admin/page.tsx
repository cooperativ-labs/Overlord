import { redirect } from 'next/navigation';

import { AgentModelOfferingsPanel } from '@/components/features/admin/AgentModelOfferingsPanel';
import { AppFeaturesPanel } from '@/components/features/admin/AppFeaturesPanel';
import { SentryTestPanel } from '@/components/features/admin/SentryTestPanel';
import { getAdminAgentModelsAction } from '@/lib/actions/admin-agent-models';
import { getAdminAppFeaturesAction } from '@/lib/actions/admin-features';
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
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center text-sm text-slate-600">
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

  const { accessRequests, feedbackItems, agentModels, appFeatures } = await loadAdminData();

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-slate-50">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-8 lg:px-8">
        <section className="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-600">Admin</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-slate-950">
            Internal submissions
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
            This page is restricted to {ADMIN_EMAIL}. It shows incoming early access requests and
            product feedback in one place.
          </p>
        </section>

        <SentryTestPanel />
        <AppFeaturesPanel initialFeatures={appFeatures} />

        <section className="rounded-[2rem] border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Access requests</h2>
              <p className="text-sm text-slate-600">{accessRequests.length} total submissions</p>
            </div>
          </div>
          {accessRequests.length === 0 ? (
            <div className="p-6">
              <EmptyState message="No early access requests have been submitted yet." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-6 py-3 font-medium">Submitted</th>
                    <th className="px-6 py-3 font-medium">Name</th>
                    <th className="px-6 py-3 font-medium">Email</th>
                    <th className="px-6 py-3 font-medium">Role</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {accessRequests.map(request => (
                    <tr key={request.id} className="align-top text-slate-700">
                      <td className="whitespace-nowrap px-6 py-4">
                        {formatDateTime(request.created_at)}
                      </td>
                      <td className="px-6 py-4 font-medium text-slate-950">{request.name}</td>
                      <td className="px-6 py-4">
                        <a
                          href={`mailto:${request.email}`}
                          className="text-sky-700 hover:text-sky-900"
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

        <section className="rounded-[2rem] border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Feedback</h2>
              <p className="text-sm text-slate-600">{feedbackItems.length} total submissions</p>
            </div>
          </div>
          {feedbackItems.length === 0 ? (
            <div className="p-6">
              <EmptyState message="No feedback has been submitted yet." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-6 py-3 font-medium">Submitted</th>
                    <th className="px-6 py-3 font-medium">User</th>
                    <th className="px-6 py-3 font-medium">Description</th>
                    <th className="px-6 py-3 font-medium">Screenshots</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {feedbackItems.map(item => (
                    <tr key={item.id} className="align-top text-slate-700">
                      <td className="whitespace-nowrap px-6 py-4">
                        {formatDateTime(item.created_at)}
                      </td>
                      <td className="px-6 py-4 font-medium text-slate-950">
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
