// Le quota d'exports PDF, vu depuis la route qui l'applique.
//
// `billing/pdf-export-quota.test.ts` couvre la règle, `billing/
// pdf-export-quota.service.test.ts` l'ordre des opérations. Ce fichier-ci
// répond aux deux questions que seul le contrôleur peut trancher :
//
//   · le PDF est-il RÉELLEMENT plafonné, avec un refus qui dit laquelle et
//     quand — et sans que Chromium ait démarré ?
//   · l'Excel est-il RÉELLEMENT épargné, y compris quand le quota PDF est à
//     zéro ?
//
// La garde est ici la VRAIE `PdfExportQuotaService`, montée sur des doubles de
// base : un mock de la garde prouverait qu'on l'a appelée, pas qu'elle refuse.

import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { PLAN_ENTITLEMENTS, type Plan } from '../billing/entitlements.js';
import { PdfExportQuotaService } from '../billing/pdf-export-quota.service.js';
import { ReportsController } from './reports.controller.js';

const ORG_ID = 'org-1';
const PROJECT_ID = 'projet-1';
const USER = { id: 'u-1' };
const TEMPLATE_SLUG = 'hello-world';

/** Réponse Express minimale — retient les en-têtes et les octets émis. */
function fakeResponse() {
  const headers: Record<string, string> = {};
  const state: { body: Buffer | undefined } = { body: undefined };
  return {
    headers,
    state,
    res: {
      setHeader(name: string, value: string) {
        headers[name] = value;
      },
      end(chunk: Buffer) {
        state.body = chunk;
      },
    } as never,
  };
}

/**
 * Monte le contrôleur avec la vraie garde de quota et des doubles pour tout le
 * reste. `plan` et `used` sont les deux seuls paramètres du test.
 */
function buildController(plan: Plan, used: number) {
  const project = {
    _id: PROJECT_ID,
    name: 'Projet démo',
    templateSlug: TEMPLATE_SLUG,
    pays: 'CD',
    deviseAffichage: 'USD',
    driverValues: {},
    parameterPackSlug: undefined,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  const billing = {
    getPlanEntitlements: async () => ({ plan, entitlements: PLAN_ENTITLEMENTS[plan] }),
  };

  const record = vi.fn(async () => {});
  const quota = new PdfExportQuotaService(
    billing as never,
    {
      record,
      countRenderedForOrganizationSince: async () => used,
    } as never,
  );

  const renderPdf = vi.fn(async () => Buffer.from('%PDF-faux'));
  const renderXlsx = vi.fn(async () => Buffer.from('classeur-faux'));
  const recordStrict = vi.fn(async () => {});

  const controller = new ReportsController(
    { findScoped: async () => project } as never,
    { findOrgById: async () => ({ name: 'Org test', pays: 'CD' }) } as never,
    { renderPdf, renderXlsx } as never,
    { findVersion: async () => undefined } as never,
    billing as never,
    { recordStrict } as never,
    quota,
  );

  return { controller, record, renderPdf, renderXlsx, recordStrict };
}

describe('quota atteint — l’API refuse, et le dit', () => {
  it('refuse le PDF sans avoir démarré Chromium', async () => {
    // Offre Free : 3 exports par mois, 3 déjà produits. Le 4e est refusé.
    const { controller, renderPdf, recordStrict, record } = buildController('free', 3);
    const { res, state } = fakeResponse();

    const erreur = await controller
      .downloadPdf(USER, 'owner' as never, ORG_ID, PROJECT_ID, res)
      .then(() => null)
      .catch((e: unknown) => e);

    expect(erreur).toBeInstanceOf(ForbiddenException);

    // Le point entier du lot : le rendu ne démarre pas. Un contrôle après coup
    // aurait déjà payé les ~140 Mo de Chromium qu'il prétend économiser.
    expect(renderPdf).not.toHaveBeenCalled();
    // Aucun octet n'est émis, et rien n'est journalisé comme export.
    expect(state.body).toBeUndefined();
    expect(recordStrict).not.toHaveBeenCalled();
    // Un export refusé n'est pas un export : il n'entre pas au compteur.
    expect(record).not.toHaveBeenCalled();
  });

  it('dit LAQUELLE des limites, combien, et QUAND elle repart', async () => {
    const { controller } = buildController('free', 3);
    const { res } = fakeResponse();

    const erreur = (await controller
      .downloadPdf(USER, 'owner' as never, ORG_ID, PROJECT_ID, res)
      .catch((e: unknown) => e)) as ForbiddenException;

    const corps = erreur.getResponse() as Record<string, unknown>;

    expect(erreur.getStatus()).toBe(403);
    expect(corps['code']).toBe('PLAN_LIMIT_PDF_EXPORTS');
    expect(corps['quota']).toBe('pdf_exports');
    expect(corps['plan']).toBe('free');
    expect(corps['limit']).toBe(3);
    expect(corps['used']).toBe(3);
    expect(typeof corps['resetAt']).toBe('string');
    expect(corps['upgradeUrl']).toBe('/pricing');
    // Ce n'est pas un 403 nu : le message nomme ce qui reste accessible.
    expect(String(corps['message'])).toContain('Excel');
  });

  it('laisse sortir le dernier export inclus', async () => {
    const { controller, renderPdf, record } = buildController('free', 2);
    const { res, state } = fakeResponse();

    await controller.downloadPdf(USER, 'owner' as never, ORG_ID, PROJECT_ID, res);

    expect(renderPdf).toHaveBeenCalledTimes(1);
    expect(state.body?.toString()).toBe('%PDF-faux');
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        outcome: 'rendered',
      }),
    );
  });
});

