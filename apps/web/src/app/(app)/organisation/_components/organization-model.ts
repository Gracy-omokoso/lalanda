// Logique pure de l'espace organisation (S21a).
//
// Isolée du rendu pour être testable : `apps/web` tourne vitest en environnement
// `node`, sans DOM. Tout ce qui décide vit ici, les `.tsx` assemblent.
//
// Rien de ce fichier n'AUTORISE quoi que ce soit. Le serveur reste seul juge
// (`authz/permissions.ts`, ADR-0012 §8) : il renvoie `sections.X === null` pour
// un bloc fermé et un 403 sur les routes réservées. Ce module traduit ces faits
// en interface. Une divergence produit au pire un onglet en trop — jamais un
// droit en trop.

import type {
  BlocMasqueView,
  ConsommationView,
  OrgAction,
  PlanEnAttenteView,
  RatioRougeView,
} from '@/lib/api';

// ─────────────────────────────────────────────────────────────────────────────
// Onglets
// ─────────────────────────────────────────────────────────────────────────────

export interface OrganizationTab {
  /** Segment sous `/organisation/`. La chaîne vide = page racine. */
  segment: string;
  label: string;
  /**
   * Action qui ouvre l'onglet, ou `null` s'il est ouvert à tout membre.
   *
   * L'onglet est MASQUÉ quand l'action manque — masquer n'est qu'un confort :
   * un utilisateur qui saisirait l'URL à la main reçoit quand même un 403 du
   * serveur, et la page l'explique au lieu de crier une panne.
   */
  action: OrgAction | null;
}

/**
 * Même pattern déclaratif que `PROJECT_TABS` et `ACCOUNT_TABS` : pour ajouter une
 * section, on AJOUTE UNE ENTRÉE ici et on crée `organisation/<segment>/page.tsx`.
 * L'ordre du tableau est l'ordre d'affichage.
 */
export const ORGANIZATION_TABS: readonly OrganizationTab[] = [
  { segment: '', label: 'Tableau de bord', action: null },
  // ADR-0016 E2 — « Membres » arrive de `/members`, à la racine des routes, où
  // il était une page d'organisation logée hors de l'organisation. En DEUXIÈME
  // position, juste après le tableau de bord : les personnes viennent avant les
  // réglages.
  //
  // L'action retenue est celle qui garde l'appel remplissant la page
  // (`GET /organizations/:id/members` → `organization.manage`), et non une
  // action choisie par ressemblance : le jour où la matrice bouge, l'onglet
  // suit l'appel qu'il ouvre.
  { segment: 'membres', label: 'Membres', action: 'organization.manage' },
  { segment: 'parametres', label: 'Paramètres', action: 'organization.manage' },
  { segment: 'facturation', label: 'Facturation', action: 'billing.manage' },
  { segment: 'journal', label: 'Journal', action: 'audit.read' },
];

export const ORGANIZATION_BASE = '/organisation';

/** Premier segment sous `/organisation/` — '' sur la page racine. */
export function segmentActif(pathname: string): string {
  if (!pathname.startsWith(ORGANIZATION_BASE)) return '';
  return pathname.slice(ORGANIZATION_BASE.length).split('/').filter(Boolean)[0] ?? '';
}

/**
 * Onglets réellement proposés au rôle.
 *
 * Tant que les permissions ne sont pas connues (`null` — premier rendu, ou appel
 * en échec), on ne montre QUE le tableau de bord. Le choix est délibéré : afficher
 * tous les onglets puis en retirer trois au chargement fait clignoter l'interface
 * et promet des pages qui répondront 403.
 */
export function ongletsVisibles(actions: readonly OrgAction[] | null): OrganizationTab[] {
  if (actions === null) return ORGANIZATION_TABS.filter((t) => t.action === null);
  return ORGANIZATION_TABS.filter((t) => t.action === null || actions.includes(t.action));
}

// ─────────────────────────────────────────────────────────────────────────────
// Refus et erreurs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Un refus d'autorisation, à distinguer d'une panne.
 *
 * 403 = rôle insuffisant dans sa propre organisation. 404 = ressource d'une autre
 * organisation, que le serveur refuse de confirmer (ADR-0011 Contrat 4). Les deux
 * se traitent pareil côté interface : on explique, on n'alarme pas.
 */
export function estRefus(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('status' in err)) return false;
  const status = (err as { status: unknown }).status;
  return status === 403 || status === 404;
}

const MESSAGES: Record<string, string> = {
  FORBIDDEN: 'Votre rôle ne donne pas accès à cette section.',
  NO_ORGANIZATION: 'Aucune organisation active. Créez-en une ou acceptez une invitation.',
  ORG_NOT_FOUND: 'Organisation introuvable.',
  INVALID_REQUEST: 'Certaines valeurs sont refusées. Vérifiez le formulaire.',
};

export function codeErreur(err: unknown): string | null {
  if (typeof err !== 'object' || err === null || !('detail' in err)) return null;
  const detail = (err as { detail: unknown }).detail;
  if (typeof detail !== 'object' || detail === null || !('code' in detail)) return null;
  const code = (detail as { code: unknown }).code;
  return typeof code === 'string' ? code : null;
}

