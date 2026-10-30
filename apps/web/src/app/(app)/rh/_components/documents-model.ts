// Documents RH (ADR-0045 § 2.8, § 3.3) — logique pure, lot H7.
//
// L'envoi est un formulaire MULTIPART : le fichier et ses métadonnées voyagent dans
// le corps (`api-hr-admin.ts`), jamais dans l'URL. Les vérifications ici sont de
// forme et de confort (type, taille, dates) ; l'API reconnaît le type au CONTENU,
// chiffre les pièces sensibles et reste juge.

import {
  HR_DOCUMENT_CATEGORIES,
  HR_LIMITS,
  UploadHrDocumentFields,
  defaultVisibleToEmployee,
  isSensitiveHrDocumentCategory,
  type HrDocumentCategory,
} from '@lalanda/shared/hr';

import type { OrgAction } from '@/lib/api';
import type { EnvoiDocument, HrDocumentView } from '@/lib/api-hr-admin';

import { formatJour } from './rh-model';

type Actions = readonly OrgAction[] | null;
const a = (x: Actions, action: OrgAction): boolean => x !== null && x.includes(action);

export const LIBELLES_CATEGORIE: Record<HrDocumentCategory, string> = {
  contract: 'Contrat',
  amendment: 'Avenant',
  id_document: 'Pièce d’identité',
  diploma: 'Diplôme',
  medical: 'Document médical',
  leave_justification: 'Justificatif d’absence',
  onboarding: 'Accueil',
  other: 'Autre',
};

/** Le lecteur peut-il déposer un document sur cette fiche ? */
export function peutDeposer(actions: Actions, estSoi: boolean): boolean {
  return a(actions, 'hr.manage') || estSoi;
}

/**
 * Catégories proposées à l'envoi : toutes avec `hr.manage` + `hr.sensitive.read` ;
 * les non sensibles avec `hr.manage` seul ; le justificatif d'absence pour soi.
 */
export function categoriesProposees(actions: Actions, estSoi: boolean): HrDocumentCategory[] {
  if (a(actions, 'hr.manage')) {
    return a(actions, 'hr.sensitive.read')
      ? [...HR_DOCUMENT_CATEGORIES]
      : HR_DOCUMENT_CATEGORIES.filter((c) => !isSensitiveHrDocumentCategory(c));
  }
  return estSoi ? ['leave_justification'] : [];
}

export const peutSupprimerDocument = (actions: Actions, d: Pick<HrDocumentView, 'sensitive'>) =>
  a(actions, 'hr.manage') && (!d.sensitive || a(actions, 'hr.sensitive.read'));

// ── Formulaire d'envoi ──────────────────────────────────────────────────────

export interface FormDocument {
  category: HrDocumentCategory;
  label: string;
  issuedOn: string;
  expiresOn: string;
  /** Libre pour les catégories non sensibles ; imposé vrai sinon. */
  sensitive: boolean;
  visibleToEmployee: boolean;
}

export function formDocument(category: HrDocumentCategory): FormDocument {
  return {
    category,
    label: '',
    issuedOn: '',
    expiresOn: '',
    sensitive: isSensitiveHrDocumentCategory(category),
    visibleToEmployee: defaultVisibleToEmployee(category),
  };
}

/** Changer de catégorie remet la sensibilité et la visibilité à leurs valeurs par défaut. */
export function changerCategorie(f: FormDocument, category: HrDocumentCategory): FormDocument {
  return {
    ...f,
    category,
    sensitive: isSensitiveHrDocumentCategory(category),
    visibleToEmployee: defaultVisibleToEmployee(category),
  };
}

export const ACCEPT_DOCUMENT =
  'application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp';

/** Fichier vu par le formulaire (sans son contenu). */
export interface FichierChoisi {
  name: string;
  size: number;
  type: string;
}

