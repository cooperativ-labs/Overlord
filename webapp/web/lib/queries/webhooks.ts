import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  CreateWebhookSubscriptionBody,
  UpdateWebhookSubscriptionBody
} from '../../../shared/contract.ts';
import { api } from '../api.ts';
import { keys } from '../query-keys.ts';

export const useWebhookSubscriptions = (workspaceId: string) =>
  useQuery({
    queryKey: keys.webhookSubscriptions(workspaceId),
    queryFn: () => api.listWebhookSubscriptions(workspaceId),
    enabled: Boolean(workspaceId)
  });

export const useWebhookDeliveries = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: keys.webhookDeliveries(id),
    queryFn: () => api.listWebhookDeliveries(id),
    enabled
  });

export function useCreateWebhookSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateWebhookSubscriptionBody) => api.createWebhookSubscription(body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['webhooks'] })
  });
}

export function useUpdateWebhookSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateWebhookSubscriptionBody }) =>
      api.updateWebhookSubscription(id, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['webhooks'] })
  });
}

export function useDeleteWebhookSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteWebhookSubscription(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['webhooks'] })
  });
}

export function useRotateWebhookSecret() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.rotateWebhookSecret(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['webhooks'] })
  });
}

export function useTestWebhookSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.testWebhookSubscription(id),
    onSuccess: (_result, id) => void qc.invalidateQueries({ queryKey: keys.webhookDeliveries(id) })
  });
}

export function useRedeliverWebhookDelivery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, outboxId }: { id: string; outboxId: string }) =>
      api.redeliverWebhookDelivery(id, outboxId),
    onSuccess: (_result, { id }) =>
      void qc.invalidateQueries({ queryKey: keys.webhookDeliveries(id) })
  });
}
