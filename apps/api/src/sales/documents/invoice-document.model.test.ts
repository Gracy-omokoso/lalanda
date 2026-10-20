// Contenu imprimé d'un document de vente — ADR-0025 (unitaires, sans navigateur).

import { describe, expect, it } from 'vitest';

import type { InvoiceLean } from '../invoices/invoice.types.js';
import {
  DocumentNotPrintableError,
  PROFORMA_TITLE,
  TEST_BANNER,
  buildInvoiceDocument,
  formatAmount,
  type InvoiceDocumentContext,
} from './invoice-document.model.js';
import { renderInvoiceDocumentHtml, invoiceFooterTemplate } from './invoice-document-html.js';
import { qrCodeEncodedContent, qrCodeSvg } from './invoice-qr.js';
import {
  FAKE_QR,
  draftUsd,
  issuedStandard,
  normalizedProduction,
  normalizedTest,
} from './testing/invoice-fixtures.js';

const CTX: InvoiceDocumentContext = {
  duplicateNumber: null,
  draftSeller: null,
  organizationName: 'Exemple SARL',
  draftInTestEnvironment: false,
};

const build = (doc: InvoiceLean, ctx: Partial<InvoiceDocumentContext> = {}) =>
  buildInvoiceDocument(doc, { ...CTX, ...ctx });

async function htmlOf(doc: InvoiceLean, ctx: Partial<InvoiceDocumentContext> = {}) {
  const m = build(doc, ctx);
  const qr = m.security ? await qrCodeSvg(m.security.qrContent) : null;
  return renderInvoiceDocumentHtml(m, qr);
}

