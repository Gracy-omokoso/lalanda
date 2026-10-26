// Contenu imprimé d'un devis et rendu par CHAQUE modèle de l'organisation
// (ADR-0035 § 1) : intitulé « DEVIS — non valable comme facture », aucune
// mention DGI de facture, et toutes les mentions du devis vérifiées dans le HTML.

import { describe, expect, it } from 'vitest';

import { draftUsd } from '../documents/testing/invoice-fixtures.js';
import { IDENTITY, renderLogos } from '../documents/testing/template-fixtures.js';
import { missingMentions, missingRepeatedMentions } from '../documents/templates/dgi-content.js';
import { allTemplates } from '../documents/templates/registry.js';
import { renderDocumentHtml } from '../documents/templates/template-engine.js';
import { buildQuoteDocument, QUOTE_TITLE } from './quote-document.model.js';
import { formatQuoteNumber, quoteActionsOf, quoteStatusOf } from './quote-model.js';
import type { QuoteLean } from './quote.schema.js';

function quote(overrides: Partial<QuoteLean> = {}): QuoteLean {
  const inv = draftUsd();
  return {
    _id: inv._id,
    organizationId: 'org-test',
    number: 'DV2610-000007',
    version: 2,
    status: 'sent',
    opportunityId: null,
    title: 'Accompagnement comptable',
    notes: 'Paiement à 30 jours.',
    validUntil: '2026-11-20',
    currency: inv.currency,
    priceMode: inv.priceMode,
    customer: inv.customer,
    lines: inv.lines,
    documentAmounts: inv.documentAmounts,
    sentAt: new Date('2026-10-21T09:00:00Z'),
    acceptedAt: null,
    refusedAt: null,
    refusalReason: null,
    opportunityOutcome: null,
    conversion: null,
    previousVersions: [],
    searchKey: '',
    revision: 4,
    createdBy: 'u1',
    updatedBy: 'u1',
    createdAt: new Date('2026-10-20T08:00:00Z'),
    updatedAt: new Date('2026-10-21T09:00:00Z'),
    _schemaVersion: 1,
    ...overrides,
  } as QuoteLean;
}

const SELLER = {
  legalName: 'Exemple SARL',
  tradeName: null,
  nif: 'A0000000X',
  rccm: null,
  address: '1, avenue Exemple, Gombe, Kinshasa',
  phone: null,
  email: null,
  vatRegistered: true,
};

const ctx = {
  seller: SELLER,
  organizationName: 'Exemple',
  status: 'sent' as const,
  softwareVersion: '0.9.4',
  layout: null,
};

