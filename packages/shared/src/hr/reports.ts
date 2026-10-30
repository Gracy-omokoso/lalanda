// Rapports RH et registre du personnel — ADR-0045 § 3.3, § 7. ADR-0045 — H5.
//
// `GET /hr/reports?from=&to=&departmentId=` (`hr.read`) : effectif, entrées et sorties
// (taux de sortie), absentéisme PAR SERVICE (jamais par personne), ancienneté par
// tranches — tous calculés par le moteur RH. AUCUNE donnée salariale, aucun champ de
// `hr_employee_private`, aucun type d'absence nommé.
//
// `GET /hr/reports/export.csv` (`hr.read` + `report.export`) : registre NON sensible ;
// formules neutralisées comme le CSV du CRM ; audit `hr.register.exported`.

import { z } from 'zod';

import { HrCalendarDay, HrId, hrIssue } from './common.js';

/** Fenêtre la plus longue d'un rapport : dix ans de jours civils. */
export const HR_REPORT_MAX_DAYS = 3660;

export const HrReportsQuery = z
  .object({
    from: HrCalendarDay,
    to: HrCalendarDay,
    departmentId: HrId.optional(),
  })
  .strict()
  .superRefine((q, ctx) => {
    if (q.to < q.from) {
      hrIssue(ctx, 'HR_REPORT_PERIOD_INVERTED', 'La fin de période précède son début.', ['to']);
      return;
    }
    const days =
      (Date.parse(`${q.to}T00:00:00Z`) - Date.parse(`${q.from}T00:00:00Z`)) / 86_400_000 + 1;
    if (days > HR_REPORT_MAX_DAYS) {
      hrIssue(ctx, 'HR_REPORT_PERIOD_TOO_LONG', 'Période de dix ans au plus.', ['to']);
    }
  });
export type HrReportsQuery = z.output<typeof HrReportsQuery>;

export const HrRegisterExportQuery = z.object({ departmentId: HrId.optional() }).strict();
export type HrRegisterExportQuery = z.output<typeof HrRegisterExportQuery>;

export interface HrReportCount {
  /** Service (`departmentId`), type de contrat, ou `null` (sans). */
  key: string | null;
  /** Libellé lisible : nom du service, libellé du type de contrat, « Sans service ». */
  label: string;
  count: number;
}

export interface HrReportsView {
  /** Version du moteur RH (`HR_VERSION`). */
  version: string;
  from: string;
  to: string;
  departmentId: string | null;
  headcount: {
    /** Effectif présent au dernier jour de la période. */
    asOf: string;
    total: number;
    byDepartment: HrReportCount[];
    byContractType: HrReportCount[];
  };
  movements: {
    entries: number;
    exits: number;
    exitsByCategory: { category: string | null; count: number }[];
    averageHeadcount: string;
    /** Indicateur Lalanda (sorties ÷ effectif moyen), pas une norme ; `null` si effectif nul. */
    exitRatePercent: string | null;
  };
  absenteeism: {
    groups: {
      departmentId: string | null;
      label: string;
      employees: number;
      theoreticalDays: string;
      absenceDays: string;
      ratePercent: string | null;
    }[];
    total: {
      employees: number;
      theoreticalDays: string;
      absenceDays: string;
      ratePercent: string | null;
    };
  };
  seniority: {
    asOf: string;
    total: number;
    buckets: { bucket: 'lt1' | '1to3' | '3to5' | '5to10' | 'gte10'; count: number }[];
  };
}

/** Colonnes du registre exporté : aucune donnée sensible, aucune note libre. */
export const HR_REGISTER_COLUMNS = [
  'Matricule',
  'Nom',
  'Prénom',
  'Nom d’usage',
  'Poste',
  'Service',
  'Manager',
  'Type de contrat',
  'Date d’entrée',
  'Fin de période d’essai',
  'Fin de contrat',
  'Date de sortie',
  'Catégorie de sortie',
  'Statut',
  'Lieu de travail',
] as const;
