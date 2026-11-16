// Lien contrat ↔ projet, lu par le module Projets — ADR-0077 § 1.
//
// Le lien vit sur le contrat (`sales_contracts.projectId`, ADR-0050 § 2.3) ; un index
// unique partiel `{ organizationId, projectId }` garantit qu'un projet suit au plus un
// contrat. Pendant une création, le contrat porte la réservation
// `pending:<contractId>` (propre à chaque contrat, donc compatible avec l'index).
//
// Lectures SEULES par la connexion, toujours filtrées par `organizationId`. Un
// `projectId` dont le projet n'existe plus (projet supprimé) ne compte pas : il est
// ignoré ici et remis à `null` par `WorkContractProjectsService` au passage.

import type { Connection } from 'mongoose';

import { isWorkId, oid } from '../work.common.js';

export const CONTRACTS = 'sales_contracts';
export const PROJECTS = 'work_projects';
/** Liens facture ↔ engagement (ADR-0050 § 2.7), lus pour la marge. */
export const DOCUMENT_LINKS = 'sales_document_links';

export const PENDING_PREFIX = 'pending:';

/** Réservation d'un contrat pendant la création de son projet. */
export function pendingOf(contractId: string): string {
  return `${PENDING_PREFIX}${contractId}`;
}

/** `projectId` réel (ni `null`, ni réservation). */
export function isRealProjectId(value: unknown): value is string {
  return typeof value === 'string' && !value.startsWith(PENDING_PREFIX) && isWorkId(value);
}

async function projectExists(
  connection: Connection,
  organizationId: string,
  projectId: string,
): Promise<boolean> {
  const n = await connection
    .collection(PROJECTS)
    .countDocuments({ _id: oid(projectId), organizationId }, { limit: 1 });
  return n > 0;
}

async function firstLinkedProject(
  connection: Connection,
  organizationId: string,
  filter: Record<string, unknown>,
): Promise<string | null> {
  const docs = await connection
    .collection(CONTRACTS)
    .find(
      { organizationId, ...filter, projectId: { $type: 'string' } },
      { projection: { projectId: 1 } },
    )
    .limit(20)
    .toArray();
  for (const d of docs) {
    const id = d['projectId'];
    if (isRealProjectId(id) && (await projectExists(connection, organizationId, id))) return id;
  }
  return null;
}

/** Projet d'un contrat issu de ce devis, ou `null`. */
export function contractProjectOfQuote(
  connection: Connection,
  organizationId: string,
  quoteId: string,
): Promise<string | null> {
  return firstLinkedProject(connection, organizationId, { 'source.quoteId': quoteId });
}

/** Projet d'un contrat de cette opportunité, ou `null`. */
export function contractProjectOfOpportunity(
  connection: Connection,
  organizationId: string,
  opportunityId: string,
): Promise<string | null> {
  return firstLinkedProject(connection, organizationId, { opportunityId });
}

/** Contrat que suit un projet (projection utile), ou `null`. */
export async function contractOfProject(
  connection: Connection,
  organizationId: string,
  projectId: string,
): Promise<Record<string, unknown> | null> {
  if (!isWorkId(projectId)) return null;
  return connection.collection(CONTRACTS).findOne(
    { organizationId, projectId },
    {
      projection: {
        number: 1,
        title: 1,
        status: 1,
        customer: 1,
        startDate: 1,
        initialTermMonths: 1,
        'billing.kind': 1,
        'billing.items.itemRef': 1,
      },
    },
  );
}

/**
 * ADR-0077 O3 : le contrat suivi par le projet facture-t-il lui-même (échéancier,
 * abonnement) ? Rend son identifiant et son numéro, sinon `null`.
 */
export async function contractBillsItself(
  connection: Connection,
  organizationId: string,
  projectId: string,
): Promise<{ contractId: string; number: string } | null> {
  const c = await contractOfProject(connection, organizationId, projectId);
  if (!c) return null;
  const kind = (c['billing'] as { kind?: string } | undefined)?.kind;
  return kind === 'schedule' || kind === 'recurring'
    ? { contractId: String(c['_id']), number: String(c['number']) }
    : null;
}

/**
 * ADR-0077 § 1.8 : factures que le contrat du projet a préparées
 * (`sales_document_links.contractId`), pour la marge. Vide sans contrat.
 */
export async function contractInvoiceIdsOf(
  connection: Connection,
  organizationId: string,
  projectId: string,
): Promise<string[]> {
  const c = await contractOfProject(connection, organizationId, projectId);
  if (!c) return [];
  const links = await connection
    .collection(DOCUMENT_LINKS)
    .find({ organizationId, contractId: String(c['_id']) }, { projection: { invoiceId: 1 } })
    .toArray();
  return links.map((l) => String(l['invoiceId'])).filter(isWorkId);
}
