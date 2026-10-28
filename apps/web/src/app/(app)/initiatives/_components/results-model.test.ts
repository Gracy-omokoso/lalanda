// Tests du modèle de la vue résultats (S23a).
//
// Ce qui est vérifié ici est ce qui casse en silence : un onglet qui disparaît
// parce que le moteur a renommé une feuille, un `?tab=` périmé qui ouvre un
// panneau vide, un avertissement de portée perdu dans la réorganisation.

import { describe, expect, it } from 'vitest';

import type { LineResult } from '@/lib/api';

import {
  SHEET_WARNINGS,
  TAB_ORDER,
  buildResultTabs,
  groupLinesBySheet,
  linesForTab,
  resolveActiveTab,
} from './results-model';

function ligne(sheetId: string, lineId: string): LineResult {
  return { sheetId, lineId, label: lineId, value: 1, format: 'money' } as LineResult;
}

/** Feuilles réellement déclarées sous `feuilles:` par les templates sectoriels. */
const FEUILLES_MOTEUR = [
  'activite',
  'financement',
  'plan_financement',
  'tresorerie',
  'projection',
  'ratios',
];

describe('buildResultTabs', () => {
  it('couvre toutes les feuilles produites par les templates du moteur', () => {
    const tabs = buildResultTabs(FEUILLES_MOTEUR);
    const ids = tabs.map((t) => t.id);
    for (const feuille of FEUILLES_MOTEUR) {
      expect(ids).toContain(feuille);
    }
  });

  it('respecte l’ordre canonique', () => {
    const tabs = buildResultTabs(['projection', 'ratios', 'activite']);
    expect(tabs.map((t) => t.id)).toEqual(['ratios', 'activite', 'projection']);
  });

  it('n’affiche pas d’onglet pour une feuille absente de l’évaluation', () => {
    const tabs = buildResultTabs(['ratios']);
    expect(tabs.map((t) => t.id)).toEqual(['ratios']);
  });

  it('affiche les onglets virtuels rendus depuis une struct dédiée', () => {
    // `amortissements` et `bfr` n'ont pas de lignes propres : sans cette règle,
    // deux états financiers deviennent inaccessibles.
    const tabs = buildResultTabs(['ratios', 'plan_financement'], ['amortissements', 'bfr']);
    expect(tabs.map((t) => t.id)).toEqual(['ratios', 'plan_financement', 'bfr', 'amortissements']);
  });

  it('rend visible une feuille inconnue plutôt que de l’avaler', () => {
    // Un nouveau template ne doit pas perdre une feuille parce que l'interface
    // n'a pas encore été mise à jour : elle passe à la suite, libellée par son id.
    const tabs = buildResultTabs(['ratios', 'feuille_future']);
    expect(tabs.map((t) => t.id)).toEqual(['ratios', 'feuille_future']);
    expect(tabs.at(-1)?.label).toBe('feuille_future');
  });

  it('ne duplique pas un onglet demandé à la fois comme réel et comme virtuel', () => {
    const tabs = buildResultTabs(['amortissements'], ['amortissements']);
    expect(tabs.filter((t) => t.id === 'amortissements')).toHaveLength(1);
  });
});

describe('resolveActiveTab', () => {
  const tabs = buildResultTabs(FEUILLES_MOTEUR);

  it('ouvre l’onglet demandé par l’URL quand il existe', () => {
    expect(resolveActiveTab('tresorerie', tabs)).toBe('tresorerie');
  });

  it('retombe sur les ratios pour un ?tab= périmé', () => {
    // Un lien partagé après un changement de template ne doit pas ouvrir un
    // panneau vide.
    expect(resolveActiveTab('feuille_supprimee', tabs)).toBe('ratios');
  });

  it('retombe sur le premier onglet disponible s’il n’y a pas de ratios', () => {
    const sansRatios = buildResultTabs(['activite', 'tresorerie']);
    expect(resolveActiveTab(null, sansRatios)).toBe('activite');
  });

  it('ne plante pas sans aucun onglet', () => {
    expect(resolveActiveTab('ratios', [])).toBe('ratios');
  });
});

describe('linesForTab', () => {
  it('sort le détail BFR du plan de financement', () => {
    // (S18a) Le BFR annuel a son propre onglet ; le plan de financement doit
    // rester la lecture « besoins / ressources ».
    const bySheet = groupLinesBySheet([
      ligne('plan_financement', 'pf_investissements'),
      ligne('plan_financement', 'pf_bfr_2027'),
    ]);
    expect(linesForTab(bySheet, 'plan_financement').map((l) => l.lineId)).toEqual([
      'pf_investissements',
    ]);
  });

  it('ne filtre rien sur les autres feuilles', () => {
    const bySheet = groupLinesBySheet([ligne('activite', 'ca'), ligne('activite', 'resultat_net')]);
    expect(linesForTab(bySheet, 'activite')).toHaveLength(2);
  });
});

describe('SHEET_WARNINGS', () => {
  it('conserve la réserve de portée de la trésorerie mensuelle', () => {
    // Le DSL porte cette réserve dans le label long de la feuille ; l'interface
    // affiche un libellé court. Si cette entrée disparaît, l'utilisateur lit une
    // trésorerie simplifiée en croyant lire le tableau de flux.
    const t = SHEET_WARNINGS.tresorerie;
    expect(t).toBeDefined();
    expect(t).toMatch(/simplifiée/i);
    expect(t).toMatch(/fonds de roulement/i);
    expect(t).toMatch(/intérêts/i);
  });

  it('ne cite que des feuilles connues', () => {
    for (const id of Object.keys(SHEET_WARNINGS)) {
      expect(TAB_ORDER).toContain(id);
    }
  });
});
