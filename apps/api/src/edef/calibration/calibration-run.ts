// Déroulé de l'étalonnage des arrondis — ADR-0024 § 7 (chantier F4).
//
// Pour chaque cas : `POST /api/invoice`, puis IMMÉDIATEMENT `PUT …/cancel`,
// AVANT toute analyse ; ensuite seulement, comparaison des totaux reçus à notre
// calcul sous les quatre politiques candidates. L'étalonnage ne CONFIRME JAMAIS
// une facture : le type `CalibrationEdef` ne porte pas la méthode de
// confirmation, et `restrictToCalibration` ne transmet que quatre méthodes —
// même un transtypage ne permettrait pas d'en atteindre une autre (test de
// lecture des sources en plus).
//
// Débit : un appel à la fois, 500 ms d'écart ; arrêt au premier 401 et à la
// première erreur DGI 1 (trop de demandes en attente).

import {
  CALIBRATION_ROUNDING_POLICIES,
  DGI_ROUNDING_POLICY,
  INVOICE_TOTALS_VERSION,
  type TaxRateTable,
} from '@lalanda/engine';

import type { Secret } from '../../integrations/secret-value.js';
import type { EdefClient } from '../edef.client.js';
import type {
  EdefCallContext,
  EdefCurrencyRate,
  EdefFailure,
  EdefReferenceData,
  EdefReferenceList,
} from '../edef.types.js';
import {
  compareUnderPolicies,
  decideVerdict,
  dgiTotalsAsReceived,
  oursByPolicy,
  proposeCalibrationRecord,
  type CaseStatus,
  type PolicyComparison,
  type RecordCase,
  type Verdict,
} from './calibration-analysis.js';
import {
  buildCalibrationRequest,
  calibrationRn,
  predictions,
  resolveRates,
  selectCalibrationCases,
  usdRateOf,
  type CalibrationCase,
  type CounterValueSource,
} from './calibration-cases.js';
import { checkOutputPath, serializeReport, writeReportFile } from './report.js';
import { CalibrationRefusal, assertTestTarget } from './safety.js';

/** Les SEULES routes que l'étalonnage peut appeler. */
export type CalibrationEdef = Pick<
  EdefClient,
  'getStatus' | 'getReferenceList' | 'submitInvoice' | 'cancelInvoice'
>;

/** Enveloppe qui ne transmet que les quatre routes de l'étalonnage. */
export function restrictToCalibration(client: CalibrationEdef): CalibrationEdef {
  return Object.freeze({
    getStatus: (ctx: EdefCallContext) => client.getStatus(ctx),
    getReferenceList: <L extends EdefReferenceList>(list: L, ctx: EdefCallContext) =>
      client.getReferenceList(list, ctx),
    submitInvoice: (...args: Parameters<CalibrationEdef['submitInvoice']>) =>
      client.submitInvoice(...args),
    cancelInvoice: (...args: Parameters<CalibrationEdef['cancelInvoice']>) =>
      client.cancelInvoice(...args),
  });
}

/** Écart entre deux appels à la DGI (ADR-0024 § 7.2). */
export const CALL_SPACING_MS = 500;

export interface FailureSummary {
  kind: EdefFailure['kind'];
  httpStatus: number | null;
  dgiErrorCode: string | null;
  message: string;
}

export interface CaseReport {
  id: string;
  baseCaseId: string;
  origin: string;
  reliability: string;
  decisive: boolean;
  priceMode: 'ttc' | 'ht';
  rn: string | null;
  status: CaseStatus;
  reason: string | null;
  rateDifferences: { group: string; caseRate: string | null; dgiRate: string }[];
  dgiError: FailureSummary | null;
  uid: string | null;
  cancel: { ok: boolean; error: FailureSummary | null; note: string | null } | null;
  dgiTotals: Record<string, string> | null;
  ours: Record<string, Record<string, string>> | null;
  comparisons: PolicyComparison[] | null;
  matchedPolicies: string[] | null;
}

