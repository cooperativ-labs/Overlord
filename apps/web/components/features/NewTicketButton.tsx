'use client';

import { Plus, Ticket } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { NewTicketModal } from '@/components/features/NewTicketModal';
import { useDefaultProject } from '@/components/features/projects/DefaultProjectContext';
import { QuickRunModal } from '@/components/features/QuickRunModal';
import { useElectron } from '@/components/features/terminal/useElectron';
import { Button } from '@/components/ui/button';
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
      <Button size="sm" onClick={() => setIsModalOpen(true)}>
        <span className="flex items-center gap-0.5 sm:hidden">
          <Plus className="h-3.5 w-3.5" />
          <Ticket className="h-3.5 w-3.5" />
        </span>
        <span className="hidden sm:inline">New Ticket</span>
      </Button>

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
