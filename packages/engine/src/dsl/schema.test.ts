import { describe, expect, it } from 'vitest';

import { DuplicateIdError } from './errors.js';
import { TemplateSchema, collectIds, findUnknownWizardGroupes, resolveEtapes } from './schema.js';

const minimal = {
  slug: 'demo',
  version: '1.0.0',
  drivers: [{ id: 'a', type: 'number', defaut: 1 }],
  feuilles: [
    {
      id: 'sheet1',
      lignes: [{ id: 'ligne1', formule: 'a * 2' }],
    },
  ],
};

describe('TemplateSchema', () => {
  it('accepte un template minimal valide', () => {
    const parsed = TemplateSchema.parse(minimal);
    expect(parsed.slug).toBe('demo');
    expect(parsed.drivers).toHaveLength(1);
  });

  it('rejette un slug invalide', () => {
    expect(() => TemplateSchema.parse({ ...minimal, slug: 'Invalid_UPPER' })).toThrow(/slug/);
  });

  it('rejette une version non-semver', () => {
    expect(() => TemplateSchema.parse({ ...minimal, version: '1.0' })).toThrow(/version/);
  });

  it('rejette un template sans drivers', () => {
    expect(() => TemplateSchema.parse({ ...minimal, drivers: [] })).toThrow(/au moins un driver/);
  });

  it('rejette un id de driver invalide', () => {
    expect(() =>
      TemplateSchema.parse({
        ...minimal,
        drivers: [{ id: 'Invalid-ID', type: 'number', defaut: 1 }],
      }),
    ).toThrow(/identifiant invalide/);
  });

  it('rejette une feuille sans lignes', () => {
    expect(() =>
      TemplateSchema.parse({
        ...minimal,
        feuilles: [{ id: 'sheet1', lignes: [] }],
      }),
    ).toThrow(/au moins une ligne/);
  });

  it('rejette une clé inconnue à la racine (strict)', () => {
    expect(() => TemplateSchema.parse({ ...minimal, extra_key: true })).toThrow();
  });
});

describe('collectIds', () => {
  it('collecte tous les ids sans doublon', () => {
    const parsed = TemplateSchema.parse(minimal);
    const ids = collectIds(parsed);
    expect(ids.drivers.has('a')).toBe(true);
    expect(ids.lignes.has('ligne1')).toBe(true);
    expect(ids.feuilles.has('sheet1')).toBe(true);
  });

  it('rejette un id de driver dupliqué', () => {
    const parsed = TemplateSchema.parse({
      ...minimal,
      drivers: [
        { id: 'a', type: 'number', defaut: 1 },
        { id: 'a', type: 'number', defaut: 2 },
      ],
    });
    expect(() => collectIds(parsed)).toThrow(DuplicateIdError);
  });

  it('rejette un id de ligne qui reprend un id de driver', () => {
    const parsed = TemplateSchema.parse({
      ...minimal,
      feuilles: [
        {
          id: 'sheet1',
          lignes: [{ id: 'a', formule: 'a * 2' }], // "a" = déjà un driver
        },
      ],
    });
    expect(() => collectIds(parsed)).toThrow(DuplicateIdError);
  });
});

// ─── Étapes du wizard (S18c) ──────────────────────────────────

/** Template avec deux groupes d'hypothèses — base des tests d'étapes. */
const avecGroupes = {
  ...minimal,
  groupes_hypotheses: [
    { id: 'activite', label: 'Activité' },
    { id: 'financement', label: 'Financement' },
  ],
  drivers: [
    { id: 'a', groupe: 'activite', type: 'number', defaut: 1 },
    { id: 'b', groupe: 'financement', type: 'number', defaut: 2 },
  ],
};

