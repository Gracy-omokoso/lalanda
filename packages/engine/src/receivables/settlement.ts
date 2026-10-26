// ─────────────────────────────────────────────────────────────────────────────
// Encaissements et statut de règlement (ADR-0031 § 1 et § 2)
//
// - `checkReceipt` : un encaissement est un montant positif, reçu par l'un des
//   six moyens de règlement, entièrement lettré sur des factures distinctes, et
//   aucun lettrage ne dépasse le reste à encaisser de sa facture. Tous les
//   problèmes sont rendus d'un coup.
// - `computeSettlement` : reste à encaisser = part CREDIT − avoirs à crédit
//   imputés − encaissements ; jamais négatif, l'excédent est rendu à part
//   (« crédit client »). Le statut « en retard » exige une échéance renseignée.
// ─────────────────────────────────────────────────────────────────────────────

import { isCalendarDate } from './calendar.js';
import { formatPositive, positiveAmountOf, sum, trustedAmount, type Fixed } from './money.js';
import {
  RECEIPT_METHODS,
  RECEIVABLES_VERSION,
  type ReceiptCheck,
  type ReceiptCheckInput,
  type ReceiptIssue,
  type Settlement,
  type SettlementInput,
  type SettlementStatus,
} from './types.js';

const METHODS: readonly string[] = RECEIPT_METHODS;

export function checkReceipt(input: ReceiptCheckInput): ReceiptCheck {
  const issues: ReceiptIssue[] = [];
  const amount = positiveAmountOf(input.amount);
  if (amount === null) {
    issues.push({
      code: 'RECEIPT_AMOUNT_INVALID',
      allocationIndex: null,
      message: 'Le montant encaissé doit être positif, avec deux décimales au plus.',
    });
  }
  if (!METHODS.includes(input.method)) {
    issues.push({
      code: 'RECEIPT_METHOD_INVALID',
      allocationIndex: null,
      message:
        'Moyen de règlement inconnu : espèces, virement, carte bancaire, mobile money, chèque ou autre.',
      details: { method: String(input.method) },
    });
  }
  if (input.allocations.length === 0) {
    issues.push({
      code: 'RECEIPT_NO_ALLOCATION',
      allocationIndex: null,
      message: 'Rattachez l’encaissement à au moins une facture.',
    });
  }

  const seen = new Set<string>();
  const parsed: (Fixed | null)[] = [];
  input.allocations.forEach((allocation, index) => {
    const value = positiveAmountOf(allocation.amount);
    parsed.push(value);
    if (value === null) {
      issues.push({
        code: 'RECEIPT_ALLOCATION_INVALID',
        allocationIndex: index,
        message: 'Chaque montant imputé doit être positif, avec deux décimales au plus.',
      });
    }
    if (seen.has(allocation.invoiceId)) {
      issues.push({
        code: 'RECEIPT_ALLOCATION_DUPLICATE',
        allocationIndex: index,
        message: 'Une même facture ne peut figurer qu’une fois dans un encaissement.',
        details: { invoiceId: allocation.invoiceId },
      });
    }
    seen.add(allocation.invoiceId);
    const balanceRaw = input.outstandingByInvoice[allocation.invoiceId];
    if (balanceRaw === undefined) {
      // L'appelant résout chaque facture avant le contrôle (404 sinon).
      throw new RangeError(`Reste à encaisser inconnu pour la facture ${allocation.invoiceId}`);
    }
    const balance = trustedAmount(balanceRaw, 'Reste à encaisser');
    if (value !== null && value > balance) {
      issues.push({
        code: 'RECEIPT_ALLOCATION_EXCEEDS_BALANCE',
        allocationIndex: index,
        message: `Le montant imputé dépasse le reste à encaisser de la facture (${formatPositive(balance)}).`,
        details: { invoiceId: allocation.invoiceId, outstanding: formatPositive(balance) },
      });
    }
  });

  // L'écart de somme n'a de sens que si chaque montant est lisible.
  if (amount !== null && parsed.length > 0 && parsed.every((v) => v !== null)) {
    const allocated = sum(parsed as Fixed[]);
    if (allocated !== amount) {
      issues.push({
        code: 'RECEIPT_ALLOCATIONS_MISMATCH',
        allocationIndex: null,
        message: `La somme imputée (${formatPositive(allocated)}) doit égaler le montant encaissé (${formatPositive(amount)}).`,
        details: { allocated: formatPositive(allocated), amount: formatPositive(amount) },
      });
    }
  }
  return { ok: issues.length === 0, issues };
}

export function computeSettlement(input: SettlementInput): Settlement {
  if (!isCalendarDate(input.asOf)) throw new RangeError(`Date du jour illisible : ${input.asOf}`);
  if (input.dueDate !== null && !isCalendarDate(input.dueDate)) {
    throw new RangeError(`Échéance illisible : ${input.dueDate}`);
  }
  const due = trustedAmount(input.amountOnCredit, 'Part à crédit');
  const credited = sum(input.creditNoteCredits.map((v) => trustedAmount(v, 'Avoir à crédit')));
  const received = sum(input.allocations.map((v) => trustedAmount(v, 'Lettrage')));
  const settled = credited + received;
  const remaining = due - settled;
  const outstanding = remaining > 0n ? remaining : 0n;
  const creditBalance = remaining < 0n ? -remaining : 0n;
  // Dates canoniques AAAA-MM-JJ : l'ordre lexicographique est l'ordre du calendrier.
  const overdue = outstanding > 0n && input.dueDate !== null && input.asOf > input.dueDate;

  let status: SettlementStatus;
  if (outstanding === 0n) status = 'paid';
  else if (overdue) status = 'overdue';
  else if (settled > 0n) status = 'partially_paid';
  else status = 'unpaid';

  return {
    status,
    overdue,
    due: formatPositive(due),
    credited: formatPositive(credited),
    received: formatPositive(received),
    outstanding: formatPositive(outstanding),
    creditBalance: formatPositive(creditBalance),
    version: RECEIVABLES_VERSION,
  };
}
