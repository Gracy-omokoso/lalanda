// Règles de correspondance et premier exercice (ADR-0049 § 2.4, § 2.7, § 3.1, § 13).
// Logique pure, testée sans DOM.
//
// - Un brouillon naît des règles PROPOSÉES du pack choisi (ou de la version validée) :
//   `POST /accounting/rule-sets`. Un seul brouillon à la fois (409 `RULE_SET_DRAFT_EXISTS`).
// - Après un changement de pack, le brouillon se REPREND : ses règles sont remplacées par
//   celles du pack choisi (`PUT`), même passage que côté serveur (`requiresReview` si le
//   pack la dit « à revoir » ou « à confirmer »).
// - Une règle « à revoir » n'est jamais appliquée : son opération va au compte d'attente
//   désigné par le pack, avec son motif (`note` du pack). Aucun numéro n'est écrit ici.
// - Valider exige la déclaration de relecture (case, nom, date) : Lalanda l'enregistre
//   sans la vérifier (décision ouverte n° 6).

import type { OrgAction } from '@/lib/api';
import type {
  AccountingChartPackDetail,
  AccountingFiscalYearView,
  AccountingRuleInput,
  AccountingRuleSetView,
  AccountingSettingsView,
} from '@/lib/api-accounting';

import { peutCloturer, peutParametrer } from './comptabilite-model';

/** Le brouillon en cours (au plus un), sinon `null`. */
export function brouillonDe(
  jeux: readonly AccountingRuleSetView[] | null,
): AccountingRuleSetView | null {
  return jeux?.find((j) => j.status === 'draft') ?? null;
}

// ── Règles proposées par le pack ────────────────────────────────────────────

const chaines = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** Règles proposées du pack, sous la forme d'un `PUT` (même passage que le serveur). */
export function reglesProposees(pack: AccountingChartPackDetail): AccountingRuleInput[] {
  return pack.proposedRules
    .filter((r) => typeof r['key'] === 'string')
    .map((r) => ({
      key: r['key'] as string,
      debit: chaines(r['debit']),
      credit: chaines(r['credit']),
      requiresReview: r['requiresReview'] === true || r['confirmation'] === 'to_confirm',
    }));
}

/** Motif de chaque règle proposée, par clé (`note` du pack). */
export function motifsDuPack(pack: AccountingChartPackDetail | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of pack?.proposedRules ?? []) {
    if (typeof r['key'] === 'string' && typeof r['note'] === 'string' && r['note'] !== '') {
      out.set(r['key'], r['note']);
    }
  }
  return out;
}

/** Phrase du compte d'attente désigné par le pack (§ 6.0), sans numéro écrit en dur. */
export function phraseAttente(pack: AccountingChartPackDetail | null): string {
  return pack?.suspenseAccount
    ? `au compte d’attente ${pack.suspenseAccount}`
    : 'au compte d’attente technique';
}

/**
 * Le brouillon doit-il être repris depuis le pack choisi ? Raison dite, ou `null`.
 * Cas : brouillon né d'un autre pack (changement de pack), ou brouillon vide alors que le
 * pack choisi propose des règles.
 */
export function repriseDuBrouillon(
  brouillon: AccountingRuleSetView | null,
  reglages: AccountingSettingsView | null,
  nbProposees: number | null,
): string | null {
  const pack = reglages?.chartPack ?? null;
  if (brouillon === null || pack === null) return null;
  const base = brouillon.basedOn;
  if (base !== null && (base.packSlug !== pack.slug || base.packVersion !== pack.version)) {
    return `Ce brouillon est né du plan ${base.packSlug}, version ${base.packVersion}. Le plan choisi est maintenant la version ${pack.version} : reprenez ses règles proposées avant de valider.`;
  }
  if (brouillon.rules.length === 0 && nbProposees !== null && nbProposees > 0) {
    return `Ce brouillon est vide alors que le plan choisi propose ${nbProposees} règles : reprenez-les avant de valider.`;
  }
  return null;
}

// ── Droits ──────────────────────────────────────────────────────────────────

export interface ActionsRegles {
  /** Créer un brouillon est offert. */
  creer: boolean;
  /**
   * Bouton de création : depuis le plan (aucune version validée) ou nouvelle version,
   * copie de la version validée (ce que fait le serveur).
   */
  libelleCreer: string;
  /** Le brouillon se modifie et se valide. */
  modifier: boolean;
  /** Pourquoi rien n'est offert ; `null` si c'est offert ou sans objet. */
  raison: string | null;
}

export function actionsRegles(
  reglages: AccountingSettingsView | null,
  jeux: readonly AccountingRuleSetView[] | null,
  actions: readonly OrgAction[] | null,
): ActionsRegles {
  const libelleCreer = jeux?.some((j) => j.status === 'validated')
    ? 'Préparer une nouvelle version (copie de la version validée)'
    : 'Créer les règles depuis le plan comptable';
  if (jeux === null || reglages === null) {
    return { creer: false, modifier: false, raison: null, libelleCreer };
  }
  const brouillon = brouillonDe(jeux);
  if (!peutParametrer(actions)) {
    return {
      creer: false,
      modifier: false,
      raison: 'Votre rôle ne permet pas de créer, modifier ou valider les règles.',
      libelleCreer,
    };
  }
  if (brouillon === null && reglages.chartPack === null) {
    return {
      creer: false,
      modifier: false,
      raison: 'Choisissez d’abord un plan comptable : les règles en viennent.',
      libelleCreer,
    };
  }
  return { creer: brouillon === null, modifier: brouillon !== null, raison: null, libelleCreer };
}