describe('TemplateSchema — etapes', () => {
  it('accepte un template sans bloc wizard (champ optionnel)', () => {
    expect(TemplateSchema.parse(minimal).wizard).toBeUndefined();
  });

  it('accepte des etapes valides', () => {
    const parsed = TemplateSchema.parse({
      ...avecGroupes,
      wizard: {
        etapes: [
          {
            id: 'chiffre_affaires',
            label: "Chiffre d'affaires",
            description: 'Combien vendez-vous ?',
            groupes: ['activite'],
            ordre: 1,
          },
          { id: 'financement', label: 'Financement', groupes: ['financement'], ordre: 2 },
        ],
      },
    });
    expect(parsed.wizard?.etapes).toHaveLength(2);
    expect(parsed.wizard?.etapes[0]?.description).toBe('Combien vendez-vous ?');
  });

  it('rejette un bloc wizard sans aucune etape', () => {
    expect(() => TemplateSchema.parse({ ...avecGroupes, wizard: { etapes: [] } })).toThrow(
      /au moins une étape/,
    );
  });

  it('rejette une clé inconnue dans le bloc wizard (strict)', () => {
    expect(() =>
      TemplateSchema.parse({
        ...avecGroupes,
        wizard: { etapes: [{ id: 'x', label: 'X', groupes: ['activite'] }], theme: 'sombre' },
      }),
    ).toThrow();
  });

  it('rejette une etape sans groupe rattaché', () => {
    expect(() =>
      TemplateSchema.parse({
        ...avecGroupes,
        wizard: { etapes: [{ id: 'vide', label: 'Vide', groupes: [] }] },
      }),
    ).toThrow(/au moins un groupe/);
  });

  it('rejette une etape sans label', () => {
    expect(() =>
      TemplateSchema.parse({
        ...avecGroupes,
        wizard: { etapes: [{ id: 'x', groupes: ['activite'] }] },
      }),
    ).toThrow();
  });

  it("rejette un id d'etape invalide", () => {
    expect(() =>
      TemplateSchema.parse({
        ...avecGroupes,
        wizard: { etapes: [{ id: 'Étape-1', label: 'X', groupes: ['activite'] }] },
      }),
    ).toThrow(/identifiant invalide/);
  });

  it('rejette une clé inconnue dans une etape (strict)', () => {
    expect(() =>
      TemplateSchema.parse({
        ...avecGroupes,
        wizard: { etapes: [{ id: 'x', label: 'X', groupes: ['activite'], couleur: 'rouge' }] },
      }),
    ).toThrow();
  });

  it('rejette un ordre non entier positif', () => {
    expect(() =>
      TemplateSchema.parse({
        ...avecGroupes,
        wizard: { etapes: [{ id: 'x', label: 'X', groupes: ['activite'], ordre: 0 }] },
      }),
    ).toThrow();
  });
});

describe('collectIds — etapes', () => {
  it("collecte les ids d'etapes", () => {
    const parsed = TemplateSchema.parse({
      ...avecGroupes,
      wizard: { etapes: [{ id: 'ca', label: 'CA', groupes: ['activite'] }] },
    });
    expect(collectIds(parsed).etapes.has('ca')).toBe(true);
  });

  it("renvoie un ensemble d'etapes vide sans declaration", () => {
    expect(collectIds(TemplateSchema.parse(minimal)).etapes.size).toBe(0);
  });

  it("rejette un id d'etape dupliqué", () => {
    const parsed = TemplateSchema.parse({
      ...avecGroupes,
      wizard: {
        etapes: [
          { id: 'ca', label: 'CA', groupes: ['activite'] },
          { id: 'ca', label: 'CA bis', groupes: ['financement'] },
        ],
      },
    });
    expect(() => collectIds(parsed)).toThrow(DuplicateIdError);
  });

  it("n'échoue PAS sur une etape qui référence un groupe inconnu", () => {
    // ADR-0011 Contrat 3 : une clé de présentation ne doit jamais empêcher un
    // template de parser. Un renommage de groupe côté structure financière ne peut
    // donc pas faire tomber le moteur — l'étape est simplement ignorée.
    const parsed = TemplateSchema.parse({
      ...avecGroupes,
      wizard: { etapes: [{ id: 'ca', label: 'CA', groupes: ['inexistant'] }] },
    });
    expect(() => collectIds(parsed)).not.toThrow();
    expect(collectIds(parsed).etapes.has('ca')).toBe(true);
  });
});

describe('findUnknownWizardGroupes', () => {
  it('ne signale rien quand tous les groupes existent', () => {
    const parsed = TemplateSchema.parse({
      ...avecGroupes,
      wizard: { etapes: [{ id: 'ca', label: 'CA', groupes: ['activite'] }] },
    });
    expect(
      findUnknownWizardGroupes(parsed.groupes_hypotheses ?? [], parsed.wizard?.etapes ?? []),
    ).toEqual([]);
  });

  it('signale un groupe inconnu pour le lint des templates livrés', () => {
    const parsed = TemplateSchema.parse({
      ...avecGroupes,
      wizard: {
        etapes: [{ id: 'ca', label: 'CA', groupes: ['activite', 'disparu'] }],
      },
    });
    expect(
      findUnknownWizardGroupes(parsed.groupes_hypotheses ?? [], parsed.wizard?.etapes ?? []),
    ).toEqual([{ etapeId: 'ca', groupeId: 'disparu' }]);
  });
});