describe('l’Excel n’est JAMAIS plafonné', () => {
  it('sort même quand le quota PDF est entièrement consommé', async () => {
    // La grille annonce « Export Excel : oui » dans les CINQ offres, Free
    // comprise. L'Excel est du calcul pur (ExcelJS, aucun navigateur) : son coût
    // marginal ne justifie aucun plafond, et en poser un vendrait une limite que
    // la page publique ne mentionne nulle part.
    const { controller, renderXlsx, record } = buildController('free', 99);
    const { res, state } = fakeResponse();

    await controller.downloadXlsx(USER, 'owner' as never, ORG_ID, PROJECT_ID, res);

    expect(renderXlsx).toHaveBeenCalledTimes(1);
    expect(state.body?.toString()).toBe('classeur-faux');
    // Et il ne touche pas au compteur : un classeur ne consomme pas un PDF.
    expect(record).not.toHaveBeenCalled();
  });

  it('reste le filet de sécurité de l’organisation à quota épuisé', async () => {
    // C'est ce qui rend le refus PDF supportable : les chiffres restent
    // sortables. Le message du refus le promet — ce test vérifie que la promesse
    // est tenue par la route, pas seulement écrite dans une chaîne.
    const { controller } = buildController('free', 3);

    await expect(
      controller.downloadPdf(USER, 'owner' as never, ORG_ID, PROJECT_ID, fakeResponse().res),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      controller.downloadXlsx(USER, 'owner' as never, ORG_ID, PROJECT_ID, fakeResponse().res),
    ).resolves.toBeUndefined();
  });
});

describe('offre illimitée', () => {
  it('n’oppose aucune limite, quel que soit le volume déjà produit', async () => {
    // Business : `pdfExportsPerMonth: null`. `null` = ILLIMITÉ, jamais « zéro ».
    const { controller, renderPdf } = buildController('business', 9_999);
    const { res, state } = fakeResponse();

    await controller.downloadPdf(USER, 'owner' as never, ORG_ID, PROJECT_ID, res);

    expect(renderPdf).toHaveBeenCalledTimes(1);
    expect(state.body?.toString()).toBe('%PDF-faux');
  });
});

describe('un export qui échoue ne consomme pas le quota', () => {
  it('ne décompte pas un rendu abandonné par délai dépassé', async () => {
    // L'utilisateur a subi la panne, il ne l'a pas provoquée. Le rendu est
    // TRACÉ (`failed`, pour que l'exploitation voie la saturation) mais pas
    // DÉCOMPTÉ : `countRenderedForOrganizationSince` filtre sur `rendered`.
    const { controller, record } = buildController('free', 0);
    const controllerEnPanne = controller as unknown as {
      reports: { renderPdf: () => Promise<Buffer> };
    };
    const panne = new Error('rendu abandonné : délai dépassé');
    controllerEnPanne.reports.renderPdf = async () => {
      throw panne;
    };

    await expect(
      controller.downloadPdf(USER, 'owner' as never, ORG_ID, PROJECT_ID, fakeResponse().res),
    ).rejects.toBe(panne);

    expect(record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed' }));
  });

  it('ne décompte pas un export dont le journal d’audit a échoué', async () => {
    // R4 (ADR-0012 §6) : si l'audit échoue, l'exception remonte et le fichier
    // n'est JAMAIS émis. L'utilisateur n'a donc rien reçu — lui décompter un
    // export lui ferait payer notre panne de journalisation.
    const { controller, record } = buildController('free', 0);
    const interne = controller as unknown as { audit: { recordStrict: () => Promise<void> } };
    interne.audit.recordStrict = async () => {
      throw new Error('journal indisponible');
    };
    const { res, state } = fakeResponse();

    await expect(
      controller.downloadPdf(USER, 'owner' as never, ORG_ID, PROJECT_ID, res),
    ).rejects.toThrow(/journal indisponible/);

    expect(state.body).toBeUndefined();
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed' }));
  });
});
