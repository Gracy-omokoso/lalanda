// Sondes de comportement de l'e-MCF — ADR-0024 § 7.4 (chantier F4).
//
// Sous-commande `probe` de l'outil d'étalonnage, environnement de TEST
// seulement, DÉSACTIVÉE par défaut : aucune sonde ne s'exécute si elle n'est pas
// nommée explicitement. Une seule sonde CONFIRME une facture de test
// (`apres-confirmation`) ; elle demande, juste avant, que l'opérateur tape le
// mot CONFIRMER. Une facture de test n'a aucune valeur fiscale, mais elle
// consomme un numéro de compteur de l'e-MCF de test : c'est pourquoi on demande.
//
// Les sondes observent ce que la documentation ne dit pas (questions DGI n° 1 à
// 3) : réponse de `GET /api/invoice/{uid}` après confirmation, après
// annulation, après expiration ; envoi d'un même `rn` pendant l'attente, après
// annulation, après expiration ; présence dans `GET /api/invoice` après
// expiration. Le résultat est un RAPPORT ; il ne modifie aucun fichier du dépôt.
// `EDEF_RECONCILIATION_EVIDENCE` (chantier F2) ne se remplit qu'à la main, et
// seulement quand l'observation est CONFIRMÉE PAR ÉCRIT par la DGI.

import {
  DGI_ROUNDING_POLICY,
  compareWithEdefResponse,
  computeInvoiceTotals,
  decimalToJsonNumber,
  type InvoiceTotals,
  type TaxRateTable,
} from '@lalanda/engine';

import type { Secret } from '../../integrations/secret-value.js';
import { RECONCILE_DELAY_MS } from '../../platform-config/dgi-platform.config.js';
import type { EdefClient } from '../edef.client.js';
import type { EdefInvoiceCallContext } from '../edef-invoice.types.js';
import type { EdefCallContext, EdefFailure } from '../edef.types.js';
import {
  buildCalibrationRequest,
  resolveRates,
  selectCalibrationCases,
} from './calibration-cases.js';
import { CALL_SPACING_MS, type CalibrationEdef } from './calibration-run.js';
import { checkOutputPath, fileStamp, serializeReport, writeReportFile } from './report.js';
import { CalibrationRefusal, assertTestTarget } from './safety.js';

export type ProbeEdef = CalibrationEdef &
  Pick<EdefClient, 'confirmInvoice' | 'getInvoiceDetails' | 'getPendingRequests'>;

export const PROBES = Object.freeze({
  'apres-confirmation': {
    confirms: true,
    description:
      'Envoie, CONFIRME une facture de test, puis lit GET /api/invoice/{uid} et la liste des demandes en attente.',
  },
  'apres-annulation': {
    confirms: false,
    description:
      'Envoie, annule, puis lit GET /api/invoice/{uid} et la liste des demandes en attente.',
  },
  'apres-expiration': {
    confirms: false,
    description:
      'Envoie, laisse expirer (environ 2 min 30), puis lit GET /api/invoice/{uid}, la liste, et tente une annulation.',
  },
  'rn-en-attente': {
    confirms: false,
    description: 'Envoie deux fois le même numéro pendant que la première demande attend.',
  },
  'rn-apres-annulation': {
    confirms: false,
    description: 'Envoie, annule, puis renvoie le même numéro.',
  },
  'rn-apres-expiration': {
    confirms: false,
    description: 'Envoie, laisse expirer (environ 2 min 30), puis renvoie le même numéro.',
  },
} as const);

export type ProbeName = keyof typeof PROBES;
export const PROBE_NAMES = Object.keys(PROBES) as ProbeName[];

export function isProbeName(value: string): value is ProbeName {
  return Object.prototype.hasOwnProperty.call(PROBES, value);
}

/** Mot exact à taper avant une sonde qui confirme. */
export const CONFIRMATION_WORD = 'CONFIRMER';

export interface ProbeStep {
  action: string;
  ok: boolean;
  error: {
    kind: string;
    httpStatus: number | null;
    dgiErrorCode: string | null;
    message: string;
  } | null;
  /** Observations SANS valeur sensible (présences, égalités, codes). */
  detail: Record<string, string | number | boolean | null>;
}

export interface ProbeReport {
  name: ProbeName;
  confirms: boolean;
  status: 'done' | 'skipped' | 'aborted';
  reason: string | null;
  steps: ProbeStep[];
  findings: string[];
}

