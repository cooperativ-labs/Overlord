import type {
  CreateWebhookSubscriptionBody,
  CreateWebhookSubscriptionResultDto,
  RotateWebhookSecretResultDto,
  UpdateWebhookSubscriptionBody,
  WebhookDeliveryAttemptsPageDto,
  WebhookSubscriptionDto
} from '../../../shared/contract.ts';

import { request } from './request.ts';

export const webhooksApi = {
  listWebhookSubscriptions: (workspaceId: string) =>
    request<WebhookSubscriptionDto[]>(
      'GET',
      `/api/webhooks?workspaceId=${encodeURIComponent(workspaceId)}`
    ),
  createWebhookSubscription: (body: CreateWebhookSubscriptionBody) =>
    request<CreateWebhookSubscriptionResultDto>('POST', '/api/webhooks', body),
  updateWebhookSubscription: (id: string, body: UpdateWebhookSubscriptionBody) =>
    request<WebhookSubscriptionDto>('PATCH', `/api/webhooks/${id}`, body),
  deleteWebhookSubscription: (id: string) => request<{ ok: true }>('DELETE', `/api/webhooks/${id}`),
  rotateWebhookSecret: (id: string) =>
    request<RotateWebhookSecretResultDto>('POST', `/api/webhooks/${id}/rotate-secret`),
  testWebhookSubscription: (id: string) =>
    request<{ ok: true; responseStatus: number | null }>('POST', `/api/webhooks/${id}/test`),
  listWebhookDeliveries: (id: string, before?: string | null) =>
    request<WebhookDeliveryAttemptsPageDto>(
      'GET',
      `/api/webhooks/${id}/deliveries${before ? `?before=${encodeURIComponent(before)}` : ''}`
    ),
  redeliverWebhookDelivery: (id: string, outboxId: string) =>
    request<{ ok: true }>('POST', `/api/webhooks/${id}/deliveries/${outboxId}/redeliver`)
};
