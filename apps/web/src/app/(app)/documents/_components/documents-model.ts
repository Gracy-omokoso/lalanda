// Bibliothèque de documents — règles communes aux écrans (ADR-0046 § 4, § 5.3, § 8 ;
// lot S9). Logique pure, testée.
//
// Les droits viennent des ACTIONS (`useShell().actions`) et des drapeaux servis par
// l'API (`canWrite` d'un dossier ou d'un document) ; l'API reste seule juge et rend
// 404 pour un document invisible. AUCUNE métadonnée ne part dans une URL : le dépôt
// est un formulaire multipart (`api-documents.ts`), la recherche un corps POST.
// Seuls les PDF et les images (PNG, JPEG, WebP) sont acceptés (ADR-0039 § 2.5).

import {
  DOCUMENT_LIMITS,
  normalizeDocumentTag,
  type DocumentSearchBody,
} from '@lalanda/shared/documents';

import type { OrgAction } from '@/lib/api';
import type { DepotDocument } from '@/lib/api-documents';
import type {
  DocumentDeadlineView,
  DocumentExpiryStatus,
  DocumentFolderView,
  DocumentLinkEntityType,
  DocumentLinkView,
  DocumentNature,
} from '@/lib/api-documents';

export { formatInstantJour, formatJour } from '../../achats/_components/achats-model';

export const DOCUMENTS_BASE = '/documents';

type Actions = readonly OrgAction[] | null;

const a = (actions: Actions, action: OrgAction): boolean =>
  actions !== null && actions.includes(action);

export const peutLireDocuments = (x: Actions): boolean => a(x, 'docs.read');
export const peutGererDocuments = (x: Actions): boolean => a(x, 'docs.manage');

/**
 * Peut-on proposer un dépôt ? `docs.manage`, ou au moins un dossier ouvert en
 * écriture à l'appelant (`canWrite`, membre de `access.write`).
 */
export function peutDeposer(x: Actions, dossiers: readonly DocumentFolderView[]): boolean {
  if (!peutLireDocuments(x)) return false;
  return peutGererDocuments(x) || dossiers.some((d) => d.canWrite && d.status === 'active');
}

export const lienDocument = (id: string): string => `${DOCUMENTS_BASE}/${encodeURIComponent(id)}`;

// ── Lectures et erreurs ─────────────────────────────────────────────────────

export type Lecture<T> = { ok: true; valeur: T } | { ok: false; erreur: unknown };

export function lire<T>(p: Promise<T>): Promise<Lecture<T>> {
  return p.then(
    (valeur) => ({ ok: true as const, valeur }),
    (erreur: unknown) => ({ ok: false as const, erreur }),
  );
}

export function statutDe(err: unknown): number | null {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : null;
}

