// Matricules et numéros de poste (ADR-0068 § 2 et § 3) — calculs purs, sans base.
//
// Le compteur vit en base (`hr_counters`, `$inc` et `$max` seulement) ; ici, la forme :
// préfixe par défaut tiré du nom de l'organisation, mise en forme d'un rang, lecture
// du rang d'un numéro saisi « compatible avec le format courant », plancher du
// compteur. La comparaison ignore la casse, les espaces et les tirets, comme
// `employeeNumberKey` de `@lalanda/shared/hr` (« ab-01 » et « AB 01 » sont un même
// matricule).

/** Bornes de la largeur (nombre de chiffres) d'un matricule. */
export const EMPLOYEE_NUMBER_WIDTH = { min: 3, max: 8, default: 4 } as const;

/** Préfixe des numéros de poste et largeur (ADR-0068 § 3) : `POS-001`. */
export const POSITION_NUMBER_PREFIX = 'POS-';
export const POSITION_NUMBER_WIDTH = 3;

/** Préfixe de repli quand le nom ne donne aucune lettre. */
export const EMPLOYEE_NUMBER_FALLBACK_PREFIX = 'MAT-';

/** Préfixe saisi : 1 à 10 caractères, lettres, chiffres et « - _ / . ». */
export const EMPLOYEE_NUMBER_PREFIX_PATTERN = /^[A-Z0-9][A-Z0-9\-_/.]{0,9}$/;

/** Mots qui ne donnent pas d'initiale (articles, formes juridiques courantes en RDC). */
const STOPWORDS = new Set([
  'DE',
  'DU',
  'DES',
  'LA',
  'LE',
  'LES',
  'ET',
  'EN',
  'AU',
  'AUX',
  'THE',
  'OF',
  'AND',
  'SARL',
  'SARLU',
  'SAS',
  'SASU',
  'SA',
  'SPRL',
  'SUARL',
  'ASBL',
  'ETS',
  'GIE',
]);

function asciiUpper(raw: string): string {
  return raw.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

/** Clé de comparaison d'un numéro (même règle que `employeeNumberKey`). */
export function numberKeyOf(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]+/g, '');
}

/**
 * Préfixe par défaut : initiales des mots significatifs (4 au plus), « Go freelance »
 * → `GF-` ; un seul mot → ses trois premières lettres (« Lalanda » → `LAL-`) ; aucun
 * mot → `MAT-`.
 */
export function defaultEmployeeNumberPrefix(organizationName: string): string {
  const words = asciiUpper(organizationName)
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w !== '' && /[A-Z]/.test(w));
  const meaningful = words.filter((w) => !STOPWORDS.has(w));
  const kept = meaningful.length > 0 ? meaningful : words;
  if (kept.length === 0) return EMPLOYEE_NUMBER_FALLBACK_PREFIX;
  if (kept.length === 1) return `${kept[0]!.replace(/[0-9]/g, '').slice(0, 3) || 'MAT'}-`;
  return `${kept
    .slice(0, 4)
    .map((w) => w.replace(/[0-9]/g, '')[0] ?? '')
    .join('')}-`;
}

/** Préfixe saisi, normalisé (majuscules, sans espace) ; `null` s'il est hors format. */
export function normalizeEmployeeNumberPrefix(raw: string): string | null {
  const p = asciiUpper(raw).replace(/\s+/g, '');
  return EMPLOYEE_NUMBER_PREFIX_PATTERN.test(p) ? p : null;
}

/** `prefix` + rang complété à `width` chiffres (un rang plus long n'est pas tronqué). */
export function formatSequenceNumber(prefix: string, width: number, rank: number): string {
  if (!Number.isInteger(rank) || rank < 1) throw new RangeError('Rang de numéro invalide.');
  return `${prefix}${String(rank).padStart(width, '0')}`;
}

/**
 * Rang d'un numéro « compatible avec le format courant » : préfixe (comparé par clé)
 * suivi de chiffres seulement. `null` si incompatible. La largeur n'est pas exigée :
 * `GF-12` et `GF-0012` sont tous deux le rang 12.
 */
export function sequenceRankOf(prefix: string, value: string): number | null {
  const pk = numberKeyOf(prefix);
  const vk = numberKeyOf(value);
  if (pk === '' || !vk.startsWith(pk)) return null;
  const rest = vk.slice(pk.length);
  if (!/^\d{1,15}$/.test(rest)) return null;
  const rank = Number(rest);
  return rank >= 1 && Number.isSafeInteger(rank) ? rank : null;
}

/** Plus grand rang compatible parmi des numéros existants (0 si aucun). */
export function highestSequenceRank(prefix: string, values: readonly (string | null)[]): number {
  let max = 0;
  for (const v of values) {
    if (v === null) continue;
    const r = sequenceRankOf(prefix, v);
    if (r !== null && r > max) max = r;
  }
  return max;
}
