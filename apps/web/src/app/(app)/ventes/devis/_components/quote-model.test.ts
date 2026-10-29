// Écrans Devis — ADR-0035 : un devis porte les lignes d'un brouillon de
// facture, ne se présente jamais comme une facture, et n'affiche aucun montant
// calculé hors de l'API.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { QuoteView } from '@/lib/api-crm';

import {
  peutConvertirDevis,
  peutPreparerDevis,
  champsRefuses,
  formatJour,
  formulaireDepuisDevis,
  formulaireDevisVide,
  LIBELLE_DEVIS,
  messageDevis,
  metaDepuisDevis,
  preparerDevis,
} from './quote-model';

function devis(): QuoteView {
  return {
    id: 'q1',
    number: 'DV2610-000007',
    version: 2,
    status: 'draft',
    statusLabel: 'Brouillon',
    title: 'Audit',
    customerName: 'Client SARL',
    customerId: 'c1',
    opportunityId: 'o1',
    currency: 'CDF',
    priceMode: 'ht',
    total: '348000.00',
    validUntil: '2026-11-20',
    convertedInvoiceId: null,
    createdAt: '2026-10-21T08:00:00.000Z',
    updatedAt: '2026-10-21T08:00:00.000Z',
    notes: null,
    customer: {
      customerId: 'c1',
      type: 'PM',
      name: 'Client SARL',
      nif: 'A01',
      exemptionReference: null,
      phone: null,
      email: null,
      address: null,
      printContactDetails: false,
    },
    lines: [
      {
        index: 0,
        source: 'catalog',
        catalogItemId: 'i1',
        code: 'AUDIT',
        edefCode: 'AUDIT',
        name: 'Audit',
        unit: 'jour',
        itemType: 'SER',
        taxGroup: 'B',
        outOfScope: false,
        quantity: '2',
        originalPrice: '150000.00',
        discount: { kind: 'percent', value: '10.00' },
        unitPrice: '135000.00',
        priceModification: null,
        priceOverridden: false,
        specificTax: null,
        amount: '270000.00',
      },
    ],
    lineInputs: [],
    documentAmounts: { currency: 'CDF', calculation: { ok: true, issues: [], totals: null } },
    sentAt: null,
    acceptedAt: null,
    refusedAt: null,
    refusalReason: null,
    opportunityOutcome: null,
    opportunity: { id: 'o1', title: 'Opp' },
    conversion: null,
    previousVersions: [],
    actions: {
      edit: true,
      delete: false,
      send: true,
      accept: false,
      refuse: false,
      newVersion: false,
      convert: false,
    },
    blockers: [],
    revision: 3,
  } as unknown as QuoteView;
}

describe('Devis — droits (ADR-0040 § 4.1)', () => {
  it('préparer exige `sales.quote` ; convertir exige aussi `sales.manage`', () => {
    expect(peutPreparerDevis(['sales.quote'])).toBe(true);
    expect(peutPreparerDevis(['sales.manage', 'sales.read'])).toBe(false);
    expect(peutPreparerDevis(null)).toBe(false);
    expect(peutConvertirDevis(['sales.quote'])).toBe(false);
    expect(peutConvertirDevis(['sales.manage'])).toBe(false);
    expect(peutConvertirDevis(['sales.quote', 'sales.manage'])).toBe(true);
  });
});

describe('Devis — modèle d’écran', () => {
  it('intitulé distinct du pro forma et de la facture', () => {
    expect(LIBELLE_DEVIS).toBe('DEVIS — non valable comme facture');
  });

  it('formulaire depuis un devis : ligne de catalogue au prix du catalogue, remise reprise', () => {
    const f = formulaireDepuisDevis(devis());
    expect(f.client).toEqual({
      mode: 'fiche',
      customerId: 'c1',
      nom: 'Client SARL',
      printContactDetails: false,
    });
    expect(f.lignes[0]).toMatchObject({
      source: 'catalog',
      catalogItemId: 'i1',
      prix: '',
      remise: 'percent',
    });
  });

  it('corps du devis : lignes et client des factures, sans paiement ni commentaire', () => {
    const f = formulaireDepuisDevis(devis());
    const r = preparerDevis(f, metaDepuisDevis(devis()));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.corps).toMatchObject({
        opportunityId: 'o1',
        title: 'Audit',
        validUntil: '2026-11-20',
        currency: 'CDF',
        priceMode: 'ht',
        customer: { customerId: 'c1', printContactDetails: false },
      });
      expect(r.corps.lines[0]).toMatchObject({ source: 'catalog', quantity: '2', unitPrice: null });
      expect(Object.keys(r.corps)).not.toContain('payments');
    }
  });

  it('refus locaux : mode de prix et client manquants, validité mal formée', () => {
    const r = preparerDevis(formulaireDevisVide(), {
      title: '',
      notes: '',
      validUntil: '20/11/2026',
      opportunityId: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(Object.keys(r.champs).sort()).toEqual(['customer', 'priceMode', 'validUntil']);
  });

  it('messages et champs refusés de l’API', () => {
    expect(messageDevis({ status: 409, detail: { code: 'QUOTE_ALREADY_CONVERTED' } }, 'x')).toMatch(
      /déjà été converti/,
    );
    expect(
      champsRefuses({
        detail: { details: { issues: [{ path: 'lines.0.unitPrice', message: 'm' }] } },
      }),
    ).toEqual({ 'lines.0.unitPrice': 'm' });
    expect(formatJour('2026-11-20')).toBe('20/11/2026');
  });

  it('aucun calcul de montant dans la source', () => {
    const src = readFileSync(fileURLToPath(new URL('./quote-model.ts', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/parseFloat|Number\(|parseInt|toFixed/);
  });
});
