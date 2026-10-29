// Rapports du CRM — requête et vue de `GET /crm/reports` (ADR-0040 § 3.4, § 7.2).
// ADR-0040 — C3.
//
// Contrat seulement : les chiffres viennent du moteur (`crmReports`,
// `@lalanda/engine`), l'API les rend tels quels et y joint les noms des
// responsables. Tous les montants sont des ESTIMATIONS (`basis: 'estimated'`),
// par devise, jamais convertis ; rien n'alimente le réalisé ni un plan.

import { z } from 'zod';

import { CRM_OWNER_ME } from './constants.js';

/** Période par défaut (mois glissants) et période maximale (décision ouverte n° 12). */
export const CRM_REPORT_PERIOD_MONTHS = Object.freeze({ default: 12, max: 24 });

/** Seuil d'échantillon des taux et des durées (décision ouverte n° 11). */
export const CRM_REPORT_MIN_SAMPLE_DEFAULT = 10;

/** Étiquette obligatoire des montants des rapports (ADR-0040 § 7). */
export const CRM_REPORT_ESTIMATE_LABEL =
  'Montants estimés — calculés par Lalanda à partir des opportunités ; ni réalisé, ni plan.';

export const CRM_REPORT_ERROR_CODES = [
  'CRM_REPORT_PERIOD_INVALID',
  'CRM_REPORT_PERIOD_TOO_LONG',
] as const;
export type CrmReportErrorCode = (typeof CRM_REPORT_ERROR_CODES)[number];

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const OBJECT_ID = /^[0-9a-f]{24}$/i;

const day = (what: string) =>
  z.string().refine((v) => DAY.test(v), {
    message: `${what} : jour AAAA-MM-JJ attendu.`,
    params: { code: 'CRM_REPORT_PERIOD_INVALID' },
  });

/** `GET /crm/reports?from=&to=&ownerId=me|<id>` ; jours de Kinshasa, bornes incluses. */
export const CrmReportsQuery = z
  .object({
    from: day('Début de période').optional(),
    to: day('Fin de période').optional(),
    ownerId: z
      .string()
      .refine((v) => v === CRM_OWNER_ME || OBJECT_ID.test(v), {
        message: 'Responsable : « me » ou un identifiant.',
        params: { code: 'CRM_ID_INVALID' },
      })
      .transform((v) => (v === CRM_OWNER_ME ? v : v.toLowerCase()))
      .optional(),
  })
  .strict();
export type CrmReportsQuery = z.output<typeof CrmReportsQuery>;

// ── Vue ─────────────────────────────────────────────────────────────────────

export interface CrmReportCurrencyTotal {
  currency: string;
  total: string;
  count: number;
}

export interface CrmReportCurrencyForecast {
  currency: string;
  weighted: string;
  unweighted: string;
  count: number;
  notWeightable: { total: string; count: number };
}

export type CrmReportRate =
  | { status: 'available'; ratePercent: string; sample: number; count: number }
  | { status: 'unavailable'; sample: number; count: number; requiredSample: number };

export type CrmReportDuration =
  | { status: 'available'; meanDays: number; medianDays: number; sample: number }
  | { status: 'unavailable'; sample: number; requiredSample: number };

export interface CrmReportCountAndAmounts {
  count: number;
  amounts: CrmReportCurrencyTotal[];
}

export interface CrmReportLostReason {
  lostReasonKey: string | null;
  /** Libellé du réglage ; `null` : sans motif ou motif retiré des réglages. */
  label?: string | null;
  count: number;
}

export interface CrmReportOwner {
  ownerId: string | null;
  /** Nom joint par l'API ; `null` : inconnu (ancien membre, ou sans responsable). */
  ownerName: string | null;
  /** `false` : responsable qui n'est plus membre (opportunités orphelines). */
  isMember: boolean;
  open: CrmReportCountAndAmounts;
  won: CrmReportCountAndAmounts;
  lost: CrmReportCountAndAmounts;
  winRate: CrmReportRate;
  forecast: CrmReportCurrencyForecast[];
  topLostReasons: CrmReportLostReason[];
}

export interface CrmReportsView {
  version: string;
  basis: 'estimated';
  label: string;
  generatedAt: string;
  period: { from: string; to: string };
  asOf: string;
  ownerId: string | null;
  minSample: number;
  stages: { key: string; label: string; kind: 'open' | 'won' | 'lost' }[];
  funnel: { created: number; stages: (CrmReportCountAndAmounts & { stageKey: string })[] };
  conversion: {
    stages: { fromStageKey: string; toStageKey: string | null; rate: CrmReportRate }[];
    overall: CrmReportRate;
  };
  cycle: { won: CrmReportDuration; lost: CrmReportDuration };
  byOwner: CrmReportOwner[];
  forecastByMonth: {
    probabilitySource: 'historical' | 'manual';
    buckets: {
      kind: 'overdue' | 'month' | 'no_date';
      month: string | null;
      count: number;
      currencies: CrmReportCurrencyForecast[];
    }[];
  };
  lostReasons: { total: number; reasons: CrmReportLostReason[] };
  /** Vrai si une borne de lecture a été atteinte (chiffres partiels). */
  truncated: boolean;
}
