// Thème d'interface (S20b, ADR-0055) — mécanique partagée entre le bascule du header, la
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
// ADR-0055 ajoute un second réglage, le THÈME (Lalanda, Lagune, Ébène), posé
// sur `data-ui-theme` et mémorisé sous `localStorage['ui-theme']`, aux mêmes
// trois endroits. Ébène est toujours sombre : `data-theme` vaut alors `dark`
// quel que soit le mode choisi, que l'on garde tout de même (revenir à Lalanda
// ou Lagune le retrouve).
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

/** Thème d'interface choisi par la personne (ADR-0055). */
export type UiTheme = 'lalanda' | 'lagune' | 'ebene';

export const UI_THEMES: readonly UiTheme[] = ['lalanda', 'lagune', 'ebene'];
export const DEFAULT_UI_THEME: UiTheme = 'lalanda';

/**
 * Clé lue par le script anti-FOUC de `app/layout.tsx`. Une valeur absente ou
 * inconnue vaut Lalanda.
 */
export const UI_THEME_STORAGE_KEY = 'ui-theme';

export function isUiTheme(value: unknown): value is UiTheme {
  return value === 'lalanda' || value === 'lagune' || value === 'ebene';
}

/** Ébène ignore le choix clair/sombre. */
export function uiThemeForcesDark(uiTheme: UiTheme): boolean {
  return uiTheme === 'ebene';
}

/** Mode réellement affiché pour un thème et un mode résolu. Fonction pure. */
export function displayedTheme(uiTheme: UiTheme, resolved: ResolvedTheme): ResolvedTheme {
  return uiThemeForcesDark(uiTheme) ? 'dark' : resolved;
}

function readStoredUiTheme(): UiTheme {
  try {
    const attr = document.documentElement.dataset['uiTheme'];
    if (isUiTheme(attr)) return attr;
  } catch {
    /* pas de document */
  }
  try {
    const stored = localStorage.getItem(UI_THEME_STORAGE_KEY);
    if (isUiTheme(stored)) return stored;
  } catch {
    /* stockage indisponible */
  }
  return DEFAULT_UI_THEME;
}

function readStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* stockage indisponible */
  }
  return 'system';
}

function writeDisplayedTheme(theme: ResolvedTheme): void {
  try {
    document.documentElement.dataset['theme'] = theme;
  } catch {
    /* pas de document (rendu serveur) — rien à appliquer */
  }
}

/**
 * Applique une préférence clair/sombre au document ET au stockage local.
 * Renvoie le mode AFFICHÉ (toujours `dark` sous Ébène).
 *
 * Ne lève jamais : Safari en navigation privée refuse `localStorage`, et un
 * réglage d'apparence ne justifie pas de casser la page.
 */
export function applyThemePreference(preference: ThemePreference): ResolvedTheme {
  const shown = displayedTheme(readStoredUiTheme(), resolveTheme(preference, systemPrefersDark()));
  writeDisplayedTheme(shown);
  try {
    const stored = themeStorageValue(preference);
    if (stored === null) localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, stored);
  } catch {
    /* stockage indisponible — le thème reste appliqué pour cette visite */
  }
  return shown;
}

/**
 * Applique un thème d'interface (ADR-0055) au document et au stockage local,
 * puis recalcule le mode affiché à partir du mode mémorisé (Ébène impose le
 * sombre ; quitter Ébène retrouve le mode choisi). Ne lève jamais.
 */
export function applyUiTheme(uiTheme: UiTheme): ResolvedTheme {
  try {
    document.documentElement.dataset['uiTheme'] = uiTheme;
  } catch {
    /* pas de document */
  }
  try {
    localStorage.setItem(UI_THEME_STORAGE_KEY, uiTheme);
  } catch {
    /* stockage indisponible */
  }
  const shown = displayedTheme(uiTheme, resolveTheme(readStoredPreference(), systemPrefersDark()));
  writeDisplayedTheme(shown);
  return shown;
}

/** Applique les deux réglages enregistrés sur le compte, dans le bon ordre. */
export function applyAppearance(prefs: {
  theme: ThemePreference;
  uiTheme?: UiTheme | null;
}): ResolvedTheme {
  applyThemePreference(prefs.theme);
  return applyUiTheme(isUiTheme(prefs.uiTheme) ? prefs.uiTheme : DEFAULT_UI_THEME);
}
