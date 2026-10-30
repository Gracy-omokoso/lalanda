// Réglages RH (ADR-0045 § 2.2, § 2.5, § 2.6, § 2.9, § 3.3) — logique pure, lot H7.
//
// Lalanda ne pose AUCUNE règle légale : ni droit à congé, ni durée d'essai, ni jours
// fériés, ni durée de conservation. Tout ce qui est réglé ici est saisi par
// l'organisation, sous sa responsabilité. Les formulaires se valident avec les
// schémas PARTAGÉS (`@lalanda/shared/hr`), mêmes messages que l'API.
//
// Droits : lecture `hr.read` ; écriture `hr.manage` ; le circuit de validation
// (`approvalFlow`, `allowSoleApprover`) exige EN PLUS `leave.approve`.

import {
  CreateChecklistTemplateBody,
  CreateHolidayBody,
  CreateLeaveTypeBody,
  HR_CONTRACT_TYPE_KEY_PATTERN,
  HR_WEEKDAYS,
  UpdateHrSettingsBody,
  isHrMonthDay,
  type HrApprovalFlow,
  type HrChecklistAssigneeRole,
  type HrChecklistKind,
  type HrContractType,
  type HrHolidayHalf,
  type HrOrgChartVisibility,
  type HrTeamCalendarVisibility,
  type HrWeekday,
  type HrWorkFraction,
  type LeaveProration,
  type LeaveUnit,
} from '@lalanda/shared/hr';

import type { OrgAction } from '@/lib/api';
import type {
  ChecklistTemplateItemInput,
  ChecklistTemplateView,
  HolidayView,
  HrSettingsFull,
  LeaveTypeFull,
} from '@/lib/api-hr-admin';

import { formatJour } from './rh-model';

type Actions = readonly OrgAction[] | null;
const a = (x: Actions, action: OrgAction): boolean => x !== null && x.includes(action);

export const peutModifierReglages = (x: Actions): boolean => a(x, 'hr.manage');
/** Changer QUI valide exige d'être soi-même validateur (motif d'ADR-0044 § 3.7). */
export const peutModifierCircuit = (x: Actions): boolean =>
  a(x, 'hr.manage') && a(x, 'leave.approve');

export const PHRASE_AUCUNE_REGLE =
  'Lalanda ne pose aucune règle légale : ni droit à congé, ni durée d’essai, ni préavis, ni jour férié, ni durée de conservation. Ce que vous réglez ici est saisi par votre organisation, sous sa responsabilité ; faites-le vérifier par votre conseil juridique.';

const erreursDe = (issues: readonly { message: string; path: readonly PropertyKey[] }[]) => [
  ...new Set(
    issues.map((i) => {
      const ligne = i.path.find((p) => typeof p === 'number');
      return typeof ligne === 'number' ? `Ligne ${ligne + 1} : ${i.message}` : i.message;
    }),
  ),
];

// ── Réglages généraux ───────────────────────────────────────────────────────

export const LIBELLES_JOUR: Record<HrWeekday, string> = {
  mon: 'Lundi',
  tue: 'Mardi',
  wed: 'Mercredi',
  thu: 'Jeudi',
  fri: 'Vendredi',
  sat: 'Samedi',
  sun: 'Dimanche',
};

export const LIBELLES_FRACTION: Record<string, string> = {
  '1': 'Journée',
  '0.5': 'Demi-journée',
  '0': 'Non travaillé',
};

export const MOIS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
] as const;

export const LIBELLES_CALENDRIER_EQUIPE: Record<HrTeamCalendarVisibility, string> = {
  department: 'Chacun voit son service et son équipe',
  organization: 'Chacun voit toute l’organisation',
  managers_and_hr: 'Seuls les managers et les RH voient les absences des autres',
};

export const LIBELLES_ORGANIGRAMME: Record<HrOrgChartVisibility, string> = {
  members: 'Visible de tous les membres reliés à une fiche',
  hr_only: 'Réservé aux ressources humaines',
};

