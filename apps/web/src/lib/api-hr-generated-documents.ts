// Client des documents RH générés (attestation, certificat de travail) — ADR-0072.
//
// La génération range le PDF dans les documents RH de la fiche : il se télécharge
// ensuite par le client des documents existant. L'aperçu revient en PDF (blob).

import type {
  GenerateHrDocumentInput,
  GeneratedDocumentPage,
  GeneratedDocumentSettingsView,
  GeneratedDocumentView,
  HrDocumentView,
  PutGeneratedDocumentSettingsInput,
} from '@lalanda/shared/hr';

import { API_URL, EVENEMENT_REFUS_API, jsonRequest } from './api';

export type {
  CertificateJob,
  GenerateHrDocumentInput,
  GeneratedDocumentKind,
  GeneratedDocumentSettingsView,
  GeneratedDocumentTemplateId,
  GeneratedDocumentView,
} from '@lalanda/shared/hr';

const e = (id: string) => encodeURIComponent(id);

type ErreurHttp = Error & { status: number; detail: unknown };

async function erreur(res: Response): Promise<ErreurHttp> {
  const text = await res.text();
  let detail: unknown = text;
  try {
    detail = JSON.parse(text);
  } catch {
    /* texte brut */
  }
  const err = new Error(
    typeof detail === 'object' && detail !== null && 'message' in detail
      ? String((detail as { message: unknown }).message)
      : `HTTP ${res.status}`,
  ) as ErreurHttp;
  err.status = res.status;
  err.detail = detail;
  if (res.status === 403 && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENEMENT_REFUS_API, { detail }));
  }
  return err;
}

export const hrGeneratedDocumentsApi = {
  settings: (): Promise<GeneratedDocumentSettingsView> =>
    jsonRequest('/hr/generated-documents/settings'),
  putSettings: (body: PutGeneratedDocumentSettingsInput): Promise<GeneratedDocumentSettingsView> =>
    jsonRequest('/hr/generated-documents/settings', { method: 'PUT', body }),
  list: (employeeId: string): Promise<GeneratedDocumentPage> =>
    jsonRequest(`/hr/employees/${e(employeeId)}/generated-documents`),
  generate: (
    employeeId: string,
    body: GenerateHrDocumentInput,
  ): Promise<{ generated: GeneratedDocumentView; document: HrDocumentView }> =>
    jsonRequest(`/hr/employees/${e(employeeId)}/generated-documents`, { method: 'POST', body }),
  preview: async (employeeId: string, body: GenerateHrDocumentInput): Promise<Blob> => {
    const res = await fetch(
      `${API_URL}/hr/employees/${e(employeeId)}/generated-documents/preview`,
      {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) throw await erreur(res);
    return res.blob();
  },
};
