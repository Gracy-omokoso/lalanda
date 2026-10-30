// À payer — échéancier par devise, paiement groupé, rattachement d'une dépense
// existante et doublons probables (ADR-0044 § 2.6, § 3.6, § 6.2, O3 ; lot P8).
// Logique pure.
//
// Montants, nombres et restes à payer : ceux de l'API (moteur `payablesSchedule`,
// `payableSettlement`), une devise par ligne, jamais additionnés ni convertis.
// Les factures sont RANGÉES (en retard, bientôt, plus tard) d'après les listes
// filtrées par l'API (`due=overdue`, `due=soon`), jamais par une date comparée ici.
// Le paiement ne calcule rien : le montant payé est saisi (c'est ce qui est sorti
// du compte) et l'API vérifie qu'il égale la somme répartie.

import type { PurchaseCurrency, SupplierPaymentChannel } from '@lalanda/shared/purchases';

import type {
  CreateSupplierPaymentInput,
  EcheancierDeviseView,
  EcheancierView,
  PaymentFromExpenseInput,
  PossibleDuplicateView,
  SupplierInvoiceListItem,
} from '@/lib/api-purchases-payables';

import { formatMontant } from '../../ventes/_components/sales-model';

import { formatJour } from './achats-model';
import { lirePrix } from './commandes-model';

// ── Échéancier ──────────────────────────────────────────────────────────────

export type IdGroupe = 'en-retard' | 'bientot' | 'plus-tard' | 'litiges';

export interface GroupeDevise {
  currency: PurchaseCurrency;
  factures: SupplierInvoiceListItem[];
}

export interface GroupeEcheancier {
  id: IdGroupe;
  titre: string;
  vide: string;
  attention: boolean;
  parDevise: GroupeDevise[];
}

/** Range une liste par devise, dans l'ordre CDF puis USD (jamais additionnée). */
export function parDevise(items: readonly SupplierInvoiceListItem[]): GroupeDevise[] {
  const out: GroupeDevise[] = [];
  for (const currency of ['CDF', 'USD'] as const) {
    const factures = items.filter((i) => i.currency === currency);
    if (factures.length > 0) out.push({ currency, factures });
  }
  return out;
}

const aPayer = (i: SupplierInvoiceListItem): boolean =>
  i.kind === 'invoice' && i.status === 'validated' && i.settlementStatus !== 'paid';

/**
 * Groupes de l'échéancier. `retard` et `bientot` sont les listes filtrées par
 * l'API ; `validees` toutes les factures validées : ce qui n'est ni en retard ni
 * bientôt, ni payé ni en litige, est « plus tard ». Les litiges sont à part.
 */
export function groupesEcheancier(
  retard: readonly SupplierInvoiceListItem[],
  bientot: readonly SupplierInvoiceListItem[],
  validees: readonly SupplierInvoiceListItem[],
  dueSoonDays: number | null,
): GroupeEcheancier[] {
  const dejaRanges = new Set([...retard, ...bientot].map((i) => i.id));
  const ouvertes = (l: readonly SupplierInvoiceListItem[]) =>
    l.filter((i) => aPayer(i) && !i.disputed);
  const litiges = [...retard, ...bientot, ...validees].filter(
    (i, k, tous) => aPayer(i) && i.disputed && tous.findIndex((x) => x.id === i.id) === k,
  );
  return [
    {
      id: 'en-retard',
      titre: 'En retard',
      vide: 'Aucune facture en retard.',
      attention: true,
      parDevise: parDevise(ouvertes(retard)),
    },
    {
      id: 'bientot',
      titre: dueSoonDays === null ? 'À payer bientôt' : `À payer sous ${dueSoonDays} jours`,
      vide: 'Rien à payer dans les prochains jours.',
      attention: false,
      parDevise: parDevise(ouvertes(bientot)),
    },
    {
      id: 'plus-tard',
      titre: 'Plus tard',
      vide: 'Aucune autre facture à payer.',
      attention: false,
      parDevise: parDevise(ouvertes(validees).filter((i) => !dejaRanges.has(i.id))),
    },
    {
      id: 'litiges',
      titre: 'En litige (paiement bloqué)',
      vide: 'Aucune facture en litige.',
      attention: false,
      parDevise: parDevise(litiges),
    },
  ];
}

/** « 1 200,00 USD · 3 factures » : montant et nombre rendus par le moteur. */
function ligneMontant(m: { amount: string; count: number }, devise: PurchaseCurrency): string {
  return `${formatMontant(m.amount, devise)} · ${m.count} facture${m.count > 1 ? 's' : ''}`;
}

/**
 * Totaux d'un groupe, une devise par ligne, lus dans l'échéancier de l'API.
 * `null` si l'échéancier n'est pas lisible (route pas encore livrée).
 */
