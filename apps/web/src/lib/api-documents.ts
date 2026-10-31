// Client de l'API de la bibliothèque de documents — ADR-0046 § 4 et § 5.3 (lot S9).
//
// Contrats : ceux de `@lalanda/shared/documents` (lots S0 et S6). Deux règles portées
// par la forme même des appels (§ 4.3, leçon du lot H4 d'ADR-0045) :
//   - un DÉPÔT (document ou version) est un formulaire `multipart/form-data` : le
//     fichier ET ses métadonnées (titre, dossier, nature, étiquettes, liens, dates,
//     sensibilité) voyagent dans le corps, jamais dans l'URL ni dans un en-tête ;
//   - une RECHERCHE est `POST /documents/search` avec un corps ; les `GET` ne portent
//     que des identifiants.
// Rien n'est mis en cache ni en stockage local : un fichier téléchargé n'existe que
// le temps de l'enregistrer.

import {
  DOCUMENT_FILE_FIELD,
  type CreateDocumentFolderBody,
  type DocumentDeadlineList,
  type DocumentFolderList,
  type DocumentFolderView,
  type DocumentLinkEntityType,
  type DocumentNature,
  type DocumentSearchBody,
  type EntityPiecesView,
  type LibraryDocumentDetail,
  type LibraryDocumentPage,
  type UpdateDocumentFolderBody,
  type UpdateLibraryDocumentBody,
} from '@lalanda/shared/documents';

import { API_URL, EVENEMENT_REFUS_API, jsonRequest, salesQuery } from './api';

export type {
  CreateDocumentFolderBody,
  DocumentDeadlineList,
  DocumentDeadlineView,
  DocumentExpiryStatus,
  DocumentFileType,
  DocumentFolderAccessInput,
  DocumentFolderList,
  DocumentFolderView,
  DocumentLinkEntityType,
  DocumentLinkView,
  DocumentNature,
  DocumentSearchBody,
  DocumentVersionView,
  EntityPieceView,
  EntityPiecesView,
  LibraryDocumentDetail,
  LibraryDocumentPage,
  LibraryDocumentView,
  UpdateDocumentFolderBody,
  UpdateLibraryDocumentBody,
} from '@lalanda/shared/documents';

const id = (v: string): string => encodeURIComponent(v);
const GET = { method: 'GET' } as const;

type ErreurHttp = Error & { status: number; detail: unknown };

async function erreurHttp(res: Response): Promise<ErreurHttp> {
  const text = await res.text();
  let detail: unknown = text;
  try {
    detail = JSON.parse(text);
  } catch {
    /* garde le texte brut */
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

export interface FichierDocument {
  blob: Blob;
  nom: string;
}

/** Fichier servi par l'API (téléchargement inerte, jamais gardé en cache). */
async function telecharger(path: string, nomParDefaut: string): Promise<FichierDocument> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  });
  if (!res.ok) throw await erreurHttp(res);
  const cd = res.headers.get('content-disposition') ?? '';
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  const simple = /filename="([^"]+)"/i.exec(cd);
  let nom = nomParDefaut;
  if (utf8?.[1]) {
    try {
      nom = decodeURIComponent(utf8[1]);
    } catch {
      nom = nomParDefaut;
    }
  } else if (simple?.[1]) {
    nom = simple[1];
  }
  return { blob: await res.blob(), nom };
}

async function envoyerFormulaire(path: string, fd: FormData): Promise<LibraryDocumentDetail> {
  // Aucun en-tête posé à la main : le navigateur écrit le type et sa frontière.
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    body: fd,
  });
  if (!res.ok) throw await erreurHttp(res);
  return (await res.json()) as LibraryDocumentDetail;
}

/** Métadonnées d'un dépôt : champs du FORMULAIRE multipart, jamais de l'URL. */
export interface DepotDocument {
  title: string;
  folderId: string | null;
  nature: DocumentNature;
  tags: string[];
  links: { entityType: DocumentLinkEntityType; entityId: string }[];
  issuedOn: string | null;
  expiresOn: string | null;
  reminderDays: number | null;
  sensitive: boolean;
  note: string | null;
}

/**
 * Corps `multipart/form-data` de `POST /documents` (`UploadLibraryDocumentFieldsSchema`) :
 * tout est texte, étiquettes et liens en JSON, booléen en `"true"`/`"false"`, dossier
 * vide pour « sans dossier » ; la pièce en dernier (partie `file`). Un champ vide est omis.
 */
