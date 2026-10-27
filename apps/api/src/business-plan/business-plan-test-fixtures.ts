// Données de test partagées par les tests unitaires du business plan. Pas de base, pas de réseau.

import type { PlanSource } from './business-plan-assembly.js';

export function sourceFigee(over: Partial<PlanSource> = {}): PlanSource {
  return {
    status: 'frozen',
    version: 2,
    fingerprint: 'a'.repeat(64),
    approvedAt: '2026-10-12T09:00:00.000Z',
    superseded: false,
    engineVersion: '1.0.0',
    currency: 'USD',
    hypotheses: [
      {
        id: 'ticket_moyen',
        label: 'Ticket moyen',
        value: 12,
        format: 'money',
        currency: 'USD',
        unit: null,
        group: 'Activité',
      },
      {
        id: 'food_cost_pct',
        label: 'Coût matière',
        value: 0.32,
        format: 'percent',
        currency: 'USD',
        unit: null,
        group: null,
      },
    ],
    lines: [
      {
        sheetId: 'projection',
        lineId: 'ca_annuel_1',
        label: 'CA année 1',
        value: 125000,
        format: 'money',
      },
      {
        sheetId: 'projection',
        lineId: 'resultat_annuel_1',
        label: 'Résultat net année 1',
        value: -4321.5,
        format: 'money',
      },
      {
        sheetId: 'ratios',
        lineId: 'dscr',
        label: 'DSCR',
        value: 1.42,
        format: 'number',
        seuil: { valeur: 1.25, direction: 'min', statut: 'vert' },
      },
      {
        sheetId: 'plan_financement',
        lineId: 'pf_besoin_total',
        label: 'Besoin total',
        value: 60000,
        format: 'money',
      },
      // Détail mensuel : jamais transmis à l'IA, jamais inséré dans une section.
      { sheetId: 'activite', lineId: 'ca', label: 'CA mensuel', value: 9876, format: 'money' },
    ],
    sheetTitles: {
      projection: 'Projection sur 5 exercices',
      ratios: 'Ratios bancaires',
      plan_financement: 'Plan de financement initial',
      activite: 'Activité',
    },
    error: null,
    ...over,
  };
}
