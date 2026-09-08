import { useState } from 'react';

import type { ButtonLoadingState } from '@/components/ui/loading-button';
import {
  useCreateWebhookSubscription,
  useRotateWebhookSecret,
  useUpdateWebhookSubscription
} from '@/lib/queries';

import type {
  CreateWebhookSubscriptionBody,
  UpdateWebhookSubscriptionBody,
  WebhookEventType,
  WebhookSubscriptionDto
} from '../../../shared/contract.ts';

/** `'auto'` omits `payloadMode` from the request so the server applies its internal-host-aware default. */
export type PayloadModeSelection = 'auto' | 'thin' | 'full';

/** Either the create sentinel, the subscription being edited, or a closed dialog. */
export type WebhookDialogTarget = 'create' | WebhookSubscriptionDto | null;

export interface WebhookFormFields {
  endpointUrl: string;
  eventTypes: WebhookEventType[];
  name: string;
  payloadMode: PayloadModeSelection;
  /** 'all' means "every project in the workspace"; the wire body sends null for it. */
  projectId: string;
}

/** The subscription behind a target, or null when creating or closed. */
export function webhookDialogSubscription(
  target: WebhookDialogTarget
): WebhookSubscriptionDto | null {
  return target !== null && target !== 'create' ? target : null;
}

export function initialWebhookFormFields(target: WebhookDialogTarget): WebhookFormFields {
  const existing = webhookDialogSubscription(target);
  return {
    name: existing?.name ?? '',
    endpointUrl: existing?.endpointUrl ?? '',
    projectId: existing?.projectId ?? 'all',
    eventTypes: existing?.eventTypes ?? [],
    payloadMode: existing?.payloadMode ?? 'auto'
  };
}

export function validateWebhookFormFields(fields: WebhookFormFields): string | null {
  if (!fields.name.trim()) return 'Name is required.';
  if (fields.eventTypes.length === 0) return 'Select at least one event type.';
  return null;
}

export function toggleWebhookEventType(
  current: WebhookEventType[],
  value: WebhookEventType
): WebhookEventType[] {
  return current.includes(value) ? current.filter(v => v !== value) : [...current, value];
}

export function buildCreateWebhookBody(
  fields: WebhookFormFields,
  workspaceId: string
): CreateWebhookSubscriptionBody {
  return {
    name: fields.name.trim(),
    endpointUrl: fields.endpointUrl,
    workspaceId,
    projectId: fields.projectId === 'all' ? null : fields.projectId,
    eventTypes: fields.eventTypes,
    ...(fields.payloadMode !== 'auto' ? { payloadMode: fields.payloadMode } : {})
  };
}

export function buildUpdateWebhookBody(fields: WebhookFormFields): UpdateWebhookSubscriptionBody {
  return {
    name: fields.name.trim(),
    endpointUrl: fields.endpointUrl,
    projectId: fields.projectId === 'all' ? null : fields.projectId,
    eventTypes: fields.eventTypes,
    ...(fields.payloadMode !== 'auto' ? { payloadMode: fields.payloadMode } : {})
  };
}

/**
 * The signing secret is only ever handed back by a create; an edit save never
 * reveals one, so reopening the dialog on an existing subscription shows no
 * secret. Rotation is the only other reveal, and it goes through its own call.
 */
export function secretFromSaveResult({
  isEdit,
  result
}: {
  isEdit: boolean;
  result: { secret: string } | null;
}): string | null {
  if (isEdit) return null;
  return result?.secret ?? null;
}

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export function useWebhookDialogForm({
  target,
  workspaceId
}: {
  target: WebhookDialogTarget;
  workspaceId: string;
}) {
  const existing = webhookDialogSubscription(target);
  const isEdit = existing !== null;

  const createSubscription = useCreateWebhookSubscription();
  const updateSubscription = useUpdateWebhookSubscription();
  const rotateSecret = useRotateWebhookSecret();

  const initial = initialWebhookFormFields(target);
  const [name, setName] = useState(initial.name);
  const [endpointUrl, setEndpointUrl] = useState(initial.endpointUrl);
  const [projectId, setProjectId] = useState<string>(initial.projectId);
  const [eventTypes, setEventTypes] = useState<WebhookEventType[]>(initial.eventTypes);
  const [payloadMode, setPayloadMode] = useState<PayloadModeSelection>(initial.payloadMode);
  const [saveState, setSaveState] = useState<ButtonLoadingState>('default');
  const [error, setError] = useState<string | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);

  function reset(nextTarget: WebhookDialogTarget) {
    const next = initialWebhookFormFields(nextTarget);
    setName(next.name);
    setEndpointUrl(next.endpointUrl);
    setProjectId(next.projectId);
    setEventTypes(next.eventTypes);
    setPayloadMode(next.payloadMode);
    setSaveState('default');
    setError(null);
    setRevealedSecret(null);
  }

  function toggleEventType(value: WebhookEventType) {
    setEventTypes(current => toggleWebhookEventType(current, value));
  }

  async function save() {
    const fields: WebhookFormFields = { name, endpointUrl, projectId, eventTypes, payloadMode };
    const validationError = validateWebhookFormFields(fields);
    if (validationError) {
      setError(validationError);
      setSaveState('error');
      return;
    }
    setSaveState('loading');
    setError(null);
    try {
      if (isEdit && existing) {
        await updateSubscription.mutateAsync({
          id: existing.id,
          body: buildUpdateWebhookBody(fields)
        });
      } else {
        const result = await createSubscription.mutateAsync(
          buildCreateWebhookBody(fields, workspaceId)
        );
        setRevealedSecret(secretFromSaveResult({ isEdit: false, result }));
      }
      setSaveState('success');
    } catch (err) {
      setSaveState('error');
      setError(errorMessage(err, 'Failed to save webhook.'));
    }
  }

  async function rotate() {
    if (!existing) return;
    try {
      const result = await rotateSecret.mutateAsync(existing.id);
      setRevealedSecret(result.secret);
    } catch (err) {
      setError(errorMessage(err, 'Failed to rotate secret.'));
    }
  }

  return {
    isEdit,
    existing,
    fields: { name, endpointUrl, projectId, eventTypes, payloadMode },
    setName,
    setEndpointUrl,
    setProjectId,
    setPayloadMode,
    toggleEventType,
    saveState,
    setSaveState,
    error,
    revealedSecret,
    dismissSecret: () => setRevealedSecret(null),
    isRotating: rotateSecret.isPending,
    reset,
    save,
    rotate
  };
}
