// Fournisseur réel du port `TREASURY_HR_PAYABLES_SOURCE` (ADR-0051 § 7.2). ADR-0051 — H10.
//
// Fourni par le module de la TRÉSORERIE (lecture seule par la connexion, sans dépendre
// du module RH, qui dépend lui-même de la trésorerie) — motif de `PurchasesPayablesSource`.
// « Remboursements au personnel » (estimation, placée à J+1 par le moteur) :
//   - notes APPROUVÉES non remboursées : total de la note (moteur `expenseReportTotals`) ;
//     une note soldée en partie par une avance : le seul complément dû (`settlement.topUp`) ;
//   - avances APPROUVÉES non versées : montant validé.
// Libellés NEUTRES : « Note de frais NF… », « Avance AV… » — jamais un nom, jamais
// « sur salaire ». Aucun montant n'est calculé ici.

import { expenseReportTotals, type HrPayableForecastInput } from '@lalanda/engine';
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

import type { TreasuryHrPayablesSource } from '../../treasury/treasury-sources.js';
import type { StoredExpenseLine } from './expense-report.schema.js';

@Injectable()
export class HrPayablesSource implements TreasuryHrPayablesSource {
  readonly integrated = true;

  constructor(@InjectConnection() private readonly connection: Connection) {}

  async openHrPayables(organizationId: string): Promise<HrPayableForecastInput[]> {
    const [reports, advances] = await Promise.all([
      this.connection
        .collection('hr_expense_reports')
        .find(
          { organizationId, status: { $in: ['approved', 'partially_settled'] } },
          { projection: { number: 1, currency: 1, lines: 1, status: 1, settlement: 1 } },
        )
        .toArray(),
      this.connection
        .collection('hr_advances')
        .find(
          { organizationId, status: 'approved' },
          { projection: { number: 1, currency: 1, amount: 1 } },
        )
        .toArray(),
    ]);
    const out: HrPayableForecastInput[] = [];
    for (const r of reports) {
      const lines = (r['lines'] ?? []) as StoredExpenseLine[];
      const amount =
        r['status'] === 'partially_settled'
          ? String((r['settlement'] as { topUp?: string } | null)?.topUp ?? '0.00')
          : expenseReportTotals(lines).total;
      if (amount === '0.00') continue;
      out.push({
        id: String(r._id),
        kind: 'expense_report',
        label: `Note de frais ${String(r['number'] ?? '')}`.trim(),
        currency: r['currency'] as HrPayableForecastInput['currency'],
        amount,
      });
    }
    for (const a of advances) {
      out.push({
        id: String(a._id),
        kind: 'advance',
        label: `Avance ${String(a['number'] ?? '')}`.trim(),
        currency: a['currency'] as HrPayableForecastInput['currency'],
        amount: String(a['amount']),
      });
    }
    return out;
  }
}
