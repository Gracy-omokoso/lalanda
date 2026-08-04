// Tests golden pour les 3 templates sectoriels de lancement (S6-lite).
// Objectif : figer les résultats attendus avec les valeurs par défaut, de sorte que
// toute modification silencieuse d'un manifest fasse échouer le test — les templates
// portent des règles fiscales/business, on ne les modifie pas sans intention.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseTemplate } from '../dsl/parser.js';
import { evaluateTemplate } from '../evaluator/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadYaml(name: string): string {
  return readFileSync(resolve(__dirname, `./${name}.yaml`), 'utf8');
}

function byId(lines: readonly { lineId: string; value: number }[]): Map<string, number> {
  return new Map(lines.map((l) => [l.lineId, l.value]));
}

describe('restaurant-kinshasa', () => {
  const template = parseTemplate(loadYaml('restaurant-kinshasa'));

  it('déclare le bon slug, version et secteur', () => {
    expect(template.slug).toBe('restaurant-kinshasa');
    expect(template.version).toBe('1.0.0');
    expect(template.secteur).toBe('restauration');
    expect(template.pays).toEqual(['CD']);
    expect(template.devise_base).toBe('USD');
  });

  it('évalue les défauts → résultat net mensuel = 6180.72 USD', () => {
    // ca = 60 * 26 * 12 = 18720
    // cout_matiere = 18720 * 0.32 = 5990.4
    // marge_matiere = 18720 - 5990.4 = 12729.6
    // charges_operationnelles = 2500 + 800 + 600 = 3900
    // excedent_brut = 12729.6 - 3900 = 8829.6
    // ibp = 8829.6 * 0.30 = 2648.88
    // resultat_net = 8829.6 - 2648.88 = 6180.72
    const { lines } = evaluateTemplate(template, {});
    const v = byId(lines);
    expect(v.get('ca')).toBe(18720);
    expect(v.get('cout_matiere')).toBeCloseTo(5990.4, 6);
    expect(v.get('marge_matiere')).toBeCloseTo(12729.6, 6);
    expect(v.get('charges_operationnelles')).toBe(3900);
    expect(v.get('excedent_brut')).toBeCloseTo(8829.6, 6);
    expect(v.get('ibp')).toBeCloseTo(2648.88, 6);
    expect(v.get('resultat_net')).toBeCloseTo(6180.72, 6);
  });

  it('recalcule quand on baisse le ticket moyen à 8 USD', () => {
    // ca = 60 * 26 * 8 = 12480
    const { lines } = evaluateTemplate(template, { ticket_moyen: 8 });
    const v = byId(lines);
    expect(v.get('ca')).toBe(12480);
    // resultat_net > 0 attendu à ce niveau
    expect(v.get('resultat_net')).toBeGreaterThan(0);
  });
});

describe('quincaillerie-negoce', () => {
  const template = parseTemplate(loadYaml('quincaillerie-negoce'));

  it('déclare le bon slug, version et secteur', () => {
    expect(template.slug).toBe('quincaillerie-negoce');
    expect(template.version).toBe('1.0.0');
    expect(template.secteur).toBe('negoce');
    expect(template.pays).toEqual(['CD']);
  });

  it('évalue les défauts → résultat net mensuel = 665 USD', () => {
    // ca = 500 * 26 = 13000
    // cout_achat_marchandises = 13000 * 0.75 = 9750
    // marge_brute = 3250
    // charges_operationnelles = 1200 + 500 + 300 + 300 = 2300
    // excedent_brut = 950
    // ibp = 285
    // resultat_net = 665
    const { lines } = evaluateTemplate(template, {});
    const v = byId(lines);
    expect(v.get('ca')).toBe(13000);
    expect(v.get('cout_achat_marchandises')).toBeCloseTo(9750, 6);
    expect(v.get('marge_brute')).toBeCloseTo(3250, 6);
    expect(v.get('charges_operationnelles')).toBe(2300);
    expect(v.get('excedent_brut')).toBeCloseTo(950, 6);
    expect(v.get('ibp')).toBeCloseTo(285, 6);
    expect(v.get('resultat_net')).toBeCloseTo(665, 6);
  });
});

describe('prestation-services', () => {
  const template = parseTemplate(loadYaml('prestation-services'));

  it('déclare le bon slug, version et secteur', () => {
    expect(template.slug).toBe('prestation-services');
    expect(template.version).toBe('1.0.0');
    expect(template.secteur).toBe('services');
    expect(template.pays).toEqual(['CD']);
  });

  it('évalue les défauts → résultat net mensuel = 840 USD', () => {
    // ca = 200 * 15 = 3000
    // charges_operationnelles = 1000 + 300 + 150 + 200 + 150 = 1800
    // excedent_brut = 1200
    // ibp = 360
    // resultat_net = 840
    const { lines } = evaluateTemplate(template, {});
    const v = byId(lines);
    expect(v.get('ca')).toBe(3000);
    expect(v.get('charges_operationnelles')).toBe(1800);
    expect(v.get('excedent_brut')).toBeCloseTo(1200, 6);
    expect(v.get('ibp')).toBeCloseTo(360, 6);
    expect(v.get('resultat_net')).toBeCloseTo(840, 6);
  });

  it('descend à zéro de facturation → excédent négatif, IBP négatif (limite du DSL S1, corrigé en S7)', () => {
    // Note : le DSL S1 n'a pas de MAX(0, ...) → l'IBP peut être négatif sur perte.
    // Ce comportement sera corrigé en S7 avec les feuilles typées syscohada_resultat.
    const { lines } = evaluateTemplate(template, { jours_facturables_mois: 0 });
    const v = byId(lines);
    expect(v.get('ca')).toBe(0);
    expect(v.get('excedent_brut')).toBe(-1800);
    // ibp = -1800 * 0.30 = -540 ; resultat_net = -1800 - (-540) = -1260
    expect(v.get('ibp')).toBeCloseTo(-540, 6);
    expect(v.get('resultat_net')).toBeCloseTo(-1260, 6);
  });
});