export const LIBELLES_CIRCUIT: Record<HrApprovalFlow, string> = {
  manager_only: 'Le manager seul',
  manager_then_hr: 'Le manager, puis les ressources humaines',
  hr_only: 'Les ressources humaines seules',
};

export interface FormReglages {
  semaine: Record<HrWeekday, '0' | '0.5' | '1'>;
  debutMois: string;
  debutJour: string;
  contrats: HrContractType[];
  rappelEssai: string;
  rappelContrat: string;
  rappelDocument: string;
  calendrierEquipe: HrTeamCalendarVisibility;
  organigramme: HrOrgChartVisibility;
  conservationMois: string;
  anonymisationAns: string;
}

export function formReglages(s: HrSettingsFull): FormReglages {
  const [mois = '01', jour = '01'] = s.leaveYearStart.split('-');
  return {
    semaine: Object.fromEntries(
      HR_WEEKDAYS.map((d) => [d, String(s.workPattern[d]) as '0' | '0.5' | '1']),
    ) as FormReglages['semaine'],
    debutMois: mois,
    debutJour: jour,
    contrats: s.contractTypes.map((c) => ({ ...c })),
    rappelEssai: String(s.reminders.probationEnd),
    rappelContrat: String(s.reminders.contractEnd),
    rappelDocument: String(s.reminders.documentExpiry),
    calendrierEquipe: s.teamCalendarVisibility,
    organigramme: s.orgChartVisibility,
    conservationMois: s.retention.privateDataMonthsAfterExit?.toString() ?? '',
    anonymisationAns: s.retention.anonymizeYearsAfterExit?.toString() ?? '',
  };
}

const entier = (v: string): number => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : Number.NaN);
const entierOuNull = (v: string): number | null => (v.trim() === '' ? null : entier(v));

/** Clé d'un nouveau type de contrat tirée de son libellé, unique dans la liste. */
export function cleContrat(libelle: string, existantes: readonly string[]): string {
  const base =
    libelle
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^[^a-z]+/, '')
      .replace(/_+$/, '')
      .slice(0, 32) || 'contrat';
  let cle = base;
  for (let i = 2; existantes.includes(cle); i++) cle = `${base}_${i}`;
  return HR_CONTRACT_TYPE_KEY_PATTERN.test(cle) ? cle : `contrat_${existantes.length + 1}`;
}

export function validerReglages(
  f: FormReglages,
  revision: number,
): { ok: true; corps: UpdateHrSettingsBody } | { ok: false; erreurs: string[] } {
  const debut = `${f.debutMois}-${f.debutJour}`;
  if (!isHrMonthDay(debut)) {
    return { ok: false, erreurs: ['Le début de l’année de congé n’est pas une date valide.'] };
  }
  const brut = {
    expectedRevision: revision,
    workPattern: Object.fromEntries(
      HR_WEEKDAYS.map((d) => [d, Number(f.semaine[d]) as HrWorkFraction]),
    ),
    leaveYearStart: debut,
    contractTypes: f.contrats.map((c) => ({ ...c, label: c.label.trim() })),
    reminders: {
      probationEnd: entier(f.rappelEssai),
      contractEnd: entier(f.rappelContrat),
      documentExpiry: entier(f.rappelDocument),
    },
    teamCalendarVisibility: f.calendrierEquipe,
    orgChartVisibility: f.organigramme,
    retention: {
      privateDataMonthsAfterExit: entierOuNull(f.conservationMois),
      anonymizeYearsAfterExit: entierOuNull(f.anonymisationAns),
    },
  };
  const r = UpdateHrSettingsBody.safeParse(brut);
  if (!r.success) {
    const messages = erreursDe(r.error.issues).map((m) =>
      m.includes('expected number') || m.includes('NaN') || /Invalid input/i.test(m)
        ? 'Un délai ou une durée doit être un nombre entier.'
        : m,
    );
    return { ok: false, erreurs: [...new Set(messages)] };
  }
  return { ok: true, corps: r.data };
}

