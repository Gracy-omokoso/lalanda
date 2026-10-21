// Zone DGI IMPOSÉE — vérification de contenu d'un rendu (ADR-0028 § 2).
//
// Règle : un modèle change la présentation, jamais le contenu. Ce fichier en
// fait une propriété VÉRIFIÉE à chaque rendu, pas une promesse : la liste des
// mentions exigées est DÉRIVÉE du document (`InvoiceDocumentModel`, qui porte
// toutes les règles d'impression d'ADR-0025), et chacune doit figurer, échappée
// telle quelle, dans le HTML produit. Il manque une mention ⇒ le PDF n'est pas
// rendu (`TemplateDgiContentError`).
//
// Les tests passent CHAQUE modèle × CHAQUE option × chaque type de document
// dans ce même vérificateur ; la présentation d'origine aussi.

import { esc } from '../invoice-document-html.js';
import type { InvoiceDocumentModel } from '../invoice-document.model.js';

/** Libellés DGI fixes, imprimés par tous les modèles. */
export const DGI_LABELS = {
  securityTitle: 'Éléments de sécurité DGI',
  codeDefDgi: 'Code DEF/DGI',
  nim: 'DEF NIM',
  counters: 'DEF Compteurs',
  dgiDateTime: 'DEF Heure',
  isf: 'ISF',
  vatTotal: 'Total TVA',
  specificTax: 'Taxe spécifique',
  operator: 'Établi par',
} as const;

export interface RequiredMention {
  what: string;
  text: string;
}

const present = (v: string | null | undefined): v is string =>
  typeof v === 'string' && v.trim() !== '';

/** Toutes les mentions que le document exige, dans l'ordre du modèle. */
export function requiredMentions(m: InvoiceDocumentModel): RequiredMention[] {
  const out: RequiredMention[] = [];
  const add = (what: string, text: string | null | undefined) => {
    if (present(text)) out.push({ what, text });
  };
  add('intitulé', m.title);
  m.natureMentions.forEach((x, i) => add(`mention de nature ${i + 1}`, x));
  m.stateMentions.forEach((x, i) => add(`mention d’état ${i + 1}`, x));
  add('mention DUPLICATA', m.duplicate?.label);
  add('bandeau de test', m.test?.banner);
  add('mot TEST', m.test?.mark);
  add('bandeau d’exemple', m.sample?.banner);
  add('mot EXEMPLE', m.sample?.mark);
  add('libellé du numéro', m.reference.label);
  add('numéro', m.reference.value);
  add('libellé de la date', m.date.label);
  add('date et heure', m.date.value);
  add('vendeur', m.seller.title);
  m.seller.lines.forEach((x, i) => add(`vendeur, ligne ${i + 1}`, x));
  add('client', m.customer.title);
  m.customer.lines.forEach((x, i) => add(`client, ligne ${i + 1}`, x));
  m.creditReference.forEach((x, i) => add(`référence d’avoir ${i + 1}`, x));
  add('devise qui fait foi', m.amountsNote);
  add('mode de prix', m.priceModeLabel);
  m.lines.forEach((l, i) => {
    const n = `ligne ${i + 1}`;
    add(`${n} — désignation`, l.name);
    add(`${n} — code`, l.code);
    add(`${n} — type`, l.itemType);
    add(`${n} — groupe`, l.group);
    add(`${n} — quantité`, l.quantity);
    add(`${n} — prix unitaire`, l.unitPrice);
    add(`${n} — modification de prix`, l.modification);
    add(`${n} — taxe spécifique`, l.specificTax);
    add(`${n} — montant`, l.amount);
  });
  m.groups.forEach((g, i) => {
    const n = `groupe ${i + 1}`;
    add(`${n} — étiquette`, g.group);
    add(`${n} — taux`, g.rate);
    add(`${n} — base`, g.ht);
    add(`${n} — TVA`, g.vat);
    add(`${n} — total`, g.total);
  });
  if (present(m.specificTaxTotal)) {
    add('libellé taxe spécifique', DGI_LABELS.specificTax);
    add('taxe spécifique totale', m.specificTaxTotal);
  }
  add('libellé TVA', DGI_LABELS.vatTotal);
  add('total TVA', m.vatTotal);
  add('total', m.total);
  add('devise', m.currency);
  add('montant en lettres', m.totalInWords);
  m.payments.forEach((p, i) => {
    add(`paiement ${i + 1} — mode`, p.label);
    add(`paiement ${i + 1} — montant`, p.amount);
  });
  add('contre-valeur', m.counterValue);
  if (m.security) {
    add('titre du cadre DGI', DGI_LABELS.securityTitle);
    add('libellé code DEF/DGI', DGI_LABELS.codeDefDgi);
    add('code DEF/DGI', m.security.codeDefDgi);
    add('libellé NIM', DGI_LABELS.nim);
    add('NIM', m.security.nim);
    add('libellé compteurs', DGI_LABELS.counters);
    add('compteurs', m.security.counters);
    add('libellé heure DGI', DGI_LABELS.dgiDateTime);
    add('heure DGI', m.security.dgiDateTime);
    add('libellé ISF', DGI_LABELS.isf);
    add('ISF', m.security.isf);
  }
  if (present(m.operator)) {
    add('libellé opérateur', DGI_LABELS.operator);
    add('opérateur', m.operator);
  }
  m.comments.forEach((c, i) => add(`commentaire ${i + 1}`, c));
  return out;
}

/** Mentions absentes du HTML (vide = conforme). `qrSvg` : SVG attendu tel quel. */
export function missingMentions(
  m: InvoiceDocumentModel,
  html: string,
  qrSvg: string | null,
): RequiredMention[] {
  const missing = requiredMentions(m).filter((r) => !html.includes(esc(r.text)));
  if (m.security && (qrSvg === null || !html.includes(qrSvg))) {
    missing.push({ what: 'QR code DGI', text: m.security.qrContent });
  }
  return missing;
}

/** Mentions exigées en EN-TÊTE ou PIED de chaque page (répétées). */
export function missingRepeatedMentions(
  m: InvoiceDocumentModel,
  header: string,
  footer: string,
): RequiredMention[] {
  const repeated = `${header}\n${footer}`;
  const out: RequiredMention[] = [];
  if (m.test && !repeated.includes(esc(m.test.banner))) {
    out.push({ what: 'bandeau de test (chaque page)', text: m.test.banner });
  }
  if (m.duplicate && !repeated.includes(esc(m.duplicate.label))) {
    out.push({ what: 'DUPLICATA (chaque page)', text: m.duplicate.label });
  }
  if (!footer.includes(esc(m.footer))) {
    out.push({ what: 'pied de page (version du logiciel)', text: m.footer });
  }
  return out;
}

export class TemplateDgiContentError extends Error {
  constructor(
    readonly templateId: string,
    readonly missing: readonly RequiredMention[],
  ) {
    super(
      `Le modèle « ${templateId} » omet des mentions obligatoires : ${missing
        .map((x) => x.what)
        .join(', ')}.`,
    );
    this.name = 'TemplateDgiContentError';
  }
}
