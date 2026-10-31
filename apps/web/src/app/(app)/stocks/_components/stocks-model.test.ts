// Règles communes des stocks (ADR-0046 § 5, § 8) : droits par actions, valeurs
// masquées au Magasinier, mise en forme sans calcul, messages d'erreur.

import { describe, expect, it } from 'vitest';

import { COMMERCIAL, COMPTABLE, MAGASINIER, PROPRIETAIRE } from './fixtures.test-utils';
import {
  constatsVisibles,
  estEnRupture,
  estNegatif,
  estNul,
  formatCoutUnitaire,
  formatQuantite,
  formatQuantiteSignee,
  formatValeur,
  jourKinshasa,
  lireCoutSaisi,
  lireQuantiteSaisie,
  messageStocks,
  peutVoirValeurs,
  phraseIndisponible,
  quantitePourSaisie,
  valeursAffichees,
  PHRASE_PAS_ENCORE,
} from './stocks-model';

describe('valeurs (ADR-0046 § 5)', () => {
  it('visibles avec stock.read et purchase.read ou treasury.read', () => {
    expect(peutVoirValeurs(PROPRIETAIRE)).toBe(true);
    expect(peutVoirValeurs(COMPTABLE)).toBe(true);
    expect(peutVoirValeurs(['stock.read', 'treasury.read'])).toBe(true);
  });

  it('le Magasinier et le Commercial ne voient aucune valeur', () => {
    expect(peutVoirValeurs(MAGASINIER)).toBe(false);
    expect(peutVoirValeurs(COMMERCIAL)).toBe(false);
    expect(peutVoirValeurs(null)).toBe(false);
    expect(peutVoirValeurs(['purchase.read'])).toBe(false);
  });

  it('une réponse qui masque les valeurs l’emporte ; un rôle sans droit aussi', () => {
    expect(valeursAffichees(PROPRIETAIRE, true)).toBe(false);
    expect(valeursAffichees(PROPRIETAIRE, false)).toBe(true);
    expect(valeursAffichees(PROPRIETAIRE, undefined)).toBe(true);
    expect(valeursAffichees(MAGASINIER, false)).toBe(false);
  });

  it('constats de valeur retirés quand les valeurs sont masquées', () => {
    const c = [
      { code: 'NEGATIVE_STOCK' },
      { code: 'UNVALUED_ENTRIES' },
      { code: 'ENTRY_COST_DIFFERS_FROM_INVOICE' },
    ];
    expect(constatsVisibles(c, false).map((x) => x.code)).toEqual(['NEGATIVE_STOCK']);
    expect(constatsVisibles(c, true)).toHaveLength(3);
    expect(constatsVisibles(undefined, true)).toEqual([]);
  });
});

describe('mise en forme (aucun calcul)', () => {
  it('quantités : groupes de milliers, virgule, zéros de fin retirés, unité', () => {
    expect(formatQuantite('1234.500', 'kg')).toBe('1 234,5 kg');
    expect(formatQuantite('12.000')).toBe('12');
    expect(formatQuantite('-3.250')).toBe('−3,25');
    expect(formatQuantite('-0.000')).toBe('0');
    expect(formatQuantite(null)).toBe('—');
    expect(formatQuantite('abc')).toBe('abc');
  });

  it('quantités signées des mouvements', () => {
    expect(formatQuantiteSignee('72.000', 'pièce')).toBe('+72 pièce');
    expect(formatQuantiteSignee('-5')).toBe('−5');
  });

  it('valeurs et coûts unitaires, par devise', () => {
    expect(formatValeur('37.5', 'USD')).toBe('37,50 USD');
    expect(formatValeur('-1234.50', 'CDF')).toBe('−1 234,50 CDF');
    expect(formatValeur(null, 'USD')).toBe('—');
    expect(formatCoutUnitaire('2.875000', 'USD')).toBe('2,875 USD');
    expect(formatCoutUnitaire('1.000000', 'USD')).toBe('1,00 USD');
  });

  it('signe lu sur la chaîne : rupture = nulle ou négative', () => {
    expect(estNul('0.000')).toBe(true);
    expect(estNegatif('-0.001')).toBe(true);
    expect(estNegatif('-0.000')).toBe(false);
    expect(estEnRupture('0')).toBe(true);
    expect(estEnRupture('-2')).toBe(true);
    expect(estEnRupture('0.5')).toBe(false);
  });

  it('quantité de l’API → texte à éditer', () => {
    expect(quantitePourSaisie('16.000')).toBe('16');
    expect(quantitePourSaisie('1234.5')).toBe('1234,5');
    expect(quantitePourSaisie(null)).toBe('');
  });

  it('jour de Kinshasa (UTC+1)', () => {
    expect(jourKinshasa(new Date('2026-10-31T23:30:00Z'))).toBe('2026-11-01');
  });
});

describe('saisie → forme du contrat', () => {
  it('quantité : virgule, espaces, trois décimales, zéro selon le cas', () => {
    expect(lireQuantiteSaisie('2,5')).toEqual({ ok: true, valeur: '2.5' });
    expect(lireQuantiteSaisie('1 200')).toEqual({ ok: true, valeur: '1200' });
    expect(lireQuantiteSaisie('0').ok).toBe(false);
    expect(lireQuantiteSaisie('0', true)).toEqual({ ok: true, valeur: '0' });
    expect(lireQuantiteSaisie('1.2345').ok).toBe(false);
    expect(lireQuantiteSaisie('-1').ok).toBe(false);
    expect(lireQuantiteSaisie('').ok).toBe(false);
  });

  it('coût : six décimales au plus', () => {
    expect(lireCoutSaisi('1,123456')).toEqual({ ok: true, valeur: '1.123456' });
    expect(lireCoutSaisi('1.1234567').ok).toBe(false);
  });
});

describe('erreurs', () => {
  const err = (status: number, code?: string) => ({ status, detail: code ? { code } : {} });

  it('codes métier en français clair', () => {
    expect(messageStocks(err(409, 'STOCK_INSUFFICIENT'), 'x')).toMatch(/Stock insuffisant/);
    expect(messageStocks(err(409, 'COUNT_SELF_VALIDATION'), 'x')).toMatch(/séparation des tâches/);
  });

  it('une route absente dit une phrase, jamais une donnée', () => {
    expect(messageStocks(err(404), 'x')).toBe(PHRASE_PAS_ENCORE);
    expect(phraseIndisponible(err(404))).toBe('Pas encore disponible');
    expect(phraseIndisponible(err(403))).toBe('Réservé à d’autres rôles');
    expect(phraseIndisponible(new Error('réseau'))).toBe('Lecture impossible pour le moment');
  });
});
