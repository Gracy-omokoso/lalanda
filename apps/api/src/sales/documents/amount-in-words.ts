// Total en lettres (mention DGI 2.1 q) — ADR-0025 § 4.
//
// Transcription française, orthographe traditionnelle : « vingt et un »,
// « quatre-vingts », « deux cents », « deux cent un », « mille » invariable,
// « un million de francs congolais ». AUCUNE conversion en nombre : la chaîne
// décimale canonique du moteur est lue chiffre par chiffre (l'API ne fait aucune
// opération sur un montant, ADR-0023).

import type { DocumentCurrency } from '@lalanda/engine';

const DIGITS = '0123456789';

const UNITS = [
  'zéro',
  'un',
  'deux',
  'trois',
  'quatre',
  'cinq',
  'six',
  'sept',
  'huit',
  'neuf',
  'dix',
  'onze',
  'douze',
  'treize',
  'quatorze',
  'quinze',
  'seize',
] as const;

const TENS = ['', 'dix', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'] as const;

/** Indice 0–9 d'un caractère chiffre. */
function d(c: string): number {
  const i = DIGITS.indexOf(c);
  if (i < 0 || c.length !== 1) throw new Error(`Chiffre attendu, reçu « ${c} »`);
  return i;
}

/** 10 à 19. */
function teen(u: number): string {
  if (u <= 6) return UNITS[10 + u]!;
  return `dix-${UNITS[u]!}`;
}

/** 1 à 99 ; `final` : rien ne suit dans le nombre (pluriel de « quatre-vingts »). */
function below100(t: number, u: number, final: boolean): string {
  if (t === 0) return UNITS[u]!;
  if (t === 1) return teen(u);
  if (t <= 6) {
    const base = TENS[t]!;
    if (u === 0) return base;
    if (u === 1) return `${base} et un`;
    return `${base}-${UNITS[u]!}`;
  }
  if (t === 7) return u === 1 ? 'soixante et onze' : `soixante-${teen(u)}`;
  if (t === 8)
    return u === 0 ? (final ? 'quatre-vingts' : 'quatre-vingt') : `quatre-vingt-${UNITS[u]!}`;
  return `quatre-vingt-${teen(u)}`;
}

/** Groupe de trois chiffres non nul ; `final` : aucun numéral ne suit (« mille » en est un). */
function group(digits: string, final: boolean): string {
  const h = d(digits[0]!);
  const t = d(digits[1]!);
  const u = d(digits[2]!);
  const rest = t === 0 && u === 0 ? '' : below100(t, u, final);
  if (h === 0) return rest;
  if (h === 1) return rest === '' ? 'cent' : `cent ${rest}`;
  if (rest === '') return `${UNITS[h]!} ${final ? 'cents' : 'cent'}`;
  return `${UNITS[h]!} cent ${rest}`;
}

/** Échelles, de la plus grande à la plus petite (groupes de trois chiffres). */
const SCALES = [
  { singular: 'billion', plural: 'billions' },
  { singular: 'milliard', plural: 'milliards' },
  { singular: 'million', plural: 'millions' },
  { singular: 'mille', plural: 'mille' },
  { singular: '', plural: '' },
] as const;

/** Entier positif ou nul, en lettres (jusqu'à 15 chiffres). */
export function integerInWords(digits: string): string {
  if (!/^\d+$/.test(digits)) throw new Error(`Entier attendu, reçu « ${digits} »`);
  const trimmed = digits.replace(/^0+(?=\d)/, '');
  if (trimmed.length > SCALES.length * 3) {
    throw new Error('Montant trop grand pour être écrit en lettres.');
  }
  if (trimmed === '0') return 'zéro';
  const padded = trimmed.padStart(SCALES.length * 3, '0');
  const words: string[] = [];
  SCALES.forEach((scale, i) => {
    const g = padded.slice(i * 3, i * 3 + 3);
    if (g === '000') return;
    const isOne = g === '001';
    if (scale.singular === 'mille') {
      // « mille » : numéral invariable ; « un mille » ne se dit pas, et il bloque
      // le pluriel de « cent » et « vingt » qui le précèdent.
      words.push(isOne ? 'mille' : `${group(g, false)} mille`);
    } else if (scale.singular === '') {
      words.push(group(g, true));
    } else {
      // « million », « milliard », « billion » : des noms, qui prennent la
      // marque du pluriel et laissent « cents » et « quatre-vingts » au pluriel.
      words.push(`${group(g, true)} ${isOne ? scale.singular : scale.plural}`);
    }
  });
  return words.join(' ');
}

const CURRENCY_WORDS: Record<
  DocumentCurrency,
  { one: string; many: string; centOne: string; centMany: string }
> = {
  CDF: {
    one: 'franc congolais',
    many: 'francs congolais',
    centOne: 'centime',
    centMany: 'centimes',
  },
  USD: {
    one: 'dollar américain',
    many: 'dollars américains',
    centOne: 'cent',
    centMany: 'cents',
  },
};

/**
 * Montant décimal canonique (`"4064.50"`) en lettres, avec sa devise :
 * « quatre mille soixante-quatre francs congolais et cinquante centimes ».
 */
export function amountInWords(amount: string, currency: DocumentCurrency): string {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount);
  if (!m) throw new Error(`Montant décimal positif attendu, reçu « ${amount} »`);
  const intDigits = m[1]!.replace(/^0+(?=\d)/, '');
  const cents = (m[2] ?? '').padEnd(2, '0');
  const w = CURRENCY_WORDS[currency];

  const integer = integerInWords(intDigits);
  // « un million DE francs » : un nom d'échelle suivi directement de la devise.
  const endsWithScaleNoun = intDigits.length > 6 && intDigits.endsWith('000000');
  const plural = intDigits.length > 1 || d(intDigits) >= 2;
  const unit = plural ? w.many : w.one;
  let text = `${integer} ${endsWithScaleNoun ? 'de ' : ''}${unit}`;
  if (cents !== '00') {
    const centPlural = cents[0] !== '0' || d(cents[1]!) >= 2;
    text += ` et ${integerInWords(cents)} ${centPlural ? w.centMany : w.centOne}`;
  }
  return text;
}
