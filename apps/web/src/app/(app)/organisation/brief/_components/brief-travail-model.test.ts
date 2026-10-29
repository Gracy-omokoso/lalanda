import { describe, expect, it } from 'vitest';

import type { BriefFactView, MorningBriefData } from '@/lib/morning-brief-api';

import { blocTravail } from './brief-travail-model';

function fait(id: string, status: BriefFactView['status'], value: string | null): BriefFactView {
  return {
    id,
    label: `Libellé ${id}`,
    kind: 'count',
    status,
    value,
    currency: null,
    source: { module: 'run.work', collection: 'work_tasks', rule: 'règle', reference: 'ADR-0039' },
  };
}

function brief(facts: BriefFactView[]): MorningBriefData {
  return {
    version: '1.1.0',
    now: '2026-10-29T08:00:00.000Z',
    period: { year: 2026, month: 10, day: 29 },
    facts,
    alerts: [],
    recommendations: [],
    triggeredCount: 0,
    alertCount: 0,
    rulesSkipped: [],
    predictions: [],
    truncated: false,
  };
}

const IDS = [
  'mes_taches.en_retard',
  'mes_taches.aujourdhui',
  'taches.en_retard',
  'projets_a_risque',
];

describe('bloc « Projets et tâches » du brief (ADR-0039 § 6.5)', () => {
  it('rend les quatre faits dans l’ordre, avec leurs liens', () => {
    const b = blocTravail(
      brief([
        fait('projets_a_risque', 'known', '1'),
        fait('taches.en_retard', 'known', '0'),
        fait('mes_taches.aujourdhui', 'known', '3'),
        fait('mes_taches.en_retard', 'known', '2'),
      ]),
    );
    expect(b?.map((l) => l.id)).toEqual(IDS);
    expect(b?.map((l) => l.lien)).toEqual([
      '/projets/mes-taches',
      '/projets/mes-taches',
      '/projets',
      '/projets',
    ]);
    expect(b?.map((l) => l.attention)).toEqual([true, false, false, true]);
    expect(b?.[0]?.valeur).toBe('2');
  });

  it('sans work.read (tous masqués) : pas de bloc', () => {
    expect(blocTravail(brief(IDS.map((id) => fait(id, 'hidden', null))))).toBeNull();
  });

  it('ancien brief sans ces faits : pas de bloc', () => {
    expect(blocTravail(brief([fait('pipeline', 'unavailable', null)]))).toBeNull();
  });

  it('non disponible : écrit en toutes lettres, jamais zéro', () => {
    const b = blocTravail(brief(IDS.map((id) => fait(id, 'unavailable', null))));
    expect(b?.every((l) => l.valeur === 'Non disponible' && !l.attention)).toBe(true);
  });
});