export function phraseSemaine(s: Pick<HrSettingsFull, 'workPattern'>): string {
  const jours = HR_WEEKDAYS.filter((d) => s.workPattern[d] > 0).map(
    (d) => `${LIBELLES_JOUR[d].toLowerCase()}${s.workPattern[d] === 0.5 ? ' (demi-journée)' : ''}`,
  );
  return jours.length > 0 ? jours.join(', ') : 'aucun jour';
}

export function phraseDebutAnnee(leaveYearStart: string): string {
  const [m = '01', j = '01'] = leaveYearStart.split('-');
  return `${Number(j) === 1 ? '1er' : Number(j)} ${MOIS[Number(m) - 1] ?? m}`;
}

// ── Types d'absence ─────────────────────────────────────────────────────────

export interface FormTypeAbsence {
  label: string;
  unit: LeaveUnit;
  deductsFromBalance: boolean;
  acquisition: 'none' | 'monthly' | 'yearly';
  jours: string;
  le: 'leave_year_start' | 'anniversary';
  proration: LeaveProration;
  reportMax: string;
  reportExpireMois: string;
  allowNegative: boolean;
  requiresDocument: boolean;
  confidential: boolean;
  requiresHrApproval: boolean;
  countsAsAbsenteeism: boolean;
  hrOnly: boolean;
}

export function formTypeAbsence(t: LeaveTypeFull | null): FormTypeAbsence {
  const p = t?.policy ?? null;
  const acc = p?.accrual ?? { kind: 'none' as const };
  return {
    label: t?.label ?? '',
    unit: t?.unit ?? 'day',
    deductsFromBalance: t?.deductsFromBalance ?? false,
    acquisition: acc.kind,
    jours: acc.kind === 'none' ? '' : acc.days.replace('.', ','),
    le: acc.kind === 'yearly' ? acc.on : 'leave_year_start',
    proration: p?.proration ?? 'calendar_days',
    reportMax: p?.carryOver.maxDays?.replace('.', ',') ?? '',
    reportExpireMois: p?.carryOver.expiresAfterMonths?.toString() ?? '',
    allowNegative: p?.allowNegative ?? false,
    requiresDocument: t?.requiresDocument ?? false,
    confidential: t?.confidential ?? false,
    requiresHrApproval: t?.requiresHrApproval ?? false,
    countsAsAbsenteeism: p?.countsAsAbsenteeism ?? true,
    hrOnly: t?.hrOnly ?? false,
  };
}

const jours = (v: string): string => v.trim().replace(',', '.');

export function validerTypeAbsence(
  f: FormTypeAbsence,
): { ok: true; corps: CreateLeaveTypeBody } | { ok: false; erreurs: string[] } {
  const accrual =
    f.acquisition === 'none'
      ? { kind: 'none' }
      : f.acquisition === 'monthly'
        ? { kind: 'monthly', days: jours(f.jours) }
        : { kind: 'yearly', days: jours(f.jours), on: f.le };
  const brut = {
    label: f.label,
    unit: f.unit,
    deductsFromBalance: f.deductsFromBalance,
    accrual,
    proration: f.proration,
    carryOver: {
      maxDays: f.reportMax.trim() === '' ? null : jours(f.reportMax),
      expiresAfterMonths: entierOuNull(f.reportExpireMois),
    },
    allowNegative: f.allowNegative,
    requiresDocument: f.requiresDocument,
    confidential: f.confidential,
    requiresHrApproval: f.requiresHrApproval,
    countsAsAbsenteeism: f.countsAsAbsenteeism,
    hrOnly: f.hrOnly,
  };
  const r = CreateLeaveTypeBody.safeParse(brut);
  if (!r.success) return { ok: false, erreurs: erreursDe(r.error.issues) };
  return { ok: true, corps: r.data };
}

