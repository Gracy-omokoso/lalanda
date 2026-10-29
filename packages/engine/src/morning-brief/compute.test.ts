import { describe, expect, it } from 'vitest';

import {
  MORNING_BRIEF_RULES,
  MORNING_BRIEF_THRESHOLDS,
  buildMorningBrief,
  buildMorningBriefFacts,
  formatFr,
  kinshasaDay,
} from './compute.js';
import type {
  BriefCrmActivityInput,
  BriefFact,
  BriefInvoiceInput,
  BriefWorkTaskInput,
  MorningBriefInput,
} from './types.js';

// 21 oct. 2026, 9 h à Kinshasa (8 h UTC).
const NOW = '2026-10-21T08:00:00.000Z';

let seq = 0;
function inv(over: Partial<BriefInvoiceInput> = {}): BriefInvoiceInput {
  seq += 1;
  return {
    id: `inv-${seq}`,
    type: 'FV',
    status: 'issued',
    testSeries: false,
    currency: 'CDF',
    issuedAt: '2026-10-05T10:00:00.000Z',
    frozenAt: '2026-10-05T10:00:00.000Z',
    updatedAt: '2026-10-05T10:00:00.000Z',
    groups: [{ group: 'B', ht: '1000.00' }],
    outstanding: null,
    creditNoteOriginId: null,
    normalizationPhase: null,
    ...over,
  };
}

function input(
  invoices: BriefInvoiceInput[],
  over: Partial<MorningBriefInput> = {},
): MorningBriefInput {
  return {
    now: NOW,
    sales: { invoices, truncated: false },
    cash: { status: 'to_fill' },
    dueDates: { status: 'unavailable' },
    work: { status: 'known', tasks: [], truncated: false },
    crm: { status: 'known', activities: [], openOpportunityCount: 0, truncated: false },
    ...over,
  };
}

function fact(facts: readonly BriefFact[], id: string): BriefFact {
  const f = facts.find((x) => x.id === id);
  if (!f) throw new Error(`fait absent : ${id}`);
  return f;
}

function ruleIds(invoices: BriefInvoiceInput[], over: Partial<MorningBriefInput> = {}): string[] {
  return buildMorningBrief(input(invoices, over)).recommendations.map((r) => r.ruleId);
}

describe('kinshasaDay — mois civil de Kinshasa (UTC+1)', () => {
  it('le 31 à 23 h 30 UTC est déjà le 1er à Kinshasa', () => {
    expect(kinshasaDay('2026-10-31T23:30:00.000Z')).toEqual({ year: 2026, month: 11, day: 1 });
  });
  it('refuse un instant illisible', () => {
    expect(() => kinshasaDay('hier')).toThrow(RangeError);
  });
});

describe('chiffre d’affaires du mois (ADR-0023 § S25e.13)', () => {
  it('somme les bases HT hors groupes H, I, J, L, N, par devise, sans conversion', () => {
    const facts = buildMorningBriefFacts(
      input([
        inv({
          groups: [
            { group: 'B', ht: '1000.00' },
            { group: 'H', ht: '50.00' },
            { group: 'J', ht: '20.00' },
            { group: 'N', ht: '16.00' },
          ],
        }),
        inv({ type: 'EV', status: 'normalized', groups: [{ group: 'E', ht: '250.50' }] }),
        inv({ currency: 'USD', groups: [{ group: 'B', ht: '99.99' }] }),
      ]),
    );
    expect(fact(facts, 'ca_mois.CDF').value).toBe('1250.50');
    expect(fact(facts, 'ca_mois.USD').value).toBe('99.99');
    expect(fact(facts, 'factures_mois.nombre').value).toBe('3');
  });

  it('déduit les avoirs finaux du mois et peut devenir négatif', () => {
    const facts = buildMorningBriefFacts(
      input([
        inv({ groups: [{ group: 'B', ht: '100.00' }] }),
        inv({ type: 'FA', groups: [{ group: 'B', ht: '300.00' }] }),
      ]),
    );
    expect(fact(facts, 'ca_mois.CDF').value).toBe('-200.00');
    expect(fact(facts, 'avoirs_mois.nombre').value).toBe('1');
  });

  it('exclut la série d’essai DGI, les brouillons, les acomptes et le mois précédent', () => {
    const facts = buildMorningBriefFacts(
      input([
        inv({ testSeries: true, status: 'normalized' }),
        inv({ status: 'draft', issuedAt: null }),
        inv({ status: 'pending_normalization', issuedAt: null }),
        inv({ type: 'FT' }),
        inv({ issuedAt: '2026-09-30T22:30:00.000Z' }), // 23 h 30 à Kinshasa, le 30 sept.
      ]),
    );
    expect(fact(facts, 'ca_mois.CDF').value).toBe('0.00');
    expect(fact(facts, 'factures_mois.nombre').value).toBe('0');
    expect(fact(facts, 'acomptes_mois.nombre').value).toBe('1');
  });

  it('compte une facture émise le 30 sept. à 23 h 30 UTC dans octobre (Kinshasa)', () => {
    const facts = buildMorningBriefFacts(input([inv({ issuedAt: '2026-09-30T23:30:00.000Z' })]));
    expect(fact(facts, 'factures_mois.nombre').value).toBe('1');
  });
});

