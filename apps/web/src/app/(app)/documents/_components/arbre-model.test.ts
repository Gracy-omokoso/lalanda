// Arbre des dossiers et droits (ADR-0046 § 4.1) : rangement de l'arbre déjà filtré
// par l'API, résumé des droits en français, corps du formulaire de dossier.

import { describe, expect, it } from 'vitest';

import {
  arbreDossiers,
  cheminDossier,
  descendants,
  formulaireDossier,
  optionsDossiers,
  preparerDossier,
  resumeAcces,
} from './arbre-model';
import { dossier } from './fixtures.test-utils';

const liste = [
  dossier({ id: 'jur', name: 'Juridique' }),
  dossier({ id: 'ass', name: 'Assurances', canWrite: true }),
  dossier({ id: 'auto', name: 'Automobile', parentId: 'ass', depth: 2 }),
  // Parent invisible (restreint) : remonte à la racine.
  dossier({ id: 'orph', name: 'Orphelin', parentId: 'secret', depth: 2 }),
  dossier({ id: 'old', name: 'Ancien', status: 'archived' }),
];

describe('arbre', () => {
  it('trié par nom, parent invisible → racine, archivés exclus', () => {
    const arbre = arbreDossiers(liste);
    expect(arbre.map((n) => n.dossier.id)).toEqual(['ass', 'jur', 'orph']);
    expect(arbre[0]!.enfants.map((n) => n.dossier.id)).toEqual(['auto']);
  });

  it('chemin et descendants', () => {
    expect(cheminDossier(liste, 'auto').map((d) => d.name)).toEqual(['Assurances', 'Automobile']);
    expect(cheminDossier(liste, null)).toEqual([]);
    expect([...descendants(liste, 'ass')].sort()).toEqual(['ass', 'auto']);
  });

  it('options indentées, filtrées sur l’écriture', () => {
    expect(optionsDossiers(liste, true)).toEqual([{ id: 'ass', label: 'Assurances' }]);
    expect(optionsDossiers(liste, false).map((o) => o.label)).toContain('  Automobile');
  });
});

describe('droits par dossier', () => {
  const nom = (id: string) => (id === 'u1' ? 'Aline' : 'Bob');
  it('résumé lisible : par nature, restreint', () => {
    expect(
      resumeAcces({ read: { action: 'treasury.read' }, write: 'managers', inherit: true }, nom)
        .lecture,
    ).toBe('ceux qui voient la trésorerie');
    const r = resumeAcces(
      { read: { userIds: ['u1', 'u2'] }, write: { userIds: ['u1'] }, inherit: true },
      nom,
    );
    expect(r.restreint).toBe(true);
    expect(r.lecture).toBe('Aline, Bob (dossier restreint)');
    expect(r.ecriture).toBe('les gestionnaires et Aline');
  });

  it('formulaire : restreint exige une personne ; corps du contrat', () => {
    const f = { ...formulaireDossier(null, 'ass'), name: 'Flotte', lecture: 'users' as const };
    expect(preparerDossier(f).ok).toBe(false);
    expect(preparerDossier({ ...f, lecteurs: ['u1', 'u1'], ecrivains: ['u2'] })).toEqual({
      ok: true,
      corps: {
        name: 'Flotte',
        parentId: 'ass',
        access: { read: { userIds: ['u1'] }, write: { userIds: ['u2'] }, inherit: true },
      },
    });
    const fiscal = preparerDossier({
      ...formulaireDossier(null, ''),
      name: 'Fiscal',
      lecture: 'action',
    });
    expect(fiscal.ok && fiscal.corps.access?.read).toEqual({ action: 'treasury.read' });
    expect(fiscal.ok && fiscal.corps.parentId).toBeNull();
  });
});
