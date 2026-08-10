// Régression de production : les registres de templates et de packs résolvaient
// leurs YAML par `resolve(__dirname, '../../../../packages/engine/src/…')`, ce
// qui suppose de tourner dans l'arborescence du dépôt.
//
// Dans l'image, le code s'exécute depuis `/app/dist/…` : la remontée aboutissait
// à `/packages/engine/src/…`, inexistant. Toutes les routes de templates et de
// packs répondaient 500 — donc AUCUN projet ne pouvait être créé, alors que les
// fichiers étaient bien présents dans `node_modules/@lalanda/engine/src/`.
//
// Ces tests vérifient que les actifs sont RÉELLEMENT lisibles, et non qu'une
// chaîne a la forme attendue : c'est la lecture qui échouait, pas le calcul.

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ENGINE_SRC, engineAsset } from './engine-assets.js';
import {
  getParameterPack,
  listParameterPackSummaries,
} from './parameter-packs/parameter-pack-registry.js';
import { getTemplate, listTemplateSlugs } from './evaluate/template-registry.js';

describe('résolution des actifs du moteur', () => {
  it('trouve la racine src/ du moteur', () => {
    expect(existsSync(ENGINE_SRC)).toBe(true);
  });

  it('rend un chemin réellement lisible pour un pack de paramètres', () => {
    const chemin = engineAsset('parameter-packs/cd-2026.yaml');
    expect(existsSync(chemin)).toBe(true);
    expect(readFileSync(chemin, 'utf8').length).toBeGreaterThan(0);
  });
});

describe('registres — les routes qui répondaient 500 en production', () => {
  it('liste les packs de paramètres sans lever', () => {
    const packs = listParameterPackSummaries();
    expect(packs.length).toBeGreaterThan(0);
    expect(getParameterPack('cd-2026')).toBeDefined();
  });

  it('liste les templates sans lever', () => {
    const slugs = listTemplateSlugs();
    expect(slugs.length).toBeGreaterThan(0);
    expect(getTemplate('hello-world')).toBeDefined();
  });
});
