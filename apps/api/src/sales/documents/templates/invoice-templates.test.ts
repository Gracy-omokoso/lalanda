// Modèles de facture — la règle « un modèle change la présentation, jamais le
// contenu » prouvée pour CHAQUE modèle × CHAQUE option × chaque sorte de
// document (ADR-0028 § 2 ; mentions d'ADR-0025). Sans navigateur.

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { esc } from '../invoice-document-html.js';
import { TEST_BANNER, buildInvoiceDocument } from '../invoice-document.model.js';
import { sampleInvoice } from '../sample-invoice.js';
import { qrCodeSvg } from '../invoice-qr.js';
import { FAKE_QR, normalizedTest } from '../testing/invoice-fixtures.js';
import {
  IDENTITY,
  documentCases,
  modelFor,
  renderLogos,
  richModel,
} from '../testing/template-fixtures.js';
import {
  TemplateDgiContentError,
  missingMentions,
  missingRepeatedMentions,
  requiredMentions,
} from './dgi-content.js';
import {
  allTemplates,
  latestTemplate,
  resolveOptions,
  templateAt,
  templateCatalog,
} from './registry.js';
import { renderDocumentHtml, initialsOf, type ResolvedPresentation } from './template-engine.js';
import {
  INVOICE_TEMPLATE_IDS,
  INVOICE_TEMPLATE_LABELS,
  PALETTES,
  type InvoiceTemplate,
  type TemplateOptions,
} from './template.contract.js';
import { contrastRatio, readableOn } from '../../../branding/colors.js';
import { presentationViewOf } from '../../invoices/invoice-view.js';
import { themeOf } from './theme.js';

const QR = await qrCodeSvg(FAKE_QR);

function presentation(
  template: InvoiceTemplate,
  options: TemplateOptions,
  withLogos = false,
): ResolvedPresentation {
  return { template, options, identity: IDENTITY, logos: renderLogos(withLogos) };
}

