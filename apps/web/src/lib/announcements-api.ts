// Client des annonces de la plateforme (ADR-0053 § 6.6, § 7 — lot P6).
//
// Fichier séparé de `api.ts` (zone de conflit des lots P1, P4) : deux surfaces.
//   - DESTINATAIRE (`/me/announcements`) : bannière et cloche de l'espace organisation ;
//   - CONSOLE (`/admin/announcements/**`) : préparer, approuver, envoyer.
// Les formes de la catégorie viennent de `@lalanda/shared/platform`. Rien ici n'autorise :
// l'API juge de tout (action plateforme, seconde personne, ré-authentification).

import type { AudienceFilter } from '@lalanda/shared/platform';

import { jsonRequest } from './api';

/** Vue du destinataire : texte et dates, jamais la catégorie ni l'auteur. */
export interface MyAnnouncementView {
  id: string;
  kind: 'platform.announcement';
  title: string;
  body: string;
  startsAt: string;
  expiresAt: string;
  readAt: string | null;
  dismissedAt: string | null;
}

export type AdminAnnouncementStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'sent'
  | 'canceled'
  /** ADR-0054 : envoyée puis retirée par un opérateur. */
  | 'withdrawn';

export interface AdminAnnouncementView {
  id: string;
  title: string;
  body: string;
  channel: 'in_app';
  audience: AudienceFilter;
  status: AdminAnnouncementStatus;
  previewCount: number | null;
  previewedAt: string | null;
  audienceCountAtApproval: number | null;
  createdBy: string;
  submittedBy: string | null;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  soleApprover: boolean;
  sentBy: string | null;
  sentAt: string | null;
  recipientCount: number | null;
  expiresAt: string | null;
  canceledAt: string | null;
  withdrawnBy: string | null;
  withdrawnAt: string | null;
  createdAt: string;
}

export interface AnnouncementDraftBody {
  title: string;
  body: string;
  audience: AudienceFilter;
  expiresAt?: string;
}

const id = (v: string): string => encodeURIComponent(v);

export const announcementsApi = {
  // ── Destinataire ──
  mine: () =>
    jsonRequest<{ announcements: MyAnnouncementView[] }>('/me/announcements', { method: 'GET' }),
  markRead: (announcementId: string) =>
    jsonRequest<MyAnnouncementView>(`/me/announcements/${id(announcementId)}/read`, {
      method: 'POST',
      body: {},
    }),
  dismiss: (announcementId: string) =>
    jsonRequest<MyAnnouncementView>(`/me/announcements/${id(announcementId)}/dismiss`, {
      method: 'POST',
      body: {},
    }),

  // ── Console ──
  list: () =>
    jsonRequest<{ announcements: AdminAnnouncementView[] }>('/admin/announcements', {
      method: 'GET',
    }),
  create: (body: AnnouncementDraftBody) =>
    jsonRequest<AdminAnnouncementView>('/admin/announcements', { method: 'POST', body }),
  update: (announcementId: string, body: AnnouncementDraftBody) =>
    jsonRequest<AdminAnnouncementView>(`/admin/announcements/${id(announcementId)}`, {
      method: 'PUT',
      body,
    }),
  preview: (announcementId: string) =>
    jsonRequest<AdminAnnouncementView>(`/admin/announcements/${id(announcementId)}/preview`, {
      method: 'POST',
      body: {},
    }),
  submit: (announcementId: string) =>
    jsonRequest<AdminAnnouncementView>(`/admin/announcements/${id(announcementId)}/submit`, {
      method: 'POST',
      body: {},
    }),
  approve: (announcementId: string) =>
    jsonRequest<AdminAnnouncementView>(`/admin/announcements/${id(announcementId)}/approve`, {
      method: 'POST',
      body: {},
    }),
  send: (announcementId: string, confirmedAudienceCount: number) =>
    jsonRequest<AdminAnnouncementView>(`/admin/announcements/${id(announcementId)}/send`, {
      method: 'POST',
      body: { confirmedAudienceCount },
    }),
  cancel: (announcementId: string, reason: string) =>
    jsonRequest<AdminAnnouncementView>(`/admin/announcements/${id(announcementId)}/cancel`, {
      method: 'POST',
      body: { reason },
    }),
  /** ADR-0054 : retirer une annonce envoyée (motif, ré-authentification). */
  withdraw: (announcementId: string, reason: string) =>
    jsonRequest<AdminAnnouncementView>(`/admin/announcements/${id(announcementId)}/withdraw`, {
      method: 'POST',
      body: { reason },
    }),
};
