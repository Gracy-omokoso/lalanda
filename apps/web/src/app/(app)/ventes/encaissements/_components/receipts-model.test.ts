// Logique de l'onglet Encaissements et de la pastille de règlement (ADR-0031).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { ActualsSyncReport, InvoiceSummary, SettlementView } from '@/lib/api';

import {
  ajouterFacture,
  aujourdhuiKinshasa,
  facturesAReglement,
  formatMontantSigne,
  formulaireVide,
  libelleJour,
  libelleMois,
  messageEncaissement,
  pastilleReglement,
  preparerEncaissement,
  RECEIPT_METHODS,
  syncDemandeAttention,
} from './receipts-model';

const NBSP = ' ';

const vue = (over: Partial<SettlementView> = {}): SettlementView => ({
  invoiceId: 'f1',
  number: 'IN2610-000001',
  type: 'FV',
  currency: 'USD',
  customerName: 'Client SARL',
  issuedOn: '2026-10-21',
  total: '92.80',
  dueDate: null,
  status: 'partially_paid',
  reason: null,
  settlement: {
    status: 'partially_paid',
    overdue: false,
    due: '92.80',
    credited: '0.00',
    received: '40.00',
    outstanding: '52.80',
    creditBalance: '0.00',
    version: '1.0.0',
  },
  asOf: '2026-10-21',
  ...over,
});

describe('pastille de règlement', () => {
  it('libellés des quatre statuts ; en retard attire l’attention', () => {
    expect(pastilleReglement(vue())).toEqual({ label: 'Partiellement payée', ton: 'neutre' });
    expect(pastilleReglement(vue({ status: 'paid' }))?.label).toBe('Payée');
    expect(pastilleReglement(vue({ status: 'unpaid' }))?.label).toBe('Non payée');
    expect(pastilleReglement(vue({ status: 'overdue' }))).toEqual({
      label: 'En retard',
      ton: 'attention',
    });
  });

  it('aucune pastille sans règlement (avoir, brouillon) ni sans réponse', () => {
    expect(pastilleReglement(vue({ status: 'not_applicable', settlement: null }))).toBeNull();
    expect(pastilleReglement(undefined)).toBeNull();
  });

  it('seules les factures définitives hors avoirs sont interrogées', () => {
    const d = (id: string, status: string, type: string) =>
      ({ id, status, type }) as unknown as InvoiceSummary;
    expect(
      facturesAReglement([
        d('a', 'issued', 'FV'),
        d('b', 'normalized', 'EV'),
        d('c', 'draft', 'FV'),
        d('d', 'issued', 'FA'),
        d('e', 'pending_normalization', 'FV'),
        d('f', 'normalized', 'FT'),
      ]),
    ).toEqual(['a', 'b', 'f']);
  });
});

