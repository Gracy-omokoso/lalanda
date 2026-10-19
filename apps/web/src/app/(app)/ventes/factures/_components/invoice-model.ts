// Logique pure de l'onglet Factures (S25e — ADR-0023, chantier E3).
//
// Isolée du rendu pour être testable (vitest en environnement `node`, sans DOM).
// Tout ce qui décide vit ici ; les `.tsx` assemblent.
//
// Trois règles tiennent ce fichier, et `invoice-model.test.ts` les impose :
//
// 1. AUCUN CALCUL DE MONTANT. Totaux, TVA, conversion en CDF, contre-valeur USD
//    et contrôle des paiements viennent du moteur, par l'API. Une saisie est
//    vérifiée dans sa FORME puis transmise en chaîne ; un montant servi est mis
//    en forme par manipulation de chaîne. Ni `Number()`, ni `parseFloat`, ni
//    `Math` : un test lit la source. La seule opération admise sur deux
//    décimaux est la COMPARAISON chiffre à chiffre (quantité ≤ restant), un
//    confort que le serveur refait de toute façon.
// 2. JAMAIS « FACTURE » AVANT L'HEURE. Tant que `documentKind = proforma`,
//    l'en-tête est « Pro forma — non valable comme facture » avec la référence
//    `PF-…` ; aucun numéro de la série fiscale n'est affiché (§ S25e.1).
// 3. RIEN N'AUTORISE. Masquer un bouton est un confort : l'API refuse de toute
//    façon (`PermissionsGuard`, mode d'émission lu dans la transaction).

import type {
  CatalogItemType,
  CatalogSpecificTax,
  ConversionRateSource,
  CreateInvoiceBody,
  CreditNoteNature,
  DocumentCurrency,
  ExchangeRateReference,
  InvoiceLineBody,
  InvoiceListStatus,
  InvoicePaymentMethod,
  InvoicePriceMode,
  InvoiceStatus,
  InvoiceSummary,
  InvoiceType,
  InvoiceView,
  JournalEvent,
  LineDiscount,
  ListInvoicesQuery,
  NormalizeInvoiceBody,
  OrgAction,
  TaxGroupLetter,
} from '@/lib/api';

import {
  codeErreur,
  formatMontant,
  lireMontantSaisi,
  lireTauxSaisi,
  type LectureDecimal,
  messageVentes,
  montantPourSaisie,
} from '../../_components/sales-model';

// ─────────────────────────────────────────────────────────────────────────────
// Accès
// ─────────────────────────────────────────────────────────────────────────────

export const FACTURES_BASE = '/ventes/factures';

/** Émettre et normaliser engagent le contribuable : `sales.invoice` (§ S25e.11). */
export function peutFacturer(actions: readonly OrgAction[] | null): boolean {
  return actions !== null && actions.includes('sales.invoice');
}

// ─────────────────────────────────────────────────────────────────────────────
// Libellés
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Types e-DEF en mots NEUTRES : le mot « facture » n'y figure pas, parce qu'un
 * type s'affiche aussi sur un pro forma (règle 2).
 */
export const TYPE_LABELS: Record<InvoiceType, string> = {
  FV: 'Vente',
  FT: 'Acompte',
  FA: 'Avoir',
  EV: 'Vente à l’exportation',
  ET: 'Acompte à l’exportation',
  EA: 'Avoir à l’exportation',
};

export const TYPES_VENTE: readonly InvoiceType[] = ['FV', 'FT', 'EV', 'ET'];
export const TYPES_AVOIR: readonly InvoiceType[] = ['FA', 'EA'];

export function estAvoir(type: InvoiceType): boolean {
  return TYPES_AVOIR.includes(type);
}

export const NATURE_LABELS: Record<CreditNoteNature, { court: string; aide: string }> = {
  COR: {
    court: 'Correction',
    aide: 'Corrige une erreur avant le paiement ou la fourniture.',
  },
  RAN: {
    court: 'Annulation',
    aide: 'Annule une vente qui n’a été ni payée ni fournie.',
  },
  RAM: {
    court: 'Avoir après reprise',
    aide: 'Après paiement ou fourniture : reprise de marchandise ou remboursement.',
  },
  RRR: {
    court: 'Remise, ristourne ou rabais',
    aide: 'Réduction commerciale ; lignes libres, sans limite de quantité.',
  },
};

export const NATURES: readonly CreditNoteNature[] = ['COR', 'RAN', 'RAM', 'RRR'];

export const PAYMENT_LABELS: Record<InvoicePaymentMethod, string> = {
  ESPECES: 'Espèces',
  VIREMENT: 'Virement',
  CARTEBANCAIRE: 'Carte bancaire',
  MOBILEMONEY: 'Mobile money',
  CHEQUES: 'Chèque',
  CREDIT: 'Crédit (part non réglée)',
  AUTRE: 'Autre',
};

export const PAYMENT_METHODS: readonly InvoicePaymentMethod[] = [
  'ESPECES',
  'VIREMENT',
  'CARTEBANCAIRE',
  'MOBILEMONEY',
  'CHEQUES',
  'CREDIT',
  'AUTRE',
];