/** Résumé d'une politique en mots (valeurs SAISIES par l'organisation). */
export function resumeTypeAbsence(t: LeaveTypeFull): string[] {
  const l: string[] = [t.unit === 'half_day' ? 'Par demi-journée' : 'Par journée'];
  l.push(t.deductsFromBalance ? 'Débite un solde' : 'Sans solde');
  const acc = t.policy?.accrual;
  if (acc && acc.kind === 'monthly')
    l.push(`Acquisition : ${acc.days.replace('.', ',')} j par mois`);
  else if (acc && acc.kind === 'yearly') {
    l.push(
      `Acquisition : ${acc.days.replace('.', ',')} j par an (${acc.on === 'anniversary' ? 'à la date anniversaire' : 'au début de l’année de congé'})`,
    );
  } else if (t.policy) l.push('Aucune acquisition automatique');
  if (t.confidential) l.push('Confidentiel : « Absent » hors ayants droit, validé par les RH');
  if (t.requiresHrApproval) l.push('Étape RH ajoutée');
  if (t.requiresDocument) l.push('Justificatif demandé');
  if (t.hrOnly) l.push('Saisi par les RH seulement');
  if (!t.active) l.push('Archivé');
  return l;
}

// ── Jours fériés ────────────────────────────────────────────────────────────

export interface FormFerie {
  date: string;
  label: string;
  demi: '' | HrHolidayHalf;
  recurring: boolean;
}

export const FORM_FERIE_VIDE: FormFerie = { date: '', label: '', demi: '', recurring: false };

export function validerFerie(
  f: FormFerie,
): { ok: true; corps: CreateHolidayBody } | { ok: false; erreurs: string[] } {
  const r = CreateHolidayBody.safeParse({
    date: f.date,
    label: f.label,
    halfDay: f.demi === '' ? null : f.demi,
    recurring: f.recurring,
  });
  if (!r.success) return { ok: false, erreurs: erreursDe(r.error.issues) };
  return { ok: true, corps: r.data };
}

export function libelleFerie(h: HolidayView): string {
  return [
    formatJour(h.date),
    h.halfDay === 'am' ? 'matin' : h.halfDay === 'pm' ? 'après-midi' : null,
    h.recurring ? 'chaque année' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

// ── Modèles de listes ───────────────────────────────────────────────────────

export interface LigneModele {
  id?: string;
  label: string;
  assignee: HrChecklistAssigneeRole;
  offsetDays: string;
  note: string;
}

export interface FormModele {
  kind: HrChecklistKind;
  label: string;
  items: LigneModele[];
}

export const LIGNE_MODELE_VIDE: LigneModele = {
  label: '',
  assignee: 'hr',
  offsetDays: '0',
  note: '',
};

export function formModele(m: ChecklistTemplateView | null): FormModele {
  if (!m) return { kind: 'onboarding', label: '', items: [{ ...LIGNE_MODELE_VIDE }] };
  return {
    kind: m.kind,
    label: m.label,
    items: m.items.map((i) => ({
      id: i.id,
      label: i.label,
      // Une personne nommée se garde telle quelle à l'envoi ; ici, rôle « RH » par défaut.
      assignee: typeof i.assignee === 'string' ? i.assignee : 'hr',
      offsetDays: String(i.offsetDays),
      note: i.note ?? '',
    })),
  };
}

export function validerModele(
  f: FormModele,
  original: ChecklistTemplateView | null = null,
): { ok: true; corps: CreateChecklistTemplateBody } | { ok: false; erreurs: string[] } {
  const items = f.items.map((i) => {
    const avant = original?.items.find((o) => o.id === i.id);
    const assignee =
      avant && typeof avant.assignee !== 'string' && i.assignee === 'hr'
        ? avant.assignee
        : i.assignee;
    const decalage = /^-?\d+$/.test(i.offsetDays.trim()) ? Number(i.offsetDays.trim()) : Number.NaN;
    return {
      ...(i.id ? { id: i.id } : {}),
      label: i.label,
      assignee,
      offsetDays: decalage,
      note: i.note.trim() === '' ? null : i.note,
    };
  });
  const r = CreateChecklistTemplateBody.safeParse({ kind: f.kind, label: f.label, items });
  if (!r.success) return { ok: false, erreurs: erreursDe(r.error.issues) };
  return { ok: true, corps: r.data };
}

export type { ChecklistTemplateItemInput };
