// Espace Croissance (ADR-0032) — logique pure de l'interface.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { GrowIndicator } from '@/lib/grow-api';

import {
  appreciation,
  droitsCroissance,
  GROUPES_INDICATEURS,
  GROW_TABS,
  lireMontant,
  messageErreur,
  refusForfait,
  segmentCroissance,
  valeurIndicateur,
} from './grow-model';

const ind = (p: Partial<GrowIndicator> & Pick<GrowIndicator, 'disponible'>): GrowIndicator =>
  ({
    code: 'burn_rate',
    libelle: 'x',
    sources: [],
    hypotheses: [],
    ...(p.disponible
      ? {
          valeur: 0,
          unite: 'montant',
          devise: null,
          periode: { libelle: '', mois: [] },
          methode: '',
        }
      : { raison: 'X', message: 'x' }),
    ...p,
  }) as GrowIndicator;

describe('navigation', () => {
  it('trois onglets, segment courant sur frontière de segment', () => {
    expect(GROW_TABS.map((t) => t.segment)).toEqual(['sante', 'investisseurs', 'parcours']);
    expect(segmentCroissance('/croissance/parcours')).toBe('parcours');
    expect(segmentCroissance('/croissance')).toBe('');
    expect(segmentCroissance('/croissance-externe')).toBe('');
  });

  it('chaque indicateur de l’API figure dans exactement un groupe', () => {
    const codes = GROUPES_INDICATEURS.flatMap((g) => g.codes);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toHaveLength(10);
  });

  it('droits affichés : déclarer (inputs.update), déclarer un solde (actuals.import)', () => {
    expect(droitsCroissance(null)).toEqual({ declarer: false, declarerTresorerie: false });
    expect(droitsCroissance(['analytics.read'])).toEqual({
      declarer: false,
      declarerTresorerie: false,
    });
    expect(droitsCroissance(['inputs.update', 'actuals.import'])).toEqual({
      declarer: true,
      declarerTresorerie: true,
    });
  });
});

describe('mise en forme', () => {
  it('valeurs selon l’unité ; indisponible → tiret, jamais zéro', () => {
    expect(valeurIndicateur(ind({ disponible: true, valeur: 0.125, unite: 'ratio' }))).toBe(
      '12,5 %',
    );
    expect(valeurIndicateur(ind({ disponible: true, valeur: 6, unite: 'mois' }))).toBe('6 mois');
    expect(
      valeurIndicateur(ind({ disponible: true, valeur: 1200.5, unite: 'montant', devise: 'USD' })),
    ).toBe('1 200,5 USD');
    expect(valeurIndicateur(ind({ disponible: false }))).toBe('—');
  });

  it('appréciation écrite de la note', () => {
    expect(appreciation(80)).toEqual({ texte: 'Solide', ton: 'ok' });
    expect(appreciation(40).texte).toBe('À surveiller');
    expect(appreciation(39).texte).toBe('Fragile');
  });
});

describe('erreurs', () => {
  it('reconnaît le refus de forfait et en garde le message', () => {
    const err = {
      status: 403,
      detail: { code: 'PLAN_FEATURE_UNAVAILABLE', message: 'Non inclus dans Free.' },
    };
    expect(refusForfait(err)).toBe('Non inclus dans Free.');
    expect(refusForfait({ status: 403, detail: { code: 'FORBIDDEN' } })).toBeNull();
    expect(messageErreur({ status: 403, detail: {} }, 'x')).toMatch(/rôle/);
    expect(
      messageErreur(
        { status: 400, detail: { details: { issues: [{ message: 'Date AAAA-MM-JJ.' }] } } },
        'x',
      ),
    ).toBe('Date AAAA-MM-JJ.');
  });
});

describe('lireMontant — forme seulement, sans calcul', () => {
  it('accepte virgule et espaces, rend une chaîne à deux décimales', () => {
    expect(lireMontant('1 250,5')).toEqual({ ok: true, valeur: '1250.50' });
    expect(lireMontant('0012')).toEqual({ ok: true, valeur: '12.00' });
    expect(lireMontant('0')).toEqual({ ok: true, valeur: '0.00' });
  });
  it('refuse négatif, trop de décimales, texte', () => {
    for (const s of ['-5', '1.234', 'abc', '']) expect(lireMontant(s).ok).toBe(false);
  });
  it('le module ne convertit aucun montant en nombre', () => {
    const src = readFileSync(new URL('./grow-model.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/\bNumber\(|parseFloat|parseInt/);
  });
});
