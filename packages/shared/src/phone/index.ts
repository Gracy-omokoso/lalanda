// Numéros de téléphone — ADR-0075 (décision de Gracy du 13 nov. 2026).
//
// Standard retenu :
// - STOCKAGE en E.164 (UIT-T E.164) : `+` puis indicatif et numéro national
//   significatif, sans espace ni préfixe interurbain (`+243812345678`) ;
// - AFFICHAGE et IMPRESSION au format international UIT-T E.123 : indicatif, puis
//   groupes séparés par des espaces (`+243 81 234 5678`).
//
// Deux fonctions seulement, utilisées par l'API (écriture, PDF) et par le web
// (affichage) : `normalizePhoneE164` et `formatPhoneE123`. Elles ne lèvent jamais :
// une valeur non reconnaissable rend `null` (normalisation) ou est rendue telle
// quelle (mise en forme) — on n'efface ni ne devine jamais une saisie ancienne.
// Fonctions PURES, sans dépendance.

/** Indicatif par défaut d'une saisie nationale (`0812…`) : la RDC. */
export const DEFAULT_PHONE_COUNTRY_CODE = '+243';

/**
 * Indicatifs à un et deux chiffres (UIT-T E.164, liste des indicatifs attribués) ;
 * tous les autres comptent trois chiffres. Les indicatifs sont « sans préfixe
 * commun » : cette table suffit à découper n'importe quel numéro international.
 */
const ONE_DIGIT_CODES = new Set(['1', '7']);
const TWO_DIGIT_CODES = new Set([
  '20',
  '27',
  '30',
  '31',
  '32',
  '33',
  '34',
  '36',
  '39',
  '40',
  '41',
  '43',
  '44',
  '45',
  '46',
  '47',
  '48',
  '49',
  '51',
  '52',
  '53',
  '54',
  '55',
  '56',
  '57',
  '58',
  '60',
  '61',
  '62',
  '63',
  '64',
  '65',
  '66',
  '81',
  '82',
  '84',
  '86',
  '90',
  '91',
  '92',
  '93',
  '94',
  '95',
  '98',
]);

export interface PhoneOptions {
  /**
   * Indicatif donné à une saisie NATIONALE (`0812345678`, ou neuf chiffres pour
   * la RDC). `null` : une saisie sans indicatif n'est pas reconnue (l'écran ne
   * devine pas le pays d'un numéro ancien). Défaut : `+243`.
   */
  defaultCountryCode?: string | null;
}

/** Sépare un E.164 en indicatif (`243`) et numéro national significatif. */
export function splitE164(e164: string): { countryCode: string; national: string } | null {
  if (!/^\+[1-9]\d{7,14}$/.test(e164)) return null;
  const digits = e164.slice(1);
  const length = ONE_DIGIT_CODES.has(digits.slice(0, 1))
    ? 1
    : TWO_DIGIT_CODES.has(digits.slice(0, 2))
      ? 2
      : 3;
  return { countryCode: digits.slice(0, length), national: digits.slice(length) };
}

/**
 * Normalise une saisie en E.164 (`+243812345678`), ou `null` si elle n'est pas un
 * numéro reconnaissable.
 *
 * - séparateurs admis et retirés : espaces, points, tirets, parenthèses, barres ;
 * - `00` vaut `+` ;
 * - une saisie nationale (`0…`) reçoit l'indicatif par défaut, sans son `0` ; pour
 *   la RDC, neuf chiffres sans `0` aussi (`812345678`) ;
 * - `+243 0812…` (préfixe interurbain recopié après l'indicatif) perd son `0` ;
 * - contrôle E.164 : 8 à 15 chiffres, premier chiffre non nul ; RDC : exactement
 *   neuf chiffres après `+243`, premier non nul.
 *
 * Toute autre forme (lettres, poste « ext. 12 », chiffres nus d'un autre pays…)
 * rend `null` : l'appelant garde alors la valeur telle quelle.
 */
export function normalizePhoneE164(
  input: string | null | undefined,
  options: PhoneOptions = {},
): string | null {
  if (typeof input !== 'string' || input.length > 40) return null;
  const compact = input.trim().replace(/[\s.\-()/]/g, '');
  if (!/^\+?\d+$/.test(compact)) return null;
  const defaut =
    options.defaultCountryCode === undefined
      ? DEFAULT_PHONE_COUNTRY_CODE
      : options.defaultCountryCode;
  let e164: string;
  if (compact.startsWith('+')) e164 = compact;
  else if (compact.startsWith('00')) e164 = `+${compact.slice(2)}`;
  else if (defaut === null) return null;
  else if (compact.startsWith('0')) e164 = `${defaut}${compact.slice(1)}`;
  else if (defaut === '+243' && compact.length === 9) e164 = `+243${compact}`;
  else return null;
  if (/^\+2430\d{9}$/.test(e164)) e164 = `+243${e164.slice(5)}`;
  if (!/^\+[1-9]\d{7,14}$/.test(e164)) return null;
  if (e164.startsWith('+243') && !/^\+243[1-9]\d{8}$/.test(e164)) return null;
  return e164;
}

/** Groupes du numéro national : RDC 2-3-4 ; ailleurs par trois, jamais un chiffre seul en fin. */
function groupNational(countryCode: string, national: string): string {
  if (countryCode === '243' && national.length === 9) {
    return `${national.slice(0, 2)} ${national.slice(2, 5)} ${national.slice(5)}`;
  }
  const n = national.length;
  if (n <= 4) return national;
  // Reste d'un chiffre : le dernier groupe en compte quatre (10 → 3-3-4, 7 → 3-4).
  const lastFour = n % 3 === 1;
  const end = lastFour ? n - 4 : n;
  const groups: string[] = [];
  let i = 0;
  for (; i + 3 <= end; i += 3) groups.push(national.slice(i, i + 3));
  if (i < n) groups.push(national.slice(i));
  return groups.join(' ');
}

/**
 * Forme E.123 internationale d'un numéro : `+243812345678` → `+243 81 234 5678`.
 * Reconnaît ce que `normalizePhoneE164` reconnaît (mêmes options) ; une valeur non
 * reconnaissable est rendue telle quelle (espaces de bord retirés), `null` ou vide
 * donne `''`. Affichage et impression seulement : la valeur stockée ne change pas.
 */
export function formatPhoneE123(
  value: string | null | undefined,
  options: PhoneOptions = {},
): string {
  const v = (value ?? '').trim();
  if (v === '') return '';
  const e164 = normalizePhoneE164(v, options);
  const parts = e164 === null ? null : splitE164(e164);
  if (parts === null || parts.national === '') return v;
  return `+${parts.countryCode} ${groupNational(parts.countryCode, parts.national)}`;
}

/**
 * Valeur à ENREGISTRER : l'E.164 quand la saisie est reconnaissable, sinon la
 * saisie telle quelle (les routes gardent leur propre règle d'acceptation, ADR-0075).
 * `null` reste `null`.
 */
export function storedPhone<T extends string | null>(value: T): T {
  if (value === null) return value;
  return (normalizePhoneE164(value) ?? value) as T;
}
