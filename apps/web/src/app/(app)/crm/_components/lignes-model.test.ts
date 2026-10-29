// Lignes d'opportunité — ADR-0040 § 2.3 : saisie relue en chaînes, jamais en nombres.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  formulaireLignes,
  ligneVide,
  lireDecimal,
  messagesAvertissements,
  preparerLignes,
} from './lignes-model';

describe('Lignes d’opportunité', () => {
  it('lit les décimaux à la française, sans conversion', () => {
    expect(lireDecimal('1 234,50', 2)).toEqual({ ok: true, valeur: '1234.5' });
    expect(lireDecimal('007', 3)).toEqual({ ok: true, valeur: '7' });
    expect(lireDecimal('1,2345', 3)).toEqual({ ok: false });
    expect(lireDecimal('-1', 2)).toEqual({ ok: false });
    expect(lireDecimal('', 2)).toEqual({ ok: false });
  });

  it('prépare les lignes : libellé, quantité positive, prix facultatif, remise < 100 %', () => {
    const r = preparerLignes([
      {
        ...ligneVide(),
        label: ' Audit ',
        quantite: '2,5',
        unite: 'jour',
        prix: '150',
        remise: '10',
      },
      { ...ligneVide(), label: 'Sans prix' },
    ]);
    expect(r).toEqual({
      ok: true,
      corps: [
        {
          catalogItemId: null,
          label: 'Audit',
          quantity: '2.5',
          unit: 'jour',
          unitPrice: '150',
          discountPercent: '10',
        },
        {
          catalogItemId: null,
          label: 'Sans prix',
          quantity: '1',
          unit: null,
          unitPrice: null,
          discountPercent: null,
        },
      ],
    });
    const ko = preparerLignes([
      { ...ligneVide(), label: '', quantite: '0', prix: 'abc', remise: '100' },
    ]);
    expect(ko.ok).toBe(false);
    if (ko.ok) return;
    expect(ko.erreurs[0]).toMatch(/libellé obligatoire/);
    expect(ko.erreurs[0]).toMatch(/quantité positive/);
    expect(ko.erreurs[0]).toMatch(/prix invalide/);
    expect(ko.erreurs[0]).toMatch(/remise/);
  });

  it('une ligne du catalogue peut omettre le libellé (recopié par l’API)', () => {
    const r = preparerLignes([{ ...ligneVide(), catalogItemId: 'c1' }]);
    expect(r.ok && r.corps[0]).toMatchObject({ catalogItemId: 'c1', label: null });
  });

  it('relit les lignes de l’API et explique les avertissements', () => {
    expect(
      formulaireLignes([
        {
          catalogItemId: null,
          label: 'A',
          quantity: '1.5',
          unit: null,
          unitPrice: '10.25',
          discountPercent: null,
        },
      ]),
    ).toEqual([
      { catalogItemId: null, label: 'A', quantite: '1,5', unite: '', prix: '10,25', remise: '' },
    ]);
    expect(messagesAvertissements([{ code: 'CRM_LINE_WITHOUT_PRICE', lineIndex: 1 }])).toEqual([
      'Ligne 2 sans prix : elle compte pour zéro dans le montant estimé.',
    ]);
  });

  it('aucun calcul de montant dans la source', () => {
    const src = readFileSync(fileURLToPath(new URL('./lignes-model.ts', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/parseFloat|Number\(|parseInt|toFixed/);
  });
});
