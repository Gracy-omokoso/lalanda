// Comptes et fiche 360° — ADR-0040 § 3.1 et § 8.2 : une section masquée se dit
// par une phrase, jamais par un zéro ; montants par devise recopiés de l'API.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { CrmAccountView, CrmTimelineEvent } from '@lalanda/shared/crm';
import { describe, expect, it } from 'vitest';

import { formatMontant } from '../../ventes/_components/sales-model';

import {
  FILTRES_COMPTES_INITIAUX,
  LIBELLES_EVENEMENT,
  PHRASE_SECTION_MASQUEE_VENTES,
  ciblesFusion,
  ficheExistante,
  formulaireCompte,
  fusionPossible,
  fusionnerFil,
  libelleNature,
  libelleReglement,
  lienEvenement,
  montantsParDevise,
  phraseSection,
  phraseSourcesMasquees,
  preparerCompte,
  requeteComptes,
} from './comptes-model';

const COMPTE: CrmAccountView = {
  id: 'a1',
  kind: 'prospect',
  customerId: null,
  name: 'Awa SARL',
  ownerId: 'u1',
  industry: null,
  origin: 'Salon',
  website: null,
  phone: null,
  email: null,
  address: null,
  notes: null,
  active: true,
  conversion: null,
  mergedInto: null,
  revision: 3,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

const evt = (id: string): CrmTimelineEvent => ({
  id,
  type: 'quote.sent',
  source: 'quote',
  at: '2026-10-20T10:00:00.000Z',
  refId: 'q1',
  title: 'Devis D-1',
  by: null,
  details: {},
});

describe('Comptes — liste', () => {
  it('requête : nature, recherche, archivés, curseur', () => {
    expect(requeteComptes(FILTRES_COMPTES_INITIAUX)).toEqual({ active: 'true', limit: 50 });
    expect(requeteComptes({ nature: 'prospect', q: ' awa ', archives: true }, 'c2')).toEqual({
      kind: 'prospect',
      q: 'awa',
      active: 'false',
      limit: 50,
      cursor: 'c2',
    });
    expect(libelleNature('customer')).toBe('Client');
    expect(libelleNature('prospect')).toBe('Prospect');
  });
});

describe('Fiche 360° — sections', () => {
  it('section masquée : la phrase, jamais un zéro ; vide : sa phrase ; connue : rien', () => {
    expect(phraseSection({ status: 'hidden' }, PHRASE_SECTION_MASQUEE_VENTES, 'Aucun.')).toBe(
      'Réservé aux rôles qui consultent les ventes.',
    );
    expect(phraseSection({ status: 'empty' }, PHRASE_SECTION_MASQUEE_VENTES, 'Aucun.')).toBe(
      'Aucun.',
    );
    expect(phraseSection({ status: 'known' }, PHRASE_SECTION_MASQUEE_VENTES, 'Aucun.')).toBeNull();
    expect(PHRASE_SECTION_MASQUEE_VENTES).not.toMatch(/\d/);
  });

  it('montants par devise recopiés, jamais additionnés', () => {
    expect(
      montantsParDevise([
        { currency: 'CDF', total: '1000.00' },
        { currency: 'USD', total: '20.50' },
      ]),
    ).toEqual([formatMontant('1000.00', 'CDF'), formatMontant('20.50', 'USD')]);
    expect(libelleReglement('partially_paid')).toBe('Partiellement payée');
    expect(libelleReglement('inconnu')).toBe('inconnu');
  });
});

describe('Fiche 360° — fil chronologique', () => {
  it('libellés, liens, sources masquées, pages sans doublon', () => {
    expect(LIBELLES_EVENEMENT['account.converted']).toBe('Prospect devenu client');
    expect(lienEvenement({ source: 'quote', refId: 'q1' })).toBe('/ventes/devis/q1');
    expect(lienEvenement({ source: 'opportunity', refId: 'o/1' })).toBe('/crm/opportunites/o%2F1');
    expect(lienEvenement({ source: 'activity', refId: 'x' })).toBe('/crm/activites?activite=x');
    expect(lienEvenement({ source: 'account', refId: 'a1' })).toBeNull();
    expect(phraseSourcesMasquees([])).toBeNull();
    expect(phraseSourcesMasquees(['quote', 'invoice'])).toMatch(/devis, factures/);
    expect(fusionnerFil([evt('1'), evt('2')], [evt('2'), evt('3')]).map((e) => e.id)).toEqual([
      '1',
      '2',
      '3',
    ]);
  });
});

describe('Comptes — écriture, fusion, conversion', () => {
  it('un compte client ne renvoie pas son nom (la fiche client fait foi)', () => {
    const f = { ...formulaireCompte(COMPTE), ownerId: '' };
    expect(preparerCompte(f)).toMatchObject({
      ok: true,
      corps: { name: 'Awa SARL', origin: 'Salon' },
    });
    const client = preparerCompte(f, 'customer');
    expect(client.ok && 'name' in client.corps).toBe(false);
    expect(preparerCompte({ ...f, name: ' ' }).ok).toBe(false);
    expect(preparerCompte({ ...f, ownerId: 'u2' })).toMatchObject({ corps: { ownerId: 'u2' } });
  });

  it('fusion : un prospect seulement, vers un autre compte actif non fusionné', () => {
    expect(fusionPossible(COMPTE)).toBe(true);
    expect(fusionPossible({ kind: 'customer', mergedInto: null })).toBe(false);
    expect(fusionPossible({ kind: 'prospect', mergedInto: 'x' })).toBe(false);
    const autres = [
      { id: 'a1', active: true, mergedInto: null },
      { id: 'a2', active: true, mergedInto: null },
      { id: 'a3', active: false, mergedInto: null },
      { id: 'a4', active: true, mergedInto: 'a2' },
    ];
    expect(ciblesFusion(COMPTE, autres).map((c) => c.id)).toEqual(['a2']);
  });

  it('NIF déjà connu : propose la fiche existante', () => {
    expect(
      ficheExistante({
        status: 409,
        detail: { code: 'CUSTOMER_NIF_EXISTS', details: { existingId: 'c9' } },
      }),
    ).toBe('c9');
    expect(ficheExistante({ status: 409, detail: { code: 'AUTRE' } })).toBeNull();
    expect(ficheExistante(null)).toBeNull();
  });

  it('aucun calcul de montant dans la source', () => {
    const src = readFileSync(fileURLToPath(new URL('./comptes-model.ts', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/parseFloat|Number\(|parseInt|toFixed/);
  });
});