describe('créances restant à encaisser (ADR-0031)', () => {
  it('somme le reste à encaisser fourni par le moteur des encaissements, par devise', () => {
    const facts = buildMorningBriefFacts(
      input([
        // Reste après avoirs et encaissements, calculé en amont par `computeSettlement`.
        inv({ outstanding: '400.00' }),
        inv({ outstanding: '0.00' }), // soldée par un encaissement
        inv({ currency: 'USD', outstanding: '40.00' }),
        // Un avoir n'est jamais une créance, même avec un reste.
        inv({ type: 'FA', creditNoteOriginId: 'x', outstanding: '600.00' }),
        // Un brouillon non plus.
        inv({ status: 'draft', outstanding: '600.00' }),
      ]),
    );
    expect(fact(facts, 'creances.CDF').value).toBe('400.00');
    expect(fact(facts, 'creances.USD').value).toBe('40.00');
    expect(fact(facts, 'creances.CDF').source.module).toBe('run.receivables');
  });

  it('isole les créances de plus de 30 jours (seuil S4), y compris des mois passés', () => {
    const facts = buildMorningBriefFacts(
      input([
        inv({ issuedAt: '2026-09-20T07:59:00.000Z', outstanding: '70.00' }), // 31 jours
        inv({ issuedAt: '2026-09-21T08:00:00.000Z', outstanding: '30.00' }), // 30 jours pile
        inv({ issuedAt: '2026-08-01T08:00:00.000Z', outstanding: null }), // sans règlement
      ]),
    );
    expect(fact(facts, 'creances.CDF').value).toBe('100.00');
    expect(fact(facts, 'creances_anciennes.nombre').value).toBe('1');
    expect(fact(facts, 'creances_anciennes.CDF').value).toBe('70.00');
  });
});

