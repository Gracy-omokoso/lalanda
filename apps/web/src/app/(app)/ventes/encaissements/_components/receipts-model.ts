// Logique pure de l'onglet Encaissements et de la pastille de règlement
// (ADR-0031). Testable sans DOM ; les `.tsx` assemblent.
//
// Mêmes règles que `sales-model.ts`, imposées par un test de lecture des
// sources :
// 1. AUCUN CALCUL DE MONTANT. Reste à encaisser, statut, totaux mensuels et
//    réalisé viennent du moteur via l'API. Un montant saisi est vérifié dans sa
//    FORME puis transmis en chaîne ; ni `Number()`, ni `parseFloat`.
// 2. RIEN N'AUTORISE. Le serveur reste seul juge ; ses refus s'affichent.

import type {
  ActualsBridgeView,
  ActualsSyncOutcome,
  ActualsSyncReport,
  InvoiceSummary,
  ReceiptBody,
  ReceiptMethod,
  SettlementStatus,
  SettlementView,
} from '@/lib/api';

import {
  codeErreur,
  formatMontant,
  lireMontantSaisi,
  messageVentes,
} from '../../_components/sales-model';

// ─────────────────────────────────────────────────────────────────────────────
// Libellés
// ─────────────────────────────────────────────────────────────────────────────

/** Les six moyens de règlement (modes e-DEF hors « à crédit »), ordre d'affichage. */
export const RECEIPT_METHODS: readonly { valeur: ReceiptMethod; label: string }[] = [
  { valeur: 'MOBILEMONEY', label: 'Mobile money' },
  { valeur: 'VIREMENT', label: 'Virement' },
  { valeur: 'ESPECES', label: 'Espèces' },
  { valeur: 'CARTEBANCAIRE', label: 'Carte bancaire' },
  { valeur: 'CHEQUES', label: 'Chèque' },
  { valeur: 'AUTRE', label: 'Autre' },
];

export function libelleMoyen(method: string): string {
  return RECEIPT_METHODS.find((m) => m.valeur === method)?.label ?? method;
}

export const SETTLEMENT_LABELS: Record<SettlementStatus, string> = {
  unpaid: 'Non payée',
  partially_paid: 'Partiellement payée',
  paid: 'Payée',
  overdue: 'En retard',
};

/** Pastille de règlement d'une facture ; `null` quand elle n'a pas de règlement. */
export function pastilleReglement(
  vue: SettlementView | undefined,
): { label: string; ton: 'neutre' | 'attention' } | null {
  if (!vue || vue.status === 'not_applicable') return null;
  return {
    label: SETTLEMENT_LABELS[vue.status],
    ton: vue.status === 'overdue' ? 'attention' : 'neutre',
  };
}

/** Factures de la liste qui peuvent porter un règlement (définitives, hors avoirs). */
export function facturesAReglement(items: readonly InvoiceSummary[]): string[] {
  return items
    .filter(
      (d) =>
        (d.status === 'issued' || d.status === 'normalized') && d.type !== 'FA' && d.type !== 'EA',
    )
    .map((d) => d.id)
    .slice(0, 100);
}

const MOIS: Readonly<Record<string, string>> = {
  '01': 'janv.',
  '02': 'févr.',
  '03': 'mars',
  '04': 'avr.',
  '05': 'mai',
  '06': 'juin',
  '07': 'juil.',
  '08': 'août',
  '09': 'sept.',
  '10': 'oct.',
  '11': 'nov.',
  '12': 'déc.',
};

/** `2026-10` → `oct. 2026` ; une valeur illisible est rendue telle quelle. */
export function libelleMois(mois: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(mois);
  const nom = m ? MOIS[m[2] ?? ''] : undefined;
  return m && nom ? `${nom} ${m[1]}` : mois;
}

/** `2026-10-21` → `21 oct. 2026`. */
export function libelleJour(jour: string | null): string {
  if (!jour) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(jour);
  const nom = m ? MOIS[m[2] ?? ''] : undefined;
  return m && nom ? `${(m[3] ?? '').replace(/^0/, '')} ${nom} ${m[1]}` : jour;
}

