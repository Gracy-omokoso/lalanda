// Clés d'opération (ADR-0049 § 2.4 et § 6) — catalogue fermé du moteur.
//
// Une organisation change le compte d'une règle, jamais la liste des clés :
// une clé hors catalogue est refusée (`400 UNKNOWN_OPERATION_KEY`, lot K4).
// Aucun compte ici : seulement des NOMS d'opération.

import { RECEIPT_METHODS } from '../../receivables/types.js';
import { STOCK_MOVEMENT_KINDS } from '../../stock/types.js';
import { EXPENSE_CATEGORY_CODES } from '../../treasury/types.js';
import { TAX_GROUP_LETTERS } from '../../invoice-totals/types.js';

/**
 * Groupes de taxation qui ne vont JAMAIS d'office à un compte de produit
 * (§ 6.1 ; ADR-0031 § 3 les exclut déjà du chiffre d'affaires).
 */
export const ACCOUNTING_NON_REVENUE_TAX_GROUPS = ['H', 'I', 'J', 'L', 'N'] as const;

/** Préfixes des pièces de vente : facture, facture d'acompte, avoir. */
export const SALES_DOCUMENT_PREFIXES = [
  'sale.invoice',
  'sale.deposit',
  'sale.credit_note',
] as const;
export type SalesDocumentPrefix = (typeof SALES_DOCUMENT_PREFIXES)[number];

const alt = (values: readonly string[]): string => values.join('|');
const GROUPS = alt(TAX_GROUP_LETTERS);
const REVENUE_GROUPS = alt(
  TAX_GROUP_LETTERS.filter(
    (g) => !(ACCOUNTING_NON_REVENUE_TAX_GROUPS as readonly string[]).includes(g),
  ),
);
const SALES = alt(SALES_DOCUMENT_PREFIXES.map((p) => p.replace('.', '\\.')));
const METHODS = alt(RECEIPT_METHODS);
const EXPENSES = alt(EXPENSE_CATEGORY_CODES);
/** Catégorie d'achat libre (`PurchaseCategoryCode`, ADR-0044). */
const PURCHASE_CATEGORY = '[a-z][a-z_]{1,39}';
/** Moyen de paiement fournisseur (`SupplierPaymentChannel`). */
const CHANNEL = '[a-z][a-z_]{1,39}';

/** Familles de clés, dans l'ordre du § 6 ; `example` sert à l'affichage et aux tests. */
export const OPERATION_KEY_FAMILIES: readonly {
  pattern: RegExp;
  example: string;
  section: string;
}[] = Object.freeze([
  {
    pattern: new RegExp(`^(${SALES})\\.receivable$`),
    example: 'sale.invoice.receivable',
    section: '6.1',
  },
  {
    pattern: new RegExp(`^(${SALES})\\.revenue\\.(BIE|SER)\\.(${REVENUE_GROUPS})$`),
    example: 'sale.invoice.revenue.SER.B',
    section: '6.1',
  },
  {
    pattern: new RegExp(`^(${SALES})\\.vat\\.(${GROUPS})$`),
    example: 'sale.invoice.vat.B',
    section: '6.1',
  },
  {
    pattern: new RegExp(`^(${SALES})\\.nonrevenue\\.(${GROUPS})$`),
    example: 'sale.invoice.nonrevenue.J',
    section: '6.1',
  },
  {
    pattern: new RegExp(`^sale\\.payment_at_issue\\.(${METHODS}|receivable)$`),
    example: 'sale.payment_at_issue.ESPECES',
    section: '6.1',
  },
  {
    pattern: new RegExp(`^receipt\\.(${METHODS}|receivable|unallocated)$`),
    example: 'receipt.VIREMENT',
    section: '6.2',
  },
  {
    pattern: new RegExp(`^expense\\.(${EXPENSES}|payment|vat_declared)$`),
    example: 'expense.loyer',
    section: '6.3',
  },
  {
    pattern: new RegExp(
      `^purchase\\.(invoice|credit_note)\\.(payable|vat_declared|${PURCHASE_CATEGORY})$`,
    ),
    example: 'purchase.invoice.achats',
    section: '6.4',
  },
  {
    pattern: new RegExp(`^purchase\\.payment\\.(payable|unallocated|${CHANNEL})$`),
    example: 'purchase.payment.bank_transfer',
    section: '6.5',
  },
  { pattern: /^transfer\.(treasury|internal)$/, example: 'transfer.internal', section: '6.6' },
  {
    pattern: /^other_(in|out)\.(treasury|counterpart)$/,
    example: 'other_in.counterpart',
    section: '6.6',
  },
  {
    pattern: new RegExp(`^stock\\.(${alt(STOCK_MOVEMENT_KINDS)})$`),
    example: 'stock.purchase_receipt',
    section: '6.7',
  },
  { pattern: /^exchange\.difference$/, example: 'exchange.difference', section: '5' },
]);

/** Vrai si le moteur sait produire une ligne pour cette clé. */
export function isOperationKey(value: unknown): value is string {
  return typeof value === 'string' && OPERATION_KEY_FAMILIES.some((f) => f.pattern.test(value));
}

/**
 * Clés dont la contrepartie va TOUJOURS au compte d'attente, quelle que soit la
 * règle : la nature d'un autre mouvement de trésorerie n'est pas connue de la
 * pièce (§ 6.6, décision ouverte n° 13).
 */
export const ALWAYS_SUSPENSE_KEYS = ['other_in.counterpart', 'other_out.counterpart'] as const;
