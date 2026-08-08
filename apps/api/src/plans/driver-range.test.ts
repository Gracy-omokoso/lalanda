// Bornes DSL appliquées côté serveur avant de figer un plan (S18c — revue CTO B1).

import { describe, expect, it } from 'vitest';
import { TemplateSchema, type Template } from '@lalanda/engine';

import { getTemplate, listTemplateSlugs } from '../evaluate/template-registry.js';
import { findDriverRangeViolations } from './driver-range.js';

const template: Template = TemplateSchema.parse({
  slug: 'demo',
  version: '1.0.0',
  drivers: [
    { id: 'borne', label: 'Borné', type: 'number', min: 0, max: 100, defaut: 50 },
    { id: 'plancher', type: 'number', min: 0, defaut: 1 },
    { id: 'plafond', type: 'number', max: 10, defaut: 1 },
    { id: 'libre', type: 'number', defaut: 1 },
    { id: 'taux', label: 'Taux', type: 'percent', min: 0, max: 0.6, defaut: 0.3 },
  ],
  feuilles: [{ id: 'f', lignes: [{ id: 'l', formule: 'borne * 2' }] }],
});

describe('findDriverRangeViolations', () => {
  it('ne signale rien quand toutes les valeurs sont dans les bornes', () => {
    expect(findDriverRangeViolations(template, { borne: 50, taux: 0.3 })).toEqual([]);
  });

  it('accepte les valeurs exactement sur les bornes', () => {
    expect(findDriverRangeViolations(template, { borne: 0 })).toEqual([]);
    expect(findDriverRangeViolations(template, { borne: 100 })).toEqual([]);
  });

  it('signale une valeur sous le minimum, avec le contexte nécessaire au message', () => {
    expect(findDriverRangeViolations(template, { borne: -1 })).toEqual([
      { driverId: 'borne', label: 'Borné', value: -1, min: 0, max: 100 },
    ]);
  });

  it('signale une valeur au-dessus du maximum', () => {
    expect(findDriverRangeViolations(template, { borne: 101 })).toHaveLength(1);
  });

  it('applique une borne unique (plancher seul, plafond seul)', () => {
    expect(findDriverRangeViolations(template, { plancher: -0.5 })).toHaveLength(1);
    expect(findDriverRangeViolations(template, { plafond: 11 })).toHaveLength(1);
    expect(findDriverRangeViolations(template, { plancher: 999, plafond: -999 })).toEqual([]);
  });

  it('laisse passer un driver sans bornes déclarées', () => {
    expect(findDriverRangeViolations(template, { libre: -1e9 })).toEqual([]);
  });

  it('compare les pourcentages en fraction, comme le DSL les déclare', () => {
    // 0.8 = 80 %, au-delà du max 0.6 ; 0.5 = 50 %, dans les bornes.
    expect(findDriverRangeViolations(template, { taux: 0.8 })).toHaveLength(1);
    expect(findDriverRangeViolations(template, { taux: 0.5 })).toEqual([]);
  });

  it('ignore les drivers non fournis — pack et défauts prennent le relais', () => {
    expect(findDriverRangeViolations(template, {})).toEqual([]);
  });

  it('ignore un driver inconnu du template (le moteur le signalera)', () => {
    expect(findDriverRangeViolations(template, { fantome: 42 })).toEqual([]);
  });

  it('signale une valeur non finie, incomparable à toute borne', () => {
    expect(findDriverRangeViolations(template, { libre: Number.NaN })).toHaveLength(1);
    expect(findDriverRangeViolations(template, { libre: Number.POSITIVE_INFINITY })).toHaveLength(
      1,
    );
  });

  it('remonte toutes les violations, pas seulement la première', () => {
    const found = findDriverRangeViolations(template, { borne: 500, plafond: 50, taux: 9 });
    expect(found.map((v) => v.driverId)).toEqual(['borne', 'plafond', 'taux']);
  });
});

// ─── Templates réellement livrés ──────────────────────────────
// Le garde doit couvrir TOUT driver borné, y compris ceux ajoutés après coup (S18a a
// introduit les délais clients/fournisseurs et la rotation de stock). Il parcourt les
// drivers du template, donc aucun câblage par driver n'est nécessaire : ces tests le
// vérifient sur les manifestes réels plutôt que sur un template de laboratoire.
describe('findDriverRangeViolations — templates livrés', () => {
  for (const slug of listTemplateSlugs()) {
    describe(slug, () => {
      const shipped = getTemplate(slug);

      it('accepte les valeurs par défaut du template', () => {
        const defauts = Object.fromEntries(
          shipped!.drivers.flatMap((d) => (d.defaut === undefined ? [] : [[d.id, d.defaut]])),
        );
        expect(findDriverRangeViolations(shipped!, defauts)).toEqual([]);
      });

      it('rejette chaque driver borné poussé hors de ses bornes', () => {
        const bornes = shipped!.drivers.filter((d) => d.min !== undefined || d.max !== undefined);
        expect(bornes.length).toBeGreaterThan(0);
        for (const d of bornes) {
          const horsBornes = d.max !== undefined ? d.max + 1 : (d.min as number) - 1;
          expect(
            findDriverRangeViolations(shipped!, { [d.id]: horsBornes }).map((v) => v.driverId),
          ).toEqual([d.id]);
        }
      });

      // Les templates de démonstration (hello-world) ne déclarent pas de BFR : le test
      // ne s'applique qu'aux templates sectoriels qui l'ont activé en S18a.
      const aDuBfr = shipped!.drivers.some((d) => d.id === 'delai_clients_jours');
      it.skipIf(!aDuBfr)('couvre les drivers de BFR introduits en S18a', () => {
        const bfr = shipped!.drivers.filter((d) =>
          ['delai_clients_jours', 'delai_fournisseurs_jours', 'rotation_stock_jours'].includes(
            d.id,
          ),
        );
        expect(bfr).toHaveLength(3);
        // 400 jours de délai client : hors des bornes, donc non figeable en plan validé.
        expect(findDriverRangeViolations(shipped!, { delai_clients_jours: 400 })).toHaveLength(1);
      });
    });
  }
});
