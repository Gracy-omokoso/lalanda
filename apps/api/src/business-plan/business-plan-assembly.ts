// Assemblage du business plan (ADR-0037 § 1, § 2, § 7) — partie PURE.
//
// Réunit trois sources qui ne se mélangent jamais :
//
//   · le TEXTE de chaque section, écrit par l'utilisateur ou proposé par l'IA
//     puis accepté (son origine reste affichée) ;
//   · les TABLEAUX du moteur, insérés tels quels depuis les lignes du plan figé
//     (ou d'une évaluation en direct marquée brouillon) — aucune valeur n'est
//     recalculée, arrondie autrement ou réécrite ici ;
//   · les HYPOTHÈSES du plan (drivers résolus), titrées comme telles.
//
// Aucun calcul : la seule transformation d'un nombre est son rendu fr-FR, par la
// même fonction que le dossier financier (`report-html.ts`).

import { createHash } from 'node:crypto';

import { formatValue } from '../reports/report-html.js';
import {
  BUSINESS_PLAN_SECTIONS,
  type BusinessPlanSectionId,
  type SectionSpec,
} from './business-plan.sections.js';
import type { SectionOrigin } from './business-plan.schemas.js';

export type Currency = 'USD' | 'CDF' | 'XOF' | 'XAF' | 'EUR';

/** Une ligne de résultat du moteur, telle que le snapshot la porte. */
export interface EngineLine {
  sheetId: string;
  lineId: string;
  label: string;
  value: number;
  format: 'money' | 'number' | 'percent';
  seuil?: { valeur: number; direction: 'min' | 'max'; statut: 'vert' | 'orange' | 'rouge' };
}

/** Une hypothèse du plan : valeur RÉSOLUE d'un driver, saisie par l'utilisateur. */
export interface PlanHypothesis {
  id: string;
  label: string;
  value: number;
  format: 'money' | 'number' | 'percent';
  currency: Currency;
  unit: string | null;
  group: string | null;
}

/** D'où viennent les chiffres du document. */
export interface PlanSource {
  /** `frozen` : snapshot d'un plan validé ; `live` : évaluation en direct (brouillon). */
  status: 'frozen' | 'live';
  version: number | null;
  fingerprint: string | null;
  /** ISO-8601. */
  approvedAt: string | null;
  /** Une version plus récente du plan existe. */
  superseded: boolean;
  engineVersion: string | null;
  currency: Currency;
  hypotheses: PlanHypothesis[];
  lines: EngineLine[];
  /** Titres des feuilles du modèle (`feuilles[].label`). */
  sheetTitles: Record<string, string>;
  /** Message si l'évaluation en direct a échoué (tableaux absents, dit plutôt que caché). */
  error: string | null;
}

/**
 * Ce que l'assemblage lit d'une section : son texte publiable et son origine.
 * Une proposition de l'IA non tranchée n'en fait JAMAIS partie.
 */
export interface SectionInput {
  text: string;
  origin: SectionOrigin | null;
}

export interface AssembledRow {
  lineId: string;
  label: string;
  /** Valeur du moteur, INCHANGÉE. */
  value: number;
  format: EngineLine['format'];
  display: string;
  seuil?: EngineLine['seuil'] & { display: string };
}

export interface AssembledTable {
  sheetId: string;
  title: string;
  rows: AssembledRow[];
}

export interface AssembledHypothesis extends PlanHypothesis {
  display: string;
}

export interface AssembledSection {
  id: BusinessPlanSectionId;
  title: string;
  questions: readonly string[];
  text: string;
  origin: SectionOrigin | null;
  empty: boolean;
  /** Mention affichée sous un texte issu de l'IA et accepté. */
  originNote: string | null;
  tables: AssembledTable[];
  hypotheses: AssembledHypothesis[] | null;
}

export const NOTE_IA_ACCEPTEE = 'Rédaction assistée par l’IA, relue et acceptée.';
export const SECTION_VIDE = 'Section non renseignée.';
export const TITRE_HYPOTHESES = 'Hypothèses retenues (saisies, non des résultats)';
export const MENTION_TABLEAUX =
  'Tableaux calculés par le moteur financier de Lalanda, insérés sans modification.';

