import { describe, expect, it } from 'vitest';

import { commande } from './fixtures.test-utils';
import { ligneValidation } from './validations-model';

describe('ligneValidation', () => {
  it('montant TTC du moteur, demandeur nommé, progression', () => {
    const l = ligneValidation(commande(), [{ userId: 'u-demandeur', name: 'Awa' }], 'u-dir');
    expect(l).toMatchObject({
      numero: 'DA2610-000001',
      fournisseur: 'Socimex',
      montant: '800,00 USD',
      demandeur: 'Awa',
      progression: '0 approbation sur 1 requise',
      propreDemande: false,
    });
  });
  it('sa propre demande (approbateur unique) est signalée', () => {
    const l = ligneValidation(commande({ requestedBy: 'u-dir' }), [], 'u-dir');
    expect(l.propreDemande).toBe(true);
    expect(l.demandeur).toBe('vous');
  });
  it('sans fournisseur choisi', () => {
    expect(ligneValidation(commande({ supplierName: null }), [], null).fournisseur).toMatch(
      /non choisi/,
    );
  });
});