export function messageErreur(err: unknown, repli: string): string {
  const code = codeErreur(err);
  if (code && MESSAGES[code]) return MESSAGES[code]!;
  return err instanceof Error && err.message !== '' ? err.message : repli;
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatage
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Consommation face à une limite : « 3 / 5 », ou « 3 / illimité ».
 *
 * `limite: null` ne devient JAMAIS 0 ni un grand nombre : « illimité » et « pas
 * de limite contractuelle » sont des informations, pas des valeurs manquantes.
 */
export function libelleLimite(
  utilise: number,
  limite: number | null,
  illimite = 'illimité',
): string {
  return `${utilise} / ${limite === null ? illimite : limite}`;
}

/** Le quota est-il atteint ou dépassé ? `false` si la limite n'existe pas. */
export function limiteAtteinte(utilise: number, limite: number | null): boolean {
  return limite !== null && utilise >= limite;
}

/** Libellés des plans commerciaux — repris de la page /pricing. */
const PLANS: Record<string, string> = { free: 'Gratuit', pro: 'Pro', business: 'Business' };

export function libellePlan(plan: string): string {
  return PLANS[plan] ?? plan;
}

/**
 * Date courte en français. Une chaîne vide ou invalide donne un tiret, jamais
 * « Invalid Date » ni la date du jour.
 */
export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateHeure(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Écart relatif en pourcentage, signé. `null` reste `null` : une base prévue
 * nulle n'autorise aucun pourcentage, et afficher « 0 % » mentirait sur un écart
 * dont on ne sait rien (doctrine ADR-0011).
 */
export function formatEcartPct(fraction: number | null): string {
  if (fraction === null) return 'non chiffrable';
  const pct = fraction * 100;
  const signe = pct > 0 ? '+' : '';
  return `${signe}${pct.toFixed(1).replace('.', ',')} %`;
}

/** Nombre lisible, séparateurs français, sans devise (on ignore l'unité ici). */
export function formatNombre(valeur: number): string {
  return valeur.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

/** Mois d'exercice « M3 » — jamais un mois calendaire : l'exercice est relatif. */
export function libelleMois(year: number, month: number): string {
  return `Exercice ${year} · mois ${month}`;
}

/**
 * Ce que le seuil attendait, en toutes lettres.
 *
 * Le feu est déjà rouge dans le snapshot du plan; on ne le recalcule pas. Cette
 * phrase se contente de dire ce que la valeur aurait dû respecter — un chiffre
 * rouge sans son seuil n'apprend rien à qui doit décider.
 */
export function libelleSeuil(
  ratio: Pick<RatioRougeView, 'seuilValeur' | 'seuilDirection'>,
): string {
  return ratio.seuilDirection === 'min'
    ? `minimum attendu : ${formatNombre(ratio.seuilValeur)}`
    : `maximum admis : ${formatNombre(ratio.seuilValeur)}`;
}

/** Pourquoi ce projet attend une validation. */
export function libelleRaisonAttente(plan: Pick<PlanEnAttenteView, 'raison'>): string {
  return plan.raison === 'AUCUN_PLAN'
    ? 'Aucun plan validé pour l’instant.'
    : 'Les hypothèses ont changé depuis la dernière version validée.';
}

// ─────────────────────────────────────────────────────────────────────────────
// Composition du tableau de bord
// ─────────────────────────────────────────────────────────────────────────────

/**
 * L'espace a-t-il quelque chose à montrer, ou seulement des blocs fermés ?
 *
 * Sert à choisir le ton de la page : avec au moins un bloc ouvert on affiche des
 * données et on liste sobrement le reste; sans aucun, on explique d'abord ce que
 * le rôle permet — c'est le cas d'un Lecteur qui n'aurait aucun projet.
 */
export function aQuelqueChoseAMontrer(sections: {
  gouvernance: unknown;
  validation: unknown;
  comptabilite: unknown;
  projets: unknown;
}): boolean {
  return (
    sections.gouvernance !== null ||
    sections.validation !== null ||
    sections.comptabilite !== null ||
    sections.projets !== null
  );
}

/**
 * Phrase d'accueil selon le rôle — dit d'emblée à quoi sert cette page POUR SOI.
 *
 * Fondée sur les blocs réellement ouverts, jamais sur le nom du rôle : le jour où
 * la matrice bouge, la phrase suit sans qu'on y touche.
 */
export function accroche(input: {
  lectureSeule: boolean;
  gouvernance: boolean;
  validation: boolean;
  comptabilite: boolean;
}): string {
  if (input.gouvernance) {
    return 'Vue d’ensemble de l’organisation : projets, validations du mois et consommation du plan.';
  }
  if (input.validation) {
    return 'Ce qui appelle une décision : ratios au rouge, plans en attente et écarts du réalisé.';
  }
  if (input.comptabilite) {
    return 'Votre file de saisie : périodes à renseigner, périodes à clôturer et anomalies signalées.';
  }
  if (input.lectureSeule) {
    return 'Consultation seule : vos projets et leurs dernières versions validées.';
  }
  return 'Vos projets et leurs dernières versions validées.';
}

/** Blocs fermés, triés dans l'ordre d'affichage des sections. */
export function masqueOrdonne(masque: readonly BlocMasqueView[]): BlocMasqueView[] {
  const ordre: BlocMasqueView['section'][] = [
    'gouvernance',
    'validation',
    'comptabilite',
    'projets',
  ];
  return [...masque].sort((a, b) => ordre.indexOf(a.section) - ordre.indexOf(b.section));
}

/** Résumé d'une consommation en une ligne, pour les tuiles du tableau de bord. */
export function resumeConsommation(c: ConsommationView): string {
  const projets = `${libelleLimite(c.projets.utilise, c.projets.limite)} projet${
    c.projets.utilise > 1 ? 's' : ''
  }`;
  const sieges =
    c.sieges.limite === null
      ? `${c.sieges.utilise} membre${c.sieges.utilise > 1 ? 's' : ''}`
      : `${libelleLimite(c.sieges.utilise, c.sieges.limite)} sièges`;
  return `${projets} · ${sieges}`;
}