describe('règles déterministes', () => {
  it('chaque règle porte un rang unique et chaque seuil cité est un paramètre à valider', () => {
    const ranks = MORNING_BRIEF_RULES.map((r) => r.rank);
    expect(new Set(ranks).size).toBe(ranks.length);
    for (const r of MORNING_BRIEF_RULES) {
      if (r.threshold) expect(r.threshold.nature).toBe('parametre_produit_a_valider');
    }
  });

  it('R1 : une facture en échec suffit (seuil S1 = 0)', () => {
    const brief = buildMorningBrief(
      input([inv({ status: 'normalization_failed', issuedAt: null })]),
    );
    const r = brief.alerts[0];
    expect(r?.ruleId).toBe('normalisation_echec');
    expect(r?.severity).toBe('critique');
    expect(r?.factIds).toEqual(['normalisation.echec']);
    expect(r?.threshold).toEqual(MORNING_BRIEF_THRESHOLDS.S1);
    expect(r?.message).toContain('1 facture est en échec');
  });

  it('R2 : phase incertaine ou à revoir → à vérifier, quel que soit l’âge', () => {
    const ids = ruleIds([
      inv({
        status: 'pending_normalization',
        issuedAt: null,
        normalizationPhase: 'uncertain',
        frozenAt: NOW,
      }),
    ]);
    expect(ids).toContain('normalisation_a_verifier');
    expect(ids).not.toContain('normalisation_attente_longue');
  });

  it('R3 : attente > 24 h déclenche, 24 h pile ne déclenche pas', () => {
    const pending = (frozenAt: string): BriefInvoiceInput =>
      inv({
        status: 'pending_normalization',
        issuedAt: null,
        normalizationPhase: 'queued',
        frozenAt,
      });
    expect(ruleIds([pending('2026-10-20T08:00:00.000Z')])).not.toContain(
      'normalisation_attente_longue',
    );
    expect(ruleIds([pending('2026-10-20T07:59:59.000Z')])).toContain(
      'normalisation_attente_longue',
    );
  });

  it('R4 : la créance ancienne cite son montant et ses faits', () => {
    const brief = buildMorningBrief(
      input([inv({ issuedAt: '2026-08-01T10:00:00.000Z', outstanding: '1234567.50' })]),
    );
    const r = brief.alerts.find((a) => a.ruleId === 'creances_anciennes');
    expect(r?.message).toContain(`${formatFr('1234567.50')} CDF`);
    expect(r?.factIds).toEqual(['creances_anciennes.nombre', 'creances_anciennes.CDF']);
    expect(r?.threshold?.value).toBe(30);
  });

  it('R5 : aucune facture du mois, seulement à partir du 10ᵉ jour', () => {
    expect(ruleIds([], { now: '2026-10-09T08:00:00.000Z' })).not.toContain(
      'aucune_facture_du_mois',
    );
    expect(ruleIds([], { now: '2026-10-10T08:00:00.000Z' })).toContain('aucune_facture_du_mois');
    expect(ruleIds([inv()])).not.toContain('aucune_facture_du_mois');
  });

  it('R6 : pro forma de plus de 14 jours', () => {
    expect(
      ruleIds([inv({ status: 'draft', issuedAt: null, updatedAt: '2026-10-01T00:00:00.000Z' })]),
    ).toContain('proformas_anciennes');
    expect(
      ruleIds([inv({ status: 'draft', issuedAt: null, updatedAt: '2026-10-15T00:00:00.000Z' })]),
    ).not.toContain('proformas_anciennes');
  });

  it('R7 : trésorerie à renseigner, et silencieuse quand elle est connue', () => {
    expect(ruleIds([inv()])).toEqual(['tresorerie_a_renseigner']);
    const known = buildMorningBrief(
      input([inv()], {
        cash: {
          status: 'known',
          amounts: [{ currency: 'USD', amount: '5000.00' }],
          sourceLabel: 'Saisie',
        },
      }),
    );
    expect(known.recommendations).toEqual([]);
    expect(fact(known.facts, 'tresorerie.USD').value).toBe('5000.00');
  });

  it('trie par gravité puis par rang, coupe à trois, et rend les totaux', () => {
    const brief = buildMorningBrief(
      input([
        inv({ status: 'draft', issuedAt: null, updatedAt: '2026-09-01T00:00:00.000Z' }),
        inv({ issuedAt: '2026-08-01T10:00:00.000Z', outstanding: '10.00' }),
        inv({ status: 'normalization_failed', issuedAt: null }),
        inv({
          status: 'pending_normalization',
          issuedAt: null,
          normalizationPhase: 'needs_review',
        }),
      ]),
    );
    expect(brief.recommendations.map((r) => r.ruleId)).toEqual([
      'normalisation_echec',
      'normalisation_a_verifier',
      'creances_anciennes',
    ]);
    expect(brief.alerts.map((r) => r.ruleId)).toEqual([
      'normalisation_echec',
      'normalisation_a_verifier',
      'creances_anciennes',
    ]);
    // R4 (créance), R5 (aucune facture de vente ce mois), R6, R7 + R1, R2.
    expect(brief.triggeredCount).toBe(6);
    expect(brief.alertCount).toBe(4);
    expect(brief.alerts.every((a) => a.severity !== 'info')).toBe(true);
  });
});

