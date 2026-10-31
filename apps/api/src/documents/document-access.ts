// Droits de la bibliothèque pour UNE requête (ADR-0046 § 4.1, § 4.2). ADR-0046 — S6.
//
// Aucune règle ici : les décisions sont celles, pures et testées, du lot S0
// (`folderAccessDecision`, `documentReadDecision` dans `authz/permissions.ts`), jugées
// sur les droits EFFECTIFS de l'appelant (`effectiveActions` : ligne du rôle, ajouts,
// retraits) et sur les PERSONNES, jamais sur le rôle. Ce fichier ne fait que construire
// la chaîne des dossiers (racine d'abord, dossier visé en dernier) et mémoriser les
// décisions de la requête.
//
// `inherit` (interprétation de S0) : la LECTURE exige la règle de chaque niveau de la
// chaîne, quel que soit `inherit` (un sous-dossier n'élargit jamais la visibilité de son
// parent) ; `inherit` ne gouverne que l'ÉCRITURE (avec lui, la règle d'écriture du
// parent s'ajoute, récursivement).

import {
  DOCUMENT_LIMITS,
  type DocumentFolderAccessInput,
  type DocumentLinkEntityType,
} from '@lalanda/shared/documents';

import {
  documentReadDecision,
  effectiveActions,
  folderAccessDecision,
  isOwnerRole,
  type Action,
  type FolderAccessDecision,
  type FolderAccessRules,
  type OrgRole,
} from '../authz/permissions.js';
import type { CurrentOrgPermissionsValue } from '../authz/current-org-permissions.decorator.js';
import type { DocumentFolderLean } from './document.schemas.js';

/** L'appelant d'une route de la bibliothèque. */
export interface DocumentsActor {
  userId: string;
  role: OrgRole | 'unknown';
  actions: ReadonlySet<Action>;
  isOwner: boolean;
}

export function documentsActorOf(
  userId: string,
  perms: CurrentOrgPermissionsValue | undefined,
): DocumentsActor {
  if (!perms) return { userId, role: 'unknown', actions: new Set(), isOwner: false };
  return {
    userId,
    role: perms.role,
    actions: new Set(effectiveActions(perms.role, perms.context)),
    isOwner: isOwnerRole(perms.role),
  };
}

/** Acteur reconstruit hors requête (tâches planifiées : destinataires). */
export function documentsActorFrom(
  userId: string,
  role: OrgRole,
  actions: readonly Action[],
): DocumentsActor {
  return { userId, role, actions: new Set(actions), isOwner: isOwnerRole(role) };
}

export function toRules(access: DocumentFolderAccessInput): FolderAccessRules {
  return access as unknown as FolderAccessRules;
}

/** Index des dossiers d'une organisation et décisions mémorisées pour un acteur. */
export class FolderIndex {
  private readonly decisions = new Map<string, FolderAccessDecision>();

  constructor(
    readonly byId: ReadonlyMap<string, DocumentFolderLean>,
    private readonly actor: DocumentsActor,
  ) {}

  /** Dossiers du plus haut au visé ; `null` si un ancêtre manque ou si la chaîne boucle. */
  chainOf(folderId: string): DocumentFolderLean[] | null {
    const chain: DocumentFolderLean[] = [];
    const seen = new Set<string>();
    let cursor: string | null = folderId;
    while (cursor !== null) {
      if (seen.has(cursor) || chain.length > DOCUMENT_LIMITS.folderDepth) return null;
      seen.add(cursor);
      const folder = this.byId.get(cursor);
      if (!folder) return null;
      chain.unshift(folder);
      cursor = folder.parentId;
    }
    return chain;
  }

  decision(folderId: string): FolderAccessDecision {
    const known = this.decisions.get(folderId);
    if (known) return known;
    const chain = this.chainOf(folderId);
    const decision =
      chain === null
        ? { read: false, write: false }
        : folderAccessDecision({
            chain: chain.map((f) => toRules(f.access)),
            userId: this.actor.userId,
            actions: [...this.actor.actions],
            isOwner: this.actor.isOwner,
          });
    this.decisions.set(folderId, decision);
    return decision;
  }

  /** Lecture d'un document : dossier ET module de chaque lien (§ 4.2). */
  canRead(doc: {
    folderId: string | null;
    links: { entityType: DocumentLinkEntityType }[];
  }): boolean {
    return documentReadDecision({
      folder: doc.folderId === null ? null : this.decision(doc.folderId),
      linkEntityTypes: doc.links.map((l) => l.entityType as never),
      actions: [...this.actor.actions],
    });
  }

  /**
   * Écriture d'un document : le lire, puis écrire dans son dossier ; un document sans
   * dossier s'écrit avec `docs.manage` (aucune règle de dossier ne désigne d'écrivain).
   */
  canWrite(doc: {
    folderId: string | null;
    links: { entityType: DocumentLinkEntityType }[];
  }): boolean {
    if (!this.canRead(doc)) return false;
    if (doc.folderId === null) return this.actor.actions.has('docs.manage');
    return this.decision(doc.folderId).write;
  }
}
