// Client du formulaire public de prospects — ADR-0048.
//
// Deux faces : les RÉGLAGES (session, `jsonRequest`) et la page PUBLIQUE
// (`/f/[token]`), qui appelle l'API SANS cookie (`credentials: 'omit'`) : le
// visiteur n'a pas de compte, et un membre connecté qui vérifie son lien ne
// doit pas envoyer sa session à une route qui n'en a pas besoin.

import type {
  CreateLeadFormBody,
  CrmLeadFormEnvelope,
  CrmLeadFormView,
  PublicLeadFormView,
  PublicLeadSubmissionResult,
  UpdateLeadFormBody,
} from '@lalanda/shared/crm';

import { API_URL, jsonRequest } from './api';

export type {
  CrmLeadFormView,
  LeadFormFieldConfig,
  LeadFormFieldKey,
  PublicLeadFormField,
  PublicLeadFormView,
} from '@lalanda/shared/crm';

/** Corps de création (fenêtre modale) : tout est facultatif, le serveur complète. */
export type CreateLeadFormInput = Partial<CreateLeadFormBody>;
/** Corps des réglages complets. */
export type UpdateLeadFormInput = UpdateLeadFormBody;

export const leadFormsApi = {
  get: (): Promise<CrmLeadFormEnvelope> => jsonRequest('/crm/lead-form'),
  create: (body: CreateLeadFormInput): Promise<CrmLeadFormView> =>
    jsonRequest('/crm/lead-form', { method: 'POST', body }),
  update: (body: UpdateLeadFormInput): Promise<CrmLeadFormView> =>
    jsonRequest('/crm/lead-form', { method: 'PUT', body }),
  rotateToken: (expectedRevision: number): Promise<CrmLeadFormView> =>
    jsonRequest('/crm/lead-form/rotate-token', { method: 'POST', body: { expectedRevision } }),
};

/** Erreur d'un appel public : statut, code et problèmes par champ. */
export class PublicFormError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
    readonly issues: { path: string; code: string; message: string }[],
  ) {
    super(message);
  }
}

async function publicRequest<T>(
  path: string,
  init?: { method: 'POST'; body: unknown },
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init?.method ?? 'GET',
      credentials: 'omit',
      cache: 'no-store',
      headers: init ? { 'content-type': 'application/json' } : undefined,
      body: init ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new PublicFormError(0, null, 'Connexion impossible : vérifiez votre réseau.', []);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const d = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
    const details = (d['details'] ?? {}) as { issues?: unknown };
    throw new PublicFormError(
      res.status,
      typeof d['code'] === 'string' ? d['code'] : null,
      typeof d['message'] === 'string' ? d['message'] : `Erreur ${res.status}`,
      Array.isArray(details.issues)
        ? (details.issues as { path: string; code: string; message: string }[])
        : [],
    );
  }
  return data as T;
}

export const publicLeadFormApi = {
  config: (token: string): Promise<PublicLeadFormView> =>
    publicRequest(`/public/lead-forms/${encodeURIComponent(token)}`),
  submit: (token: string, body: Record<string, unknown>): Promise<PublicLeadSubmissionResult> =>
    publicRequest(`/public/lead-forms/${encodeURIComponent(token)}/submissions`, {
      method: 'POST',
      body,
    }),
};
