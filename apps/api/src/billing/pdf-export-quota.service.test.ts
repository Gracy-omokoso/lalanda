// Branchement du quota d'exports PDF sur la base et sur HTTP.
//
// `pdf-export-quota.test.ts` couvre la RÈGLE (fonction pure). Ce fichier couvre
// l'ORDRE DES OPÉRATIONS, qui est là où un quota se trompe : garder AVANT le
// rendu, compter APRÈS à partir de l'issue RÉELLE. Les doubles remplacent la
// base ; aucune promesse n'est faite sur Mongo ici.

import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { PdfExportQuotaService } from './pdf-export-quota.service.js';
import type { Plan } from './entitlements.js';
import { PLAN_ENTITLEMENTS } from './entitlements.js';

const ORG = 'org-1';
const MI_AOUT = new Date('2026-08-12T10:00:00.000Z');

/** Contexte d'appel minimal — les trois champs que le service demande. */
const CONTEXTE = { organizationId: ORG, userId: 'u-1', projectId: 'p-1' };

/**
 * Monte le service avec un plan figé et un compteur figé.
 *
 * `record` est espionné : c'est lui qui porte la réponse à « l'export échoué
 * est-il compté ? », et le test doit pouvoir lire ce qui a été écrit.
 */
function buildService(plan: Plan, used: number) {
  const record = vi.fn(async () => {});
  const countRenderedForOrganizationSince = vi.fn(async () => used);

  const service = new PdfExportQuotaService(
    { getPlanEntitlements: async () => ({ plan, entitlements: PLAN_ENTITLEMENTS[plan] }) } as never,
    { record, countRenderedForOrganizationSince } as never,
  );

  return { service, record, countRenderedForOrganizationSince };
}