export const CURRENCY_LABELS: Record<DocumentCurrency, string> = {
  CDF: 'Franc congolais (CDF)',
  USD: 'Dollar américain (USD)',
};

export const PRICE_MODE_DOC_LABELS: Record<InvoicePriceMode, string> = {
  ttc: 'TTC — prix taxes comprises',
  ht: 'HT — prix hors taxes',
};

/** Statut en mots. Les états non finals d'un document disent « pro forma ». */
export const STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: 'Brouillon (pro forma)',
  issued: 'Émise',
  pending_normalization: 'Pro forma — normalisation en cours',
  normalized: 'Facture normalisée',
  normalization_failed: 'Pro forma — normalisation refusée',
};

export function tonStatut(statut: InvoiceStatus): 'neutre' | 'attention' {
  return statut === 'normalization_failed' ? 'attention' : 'neutre';
}

export const RATE_SOURCE_LABELS: Record<ConversionRateSource, string> = {
  dgi_currency_rates: 'Taux officiel publié par la DGI',
  user_within_tolerance: 'Taux saisi (dans la tolérance de ±1 %)',
  identity: 'Document en CDF : aucune conversion',
  origin_invoice: 'Taux de la facture d’origine',
};

export const JOURNAL_EVENT_LABELS: Record<JournalEvent, string> = {
  issued: 'Facture émise',
  submitted: 'Pro forma figé, transmis pour normalisation',
  number_reserved: 'Numéro réservé',
  normalized: 'Facture normalisée',
  normalization_failed: 'Normalisation refusée',
  number_released: 'Numéro rendu',
  returned_to_draft: 'Repris en brouillon',
  duplicate_issued: 'Duplicata imprimé',
  report_issued: 'Rapport émis',
};

// ─────────────────────────────────────────────────────────────────────────────
// En-tête : ce que le document a le droit de dire de lui-même (règle 2)
// ─────────────────────────────────────────────────────────────────────────────

export const LIBELLE_PRO_FORMA = 'Pro forma — non valable comme facture';

export interface EnteteDocument {
  /** « Facture n° 2026-000123 » ou « Pro forma — non valable comme facture ». */
  titre: string;
  /** Référence affichée : numéro définitif, ou `PF-…`. */
  reference: string;
  /** `true` : la référence est un numéro de la série fiscale. */
  numeroDefinitif: boolean;
  /** Précision sous le titre (normalisation en cours, refusée…), ou `null`. */
  mention: string | null;
}

export function enteteDocument(
  doc: Pick<
    InvoiceSummary,
    'documentKind' | 'status' | 'number' | 'proformaRef' | 'type' | 'emissionMode'
  > & { documentLabel?: string },
): EnteteDocument {
  const avoir = estAvoir(doc.type);
  if (doc.documentKind === 'invoice' && doc.number !== null) {
    const nature =
      doc.status === 'normalized'
        ? avoir
          ? 'Facture d’avoir normalisée'
          : 'Facture normalisée'
        : avoir
          ? 'Facture d’avoir'
          : 'Facture';
    return {
      titre: `${nature} n° ${doc.number}`,
      reference: doc.number,
      numeroDefinitif: true,
      mention: null,
    };
  }
  // Pro forma : le libellé du serveur s'il le donne, sinon le libellé fixé par
  // l'ADR. On ne laisse jamais passer un libellé qui dirait « Facture n° ».
  const libelle =
    doc.documentLabel && !/^facture\b/i.test(doc.documentLabel)
      ? doc.documentLabel
      : LIBELLE_PRO_FORMA;
  const mention =
    doc.status === 'pending_normalization'
      ? 'Normalisation en cours auprès de la DGI.'
      : doc.status === 'normalization_failed'
        ? 'La DGI a refusé la normalisation.'
        : doc.status === 'draft'
          ? 'Brouillon modifiable.'
          : null;
  return { titre: libelle, reference: doc.proformaRef, numeroDefinitif: false, mention };
}

