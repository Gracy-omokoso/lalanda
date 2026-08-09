// ─────────────────────────────────────────────────────────────────────────────
// AVERTISSEMENT — PROJETS DE DOCUMENTS, NON VALIDÉS JURIDIQUEMENT
//
// Les textes des pages légales de Lalanda (CGU, CGV, politique de
// confidentialité, mentions légales, politique de cookies) sont des PROJETS
// rédigés par l'équipe produit. Ils n'ont PAS été relus par un juriste et ne
// doivent PAS être présentés comme conformes à un droit applicable.
// Une relecture juridique est un PRÉALABLE À LA MISE EN PRODUCTION.
// Voir docs/28-CONFORMITE-LEGALE.md.
// ─────────────────────────────────────────────────────────────────────────────
//
// Registre unique des documents légaux. Trois consommateurs le lisent :
//   1. les pages elles-mêmes (titre, date de dernière mise à jour affichée);
//   2. les footers marketing et applicatif (liste des liens);
//   3. le classement des routes (`routes.ts`) — les pages légales doivent rester
//      joignables avec OU sans session.
//
// Centraliser évite l'écart le plus courant sur ce genre de pages : une page
// ajoutée mais absente du footer, donc introuvable par un utilisateur qui la
// cherche — et donc juridiquement inopposable.

/** Identifiants des documents légaux publiés. */
export type LegalSlug = 'cgu' | 'cgv' | 'confidentialite' | 'mentions-legales' | 'cookies';

export interface LegalDocument {
  slug: LegalSlug;
  /** Chemin public, servi par le route group `(marketing)`. */
  href: string;
  /** Titre complet, affiché en tête de page et dans `<title>`. */
  title: string;
  /** Libellé court, utilisé dans les footers. */
  shortTitle: string;
  /** Résumé d'une phrase, utilisé en `<meta name="description">`. */
  summary: string;
  /** Date de dernière mise à jour (ISO `YYYY-MM-DD`), affichée en tête de page. */
  updatedAt: string;
}

/**
 * VERSION DU CORPUS CONTRACTUEL.
 *
 * C'est cette valeur qui est enregistrée avec l'acceptation d'un utilisateur
 * (`termsVersion`, cf. `apps/api/src/legal/`). Elle couvre l'ENSEMBLE des
 * documents opposables — CGU, CGV et politique de confidentialité — plutôt qu'un
 * document isolé : un utilisateur accepte un état du corpus à une date, pas cinq
 * numéros de version indépendants qu'il faudrait recouper pour savoir ce qu'il a
 * réellement lu.
 *
 * RÈGLE D'ÉVOLUTION : toute modification SUBSTANTIELLE (nouvelle finalité de
 * traitement, nouveau sous-traitant, changement de prix ou de durée
 * d'engagement, extension des usages interdits) impose de faire avancer cette
 * version. Les acceptations antérieures deviennent alors périmées et l'accord
 * est redemandé — c'est exactement ce que `GET /legal/terms/acceptance` permet
 * de détecter. Une correction de typographie ne la fait PAS avancer.
 */
export const LEGAL_VERSION = '2026-08-09';

/**
 * Documents publiés. L'ordre est celui des footers.
 *
 * `updatedAt` est propre à chaque document : il renseigne le lecteur sur la
 * fraîcheur du texte qu'il a sous les yeux, là où `LEGAL_VERSION` sert la preuve
 * d'acceptation. Les deux ne mesurent pas la même chose et ne doivent pas être
 * confondus.
 */
export const LEGAL_DOCUMENTS: readonly LegalDocument[] = [
  {
    slug: 'cgu',
    href: '/cgu',
    title: "Conditions générales d'utilisation",
    shortTitle: 'CGU',
    summary:
      "Conditions d'utilisation du service Lalanda : compte, usages autorisés et interdits, propriété intellectuelle, disponibilité, résiliation et responsabilité.",
    updatedAt: '2026-08-09',
  },
  {
    slug: 'cgv',
    href: '/cgv',
    title: 'Conditions générales de vente',
    shortTitle: 'CGV',
    summary:
      'Conditions de vente des abonnements Lalanda : offres et prix, essai de 14 jours, paiement, facturation, reconduction, rétractation, remboursement et impayés.',
    updatedAt: '2026-08-09',
  },
  {
    slug: 'confidentialite',
    href: '/confidentialite',
    title: 'Politique de confidentialité',
    shortTitle: 'Confidentialité',
    summary:
      'Données collectées par Lalanda, finalités, durées de conservation, sous-traitants (hébergement, IA, paiement, email), transferts et droits des personnes.',
    updatedAt: '2026-08-09',
  },
  {
    slug: 'cookies',
    href: '/cookies',
    title: 'Politique de cookies',
    shortTitle: 'Cookies',
    summary:
      'Cookies et traceurs utilisés par Lalanda, distinction entre cookies essentiels et non essentiels, et gestion de votre choix.',
    updatedAt: '2026-08-09',
  },
  {
    slug: 'mentions-legales',
    href: '/mentions-legales',
    title: 'Mentions légales',
    shortTitle: 'Mentions légales',
    summary: 'Éditeur, directeur de publication, hébergeur et contact du service Lalanda.',
    updatedAt: '2026-08-09',
  },
] as const;

/** Chemins publics des pages légales — dérivés, jamais recopiés à la main. */
export const LEGAL_PATHS: readonly string[] = LEGAL_DOCUMENTS.map((d) => d.href);

/** Retrouve un document par son slug. Lève si le slug est inconnu. */
export function legalDocument(slug: LegalSlug): LegalDocument {
  const doc = LEGAL_DOCUMENTS.find((d) => d.slug === slug);
  if (!doc) throw new Error(`Document légal inconnu : ${slug}`);
  return doc;
}

/**
 * Ce chemin est-il une page légale publique ?
 *
 * Comparaison par ÉGALITÉ EXACTE : ces pages n'ont pas de sous-routes, et un
 * `startsWith` ferait passer pour publique n'importe quelle future page dont le
 * chemin commencerait par `/cgu`.
 */
export function isLegalPath(pathname: string): boolean {
  return LEGAL_PATHS.includes(pathname);
}

/**
 * Ces textes ont-ils été relus et validés par un juriste ?
 *
 * `false` tant que la relecture n'a pas eu lieu — et tant que c'est le cas,
 * chaque page affiche un bandeau qui le dit AU LECTEUR, pas seulement à l'équipe.
 * Un projet de CGU présenté comme des CGU définitives est une affirmation fausse
 * faite à l'utilisateur au moment précis où il décide de s'engager ; le bandeau
 * est ce qui empêche cette page de mentir tant qu'elle n'est pas validée.
 *
 * Ne basculer cette valeur à `true` qu'APRÈS une relecture juridique effective,
 * dans le même lot que les corrections qu'elle aura demandées.
 * Voir docs/28-CONFORMITE-LEGALE.md.
 */
export const LEGAL_REVIEWED_BY_COUNSEL = false;

/**
 * Adresse de contact affichée sur les pages légales et pour l'exercice des
 * droits. Laissée en marqueur : elle doit exister et être relevée avant la mise
 * en production — publier une adresse qui ne reçoit personne est pire que ne
 * rien publier.
 */
export const CONTACT_PLACEHOLDER = '[À COMPLÉTER : adresse email de contact]';

/** Marqueur de champ que l'éditeur doit renseigner avant publication. */
export function todo(label: string): string {
  return `[À COMPLÉTER : ${label}]`;
}
