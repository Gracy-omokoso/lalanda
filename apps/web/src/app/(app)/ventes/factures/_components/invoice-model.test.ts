// Tests du modèle de l'onglet Factures (ADR-0023, chantier E3), contre des
// réponses simulées conformes au contrat HTTP § S25e.14.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { InvoiceSummary, InvoiceView } from '@/lib/api';

import {
  actionsDocument,
  comparerDecimaux,
  enteteDocument,
  formatDateDgi,
  formatTauxChange,
  formulaireDepuisVue,
  formulaireVide,
  LIBELLE_PRO_FORMA,
  ligneDepuisOrigine,
  ligneVide,
  lireQuantiteSaisie,
  lireTauxChange,
  messageFacture,
  montantsResume,
  paiementUnique,
  peutFacturer,
  preparerDocument,
  preparerNormalisation,
  problemesGel,
  requeteFactures,
  STATUS_LABELS,
  TYPE_LABELS,
} from './invoice-model';

const NBSP = '\u00a0';
const NNBSP = '\u202f';

function erreurApi(status: number, detail: unknown): Error & { status: number; detail: unknown } {
  return Object.assign(new Error('x'), { status, detail });
}

/** Vue d'un document USD normalisé « en attente DGI », forme du contrat. */
function vue(partiel: Partial<InvoiceView> = {}): InvoiceView {
  return {
    id: '6714b1d5f2a3b4c5d6e7f801',
    status: 'pending_normalization',
    documentKind: 'proforma',
    documentLabel: 'Pro forma — non valable comme facture',
    proformaRef: 'PF-2026-000045',
    number: null,
    series: null,
    fiscalYear: null,
    issuedAt: null,
    type: 'FV',
    typeLabel: 'Facture de vente',
    currency: 'USD',
    priceMode: 'ht',
    emissionMode: 'normalized',
    environment: 'test',
    isf: 'TEST-ISF',
    customer: {
      customerId: '6713a0c4e1a2b3c4d5e6f701',
      type: 'PM',
      typeLabel: 'Personne morale',
      name: 'Exemple SARL',
      nif: 'A0000000X',
      exemptionReference: null,
      phone: null,
      email: null,
      address: null,
      printContactDetails: false,
    },
    pointOfSaleId: 'pos',
    lines: [
      {
        index: 0,
        source: 'catalog',
        catalogItemId: '6713a0c4e1a2b3c4d5e6f702',
        code: 'CONSEIL-H',
        edefCode: 'CONSEIL-H',
        name: 'Conseil (heure)',
        unit: 'heure',
        itemType: 'SER',
        taxGroup: 'B',
        outOfScope: false,
        quantity: '2.375',
        originalPrice: null,
        discount: null,
        unitPrice: '40.00',
        priceModification: null,
        priceOverridden: false,
        specificTax: null,
        amount: '95.00',
        credited: '0',
        remaining: '2.375',
      },
      {
        index: 1,
        source: 'free',
        catalogItemId: null,
        code: null,
        edefCode: null,
        name: 'Débours de transport',
        unit: 'forfait',
        itemType: 'SER',
        taxGroup: 'J',
        outOfScope: false,
        quantity: '1',
        originalPrice: '25.00',
        discount: { kind: 'percent', value: '10' },
        unitPrice: '22.50',
        priceModification: 'Remise 10%',
        priceOverridden: false,
        specificTax: null,
        amount: '22.50',
      },
    ],
    documentAmounts: {
      label: 'Montants du document (USD)',
      currency: 'USD',
      calculation: {
        ok: true,
        issues: [],
        totals: {
          calculationVersion: '1.0.0',
          policyId: 'dgi-cd-2026.1',
          priceMode: 'ht',
          lines: [],
          groups: [],
          specificTax: '0.00',
          total: '132.70',
          vatTotal: '15.20',
        },
      },
      payments: [{ method: 'VIREMENT', methodLabel: 'Virement', amount: '132.70' }],
      paymentsCheck: { ok: true, paidTotal: '132.70', amountOnCredit: '0.00', issues: [] },
    },
    conversion: null,
    normalizedAmounts: null,
    calculationVersion: '1.0.0',
    roundingPolicyId: 'dgi-cd-2026.1',
    taxRates: null,
    comments: { A: null, B: null, C: null, D: null, E: null, F: null, G: null, H: null },
    creditNote: null,
    creditNotes: [],
    seller: null,
    operator: null,
    normalization: null,
    readiness: { action: 'normalize', ready: false, blockers: [] },
    revision: 8,
    createdAt: '2026-10-19T09:00:00.000Z',
    updatedAt: '2026-10-19T09:00:00.000Z',
    ...partiel,
  };
}

