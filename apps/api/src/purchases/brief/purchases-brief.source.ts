// Fournisseur réel du port `PURCHASES_SOURCE` du brief du matin — ADR-0044 § 6.4.
// ADR-0044 — P6.
//
// LECTURE SEULE, dans l'organisation seulement (l'identifiant vient de la session) :
//   - factures fournisseurs VALIDÉES (type `invoice`) au reste à payer non nul,
//     avec leur échéance et leur litige ; le reste vient du moteur
//     (`payableSettlement`, via `settlementsOf`) ;
//   - fenêtre « bientôt » et approbateur unique : réglages des achats ;
//   - demandes soumises que l'appelant peut approuver (`approvableFilter`, motif de
//     « Mes tâches »), comptées seulement si le service l'y autorise.
// Aucun « en retard » n'est décidé ici : le moteur du brief le décide au jour de
// Kinshasa. Module sans dépendance (motif de `PurchasesAgendaModule`) : le brief
// l'importe sans dépendre du module des achats.

import type { BriefPayableInput, BriefPurchasesInput } from '@lalanda/engine';
import { PURCHASE_SETTINGS_DEFAULTS } from '@lalanda/shared/purchases';
import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

import { AuthzService } from '../../authz/authz.service.js';
import type { PurchasesSource } from '../../morning-brief/morning-brief.ports.js';
import { approvableFilter, isSoleApproverOrg } from '../orders/purchase-order-model.js';
import {
  INVOICES,
  settlementsOf,
  type PayableInvoiceDoc,
} from '../payments/payable-settlements.js';

/** Factures lues au plus pour un brief : un tableau de bord n'est pas un export. */
export const MAX_BRIEF_PAYABLES = 2000;

@Injectable()
export class PurchasesBriefSource implements PurchasesSource {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @Inject(AuthzService) private readonly authz: AuthzService,
  ) {}

  async purchasesOf(
    organizationId: string,
    userId: string,
    access: { amounts: boolean; approvals: boolean },
  ): Promise<BriefPurchasesInput> {
    const [settings, rows] = await Promise.all([
      this.connection
        .collection('purchase_settings')
        .findOne({ organizationId }, { projection: { dueSoonDays: 1, allowSoleApprover: 1 } }),
      this.connection
        .collection(INVOICES)
        .find(
          { organizationId, status: 'validated', kind: 'invoice' },
          { projection: { status: 1, kind: 1, total: 1, currency: 1, dueDate: 1, disputed: 1 } },
        )
        .sort({ dueDate: 1, _id: 1 })
        .limit(MAX_BRIEF_PAYABLES + 1)
        .toArray() as unknown as Promise<PayableInvoiceDoc[]>,
    ]);
    const truncated = rows.length > MAX_BRIEF_PAYABLES;
    const invoices = rows.slice(0, MAX_BRIEF_PAYABLES);
    const settlements = await settlementsOf(this.connection, organizationId, invoices);
    const payables: BriefPayableInput[] = [];
    for (const inv of invoices) {
      const remaining = settlements.get(String(inv._id))?.remaining ?? '0.00';
      if (remaining === '0.00') continue;
      payables.push({
        currency: inv.currency,
        dueDate: inv.dueDate,
        remaining,
        disputed: inv.disputed !== null && inv.disputed !== undefined,
      });
    }

    const dueSoonDays =
      typeof settings?.['dueSoonDays'] === 'number'
        ? (settings['dueSoonDays'] as number)
        : PURCHASE_SETTINGS_DEFAULTS.dueSoonDays;
    let pendingApprovalCount: number | null = null;
    if (access.approvals) {
      const allow =
        typeof settings?.['allowSoleApprover'] === 'boolean'
          ? (settings['allowSoleApprover'] as boolean)
          : PURCHASE_SETTINGS_DEFAULTS.allowSoleApprover;
      const approvers = await this.authz.countApprovers(organizationId, 'purchase.approve');
      pendingApprovalCount = await this.connection
        .collection('purchase_orders')
        .countDocuments(
          approvableFilter(organizationId, userId, isSoleApproverOrg(allow, approvers)),
        );
    }
    return {
      status: 'known',
      payables,
      dueSoonDays,
      amountsVisible: access.amounts,
      pendingApprovalCount,
      truncated,
    };
  }
}
