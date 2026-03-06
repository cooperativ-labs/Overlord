'use client';

import { Plus, Ticket } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { NewTicketModal } from '@/components/features/NewTicketModal';
import { useDefaultProject } from '@/components/features/projects/DefaultProjectContext';
import { Button } from '@/components/ui/button';
import { createClient } from '@/supabase/utils/client';

type ProjectOption = {
  id: string;
  name: string;
  color: string;
  everhour_project_id: string | null;
};

export function NewTicketButton() {
  const pathname = usePathname();
  const { defaultProject } = useDefaultProject();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectOption[]>([]);

  const segments = pathname.split('/').filter(Boolean);
  // Route format: /projects/[projectId]/... or /u/...
  const projectId =
    defaultProject?.id ??
    (segments[0] === 'projects' && typeof segments[1] === 'string' ? segments[1] : undefined);

  // Load projects when modal opens
  useEffect(() => {
    if (!isModalOpen) return;

    const loadProjects = async () => {
      try {
        const supabase = createClient();
        const { data: projectsData } = await supabase
          .from('projects')
          .select('id,name,color,everhour_project_id')
          .order('created_at', { ascending: true });

        if (projectsData) {
          setProjects(projectsData);
        }
      } catch (error) {
        console.error('Failed to load projects:', error);
      }
    };

    loadProjects();
  }, [isModalOpen]);

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
    </>
  );
}
