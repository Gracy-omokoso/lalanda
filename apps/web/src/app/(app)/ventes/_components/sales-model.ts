// Logique pure de l'espace Ventes : clients et catalogue (S25c — ADR-0022,
// chantier D2).
//
// Isolée du rendu pour être testable : `apps/web` tourne vitest en environnement
// `node`, sans DOM. Tout ce qui décide vit ici, les `.tsx` assemblent.
//
// Deux règles tiennent ce fichier, et un test les impose en lisant sa source :
//
// 1. AUCUN CALCUL DE MONTANT. Un prix est une chaîne décimale saisie, vérifiée
//    dans sa FORME (chiffres, une virgule, deux décimales au plus) puis transmise
//    telle quelle ; un prix servi par l'API est mis en forme par manipulation de
//    chaîne. Ni `Number()`, ni `parseFloat`, ni `parseInt` : `0,1 + 0,2 ≠ 0,3`
//    suffit à rater une comparaison au centime avec la DGI (docs/26, ADR-0022
//    § O3). Les totaux d'une facture viendront du moteur, jamais d'ici.
// 2. RIEN N'AUTORISE. Les contrôles de ce module sont un CONFORT — éviter un
//    aller-retour pour un champ oublié. Le serveur reste seul juge (règles du
//    § S25c.2–3) et ses refus s'affichent champ par champ.

import type {
  CatalogItemBody,
  CatalogItemListQuery,
  CatalogItemType,
  CatalogItemView,
  CatalogPriceMode,
  CatalogSpecificTax,
  CustomerBody,
  CustomerListQuery,
  CustomerType,
  CustomerView,
  OrgAction,
  SalesStatusFilter,
  TaxGroupLetter,
  TaxGroupList,
  TaxGroupOption,
} from '@/lib/api';

// Ce module ne dépend d'aucun autre espace : les quelques fonctions de lecture
// d'erreur qu'il partage avec l'onglet Fiscalité sont reprises ci-dessous, à
// l'identique dans leur comportement, plutôt qu'importées de `organisation/`
// (qui tire le catalogue des offres dans l'espace Ventes).

// ─────────────────────────────────────────────────────────────────────────────
// Accès et onglets
// ─────────────────────────────────────────────────────────────────────────────

export const VENTES_BASE = '/ventes';

export interface SalesTab {
  segment: 'clients' | 'catalogue';
  label: string;
  action: OrgAction;
}

/** L'ordre du tableau est l'ordre d'affichage (ADR-0022, chantier D2). */
export const SALES_TABS: readonly SalesTab[] = [
  { segment: 'clients', label: 'Clients', action: 'sales.read' },
  { segment: 'catalogue', label: 'Catalogue', action: 'sales.read' },
];

/**
 * Onglets proposés. `null` (permissions pas encore connues) : aucun — afficher
 * puis retirer ferait clignoter l'interface. Un ÉCHEC de lecture des
 * permissions est traité par l'appelant (voir `sales-access.tsx`).
 */
export function ongletsVentes(actions: readonly OrgAction[] | null): SalesTab[] {
  if (actions === null) return [];
  return SALES_TABS.filter((t) => actions.includes(t.action));
}

/** Premier segment sous `/ventes/` — '' sur la racine. */
export function segmentVentes(pathname: string): string {
  if (pathname !== VENTES_BASE && !pathname.startsWith(`${VENTES_BASE}/`)) return '';
  return pathname.slice(VENTES_BASE.length).split('/').filter(Boolean)[0] ?? '';
}

export function peutConsulter(actions: readonly OrgAction[] | null): boolean {
  return actions !== null && actions.includes('sales.read');
}

/**
 * Peut-on écrire ? `null` (inconnu) répond NON : l'écran reste en lecture seule
 * tant que le serveur n'a pas dit le contraire — mieux vaut un bouton qui
 * apparaît qu'un bouton qui répond 403.
 */
export function peutGerer(actions: readonly OrgAction[] | null): boolean {
  return actions !== null && actions.includes('sales.manage');
}

// ─────────────────────────────────────────────────────────────────────────────
// Montants : forme seulement, jamais de calcul
// ─────────────────────────────────────────────────────────────────────────────

/** Espace fine insécable : séparateur des milliers en français (comme `fr-FR`). */
const MILLIERS = ' ';
/** Espace insécable : le montant et sa devise ne se séparent jamais en fin de ligne. */
const INSECABLE = ' ';

const DECIMAL_CANONIQUE = /^\d+(\.\d+)?$/;

/** Groupe les chiffres par trois à partir de la droite. Chaîne de chiffres en entrée. */
function grouperMilliers(entier: string): string {
  const sansZeros = entier.replace(/^0+(?=\d)/, '');
  let out = '';
  for (let i = 0; i < sansZeros.length; i++) {
    const resteADroite = sansZeros.length - i;
    if (i > 0 && resteADroite % 3 === 0) out += MILLIERS;
    out += sansZeros[i];
  }
  return out;
}