export function totauxGroupe(e: EcheancierView | null, id: IdGroupe): string[] | null {
  if (e === null) return null;
  const champ = (d: EcheancierDeviseView): { amount: string; count: number }[] => {
    switch (id) {
      case 'en-retard':
        return [d.overdue];
      case 'bientot':
        return [d.dueSoon];
      case 'litiges':
        return [d.disputed];
      default:
        return [];
    }
  };
  if (id === 'plus-tard') return lignesPlusTard(e);
  return e.byCurrency.flatMap((d) =>
    champ(d)
      .filter((m) => m.count > 0)
      .map((m) => ligneMontant(m, d.currency)),
  );
}

const MOIS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

/** « Plus tard » : semaines puis mois rendus par le moteur, une ligne chacun. */
export function lignesPlusTard(e: EcheancierView): string[] {
  return e.byCurrency.flatMap((d) => [
    ...(d.weeks ?? [])
      .filter((w) => w.count > 0)
      .map(
        (w) => `Du ${formatJour(w.from)} au ${formatJour(w.to)} : ${ligneMontant(w, d.currency)}`,
      ),
    ...(d.months ?? [])
      .filter((m) => m.count > 0)
      .map((m) => {
        const [a, mm] = m.month.split('-');
        const nom = MOIS[Number(mm) - 1] ?? m.month;
        return `En ${nom} ${a ?? ''} : ${ligneMontant(m, d.currency)}`;
      }),
  ]);
}

// ── Paiement (§ 2.6) ────────────────────────────────────────────────────────

export const LIBELLES_MOYEN: Record<SupplierPaymentChannel, string> = {
  bank_transfer: 'Virement bancaire',
  mobile_money: 'Mobile money',
  cash: 'Espèces',
  cheque: 'Chèque',
  other: 'Autre',
};

export interface ImputationPaiement {
  invoiceId: string;
  libelle: string;
  /** Reste à payer rendu par l'API (affichage et préremplissage). */
  reste: string;
  echeance: string;
  choisie: boolean;
  montant: string;
}

export interface FormulairePaiement {
  supplierId: string;
  supplierName: string;
  currency: PurchaseCurrency;
  paidOn: string;
  amount: string;
  accountId: string;
  method: SupplierPaymentChannel;
  reference: string;
  imputations: ImputationPaiement[];
}

const versSaisie = (v: string): string => v.replace('.', ',');

/** Factures qu'un paiement peut viser : validées, du fournisseur et de la devise, non payées ni en litige. */
export function facturesPayables(
  items: readonly SupplierInvoiceListItem[],
  supplierId: string,
  currency: PurchaseCurrency,
): SupplierInvoiceListItem[] {
  return items.filter(
    (i) => aPayer(i) && !i.disputed && i.supplierId === supplierId && i.currency === currency,
  );
}

/** Ligne d'imputation proposée pour une facture. */
export function imputationDe(i: SupplierInvoiceListItem, choisie: boolean): ImputationPaiement {
  return {
    invoiceId: i.id,
    libelle: `${i.internalNumber} — réf. ${i.supplierReference}`,
    reste: i.remaining,
    echeance: i.dueDate,
    choisie,
    montant: choisie ? versSaisie(i.remaining) : '',
  };
}

/**
 * Formulaire d'un paiement : les factures payables du fournisseur, celles de
 * `choisies` cochées avec leur reste à payer recopié. Une seule facture cochée :
 * le montant payé reprend son reste (copie, pas un calcul).
 */
export function formulairePaiement(
  factures: readonly SupplierInvoiceListItem[],
  choisies: ReadonlySet<string>,
  aujourdhui: string,
): FormulairePaiement {
  const premiere = factures[0];
  const imputations = factures.map((i) => imputationDe(i, choisies.has(i.id)));
  const cochees = imputations.filter((x) => x.choisie);
  return {
    supplierId: premiere?.supplierId ?? '',
    supplierName: premiere?.supplierName ?? 'Fournisseur',
    currency: premiere?.currency ?? 'USD',
    paidOn: aujourdhui,
    amount: cochees.length === 1 ? cochees[0]!.montant : '',
    accountId: '',
    method: 'bank_transfer',
    reference: '',
    imputations,
  };
}

/** Coche ou décoche une facture ; cochée, son reste à payer est recopié. */
export function basculerImputation(f: FormulairePaiement, invoiceId: string): FormulairePaiement {
  const imputations = f.imputations.map((x) =>
    x.invoiceId === invoiceId
      ? { ...x, choisie: !x.choisie, montant: !x.choisie ? versSaisie(x.reste) : '' }
      : x,
  );
  return { ...f, imputations };
}

const JOUR = /^\d{4}-\d{2}-\d{2}$/;

function imputationsSaisies(
  imputations: readonly ImputationPaiement[],
  montantUnique: string | null,
  champs: Record<string, string>,
): { invoiceId: string; amount: string }[] {
  const cochees = imputations.filter((x) => x.choisie);
  if (cochees.length === 0) champs['imputations'] = 'Cochez au moins une facture.';
  if (cochees.length > 50) champs['imputations'] = '50 factures au plus par paiement.';
  const out: { invoiceId: string; amount: string }[] = [];
  for (const x of cochees) {
    const brut = x.montant.trim() === '' && cochees.length === 1 ? montantUnique : x.montant;
    const m = lirePrix(brut ?? '');
    if (!m.ok) champs[`imputation-${x.invoiceId}`] = m.erreur;
    else if (/^0+(\.0+)?$/.test(m.valeur)) {
      champs[`imputation-${x.invoiceId}`] = 'Le montant doit être supérieur à zéro.';
    } else out.push({ invoiceId: x.invoiceId, amount: m.valeur });
  }
  return out;
}

