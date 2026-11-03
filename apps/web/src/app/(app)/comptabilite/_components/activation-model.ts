// Assistant d'activation de la comptabilité (ADR-0049 § 3.1, § 13 « Réglages »), lot K8.
// Logique pure.
//
// Cinq étapes : pack et avertissements, monnaie de tenue, bascule et reprise, règles,
// premier exercice.
// Trois modes : `off`, `simulation`, `active`. Le mode `active` reste GRISÉ, avec sa
// raison, tant que le pack n'est pas approuvé ; le serveur vérifie de toute façon
// chaque condition (`409 ACCOUNTING_ACTIVATION_PRECONDITION`, `details.missing[]`) —
// cet écran ne fait qu'annoncer ce qu'il refusera.

import {
  ACCOUNTING_ACTIVATION_MISSING_CODES,
  ACCOUNTING_MODES,
  type AccountingActivationMissingCode,
  type AccountingChartPackStatus,
  type AccountingMode,
} from '@lalanda/shared/accounting';

import type { OrgAction } from '@/lib/api';
import type {
  AccountingFiscalYearView,
  AccountingRuleSetView,
  AccountingSettingsView,
} from '@/lib/api-accounting';

import {
  EXPLICATIONS_MODE,
  LIBELLES_MODE,
  LIBELLES_STATUT_PACK,
  codeDe,
  packActivable,
  peutActiver,
  peutParametrer,
} from './comptabilite-model';

/** Phrase de chaque condition manquante, dans l'ordre de l'assistant. */
export const LIBELLES_CONDITION: Record<AccountingActivationMissingCode, string> = {
  CHART_PACK_NOT_APPROVED:
    'Choisissez un plan comptable approuvé : un plan au statut brouillon ne sert qu’à la simulation.',
  BOOK_CURRENCY_REQUIRED: 'Choisissez la monnaie de tenue (CDF ou USD).',
  CUTOVER_DATE_REQUIRED: 'Choisissez la date de bascule.',
  RULE_SET_NOT_VALIDATED: 'Validez une version des règles de correspondance.',
  EXPERT_REVIEW_NOT_DECLARED:
    'Faites la déclaration de relecture : nom de votre expert-comptable et date de sa relecture.',
  FISCAL_YEAR_NOT_OPEN: 'Ouvrez un premier exercice (étape 5).',
};

/** Conditions lues dans un refus `409 ACCOUNTING_ACTIVATION_PRECONDITION`, ordonnées. */
export function conditionsDuRefus(err: unknown): AccountingActivationMissingCode[] | null {
  if (codeDe(err) !== 'ACCOUNTING_ACTIVATION_PRECONDITION') return null;
  const detail = (err as { detail?: { details?: { missing?: unknown } } }).detail;
  const missing = detail?.details?.missing;
  if (!Array.isArray(missing)) return [];
  return ACCOUNTING_ACTIVATION_MISSING_CODES.filter((c) => missing.includes(c));
}

// ── Choix du mode ───────────────────────────────────────────────────────────

export interface OptionMode {
  mode: AccountingMode;
  libelle: string;
  explication: string;
  courant: boolean;
  desactive: boolean;
  /** Pourquoi l'option est grisée ; `null` si elle est offerte. */
  raison: string | null;
}

/**
 * Les trois modes et, pour chacun, s'il est offert. `active` est grisé tant que le pack
 * n'est pas `approved` ou `active` (raison dite avec le statut du pack), ou si
 * l'appelant n'a pas `accounting.manage` ET `fiscal.manage`.
 */
export function optionsMode(
  reglages: AccountingSettingsView | null,
  actions: readonly OrgAction[] | null,
): OptionMode[] {
  const courant = reglages?.mode ?? null;
  const statutPack: AccountingChartPackStatus | null = reglages?.chartPack?.status ?? null;
  return ACCOUNTING_MODES.map((mode) => {
    let raison: string | null = null;
    if (reglages === null) {
      raison = 'Les réglages de la comptabilité ne sont pas encore lisibles.';
    } else if (!peutParametrer(actions)) {
      raison = 'Votre rôle ne permet pas de paramétrer la comptabilité.';
    } else if (mode === 'active') {
      if (!packActivable(statutPack)) {
        raison =
          statutPack === null
            ? 'Aucun plan comptable choisi. La tenue active exige un plan approuvé.'
            : `Le plan comptable choisi n’est pas encore approuvé (statut : ${LIBELLES_STATUT_PACK[statutPack].toLowerCase()}). La tenue active reste fermée tant qu’un plan approuvé n’est pas choisi ; la simulation, elle, est possible.`;
      } else if (!peutActiver(actions)) {
        raison =
          'Activer engage l’organisation : il faut aussi le droit de gérer la fiscalité (Propriétaire ou Directeur financier).';
      }
    }
    return {
      mode,
      libelle: LIBELLES_MODE[mode],
      explication: EXPLICATIONS_MODE[mode],
      courant: courant === mode,
      desactive: raison !== null || courant === mode,
      raison,
    };
  });
}

