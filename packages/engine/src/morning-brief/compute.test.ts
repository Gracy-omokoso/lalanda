import { describe, expect, it } from 'vitest';

import {
  MORNING_BRIEF_RULES,
  MORNING_BRIEF_THRESHOLDS,
  buildMorningBrief,
  buildMorningBriefFacts,
  formatFr,
  kinshasaDay,
} from './compute.js';
import type { BriefFact, BriefInvoiceInput, MorningBriefInput } from './types.js';

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
    amountOnCredit: null,
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

describe('créances déclarées', () => {
  it('somme la part à crédit, moins les avoirs à crédit imputés sur l’origine, jamais sous zéro', () => {
    const a = inv({ amountOnCredit: '600.00' });
    const b = inv({ amountOnCredit: '100.00' });
    const facts = buildMorningBriefFacts(
      input([
        a,
        b,
        inv({ type: 'FA', creditNoteOriginId: a.id, amountOnCredit: '200.00' }),
        inv({ type: 'FA', creditNoteOriginId: b.id, amountOnCredit: '150.00' }),
        inv({ currency: 'USD', amountOnCredit: '40.00' }),
        // Un avoir en brouillon ne réduit rien.
        inv({ type: 'FA', status: 'draft', creditNoteOriginId: a.id, amountOnCredit: '600.00' }),
      ]),
    );
    expect(fact(facts, 'creances.CDF').value).toBe('400.00');
    expect(fact(facts, 'creances.USD').value).toBe('40.00');
  });

  it('isole les créances de plus de 30 jours (seuil S4), y compris des mois passés', () => {
    const facts = buildMorningBriefFacts(
      input([
        inv({ issuedAt: '2026-09-20T07:59:00.000Z', amountOnCredit: '70.00' }), // 31 jours
        inv({ issuedAt: '2026-09-21T08:00:00.000Z', amountOnCredit: '30.00' }), // 30 jours pile
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
      input([inv({ issuedAt: '2026-08-01T10:00:00.000Z', amountOnCredit: '1234567.50' })]),
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
        inv({ issuedAt: '2026-08-01T10:00:00.000Z', amountOnCredit: '10.00' }),
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
    const brief = buildMorningBrief(input([]));
    for (const id of ['echeances.depassees', 'pipeline', 'taches_en_retard', 'projets_a_risque']) {
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
      inv({ amountOnCredit: '5.00' }),
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