describe('resolveEtapes', () => {
  it("ignore un groupe inconnu et conserve les groupes valides de l'étape", () => {
    const resolved = resolveEtapes(
      TemplateSchema.parse({
        ...avecGroupes,
        wizard: {
          etapes: [{ id: 'ca', label: 'CA', groupes: ['activite', 'disparu'], ordre: 1 }],
        },
      }),
    );
    expect(resolved[0]?.groupes).toEqual(['activite']);
  });

  it('écarte une étape dont tous les groupes ont disparu, sans perdre les autres', () => {
    const resolved = resolveEtapes(
      TemplateSchema.parse({
        ...avecGroupes,
        wizard: {
          etapes: [
            { id: 'fantome', label: 'Fantôme', groupes: ['disparu'], ordre: 1 },
            { id: 'ca', label: 'CA', groupes: ['activite'], ordre: 2 },
          ],
        },
      }),
    );
    // L'étape fantôme disparaît ; `financement`, non rattaché, revient en fin de liste.
    expect(resolved.map((e) => e.id)).toEqual(['ca', 'financement']);
  });

  it('retombe sur le fallback groupes quand toutes les étapes sont écartées', () => {
    const resolved = resolveEtapes(
      TemplateSchema.parse({
        ...avecGroupes,
        wizard: { etapes: [{ id: 'fantome', label: 'Fantôme', groupes: ['disparu'] }] },
      }),
    );
    expect(resolved.map((e) => e.id)).toEqual(['activite', 'financement']);
  });

  it("fallback : une etape par groupe d'hypothèses quand etapes est absent", () => {
    const resolved = resolveEtapes(TemplateSchema.parse(avecGroupes));
    expect(resolved).toEqual([
      { id: 'activite', label: 'Activité', groupes: ['activite'] },
      { id: 'financement', label: 'Financement', groupes: ['financement'] },
    ]);
  });

  it("fallback : une etape unique quand il n'y a ni etapes ni groupes", () => {
    const resolved = resolveEtapes(TemplateSchema.parse(minimal));
    expect(resolved).toEqual([{ id: 'hypotheses', label: 'Hypothèses', groupes: ['_all'] }]);
  });

  it('trie les etapes déclarées par `ordre` croissant', () => {
    const resolved = resolveEtapes(
      TemplateSchema.parse({
        ...avecGroupes,
        wizard: {
          etapes: [
            { id: 'fin', label: 'Financement', groupes: ['financement'], ordre: 2 },
            { id: 'ca', label: 'CA', groupes: ['activite'], ordre: 1 },
          ],
        },
      }),
    );
    expect(resolved.map((e) => e.id)).toEqual(['ca', 'fin']);
  });

  it("conserve l'ordre de déclaration et place les etapes sans `ordre` en dernier", () => {
    const resolved = resolveEtapes(
      TemplateSchema.parse({
        ...avecGroupes,
        wizard: {
          etapes: [
            { id: 'sans', label: 'Sans ordre', groupes: ['financement'] },
            { id: 'avec', label: 'Avec ordre', groupes: ['activite'], ordre: 5 },
          ],
        },
      }),
    );
    expect(resolved.map((e) => e.id)).toEqual(['avec', 'sans']);
  });

  it('ajoute en fin de liste les groupes non rattachés à une etape', () => {
    // Résilience : un groupe ajouté au template sans mise à jour de `etapes`
    // reste saisissable au lieu de disparaître du wizard.
    const resolved = resolveEtapes(
      TemplateSchema.parse({
        ...avecGroupes,
        wizard: { etapes: [{ id: 'ca', label: 'CA', groupes: ['activite'], ordre: 1 }] },
      }),
    );
    expect(resolved.map((e) => e.id)).toEqual(['ca', 'financement']);
    expect(resolved[1]?.groupes).toEqual(['financement']);
  });

  it('accepte plusieurs groupes rattachés à une même etape', () => {
    const resolved = resolveEtapes(
      TemplateSchema.parse({
        ...avecGroupes,
        wizard: { etapes: [{ id: 'tout', label: 'Tout', groupes: ['activite', 'financement'] }] },
      }),
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.groupes).toEqual(['activite', 'financement']);
  });

  it("omet `description` quand elle n'est pas déclarée", () => {
    const resolved = resolveEtapes(
      TemplateSchema.parse({
        ...avecGroupes,
        wizard: { etapes: [{ id: 'ca', label: 'CA', groupes: ['activite', 'financement'] }] },
      }),
    );
    expect(resolved[0]).not.toHaveProperty('description');
  });
});
