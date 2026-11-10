// Modèles de facture — la règle « un modèle change la présentation, jamais le
// contenu » prouvée pour CHAQUE modèle × CHAQUE option × chaque sorte de
// document (ADR-0028 § 2 ; mentions d'ADR-0025). Sans navigateur.

import { createHash } from 'node:crypto';

import { patternDataUri } from '@lalanda/shared/branding';
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
    expect(templateAt('bandeau', '1.2.0')).toBe(latestTemplate('bandeau'));
    expect(templateAt('bandeau', '1.1.0')?.version).toBe('1.1.0');
    expect(templateAt('bandeau', '1.0.0')?.version).toBe('1.0.0');
    expect(templateCatalog().map((t) => t.version)).toEqual(Array(6).fill('1.2.0'));
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

// ── Identité visuelle v2 (ADR-0073) : versions 1.2.0 ─────────────────────────

/**
 * Empreintes du rendu 1.1.0 (même méthode que `EMPREINTES_1_0_0`), relevées le
 * 10 nov. 2026 AVANT l'ajout de 1.2.0, du motif de fond et du choix de logo :
 * une facture gelée avec `…@1.1.0` se réimprime octet pour octet.
 */
const EMPREINTES_1_1_0: Record<string, string> = {
  classique: 'f1e92ef20e3c8fb8149b87dc03d2c4f3686487fd69c346e21415e6b97513f67d',
  bandeau: '2a095690077a4de630a0f756a75dd090c86ea4e7a282515f92620e130e04100f',
  laterale: '26fbdfe2cbb63bf995a3ea1f2341b6fd9eef519d43b08b909b637cd903bd50c3',
  minimal: '787392b92bc4a907d0976ff7a55783ee4219d60623c23e006e0f59c770a615dd',
  compacte: '4df7ef3266e9d00c7245a070cd61cb2f479c3a51b0bc4751a33678a51ed1f1bc',
  editoriale: '09ecb02ee56cb8a0f468fc31f1ff60565f06513d9e70988ceb9456318cc7574c',
};

function onlyLogos(variants: readonly LogoVariantId[]): ResolvedPresentation['logos'] {
  const all = renderLogos(true);
  const out = renderLogos(false);
  for (const v of variants) out[v] = all[v];
  return out;
}

type LogoVariantId = 'primary' | 'horizontal' | 'symbol' | 'light';

function v2Html(
  id: (typeof INVOICE_TEMPLATE_IDS)[number],
  opts: {
    logos?: readonly LogoVariantId[];
    logoChoice?: 'square' | 'horizontal';
    pattern?: ResolvedPresentation['pattern'];
  } = {},
): string {
  const t = templateAt(id, '1.2.0')!;
  const m = modelFor(normalizedTest(), t);
  return renderDocumentHtml(m, QR, {
    template: t,
    options: t.defaults,
    identity: { ...IDENTITY, ...(opts.logoChoice ? { logoChoice: opts.logoChoice } : {}) },
    logos: onlyLogos(opts.logos ?? []),
    ...(opts.pattern !== undefined ? { pattern: opts.pattern } : {}),
  }).html;
}

const LIB_PATTERN = {
  dataUri: patternDataUri('losanges', '#0f5132'),
  width: 24,
  height: 24,
  raster: false,
  opacity: 0.08,
};