export function formulaireDepot(meta: DepotDocument, fichier: Blob, nom: string): FormData {
  const fd = new FormData();
  fd.append('title', meta.title);
  fd.append('folderId', meta.folderId ?? '');
  fd.append('nature', meta.nature);
  if (meta.tags.length > 0) fd.append('tags', JSON.stringify(meta.tags));
  if (meta.links.length > 0) fd.append('links', JSON.stringify(meta.links));
  if (meta.issuedOn) fd.append('issuedOn', meta.issuedOn);
  if (meta.expiresOn) fd.append('expiresOn', meta.expiresOn);
  if (meta.reminderDays !== null) fd.append('reminderDays', String(meta.reminderDays));
  fd.append('sensitive', meta.sensitive ? 'true' : 'false');
  if (meta.note) fd.append('note', meta.note);
  fd.append(DOCUMENT_FILE_FIELD, fichier, nom);
  return fd;
}

/** Corps multipart d'une nouvelle version : note facultative et pièce. */
export function formulaireVersion(note: string | null, fichier: Blob, nom: string): FormData {
  const fd = new FormData();
  if (note) fd.append('note', note);
  fd.append(DOCUMENT_FILE_FIELD, fichier, nom);
  return fd;
}

export interface ListDocumentsParams {
  folderId?: string;
  entityType?: DocumentLinkEntityType;
  entityId?: string;
  cursor?: string;
  limit?: number;
}

export const documentsApi = {
  // Dossiers (§ 4.1) — l'arbre servi est déjà filtré par les droits.
  listFolders: () => jsonRequest<DocumentFolderList>('/documents/folders', GET),
  createFolder: (body: CreateDocumentFolderBody) =>
    jsonRequest<DocumentFolderView>('/documents/folders', { method: 'POST', body }),
  createDefaultFolders: () =>
    jsonRequest<DocumentFolderList>('/documents/folders/defaults', { method: 'POST', body: {} }),
  updateFolder: (folderId: string, body: UpdateDocumentFolderBody) =>
    jsonRequest<DocumentFolderView>(`/documents/folders/${id(folderId)}`, {
      method: 'PUT',
      body,
    }),
  archiveFolder: (folderId: string, expectedRevision: number) =>
    jsonRequest<DocumentFolderView>(`/documents/folders/${id(folderId)}/archive`, {
      method: 'POST',
      body: { expectedRevision },
    }),

  // Documents (§ 4.2) — identifiants seulement en requête.
  list: (query: ListDocumentsParams = {}) =>
    jsonRequest<LibraryDocumentPage>(`/documents${salesQuery(query)}`, GET),
  /** Recherche par métadonnées, critères dans le CORPS (jamais dans l'URL). */
  search: (body: DocumentSearchBody) =>
    jsonRequest<LibraryDocumentPage>('/documents/search', { method: 'POST', body }),
  get: (documentId: string) =>
    jsonRequest<LibraryDocumentDetail>(`/documents/${id(documentId)}`, GET),
  upload: (meta: DepotDocument, fichier: File) =>
    envoyerFormulaire('/documents', formulaireDepot(meta, fichier, fichier.name)),
  update: (documentId: string, body: UpdateLibraryDocumentBody) =>
    jsonRequest<LibraryDocumentDetail>(`/documents/${id(documentId)}`, { method: 'PUT', body }),
  archive: (documentId: string, expectedRevision: number) =>
    jsonRequest<LibraryDocumentDetail>(`/documents/${id(documentId)}/archive`, {
      method: 'POST',
      body: { expectedRevision },
    }),
  restore: (documentId: string, expectedRevision: number) =>
    jsonRequest<LibraryDocumentDetail>(`/documents/${id(documentId)}/restore`, {
      method: 'POST',
      body: { expectedRevision },
    }),
  /** Suppression ; les fichiers sont effacés du stockage 30 jours plus tard. */
  remove: (documentId: string) =>
    jsonRequest<void>(`/documents/${id(documentId)}`, { method: 'DELETE' }),

  // Versions
  addVersion: (documentId: string, note: string | null, fichier: File) =>
    envoyerFormulaire(
      `/documents/${id(documentId)}/versions`,
      formulaireVersion(note, fichier, fichier.name),
    ),
  restoreVersion: (documentId: string, versionId: string) =>
    jsonRequest<LibraryDocumentDetail>(
      `/documents/${id(documentId)}/versions/${id(versionId)}/restore`,
      { method: 'POST', body: {} },
    ),
  download: (documentId: string, versionId: string, nomParDefaut: string) =>
    telecharger(`/documents/${id(documentId)}/versions/${id(versionId)}/file`, nomParDefaut),

  // Échéances et présentation par entité (O5)
  deadlines: (within?: number) =>
    jsonRequest<DocumentDeadlineList>(`/documents/deadlines${salesQuery({ within })}`, GET),
  entityPieces: (entityType: DocumentLinkEntityType, entityId: string) =>
    jsonRequest<EntityPiecesView>(
      `/documents/entity-pieces${salesQuery({ entityType, entityId })}`,
      GET,
    ),
  /**
   * Pièce d'un module propriétaire : sa route de téléchargement (`href`, chemin de
   * l'API) et sa propre permission s'appliquent.
   */
  downloadPiece: (href: string, nomParDefaut: string) => telecharger(href, nomParDefaut),
};