/** Texte visible (balises, styles, SVG retirés). */
function visibleText(html: string): string {
  return html
    .replace(/<style>[\s\S]*?<\/style>/g, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

/** Toutes les combinaisons d'options d'un modèle (palette × police × accent). */
function optionMatrix(t: InvoiceTemplate): TemplateOptions[] {
  const accents = [t.defaults.accent, '#fde047', '#000000'];
  return PALETTES.flatMap((palette) =>
    t.fontChoices.flatMap((font) => accents.map((accent) => ({ palette, font, accent }))),
  );
}

describe('catalogue', () => {
  it('six modèles, dans l’ordre de la décision du 21 oct. 2026', () => {
    expect(allTemplates().map((t) => t.label)).toEqual([
      'Classique',
      'Bandeau',
      'Latérale',
      'Minimal',
      'Compacte',
      'Éditoriale',
    ]);
    expect(templateCatalog()).toHaveLength(6);
    // ADR-0028 § 4 : toutes les versions publiées restent ; le choix pointe la dernière.
    expect(templateAt('bandeau', '1.1.0')).toBe(latestTemplate('bandeau'));
    expect(templateAt('bandeau', '1.0.0')?.version).toBe('1.0.0');
    expect(templateCatalog().map((t) => t.version)).toEqual(Array(6).fill('1.1.0'));
    expect(templateAt('bandeau', '9.9.9')).toBeNull();
    expect(templateAt('inconnu', '1.0.0')).toBeNull();
  });

  it('polices : liste fermée, paires pour Éditoriale', () => {
    for (const t of allTemplates()) {
      const expected =
        t.id === 'editoriale'
          ? ['fraunces+inter', 'source-serif-4+ibm-plex-sans', 'source-serif-4+manrope']
          : ['inter', 'ibm-plex-sans', 'manrope', 'source-serif-4'];
      expect([...t.fontChoices].sort(), t.id).toEqual(expected.sort());
    }
  });
});

describe.each(allTemplates().map((t) => [t.label, t] as const))('modèle %s', (_label, template) => {
  it.each(documentCases(template))(
    '%s : toutes les mentions DGI, options par défaut',
    (_name, m) => {
      for (const withLogos of [false, true]) {
        const r = renderDocumentHtml(
          m,
          m.security ? QR : null,
          presentation(template, template.defaults, withLogos),
        );
        expect(missingMentions(m, r.html, m.security ? QR : null)).toEqual([]);
        expect(missingRepeatedMentions(m, r.headerTemplate, r.footerTemplate)).toEqual([]);
        if (m.security) expect(r.html).toContain(QR);
      }
    },
  );

  it(
    'chaque option (palette × police × accent) garde toutes les mentions',
    { timeout: 120_000 },
    () => {
      const docs = [
        modelFor(normalizedTest(), template),
        modelFor(normalizedTest(), template, { duplicateNumber: 1 }),
        richModel(template),
      ];
      for (const options of optionMatrix(template)) {
        for (const m of docs) {
          const r = renderDocumentHtml(m, QR, presentation(template, options, true));
          const label = JSON.stringify(options);
          expect(missingMentions(m, r.html, QR), label).toEqual([]);
          expect(missingRepeatedMentions(m, r.headerTemplate, r.footerTemplate), label).toEqual([]);
        }
      }
    },
  );

  it('environnement de test : filigrane TEST et bandeau ; production : aucun', () => {
    const test = renderDocumentHtml(
      modelFor(normalizedTest(), template),
      QR,
      presentation(template, template.defaults),
    );
    expect(test.html).toContain('class="dgi-watermark">TEST<');
    expect(test.html).toContain(`class="dgi-test-band">${TEST_BANNER}<`);
    expect(test.footerTemplate).toContain(TEST_BANNER);

    const prod = documentCases(template).find(
      ([n]) => n === 'facture normalisée de production',
    )![1];
    const r = renderDocumentHtml(prod, QR, presentation(template, template.defaults));
    expect(r.html).not.toContain('class="dgi-watermark');
    expect(r.html).not.toContain(TEST_BANNER);
    expect(visibleText(r.html)).not.toMatch(/\bTEST\b/);
  });

  it('aperçu : filigrane et bandeau EXEMPLE', () => {
    const m = documentCases(template).find(([n]) => n === 'aperçu EXEMPLE')![1];
    const r = renderDocumentHtml(m, QR, presentation(template, template.defaults));
    expect(r.html).toContain('class="dgi-watermark sample">EXEMPLE<');
    expect(r.html).toContain('dgi-sample-band');
    expect(r.footerTemplate).toContain('Exemple fictif');
  });

  it('pied : version figée du logiciel et modèle nommé', () => {
    const m = modelFor(normalizedTest({ softwareVersion: '0.9.3' }), template);
    expect(m.footer).toContain(
      `Établi avec Lalanda v0.9.3 — modèle ${template.label} ${template.version}`,
    );
    const r = renderDocumentHtml(m, QR, presentation(template, template.defaults));
    expect(r.footerTemplate).toContain('modèle');
  });

  it('confinement : CSP stricte, aucune ressource distante, polices et logos intégrés', () => {
    const r = renderDocumentHtml(
      richModel(template),
      QR,
      presentation(template, template.defaults, true),
    );
    expect(r.html).toContain(
      "content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:\"",
    );
    expect(r.html).not.toMatch(/(src|href)\s*=\s*["']?(https?:|\/\/)/i);
    expect(r.html).not.toMatch(/url\((?!data:)/);
    expect(r.html).not.toMatch(/<script/i);
    expect(r.html).toContain('src:url(data:font/woff2;base64,');
    expect(r.html).toContain("'Lalanda JetBrains Mono'");
    expect(r.html).toMatch(
      /<img class="brand-logo" data-variant="\w+" src="data:image\/png;base64,/,
    );
  });

  it('champs saisis échappés', () => {
    const r = renderDocumentHtml(
      richModel(template),
      QR,
      presentation(template, template.defaults),
    );
    expect(r.html).not.toContain('<b>&</b>');
    expect(r.html).toContain('&lt;b&gt;&amp;&lt;/b&gt;');
    expect(r.html).toContain('Comptable &lt;Exemple&gt;');
  });

  it('noir et blanc : logos en niveaux de gris, aucune couleur d’accent', () => {
    const r = renderDocumentHtml(
      modelFor(normalizedTest(), template),
      QR,
      presentation(template, { ...template.defaults, palette: 'mono', accent: '#1d4ed8' }, true),
    );
    expect(r.html).toContain('filter:grayscale(1)');
    expect(r.html).not.toContain('#1d4ed8');
  });

  it('déterministe : même document, même présentation ⇒ même HTML', () => {
    const p = presentation(template, template.defaults, true);
    const a = renderDocumentHtml(richModel(template), QR, p);
    const b = renderDocumentHtml(richModel(template), QR, p);
    expect(a.html).toBe(b.html);
    expect(a.html).toContain(`data-template="${template.id}@${template.version}"`);
  });
});

describe('zone DGI imposée — le vérificateur refuse un modèle incomplet', () => {
  it('un modèle qui omet le montant en lettres ou le QR ne s’imprime pas', () => {
    const base = latestTemplate('classique');
    const amputé: InvoiceTemplate = {
      ...base,
      id: 'classique',
      render: (input) => {
        const out = base.render(input);
        return {
          css: out.css,
          body: out.body.replace(esc(input.document.totalInWords), '').replace(input.dgi.qrSvg, ''),
        };
      },
    };
    const m = modelFor(normalizedTest(), base);
    expect(() => renderDocumentHtml(m, QR, presentation(amputé, base.defaults))).toThrow(
      TemplateDgiContentError,
    );
    try {
      renderDocumentHtml(m, QR, presentation(amputé, base.defaults));
    } catch (err) {
      const whats = (err as TemplateDgiContentError).missing.map((x) => x.what);
      expect(whats).toContain('montant en lettres');
      expect(whats).toContain('QR code DGI');
    }
  });

  it('la présentation d’origine passe le même vérificateur, document par document', () => {
    for (const [name, m] of documentCases(null)) {
      // Un aperçu s'imprime toujours avec un modèle, jamais l'origine.
      if (m.sample) {
        expect(() => renderDocumentHtml(m, QR, null)).toThrow(/aperçu/);
        continue;
      }
      const r = renderDocumentHtml(m, m.security ? QR : null, null);
      expect(missingMentions(m, r.html, m.security ? QR : null), name).toEqual([]);
      expect(missingRepeatedMentions(m, r.headerTemplate, r.footerTemplate), name).toEqual([]);
    }
  });

  it('les mentions exigées couvrent le cadre DGI d’une facture normalisée', () => {
    const whats = requiredMentions(modelFor(normalizedTest(), null)).map((r) => r.what);
    for (const w of [
      'code DEF/DGI',
      'NIM',
      'compteurs',
      'heure DGI',
      'ISF',
      'montant en lettres',
      'contre-valeur',
      'opérateur',
      'mot TEST',
      'bandeau de test',
    ]) {
      expect(whats).toContain(w);
    }
  });

  it('la présentation d’origine est inchangée (octet pour octet)', async () => {
    const { renderInvoiceDocumentHtml } = await import('../invoice-document-html.js');
    const m = modelFor(normalizedTest(), null);
    expect(renderDocumentHtml(m, QR, null).html).toBe(renderInvoiceDocumentHtml(m, QR));
    expect(m.footer).toMatch(/— gabarit 1\.0\.0/);
  });

  it('une URI de logo autre qu’une image data: est refusée', () => {
    const t = latestTemplate('classique');
    const logos = renderLogos(false);
    logos.primary = { dataUri: 'https://evil.example/x.png', width: 10, height: 10 };
    expect(() =>
      renderDocumentHtml(modelFor(normalizedTest(), t), QR, {
        template: t,
        options: t.defaults,
        identity: IDENTITY,
        logos,
      }),
    ).toThrow(/URI de données refusée/);
  });
});

describe('aperçu : la facture fictive EXEMPLE passe chaque modèle', () => {
  it.each(allTemplates().map((t) => [t.label, t] as const))('%s', async (_l, template) => {
    const m = buildInvoiceDocument(sampleInvoice('org-x'), {
      duplicateNumber: null,
      draftSeller: null,
      organizationName: 'Organisation',
      draftInTestEnvironment: false,
      layout: { label: template.label, version: template.version },
      sample: true,
    });
    expect(m.test).toBeNull();
    expect(m.sample).not.toBeNull();
    expect(m.total).toBe('631\u00a0193,30');
    const qr = await qrCodeSvg(m.security!.qrContent);
    const r = renderDocumentHtml(m, qr, presentation(template, template.defaults, true));
    expect(r.html).toContain('EXEMPLE-000042');
    expect(r.footerTemplate).toContain('Exemple fictif');
  });
});

describe('options et couleurs', () => {
  it('résolution : saisie, puis identité, puis défaut du modèle', () => {
    const t = latestTemplate('bandeau');
    expect(resolveOptions(t, null, { primaryColor: null, font: null })).toEqual(t.defaults);
    expect(resolveOptions(t, null, { primaryColor: '#123456', font: 'inter' })).toEqual({
      palette: 'brand',
      accent: '#123456',
      font: 'inter',
    });
    expect(
      resolveOptions(
        t,
        { palette: 'mono', accent: '#abcdef', font: 'source-serif-4' },
        { primaryColor: '#123456', font: 'inter' },
      ),
    ).toEqual({ palette: 'mono', accent: '#abcdef', font: 'source-serif-4' });
    // Éditoriale : la police de l'identité n'est pas une paire, le défaut s'applique.
    const e = latestTemplate('editoriale');
    expect(resolveOptions(e, null, { primaryColor: null, font: 'inter' }).font).toBe(
      'fraunces+inter',
    );
    // Minimal : noir et blanc par défaut (maquette).
    expect(
      resolveOptions(latestTemplate('minimal'), null, { primaryColor: '#123456', font: null })
        .palette,
    ).toBe('mono');
  });

  it('contraste : texte lisible sur l’accent, accent lisible sur blanc', () => {
    for (const accent of ['#fde047', '#ffffff', '#0f5132', '#000000', '#22d3ee']) {
      const th = themeOf({ palette: 'brand', accent, font: 'inter' }, IDENTITY);
      expect(contrastRatio(th.accent, '#ffffff'), accent).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(th.accent, th.onAccent), accent).toBeGreaterThanOrEqual(4.5);
    }
    expect(readableOn('#fde047')).toBe('#111111');
    expect(readableOn('#0f5132')).toBe('#ffffff');
  });

  it('initiales du vendeur', () => {
    expect(initialsOf('Exemple SARL')).toBe('ES');
    expect(initialsOf('  société   d’études ')).toBe('SD');
    expect(initialsOf('')).toBe('·');
  });
});

// ── « Total HT » (1.1.0) et réimpression des factures gelées en 1.0.0 ─────────

/**
 * Empreintes du rendu 1.0.0 des six modèles (cas `documentCases`, options par
 * défaut, logos), relevées le 21 oct. 2026 AVANT l'ajout de la version 1.1.0.
 * Une facture gelée avec `…@1.0.0` doit se réimprimer octet pour octet : si une
 * de ces valeurs change, c'est une version publiée qui a bougé — interdit
 * (ADR-0028 § 4) ; publier une nouvelle version à la place.
 */
const EMPREINTES_1_0_0: Record<string, string> = {
  classique: '4eec7d896bc6dcc914dc91ce7cb7c6542b445982c27d01cd755e1523602bd3b4',
  bandeau: '76388da8255117832192d78a08b75664199bc51b9daf9f3d4ae1736af9528fdd',
  laterale: 'd9da0cba8319b91dd0bcfdb15b573d15452ace6044ea2f37ec73fa8f21d29bca',
  minimal: '366c126e7239281585f53d8ad7b5f17bd339eedc8a315cdeca8a419fa8fea912',
  compacte: '3fe4616f6de87645171ecf73ddcd4e09a4ae18db62f8258e21cd4cb80331cb8e',
  editoriale: '805db0d4870ea4e6d68c12103701d0911795f1d70bbcbf5cedd0fcacee14d22a',
};

function empreinte(t: InvoiceTemplate): string {
  const h = createHash('sha256');
  for (const [name, m] of documentCases(t)) {
    const r = renderDocumentHtml(m, m.security ? QR : null, presentation(t, t.defaults, true));
    h.update(name);
    h.update(r.html);
    h.update(r.headerTemplate);
    h.update(r.footerTemplate);
  }
  return h.digest('hex');
}

describe('Total HT (ADR-0028, décision ouverte n° 1)', () => {
  it.each(INVOICE_TEMPLATE_IDS.map((id) => [id]))(
    '%s@1.0.0 : rendu inchangé, octet pour octet (factures déjà gelées)',
    (id) => {
      expect(empreinte(templateAt(id, '1.0.0')!)).toBe(EMPREINTES_1_0_0[id]);
    },
  );

  it.each(INVOICE_TEMPLATE_IDS.map((id) => [id]))(
    '%s : 1.1.0 imprime « Total HT », 1.0.0 non ; rien d’autre ne change',
    (id) => {
      const v1 = templateAt(id, '1.0.0')!;
      const v11 = templateAt(id, '1.1.0')!;
      for (const [name, m] of documentCases(v1)) {
        const qr = m.security ? QR : null;
        const a = renderDocumentHtml(m, qr, presentation(v1, v1.defaults, true)).html;
        const b = renderDocumentHtml(m, qr, presentation(v11, v11.defaults, true)).html;
        expect(visibleText(a), name).not.toContain('Total HT');
        expect(visibleText(b), name).toContain(visibleText(`Total HT ${m.htTotal}`));
        // Seule différence : la ligne ajoutée et la version nommée.
        const sans = b
          .replace(/<div class="sum"><span>Total HT<\/span><span>[^<]*<\/span><\/div>/, '')
          .replace(/<div>Total HT [^<]*<\/div>/, '')
          .replaceAll(`${id}@1.1.0`, `${id}@1.0.0`);
        expect(sans, name).toBe(a);
      }
    },
  );

  it('le montant imprimé est la somme des bases par groupe (moteur)', () => {
    const m = richModel(latestTemplate('classique'));
    const html = renderDocumentHtml(
      m,
      QR,
      presentation(latestTemplate('classique'), latestTemplate('classique').defaults),
    ).html;
    expect(m.htTotal).toMatch(/\d/);
    expect(html).toContain(esc(m.htTotal));
  });
});

describe('vue API : présentation figée (ADR-0028 § 6)', () => {
  it('les noms affichés sont ceux des modèles', () => {
    for (const t of allTemplates()) expect(INVOICE_TEMPLATE_LABELS[t.id]).toBe(t.label);
  });

  it('brouillon → null ; gelé sans modèle → origine ; gelé avec modèle → modèle et version', () => {
    expect(presentationViewOf({ status: 'draft', presentation: null })).toBeNull();
    expect(presentationViewOf({ status: 'issued' })).toEqual({
      kind: 'original',
      templateId: null,
      templateLabel: null,
      version: null,
      options: null,
    });
    expect(
      presentationViewOf({
        status: 'normalized',
        presentation: {
          template: { id: 'editoriale', version: '1.0.0' },
          options: { palette: 'mono', accent: '#7f1d1d', font: 'fraunces+inter' },
          identity: IDENTITY,
        },
      }),
    ).toEqual({
      kind: 'template',
      templateId: 'editoriale',
      templateLabel: 'Éditoriale',
      version: '1.0.0',
      options: { palette: 'mono', accent: '#7f1d1d', font: 'fraunces+inter' },
    });
  });
});
