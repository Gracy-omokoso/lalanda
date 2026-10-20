// Construction de la requête e-MCF depuis le contenu FIGÉ — ADR-0024 § 1.
//
// Fonction PURE : aucune lecture de base, aucune arithmétique. Tous les
// montants viennent du moteur, déjà figés au gel ; seule `decimalToJsonNumber`
// du moteur transforme une chaîne décimale en nombre JSON (et refuse ce qui ne
// serait pas exact). Le corps est sérialisé UNE fois ; son empreinte sha256 est
// figée dans `normalization.requestSha256` et ce MÊME corps sert à toute la
// tentative.
//
// Ce qui ne part JAMAIS à la DGI : un montant en USD (sauf la contre-valeur
// indicative `curRate`), l'identifiant interne de l'opérateur, les coordonnées
// du client quand il n'a pas demandé à les voir imprimées (« données imprimées
// = données échangées »).

import { createHash } from 'node:crypto';

import { decimalToJsonNumber } from '@lalanda/engine';

import {
  EdefInvoiceRequestSchema,
  type EdefInvoiceClient,
  type EdefInvoiceItem,
  type EdefInvoiceRequest,
} from '../../edef/edef-invoice.types.js';
import type { EdefTypeEntry } from '../../edef/edef.types.js';
import { COMMENT_LINES, CREDIT_NOTE_TYPES } from '../invoices/invoice.contract.js';
import type { InvoiceLean } from '../invoices/invoice.types.js';

/** Libellés des instantanés `clientTypes` et `referenceTypes` de l'environnement. */
export interface EdefRequestRefs {
  clientTypes: readonly EdefTypeEntry[];
  referenceTypes: readonly EdefTypeEntry[];
}

/** Prérequis manquant AVANT tout envoi : rendu dans `lastError`, jamais en HTTP (§ 9.1). */
export class NormalizationPreconditionError extends Error {
  constructor(
    readonly code:
      | 'ISF_NOT_CONFIGURED'
      | 'REFERENCE_LISTS_UNAVAILABLE'
      | 'CREDIT_NOTE_REFERENCE_MISSING'
      | 'REQUEST_NOT_BUILDABLE',
    message: string,
  ) {
    super(message);
    this.name = 'NormalizationPreconditionError';
  }
}

export interface BuiltEdefRequest {
  body: EdefInvoiceRequest;
  /** Le corps sérialisé une fois — celui que l'on journalise et dont on prend l'empreinte. */
  json: string;
  sha256: string;
}

const COMMENT_FIELDS = {
  A: 'cmta',
  B: 'cmtb',
  C: 'cmtc',
  D: 'cmtd',
  E: 'cmte',
  F: 'cmtf',
  G: 'cmtg',
  H: 'cmth',
} as const;

