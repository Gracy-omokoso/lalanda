// Reste à payer des factures fournisseurs VALIDÉES (ADR-0044 § 2.6, § 6.3).
// ADR-0044 — P5.
//
// Lecture seule par la connexion (`supplier_invoices`, `supplier_payments`), sans
// modèle injecté : la source des dettes de la prévision (fournie par le module de
// la trésorerie) et le service des paiements (dans SA transaction, `session`) s'en
// servent sans dépendre l'un de l'autre. Le règlement de chaque facture vient du
// moteur (`payableSettlement`) : paiements non annulés et avoirs validés imputés.

import { payableSettlement, type PayableSettlement } from '@lalanda/engine';
import type { ClientSession, Connection } from 'mongoose';
import { Types } from 'mongoose';

export const INVOICES = 'supplier_invoices';
export const PAYMENTS = 'supplier_payments';

/** Champs d'une facture lus pour le règlement et l'échéancier. */
export interface PayableInvoiceDoc {
  _id: Types.ObjectId;
  organizationId: string;
  internalNumber: string;
  supplierId: string;
  supplierReference: string;
  kind: 'invoice' | 'credit_note';
  status: 'draft' | 'validated' | 'cancelled';
  currency: 'CDF' | 'USD';
  invoiceDate: string;
  dueDate: string;
  total: string;
  deductibleVat: string | null;
  costAllocations: { category: string; workProjectId: string | null; amount: string }[];
  disputed: { by: string; at: Date; reason: string } | null;
}

export type InvoiceSettlement = Omit<PayableSettlement, 'version'>;

const PROJECTION = {
  organizationId: 1,
  internalNumber: 1,
  supplierId: 1,
  supplierReference: 1,
  kind: 1,
  status: 1,
  currency: 1,
  invoiceDate: 1,
  dueDate: 1,
  total: 1,
  deductibleVat: 1,
  costAllocations: 1,
  disputed: 1,
};

/** Factures de l'organisation par identifiants (les autres organisations sont absentes). */
export async function readInvoices(
  connection: Connection,
  organizationId: string,
  ids: readonly string[],
  session?: ClientSession,
): Promise<PayableInvoiceDoc[]> {
  const valid = [...new Set(ids)].filter((id) => /^[0-9a-f]{24}$/.test(id));
  if (valid.length === 0) return [];
  return (await connection
    .collection(INVOICES)
    .find(
      { organizationId, _id: { $in: valid.map((id) => new Types.ObjectId(id)) } },
      { projection: PROJECTION, ...(session ? { session } : {}) },
    )
    .toArray()) as unknown as PayableInvoiceDoc[];
}

/** Factures VALIDÉES (type `invoice`) de l'organisation, filtrées par fournisseur. */
export async function readValidatedInvoices(
  connection: Connection,
  organizationId: string,
  supplierId?: string,
): Promise<PayableInvoiceDoc[]> {
  return (await connection
    .collection(INVOICES)
    .find(
      {
        organizationId,
        status: 'validated',
        kind: 'invoice',
        ...(supplierId ? { supplierId } : {}),
      },
      { projection: PROJECTION },
    )
    .sort({ dueDate: 1, _id: 1 })
    .toArray()) as unknown as PayableInvoiceDoc[];
}

/** Règlement (moteur) de chaque facture validée ; `session` : lecture dans une transaction. */
export async function settlementsOf(
  connection: Connection,
  organizationId: string,
  invoices: readonly Pick<PayableInvoiceDoc, '_id' | 'status' | 'kind' | 'total'>[],
  session?: ClientSession,
): Promise<Map<string, InvoiceSettlement>> {
  const out = new Map<string, InvoiceSettlement>();
  const open = invoices.filter((d) => d.status === 'validated' && d.kind === 'invoice');
  if (open.length === 0) return out;
  const ids = open.map((d) => String(d._id));
  const opts = session ? { session } : {};
  const [payments, credits] = await Promise.all([
    connection
      .collection(PAYMENTS)
      .find(
        { organizationId, status: { $ne: 'cancelled' }, 'allocations.invoiceId': { $in: ids } },
        { projection: { allocations: 1 }, ...opts },
      )
      .toArray(),
    connection
      .collection(INVOICES)
      .find(
        {
          organizationId,
          kind: 'credit_note',
          status: 'validated',
          creditedInvoiceId: { $in: ids },
        },
        { projection: { creditedInvoiceId: 1, total: 1 }, ...opts },
      )
      .toArray(),
  ]);
  const paidBy = new Map<string, string[]>();
  for (const p of payments) {
    for (const a of (p['allocations'] ?? []) as { invoiceId?: unknown; amount?: unknown }[]) {
      if (typeof a.invoiceId !== 'string' || typeof a.amount !== 'string') continue;
      paidBy.set(a.invoiceId, [...(paidBy.get(a.invoiceId) ?? []), a.amount]);
    }
  }
  const creditBy = new Map<string, string[]>();
  for (const c of credits) {
    const target = String(c['creditedInvoiceId']);
    creditBy.set(target, [...(creditBy.get(target) ?? []), String(c['total'])]);
  }
  for (const d of open) {
    const id = String(d._id);
    const { version: _version, ...s } = payableSettlement(
      { total: d.total },
      paidBy.get(id) ?? [],
      creditBy.get(id) ?? [],
    );
    out.set(id, s);
  }
  return out;
}

/** Noms des fiches fournisseurs de l'organisation. */
export async function supplierNamesOf(
  connection: Connection,
  organizationId: string,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const valid = [...new Set(ids)].filter((id) => /^[0-9a-f]{24}$/.test(id));
  if (valid.length === 0) return new Map();
  const docs = await connection
    .collection('suppliers')
    .find(
      { organizationId, _id: { $in: valid.map((id) => new Types.ObjectId(id)) } },
      { projection: { name: 1 } },
    )
    .toArray();
  return new Map(docs.map((d) => [String(d._id), String(d['name'])]));
}
