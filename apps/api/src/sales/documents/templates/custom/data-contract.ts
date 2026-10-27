// Contrat de données des gabarits sur mesure, version 1 — ADR-0029 § 3.
//
// C'est le contenu imprimé des six modèles intégrés (`InvoiceDocumentModel`),
// réduit à ce que le GABARIT place : tout ce qui relève de la zone DGI
// imposée (DUPLICATA, test, EXEMPLE, éléments de sécurité, QR, pied) est posé
// par le moteur et n'y figure pas.
//
// Le schéma ci-dessous sert trois fois : contrôle STATIQUE de chaque variable
// à la validation du paquet (`mustache.ts`), construction des données au rendu
// (`templateDataOf`), et liste des variables du guide des créateurs (un test
// vérifie que le guide les reprend toutes).
//
// Règle d'évolution : AJOUTER une variable garde le contrat 1 ; en retirer une
// ou en changer le sens ouvre le contrat 2 (et le moteur sert les deux).

import type { InvoiceDocumentModel } from '../../invoice-document.model.js';
import { DGI_LABELS } from '../dgi-content.js';
import { HT_TOTAL_LABEL } from '../parts.js';
import { LOGO_VARIANTS, type LogoVariant, type TemplateBrand } from '../template.contract.js';

export const DATA_CONTRACT_VERSION = 1;

export type FieldType =
  | { kind: 'text'; nullable: boolean; doc: string }
  | { kind: 'bool'; doc: string }
  | { kind: 'object'; fields: Readonly<Record<string, FieldType>>; doc: string }
  | { kind: 'list'; item: FieldType; doc: string };

const text = (doc: string): FieldType => ({ kind: 'text', nullable: false, doc });
const maybe = (doc: string): FieldType => ({ kind: 'text', nullable: true, doc });
const bool = (doc: string): FieldType => ({ kind: 'bool', doc });
const obj = (doc: string, fields: Record<string, FieldType>): FieldType => ({
  kind: 'object',
  fields,
  doc,
});
const list = (doc: string, item: FieldType): FieldType => ({ kind: 'list', item, doc });

const party = (doc: string) =>
  obj(doc, {
    title: text('Raison sociale ou nom (en gras en tête du bloc).'),
    lines: list(
      'Lignes du bloc, dans l’ordre (NIF, RCCM, adresse, contacts…) — `{{.}}` pour chacune.',
      text('Une ligne.'),
    ),
  });

/** Racine des données d'un gabarit (contrat 1). */
export const DATA_SCHEMA: FieldType = obj('Données du gabarit.', {
  document: obj('Contenu imprimé du document, déjà mis en forme (aucun calcul à faire).', {
    title: text(
      'Intitulé : « Facture normalisée », « Facture d’avoir », « PRO FORMA — non valable comme facture »…',
    ),
    isInvoice: bool('Vrai pour une facture ou un avoir final (numéroté).'),
    isProforma: bool('Vrai pour un pro forma (brouillon ou normalisation en cours).'),
    natureMentions: list(
      'Mentions de nature DGI : « EXPORTATION », « D’ACOMPTE », « FACTURE D’AVOIR — Annulation »…',
      text('Une mention.'),
    ),
    stateMentions: list(
      'Mentions d’état d’un pro forma : « Normalisation DGI en cours »…',
      text('Une mention.'),
    ),
    reference: obj('Numéro.', {
      label: text('« Facture n° », « Avoir n° » ou « Référence pro forma ».'),
      value: text('Le numéro lui-même.'),
    }),
    date: obj('Date d’émission.', {
      label: text('« Date et heure d’émission » ou « Établi le ».'),
      value: text('« 20/10/2026 10:15:30 » (heure de Kinshasa).'),
    }),
    seller: party('Vendeur (fiche fiscale figée).'),
    customer: party('Client (type DGI, NIF, coordonnées si demandées).'),
    creditReference: list(
      'Références d’un avoir : facture d’origine, code DEF/DGI d’origine.',
      text('Une référence.'),
    ),
    currency: text('Devise des montants imprimés : « CDF » ou « USD ».'),
    amountsNote: text('« Montants en francs congolais (CDF) — font foi »…'),
    priceModeLabel: text('« Prix unitaires HT » ou « Prix unitaires TTC ».'),
    lines: list(
      'Lignes du document.',
      obj('Une ligne.', {
        name: text('Désignation.'),
        code: maybe('Code article envoyé à la DGI (peut être absent).'),
        itemType: text('Type DGI entre crochets : « [SER] », « [BIE] »…'),
        group: text('Groupe de taxation : « [B] », « [C] hors champ »…'),
        quantity: text('Quantité et unité : « 2 heure ».'),
        unitPrice: text('Prix unitaire mis en forme.'),
        modification: maybe('Modification de prix : « Prix d’origine 50,00 — remise 10 % ».'),
        specificTax: maybe('Taxe spécifique de la ligne : « T.S. 1 250,00 ».'),
        amount: text('Montant de la ligne.'),
      }),
    ),
    groups: list(
      'Ventilation par groupe de taxation.',
      obj('Un groupe.', {
        group: text('« [B] »'),
        rate: text('« 16 % »'),
        ht: text('Base hors taxe du groupe.'),
        vat: text('TVA du groupe.'),
        total: text('Total du groupe.'),
      }),
    ),
    specificTaxTotal: maybe('Total de la taxe spécifique (absent s’il est nul).'),
    htTotal: text(
      'Total HT : somme des bases hors taxe par groupe, calculée par le moteur (ajout du 27 oct. 2026, contrat 1 inchangé).',
    ),
    vatTotal: text('Total TVA.'),
    total: text('Total TTC.'),
    totalInWords: text('« Arrêtée la présente facture à la somme de : … »'),
    payments: list(
      'Paiements par mode.',
      obj('Un paiement.', {
        label: text('Mode : « Virement », « Espèces »…'),
        amount: text('Montant.'),
      }),
    ),
    counterValue: maybe('Contre-valeur en USD d’une facture normalisée en CDF.'),
    operator: maybe('Nom de la personne qui a établi le document.'),
    comments: list('Commentaires imprimés.', text('Un commentaire.')),
  }),
  labels: obj('Libellés DGI fixes, à imprimer tels quels.', {
    htTotal: text(`« ${HT_TOTAL_LABEL} »`),
    vatTotal: text(`« ${DGI_LABELS.vatTotal} »`),
    specificTax: text(`« ${DGI_LABELS.specificTax} »`),
    operator: text(`« ${DGI_LABELS.operator} »`),
  }),
  brand: obj('Identité visuelle de l’organisation.', {
    initials: text('Initiales du vendeur (à défaut de logo).'),
    logo: maybe(
      'Logo préféré (principal, sinon horizontal, sinon symbole) — à placer dans `<img src="{{brand.logo}}">`.',
    ),
    logos: obj('Les quatre déclinaisons, chacune éventuellement absente.', {
      primary: maybe('Logo principal.'),
      horizontal: maybe('Version horizontale.'),
      symbol: maybe('Symbole seul.'),
      light: maybe('Version claire (fond sombre).'),
    }),
  }),
  theme: obj('Options de rendu.', {
    mono: bool('Vrai en palette « noir et blanc ».'),
  }),
});

