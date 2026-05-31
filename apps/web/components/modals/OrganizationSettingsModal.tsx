'use client';

import { Newspaper, Settings, Trash2, Users } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  getOrganizationDetailsAction,
  type OrganizationDetails
} from '@/lib/actions/organizations';

import { DangerZonePage } from './organization-settings/DangerZonePage';
import { FeedPage } from './organization-settings/FeedPage';
import { GeneralPage } from './organization-settings/GeneralPage';
import { MembersPage } from './organization-settings/MembersPage';
import { SettingsDialogShell, type SettingsNavItem } from './SettingsDialogShell';

const navItems: SettingsNavItem[] = [
  { name: 'General', icon: Settings },
  { name: 'Members', icon: Users },
  { name: 'Feed', icon: Newspaper },
  { name: 'Danger zone', icon: Trash2 }
];

export type OrganizationSettingsNavSection = (typeof navItems)[number]['name'];

type OrganizationSettingsModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: number | null;
  initialNav?: OrganizationSettingsNavSection;
};

export function OrganizationSettingsModal({
  open,
  onOpenChange,
  organizationId,
  initialNav
}: OrganizationSettingsModalProps) {
  const [activeNav, setActiveNav] = useState<string>('General');
  const [details, setDetails] = useState<OrganizationDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (initialNav && navItems.some(item => item.name === initialNav)) {
      setActiveNav(initialNav);
    } else {
      setActiveNav('General');
    }
  }, [open, initialNav]);

  useEffect(() => {
    if (!open || organizationId === null) {
      setDetails(null);
      return;
    }
    setLoading(true);
    setError(null);
    getOrganizationDetailsAction(organizationId)
      .then(setDetails)
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load organization.'))
      .finally(() => setLoading(false));
  }, [open, organizationId]);

  return (
    <SettingsDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="Organization settings"
      description="Customize your organization settings here."
      breadcrumbRoot={details?.name ?? 'Organization settings'}
      navGroups={[{ items: navItems }]}
      activeNav={activeNav}
      onActiveNavChange={setActiveNav}
    >
      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : !details || organizationId === null ? null : (
        <>
          {activeNav === 'General' && (
            <GeneralPage
              open={open}
              organizationId={details.id}
              initialName={details.name}
              initialGitProvider={details.gitProvider}
              initialLogoUrl={details.logoUrl}
              onNameChange={nextName =>
                setDetails(prev => (prev ? { ...prev, name: nextName } : prev))
              }
              onLogoChange={nextLogoUrl =>
                setDetails(prev => (prev ? { ...prev, logoUrl: nextLogoUrl } : prev))
              }
            />
          )}
          {activeNav === 'Members' && <MembersPage open={open} organizationId={details.id} />}
          {activeNav === 'Feed' && (
            <FeedPage
              open={open}
              organizationId={details.id}
              initialRetentionDays={details.feedRetentionDays}
            />
          )}
          {activeNav === 'Danger zone' && (
            <DangerZonePage
              organizationId={details.id}
              organizationName={details.name}
              onOpenChange={onOpenChange}
            />
          )}
        </>
      )}
    </SettingsDialogShell>
  );
}
