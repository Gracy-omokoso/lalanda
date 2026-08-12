// Règle de quota IA — fonction pure, aucune base, aucune horloge réelle.
//
// Les cinq exigences du lot sont couvertes ici pour la partie DÉCISION :
// quota atteint, quota réinitialisé, offre illimitée, repli non compté, et un
// refus qui dit laquelle et quand. Le branchement HTTP est couvert par
// `apps/api/src/ai/ai-quota.service.test.ts`.

import { PLAN_ENTITLEMENTS } from '@lalanda/shared/pricing';
import { describe, expect, it } from 'vitest';

import {
  AI_MESSAGES_QUOTA,
  AI_QUOTA_ERROR_CODE,
  aiQuotaExceededPayload,
  aiQuotaStatus,
  consumesQuota,
} from './ai-quota.js';

// Milieu de mois : ni le 1er (fenêtre qui vient de s'ouvrir), ni le 31.
const MI_AOUT = new Date('2026-08-12T10:00:00.000Z');

describe('état du quota IA', () => {
  it('décompte les messages consommés sur une offre plafonnée', () => {
    const s = aiQuotaStatus('pro', PLAN_ENTITLEMENTS.pro, 120, MI_AOUT);
    expect(s.limit).toBe(500);
    expect(s.used).toBe(120);
    expect(s.remaining).toBe(380);
    expect(s.unlimited).toBe(false);
    expect(s.exceeded).toBe(false);
  });

  it('déclare le quota atteint À la limite, pas au-delà', () => {
    // 500 sur 500 : le 501e appel doit être refusé, pas le 502e. Un `>` au lieu
    // d'un `>=` offrirait systématiquement un message de plus que le vendu.
    const pile = aiQuotaStatus('pro', PLAN_ENTITLEMENTS.pro, 500, MI_AOUT);
    expect(pile.exceeded).toBe(true);
    expect(pile.remaining).toBe(0);

    const juste = aiQuotaStatus('pro', PLAN_ENTITLEMENTS.pro, 499, MI_AOUT);
    expect(juste.exceeded).toBe(false);
    expect(juste.remaining).toBe(1);
  });

  it('ne descend jamais en dessous de zéro restant', () => {
    // Un dépassement reste possible (course entre deux appels concurrents) :
    // « -3 messages restants » s'afficherait tel quel dans l'interface.
    const s = aiQuotaStatus('free', PLAN_ENTITLEMENTS.free, 23, MI_AOUT);
    expect(s.remaining).toBe(0);
    expect(s.exceeded).toBe(true);
  });

  it('traite un compteur absurde comme zéro plutôt que de le propager', () => {
    for (const used of [-5, Number.NaN, Number.POSITIVE_INFINITY * 0]) {
      expect(aiQuotaStatus('pro', PLAN_ENTITLEMENTS.pro, used, MI_AOUT).used).toBe(0);
    }
  });

  // ── Offre illimitée ────────────────────────────────────────────────────────

  it('n’oppose jamais de limite à une offre illimitée', () => {
    // Expert : `aiMessagesPerMonth: null`. `null` veut dire ILLIMITÉ, jamais
    // « inconnu » ni « zéro » — le confondre avec 0 bloquerait l'offre la plus
    // chère au premier message.
    const s = aiQuotaStatus('expert', PLAN_ENTITLEMENTS.expert, 999_999, MI_AOUT);
    expect(s.unlimited).toBe(true);
    expect(s.limit).toBeNull();
    // `null` et non un grand nombre : « 9 999 restants » serait un mensonge
    // chiffré, et une interface qui affiche une jauge la remplirait.
    expect(s.remaining).toBeNull();
    expect(s.exceeded).toBe(false);
  });

  it('refuse de construire un refus pour une offre illimitée', () => {
    const s = aiQuotaStatus('expert', PLAN_ENTITLEMENTS.expert, 10, MI_AOUT);
    expect(() => aiQuotaExceededPayload(s)).toThrow(/sans limite/);
  });

  // ── Réinitialisation ───────────────────────────────────────────────────────

  it('réinitialise au 1er du mois suivant, à minuit UTC', () => {
    const s = aiQuotaStatus('pro', PLAN_ENTITLEMENTS.pro, 500, MI_AOUT);
    expect(s.windowStart.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(s.resetAt.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('passe l’année sans se tromper de mois', () => {
    const s = aiQuotaStatus('pro', PLAN_ENTITLEMENTS.pro, 0, new Date('2026-12-20T23:00:00.000Z'));
    expect(s.resetAt.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('repart à zéro dans la fenêtre suivante', () => {
    // Le compteur n'est pas « remis à zéro » : la fenêtre change, donc la
    // consommation lue change avec elle. Il n'y a aucune remise à zéro à rater.
    const epuise = aiQuotaStatus('free', PLAN_ENTITLEMENTS.free, 20, MI_AOUT);
    expect(epuise.exceeded).toBe(true);

    const septembre = new Date('2026-09-01T00:00:01.000Z');
    const apres = aiQuotaStatus('free', PLAN_ENTITLEMENTS.free, 0, septembre);
    expect(apres.exceeded).toBe(false);
    expect(apres.remaining).toBe(20);
    expect(apres.windowStart.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('n’annonce jamais « 0 jour » avant la réinitialisation', () => {
    // Le 31 à 23 h, il reste moins d'une heure : « dans 0 jour » se lit
    // « maintenant » alors que le quota n'est pas encore reparti.
    const s = aiQuotaStatus(
      'pro',
      PLAN_ENTITLEMENTS.pro,
      500,
      new Date('2026-08-31T23:10:00.000Z'),
    );
    expect(s.resetInDays).toBe(1);
  });

  it('compte les jours restants en arrondissant vers le haut', () => {
    const s = aiQuotaStatus(
      'pro',
      PLAN_ENTITLEMENTS.pro,
      500,
      new Date('2026-08-29T12:00:00.000Z'),
    );
    // 2 jours et 12 h → 3, jamais 2 : mieux vaut promettre un peu tard.
    expect(s.resetInDays).toBe(3);
  });
});

describe('refus opposé à un dépassement', () => {
  const status = aiQuotaStatus('free', PLAN_ENTITLEMENTS.free, 20, MI_AOUT);
  const payload = aiQuotaExceededPayload(status);

  it('nomme LAQUELLE des limites est atteinte', () => {
    // Un « 403 » nu ne dit ni ce qui est bloqué, ni pour combien de temps.
    expect(payload.code).toBe(AI_QUOTA_ERROR_CODE);
    expect(payload.quota).toBe(AI_MESSAGES_QUOTA);
    expect(payload.plan).toBe('free');
    expect(payload.limit).toBe(20);
    expect(payload.used).toBe(20);
  });

  it('dit QUAND le quota se réinitialise, en machine et en français', () => {
    expect(payload.resetAt).toBe('2026-09-01T00:00:00.000Z');
    expect(payload.resetInDays).toBe(20);
    expect(payload.message).toContain('1er du mois prochain');
    expect(payload.message).toContain('20 jours');
  });

  it('dit « demain » plutôt que « dans 1 jours »', () => {
    const veille = aiQuotaStatus(
      'free',
      PLAN_ENTITLEMENTS.free,
      20,
      new Date('2026-08-31T12:00:00.000Z'),
    );
    expect(aiQuotaExceededPayload(veille).message).toContain('demain');
  });

  it('rassure sur ce qui reste accessible', () => {
    // Un quota IA épuisé ne coupe ni les projets ni les exports. Le taire
    // laisserait croire à une suspension de compte.
    expect(payload.message).toContain('projets');
    expect(payload.message).toContain('exports');
  });

  it('indique où lever la limite', () => {
    expect(payload.upgradeUrl).toBe('/pricing');
  });
});

describe('ce qui consomme du quota', () => {
  it('ne compte QUE les réponses réellement produites par le modèle', () => {
    expect(consumesQuota('llm')).toBe(true);
    // Un repli déterministe n'appelle aucun modèle : il survient quand aucune
    // clé n'est configurée, quand le réseau tombe, ou quand la réponse est
    // refusée par le schéma. Le facturer ferait payer une panne de NOTRE
    // configuration — et viderait un quota gratuit en vingt requêtes le jour où
    // une clé expire.
    expect(consumesQuota('fallback')).toBe(false);
  });
});
