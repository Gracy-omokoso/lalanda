// Tests des ParameterPacks : parsing YAML, précédence à l'évaluation, aplatissement.
//
// Objectif principal : figer la sémantique "user > pack > defaut" — un changement
// de précédence casserait toute la logique multi-pays.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { EngineError } from '../dsl/errors.js';
import { parseTemplate } from '../dsl/parser.js';
import { evaluateTemplate } from '../evaluator/index.js';
import { packToDriverValues, parseParameterPack, toSummary } from './index.js';

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

describe('Feux tricolores (S10) — seuil_pack + seuil_direction', () => {
  const templateWithSeuils = parseTemplate(`
slug: seuil-test
version: 1.0.0
drivers:
  - { id: ca, type: money, defaut: 10000 }
  - { id: charges, type: money, defaut: 8500 }
feuilles:
  - id: main
    lignes:
      - { id: marge_ebe, formule: '(ca - charges) / ca', format: percent, seuil_pack: ratio_marge_ebe_min, seuil_direction: min }
`);
  const packCd = loadPack('cd-2026'); // ratio_marge_ebe_min = 0.10

  it('vert quand valeur ≥ seuil', () => {
    // marge = (10000 - 8500) / 10000 = 0.15 ≥ 0.10 → vert
    const { lines } = evaluateTemplate(templateWithSeuils, {}, { parameterPack: packCd });
    const marge = lines.find((l) => l.lineId === 'marge_ebe');
    expect(marge?.seuil?.statut).toBe('vert');
    expect(marge?.seuil?.valeur).toBeCloseTo(0.1, 6);
    expect(marge?.seuil?.direction).toBe('min');
  });

  it('orange dans la zone de tolérance ±10 %', () => {
    // marge = (10000 - 9050) / 10000 = 0.095 → dans [0.09, 0.10[ → orange
    const { lines } = evaluateTemplate(
      templateWithSeuils,
      { charges: 9050 },
      { parameterPack: packCd },
    );
    expect(lines.find((l) => l.lineId === 'marge_ebe')?.seuil?.statut).toBe('orange');
  });

  it('rouge nettement sous le seuil', () => {
    // marge = (10000 - 9500) / 10000 = 0.05 < 0.09 → rouge
    const { lines } = evaluateTemplate(
      templateWithSeuils,
      { charges: 9500 },
      { parameterPack: packCd },
    );
    expect(lines.find((l) => l.lineId === 'marge_ebe')?.seuil?.statut).toBe('rouge');
  });

  it('pas de seuil si pas de pack ou seuil absent du pack', () => {
    const { lines } = evaluateTemplate(templateWithSeuils, {});
    expect(lines.find((l) => l.lineId === 'marge_ebe')?.seuil).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Erratum en place (ADR-0021 §7) — révision n° 2 de cd-2026, et son verrou
// ─────────────────────────────────────────────────────────────────────────────

describe('cd-2026 — révision n° 2 (taux réduits de TVA 2026)', () => {
  const pack = loadPack('cd-2026');

  it('porte le taux réduit à 5 % (groupe C) et le nouveau taux de 1 % (groupe O)', () => {
    expect(pack.params['tva_taux_reduit']?.valeur).toBe(0.05);
    expect(pack.params['tva_taux_reduit_1pct']?.valeur).toBe(0.01);
    expect(pack.params['tva_taux_reduit']?.a_confirmer).toBe(true);
    expect(pack.params['tva_taux_reduit_1pct']?.a_confirmer).toBe(true);
    expect(pack.params['tva_seuil_assujettissement_cdf']?.a_confirmer).toBe(true);
    // Le taux normal n'est pas touché.
    expect(pack.params['tva_taux_normal']?.valeur).toBe(0.16);
  });

  it('cite la loi de finances 2026 et le communiqué officiel DGI n° 010', () => {
    for (const id of ['tva_taux_reduit', 'tva_taux_reduit_1pct']) {
      expect(pack.params[id]?.source).toMatch(/Loi de finances 2026/);
      expect(pack.params[id]?.source).toMatch(/communiqué officiel DGI n° 010/);
    }
  });

  it('trace la révision n° 2 et nomme les paramètres corrigés', () => {
    const revision = pack.revisions?.find((r) => r.numero === 2);
    expect(revision).toBeDefined();
    expect(revision!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(revision!.parametres).toEqual(
      expect.arrayContaining(['tva_taux_reduit', 'tva_taux_reduit_1pct']),
    );
    for (const id of revision!.parametres) expect(pack.params[id], id).toBeDefined();
  });

  it('toSummary ne change pas de forme (aucune révision exposée au listing)', () => {
    expect(Object.keys(toSummary(pack))).not.toContain('revisions');
  });

  it('refuse une révision n° 1, une date mal formée, un objet trop court ou sans paramètre', () => {
    const base = `
slug: x-2026
pays: CD
annee: 2026
systeme_comptable: syscohada-revise-2017
devise_principale: USD
label: 'X'
params:
  p: { valeur: 1 }
`;
    for (const rev of [
      "revisions: [{ numero: 1, date: '2026-01-01', objet: 'Objet assez long', parametres: [p] }]",
      "revisions: [{ numero: 2, date: '01/01/2026', objet: 'Objet assez long', parametres: [p] }]",
      "revisions: [{ numero: 2, date: '2026-01-01', objet: 'court', parametres: [p] }]",
      "revisions: [{ numero: 2, date: '2026-01-01', objet: 'Objet assez long', parametres: [] }]",
    ]) {
      expect(() => parseParameterPack(base + rev), rev).toThrow(EngineError);
    }
  });
});

describe('verrou des errata — aucun modèle ne consomme un paramètre révisé en place', () => {
  // Un erratum en place n'est légitime que parce qu'il ne change AUCUN plan
  // (ADR-0021 §7) : l'évaluateur ne résout que les drivers du modèle, et aucun
  // modèle ne lit ces paramètres. Le jour où un modèle les consommera — comme
  // driver, dans une formule ou comme seuil — ce test tombera : toute correction
  // ultérieure exigera alors une vraie nouvelle version du pack (docs/09).
  const engineSrc = resolve(__dirname, '..');
  const modeles = [
    ...readdirSync(resolve(engineSrc, 'templates'))
      .filter((f) => f.endsWith('.yaml'))
      .map((f) => resolve(engineSrc, 'templates', f)),
    resolve(engineSrc, 'toy-template.yaml'),
  ];

  const revises = readdirSync(__dirname)
    .filter((f) => f.endsWith('.yaml'))
    .flatMap((f) => {
      const pack = parseParameterPack(readFileSync(resolve(__dirname, f), 'utf8'));
      return (pack.revisions ?? []).flatMap((r) =>
        r.parametres.map((id) => ({ pack: pack.slug, id })),
      );
    });

  it('trouve des modèles et au moins un paramètre révisé (le test ne se valide pas à vide)', () => {
    expect(modeles.length).toBeGreaterThanOrEqual(5);
    expect(revises.length).toBeGreaterThan(0);
  });

  it('aucun modèle ne déclare de driver révisé ni ne le cite dans une formule ou un seuil', () => {
    for (const fichier of modeles) {
      const yaml = readFileSync(fichier, 'utf8');
      const template = parseTemplate(yaml);
      const driverIds = new Set(template.drivers.map((d) => d.id));
      for (const { pack, id } of revises) {
        expect(driverIds.has(id), `${fichier} déclare le driver ${id} (révisé dans ${pack})`).toBe(
          false,
        );
        expect(
          new RegExp(`\\b${id}\\b`).test(yaml),
          `${fichier} cite ${id} (révisé dans ${pack}) : une correction exige une nouvelle version`,
        ).toBe(false);
      }
    }
  });
});