describe('formulaire d’encaissement', () => {
  it('une facture : le montant reçu est le montant imputé, prérempli du reste', () => {
    const f = ajouterFacture(formulaireVide('2026-10-21'), vue());
    expect(f.lignes).toEqual([
      { invoiceId: 'f1', libelle: 'IN2610-000001 · Client SARL', montant: '52,80' },
    ]);
    const prep = preparerEncaissement({ ...f, method: 'MOBILEMONEY', reference: ' TX-1 ' });
    expect(prep).toEqual({
      ok: true,
      body: {
        receivedOn: '2026-10-21',
        amount: '52.80',
        currency: 'USD',
        method: 'MOBILEMONEY',
        reference: 'TX-1',
        note: null,
        allocations: [{ invoiceId: 'f1', amount: '52.80' }],
      },
    });
  });

  it('plusieurs factures : montant reçu saisi, jamais additionné ici', () => {
    let f = ajouterFacture(formulaireVide('2026-10-21'), vue());
    f = ajouterFacture(f, vue({ invoiceId: 'f2', number: 'IN2610-000002' }));
    const sansTotal = preparerEncaissement({ ...f, method: 'VIREMENT' });
    expect(sansTotal.ok).toBe(false);
    if (!sansTotal.ok) expect(sansTotal.erreurs.total).toBe('Saisissez un montant.');
    const prep = preparerEncaissement({ ...f, method: 'VIREMENT', total: '105,60' });
    expect(prep.ok && prep.body.amount).toBe('105.60');
  });

  it('pas de mélange de devises ni de doublon', () => {
    const f = ajouterFacture(formulaireVide('2026-10-21'), vue());
    expect(ajouterFacture(f, vue())).toBe(f);
    expect(ajouterFacture(f, vue({ invoiceId: 'c', currency: 'CDF' }))).toBe(f);
  });

  it('erreurs de forme : moyen, facture, montant', () => {
    const prep = preparerEncaissement(formulaireVide('2026-10-21'));
    expect(prep.ok).toBe(false);
    if (!prep.ok) {
      expect(prep.erreurs.method).toBeDefined();
      expect(prep.erreurs.lignes).toBeDefined();
    }
    const f = ajouterFacture(formulaireVide('2026-10-21'), vue());
    const mauvais = preparerEncaissement({
      ...f,
      method: 'ESPECES',
      lignes: [{ ...f.lignes[0]!, montant: '1,234' }],
    });
    expect(!mauvais.ok && mauvais.erreurs['ligne.0']).toBe('Deux décimales au plus.');
  });

  it('les six moyens excluent « à crédit »', () => {
    expect(RECEIPT_METHODS.map((m) => m.valeur).sort()).toEqual(
      ['AUTRE', 'CARTEBANCAIRE', 'CHEQUES', 'ESPECES', 'MOBILEMONEY', 'VIREMENT'].sort(),
    );
  });

  it('refus du moteur : ses messages, tels quels', () => {
    const err = Object.assign(new Error('Encaissement refusé'), {
      status: 422,
      detail: {
        code: 'RECEIPT_INVALID',
        details: { issues: [{ code: 'RECEIPT_ALLOCATION_EXCEEDS_BALANCE', message: 'Trop.' }] },
      },
    });
    expect(messageEncaissement(err, 'repli')).toBe('Trop.');
  });
});

describe('dates et montants', () => {
  it('libellés de mois et de jour', () => {
    expect(libelleMois('2026-10')).toBe('oct. 2026');
    expect(libelleMois('n/a')).toBe('n/a');
    expect(libelleJour('2026-02-05')).toBe('5 févr. 2026');
    expect(libelleJour(null)).toBe('—');
  });

  it('jour de Kinshasa (UTC+1)', () => {
    expect(aujourdhuiKinshasa(new Date('2026-10-21T23:30:00Z'))).toBe('2026-10-22');
    expect(aujourdhuiKinshasa(new Date('2026-10-21T22:59:00Z'))).toBe('2026-10-21');
  });

  it('montant signé du moteur, par manipulation de chaîne', () => {
    expect(formatMontantSigne('-40.00', 'USD')).toBe(`−40,00${NBSP}USD`);
    expect(formatMontantSigne('80.00', 'USD')).toBe(`80,00${NBSP}USD`);
    expect(formatMontantSigne(null, 'USD')).toBe('—');
  });

  it('une synchronisation bloquée ou incomplète demande l’attention', () => {
    const r = (blocked: number, skipped: number) =>
      ({ counts: { written: 0, unchanged: 0, removed: 0, blocked, skipped } }) as ActualsSyncReport;
    expect(syncDemandeAttention(r(0, 0))).toBe(false);
    expect(syncDemandeAttention(r(1, 0))).toBe(true);
    expect(syncDemandeAttention(r(0, 1))).toBe(true);
  });
});

describe('lecture des sources : aucun calcul de montant dans l’interface', () => {
  for (const fichier of [
    './receipts-model.ts',
    './receipts-workspace.tsx',
    './bridge-panel.tsx',
    '../../factures/_components/invoice-list.tsx',
  ]) {
    it(fichier, () => {
      const code = readFileSync(fileURLToPath(new URL(fichier, import.meta.url)), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(code).not.toMatch(/\bNumber\s*\(|\bparseFloat\b|\bparseInt\b|\.toFixed\s*\(|\bMath\./);
    });
  }
});
