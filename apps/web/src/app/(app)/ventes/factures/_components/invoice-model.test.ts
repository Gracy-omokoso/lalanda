// Tests du modèle de l'onglet Factures (ADR-0023, chantier E3 ; ADR-0024,
// chantier F3), contre des réponses simulées conformes aux contrats HTTP
// § S25e.14 et ADR-0024 § 9.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { InvoiceSummary, InvoiceView, NormalizationView } from '@/lib/api';

import { erreursFormulaire } from '../../_components/sales-model';

import {
  actionsDocument,
  commentaireAModifiable,
  comparerDecimaux,
  conduiteApresEchecNormaliser,
  corpsLisible,
  ecartsAffiches,
  enTestDgi,
  enteteDocument,
  etapesNormalisation,
  JOURNAL_EVENT_LABELS,
  libelleChampDgi,
  lignesEchanges,
  lireMotifDeclaration,
  phaseNormalisation,
  presentationNormalisation,
  prochaineRelecture,
  RELECTURE,
  TITRES_PHASE,
  formatDateDgi,
  formatTauxChange,
  formulaireDepuisVue,
  formulaireVide,
  LIBELLE_PRO_FORMA,
  MENTION_TEST_DGI,
  RAPPEL_TEST_DGI,
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
    showUsdCounterValue: false,
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
    series: null,
    revision: 1,
    ...partiel,
  };
}

const SANS_ACTION: NormalizationView['actions'] = {
  retry: false,
  check: false,
  declareNotNormalized: false,
  backToDraft: false,
};