describe('faits masqués et indisponibles', () => {
  it('sans sales.read : faits de ventes masqués, règles de ventes non évaluées', () => {
    const brief = buildMorningBrief(input([], { sales: 'hidden' }));
    expect(fact(brief.facts, 'ca_mois.CDF')).toMatchObject({ status: 'hidden', value: null });
    expect(brief.rulesSkipped.map((s) => s.ruleId)).toEqual([
      'normalisation_echec',
      'normalisation_a_verifier',
      'normalisation_attente_longue',
      'creances_anciennes',
      'aucune_facture_du_mois',
      'proformas_anciennes',
    ]);
    expect(brief.rulesSkipped.every((s) => s.reason === 'hidden')).toBe(true);
    expect(brief.recommendations.map((r) => r.ruleId)).toEqual(['tresorerie_a_renseigner']);
  });

  it('échéances, pipeline, tâches et projets : non disponibles, jamais à zéro', () => {
    const brief = buildMorningBrief(
      input([], { work: { status: 'unavailable' }, crm: { status: 'unavailable' } }),
    );
    for (const id of [
      'echeances.depassees',
      'pipeline',
      'mes_taches.en_retard',
      'mes_taches.aujourdhui',
      'taches.en_retard',
      'projets_a_risque',
    ]) {
      expect(fact(brief.facts, id)).toMatchObject({ status: 'unavailable', value: null });
    }
    expect(brief.predictions).toEqual([]);
  });

  it('chaque fait porte une source complète', () => {
    for (const f of buildMorningBrief(input([inv()])).facts) {
      expect(f.source.module).not.toBe('');
      expect(f.source.rule).not.toBe('');
      expect(f.source.reference).not.toBe('');
    }
  });

  it('est déterministe : mêmes entrées, même sortie', () => {
    const invoices = [
      inv({ outstanding: '5.00' }),
      inv({ status: 'normalization_failed', issuedAt: null }),
    ];
    expect(buildMorningBrief(input(invoices))).toEqual(buildMorningBrief(input(invoices)));
  });
});

describe('sources du module', () => {
  it('aucun flottant natif sur les montants (parseFloat, toFixed)', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('./compute.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/parseFloat|toFixed|Number\(\s*inv/);
  });
});

// ── ADR-0039 § 6.5 : projets et tâches (faits, R8, R9) ──────────────────────