/**
 * `"1234.5"` → `1 234,50 CDF`.
 *
 * Mise en forme par manipulation de chaîne : deux décimales au moins (complétées
 * par des zéros), jamais ARRONDIE — une valeur à trois décimales garde ses trois
 * chiffres, parce qu'arrondir ici serait calculer. Une valeur qui n'est pas un
 * décimal reste visible telle quelle : masquer une anomalie serait pire.
 */
export function formatMontant(valeur: string, devise: string = 'CDF'): string {
  if (!DECIMAL_CANONIQUE.test(valeur)) return `${valeur}${INSECABLE}${devise}`;
  const [entier = '0', decimales = ''] = valeur.split('.');
  const dec = decimales.length >= 2 ? decimales : decimales.padEnd(2, '0');
  return `${grouperMilliers(entier)},${dec}${INSECABLE}${devise}`;
}

/** Taux servi par l'API (`"16"`, `"16.5"`) → `16 %`, `16,5 %`. `null` → `null`. */
export function formatTaux(ratePercent: string | null): string | null {
  if (ratePercent === null) return null;
  if (!DECIMAL_CANONIQUE.test(ratePercent)) return `${ratePercent}${INSECABLE}%`;
  return `${ratePercent.replace('.', ',')}${INSECABLE}%`;
}

/** Montant de l'API (`"1234.50"`) → texte à éditer (`"1234,50"`), sans séparateur de milliers. */
export function montantPourSaisie(valeur: string): string {
  return valeur.replace('.', ',');
}

export type LectureDecimal = { ok: true; valeur: string } | { ok: false; erreur: string };

/**
 * Lit un montant saisi à la française et le rend dans la forme du contrat
 * (`^\d{1,13}(\.\d{1,2})?$`, strictement positif).
 *
 * Espaces (ordinaires, insécables, fines) ignorés ; la virgule ou le point sert
 * de séparateur décimal, une seule fois. La valeur rendue est une CHAÎNE,
 * jamais un nombre ; l'API la canonicalise (`"464"` → `"464.00"`).
 */
export function lireMontantSaisi(saisie: string): LectureDecimal {
  const s = saisie.replace(/[\s  ]/g, '').replace(',', '.');
  if (s === '') return { ok: false, erreur: 'Saisissez un montant.' };
  if (!/^\d+(\.\d*)?$/.test(s)) {
    return {
      ok: false,
      erreur: 'Montant invalide : des chiffres et une virgule, par exemple 1 234,50.',
    };
  }
  const [entierBrut = '', decimales = ''] = s.split('.');
  if (decimales.length > 2) return { ok: false, erreur: 'Deux décimales au plus.' };
  const entier = entierBrut.replace(/^0+(?=\d)/, '');
  if (entier.length > 13) return { ok: false, erreur: 'Montant trop grand (13 chiffres au plus).' };
  if (/^0+$/.test(entier) && /^0*$/.test(decimales)) {
    return { ok: false, erreur: 'Le montant doit être supérieur à zéro.' };
  }
  return { ok: true, valeur: decimales === '' ? entier : `${entier}.${decimales}` };
}

/**
 * Lit un taux de taxe spécifique en pour cent : mêmes règles qu'un montant, et
 * strictement inférieur à 100 (§ S25c.3). La borne se vérifie sur le NOMBRE DE
 * CHIFFRES de la partie entière — aucune comparaison numérique.
 */
export function lireTauxSaisi(saisie: string): LectureDecimal {
  const lu = lireMontantSaisi(saisie.replace(/%/g, ''));
  if (!lu.ok) {
    return lu.erreur === 'Saisissez un montant.' ? { ok: false, erreur: 'Saisissez un taux.' } : lu;
  }
  const entier = lu.valeur.split('.')[0] ?? '';
  if (entier.length > 2) return { ok: false, erreur: 'Le taux doit être inférieur à 100 %.' };
  return lu;
}

// ─────────────────────────────────────────────────────────────────────────────
// Clients : les cinq types de la DGI
// ─────────────────────────────────────────────────────────────────────────────

export interface CustomerTypeOption {
  value: CustomerType;
  label: string;
  /** Ce que la DGI exige pour ce type, en une phrase. */
  aide: string;
}

/** Les cinq types (`ClientTypeEnum`), dans l'ordre du tableau de l'ADR-0022. */
export const CUSTOMER_TYPES: readonly CustomerTypeOption[] = [
  { value: 'PP', label: 'Personne physique', aide: 'Un particulier. Le NIF est facultatif.' },
  {
    value: 'PM',
    label: 'Personne morale',
    aide: 'Une société, une association… La dénomination et le NIF sont obligatoires.',
  },
  {
    value: 'PC',
    label: 'Personne physique commerçante',
    aide: 'Un commerçant en nom propre. Le nom et le NIF sont obligatoires.',
  },
  {
    value: 'PL',
    label: 'Profession libérale',
    aide: 'Avocat, médecin, consultant… Le nom et le NIF sont obligatoires.',
  },
  {
    value: 'AO',
    label: 'Ambassade, organisation internationale',
    aide: 'La référence du document d’exonération est obligatoire ; elle est imprimée sur la facture.',
  },
];

