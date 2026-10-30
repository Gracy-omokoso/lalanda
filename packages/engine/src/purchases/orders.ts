// ─────────────────────────────────────────────────────────────────────────────
// Demandes et bons de commande (ADR-0044 § 2.3, § 7)
//
// - `computeOrderTotals` : ligne = quantité × prix × (1 − remise), UN SEUL
//   arrondi au centime par ligne (demi vers le haut) ; taxes DÉCLARÉES
//   additionnées telles quelles, jamais calculées (§ 9). Sert aussi au
//   sous-total d'une facture fournisseur saisie avec des lignes (§ 2.5).
// - `requiredApprovals` : palier de la devise de la commande (le plus haut dont
//   `from` ≤ total TTC) ; aucune conversion entre devises (O4).
// - `orderReceptionStatus` : reçu et reste à recevoir par ligne, statut dérivé.
// - `orderRemainingToInvoice` : reste à facturer par ligne (préremplissage
//   `from-order`, engagé du résumé).
// ─────────────────────────────────────────────────────────────────────────────

import {
  centsOf,
  checkCurrency,
  discountOf,
  formatCents,
  formatQuantity,
  lineCents,
  positiveMilliOf,
  scaledOf,
  sumOf,
} from './money.js';
import {
  PURCHASES_VERSION,
  type ApprovalTier,
  type ApprovalTierIssue,
  type ApprovalTiersByCurrency,
  type ApprovalTiersCheck,
  type DeclaredTaxInput,
  type InvoicedLinesInput,
  type OrderReceptionLine,
  type OrderReceptionStatus,
  type OrderTotals,
  type PurchaseCurrency,
  type PurchaseLineInput,
  type PurchaseOrderStatus,
  type PurchaseReceptionInput,
  type ReceptionOrderInput,
  type RemainingToInvoice,
  type RemainingToInvoiceOrderInput,
  type RequiredApprovals,
} from './types.js';

/** Montant HT d'une ligne, en centimes. */
export function lineAmountCents(line: PurchaseLineInput, what: string): bigint {
  return lineCents(
    positiveMilliOf(line.quantity, `${what} : quantité`),
    centsOf(line.unitPrice, `${what} : prix unitaire`),
    discountOf(line.discountPercent, `${what} : remise`),
  );
}

export function computeOrderTotals(
  lines: readonly PurchaseLineInput[],
  declaredTaxes: readonly DeclaredTaxInput[],
): OrderTotals {
  const amounts = lines.map((line, i) => lineAmountCents(line, `Ligne ${i + 1}`));
  const subtotal = sumOf(amounts);
  const taxes = sumOf(declaredTaxes.map((t, i) => centsOf(t.amount, `Taxe ${i + 1}`)));
  return {
    version: PURCHASES_VERSION,
    lines: lines.map((line, i) => ({ id: line.id ?? null, amount: formatCents(amounts[i] ?? 0n) })),
    subtotal: formatCents(subtotal),
    taxes: formatCents(taxes),
    total: formatCents(subtotal + taxes),
  };
}

// ─── Paliers d'approbation ───────────────────────────────────────────────────

const APPROVAL_COUNTS: readonly number[] = [0, 1, 2];

/** Contrôle d'une liste de paliers d'une devise ; tous les problèmes d'un coup. */
export function checkApprovalTiers(tiers: readonly ApprovalTier[]): ApprovalTiersCheck {
  const issues: ApprovalTierIssue[] = [];
  if (tiers.length === 0) {
    issues.push({
      code: 'APPROVAL_TIERS_EMPTY',
      tierIndex: null,
      message: 'Indiquez au moins un palier, à partir de 0.',
    });
    return { ok: false, issues };
  }
  let previous: bigint | null = null;
  tiers.forEach((tier, index) => {
    const from = scaledOf(tier.from, 2);
    if (from === null) {
      issues.push({
        code: 'APPROVAL_TIER_FROM_INVALID',
        tierIndex: index,
        message: 'Le seuil doit être un montant positif ou nul, avec deux décimales au plus.',
      });
    } else {
      if (index === 0 && from !== 0n) {
        issues.push({
          code: 'APPROVAL_TIER_FIRST_NOT_ZERO',
          tierIndex: 0,
          message: 'Le premier palier commence à 0.',
        });
      }
      if (previous !== null && from <= previous) {
        issues.push({
          code: 'APPROVAL_TIERS_NOT_INCREASING',
          tierIndex: index,
          message: 'Les seuils doivent être strictement croissants.',
        });
      }
      previous = from;
    }
    if (!Number.isInteger(tier.approvals) || !APPROVAL_COUNTS.includes(tier.approvals)) {
      issues.push({
        code: 'APPROVAL_TIER_APPROVALS_INVALID',
        tierIndex: index,
        message: 'Un palier exige 0, 1 ou 2 approbations.',
      });
    }
  });
  return { ok: issues.length === 0, issues };
}

export function requiredApprovals(
  tiers: ApprovalTiersByCurrency,
  currency: PurchaseCurrency,
  total: string,
): RequiredApprovals {
  const cur = checkCurrency(currency, 'Commande');
  const list = tiers[cur];
  if (list === undefined) throw new RangeError(`Aucun palier pour la devise ${cur}`);
  const check = checkApprovalTiers(list);
  if (!check.ok) {
    throw new RangeError(
      `Paliers ${cur} invalides : ${check.issues.map((i) => i.code).join(', ')}`,
    );
  }
  const amount = centsOf(total, 'Total de la commande');
  let chosen = 0;
  list.forEach((tier, index) => {
    if (centsOf(tier.from, 'Seuil') <= amount) chosen = index;
  });
  const tier = list[chosen] as ApprovalTier;
  return {
    version: PURCHASES_VERSION,
    currency: cur,
    approvals: tier.approvals,
    tierIndex: chosen,
    from: formatCents(centsOf(tier.from, 'Seuil')),
  };
}

