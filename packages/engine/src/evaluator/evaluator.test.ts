import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { MissingDriverValueError } from '../dsl/errors.js';
import { parseTemplate } from '../dsl/parser.js';
import { evaluateTemplate } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const toyTemplateYaml = readFileSync(resolve(__dirname, '../toy-template.yaml'), 'utf8');

describe('evaluateTemplate — template jouet 5 drivers', () => {
  const template = parseTemplate(toyTemplateYaml);

  it('évalue avec les valeurs par défaut → resultat_net = 70', () => {
    // ca = 10 * 100 = 1000
    // cout_variable = 1000 * 0.4 = 400
    // marge_brute = 1000 - 400 = 600
    // resultat_avant_impot = 600 - 500 = 100
    // resultat_net = 100 * (1 - 0.3) = 70
    const { lines } = evaluateTemplate(template, {});
    const byId = new Map(lines.map((l) => [l.lineId, l.value]));

    expect(byId.get('ca')).toBe(1000);
    expect(byId.get('cout_variable')).toBe(400);
    expect(byId.get('marge_brute')).toBe(600);
    expect(byId.get('resultat_avant_impot')).toBe(100);
    expect(byId.get('resultat_net')).toBeCloseTo(70, 9);
  });

  it('évalue en surchargeant prix_unitaire → recalcul complet correct', () => {
    // prix_unitaire = 20 → ca = 20 * 100 = 2000
    // cout_variable = 800, marge_brute = 1200
    // resultat_avant_impot = 700, resultat_net = 700 * 0.7 = 490
    const { lines } = evaluateTemplate(template, { prix_unitaire: 20 });
    const byId = new Map(lines.map((l) => [l.lineId, l.value]));

    expect(byId.get('ca')).toBe(2000);
    expect(byId.get('resultat_net')).toBeCloseTo(490, 9);
  });

  it('expose formule source et formule Excel dans le résultat', () => {
    const { lines } = evaluateTemplate(template, {});
    const ca = lines.find((l) => l.lineId === 'ca')!;
    expect(ca.formulaSource).toBe('prix_unitaire * quantite_mois');
    expect(ca.formulaExcel).toBe('=__drivers!B1 * __drivers!B2');
  });

  it("expose l'ordre stable des feuilles et lignes du template", () => {
    const { lines } = evaluateTemplate(template, {});
    expect(lines.map((l) => l.lineId)).toEqual([
      'ca',
      'cout_variable',
      'marge_brute',
      'resultat_avant_impot',
      'resultat_net',
    ]);
  });

  it("lève MissingDriverValueError si un driver sans défaut n'a pas de valeur", () => {
    const withoutDefault = parseTemplate(`
slug: no-default
version: 1.0.0
drivers:
  - { id: x, type: number }
feuilles:
  - id: s
    lignes:
      - { id: y, formule: "x + 1" }
`);
    expect(() => evaluateTemplate(withoutDefault, {})).toThrow(MissingDriverValueError);
  });

  it('prend les valeurs fournies (Map ou objet) indifféremment', () => {
    const asMap = evaluateTemplate(template, new Map([['prix_unitaire', 15]]));
    const asObj = evaluateTemplate(template, { prix_unitaire: 15 });
    expect(asMap.lines.find((l) => l.lineId === 'ca')?.value).toBe(1500);
    expect(asObj.lines.find((l) => l.lineId === 'ca')?.value).toBe(1500);
  });
});
