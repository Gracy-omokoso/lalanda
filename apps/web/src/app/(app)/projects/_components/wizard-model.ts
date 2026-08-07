// Logique pure du wizard de saisie (S18c) — aucune dépendance React, testable seule.
//
// Deux responsabilités :
//  1. découper les drivers du template en étapes ordonnées (miroir de `resolveEtapes`
//     du moteur, que le web ne peut pas importer : @lalanda/web ne dépend pas de
//     @lalanda/engine — voir apps/web/package.json);
//  2. valider les saisies sur trois niveaux (bloquant / avertissement / information)
//     conformément à docs/06-WIZARD.md.
//
// Règle importante : ce module ne calcule RIEN de financier. Le moteur reste la seule
// source de vérité des calculs (brief §3-1, CLAUDE.md).

import type { TemplateDriverMeta, TemplateMeta } from '@/lib/api';

/** Groupe virtuel qui porte tous les drivers quand le template ne déclare aucun groupe. */
export const GROUPE_TOUS = '_all';
/** Étape virtuelle finale — récapitulatif et validation, ne porte aucun driver. */
export const ETAPE_SYNTHESE = '_synthese';

export interface WizardStep {
  id: string;
  label: string;
  description?: string;
  /** Drivers saisis à cette étape, dans l'ordre de déclaration du template. */
  drivers: TemplateDriverMeta[];
  /** `true` pour l'étape finale de synthèse (aucun champ à saisir). */
  synthese?: boolean;
}

// ─── Découpage en étapes ──────────────────────────────────────

interface ResolvedEtape {
  id: string;
  label: string;
  description?: string;
  groupes: string[];
}

/**
 * Résout les étapes déclarées par le template, avec les mêmes règles que le moteur :
 * tri par `ordre` (les étapes sans `ordre` restent dans l'ordre de déclaration et
 * passent en dernier), puis ajout en fin de liste des groupes non rattachés.
 */
function resolveEtapes(template: TemplateMeta): ResolvedEtape[] {
  const groupes = template.groupes_hypotheses ?? [];
  const declared = template.wizard?.etapes ?? [];

  if (declared.length === 0) {
    if (groupes.length === 0) {
      return [{ id: 'hypotheses', label: 'Hypothèses', groupes: [GROUPE_TOUS] }];
    }
    return groupes.map((g) => ({ id: g.id, label: g.label, groupes: [g.id] }));
  }

  const ordered = declared
    .map((e, index) => ({ e, index }))
    .sort((a, b) => {
      const oa = a.e.ordre ?? Number.POSITIVE_INFINITY;
      const ob = b.e.ordre ?? Number.POSITIVE_INFINITY;
      return oa === ob ? a.index - b.index : oa - ob;
    })
    .map(({ e }) => ({
      id: e.id,
      label: e.label,
      ...(e.description === undefined ? {} : { description: e.description }),
      groupes: [...e.groupes],
    }));

  const couverts = new Set(ordered.flatMap((e) => e.groupes));
  const orphelins = groupes.filter((g) => !couverts.has(g.id));
  return [...ordered, ...orphelins.map((g) => ({ id: g.id, label: g.label, groupes: [g.id] }))];
}

/**
 * Construit les étapes affichables du wizard : les étapes du DSL peuplées de leurs
 * drivers, puis — le cas échéant — une étape « Autres » pour les drivers dont le
 * groupe est absent ou inconnu, et enfin l'étape de synthèse.
 *
 * Une étape sans aucun driver est écartée (un groupe peut être vide après une
 * évolution du template) ; la synthèse est toujours présente.
 */
export function buildWizardSteps(template: TemplateMeta): WizardStep[] {
  const etapes = resolveEtapes(template);
  const parGroupe = new Map<string, TemplateDriverMeta[]>();
  const connus = new Set((template.groupes_hypotheses ?? []).map((g) => g.id));

  for (const d of template.drivers) {
    const cle = d.groupe && connus.has(d.groupe) ? d.groupe : GROUPE_TOUS;
    const bucket = parGroupe.get(cle);
    if (bucket) bucket.push(d);
    else parGroupe.set(cle, [d]);
  }

  const steps: WizardStep[] = [];
  const places = new Set<string>();
  for (const e of etapes) {
    const drivers = e.groupes.flatMap((g) => parGroupe.get(g) ?? []);
    if (drivers.length === 0) continue;
    for (const d of drivers) places.add(d.id);
    steps.push({
      id: e.id,
      label: e.label,
      ...(e.description === undefined ? {} : { description: e.description }),
      drivers,
    });
  }

  // Filet de sécurité : aucun driver ne doit disparaître du parcours de saisie.
  const restants = template.drivers.filter((d) => !places.has(d.id));
  if (restants.length > 0) {
    steps.push({ id: '_autres', label: 'Autres hypothèses', drivers: restants });
  }

  steps.push({
    id: ETAPE_SYNTHESE,
    label: 'Synthèse',
    description: 'Relisez vos hypothèses, puis validez le plan.',
    drivers: [],
    synthese: true,
  });
  return steps;
}

// ─── Conversion saisie ↔ valeur stockée ───────────────────────

export function isPercentDriver(d: TemplateDriverMeta): boolean {
  return d.type === 'percent';
}

/**
 * Convertit la valeur stockée (fraction pour les pourcentages) en texte d'affichage.
 * Les pourcentages sont saisis en points (40) et stockés en fraction (0.4).
 */
