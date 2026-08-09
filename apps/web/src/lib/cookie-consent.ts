// Consentement aux cookies non essentiels — logique pure (S22c).
//
// Ce fichier ne touche ni au DOM ni à React : il est testé en environnement node
// (`vitest.config.ts` de apps/web n'installe aucun environnement DOM). Le
// composant `components/cookie-banner.tsx` n'est qu'une enveloppe autour de ces
// fonctions.
//
// ── Deux règles de fond, appliquées ici et pas seulement affichées ─────────────
//
// 1. REFUS PAR DÉFAUT. Tant qu'aucun choix n'a été enregistré, `isAllowed`
//    renvoie `false` pour toute catégorie non essentielle. L'état « pas encore
//    répondu » n'est donc jamais interprété comme une acceptation — c'est la
//    différence entre une bannière informative et un consentement.
// 2. LE REFUS EST UN CHOIX ENREGISTRÉ. « Refuser » écrit un cookie au même titre
//    qu'« Accepter ». Sans cela, un refus ferait réapparaître la bannière à
//    chaque page, ce qui est la version passive du dark pattern : fatiguer
//    jusqu'à l'acceptation.
//
// ── Ce qui existe réellement aujourd'hui ──────────────────────────────────────
//
// Lalanda ne pose AUCUN cookie non essentiel à ce jour : pas de mesure
// d'audience, pas de régie publicitaire, pas de widget tiers. La bannière et ce
// module existent pour que le choix soit connu AVANT qu'un tel outil soit
// introduit, et pour qu'il n'existe qu'un seul endroit où le vérifier
// (`isAllowed`). Voir docs/28-CONFORMITE-LEGALE.md.

/**
 * Catégories de cookies soumises au choix de l'utilisateur.
 *
 * Les cookies ESSENTIELS n'y figurent pas et ne sont pas optionnels : cookie de
 * session (connexion) et cookie de consentement lui-même. Les lister comme
 * « choix » serait mensonger, puisque les refuser rendrait le service inopérant.
 */
export type CookieCategory = 'mesure';

/** Catégories connues, dans l'ordre d'affichage. */
export const COOKIE_CATEGORIES: readonly CookieCategory[] = ['mesure'] as const;

export interface CategoryDescription {
  category: CookieCategory;
  label: string;
  description: string;
}

export const CATEGORY_DESCRIPTIONS: readonly CategoryDescription[] = [
  {
    category: 'mesure',
    label: 'Mesure d’audience',
    description:
      'Statistiques de fréquentation agrégées, destinées à comprendre quelles pages sont utiles. ' +
      'Aucun outil de mesure n’est installé à ce jour : votre choix sera appliqué le jour où il le sera.',
  },
] as const;

/** État du consentement : une décision par catégorie non essentielle. */
export type ConsentState = Record<CookieCategory, boolean>;

/** Refus de tout ce qui n'est pas essentiel — la valeur par défaut. */
export const DEFAULT_CONSENT: ConsentState = { mesure: false };

/** Acceptation de toutes les catégories — utilisée par le bouton « Tout accepter ». */
export const FULL_CONSENT: ConsentState = { mesure: true };

export interface StoredConsent {
  /** Version du formulaire de consentement au moment du choix. */
  version: number;
  /** Date du choix (ISO). Permet de redemander après une période raisonnable. */
  decidedAt: string;
  state: ConsentState;
}

export const CONSENT_COOKIE_NAME = 'lalanda_consent';

/**
 * Version du formulaire de consentement.
 *
 * À FAIRE AVANCER dès qu'une catégorie est ajoutée ou que la finalité d'une
 * catégorie existante change : un choix exprimé sur l'ancien formulaire ne dit
 * rien du nouveau. Les consentements de version antérieure sont alors traités
 * comme absents — donc comme un refus — et la bannière réapparaît.
 */
export const CONSENT_VERSION = 1;

