// Limite de projets — et le cas réel qui a motivé ce module.
//
// EN PRODUCTION, au moment de la bascule de grille : 7 organisations, 9 projets.
// Une organisation en détient 5. L'offre gratuite en autorise 1. Le décideur a
// tranché « aucune antériorité », donc cette organisation se retrouve au-dessus
// de sa limite sans avoir rien fait.
//
// Ce fichier fixe ce qui doit arriver dans ce cas, pour que personne ne
// « simplifie » plus tard en supprimant, archivant ou masquant des plans
// financiers existants.

import { PLAN_ENTITLEMENTS } from '@lalanda/shared/pricing';
import { describe, expect, it } from 'vitest';

import {
  cheapestPlanFor,
  PROJECT_LIMIT_ERROR_CODE,
  projectLimitExceededPayload,
  projectLimitStatus,
} from './project-limit.js';

describe('état de la limite de projets', () => {
  it('laisse créer tant que la limite n’est pas atteinte', () => {
    const s = projectLimitStatus('cabinet', PLAN_ENTITLEMENTS.cabinet, 12);
    expect(s.limit).toBe(20);
    expect(s.remaining).toBe(8);
    expect(s.blocked).toBe(false);
    expect(s.overLimit).toBe(false);
  });

  it('bloque À la limite sans parler de dépassement', () => {
    // Pile à la limite : l'utilisateur a consommé ce qu'il a acheté. Ce n'est pas
    // un dépassement, et le lui dire ainsi serait une accusation gratuite.
    const s = projectLimitStatus('free', PLAN_ENTITLEMENTS.free, 1);
    expect(s.blocked).toBe(true);
    expect(s.overLimit).toBe(false);
    expect(s.excess).toBe(0);
  });

  it('distingue le dépassement de la limite atteinte', () => {
    const s = projectLimitStatus('free', PLAN_ENTITLEMENTS.free, 5);
    expect(s.blocked).toBe(true);
    expect(s.overLimit).toBe(true);
    expect(s.excess).toBe(4);
    // Jamais négatif : « -4 projets restants » s'afficherait tel quel.
    expect(s.remaining).toBe(0);
  });

  it('n’oppose aucune limite à une offre illimitée', () => {
    const s = projectLimitStatus('business', PLAN_ENTITLEMENTS.business, 400);
    expect(s.unlimited).toBe(true);
    expect(s.blocked).toBe(false);
    expect(s.overLimit).toBe(false);
    expect(s.remaining).toBeNull();
  });
});

describe('offre suggérée', () => {
  it('propose la moins chère qui couvre le besoin, pas la plus riche', () => {
    // Proposer Business à qui a besoin d'un 6e projet serait une vente forcée :
    // Cabinet (20) suffit, et Pro (5) ne suffit pas.
    expect(cheapestPlanFor(2)).toBe('pro');
    expect(cheapestPlanFor(5)).toBe('pro');
    expect(cheapestPlanFor(6)).toBe('cabinet');
    expect(cheapestPlanFor(20)).toBe('cabinet');
    expect(cheapestPlanFor(21)).toBe('business');
  });

  it('ne propose jamais une offre qui ne se souscrit pas en ligne', () => {
    // Expert couvrirait n'importe quel volume, mais il n'a pas de tunnel : le
    // proposer comme solution en un clic promettrait ce qui ne se livre pas sans
    // accord commercial.
    for (const besoin of [1, 6, 21, 10_000]) {
      expect(cheapestPlanFor(besoin)).not.toBe('expert');
      expect(cheapestPlanFor(besoin)).not.toBe('free');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LE CAS DE PRODUCTION
// ─────────────────────────────────────────────────────────────────────────────

describe('organisation à 5 projets sur une offre qui en autorise 1', () => {
  const status = projectLimitStatus('free', PLAN_ENTITLEMENTS.free, 5);
  const refus = projectLimitExceededPayload(status);

  it('refuse la création d’un projet supplémentaire', () => {
    expect(status.blocked).toBe(true);
    expect(refus.code).toBe(PROJECT_LIMIT_ERROR_CODE);
    expect(refus.quota).toBe('projects');
  });

  it('dit combien l’organisation en a, et combien l’offre autorise', () => {
    expect(refus.used).toBe(5);
    expect(refus.limit).toBe(1);
    expect(refus.excess).toBe(4);
    expect(refus.message).toContain('5 projets');
    expect(refus.message).toContain('autorise 1');
    expect(refus.message).toContain('Free');
  });

  it('dit explicitement que rien n’est perdu ni fermé', () => {
    // LE point du test. Un utilisateur qui voit « limite dépassée » sur cinq
    // dossiers bancaires en cours doit lire, dans la même phrase, qu'ils sont
    // intacts. Sans cela il croit son compte suspendu.
    expect(refus.message).toContain('accessibles');
    expect(refus.message).toContain('modifiables');
    expect(refus.message).toContain('exportables');
    expect(refus.message).toContain("rien n'a été supprimé");
    expect(refus.message).toContain('Seule la création');
  });

  it('dit ce que l’utilisateur peut faire, sans le forcer', () => {
    // Deux voies, et la seconde ne coûte rien : monter en gamme OU supprimer
    // soi-même. Ne proposer que la première serait une vente sous contrainte.
    expect(refus.suggestedPlan).toBe('cabinet');
    expect(refus.message).toContain('Cabinet');
    expect(refus.message).toContain('supprimez un projet existant');
    expect(refus.upgradeUrl).toBe('/pricing');
  });

  it('ne menace jamais de suppression automatique', () => {
    // docs/13 § Changements de plan : « aucune suppression automatique de
    // projet ». Le message ne doit pas suggérer le contraire.
    const bas = refus.message.toLowerCase();
    for (const menace of [
      'sera supprimé',
      'seront supprimés',
      'archivé',
      'suspendu votre compte',
    ]) {
      expect(bas).not.toContain(menace);
    }
  });
});

describe('organisation pile à la limite', () => {
  const refus = projectLimitExceededPayload(projectLimitStatus('pro', PLAN_ENTITLEMENTS.pro, 5));

  it('constate sans accuser d’un dépassement', () => {
    expect(refus.excess).toBe(0);
    expect(refus.message).toContain('totalité des 5');
    // Il n'y a AUCUN dépassement : parler de projets « au-delà » serait faux.
    expect(refus.message).not.toContain('alors que');
  });

  it('propose le palier immédiatement supérieur', () => {
    expect(refus.suggestedPlan).toBe('cabinet');
  });
});

describe('garde-fou', () => {
  it('refuse de construire un refus pour une offre illimitée', () => {
    const s = projectLimitStatus('business', PLAN_ENTITLEMENTS.business, 99);
    expect(() => projectLimitExceededPayload(s)).toThrow(/sans limite/);
  });
});