export interface CalibrationReport {
  kind: 'lalanda-etalonnage-arrondis';
  reportVersion: 1;
  adr: 'ADR-0024 § 7';
  generatedAt: string;
  environment: 'test';
  target: string;
  engine: {
    invoiceTotalsVersion: string;
    defaultPolicyId: string;
    policies: { id: string; lineAmount: string; vat: string }[];
  };
  dgi: {
    tokenValidUntil: string | null;
    serverDateTime: string | null;
    taxGroups: Record<string, number> | null;
    usdRate: { rate: string; date: string } | null;
  };
  cases: CaseReport[];
  stoppedEarly: string | null;
  verdict: Verdict;
  /** Rappels pour la personne qui lit le rapport. */
  notes: string[];
}

export interface CalibrationDeps {
  edef: CalibrationEdef;
  target: { testUrl: string; productionUrl: string };
  isfTest: string | null;
  /** Invite masquée — appelée APRÈS les contrôles locaux, avant tout appel réseau. */
  readToken: () => Promise<Secret>;
  out: (line: string) => void;
  /** Chemin complet du rapport JSON (hors suivi git). */
  reportPath: string;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  spacingMs?: number;
}

export interface CalibrationResult {
  report: CalibrationReport;
  reportFile: { path: string; sha256: string };
  proposal: { text: string; requiresNewPolicy: boolean; path: string } | null;
}

function summarize(error: EdefFailure): FailureSummary {
  return {
    kind: error.kind,
    httpStatus: error.httpStatus,
    dgiErrorCode: error.dgiErrorCode,
    message: error.message,
  };
}

const NO_RESPONSE_NOTE =
  'Sans réponse : la demande a peut-être été créée. Elle expirera seule au bout de deux minutes ' +
  '(aucune confirmation n’est jamais envoyée par l’étalonnage).';

