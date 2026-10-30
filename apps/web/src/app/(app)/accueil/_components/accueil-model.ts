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
 * Compte lu sur une page d'API : `n` éléments, `auMoins` si la page est pleine et
 * qu'il en reste (`nextCursor`) — l'accueil affiche alors « 100+ », jamais un
 * nombre inventé au-delà de ce qui a été lu.
 */
export interface Compte {
  n: number;
  auMoins?: boolean;
}

/** Compte d'une page `{ items, nextCursor }` ; `null` (illisible) reste `null`. */
export function comptePage(
  page: { items: readonly unknown[]; nextCursor: string | null } | null,
): Compte | null {
  if (page === null) return null;
  return { n: page.items.length, auMoins: page.nextCursor !== null };
}

/** Factures fournisseurs en retard : Σ des nombres par devise de l'échéancier (moteur). */
export function achatsEnRetard(
  echeancier: { schedule: ReadonlyArray<{ overdue: { count: number } }> } | null,
): Compte | null {
  if (echeancier === null) return null;
  return { n: echeancier.schedule.reduce((s, c) => s + c.overdue.count, 0) };
}

function compte(
  id: string,
  c: Compte | null | undefined,
  singulier: string,
  pluriel: string,
  attention = false,
): Chiffre | null {
  if (!c) return null;
  const base = chiffre(id, c.n, singulier, pluriel, attention);
  if (base === null || !c.auMoins) return base;
  // Page pleine : « 100+ », au pluriel ; jamais un total deviné.
  return { ...base, valeur: `${base.valeur}+`, libelle: pluriel };
}

/** Tuiles au plus sur la carte RUN (grille de deux colonnes). */
export const MAX_TUILES_RUN = 4;

/**
 * Chiffres CRM et Achats de la carte RUN, chacun lu sur une API EXISTANTE et
 * seulement si l'utilisateur en a le droit ; `null` ou absent = non lu (droit
 * manquant, panne) : aucune tuile, jamais un zéro.
 *
 * - `achatsEnRetard` : `GET /purchases/payables` (`purchase.read`) ;
 * - `validationsEnAttente` : `GET /purchases/approvals/pending` (`purchase.approve`) ;
 * - `relancesEnRetard` : `GET /crm/activities?status=overdue` (`crm.read`) ;
 * - `opportunitesOuvertes` : `GET /crm/opportunities?status=open` (`crm.read`).
 */
export interface FaitsRunModules {
  achatsEnRetard?: Compte | null;
  validationsEnAttente?: Compte | null;
  relancesEnRetard?: Compte | null;
  opportunitesOuvertes?: Compte | null;
}

/**
 * RUN : à partir des factures ouvertes (`GET /sales/settlements?open=true`), puis
 * les chiffres des achats et du CRM, dans cet ordre, {@link MAX_TUILES_RUN} au plus.
 * `ouvertes === null` = ventes non lisibles (rôle sans `sales.read`, panne).
 */
export function chiffresRun(
  ouvertes: readonly SettlementView[] | null,
  modules: FaitsRunModules = {},
): Chiffre[] {
  const ventes: Array<Chiffre | null> = [];
  if (ouvertes !== null) {
    const aRegler = ouvertes.filter((f) => f.settlement !== null);
    const enRetard = aRegler.filter(
      (f) => f.settlement?.overdue === true || f.status === 'overdue',
    ).length;
    ventes.push(
      chiffre('a-encaisser', aRegler.length, 'facture à encaisser', 'factures à encaisser'),
      chiffre('en-retard', enRetard, 'facture en retard', 'factures en retard', true),
    );
  }
  return definis([
    ...ventes,
    compte(
      'achats-en-retard',
      modules.achatsEnRetard,
      'facture fournisseur en retard',
      'factures fournisseurs en retard',
      true,
    ),
    compte(
      'validations-achat',
      modules.validationsEnAttente,
      'achat à valider',
      'achats à valider',
      true,
    ),
    compte(
      'relances-en-retard',
      modules.relancesEnRetard,
      'relance client en retard',
      'relances clients en retard',
      true,
    ),
    compte(
      'opportunites',
      modules.opportunitesOuvertes,
      'opportunité ouverte',
      'opportunités ouvertes',
    ),
  ]).slice(0, MAX_TUILES_RUN);
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
