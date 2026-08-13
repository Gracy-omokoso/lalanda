// Règle de quota d'exports PDF — fonction pure, aucune base, aucune horloge réelle.
//
// Les cinq exigences du lot sont couvertes ici pour la partie DÉCISION : quota
// atteint, quota réinitialisé au mois suivant, offre illimitée, rendu échoué non
// compté, et un refus qui dit LAQUELLE des limites et QUAND elle repart. Le
// branchement base + HTTP est couvert par `pdf-export-quota.service.test.ts`, et
// la garantie « l'Excel n'est jamais bloqué » par
// `reports/reports.controller.quota.test.ts`.
//
// Ce fichier est le jumeau de `ai-quota.test.ts` : même découpage, mêmes
// questions posées dans le même ordre. Deux quotas testés différemment
// divergeraient à la première correction.

import { PLAN_ENTITLEMENTS } from '@lalanda/shared/pricing';
import { describe, expect, it } from 'vitest';

import {
  PDF_EXPORTS_QUOTA,
  PDF_EXPORT_QUOTA_ERROR_CODE,
  consumesPdfExportQuota,
  pdfExportQuotaExceededPayload,
  pdfExportQuotaStatus,
} from './pdf-export-quota.js';

// Milieu de mois : ni le 1er (fenêtre qui vient de s'ouvrir), ni le 31.
const MI_AOUT = new Date('2026-08-12T10:00:00.000Z');