/** Montant à afficher dans la liste : le CDF normalisé s'il existe (il fait foi). */
export function montantsResume(doc: InvoiceSummary): {
  document: string;
  normalise: string | null;
} {
  const total = doc.documentAmounts.calculation.totals?.total ?? null;
  return {
    document: total === null ? 'Total à compléter' : formatMontant(total, doc.currency),
    normalise:
      doc.normalizedAmounts === null
        ? null
        : formatMontant(doc.normalizedAmounts.calculation.total, 'CDF'),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Liste : filtres
// ─────────────────────────────────────────────────────────────────────────────

export type FiltreStatut =
  'all' | 'draft' | 'pending_normalization' | 'normalization_failed' | 'final';

export const FILTRES_STATUT: readonly { valeur: FiltreStatut; label: string }[] = [
  { valeur: 'all', label: 'Tous' },
  { valeur: 'draft', label: 'Brouillons' },
  { valeur: 'pending_normalization', label: 'Pro forma en attente DGI' },
  { valeur: 'normalization_failed', label: 'Normalisation refusée' },
  { valeur: 'final', label: 'Émises' },
];

export interface FiltresFactures {
  statut: FiltreStatut;
  type: InvoiceType | '';
  q: string;
}

export const FILTRES_INITIAUX: FiltresFactures = { statut: 'all', type: '', q: '' };

export function requeteFactures(f: FiltresFactures, cursor?: string | null): ListInvoicesQuery {
  const q = f.q.trim();
  const statut: InvoiceListStatus = f.statut;
  return {
    status: statut,
    ...(f.type !== '' ? { type: f.type } : {}),
    ...(q !== '' ? { q: q.slice(0, 100) } : {}),
    ...(cursor ? { cursor } : {}),
  };
}

export function filtreActif(f: FiltresFactures): boolean {
  return f.statut !== 'all' || f.type !== '' || f.q.trim() !== '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Actions possibles sur un document
// ─────────────────────────────────────────────────────────────────────────────

export type ActionDocument =
  'modifier' | 'supprimer' | 'emettre' | 'normaliser' | 'avoir' | 'reprendre';

/**
 * Ce que l'on propose, selon le statut et les droits. « Émettre » et
 * « Normaliser » ne coexistent JAMAIS : le brouillon dit lui-même, par
 * `readiness.action`, laquelle s'applique au mode de l'organisation.
 */
export function actionsDocument(
  doc: Pick<InvoiceView, 'status' | 'type' | 'readiness' | 'normalization'>,
  droits: { gerer: boolean; facturer: boolean },
): ActionDocument[] {
  const out: ActionDocument[] = [];
  switch (doc.status) {
    case 'draft':
      if (droits.gerer) out.push('modifier');
      if (droits.facturer) out.push(doc.readiness.action === 'issue' ? 'emettre' : 'normaliser');
      if (droits.gerer) out.push('supprimer');
      break;
    case 'issued':
    case 'normalized':
      if (droits.gerer && !estAvoir(doc.type)) out.push('avoir');
      break;
    case 'normalization_failed':
      if (droits.gerer && (doc.normalization?.reservedNumber ?? null) === null) {
        out.push('reprendre');
      }
      break;
    case 'pending_normalization':
      break;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Saisie : formes seulement (règle 1)
// ─────────────────────────────────────────────────────────────────────────────

/** Quantité : > 0, trois décimales au plus (`"2.375"`). Chaîne en sortie. */
export function lireQuantiteSaisie(saisie: string): LectureDecimal {
  const s = saisie.replace(/[\s  ]/g, '').replace(',', '.');
  if (s === '') return { ok: false, erreur: 'Saisissez une quantité.' };
  if (!/^\d+(\.\d*)?$/.test(s)) {
    return {
      ok: false,
      erreur: 'Quantité invalide : des chiffres et une virgule, par exemple 2,5.',
    };
  }
  const [entierBrut = '', decimalesBrutes = ''] = s.split('.');
  // `2,3750` vaut `2,375` : les zéros de fin ne sont pas une précision.
  const decimales = decimalesBrutes.replace(/0+$/, '');
  if (decimales.length > 3) return { ok: false, erreur: 'Trois décimales au plus.' };
  const entier = entierBrut.replace(/^0+(?=\d)/, '');
  if (entier.length > 9) return { ok: false, erreur: 'Quantité trop grande.' };
  if (/^0+$/.test(entier) && /^0*$/.test(decimales)) {
    return { ok: false, erreur: 'La quantité doit être supérieure à zéro.' };
  }
  return { ok: true, valeur: decimales === '' ? entier : `${entier}.${decimales}` };
}

/** Taux de change saisi (CDF pour 1 USD) : > 0, huit décimales au plus. */
export function lireTauxChange(saisie: string): LectureDecimal {
  const s = saisie.replace(/[\s  ]/g, '').replace(',', '.');
  if (s === '') return { ok: false, erreur: 'Saisissez un taux.' };
  if (!/^\d+(\.\d*)?$/.test(s)) {
    return {
      ok: false,
      erreur: 'Taux invalide : des chiffres et une virgule, par exemple 2 270,50.',
    };
  }
  const [entierBrut = '', decimales = ''] = s.split('.');
  if (decimales.length > 8) return { ok: false, erreur: 'Huit décimales au plus.' };
  const entier = entierBrut.replace(/^0+(?=\d)/, '');
  if (entier.length > 9) return { ok: false, erreur: 'Taux trop grand.' };
  if (/^0+$/.test(entier) && /^0*$/.test(decimales)) {
    return { ok: false, erreur: 'Le taux doit être supérieur à zéro.' };
  }
  return { ok: true, valeur: decimales === '' ? entier : `${entier}.${decimales}` };
}

/**
 * Compare deux décimaux canoniques CHIFFRE À CHIFFRE : −1, 0 ou 1. Aucune
 * conversion en nombre (un `double` perd des chiffres au-delà de 2⁵³). `null`
 * si l'une des valeurs n'est pas un décimal.
 */
export function comparerDecimaux(a: string, b: string): -1 | 0 | 1 | null {
  const forme = /^\d+(\.\d+)?$/;
  if (!forme.test(a) || !forme.test(b)) return null;
  const [ea = '0', da = ''] = a.split('.');
  const [eb = '0', db = ''] = b.split('.');
  const ia = ea.replace(/^0+(?=\d)/, '');
  const ib = eb.replace(/^0+(?=\d)/, '');
  if (ia.length !== ib.length) return ia.length < ib.length ? -1 : 1;
  if (ia !== ib) return ia < ib ? -1 : 1;
  const longueur = da.length > db.length ? da.length : db.length;
  const fa = da.padEnd(longueur, '0');
  const fb = db.padEnd(longueur, '0');
  if (fa === fb) return 0;
  return fa < fb ? -1 : 1;
}

/** Quantité servie (`"2.375"`) → texte à éditer (`"2,375"`). */
export function quantitePourSaisie(valeur: string): string {
  return valeur.replace('.', ',');
}

/** `2.375` → `2,375` ; une quantité n'a pas de devise. */
export function formatQuantite(valeur: string): string {
  return /^\d+(\.\d+)?$/.test(valeur) ? valeur.replace('.', ',') : valeur;
}

/** Taux de change servi (`"2262.32"`) → `2 262,32 CDF pour 1 USD`. */
export function formatTauxChange(rate: string): string {
  if (!/^\d+(\.\d+)?$/.test(rate)) return `${rate} CDF pour 1 USD`;
  const [entier = '0', dec = ''] = rate.split('.');
  // formatMontant complète à deux décimales ; un taux en a parfois davantage,
  // gardées telles quelles.
  const groupe = formatMontant(entier, '')
    .replace(/,00\s*$/, '')
    .trim();
  return `${groupe}${dec === '' ? '' : `,${dec}`} CDF pour 1 USD`;
}

/** Date DGI (`2026-10-19T00:00:00+01:00`) → `19 oct. 2026`, sans glissement de fuseau. */
export function formatDateDgi(valeur: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(valeur);
  if (!m) return valeur;
  const mois = [
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
  const indice = mois.findIndex((_, i) => String(i + 1).padStart(2, '0') === m[2]);
  return indice < 0 ? valeur : `${m[3]} ${mois[indice]} ${m[1]}`;
}

/** Partie date (`AAAA-MM-JJ`) d'une date DGI, pour pré-remplir un champ date. */
export function jourDgi(valeur: string): string {
  return /^(\d{4}-\d{2}-\d{2})/.exec(valeur)?.[1] ?? '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Formulaire d'un document
// ─────────────────────────────────────────────────────────────────────────────

export type RemiseChoix = 'none' | 'percent' | 'total_amount';
export type TaxeChoix = 'none' | 'per_unit' | 'percent';

export interface LigneFormulaire {
  /** Clé de rendu stable, sans rapport avec l'index envoyé. */
  cle: string;
  source: 'catalog' | 'free' | 'origin';
  // Catalogue
  catalogItemId: string;
  /** Rappel affiché : désignation et prix de l'article choisi. */
  apercu: string;
  /** Devise de l'article (catalogue) : un prix doit être saisi si elle diffère. */
  deviseArticle: DocumentCurrency | null;
  // Origine (avoir hors RRR)
  originLineIndex: number | null;
  /** Restant à créditer sur l'origine, servi par l'API ; `null` si inconnu. */
  restant: string | null;
  // Commun
  quantite: string;
  /** Prix AVANT remise ; vide sur une ligne de catalogue = prix de l'article. */
  prix: string;
  remise: RemiseChoix;
  remiseValeur: string;
  // Ligne libre
  code: string;
  name: string;
  itemType: CatalogItemType | '';
  taxGroup: TaxGroupLetter | '';
  outOfScope: boolean;
  unit: string;
  taxe: TaxeChoix;
  taxeValeur: string;
}

export type ClientChoix =
  | { mode: 'fiche'; customerId: string; nom: string; printContactDetails: boolean }
  | { mode: 'comptoir'; nom: string };

export interface PaiementFormulaire {
  cle: string;
  method: InvoicePaymentMethod;
  montant: string;
}

export interface FormulaireDocument {
  type: InvoiceType;
  currency: DocumentCurrency;
  priceMode: InvoicePriceMode | '';
  client: ClientChoix | null;
  lignes: LigneFormulaire[];
  paiements: PaiementFormulaire[];
  commentA: string;
  commentC: string;
  nature: CreditNoteNature | null;
  originInvoiceId: string | null;
  showUsdCounterValue: boolean;
}

let compteurCle = 0;
/** Clé de rendu : unique dans la page, sans signification. */
export function nouvelleCle(prefixe: string): string {
  compteurCle += 1;
  return `${prefixe}-${compteurCle}`;
}

export function ligneVide(source: 'catalog' | 'free'): LigneFormulaire {
  return {
    cle: nouvelleCle('l'),
    source,
    catalogItemId: '',
    apercu: '',
    deviseArticle: null,
    originLineIndex: null,
    restant: null,
    quantite: '1',
    prix: '',
    remise: 'none',
    remiseValeur: '',
    code: '',
    name: '',
    itemType: '',
    taxGroup: '',
    outOfScope: false,
    unit: '',
    taxe: 'none',
    taxeValeur: '',
  };
}

export function formulaireVide(): FormulaireDocument {
  return {
    type: 'FV',
    currency: 'CDF',
    priceMode: '',
    client: null,
    lignes: [],
    paiements: [{ cle: nouvelleCle('p'), method: 'ESPECES', montant: '' }],
    commentA: '',
    commentC: '',
    nature: null,
    originInvoiceId: null,
    showUsdCounterValue: false,
  };
}

function remiseVersFormulaire(d: LineDiscount | null): { remise: RemiseChoix; valeur: string } {
  if (d === null) return { remise: 'none', valeur: '' };
  return { remise: d.kind, valeur: montantPourSaisie(d.value) };
}

function taxeVersFormulaire(t: CatalogSpecificTax | null): { taxe: TaxeChoix; valeur: string } {
  if (t === null) return { taxe: 'none', valeur: '' };
  return t.kind === 'per_unit'
    ? { taxe: 'per_unit', valeur: montantPourSaisie(t.amount) }
    : { taxe: 'percent', valeur: montantPourSaisie(t.rate) };
}

/**
 * Formulaire d'un brouillon servi par l'API. Le prix saisi est le prix AVANT
 * remise (`originalPrice` quand une remise s'applique) : c'est ce que le corps
 * attend, la remise étant appliquée par le moteur.
 */
export function formulaireDepuisVue(
  vue: InvoiceView,
  origine: InvoiceView | null = null,
): FormulaireDocument {
  const lignes = vue.lines.map((l): LigneFormulaire => {
    const base = ligneVide(l.source === 'free' ? 'free' : 'catalog');
    const remise = remiseVersFormulaire(l.discount);
    const prixAvantRemise = l.discount !== null ? (l.originalPrice ?? l.unitPrice) : l.unitPrice;
    if (l.source === 'origin') {
      const idx = l.originLineIndex ?? null;
      const ligneOrigine = idx === null ? undefined : origine?.lines.find((o) => o.index === idx);
      return {
        ...base,
        source: 'origin',
        originLineIndex: idx,
        apercu: l.name,
        quantite: quantitePourSaisie(l.quantity),
        restant: ligneOrigine?.remaining ?? null,
      };
    }
    if (l.source === 'catalog') {
      return {
        ...base,
        catalogItemId: l.catalogItemId ?? '',
        apercu: l.name,
        deviseArticle: null,
        quantite: quantitePourSaisie(l.quantity),
        prix: l.priceOverridden ? montantPourSaisie(prixAvantRemise) : '',
        remise: remise.remise,
        remiseValeur: remise.valeur,
      };
    }
    const taxe = taxeVersFormulaire(l.specificTax);
    return {
      ...base,
      code: l.code ?? '',
      name: l.name,
      itemType: l.itemType,
      taxGroup: l.taxGroup,
      outOfScope: l.outOfScope,
      unit: l.unit ?? '',
      quantite: quantitePourSaisie(l.quantity),
      prix: montantPourSaisie(prixAvantRemise),
      remise: remise.remise,
      remiseValeur: remise.valeur,
      taxe: taxe.taxe,
      taxeValeur: taxe.valeur,
    };
  });
  const client: ClientChoix =
    vue.customer.customerId === null
      ? { mode: 'comptoir', nom: vue.customer.name ?? '' }
      : {
          mode: 'fiche',
          customerId: vue.customer.customerId,
          nom: vue.customer.name ?? '',
          printContactDetails: vue.customer.printContactDetails,
        };
  const servis = vue.documentAmounts.payments.map((p): PaiementFormulaire => ({
    cle: nouvelleCle('p'),
    method: p.method,
    montant: montantPourSaisie(p.amount),
  }));
  // Un brouillon sans paiement garde une ligne vide à remplir.
  const paiements: PaiementFormulaire[] =
    servis.length > 0 ? servis : [{ cle: nouvelleCle('p'), method: 'ESPECES', montant: '' }];
  return {
    type: vue.type,
    currency: vue.currency,
    priceMode: vue.priceMode,
    client,
    lignes,
    paiements,
    commentA: vue.comments.A ?? '',
    commentC: vue.comments.C ?? '',
    nature: vue.creditNote?.nature ?? null,
    originInvoiceId: vue.creditNote?.originInvoiceId ?? null,
    showUsdCounterValue: vue.normalizedAmounts?.counterValueUsd != null,
  };
}

/** Lignes de l'avoir à reprendre de l'origine : celles qui ne sont pas encore dans le brouillon. */
export function lignesOrigineDisponibles(
  origine: InvoiceView,
  f: FormulaireDocument,
): InvoiceView['lines'] {
  const prises = new Set(f.lignes.map((l) => l.originLineIndex).filter((i) => i !== null));
  return origine.lines.filter(
    (l) => !prises.has(l.index) && (l.remaining === undefined || l.remaining !== '0'),
  );
}

/** Ligne d'avoir reprise de l'origine : quantité préremplie au restant. */
export function ligneDepuisOrigine(l: InvoiceView['lines'][number]): LigneFormulaire {
  return {
    ...ligneVide('catalog'),
    source: 'origin',
    originLineIndex: l.index,
    apercu: l.name,
    restant: l.remaining ?? null,
    quantite: quantitePourSaisie(l.remaining ?? l.quantity),
  };
}

/** Commentaire A : automatique pour un client AO (le serveur l'écrit), saisissable si groupe D. */
export function commentaireAModifiable(
  f: Pick<FormulaireDocument, 'lignes'>,
  typeClient: string | null,
): boolean {
  if (typeClient === 'AO') return false;
  return f.lignes.some((l) => l.source === 'free' && l.taxGroup === 'D') || typeClient === null;
}

export type ChampDocument = string;

export type PreparationDocument =
  { ok: true; corps: CreateInvoiceBody } | { ok: false; champs: Record<ChampDocument, string> };

function lireRemise(
  choix: RemiseChoix,
  valeur: string,
): { remise: LineDiscount | null; erreur?: string } {
  if (choix === 'none') return { remise: null };
  const lu = choix === 'percent' ? lireTauxSaisi(valeur) : lireMontantSaisi(valeur);
  if (!lu.ok) return { remise: null, erreur: lu.erreur };
  return { remise: { kind: choix, value: lu.valeur } };
}

/**
 * Contrôle de FORME puis corps du brouillon. Les clés d'erreur reprennent les
 * chemins du serveur (`lines.0.quantity`, `payments.1.amount`) : une erreur
 * locale et un refus de l'API s'affichent au même endroit.
 *
 * Un brouillon incomplet s'enregistre (l'API le dit par `readiness`) : seules
 * les valeurs MAL FORMÉES bloquent ici. Un paiement sans montant est ignoré.
 */
export function preparerDocument(f: FormulaireDocument): PreparationDocument {
  const champs: Record<string, string> = {};
  if (f.priceMode === '') champs['priceMode'] = 'Indiquez si les prix sont TTC ou HT.';
  if (f.client === null) champs['customer'] = 'Choisissez un client ou une vente de comptoir.';
  if (estAvoir(f.type) && f.nature === null)
    champs['creditNote.nature'] = 'Choisissez la nature de l’avoir.';

  const lignes: InvoiceLineBody[] = [];
  f.lignes.forEach((l, i) => {
    const q = lireQuantiteSaisie(l.quantite);
    if (!q.ok) champs[`lines.${i}.quantity`] = q.erreur;
    if (l.source === 'origin') {
      if (l.originLineIndex === null) {
        champs[`lines.${i}`] = 'Ligne de la facture d’origine introuvable.';
        return;
      }
      if (q.ok && l.restant !== null && comparerDecimaux(q.valeur, l.restant) === 1) {
        champs[`lines.${i}.quantity`] =
          `Au plus ${formatQuantite(l.restant)} : c’est ce qui reste à créditer sur cette ligne.`;
      }
      if (q.ok)
        lignes.push({ source: 'origin', originLineIndex: l.originLineIndex, quantity: q.valeur });
      return;
    }
    const remise = lireRemise(l.remise, l.remiseValeur);
    if (remise.erreur) champs[`lines.${i}.discount`] = remise.erreur;
    if (l.source === 'catalog') {
      if (l.catalogItemId === '') champs[`lines.${i}.catalogItemId`] = 'Choisissez un article.';
      let prix: string | null = null;
      if (l.prix.trim() !== '') {
        const p = lireMontantSaisi(l.prix);
        if (p.ok) prix = p.valeur;
        else champs[`lines.${i}.unitPrice`] = p.erreur;
      } else if (l.deviseArticle !== null && l.deviseArticle !== f.currency) {
        champs[`lines.${i}.unitPrice`] =
          `Article tarifé en ${l.deviseArticle} : saisissez son prix en ${f.currency}. Aucune conversion n’est faite au brouillon.`;
      }
      if (q.ok && l.catalogItemId !== '') {
        lignes.push({
          source: 'catalog',
          catalogItemId: l.catalogItemId,
          quantity: q.valeur,
          unitPrice: prix,
          discount: remise.remise,
        });
      }
      return;
    }
    // Ligne libre
    if (l.name.trim() === '') champs[`lines.${i}.name`] = 'La désignation est obligatoire.';
    if (l.taxGroup === '') champs[`lines.${i}.taxGroup`] = 'Choisissez le groupe de taxation.';
    if (l.itemType === '')
      champs[`lines.${i}.itemType`] = 'Choisissez le type : bien, service ou taxe.';
    const p = lireMontantSaisi(l.prix);
    if (!p.ok) champs[`lines.${i}.unitPrice`] = p.erreur;
    let specificTax: CatalogSpecificTax | null = null;
    if (l.taxe !== 'none') {
      const t = l.taxe === 'percent' ? lireTauxSaisi(l.taxeValeur) : lireMontantSaisi(l.taxeValeur);
      if (!t.ok) champs[`lines.${i}.specificTax`] = t.erreur;
      else
        specificTax =
          l.taxe === 'percent'
            ? { kind: 'percent', rate: t.valeur }
            : { kind: 'per_unit', amount: t.valeur };
    }
    if (q.ok && p.ok && l.taxGroup !== '' && l.itemType !== '' && l.name.trim() !== '') {
      lignes.push({
        source: 'free',
        code: l.code.trim() === '' ? null : l.code.trim(),
        name: l.name.trim(),
        itemType: l.itemType,
        taxGroup: l.taxGroup,
        outOfScope: l.taxGroup === 'A' && l.outOfScope,
        unit: l.unit.trim() === '' ? null : l.unit.trim(),
        quantity: q.valeur,
        unitPrice: p.valeur,
        specificTax,
        discount: remise.remise,
      });
    }
  });
  if (f.lignes.length > 200) champs['lines'] = '200 lignes au plus.';

  const payments: { method: InvoicePaymentMethod; amount: string }[] = [];
  f.paiements.forEach((p, i) => {
    if (p.montant.trim() === '') return;
    const m = lireMontantSaisi(p.montant);
    if (!m.ok) champs[`payments.${i}.amount`] = m.erreur;
    else payments.push({ method: p.method, amount: m.valeur });
  });

  if (Object.keys(champs).length > 0 || f.client === null || f.priceMode === '') {
    return { ok: false, champs };
  }
  const commentaire = (v: string): string | null =>
    v.trim() === '' ? null : v.trim().slice(0, 255);
  return {
    ok: true,
    corps: {
      type: f.type,
      currency: f.currency,
      priceMode: f.priceMode,
      customer:
        f.client.mode === 'fiche'
          ? { customerId: f.client.customerId, printContactDetails: f.client.printContactDetails }
          : { customerId: null, walkIn: { name: commentaire(f.client.nom) } },
      pointOfSaleId: null,
      lines: lignes,
      payments,
      comments: { A: commentaire(f.commentA), C: commentaire(f.commentC) },
      creditNote: estAvoir(f.type)
        ? { nature: f.nature ?? 'RRR', originInvoiceId: f.originInvoiceId }
        : null,
      showUsdCounterValue: f.currency === 'CDF' && f.showUsdCounterValue,
    },
  };
}

/**
 * « Un seul paiement égal au total » : RECOPIE le total servi par l'API
 * (aucun calcul), à confirmer par la personne (§ S25e.8). `null` si l'API n'a
 * pas encore pu calculer le total.
 */
export function paiementUnique(
  vue: Pick<InvoiceView, 'documentAmounts'>,
  method: InvoicePaymentMethod,
): PaiementFormulaire[] | null {
  const total = vue.documentAmounts.calculation.totals?.total ?? null;
  if (total === null) return null;
  return [{ cle: nouvelleCle('p'), method, montant: montantPourSaisie(total) }];
}

// ─────────────────────────────────────────────────────────────────────────────
// Normaliser
// ─────────────────────────────────────────────────────────────────────────────

export type ChoixTaux = 'officiel' | 'autre';

/**
 * Corps de `POST …/normalize`. Taux officiel : `exchangeRate: null`, le serveur
 * prend le taux publié par la DGI. Autre taux : il doit rester à ±1 % du taux
 * officiel — c'est le SERVEUR qui le vérifie (`EXCHANGE_RATE_OUT_OF_TOLERANCE`).
 */
export function preparerNormalisation(
  revision: number,
  choix: ChoixTaux,
  saisieTaux: string,
  date: string,
): { ok: true; corps: NormalizeInvoiceBody } | { ok: false; champs: Record<string, string> } {
  if (choix === 'officiel')
    return { ok: true, corps: { expectedRevision: revision, exchangeRate: null } };
  const champs: Record<string, string> = {};
  const lu = lireTauxChange(saisieTaux);
  if (!lu.ok) champs['rate'] = lu.erreur;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) champs['date'] = 'Indiquez la date du taux.';
  if (!lu.ok || champs['date']) return { ok: false, champs };
  return {
    ok: true,
    corps: { expectedRevision: revision, exchangeRate: { rate: lu.valeur, date } },
  };
}

/** Phrase de rappel de la tolérance, d'après la référence servie par l'API. */
export function rappelTolerance(ref: ExchangeRateReference): string {
  const tol = ref.tolerancePercent.replace('.', ',');
  return `Un autre taux doit rester à ±${tol} % du taux officiel (${formatTauxChange(ref.rate)}) : au-delà, la DGI refuserait la facture et le serveur le refuse avant.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Erreurs de l'API
// ─────────────────────────────────────────────────────────────────────────────

const MESSAGES_FACTURES: Record<string, string> = {
  FORBIDDEN: 'Votre rôle ne permet pas cette action sur les documents de vente.',
  INVOICE_NOT_FOUND: 'Ce document est introuvable. Il a peut-être été supprimé.',
  STALE_REVISION:
    'Ce document a été modifié par quelqu’un d’autre depuis que vous l’avez ouvert. Rechargez-le pour voir la dernière version, puis refaites vos modifications.',
  INVOICE_NOT_DRAFT:
    'Ce document est figé : il ne se modifie plus. Une facture émise se corrige par un avoir.',
  NORMALIZATION_REQUIRED:
    'Votre organisation est passée à la facture normalisée : ce document doit être normalisé, pas émis. Rechargez la page.',
  NORMALIZATION_NOT_ENABLED:
    'La facture normalisée n’est pas activée pour votre organisation : ce document s’émet directement. Rechargez la page.',
  NORMALIZATION_IN_PROGRESS:
    'Une autre normalisation est en cours pour votre organisation. Réessayez dans quelques minutes.',
  CUSTOMER_INACTIVE: 'Ce client est désactivé : réactivez-le ou choisissez-en un autre.',
  CATALOG_ITEM_INACTIVE:
    'Un article de ce document est désactivé : réactivez-le ou retirez la ligne.',
  TAX_GROUP_UNAVAILABLE: 'Un groupe de taxation de ce document n’est plus proposé par la DGI.',
  FISCAL_PROFILE_REQUIRED:
    'Complétez d’abord la fiche fiscale de votre organisation (Organisation › Fiscalité) : une facture porte le NIF et l’adresse du vendeur.',
  POINT_OF_SALE_NOT_ACTIVE:
    'Aucun point de vente actif pour l’environnement courant. Activez-en un dans Organisation › Fiscalité.',
  POINT_OF_SALE_NOT_FOUND: 'Ce point de vente est introuvable.',
  TAX_RATES_UNAVAILABLE:
    'Les taux de TVA de la DGI n’ont pas encore été relevés pour votre organisation. Rafraîchissez les listes de référence de votre point de vente (Organisation › Fiscalité).',
  EXCHANGE_RATE_REFERENCE_UNAVAILABLE:
    'Le taux officiel du jour n’est pas disponible. Rafraîchissez les listes de référence de votre point de vente (Organisation › Fiscalité), puis réessayez.',
  CREDIT_NOTE_ORIGIN_TYPE:
    'Un avoir se rattache à une vente ou un acompte du même régime (export ou non).',
  CREDIT_NOTE_ORIGIN_NOT_FINAL: 'Un avoir ne se crée que sur une facture émise ou normalisée.',
  CREDIT_NOTE_ORIGIN_MODE_MISMATCH:
    'Cette facture a été faite dans un autre mode d’émission : l’avoir n’est pas possible dans le logiciel pour l’instant.',
  CREDIT_NOTE_CURRENCY_MISMATCH: 'Un avoir garde la devise de la facture d’origine.',
  CREDIT_NOTE_PRICE_MODE_MISMATCH:
    'Un avoir garde le mode de prix (TTC ou HT) de la facture d’origine.',
  CREDIT_NOTE_NOTHING_REMAINING:
    'Tout a déjà été crédité sur cette facture : il ne reste rien à reprendre.',
  NOT_RETURNABLE_TO_DRAFT: 'Ce document ne peut pas être repris en brouillon dans son état actuel.',
  NUMBER_RESERVED:
    'Un numéro de facture est réservé pour ce document : sa reprise appartient à la connexion DGI, pas au brouillon.',
  INVOICE_NOT_ISSUABLE: 'Le document ne peut pas encore être figé. Corrigez les points ci-dessous.',
};

/** Message en français d'une erreur des documents de vente. */
export function messageFacture(err: unknown, repli: string): string {
  const code = codeErreur(err);
  if (code && MESSAGES_FACTURES[code]) return MESSAGES_FACTURES[code]!;
  return messageVentes(err, repli);
}

/** Problèmes d'un `422 INVOICE_NOT_ISSUABLE` (`details.issues`) : TOUS, en phrases. */
export function problemesGel(err: unknown): string[] {
  if (codeErreur(err) !== 'INVOICE_NOT_ISSUABLE') return [];
  const detail =
    typeof err === 'object' && err !== null && 'detail' in err
      ? (err as { detail: unknown }).detail
      : null;
  const details =
    typeof detail === 'object' && detail !== null
      ? (detail as Record<string, unknown>)['details']
      : null;
  const issues =
    typeof details === 'object' && details !== null
      ? (details as Record<string, unknown>)['issues']
      : null;
  if (!Array.isArray(issues)) return [];
  return issues.map((i: unknown) => {
    if (typeof i !== 'object' || i === null) return 'Problème non précisé.';
    const { message, code, lineIndex } = i as {
      message?: unknown;
      code?: unknown;
      lineIndex?: unknown;
    };
    const ligne = typeof lineIndex === 'number' ? `Ligne ${String(lineIndex + 1)} : ` : '';
    const texte =
      typeof message === 'string' && message !== ''
        ? message
        : typeof code === 'string'
          ? code
          : 'Problème non précisé.';
    return `${ligne}${texte}`;
  });
}

/** Phrase d'un empêchement (`readiness.blockers`), ligne comprise. */
export function libelleEmpechement(b: { message: string; lineIndex?: number | null }): string {
  return typeof b.lineIndex === 'number'
    ? `Ligne ${String(b.lineIndex + 1)} : ${b.message}`
    : b.message;
}

/** `409 EXCHANGE_RATE_REFERENCE_UNAVAILABLE` (ou 404) : proposer de rafraîchir les listes. */
export function tauxIndisponible(err: unknown): boolean {
  return codeErreur(err) === 'EXCHANGE_RATE_REFERENCE_UNAVAILABLE';
}