export interface ProbeRunReport {
  kind: 'lalanda-sondes-emcf';
  reportVersion: 1;
  adr: 'ADR-0024 § 7.4';
  generatedAt: string;
  environment: 'test';
  target: string;
  probes: ProbeReport[];
  notes: string[];
}

export interface ProbeDeps {
  edef: ProbeEdef;
  target: { testUrl: string; productionUrl: string };
  isfTest: string | null;
  probes: readonly ProbeName[];
  readToken: () => Promise<Secret>;
  /** Question visible ; la réponse doit être exactement CONFIRMER pour une sonde qui confirme. */
  ask: (question: string) => Promise<string>;
  out: (line: string) => void;
  reportPath: string;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  spacingMs?: number;
  /** Attente avant d'observer une demande expirée (défaut : 150 s, ADR-0024 § 6). */
  expiryWaitMs?: number;
}

function failureOf(error: EdefFailure): ProbeStep['error'] {
  return {
    kind: error.kind,
    httpStatus: error.httpStatus,
    dgiErrorCode: error.dgiErrorCode,
    message: error.message,
  };
}

export async function runProbes(
  deps: ProbeDeps,
): Promise<{ report: ProbeRunReport; reportFile: { path: string; sha256: string } }> {
  if (deps.probes.length === 0) {
    throw new CalibrationRefusal(
      'Aucune sonde demandée : les sondes sont désactivées par défaut. Nommez-les une à une (--sonde <nom>).',
    );
  }
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const spacing = deps.spacingMs ?? CALL_SPACING_MS;
  const expiryWaitMs = deps.expiryWaitMs ?? RECONCILE_DELAY_MS;
  const out = deps.out;

  const target = assertTestTarget(deps.target.testUrl, deps.target.productionUrl);
  if (!deps.isfTest) {
    throw new CalibrationRefusal('DGI_ISF_TEST n’est pas renseigné : arrêt.');
  }
  checkOutputPath(deps.reportPath);

  const token = await deps.readToken();
  const ctx: EdefCallContext = {
    environment: 'test',
    token,
    organizationId: null,
    pointOfSaleId: null,
  };
  const edef = deps.edef;

  let calls = 0;
  const paced = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (calls > 0 && spacing > 0) await sleep(spacing);
    calls += 1;
    return fn();
  };

  const status = await paced(() => edef.getStatus(ctx));
  if (!status.ok) throw new CalibrationRefusal(`Statut e-MCF illisible : ${status.error.message}`);
  if (!status.data.status || !status.data.nif) {
    throw new CalibrationRefusal('Statut e-MCF non valide ou NIF absent : arrêt.');
  }
  const nif = status.data.nif;
  const taxGroups = await paced(() => edef.getReferenceList('taxGroups', ctx));
  if (!taxGroups.ok) {
    throw new CalibrationRefusal(`Liste des groupes illisible : ${taxGroups.error.message}`);
  }

  // Facture des sondes : la facture modèle de la documentation DGI (TTC, A et B).
  const model = selectCalibrationCases().find((c) => c.id === 'dgi-modele');
  if (!model) throw new Error('Cas dgi-modele introuvable.');
  const rates = resolveRates(model, taxGroups.data);
  if (!rates.ok) throw new CalibrationRefusal(`Facture des sondes impossible : ${rates.reason}`);
  const computed = computeInvoiceTotals({
    ...model.input,
    rates: rates.rates,
    policy: DGI_ROUNDING_POLICY,
  });
  if (!computed.ok) throw new Error('Calcul de la facture des sondes refusé par le moteur.');
  const ours: InvoiceTotals = computed.totals;
  const ourRates: TaxRateTable = rates.rates;

  const stamp = fileStamp(now());
  const body = (rn: string) =>
    buildCalibrationRequest(model, {
      nif,
      isf: deps.isfTest as string,
      rn,
      rates: ourRates,
      clientTypeDesc: null,
      counterValue: null,
    });
  const invoiceCtx = (probe: ProbeName, rn: string): EdefInvoiceCallContext => ({
    ...ctx,
    invoiceId: `sonde:${probe}`,
    rn,
  });

  const reports: ProbeReport[] = [];
  for (const name of deps.probes) {
    const def = PROBES[name];
    const report: ProbeReport = {
      name,
      confirms: def.confirms,
      status: 'done',
      reason: null,
      steps: [],
      findings: [],
    };
    reports.push(report);
    out(`Sonde ${name} : ${def.description}`);

    if (def.confirms) {
      const answer = await deps.ask(
        `La sonde « ${name} » va CONFIRMER une facture de TEST (sans valeur fiscale, mais définitive sur l’e-MCF de test).\n` +
          `Tapez ${CONFIRMATION_WORD} pour continuer, ou autre chose pour passer cette sonde :`,
      );
      if (answer !== CONFIRMATION_WORD) {
        report.status = 'skipped';
        report.reason = 'Confirmation refusée par l’opérateur : aucune facture confirmée.';
        out('  → sonde passée, rien n’a été envoyé.');
        continue;
      }
    }

    const rn = `SONDE-${stamp}-${name}`;
    const ictx = invoiceCtx(name, rn);
    const step = (s: ProbeStep): ProbeStep => {
      report.steps.push(s);
      return s;
    };

    const submit = async (action: string) => {
      const r = await paced(() => edef.submitInvoice(body(rn), ictx));
      step({
        action,
        ok: r.ok,
        error: r.ok ? null : failureOf(r.error),
        detail: r.ok ? { uidReceived: true } : {},
      });
      return r;
    };
    const cancel = async (action: string, uid: string) => {
      const r = await paced(() => edef.cancelInvoice(uid, ictx));
      step({ action, ok: r.ok, error: r.ok ? null : failureOf(r.error), detail: {} });
      return r;
    };
    const details = async (action: string, uid: string) => {
      const r = await paced(() => edef.getInvoiceDetails(uid, ictx));
      step({
        action,
        ok: r.ok,
        error: r.ok ? null : failureOf(r.error),
        detail: r.ok
          ? {
              rnIdentique: r.data.rn === rn,
              nifIdentique: r.data.nif === nif,
              totauxPresents: r.data.totals !== null,
              elementsDeSecuritePresents: r.data.security !== null,
            }
          : {},
      });
      return r;
    };
    const pending = async (action: string, uid: string) => {
      const r = await paced(() => edef.getPendingRequests(ctx));
      step({
        action,
        ok: r.ok,
        error: r.ok ? null : failureOf(r.error),
        detail: r.ok
          ? { demandesEnAttente: r.data.count, uidPresent: r.data.list.some((p) => p.uid === uid) }
          : {},
      });
      return r;
    };
    const describeDetails = (when: string, d: Awaited<ReturnType<typeof details>>): string =>
      d.ok
        ? `GET /api/invoice/{uid} ${when} : répond ; éléments de sécurité ${
            d.data.security ? 'PRÉSENTS' : 'ABSENTS'
          } ; totaux ${d.data.totals ? 'présents' : 'absents'}.`
        : `GET /api/invoice/{uid} ${when} : erreur ${d.error.kind}${
            d.error.dgiErrorCode ? ` (code DGI ${d.error.dgiErrorCode})` : ''
          }.`;
    const describePending = (
      when: string,
      p: Awaited<ReturnType<typeof pending>>,
      uid: string,
    ): string =>
      p.ok
        ? `GET /api/invoice ${when} : la demande ${
            p.data.list.some((x) => x.uid === uid) ? 'FIGURE' : 'ne figure PAS'
          } dans la liste des demandes en attente.`
        : `GET /api/invoice ${when} : erreur ${p.error.kind}.`;
    const describeSecond = (when: string, r: Awaited<ReturnType<typeof submit>>): string =>
      r.ok
        ? `Même numéro renvoyé ${when} : ACCEPTÉ (nouvelle demande créée).`
        : `Même numéro renvoyé ${when} : refusé (${r.error.kind}${
            r.error.dgiErrorCode ? `, code DGI ${r.error.dgiErrorCode}` : ''
          }).`;

    const first = await submit('POST /api/invoice');
    if (!first.ok) {
      report.status = 'aborted';
      report.reason = `Envoi refusé ou sans réponse : ${first.error.message}`;
      out(`  → interrompue : ${first.error.message}`);
      if (first.error.kind === 'unauthorized') break;
      continue;
    }
    const uid = first.data.uid;

    switch (name) {
      case 'apres-confirmation': {
        const comparison = compareWithEdefResponse(ours, ourRates, first.data.raw);
        if (!comparison.identical) {
          await cancel('PUT …/cancel (écart de totaux)', uid);
          report.status = 'aborted';
          report.reason =
            'Écart entre nos totaux et ceux de la DGI : AUCUNE confirmation envoyée, demande annulée.';
          break;
        }
        const confirmed = await paced(() =>
          edef.confirmInvoice(
            uid,
            {
              total: decimalToJsonNumber(ours.total),
              vtotal: decimalToJsonNumber(ours.vatTotal),
            },
            ictx,
          ),
        );
        step({
          action: 'PUT …/confirm',
          ok: confirmed.ok,
          error: confirmed.ok ? null : failureOf(confirmed.error),
          detail: confirmed.ok ? { elementsDeSecuriteRecus: true } : {},
        });
        report.findings.push(
          confirmed.ok
            ? 'Confirmation acceptée : éléments de sécurité reçus.'
            : `Confirmation sans succès (${confirmed.error.kind}).`,
        );
        report.findings.push(
          describeDetails('après confirmation', await details('GET /api/invoice/{uid}', uid)),
        );
        report.findings.push(
          describePending('après confirmation', await pending('GET /api/invoice', uid), uid),
        );
        break;
      }
      case 'apres-annulation': {
        await cancel('PUT …/cancel', uid);
        report.findings.push(
          describeDetails('après annulation', await details('GET /api/invoice/{uid}', uid)),
        );
        report.findings.push(
          describePending('après annulation', await pending('GET /api/invoice', uid), uid),
        );
        break;
      }
      case 'apres-expiration': {
        out(`  attente de ${Math.round(expiryWaitMs / 1000)} s pour laisser la demande expirer…`);
        await sleep(expiryWaitMs);
        report.findings.push(
          describeDetails('après expiration', await details('GET /api/invoice/{uid}', uid)),
        );
        report.findings.push(
          describePending('après expiration', await pending('GET /api/invoice', uid), uid),
        );
        const late = await cancel('PUT …/cancel après expiration', uid);
        report.findings.push(
          late.ok
            ? 'Annulation après expiration : acceptée.'
            : `Annulation après expiration : refusée (${late.error.kind}${
                late.error.dgiErrorCode ? `, code DGI ${late.error.dgiErrorCode}` : ''
              }).`,
        );
        break;
      }
      case 'rn-en-attente': {
        const second = await submit('POST /api/invoice (même numéro, première demande en attente)');
        report.findings.push(describeSecond('pendant l’attente', second));
        if (second.ok && second.data.uid !== uid)
          await cancel('PUT …/cancel (seconde demande)', second.data.uid);
        await cancel('PUT …/cancel (première demande)', uid);
        break;
      }
      case 'rn-apres-annulation': {
        await cancel('PUT …/cancel', uid);
        const second = await submit('POST /api/invoice (même numéro, après annulation)');
        report.findings.push(describeSecond('après annulation', second));
        if (second.ok) await cancel('PUT …/cancel (seconde demande)', second.data.uid);
        break;
      }
      case 'rn-apres-expiration': {
        out(`  attente de ${Math.round(expiryWaitMs / 1000)} s pour laisser la demande expirer…`);
        await sleep(expiryWaitMs);
        const second = await submit('POST /api/invoice (même numéro, après expiration)');
        report.findings.push(describeSecond('après expiration', second));
        if (second.ok) await cancel('PUT …/cancel (seconde demande)', second.data.uid);
        break;
      }
    }
    for (const f of report.findings) out(`  → ${f}`);
    if (report.reason) out(`  → ${report.reason}`);
  }

  const report: ProbeRunReport = {
    kind: 'lalanda-sondes-emcf',
    reportVersion: 1,
    adr: 'ADR-0024 § 7.4',
    generatedAt: now().toISOString(),
    environment: 'test',
    target,
    probes: reports,
    notes: [
      'Observations faites sur l’environnement de TEST de la DGI ; elles ne valent pas réponse écrite de la DGI.',
      'EDEF_RECONCILIATION_EVIDENCE ne se met à jour qu’à la main, et seulement quand la DGI a confirmé par écrit (ADR-0024 § 7.4).',
      'Ni le jeton, ni le NIF, ni les éléments de sécurité ne figurent dans ce rapport.',
    ],
  };
  const reportFile = writeReportFile(deps.reportPath, serializeReport(report, { token, nif }));
  out('');
  out(`Rapport des sondes écrit : ${reportFile.path}`);
  out(`Empreinte sha256 : ${reportFile.sha256}`);
  return { report, reportFile };
}
