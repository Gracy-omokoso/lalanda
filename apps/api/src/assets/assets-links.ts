// Liens des équipements vers les autres modules (ADR-0046 § 1, § 3, § 6.5). ADR-0046 — S5.
//
// LECTURE SEULE par la connexion (motif de la trésorerie, `work_projects`) : le module
// des équipements n'importe ni les achats, ni les RH, ni les projets, ni les stocks, ni
// la bibliothèque. Chaque lecture porte `organizationId` : un identifiant d'une autre
// organisation, même forgé dans un corps, répond 404.
//
// Collaborateurs (R4) : seuls le nom d'usage, le poste, le statut et la date de sortie
// sont projetés — jamais une donnée sensible (`hr_employee_private` n'est pas lue), ni
// le contrat, ni les coordonnées, ni le matricule.

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Types, type Connection } from 'mongoose';

import { conflict } from '../sales/sales.errors.js';
import { isObjectIdHex } from '../sales/search.js';

const COLLECTIONS = {
  employees: 'hr_employees',
  projects: 'work_projects',
  locations: 'stock_locations',
  stockItems: 'stock_items',
  suppliers: 'suppliers',
  supplierInvoices: 'supplier_invoices',
  expenses: 'treasury_expenses',
  documents: 'library_documents',
  memberships: 'memberships',
  users: 'user',
} as const;

/** Champs d'un collaborateur que le registre peut lire (aucune donnée sensible). */
const EMPLOYEE_PROJECTION = {
  firstName: 1,
  lastName: 1,
  preferredName: 1,
  jobTitle: 1,
  status: 1,
  endDate: 1,
} as const;

export interface AssetEmployeeCard {
  id: string;
  name: string | null;
  jobTitle: string | null;
  status: string;
  endDate: string | null;
}

function notFound(code: string, message: string): never {
  throw new NotFoundException({ code, message });
}

function oid(id: string): Types.ObjectId | null {
  return typeof id === 'string' && isObjectIdHex(id) ? new Types.ObjectId(id) : null;
}

@Injectable()
export class AssetsLinks {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  private async findOwn(
    collection: string,
    organizationId: string,
    id: string,
    projection: Record<string, 1>,
  ): Promise<Record<string, unknown> | null> {
    const _id = oid(id);
    if (_id === null) return null;
    return this.connection.collection(collection).findOne({ _id, organizationId }, { projection });
  }

  // ── Vérifications d'écriture ───────────────────────────────────────────────

  /** Collaborateur ACTIF de l'organisation (une fiche sortie ne reçoit pas de matériel). */
  async assertActiveEmployee(organizationId: string, employeeId: string): Promise<void> {
    const e = await this.findOwn(COLLECTIONS.employees, organizationId, employeeId, {
      status: 1,
    });
    if (!e) notFound('EMPLOYEE_NOT_FOUND', 'Collaborateur introuvable.');
    if (e['status'] !== 'active') {
      conflict('EMPLOYEE_NOT_ACTIVE', 'Ce collaborateur n’est plus actif.');
    }
  }

  async assertLiveProject(organizationId: string, workProjectId: string): Promise<void> {
    const p = await this.findOwn(COLLECTIONS.projects, organizationId, workProjectId, {
      status: 1,
    });
    if (!p) notFound('WORK_PROJECT_NOT_FOUND', 'Projet introuvable dans cette organisation.');
    if (p['status'] === 'archived') {
      conflict('WORK_PROJECT_ARCHIVED', 'Ce projet est archivé.');
    }
  }

  async assertLocation(organizationId: string, locationId: string): Promise<void> {
    const l = await this.findOwn(COLLECTIONS.locations, organizationId, locationId, {
      archived: 1,
      active: 1,
    });
    if (!l) notFound('STOCK_LOCATION_NOT_FOUND', 'Emplacement introuvable.');
  }

  async assertStockItem(organizationId: string, stockItemId: string): Promise<void> {
    const s = await this.findOwn(COLLECTIONS.stockItems, organizationId, stockItemId, { _id: 1 });
    if (!s) notFound('STOCK_ITEM_NOT_FOUND', 'Article stocké introuvable.');
  }

  async assertMember(organizationId: string, userId: string): Promise<void> {
    const m = await this.connection
      .collection(COLLECTIONS.memberships)
      .findOne({ organizationId, userId }, { projection: { _id: 1 } });
    if (!m) notFound('MEMBER_NOT_FOUND', 'Ce compte n’est pas membre de l’organisation.');
  }

  async assertSupplier(organizationId: string, supplierId: string): Promise<void> {
    const s = await this.findOwn(COLLECTIONS.suppliers, organizationId, supplierId, { _id: 1 });
    if (!s) notFound('SUPPLIER_NOT_FOUND', 'Fournisseur introuvable.');
  }

