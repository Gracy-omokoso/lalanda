// Tests unitaires du service d'actions correctives (S14a — agent D).
// Aucun appel réseau réel : le client OpenAI est mocké intégralement.

import { describe, expect, it, vi } from 'vitest';

import {
  AiActionsService,
  buildFallbackActions,
  extractProblematiques,
  parseLlmActions,
  type OpenAIChatClient,
} from './ai-actions.service.js';
import type { EvaluateLine } from './ai-actions.dto.js';

/** Fabrique une ligne "ratio" typée avec seuil. */
function ratioLine(
  lineId: string,
  label: string,
  value: number,
  seuilValeur: number,
  statut: 'vert' | 'orange' | 'rouge',
  direction: 'min' | 'max',
  format: 'money' | 'number' | 'percent' = 'number',
): EvaluateLine {
  return {
    sheetId: 'ratios',
    lineId,
    label,
    value,
    format,
    seuil: { valeur: seuilValeur, direction, statut },
  };
}

describe('extractProblematiques', () => {
  it('ignore les lignes sans seuil et les vertes', () => {
    const lines: EvaluateLine[] = [
      { sheetId: 'ratios', lineId: 'ca', label: 'CA', value: 1000, format: 'money' },
      ratioLine('dscr', 'DSCR', 2, 1.25, 'vert', 'min'),
      ratioLine('apport_pct', 'Apport', 0.3, 0.25, 'vert', 'min', 'percent'),
    ];
    expect(extractProblematiques(lines)).toEqual([]);
  });

  it('trie rouge avant orange et limite à 4', () => {
    const lines: EvaluateLine[] = [
      ratioLine('a', 'A', 1, 2, 'orange', 'min'),
      ratioLine('b', 'B', 1, 2, 'rouge', 'min'),
      ratioLine('c', 'C', 1, 2, 'orange', 'min'),
      ratioLine('d', 'D', 1, 2, 'rouge', 'min'),
      ratioLine('e', 'E', 1, 2, 'rouge', 'min'),
    ];
    const out = extractProblematiques(lines);
    expect(out).toHaveLength(4);
    expect(out.slice(0, 3).every((p) => p.severity === 'rouge')).toBe(true);
  });
});

describe('buildFallbackActions — un cas par ratio surveillé', () => {
  it('DSCR rouge : suggestion parle de service de la dette et cite le seuil', () => {
    const p = extractProblematiques([
      ratioLine('dscr', 'DSCR (couverture)', 0.8, 1.25, 'rouge', 'min'),
    ]);
    const [a] = buildFallbackActions(p);
    expect(a?.ratio).toBe('dscr');
    expect(a?.severity).toBe('rouge');
    expect(a?.suggestion).toMatch(/dette|EBE|amortissement/i);
    expect(a?.expected_impact).toContain('1,25');
  });

  it("apport_pct rouge : suggestion parle d'apport et cite le seuil en %", () => {
    const p = extractProblematiques([
      ratioLine('apport_pct', 'Apport', 0.1, 0.25, 'rouge', 'min', 'percent'),
    ]);
    const [a] = buildFallbackActions(p);
    expect(a?.ratio).toBe('apport_pct');
    expect(a?.suggestion).toMatch(/apport|co-investisseur|épargne/i);
    expect(a?.expected_impact).toContain('25,0 %');
  });

  it('payback_annees rouge : suggestion parle de retour sur investissement', () => {
    const p = extractProblematiques([ratioLine('payback_annees', 'Payback', 7, 5, 'rouge', 'max')]);
    const [a] = buildFallbackActions(p);
    expect(a?.ratio).toBe('payback_annees');
    expect(a?.suggestion).toMatch(/investissement|marge|phaser/i);
    expect(a?.expected_impact).toContain('5,00');
  });

  it('tresorerie_min_ok rouge : suggestion parle de trésorerie et cite la devise', () => {
    const p = extractProblematiques([
      ratioLine('tresorerie_min_ok', 'Trésorerie mini', -500, 0, 'rouge', 'min', 'money'),
    ]);
    const [a] = buildFallbackActions(p, 'USD');
    expect(a?.ratio).toBe('tresorerie_min_ok');
    expect(a?.suggestion).toMatch(/trésorerie|réserve|caisse/i);
    expect(a?.expected_impact).toMatch(/USD/);
  });

  it('ratio inconnu → action générique fournie sans exception', () => {
    const p = extractProblematiques([ratioLine('autre_ratio', 'Autre', 0.5, 1, 'orange', 'min')]);
    const [a] = buildFallbackActions(p);
    expect(a?.ratio).toBe('autre_ratio');
    expect(a?.severity).toBe('orange');
    expect(a?.suggestion).toBeTruthy();
    expect(a?.expected_impact).toBeTruthy();
  });
});

