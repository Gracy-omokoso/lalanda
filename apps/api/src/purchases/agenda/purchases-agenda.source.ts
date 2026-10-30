// Fournisseur RÉEL du port `PURCHASES_AGENDA_SOURCE` de « Mes tâches » —
// ADR-0044 § 6.5. ADR-0044 — P3.
//
// LECTURE SEULE de `purchase_orders` (et du réglage `allowSoleApprover`) : rien n'est
// copié dans `work_tasks`. Une demande `submitted` que l'appelant peut approuver y
// figure (ni demandeur ni créateur, sauf approbateur unique ; pas déjà approuvée
// par lui) ; elle disparaît dès qu'elle est approuvée, refusée ou modifiée (la
// modification efface les approbations : elle revient alors pour tous). La détention
// de `purchase.approve` est vérifiée par `WorkTasksService.myTasks` avant l'appel.

import {
  PURCHASE_SETTINGS_DEFAULTS,
  purchasesAgendaHref,
  purchasesAgendaId,
  type PurchasesMyTaskItem,
} from '@lalanda/shared/purchases';
import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';

import { AuthzService } from '../../authz/authz.service.js';
import { kinshasaDay } from '../../crm/crm-model.js';
import type { PurchasesAgendaPage, PurchasesAgendaReader } from '../../work/my-tasks.ports.js';
import { approvableFilter, isSoleApproverOrg } from '../orders/purchase-order-model.js';
import {
  PurchaseOrder,
  type PurchaseOrderDocument,
  type PurchaseOrderLean,
} from '../orders/purchase-order.schema.js';

@Injectable()
export class PurchasesAgendaSource implements PurchasesAgendaReader {
  constructor(
    @InjectModel(PurchaseOrder.name) private readonly orders: Model<PurchaseOrderDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(AuthzService) private readonly authz: AuthzService,
  ) {}

  async approvalsOf(
    organizationId: string,
    userId: string,
    limit: number,
  ): Promise<PurchasesAgendaPage> {
    const [settings, approverCount] = await Promise.all([
      this.connection
        .collection('purchase_settings')
        .findOne({ organizationId }, { projection: { allowSoleApprover: 1 } }),
      this.authz.countApprovers(organizationId, 'purchase.approve'),
    ]);
    const allow =
      typeof settings?.['allowSoleApprover'] === 'boolean'
        ? (settings['allowSoleApprover'] as boolean)
        : PURCHASE_SETTINGS_DEFAULTS.allowSoleApprover;
    const docs = await this.orders
      .find(approvableFilter(organizationId, userId, isSoleApproverOrg(allow, approverCount)), {
        requestNumber: 1,
        title: 1,
        supplierName: 1,
        totals: 1,
        currency: 1,
        submittedAt: 1,
        submittedOn: 1,
        updatedAt: 1,
      })
      .sort({ submittedAt: 1, _id: 1 })
      .limit(limit + 1)
      .lean<PurchaseOrderLean[]>()
      .exec();
    const items: PurchasesMyTaskItem[] = docs.slice(0, limit).map((d) => {
      const orderId = String(d._id);
      const at = new Date(d.submittedAt ?? d.updatedAt);
      return {
        source: 'purchases',
        id: purchasesAgendaId(orderId),
        orderId,
        requestNumber: d.requestNumber ?? null,
        title: d.title,
        supplierName: d.supplierName ?? null,
        total: d.totals.total,
        currency: d.currency,
        dueDate: d.submittedOn ?? kinshasaDay(at),
        priority: 'none',
        rank: at.toISOString(),
        done: false,
        kindLabel: 'Approbation',
        href: purchasesAgendaHref(orderId),
      };
    });
    return { items, truncated: docs.length > limit };
  }
}