  /** Facture fournisseur de l'organisation ; rend son fournisseur. */
  async supplierOfInvoice(organizationId: string, supplierInvoiceId: string): Promise<string> {
    const i = await this.findOwn(COLLECTIONS.supplierInvoices, organizationId, supplierInvoiceId, {
      supplierId: 1,
      status: 1,
    });
    if (!i) notFound('SUPPLIER_INVOICE_NOT_FOUND', 'Facture fournisseur introuvable.');
    if (i['status'] === 'cancelled') {
      conflict('SUPPLIER_INVOICE_CANCELLED', 'Cette facture fournisseur est annulée.');
    }
    return String(i['supplierId']);
  }

  async assertExpense(organizationId: string, expenseId: string): Promise<void> {
    const e = await this.findOwn(COLLECTIONS.expenses, organizationId, expenseId, { _id: 1 });
    if (!e) notFound('EXPENSE_NOT_FOUND', 'Dépense introuvable.');
  }

  async assertDocument(organizationId: string, documentId: string): Promise<void> {
    const d = await this.findOwn(COLLECTIONS.documents, organizationId, documentId, { _id: 1 });
    if (!d) notFound('DOCUMENT_NOT_FOUND', 'Document introuvable.');
  }

  /**
   * Fournisseur et facture fournisseur d'une acquisition ou d'une intervention : la
   * facture doit appartenir à l'organisation et, si un fournisseur est donné, être la
   * sienne (`409 SUPPLIER_INVOICE_MISMATCH`) ; sans fournisseur, celui de la facture est
   * repris. Rien n'est créé (ni dépense, ni dette).
   */
  async supplierLinks(
    organizationId: string,
    supplierId: string | null,
    supplierInvoiceId: string | null,
  ): Promise<{ supplierId: string | null; supplierInvoiceId: string | null }> {
    if (supplierId !== null) await this.assertSupplier(organizationId, supplierId);
    if (supplierInvoiceId === null) return { supplierId, supplierInvoiceId: null };
    const invoiceSupplier = await this.supplierOfInvoice(organizationId, supplierInvoiceId);
    if (supplierId !== null && supplierId !== invoiceSupplier) {
      conflict(
        'SUPPLIER_INVOICE_MISMATCH',
        'Cette facture fournisseur n’est pas celle du fournisseur indiqué.',
      );
    }
    return { supplierId: invoiceSupplier, supplierInvoiceId };
  }

  // ── Lectures d'affichage ───────────────────────────────────────────────────

  /** Cartes des collaborateurs (nom d'usage, poste, statut, sortie) — rien d'autre. */
  async employees(
    organizationId: string,
    ids: readonly string[],
  ): Promise<Map<string, AssetEmployeeCard>> {
    const oids = [...new Set(ids)].map(oid).filter((v): v is Types.ObjectId => v !== null);
    if (oids.length === 0) return new Map();
    const rows = await this.connection
      .collection(COLLECTIONS.employees)
      .find({ organizationId, _id: { $in: oids } }, { projection: EMPLOYEE_PROJECTION })
      .toArray();
    return new Map(
      rows.map((e) => {
        const anonymized = e['status'] === 'anonymized';
        const name = anonymized
          ? null
          : ((e['preferredName'] as string | null | undefined) ??
            `${String(e['firstName'] ?? '')} ${String(e['lastName'] ?? '')}`.trim());
        return [
          String(e['_id']),
          {
            id: String(e['_id']),
            name,
            jobTitle: anonymized ? null : ((e['jobTitle'] as string | null | undefined) ?? null),
            status: String(e['status'] ?? 'active'),
            endDate: (e['endDate'] as string | null | undefined) ?? null,
          },
        ];
      }),
    );
  }

  /** Noms de projets, d'emplacements et de membres (affichage seulement). */
  async names(
    collection: 'projects' | 'locations',
    organizationId: string,
    ids: readonly string[],
  ): Promise<Map<string, string>> {
    const oids = [...new Set(ids)].map(oid).filter((v): v is Types.ObjectId => v !== null);
    if (oids.length === 0) return new Map();
    const rows = await this.connection
      .collection(COLLECTIONS[collection])
      .find({ organizationId, _id: { $in: oids } }, { projection: { name: 1 } })
      .toArray();
    return new Map(rows.map((r) => [String(r['_id']), String(r['name'] ?? '')]));
  }

  async memberNames(
    organizationId: string,
    userIds: readonly string[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return new Map();
    const members = await this.connection
      .collection(COLLECTIONS.memberships)
      .find({ organizationId, userId: { $in: ids } }, { projection: { userId: 1 } })
      .toArray();
    const memberIds = members.map((m) => String(m['userId']));
    const oids = memberIds.map(oid).filter((v): v is Types.ObjectId => v !== null);
    const users =
      oids.length === 0
        ? []
        : await this.connection
            .collection(COLLECTIONS.users)
            .find({ _id: { $in: oids } }, { projection: { name: 1 } })
            .toArray();
    return new Map(users.map((u) => [String(u['_id']), String(u['name'] ?? '')]));
  }
}