function text(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function labelOf(entries: readonly EdefTypeEntry[], type: string): string | null {
  return text(entries.find((e) => e.type === type)?.description ?? null);
}

/**
 * Document gelé `pending_normalization` + numéro réservé → corps e-MCF.
 * Lève `NormalizationPreconditionError` pour un prérequis manquant, `Error`
 * pour une incohérence du contenu figé (erreur de programmation).
 */
export function buildEdefInvoiceRequest(
  doc: InvoiceLean,
  rn: string,
  refs: EdefRequestRefs | null,
): BuiltEdefRequest {
  if (refs === null) {
    throw new NormalizationPreconditionError(
      'REFERENCE_LISTS_UNAVAILABLE',
      'Les listes de référence de la DGI (types de client, natures d’avoir) n’ont pas été relevées : rafraîchissez les listes du point de vente.',
    );
  }
  const isf = text(doc.isf);
  if (isf === null) {
    throw new NormalizationPreconditionError(
      'ISF_NOT_CONFIGURED',
      'L’identifiant du logiciel (ISF) n’est pas configuré sur la plateforme : l’équipe Lalanda est prévenue.',
    );
  }
  const amounts = doc.normalizedAmounts;
  const seller = doc.seller;
  const operator = doc.operator;
  if (!amounts || !seller || !operator) {
    throw new Error(`Document ${String(doc._id)} non figé : aucune requête e-MCF possible.`);
  }

  const items: EdefInvoiceItem[] = [...doc.lines]
    .sort((a, b) => a.index - b.index)
    .map((line) => {
      const normalized = amounts.lines.find((l) => l.index === line.index);
      const computed = amounts.calculation.lines.find((l) => l.index === line.index);
      if (!normalized || !computed) {
        throw new Error(`Ligne ${line.index} absente des montants normalisés figés.`);
      }
      const item: EdefInvoiceItem = {
        code: text(line.edefCode),
        name: line.name,
        type: line.itemType,
        price: decimalToJsonNumber(normalized.unitPrice),
        quantity: decimalToJsonNumber(line.quantity),
        taxGroup: line.taxGroup,
      };
      if (computed.specificTaxValue !== null) {
        item.taxSpecificValue = computed.specificTaxValue;
        item.taxSpecificAmount = decimalToJsonNumber(computed.specificTaxAmount);
      }
      if (normalized.originalPrice !== null) {
        item.originalPrice = decimalToJsonNumber(normalized.originalPrice);
        const modification = text(normalized.priceModification);
        if (modification !== null) item.priceModification = modification;
      }
      return item;
    });

  const customer = doc.customer;
  const client: EdefInvoiceClient = { type: customer.type };
  const typeDesc = labelOf(refs.clientTypes, customer.type);
  if (typeDesc !== null) client.typeDesc = typeDesc;
  const name = text(customer.name);
  if (name !== null) client.name = name;
  const nif = text(customer.nif);
  if (nif !== null) client.nif = nif;
  if (customer.printContactDetails) {
    const contact = [text(customer.phone), text(customer.email)]
      .filter((c): c is string => c !== null)
      .join('; ');
    if (contact !== '') client.contact = contact;
    const address = text(customer.address);
    if (address !== null) client.address = address;
  }

  const body: EdefInvoiceRequest = {
    nif: seller.nif,
    rn,
    mode: doc.priceMode,
    isf,
    type: doc.type,
    items,
    client,
    operator: { name: operator.name },
    payment: amounts.payments.map((p) => ({
      name: p.method,
      amount: decimalToJsonNumber(p.amount),
    })),
  };

  if ((CREDIT_NOTE_TYPES as readonly string[]).includes(doc.type)) {
    const credit = doc.creditNote;
    const reference = text(credit?.reference ?? null);
    if (!credit || reference === null) {
      throw new NormalizationPreconditionError(
        'CREDIT_NOTE_REFERENCE_MISSING',
        'Cet avoir ne porte pas la référence DGI de sa facture d’origine.',
      );
    }
    body.reference = reference;
    body.referenceType = credit.nature;
    const desc = labelOf(refs.referenceTypes, credit.nature);
    if (desc !== null) body.referenceDesc = desc;
  }

  for (const line of COMMENT_LINES) {
    const comment = text(doc.comments[line] ?? null);
    if (comment !== null) body[COMMENT_FIELDS[line]] = comment;
  }

  const usd = amounts.counterValueUsd;
  if (usd !== null) {
    body.curCode = 'USD';
    body.curRate = decimalToJsonNumber(usd.rate);
    body.curDate = usd.date;
  }

  // Garde-fou de forme (champ inconnu, `null` au lieu d'une omission…) : une
  // erreur ici est une erreur de programmation, jamais une donnée à envoyer.
  const checked = EdefInvoiceRequestSchema.safeParse(body);
  if (!checked.success) {
    throw new NormalizationPreconditionError(
      'REQUEST_NOT_BUILDABLE',
      `La requête e-MCF construite n’est pas conforme : ${checked.error.issues
        .map((i) => `${i.path.join('.')} ${i.message}`)
        .join(' ; ')}.`,
    );
  }
  const json = JSON.stringify(body);
  return { body, json, sha256: createHash('sha256').update(json).digest('hex') };
}