export function libelleTypeClient(type: CustomerType): string {
  return CUSTOMER_TYPES.find((t) => t.value === type)?.label ?? type;
}

export interface RequiredCustomerFields {
  name: boolean;
  nif: boolean;
  exemptionReference: boolean;
}

/**
 * Champs exigés selon le type (§ S25c.2) : le nom pour tous, le NIF pour PM, PC
 * et PL, la référence d'exonération pour AO seulement.
 */
export function requiredFieldsFor(type: CustomerType): RequiredCustomerFields {
  return {
    name: true,
    nif: type === 'PM' || type === 'PC' || type === 'PL',
    exemptionReference: type === 'AO',
  };
}

/** La référence d'exonération n'existe que pour AO ; l'API impose `null` ailleurs. */
export function referenceExonerationAdmise(type: CustomerType | ''): boolean {
  return type === 'AO';
}

/** « Dénomination » pour une personne morale, « Nom » sinon. */
export function libelleNom(type: CustomerType | ''): string {
  return type === 'PM' ? 'Dénomination' : 'Nom';
}

/** Tous les champs en texte, comme les saisit le formulaire. */
export interface FormulaireClient {
  type: CustomerType | '';
  name: string;
  nif: string;
  exemptionReference: string;
  phone: string;
  email: string;
  address: string;
}

export type ChampClient = keyof FormulaireClient;

export function formulaireClient(vue: CustomerView | null): FormulaireClient {
  return {
    // Pas de type par défaut : il est obligatoire et commande les champs exigés.
    // Le choisir à la place de la personne ferait passer un PM pour un PP.
    type: vue?.type ?? '',
    name: vue?.name ?? '',
    nif: vue?.nif ?? '',
    exemptionReference: vue?.exemptionReference ?? '',
    phone: vue?.phone ?? '',
    email: vue?.email ?? '',
    address: vue?.address ?? '',
  };
}

const ouNull = (v: string): string | null => (v.trim() === '' ? null : v.trim());

export type Preparation<C, K extends string> =
  { ok: true; corps: C } | { ok: false; champs: Partial<Record<K, string>> };

/**
 * Contrôle de confort puis corps de requête.
 *
 * Le NIF part tel que saisi (espaces de bord retirés) : c'est le serveur qui le
 * normalise (`"a 000-0000x"` → `"A0000000X"`). La référence d'exonération part
 * à `null` hors AO, même si la personne en avait saisi une avant de changer de
 * type.
 */
