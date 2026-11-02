// Module « Finances du site » de la console (ADR-0053 § 6.8 — lot P7). Fonctions pures,
// testées. Les nombres viennent du moteur (`platform-revenue`, servi par l'API) : ici on
// les AFFICHE, sans recalcul, sans conversion de devise, sans arrondi caché.
//
// Vocabulaire (décision ouverte n° 14, défaut) : « encaissements constatés », « revenu
// récurrent déclaré », « montants attendus » ; jamais un mot réservé aux pièces fiscales
// tant qu'ADR-0047 n'est pas tranché (`findForbiddenPlatformFinanceWords`, testé).

import { API_URL, jsonRequest, type Plan } from '@/lib/api';

import { LIBELLES_PLAN } from './admin-model';

export interface MontantDevise {
  currency: string;
  totalCents: number;
  count: number;
}

/** Réponse de `GET /admin/finance` (rapport du moteur, agrégats seulement). */
export interface FinancesView {
  version: string;
  period: { from: string; to: string };
  receipts: {
    total: MontantDevise[];
    byMonth: Array<{ month: string; byCurrency: MontantDevise[] }>;
    byPlan: Array<{ plan: string; byCurrency: MontantDevise[] }>;
    byMethod: Array<{ method: string; byCurrency: MontantDevise[] }>;
  };
  providerEventsWithoutAmount: Array<{ provider: string; count: number }>;
  declaredRecurring: Array<{
    currency: string;
    monthlySubscriptionsCents: number;
    yearlySubscriptionsCents: number;
    monthlyEquivalentCents: number;
    subscriptions: number;
  }>;
  recurringExclusions: { neverPaid: number; withoutPublishedTariff: number };
  manualQueue: { pending: MontantDevise[]; expired: MontantDevise[]; rejected: MontantDevise[] };
  subscriptionsAtRisk: { pastDue: number; grace: number };
}

const MOIS_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function moisValide(mois: string): boolean {
  return MOIS_RE.test(mois);
}

/** Période saisie : deux mois valides, début avant fin ; sinon le message à afficher. */
export function erreurPeriode(from: string, to: string): string | null {
  if (!moisValide(from) || !moisValide(to)) return 'Choisissez un mois de début et de fin.';
  if (from > to) return 'Le mois de début doit précéder le mois de fin.';
  return null;
}

function requete(from: string, to: string): string {
  const p = new URLSearchParams();
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  const q = p.toString();
  return q ? `?${q}` : '';
}

export const chargerFinances = (from = '', to = ''): Promise<FinancesView> =>
  jsonRequest<FinancesView>(`/admin/finance${requete(from, to)}`, { method: 'GET' });

/** Export CSV (journalisé côté API) : fichier à enregistrer. */
export async function telechargerExportFinances(
  from: string,
  to: string,
): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(`${API_URL}/admin/finance/export.csv${requete(from, to)}`, {
    method: 'GET',
    credentials: 'include',
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  const cd = res.headers.get('content-disposition') ?? '';
  const match = cd.match(/filename="([^"]+)"/);
  return { blob: await res.blob(), filename: match?.[1] ?? 'encaissements-constates.csv' };
}

/**
 * `5801, 'USD'` → `58,01 USD`. Arithmétique entière : la devise est écrite telle que
 * servie, jamais convertie ni devinée.
 */
export function formaterMontant(cents: number, devise: string): string {
  const signe = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(cents));
  const unites = new Intl.NumberFormat('fr-FR').format(Math.trunc(abs / 100));
  return `${signe}${unites},${String(abs % 100).padStart(2, '0')} ${devise}`;
}

/** Plusieurs devises, une par ligne de texte ; « — » s'il n'y a rien. */
export function formaterMontants(lignes: readonly MontantDevise[]): string {
  const utiles = lignes.filter((l) => l.count > 0 || l.totalCents > 0);
  if (utiles.length === 0) return '—';
  return utiles.map((l) => formaterMontant(l.totalCents, l.currency)).join(' · ');
}

export function nombreDeDepots(lignes: readonly MontantDevise[]): number {
  return lignes.reduce((n, l) => n + l.count, 0);
}

const MOIS = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
];

/** `2026-10` → `oct. 2026`. */
export function libelleMois(mois: string): string {
  if (!moisValide(mois)) return mois;
  const [a, m] = mois.split('-');
  return `${MOIS[Number(m) - 1]} ${a}`;
}

const LIBELLES_MOYEN: Record<string, string> = {
  mobile_money: 'Mobile money',
  bank_transfer: 'Virement bancaire',
};

export function libelleMoyen(cle: string): string {
  return LIBELLES_MOYEN[cle] ?? cle;
}

export function libelleOffre(cle: string): string {
  return LIBELLES_PLAN[cle as Plan] ?? cle;
}

const LIBELLES_FOURNISSEUR: Record<string, string> = { stripe: 'Stripe', paypal: 'PayPal' };

export function libelleFournisseur(cle: string): string {
  return LIBELLES_FOURNISSEUR[cle] ?? cle;
}

/** Libellés fixes de l'écran — testés contre les mots réservés aux pièces fiscales. */
export const LIBELLES_FINANCES = {
  encaissements: 'Encaissements constatés',
  aideEncaissements:
    'Sommes des dépôts manuels confirmés par un opérateur, au montant de la demande, présentées par devise sans conversion. Les octrois sans paiement n’y entrent jamais. Ce n’est pas un résultat comptable ni fiscal : aucune pièce n’est encore remise aux abonnés (ADR-0047).',
  parMois: 'Par mois',
  parOffre: 'Par offre',
  parMoyen: 'Par moyen',
  rappels: 'Paiements en ligne reçus, sans montant',
  aideRappels:
    'Rappels signés des prestataires en ligne. Lalanda n’en conserve pas le montant : ils sont comptés, jamais additionnés.',
  recurrent: 'Revenu récurrent déclaré',
  aideRecurrent:
    'Abonnements actifs déjà payés au moins une fois, au tarif publié, ramenés au mois (annuels divisés par douze). Indicateur de pilotage, pas une créance.',
  file: 'Demandes de paiement manuel',
  enAttente: 'En attente (montants attendus)',
  expirees: 'Expirées sur la période',
  refusees: 'Refusées sur la période',
  risque: 'Abonnements à surveiller',
  export: 'Exporter (CSV)',
  aideExport: 'L’export est inscrit au journal plateforme.',
} as const;