describe('état du quota d’exports PDF', () => {
  it('lit le plafond dans le catalogue partagé, sans le réécrire', () => {
    // La grille publique vend 3 / 30 / 100 / illimités. Ces nombres ne sont PAS
    // recopiés ici : ils viennent de `PLAN_CATALOG`, et ce test échoue si un
    // jour la règle se met à porter sa propre copie.
    expect(pdfExportQuotaStatus('free', PLAN_ENTITLEMENTS.free, 0, MI_AOUT).limit).toBe(3);
    expect(pdfExportQuotaStatus('pro', PLAN_ENTITLEMENTS.pro, 0, MI_AOUT).limit).toBe(30);
    expect(pdfExportQuotaStatus('cabinet', PLAN_ENTITLEMENTS.cabinet, 0, MI_AOUT).limit).toBe(100);
    expect(
      pdfExportQuotaStatus('business', PLAN_ENTITLEMENTS.business, 0, MI_AOUT).limit,
    ).toBeNull();
  });

  it('décompte les exports consommés sur une offre plafonnée', () => {
    const s = pdfExportQuotaStatus('pro', PLAN_ENTITLEMENTS.pro, 12, MI_AOUT);
    expect(s.used).toBe(12);
    expect(s.remaining).toBe(18);
    expect(s.unlimited).toBe(false);
    expect(s.exceeded).toBe(false);
  });

  // ── Quota atteint ──────────────────────────────────────────────────────────

  it('déclare le quota atteint À la limite, pas au-delà', () => {
    // 3 sur 3 : le 4e export doit être refusé, pas le 5e. Un `>` au lieu d'un
    // `>=` offrirait systématiquement un rendu Chromium de plus que le vendu.
    const pile = pdfExportQuotaStatus('free', PLAN_ENTITLEMENTS.free, 3, MI_AOUT);
    expect(pile.exceeded).toBe(true);
    expect(pile.remaining).toBe(0);

    const juste = pdfExportQuotaStatus('free', PLAN_ENTITLEMENTS.free, 2, MI_AOUT);
    expect(juste.exceeded).toBe(false);
    expect(juste.remaining).toBe(1);
  });

  it('ne descend jamais en dessous de zéro restant', () => {
    // Un dépassement reste possible (deux exports lancés en même temps) :
    // « -1 export restant » s'afficherait tel quel dans l'interface.
    const s = pdfExportQuotaStatus('free', PLAN_ENTITLEMENTS.free, 4, MI_AOUT);
    expect(s.remaining).toBe(0);
    expect(s.exceeded).toBe(true);
  });

  it('traite un compteur absurde comme zéro plutôt que de le propager', () => {
    for (const used of [-5, Number.NaN, Number.POSITIVE_INFINITY * 0]) {
      expect(pdfExportQuotaStatus('pro', PLAN_ENTITLEMENTS.pro, used, MI_AOUT).used).toBe(0);
    }
  });

  // ── Offre illimitée ────────────────────────────────────────────────────────

  it('n’oppose jamais de limite à une offre illimitée', () => {
    // Business et Expert : `pdfExportsPerMonth: null`. `null` veut dire
    // ILLIMITÉ, jamais « inconnu » ni « zéro » — le confondre avec 0 bloquerait
    // au premier export les deux offres qui promettent l'illimité.
    for (const plan of ['business', 'expert'] as const) {
      const s = pdfExportQuotaStatus(plan, PLAN_ENTITLEMENTS[plan], 999_999, MI_AOUT);
      expect(s.unlimited).toBe(true);
      expect(s.limit).toBeNull();
      // `null` et non un grand nombre : une jauge d'interface remplirait
      // « 9 999 restants ».
      expect(s.remaining).toBeNull();
      expect(s.exceeded).toBe(false);
    }
  });

  it('refuse de construire un refus pour une offre illimitée', () => {
    const s = pdfExportQuotaStatus('business', PLAN_ENTITLEMENTS.business, 10, MI_AOUT);
    expect(() => pdfExportQuotaExceededPayload(s)).toThrow(/sans limite/);
  });

  // ── Réinitialisation ───────────────────────────────────────────────────────

  it('réinitialise au 1er du mois suivant, à minuit UTC', () => {
    const s = pdfExportQuotaStatus('free', PLAN_ENTITLEMENTS.free, 3, MI_AOUT);
    expect(s.windowStart.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(s.resetAt.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('passe l’année sans se tromper de mois', () => {
    const s = pdfExportQuotaStatus(
      'free',
      PLAN_ENTITLEMENTS.free,
      0,
      new Date('2026-12-20T23:00:00.000Z'),
    );
    expect(s.resetAt.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('repart à zéro dans la fenêtre suivante', () => {
    // Le compteur n'est pas « remis à zéro » : la fenêtre change, donc la
    // consommation lue change avec elle. Il n'y a aucune remise à zéro à rater,
    // donc aucune à manquer un 1er du mois.
    const epuise = pdfExportQuotaStatus('free', PLAN_ENTITLEMENTS.free, 3, MI_AOUT);
    expect(epuise.exceeded).toBe(true);

    const septembre = new Date('2026-09-01T00:00:01.000Z');
    const apres = pdfExportQuotaStatus('free', PLAN_ENTITLEMENTS.free, 0, septembre);
    expect(apres.exceeded).toBe(false);
    expect(apres.remaining).toBe(3);
    expect(apres.windowStart.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('n’annonce jamais « 0 jour » avant la réinitialisation', () => {
    const s = pdfExportQuotaStatus(
      'free',
      PLAN_ENTITLEMENTS.free,
      3,
      new Date('2026-08-31T23:10:00.000Z'),
    );
    expect(s.resetInDays).toBe(1);
  });
});

describe('refus opposé à un dépassement d’exports PDF', () => {
  const status = pdfExportQuotaStatus('free', PLAN_ENTITLEMENTS.free, 3, MI_AOUT);
  const payload = pdfExportQuotaExceededPayload(status);

  it('nomme LAQUELLE des limites est atteinte', () => {
    // Un « 403 » nu ne dit ni ce qui est bloqué, ni pour combien de temps. Le
    // code est distinct de `PLAN_LIMIT_AI_MESSAGES` : une interface doit
    // pouvoir distinguer les deux refus sans lire le français.
    expect(payload.code).toBe(PDF_EXPORT_QUOTA_ERROR_CODE);
    expect(payload.code).toBe('PLAN_LIMIT_PDF_EXPORTS');
    expect(payload.quota).toBe(PDF_EXPORTS_QUOTA);
    expect(payload.plan).toBe('free');
    expect(payload.limit).toBe(3);
    expect(payload.used).toBe(3);
  });

  it('dit QUAND le quota se réinitialise, en machine et en français', () => {
    expect(payload.resetAt).toBe('2026-09-01T00:00:00.000Z');
    expect(payload.resetInDays).toBe(20);
    expect(payload.message).toContain('1er du mois prochain');
    expect(payload.message).toContain('20 jours');
  });

  it('dit « demain » plutôt que « dans 1 jours »', () => {
    const veille = pdfExportQuotaStatus(
      'free',
      PLAN_ENTITLEMENTS.free,
      3,
      new Date('2026-08-31T12:00:00.000Z'),
    );
    expect(pdfExportQuotaExceededPayload(veille).message).toContain('demain');
  });

  it('rassure sur le patrimoine déjà là : rien n’est rendu inaccessible', () => {
    // C'est LA garantie du lot, celle qui vaut pour l'organisation de production
    // à 5 projets sur une offre qui en autorise 1 : le quota borne les rendus À
    // VENIR, il ne ferme l'accès à aucun plan déjà produit. Taire cela ferait
    // lire le refus comme une suspension de compte.
    expect(payload.message).toContain('consultables');
    expect(payload.message).toContain('modifiables');
    // L'Excel n'est pas plafonné : le dire ici évite que l'utilisateur croie
    // avoir perdu tout moyen de sortir ses chiffres.
    expect(payload.message).toContain('Excel');
  });

  it('indique où lever la limite', () => {
    expect(payload.upgradeUrl).toBe('/pricing');
  });
});

describe('ce qui consomme du quota d’export', () => {
  it('ne compte QUE les rendus réellement produits', () => {
    expect(consumesPdfExportQuota('rendered')).toBe(true);
    // Un rendu abandonné (délai dépassé, portillon saturé, Chromium indisponible)
    // n'a livré aucun fichier. Le décompter ferait payer à l'utilisateur une
    // panne de NOTRE infrastructure : il a subi l'incident, il ne l'a pas
    // provoqué. Même honnêteté que `source: 'fallback'` côté IA.
    expect(consumesPdfExportQuota('failed')).toBe(false);
  });
});