describe('buildQuoteDocument (ADR-0035 § 1)', () => {
  it('intitulé du devis, référence et validité ; aucune mention DGI de facture', () => {
    const m = buildQuoteDocument(quote(), ctx);
    expect(m.title).toBe(QUOTE_TITLE);
    expect(m.title).toBe('DEVIS — non valable comme facture');
    expect(m.kind).toBe('proforma');
    expect(m.reference).toEqual({ label: 'Devis n°', value: 'DV2610-000007 — version 2' });
    expect(m.stateMentions).toEqual(['Valable jusqu’au 20/11/2026']);
    expect(m.security).toBeNull();
    expect(m.test).toBeNull();
    expect(m.duplicate).toBeNull();
    expect(m.payments).toEqual([]);
    expect(m.counterValue).toBeNull();
    expect(m.natureMentions).toEqual([]);
    expect(m.totalInWords).toMatch(/^Arrêté le présent devis à la somme de : /);
    expect(m.comments).toEqual(['Accompagnement comptable', 'Paiement à 30 jours.']);
    expect(m.footer).toContain('Non valable comme facture');
    expect(m.fileName).toBe('DV2610-000007-v2.pdf');
    // Montants : ceux du moteur, figés, seulement mis en forme.
    expect(m.total).toBe('92,80');
  });

  it('statut accepté, refusé ou expiré imprimé ; brouillon sans mention', () => {
    expect(buildQuoteDocument(quote(), { ...ctx, status: 'accepted' }).stateMentions).toContain(
      'Devis accepté',
    );
    expect(buildQuoteDocument(quote(), { ...ctx, status: 'expired' }).stateMentions).toContain(
      'Devis expiré',
    );
    expect(buildQuoteDocument(quote(), { ...ctx, status: 'draft' }).stateMentions).toHaveLength(1);
  });

  it('refuse d’imprimer un calcul en erreur', () => {
    const q = quote({
      documentAmounts: {
        currency: 'USD',
        calculation: { ok: false, issues: [], totals: null },
        paymentsCheck: null,
      },
    });
    expect(() => buildQuoteDocument(q, ctx)).toThrow(/calcul de ce devis/);
  });

  it('présentation d’origine : toutes les mentions, aucun mot « facture » hors l’intitulé', () => {
    const m = buildQuoteDocument(quote(), ctx);
    const r = renderDocumentHtml(m, null, null);
    expect(missingMentions(m, r.html, null)).toEqual([]);
    expect(r.html).not.toContain('Éléments de sécurité DGI');
    expect(r.html.replace(/non valable comme facture/gi, '')).not.toMatch(/factur/i);
  });

  it.each(allTemplates().map((t) => [t.label, t] as const))(
    'modèle %s : toutes les mentions du devis, aucune mention de facture',
    (_label, template) => {
      const m = buildQuoteDocument(quote(), {
        ...ctx,
        layout: { label: template.label, version: template.version },
      });
      const r = renderDocumentHtml(m, null, {
        template,
        options: template.defaults,
        identity: IDENTITY,
        logos: renderLogos(true),
      });
      expect(missingMentions(m, r.html, null)).toEqual([]);
      expect(missingRepeatedMentions(m, r.headerTemplate, r.footerTemplate)).toEqual([]);
      expect(r.html).not.toContain('Éléments de sécurité DGI');
      const visible = r.html
        .replace(/<style>[\s\S]*?<\/style>/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/non valable comme facture/gi, '')
        // Libellé fixe du bloc client du modèle « Bandeau », déjà imprimé sur les
        // pro forma : le modèle ne connaît pas la nature du document (ADR-0028 § 3).
        .replace(/Facturé à/g, '');
      expect(visible).not.toMatch(/factur/i);
    },
  );
});

describe('règles pures du devis', () => {
  it('numéro DV{AA}{MM}-NNNNNN, qui s’allonge au-delà de 999 999', () => {
    expect(formatQuoteNumber({ year: 2026, month: 10 }, 7)).toBe('DV2610-000007');
    expect(formatQuoteNumber({ year: 2026, month: 1 }, 1_234_567)).toBe('DV2601-1234567');
  });

  it('un devis envoyé dont la validité est passée est expiré, le jour même ne l’est pas', () => {
    expect(quoteStatusOf('sent', '2026-10-21', '2026-10-21')).toBe('sent');
    expect(quoteStatusOf('sent', '2026-10-20', '2026-10-21')).toBe('expired');
    expect(quoteStatusOf('accepted', '2026-10-20', '2026-10-21')).toBe('accepted');
    expect(quoteStatusOf('draft', '2026-10-20', '2026-10-21')).toBe('draft');
  });

  it('actions par statut ; conversion une seule fois tant que la facture existe', () => {
    expect(quoteActionsOf('draft', false)).toMatchObject({
      edit: true,
      send: true,
      convert: false,
    });
    expect(quoteActionsOf('sent', false)).toMatchObject({
      accept: true,
      refuse: true,
      newVersion: true,
    });
    expect(quoteActionsOf('expired', false)).toMatchObject({ accept: false, newVersion: true });
    expect(quoteActionsOf('accepted', false).convert).toBe(true);
    expect(quoteActionsOf('accepted', true).convert).toBe(false);
    expect(quoteActionsOf('refused', false)).toMatchObject({ newVersion: true, convert: false });
  });
});