/** Durée de conservation du choix. Au-delà, la question est reposée. */
export const CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 182; // ~6 mois

/**
 * Lit le consentement depuis une chaîne de cookies (`document.cookie` ou en-tête
 * `Cookie`).
 *
 * Renvoie `null` — c'est-à-dire « aucun choix exprimé », donc refus — dans TOUS
 * les cas douteux : cookie absent, illisible, de version antérieure, ou dont la
 * forme ne correspond pas. Un cookie corrompu ne doit jamais valoir acceptation.
 */
export function readConsent(cookieString: string | undefined | null): StoredConsent | null {
  const raw = readCookieValue(cookieString, CONSENT_COOKIE_NAME);
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const obj = parsed as Record<string, unknown>;
  if (obj['version'] !== CONSENT_VERSION) return null;
  if (typeof obj['decidedAt'] !== 'string') return null;

  const rawState = obj['state'];
  if (!rawState || typeof rawState !== 'object') return null;
  const source = rawState as Record<string, unknown>;

  // Reconstruction catégorie par catégorie : une catégorie absente du cookie
  // (ajoutée depuis, ou retirée par bricolage) retombe sur le refus, jamais sur
  // la valeur brute trouvée dans le cookie.
  const state = { ...DEFAULT_CONSENT };
  for (const category of COOKIE_CATEGORIES) {
    state[category] = source[category] === true;
  }

  return { version: CONSENT_VERSION, decidedAt: obj['decidedAt'], state };
}

/** Un choix a-t-il été exprimé ? Sinon, la bannière doit être affichée. */
export function hasDecided(stored: StoredConsent | null): boolean {
  return stored !== null;
}

/**
 * Cette catégorie est-elle autorisée ?
 *
 * POINT UNIQUE DE VÉRIFICATION : tout code qui voudrait charger un script tiers,
 * poser un cookie de mesure ou envoyer un événement passe par ici. Le refus par
 * défaut (`stored === null` → `false`) est ce qui rend la promesse tenable sans
 * dépendre de la vigilance de l'appelant.
 */
export function isAllowed(stored: StoredConsent | null, category: CookieCategory): boolean {
  if (!stored) return false;
  return stored.state[category] === true;
}

/** Sérialise un choix en valeur de cookie (non encodée). */
export function serializeConsent(state: ConsentState, now: Date): string {
  const stored: StoredConsent = {
    version: CONSENT_VERSION,
    decidedAt: now.toISOString(),
    state: { ...DEFAULT_CONSENT, ...state },
  };
  return JSON.stringify(stored);
}

/**
 * Construit la chaîne à affecter à `document.cookie`.
 *
 * `SameSite=Lax` et pas de `Secure` en clair : le drapeau est ajouté seulement
 * si la page est servie en HTTPS, faute de quoi le cookie serait rejeté en
 * développement (http://localhost) et la bannière reviendrait indéfiniment.
 * Pas de `HttpOnly` — ce cookie est écrit et relu par le navigateur.
 */
export function buildConsentCookie(state: ConsentState, now: Date, secure: boolean): string {
  const value = encodeURIComponent(serializeConsent(state, now));
  const parts = [
    `${CONSENT_COOKIE_NAME}=${value}`,
    'Path=/',
    `Max-Age=${CONSENT_MAX_AGE_SECONDS}`,
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** Chaîne à affecter à `document.cookie` pour effacer le choix (bouton « Revenir sur mon choix »). */
export function buildConsentClearCookie(): string {
  return `${CONSENT_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/**
 * Extrait la valeur brute d'un cookie d'une chaîne `a=1; b=2`.
 *
 * Découpage sur le PREMIER `=` uniquement : la valeur est du JSON encodé, qui
 * contient lui-même des `=` une fois percent-encodé.
 */
export function readCookieValue(
  cookieString: string | undefined | null,
  name: string,
): string | null {
  if (!cookieString) return null;
  for (const part of cookieString.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return null;
}