function codeDe(err: unknown): string | null {
  const detail = (err as { detail?: unknown } | null)?.detail;
  if (typeof detail !== 'object' || detail === null) return null;
  const code = (detail as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

export const PHRASE_TYPES =
  'Seuls les PDF (10 Mo au plus) et les images PNG, JPEG ou WebP (2 Mo au plus) sont acceptés.';

const MESSAGES: Record<string, string> = {
  DOCUMENT_TYPE: `Ce type de fichier n’est pas accepté. ${PHRASE_TYPES} Enregistrez un document bureautique en PDF avant de le déposer.`,
  DOCUMENT_TOO_LARGE: `Fichier trop lourd. ${PHRASE_TYPES}`,
  DOCUMENT_STORAGE_FULL:
    'L’espace de stockage des pièces de l’organisation est plein (1 Gio, partagé avec les projets, les achats et les RH).',
  DOCUMENT_VERSIONS_FULL: 'Ce document a déjà 50 versions : créez-en un nouveau.',
  DOCUMENT_UPLOAD_RATE: 'Trop de dépôts en une heure (30 au plus) : réessayez plus tard.',
  SECRETS_NOT_CONFIGURED:
    'Le coffre de chiffrement n’est pas configuré : un document sensible ne peut être ni déposé ni lu.',
  STALE_REVISION:
    'Ce document a été modifié entre-temps par quelqu’un d’autre. Rechargez la page avant de recommencer.',
  FOLDER_CYCLE: 'Un dossier ne peut pas être rangé dans l’un de ses sous-dossiers.',
  FOLDER_TOO_DEEP: 'Cinq niveaux de dossiers au plus.',
  FOLDER_NOT_EMPTY: 'Ce dossier contient encore des documents ou des sous-dossiers.',
  DOCUMENT_ARCHIVED: 'Ce document est à la corbeille : restaurez-le d’abord.',
  DOCUMENT_UNFILED: 'Un document sans dossier doit être lié à au moins un élément.',
  DOCUMENT_ENTITY_NOT_FOUND: 'L’élément lié est introuvable ou n’est pas lisible avec votre rôle.',
  DOCUMENT_LINK_DUPLICATE: 'Ce lien est déjà présent.',
  DOCUMENT_UNREADABLE: 'Ce document ne peut pas être déchiffré.',
};

export function messageDocuments(err: unknown, repli: string): string {
  if (typeof err !== 'object' || err === null) return repli;
  const code = codeDe(err);
  if (code !== null && MESSAGES[code]) return MESSAGES[code]!;
  const status = statutDe(err);
  if (status === 415) return MESSAGES['DOCUMENT_TYPE']!;
  if (status === 413) return MESSAGES['DOCUMENT_TOO_LARGE']!;
  if (status === 403)
    return 'Votre rôle ou les droits de ce dossier ne permettent pas cette action.';
  if (status === 404) return 'Document introuvable, ou invisible avec vos droits.';
  if (status === 429) return MESSAGES['DOCUMENT_UPLOAD_RATE']!;
  const detail = (err as { detail?: unknown }).detail;
  if (typeof detail === 'object' && detail !== null) {
    const m = (detail as { message?: unknown }).message;
    if (typeof m === 'string' && m !== '') return m;
  }
  return repli;
}

// ── Fichiers ────────────────────────────────────────────────────────────────

export const ACCEPT_DOCUMENT = 'application/pdf,image/png,image/jpeg,image/webp';

const TYPES_IMAGES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** Contrôle d'avance (l'API reste juge) : type et taille, message clair sinon. */
export function validerFichier(
  f: { type: string; size: number; name: string } | null,
): string | null {
  if (f === null) return 'Choisissez un fichier.';
  const pdf = f.type === 'application/pdf' || (f.type === '' && /\.pdf$/i.test(f.name));
  if (!pdf && !TYPES_IMAGES.has(f.type)) {
    return `« ${f.name} » n’est pas accepté. ${PHRASE_TYPES}`;
  }
  const max = pdf ? DOCUMENT_LIMITS.pdfMaxBytes : DOCUMENT_LIMITS.imageMaxBytes;
  if (f.size > max) return `« ${f.name} » est trop lourd. ${PHRASE_TYPES}`;
  if (f.size === 0) return `« ${f.name} » est vide.`;
  return null;
}

/** Taille lisible : « 340 Ko », « 2,4 Mo ». */
export function formatTaille(octets: number): string {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} Ko`;
  return `${(octets / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
}

export function libelleType(contentType: string): string {
  if (contentType === 'application/pdf') return 'PDF';
  if (contentType.startsWith('image/')) return `Image ${contentType.slice(6).toUpperCase()}`;
  return contentType;
}

// ── Libellés ────────────────────────────────────────────────────────────────

export const LIBELLES_NATURE: Record<DocumentNature, string> = {
  contract: 'Contrat',
  certificate: 'Attestation ou certificat',
  license: 'Licence ou autorisation',
  insurance: 'Assurance',
  legal: 'Juridique',
  policy: 'Règlement ou politique',
  technical: 'Technique',
  other: 'Autre',
};

export const LIBELLES_ENTITE: Record<DocumentLinkEntityType, string> = {
  customer: 'Client',
  supplier: 'Fournisseur',
  work_project: 'Projet',
  crm_account: 'Compte CRM',
  asset: 'Équipement',
  stock_item: 'Article stocké',
  purchase_order: 'Commande d’achat',
};

/** Permission de lecture du module d'une entité (§ 4.2) : pour offrir le lien. */
export const LECTURE_ENTITE: Record<DocumentLinkEntityType, OrgAction> = {
  customer: 'sales.read',
  supplier: 'purchase.read',
  work_project: 'work.read',
  crm_account: 'crm.read',
  asset: 'assets.read',
  stock_item: 'stock.read',
  purchase_order: 'purchase.read',
};

/** Entités qu'un écran propose de lier (une commande d'achat se lie depuis les achats). */
export type EntiteLiable = Exclude<DocumentLinkEntityType, 'purchase_order'>;

/** Types d'entités que le rôle peut lier (il faut lire leur module). */
export function entitesLiables(x: Actions): EntiteLiable[] {
  return (Object.keys(LECTURE_ENTITE) as DocumentLinkEntityType[]).filter(
    (t): t is EntiteLiable => t !== 'purchase_order' && a(x, LECTURE_ENTITE[t]),
  );
}

/** Adresse de la fiche d'une entité liée ; `null` si le rôle ne lit pas son module. */
export function lienEntite(l: DocumentLinkView, x: Actions): string | null {
  if (!a(x, LECTURE_ENTITE[l.entityType])) return null;
  const id = encodeURIComponent(l.entityId);
  switch (l.entityType) {
    case 'customer':
      return `/ventes/clients?fiche=${id}`;
    case 'supplier':
      return `/achats/fournisseurs/${id}`;
    case 'work_project':
      return `/projets/${id}`;
    case 'crm_account':
      return `/crm/comptes/${id}`;
    case 'asset':
      return `/equipements/${id}`;
    case 'stock_item':
      return `/stocks/articles/${id}`;
    case 'purchase_order':
      return `/achats/commandes/${id}`;
  }
}

export type Ton = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/** Expiration servie par l'API (`expiryStatus`), en badge. */
export function badgeExpiration(
  status: DocumentExpiryStatus | null,
  expiresOn: string | null,
  formatJour: (j: string | null) => string,
): { texte: string; ton: Ton } | null {
  if (status === null || expiresOn === null) return null;
  if (status === 'expired') return { texte: `Expiré le ${formatJour(expiresOn)}`, ton: 'danger' };
  if (status === 'due_soon') return { texte: `Expire le ${formatJour(expiresOn)}`, ton: 'warning' };
  return { texte: `Valable jusqu’au ${formatJour(expiresOn)}`, ton: 'neutral' };
}

export const PHRASE_SENSIBLE =
  'Document sensible : chiffré par Lalanda, chaque téléchargement est journalisé.';

// ── Dépôt ───────────────────────────────────────────────────────────────────

export interface FormulaireDepot {
  title: string;
  folderId: string;
  nature: DocumentNature;
  tags: string;
  links: { entityType: DocumentLinkEntityType; entityId: string; label: string }[];
  issuedOn: string;
  expiresOn: string;
  reminderDays: string;
  sensitive: boolean;
  note: string;
}

export function formulaireDepot(
  dossier: string,
  liens: FormulaireDepot['links'] = [],
): FormulaireDepot {
  return {
    title: '',
    folderId: dossier,
    nature: 'other',
    tags: '',
    links: liens,
    issuedOn: '',
    expiresOn: '',
    reminderDays: '',
    sensitive: false,
    note: '',
  };
}

/** Titre proposé depuis le nom du fichier (extension retirée). */
export function titreDepuisFichier(nom: string): string {
  return nom
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .slice(0, 200);
}

/** « Fiscal, 2026 » → ['fiscal', '2026'] : normalisées, dédoublonnées, bornées. */
export function lireEtiquettes(
  saisie: string,
): { ok: true; valeur: string[] } | { ok: false; erreur: string } {
  const out: string[] = [];
  for (const brute of saisie.split(/[,;]/)) {
    const t = normalizeDocumentTag(brute);
    if (t === '') continue;
    if (t.length > DOCUMENT_LIMITS.tagMax) {
      return {
        ok: false,
        erreur: `Étiquette « ${t} » : ${DOCUMENT_LIMITS.tagMax} caractères au plus.`,
      };
    }
    if (!out.includes(t)) out.push(t);
  }
  if (out.length > DOCUMENT_LIMITS.tags) {
    return { ok: false, erreur: `${DOCUMENT_LIMITS.tags} étiquettes au plus.` };
  }
  return { ok: true, valeur: out };
}

const estJour = (v: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(v);

export function preparerDepot(
  f: FormulaireDepot,
  fichier: { type: string; size: number; name: string } | null,
  gerer: boolean,
): { ok: true; meta: DepotDocument } | { ok: false; champs: Record<string, string> } {
  const champs: Record<string, string> = {};
  const errFichier = validerFichier(fichier);
  if (errFichier) champs['fichier'] = errFichier;
  if (f.title.trim() === '') champs['title'] = 'Le titre est obligatoire.';
  const tags = lireEtiquettes(f.tags);
  if (!tags.ok) champs['tags'] = tags.erreur;
  if (f.issuedOn !== '' && !estJour(f.issuedOn)) champs['issuedOn'] = 'Date invalide.';
  if (f.expiresOn !== '' && !estJour(f.expiresOn)) champs['expiresOn'] = 'Date invalide.';
  if (f.issuedOn && f.expiresOn && f.expiresOn < f.issuedOn) {
    champs['expiresOn'] = 'La date d’expiration précède la date de délivrance.';
  }
  let reminderDays: number | null = null;
  if (f.reminderDays.trim() !== '') {
    const n = /^\d{1,3}$/.test(f.reminderDays.trim()) ? Number(f.reminderDays.trim()) : NaN;
    if (Number.isNaN(n) || n > DOCUMENT_LIMITS.reminderDaysMax) {
      champs['reminderDays'] = `Entre 0 et ${DOCUMENT_LIMITS.reminderDaysMax} jours.`;
    } else reminderDays = n;
  }
  if (f.folderId === '' && f.links.length === 0) {
    champs['folderId'] = 'Choisissez un dossier, ou liez le document à au moins un élément.';
  }
  if (f.folderId === '' && !gerer) {
    champs['folderId'] = 'Choisissez un dossier où vous pouvez déposer.';
  }
  if (f.sensitive && !gerer)
    champs['sensitive'] = 'Un document sensible se dépose avec la gestion des documents.';
  if (Object.keys(champs).length > 0 || !tags.ok) return { ok: false, champs };
  return {
    ok: true,
    meta: {
      title: f.title.trim(),
      folderId: f.folderId === '' ? null : f.folderId,
      nature: f.nature,
      tags: tags.valeur,
      links: f.links.map(({ entityType, entityId }) => ({ entityType, entityId })),
      issuedOn: f.issuedOn || null,
      expiresOn: f.expiresOn || null,
      reminderDays,
      sensitive: f.sensitive,
      note: f.note.trim() || null,
    },
  };
}

// ── Recherche ───────────────────────────────────────────────────────────────

export interface FiltresBibliotheque {
  texte: string;
  etiquette: string;
  nature: DocumentNature | '';
}

export const FILTRES_VIDES: FiltresBibliotheque = { texte: '', etiquette: '', nature: '' };

/**
 * Corps de `POST /documents/search` quand un critère est saisi ; `null` sinon (la
 * liste par dossier, `GET /documents?folderId=`, ne porte que des identifiants).
 */
export function corpsRecherche(
  f: FiltresBibliotheque,
  dossier: string | null,
): DocumentSearchBody | null {
  const texte = f.texte.trim();
  const tag = normalizeDocumentTag(f.etiquette);
  if (texte === '' && tag === '' && f.nature === '') return null;
  return {
    ...(texte ? { text: texte.slice(0, DOCUMENT_LIMITS.searchText) } : {}),
    ...(tag ? { tags: [tag] } : {}),
    ...(f.nature ? { nature: f.nature } : {}),
    ...(dossier ? { folderId: dossier } : {}),
    limit: 50,
  };
}

/** Corbeille : documents archivés (la recherche les inclut sur demande). */
export const CORPS_CORBEILLE: DocumentSearchBody = { includeArchived: true, limit: 100 };

// ── Échéances ───────────────────────────────────────────────────────────────

export function grouperEcheancesDocuments(items: readonly DocumentDeadlineView[]): {
  expires: DocumentDeadlineView[];
  bientot: DocumentDeadlineView[];
} {
  return {
    expires: items.filter((i) => i.status === 'expired'),
    bientot: items.filter((i) => i.status === 'due_soon'),
  };
}