describe('lecture du quota — sans effet de bord', () => {
  it('rend l’état complet d’une offre plafonnée', async () => {
    const { service } = buildService('free', 2);
    const status = await service.status(ORG, MI_AOUT);

    expect(status.plan).toBe('free');
    expect(status.limit).toBe(3);
    expect(status.used).toBe(2);
    expect(status.remaining).toBe(1);
    expect(status.exceeded).toBe(false);
    expect(status.resetAt.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('n’interroge même pas la base sur une offre illimitée', async () => {
    // Une offre illimitée n'a pas besoin d'être comptée : la lecture serait un
    // décompte inutile sur le chemin d'un export, et son résultat serait ignoré.
    const { service, countRenderedForOrganizationSince } = buildService('business', 0);
    const status = await service.status(ORG, MI_AOUT);

    expect(status.unlimited).toBe(true);
    expect(status.limit).toBeNull();
    expect(status.remaining).toBeNull();
    expect(countRenderedForOrganizationSince).not.toHaveBeenCalled();
  });

  it('ne consomme rien : lire un quota n’en dépense pas', async () => {
    const { service, record } = buildService('free', 3);
    await service.status(ORG, MI_AOUT);
    expect(record).not.toHaveBeenCalled();
  });
});

describe('refus quand le quota est atteint', () => {
  it('lève un 403 nommant la limite, la consommation et la date de reprise', async () => {
    const { service } = buildService('free', 3);

    await expect(service.assertWithinQuota(ORG, MI_AOUT)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    const erreur = await service.assertWithinQuota(ORG, MI_AOUT).catch((e: unknown) => e);
    const corps = (erreur as ForbiddenException).getResponse() as Record<string, unknown>;

    // 403 et non 429 : ce n'est pas une limitation de débit qu'une seconde
    // d'attente lèverait, c'est un droit que l'offre n'accorde pas.
    expect((erreur as ForbiddenException).getStatus()).toBe(403);
    expect(corps['code']).toBe('PLAN_LIMIT_PDF_EXPORTS');
    expect(corps['quota']).toBe('pdf_exports');
    expect(corps['limit']).toBe(3);
    expect(corps['used']).toBe(3);
    expect(corps['resetAt']).toBe('2026-09-01T00:00:00.000Z');
    expect(corps['upgradeUrl']).toBe('/pricing');
  });

  it('laisse passer le dernier export inclus', async () => {
    // 2 sur 3 : le troisième export est vendu, il doit sortir.
    const { service } = buildService('free', 2);
    await expect(service.assertWithinQuota(ORG, MI_AOUT)).resolves.toMatchObject({ remaining: 1 });
  });

  it('n’oppose jamais de refus à une offre illimitée', async () => {
    const { service } = buildService('business', 9_999);
    await expect(service.assertWithinQuota(ORG, MI_AOUT)).resolves.toMatchObject({
      unlimited: true,
    });
  });
});

describe('runGuarded — garder avant, compter après', () => {
  it('refuse AVANT de lancer le rendu quand le quota est épuisé', async () => {
    // C'est l'exigence entière du lot : un rendu Chromium coûte ~140 Mo, il ne
    // doit pas démarrer si l'organisation n'y a pas droit. Un contrôle après
    // coup aurait déjà payé le coût qu'il prétend éviter.
    const { service, record } = buildService('free', 3);
    const rendu = vi.fn(async () => 'pdf');

    await expect(service.runGuarded(CONTEXTE, rendu as never, MI_AOUT)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect(rendu).not.toHaveBeenCalled();
    // Un export refusé n'est pas un export : rien n'est écrit au compteur.
    expect(record).not.toHaveBeenCalled();
  });

  it('compte le rendu qui a réellement produit un fichier', async () => {
    const { service, record } = buildService('free', 0);
    const octets = await service.runGuarded(CONTEXTE, async () => 'pdf', MI_AOUT);

    expect(octets).toBe('pdf');
    expect(record).toHaveBeenCalledWith({ ...CONTEXTE, outcome: 'rendered' });
  });

  it('NE COMPTE PAS un rendu qui a échoué, et laisse remonter l’échec', async () => {
    // L'exigence 3 du lot. Un délai dépassé côté Chromium est une panne de
    // NOTRE infrastructure : l'utilisateur l'a subie, il ne l'a pas provoquée.
    // La ligne est tout de même écrite en `failed` — sans elle, une vague de
    // délais dépassés resterait invisible jusqu'à ce qu'un client se plaigne —
    // mais elle n'entre pas dans le décompte (voir le filtre de
    // `countRenderedForOrganizationSince`).
    const { service, record } = buildService('free', 0);
    const panne = new Error('rendu abandonné : délai dépassé');

    await expect(
      service.runGuarded(
        CONTEXTE,
        async () => {
          throw panne;
        },
        MI_AOUT,
      ),
    ).rejects.toBe(panne);

    expect(record).toHaveBeenCalledWith({ ...CONTEXTE, outcome: 'failed' });
  });

  it('trois délais dépassés ne consomment aucun des 3 exports gratuits', async () => {
    // Le scénario redouté, écrit en toutes lettres : Chromium sature, trois
    // exports partent en erreur, et le compte gratuit doit garder ses 3 exports.
    const { service, record } = buildService('free', 0);

    for (let i = 0; i < 3; i += 1) {
      await service
        .runGuarded(
          CONTEXTE,
          async () => {
            throw new Error('délai dépassé');
          },
          MI_AOUT,
        )
        .catch(() => undefined);
    }

    expect(record).toHaveBeenCalledTimes(3);
    for (const appel of record.mock.calls) {
      expect(appel[0]).toMatchObject({ outcome: 'failed' });
    }
    // Le compteur lu reste à 0 : aucune ligne `rendered` n'a été écrite, donc
    // le quatrième export (le premier vrai) passe toujours.
    await expect(service.assertWithinQuota(ORG, MI_AOUT)).resolves.toMatchObject({ remaining: 3 });
  });

  it('compte aussi sur une offre illimitée, pour que l’exploitation voie le coût', async () => {
    // Le quota ne s'applique pas, mais le Chromium a bien tourné. Ne rien
    // écrire rendrait invisible le poste de coût des offres les plus lourdes —
    // celles, précisément, qui promettent l'illimité.
    const { service, record } = buildService('business', 0);
    await service.runGuarded(CONTEXTE, async () => 'pdf', MI_AOUT);
    expect(record).toHaveBeenCalledWith({ ...CONTEXTE, outcome: 'rendered' });
  });

  it('repart à zéro le mois suivant sans aucune remise à zéro', async () => {
    // La fenêtre se déduit de l'horloge. Le compteur du mois d'août n'est pas
    // effacé : il n'est simplement plus dans la fenêtre lue en septembre.
    const { service, countRenderedForOrganizationSince } = buildService('free', 0);

    await service.status(ORG, new Date('2026-09-03T08:00:00.000Z'));

    expect(countRenderedForOrganizationSince).toHaveBeenCalledWith(
      ORG,
      new Date('2026-09-01T00:00:00.000Z'),
    );
  });
});
