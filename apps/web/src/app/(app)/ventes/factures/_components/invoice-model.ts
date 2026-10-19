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
  DgiExchangePage,
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
  NormalizationErrorCategory,
  NormalizationView,
  NormalizationViewPhase,
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
  normalization_uncertain: 'Réponse de la DGI incertaine',
  normalization_review_required: 'Vérification nécessaire',
  number_abandoned: 'Numéro abandonné (trou tracé dans la série)',
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
  > & { documentLabel?: string; normalization?: NormalizationView | null },
): EnteteDocument {
  const avoir = estAvoir(doc.type);
  // Défense en profondeur (ADR-0024 § 4.3) : un document « normalisé » dont la
  // vue complète ne porte pas son code DEF/DGI ne se dit pas « Facture ».
  // (`documentKind` de l'API est le verrou principal ; ceci ne joue que sur un
  // sous-document présent mais incomplet.)
  const elementsManquants =
    doc.status === 'normalized' &&
    doc.normalization !== undefined &&
    doc.normalization !== null &&
    !doc.normalization.codeDefDgi;
  if (doc.documentKind === 'invoice' && doc.number !== null && !elementsManquants) {
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
function toutCredite(lignes: InvoiceView['lines'] | undefined): boolean {
  if (!lignes || lignes.length === 0) return false;
  return lignes.every((l) => l.remaining !== undefined && comparerDecimaux(l.remaining, '0') === 0);
}

export function actionsDocument(
  doc: Pick<InvoiceView, 'status' | 'type' | 'readiness' | 'normalization'> & {
    lines?: InvoiceView['lines'];
  },
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
      // Tout crédité (restants servis par l'API, tous nuls) : rien à reprendre.
      if (droits.gerer && !estAvoir(doc.type) && !toutCredite(doc.lines)) out.push('avoir');
      break;
    case 'normalization_failed':
      // ADR-0024 § 9.2 : l'API dit elle-même, par `actions`, si la reprise est
      // possible pour cette personne. Sans ce bloc (document antérieur), la
      // règle d'ADR-0023 : droit de gérer et aucun numéro réservé.
      if (doc.normalization?.actions) {
        if (doc.normalization.actions.backToDraft) out.push('reprendre');
      } else if (droits.gerer && (doc.normalization?.reservedNumber ?? null) === null) {
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
    showUsdCounterValue: vue.showUsdCounterValue,
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
  // A est écrite par le serveur pour un client AO ; sinon, saisissable seulement
  // avec une ligne du groupe D (§ S25e.7), refusée par le serveur dans tout autre cas.
  if (typeClient === 'AO') return false;
  return f.lignes.some((l) => l.source === 'free' && l.taxGroup === 'D');
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
  // ADR-0024 § 9.1
  NORMALIZATION_NOT_RETRYABLE:
    'Cette normalisation ne peut pas être relancée dans son état actuel. Rechargez la page pour voir où elle en est.',
  NORMALIZATION_NOT_UNDER_REVIEW:
    'Ce document n’est plus en « vérification nécessaire » : Lalanda a peut-être conclu entre-temps. Rechargez la page.',
  REAUTH_REQUIRED: 'Confirmez votre identité pour poursuivre.',
  REAUTH_GOOGLE_REQUIRED: 'Reconnectez-vous avec Google pour poursuivre.',
};

const TROP_DE_NORMALISATIONS =
  'Vous avez lancé beaucoup de normalisations en une heure : par sécurité, attendez quelques minutes avant de recommencer.';

/** Message en français d'une erreur des documents de vente. */
export function messageFacture(err: unknown, repli: string): string {
  const code = codeErreur(err);
  if (code && MESSAGES_FACTURES[code]) return MESSAGES_FACTURES[code]!;
  if (statutHttp(err) === 429) return TROP_DE_NORMALISATIONS;
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

/** Statut HTTP d'une erreur de l'API, ou `null` (réseau, délai, erreur du navigateur). */
function statutHttp(err: unknown): number | null {
  if (typeof err !== 'object' || err === null || !('status' in err)) return null;
  const s = (err as { status: unknown }).status;
  return typeof s === 'number' ? s : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalisation DGI : déroulé, états, relectures (S25f — ADR-0024 § 9)
// ─────────────────────────────────────────────────────────────────────────────
//
// Trois règles de plus, imposées par `invoice-model.test.ts` :
//
// 4. LA REQUÊTE « NORMALISER » N'EST JAMAIS RENVOYÉE AUTOMATIQUEMENT. Après une
//    coupure côté navigateur, on RELIT le document (la route est idempotente,
//    § 9.3) : un second envoi pourrait, au pire, coûter un doublon fiscal.
// 5. LES RELECTURES SONT BORNÉES DANS LE TEMPS (3 s pendant 1 min ; 15 s jusqu'à
//    la vérification annoncée + 1 min ; 15 min au plus). Au-delà, un bouton.
// 6. LES BOUTONS VIENNENT DE `actions`, calculé par l'API selon la phase ET les
//    droits. L'interface n'en déduit rien d'autre.

/** Phase lue sur un document figé ; `null` pour un brouillon ou une facture émise. */
export function phaseNormalisation(
  doc: Pick<InvoiceView, 'status' | 'normalization'>,
): NormalizationViewPhase | null {
  switch (doc.status) {
    case 'normalized':
      return 'done';
    case 'normalization_failed':
      return 'failed';
    case 'pending_normalization': {
      // Document gelé avant S25f : pas de phase → `queued` (ADR-0024 § 10).
      const p = doc.normalization?.phase ?? 'queued';
      // Un document encore « en attente » ne se dit JAMAIS normalisé ni refusé :
      // une phase finale sur ce statut ne peut être qu'une écriture en cours.
      return p === 'done' || p === 'failed' ? 'in_progress' : p;
    }
    default:
      return null;
  }
}

/** Titres du tableau § 9.3, pour la fenêtre et pour le détail. */
export const TITRES_PHASE: Record<NormalizationViewPhase, string> = {
  done: 'Facture normalisée',
  in_progress: 'Transmission à la DGI…',
  queued: 'En attente d’envoi',
  uncertain: 'Réponse de la DGI incertaine',
  needs_review: 'Vérification nécessaire',
  failed: 'Normalisation refusée',
};

/** Ce que dit chaque catégorie d'erreur, et ce qu'il faut faire (ADR-0024 § 5). */
export const CONDUITE_CATEGORIE: Record<NormalizationErrorCategory, string> = {
  data: 'La DGI juge la facture mal formée. Reprenez-la en brouillon pour la corriger, puis normalisez-la de nouveau. L’équipe Lalanda est aussi alertée : ses contrôles auraient dû le voir avant l’envoi.',
  configuration:
    'Un réglage de la plateforme Lalanda manque pour la DGI. L’équipe Lalanda est alertée ; vous pourrez relancer quand elle l’aura corrigé.',
  capacity:
    'L’e-MCF de votre point de vente a trop de demandes en attente, sans doute envoyées par un autre logiciel. Réessayez dans deux minutes.',
  temporary:
    'Le service de la DGI est momentanément indisponible pour ce contrôle. Vous pouvez relancer dans quelques minutes.',
  server:
    'Le serveur de la DGI a signalé une erreur. Lalanda vérifie auprès de la DGI avant de conclure : ne refaites pas cette vente.',
  state:
    'La DGI a donné une réponse ambiguë sur l’état de la demande. Lalanda vérifie auprès d’elle avant de conclure.',
  totals_mismatch:
    'Rien n’a été enregistré : la demande a été annulée auprès de la DGI, aucune facture n’a été créée et le numéro n’a pas été consommé. L’écart est signalé à l’équipe Lalanda.',
  duplicate_pending:
    'Une demande portant ce numéro attend déjà à la DGI. Lalanda l’annule et vérifie avant de conclure : ne refaites pas cette vente.',
  unknown:
    'La DGI a renvoyé une erreur que Lalanda ne connaît pas encore. L’équipe Lalanda est alertée ; le code et le libellé de la DGI ci-dessous l’aideront.',
  network:
    'La DGI n’a pas pu être jointe. Lalanda vérifie avant de conclure : ne refaites pas cette vente.',
  token_rejected:
    'La DGI a refusé le jeton de votre point de vente. Renouvelez-le dans Organisation › Fiscalité, puis relancez.',
  precondition: 'Un prérequis manquait avant l’envoi : rien n’a été transmis à la DGI.',
};

/**
 * Codes Lalanda posés AVANT tout envoi (§ 9.1) : phrase de repli si le serveur
 * n'en donne pas, et lien vers l'onglet Fiscalité quand c'est là que se règle
 * le problème.
 */
const ERREURS_AVANT_ENVOI: Record<string, { message: string; fiscalite: boolean }> = {
  POINT_OF_SALE_NOT_ACTIVE: {
    message:
      'Le point de vente n’est pas actif (jeton expiré ou en échec). Vérifiez-le dans Organisation › Fiscalité.',
    fiscalite: true,
  },
  SELLER_NIF_MISMATCH: {
    message:
      'Le NIF du document ne correspond pas à celui du point de vente enregistré auprès de la DGI.',
    fiscalite: true,
  },
  ISF_NOT_CONFIGURED: {
    message:
      'L’identifiant du logiciel auprès de la DGI (ISF) n’est pas encore configuré par la plateforme. L’équipe Lalanda est alertée.',
    fiscalite: false,
  },
  REFERENCE_LISTS_UNAVAILABLE: {
    message:
      'Les listes de référence de la DGI (types de client, types de référence) n’ont pas été relevées. Rafraîchissez-les depuis votre point de vente.',
    fiscalite: true,
  },
  DGI_PRODUCTION_UNAVAILABLE: {
    message:
      'L’environnement de production de la DGI n’est pas encore ouvert dans Lalanda : rien n’a été transmis.',
    fiscalite: false,
  },
  NORMALIZATION_IN_PROGRESS: {
    message:
      'Une autre facture de votre organisation est en cours de normalisation, ou en vérification auprès de la DGI. Celle-ci attend son tour : les numéros de facture se suivent sans trou.',
    fiscalite: false,
  },
};

export interface ErreurNormalisation {
  /** Notre phrase, en français. */
  message: string;
  /** Ce qu'il faut faire, selon la catégorie. */
  conduite: string | null;
  /** Code Lalanda, pour l'assistance. */
  codeLalanda: string;
  /** Code et libellé DGI, TELS QUELS (exigence DGI) ; `null` si la DGI n'en a pas donné. */
  dgi: { code: string | null; libelle: string | null } | null;
  /** Le problème se règle dans Organisation › Fiscalité. */
  lienFiscalite: boolean;
}

export function erreurNormalisation(
  e: NonNullable<NormalizationView['lastError']>,
): ErreurNormalisation {
  const avant = ERREURS_AVANT_ENVOI[e.code];
  const message =
    e.message.trim() !== '' ? e.message : (avant?.message ?? 'La normalisation n’a pas abouti.');
  const dgi =
    e.dgiErrorCode !== null || e.dgiMessage !== null
      ? { code: e.dgiErrorCode, libelle: e.dgiMessage }
      : null;
  return {
    message,
    conduite: e.category ? CONDUITE_CATEGORIE[e.category] : null,
    codeLalanda: e.code,
    dgi,
    lienFiscalite: (avant?.fiscalite ?? false) || e.category === 'token_rejected',
  };
}

/** Champ de totaux e-DEF (`vab`, `ts`…) en mots. */
export function libelleChampDgi(champ: string): string {
  const m = /^(t|ta|ha|va)([a-p])$/.exec(champ);
  if (m) {
    const groupe = (m[2] ?? '').toUpperCase();
    const nature =
      m[1] === 't' ? 'Taux' : m[1] === 'ta' ? 'Total' : m[1] === 'ha' ? 'Hors taxe' : 'TVA';
    return `${nature} du groupe ${groupe}`;
  }
  const fixes: Record<string, string> = {
    ts: 'Taxe spécifique',
    total: 'Total à payer',
    vtotal: 'TVA totale',
    curTotal: 'Contre-valeur en USD',
  };
  return fixes[champ] ?? champ;
}

export interface EcartAffiche {
  champ: string;
  libelle: string;
  /** Valeurs TELLES QUE CONSERVÉES par l'API : aucune conversion, aucun arrondi. */
  lalanda: string;
  dgi: string;
}

export function ecartsAffiches(
  differences: NormalizationView['differences'],
): EcartAffiche[] | null {
  if (!differences || differences.length === 0) return null;
  return differences.map((d) => ({
    champ: d.field,
    libelle: libelleChampDgi(d.field),
    lalanda: d.ours ?? '—',
    dgi: d.dgi ?? 'absent',
  }));
}

/** Heure locale `HH:MM` d'un instant ISO ; `null` si illisible. */
export function formatHeure(iso: string | null, timeZone?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  });
}

/** Date et heure d'un instant ISO (`19 oct. 2026, 09:03:12`). */
export function formatInstant(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  });
}

/** Éléments de sécurité DGI, chaînes affichées TELLES QUE REÇUES. */
export function elementsDgi(
  n: NormalizationView | null,
): { libelle: string; valeur: string }[] | null {
  if (!n || !n.codeDefDgi) return null;
  const out = [{ libelle: 'Code DEF/DGI', valeur: n.codeDefDgi }];
  if (n.nim) out.push({ libelle: 'NIM (identifiant de l’e-MCF)', valeur: n.nim });
  if (n.counters) out.push({ libelle: 'Compteurs', valeur: n.counters });
  if (n.dgiDateTime) out.push({ libelle: 'Date DGI', valeur: n.dgiDateTime });
  return out;
}

export type BoutonNormalisation = 'relancer' | 'verifier' | 'declarer';

export interface PresentationNormalisation {
  phase: NormalizationViewPhase;
  titre: string;
  /** Ton du bandeau : `alerte` pour l'incertitude et la vérification nécessaire. */
  ton: 'info' | 'succes' | 'attention' | 'alerte';
  /** Phrase principale. */
  resume: string;
  /** Ce que la personne doit faire (ou ne pas faire), dans l'ordre. */
  consignes: string[];
  erreur: ErreurNormalisation | null;
  ecarts: EcartAffiche[] | null;
  elements: { libelle: string; valeur: string }[] | null;
  /** Identifiant de la demande à la DGI, utile à l'assistance DGI. */
  demandeDgi: string | null;
  /** Selon `actions` SEULEMENT (règle 6). « Reprendre en brouillon » vit dans le détail. */
  boutons: BoutonNormalisation[];
  /** Motif et date du passage en vérification nécessaire. */
  revue: { depuis: string; motif: string } | null;
}

const PRO_FORMA_RESTE = 'Le document reste un pro forma, non valable comme facture.';

/** Ce que l'interface affiche pour un document figé en mode normalisé (§ 9.3). */
export function presentationNormalisation(
  doc: Pick<InvoiceView, 'status' | 'normalization'>,
  options: { timeZone?: string } = {},
): PresentationNormalisation | null {
  const phase = phaseNormalisation(doc);
  if (phase === null) return null;
  const n = doc.normalization;
  const heure = formatHeure(n?.nextCheckAt ?? null, options.timeZone);
  const a = n?.actions ?? { retry: false, check: false, declareNotNormalized: false };
  const boutons: BoutonNormalisation[] = [];
  if (phase !== 'done' && phase !== 'in_progress') {
    if (a.retry) boutons.push('relancer');
    if (a.check) boutons.push('verifier');
    if (a.declareNotNormalized) boutons.push('declarer');
  }
  const base: PresentationNormalisation = {
    phase,
    titre: TITRES_PHASE[phase],
    ton: 'info',
    resume: '',
    consignes: [],
    erreur: n?.lastError ? erreurNormalisation(n.lastError) : null,
    ecarts: phase === 'failed' ? ecartsAffiches(n?.differences ?? null) : null,
    elements: null,
    demandeDgi: n?.dgiRequestId ?? null,
    boutons,
    revue: n?.review ? { depuis: n.review.since, motif: n.review.reason } : null,
  };
  switch (phase) {
    case 'done':
      return {
        ...base,
        ton: 'succes',
        erreur: null,
        resume:
          'La DGI a confirmé la facture. Ses éléments de sécurité sont enregistrés tels qu’elle les a renvoyés.',
        elements: elementsDgi(n),
      };
    case 'in_progress':
      return {
        ...base,
        erreur: null,
        resume: `Lalanda envoie le document à la DGI, compare les montants qu’elle calcule aux siens, puis demande la confirmation. Cela prend d’habitude moins d’une seconde. ${PRO_FORMA_RESTE}`,
        consignes: ['Ne refaites pas cette vente pendant la transmission.'],
      };
    case 'queued':
      return {
        ...base,
        ton: 'attention',
        resume: `Le document est figé et attend d’être envoyé à la DGI. ${PRO_FORMA_RESTE}`,
        consignes: a.retry
          ? ['Relancez l’envoi quand le point signalé est réglé.']
          : ['Une personne habilitée à normaliser pourra relancer l’envoi.'],
      };
    case 'uncertain':
      return {
        ...base,
        ton: 'alerte',
        resume: `La DGI n’a pas répondu de façon certaine : Lalanda ne sait pas encore si la facture a été normalisée. ${PRO_FORMA_RESTE}`,
        consignes: [
          heure
            ? `Ne refaites pas cette vente : Lalanda vérifie auprès de la DGI vers ${heure}.`
            : 'Ne refaites pas cette vente : Lalanda vérifie auprès de la DGI dans quelques minutes.',
          'Pendant cette vérification, les autres normalisations de votre organisation attendent leur tour (au plus une trentaine de minutes) : c’est ce qui garde les numéros de facture dans l’ordre, sans doublon.',
        ],
      };
    case 'needs_review':
      return {
        ...base,
        ton: 'alerte',
        resume: `Lalanda n’a pas pu établir si la DGI a normalisé cette facture. Rien n’est imprimé ni renvoyé comme facture. ${PRO_FORMA_RESTE}`,
        consignes: [
          heure
            ? `Attendez la prochaine vérification automatique (vers ${heure}) : elle suffit souvent quand la DGI était injoignable.`
            : 'Attendez la prochaine vérification automatique : elle suffit souvent quand la DGI était injoignable.',
          'Sinon, le Propriétaire ou le Directeur financier vérifie auprès de la DGI (site de vérification ou assistance DGI), en donnant l’identifiant de la demande indiqué ici.',
          'S’il est établi que la facture n’a pas été normalisée, il le déclare dans Lalanda, avec un motif écrit. Personne ne saisit jamais d’éléments de sécurité à la main.',
          'Les autres factures de votre organisation peuvent de nouveau être normalisées ; le numéro réservé reste attaché à ce document.',
        ],
      };
    case 'failed': {
      const ecart = n?.lastError?.category === 'totals_mismatch' || base.ecarts !== null;
      return {
        ...base,
        ton: 'attention',
        resume: ecart
          ? `Écart de calcul entre Lalanda et la DGI. ${PRO_FORMA_RESTE}`
          : `La DGI n’a pas normalisé ce document. ${PRO_FORMA_RESTE}`,
        consignes: a.retry
          ? ['Vous pouvez relancer la normalisation : le contenu figé sera renvoyé à l’identique.']
          : [],
      };
    }
  }
}

// ── Progression : gel, envoi, comparaison, confirmation ─────────────────────

export type EtatEtape = 'en_cours' | 'fait' | 'echec' | 'incertain' | 'non_fait' | 'a_venir';

export interface EtapeNormalisation {
  cle: 'gel' | 'envoi' | 'comparaison' | 'confirmation';
  libelle: string;
  etat: EtatEtape;
}

const LIBELLES_ETAPES: Record<EtapeNormalisation['cle'], string> = {
  gel: 'Gel du document et conversion en CDF',
  envoi: 'Envoi à la DGI',
  comparaison: 'Comparaison des montants',
  confirmation: 'Confirmation par la DGI',
};

export const LIBELLES_ETAT_ETAPE: Record<EtatEtape, string> = {
  en_cours: 'en cours',
  fait: 'fait',
  echec: 'échec',
  incertain: 'réponse incertaine',
  non_fait: 'non effectué',
  a_venir: 'à venir',
};

type QuatreEtats = [EtatEtape, EtatEtape, EtatEtape, EtatEtape];

function etatsApresReponse(doc: Pick<InvoiceView, 'status' | 'normalization'>): QuatreEtats {
  const phase = phaseNormalisation(doc);
  const n = doc.normalization;
  const envoye = (n?.dgiRequestId ?? null) !== null;
  const ecart = (n?.differences?.length ?? 0) > 0;
  const cat = n?.lastError?.category ?? null;
  switch (phase) {
    case 'done':
      return ['fait', 'fait', 'fait', 'fait'];
    case 'queued':
      return ['fait', 'a_venir', 'a_venir', 'a_venir'];
    case 'in_progress':
      return envoye
        ? ['fait', 'fait', 'en_cours', 'en_cours']
        : ['fait', 'en_cours', 'a_venir', 'a_venir'];
    case 'uncertain':
    case 'needs_review':
      if (ecart) return ['fait', 'fait', 'echec', 'non_fait'];
      return envoye
        ? ['fait', 'fait', 'fait', 'incertain']
        : ['fait', 'incertain', 'non_fait', 'non_fait'];
    case 'failed':
      if (ecart) return ['fait', 'fait', 'echec', 'non_fait'];
      if (cat === 'totals_mismatch') return ['fait', 'fait', 'fait', 'echec'];
      if (cat === 'precondition') return ['fait', 'non_fait', 'non_fait', 'non_fait'];
      return envoye ? ['fait', 'fait', 'fait', 'echec'] : ['fait', 'echec', 'non_fait', 'non_fait'];
    default:
      return ['a_venir', 'a_venir', 'a_venir', 'a_venir'];
  }
}

/**
 * Où en est chaque étape. Pendant la requête (`enCours`), l'API ne dit pas
 * laquelle se joue : toutes sont « en cours », aucune n'est annoncée faite
 * avant la réponse. Ensuite, l'état se DÉDUIT de la vue renvoyée — phase,
 * catégorie d'erreur, présence d'un identifiant de demande DGI, écarts.
 */
export function etapesNormalisation(
  doc: Pick<InvoiceView, 'status' | 'normalization'> | null,
  enCours: boolean,
): EtapeNormalisation[] {
  const etats: QuatreEtats =
    enCours || doc === null
      ? ['en_cours', 'en_cours', 'en_cours', 'en_cours']
      : etatsApresReponse(doc);
  const cles: EtapeNormalisation['cle'][] = ['gel', 'envoi', 'comparaison', 'confirmation'];
  return cles.map((cle, i) => ({
    cle,
    libelle: LIBELLES_ETAPES[cle],
    etat: etats[i] ?? 'a_venir',
  }));
}

// ── Relectures bornées (règle 5) ────────────────────────────────────────────

export const RELECTURE = {
  /** `in_progress` : toutes les 3 s… */
  enCoursMs: 3_000,
  /** … pendant une minute au plus. */
  enCoursDureeMs: 60_000,
  /** `uncertain` : toutes les 15 s… */
  incertainMs: 15_000,
  /** … jusqu'à la vérification annoncée plus une minute. */
  margeMs: 60_000,
  /** `uncertain` sans heure annoncée : trois minutes. */
  incertainSansDateMs: 180_000,
  /** Plafond absolu, quoi que dise `nextCheckAt`. */
  plafondMs: 900_000,
} as const;

/**
 * Délai avant la prochaine relecture (`GET`), ou `null` : on s'arrête. `debut`
 * est l'instant où la page a vu la phase courante pour la première fois.
 */
export function prochaineRelecture(
  doc: Pick<InvoiceView, 'status' | 'normalization'>,
  debut: number,
  maintenant: number,
): number | null {
  const ecoule = maintenant - debut;
  if (ecoule >= RELECTURE.plafondMs) return null;
  const phase = phaseNormalisation(doc);
  if (phase === 'in_progress') {
    return ecoule < RELECTURE.enCoursDureeMs ? RELECTURE.enCoursMs : null;
  }
  if (phase === 'uncertain') {
    const prevue = doc.normalization?.nextCheckAt;
    const annonce = prevue ? Date.parse(prevue) : Number.NaN;
    const limite = Number.isNaN(annonce)
      ? debut + RELECTURE.incertainSansDateMs
      : annonce + RELECTURE.margeMs;
    return maintenant < limite ? RELECTURE.incertainMs : null;
  }
  return null;
}

/**
 * Après l'échec de `POST …/normalize` côté navigateur : `afficher` l'erreur
 * (refus clair de l'API, 4xx), ou `relire` le document (réseau, délai, 5xx d'un
 * mandataire : la requête a pu aboutir côté serveur). JAMAIS « renvoyer »
 * (règle 4).
 */
export function conduiteApresEchecNormaliser(err: unknown): 'afficher' | 'relire' {
  const s = statutHttp(err);
  return s !== null && s >= 400 && s < 500 ? 'afficher' : 'relire';
}

// ── Déclarer « non normalisée » (§ 4.4) ─────────────────────────────────────

export const MOTIF_MIN = 20;
export const MOTIF_MAX = 500;

export function lireMotifDeclaration(
  saisie: string,
): { ok: true; motif: string } | { ok: false; erreur: string } {
  const motif = saisie.trim();
  if (motif.length < MOTIF_MIN) {
    return {
      ok: false,
      erreur: `Décrivez en ${String(MOTIF_MIN)} caractères au moins comment vous avez établi que la facture n’a pas été normalisée.`,
    };
  }
  if (motif.length > MOTIF_MAX) {
    return { ok: false, erreur: `Le motif ne doit pas dépasser ${String(MOTIF_MAX)} caractères.` };
  }
  return { ok: true, motif };
}

// ── Échanges DGI du document (§ 6, § 9.3) ───────────────────────────────────

const RESULTATS_ECHANGE: Record<string, string> = {
  ok: 'Réussi',
  production_disabled: 'Production fermée : aucun appel',
  unauthorized: 'Jeton refusé (401)',
  timeout: 'Sans réponse (délai dépassé)',
  network: 'DGI injoignable',
  server: 'Erreur du serveur DGI',
  business: 'Refus de la DGI',
  invalid_response: 'Réponse illisible',
};

function operationEchange(method: string, path: string): string {
  const m = method.toUpperCase();
  if (m === 'POST' && /\/api\/invoice\/?$/.test(path)) return 'Envoi de la facture';
  if (m === 'PUT' && /\/confirm\/?$/.test(path)) return 'Confirmation';
  if (m === 'PUT' && /\/cancel\/?$/.test(path)) return 'Annulation';
  if (m === 'GET' && /\/api\/invoice\/[^/]+\/?$/.test(path)) return 'Lecture de la demande';
  if (m === 'GET' && /\/api\/invoice\/?$/.test(path)) return 'Demandes en attente';
  if (/\/api\/info\/status/.test(path)) return 'Statut de l’e-MCF';
  return 'Échange';
}

/** Clés masquées par défense en profondeur : l'API n'en renvoie jamais. */
const CLES_SECRETES = /token|authorization|password|secret|bearer/i;

function masquer(valeur: unknown): unknown {
  if (Array.isArray(valeur)) return valeur.map(masquer);
  if (typeof valeur === 'object' && valeur !== null) {
    return Object.fromEntries(
      Object.entries(valeur).map(([k, v]) => [k, CLES_SECRETES.test(k) ? '[masqué]' : masquer(v)]),
    );
  }
  return valeur;
}

/**
 * Corps d'un échange, à afficher. Le TEXTE servi est rendu tel quel (les
 * nombres e-DEF ne sont jamais reconvertis) ; `JSON.parse` ne sert qu'à repérer
 * une clé ressemblant à un secret. Si l'une existe — l'API n'en renvoie jamais,
 * l'interface s'en assure — le corps est réécrit avec la valeur masquée. Tout
 * « Bearer … » est masqué aussi.
 */
export function corpsLisible(body: string | null): string | null {
  if (body === null || body === '') return null;
  const sansJeton = body.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [masqué]');
  try {
    const lu: unknown = JSON.parse(sansJeton);
    if (typeof lu !== 'object' || lu === null) return sansJeton;
    const masque = masquer(lu);
    return JSON.stringify(masque) === JSON.stringify(lu)
      ? sansJeton
      : JSON.stringify(masque, null, 2);
  } catch {
    return sansJeton;
  }
}

export interface LigneEchange {
  cle: string;
  date: string;
  sens: string;
  operation: string;
  route: string;
  resultat: string | null;
  http: string | null;
  duree: string | null;
  codeDgi: string | null;
  corps: string | null;
}

export function lignesEchanges(page: DgiExchangePage): LigneEchange[] {
  return page.items.map((e, i) => ({
    cle: `${e.exchangeId}-${e.entry}-${String(i)}`,
    date: e.at,
    sens:
      e.entry === 'request'
        ? 'Requête envoyée'
        : e.entry === 'response'
          ? 'Réponse reçue'
          : 'Lecture',
    operation: operationEchange(e.method, e.path),
    route: `${e.method.toUpperCase()} ${e.path}`,
    resultat: e.outcome === null ? null : (RESULTATS_ECHANGE[e.outcome] ?? e.outcome),
    http: e.httpStatus === null ? null : String(e.httpStatus),
    duree: e.durationMs === null ? null : `${String(e.durationMs)} ms`,
    codeDgi: e.dgiErrorCode,
    corps: corpsLisible(e.body),
  }));
}
