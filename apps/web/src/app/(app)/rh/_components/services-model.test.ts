import { describe, expect, it } from 'vitest';

import type { HrDepartmentView } from '@/lib/api-hr';

import { arbreServices, parentsPossibles, validerService } from './services-model';

const s = (id: string, name: string, parentId: string | null = null): HrDepartmentView => ({
  id,
  name,
  parentId,
  headEmployeeId: null,
  active: true,
  revision: 1,
});

const services = [
  s('v', 'Ventes'),
  s('f', 'Finance'),
  s('c', 'Comptabilité', 'f'),
  s('t', 'Trésorerie', 'f'),
  s('k', 'Caisse', 't'),
];

describe('services', () => {
  it('arbre à plat : parent puis enfants, par nom, avec le niveau', () => {
    expect(arbreServices(services).map((l) => `${l.niveau}:${l.service.name}`)).toEqual([
      '0:Finance',
      '1:Comptabilité',
      '1:Trésorerie',
      '2:Caisse',
      '0:Ventes',
    ]);
  });

  it('un cycle déjà en base ne fait rien disparaître', () => {
    const cycle = [s('a', 'A', 'b'), s('b', 'B', 'a')];
    expect(arbreServices(cycle)).toHaveLength(2);
  });

  it('parents proposés : ni soi, ni ses sous-services', () => {
    expect(parentsPossibles(services, 'f').map((x) => x.id)).toEqual(['v']);
    expect(parentsPossibles(services, null)).toHaveLength(5);
  });

  it('nom requis et borné', () => {
    expect(validerService({ name: ' ', parentId: '', headEmployeeId: '' }).ok).toBe(false);
    expect(validerService({ name: 'x'.repeat(121), parentId: '', headEmployeeId: '' }).ok).toBe(
      false,
    );
    expect(validerService({ name: ' RH ', parentId: 'f', headEmployeeId: '' })).toEqual({
      ok: true,
      corps: { name: 'RH', parentId: 'f', headEmployeeId: null },
    });
  });
});
