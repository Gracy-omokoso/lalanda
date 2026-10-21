// Batterie de documents de la validation d'un paquet — ADR-0029 § 5.
//
// Un modèle sur mesure doit savoir imprimer TOUTES les sortes de documents,
// pas seulement l'aperçu. Les cas partent de la facture FICTIVE de l'aperçu
// (`sample-invoice.ts`, marquée EXEMPLE) et en dérivent les variantes : aucune
// donnée réelle, aucun calcul (montants recopiés tels quels, déjà mis en forme).

import {
  PROFORMA_TITLE,
  TEST_BANNER,
  TEST_MARK,
  buildInvoiceDocument,
  type InvoiceDocumentModel,
} from '../../invoice-document.model.js';
import { sampleInvoice } from '../../sample-invoice.js';

export interface ValidationCase {
  name: string;
  model: InvoiceDocumentModel;
  /** Palette du rendu ; `withLogos` : logos fournis ou initiales. */
  palette: 'brand' | 'mono';
  withLogos: boolean;
}

/** Les cas de la batterie, dans l'ordre du rapport. */
export function validationCases(layout: { label: string; version: string }): ValidationCase[] {
  const base = buildInvoiceDocument(sampleInvoice('validation'), {
    duplicateNumber: null,
    draftSeller: null,
    organizationName: 'Organisation',
    draftInTestEnvironment: false,
    layout,
    sample: true,
  });
  const footerWith = (m: InvoiceDocumentModel, extra: string) => `${m.footer} · ${extra}`;

  const testDuplicate: InvoiceDocumentModel = {
    ...base,
    test: { banner: TEST_BANNER, mark: TEST_MARK },
    duplicate: { number: 2, label: 'DUPLICATA n° 2' },
    footer: footerWith(base, `DUPLICATA n° 2 · ${TEST_BANNER}`),
  };
  const proforma: InvoiceDocumentModel = {
    ...base,
    kind: 'proforma',
    title: PROFORMA_TITLE,
    natureMentions: ['Vente'],
    stateMentions: ['Normalisation DGI en cours'],
    reference: { label: 'Référence pro forma', value: 'PF-EXEMPLE-0001' },
    date: { label: 'Établi le', value: base.date.value },
    counterValue: null,
    security: null,
    operator: null,
  };
  const credit: InvoiceDocumentModel = {
    ...base,
    title: 'Facture d’avoir normalisée',
    natureMentions: ['FACTURE D’AVOIR — Annulation'],
    reference: { label: 'Avoir n°', value: 'EXEMPLE-000043' },
    creditReference: [
      'Facture d’origine : n° EXEMPLE-000042',
      'Code DEF/DGI d’origine : EXEMPLE-0000-0000-0000-0000-0000',
    ],
    totalInWords: base.totalInWords.replace(
      'Arrêtée la présente facture',
      'Arrêtée la présente facture d’avoir',
    ),
  };
  const exportDeposit: InvoiceDocumentModel = {
    ...base,
    natureMentions: ['EXPORTATION', 'D’ACOMPTE'],
    customer: { ...base.customer, lines: ['[PM] Personne morale', 'NIF : EXEMPLE-EXPORT'] },
  };
  const rich: InvoiceDocumentModel = {
    ...base,
    lines: Array.from({ length: 30 }, (_, i) => ({
      ...base.lines[i % base.lines.length]!,
      name: `Article n° ${i + 1} — « spécial » <b>&</b> l’été`,
      code: i % 4 === 3 ? null : `ART-${String(i + 1).padStart(3, '0')}`,
      modification: i % 3 === 0 ? 'Prix d’origine 100 000,00 — remise 10 %' : null,
      specificTax: i % 5 === 0 ? 'T.S. 1 250,00' : null,
    })),
    seller: {
      title: 'Société <Exemple> & Fils',
      lines: [
        ...base.seller.lines,
        'RCCM : CD/KIN/RCCM/00-B-0000',
        '+243 800 000 000 · contact@exemple.cd',
      ],
    },
    customer: {
      ...base.customer,
      lines: [...base.customer.lines, '2, avenue Cliente, Kinshasa', '+243 800 000 001'],
    },
    specificTaxTotal: '7 500,00',
    payments: [
      { label: 'Virement', amount: '500 000,00' },
      { label: 'Espèces', amount: '131 193,30' },
    ],
    comments: ['Réf. Exo. : EXO-1', 'Livraison le 22/10/2026 — « fragile »'],
    operator: 'Comptable <Exemple>',
  };
  const noOptional: InvoiceDocumentModel = {
    ...base,
    customer: { title: 'Client comptant', lines: ['[PP] Personne physique'] },
    seller: { title: base.seller.title, lines: ['NIF : EXEMPLE'] },
    payments: [],
    counterValue: null,
    operator: null,
    comments: [],
  };

  return [
    { name: 'facture normalisée', model: base, palette: 'brand', withLogos: true },
    {
      name: 'facture normalisée, noir et blanc, sans logo',
      model: base,
      palette: 'mono',
      withLogos: false,
    },
    {
      name: 'environnement de test, duplicata',
      model: testDuplicate,
      palette: 'brand',
      withLogos: true,
    },
    { name: 'pro forma', model: proforma, palette: 'brand', withLogos: false },
    { name: 'facture d’avoir', model: credit, palette: 'brand', withLogos: true },
    { name: 'acompte à l’exportation', model: exportDeposit, palette: 'brand', withLogos: true },
    {
      name: 'document riche (30 lignes, taxes, paiements, commentaires)',
      model: rich,
      palette: 'brand',
      withLogos: true,
    },
    {
      name: 'document sans paiement ni commentaire',
      model: noOptional,
      palette: 'mono',
      withLogos: false,
    },
  ];
}