describe('projets et tâches — faits et règles R8, R9 (ADR-0039 § 6.5)', () => {
  // NOW = 21 oct. 2026 à Kinshasa.
  function task(over: Partial<BriefWorkTaskInput> = {}): BriefWorkTaskInput {
    return {
      projectId: 'p1',
      dueDate: '2026-10-20',
      isMilestone: false,
      mine: false,
      projectActive: true,
      ...over,
    };
  }
  function work(tasks: BriefWorkTaskInput[], truncated = false): Partial<MorningBriefInput> {
    return { work: { status: 'known', tasks, truncated } };
  }
  const brief = (tasks: BriefWorkTaskInput[]): ReturnType<typeof buildMorningBrief> =>
    buildMorningBrief(input([inv()], work(tasks)));

  it('compte mes tâches en retard et du jour, et les retards de l’organisation', () => {
    const b = brief([
      task({ mine: true, dueDate: '2026-10-20' }),
      task({ mine: true, dueDate: '2026-09-01' }),
      task({ mine: true, dueDate: '2026-10-21' }),
      task({ mine: false, dueDate: '2026-10-19' }),
      task({ mine: false, dueDate: '2026-10-21' }),
    ]);
    expect(fact(b.facts, 'mes_taches.en_retard').value).toBe('2');
    expect(fact(b.facts, 'mes_taches.aujourdhui').value).toBe('1');
    expect(fact(b.facts, 'taches.en_retard').value).toBe('3');
  });

  it('le jour est celui de Kinshasa : à 23 h 30 UTC, l’échéance de la veille UTC est dépassée', () => {
    const b = buildMorningBrief(
      input([], {
        now: '2026-10-21T23:30:00.000Z', // 22 oct., 0 h 30 à Kinshasa
        ...work([task({ mine: true, dueDate: '2026-10-21' })]),
      }),
    );
    expect(fact(b.facts, 'mes_taches.en_retard').value).toBe('1');
    expect(fact(b.facts, 'mes_taches.aujourdhui').value).toBe('0');
  });

  it('R8 : deux tâches en retard déclenchent l’alerte vers Mes tâches (critère n° 16)', () => {
    const b = brief([task({ mine: true }), task({ mine: true, projectId: 'p2' })]);
    const r8 = b.alerts.find((a) => a.ruleId === 'taches_en_retard');
    expect(r8).toMatchObject({
      severity: 'attention',
      rank: 8,
      actionPath: '/projets/mes-taches',
      factIds: ['mes_taches.en_retard'],
    });
    expect(r8?.message).toContain('2 tâches');
  });

  it('R8 : au seuil exact (zéro tâche en retard à moi), rien ne se déclenche', () => {
    const b = brief([task({ mine: false }), task({ mine: true, dueDate: '2026-10-21' })]);
    expect(b.recommendations.map((r) => r.ruleId)).not.toContain('taches_en_retard');
  });

  it('projet à risque : un jalon en retard suffit', () => {
    const b = brief([task({ isMilestone: true })]);
    expect(fact(b.facts, 'projets_a_risque').value).toBe('1');
    const r9 = b.alerts.find((a) => a.ruleId === 'jalon_depasse');
    expect(r9?.threshold).toEqual(MORNING_BRIEF_THRESHOLDS.S7);
    expect(r9?.actionPath).toBe('/projets');
  });

  it('projet à risque : S7 = 3 tâches en retard, pas 2', () => {
    const deux = brief([task(), task()]);
    expect(fact(deux.facts, 'projets_a_risque').value).toBe('0');
    expect(deux.recommendations.map((r) => r.ruleId)).not.toContain('jalon_depasse');
    const trois = brief([task(), task(), task()]);
    expect(fact(trois.facts, 'projets_a_risque').value).toBe('1');
    expect(trois.recommendations.map((r) => r.ruleId)).toContain('jalon_depasse');
  });

  it('projet à risque : seuls les projets actifs comptent, et un jalon du jour n’est pas en retard', () => {
    const b = brief([
      task({ projectId: 'p-pause', projectActive: false, isMilestone: true }),
      task({ projectId: 'p-jour', isMilestone: true, dueDate: '2026-10-21' }),
    ]);
    expect(fact(b.facts, 'projets_a_risque').value).toBe('0');
    expect(fact(b.facts, 'taches.en_retard').value).toBe('1');
  });

  it('projets distincts : chacun compté une fois', () => {
    const b = brief([
      task({ projectId: 'a', isMilestone: true }),
      task({ projectId: 'a', isMilestone: true }),
      task({ projectId: 'b' }),
      task({ projectId: 'b' }),
      task({ projectId: 'b' }),
    ]);
    expect(fact(b.facts, 'projets_a_risque').value).toBe('2');
  });

  it('sans work.read : faits masqués, R8 et R9 non évaluées (critère n° 16)', () => {
    const b = buildMorningBrief(input([], { work: 'hidden' }));
    for (const id of [
      'mes_taches.en_retard',
      'mes_taches.aujourdhui',
      'taches.en_retard',
      'projets_a_risque',
    ]) {
      expect(fact(b.facts, id)).toMatchObject({ status: 'hidden', value: null });
    }
    expect(b.rulesSkipped).toEqual(
      expect.arrayContaining([
        { ruleId: 'taches_en_retard', reason: 'hidden' },
        { ruleId: 'jalon_depasse', reason: 'hidden' },
      ]),
    );
  });

  it('lecture bornée des tâches : le brief le dit', () => {
    expect(buildMorningBrief(input([], work([], true))).truncated).toBe(true);
    expect(buildMorningBrief(input([], work([], false))).truncated).toBe(false);
  });

  it('version mineure suivante (ADR-0040 — C4)', () => {
    expect(brief([]).version).toBe('1.2.0');
  });

  it('les dix règles ont des rangs uniques', () => {
    const ranks = MORNING_BRIEF_RULES.map((r) => r.rank);
    expect(new Set(ranks).size).toBe(ranks.length);
    expect(ranks.length).toBe(10);
  });
});

