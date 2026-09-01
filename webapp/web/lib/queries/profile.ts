import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { NotificationDto, UpdateProfileBody } from '../../../shared/contract.ts';
import { api } from '../api.ts';
import { clearAuthTokens } from '../api-base.ts';
import { authClient, normalizeEmail } from '../auth-client.ts';
import { keys } from '../query-keys.ts';

export const useMeta = () => useQuery({ queryKey: keys.meta, queryFn: api.meta });

export const useProfile = () => useQuery({ queryKey: keys.profile, queryFn: api.getProfile });

export const useNotifications = () =>
  useQuery<NotificationDto[]>({ queryKey: keys.notifications, queryFn: api.listNotifications });

export const useNotificationPreferences = () =>
  useQuery({ queryKey: keys.notificationPreferences, queryFn: api.getNotificationPreferences });

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, revision }: { id: string; revision: number }) =>
      api.markNotificationRead(id, revision),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.notifications })
  });
}

export function useDismissNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, revision }: { id: string; revision: number }) =>
      api.dismissNotification(id, revision),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.notifications })
  });
}

export const useDefaultProject = () =>
  useQuery({ queryKey: keys.defaultProject, queryFn: api.getDefaultProject });

export function useSetDefaultProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => api.setDefaultProject(projectId),
    onSuccess: preference => {
      qc.setQueryData(keys.defaultProject, preference);
      void qc.invalidateQueries({ queryKey: keys.meta });
    }
  });
}

export function useClearDefaultProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.clearDefaultProject,
    onSuccess: preference => {
      qc.setQueryData(keys.defaultProject, preference);
      void qc.invalidateQueries({ queryKey: keys.meta });
    }
  });
}

/**
 * Live runner queue status for the sidebar runner box. Polls on a light
 * interval so the subtle status indicator stays current without a realtime
 * subscription.
 */

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateProfileBody) => api.updateProfile(body),
    onSuccess: data => {
      qc.setQueryData(keys.profile, data);
      // The sidebar identity reads from the workspace meta, so refresh it too.
      void qc.invalidateQueries({ queryKey: keys.meta });
    }
  });
}

/**
 * Change the account email through the Auth surface. Email is the primary
 * account identifier, so this updates the Better Auth account email directly;
 * the auth→profiles bridge then mirrors the new email into `profiles.email`.
 */
export function useChangeEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rawEmail: string) => {
      const email = normalizeEmail(rawEmail);
      const reemailed = await authClient.changeEmail({ newEmail: email });
      if (reemailed.error) {
        throw new Error(reemailed.error.message ?? 'Failed to update email.');
      }
      return email;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.profile });
      void qc.invalidateQueries({ queryKey: keys.meta });
    }
  });
}

/** Change the account password through the Auth surface (requires the current password). */
export function useChangePassword() {
  return useMutation({
    mutationFn: async (input: { currentPassword: string; newPassword: string }) => {
      const result = await authClient.changePassword({
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
        revokeOtherSessions: true
      });
      if (result.error) {
        throw new Error(result.error.message ?? 'Failed to update password.');
      }
    }
  });
}

/**
 * Permanently delete the signed-in account through the Auth surface. The
 * server cascades workspace memberships, tokens, and avatar images before
 * removing the underlying auth user (see backend/account-deletion.ts), then
 * clears the session cookie itself — this only needs to drop local tokens
 * once the call succeeds so the next render sees a signed-out state.
 */
export function useDeleteAccount() {
  return useMutation({
    mutationFn: async (password: string) => {
      const result = await authClient.deleteUser({ password });
      if (result.error) {
        throw new Error(result.error.message ?? 'Failed to delete account.');
      }
    },
    onSuccess: async () => {
      await clearAuthTokens();
    }
  });
}

/**
 * Upload an image to the `user-images` bucket via the core upload service and
 * set it as the operator's avatar in one step. Returns the updated profile.
 */
export function useUploadAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const stored = await api.uploadImage('user-images', file);
      return api.updateProfile({ avatarUrl: stored.url });
    },
    onSuccess: data => {
      qc.setQueryData(keys.profile, data);
      void qc.invalidateQueries({ queryKey: keys.meta });
    }
  });
}

/**
 * Upload an image to the `organization-images` bucket and set it as the given
 * organization's logo. Org-admin-only on the server side.
 */