describe('ADR-0073 — identité visuelle v2 (modèles 1.2.0)', () => {
  it.each(INVOICE_TEMPLATE_IDS)(
    '%s@1.1.0 : rendu inchangé, octet pour octet (factures déjà gelées)',
    (id) => {
      expect(empreinte(templateAt(id, '1.1.0')!)).toBe(EMPREINTES_1_1_0[id]);
    },
  );

  it.each(INVOICE_TEMPLATE_IDS)(
    '%s@1.2.0 : toutes les mentions DGI, avec et sans logo, avec et sans motif',
    (id) => {
      const t = templateAt(id, '1.2.0')!;
      for (const [, m] of documentCases(t)) {
        for (const logos of [[], ['primary', 'horizontal', 'symbol', 'light']] as const) {
          for (const pattern of [null, LIB_PATTERN]) {
            expect(() =>
              renderDocumentHtml(m, m.security ? QR : null, {
                template: t,
                options: t.defaults,
                identity: { ...IDENTITY, logoChoice: 'horizontal' },
                logos: onlyLogos(logos),
                pattern,
              }),
            ).not.toThrow();
          }
        }
      }
    },
  );

  it.each(INVOICE_TEMPLATE_IDS)(
    '%s@1.2.0 : le choix carré ou horizontal décide du logo imprimé',
    (id) => {
      const all = ['primary', 'horizontal', 'symbol'] as const;
      const square = v2Html(id, { logos: all, logoChoice: 'square' });
      const horizontal = v2Html(id, { logos: all, logoChoice: 'horizontal' });
      // Sur fond de couleur, la version claire passe devant (absente ici).
      expect(square).toContain('data-variant="primary"');
      expect(square).not.toContain('data-variant="horizontal"');
      expect(horizontal).toContain('data-variant="horizontal"');
      expect(horizontal).not.toContain('data-variant="primary"');
      // Repli : le carré manque ⇒ l'horizontal ; l'horizontal manque ⇒ le carré.
      expect(v2Html(id, { logos: ['horizontal'], logoChoice: 'square' })).toContain(
        'data-variant="horizontal"',
      );
      expect(v2Html(id, { logos: ['primary'], logoChoice: 'horizontal' })).toContain(
        'data-variant="primary"',
      );
      // Sans choix enregistré : déduit (horizontal seul ⇒ horizontal).
      expect(v2Html(id, { logos: ['horizontal', 'symbol'] })).toContain('data-variant="symbol"');
    },
  );

  it.each(INVOICE_TEMPLATE_IDS)(
    '%s@1.2.0 : avec un logo, le nom n’est écrit qu’une fois (bloc légal, texte normal)',
    (id) => {
      const t = templateAt(id, '1.2.0')!;
      const m = modelFor(normalizedTest(), t);
      const title = esc(m.seller.title);
      // Occurrences du nom seul (le client « Client Exemple SARL » le contient).
      const count = (h: string) => h.split(new RegExp(`>(?:${title})<`)).length - 1;
      const withLogo = v2Html(id, { logos: ['primary'] });
      const without = v2Html(id);
      // Le titre HTML de l'onglet (<title>) ne porte pas la raison sociale.
      expect(count(withLogo)).toBe(1);
      expect(withLogo).not.toContain(`font-weight:700">${title}`);
      // Avant toute configuration : initiales + nom, comme en 1.1.0.
      expect(count(without)).toBeGreaterThanOrEqual(1);
      const v11 = renderDocumentHtml(m, QR, {
        template: templateAt(id, '1.1.0')!,
        options: t.defaults,
        identity: IDENTITY,
        logos: onlyLogos([]),
      }).html;
      expect(count(without)).toBe(count(v11));
    },
  );

  it('motif : posé par le moteur sous le contenu, absent sans réglage, cadre DGI sur blanc', () => {
    const with_ = v2Html('classique', { pattern: LIB_PATTERN });
    const without = v2Html('classique');
    expect(with_).toContain('<div class="lx-pattern" aria-hidden="true"></div>');
    expect(with_).toContain('z-index: -1');
    expect(with_).toContain('opacity: 0.08');
    expect(with_).toContain('background:#ffffff">');
    expect(without).not.toContain('lx-pattern');
    // Opacité bornée à 20 % quoi qu'on demande.
    expect(v2Html('minimal', { pattern: { ...LIB_PATTERN, opacity: 0.9 } })).toContain(
      'opacity: 0.20',
    );
    // Aucune ressource distante, URI contrôlée.
    expect(() =>
      v2Html('classique', {
        pattern: { ...LIB_PATTERN, dataUri: 'https://exemple.cd/motif.png' },
      }),
    ).toThrow(/URI/);
    expect(() =>
      v2Html('classique', {
        pattern: { ...LIB_PATTERN, dataUri: 'data:image/svg+xml,a")%3Bbackground:url("x' },
      }),
    ).toThrow(/URI/);
  });
});