export async function runCalibration(deps: CalibrationDeps): Promise<CalibrationResult> {
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const spacing = deps.spacingMs ?? CALL_SPACING_MS;
  const out = deps.out;

  // 1. Contrôles locaux, AVANT la saisie du jeton et avant tout appel réseau.
  const target = assertTestTarget(deps.target.testUrl, deps.target.productionUrl);
  if (!deps.isfTest) {
    throw new CalibrationRefusal(
      'DGI_ISF_TEST n’est pas renseigné : l’ISF de test est obligatoire pour envoyer une facture.',
    );
  }
  const reportPath = deps.reportPath;
  const proposalPath = reportPath.replace(/\.json$/, '') + '.proposition.txt';
  checkOutputPath(reportPath);
  checkOutputPath(proposalPath);

  const edef = restrictToCalibration(deps.edef);
  const token = await deps.readToken();
  const ctx: EdefCallContext = {
    environment: 'test',
    token,
    organizationId: null,
    pointOfSaleId: null,
  };

  let calls = 0;
  const paced = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (calls > 0 && spacing > 0) await sleep(spacing);
    calls += 1;
    return fn();
  };

  // 2. Statut du jeton : NIF lu sur la réponse, jamais saisi.
  const status = await paced(() => edef.getStatus(ctx));
  if (!status.ok) {
    throw new CalibrationRefusal(`Statut e-MCF illisible : ${status.error.message}`);
  }
  if (!status.data.status) {
    throw new CalibrationRefusal(
      'La DGI indique un statut e-MCF non valide pour ce jeton : arrêt.',
    );
  }
  const nif = status.data.nif;
  if (!nif) throw new CalibrationRefusal('La DGI n’a pas renvoyé de NIF pour ce jeton : arrêt.');
  out(`Jeton de test accepté par la DGI (valable jusqu’au ${status.data.tokenValid}).`);

  // 3. Listes de référence : taux (obligatoire), taux USD et types de client (facultatifs).
  const taxGroupsOutcome = await paced(() => edef.getReferenceList('taxGroups', ctx));
  if (!taxGroupsOutcome.ok) {
    throw new CalibrationRefusal(
      `Liste des groupes de taxation illisible : ${taxGroupsOutcome.error.message}`,
    );
  }
  const taxGroups: EdefReferenceData['taxGroups'] = taxGroupsOutcome.data;
  const currencyOutcome = await paced(() => edef.getReferenceList('currencyRates', ctx));
  const currencyRates: EdefCurrencyRate[] = currencyOutcome.ok ? currencyOutcome.data : [];
  const clientTypesOutcome = await paced(() => edef.getReferenceList('clientTypes', ctx));
  const clientTypeDesc = clientTypesOutcome.ok
    ? (clientTypesOutcome.data.find((t) => t.type === 'PP')?.description ?? null)
    : null;
  const usd = usdRateOf(currencyRates);

  // 4. Les cas, un par un : envoi, annulation immédiate, puis analyse.
  const cases = selectCalibrationCases();
  const reports: CaseReport[] = [];
  const recordCases: RecordCase[] = [];
  let stoppedEarly: string | null = null;

  for (const c of cases) {
    const base = emptyCase(c);
    if (stoppedEarly) {
      reports.push({ ...base, status: 'not_sent', reason: `Non envoyé : ${stoppedEarly}` });
      continue;
    }
    const rates = resolveRates(c, taxGroups);
    if (!rates.ok) {
      reports.push({ ...base, status: 'skipped', reason: rates.reason });
      out(`• ${c.id} : non envoyé (${rates.reason}).`);
      continue;
    }
    let counterValue: CounterValueSource | null = null;
    if (c.counterValue) {
      counterValue = usd;
      if (!counterValue) {
        reports.push({
          ...base,
          status: 'skipped',
          reason: 'taux USD absent de la liste currencyRates de la DGI',
        });
        out(`• ${c.id} : non envoyé (taux USD absent).`);
        continue;
      }
    }

    const rn = calibrationRn(c.id, c.input.priceMode, now());
    const body = buildCalibrationRequest(c, {
      nif,
      isf: deps.isfTest,
      rn,
      rates: rates.rates,
      clientTypeDesc,
      counterValue,
    });
    const invoiceCtx = { ...ctx, invoiceId: `etalonnage:${c.id}`, rn };
    const caseReport: CaseReport = { ...base, rn, rateDifferences: rates.differences };

    const submitted = await paced(() => edef.submitInvoice(body, invoiceCtx));
    if (!submitted.ok) {
      const error = summarize(submitted.error);
      const noResponse = ['timeout', 'network', 'server', 'invalid_response'].includes(error.kind);
      reports.push({
        ...caseReport,
        status: noResponse ? 'no_response' : 'refused',
        reason: noResponse ? NO_RESPONSE_NOTE : 'Refus de la DGI (code et libellé conservés).',
        dgiError: error,
      });
      out(`• ${c.id} : ${noResponse ? 'sans réponse' : 'refusé'} — ${error.message}`);
      if (error.kind === 'unauthorized') stoppedEarly = 'jeton refusé par la DGI (HTTP 401)';
      if (error.kind === 'business' && error.dgiErrorCode === '1') {
        stoppedEarly = 'e-MCF saturé (erreur DGI 1 : trop de demandes en attente)';
      }
      continue;
    }

    // Annulation IMMÉDIATE, avant toute analyse.
    const uid = submitted.data.uid;
    const cancelled = await paced(() => edef.cancelInvoice(uid, invoiceCtx));
    caseReport.uid = uid;
    caseReport.cancel = cancelled.ok
      ? { ok: true, error: null, note: null }
      : {
          ok: false,
          error: summarize(cancelled.error),
          note: 'Annulation sans succès : la demande expirera seule au bout de deux minutes.',
        };
    if (!cancelled.ok) {
      out(`  ! annulation de ${c.id} sans succès : la demande expirera seule en deux minutes.`);
      if (cancelled.error.kind === 'unauthorized') {
        stoppedEarly = 'jeton refusé par la DGI (HTTP 401)';
      }
    }

    // Analyse.
    const raw = submitted.data.raw;
    const predicted = predictions(c, rates.rates as TaxRateTable);
    const { comparisons, matchedPolicies } = compareUnderPolicies(
      predicted,
      rates.rates,
      raw,
      counterValue,
    );
    const dgiTotals = dgiTotalsAsReceived(raw, counterValue);
    reports.push({
      ...caseReport,
      status: 'compared',
      dgiTotals,
      ours: oursByPolicy(predicted, rates.rates, counterValue),
      comparisons,
      matchedPolicies,
    });
    if (c.decisive) {
      recordCases.push({ caseId: c.id, priceMode: c.input.priceMode, matchedPolicies, dgiTotals });
    }
    out(
      `• ${c.id} (${c.input.priceMode.toUpperCase()}) : ${
        matchedPolicies.length
          ? `identique sous ${matchedPolicies.join(', ')}`
          : 'aucune politique ne reproduit la DGI'
      }${c.decisive ? '' : ' (pour information, cas non décisif)'}.`,
    );
  }

  // 5. Verdict, rapport, proposition.
  const verdict = decideVerdict(
    reports.map((r) => ({
      id: r.id,
      decisive: r.decisive,
      status: r.status,
      matchedPolicies: r.matchedPolicies ?? [],
    })),
  );
  const generatedAt = now();
  const report: CalibrationReport = {
    kind: 'lalanda-etalonnage-arrondis',
    reportVersion: 1,
    adr: 'ADR-0024 § 7',
    generatedAt: generatedAt.toISOString(),
    environment: 'test',
    target,
    engine: {
      invoiceTotalsVersion: INVOICE_TOTALS_VERSION,
      defaultPolicyId: DGI_ROUNDING_POLICY.id,
      policies: CALIBRATION_ROUNDING_POLICIES.map((p) => ({
        id: p.id,
        lineAmount: p.lineAmount,
        vat: p.vat,
      })),
    },
    dgi: {
      tokenValidUntil: status.data.tokenValid,
      serverDateTime: status.data.serverDateTime,
      taxGroups,
      usdRate: usd ? { rate: usd.rate, date: usd.date } : null,
    },
    cases: reports,
    stoppedEarly,
    verdict,
    notes: [
      'Toutes les factures de cet étalonnage ont été envoyées puis annulées ; aucune n’a été confirmée.',
      'Ni le jeton, ni le NIF, ni le corps des requêtes ne figurent dans ce rapport.',
      'Le relevé ROUNDING_CALIBRATION se remplit À LA MAIN, après relecture, depuis la proposition.',
    ],
  };
  const text = serializeReport(report, { token, nif });
  const reportFile = writeReportFile(reportPath, text);

  const proposed = proposeCalibrationRecord({
    verdict,
    cases: recordCases,
    calibratedAt: generatedAt.toISOString().slice(0, 10),
    reportSha256: reportFile.sha256,
  });
  let proposal: CalibrationResult['proposal'] = null;
  if (proposed) {
    const written = writeReportFile(proposalPath, serializeText(proposed.text, token, nif));
    proposal = { ...proposed, path: written.path };
  }

  out('');
  out(`Rapport écrit : ${reportFile.path}`);
  out(`Empreinte sha256 du rapport : ${reportFile.sha256}`);
  if (stoppedEarly) out(`Arrêt anticipé : ${stoppedEarly}.`);
  if (verdict.decided) {
    out(`Verdict : politique ${verdict.policyId} — ${verdict.reason}`);
    if (proposal) {
      out(`Proposition de relevé (à relire, puis à recopier à la main) : ${proposal.path}`);
      if (proposal.requiresNewPolicy) {
        out(
          'ATTENTION : la politique observée n’est pas la politique par défaut ; une nouvelle version du calcul est nécessaire (voir la proposition).',
        );
      }
    }
  } else {
    out(`Verdict : NON DÉCIDÉ — ${verdict.reason}`);
    if (verdict.candidates.length) out(`Candidates : ${verdict.candidates.join(', ')}`);
  }
  out('Le relevé rounding-calibration.ts n’a PAS été modifié : c’est une personne qui le valide.');

  return { report, reportFile, proposal };
}

function serializeText(text: string, token: Secret, nif: string): string {
  if (text.includes(token.expose())) {
    throw new CalibrationRefusal(
      'Erreur de programmation : le jeton apparaîtrait dans la proposition.',
    );
  }
  return nif.length >= 6 ? text.split(nif).join('[NIF]') : text;
}

function emptyCase(c: CalibrationCase): CaseReport {
  return {
    id: c.id,
    baseCaseId: c.baseCaseId,
    origin: c.origin,
    reliability: c.reliability,
    decisive: c.decisive,
    priceMode: c.input.priceMode,
    rn: null,
    status: 'not_sent',
    reason: null,
    rateDifferences: [],
    dgiError: null,
    uid: null,
    cancel: null,
    dgiTotals: null,
    ours: null,
    comparisons: null,
    matchedPolicies: null,
  };
}
