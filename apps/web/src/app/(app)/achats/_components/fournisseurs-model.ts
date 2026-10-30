// Fournisseurs et fiche 360° — ADR-0044 § 2.1, § 3.1 et § 8. Logique pure.
//
// Les coordonnées de paiement sont TOUJOURS masquées (`Rawbank •••• 4521`) ; le
// clair ne se lit que par `…/reveal` (droit `payables.pay`, journalisé par l'API),
// après confirmation. Aucun montant n'est additionné ni converti : reste dû et
// ancienneté viennent du moteur, une devise par ligne.

import type {
  PurchaseCurrency,
  SupplierPaymentTerms,
  SupplierPaymentMethodRevealView,
  SupplierWarning,
} from '@lalanda/shared/purchases';

import type { OrgAction } from '@/lib/api';
import type {
  CreateSupplierInput,
  ListSuppliersParams,
  SupplierListItem,
  SupplierOverview,
  SupplierView,
} from '@/lib/api-purchases';

import { formatMontant } from '../../ventes/_components/sales-model';

import { peutPayerFournisseurs } from './achats-model';

// ── Liste ───────────────────────────────────────────────────────────────────

export interface FiltresFournisseurs {
  q: string;
  archives: boolean;
}

export const FILTRES_FOURNISSEURS_INITIAUX: FiltresFournisseurs = { q: '', archives: false };

export function requeteFournisseurs(
  f: FiltresFournisseurs,
  cursor: string | null = null,
): ListSuppliersParams {
  const q = f.q.trim();
  return {
    active: f.archives ? 'false' : 'true',
    limit: 50,
    ...(q === '' ? {} : { q: q.slice(0, 100) }),
    ...(cursor ? { cursor } : {}),
  };
}

/**
 * Reste dû d'une ligne de liste, une devise par ligne. `null` : l'appelant ne
 * lit pas la trésorerie (l'API ne le sert pas) — l'écran le dit, sans zéro.
 */
export function resteDuLignes(item: Pick<SupplierListItem, 'remainingByCurrency'>): string[] | null {
  if (item.remainingByCurrency === null) return null;
  return (['CDF', 'USD'] as const)
    .filter((c) => item.remainingByCurrency?.[c] !== undefined)
    .map((c) => formatMontant(item.remainingByCurrency![c]!, c));
}

export function libelleNature(kind: SupplierView['kind']): string {
  return kind === 'individual' ? 'Particulier' : 'Entreprise';
}

/** « Paiement immédiat », « 30 jours net », « Fin de mois + 30 jours ». */
export function libelleConditions(t: SupplierPaymentTerms): string {
  switch (t.kind) {
    case 'immediate':
      return 'Paiement immédiat';
    case 'net':
      return `${t.days} jour${t.days > 1 ? 's' : ''} net`;
    case 'end_of_month':
      return t.days === 0 ? 'Fin de mois' : `Fin de mois + ${t.days} jour${t.days > 1 ? 's' : ''}`;
  }
}

/** Contact principal (préremplit l'envoi du bon de commande), ou `null`. */
export function contactPrincipal(s: Pick<SupplierView, 'contacts'>): SupplierView['contacts'][number] | null {
  return s.contacts.find((c) => c.isPrimary) ?? s.contacts[0] ?? null;
}

// ── Mémoire de la liste (repli de la fiche) ─────────────────────────────────

/**
 * Fiches lues dans la liste, gardées le temps de la session de navigation. Si
 * la fiche 360° n'est pas encore servie (404, lot P6 non fusionné), l'écran
 * montre au moins l'identité RENDUE PAR L'API dans la liste — jamais inventée.
 */
const memoire = new Map<string, SupplierView>();

export function retenirFournisseurs(items: readonly SupplierView[]): void {
  for (const s of items) memoire.set(s.id, s);
}

export function fournisseurRetenu(id: string): SupplierView | null {
  return memoire.get(id) ?? null;
}

// ── Formulaire de création ──────────────────────────────────────────────────

export interface FormulaireFournisseur {
  name: string;
  kind: SupplierView['kind'];
  nif: string;
  phone: string;
  email: string;
  address: string;
  defaultCurrency: PurchaseCurrency | '';
  termsKind: SupplierPaymentTerms['kind'];
  termsDays: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
}

export function formulaireFournisseur(): FormulaireFournisseur {
  return {
    name: '',
    kind: 'company',
    nif: '',
    phone: '',
    email: '',
    address: '',
    defaultCurrency: '',
    termsKind: 'immediate',
    termsDays: '30',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
  };
}

const ADRESSE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TELEPHONE = /^\+?[0-9][0-9 .-]{6,19}$/;
const ouNul = (v: string): string | null => (v.trim() === '' ? null : v.trim());

/**
 * Vérification de FORME (l'API reste juge : NIF unique, homonymes) et corps de
 * `POST /purchases/suppliers`. Le NIF est facultatif (décision ouverte n° 14).
 */