describe('relances du CRM — faits, pipeline et règle R10 (ADR-0040 — C4 § 5.5)', () => {
  // NOW = 21 oct. 2026 à Kinshasa.
  function crm(
    activities: BriefCrmActivityInput[],
    openOpportunityCount = 0,
    truncated = false,
  ): Partial<MorningBriefInput> {
    return { crm: { status: 'known', activities, openOpportunityCount, truncated } };
  }

  it('compte mes relances en retard et du jour, et les retards de l’organisation', () => {
    const b = buildMorningBrief(
      input(
        [],
        crm(
          [
            { dueDay: '2026-10-20', mine: true },
            { dueDay: '2026-09-01', mine: true },
            { dueDay: '2026-10-21', mine: true },
            { dueDay: '2026-10-19', mine: false },
            { dueDay: '2026-10-21', mine: false },
          ],
          4,
        ),
      ),
    );
    expect(fact(b.facts, 'mes_relances.en_retard').value).toBe('2');
    expect(fact(b.facts, 'mes_relances.aujourdhui').value).toBe('1');
    expect(fact(b.facts, 'relances.en_retard').value).toBe('3');
    expect(fact(b.facts, 'pipeline')).toMatchObject({ status: 'known', value: '4', kind: 'count' });
  });

  it('jour de Kinshasa : à 23 h 30 UTC, l’échéance de la veille UTC est dépassée', () => {
    const b = buildMorningBrief(
      input([], {
        now: '2026-10-21T23:30:00.000Z',
        ...crm([{ dueDay: '2026-10-21', mine: true }]),
      }),
    );
    expect(fact(b.facts, 'mes_relances.en_retard').value).toBe('1');
  });

  it('R10 : deux relances en retard (critère 11), rang 10, vers Mes tâches', () => {
    const b = buildMorningBrief(
      input(
        [],
        crm([
          { dueDay: '2026-10-20', mine: true },
          { dueDay: '2026-10-01', mine: true },
        ]),
      ),
    );
    const r10 = b.recommendations.find((r) => r.ruleId === 'relances_en_retard');
    expect(r10).toMatchObject({
      severity: 'attention',
      rank: 10,
      actionPath: '/projets/mes-taches',
      factIds: ['mes_relances.en_retard'],
      threshold: null,
    });
    expect(r10?.message).toBe('2 relances clients ont dépassé leur échéance.');
  });

  it('R10 : au seuil exact (aucune relance à moi en retard), rien', () => {
    const b = buildMorningBrief(input([], crm([{ dueDay: '2026-10-20', mine: false }])));
    expect(b.recommendations.map((r) => r.ruleId)).not.toContain('relances_en_retard');
  });

  it('sans crm.read : faits masqués (pipeline compris), R10 non évaluée', () => {
    const b = buildMorningBrief(input([], { crm: 'hidden' }));
    for (const id of [
      'mes_relances.en_retard',
      'mes_relances.aujourdhui',
      'relances.en_retard',
      'pipeline',
    ]) {
      expect(fact(b.facts, id)).toMatchObject({ status: 'hidden', value: null });
    }
    expect(b.rulesSkipped).toContainEqual({ ruleId: 'relances_en_retard', reason: 'hidden' });
  });

  it('sans source CRM (entrée absente) : non disponible, jamais zéro', () => {
    const { crm: _omis, ...sans } = input([]);
    const b = buildMorningBrief(sans);
    expect(fact(b.facts, 'pipeline')).toMatchObject({ status: 'unavailable', value: null });
    expect(b.rulesSkipped).toContainEqual({ ruleId: 'relances_en_retard', reason: 'unavailable' });
  });

  it('lecture bornée des relances : le brief le dit', () => {
    expect(buildMorningBrief(input([], crm([], 0, true))).truncated).toBe(true);
  });
});