/**
 * Vérification locale et corps de `POST /purchases/payments`. Le montant payé est
 * saisi ; avec une seule facture et un montant réparti vide, il lui est recopié.
 * L'API refuse si la somme répartie diffère (`SUPPLIER_PAYMENT_ALLOCATION_MISMATCH`)
 * ou dépasse un reste (`SUPPLIER_PAYMENT_EXCEEDS_REMAINING`).
 */
export function preparerPaiement(
  f: FormulairePaiement,
  aujourdhui: string,
): { ok: true; corps: CreateSupplierPaymentInput } | { ok: false; champs: Record<string, string> } {
  const champs: Record<string, string> = {};
  if (!JOUR.test(f.paidOn)) champs['paidOn'] = 'Date du paiement obligatoire.';
  else if (f.paidOn > aujourdhui) champs['paidOn'] = 'La date ne peut pas être future.';
  const montant = lirePrix(f.amount);
  if (!montant.ok) champs['amount'] = montant.erreur;
  else if (/^0+(\.0+)?$/.test(montant.valeur))
    champs['amount'] = 'Le montant doit être supérieur à zéro.';
  if (f.reference.length > 100) champs['reference'] = '100 caractères au plus.';
  const allocations = imputationsSaisies(f.imputations, montant.ok ? montant.valeur : null, champs);
  if (Object.keys(champs).length > 0 || !montant.ok) return { ok: false, champs };
  const reference = f.reference.trim();
  return {
    ok: true,
    corps: {
      supplierId: f.supplierId,
      currency: f.currency,
      paidOn: f.paidOn,
      amount: montant.valeur,
      accountId: f.accountId === '' ? null : f.accountId,
      method: f.method,
      reference: reference === '' ? null : reference,
      allocations,
    },
  };
}

// ── Rattacher une dépense déjà saisie (§ 6.2, O3 b) ─────────────────────────

export interface DepenseCandidate {
  id: string;
  spentOn: string;
  label: string;
  amount: string;
  currency: PurchaseCurrency;
  revision: number;
  supplierName: string | null;
  /** `null` : dépense directe ; non nul : déjà possédée par les achats. */
  origin?: unknown;
  status: 'recorded' | 'cancelled';
}

/** Dépenses rattachables : directes (sans `origin`), enregistrées, dans la devise. */
export function depensesRattachables(
  items: readonly DepenseCandidate[],
  currency: PurchaseCurrency,
): DepenseCandidate[] {
  return items.filter(
    (d) =>
      d.status === 'recorded' &&
      d.currency === currency &&
      (d.origin === undefined || d.origin === null),
  );
}

export const ALERTE_DOUBLE_COMPTE =
  'Si vous avez déjà saisi ce paiement comme dépense dans la trésorerie, rattachez cette dépense au lieu d’enregistrer un nouveau paiement : sinon la même sortie d’argent serait comptée deux fois.';

/**
 * Corps de `POST /purchases/payments/from-expense`. Une seule facture cochée sans
 * montant reçoit le montant de la dépense (copie).
 */
export function preparerRattachement(
  depense: DepenseCandidate | null,
  imputations: readonly ImputationPaiement[],
): { ok: true; corps: PaymentFromExpenseInput } | { ok: false; champs: Record<string, string> } {
  const champs: Record<string, string> = {};
  if (depense === null) champs['expenseId'] = 'Choisissez la dépense déjà saisie.';
  const allocations = imputationsSaisies(imputations, depense?.amount ?? null, champs);
  if (Object.keys(champs).length > 0 || depense === null) return { ok: false, champs };
  return {
    ok: true,
    corps: { expenseId: depense.id, allocations, expectedRevision: depense.revision },
  };
}

// ── Doublons probables (O3 c) ───────────────────────────────────────────────

/** Phrase d'un doublon probable, avec ce que l'API en rend. */
export function phraseDoublon(d: PossibleDuplicateView): string {
  const qui = d.supplierName ?? 'ce fournisseur';
  const ecart =
    d.daysApart === 0
      ? 'le même jour'
      : `à ${d.daysApart} jour${d.daysApart > 1 ? 's' : ''} d’écart`;
  const paiement = d.paymentNumber ? `le paiement ${d.paymentNumber}` : 'un paiement fournisseur';
  const depense = d.expenseLabel
    ? `la dépense « ${d.expenseLabel} »`
    : 'une dépense saisie à la main';
  return `${formatMontant(d.amount, d.currency)} chez ${qui} : ${paiement} et ${depense}, ${ecart}. Vérifiez qu’il ne s’agit pas de la même sortie d’argent ; rien n’est annulé automatiquement.`;
}
