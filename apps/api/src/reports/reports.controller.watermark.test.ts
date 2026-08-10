// Régression S22i : le filigrane doit être posé sur les DEUX chemins d'export.
//
// `report-html.watermark.test.ts` couvre le rendu (« si `watermark` vaut true,
// le HTML porte le filigrane »). Il ne pouvait pas voir le défaut corrigé ici,
// qui était en amont : le contrôleur ne posait le champ que sur le chemin live.
// Le chemin `?planVersion=N` retournait avant d'avoir résolu les entitlements,
// donc `watermark` restait `undefined` — et un `undefined` produit un PDF sans
// filigrane, exactement comme un `false` légitime.
//
// Conséquence : une organisation en offre `free` obtenait un export SANS
// filigrane en demandant sa version validée. C'est-à-dire que la limite se
// contournait sur l'export qu'on dépose en banque — le seul qui compte.
//
// Le test porte donc sur l'assemblage du `ReportData` par le contrôleur, pas
// sur le rendu : c'est là que le défaut vivait.

import { describe, expect, it } from 'vitest';

import { ReportsController } from './reports.controller.js';
import type { ReportData } from './report-html.js';

const ORG_ID = 'org-1';
const PROJECT_ID = 'projet-1';
const TEMPLATE_SLUG = 'hello-world';

/**
 * Construit le contrôleur avec des doubles minimaux. `pdfWatermark` est le seul
 * paramètre du test : tout le reste est figé.
 */
function buildController(pdfWatermark: boolean): ReportsController {
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

  const plan = {
    version: 3,
    templateSlug: TEMPLATE_SLUG,
    parameterPackSlug: undefined,
    approvedAt: new Date('2026-02-01T00:00:00.000Z'),
    driverValues: {},
    // Un snapshot figé porte ses lignes déjà calculées : aucun recalcul moteur.
    result: { lines: [] },
  };

  return new ReportsController(
    { findScoped: async () => project } as never,
    { findOrgById: async () => ({ name: 'Org test', pays: 'CD' }) } as never,
    {} as never,
    { findVersion: async () => plan } as never,
    { getPlanEntitlements: async () => ({ entitlements: { pdfWatermark } }) } as never,
    {} as never,
  );
}

/** `buildReportData` est privé : le test l'atteint explicitement, sans l'exposer. */
function buildReportData(
  controller: ReportsController,
  planVersion?: number,
): Promise<ReportData> {
  const internals = controller as unknown as {
    buildReportData(orgId: string, id: string, planVersion?: number): Promise<ReportData>;
  };
  return internals.buildReportData(ORG_ID, PROJECT_ID, planVersion);
}

describe('ReportsController — filigrane et plan figé (S22i)', () => {
  it('pose le filigrane sur un export de plan figé quand l’offre l’impose', async () => {
    const data = await buildReportData(buildController(true), 3);

    // C'est l'assertion qui échouait avant le correctif : `watermark` valait
    // `undefined`, et le rendu traite `undefined` comme « pas de filigrane ».
    expect(data.watermark).toBe(true);
    expect(data.plan).toEqual({ version: 3, approvedAt: '2026-02-01T00:00:00.000Z' });
  });

  it('ne pose pas le filigrane sur un plan figé quand l’offre en dispense', async () => {
    const data = await buildReportData(buildController(false), 3);

    expect(data.watermark).toBe(false);
  });

  it('garde le même verdict sur le chemin live, pour que les deux ne divergent plus', async () => {
    // Les deux chemins doivent répondre à la même question de la même façon :
    // c'est leur divergence, et non la valeur elle-même, qui était le défaut.
    expect((await buildReportData(buildController(true))).watermark).toBe(true);
    expect((await buildReportData(buildController(false))).watermark).toBe(false);
  });
});