// ── Modification d'une règle du brouillon ───────────────────────────────────

/** « 1X1, {customer} » → `['1X1', '{customer}']` (virgules, points-virgules ou espaces). */
export function lireComptes(texte: string): string[] {
  return texte
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter((t) => t !== '');
}

export type RetourRegle =
  { ok: true; regles: AccountingRuleInput[] } | { ok: false; erreur: string };

/**
 * Remplace débit, crédit et « à revoir » d'une règle ; les autres règles et la liste des
 * clés ne changent pas. Le plan est vérifié par le serveur (`RULE_ACCOUNT_NOT_IN_CHART`).
 */
export function remplacerRegle(
  regles: readonly AccountingRuleInput[],
  cle: string,
  saisie: { debit: string; credit: string; aRevoir: boolean },
): RetourRegle {
  if (!regles.some((r) => r.key === cle)) return { ok: false, erreur: 'Règle introuvable.' };
  const debit = lireComptes(saisie.debit);
  const credit = lireComptes(saisie.credit);
  if (debit.length > 5 || credit.length > 5) {
    return { ok: false, erreur: 'Cinq comptes au plus au débit et au crédit.' };
  }
  if (!saisie.aRevoir && debit.length === 0 && credit.length === 0) {
    return {
      ok: false,
      erreur: 'Indiquez au moins un compte, ou laissez la règle « à revoir ».',
    };
  }
  return {
    ok: true,
    regles: regles.map((r) =>
      r.key === cle ? { key: r.key, debit, credit, requiresReview: saisie.aRevoir } : { ...r },
    ),
  };
}

// ── Validation avec déclaration de relecture ────────────────────────────────

export interface SaisieRelecture {
  coche: boolean;
  nom: string;
  /** `AAAA-MM-JJ`. */
  date: string;
  note: string;
}

export interface CorpsValidation {
  expectedRevision: number;
  expertReview: { declared: true; name: string; date: string; note: string | null };
}

export type RetourValidation = { ok: true; corps: CorpsValidation } | { ok: false; erreur: string };

/** Corps de `POST /accounting/rule-sets/:version/validate`, ou la phrase qui manque. */
export function corpsValidation(
  revision: number,
  saisie: SaisieRelecture,
  aujourdhui: string,
): RetourValidation {
  if (!saisie.coche) {
    return {
      ok: false,
      erreur: 'Cochez la case : les règles ont été relues par votre expert-comptable.',
    };
  }
  const nom = saisie.nom.trim();
  if (nom === '') return { ok: false, erreur: 'Indiquez le nom de votre expert-comptable.' };
  if (nom.length > 120) return { ok: false, erreur: 'Le nom tient en 120 caractères.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(saisie.date)) {
    return { ok: false, erreur: 'Indiquez la date de sa relecture.' };
  }
  if (saisie.date > aujourdhui) {
    return { ok: false, erreur: 'La date de relecture ne peut pas être dans le futur.' };
  }
  const note = saisie.note.trim();
  return {
    ok: true,
    corps: {
      expectedRevision: revision,
      expertReview: {
        declared: true,
        name: nom,
        date: saisie.date,
        note: note === '' ? null : note,
      },
    },
  };
}

// ── Premier exercice (§ 2.7, condition `FISCAL_YEAR_NOT_OPEN`) ──────────────

/**
 * Exercice à proposer quand aucun n'est ouvert : celui qui contient la date de bascule
 * (sinon aujourd'hui), selon le mois de début d'exercice ; le suivant du dernier si des
 * exercices existent déjà, tous clos. L'exercice `N` commence le
 * premier jour du mois de début de l'année `N` (même découpage que le serveur).
 * `null` : un exercice est déjà ouvert.
 */
export function exerciceAProposer(
  reglages: AccountingSettingsView,
  exercices: readonly AccountingFiscalYearView[],
  aujourdhui: string,
): number | null {
  if (exercices.some((e) => e.status === 'open')) return null;
  // Des exercices existent, tous clos ou en clôture : le suivant.
  if (exercices.length > 0) return Math.max(...exercices.map((e) => e.year)) + 1;
  const jour = reglages.cutoverDate ?? aujourdhui;
  const annee = Number(jour.slice(0, 4));
  const mois = Number(jour.slice(5, 7));
  return mois >= reglages.fiscalYearStartMonth ? annee : annee - 1;
}

export interface ActionExercice {
  offert: boolean;
  raison: string | null;
}

export function actionOuvrirExercice(actions: readonly OrgAction[] | null): ActionExercice {
  return peutCloturer(actions)
    ? { offert: true, raison: null }
    : {
        offert: false,
        raison:
          'Ouvrir un exercice demande le droit de clôturer (Propriétaire, Directeur financier ou Comptable).',
      };
}

/** Jour civil de Kinshasa (`AAAA-MM-JJ`) d'un instant. */
export function jourDe(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Kinshasa',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}
