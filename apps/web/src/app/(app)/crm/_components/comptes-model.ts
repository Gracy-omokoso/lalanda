// Comptes et fiche 360° — ADR-0040 § 3.1 et § 8.2. Logique pure.
//
// La fiche 360° affiche ce que l'API rend : aucun montant n'est additionné,
// converti ni arrondi ici. Une section masquée (droit manquant) se dit par une
// PHRASE, jamais par un zéro ni une liste vide.

import type {
  CrmAccountView,
  CrmOverviewSection,
  CrmTimelineEvent,
  CrmTimelineSource,
} from '@lalanda/shared/crm';

import type { AccountBody, ListAccountsQuery } from '@/lib/api-crm';

import { formatMontant } from '../../ventes/_components/sales-model';

// ── Liste ───────────────────────────────────────────────────────────────────

export type FiltreNature = 'tous' | 'prospect' | 'customer';

export interface FiltresComptes {
  nature: FiltreNature;
  q: string;
  archives: boolean;
}

export const FILTRES_COMPTES_INITIAUX: FiltresComptes = { nature: 'tous', q: '', archives: false };

export const FILTRES_NATURE: readonly { valeur: FiltreNature; label: string }[] = [
  { valeur: 'tous', label: 'Tous' },
  { valeur: 'prospect', label: 'Prospects' },
  { valeur: 'customer', label: 'Clients' },
];

export function requeteComptes(f: FiltresComptes, cursor: string | null = null): ListAccountsQuery {
  const q = f.q.trim();
  return {
    ...(f.nature === 'tous' ? {} : { kind: f.nature }),
    ...(q === '' ? {} : { q: q.slice(0, 100) }),
    active: f.archives ? 'false' : 'true',
    limit: 50,
    ...(cursor ? { cursor } : {}),
  };
}

export function libelleNature(kind: CrmAccountView['kind']): string {
  return kind === 'customer' ? 'Client' : 'Prospect';
}

// ── Sections de la fiche 360° ───────────────────────────────────────────────

export const PHRASE_SECTION_MASQUEE_VENTES = 'Réservé aux rôles qui consultent les ventes.';
export const PHRASE_SECTION_MASQUEE_PROJETS = 'Réservé aux rôles qui consultent les projets.';

/**
 * Phrase d'une section non connue : masquée (droit) ou vide. `null` : la
 * section est connue, l'écran affiche son contenu.
 */
export function phraseSection(
  section: CrmOverviewSection<object>,
  masquee: string,
  vide: string,
): string | null {
  if (section.status === 'hidden') return masquee;
  if (section.status === 'empty') return vide;
  return null;
}

/** « 1 500,00 USD » par devise, chiffres de l'API ; jamais de somme entre devises. */
export function montantsParDevise(
  totaux: readonly { currency: string; total: string; count?: number }[],
): string[] {
  return totaux.map((t) => formatMontant(t.total, t.currency));
}

export const STATUTS_OPPORTUNITE: Record<string, string> = {
  open: 'En cours',
  won: 'Gagnée',
  lost: 'Perdue',
};

export const STATUTS_REGLEMENT: Record<string, string> = {
  unpaid: 'Non payée',
  partially_paid: 'Partiellement payée',
  paid: 'Payée',
  overdue: 'En retard',
  not_applicable: 'Sans règlement',
};

export function libelleReglement(status: string): string {
  return STATUTS_REGLEMENT[status] ?? status;
}

// ── Fil chronologique ───────────────────────────────────────────────────────

export const LIBELLES_EVENEMENT: Record<CrmTimelineEvent['type'], string> = {
  'activity.created': 'Activité créée',
  'activity.done': 'Activité faite',
  'opportunity.created': 'Opportunité créée',
  'opportunity.stage_changed': 'Changement d’étape',
  'opportunity.won': 'Opportunité gagnée',
  'opportunity.lost': 'Opportunité perdue',
  'account.created': 'Compte créé',
  'account.converted': 'Prospect devenu client',
  'account.merged': 'Comptes fusionnés',
  'quote.created': 'Devis créé',
  'quote.sent': 'Devis envoyé',
  'quote.accepted': 'Devis accepté',
  'quote.refused': 'Devis refusé',
  'quote.converted': 'Devis converti en facture',
  'invoice.issued': 'Facture émise',
  'invoice.normalized': 'Facture normalisée',
  'receipt.recorded': 'Encaissement enregistré',
  'receipt.cancelled': 'Encaissement annulé',
  'project.created': 'Projet créé',
  'project.completed': 'Projet terminé',
};

const LIBELLES_SOURCE: Record<CrmTimelineSource, string> = {
  activity: 'activités',
  opportunity: 'opportunités',
  account: 'compte',
  quote: 'devis',
  invoice: 'factures',
  receipt: 'encaissements',
  project: 'projets',
};

