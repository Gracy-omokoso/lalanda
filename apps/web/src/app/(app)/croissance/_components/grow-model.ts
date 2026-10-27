// Logique pure de l'espace Croissance (GROW — ADR-0032).
//
// Isolée du rendu pour être testable (vitest en environnement `node`, sans DOM).
// Deux règles :
//
// 1. AUCUN CALCUL. Score, indicateurs, risques, actions et étape viennent du
//    moteur par l'API ; ce module les MET EN FORME (libellés, nombres affichés à
//    la française) et ne refait aucune opération.
// 2. RIEN N'AUTORISE. Masquer un bouton est un confort : l'API refuse de toute
//    façon (permissions, forfait).

import type { OrgAction } from '@/lib/api';
import type {
  ConditionState,
  GrowIndicator,
  GrowIndicatorCode,
  JourneyStage,
  RiskSeverity,
} from '@/lib/grow-api';

export const CROISSANCE_BASE = '/croissance';

export interface GrowTab {
  segment: 'sante' | 'investisseurs' | 'parcours';
  label: string;
}

/** Ordre d'affichage. Les trois onglets exigent `analytics.read` (tous les rôles). */
export const GROW_TABS: readonly GrowTab[] = [
  { segment: 'sante', label: 'Santé' },
  { segment: 'investisseurs', label: 'Indicateurs investisseurs' },
  { segment: 'parcours', label: 'Parcours' },
];

/** Premier segment sous `/croissance/` — '' sur la racine. */
export function segmentCroissance(pathname: string): string {
  if (pathname !== CROISSANCE_BASE && !pathname.startsWith(`${CROISSANCE_BASE}/`)) return '';
  return pathname.slice(CROISSANCE_BASE.length).split('/').filter(Boolean)[0] ?? '';
}

/** Droits d'écriture affichés (l'API reste seule juge). */
export function droitsCroissance(actions: readonly OrgAction[] | null): {
  declarer: boolean;
  declarerTresorerie: boolean;
} {
  return {
    declarer: actions !== null && actions.includes('inputs.update'),
    declarerTresorerie: actions !== null && actions.includes('actuals.import'),
  };
}

// ─── Erreurs ────────────────────────────────────────────────────────────────

interface ApiError {
  status?: number;
  detail?: unknown;
  message?: string;
}

/** Refus de forfait (403 PLAN_FEATURE_UNAVAILABLE) : message du serveur, sinon `null`. */
export function refusForfait(err: unknown): string | null {
  const e = err as ApiError;
  const d = e?.detail as { code?: unknown; message?: unknown } | undefined;
  if (e?.status === 403 && d?.code === 'PLAN_FEATURE_UNAVAILABLE') {
    return typeof d.message === 'string' ? d.message : 'Fonction non incluse dans votre offre.';
  }
  return null;
}

/** Message lisible d'une erreur d'API. */
export function messageErreur(err: unknown, defaut: string): string {
  const e = err as ApiError;
  const d = e?.detail as { message?: unknown; details?: { issues?: { message?: string }[] } };
  const issue = d?.details?.issues?.[0]?.message;
  if (typeof issue === 'string') return issue;
  if (typeof d?.message === 'string') return d.message;
  if (e?.status === 403) return 'Votre rôle ne permet pas cette action.';
  return defaut;
}

// ─── Mise en forme ──────────────────────────────────────────────────────────

const NOMBRE = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const POURCENT = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 });
const MOIS = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

/** Ratio servi en fraction (`0.05`) → « 5 % ». */
export function formatRatio(v: number): string {
  return POURCENT.format(v);
}

export function formatMontant(v: number, devise: string | null): string {
  return devise ? `${NOMBRE.format(v)} ${devise}` : NOMBRE.format(v);
}

/** Valeur affichée d'un indicateur disponible ; « — » sinon. */
export function valeurIndicateur(ind: GrowIndicator): string {
  if (!ind.disponible) return '—';
  switch (ind.unite) {
    case 'ratio':
      return formatRatio(ind.valeur);
    case 'mois':
      return `${MOIS.format(ind.valeur)} mois`;
    case 'montant':
      return formatMontant(ind.valeur, ind.devise);
  }
}

/** Ordre et regroupement de la page « Indicateurs investisseurs ». */
export const GROUPES_INDICATEURS: readonly { titre: string; codes: GrowIndicatorCode[] }[] = [
  { titre: 'Revenus récurrents', codes: ['mrr', 'arr'] },
  { titre: 'Trésorerie', codes: ['burn_rate', 'runway'] },
  { titre: 'Croissance', codes: ['croissance_ventes', 'croissance_ca_realise'] },
  { titre: 'Rentabilité', codes: ['marge_brute', 'marge_nette'] },
  { titre: 'Clients', codes: ['concentration_clients', 'clients_revenants'] },
];

const SOURCES: Readonly<Record<string, string>> = {
  'build.actuals': 'Réalisé (BUILD)',
  'run.sales': 'Ventes (RUN)',
  'grow.declared_cash': 'Déclaration (hypothèse)',
  'treasury.accounts': 'Comptes de trésorerie',
};

export function libelleSource(source: string): string {
  return SOURCES[source] ?? source;
}

const GRAVITES: Readonly<Record<RiskSeverity, string>> = {
  critique: 'Critique',
  haute: 'Élevée',
  moyenne: 'Moyenne',
  faible: 'Faible',
};

export function libelleGravite(g: RiskSeverity): string {
  return GRAVITES[g];
}

const ETATS: Readonly<Record<ConditionState, string>> = {
  remplie: 'Remplie',
  non_remplie: 'Non remplie',
  inconnue: 'Inconnue (donnée absente)',
};

export function libelleEtat(e: ConditionState): string {
  return ETATS[e];
}

export const LIBELLES_ETAPES: Readonly<Record<JourneyStage, string>> = {
  IDEA: 'Idée',
  VALIDATION: 'Validation',
  MVP: 'Offre minimale (MVP)',
  FIRST_CUSTOMER: 'Premiers clients',
  PMF: 'Adéquation produit-marché',
  GROWTH: 'Croissance',
  SCALE: 'Passage à l’échelle',
  FUNDRAISING: 'Levée de fonds',
};

/** Appréciation écrite d'une note 0–100 (le texte porte l'information, pas la couleur). */
export function appreciation(note: number): { texte: string; ton: 'ok' | 'warn' | 'ko' } {
  if (note >= 70) return { texte: 'Solide', ton: 'ok' };
  if (note >= 40) return { texte: 'À surveiller', ton: 'warn' };
  return { texte: 'Fragile', ton: 'ko' };
}

// ─── Saisie du solde déclaré ────────────────────────────────────────────────

/**
 * Montant saisi → chaîne décimale canonique (virgule acceptée), ou un message.
 * Contrôle de FORME seulement, par manipulation de chaîne, sans conversion numérique.
 */
export function lireMontant(
  saisie: string,
): { ok: true; valeur: string } | { ok: false; message: string } {
  const brut = saisie.replace(/[\s  ]/g, '').replace(',', '.');
  if (!/^\d{1,15}(\.\d{1,2})?$/.test(brut)) {
    return { ok: false, message: 'Montant positif, deux décimales au plus (ex. 1 250,00).' };
  }
  const [ent, dec = ''] = brut.split('.');
  return { ok: true, valeur: `${ent!.replace(/^0+(?=\d)/, '')}.${dec.padEnd(2, '0')}` };
}
