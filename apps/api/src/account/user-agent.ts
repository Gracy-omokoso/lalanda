/**
 * Description lisible d'une session à partir de son `User-Agent` (S20b).
 *
 * PÉRIMÈTRE ASSUMÉ : il ne s'agit PAS d'identifier un appareil de façon fiable —
 * un User-Agent est déclaratif, falsifiable et volontairement appauvri par les
 * navigateurs récents (réduction d'entropie). L'objectif est uniquement d'aider
 * l'utilisateur à reconnaître ses propres sessions dans une liste : « Chrome sur
 * macOS » suffit à décider d'une révocation, une chaîne brute de 200 caractères
 * non. Aucune décision d'autorisation ne dépend de cette valeur.
 *
 * Volontairement sans dépendance : les bibliothèques de parsing d'UA embarquent
 * des bases de règles à tenir à jour pour un gain nul à cet usage.
 */

export interface DeviceLabel {
  /** Navigateur détecté, ou null si non reconnu. */
  browser: string | null;
  /** Système d'exploitation détecté, ou null si non reconnu. */
  os: string | null;
  /** Libellé prêt à afficher — jamais vide. */
  label: string;
}

/** Ordre significatif : les cas particuliers passent avant les cas généraux. */
const BROWSERS: ReadonlyArray<readonly [RegExp, string]> = [
  // Edge et Opera contiennent « Chrome » dans leur UA : ils doivent gagner avant.
  [/\bEdgA?\/|\bEdge\//i, 'Edge'],
  [/\bOPR\/|\bOpera\//i, 'Opera'],
  [/\bSamsungBrowser\//i, 'Samsung Internet'],
  [/\bFirefox\/|\bFxiOS\//i, 'Firefox'],
  [/\bChrome\/|\bCriOS\//i, 'Chrome'],
  // Safari n'est retenu qu'en dernier : tous les navigateurs iOS l'annoncent.
  [/\bSafari\//i, 'Safari'],
];

const OPERATING_SYSTEMS: ReadonlyArray<readonly [RegExp, string]> = [
  // iPadOS s'annonce « Macintosh » depuis iOS 13 : le test iPad passe avant macOS.
  [/\biPad\b/i, 'iPadOS'],
  [/\biPhone\b|\biPod\b/i, 'iOS'],
  [/\bAndroid\b/i, 'Android'],
  [/\bWindows NT\b/i, 'Windows'],
  [/\bMac OS X\b|\bMacintosh\b/i, 'macOS'],
  [/\bCrOS\b/i, 'ChromeOS'],
  [/\bLinux\b/i, 'Linux'],
];

const UNKNOWN_LABEL = 'Appareil inconnu';

/**
 * Traduit un User-Agent en libellé affichable.
 *
 * Un UA absent ou vide n'est pas une anomalie : better-auth enregistre une chaîne
 * vide pour les sessions créées hors navigateur (tests e2e, appels serveur). On
 * renvoie alors un libellé neutre plutôt que d'inventer un appareil.
 */
export function describeUserAgent(userAgent: string | null | undefined): DeviceLabel {
  const ua = (userAgent ?? '').trim();
  if (ua.length === 0) {
    return { browser: null, os: null, label: UNKNOWN_LABEL };
  }

  const browser = BROWSERS.find(([pattern]) => pattern.test(ua))?.[1] ?? null;
  const os = OPERATING_SYSTEMS.find(([pattern]) => pattern.test(ua))?.[1] ?? null;

  if (browser && os) return { browser, os, label: `${browser} sur ${os}` };
  if (browser) return { browser, os, label: browser };
  if (os) return { browser, os, label: os };

  return { browser: null, os: null, label: UNKNOWN_LABEL };
}
