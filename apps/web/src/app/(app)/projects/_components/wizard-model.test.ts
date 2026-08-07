// Tests de la logique pure du wizard (S18c). Aucun DOM requis : vitest en environnement
// node suffit, le rendu React n'est pas couvert ici (pas de setup jsdom dans apps/web).

import { describe, expect, it } from 'vitest';

import type { TemplateDriverMeta, TemplateMeta } from '@/lib/api';

import {
  ETAPE_SYNTHESE,
  GROUPE_TOUS,
  blockingDriverIds,
  buildWizardSteps,
  diagnoseStep,
  initialRawValues,
  parseInput,
  toDisplayString,
  validateDriver,
} from './wizard-model';

function driver(over: Partial<TemplateDriverMeta> & { id: string }): TemplateDriverMeta {
  return { type: 'number', ...over };
}

function template(over: Partial<TemplateMeta>): TemplateMeta {
  return { slug: 'demo', version: '1.0.0', drivers: [], ...over };
}

// ─── Découpage en étapes ──────────────────────────────────────

describe('buildWizardSteps', () => {
  const drivers = [
    driver({ id: 'ca', groupe: 'activite' }),
    driver({ id: 'jours', groupe: 'activite' }),
    driver({ id: 'apport', groupe: 'financement' }),
  ];
  const groupes = [
    { id: 'activite', label: 'Activité' },
    { id: 'financement', label: 'Financement' },
  ];

  it('utilise les étapes déclarées et les trie par ordre', () => {
    const steps = buildWizardSteps(
      template({
        drivers,
        groupes_hypotheses: groupes,
        wizard: {
          etapes: [
            { id: 'fin', label: 'Financement', groupes: ['financement'], ordre: 2 },
            { id: 'ca', label: 'Chiffre d’affaires', groupes: ['activite'], ordre: 1 },
          ],
        },
      }),
    );
    expect(steps.map((s) => s.id)).toEqual(['ca', 'fin', ETAPE_SYNTHESE]);
    expect(steps[0]?.drivers.map((d) => d.id)).toEqual(['ca', 'jours']);
  });

  it('fallback : une étape par groupe quand aucun bloc wizard n’est déclaré', () => {
    const steps = buildWizardSteps(template({ drivers, groupes_hypotheses: groupes }));
    expect(steps.map((s) => s.id)).toEqual(['activite', 'financement', ETAPE_SYNTHESE]);
    expect(steps.map((s) => s.label)).toEqual(['Activité', 'Financement', 'Synthèse']);
  });

  it('fallback : une étape unique quand il n’y a ni wizard ni groupes', () => {
    const steps = buildWizardSteps(template({ drivers: [driver({ id: 'x' })] }));
    expect(steps.map((s) => s.id)).toEqual(['hypotheses', ETAPE_SYNTHESE]);
    expect(steps[0]?.drivers).toHaveLength(1);
  });

  it('regroupe plusieurs groupes dans une même étape', () => {
    const steps = buildWizardSteps(
      template({
        drivers,
        groupes_hypotheses: groupes,
        wizard: { etapes: [{ id: 'tout', label: 'Tout', groupes: ['activite', 'financement'] }] },
      }),
    );
    expect(steps.map((s) => s.id)).toEqual(['tout', ETAPE_SYNTHESE]);
    expect(steps[0]?.drivers).toHaveLength(3);
  });

  it('ajoute en fin de parcours un groupe non rattaché à une étape', () => {
    const steps = buildWizardSteps(
      template({
        drivers,
        groupes_hypotheses: groupes,
        wizard: { etapes: [{ id: 'ca', label: 'CA', groupes: ['activite'] }] },
      }),
    );
    expect(steps.map((s) => s.id)).toEqual(['ca', 'financement', ETAPE_SYNTHESE]);
  });

  it('rassemble dans « Autres » les drivers au groupe inconnu ou absent', () => {
    const steps = buildWizardSteps(
      template({
        drivers: [
          ...drivers,
          driver({ id: 'orphelin', groupe: 'inexistant' }),
          driver({ id: 'nu' }),
        ],
        groupes_hypotheses: groupes,
      }),
    );
    const autres = steps.find((s) => s.id === '_autres');
    expect(autres?.drivers.map((d) => d.id)).toEqual(['orphelin', 'nu']);
  });

  it('écarte une étape dont aucun groupe ne porte de driver', () => {
    const steps = buildWizardSteps(
      template({
        drivers: [driver({ id: 'ca', groupe: 'activite' })],
        groupes_hypotheses: [...groupes, { id: 'vide', label: 'Vide' }],
        wizard: {
          etapes: [
            { id: 'ca', label: 'CA', groupes: ['activite'] },
            { id: 'rien', label: 'Rien', groupes: ['vide'] },
          ],
        },
      }),
    );
    expect(steps.map((s) => s.id)).toEqual(['ca', ETAPE_SYNTHESE]);
  });

  it('termine toujours par l’étape de synthèse, sans driver', () => {
    const steps = buildWizardSteps(template({ drivers }));
    const derniere = steps.at(-1);
    expect(derniere?.synthese).toBe(true);
    expect(derniere?.drivers).toEqual([]);
  });

  it('rattache tous les drivers au groupe virtuel quand aucun groupe n’est déclaré', () => {
    const steps = buildWizardSteps(template({ drivers }));
    expect(steps[0]?.drivers).toHaveLength(3);
    expect(GROUPE_TOUS).toBe('_all');
  });
});

