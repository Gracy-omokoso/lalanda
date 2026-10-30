// ─────────────────────────────────────────────────────────────────────────────
// Résumé des achats (ADR-0044 § 3.7, § 7)
//
// Par devise, par fournisseur et par catégorie, JAMAIS converti :
// - engagé : reste à facturer (HT) des commandes retenues par l'appelant,
//   calculé par `orderRemainingToInvoice` sur les factures validées ;
// - facturé, avoirs imputés, payé, reste à payer : factures VALIDÉES de type
//   `invoice` ; la ventilation par catégorie suit leurs imputations de coût
//   (facturé = montants des imputations ; avoirs, payé, reste = répartis au
//   prorata par `splitAllocation`).
// La période et les statuts retenus sont le choix de l'appelant.
// ─────────────────────────────────────────────────────────────────────────────

import { orderRemainingToInvoice } from './orders.js';
import { byString, centsOf, checkCurrency, formatCents } from './money.js';
import { splitAllocation } from './payables.js';
import {
  PURCHASES_VERSION,
  type PurchaseCurrency,
  type PurchasesSummary,
  type PurchasesSummaryInput,
  type SummaryFigures,
} from './types.js';

interface Figures {
  committed: bigint;
  invoiced: bigint;
  credited: bigint;
  paid: bigint;
  remaining: bigint;
}
type FigureKey = keyof Figures;

const empty = (): Figures => ({
  committed: 0n,
  invoiced: 0n,
  credited: 0n,
  paid: 0n,
  remaining: 0n,
});
const format = (f: Figures): SummaryFigures => ({
  committed: formatCents(f.committed),
  invoiced: formatCents(f.invoiced),
  credited: formatCents(f.credited),
  paid: formatCents(f.paid),
  remaining: formatCents(f.remaining),
});

/** Clé composite sans ambiguïté (le séparateur ne peut figurer dans une devise). */
const key = (head: string, currency: PurchaseCurrency): string => `${currency}\u0000${head}`;

function categoryOf(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new RangeError(`${what} : catégorie manquante`);
  }
  return value;
}

export function purchasesSummary(input: PurchasesSummaryInput): PurchasesSummary {
  const byCurrency = new Map<PurchaseCurrency, Figures>();
  const bySupplier = new Map<
    string,
    Figures & { supplierId: string; currency: PurchaseCurrency }
  >();
  const byCategory = new Map<string, Figures & { category: string; currency: PurchaseCurrency }>();

  const bump = (
    currency: PurchaseCurrency,
    supplierId: string,
    category: string,
    field: FigureKey,
    amount: bigint,
    countSupplier = true,
  ): void => {
    const c = byCurrency.get(currency) ?? empty();
    const s = bySupplier.get(key(supplierId, currency)) ?? { ...empty(), supplierId, currency };
    const k = byCategory.get(key(category, currency)) ?? { ...empty(), category, currency };
    if (countSupplier) {
      c[field] += amount;
      s[field] += amount;
    }
    k[field] += amount;
    byCurrency.set(currency, c);
    bySupplier.set(key(supplierId, currency), s);
    byCategory.set(key(category, currency), k);
  };

  // Engagé : une imputation par ligne de commande, catégorie de la ligne.
  input.orders.forEach((order, o) => {
    const currency = checkCurrency(order.currency, `Commande ${order.id}`);
    const rest = orderRemainingToInvoice(order, input.invoices);
    rest.lines.forEach((line, l) => {
      const amount = centsOf(line.remainingAmount, 'Reste à facturer');
      if (amount === 0n) return;
      bump(
        currency,
        order.supplierId,
        categoryOf(line.category, `Commande ${o + 1}, ligne ${l + 1}`),
        'committed',
        amount,
      );
    });
  });

  // Facturé, avoirs, payé, reste : factures validées seulement.
  for (const invoice of input.invoices) {
    if (invoice.status !== 'validated' || invoice.kind !== 'invoice') continue;
    const currency = checkCurrency(invoice.currency, `Facture ${invoice.id}`);
    const allocations = invoice.costAllocations;
    if (allocations.length === 0) throw new RangeError(`Facture ${invoice.id} : aucune imputation`);
    const categories = allocations.map((a, i) =>
      categoryOf(a.category, `Facture ${invoice.id}, imputation ${i + 1}`),
    );
    const total = centsOf(invoice.total, `Facture ${invoice.id} : total`);
    const allocated = allocations.reduce(
      (s, a, i) => s + centsOf(a.amount, `Imputation ${i + 1}`),
      0n,
    );
    if (allocated !== total) {
      throw new RangeError(`Facture ${invoice.id} : imputations différentes du total`);
    }
    const parts: [FigureKey, readonly string[]][] = [
      ['invoiced', allocations.map((a) => a.amount)],
      ['credited', splitAllocation(invoice.settlement.credited, allocations).shares],
      ['paid', splitAllocation(invoice.settlement.paid, allocations).shares],
      ['remaining', splitAllocation(invoice.settlement.remaining, allocations).shares],
    ];
    for (const [field, shares] of parts) {
      // Devise et fournisseur : le montant entier de la facture, une fois.
      const whole = shares.reduce((s, v) => s + centsOf(v, 'Part'), 0n);
      const c = byCurrency.get(currency) ?? empty();
      c[field] += whole;
      byCurrency.set(currency, c);
      const sk = key(invoice.supplierId, currency);
      const s = bySupplier.get(sk) ?? { ...empty(), supplierId: invoice.supplierId, currency };
      s[field] += whole;
      bySupplier.set(sk, s);
      shares.forEach((share, i) =>
        bump(
          currency,
          invoice.supplierId,
          categories[i] as string,
          field,
          centsOf(share, 'Part'),
          false,
        ),
      );
    }
  }

  return {
    version: PURCHASES_VERSION,
    byCurrency: [...byCurrency.entries()]
      .sort(([a], [b]) => byString(a, b))
      .map(([currency, f]) => ({ currency, ...format(f) })),
    bySupplier: [...bySupplier.values()]
      .sort((a, b) => byString(a.currency, b.currency) || byString(a.supplierId, b.supplierId))
      .map((f) => ({ supplierId: f.supplierId, currency: f.currency, ...format(f) })),
    byCategory: [...byCategory.values()]
      .sort((a, b) => byString(a.currency, b.currency) || byString(a.category, b.category))
      .map((f) => ({ category: f.category, currency: f.currency, ...format(f) })),
  };
}
