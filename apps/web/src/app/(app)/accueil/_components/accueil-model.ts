// Logique pure de l'accueil (ADR-0038 § 5).
//
// Les chiffres des cartes BUILD · RUN · GROW sont lus sur des API EXISTANTES ;
// ce module les met en forme et décide de ce qui s'affiche. Règle : un chiffre
// inconnu (droit manquant, offre, panne réseau) n'est JAMAIS remplacé par un
// zéro ou une estimation — il n'est pas affiché, et la carte montre une phrase
// d'appel à la place (`appel`).

import type { SettlementView } from '@/lib/api';
import type { BriefSeverity } from '@/lib/morning-brief-api';

export interface Chiffre {
  id: string;
  /** Valeur mise en forme, ex. « 3 ». */
  valeur: string;
  /** Ce que compte la valeur, accordé, ex. « initiatives ». */
  libelle: string;
  /** Mis en relief (ex. factures en retard > 0). */
  attention?: boolean;
}

/** `n` suivi du singulier ou du pluriel. Zéro prend le singulier, en français. */
export function accorder(n: number, singulier: string, pluriel: string): string {
  return n <= 1 ? singulier : pluriel;
}

function chiffre(
  id: string,
  n: number | null,
  singulier: string,
  pluriel: string,
  attention = false,
): Chiffre | null {
  if (n === null || !Number.isFinite(n) || n < 0) return null;
  return {
    id,
    valeur: new Intl.NumberFormat('fr-FR').format(n),
    libelle: accorder(n, singulier, pluriel),
    attention: attention && n > 0,
  };
}

const definis = (liste: Array<Chiffre | null>): Chiffre[] =>
  liste.filter((c): c is Chiffre => c !== null);

/** BUILD : initiatives (`GET /projects`) et idées actives (`GET /idea-lab/ideas`). */
export function chiffresBuild(faits: {
  initiatives: number | null;
  ideesActives: number | null;
}): Chiffre[] {
  return definis([
    chiffre('initiatives', faits.initiatives, 'initiative', 'initiatives'),
    chiffre('idees', faits.ideesActives, 'idée active', 'idées actives'),
  ]);
}

/**
 * RUN : à partir des factures ouvertes (`GET /sales/settlements?open=true`).
 * `null` = non lisible (rôle sans `sales.read`, panne) : aucun chiffre.
 */
export function chiffresRun(ouvertes: readonly SettlementView[] | null): Chiffre[] {
  if (ouvertes === null) return [];
  const aRegler = ouvertes.filter((f) => f.settlement !== null);
  const enRetard = aRegler.filter(
    (f) => f.settlement?.overdue === true || f.status === 'overdue',
  ).length;
  return definis([
    chiffre('a-encaisser', aRegler.length, 'facture à encaisser', 'factures à encaisser'),
    chiffre('en-retard', enRetard, 'facture en retard', 'factures en retard', true),
  ]);
}

/**
 * GROW : alertes du brief du matin (`GET /morning-brief`) et score de santé
 * quand il est calculable (`GET /grow/health` — `disponible: false` n'affiche
 * rien : le score n'est jamais complété par une estimation, ADR-0032).
 */
export function chiffresGrow(faits: { alertes: number | null; sante: number | null }): Chiffre[] {
  const sante =
    faits.sante === null || !Number.isFinite(faits.sante)
      ? null
      : {
          id: 'sante',
          valeur: `${Math.round(faits.sante)}/100`,
          libelle: 'score de santé',
        };
  return definis([
    chiffre('alertes', faits.alertes, 'alerte du brief', 'alertes du brief', true),
    sante,
  ]);
}

/** Phrase d'appel quand une carte n'a aucun chiffre lisible. */
export const APPELS = {
  build: 'Notez une idée ou ouvrez une initiative.',
  run: 'Facturez, encaissez et suivez votre trésorerie.',
  grow: 'Pilotez l’entreprise et lisez ses écarts.',
} as const;

export interface AlerteAccueil {
  id: string;
  severite: BriefSeverity;
  titre: string;
  message: string;
  lien: string;
}

const RANG: Record<BriefSeverity, number> = { critique: 0, attention: 1, info: 2 };

/**
 * Alertes du brief à montrer sur l'accueil : les plus graves d'abord, puis le
 * rang du moteur, trois au plus. Le lien est celui que le moteur donne
 * (`actionPath`), à condition d'être un chemin interne — sinon le brief.
 */
export function alertesAccueil(
  alertes: ReadonlyArray<{
    ruleId: string;
    severity: BriefSeverity;
    rank: number;
    title: string;
    message: string;
    actionPath: string;
  }>,
  max = 3,
): AlerteAccueil[] {
  return [...alertes]
    .sort((a, b) => RANG[a.severity] - RANG[b.severity] || a.rank - b.rank)
    .slice(0, max)
    .map((a) => ({
      id: a.ruleId,
      severite: a.severity,
      titre: a.title,
      message: a.message,
      lien: cheminInterne(a.actionPath) ? a.actionPath : '/organisation/brief',
    }));
}

/** Un chemin interne commence par un seul « / » (pas de `//hote`, pas de schéma). */
export function cheminInterne(chemin: string): boolean {
  return chemin.startsWith('/') && !chemin.startsWith('//') && !chemin.includes('\\');
}
