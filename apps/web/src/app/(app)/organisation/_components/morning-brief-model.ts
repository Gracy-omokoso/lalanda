// Logique pure de l'écran « Brief du matin » (ADR-0033).
//
// Aucun calcul ici : les valeurs viennent du moteur, déjà agrégées. Ce module
// les MET EN FORME (français, devise, statut écrit en toutes lettres) et décide
// de ce que dit l'écran quand une valeur manque. Un fait inconnu n'est jamais
// affiché comme zéro.

import type {
  BriefAnswerView,
  BriefFactView,
  BriefRuleOutcomeView,
  BriefSeverity,
  BriefThresholdView,
  MorningBriefData,
  MorningBriefView,
} from '@/lib/morning-brief-api';

const STATUTS: Record<Exclude<BriefFactView['status'], 'known'>, string> = {
  to_fill: 'À renseigner',
  unavailable: 'Non disponible',
  hidden: 'Masqué pour votre rôle',
};

/** « 1 250 000,00 » depuis une chaîne décimale canonique, sans passer par un flottant. */
export function formatDecimalFr(decimal: string): string {
  const negatif = decimal.startsWith('-');
  const [entier = '0', fraction = ''] = (negatif ? decimal.slice(1) : decimal).split('.');
  const groupe = entier.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${negatif ? '−' : ''}${groupe}${fraction ? `,${fraction}` : ''}`;
}

export function valeurFait(f: BriefFactView): string {
  if (f.status !== 'known' || f.value === null) {
    return f.status === 'known' ? STATUTS.unavailable : STATUTS[f.status];
  }
  if (f.kind === 'amount') return `${formatDecimalFr(f.value)} ${f.currency ?? ''}`.trim();
  return f.value;
}

export function fait(brief: MorningBriefData, id: string): BriefFactView | undefined {
  return brief.facts.find((f) => f.id === id);
}

/** Faits d'un indicateur par devise (`ca_mois.CDF`, `ca_mois.USD`), ou le fait de statut seul. */
export function faitsParDevise(brief: MorningBriefData, prefixe: string): BriefFactView[] {
  const exact = fait(brief, prefixe);
  if (exact) return [exact];
  return ['CDF', 'USD']
    .map((c) => fait(brief, `${prefixe}.${c}`))
    .filter((f): f is BriefFactView => f !== undefined);
}

/**
 * Lignes d'une tuile multi-devises. Une devise à zéro est omise QUAND une autre
 * porte un montant : « 0,00 USD » sous un chiffre d'affaires en CDF n'apprend
 * rien. Si toutes sont à zéro, on garde la première — zéro est alors l'information.
 */
export function lignesTuile(faits: BriefFactView[]): string[] {
  const zero = (f: BriefFactView): boolean =>
    f.status === 'known' && f.value !== null && /^-?0+(\.0+)?$/.test(f.value);
  const utiles = faits.filter((f) => !zero(f));
  return (utiles.length > 0 ? utiles : faits.slice(0, 1)).map(valeurFait);
}

export const TUILES: readonly { titre: string; prefixe: string; aide: string }[] = [
  {
    titre: 'Chiffre d’affaires HT du mois',
    prefixe: 'ca_mois',
    aide: 'Factures de vente émises ce mois, moins les avoirs ; hors TVA, débours, consignations et taxes.',
  },
  {
    titre: 'Trésorerie disponible',
    prefixe: 'tresorerie',
    aide: 'Total des soldes de vos comptes de trésorerie (caisse, banque, mobile money). À renseigner tant qu’aucun compte n’est ouvert.',
  },
  {
    titre: 'Créances à encaisser',
    prefixe: 'creances',
    aide: 'Reste à encaisser de vos factures à crédit : avoirs et encaissements enregistrés déjà déduits.',
  },
  {
    titre: 'Échéances dépassées',
    prefixe: 'echeances.depassees',
    aide: 'Factures dont l’échéance est passée et qui ne sont pas entièrement réglées.',
  },
];

/** Les trois compteurs d'anomalies de normalisation, chacun avec son libellé. */
export const ANOMALIES: readonly string[] = [
  'normalisation.echec',
  'normalisation.a_verifier',
  'normalisation.attente_longue',
];

export function libelleGravite(g: BriefSeverity): string {
  return g === 'critique' ? 'Critique' : g === 'attention' ? 'À surveiller' : 'Information';
}

const UNITES: Record<BriefThresholdView['unit'], (v: number) => string> = {
  facture: (v) => `${v} facture${v > 1 ? 's' : ''}`,
  heures: (v) => `${v} h`,
  jours: (v) => `${v} jours`,
  jour_du_mois: (v) => `${v}ᵉ jour du mois`,
};

export function libelleSeuil(t: BriefThresholdView | null): string | null {
  if (!t) return null;
  return `Seuil ${t.id} : ${UNITES[t.unit](t.value)} — paramètre à valider`;
}

/** Libellés des faits cités par une règle, pour la mention « Source ». */
export function sourcesRegle(brief: MorningBriefData, r: BriefRuleOutcomeView): string[] {
  return r.factIds.map((id) => fait(brief, id)?.label ?? id);
}

export function provenance(a: BriefAnswerView): string {
  if (a.source === 'llm') {
    return a.cached
      ? 'Rédigé par l’IA plus tôt aujourd’hui — chiffres vérifiés'
      : 'Rédigé par l’IA — chiffres vérifiés';
  }
  switch (a.reason) {
    case 'desactivee_plateforme':
      return 'Lecture automatique — IA désactivée par Lalanda';
    case 'desactivee_organisation':
      return 'Lecture automatique — IA désactivée pour votre organisation';
    case 'rejetee':
      return 'Lecture automatique — la réponse de l’IA citait un chiffre non vérifiable';
    default:
      return 'Lecture automatique — IA indisponible';
  }
}

export function resumeQuota(q: MorningBriefView['ai']['quota']): string | null {
  if (!q) return null;
  if (q.unlimited) return 'Messages IA illimités avec votre offre.';
  if (q.exceeded) {
    return `Quota de messages IA du mois atteint ; il se renouvelle dans ${q.resetInDays} jour${q.resetInDays > 1 ? 's' : ''}.`;
  }
  return `${q.remaining ?? 0} message${(q.remaining ?? 0) > 1 ? 's' : ''} IA restant${(q.remaining ?? 0) > 1 ? 's' : ''} ce mois-ci.`;
}