// ─── Réceptions ──────────────────────────────────────────────────────────────

/** Statuts d'une commande vivante, dont le statut se dérive des réceptions. */
const LIVE_ORDER_STATUSES: readonly PurchaseOrderStatus[] = [
  'approved',
  'sent',
  'partially_received',
  'received',
];

/** Σ reçu par ligne de commande, réceptions non annulées. */
function receivedByLine(
  lineIds: ReadonlySet<string>,
  receptions: readonly PurchaseReceptionInput[],
): Map<string, bigint> {
  const received = new Map<string, bigint>();
  receptions.forEach((reception, r) => {
    if (reception.status === 'cancelled') return;
    if (reception.status !== 'recorded') {
      throw new RangeError(`Réception ${r + 1} : statut inconnu ${String(reception.status)}`);
    }
    reception.lines.forEach((line, l) => {
      if (!lineIds.has(line.orderLineId)) {
        throw new RangeError(`Réception ${r + 1} : ligne de commande inconnue ${line.orderLineId}`);
      }
      const q = positiveMilliOf(line.quantity, `Réception ${r + 1}, ligne ${l + 1}`);
      received.set(line.orderLineId, (received.get(line.orderLineId) ?? 0n) + q);
    });
  });
  return received;
}

export function orderReceptionStatus(
  order: ReceptionOrderInput,
  receptions: readonly PurchaseReceptionInput[],
): OrderReceptionStatus {
  const ids = new Set<string>();
  for (const line of order.lines) {
    if (ids.has(line.id)) throw new RangeError(`Ligne de commande en double : ${line.id}`);
    ids.add(line.id);
  }
  const received = receivedByLine(ids, receptions);
  let anyReceived = false;
  let receivableCount = 0;
  let complete = 0;
  const lines: OrderReceptionLine[] = order.lines.map((line) => {
    const ordered = positiveMilliOf(line.quantity, `Ligne ${line.id} : quantité`);
    const got = received.get(line.id) ?? 0n;
    if (line.receivable) {
      receivableCount += 1;
      if (got > 0n) anyReceived = true;
      if (got >= ordered) complete += 1;
    }
    return {
      orderLineId: line.id,
      receivable: line.receivable,
      ordered: formatQuantity(ordered),
      received: formatQuantity(got),
      remaining: formatQuantity(ordered > got ? ordered - got : 0n),
      overReceived: formatQuantity(got > ordered ? got - ordered : 0n),
    };
  });
  const fullyReceived = receivableCount > 0 && complete === receivableCount;
  let status = order.status;
  if (LIVE_ORDER_STATUSES.includes(order.status)) {
    if (fullyReceived) status = 'received';
    else if (anyReceived) status = 'partially_received';
    else status = order.sent ? 'sent' : 'approved';
  }
  return { version: PURCHASES_VERSION, status, lines, anyReceived, fullyReceived };
}

// ─── Reste à facturer ────────────────────────────────────────────────────────

/**
 * Σ facturé par ligne de commande sur les factures VALIDÉES (avoirs exclus), en
 * millièmes. Les lignes visant une autre commande sont ignorées.
 */
export function invoicedByOrderLine(
  invoices: readonly InvoicedLinesInput[],
  excludeInvoiceId: string | null,
): Map<string, bigint> {
  const invoiced = new Map<string, bigint>();
  for (const invoice of invoices) {
    if (invoice.id === excludeInvoiceId) continue;
    if (invoice.status !== 'validated' || invoice.kind !== 'invoice') continue;
    invoice.lines.forEach((line, l) => {
      if (line.orderLineId === null) return;
      const q = positiveMilliOf(line.quantity, `Facture ${invoice.id}, ligne ${l + 1}`);
      invoiced.set(line.orderLineId, (invoiced.get(line.orderLineId) ?? 0n) + q);
    });
  }
  return invoiced;
}

export function orderRemainingToInvoice(
  order: RemainingToInvoiceOrderInput,
  invoices: readonly InvoicedLinesInput[],
): RemainingToInvoice {
  const currency = checkCurrency(order.currency, 'Commande');
  const invoiced = invoicedByOrderLine(invoices, null);
  let total = 0n;
  const lines = order.lines.map((line) => {
    const ordered = positiveMilliOf(line.quantity, `Ligne ${line.id} : quantité`);
    const done = invoiced.get(line.id) ?? 0n;
    const rest = ordered > done ? ordered - done : 0n;
    const amount =
      rest === 0n
        ? 0n
        : lineCents(
            rest,
            centsOf(line.unitPrice, `Ligne ${line.id} : prix unitaire`),
            discountOf(line.discountPercent, `Ligne ${line.id} : remise`),
          );
    total += amount;
    return {
      orderLineId: line.id,
      category: line.category ?? null,
      workProjectId: line.workProjectId ?? null,
      ordered: formatQuantity(ordered),
      invoiced: formatQuantity(done),
      remainingQuantity: formatQuantity(rest),
      remainingAmount: formatCents(amount),
    };
  });
  return { version: PURCHASES_VERSION, currency, lines, remainingAmount: formatCents(total) };
}