export function preparerFournisseur(
  f: FormulaireFournisseur,
): { ok: true; corps: CreateSupplierInput } | { ok: false; champs: Record<string, string> } {
  const champs: Record<string, string> = {};
  const name = f.name.trim();
  if (name === '') champs['name'] = 'Le nom est obligatoire.';
  else if (name.length > 200) champs['name'] = '200 caractères au plus.';
  const nif = f.nif.toUpperCase().replace(/[\s-]+/g, '');
  if (nif !== '' && !/^[A-Z0-9]{5,20}$/.test(nif)) champs['nif'] = 'NIF : 5 à 20 lettres ou chiffres.';
  if (f.phone.trim() !== '' && !TELEPHONE.test(f.phone.trim()))
    champs['phone'] = 'Numéro de téléphone invalide.';
  if (f.email.trim() !== '' && !ADRESSE.test(f.email.trim()))
    champs['email'] = 'Adresse e-mail invalide.';
  if (f.contactEmail.trim() !== '' && !ADRESSE.test(f.contactEmail.trim()))
    champs['contactEmail'] = 'Adresse e-mail invalide.';
  if (f.contactPhone.trim() !== '' && !TELEPHONE.test(f.contactPhone.trim()))
    champs['contactPhone'] = 'Numéro de téléphone invalide.';
  if ((f.contactEmail.trim() !== '' || f.contactPhone.trim() !== '') && f.contactName.trim() === '')
    champs['contactName'] = 'Nommez le contact.';

  let paymentTerms: SupplierPaymentTerms = { kind: 'immediate' };
  if (f.termsKind !== 'immediate') {
    const jours = /^\d{1,3}$/.test(f.termsDays.trim()) ? Number(f.termsDays.trim()) : NaN;
    const min = f.termsKind === 'net' ? 1 : 0;
    if (Number.isNaN(jours) || jours < min || jours > 180) {
      champs['termsDays'] = `Nombre de jours entre ${min} et 180.`;
    } else {
      paymentTerms = { kind: f.termsKind, days: jours };
    }
  }

  if (Object.keys(champs).length > 0) return { ok: false, champs };
  const contact = ouNul(f.contactName);
  return {
    ok: true,
    corps: {
      name,
      kind: f.kind,
      nif: nif === '' ? null : nif,
      phone: ouNul(f.phone),
      email: ouNul(f.email),
      address: ouNul(f.address),
      defaultCurrency: f.defaultCurrency === '' ? null : f.defaultCurrency,
      paymentTerms,
      ...(contact === null
        ? {}
        : {
            contacts: [
              {
                name: contact,
                email: ouNul(f.contactEmail),
                phone: ouNul(f.contactPhone),
                isPrimary: true,
              },
            ],
          }),
    },
  };
}

/** Phrases des avertissements rendus à l'écriture (rien n'est refusé). */
export function phrasesAvertissements(warnings: readonly SupplierWarning[]): string[] {
  const phrases: string[] = [];
  if (warnings.some((w) => w.code === 'SUPPLIER_SIMILAR_NAME')) {
    phrases.push(
      'Un fournisseur au nom proche existe déjà : vérifiez qu’il ne s’agit pas du même (les doublons se fusionnent).',
    );
  }
  if (warnings.some((w) => w.code === 'SUPPLIER_PAYMENT_DETAILS_SHARED')) {
    phrases.push(
      'Ces coordonnées de paiement sont aussi celles d’un autre fournisseur : vérifiez-les avant tout paiement.',
    );
  }
  return phrases;
}

// ── Coordonnées de paiement ─────────────────────────────────────────────────

export const RAISON_SANS_PAIEMENT =
  'Afficher les coordonnées est réservé aux rôles qui paient les fournisseurs.';

export const PHRASE_CONFIRMATION_REVELATION =
  'Les coordonnées complètes vont s’afficher. Cet affichage est enregistré au journal d’audit de l’organisation, à votre nom.';

/** Le bouton « Afficher » : actif avec `payables.pay`, sinon désactivé et sa raison. */
export function boutonAfficher(actions: readonly OrgAction[] | null): {
  actif: boolean;
  raison: string | null;
} {
  return peutPayerFournisseurs(actions)
    ? { actif: true, raison: null }
    : { actif: false, raison: RAISON_SANS_PAIEMENT };
}

/** Clair d'un moyen de paiement, en paires libellé / valeur (champs vides omis). */
export function lignesCoordonnees(r: SupplierPaymentMethodRevealView): [string, string][] {
  const paires: [string, string | null][] =
    r.kind === 'bank'
      ? [
          ['Banque', r.details.bankName],
          ['Titulaire', r.details.accountHolder],
          ['Numéro de compte', r.details.accountNumber],
          ['IBAN', r.details.iban],
          ['SWIFT', r.details.swift],
        ]
      : [
          ['Opérateur', r.details.operator],
          ['Numéro', r.details.phoneNumber],
          ['Titulaire', r.details.holderName],
        ];
  return paires.filter((p): p is [string, string] => p[1] !== null && p[1] !== '');
}

// ── Fiche 360° ──────────────────────────────────────────────────────────────

export const PHRASE_MASQUEE_TRESORERIE = 'Réservé aux rôles qui consultent la trésorerie.';
export const PHRASE_MASQUEE_ACHATS = 'Réservé aux rôles qui consultent les achats.';

/** Phrase d'une section non connue (masquée ou vide) ; `null` si elle est connue. */
export function phraseSection(
  section: { status: 'known' | 'hidden' | 'empty' },
  masquee: string,
  vide: string,
): string | null {
  if (section.status === 'hidden') return masquee;
  if (section.status === 'empty') return vide;
  return null;
}

export const TRANCHES_ANCIENNETE = [
  ['notDue', 'Non échu'],
  ['days1to30', '1 à 30 jours'],
  ['days31to60', '31 à 60 jours'],
  ['days61to90', '61 à 90 jours'],
  ['over90', 'Plus de 90 jours'],
  ['disputed', 'En litige'],
] as const;

type LigneAnciennete = NonNullable<SupplierOverview['sections']['balance']['data']>['byCurrency'][number];

/** Tranches d'ancienneté d'une devise, montants formatés (valeurs du moteur). */
export function trancheAnciennete(row: LigneAnciennete): { libelle: string; montant: string }[] {
  return TRANCHES_ANCIENNETE.map(([cle, libelle]) => ({
    libelle,
    montant: formatMontant(row[cle], row.currency),
  }));
}
