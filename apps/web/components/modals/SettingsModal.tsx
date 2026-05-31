'use client';

import {
  Bot,
  Edit3,
  Info,
  Key,
  Keyboard,
  Link2,
  Monitor,
  Palette,
  Server,
  Shield,
  Terminal,
  User
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { useElectron } from '@/components/features/terminal/useElectron';

import { AboutPage } from './settings/AboutPage';
import { AgentsAndMcpPage } from './settings/AgentsAndMcpPage';
import { AgentTokensPage } from './settings/AgentTokensPage';
import { ApplicationPage } from './settings/ApplicationPage';
import { CliPage } from './settings/CliPage';
import { CustomizationPage } from './settings/CustomizationPage';
import { ExecutionTargetsPage } from './settings/ExecutionTargetsPage';
import { HotkeysPage } from './settings/HotkeysPage';
import { IntegrationsPage } from './settings/IntegrationsPage';
import { LinkedAccountsPage } from './settings/LinkedAccountsPage';
import { TerminalPage } from './settings/TerminalPage';
import { UserProfilePage } from './settings/UserProfilePage';
import {
  SettingsDialogShell,
  type SettingsNavGroup,
  type SettingsNavItem
} from './SettingsDialogShell';

type SettingsModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialNav?: SettingsNavSection;
  slackEnabled?: boolean;
};

const workflowNavItems: SettingsNavItem[] = [
  { name: 'Terminal & IDE', icon: Monitor },
  { name: 'Execution Targets', icon: Server },
  { name: 'MCP & Cloud Agents', icon: Bot },
  { name: 'CLI & Local Agents', icon: Terminal },
  { name: 'Customization', icon: Edit3 }
];

const appNavItems: SettingsNavItem[] = [
  { name: 'Application', icon: Palette },
  { name: 'Hotkeys', icon: Keyboard },
  { name: 'Integrations', icon: Link2 },
  { name: 'About', icon: Info }
];

const userNavItems: SettingsNavItem[] = [
  { name: 'Profile', icon: User },
  { name: 'Agent Tokens', icon: Key },
  { name: 'Linked Accounts', icon: Shield }
];

const navItems: SettingsNavItem[] = [...workflowNavItems, ...appNavItems, ...userNavItems];
export type SettingsNavSection = (typeof navItems)[number]['name'];

export function SettingsModal({
  open,
  onOpenChange,
  initialNav,
  slackEnabled = false
}: SettingsModalProps) {
  const { isElectron } = useElectron();
  const visibleNavItems = navItems.filter(item => !item.electronOnly || isElectron);
  const navGroups: SettingsNavGroup[] = [
    {
      label: 'Workflow',
      items: workflowNavItems.filter(item => !item.electronOnly || isElectron)
    },
    { label: 'Application', items: appNavItems.filter(item => !item.electronOnly || isElectron) },
    { label: 'User', items: userNavItems.filter(item => !item.electronOnly || isElectron) }
  ];
  const [activeNav, setActiveNav] = useState<string>('CLI & Local Agents');

  useEffect(() => {
    if (!open || !initialNav) return;
    if (!visibleNavItems.some(item => item.name === initialNav)) return;
    setActiveNav(initialNav);
  }, [open, initialNav, visibleNavItems]);

  useEffect(() => {
    if (visibleNavItems.length > 0 && !visibleNavItems.find(i => i.name === activeNav)) {
      setActiveNav(visibleNavItems[0]!.name);
    }
  }, [isElectron]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <SettingsDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="Settings"
      description="Customize your settings here."
      navGroups={navGroups}
      activeNav={activeNav}
      onActiveNavChange={setActiveNav}
      showClose
    >
      {activeNav === 'Integrations' && <IntegrationsPage open={open} slackEnabled={slackEnabled} />}
      {activeNav === 'MCP & Cloud Agents' && (
        <AgentsAndMcpPage open={open} onNavigate={setActiveNav} />
      )}
      {activeNav === 'Agent Tokens' && <AgentTokensPage open={open} />}
      {activeNav === 'Customization' && <CustomizationPage open={open} />}
      {activeNav === 'CLI & Local Agents' && <CliPage open={open} onNavigate={setActiveNav} />}
      {activeNav === 'Application' && <ApplicationPage />}
      {activeNav === 'Hotkeys' && <HotkeysPage />}
      {activeNav === 'Profile' && <UserProfilePage open={open} />}
      {activeNav === 'Linked Accounts' && <LinkedAccountsPage open={open} />}
      {activeNav === 'Terminal & IDE' && <TerminalPage open={open} onNavigate={setActiveNav} />}
      {activeNav === 'Execution Targets' && (
        <ExecutionTargetsPage open={open} onNavigate={setActiveNav} />
      )}
      {activeNav === 'About' && <AboutPage open={open} />}
    </SettingsDialogShell>
  );
}
