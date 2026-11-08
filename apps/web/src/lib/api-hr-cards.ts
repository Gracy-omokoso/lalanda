// Client des cartes de service et cartes de visite — ADR-0069.
//
// Deux faces : les routes RH (session, `jsonRequest` et téléchargements), et la
// page PUBLIQUE de vérification (`/v/[token]`), qui appelle l'API SANS cookie
// (`credentials: 'omit'`), comme le formulaire public de prospects.

import type {
  CardBatchInput,
  CardExportInput,
  CardFace,
  CardPackageView,
  CardProfileView,
  CardSettingsView,
  CardVariant,
  PublicCardView,
  PutCardConsentInput,
  PutCardSettingsInput,
} from '@lalanda/shared/hr';

import { API_URL, EVENEMENT_REFUS_API, jsonRequest } from './api';

export type {
  CardBatchFormat,
  CardExportFormat,
  CardFace,
  CardKind,
  CardOrientation,
  CardPackageView,
  CardProfileView,
  CardSettingsView,
  CardTemplateSummary,
  CardVariant,
  PublicCardView,
} from '@lalanda/shared/hr';

export interface FichierCarte {
  blob: Blob;
  nom: string;
}

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

async function fichier(
  path: string,
  init: { method: 'GET' | 'POST' | 'PUT'; body?: BodyInit; type?: string },
  nomParDefaut: string,
): Promise<FichierCarte> {
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method,
    credentials: 'include',
    cache: 'no-store',
    headers: init.type ? { 'content-type': init.type } : undefined,
    body: init.body,
  });
  if (!res.ok) throw await erreur(res);
  const cd = res.headers.get('content-disposition') ?? '';
  const nom = /filename="([^"]+)"/i.exec(cd)?.[1] ?? nomParDefaut;
  return { blob: await res.blob(), nom };
}

const e = (id: string) => encodeURIComponent(id);

export const hrCardsApi = {
  settings: (): Promise<CardSettingsView> => jsonRequest('/hr/cards/settings'),
  putSettings: (body: PutCardSettingsInput): Promise<CardSettingsView> =>
    jsonRequest('/hr/cards/settings', { method: 'PUT', body }),
  packages: (): Promise<{ packages: CardPackageView[] }> => jsonRequest('/hr/cards/packages'),
  installPackage: async (zip: File): Promise<{ installed: CardPackageView; created: boolean }> => {
    const res = await fetch(`${API_URL}/hr/cards/packages`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/zip' },
      body: zip,
    });
    if (!res.ok) throw await erreur(res);
    return (await res.json()) as { installed: CardPackageView; created: boolean };
  },
  preview: (
    templateId: string,
    opts: { format: 'png' | 'pdf'; face: CardFace; variant?: CardVariant },
  ): Promise<FichierCarte> => {
    const q = new URLSearchParams({ format: opts.format, face: opts.face });
    if (opts.variant) q.set('variant', opts.variant);
    return fichier(
      `/hr/cards/templates/${e(templateId)}/preview?${q.toString()}`,
      { method: 'GET' },
      `apercu.${opts.format}`,
    );
  },
  batch: (body: CardBatchInput): Promise<FichierCarte> =>
    fichier(
      '/hr/cards/batch',
      { method: 'POST', body: JSON.stringify(body), type: 'application/json' },
      body.format === 'png-zip' ? 'cartes.zip' : 'cartes.pdf',
    ),
  profile: (employeeId: string): Promise<CardProfileView> =>
    jsonRequest(`/hr/employees/${e(employeeId)}/card`),
  photo: (employeeId: string): Promise<FichierCarte> =>
    fichier(`/hr/employees/${e(employeeId)}/card/photo`, { method: 'GET' }, 'photo'),
  putConsent: (employeeId: string, body: PutCardConsentInput): Promise<CardProfileView> =>
    jsonRequest(`/hr/employees/${e(employeeId)}/card/consent`, { method: 'PUT', body }),
  putPhoto: async (employeeId: string, image: File): Promise<CardProfileView> => {
    const res = await fetch(`${API_URL}/hr/employees/${e(employeeId)}/card/photo`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': image.type || 'application/octet-stream' },
      body: image,
    });
    if (!res.ok) throw await erreur(res);
    return (await res.json()) as CardProfileView;
  },
  removePhoto: (employeeId: string): Promise<CardProfileView> =>
    jsonRequest(`/hr/employees/${e(employeeId)}/card/photo`, { method: 'DELETE' }),
  issue: (employeeId: string, expectedRevision: number): Promise<CardProfileView> =>
    jsonRequest(`/hr/employees/${e(employeeId)}/card/issue`, {
      method: 'POST',
      body: { expectedRevision },
    }),
  revoke: (employeeId: string, expectedRevision: number): Promise<CardProfileView> =>
    jsonRequest(`/hr/employees/${e(employeeId)}/card/revoke`, {
      method: 'POST',
      body: { expectedRevision },
    }),
  exportCard: (employeeId: string, q: CardExportInput): Promise<FichierCarte> => {
    const params = new URLSearchParams({ kind: q.kind, format: q.format, face: q.face });
    if (q.template) params.set('template', q.template);
    return fichier(
      `/hr/employees/${e(employeeId)}/card/export?${params.toString()}`,
      { method: 'GET' },
      `carte.${q.format}`,
    );
  },
};

/** Page publique : sans cookie. Toute panne réseau est distinguée d'une carte non valide. */
export async function verifierCarte(
  token: string,
): Promise<PublicCardView | { erreur: 'reseau' | 'debit' }> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/public/cards/${encodeURIComponent(token)}`, {
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch {
    return { erreur: 'reseau' };
  }
  if (res.status === 429) return { erreur: 'debit' };
  if (!res.ok) return { valid: false };
  return (await res.json()) as PublicCardView;
}