describe('AiActionsService.correctiveActions', () => {
  const lignesRouges: EvaluateLine[] = [
    ratioLine('dscr', 'DSCR', 0.9, 1.25, 'rouge', 'min'),
    ratioLine('apport_pct', 'Apport', 0.1, 0.25, 'rouge', 'min', 'percent'),
  ];

  it('sans client OpenAI → fallback déterministe, source = "fallback"', async () => {
    const svc = new AiActionsService(null);
    const res = await svc.correctiveActions({
      templateSlug: 'x',
      drivers: {},
      lines: lignesRouges,
    });
    expect(res.source).toBe('fallback');
    expect(res.actions).toHaveLength(2);
    expect(res.actions.map((a) => a.ratio).sort()).toEqual(['apport_pct', 'dscr']);
  });

  it('sans ratio problématique → 0 action, aucun appel LLM', async () => {
    const mock = { chatJson: vi.fn() };
    const svc = new AiActionsService(mock as unknown as OpenAIChatClient);
    const res = await svc.correctiveActions({
      templateSlug: 'x',
      drivers: {},
      lines: [ratioLine('dscr', 'DSCR', 2, 1.25, 'vert', 'min')],
    });
    expect(res.actions).toEqual([]);
    expect(mock.chatJson).not.toHaveBeenCalled();
  });

  it('avec client OpenAI valide → source = "llm" et actions parsées', async () => {
    const llmPayload = JSON.stringify({
      actions: [
        {
          ratio: 'dscr',
          severity: 'rouge',
          suggestion: 'Renégocier la durée du prêt',
          expected_impact: 'DSCR remonte vers 1.25',
        },
        {
          ratio: 'apport_pct',
          severity: 'rouge',
          suggestion: 'Chercher un co-investisseur',
          expected_impact: 'Apport à 25 %',
        },
      ],
    });
    const client: OpenAIChatClient = {
      chatJson: vi.fn().mockResolvedValue(llmPayload),
    };
    const svc = new AiActionsService(client);
    const res = await svc.correctiveActions({
      templateSlug: 'x',
      drivers: {},
      lines: lignesRouges,
    });
    expect(res.source).toBe('llm');
    expect(res.actions).toHaveLength(2);
    expect(res.actions[0]?.suggestion).toContain('prêt');
  });

  it('LLM renvoie du JSON malformé → fallback silencieux, source = "fallback"', async () => {
    const client: OpenAIChatClient = {
      chatJson: vi.fn().mockResolvedValue('{ not json'),
    };
    const svc = new AiActionsService(client);
    const res = await svc.correctiveActions({
      templateSlug: 'x',
      drivers: {},
      lines: lignesRouges,
    });
    expect(res.source).toBe('fallback');
    expect(res.actions).toHaveLength(2);
  });

  it('LLM invente un ratio hors périmètre → refus par parseLlmActions', () => {
    const raw = JSON.stringify({
      actions: [
        {
          ratio: 'ratio_bidon',
          severity: 'rouge',
          suggestion: 'Faire quelque chose',
          expected_impact: 'Truc',
        },
      ],
    });
    const p = extractProblematiques(lignesRouges);
    expect(() => parseLlmActions(raw, p)).toThrow(/hors périmètre/);
  });

  it('LLM renvoie une action sans champ requis → zod refuse', () => {
    const raw = JSON.stringify({
      actions: [{ ratio: 'dscr', severity: 'rouge', suggestion: 'x' }],
    });
    const p = extractProblematiques(lignesRouges);
    expect(() => parseLlmActions(raw, p)).toThrow();
  });

  it('LLM renvoie 5 actions → refus (> 4)', () => {
    const raw = JSON.stringify({
      actions: Array.from({ length: 5 }, () => ({
        ratio: 'dscr',
        severity: 'rouge',
        suggestion: 'x',
        expected_impact: 'y',
      })),
    });
    const p = extractProblematiques(lignesRouges);
    expect(() => parseLlmActions(raw, p)).toThrow(/Trop d'actions/);
  });

  it('LLM lève une erreur réseau → fallback silencieux', async () => {
    const client: OpenAIChatClient = {
      chatJson: vi.fn().mockRejectedValue(new Error('ECONNRESET')),
    };
    const svc = new AiActionsService(client);
    const res = await svc.correctiveActions({
      templateSlug: 'x',
      drivers: {},
      lines: lignesRouges,
    });
    expect(res.source).toBe('fallback');
    expect(res.actions).toHaveLength(2);
  });
});
