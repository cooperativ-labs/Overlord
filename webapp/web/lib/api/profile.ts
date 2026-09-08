import type {
  DefaultProjectPreferenceDto,
  NotificationDto,
  NotificationPreferencesDto,
  ProfileDto,
  StoredImageDto,
  UpdateNotificationPreferencesBody,
  UpdateProfileBody
} from '../../../shared/contract.ts';

import { type AuthProviders, type Meta, request } from './request.ts';

export const profileApi = {
  meta: () => request<Meta>('GET', '/api/meta'),
  /** Public (pre-auth) login-provider advertisement for the sign-in screen. */
  authProviders: () => request<AuthProviders>('GET', '/api/auth-providers'),

  getProfile: () => request<ProfileDto>('GET', '/api/profile'),
  updateProfile: (body: UpdateProfileBody) => request<ProfileDto>('PATCH', '/api/profile', body),
  getDefaultProject: () =>
    request<DefaultProjectPreferenceDto>('GET', '/api/profile/default-project'),
  setDefaultProject: (projectId: string) =>
    request<DefaultProjectPreferenceDto>('PUT', '/api/profile/default-project', { projectId }),
  clearDefaultProject: () =>
    request<DefaultProjectPreferenceDto>('DELETE', '/api/profile/default-project'),
  getNotificationPreferences: () =>
    request<NotificationPreferencesDto>('GET', '/api/profile/notification-preferences'),
  updateNotificationPreferences: (body: UpdateNotificationPreferencesBody) =>
    request<NotificationPreferencesDto>('PUT', '/api/profile/notification-preferences', body),
  listNotifications: () => request<NotificationDto[]>('GET', '/api/notifications'),
  markNotificationRead: (id: string, expectedRevision: number) =>
    request<NotificationDto>('PATCH', `/api/notifications/${encodeURIComponent(id)}/read`, {
      expectedRevision
    }),
  dismissNotification: (id: string, expectedRevision: number) =>
    request<{ ok: true }>('DELETE', `/api/notifications/${encodeURIComponent(id)}`, {
      expectedRevision
    }),

  /**
   * Core upload service: stream a single image File to a storage bucket and get
   * back its stored descriptor (including the URL that serves it). The raw bytes
   * are sent as the request body; the filename rides in a header so the server
   * can record it without multipart parsing.
   */
  uploadImage: (bucketKey: string, file: File) =>
    request<StoredImageDto>('POST', `/api/uploads/${encodeURIComponent(bucketKey)}`, file, {
      'Content-Type': file.type || 'application/octet-stream',
      'X-Upload-Filename': encodeURIComponent(file.name)
    })
};
