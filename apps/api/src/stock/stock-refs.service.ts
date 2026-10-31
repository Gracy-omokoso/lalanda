// Vérification des références d'autres modules, EN LECTURE SEULE (ADR-0046 § 1).
// ADR-0046 — S3.
//
// Un identifiant forgé dans un corps (`catalogItemId`, `workProjectId`, `employeeId`,
// `supplierId`, `receptionId`, membre) qui désigne une ressource d'une autre
// organisation, ou rien, répond 404. Lecture par la connexion : aucun modèle d'un autre
// module n'est déclaré ici, rien n'y est jamais écrit.

import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Types, type Connection } from 'mongoose';

import { isOid, notFound } from './stock.common.js';

@Injectable()
export class StockRefsService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  private async byId(
    collection: string,
    organizationId: string,
    id: string,
    projection: Record<string, 1> = {},
  ): Promise<Record<string, unknown> | null> {
    if (!isOid(id)) return null;
    return this.connection
      .collection(collection)
      .findOne({ _id: new Types.ObjectId(id), organizationId }, { projection });
  }

  /** Article du catalogue de vente de l'organisation (type lu, jamais écrit). */
  async catalogItem(organizationId: string, id: string): Promise<{ itemType: string }> {
    const doc = await this.byId('catalog_items', organizationId, id, { itemType: 1 });
    if (!doc) notFound('CATALOG_ITEM_NOT_FOUND', 'Article du catalogue introuvable.');
    return { itemType: String(doc['itemType']) };
  }

  async supplier(organizationId: string, id: string): Promise<void> {
    const doc = await this.byId('suppliers', organizationId, id, { active: 1 });
    if (!doc) notFound('SUPPLIER_NOT_FOUND', 'Fournisseur introuvable.');
  }

  async workProject(organizationId: string, id: string): Promise<void> {
    const doc = await this.byId('work_projects', organizationId, id);
    if (!doc) notFound('WORK_PROJECT_NOT_FOUND', 'Projet introuvable.');
  }

  async employee(organizationId: string, id: string): Promise<void> {
    const doc = await this.byId('hr_employees', organizationId, id);
    if (!doc) notFound('EMPLOYEE_NOT_FOUND', 'Collaborateur introuvable.');
  }

  async reception(organizationId: string, id: string): Promise<void> {
    const doc = await this.byId('purchase_receptions', organizationId, id);
    if (!doc) notFound('PURCHASE_RECEPTION_NOT_FOUND', 'Réception introuvable.');
  }

  /** Membre de l'organisation (responsable d'emplacement, compteur). */
  async member(organizationId: string, userId: string): Promise<void> {
    const doc = await this.connection
      .collection('memberships')
      .findOne({ organizationId, userId }, { projection: { _id: 1 } });
    if (!doc) notFound('MEMBER_NOT_FOUND', 'Membre introuvable dans cette organisation.');
  }
}
