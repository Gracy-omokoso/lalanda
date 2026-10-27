// ADR-0036 § 3 — passage d'une idée vers le Canvas : cartes de texte seulement,
// idempotent, cartes existantes conservées, bloc plein signalé.

import { describe, expect, it } from 'vitest';

import { emptyCanvasBlocks } from '../canvas/canvas.schema.js';
import { planPromotion, promotedCardId } from './idea-lab-promotion.js';

const IDEA = {
  id: '0123456789abcdef01234567',
  problem: 'Les commerçantes perdent leurs invendus.',
  solution: 'Chambre froide partagée au marché.',
  target: 'Commerçantes du marché de la Liberté',
  revenueModel: 'Location à la journée',
};

describe('planPromotion', () => {
  it('recopie quatre champs en cartes, aux blocs prévus, sans transformation', () => {
    const plan = planPromotion(emptyCanvasBlocks(), IDEA);
    expect(plan.added.map((a) => [a.field, a.bloc])).toEqual([
      ['probleme', 'proposition_valeur'],
      ['solution', 'proposition_valeur'],
      ['cible', 'segments_clients'],
      ['revenus', 'revenus'],
    ]);
    expect(plan.blocs.proposition_valeur.map((c) => c.texte)).toEqual([
      'Problème : Les commerçantes perdent leurs invendus.',
      'Solution : Chambre froide partagée au marché.',
    ]);
    expect(plan.blocs.segments_clients[0]).toEqual({
      id: promotedCardId(IDEA.id, 'cible'),
      texte: IDEA.target,
      ordre: 0,
    });
    // Aucun autre bloc n'est touché : ni coûts, ni ressources, ni montants.
    expect(plan.blocs.couts).toEqual([]);
    expect(promotedCardId(IDEA.id, 'probleme')).toMatch(/^[a-z0-9][a-z0-9_-]*$/);
    expect(promotedCardId(IDEA.id, 'probleme').length).toBeLessThanOrEqual(64);
  });

  it('idempotent : une seconde promotion n’ajoute rien et ne réécrit pas une carte modifiée', () => {
    const first = planPromotion(emptyCanvasBlocks(), IDEA);
    const edited = first.blocs;
    edited.segments_clients[0] = { ...edited.segments_clients[0]!, texte: 'Texte retouché' };
    const second = planPromotion(edited, IDEA);
    expect(second.added).toEqual([]);
    expect(second.present).toHaveLength(4);
    expect(second.blocs.segments_clients[0]!.texte).toBe('Texte retouché');
  });

  it('conserve les cartes existantes, ordre à la suite ; champs vides non recopiés', () => {
    const blocs = emptyCanvasBlocks();
    blocs.revenus = [{ id: 'ma-carte', texte: 'Vente directe', ordre: 4 }];
    const plan = planPromotion(blocs, { ...IDEA, problem: '  ', solution: '' });
    expect(plan.empty).toEqual(['probleme', 'solution']);
    expect(plan.blocs.revenus.map((c) => [c.id, c.ordre])).toEqual([
      ['ma-carte', 4],
      [promotedCardId(IDEA.id, 'revenus'), 5],
    ]);
    // L'entrée n'est pas modifiée.
    expect(blocs.revenus).toHaveLength(1);
  });

  it('bloc plein : carte ignorée et signalée ; texte long tronqué à 500', () => {
    const blocs = emptyCanvasBlocks();
    blocs.segments_clients = Array.from({ length: 20 }, (_, i) => ({
      id: `c${i}`,
      texte: `carte ${i}`,
      ordre: i,
    }));
    const plan = planPromotion(blocs, { ...IDEA, revenueModel: 'x'.repeat(700) });
    expect(plan.ignored).toEqual([
      { field: 'cible', bloc: 'segments_clients', reason: 'BLOC_PLEIN' },
    ]);
    const rev = plan.added.find((a) => a.field === 'revenus')!;
    expect(rev.truncated).toBe(true);
    expect(plan.blocs.revenus[0]!.texte).toHaveLength(500);
  });
});