// ─── Conversion ───────────────────────────────────────────────

describe('parseInput / toDisplayString', () => {
  const pct = driver({ id: 'p', type: 'percent' });

  it('stocke un pourcentage en fraction', () => {
    expect(parseInput(pct, '40')).toBe(0.4);
  });

  it('affiche une fraction en points de pourcentage sans bruit flottant', () => {
    expect(toDisplayString(pct, 0.07)).toBe('7');
  });

  it('accepte la virgule décimale française', () => {
    expect(parseInput(driver({ id: 'n' }), '12,5')).toBe(12.5);
  });

  it('renvoie null sur un champ vide', () => {
    expect(parseInput(driver({ id: 'n' }), '   ')).toBeNull();
  });

  it('renvoie null sur un texte non numérique', () => {
    expect(parseInput(driver({ id: 'n' }), 'abc')).toBeNull();
  });

  it('n’écrête pas une valeur hors bornes', () => {
    // Le clamp silencieux de S5a est supprimé : la valeur est conservée et signalée.
    expect(parseInput(driver({ id: 'n', min: 0, max: 10 }), '999')).toBe(999);
  });
});

// ─── Validation ───────────────────────────────────────────────

describe('validateDriver', () => {
  const borne = driver({ id: 'n', min: 0, max: 100 });

  it('bloque un champ vide', () => {
    expect(validateDriver(borne, '')).toEqual({
      level: 'error',
      message: 'Valeur requise pour calculer le plan.',
    });
  });

  it('bloque un texte non numérique', () => {
    expect(validateDriver(borne, 'douze')?.level).toBe('error');
  });

  it('bloque une valeur sous le minimum', () => {
    const issue = validateDriver(borne, '-1');
    expect(issue?.level).toBe('error');
    expect(issue?.message).toContain('minimum');
  });

  it('bloque une valeur au-dessus du maximum', () => {
    const issue = validateDriver(borne, '101');
    expect(issue?.level).toBe('error');
    expect(issue?.message).toContain('maximum');
  });

  it('exprime les bornes d’un pourcentage en points', () => {
    const pct = driver({ id: 'p', type: 'percent', min: 0, max: 0.6 });
    expect(validateDriver(pct, '80')?.message).toContain('60 %');
  });

  it('avertit sur une valeur dans les 5 % bas de l’intervalle', () => {
    const issue = validateDriver(borne, '3');
    expect(issue?.level).toBe('warning');
    expect(issue?.message).toContain('basse');
  });

  it('avertit sur une valeur dans les 5 % hauts de l’intervalle', () => {
    const issue = validateDriver(borne, '98');
    expect(issue?.level).toBe('warning');
    expect(issue?.message).toContain('haute');
  });

  it('n’avertit pas sur une valeur centrale', () => {
    expect(validateDriver(borne, '50')).toBeNull();
  });

  it('avertit sur la borne minimale quand le maximum est absent', () => {
    const issue = validateDriver(driver({ id: 'n', min: 0 }), '0');
    expect(issue?.level).toBe('warning');
  });

  it('n’avertit pas quand aucune borne n’est déclarée', () => {
    expect(validateDriver(driver({ id: 'n' }), '0')).toBeNull();
  });
});

// ─── Agrégation par étape ─────────────────────────────────────

describe('diagnoseStep / blockingDriverIds', () => {
  const steps = buildWizardSteps(
    template({
      drivers: [
        driver({ id: 'a', min: 0, max: 100 }),
        driver({ id: 'b', min: 0, max: 100 }),
        driver({ id: 'c' }),
      ],
    }),
  );
  const saisie = steps[0] as NonNullable<(typeof steps)[0]>;

  it('classe une étape en erreur dès un champ bloquant', () => {
    const d = diagnoseStep(saisie, { a: '999', b: '50', c: '1' });
    expect(d.status).toBe('error');
    expect(d.errors).toEqual(['a']);
  });

  it('classe une étape en avertissement sans erreur bloquante', () => {
    const d = diagnoseStep(saisie, { a: '2', b: '50', c: '1' });
    expect(d.status).toBe('warning');
    expect(d.warnings).toEqual(['a']);
  });

  it('classe une étape valide en ok', () => {
    expect(diagnoseStep(saisie, { a: '50', b: '50', c: '1' }).status).toBe('ok');
  });

  it('considère un champ absent comme vide, donc bloquant', () => {
    expect(diagnoseStep(saisie, {}).errors).toEqual(['a', 'b', 'c']);
  });

  it('l’étape de synthèse n’a jamais d’erreur propre', () => {
    const synthese = steps.at(-1) as NonNullable<(typeof steps)[0]>;
    expect(diagnoseStep(synthese, {}).status).toBe('ok');
  });

  it('agrège les erreurs bloquantes de tout le wizard', () => {
    expect(blockingDriverIds(steps, { a: '', b: '50', c: 'x' })).toEqual(['a', 'c']);
  });
});

describe('initialRawValues', () => {
  it('reprend la valeur persistée, sinon le défaut DSL, sinon 0', () => {
    const raw = initialRawValues(
      [
        driver({ id: 'a', defaut: 10 }),
        driver({ id: 'b', defaut: 5 }),
        driver({ id: 'c' }),
        driver({ id: 'p', type: 'percent', defaut: 0.32 }),
      ],
      { a: 42 },
    );
    expect(raw).toEqual({ a: '42', b: '5', c: '0', p: '32' });
  });
});