/** Sous-document `normalization` conforme au contrat ADR-0024 § 9.2. */
function normalisation(partiel: Partial<NormalizationView> = {}): NormalizationView {
  return {
    attempts: 1,
    reservedNumber: 'TEST-2026-000012',
    codeDefDgi: null,
    nim: null,
    counters: null,
    dgiDateTime: null,
    qrCode: null,
    lastError: null,
    normalizedAt: null,
    phase: 'queued',
    dgiRequestId: null,
    differences: null,
    nextCheckAt: null,
    review: null,
    actions: SANS_ACTION,
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
    // La fixture est en environnement de TEST DGI : « (test) » suit le numéro
    // (demande de la décideuse, chantier F3 d'ADR-0024).
    expect(
      enteteDocument(
        vue({
          status: 'normalized',
          documentKind: 'invoice',
          number: 'TEST-2026-000004',
          type: 'FA',
        }),
      ).titre,
    ).toBe('Facture d’avoir normalisée n° TEST-2026-000004 (test)');
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
    const solde = vue({ status: 'issued' });
    const credite = vue({
      status: 'issued',
      lines: solde.lines.map((l) => ({ ...l, credited: l.quantity, remaining: '0.000' })),
    });
    expect(actionsDocument(credite, tout)).toEqual([]);
    expect(actionsDocument(vue({ status: 'issued', type: 'FA' }), tout)).toEqual([]);
    expect(actionsDocument(vue({ status: 'pending_normalization' }), tout)).toEqual([]);
    expect(actionsDocument(vue({ status: 'normalization_failed' }), tout)).toEqual(['reprendre']);
    // ADR-0024 § 9.2 : la reprise suit `actions.backToDraft`, servi par l'API.
    const reserve = vue({
      status: 'normalization_failed',
      normalization: normalisation({ phase: 'failed', reservedNumber: 'TEST-2026-000005' }),
    });
    expect(actionsDocument(reserve, tout)).toEqual([]);
    const permise = vue({
      status: 'normalization_failed',
      normalization: normalisation({
        phase: 'failed',
        actions: { ...SANS_ACTION, backToDraft: true },
      }),
    });
    expect(actionsDocument(permise, tout)).toEqual(['reprendre']);
    expect(actionsDocument(permise, { gerer: false, facturer: false })).toEqual(['reprendre']);
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
    // Taux saisi dont l'API a retiré les zéros finaux (`"2270.00"` → `"2270"`).
    expect(formatTauxChange('2270')).toBe(`2${NNBSP}270 CDF pour 1 USD`);
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

  it('reprise d’un brouillon : la case de contre-valeur USD est relue de la vue', () => {
    expect(
      formulaireDepuisVue(vue({ status: 'draft', currency: 'CDF', showUsdCounterValue: true }))
        .showUsdCounterValue,
    ).toBe(true);
  });

  it('400 CATALOG_CURRENCY_MISMATCH : rangé sous le prix de la ligne', () => {
    const err = erreurApi(400, {
      code: 'INVALID_REQUEST',
      message: 'x',
      details: {
        issues: [
          {
            path: 'lines.0.unitPrice',
            code: 'CATALOG_CURRENCY_MISMATCH',
            message: 'Le prix de cet article est en USD : saisissez le prix unitaire en CDF.',
          },
        ],
      },
    });
    const e = erreursFormulaire(err, ['lines.0.unitPrice']);
    expect(e.champs['lines.0.unitPrice']).toMatch(/en USD/);
    expect(e.autres).toEqual([]);
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

describe('commentaire A (§ S25e.7)', () => {
  it('automatique pour AO, saisissable seulement avec une ligne du groupe D', () => {
    const f = formulaireVide();
    expect(commentaireAModifiable(f, null)).toBe(false);
    expect(commentaireAModifiable(f, 'PM')).toBe(false);
    f.lignes = [{ ...ligneVide('free'), taxGroup: 'D' }];
    expect(commentaireAModifiable(f, 'PM')).toBe(true);
    expect(commentaireAModifiable(f, 'AO')).toBe(false);
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

// ─────────────────────────────────────────────────────────────────────────────
// Normalisation DGI — chantier F3 (ADR-0024 § 9.3 et critères F3)
// ─────────────────────────────────────────────────────────────────────────────

/** Document normalisé, éléments DGI tels que reçus. */
function normalisee(): InvoiceView {
  return vue({
    status: 'normalized',
    documentKind: 'invoice',
    documentLabel: 'Facture',
    number: 'TEST-2026-000012',
    normalization: normalisation({
      phase: 'done',
      codeDefDgi: 'TEST-ABCD-EFGH-IJKL-MNOP-QRST',
      nim: 'TS01000123',
      counters: '12/15 FV',
      dgiDateTime: '19/10/2026 10:03:12',
      qrCode: 'F;TS01000123;TESTABCDEFGHIJKLMNOPQRST;A0000000X;20261019100312',
      normalizedAt: '2026-10-19T09:03:12.000Z',
      dgiRequestId: 'uid-1',
    }),
  });
}

const enAttente = (n: Partial<NormalizationView>): InvoiceView =>
  vue({ status: 'pending_normalization', normalization: normalisation(n) });

describe('normalisation : chaque ligne du tableau § 9.3', () => {
  it('normalized / done : « Facture normalisée », éléments DGI tels quels, seul en-tête « Facture »', () => {
    const v = normalisee();
    const p = presentationNormalisation(v)!;
    expect(p.titre).toBe('Facture normalisée');
    expect(p.ton).toBe('succes');
    expect(p.boutons).toEqual([]);
    expect(p.elements).toEqual([
      { libelle: 'Code DEF/DGI', valeur: 'TEST-ABCD-EFGH-IJKL-MNOP-QRST' },
      { libelle: 'NIM (identifiant de l’e-MCF)', valeur: 'TS01000123' },
      { libelle: 'Compteurs', valeur: '12/15 FV' },
      { libelle: 'Date DGI', valeur: '19/10/2026 10:03:12' },
    ]);
    expect(enteteDocument(v).titre).toBe('Facture normalisée n° TEST-2026-000012 (test)');
  });

  it('titre « Facture » seulement pour done : toutes les autres phases restent pro forma', () => {
    const autres: Array<[InvoiceView['status'], NormalizationView['phase']]> = [
      ['pending_normalization', 'queued'],
      ['pending_normalization', 'in_progress'],
      ['pending_normalization', 'uncertain'],
      ['pending_normalization', 'needs_review'],
      ['normalization_failed', 'failed'],
    ];
    for (const [status, phase] of autres) {
      const v = vue({ status, normalization: normalisation({ phase }) });
      const e = enteteDocument(v);
      expect(e.titre, phase).toBe(LIBELLE_PRO_FORMA);
      expect(e.reference, phase).toBe('PF-2026-000045');
      expect(e.numeroDefinitif, phase).toBe(false);
      // Le numéro réservé n'apparaît nulle part dans l'en-tête.
      expect(JSON.stringify(e), phase).not.toContain('TEST-2026-000012');
      expect(presentationNormalisation(v)!.titre, phase).not.toMatch(/^Facture/);
    }
  });

  it('défense : « normalisé » sans code DEF/DGI ne se dit jamais « Facture »', () => {
    const v = normalisee();
    const incomplet = { ...v, normalization: { ...v.normalization!, codeDefDgi: null } };
    expect(enteteDocument(incomplet).titre).toBe(LIBELLE_PRO_FORMA);
    expect(presentationNormalisation(incomplet)!.elements).toBeNull();
  });

  it('pending / in_progress : « Transmission à la DGI… », aucun bouton même si actions en propose', () => {
    const p = presentationNormalisation(
      enAttente({
        phase: 'in_progress',
        actions: { retry: true, check: true, declareNotNormalized: true, backToDraft: true },
      }),
    )!;
    expect(p.titre).toBe('Transmission à la DGI…');
    expect(p.boutons).toEqual([]);
    expect(p.resume).toMatch(/non valable comme facture/);
  });

  it('pending / queued : « En attente d’envoi », lastError expliqué, « Relancer » si actions.retry', () => {
    const v = enAttente({
      phase: 'queued',
      lastError: {
        code: 'NORMALIZATION_IN_PROGRESS',
        category: null,
        message: '',
        dgiErrorCode: null,
        dgiMessage: null,
        retryable: true,
      },
      actions: { ...SANS_ACTION, retry: true },
    });
    const p = presentationNormalisation(v)!;
    expect(p.titre).toBe('En attente d’envoi');
    expect(p.boutons).toEqual(['relancer']);
    expect(p.erreur?.message).toMatch(/attend son tour/);
    expect(presentationNormalisation(enAttente({ phase: 'queued' }))!.boutons).toEqual([]);
  });

  it('pending / uncertain : bandeau explicite, heure de vérification, blocage expliqué', () => {
    const p = presentationNormalisation(
      enAttente({
        phase: 'uncertain',
        dgiRequestId: 'uid-7',
        nextCheckAt: '2026-10-19T09:03:30.000Z',
      }),
      { timeZone: 'Africa/Kinshasa' },
    )!;
    expect(p.titre).toBe('Réponse de la DGI incertaine');
    expect(p.ton).toBe('alerte');
    expect(p.consignes[0]).toBe(
      'Ne refaites pas cette vente : Lalanda vérifie auprès de la DGI vers 10:03.',
    );
    expect(p.consignes[1]).toMatch(/autres normalisations de votre organisation attendent/);
    expect(p.demandeDgi).toBe('uid-7');
    expect(p.boutons).toEqual([]);
  });

  it('« Vérifier maintenant » seulement quand l’API l’ouvre (actions.check)', () => {
    const p = presentationNormalisation(
      enAttente({ phase: 'uncertain', actions: { ...SANS_ACTION, check: true } }),
    )!;
    expect(p.boutons).toEqual(['verifier']);
  });

  it('pending / needs_review : marche à suivre § 4.4 ; « Déclarer » selon actions seulement', () => {
    const revue = enAttente({
      phase: 'needs_review',
      review: {
        since: '2026-10-19T09:35:00.000Z',
        reason: 'Aucune réponse exploitable de la DGI.',
      },
      nextCheckAt: '2026-10-19T09:50:00.000Z',
    });
    const sans = presentationNormalisation(revue, { timeZone: 'Africa/Kinshasa' })!;
    expect(sans.titre).toBe('Vérification nécessaire');
    expect(sans.consignes).toHaveLength(4);
    expect(sans.consignes[0]).toMatch(/vers 10:50/);
    expect(sans.consignes[1]).toMatch(/Propriétaire ou le Directeur financier/);
    expect(sans.consignes[2]).toMatch(/jamais d’éléments de sécurité à la main/);
    expect(sans.revue).toEqual({
      depuis: '2026-10-19T09:35:00.000Z',
      motif: 'Aucune réponse exploitable de la DGI.',
    });
    expect(sans.boutons).toEqual([]);
    const avec = presentationNormalisation({
      ...revue,
      normalization: {
        ...revue.normalization!,
        actions: { ...SANS_ACTION, declareNotNormalized: true, check: true },
      },
    })!;
    expect(avec.boutons).toEqual(['verifier', 'declarer']);
  });

  it('normalization_failed / failed : notre message, PUIS code et libellé DGI tels quels', () => {
    const v = vue({
      status: 'normalization_failed',
      normalization: normalisation({
        phase: 'failed',
        lastError: {
          code: 'EDEF_BUSINESS_ERROR',
          category: 'capacity',
          message: 'L’e-MCF a trop de demandes en attente.',
          dgiErrorCode: '1',
          dgiMessage: 'Too many pending requests  (max 10)',
          retryable: true,
        },
        actions: { ...SANS_ACTION, retry: true },
      }),
    });
    const p = presentationNormalisation(v)!;
    expect(p.titre).toBe('Normalisation refusée');
    expect(p.erreur).toEqual({
      message: 'L’e-MCF a trop de demandes en attente.',
      conduite: expect.stringMatching(/deux minutes/),
      codeLalanda: 'EDEF_BUSINESS_ERROR',
      // Tels quels : ni traduits, ni nettoyés (double espace compris).
      dgi: { code: '1', libelle: 'Too many pending requests  (max 10)' },
      lienFiscalite: false,
    });
    expect(p.boutons).toEqual(['relancer']);
  });

  it('écart de calcul : message rassurant, rien n’a été enregistré, tableau des écarts', () => {
    const v = vue({
      status: 'normalization_failed',
      normalization: normalisation({
        phase: 'failed',
        dgiRequestId: 'uid-9',
        differences: [
          { field: 'vab', ours: '64.00', dgi: '64.01' },
          { field: 'total', ours: '464.00', dgi: null },
        ],
        lastError: {
          code: 'EDEF_TOTALS_MISMATCH',
          category: 'totals_mismatch',
          message: 'Écart de calcul entre Lalanda et la DGI.',
          dgiErrorCode: null,
          dgiMessage: null,
          retryable: false,
        },
        actions: { ...SANS_ACTION, backToDraft: true },
      }),
    });
    const p = presentationNormalisation(v)!;
    expect(p.resume).toMatch(/^Écart de calcul entre Lalanda et la DGI\./);
    expect(p.erreur?.conduite).toMatch(/Rien n’a été enregistré/);
    expect(p.erreur?.conduite).toMatch(/aucune facture n’a été créée/);
    expect(p.erreur?.dgi).toBeNull();
    expect(p.ecarts).toEqual([
      { champ: 'vab', libelle: 'TVA du groupe B', lalanda: '64.00', dgi: '64.01' },
      { champ: 'total', libelle: 'Total à payer', lalanda: '464.00', dgi: 'absent' },
    ]);
    // Non réessayable : aucun « Relancer », la reprise vit dans le détail.
    expect(p.boutons).toEqual([]);
    expect(actionsDocument(v, { gerer: true, facturer: true })).toEqual(['reprendre']);
  });

  it('champs e-DEF en mots', () => {
    expect(libelleChampDgi('tb')).toBe('Taux du groupe B');
    expect(libelleChampDgi('taa')).toBe('Total du groupe A');
    expect(libelleChampDgi('hap')).toBe('Hors taxe du groupe P');
    expect(libelleChampDgi('ts')).toBe('Taxe spécifique');
    expect(libelleChampDgi('vtotal')).toBe('TVA totale');
    expect(libelleChampDgi('curTotal')).toBe('Contre-valeur en USD');
    expect(libelleChampDgi('inconnu')).toBe('inconnu');
    expect(ecartsAffiches([])).toBeNull();
  });

  it('erreur avant envoi : phrase de repli et lien vers la Fiscalité ; jeton refusé aussi', () => {
    const base = {
      category: 'precondition' as const,
      dgiErrorCode: null,
      dgiMessage: null,
      retryable: false,
    };
    const pdv = presentationNormalisation(
      vue({
        status: 'normalization_failed',
        normalization: normalisation({
          phase: 'failed',
          lastError: { ...base, code: 'POINT_OF_SALE_NOT_ACTIVE', message: '' },
        }),
      }),
    )!;
    expect(pdv.erreur?.message).toMatch(/point de vente n’est pas actif/);
    expect(pdv.erreur?.conduite).toMatch(/rien n’a été transmis/);
    expect(pdv.erreur?.lienFiscalite).toBe(true);
    expect(pdv.resume).toMatch(/^Le document n’a pas été envoyé à la DGI\./);
    const jeton = presentationNormalisation(
      vue({
        status: 'normalization_failed',
        normalization: normalisation({
          phase: 'failed',
          lastError: {
            ...base,
            category: 'token_rejected',
            code: 'EDEF_TOKEN_REJECTED',
            message: 'Jeton refusé.',
          },
        }),
      }),
    )!;
    expect(jeton.erreur?.lienFiscalite).toBe(true);
    expect(jeton.erreur?.conduite).toMatch(/Renouvelez-le/);
  });

  it('chaque catégorie d’erreur a sa conduite en français', () => {
    const categories = [
      'data',
      'configuration',
      'capacity',
      'temporary',
      'server',
      'state',
      'totals_mismatch',
      'duplicate_pending',
      'unknown',
      'network',
      'token_rejected',
      'precondition',
    ] as const;
    const erreur = (category: (typeof categories)[number]) => ({
      code: 'X',
      category,
      message: 'm',
      dgiErrorCode: null,
      dgiMessage: null,
      retryable: false,
    });
    for (const category of categories) {
      const p = presentationNormalisation(
        enAttente({ phase: 'uncertain', lastError: erreur(category) }),
      )!;
      expect(p.erreur?.conduite, category).toMatch(/^[A-ZÉ]/);
    }
    // Une fois le rattrapage conclu (`failed`), « Lalanda vérifie » serait faux :
    // seul le message de l'API (la conclusion) reste.
    for (const category of ['server', 'state', 'duplicate_pending', 'network'] as const) {
      const p = presentationNormalisation(
        vue({
          status: 'normalization_failed',
          normalization: normalisation({ phase: 'failed', lastError: erreur(category) }),
        }),
      )!;
      expect(p.erreur?.conduite, category).toBeNull();
      expect(p.erreur?.message).toBe('m');
    }
  });

  it('déclarée non normalisée (demande envoyée) : jamais « rien n’a été transmis »', () => {
    // Forme observée contre l'API réelle (F2) : catégorie `precondition` après un envoi.
    const v = vue({
      status: 'normalization_failed',
      normalization: normalisation({
        phase: 'failed',
        dgiRequestId: '5ac45769-uid',
        lastError: {
          code: 'DECLARED_NOT_NORMALIZED',
          category: 'precondition',
          message: 'Déclarée non normalisée après vérification auprès de la DGI.',
          dgiErrorCode: null,
          dgiMessage: null,
          retryable: true,
        },
        actions: { ...SANS_ACTION, retry: true },
      }),
    });
    const p = presentationNormalisation(v)!;
    expect(p.resume).toMatch(/^La DGI n’a pas normalisé ce document\./);
    expect(p.erreur?.conduite).toBeNull();
    expect(p.erreur?.message).toMatch(/^Déclarée non normalisée/);
    expect(etapesNormalisation(v, false).map((e) => e.etat)).toEqual([
      'fait',
      'fait',
      'fait',
      'echec',
    ]);
  });

  it('mentions « test » impossibles à manquer (demande de la décideuse)', () => {
    const v = normalisee();
    expect(v.environment).toBe('test');
    expect(enteteDocument(v).titre).toBe('Facture normalisée n° TEST-2026-000012 (test)');
    expect(enteteDocument({ ...v, environment: 'production' }).titre).toBe(
      'Facture normalisée n° TEST-2026-000012',
    );
    expect(enTestDgi(v)).toBe(true);
    expect(enTestDgi({ environment: 'production' })).toBe(false);
    expect(MENTION_TEST_DGI).toBe('Environnement de test DGI — facture sans valeur fiscale');
    expect(RAPPEL_TEST_DGI).toBe('Environnement de test DGI — sans valeur fiscale');
    const ici = fileURLToPath(new URL('.', import.meta.url));
    // Fiche : bandeau en tête, avant le titre.
    const detail = readFileSync(`${ici}/invoice-detail.tsx`, 'utf8');
    expect(detail).toMatch(/enTestDgi\(vue\)/);
    expect(detail.indexOf('{MENTION_TEST_DGI}')).toBeGreaterThan(-1);
    expect(detail.indexOf('{MENTION_TEST_DGI}')).toBeLessThan(detail.indexOf('id="doc-titre"'));
    // Fenêtre « Normaliser » : rappel quand l'organisation est en test.
    expect(readFileSync(`${ici}/normalize-dialog.tsx`, 'utf8')).toMatch(/\{RAPPEL_TEST_DGI\}/);
  });

  it('phase : document antérieur sans phase → queued ; jamais « done » tant que le statut attend', () => {
    expect(phaseNormalisation(vue({ status: 'pending_normalization', normalization: null }))).toBe(
      'queued',
    );
    expect(phaseNormalisation(enAttente({ phase: 'done' }))).toBe('in_progress');
    expect(phaseNormalisation(enAttente({ phase: 'failed' }))).toBe('in_progress');
    expect(phaseNormalisation(vue({ status: 'draft' }))).toBeNull();
    expect(phaseNormalisation(vue({ status: 'issued' }))).toBeNull();
    expect(Object.keys(TITRES_PHASE).sort()).toEqual([
      'done',
      'failed',
      'in_progress',
      'needs_review',
      'queued',
      'uncertain',
    ]);
  });

  it('journal : les trois événements d’ADR-0024 ont un libellé', () => {
    expect(JOURNAL_EVENT_LABELS.normalization_uncertain).toBe('Réponse de la DGI incertaine');
    expect(JOURNAL_EVENT_LABELS.normalization_review_required).toBe('Vérification nécessaire');
    expect(JOURNAL_EVENT_LABELS.number_abandoned).toMatch(/Numéro abandonné/);
  });
});

describe('normalisation : progression lisible', () => {
  const etats = (v: InvoiceView | null, enCours = false): string[] =>
    etapesNormalisation(v, enCours).map((e) => e.etat);

  it('pendant la requête : rien n’est annoncé fait avant la réponse', () => {
    expect(etats(null, true)).toEqual(['en_cours', 'en_cours', 'en_cours', 'en_cours']);
    // Relance : le gel est acquis, le reste est en cours.
    expect(etapesNormalisation(null, true, true).map((e) => e.etat)).toEqual([
      'fait',
      'en_cours',
      'en_cours',
      'en_cours',
    ]);
    expect(etapesNormalisation(null, true).map((e) => e.libelle)).toEqual([
      'Gel du document et conversion en CDF',
      'Envoi à la DGI',
      'Comparaison des montants',
      'Confirmation par la DGI',
    ]);
  });

  it('après la réponse : déduit de la vue', () => {
    expect(etats(normalisee())).toEqual(['fait', 'fait', 'fait', 'fait']);
    expect(
      etats(
        vue({
          status: 'normalization_failed',
          normalization: normalisation({
            phase: 'failed',
            dgiRequestId: 'u',
            differences: [{ field: 'vab', ours: '1.00', dgi: '1.01' }],
          }),
        }),
      ),
    ).toEqual(['fait', 'fait', 'echec', 'non_fait']);
    expect(
      etats(
        vue({
          status: 'normalization_failed',
          normalization: normalisation({
            phase: 'failed',
            lastError: {
              code: 'C',
              category: 'data',
              message: 'm',
              dgiErrorCode: '12',
              dgiMessage: 'x',
              retryable: false,
            },
          }),
        }),
      ),
    ).toEqual(['fait', 'echec', 'non_fait', 'non_fait']);
    expect(
      etats(
        vue({
          status: 'normalization_failed',
          normalization: normalisation({
            phase: 'failed',
            lastError: {
              code: 'ISF_NOT_CONFIGURED',
              category: 'precondition',
              message: 'm',
              dgiErrorCode: null,
              dgiMessage: null,
              retryable: false,
            },
          }),
        }),
      ),
    ).toEqual(['fait', 'non_fait', 'non_fait', 'non_fait']);
    expect(etats(enAttente({ phase: 'uncertain', dgiRequestId: 'u' }))).toEqual([
      'fait',
      'fait',
      'fait',
      'incertain',
    ]);
    expect(etats(enAttente({ phase: 'uncertain' }))).toEqual([
      'fait',
      'incertain',
      'non_fait',
      'non_fait',
    ]);
    expect(etats(enAttente({ phase: 'queued' }))).toEqual([
      'fait',
      'a_venir',
      'a_venir',
      'a_venir',
    ]);
  });
});

describe('normalisation : relectures bornées dans le temps', () => {
  const t0 = Date.parse('2026-10-19T09:00:00.000Z');

  it('in_progress : toutes les 3 s pendant une minute, puis plus rien', () => {
    const v = enAttente({ phase: 'in_progress' });
    expect(prochaineRelecture(v, t0, t0)).toBe(3_000);
    expect(prochaineRelecture(v, t0, t0 + 59_999)).toBe(3_000);
    expect(prochaineRelecture(v, t0, t0 + 60_000)).toBeNull();
  });

  it('uncertain : toutes les 15 s jusqu’à nextCheckAt + 1 min, puis bouton', () => {
    const v = enAttente({ phase: 'uncertain', nextCheckAt: '2026-10-19T09:02:30.000Z' });
    expect(prochaineRelecture(v, t0, t0)).toBe(15_000);
    expect(prochaineRelecture(v, t0, t0 + 209_999)).toBe(15_000);
    expect(prochaineRelecture(v, t0, t0 + 210_000)).toBeNull();
    // Sans heure annoncée : trois minutes.
    const sans = enAttente({ phase: 'uncertain', nextCheckAt: null });
    expect(prochaineRelecture(sans, t0, t0 + 179_999)).toBe(15_000);
    expect(prochaineRelecture(sans, t0, t0 + 180_000)).toBeNull();
  });

  it('plafond absolu, même si nextCheckAt est lointain', () => {
    const v = enAttente({ phase: 'uncertain', nextCheckAt: '2026-10-20T09:00:00.000Z' });
    expect(prochaineRelecture(v, t0, t0 + RELECTURE.plafondMs - 1)).toBe(15_000);
    expect(prochaineRelecture(v, t0, t0 + RELECTURE.plafondMs)).toBeNull();
  });

  it('aucune relecture pour les phases stables', () => {
    for (const phase of ['queued', 'needs_review'] as const) {
      expect(prochaineRelecture(enAttente({ phase }), t0, t0), phase).toBeNull();
    }
    expect(prochaineRelecture(normalisee(), t0, t0)).toBeNull();
    expect(
      prochaineRelecture(
        vue({ status: 'normalization_failed', normalization: normalisation({ phase: 'failed' }) }),
        t0,
        t0,
      ),
    ).toBeNull();
  });
});

describe('normalisation : jamais de renvoi automatique de « Normaliser »', () => {
  it('erreur réseau, délai ou 5xx → relire le document ; refus 4xx → afficher', () => {
    expect(conduiteApresEchecNormaliser(new TypeError('Failed to fetch'))).toBe('relire');
    expect(conduiteApresEchecNormaliser(erreurApi(502, 'Bad Gateway'))).toBe('relire');
    expect(conduiteApresEchecNormaliser(erreurApi(504, 'Gateway Timeout'))).toBe('relire');
    expect(conduiteApresEchecNormaliser(erreurApi(500, { code: 'INTERNAL' }))).toBe('relire');
    expect(conduiteApresEchecNormaliser(erreurApi(409, { code: 'STALE_REVISION' }))).toBe(
      'afficher',
    );
    expect(conduiteApresEchecNormaliser(erreurApi(422, { code: 'INVOICE_NOT_ISSUABLE' }))).toBe(
      'afficher',
    );
    expect(conduiteApresEchecNormaliser(erreurApi(429, 'x'))).toBe('afficher');
    expect(messageFacture(erreurApi(429, 'x'), 'r')).toMatch(/attendez quelques minutes/);
  });

  it('la fenêtre n’appelle `normalizeInvoice` qu’à un seul endroit, jamais dans un rattrapage d’erreur', () => {
    const ici = fileURLToPath(new URL('.', import.meta.url));
    const code = readFileSync(`${ici}/normalize-dialog.tsx`, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(code.match(/api\.normalizeInvoice\(/g)).toHaveLength(1);
    const apresCatch = code.slice(code.indexOf('catch (err)'));
    expect(apresCatch).not.toMatch(/normalizeInvoice/);
    expect(apresCatch).toMatch(/conduiteApresEchecNormaliser/);
  });

  it('« Mode test » partout où l’environnement est le test', () => {
    const ici = fileURLToPath(new URL('.', import.meta.url));
    for (const f of ['normalize-dialog.tsx', 'normalization-status.tsx', 'invoice-detail.tsx']) {
      expect(readFileSync(`${ici}/${f}`, 'utf8'), f).toMatch(/Mode test/);
    }
  });
});

describe('déclarer « non normalisée »', () => {
  it('motif de 20 à 500 caractères, espaces de bord retirés', () => {
    expect(lireMotifDeclaration('   trop court   ').ok).toBe(false);
    expect(lireMotifDeclaration('a'.repeat(501)).ok).toBe(false);
    expect(lireMotifDeclaration(`  ${'a'.repeat(20)}  `)).toEqual({
      ok: true,
      motif: 'a'.repeat(20),
    });
    expect(lireMotifDeclaration('a'.repeat(500)).ok).toBe(true);
  });
});

describe('échanges DGI du document', () => {
  it('lignes lisibles, ordre conservé, corps rendu tel quel', () => {
    const corps = '{"nif":"A0000000X","rn":"TEST-2026-000012","items":[{"price":1000.10}]}';
    const lignes = lignesEchanges({
      items: [
        {
          at: '2026-10-19T09:00:00.000Z',
          exchangeId: 'e1',
          entry: 'request',
          method: 'POST',
          path: '/api/invoice',
          httpStatus: null,
          durationMs: null,
          outcome: null,
          dgiErrorCode: null,
          body: corps,
        },
        {
          at: '2026-10-19T09:00:00.150Z',
          exchangeId: 'e1',
          entry: 'response',
          method: 'POST',
          path: '/api/invoice',
          httpStatus: 200,
          durationMs: 150,
          outcome: 'business',
          dgiErrorCode: '12',
          body: '{"errorCode":"12"}',
        },
        {
          at: '2026-10-19T09:03:00.000Z',
          exchangeId: 'e2',
          entry: 'complete',
          method: 'GET',
          path: '/api/invoice/uid-1',
          httpStatus: null,
          durationMs: 15000,
          outcome: 'timeout',
          dgiErrorCode: null,
          body: null,
        },
      ],
    });
    expect(lignes.map((l) => [l.sens, l.operation, l.resultat])).toEqual([
      ['Requête envoyée', 'Envoi de la facture', null],
      ['Réponse reçue', 'Envoi de la facture', 'Refus de la DGI'],
      ['Lecture', 'Lecture de la demande', 'Sans réponse (délai dépassé)'],
    ]);
    // Nombres e-DEF jamais reconvertis : « 1000.10 » reste « 1000.10 ».
    expect(lignes[0]!.corps).toBe(corps);
    expect(lignes[1]!.http).toBe('200');
    expect(lignes[1]!.duree).toBe('150 ms');
    expect(lignes[1]!.codeDgi).toBe('12');
    expect(lignes[2]!.corps).toBeNull();
  });

  it('défense en profondeur : aucun jeton ne s’affiche, même si un corps en portait un', () => {
    const avecJeton = corpsLisible('{"token":"eyJhbGciOi.secret","nif":"A0000000X"}')!;
    expect(avecJeton).not.toContain('eyJhbGciOi');
    expect(avecJeton).toContain('[masqué]');
    expect(avecJeton).toContain('A0000000X');
    expect(corpsLisible('Authorization: Bearer abc.def-123')).toBe(
      'Authorization: Bearer [masqué]',
    );
    expect(corpsLisible('texte brut')).toBe('texte brut');
  });
});

describe('badge TEST de la liste (demande de la décideuse)', () => {
  it('marque « TEST » une facture numérotée dans la série de test DGI, et elle seule', async () => {
    const { resumeEnTestDgi, BADGE_TEST_DGI } = await import('./invoice-model');
    expect(BADGE_TEST_DGI).toBe('TEST');
    expect(resumeEnTestDgi({ series: 'test' })).toBe(true);
    expect(resumeEnTestDgi({ series: 'real' })).toBe(false);
    expect(resumeEnTestDgi({ series: null })).toBe(false);
  });
});
