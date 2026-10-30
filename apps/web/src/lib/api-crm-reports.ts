// Client des rapports du CRM — ADR-0040 § 3.4, § 7.2, § 8.2 (lot C6).
//
// `GET /crm/reports?from=&to=&ownerId=me|<id>` sous `crm.read`. Fichier propre
// au lot C6 (`api.ts` appartient à C0, `api-crm.ts` à l'application `/crm`).
// AUCUN chiffre n'est calculé ici : entonnoir, taux, durées, résultats par
// responsable et prévision viennent du moteur (`crmReports`), montants estimés
// par devise, jamais convertis.

import type { CrmReportsView } from '@lalanda/shared/crm';

import { jsonRequest, salesQuery } from './api';

export type {
  CrmReportCountAndAmounts,
  CrmReportCurrencyForecast,
  CrmReportCurrencyTotal,
  CrmReportDuration,
  CrmReportLostReason,
  CrmReportOwner,
  CrmReportRate,
  CrmReportsView,
} from '@lalanda/shared/crm';

export { CRM_REPORT_PERIOD_MONTHS } from '@lalanda/shared/crm';

/** Requête des rapports ; sans `from`/`to`, l'API prend 12 mois glissants. */
export interface CrmReportsRequest {
  from?: string;
  to?: string;
  /** `me` ou l'identifiant d'un membre ; absent : toute l'organisation. */
  ownerId?: string;
}

export const crmReportsApi = {
  get: (query: CrmReportsRequest = {}) =>
    jsonRequest<CrmReportsView>(`/crm/reports${salesQuery(query)}`, { method: 'GET' }),
};
