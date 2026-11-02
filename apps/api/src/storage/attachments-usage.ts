// Borne COMMUNE de 1 Gio de pièces par organisation (ADR-0039 § 2.5, ADR-0044 § 2.7,
// ADR-0045 § 2.8, ADR-0046 § 4.3 et décision ouverte n° 19). Factorisé au lot S6
// d'ADR-0046 : une seule liste des collections qui portent des pièces, lue par la
// connexion (aucun module n'importe celui d'un autre).

import type { Connection } from 'mongoose';

/** Collections dont les pièces comptent dans la borne commune, et leur champ de taille. */
export const SHARED_ATTACHMENT_STORAGE: readonly {
  collection: string;
  match: Record<string, unknown>;
  field: string;
  /** Tableau à déplier avant la somme (pièces portées par des lignes). */
  unwind?: string;
}[] = [
  { collection: 'work_attachments', match: { deletedAt: null }, field: '$size' },
  {
    collection: 'purchase_receptions',
    match: { 'attachment.size': { $gt: 0 } },
    field: '$attachment.size',
  },
  {
    collection: 'supplier_invoices',
    match: { 'attachment.size': { $gt: 0 } },
    field: '$attachment.size',
  },
  { collection: 'hr_documents', match: { deletedAt: null }, field: '$storedSize' },
  // ADR-0046 — S6 : versions de la bibliothèque tant que leur objet existe (un document
  // supprimé compte jusqu'à la purge de ses objets, `documents.purge`).
  { collection: 'library_document_versions', match: { purgedAt: null }, field: '$storedSize' },
  // ADR-0051 — H10 : justificatifs des lignes de frais (taille stockée, chiffrée ou non).
  {
    collection: 'hr_expense_reports',
    match: { 'lines.receipt.storedSize': { $gt: 0 } },
    field: '$lines.receipt.storedSize',
    unwind: '$lines',
  },
];

/** Octets occupés par l'organisation, toutes pièces confondues. */
export async function sharedAttachmentsUsage(
  connection: Connection,
  organizationId: string,
): Promise<number> {
  const parts = await Promise.all(
    SHARED_ATTACHMENT_STORAGE.map(async ({ collection, match, field, unwind }) => {
      const [row] = await connection
        .collection(collection)
        .aggregate<{ total: number }>([
          { $match: { organizationId, ...match } },
          ...(unwind ? [{ $unwind: unwind }] : []),
          { $group: { _id: null, total: { $sum: field } } },
        ])
        .toArray();
      return row?.total ?? 0;
    }),
  );
  return parts.reduce((a, b) => a + b, 0);
}