function seuilDisplay(l: EngineLine, currency: Currency): string {
  if (!l.seuil) return '';
  const sens = l.seuil.direction === 'min' ? '≥' : '≤';
  return `seuil ${sens} ${formatValue(l.seuil.valeur, l.format, currency)}`;
}

/** Tableau d'une feuille du moteur, lignes dans l'ordre du snapshot. */
export function tableOf(sheetId: string, source: PlanSource): AssembledTable | null {
  const rows = source.lines
    .filter((l) => l.sheetId === sheetId)
    .map<AssembledRow>((l) => ({
      lineId: l.lineId,
      label: l.label,
      value: l.value,
      format: l.format,
      display: formatValue(l.value, l.format, source.currency),
      ...(l.seuil ? { seuil: { ...l.seuil, display: seuilDisplay(l, source.currency) } } : {}),
    }));
  if (rows.length === 0) return null;
  return { sheetId, title: source.sheetTitles[sheetId] ?? sheetId, rows };
}

export function hypothesesOf(source: PlanSource): AssembledHypothesis[] {
  return source.hypotheses.map((h) => ({
    ...h,
    display: `${formatValue(h.value, h.format, h.currency)}${h.unit ? ` ${h.unit}` : ''}`,
  }));
}

function assembleSection(
  spec: SectionSpec,
  input: SectionInput | undefined,
  source: PlanSource,
): AssembledSection {
  const text = (input?.text ?? '').trim();
  const origin = text === '' ? null : (input?.origin ?? 'user');
  return {
    id: spec.id,
    title: spec.title,
    questions: spec.questions,
    text,
    origin,
    empty: text === '',
    originNote: origin === 'ai_accepted' ? NOTE_IA_ACCEPTEE : null,
    tables: spec.engineSheets
      .map((s) => tableOf(s, source))
      .filter((t): t is AssembledTable => t !== null),
    hypotheses: spec.showsHypotheses ? hypothesesOf(source) : null,
  };
}

/** Les neuf sections, dans l'ordre fixe, texte et tableaux réunis. */
export function assembleSections(
  sections: Partial<Record<BusinessPlanSectionId, SectionInput>>,
  source: PlanSource,
): AssembledSection[] {
  return BUSINESS_PLAN_SECTIONS.map((spec) => assembleSection(spec, sections[spec.id], source));
}

/**
 * Empreinte du CONTENU publiable : textes et origines des neuf sections, plan
 * rattaché. Les propositions IA non tranchées n'en font pas partie — elles ne
 * sont pas publiées.
 */
export function contentSha256(
  sections: Partial<Record<BusinessPlanSectionId, { text: string; origin: SectionOrigin | null }>>,
  plan: { version: number | null; fingerprint: string | null },
): string {
  const canonique = {
    sections: BUSINESS_PLAN_SECTIONS.map((s) => {
      const text = (sections[s.id]?.text ?? '').trim();
      return [s.id, text, text === '' ? null : (sections[s.id]?.origin ?? 'user')];
    }),
    plan: [plan.version, plan.fingerprint],
  };
  return createHash('sha256').update(JSON.stringify(canonique)).digest('hex');
}

/** Sections portant une proposition de l'IA non tranchée. */
export function pendingProposals(
  sections: Partial<Record<BusinessPlanSectionId, { proposal?: unknown }>>,
): BusinessPlanSectionId[] {
  return BUSINESS_PLAN_SECTIONS.filter((s) => {
    const p = sections[s.id]?.proposal;
    return p !== undefined && p !== null;
  }).map((s) => s.id);
}

/** Libellé du plan rattaché, cité en page de garde et en pied de page. */
export function planLabel(source: PlanSource): string {
  if (source.status === 'frozen' && source.version !== null) {
    const date = source.approvedAt
      ? new Intl.DateTimeFormat('fr-FR', {
          day: '2-digit',
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC',
        }).format(new Date(source.approvedAt))
      : '';
    return `Plan financier validé v${source.version}${date ? ` du ${date}` : ''}`;
  }
  return 'Plan financier non validé (BROUILLON) — chiffres recalculés à chaque affichage';
}