/** Jour civil à Kinshasa (`AAAA-MM-JJ`), comme l'API. */
export function aujourdhuiKinshasa(maintenant: Date): string {
  const parts: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Kinshasa',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(maintenant)) {
    parts[p.type] = p.value;
  }
  return `${parts['year']}-${parts['month']}-${parts['day']}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Formulaire d'encaissement
// ─────────────────────────────────────────────────────────────────────────────

export interface LigneLettrage {
  invoiceId: string;
  /** Libellé affiché (numéro et client), non transmis. */
  libelle: string;
  montant: string;
}

export interface FormulaireEncaissement {
  receivedOn: string;
  currency: 'CDF' | 'USD';
  method: ReceiptMethod | '';
  reference: string;
  note: string;
  /** Montant total ; ignoré quand une seule facture est lettrée (= son montant). */
  total: string;
  lignes: LigneLettrage[];
}

export function formulaireVide(aujourdhui: string): FormulaireEncaissement {
  return {
    receivedOn: aujourdhui,
    currency: 'USD',
    method: '',
    reference: '',
    note: '',
    total: '',
    lignes: [],
  };
}

/** Ajoute une facture à lettrer, préremplie de son reste à encaisser (chaîne du moteur). */
export function ajouterFacture(
  f: FormulaireEncaissement,
  vue: SettlementView,
): FormulaireEncaissement {
  if (f.lignes.some((l) => l.invoiceId === vue.invoiceId)) return f;
  const memeDevise = f.lignes.length === 0 || f.currency === vue.currency;
  if (!memeDevise) return f;
  return {
    ...f,
    currency: vue.currency,
    lignes: [
      ...f.lignes,
      {
        invoiceId: vue.invoiceId,
        libelle: `${vue.number ?? '—'} · ${vue.customerName ?? 'Vente de comptoir'}`,
        montant: (vue.settlement?.outstanding ?? '').replace('.', ','),
      },
    ],
  };
}

export type ChampEncaissement = 'receivedOn' | 'method' | 'total' | 'lignes' | `ligne.${number}`;

export type PreparationEncaissement =
  | { ok: true; body: ReceiptBody }
  | { ok: false; erreurs: Partial<Record<ChampEncaissement, string>> };

/** Vérifie la FORME du formulaire ; la somme et les plafonds, c'est le moteur. */
export function preparerEncaissement(f: FormulaireEncaissement): PreparationEncaissement {
  const erreurs: Partial<Record<ChampEncaissement, string>> = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.receivedOn))
    erreurs.receivedOn = 'Indiquez la date de réception.';
  if (f.method === '') erreurs.method = 'Choisissez le moyen de règlement.';
  if (f.lignes.length === 0) erreurs.lignes = 'Choisissez au moins une facture.';
  const allocations: { invoiceId: string; amount: string }[] = [];
  f.lignes.forEach((l, i) => {
    const lu = lireMontantSaisi(l.montant);
    if (lu.ok) allocations.push({ invoiceId: l.invoiceId, amount: lu.valeur });
    else erreurs[`ligne.${i}`] = lu.erreur;
  });
  let amount: string | null = null;
  if (f.lignes.length === 1) {
    amount = allocations[0]?.amount ?? null;
  } else if (f.lignes.length > 1) {
    const lu = lireMontantSaisi(f.total);
    if (lu.ok) amount = lu.valeur;
    else erreurs.total = lu.erreur;
  }
  if (Object.keys(erreurs).length > 0 || amount === null || f.method === '') {
    return { ok: false, erreurs };
  }
  const reference = f.reference.trim();
  const note = f.note.trim();
  return {
    ok: true,
    body: {
      receivedOn: f.receivedOn,
      amount,
      currency: f.currency,
      method: f.method,
      reference: reference === '' ? null : reference,
      note: note === '' ? null : note,
      allocations,
    },
  };
}

/** Message d'un refus d'encaissement : le détail du moteur quand il existe. */
export function messageEncaissement(err: unknown, repli: string): string {
  if (codeErreur(err) === 'RECEIPT_INVALID') {
    const detail = (err as { detail?: { details?: { issues?: unknown } } }).detail;
    const issues = detail?.details?.issues;
    if (Array.isArray(issues)) {
      const messages = issues
        .map((i) =>
          typeof i === 'object' && i !== null ? (i as { message?: unknown }).message : null,
        )
        .filter((m): m is string => typeof m === 'string' && m !== '');
      if (messages.length > 0) return messages.join(' ');
    }
  }
  return messageVentes(err, repli);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pont vers le réalisé
// ─────────────────────────────────────────────────────────────────────────────

export const BRIDGE_STATE_LABELS: Record<ActualsBridgeView['state'], string> = {
  disabled: 'Désactivé : les ventes n’alimentent aucun plan',
  not_configured: 'Activé mais incomplet : choisissez l’initiative, la ligne et le début d’exercice',
  active: 'Actif : le chiffre d’affaires des ventes alimente le réalisé de l’initiative',
};

export const OUTCOME_LABELS: Record<ActualsSyncOutcome, string> = {
  written: 'Reporté',
  unchanged: 'Déjà à jour',
  removed: 'Retiré (plus de vente ce mois-là)',
  PERIOD_CLOSED: 'Période clôturée : non modifiée',
  MANUAL_VALUE_PRESENT:
    'Saisie manuelle conservée : effacez-la pour laisser les ventes l’alimenter',
  OTHER_SOURCE_PRESENT: 'Ligne alimentée par les dépenses : non écrasée',
};

export const SKIP_LABELS: Record<ActualsSyncReport['skipped'][number]['reason'], string> = {
  OUTSIDE_PLAN_HORIZON: 'Hors des cinq exercices du plan',
  CURRENCY_NOT_CONVERTIBLE:
    'Une vente est dans une autre devise que l’initiative : aucun taux n’est appliqué, le mois n’est pas reporté',
};

/** Le résultat d'une synchronisation demande-t-il l'attention de la personne ? */
export function syncDemandeAttention(rapport: ActualsSyncReport): boolean {
  return rapport.counts.blocked > 0 || rapport.counts.skipped > 0;
}

/** Montant signé du moteur (`"-40.00"`) à la française, par manipulation de chaîne. */
export function formatMontantSigne(valeur: string | null, devise: string): string {
  if (valeur === null) return '—';
  return valeur.startsWith('-')
    ? `−${formatMontant(valeur.slice(1), devise)}`
    : formatMontant(valeur, devise);
}

/** `exercice 1, mois 4` — repère du réalisé BUILD (docs/08, convention 1). */
export function libellePeriodeExercice(year: number, month: number): string {
  return `exercice ${year}, mois ${month}`;
}
