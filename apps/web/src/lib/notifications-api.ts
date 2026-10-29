// Client de la boîte de notifications in-app (ADR-0039 § 4, lot L2).
//
// Fichier séparé de `api.ts` (ADR-0039, fichiers partagés) : les formes viennent
// des contrats partagés `@lalanda/shared/notifications`, jamais recopiées.

import type {
  NotificationKind,
  NotificationPageView,
  NotificationPreferencesView,
  NotificationView,
  UnreadCountView,
} from '@lalanda/shared/notifications';

import { jsonRequest } from './api';

export interface ListNotificationsParams {
  unreadOnly?: boolean;
  limit?: number;
  cursor?: string | null;
}

function queryOf(params: ListNotificationsParams): string {
  const qs = new URLSearchParams();
  if (params.unreadOnly) qs.set('unreadOnly', 'true');
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  if (params.cursor) qs.set('cursor', params.cursor);
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export const notificationsApi = {
  list: (params: ListNotificationsParams = {}) =>
    jsonRequest<NotificationPageView>(`/notifications${queryOf(params)}`, { method: 'GET' }),
  unreadCount: () =>
    jsonRequest<UnreadCountView>('/notifications/unread-count', { method: 'GET' }),
  markRead: (notificationId: string) =>
    jsonRequest<NotificationView>(`/notifications/${encodeURIComponent(notificationId)}/read`, {
      method: 'POST',
      body: {},
    }),
  markAllRead: () =>
    jsonRequest<UnreadCountView>('/notifications/read-all', { method: 'POST', body: {} }),
  preferences: () =>
    jsonRequest<NotificationPreferencesView>('/notifications/preferences', { method: 'GET' }),
  setPreferences: (mutedKinds: NotificationKind[]) =>
    jsonRequest<NotificationPreferencesView>('/notifications/preferences', {
      method: 'PUT',
      body: { mutedKinds },
    }),
};