export function toDisplayString(d: TemplateDriverMeta, stored: number): string {
  const display = isPercentDriver(d) ? stored * 100 : stored;
  // Arrondi de sûreté : 0.07 * 100 vaut 7.000000000000001 en flottant.
  return String(Math.round(display * 1e6) / 1e6);
}

/** Borne min/max exprimée dans l'unité de saisie (points pour un pourcentage). */
export function displayBound(d: TemplateDriverMeta, bound: number): number {
  return isPercentDriver(d) ? bound * 100 : bound;
}

/**
 * Convertit un texte saisi en valeur stockée. Renvoie `null` si le texte est vide ou
 * n'est pas un nombre fini — AUCUN écrêtage sur min/max : une valeur hors bornes est
 * conservée telle quelle et signalée par {@link validateDriver} (docs/06-WIZARD.md :
 * « les erreurs bloquantes empêchent la validation, pas la sauvegarde »).
 */
export function parseInput(d: TemplateDriverMeta, raw: string): number | null {
  const trimmed = raw.trim().replace(',', '.');
  if (trimmed === '') return null;
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return isPercentDriver(d) ? parsed / 100 : parsed;
}

// ─── Validation à trois niveaux ───────────────────────────────

export type IssueLevel = 'error' | 'warning';

export interface FieldIssue {
  level: IssueLevel;
  message: string;
}

/** Part de l'intervalle [min, max] considérée comme « proche d'une borne ». */
const MARGE_ATYPIQUE = 0.05;

function formatBound(d: TemplateDriverMeta, bound: number): string {
  const value = displayBound(d, bound);
  const suffix = isPercentDriver(d) ? ' %' : d.unite ? ` ${d.unite}` : '';
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 4 }).format(value)}${suffix}`;
}

/**
 * Valide une saisie et renvoie au plus un problème, le niveau le plus fort d'abord.
 *
 * - **bloquant** : champ vide, texte non numérique, valeur hors `min`/`max` du DSL;
 * - **avertissement** : valeur atypique, c'est-à-dire dans les 5 % extrêmes de
 *   l'intervalle autorisé (ou exactement sur une borne quand une seule est déclarée);
 * - **information** : `aide` du driver, affichée en permanence par le composant de
 *   champ — elle ne dépend pas de la valeur et ne transite donc pas par cette fonction.
 */
export function validateDriver(d: TemplateDriverMeta, raw: string): FieldIssue | null {
  if (raw.trim() === '') {
    return { level: 'error', message: 'Valeur requise pour calculer le plan.' };
  }
  const value = parseInput(d, raw);
  if (value === null) {
    return { level: 'error', message: 'Saisissez un nombre (ex. 1250 ou 12,5).' };
  }
  if (d.min !== undefined && value < d.min) {
    return { level: 'error', message: `Valeur trop basse — minimum ${formatBound(d, d.min)}.` };
  }
  if (d.max !== undefined && value > d.max) {
    return { level: 'error', message: `Valeur trop haute — maximum ${formatBound(d, d.max)}.` };
  }

  if (d.min !== undefined && d.max !== undefined && d.max > d.min) {
    const marge = (d.max - d.min) * MARGE_ATYPIQUE;
    if (value <= d.min + marge) {
      return {
        level: 'warning',
        message: `Valeur inhabituellement basse (minimum ${formatBound(d, d.min)}) — à vérifier.`,
      };
    }
    if (value >= d.max - marge) {
      return {
        level: 'warning',
        message: `Valeur inhabituellement haute (maximum ${formatBound(d, d.max)}) — à vérifier.`,
      };
    }
    return null;
  }
  if (d.min !== undefined && value === d.min) {
    return { level: 'warning', message: `Valeur à la borne minimale (${formatBound(d, d.min)}).` };
  }
  if (d.max !== undefined && value === d.max) {
    return { level: 'warning', message: `Valeur à la borne maximale (${formatBound(d, d.max)}).` };
  }
  return null;
}

// ─── Agrégation par étape ─────────────────────────────────────

export type StepStatus = 'error' | 'warning' | 'ok';

export interface StepDiagnostic {
  errors: string[];
  warnings: string[];
  status: StepStatus;
}

/** Compte les problèmes bloquants et les avertissements d'une étape. */
export function diagnoseStep(step: WizardStep, raw: Record<string, string>): StepDiagnostic {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const d of step.drivers) {
    const issue = validateDriver(d, raw[d.id] ?? '');
    if (issue?.level === 'error') errors.push(d.id);
    else if (issue?.level === 'warning') warnings.push(d.id);
  }
  const status: StepStatus = errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'ok';
  return { errors, warnings, status };
}

/** Ids des drivers en erreur bloquante sur l'ensemble du wizard. */
export function blockingDriverIds(steps: WizardStep[], raw: Record<string, string>): string[] {
  return steps.flatMap((s) => diagnoseStep(s, raw).errors);
}

/**
 * Construit l'état texte initial des champs à partir des valeurs stockées.
 * Les drivers absents retombent sur leur `defaut` DSL, puis sur 0.
 */
export function initialRawValues(
  drivers: TemplateDriverMeta[],
  values: Record<string, number>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of drivers) {
    out[d.id] = toDisplayString(d, values[d.id] ?? d.defaut ?? 0);
  }
  return out;
}