export function preparerClient(f: FormulaireClient): Preparation<CustomerBody, ChampClient> {
  const champs: Partial<Record<ChampClient, string>> = {};
  if (f.type === '') {
    champs.type = 'Choisissez le type de client.';
    if (f.name.trim() === '') champs.name = 'Ce champ est obligatoire.';
    return { ok: false, champs };
  }
  const requis = requiredFieldsFor(f.type);
  if (f.name.trim() === '') champs.name = `${libelleNom(f.type)} : ce champ est obligatoire.`;
  if (requis.nif && f.nif.trim() === '') {
    champs.nif = `Le NIF est obligatoire pour une ${libelleTypeClient(f.type).toLowerCase()}.`;
  }
  if (requis.exemptionReference && f.exemptionReference.trim() === '') {
    champs.exemptionReference =
      'La référence du document d’exonération est obligatoire pour une ambassade ou une organisation internationale.';
  }
  if (Object.keys(champs).length > 0) return { ok: false, champs };
  return {
    ok: true,
    corps: {
      type: f.type,
      name: f.name.trim(),
      nif: ouNull(f.nif),
      exemptionReference: referenceExonerationAdmise(f.type) ? ouNull(f.exemptionReference) : null,
      phone: ouNull(f.phone),
      email: ouNull(f.email),
      address: ouNull(f.address),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Catalogue
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Code imposé par la DGI pour une opération hors champ (groupe A). L'API le
 * calcule (`edefCode`) ; il n'est repris ici que pour l'APERÇU du formulaire,
 * avant enregistrement. Orthographe à confirmer auprès de la DGI (ADR-0022).
 */
export const OUT_OF_SCOPE_ITEM_CODE = 'HORS CHAMP';

/**
 * Groupes où une taxe spécifique est interdite (§ S25c.3 : L et N, ceux des
 * articles de type « Taxe »). Le serveur refuse de toute façon
 * (`SPECIFIC_TAX_NOT_ALLOWED`) ; masquer le choix évite seulement un refus.
 */
const GROUPES_SANS_TAXE_SPECIFIQUE: readonly TaxGroupLetter[] = ['L', 'N'];

export function taxeSpecifiqueAdmise(groupe: TaxGroupLetter | ''): boolean {
  return groupe !== '' && !GROUPES_SANS_TAXE_SPECIFIQUE.includes(groupe);
}

export const ITEM_TYPE_LABELS: Record<CatalogItemType, string> = {
  BIE: 'Bien',
  SER: 'Service',
  TAX: 'Taxe',
};

export const PRICE_MODE_LABELS: Record<CatalogPriceMode, { court: string; long: string }> = {
  ttc: { court: 'TTC', long: 'TTC — taxes comprises' },
  ht: { court: 'HT', long: 'HT — hors taxes' },
};

export function groupeDe(
  liste: TaxGroupList | null,
  lettre: TaxGroupLetter | '',
): TaxGroupOption | undefined {
  if (!liste || lettre === '') return undefined;
  return liste.groups.find((g) => g.letter === lettre);
}

/** Types d'article admis par le groupe, tels que l'API les sert. */
export function typesAdmis(
  liste: TaxGroupList | null,
  lettre: TaxGroupLetter | '',
): CatalogItemType[] {
  return groupeDe(liste, lettre)?.itemTypes ?? [];
}

/** `B — Taxable 16 % · taux 16 %`, ou sans taux quand la liste est celle par défaut. */
export function libelleGroupe(g: TaxGroupOption): string {
  const taux = formatTaux(g.ratePercent);
  return taux === null ? `${g.letter} — ${g.label}` : `${g.letter} — ${g.label} · taux ${taux}`;
}

/**
 * Bandeau d'origine de la liste des groupes. La liste par défaut ne porte aucun
 * taux (ADR-0019 interdit de les coder) : on le dit plutôt que de laisser croire
 * qu'ils manquent par erreur.
 */
export function bandeauGroupes(liste: TaxGroupList): {
  ton: 'info' | 'neutre';
  titre: string;
  texte: string;
} {
  const env = liste.environment === 'test' ? 'environnement de test' : 'production';
  if (liste.source === 'default') {
    return {
      ton: 'info',
      titre: 'Liste par défaut (février 2026)',
      texte: `Les seize groupes de taxation en vigueur depuis février 2026. Aucune liste n’a encore été lue auprès de la DGI pour votre organisation (${env}) : les taux ne sont donc pas affichés. Le taux appliqué à une facture sera celui de la DGI.`,
    };
  }
  return {
    ton: 'neutre',
    titre: 'Liste de la DGI',
    texte: `Groupes et taux lus auprès de la DGI (${env}) le ${formatDate(liste.fetchedAt)}.`,
  };
}

export type TaxeSpecifiqueChoix = 'none' | 'per_unit' | 'percent';

export interface FormulaireArticle {
  code: string;
  name: string;
  unit: string;
  taxGroup: TaxGroupLetter | '';
  itemType: CatalogItemType | '';
  outOfScope: boolean;
  /** Texte saisi, à la française (`"1 234,50"`). */
  unitPrice: string;
  priceMode: CatalogPriceMode | '';
  specificKind: TaxeSpecifiqueChoix;
  /** Montant par unité ou taux en %, selon `specificKind`. */
  specificValue: string;
}

export type ChampArticle = keyof FormulaireArticle;

export function formulaireArticle(vue: CatalogItemView | null): FormulaireArticle {
  const ts = vue?.specificTax ?? null;
  return {
    code: vue?.code ?? '',
    name: vue?.name ?? '',
    unit: vue?.unit ?? '',
    taxGroup: vue?.taxGroup ?? '',
    itemType: vue?.itemType ?? '',
    outOfScope: vue?.outOfScope ?? false,
    unitPrice: vue ? montantPourSaisie(vue.unitPrice) : '',
    // Pas de mode par défaut : il est obligatoire (§ S25c.3), et un prix saisi
    // dans le mauvais mode change tous les montants d'une facture.
    priceMode: vue?.priceMode ?? '',
    specificKind: ts?.kind ?? 'none',
    specificValue:
      ts === null ? '' : montantPourSaisie(ts.kind === 'per_unit' ? ts.amount : ts.rate),
  };
}

/**
 * Change le groupe et remet en cohérence ce qui en dépend : type d'article
 * admis (choisi d'office s'il n'y en a qu'un), case « hors champ » (groupe A
 * seulement), taxe spécifique (interdite en L et N).
 */
export function appliquerGroupe(
  f: FormulaireArticle,
  liste: TaxGroupList | null,
  lettre: TaxGroupLetter | '',
): FormulaireArticle {
  const g = groupeDe(liste, lettre);
  const admis = g?.itemTypes ?? [];
  const itemType =
    f.itemType !== '' && admis.includes(f.itemType)
      ? f.itemType
      : admis.length === 1
        ? admis[0]!
        : '';
  const ts = taxeSpecifiqueAdmise(lettre);
  return {
    ...f,
    taxGroup: lettre,
    itemType,
    outOfScope: g?.outOfScopeAllowed === true ? f.outOfScope : false,
    specificKind: ts ? f.specificKind : 'none',
    specificValue: ts ? f.specificValue : '',
  };
}

/** Code que la DGI recevra, pour l'aperçu du formulaire. `null` si aucun. */
export function codeDgiApercu(f: Pick<FormulaireArticle, 'code' | 'outOfScope'>): string | null {
  return f.outOfScope ? OUT_OF_SCOPE_ITEM_CODE : ouNull(f.code);
}

const FORMAT_CODE = /^[A-Za-z0-9._/-]+$/;

/** Le code saisi imite-t-il la valeur réservée (casse et espaces ignorés) ? */
export function codeReserve(code: string): boolean {
  // Même repliement que l'API (`isReservedItemCode`) : casse ignorée, et les
  // séparateurs « . _ / - » valent une espace (« hors-champ », « HORS_CHAMP »).
  return (
    code
      .toUpperCase()
      .replace(/[\s._/-]+/g, ' ')
      .trim() === OUT_OF_SCOPE_ITEM_CODE
  );
}

/**
 * Contrôle de confort puis corps de requête. Le prix et la taxe spécifique
 * partent en CHAÎNES, dans la forme du contrat (point décimal).
 */
export function preparerArticle(
  f: FormulaireArticle,
  liste: TaxGroupList | null,
): Preparation<CatalogItemBody, ChampArticle> {
  const champs: Partial<Record<ChampArticle, string>> = {};
  const code = f.code.trim();
  if (code !== '') {
    if (codeReserve(code)) {
      champs.code =
        'Ce code est réservé à la DGI. Pour une opération hors champ, cochez « Opération hors champ ».';
    } else if (code.length > 50) {
      champs.code = 'Le code compte 50 caractères au plus.';
    } else if (!FORMAT_CODE.test(code)) {
      champs.code =
        'Le code ne contient que des lettres sans accent, des chiffres et les signes . _ / -';
    }
  }
  if (f.name.trim() === '') champs.name = 'La désignation est obligatoire.';
  if (f.unit.trim() === '') champs.unit = 'L’unité est obligatoire (pièce, kg, heure…).';
  if (f.taxGroup === '') champs.taxGroup = 'Choisissez le groupe de taxation.';
  const admis = typesAdmis(liste, f.taxGroup);
  if (f.itemType === '') champs.itemType = 'Choisissez le type d’article.';
  else if (f.taxGroup !== '' && liste && !admis.includes(f.itemType)) {
    champs.itemType = `Le type « ${ITEM_TYPE_LABELS[f.itemType]} » n’est pas admis dans le groupe ${f.taxGroup}.`;
  }
  if (f.outOfScope && groupeDe(liste, f.taxGroup)?.outOfScopeAllowed !== true) {
    champs.outOfScope = 'Une opération hors champ relève du groupe A seulement.';
  }
  if (f.priceMode === '') champs.priceMode = 'Indiquez si le prix est TTC ou HT.';
  const prix = lireMontantSaisi(f.unitPrice);
  if (!prix.ok) champs.unitPrice = prix.erreur;

  let specificTax: CatalogSpecificTax | null = null;
  if (f.specificKind !== 'none') {
    if (!taxeSpecifiqueAdmise(f.taxGroup) && f.taxGroup !== '') {
      champs.specificValue = `Aucune taxe spécifique n’est admise dans le groupe ${f.taxGroup}.`;
    } else if (f.specificKind === 'per_unit') {
      const m = lireMontantSaisi(f.specificValue);
      if (m.ok) specificTax = { kind: 'per_unit', amount: m.valeur };
      else champs.specificValue = m.erreur;
    } else {
      const t = lireTauxSaisi(f.specificValue);
      if (t.ok) specificTax = { kind: 'percent', rate: t.valeur };
      else champs.specificValue = t.erreur;
    }
  }

  // Les trois dernières conditions sont déjà des erreurs de champ ; elles sont
  // répétées pour que TypeScript sache les valeurs choisies.
  if (
    Object.keys(champs).length > 0 ||
    !prix.ok ||
    f.taxGroup === '' ||
    f.itemType === '' ||
    f.priceMode === ''
  ) {
    return { ok: false, champs };
  }
  return {
    ok: true,
    corps: {
      code: code === '' ? null : code,
      name: f.name.trim(),
      itemType: f.itemType,
      taxGroup: f.taxGroup,
      outOfScope: f.outOfScope,
      unitPrice: prix.valeur,
      priceMode: f.priceMode,
      currency: 'CDF',
      unit: f.unit.trim(),
      specificTax,
    },
  };
}

/** `1 234,50 CDF TTC` — prix d'un article tel que l'API le sert. */
export function libellePrix(
  item: Pick<CatalogItemView, 'unitPrice' | 'currency' | 'priceMode'>,
): string {
  return `${formatMontant(item.unitPrice, item.currency)} ${PRICE_MODE_LABELS[item.priceMode].court}`;
}

/** Taxe spécifique en mots, ou `null`. */
export function libelleTaxeSpecifique(
  item: Pick<CatalogItemView, 'specificTax' | 'currency' | 'unit'>,
): string | null {
  const ts = item.specificTax;
  if (ts === null) return null;
  return ts.kind === 'per_unit'
    ? `Taxe spécifique : ${formatMontant(ts.amount, item.currency)} par ${item.unit}`
    : `Taxe spécifique : ${formatTaux(ts.rate) ?? ts.rate}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Listes : filtres, pages, actions par ligne
// ─────────────────────────────────────────────────────────────────────────────

export const STATUS_LABELS: Record<SalesStatusFilter, string> = {
  active: 'Actifs',
  inactive: 'Désactivés',
  all: 'Tous',
};

/** Recherche : espaces de bord retirés, 100 caractères au plus (§ S25c.5). */
function recherche(q: string): string | undefined {
  const t = q.trim();
  return t === '' ? undefined : t.slice(0, 100);
}

export interface FiltresClients {
  q: string;
  type: CustomerType | '';
  status: SalesStatusFilter;
}

export function requeteClients(f: FiltresClients, cursor?: string | null): CustomerListQuery {
  const out: CustomerListQuery = { status: f.status };
  const q = recherche(f.q);
  if (q !== undefined) out.q = q;
  if (f.type !== '') out.type = f.type;
  if (cursor) out.cursor = cursor;
  return out;
}

export interface FiltresArticles {
  q: string;
  taxGroup: TaxGroupLetter | '';
  itemType: CatalogItemType | '';
  status: SalesStatusFilter;
}

export function requeteArticles(f: FiltresArticles, cursor?: string | null): CatalogItemListQuery {
  const out: CatalogItemListQuery = { status: f.status };
  const q = recherche(f.q);
  if (q !== undefined) out.q = q;
  if (f.taxGroup !== '') out.taxGroup = f.taxGroup;
  if (f.itemType !== '') out.itemType = f.itemType;
  if (cursor) out.cursor = cursor;
  return out;
}

/** Ajoute une page à la liste affichée, sans doublon (une fiche modifiée entre deux pages). */
export function fusionnerPage<T extends { id: string }>(
  actuels: readonly T[],
  page: readonly T[],
): T[] {
  const vus = new Set(actuels.map((i) => i.id));
  return [...actuels, ...page.filter((i) => !vus.has(i.id))];
}

/**
 * Remplace une fiche après une écriture. Si elle ne correspond plus au filtre
 * d'état (désactivée dans la vue « Actifs »), elle sort de la liste.
 */
export function remplacerDansListe<T extends { id: string; active: boolean }>(
  items: readonly T[],
  maj: T,
  status: SalesStatusFilter,
): T[] {
  const garde = status === 'all' || (status === 'active') === maj.active;
  return garde
    ? items.map((i) => (i.id === maj.id ? maj : i))
    : items.filter((i) => i.id !== maj.id);
}

export type ActionLigne = 'consulter' | 'modifier' | 'desactiver' | 'reactiver' | 'supprimer';

/**
 * Actions proposées sur une ligne. Sans `sales.manage` : consulter seulement.
 * La suppression n'est proposée que pour une fiche JAMAIS facturée (§ O7) ;
 * sinon la désactivation est la seule façon de la retirer.
 */
export function actionsLigne(
  item: { active: boolean; invoiced: boolean },
  gerer: boolean,
): ActionLigne[] {
  if (!gerer) return ['consulter'];
  const out: ActionLigne[] = ['modifier', item.active ? 'desactiver' : 'reactiver'];
  if (!item.invoiced) out.push('supprimer');
  return out;
}

/** Paramètre `?fiche=` : `nouveau` pour une création, l'identifiant sinon. */
export const FICHE_NOUVELLE = 'nouveau';

export type FicheOuverte = { mode: 'creation' } | { mode: 'edition'; id: string } | null;

export function ficheDepuisParametre(valeur: string | null): FicheOuverte {
  if (valeur === null || valeur.trim() === '') return null;
  if (valeur === FICHE_NOUVELLE) return { mode: 'creation' };
  return { mode: 'edition', id: valeur };
}

// ─────────────────────────────────────────────────────────────────────────────
// Erreurs de l'API
// ─────────────────────────────────────────────────────────────────────────────

/** Code d'erreur de l'API (`detail.code`), ou `null`. */
export function codeErreur(err: unknown): string | null {
  const code = detailDe(err)?.['code'];
  return typeof code === 'string' ? code : null;
}

/** 403 (rôle insuffisant) ou 404 (fiche d'une autre organisation) : un refus, pas une panne. */
export function estRefus(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('status' in err)) return false;
  const status = (err as { status: unknown }).status;
  return status === 403 || status === 404;
}

/** Date courte en français ; une valeur absente ou invalide donne un tiret. */
export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function detailDe(err: unknown): Record<string, unknown> | null {
  if (typeof err !== 'object' || err === null || !('detail' in err)) return null;
  const detail = (err as { detail: unknown }).detail;
  return typeof detail === 'object' && detail !== null ? (detail as Record<string, unknown>) : null;
}

function detailsDe(err: unknown): Record<string, unknown> | null {
  const details = detailDe(err)?.['details'];
  return typeof details === 'object' && details !== null
    ? (details as Record<string, unknown>)
    : null;
}

const MESSAGES_VENTES: Record<string, string> = {
  FORBIDDEN: 'Votre rôle ne permet pas cette action sur les clients et le catalogue.',
  NO_ORGANIZATION: 'Aucune organisation active. Créez-en une ou acceptez une invitation.',
  INVALID_REQUEST: 'Certaines valeurs sont refusées. Vérifiez les champs signalés.',
  INVALID_CURSOR: 'La pagination a expiré. Rechargez la liste.',
  CUSTOMER_NOT_FOUND: 'Ce client est introuvable. Il a peut-être été supprimé.',
  CATALOG_ITEM_NOT_FOUND: 'Cet article est introuvable. Il a peut-être été supprimé.',
  CUSTOMER_NIF_EXISTS: 'Un client portant ce NIF existe déjà dans votre organisation.',
  CATALOG_CODE_EXISTS:
    'Un article porte déjà ce code dans votre catalogue (majuscules et minuscules confondues).',
  STALE_REVISION:
    'Cette fiche a été modifiée par quelqu’un d’autre depuis que vous l’avez ouverte. Rechargez-la pour voir la dernière version, puis refaites vos modifications.',
  CUSTOMER_ALREADY_INVOICED:
    'Ce client a déjà été facturé : il ne peut pas être supprimé. Désactivez-le pour qu’il ne soit plus proposé.',
  CATALOG_ITEM_ALREADY_INVOICED:
    'Cet article a déjà été facturé : il ne peut pas être supprimé. Désactivez-le pour qu’il ne soit plus proposé.',
};

/** Messages des problèmes de validation du contrat (§ S25c.5), quand le serveur n'en donne pas. */
const MESSAGES_PROBLEMES: Record<string, string> = {
  NAME_REQUIRED: 'Ce champ est obligatoire.',
  NIF_REQUIRED_FOR_TYPE: 'Le NIF est obligatoire pour ce type de client.',
  NIF_INVALID: 'NIF invalide : 5 à 20 lettres ou chiffres.',
  EXEMPTION_REFERENCE_REQUIRED:
    'La référence du document d’exonération est obligatoire pour ce type de client.',
  EXEMPTION_REFERENCE_NOT_ALLOWED:
    'La référence d’exonération ne concerne que les ambassades et organisations internationales.',
  DECIMAL_MUST_BE_STRING:
    'Montant mal transmis. Réessayez ; si le problème persiste, contactez le support.',
  PRICE_NOT_POSITIVE: 'Le montant doit être supérieur à zéro.',
  PRICE_TOO_PRECISE: 'Deux décimales au plus.',
  ITEM_TYPE_NOT_ALLOWED_FOR_GROUP: 'Ce type d’article n’est pas admis dans ce groupe de taxation.',
  OUT_OF_SCOPE_ONLY_GROUP_A: 'Une opération hors champ relève du groupe A seulement.',
  SPECIFIC_TAX_NOT_ALLOWED: 'Aucune taxe spécifique n’est admise dans ce groupe de taxation.',
  CODE_RESERVED:
    'Ce code est réservé à la DGI. Pour une opération hors champ, cochez « Opération hors champ ».',
  UNKNOWN_TAX_GROUP: 'Ce groupe de taxation n’est pas proposé. Choisissez-en un dans la liste.',
  // Codes précisés par l'API (chantier D1).
  NAME_TOO_LONG: '200 caractères au plus.',
  PHONE_INVALID: 'Numéro de téléphone invalide, par exemple +243 800 000 000.',
  EMAIL_INVALID: 'Adresse e-mail invalide.',
  ADDRESS_TOO_LONG: '255 caractères au plus.',
  EXEMPTION_REFERENCE_TOO_LONG: '200 caractères au plus.',
  CODE_INVALID:
    'Code invalide : 1 à 50 lettres sans accent, chiffres et les signes . _ / - seulement.',
  ITEM_TYPE_INVALID: 'Choisissez le type d’article : bien, service ou taxe.',
  PRICE_INVALID: 'Montant invalide : des chiffres et une virgule, par exemple 1 234,50.',
  PRICE_MODE_INVALID: 'Indiquez si le prix est TTC ou HT.',
  CURRENCY_NOT_SUPPORTED: 'Seul le franc congolais (CDF) est admis pour l’instant.',
  UNIT_REQUIRED: 'L’unité est obligatoire (pièce, kg, heure…).',
  UNIT_TOO_LONG: '20 caractères au plus.',
  SPECIFIC_TAX_INVALID:
    'Taxe spécifique invalide : un montant ou un taux strictement positif (taux inférieur à 100 %), deux décimales au plus.',
  // Codes génériques de forme.
  UNKNOWN_FIELD: 'Champ non reconnu par le serveur.',
  FIELD_REQUIRED: 'Ce champ est obligatoire.',
  INVALID_TYPE: 'Valeur manquante ou invalide.',
  INVALID_VALUE: 'Valeur refusée.',
};

const SESSION_EXPIREE = 'Votre session a expiré. Reconnectez-vous pour continuer.';

function statutDe(err: unknown): unknown {
  return typeof err === 'object' && err !== null && 'status' in err
    ? (err as { status: unknown }).status
    : null;
}

/** Message en français d'une erreur de l'espace Ventes. */
export function messageVentes(err: unknown, repli: string): string {
  const code = codeErreur(err);
  // Un 400 sans problème de champ : le message du serveur dit exactement quoi
  // faire, la phrase générique « vérifiez les champs » serait fausse.
  if (code === 'INVALID_REQUEST' && problemes(err).length === 0) {
    const m = detailDe(err)?.['message'];
    if (typeof m === 'string' && m !== '') return m;
  }
  if (code && MESSAGES_VENTES[code]) return MESSAGES_VENTES[code]!;
  // 401 sans code connu : la session a expiré. « HTTP 401 » n'apprend rien.
  if (statutDe(err) === 401) return SESSION_EXPIREE;
  return err instanceof Error && err.message !== '' ? err.message : repli;
}

interface Probleme {
  chemin: string;
  message: string;
}

/**
 * Problèmes de validation. L'API les sert sous `details.issues` (contrat
 * § S25c.5) ; des contrôleurs plus anciens les posent à la racine — on lit les
 * deux, comme l'onglet Fiscalité.
 */
function problemes(err: unknown): Probleme[] {
  if (codeErreur(err) !== 'INVALID_REQUEST') return [];
  const issues = detailsDe(err)?.['issues'] ?? detailDe(err)?.['issues'];
  if (!Array.isArray(issues)) return [];
  const out: Probleme[] = [];
  for (const issue of issues) {
    if (typeof issue !== 'object' || issue === null) continue;
    const { path, code, message } = issue as { path?: unknown; code?: unknown; message?: unknown };
    const chemin = Array.isArray(path)
      ? path.map(String).join('.')
      : typeof path === 'string'
        ? path
        : '';
    // Le message français du serveur d'abord ; sinon celui du code du contrat ;
    // sinon la traduction des messages par défaut de Zod (en anglais).
    const parCode = typeof code === 'string' ? MESSAGES_PROBLEMES[code] : undefined;
    const parZod = typeof code === 'string' ? MESSAGES_ZOD[code] : undefined;
    const texte = utilisable(message) ? message : (parCode ?? parZod ?? 'Valeur refusée.');
    out.push({ chemin, message: texte });
  }
  return out;
}

/** Messages par défaut de Zod, en anglais, remplacés d'après leur code. */
const MESSAGES_ZOD: Record<string, string> = {
  too_small: 'Ce champ est obligatoire ou trop court.',
  too_big: 'Ce champ est trop long.',
  invalid_type: 'Valeur manquante ou invalide.',
  invalid_string: 'Format invalide.',
  invalid_enum_value: 'Choix non reconnu.',
  unrecognized_keys: 'Champ non reconnu.',
};

/** Un message du serveur est affichable s'il est en français, pas un message Zod par défaut. */
const ZOD_ANGLAIS = /^(String|Number|Array|Expected|Required|Invalid|Unrecognized)\b/;
function utilisable(message: unknown): message is string {
  return typeof message === 'string' && message !== '' && !ZOD_ANGLAIS.test(message);
}

/**
 * Range les erreurs du serveur sous les champs connus du formulaire. Un chemin
 * inconnu part dans `autres`, affiché en tête : jamais perdu. Les doublons
 * (NIF, code) sont rattachés au champ que la personne doit regarder.
 */
export function erreursFormulaire<K extends string>(
  err: unknown,
  champsConnus: readonly K[],
  correspondances: Readonly<Record<string, K>> = {},
): { champs: Partial<Record<K, string>>; autres: string[] } {
  const champs: Partial<Record<K, string>> = {};
  const autres: string[] = [];
  const code = codeErreur(err);
  const surChamp = (cle: string, message: string): void => {
    const champ = (correspondances[cle] ?? cle) as K;
    if (champsConnus.includes(champ)) {
      if (champs[champ] === undefined) champs[champ] = message;
    } else {
      autres.push(cle === '' ? message : `${cle} : ${message}`);
    }
  };
  if (code === 'CUSTOMER_NIF_EXISTS') surChamp('nif', MESSAGES_VENTES['CUSTOMER_NIF_EXISTS']!);
  if (code === 'CATALOG_CODE_EXISTS') surChamp('code', MESSAGES_VENTES['CATALOG_CODE_EXISTS']!);
  for (const p of problemes(err)) surChamp(p.chemin, p.message);
  return { champs, autres };
}

/**
 * Chemins du serveur → champs du formulaire article : la taxe spécifique est
 * saisie dans un seul champ, quel que soit son genre.
 */
export const CHEMINS_ARTICLE: Readonly<Record<string, ChampArticle>> = {
  specificTax: 'specificValue',
  'specificTax.amount': 'specificValue',
  'specificTax.rate': 'specificValue',
  'specificTax.kind': 'specificKind',
};

/** `409 STALE_REVISION` : quelqu'un d'autre a écrit entre-temps. */
export function estRevisionPerimee(err: unknown): boolean {
  return codeErreur(err) === 'STALE_REVISION';
}

/** Identifiant de la fiche qui porte déjà ce NIF ou ce code (`details.existingId`), ou `null`. */
export function ficheExistante(err: unknown): string | null {
  const code = codeErreur(err);
  if (code !== 'CUSTOMER_NIF_EXISTS' && code !== 'CATALOG_CODE_EXISTS') return null;
  const id = detailsDe(err)?.['existingId'];
  return typeof id === 'string' && id !== '' ? id : null;
}
