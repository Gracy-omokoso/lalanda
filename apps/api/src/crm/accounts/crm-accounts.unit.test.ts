// Comptes CRM — fonctions pures (ADR-0040 § 2.1 et § 2.7). ADR-0040 — C1.
//
// La migration ne dépend pas du code applicatif (README des migrations) : elle
// recopie la normalisation des noms. Ce test vérifie que les deux copies donnent
// le même résultat, sinon un prospect migré et un prospect saisi de même nom ne
// se reconnaîtraient pas.

import { describe, expect, it } from 'vitest';

import { normalizeForSearch, searchKeyOf } from '../../sales/search.js';
import { accountKeys } from './crm-accounts.service.js';

interface MigrationPure {
  normalizeName(v: string): string;
  searchKeyOf(parts: Array<string | null | undefined>): string;
  kinshasaDayOf(at: Date): string;
  groupProspectNames(
    entries: Array<{
      name: string;
      createdAt: Date;
      createdBy?: string | null;
      source: 'contact' | 'opportunity';
    }>,
  ): Map<
    string,
    {
      key: string;
      name: string;
      spellings: Array<{ name: string; count: number }>;
      owner: string | null;
    }
  >;
}

async function migration(): Promise<MigrationPure> {
  const chemin = new URL('../../../migrations/20261030-0001-crm-accounts.mjs', import.meta.url)
    .href;
  return (await import(chemin)) as MigrationPure;
}

const t = (iso: string) => new Date(iso);

describe('normalisation des noms de compte', () => {
  const noms = [
    'ACME Sarl',
    'acme  sarl',
    '  Élevage   du Kasaï ',
    'ÉLEVAGE DU KASAI',
    'Société Générale',
    'O’Brien & Fils',
    '',
  ];

  it('la migration et l’application normalisent à l’identique', async () => {
    const m = await migration();
    for (const n of noms) {
      expect(m.normalizeName(n), n).toBe(normalizeForSearch(n));
      expect(m.searchKeyOf([n, null, 'x@y.cd']), n).toBe(searchKeyOf([n, null, 'x@y.cd']));
    }
  });

  it('clés du compte : tri par nom seul, recherche sur nom, e-mail, site et secteur', () => {
    expect(accountKeys({ name: '  ACME  Sarl ' })).toEqual({
      sortName: 'acme sarl',
      searchKey: 'acme sarl',
    });
    expect(
      accountKeys({ name: 'Acmé', email: 'Contact@Acme.cd', website: null, industry: 'Mines' }),
    ).toEqual({ sortName: 'acme', searchKey: 'acme contact@acme.cd mines' });
  });

  it('jour de Kinshasa (UTC+1)', async () => {
    const m = await migration();
    expect(m.kinshasaDayOf(t('2026-10-29T22:59:59Z'))).toBe('2026-10-29');
    expect(m.kinshasaDayOf(t('2026-10-29T23:30:00Z'))).toBe('2026-10-30');
  });
});

describe('regroupement des prospects à la migration', () => {
  it('nom normalisé EXACT : « ACME Sarl » et « acme  sarl » ensemble, « ACME » et « ACME SA » à part', async () => {
    const m = await migration();
    const groups = m.groupProspectNames([
      { name: 'ACME Sarl', createdAt: t('2026-01-02T00:00:00Z'), source: 'contact' },
      {
        name: 'acme  sarl',
        createdAt: t('2026-01-01T00:00:00Z'),
        source: 'opportunity',
        createdBy: 'u1',
      },
      { name: 'ACME', createdAt: t('2026-01-03T00:00:00Z'), source: 'contact' },
      { name: 'ACME SA', createdAt: t('2026-01-04T00:00:00Z'), source: 'contact' },
    ]);
    expect([...groups.keys()]).toEqual(['acme', 'acme sa', 'acme sarl']);
    expect(groups.get('acme sarl')!.spellings).toHaveLength(2);
    expect(groups.get('acme sarl')!.owner).toBe('u1');
    expect(groups.get('acme')!.owner).toBeNull();
  });

  it('graphie la plus fréquente, puis la plus ancienne ; responsable = créateur de la plus ancienne opportunité', async () => {
    const m = await migration();
    const g = m
      .groupProspectNames([
        { name: 'Kin Bois', createdAt: t('2026-03-01T00:00:00Z'), source: 'contact' },
        {
          name: 'KIN BOIS',
          createdAt: t('2026-02-01T00:00:00Z'),
          source: 'opportunity',
          createdBy: 'b',
        },
        {
          name: 'Kin Bois',
          createdAt: t('2026-04-01T00:00:00Z'),
          source: 'opportunity',
          createdBy: 'c',
        },
        {
          name: 'KIN BOIS',
          createdAt: t('2026-01-15T00:00:00Z'),
          source: 'opportunity',
          createdBy: 'a',
        },
        { name: 'kin bois', createdAt: t('2026-01-01T00:00:00Z'), source: 'contact' },
      ])
      .get('kin bois')!;
    // 2 « Kin Bois » contre 2 « KIN BOIS » : la plus ancienne (« KIN BOIS », 15 janv.) l'emporte.
    expect(g.name).toBe('KIN BOIS');
    expect(g.spellings).toEqual([
      { name: 'KIN BOIS', count: 2 },
      { name: 'Kin Bois', count: 2 },
      { name: 'kin bois', count: 1 },
    ]);
    expect(g.owner).toBe('a');
  });

  it('un nom vide n’est pas une entreprise', async () => {
    const m = await migration();
    expect(
      m.groupProspectNames([
        { name: '   ', createdAt: t('2026-01-01T00:00:00Z'), source: 'contact' },
      ]).size,
    ).toBe(0);
  });
});
