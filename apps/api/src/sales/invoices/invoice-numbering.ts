// Format des numéros de documents de vente — ADR-0027 (amende ADR-0023 § S25e.3).
//
// Fonctions pures : aucun accès à la base. Le compteur (`InvoiceNumberingService`)
// donne le rang ; ce module l'habille.
//
//   IN{AA}{MM}-{NNNNNN}       facture (FV, FT, EV, ET), série réelle
//   AV{AA}{MM}-{NNNNNN}       avoir (FA, EA), MÊME série que les factures
//   TEST-IN… / TEST-AV…       série d'essai (environnement de test DGI), compteur propre
//   PF{AA}{MM}-{NNNNNN}       référence de pro forma, compteur propre, trous admis
//
// Le mois est un REPÈRE de lecture : le rang est unique et ininterrompu par
// organisation, série et année de gestion (NS022 1.1.15, 1.2.1 k) ; il ne repart
// pas à 1 chaque mois, seulement au 1ᵉʳ janvier (Kinshasa).
//
// Les anciennes formes (`AAAA-NNNNNN`, `TEST-AAAA-NNNNNN`, `PF-AAAA-NNNNNN`,
// ADR-0023) restent lisibles : des documents figés les portent.

import { CREDIT_NOTE_TYPES, type InvoiceType } from './invoice.contract.js';

export type NumberingSeries = 'real' | 'test' | 'proforma';

/** Préfixe de la série fiscale : facture ou avoir. */
export type FiscalPrefix = 'IN' | 'AV';

/** Année et mois (1 à 12) à Kinshasa. */
export interface NumberingPeriod {
  year: number;
  month: number;
}

export interface ParsedInvoiceNumber {
  series: NumberingSeries;
  /** Année de gestion (quatre chiffres), clé du compteur. */
  year: number;
  /** Mois imprimé ; `null` pour l'ancienne forme, qui n'en porte pas. */
  month: number | null;
  /** `IN`, `AV` ou `PF` ; `null` pour une ancienne forme de la série fiscale. */
  prefix: FiscalPrefix | 'PF' | null;
  /** Rang dans la série de l'année. */
  seq: number;
  /** Ancienne forme (ADR-0023), antérieure à ADR-0027. */
  legacy: boolean;
}

const KINSHASA_PERIOD = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Africa/Kinshasa',
  year: 'numeric',
  month: 'numeric',
});

/** Année et mois civils à Kinshasa (UTC+1, sans heure d'été). */
export function fiscalPeriodOf(at: Date): NumberingPeriod {
  let year = Number.NaN;
  let month = Number.NaN;
  for (const part of KINSHASA_PERIOD.formatToParts(at)) {
    if (part.type === 'year') year = Number.parseInt(part.value, 10);
    if (part.type === 'month') month = Number.parseInt(part.value, 10);
  }
  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    throw new Error(`Date illisible pour la numérotation : ${String(at)}`);
  }
  return { year, month };
}

/** Année de gestion d'un instant : année civile à Kinshasa. */
export function fiscalYearOf(at: Date): number {
  return fiscalPeriodOf(at).year;
}

/**
 * Mois à imprimer pour un numéro du compteur de l'année `year`, attribué à
 * l'instant `at`. L'année imprimée est TOUJOURS celle du compteur : un instant
 * d'une autre année (horloge en avance, date DGI après minuit) est ramené en
 * décembre ou en janvier de `year`, sinon deux compteurs pourraient produire la
 * même chaîne.
 */
export function periodInYear(year: number, at: Date): NumberingPeriod {
  const p = fiscalPeriodOf(at);
  if (p.year === year) return p;
  return { year, month: p.year > year ? 12 : 1 };
}

/** `AV` pour un avoir (FA, EA), `IN` pour toute autre facture. */
export function fiscalPrefixOf(type: InvoiceType): FiscalPrefix {
  return (CREDIT_NOTE_TYPES as readonly InvoiceType[]).includes(type) ? 'AV' : 'IN';
}

function periodPart(period: NumberingPeriod): string {
  const { year, month } = period;
  if (!Number.isInteger(year) || year < 2000 || year > 2099) {
    throw new Error(`Année hors du format AA : ${year}`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`Mois invalide : ${month}`);
  }
  return `${String(year % 100).padStart(2, '0')}${String(month).padStart(2, '0')}`;
}

function seqPart(seq: number): string {
  if (!Number.isInteger(seq) || seq < 1) throw new Error(`Rang invalide : ${seq}`);
  return String(seq).padStart(6, '0');
}

/**
 * `IN2610-000042`, `AV2610-000043`, `TEST-IN2610-000001` ; au-delà de 999 999,
 * le rang s'allonge.
 */
export function formatInvoiceNumber(
  series: 'real' | 'test',
  prefix: FiscalPrefix,
  period: NumberingPeriod,
  seq: number,
): string {
  return `${series === 'test' ? 'TEST-' : ''}${prefix}${periodPart(period)}-${seqPart(seq)}`;
}

/** `PF2610-000001` : hors série fiscale. */
export function formatProformaRef(period: NumberingPeriod, seq: number): string {
  return `PF${periodPart(period)}-${seqPart(seq)}`;
}

const CURRENT_FISCAL = /^(TEST-)?(IN|AV)(\d{2})(0[1-9]|1[0-2])-(\d{6,})$/;
const CURRENT_PROFORMA = /^PF(\d{2})(0[1-9]|1[0-2])-(\d{6,})$/;
const LEGACY = /^(?:(TEST|PF)-)?(\d{4})-(\d{6,})$/;

/** Lecture des formes actuelle et ancienne ; `null` si la forme est inconnue. */
export function parseInvoiceNumber(value: string): ParsedInvoiceNumber | null {
  let m = CURRENT_FISCAL.exec(value);
  if (m) {
    return {
      series: m[1] ? 'test' : 'real',
      year: 2000 + Number.parseInt(m[3]!, 10),
      month: Number.parseInt(m[4]!, 10),
      prefix: m[2] as FiscalPrefix,
      seq: Number.parseInt(m[5]!, 10),
      legacy: false,
    };
  }
  m = CURRENT_PROFORMA.exec(value);
  if (m) {
    return {
      series: 'proforma',
      year: 2000 + Number.parseInt(m[1]!, 10),
      month: Number.parseInt(m[2]!, 10),
      prefix: 'PF',
      seq: Number.parseInt(m[3]!, 10),
      legacy: false,
    };
  }
  m = LEGACY.exec(value);
  if (m) {
    const series: NumberingSeries = m[1] === 'TEST' ? 'test' : m[1] === 'PF' ? 'proforma' : 'real';
    return {
      series,
      year: Number.parseInt(m[2]!, 10),
      month: null,
      prefix: series === 'proforma' ? 'PF' : null,
      seq: Number.parseInt(m[3]!, 10),
      legacy: true,
    };
  }
  return null;
}
