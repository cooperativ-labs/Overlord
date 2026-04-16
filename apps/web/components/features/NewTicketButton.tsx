'use client';

import { MessageSquarePlus, Plus, Ticket } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { NewTicketModal } from '@/components/features/NewTicketModal';
import { useDefaultProject } from '@/components/features/projects/DefaultProjectContext';
import { QuickRunModal } from '@/components/features/QuickRunModal';
import { useElectron } from '@/components/features/terminal/useElectron';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { createClient } from '@/supabase/utils/client';

type ProjectOption = {
  id: string;
  name: string;
  color: string;
  everhour_project_id: string | null;
  local_working_directory: string | null;
};

export function NewTicketButton() {
  const pathname = usePathname();
  const { defaultProject } = useDefaultProject();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isQuickRunOpen, setIsQuickRunOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const { isElectron } = useElectron();
  const [isMac, setIsMac] = useState(false);

  const segments = pathname.split('/').filter(Boolean);
  // Route format: /projects/[projectId]/... or /u/...
  const routeProjectId =
    segments[0] === 'projects' && typeof segments[1] === 'string' ? segments[1] : undefined;
  const projectId = defaultProject?.id ?? routeProjectId;
  const quickRunProjectId = routeProjectId ?? defaultProject?.id;

  // Load projects when either modal opens
  useEffect(() => {
    if (!isModalOpen && !isQuickRunOpen) return;

    const loadProjects = async () => {
      try {
        const supabase = createClient();
        const { data: projectsData } = await supabase
          .from('projects')
          .select('id,name,color,everhour_project_id,local_working_directory')
          .order('created_at', { ascending: true });

        if (projectsData) {
          setProjects(projectsData);
        }
      } catch (error) {
        console.error('Failed to load projects:', error);
      }
    };

    loadProjects();
  }, [isModalOpen, isQuickRunOpen]);

  useEffect(() => {
    setIsMac(navigator.platform.toLowerCase().includes('mac'));
  }, []);

  useEffect(() => {
    const handleNewTicketHotkey = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
        if (event.key === 'n') {
          event.preventDefault();
          setIsModalOpen(true);
        } else if (event.key === 'p' && isElectron) {
          event.preventDefault();
          setIsQuickRunOpen(true);
        }
      }
    };

    window.addEventListener('keydown', handleNewTicketHotkey);
    return () => window.removeEventListener('keydown', handleNewTicketHotkey);
  }, [isElectron]);

  return (
    <>
      <div className="flex items-center gap-2">
        {isElectron ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className="electron-no-drag hidden sm:inline-flex"
                onClick={() => setIsQuickRunOpen(true)}
                size="sm"
                variant="outline"
                type="button"
              >
                <MessageSquarePlus className="h-3.5 w-3.5" />
                <span>Prompt</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Open prompt (Cmd+P)</TooltipContent>
          </Tooltip>
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className="electron-no-drag"
              onClick={() => setIsModalOpen(true)}
              size="sm"
              type="button"
            >
              <span className="flex items-center gap-0.5 sm:hidden">
                <Plus className="h-3.5 w-3.5" />
                <Ticket className="h-3.5 w-3.5" />
              </span>
              <span className="hidden items-center gap-1 sm:inline-flex">
                <Ticket className="h-3.5 w-3.5" />
                <span>New Ticket</span>
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Create new ticket ({isMac ? '⌘N' : 'Ctrl+N'})</TooltipContent>
        </Tooltip>
      </div>

      <NewTicketModal
        isOpen={isModalOpen}
        onOpenChange={setIsModalOpen}
        defaultProjectId={projectId}
        projects={projects}
      />

      {isElectron && (
        <QuickRunModal
          isOpen={isQuickRunOpen}
          onOpenChange={setIsQuickRunOpen}
          defaultProjectId={quickRunProjectId}
          projects={projects}
        />
      )}
    </>
  );
}