/** Texte visible du HTML (balises et styles retirés), pour chercher les mots. */
function visibleText(html: string): string {
  return html
    .replace(/<style>[\s\S]*?<\/style>/g, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

describe('intitulé — documentKind et lui seul', () => {
  it.each([
    ['draft', PROFORMA_TITLE],
    ['pending_normalization', PROFORMA_TITLE],
    ['normalization_failed', PROFORMA_TITLE],
  ] as const)('%s → pro forma', (status, title) => {
    const doc = { ...normalizedTest(), status } as InvoiceLean;
    const m = build(doc);
    expect(m.kind).toBe('proforma');
    expect(m.title).toBe(title);
    expect(m.reference).toEqual({ label: 'Référence pro forma', value: 'PF-2026-000045' });
    expect(m.security).toBeNull();
  });

  it('normalized → « Facture normalisée », numéro définitif, bloc DGI', () => {
    const m = build(normalizedTest());
    expect(m.kind).toBe('invoice');
    expect(m.title).toBe('Facture normalisée');
    expect(m.reference).toEqual({ label: 'Facture n°', value: 'TEST-2026-000001' });
    expect(m.security).toEqual({
      codeDefDgi: 'ABCD-1234-EFGH-5678-IJKL-9012',
      nim: 'XX01000001-1',
      counters: '7/8 FV',
      dgiDateTime: '20/10/2026 10:15:30',
      isf: 'ISF-TEST-E2E',
      qrContent: FAKE_QR,
    });
  });

  it('normalized SANS code DEF/DGI → pro forma (verrou ADR-0024), aucun élément de sécurité', () => {
    const doc = normalizedTest();
    const m = build({ ...doc, normalization: { ...doc.normalization!, codeDefDgi: null } });
    expect(m.kind).toBe('proforma');
    expect(m.title).toBe(PROFORMA_TITLE);
    expect(m.security).toBeNull();
    expect(m.stateMentions).toContain('Éléments de sécurité DGI incomplets');
  });

  it('issued (organisation ordinaire) → « Facture », sans bloc DGI', () => {
    const m = build(issuedStandard());
    expect(m.title).toBe('Facture');
    expect(m.reference.value).toBe('2026-000012');
    expect(m.security).toBeNull();
  });

  it('avoir normalisé → « Facture d’avoir normalisée » + nature et référence d’origine', () => {
    const m = build(
      normalizedTest({
        type: 'FA',
        creditNote: {
          nature: 'RAN',
          originInvoiceId: 'x',
          originNumber: 'TEST-2026-000001',
          reference: 'ABCD-1234-EFGH-5678-IJKL-9012',
        },
      }),
    );
    expect(m.title).toBe('Facture d’avoir normalisée');
    expect(m.natureMentions).toEqual(['FACTURE D’AVOIR — Annulation']);
    expect(m.creditReference).toEqual([
      'Facture d’origine : n° TEST-2026-000001',
      'Code DEF/DGI d’origine : ABCD-1234-EFGH-5678-IJKL-9012',
    ]);
    expect(m.reference.label).toBe('Avoir n°');
  });

  it('pending_normalization → mention « Normalisation DGI en cours »', () => {
    const m = build({ ...normalizedTest(), status: 'pending_normalization' } as InvoiceLean);
    expect(m.stateMentions).toEqual(['Normalisation DGI en cours']);
  });

  it('un pro forma ne contient pas le mot « facture », hors de la phrase consacrée', async () => {
    for (const type of ['FV', 'FT', 'FA', 'EV', 'ET', 'EA'] as const) {
      const doc = {
        ...normalizedTest(),
        status: 'pending_normalization',
        type,
        creditNote:
          type === 'FA' || type === 'EA'
            ? { nature: 'COR', originInvoiceId: 'x', originNumber: null, reference: 'REF' }
            : null,
      } as InvoiceLean;
      const text = visibleText(await htmlOf(doc));
      // L'adresse e-mail du vendeur fictif (« facturation@… ») n'est pas une mention.
      const sansPhrase = text
        .replaceAll('non valable comme facture', '')
        .replaceAll('facturation@exemple.cd', '');
      expect(sansPhrase, type).not.toMatch(/factur/i);
      expect(text).toContain(PROFORMA_TITLE);
      expect(text).not.toContain('TEST-2026-000001');
      expect(text).not.toContain('ABCD-1234');
    }
  });
});

describe('mentions DGI par type', () => {
  it.each([
    ['FV', []],
    ['FT', ['D’ACOMPTE']],
    ['EV', ['EXPORTATION']],
    ['ET', ['EXPORTATION', 'D’ACOMPTE']],
  ] as const)('%s', (type, mentions) => {
    expect(build(normalizedTest({ type })).natureMentions).toEqual(mentions);
  });

  it('EA : EXPORTATION + FACTURE D’AVOIR + nature', () => {
    const m = build(
      normalizedTest({
        type: 'EA',
        creditNote: { nature: 'RRR', originInvoiceId: null, originNumber: null, reference: 'RRR' },
      }),
    );
    expect(m.natureMentions).toEqual([
      'EXPORTATION',
      'FACTURE D’AVOIR — Remise, ristourne, rabais (RRR)',
    ]);
    expect(m.creditReference).toEqual(['Référence : RRR']);
  });

  it('client : type imprimé « [PM] Personne morale », coordonnées seulement sur demande', () => {
    expect(build(normalizedTest()).customer.lines).toEqual([
      '[PM] Personne morale',
      'NIF : T0000000X',
    ]);
    const doc = normalizedTest();
    const withContacts = build({
      ...doc,
      customer: { ...doc.customer, printContactDetails: true },
    });
    expect(withContacts.customer.lines).toContain('2, avenue Cliente, Kinshasa');
  });

  it('ligne : type d’article, étiquette de groupe ; mode de prix', () => {
    const m = build(normalizedTest());
    expect(m.lines[0]).toMatchObject({ itemType: '[SER]', group: '[B]', quantity: '2 heure' });
    expect(m.priceModeLabel).toBe('Prix unitaires HT');
  });

  it('client AO : mention imposée par la DGI (ADR-0026 § 3.1)', () => {
    const doc = normalizedTest();
    const m = build({
      ...doc,
      customer: { ...doc.customer, type: 'AO', exemptionReference: 'EXO-1' },
      comments: { A: 'Réf. Exo. : EXO-1', C: null },
    });
    expect(m.customer.lines[0]).toBe('[AO] Ambassades et organisations internationales');
    expect(m.comments).toEqual(['Réf. Exo. : EXO-1']);
  });

  it('opération hors champ : le code imprimé est celui envoyé, « HORS CHAMP » (ADR-0026 § 3.2)', () => {
    const doc = normalizedTest();
    const m = build({
      ...doc,
      lines: doc.lines.map((l) => ({
        ...l,
        code: 'INDEM-1',
        edefCode: 'HORS CHAMP',
        taxGroup: 'A' as const,
        outOfScope: true,
      })),
    });
    expect(m.lines[0]).toMatchObject({ code: 'HORS CHAMP', group: '[A] hors champ' });
    // Article ordinaire : le code envoyé est le code de l'article.
    expect(build(doc).lines[0]?.code).toBe('CONSEIL-H');
  });
});

describe('montants — imprimés tels que figés', () => {
  it('facture normalisée : CDF de normalizedAmounts, jamais les USD', async () => {
    const m = build(normalizedTest());
    expect(m.currency).toBe('CDF');
    expect(m.lines[0]!.unitPrice).toBe(formatAmount('90492.80'));
    expect(m.total).toBe(formatAmount('209943.30'));
    expect(m.vatTotal).toBe(formatAmount('28957.70'));
    expect(m.amountsNote).toBe('Montants en francs congolais (CDF) — font foi');
    const text = visibleText(await htmlOf(normalizedTest()));
    expect(text).not.toContain('40,00');
  });

  it('contre-valeur USD figée', () => {
    expect(build(normalizedTest()).counterValue).toBe(
      `Contre-valeur : 92,80 USD — taux appliqué : 1 USD = ${formatAmount('2262.32')} CDF (taux du 19/10/2026)`,
    );
  });

  it('total en lettres du total qui fait foi', () => {
    expect(build(normalizedTest()).totalInWords).toBe(
      'Arrêtée la présente facture à la somme de : Deux cent neuf mille neuf cent quarante-trois francs congolais et trente centimes.',
    );
    expect(build(draftUsd()).totalInWords).toBe(
      'Arrêté le présent pro forma à la somme de : Quatre-vingt-douze dollars américains et quatre-vingts cents.',
    );
  });

  it('pro forma et facture ordinaire : devise du document', () => {
    expect(build(draftUsd())).toMatchObject({ currency: 'USD', total: '92,80' });
    expect(build(issuedStandard())).toMatchObject({ currency: 'USD', total: '92,80' });
  });

  it('brouillon au calcul en échec → non imprimable', () => {
    const doc = draftUsd();
    const broken = {
      ...doc,
      documentAmounts: {
        ...doc.documentAmounts,
        calculation: {
          ok: false,
          totals: null,
          issues: [
            { code: 'NO_LINES', lineIndex: null, field: null, message: 'Aucune ligne.' } as const,
          ],
        },
      },
    } as InvoiceLean;
    expect(() => build(broken)).toThrow(DocumentNotPrintableError);
  });
});

describe('filigrane de l’environnement de test (exigence de la décideuse)', () => {
  it('environment = test → bandeau, mot TEST, sur chaque page (gabarits)', async () => {
    const m = build(normalizedTest());
    expect(m.test).toEqual({ banner: TEST_BANNER, mark: 'TEST' });
    const html = await htmlOf(normalizedTest());
    expect(html).toContain('class="test-mark">TEST<');
    expect(html).toContain(`class="test-band">${TEST_BANNER}<`);
    expect(invoiceFooterTemplate(m)).toContain(TEST_BANNER);
  });

  it('série TEST seule suffit (défense en profondeur)', () => {
    expect(build(normalizedTest({ environment: null })).test).not.toBeNull();
  });

  it('brouillon d’une organisation en test → filigrane', () => {
    expect(build(draftUsd(), { draftInTestEnvironment: true }).test).not.toBeNull();
    expect(build(draftUsd()).test).toBeNull();
  });

  it('production → aucun filigrane, aucun bandeau, aucun mot TEST', async () => {
    const m = build(normalizedProduction());
    expect(m.test).toBeNull();
    const html = await htmlOf(normalizedProduction());
    expect(html).not.toContain('test-mark"');
    expect(html).not.toContain('test-band"');
    expect(visibleText(html)).not.toMatch(/\bTEST\b/);
    expect(html).not.toContain(TEST_BANNER);
    expect(invoiceFooterTemplate(m)).not.toContain(TEST_BANNER);
  });
});

describe('duplicata', () => {
  it('« DUPLICATA n° k », même numéro de facture', async () => {
    const m = build(normalizedTest(), { duplicateNumber: 2 });
    expect(m.duplicate).toEqual({ number: 2, label: 'DUPLICATA n° 2' });
    expect(m.reference.value).toBe('TEST-2026-000001');
    expect(m.fileName).toBe('TEST-2026-000001-duplicata-2.pdf');
    expect(invoiceFooterTemplate(m)).toContain('DUPLICATA n° 2');
    expect(await htmlOf(normalizedTest(), { duplicateNumber: 2 })).toContain('DUPLICATA n° 2');
  });

  it('l’original ne porte jamais DUPLICATA', async () => {
    expect(await htmlOf(normalizedTest())).not.toContain('DUPLICATA');
  });

  it('un pro forma n’a pas de duplicata', () => {
    expect(() => build(draftUsd(), { duplicateNumber: 1 })).toThrow(DocumentNotPrintableError);
  });
});

describe('QR code et déterminisme', () => {
  it('le QR encode EXACTEMENT normalization.qrCode', async () => {
    expect(qrCodeEncodedContent(FAKE_QR)).toBe(FAKE_QR);
    const html = await htmlOf(normalizedTest());
    expect(html).toContain(await qrCodeSvg(FAKE_QR));
  });

  it('même document figé → même HTML', async () => {
    expect(await htmlOf(normalizedTest())).toBe(await htmlOf(normalizedTest()));
  });

  it('version du logiciel : celle FIGÉE au gel, pas celle du rendu (ADR-0026 § 6.2)', async () => {
    const gelee = normalizedTest({ softwareVersion: '0.9.3' });
    const m = build(gelee, { currentSoftwareVersion: '0.9.4' });
    expect(m.softwareVersion).toBe('0.9.3');
    expect(m.footer).toContain('Établi avec Lalanda v0.9.3 — gabarit 1.0.0');
    // Même document, même version figée : même HTML, quelle que soit la version qui rend.
    expect(await htmlOf(gelee, { currentSoftwareVersion: '0.9.4' })).toBe(
      await htmlOf(gelee, { currentSoftwareVersion: '1.0.0' }),
    );
    // Document gelé avant le 20 oct. 2026 : pas de version, pied inchangé.
    const ancien = build(normalizedTest(), { currentSoftwareVersion: '0.9.4' });
    expect(ancien.softwareVersion).toBeNull();
    expect(ancien.footer).toMatch(/^Établi avec Lalanda — gabarit 1\.0\.0/);
    // Brouillon : la version courante.
    expect(build(draftUsd(), { currentSoftwareVersion: '0.9.4' }).footer).toContain(
      'Lalanda v0.9.4',
    );
  });

  it('les champs saisis sont échappés', async () => {
    const doc = draftUsd();
    const html = await htmlOf({
      ...doc,
      customer: { ...doc.customer, name: '<script>alert(1)</script>' },
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