/** Valeur portée par les données d'un rendu. */
export type DataValue = string | boolean | null | DataValue[] | { [k: string]: DataValue };

/** Jeton placé dans `src` à la place d'un logo ; remplacé par le moteur APRÈS validation. */
export const LOGO_TOKEN_PREFIX = 'lx-logo:';

export function logoToken(v: LogoVariant): string {
  return `${LOGO_TOKEN_PREFIX}${v}`;
}

/** Données du gabarit pour un document (lecture seule, aucune propriété héritée). */
export function templateDataOf(
  m: InvoiceDocumentModel,
  brand: TemplateBrand,
  mono: boolean,
): DataValue {
  const logos: Record<string, DataValue> = {};
  for (const v of LOGO_VARIANTS) logos[v] = brand.logos[v] ? logoToken(v) : null;
  const preferred = (['primary', 'horizontal', 'symbol'] as const).find((v) => brand.logos[v]);
  return {
    document: {
      title: m.title,
      isInvoice: m.kind === 'invoice',
      isProforma: m.kind === 'proforma',
      natureMentions: [...m.natureMentions],
      stateMentions: [...m.stateMentions],
      reference: { label: m.reference.label, value: m.reference.value },
      date: { label: m.date.label, value: m.date.value },
      seller: { title: m.seller.title, lines: [...m.seller.lines] },
      customer: { title: m.customer.title, lines: [...m.customer.lines] },
      creditReference: [...m.creditReference],
      currency: m.currency,
      amountsNote: m.amountsNote,
      priceModeLabel: m.priceModeLabel,
      lines: m.lines.map((l) => ({
        name: l.name,
        code: l.code,
        itemType: l.itemType,
        group: l.group,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        modification: l.modification,
        specificTax: l.specificTax,
        amount: l.amount,
      })),
      groups: m.groups.map((g) => ({
        group: g.group,
        rate: g.rate,
        ht: g.ht,
        vat: g.vat,
        total: g.total,
      })),
      specificTaxTotal: m.specificTaxTotal,
      htTotal: m.htTotal,
      vatTotal: m.vatTotal,
      total: m.total,
      totalInWords: m.totalInWords,
      payments: m.payments.map((p) => ({ label: p.label, amount: p.amount })),
      counterValue: m.counterValue,
      operator: m.operator,
      comments: [...m.comments],
    },
    labels: {
      htTotal: HT_TOTAL_LABEL,
      vatTotal: DGI_LABELS.vatTotal,
      specificTax: DGI_LABELS.specificTax,
      operator: DGI_LABELS.operator,
    },
    brand: {
      initials: brand.initials,
      logo: preferred ? logoToken(preferred) : null,
      logos,
    },
    theme: { mono },
  };
}

export interface VariableDoc {
  path: string;
  type: string;
  doc: string;
}

/** Liste à plat des variables (guide des créateurs, commande `--variables`). */
export function variableList(): VariableDoc[] {
  const out: VariableDoc[] = [];
  const walk = (t: FieldType, path: string) => {
    if (t.kind === 'object') {
      if (path) out.push({ path, type: 'objet', doc: t.doc });
      for (const [k, v] of Object.entries(t.fields)) walk(v, path ? `${path}.${k}` : k);
    } else if (t.kind === 'list') {
      out.push({
        path,
        type: t.item.kind === 'object' ? 'liste d’objets' : 'liste de textes',
        doc: t.doc,
      });
      if (t.item.kind === 'object') {
        for (const [k, v] of Object.entries(t.item.fields)) walk(v, `${path}[].${k}`);
      }
    } else {
      out.push({
        path,
        type: t.kind === 'bool' ? 'booléen' : t.nullable ? 'texte ou absent' : 'texte',
        doc: t.doc,
      });
    }
  };
  walk(DATA_SCHEMA, '');
  return out;
}
