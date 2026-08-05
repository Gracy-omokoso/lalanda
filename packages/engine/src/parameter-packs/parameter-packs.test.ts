// Tests des ParameterPacks : parsing YAML, précédence à l'évaluation, aplatissement.
//
// Objectif principal : figer la sémantique "user > pack > defaut" — un changement
// de précédence casserait toute la logique multi-pays.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { EngineError } from '../dsl/errors.js';
import { parseTemplate } from '../dsl/parser.js';
import { evaluateTemplate } from '../evaluator/index.js';
import { packToDriverValues, parseParameterPack } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadPack(slug: string) {
  return parseParameterPack(readFileSync(resolve(__dirname, `./${slug}.yaml`), 'utf8'));
}

describe('ParameterPack — parsing YAML', () => {
  it('parse cd-2026 valide avec params attendus', () => {
    const pack = loadPack('cd-2026');
    expect(pack.slug).toBe('cd-2026');
    expect(pack.pays).toBe('CD');
    expect(pack.annee).toBe(2026);
    expect(pack.systeme_comptable).toBe('syscohada-revise-2017');
    expect(pack.devise_principale).toBe('USD');
    expect(pack.devise_secondaire).toBe('CDF');
    expect(pack.params['ibp_taux']?.valeur).toBe(0.3);
    expect(pack.params['tva_taux_normal']?.valeur).toBe(0.16);
    expect(pack.params['cnss_employeur_pct']?.valeur).toBe(0.05);
  });

  it('parse les 4 packs de lancement sans erreur', () => {
    for (const slug of ['cd-2026', 'ci-2026', 'sn-2026', 'ohada-generic-2026']) {
      const pack = loadPack(slug);
      expect(pack.slug).toBe(slug);
      expect(pack.params['ibp_taux']?.valeur).toBeGreaterThan(0);
      expect(pack.params['tva_taux_normal']?.valeur).toBeGreaterThan(0);
      expect(pack.params['ratio_dscr_min']?.valeur).toBeGreaterThan(1);
    }
  });

  it('IBP diffère bien selon pays', () => {
    expect(loadPack('cd-2026').params['ibp_taux']?.valeur).toBe(0.3);
    expect(loadPack('ci-2026').params['ibp_taux']?.valeur).toBe(0.25);
    expect(loadPack('sn-2026').params['ibp_taux']?.valeur).toBe(0.3);
    expect(loadPack('ohada-generic-2026').params['ibp_taux']?.valeur).toBe(0.28);
  });

  it('rejette un pack avec devise inconnue', () => {
    expect(() =>
      parseParameterPack(`
slug: bad
pays: XX
annee: 2026
systeme_comptable: syscohada-revise-2017
devise_principale: BTC
label: 'Bad'
params: {}
`),
    ).toThrow(EngineError);
  });

  it('packToDriverValues aplati ibp_taux et tva_taux_normal', () => {
    const pack = loadPack('cd-2026');
    const flat = packToDriverValues(pack);
    expect(flat['ibp_taux']).toBe(0.3);
    expect(flat['tva_taux_normal']).toBe(0.16);
    // Vérifie qu'on n'a que des numbers, pas de sous-objet.
    for (const v of Object.values(flat)) expect(typeof v).toBe('number');
  });
});

describe('Évaluation avec ParameterPack — précédence user > pack > defaut', () => {
  const templateYaml = `
slug: precedence-test
version: 1.0.0
drivers:
  - { id: base, type: money, defaut: 1000 }
  - { id: ibp_taux, type: percent, defaut: 0.10 }
feuilles:
  - id: sheet
    lignes:
      - { id: impot, formule: 'base * ibp_taux' }
`;
  const template = parseTemplate(templateYaml);
  const packCd = loadPack('cd-2026');

  it('sans pack, sans user override → utilise defaut du template (0.10)', () => {
    const { lines } = evaluateTemplate(template, {});
    expect(lines.find((l) => l.lineId === 'impot')?.value).toBeCloseTo(100, 6);
  });

  it('avec pack cd-2026, sans user override → utilise pack (0.30)', () => {
    const { lines } = evaluateTemplate(template, {}, { parameterPack: packCd });
    expect(lines.find((l) => l.lineId === 'impot')?.value).toBeCloseTo(300, 6);
  });

  it('avec pack cd-2026 + user override → user gagne', () => {
    const { lines } = evaluateTemplate(template, { ibp_taux: 0.25 }, { parameterPack: packCd });
    expect(lines.find((l) => l.lineId === 'impot')?.value).toBeCloseTo(250, 6);
  });

  it('drivers absents du pack retombent sur defaut du template', () => {
    // `base` n'est pas dans le pack → doit utiliser defaut 1000.
    const { drivers } = evaluateTemplate(template, {}, { parameterPack: packCd });
    expect(drivers.get('base')).toBe(1000);
    expect(drivers.get('ibp_taux')).toBeCloseTo(0.3, 6);
  });
});
