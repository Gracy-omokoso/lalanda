// Thème d'interface (S20b) — mécanique partagée entre le bascule du header, la
// page de préférences et la synchronisation au chargement de l'application.
//
// Trois endroits stockent un thème, et ils doivent rester d'accord :
//
//   1. `document.documentElement.dataset.theme` — ce qui est AFFICHÉ ;
//   2. `localStorage['theme']` — cache local lu par le script inline de
//      `app/layout.tsx` AVANT le premier paint, pour éviter le flash clair→sombre ;
//   3. `/account/preferences` — la préférence de l'utilisateur, qui le suit d'un
//      appareil à l'autre et fait autorité au chargement.
//
// Ce module est le seul à écrire (1) et (2), ensemble, dans le bon vocabulaire.
// Le laisser à chaque appelant produirait tôt ou tard un écran qui change de
// thème tout seul au rechargement.

/** Préférence telle qu'elle est ENREGISTRÉE (serveur et UI). */
export type ThemePreference = 'light' | 'dark' | 'system';

/** Thème réellement APPLIQUÉ au document — `system` n'existe pas à ce niveau. */
export type ResolvedTheme = 'light' | 'dark';

/**
 * Clé lue par le script anti-FOUC de `app/layout.tsx`. Il n'attend qu'un thème
 * RÉSOLU (`light` | `dark`) ; l'absence de clé signifie « suis le système ».
 * Y écrire `system` forcerait le mode clair au prochain chargement, ce mot ne
 * faisant pas partie de son vocabulaire.
 */
export const THEME_STORAGE_KEY = 'theme';

/**
 * Thème effectif d'une préférence. Fonction PURE : `prefersDark` est injecté,
 * ce qui la rend testable sans DOM et nomme le seul facteur externe.
 */
export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (preference === 'light' || preference === 'dark') return preference;
  return prefersDark ? 'dark' : 'light';
}

/** Ce que le stockage local doit contenir. `null` = supprimer la clé. */
export function themeStorageValue(preference: ThemePreference): ResolvedTheme | null {
  return preference === 'system' ? null : preference;
}

/** Le système est-il en sombre ? `false` hors navigateur ou si l'API manque. */
export function systemPrefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

/**
 * Applique une préférence au document ET au stockage local.
 *
 * Ne lève jamais : Safari en navigation privée refuse `localStorage`, et un
 * réglage d'apparence ne justifie pas de casser la page.
 */
export function applyThemePreference(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference, systemPrefersDark());
  try {
    document.documentElement.dataset['theme'] = resolved;
  } catch {
    /* pas de document (rendu serveur) — rien à appliquer */
  }
  try {
    const stored = themeStorageValue(preference);
    if (stored === null) localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, stored);
  } catch {
    /* stockage indisponible — le thème reste appliqué pour cette visite */
  }
  return resolved;
}