// ── Étapes de l'assistant ───────────────────────────────────────────────────

export type EtatEtape = 'fait' | 'a-faire' | 'attente-expert';

export interface EtapeActivation {
  id: 'pack' | 'monnaie' | 'bascule' | 'regles' | 'exercice';
  numero: 1 | 2 | 3 | 4 | 5;
  titre: string;
  etat: EtatEtape;
  resume: string;
}

/** Règles en vigueur : la version validée la plus récente, sinon `null`. */
export function reglesEnVigueur(
  jeux: readonly AccountingRuleSetView[] | null,
): AccountingRuleSetView | null {
  if (jeux === null) return null;
  const validees = jeux.filter((j) => j.status === 'validated');
  if (validees.length === 0) return null;
  return validees.reduce((m, j) => (j.version > m.version ? j : m));
}

/** Nombre de règles encore « à confirmer » ou à revoir dans un jeu. */
export function reglesAConfirmer(jeu: AccountingRuleSetView): number {
  return jeu.rules.filter((r) => r.requiresReview).length;
}

/**
 * État des cinq étapes. Rien n'est déduit qui ne vienne de l'API : un jeu de règles ou
 * une liste d'exercices illisible (`null`) laisse l'étape « à faire ».
 */
export function etapesActivation(
  reglages: AccountingSettingsView,
  jeux: readonly AccountingRuleSetView[] | null,
  exercices: readonly AccountingFiscalYearView[] | null = null,
): EtapeActivation[] {
  const ouvert = exercices?.find((e) => e.status === 'open') ?? null;
  const brouillon = jeux?.find((j) => j.status === 'draft') ?? null;
  const pack = reglages.chartPack;
  const valide = reglesEnVigueur(jeux);
  const relu = valide?.validation?.expertReview?.declared === true;
  return [
    {
      id: 'pack',
      numero: 1,
      titre: 'Plan comptable et avertissements',
      etat: pack === null ? 'a-faire' : packActivable(pack.status) ? 'fait' : 'attente-expert',
      resume:
        pack === null
          ? 'Aucun plan comptable choisi.'
          : `${pack.label} (${pack.slug}, version ${pack.version}) — ${LIBELLES_STATUT_PACK[pack.status]}.`,
    },
    {
      id: 'monnaie',
      numero: 2,
      titre: 'Monnaie de tenue',
      etat: reglages.bookCurrency === null ? 'a-faire' : 'fait',
      resume:
        reglages.bookCurrency === null
          ? 'Pas encore choisie : Lalanda ne la choisit pas pour vous.'
          : `Tenue en ${reglages.bookCurrency}.`,
    },
    {
      id: 'bascule',
      numero: 3,
      titre: 'Date de bascule et reprise de l’existant',
      etat: reglages.cutoverDate === null ? 'a-faire' : 'fait',
      resume:
        reglages.cutoverDate === null
          ? 'Pas encore choisie.'
          : `Les pièces datées du ${reglages.cutoverDate} ou après sont passées en écritures.`,
    },
    {
      id: 'regles',
      numero: 4,
      titre: 'Règles de correspondance',
      etat: valide !== null && relu ? 'fait' : 'a-faire',
      resume:
        valide === null
          ? brouillon === null
            ? 'Aucune version : créez les règles depuis le plan comptable.'
            : `Version ${brouillon.version} en brouillon (${brouillon.rules.length} règles), à valider avec la déclaration de relecture.`
          : relu
            ? `Version ${valide.version} validée, déclaration de relecture faite.`
            : `Version ${valide.version} validée, sans déclaration de relecture.`,
    },
    {
      id: 'exercice',
      numero: 5,
      titre: 'Premier exercice',
      etat: ouvert !== null ? 'fait' : 'a-faire',
      resume:
        ouvert !== null
          ? `Exercice ${ouvert.year} ouvert, du ${ouvert.start} au ${ouvert.end}.`
          : 'Aucun exercice ouvert : les écritures ont besoin de leurs mois.',
    },
  ];
}

export const LIBELLES_ETAT_ETAPE: Record<EtatEtape, string> = {
  fait: 'Fait',
  'a-faire': 'À faire',
  'attente-expert': 'En attente de l’expert-comptable',
};
