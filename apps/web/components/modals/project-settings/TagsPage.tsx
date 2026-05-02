'use client';

import { Check, Loader2, Pencil, Plus, Tag, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  createProjectTagDefinitionAction,
  listProjectTagDefinitionsAction,
  type ProjectTagDefinition,
  updateProjectTagDefinitionAction
} from '@/lib/actions/tags';

type TagsPageProps = {
  projectId: string;
  open: boolean;
};

export function TagsPage({ projectId, open }: TagsPageProps) {
  const [tags, setTags] = useState<ProjectTagDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newKey, setNewKey] = useState('');
  const [adding, setAdding] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);
  const newLabelInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    listProjectTagDefinitionsAction(projectId)
      .then(setTags)
      .catch(() => toast.error('Failed to load tags'))
      .finally(() => setLoading(false));
  }, [open, projectId]);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  useEffect(() => {
    if (showAdd && newLabelInputRef.current) {
      newLabelInputRef.current.focus();
    }
  }, [showAdd]);

  function handleStartEdit(tag: ProjectTagDefinition) {
    setEditingId(tag.id);
    setEditLabel(tag.label);
  }

  function handleCancelEdit() {
    setEditingId(null);
    setEditLabel('');
  }

  async function handleSaveEdit(tag: ProjectTagDefinition) {
    const trimmed = editLabel.trim();
    if (!trimmed || trimmed === tag.label) {
      handleCancelEdit();
      return;
    }

    setSavingId(tag.id);
    try {
      const updated = await updateProjectTagDefinitionAction(tag.id, { label: trimmed });
      setTags(prev => prev.map(t => (t.id === updated.id ? updated : t)));
      setEditingId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update tag');
    } finally {
      setSavingId(null);
    }
  }

  async function handleToggleActive(tag: ProjectTagDefinition) {
    setSavingId(tag.id);
    try {
      const updated = await updateProjectTagDefinitionAction(tag.id, {
        is_active: !tag.is_active
      });
      setTags(prev => prev.map(t => (t.id === updated.id ? updated : t)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update tag');
    } finally {
      setSavingId(null);
    }
  }

  function deriveKey(label: string): string {
    return label
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
  }

  function handleNewLabelChange(value: string) {
    setNewLabel(value);
    setNewKey(deriveKey(value));
  }

  async function handleAddTag() {
    const trimmedLabel = newLabel.trim();
    const trimmedKey = newKey.trim();
    if (!trimmedLabel || !trimmedKey) return;

    setAdding(true);
    try {
      const created = await createProjectTagDefinitionAction(projectId, {
        key: trimmedKey,
        label: trimmedLabel
      });
      setTags(prev => [...prev, created].sort((a, b) => a.label.localeCompare(b.label)));
      setNewLabel('');
      setNewKey('');
      setShowAdd(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create tag');
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="mb-1 text-sm font-semibold">Project Tags</h2>
        <p className="text-xs text-muted-foreground">
          Define tags for this project. Rename labels freely — the internal key stays stable so
          existing assignments are preserved.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading tags…
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {tags.length === 0 && !showAdd ? (
            <p className="text-xs text-muted-foreground">No tags yet. Add one below.</p>
          ) : null}

          {tags.map(tag => (
            <div key={tag.id} className="group flex items-center gap-3 rounded-md border px-3 py-2">
              <Tag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />

              {editingId === tag.id ? (
                <Input
                  ref={editInputRef}
                  value={editLabel}
                  onChange={e => setEditLabel(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleSaveEdit(tag);
                    if (e.key === 'Escape') handleCancelEdit();
                  }}
                  className="h-6 flex-1 text-sm"
                />
              ) : (
                <span
                  className={`flex-1 text-sm ${!tag.is_active ? 'text-muted-foreground line-through' : ''}`}
                >
                  {tag.label}
                </span>
              )}

              <span className="hidden text-[10px] text-muted-foreground sm:inline">{tag.key}</span>

              {!tag.is_active && (
                <Badge variant="outline" className="text-[10px]">
                  archived
                </Badge>
              )}

              <div className="flex shrink-0 items-center gap-1">
                {editingId === tag.id ? (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => handleSaveEdit(tag)}
                      disabled={savingId === tag.id}
                    >
                      {savingId === tag.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Check className="h-3 w-3" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={handleCancelEdit}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={() => handleStartEdit(tag)}
                      title="Rename label"
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => handleToggleActive(tag)}
                      disabled={savingId === tag.id}
                      title={tag.is_active ? 'Archive tag' : 'Restore tag'}
                    >
                      {savingId === tag.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <X className={`h-3 w-3 ${tag.is_active ? '' : 'text-green-600'}`} />
                      )}
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}

          {showAdd ? (
            <div className="flex flex-col gap-2 rounded-md border px-3 py-3">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <Input
                    ref={newLabelInputRef}
                    placeholder="Label (e.g. Web App)"
                    value={newLabel}
                    onChange={e => handleNewLabelChange(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleAddTag();
                      if (e.key === 'Escape') {
                        setShowAdd(false);
                        setNewLabel('');
                        setNewKey('');
                      }
                    }}
                    className="h-8 flex-1 text-sm"
                  />
                  <Button
                    size="sm"
                    onClick={handleAddTag}
                    disabled={!newLabel.trim() || !newKey.trim() || adding}
                    className="h-8"
                  >
                    {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Add'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8"
                    onClick={() => {
                      setShowAdd(false);
                      setNewLabel('');
                      setNewKey('');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
                {newKey ? (
                  <p className="text-[10px] text-muted-foreground">
                    Key: <code className="font-mono">{newKey}</code> (stable, not editable after
                    creation)
                  </p>
                ) : null}
              </div>
            </div>
          ) : (
            <Button variant="outline" size="sm" className="w-fit" onClick={() => setShowAdd(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add tag
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
