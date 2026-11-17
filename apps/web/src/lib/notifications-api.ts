// Client de la boîte de notifications in-app (ADR-0039 § 4, lot L2).
//
// Fichier séparé de `api.ts` (ADR-0039, fichiers partagés) : les formes viennent
// des contrats partagés `@lalanda/shared/notifications`, jamais recopiées.

import type {
  NotificationChannel,
  NotificationChannelsView,
  NotificationDeliveriesPageView,
  NotificationKind,
  NotificationOrgSettingsView,
  NotificationPageView,
  NotificationPreferencesView,
  NotificationSettingsView,
  NotificationTestView,
  NotificationView,
  PutNotificationOrgSettingsBody,
  PutNotificationSettingsBody,
  UnreadCountView,
  UnreadElsewhereView,
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
  unreadCount: () => jsonRequest<UnreadCountView>('/notifications/unread-count', { method: 'GET' }),
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
  // ADR-0079 : non lues des autres organisations, réglages, canaux, tests, journal.
  unreadElsewhere: () =>
    jsonRequest<UnreadElsewhereView>('/notifications/unread-elsewhere', { method: 'GET' }),
  settings: () => jsonRequest<NotificationSettingsView>('/notifications/settings', { method: 'GET' }),
  putSettings: (body: PutNotificationSettingsBody) =>
    jsonRequest<NotificationSettingsView>('/notifications/settings', { method: 'PUT', body }),
  orgSettings: () =>
    jsonRequest<NotificationOrgSettingsView>('/notifications/organization-settings', {
      method: 'GET',
    }),
  putOrgSettings: (body: PutNotificationOrgSettingsBody) =>
    jsonRequest<NotificationOrgSettingsView>('/notifications/organization-settings', {
      method: 'PUT',
      body,
    }),
  channels: () => jsonRequest<NotificationChannelsView>('/notifications/channels', { method: 'GET' }),
  test: (channel: NotificationChannel) =>
    jsonRequest<NotificationTestView>('/notifications/test', { method: 'POST', body: { channel } }),
  deliveries: (params: { cursor?: string | null; organization?: boolean } = {}) =>
    jsonRequest<NotificationDeliveriesPageView>(
      `/notifications/deliveries${params.organization ? '/organization' : ''}${
        params.cursor ? `?cursor=${encodeURIComponent(params.cursor)}` : ''
      }`,
      { method: 'GET' },
    ),
};