/** Phrase des sources masquées du fil, ou `null`. */
export function phraseSourcesMasquees(sources: readonly CrmTimelineSource[]): string | null {
  if (sources.length === 0) return null;
  return `Le fil n’affiche pas les ${sources.map((s) => LIBELLES_SOURCE[s]).join(', ')} : réservé aux rôles qui les consultent.`;
}

/** Lien de l'élément source d'un événement, ou `null`. */
export function lienEvenement(e: Pick<CrmTimelineEvent, 'source' | 'refId'>): string | null {
  const id = encodeURIComponent(e.refId);
  switch (e.source) {
    case 'opportunity':
      return `/crm/opportunites/${id}`;
    case 'activity':
      return `/crm/activites?activite=${id}`;
    case 'quote':
      return `/ventes/devis/${id}`;
    case 'invoice':
      return `/ventes/factures/${id}`;
    case 'project':
      return `/projets/${id}`;
    default:
      return null;
  }
}

/** Fusion de pages du fil : les éléments déjà vus ne sont pas répétés. */
export function fusionnerFil(
  avant: readonly CrmTimelineEvent[],
  page: readonly CrmTimelineEvent[],
): CrmTimelineEvent[] {
  const vus = new Set(avant.map((e) => e.id));
  return [...avant, ...page.filter((e) => !vus.has(e.id))];
}

/** Date et heure d'un événement, à Kinshasa. */
export function formatInstant(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Kinshasa',
  });
}

// ── Formulaire d'un compte (prospect) ───────────────────────────────────────

export interface FormulaireCompte {
  name: string;
  industry: string;
  origin: string;
  website: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  ownerId: string;
}

export function formulaireCompte(a: CrmAccountView | null = null): FormulaireCompte {
  return {
    name: a?.name ?? '',
    industry: a?.industry ?? '',
    origin: a?.origin ?? '',
    website: a?.website ?? '',
    phone: a?.phone ?? '',
    email: a?.email ?? '',
    address: a?.address ?? '',
    notes: a?.notes ?? '',
    ownerId: a?.ownerId ?? '',
  };
}

const ouNul = (v: string): string | null => (v.trim() === '' ? null : v.trim());

/**
 * Corps d'un compte. Pour un compte CLIENT, le nom vient de la fiche client
 * (`CRM_ACCOUNT_IDENTITY_FROM_CUSTOMER`) : il n'est pas envoyé.
 */
export function preparerCompte(
  f: FormulaireCompte,
  kind: CrmAccountView['kind'] = 'prospect',
): { ok: true; corps: AccountBody } | { ok: false; champs: Record<string, string> } {
  const champs: Record<string, string> = {};
  const name = f.name.trim();
  if (kind === 'prospect' && name === '') champs['name'] = 'Le nom est obligatoire.';
  if (name.length > 200) champs['name'] = '200 caractères au plus.';
  if (Object.keys(champs).length > 0) return { ok: false, champs };
  return {
    ok: true,
    corps: {
      ...(kind === 'prospect' ? { name } : {}),
      industry: ouNul(f.industry),
      origin: ouNul(f.origin),
      website: ouNul(f.website),
      phone: ouNul(f.phone),
      email: ouNul(f.email),
      address: ouNul(f.address),
      notes: ouNul(f.notes),
      ...(f.ownerId === '' ? {} : { ownerId: f.ownerId }),
    },
  };
}

// ── Fusion ──────────────────────────────────────────────────────────────────

/** Cibles possibles d'une fusion : tout autre compte actif non fusionné (§ 3.1). */
export function ciblesFusion<T extends Pick<CrmAccountView, 'id' | 'active' | 'mergedInto'>>(
  source: Pick<CrmAccountView, 'id'>,
  comptes: readonly T[],
): T[] {
  return comptes.filter((c) => c.id !== source.id && c.active && c.mergedInto === null);
}

/** Seul un prospect se fusionne dans un autre compte. */
export function fusionPossible(a: Pick<CrmAccountView, 'kind' | 'mergedInto'>): boolean {
  return a.kind === 'prospect' && a.mergedInto === null;
}

// ── Conversion prospect → client (§ 3.1.1) ──────────────────────────────────

/**
 * Fiche client existante signalée par un refus `409 CUSTOMER_NIF_EXISTS`
 * (`details.existingId`) : l'écran propose alors de RATTACHER le prospect.
 */
export function ficheExistante(err: unknown): string | null {
  const detail = (err as { detail?: { code?: unknown; details?: { existingId?: unknown } } } | null)
    ?.detail;
  if (detail?.code !== 'CUSTOMER_NIF_EXISTS') return null;
  const id = detail.details?.existingId;
  return typeof id === 'string' && id !== '' ? id : null;
}

/** Raison affichée quand la conversion n'est pas ouverte au rôle (décision ouverte n° 4). */
export const RAISON_CONVERSION_FERMEE =
  'Convertir crée une fiche client (type DGI, NIF) : réservé aux rôles qui gèrent les clients dans Ventes.';
