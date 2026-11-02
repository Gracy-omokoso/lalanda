// Fournisseur réel du port `WORK_HR_EXPENSES_SOURCE` — ADR-0051 § 7.3. ADR-0051 — H14.
//
// LECTURE SEULE de `hr_expense_reports`, par la connexion (motif de `StockMarginSource`) :
// fourni par le module de la facturation des projets sans dépendre du module RH. Dans
// l'organisation de la session seulement ; un projet d'une autre organisation n'a aucune
// ligne (le contrôleur a déjà rendu 404).
//
// Ni nom de collaborateur, ni justificatif, ni motif : la fiche projet ne voit les frais
// que par la dépense de remboursement (« Frais NF… — {libellé} », § 4). AUCUN calcul ici :
// le reste à rembourser est calculé par le moteur de la marge (`pendingExpenseClaimsOf`),
// le montant d'une ligne refacturable est celui de la ligne, lu tel quel.

import type { WorkMarginExpenseClaimInput } from '@lalanda/engine';
import type { WorkRebillableExpenseView } from '@lalanda/shared/hr';
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

import type { WorkHrExpensesSource } from '../../work/margin/work-hr-expenses.port.js';
import type { StoredExpenseLine } from '../expenses/expense-report.schema.js';

/** Notes lues au plus par projet (borne de sûreté d'une fiche). */
export const MAX_PROJECT_EXPENSE_REPORTS = 2_000;

/** Approuvée, rien (ou pas tout) n'est encore remboursé. */
const PENDING_STATUSES = ['approved', 'partially_settled'] as const;
/** Toutes les dépenses de la note existent : remboursée, ou soldée par une avance. */
const SPENT_STATUSES = ['reimbursed', 'settled_by_advance'] as const;

interface ReportRow {
  _id: unknown;
  number: string | null;
  currency: 'CDF' | 'USD';
  lines: StoredExpenseLine[];
}

@Injectable()
export class HrWorkExpensesSource implements WorkHrExpensesSource {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  private reports(
    organizationId: string,
    projectId: string,
    statuses: readonly string[],
    extra: Record<string, unknown> = {},
  ): Promise<ReportRow[]> {
    return this.connection
      .collection('hr_expense_reports')
      .find(
        {
          organizationId,
          status: { $in: [...statuses] },
          lines: { $elemMatch: { workProjectId: projectId, ...extra } },
        },
        { projection: { number: 1, currency: 1, lines: 1 } },
      )
      .sort({ _id: 1 })
      .limit(MAX_PROJECT_EXPENSE_REPORTS + 1)
      .toArray() as unknown as Promise<ReportRow[]>;
  }

  async claimsOf(
    organizationId: string,
    projectId: string,
  ): Promise<WorkMarginExpenseClaimInput[]> {
    const rows = await this.reports(organizationId, projectId, PENDING_STATUSES);
    return rows
      .slice(0, MAX_PROJECT_EXPENSE_REPORTS)
      .flatMap((r) =>
        r.lines.flatMap((l, index) =>
          l.workProjectId === projectId
            ? [{ line: `${String(r._id)}:${index}`, currency: r.currency, amount: l.amount }]
            : [],
        ),
      );
  }

  async rebillableOf(
    organizationId: string,
    projectId: string,
  ): Promise<{ items: WorkRebillableExpenseView[]; truncated: boolean }> {
    const rows = await this.reports(organizationId, projectId, SPENT_STATUSES, {
      rebillable: true,
    });
    const items = rows.slice(0, MAX_PROJECT_EXPENSE_REPORTS).flatMap((r) => {
      const reportId = String(r._id);
      return r.lines.flatMap((l, lineIndex) =>
        l.workProjectId === projectId && l.rebillable === true
          ? [
              {
                key: `${reportId}:${lineIndex}`,
                reportId,
                reportNumber: r.number ?? null,
                lineIndex,
                spentOn: l.spentOn,
                category: l.category,
                label: `Frais ${r.number ?? ''} — ${l.label}`.replace('Frais  —', 'Frais —'),
                currency: r.currency,
                amount: l.amount,
                merchant: l.merchant ?? null,
              },
            ]
          : [],
      );
    });
    items.sort((a, b) =>
      a.spentOn === b.spentOn ? (a.key < b.key ? -1 : 1) : a.spentOn < b.spentOn ? -1 : 1,
    );
    return { items, truncated: rows.length > MAX_PROJECT_EXPENSE_REPORTS };
  }
}
