import { useCallback, useEffect, useMemo, useState } from 'react';

import type { DocumentItem, PickedFile } from '@/components/DocumentAttachmentsSection';
import { createAssignedAgent, DEFAULT_AGENT_MODEL_SELECTION } from '@/lib/agent-models';
import { useAuth } from '@/lib/auth-context';
import { getRecentProjectId, setRecentProjectId } from '@/lib/recent-project';
import { useSelectedProject } from '@/lib/selected-project-context';
import { getSupabase } from '@/lib/supabase';
import type { AgentModelSelection } from '@/lib/types';

export type ProjectRecord = {
  id: string;
  name: string;
  color: string;
  organization_id: number;
};

export type TagDefinition = {
  id: string;
  key: string;
  label: string;
  color: string | null;
};

export type SelectorPanel = 'agent' | 'project' | null;

type UseCreateTicketFormOptions = {
  /** Gates project/tag loading so the modal only fetches while open. */
  active?: boolean;
  defaultProjectId?: string | null;
};

/**
 * Shared state + submit logic for creating a ticket from the mobile app. Backs
 * both the Create tab and the QuickCreateTicketModal so the two surfaces stay
 * in lockstep. Persists the most recent project selection locally and uses it
 * as the default project on the next launch.
 */
export function useCreateTicketForm({
  active = true,
  defaultProjectId
}: UseCreateTicketFormOptions = {}) {
  const { user } = useAuth();
  const { selectedProjectId } = useSelectedProject();

  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [openSelectorPanel, setOpenSelectorPanel] = useState<SelectorPanel>(null);
  const [agentSelection, setAgentSelection] = useState<AgentModelSelection | null>(null);
  const [resolvedAgentSelection, setResolvedAgentSelection] = useState<AgentModelSelection>(
    DEFAULT_AGENT_MODEL_SELECTION
  );
  const [objective, setObjective] = useState('');
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('');
  const [tagDefinitions, setTagDefinitions] = useState<TagDefinition[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [pendingDocuments, setPendingDocuments] = useState<(PickedFile & DocumentItem)[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Load the project list and choose a sensible default: keep the current
  // choice, else the explicit default, else the most-recently-used project,
  // else the globally-selected project, else the first project.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoadingProjects(true);
    void (async () => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('projects')
        .select('id, name, color, organization_id')
        .order('name', { ascending: true });
      if (cancelled) return;
      if (!error && data) {
        setProjects(data as ProjectRecord[]);
        const recentProjectId = getRecentProjectId();
        setProjectId(prev => {
          if (prev && data.some(p => p.id === prev)) return prev;
          if (defaultProjectId && data.some(p => p.id === defaultProjectId))
            return defaultProjectId;
          if (recentProjectId && data.some(p => p.id === recentProjectId)) return recentProjectId;
          if (selectedProjectId && data.some(p => p.id === selectedProjectId)) {
            return selectedProjectId;
          }
          return data[0]?.id ?? null;
        });
      }
      setLoadingProjects(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [active, selectedProjectId, defaultProjectId]);

  // Tags are project-scoped: reload definitions and drop selections whenever the
  // project changes.
  useEffect(() => {
    if (!active || !projectId) {
      setTagDefinitions([]);
      setSelectedTagIds([]);
      return;
    }
    let cancelled = false;
    setLoadingTags(true);
    setSelectedTagIds([]);
    void (async () => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('project_tag_definitions')
        .select('id, key, label, color, is_active')
        .eq('project_id', projectId)
        .eq('is_active', true)
        .order('label', { ascending: true });
      if (cancelled) return;
      if (!error && data) {
        setTagDefinitions(
          data.map(row => ({ id: row.id, key: row.key, label: row.label, color: row.color }))
        );
      } else {
        setTagDefinitions([]);
      }
      setLoadingTags(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [active, projectId]);

  const selectProject = useCallback((nextProjectId: string) => {
    setProjectId(nextProjectId);
    setRecentProjectId(nextProjectId);
  }, []);

  const toggleTag = useCallback((tagId: string) => {
    setSelectedTagIds(prev =>
      prev.includes(tagId) ? prev.filter(id => id !== tagId) : [...prev, tagId]
    );
  }, []);

  const addDocument = useCallback((file: PickedFile) => {
    const id = `pending-${Date.now()}`;
    setPendingDocuments(prev => [...prev, { ...file, id, label: file.fileName }]);
  }, []);

  const removeDocument = useCallback((id: string) => {
    setPendingDocuments(prev => prev.filter(doc => doc.id !== id));
  }, []);

  const reset = useCallback(() => {
    setObjective('');
    setAcceptanceCriteria('');
    setSelectedTagIds([]);
    setPendingDocuments([]);
    setOpenSelectorPanel(null);
  }, []);

  const selectedProject = useMemo(
    () => projects.find(p => p.id === projectId) ?? null,
    [projects, projectId]
  );

  const canSubmit = objective.trim().length > 0 && !!selectedProject && !submitting;

  const submit = useCallback(async (): Promise<string | null> => {
    const trimmed = objective.trim();
    if (!trimmed || !selectedProject) return null;
    setSubmitting(true);
    try {
      const supabase = getSupabase();
      const title = trimmed.length > 80 ? trimmed.substring(0, 77) + '...' : trimmed;
      const selection = agentSelection ?? resolvedAgentSelection;

      const { data: ticket, error: ticketError } = await supabase
        .from('tickets')
        .insert({
          title,
          status: 'draft',
          priority: 'medium',
          for_human: false,
          organization_id: selectedProject.organization_id,
          project_id: selectedProject.id,
          acceptance_criteria:
            acceptanceCriteria.trim().length > 0 ? acceptanceCriteria.trim() : null
        })
        .select('id')
        .single();

      if (ticketError || !ticket) {
        throw new Error(ticketError?.message ?? 'Failed to create ticket.');
      }

      const { data: createdObjective, error: objectiveError } = await supabase
        .from('objectives')
        .insert({
          ticket_id: ticket.id,
          objective: trimmed,
          state: 'draft',
          assigned_agent: createAssignedAgent(selection)
        })
        .select('id')
        .single();

      if (objectiveError || !createdObjective) {
        throw new Error(objectiveError?.message ?? 'Failed to create objective.');
      }

      await supabase.from('ticket_events').insert({
        event_type: 'system',
        summary: 'Ticket created from mobile.',
        ticket_id: ticket.id,
        objective_id: createdObjective.id
      });

      if (selectedTagIds.length > 0) {
        const { error: tagError } = await supabase.from('ticket_tag_assignments').insert(
          selectedTagIds.map(tagDefinitionId => ({
            ticket_id: ticket.id,
            tag_definition_id: tagDefinitionId,
            source: 'user',
            applied_by: user?.id ?? null
          }))
        );
        if (tagError) {
          // Non-fatal: the ticket exists; surface tag failures without losing it.
          console.error('Failed to attach tags to ticket:', tagError.message);
        }
      }

      for (const doc of pendingDocuments) {
        const storagePath = `${selectedProject.organization_id}/${selectedProject.id}/${ticket.id}/${createdObjective.id}/${Date.now()}-${doc.fileName}`;
        const response = await fetch(doc.uri);
        const blob = await response.blob();
        const buffer = await blob.arrayBuffer();
        const { error: uploadError } = await supabase.storage
          .from('artifacts')
          .upload(storagePath, buffer, { contentType: doc.mimeType, upsert: false });
        if (uploadError) continue;
        await supabase.from('objective_attachments').insert({
          objective_id: createdObjective.id,
          ticket_id: ticket.id,
          content_type: doc.mimeType,
          file_size: doc.fileSize,
          label: doc.fileName,
          storage_path: storagePath,
          metadata: { size: doc.fileSize, type: doc.mimeType, fileName: doc.fileName }
        });
      }

      // Remember this project as the most-recent selection for next time.
      setRecentProjectId(selectedProject.id);

      return ticket.id;
    } finally {
      setSubmitting(false);
    }
  }, [
    acceptanceCriteria,
    agentSelection,
    objective,
    pendingDocuments,
    resolvedAgentSelection,
    selectedProject,
    selectedTagIds,
    user?.id
  ]);

  return {
    projects,
    loadingProjects,
    projectId,
    setProjectId: selectProject,
    openSelectorPanel,
    setOpenSelectorPanel,
    agentSelection,
    setAgentSelection,
    resolvedAgentSelection,
    setResolvedAgentSelection,
    objective,
    setObjective,
    acceptanceCriteria,
    setAcceptanceCriteria,
    tagDefinitions,
    loadingTags,
    selectedTagIds,
    toggleTag,
    pendingDocuments,
    addDocument,
    removeDocument,
    submitting,
    canSubmit,
    selectedProject,
    submit,
    reset
  };
}

export type CreateTicketForm = ReturnType<typeof useCreateTicketForm>;