function natureFichier(f: FichierChoisi): 'pdf' | 'image' | null {
  const type = f.type.toLowerCase();
  const ext = f.name.toLowerCase().split('.').pop() ?? '';
  if (type === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (['image/png', 'image/jpeg', 'image/webp'].includes(type)) return 'image';
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return 'image';
  return null;
}

const MIO = 1024 * 1024;

export function validerDocument(
  f: FormDocument,
  fichier: FichierChoisi | null,
  categoriesPermises: readonly HrDocumentCategory[],
): { ok: true; meta: EnvoiDocument } | { ok: false; erreurs: string[] } {
  const erreurs: string[] = [];
  if (fichier === null) {
    erreurs.push('Choisissez un fichier.');
  } else {
    const nature = natureFichier(fichier);
    if (nature === null) {
      erreurs.push('Seuls les PDF et les images PNG, JPEG ou WebP sont acceptés.');
    } else if (nature === 'pdf' && fichier.size > HR_LIMITS.documentPdfMaxBytes) {
      erreurs.push(`Un PDF pèse ${HR_LIMITS.documentPdfMaxBytes / MIO} Mo au plus.`);
    } else if (nature === 'image' && fichier.size > HR_LIMITS.documentImageMaxBytes) {
      erreurs.push(`Une image pèse ${HR_LIMITS.documentImageMaxBytes / MIO} Mo au plus.`);
    }
  }
  if (!categoriesPermises.includes(f.category)) {
    erreurs.push('Votre rôle ne permet pas de déposer ce type de document.');
  }
  const champs: Record<string, string> = { category: f.category, label: f.label };
  if (f.issuedOn) champs['issuedOn'] = f.issuedOn;
  if (f.expiresOn) champs['expiresOn'] = f.expiresOn;
  champs['sensitive'] = f.sensitive ? 'true' : 'false';
  champs['visibleToEmployee'] = f.visibleToEmployee ? 'true' : 'false';
  const r = UploadHrDocumentFields.safeParse(champs);
  if (!r.success) erreurs.push(...r.error.issues.map((i) => i.message));
  if (erreurs.length > 0 || !r.success) return { ok: false, erreurs: [...new Set(erreurs)] };
  return {
    ok: true,
    meta: {
      category: r.data.category,
      label: r.data.label,
      issuedOn: r.data.issuedOn,
      expiresOn: r.data.expiresOn,
      sensitive: r.data.sensitive,
      visibleToEmployee: r.data.visibleToEmployee,
    },
  };
}

// ── Liste ───────────────────────────────────────────────────────────────────

/** Taille lisible (« 820 Ko », « 1,4 Mo »), mise en forme seulement. */
export function libelleTaille(octets: number): string {
  if (octets < 1024) return `${octets} o`;
  if (octets < MIO) return `${Math.round(octets / 1024)} Ko`;
  return `${(octets / MIO).toFixed(1).replace('.', ',')} Mo`;
}

/**
 * Expiration d'un document : « Expiré le … » si la date est passée (comparaison de
 * dates civiles), « Expire le … » sinon. Le délai restant, lui, vient de
 * `GET /hr/deadlines` (écran Échéances).
 */
export function libelleExpiration(
  expiresOn: string | null,
  aujourdhui: string,
): { texte: string; expire: boolean } | null {
  if (!expiresOn) return null;
  const expire = expiresOn < aujourdhui;
  return { texte: `${expire ? 'Expiré' : 'Expire'} le ${formatJour(expiresOn)}`, expire };
}

/** Sous-titre d'une ligne de document : catégorie, fichier, dépôt. */
export function detailDocument(d: HrDocumentView): string {
  return [
    LIBELLES_CATEGORIE[d.category],
    `${d.fileName} (${libelleTaille(d.size)})`,
    d.issuedOn ? `délivré le ${formatJour(d.issuedOn)}` : null,
    `déposé le ${formatJour(d.uploadedAt.slice(0, 10))}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

export const PHRASE_SENSIBLE =
  'Pièce sensible : chiffrée par Lalanda, téléchargement réservé aux personnes habilitées et inscrit au journal d’audit.';
