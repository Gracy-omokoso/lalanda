// Constantes de la bibliothèque de documents (ADR-0046 § 1, § 4 et § 5.3). ADR-0046 — S0.
//
// Libellé d'interface ↔ code (ADR-0046 § 1) : « Dossier » = `DocumentFolder`,
// « Document » = `LibraryDocument`, « Version » = `DocumentVersion`.
//
// La bibliothèque ne stocke que SES documents ; les pièces des autres modules (projets,
// achats) sont PRÉSENTÉES par entité, filtrées par la permission de leur module (O5) ;
// les documents RH ne sortent jamais de `/rh`. Aucune durée légale de conservation n'est
// posée (décision ouverte n° 16). Les métadonnées (titre, étiquettes, nom du fichier) ne
// passent JAMAIS dans une URL ni dans un en-tête : envoi en `multipart/form-data`,
// recherche en corps de `POST /documents/search` (§ 4.3).

/** Nature d'un document (§ 4.2). */
export const DOCUMENT_NATURES = [
  'contract',
  'certificate',
  'license',
  'insurance',
  'legal',
  'policy',
  'technical',
  'other',
] as const;
export type DocumentNature = (typeof DOCUMENT_NATURES)[number];

/**
 * Entités qu'un document peut lier (§ 4.2) — jamais `employee` : les pièces RH restent
 * dans `hr_documents`. Lire un document lié exige la lecture du module de chaque entité
 * (`DOCUMENT_LINK_READ_ACTION` dans `apps/api/src/authz/permissions.ts`).
 */
export const DOCUMENT_LINK_ENTITY_TYPES = [
  'customer',
  'supplier',
  'work_project',
  'crm_account',
  'asset',
  'stock_item',
  'purchase_order',
] as const;
export type DocumentLinkEntityType = (typeof DOCUMENT_LINK_ENTITY_TYPES)[number];

export const DOCUMENT_STATUSES = ['active', 'archived'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/**
 * Types de fichier acceptés (motif exact d'ADR-0039 § 2.5) : images assainies et PDF
 * reconnus par `%PDF-`, non analysés, servis en téléchargement inerte. Formats
 * bureautiques : non (décision ouverte n° 18) → `415 DOCUMENT_TYPE`.
 */
export const DOCUMENT_FILE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
] as const;
export type DocumentFileType = (typeof DOCUMENT_FILE_TYPES)[number];

/** Préfixe des clés d'objet de la bibliothèque (`documents/<objectId>` au hasard). */
export const DOCUMENT_OBJECT_KEY_PREFIX = 'documents/';

/** Règle de lecture d'un dossier : `'all'`, droit par nature, ou personnes désignées. */
export const DOCUMENT_FOLDER_READ_KINDS = ['all', 'action', 'users'] as const;
export type DocumentFolderReadKind = (typeof DOCUMENT_FOLDER_READ_KINDS)[number];

/**
 * Dossiers proposés à l'activation (§ 4.1). « Fiscal et administratif » est réservé par
 * NATURE à `treasury.read` ; les autres sont ouverts à tout détenteur de `docs.read`.
 */
export const DOCUMENT_DEFAULT_FOLDERS = Object.freeze([
  { name: 'Juridique', readAction: null },
  { name: 'Assurances', readAction: null },
  { name: 'Contrats', readAction: null },
  { name: 'Fiscal et administratif', readAction: 'treasury.read' },
  { name: 'Divers', readAction: null },
] as const);

// ── Bornes ──────────────────────────────────────────────────────────────────

export const DOCUMENT_LIMITS = Object.freeze({
  title: 200,
  folderName: 120,
  /** Profondeur de l'arborescence (racine = 1). */
  folderDepth: 5,
  folderUserIds: 50,
  tags: 10,
  tagMin: 1,
  tagMax: 40,
  links: 10,
  versions: 50,
  fileName: 200,
  versionNote: 500,
  searchText: 200,
  reminderDaysDefault: 30,
  reminderDaysMax: 365,
  imageMaxBytes: 2 * 1024 * 1024,
  pdfMaxBytes: 10 * 1024 * 1024,
  /** Borne COMMUNE avec les pièces des projets, des achats et des RH (décision n° 19). */
  storagePerOrganizationBytes: 1024 * 1024 * 1024,
  uploadsPerHourPerUser: 30,
  /** Délai avant l'effacement des objets d'un document supprimé (`documents.purge`). */
  purgeAfterDays: 30,
});

export const DOCUMENT_PAGE_LIMIT_DEFAULT = 50;
export const DOCUMENT_PAGE_LIMIT_MAX = 100;

// ── Codes ───────────────────────────────────────────────────────────────────

export const DOCUMENT_ERROR_CODES = [
  'FOLDER_CYCLE',
  'FOLDER_TOO_DEEP',
  'FOLDER_NOT_EMPTY',
  'DOCUMENT_TYPE',
  'DOCUMENT_TOO_LARGE',
  'DOCUMENT_STORAGE_FULL',
  'DOCUMENT_VERSIONS_FULL',
  'DOCUMENT_UPLOAD_RATE',
  'SECRETS_NOT_CONFIGURED',
  'STALE_REVISION',
] as const;
export type DocumentErrorCode = (typeof DOCUMENT_ERROR_CODES)[number];

export const DOCUMENT_AUDIT_EVENTS = [
  'documents.sensitive_downloaded',
  'documents.deleted',
  'documents.folder_access_changed',
] as const;
export type DocumentAuditEvent = (typeof DOCUMENT_AUDIT_EVENTS)[number];

/** Normalise une étiquette (§ 4.2) : espaces de bord retirés, minuscules, espaces réduits. */
export function normalizeDocumentTag(tag: string): string {
  return tag.trim().replace(/\s+/g, ' ').toLowerCase();
}