function resume(partiel: Partial<InvoiceSummary> = {}): InvoiceSummary {
  return {
    id: 'a',
    status: 'draft',
    documentKind: 'proforma',
    proformaRef: 'PF-2026-000001',
    number: null,
    type: 'FV',
    currency: 'USD',
    issuedAt: null,
    customer: { name: 'Exemple SARL', type: 'PM' },
    documentAmounts: { calculation: { totals: { total: '1234.5' } } },
    normalizedAmounts: null,
    emissionMode: null,
    revision: 1,
    ...partiel,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('aucun calcul de montant dans le navigateur (docs/26, ADR-0023 § E3)', () => {
  const ici = fileURLToPath(new URL('.', import.meta.url));
  const sansCommentaires = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('invoice-model.ts n’utilise ni Number(), ni parseFloat, ni parseInt, ni Math, ni toFixed', () => {
    const source = sansCommentaires(
      readFileSync(fileURLToPath(new URL('./invoice-model.ts', import.meta.url)), 'utf8'),
    );
    expect(source).not.toMatch(/\bNumber\s*\(/);
    expect(source).not.toMatch(/\bparseFloat\b/);
    expect(source).not.toMatch(/\bparseInt\b/);
    expect(source).not.toMatch(/\.toFixed\s*\(/);
    expect(source).not.toMatch(/\bMath\./);
    expect(source).not.toMatch(/[=(,]\s*\+[a-zA-Z_]/);
  });

  it('aucun composant de l’onglet ne convertit un montant non plus', () => {
    const fichiers = readdirSync(ici).filter((f) => f.endsWith('.tsx'));
    expect(fichiers.length).toBeGreaterThan(0);
    for (const f of fichiers) {
      const code = sansCommentaires(readFileSync(`${ici}/${f}`, 'utf8'));
      expect(code, f).not.toMatch(
        /\bNumber\s*\(|\bparseFloat\b|\bparseInt\b|\.toFixed\s*\(|\bMath\./,
      );
    }
  });
});

describe('en-tête : jamais « Facture » avant la normalisation (§ S25e.1)', () => {
  it('pro forma : libellé fixe et référence PF-, jamais « Facture n° »', () => {
    for (const status of ['draft', 'pending_normalization', 'normalization_failed'] as const) {
      const e = enteteDocument(vue({ status }));
      expect(e.titre).toBe(LIBELLE_PRO_FORMA);
      expect(e.reference).toBe('PF-2026-000045');
      expect(e.numeroDefinitif).toBe(false);
      expect(e.titre).not.toMatch(/facture n°/i);
    }
  });

  it('un numéro réservé ou un libellé fautif ne fait pas une facture', () => {
    const e = enteteDocument(
      vue({ number: '2026-000123', documentKind: 'proforma', documentLabel: 'Facture' }),
    );
    expect(e.titre).toBe(LIBELLE_PRO_FORMA);
    expect(e.reference).toBe('PF-2026-000045');
  });

  it('facture émise ou normalisée : numéro définitif', () => {
    expect(
      enteteDocument(vue({ status: 'issued', documentKind: 'invoice', number: '2026-000123' }))
        .titre,
    ).toBe('Facture n° 2026-000123');
    expect(
      enteteDocument(
        vue({
          status: 'normalized',
          documentKind: 'invoice',
          number: 'TEST-2026-000004',
          type: 'FA',
        }),
      ).titre,
    ).toBe('Facture d’avoir normalisée n° TEST-2026-000004');
  });

  it('les libellés de type et de statut non finals ne disent pas « facture »', () => {
    for (const l of Object.values(TYPE_LABELS)) expect(l).not.toMatch(/facture/i);
    for (const s of ['draft', 'pending_normalization', 'normalization_failed'] as const) {
      expect(STATUS_LABELS[s]).not.toMatch(/facture/i);
    }
  });
});

describe('actions : « Émettre » ou « Normaliser », jamais les deux', () => {
  const tout = { gerer: true, facturer: true };

  it('le brouillon suit readiness.action', () => {
    const n = actionsDocument(vue({ status: 'draft' }), tout);
    expect(n).toContain('normaliser');
    expect(n).not.toContain('emettre');
    const e = actionsDocument(
      vue({ status: 'draft', readiness: { action: 'issue', ready: true, blockers: [] } }),
      tout,
    );
    expect(e).toContain('emettre');
    expect(e).not.toContain('normaliser');
  });

  it('sans sales.invoice : ni émettre ni normaliser', () => {
    const a = actionsDocument(vue({ status: 'draft' }), { gerer: true, facturer: false });
    expect(a).toEqual(['modifier', 'supprimer']);
    expect(peutFacturer(['sales.read', 'sales.manage'])).toBe(false);
    expect(peutFacturer(['sales.invoice'])).toBe(true);
    expect(peutFacturer(null)).toBe(false);
  });

  it('avoir sur une facture finale, pas sur un avoir ; reprise sans numéro réservé', () => {
    expect(actionsDocument(vue({ status: 'normalized' }), tout)).toEqual(['avoir']);
    expect(actionsDocument(vue({ status: 'issued', type: 'FA' }), tout)).toEqual([]);
    expect(actionsDocument(vue({ status: 'pending_normalization' }), tout)).toEqual([]);
    expect(actionsDocument(vue({ status: 'normalization_failed' }), tout)).toEqual(['reprendre']);
    const reserve = vue({
      status: 'normalization_failed',
      normalization: {
        attempts: 1,
        reservedNumber: 'TEST-2026-000005',
        codeDefDgi: null,
        nim: null,
        counters: null,
        dgiDateTime: null,
        qrCode: null,
        lastError: null,
        normalizedAt: null,
      },
    });
    expect(actionsDocument(reserve, tout)).toEqual([]);
  });
});

describe('montants : recopiés de l’API, mis en forme par chaîne', () => {
  it('liste : document et CDF normalisé', () => {
    expect(montantsResume(resume())).toEqual({
      document: `1${NNBSP}234,50${NBSP}USD`,
      normalise: null,
    });
    expect(
      montantsResume(
        resume({
          documentAmounts: { calculation: { totals: null } },
          normalizedAmounts: { calculation: { total: '2792799.66' } },
        }),
      ),
    ).toEqual({ document: 'Total à compléter', normalise: `2${NNBSP}792${NNBSP}799,66${NBSP}CDF` });
  });

  it('paiement unique : recopie du total servi, sans calcul', () => {
    const p = paiementUnique(vue(), 'ESPECES');
    expect(p?.[0]?.montant).toBe('132,70');
    expect(
      paiementUnique(
        vue({
          documentAmounts: {
            ...vue().documentAmounts,
            calculation: { ok: false, issues: [], totals: null },
          },
        }),
        'ESPECES',
      ),
    ).toBeNull();
  });

  it('taux de change et dates DGI', () => {
    expect(formatTauxChange('2262.32')).toBe(`2${NNBSP}262,32 CDF pour 1 USD`);
    expect(formatTauxChange('2262.3215')).toBe(`2${NNBSP}262,3215 CDF pour 1 USD`);
    expect(formatDateDgi('2026-10-19T00:00:00+01:00')).toBe('19 oct. 2026');
  });
});

describe('saisie : formes seulement', () => {
  it('quantité à trois décimales au plus', () => {
    expect(lireQuantiteSaisie('2,375')).toEqual({ ok: true, valeur: '2.375' });
    expect(lireQuantiteSaisie('2,3750')).toEqual({ ok: true, valeur: '2.375' });
    expect(lireQuantiteSaisie('2,3751').ok).toBe(false);
    expect(lireQuantiteSaisie('0').ok).toBe(false);
    expect(lireQuantiteSaisie('-1').ok).toBe(false);
  });

  it('taux de change à huit décimales au plus', () => {
    expect(lireTauxChange('2 270,5')).toEqual({ ok: true, valeur: '2270.5' });
    expect(lireTauxChange('1e3').ok).toBe(false);
    expect(lireTauxChange('2270,123456789').ok).toBe(false);
  });

  it('comparaison chiffre à chiffre, exacte au-delà de 2^53', () => {
    expect(comparerDecimaux('2.375', '2.375')).toBe(0);
    expect(comparerDecimaux('2.376', '2.375')).toBe(1);
    expect(comparerDecimaux('2.3', '2.30')).toBe(0);
    expect(comparerDecimaux('10', '9.999')).toBe(1);
    expect(comparerDecimaux('9007199254740993', '9007199254740992')).toBe(1);
    expect(comparerDecimaux('x', '1')).toBeNull();
  });
});

describe('préparation du corps (contrat § S25e.14)', () => {
  it('lignes de catalogue, libre et paiements, montants en chaînes', () => {
    const f = formulaireVide();
    f.priceMode = 'ht';
    f.currency = 'USD';
    f.client = { mode: 'fiche', customerId: 'c1', nom: 'Exemple', printContactDetails: false };
    const cat = { ...ligneVide('catalog'), catalogItemId: 'i1', quantite: '2,375' };
    const libre = {
      ...ligneVide('free'),
      name: 'Débours de transport',
      itemType: 'SER' as const,
      taxGroup: 'J' as const,
      unit: 'forfait',
      prix: '25',
      remise: 'percent' as const,
      remiseValeur: '10',
    };
    f.lignes = [cat, libre];
    f.paiements = [{ cle: 'p', method: 'VIREMENT', montant: '132,70' }];
    const r = preparerDocument(f);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.corps.lines).toEqual([
      {
        source: 'catalog',
        catalogItemId: 'i1',
        quantity: '2.375',
        unitPrice: null,
        discount: null,
      },
      {
        source: 'free',
        code: null,
        name: 'Débours de transport',
        itemType: 'SER',
        taxGroup: 'J',
        outOfScope: false,
        unit: 'forfait',
        quantity: '1',
        unitPrice: '25',
        specificTax: null,
        discount: { kind: 'percent', value: '10' },
      },
    ]);
    expect(r.corps.payments).toEqual([{ method: 'VIREMENT', amount: '132.70' }]);
    expect(r.corps.creditNote).toBeNull();
    expect(r.corps.showUsdCounterValue).toBe(false);
  });

  it('vente de comptoir ; article d’une autre devise sans prix refusé', () => {
    const f = formulaireVide();
    f.priceMode = 'ttc';
    f.client = { mode: 'comptoir', nom: '' };
    f.lignes = [{ ...ligneVide('catalog'), catalogItemId: 'i1', deviseArticle: 'USD' }];
    const r = preparerDocument(f);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.champs['lines.0.unitPrice']).toMatch(/USD/);
    f.lignes[0]!.prix = '4 064';
    const r2 = preparerDocument(f);
    expect(r2.ok && r2.corps.customer).toEqual({ customerId: null, walkIn: { name: null } });
    expect(r2.ok && r2.corps.lines[0]).toMatchObject({ unitPrice: '4064' });
  });

  it('avoir : quantité au plus le restant, nature obligatoire', () => {
    const origine = vue({
      status: 'normalized',
      documentKind: 'invoice',
      number: 'TEST-2026-000001',
    });
    const f = formulaireVide();
    f.type = 'FA';
    f.currency = 'USD';
    f.priceMode = 'ht';
    f.client = { mode: 'fiche', customerId: 'c1', nom: 'Exemple', printContactDetails: false };
    const l = ligneDepuisOrigine(origine.lines[0]!);
    expect(l.quantite).toBe('2,375');
    l.quantite = '2,376';
    f.lignes = [l];
    let r = preparerDocument(f);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.champs['creditNote.nature']).toBeDefined();
    expect(r.champs['lines.0.quantity']).toMatch(/2,375/);
    f.nature = 'RAM';
    f.originInvoiceId = origine.id;
    l.quantite = '1';
    r = preparerDocument(f);
    expect(r.ok && r.corps.lines).toEqual([
      { source: 'origin', originLineIndex: 0, quantity: '1' },
    ]);
    expect(r.ok && r.corps.creditNote).toEqual({ nature: 'RAM', originInvoiceId: origine.id });
  });

  it('reprise d’un brouillon : prix avant remise, prix d’article non surchargé laissé vide', () => {
    const f = formulaireDepuisVue(vue({ status: 'draft' }));
    expect(f.lignes[0]?.prix).toBe('');
    expect(f.lignes[1]?.prix).toBe('25,00');
    expect(f.lignes[1]?.remise).toBe('percent');
    expect(f.paiements[0]?.montant).toBe('132,70');
    expect(f.client).toEqual({
      mode: 'fiche',
      customerId: '6713a0c4e1a2b3c4d5e6f701',
      nom: 'Exemple SARL',
      printContactDetails: false,
    });
  });
});

describe('normaliser', () => {
  it('taux officiel : exchangeRate null ; autre taux : chaîne et date', () => {
    expect(preparerNormalisation(7, 'officiel', '', '')).toEqual({
      ok: true,
      corps: { expectedRevision: 7, exchangeRate: null },
    });
    expect(preparerNormalisation(7, 'autre', '2 270,00', '2026-10-19')).toEqual({
      ok: true,
      corps: { expectedRevision: 7, exchangeRate: { rate: '2270.00', date: '2026-10-19' } },
    });
    expect(preparerNormalisation(7, 'autre', 'abc', '').ok).toBe(false);
  });
});

describe('liste et erreurs', () => {
  it('requête : statut, type, recherche', () => {
    expect(requeteFactures({ statut: 'final', type: 'FA', q: '  PF-2026 ' }, 'c')).toEqual({
      status: 'final',
      type: 'FA',
      q: 'PF-2026',
      cursor: 'c',
    });
    expect(requeteFactures({ statut: 'all', type: '', q: '' })).toEqual({ status: 'all' });
  });

  it('422 INVOICE_NOT_ISSUABLE : tous les problèmes, ligne comprise', () => {
    const err = erreurApi(422, {
      code: 'INVOICE_NOT_ISSUABLE',
      message: 'x',
      details: {
        issues: [
          {
            code: 'PAYMENTS_TOTAL_MISMATCH',
            lineIndex: null,
            message: 'La somme des paiements diffère du total.',
          },
          {
            code: 'CREDIT_NOTE_QUANTITY_EXCEEDED',
            lineIndex: 0,
            message: 'Quantité supérieure au restant.',
          },
        ],
      },
    });
    expect(problemesGel(err)).toEqual([
      'La somme des paiements diffère du total.',
      'Ligne 1 : Quantité supérieure au restant.',
    ]);
    expect(messageFacture(err, 'repli')).toMatch(/Corrigez/);
  });

  it('codes du contrat traduits ; inconnu → message du serveur', () => {
    expect(messageFacture(erreurApi(409, { code: 'NORMALIZATION_REQUIRED' }), 'r')).toMatch(
      /normalisé/,
    );
    expect(
      messageFacture(erreurApi(409, { code: 'EXCHANGE_RATE_REFERENCE_UNAVAILABLE' }), 'r'),
    ).toMatch(/Rafraîchissez/);
  });
});
