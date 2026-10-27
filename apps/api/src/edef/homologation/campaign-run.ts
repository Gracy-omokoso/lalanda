// Campagne d'homologation DGI RÉELLE — exécution (ADR-0026 § 7).
//
// Passe par les VRAIS services de Lalanda, exactement le chemin d'un
// utilisateur : fiches clients (`CustomersService`), brouillon puis paiements
// (`InvoiceDraftsService`, corps validés par les MÊMES schémas que l'API),
// « Normaliser » (`InvoiceFreezingService` → normalisation e-MCF par le port),
// PDF original (`InvoiceDocumentsService`). Aucun appel direct à la DGI.
//
// Règles :
// - s'arrête à la PREMIÈRE erreur ; un avoir n'est jamais tenté si son origine
//   n'est pas normalisée ;
// - IDEMPOTENTE et REPRENABLE : chaque brouillon porte l'étiquette interne
//   `campaign` (id, cas, mode) et le fichier d'état de `--out` note chaque cas
//   réussi. Une relance saute les cas notés, retrouve en base un cas normalisé
//   que l'état n'a pas eu le temps de noter (arrêt brutal), supprime un brouillon
//   laissé en route, et S'ARRÊTE devant un document gelé dont la normalisation
//   n'a pas abouti (incertaine, échouée) : jamais de seconde normalisation.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { PriceMode, TaxRateTable } from '@lalanda/engine';
import { HttpException } from '@nestjs/common';

import type { CustomersService, SalesActor } from '../../sales/customers.service.js';
import type { InvoiceDocumentsService } from '../../sales/documents/invoice-documents.service.js';
import type { InvoiceDraftsService } from '../../sales/invoices/invoice-drafts.service.js';
import type { InvoiceFreezingService } from '../../sales/invoices/invoice-freezing.service.js';
import type { InvoiceView } from '../../sales/invoices/invoice.contract.js';
import type { InvoiceActor, InvoiceLean } from '../../sales/invoices/invoice.types.js';
import { CreateInvoiceSchema, PutInvoiceSchema } from '../../sales/invoices/invoices.dto.js';
import { compareSubmission } from '../../sales/normalization/edef-values.js';
import { CALL_SPACING_MS } from '../calibration/calibration-run.js';
import { CreateCustomerSchema, type CustomerType } from '../../sales/sales.dto.js';
import {
  CampaignStop,
  buildReport,
  pdfFileName,
  stepKey,
  writeAtomic,
  writeReports,
  writeState,
  type CampaignEntry,
  type CampaignState,
  type PlannedStep,
  type StepKey,
} from './campaign-plan.js';
import {
  HOMOLOGATION_CUSTOMERS,
  homologationCase,
  homologationDraftBody,
  homologationPayments,
} from './homologation-cases.js';

export interface CampaignServices {
  customers: CustomersService;
  drafts: InvoiceDraftsService;
  freezing: InvoiceFreezingService;
  documents: InvoiceDocumentsService;
}

/** Points d'arrêt simulés — tests seulement. */
export interface CampaignHooks {
  /** Appelé juste après une normalisation réussie, AVANT l'écriture de l'état. */
  afterNormalize?: (step: PlannedStep) => void | Promise<void>;
}

export interface RunCampaignInput {
  services: CampaignServices;
  organizationId: string;
  actor: InvoiceActor;
  campaignId: string;
  steps: readonly PlannedStep[];
  state: CampaignState;
  outDir: string;
  out: (line: string) => void;
  now?: () => Date;
  hooks?: CampaignHooks;
  /** Pause entre deux normalisations (défaut `CALL_SPACING_MS`, comme l'étalonnage). */
  spacingMs?: number;
  /**
   * Délai minimal entre la normalisation d'une facture et celle de son avoir
   * (défaut `ORIGIN_SETTLE_MS`). Constat du 21 oct. 2026 : un avoir envoyé 1,4 s
   * après son origine a été refusé par l'e-MCF de test (erreur 11 « la facture
   * originale est introuvable ») ; la même paire, espacée d'environ 1 s de plus,
   * était passée en TTC. La DGI met donc un court délai à connaître une facture.
   */
  originSettleMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Délai par défaut avant d'envoyer un avoir dont l'origine vient d'être normalisée. */
export const ORIGIN_SETTLE_MS = 20_000;

/** Message d'une erreur de service (corps `{ code, message, details }`), sans rien d'autre. */
export function describeError(err: unknown): string {
  if (err instanceof HttpException) {
    const body = err.getResponse();
    if (typeof body === 'object' && body !== null) {
      const b = body as {
        code?: unknown;
        message?: unknown;
        details?: { issues?: { code?: unknown; message?: unknown }[] };
      };
      const issues = (b.details?.issues ?? [])
        .map((i) => `${String(i.code)} : ${String(i.message)}`)
        .join(' ; ');
      return `${String(b.code ?? err.getStatus())} — ${String(b.message ?? err.message)}${issues ? ` (${issues})` : ''}`;
    }
    return `${err.getStatus()} — ${err.message}`;
  }
  return err instanceof Error ? err.message : 'erreur inconnue';
}

function invalid(what: string, issues: { path: PropertyKey[]; message: string }[]): never {
  throw new CampaignStop(
    `${what} : corps refusé par la validation de l’API (${issues
      .map((i) => `${i.path.join('.')} : ${i.message}`)
      .join(' ; ')}).`,
  );
}

// ── Clients fictifs ──────────────────────────────────────────────────────────

export interface CustomerResolution {
  type: Exclude<CustomerType, 'PP'>;
  name: string;
  nif: string;
  existingId: string | null;
}

/** Fiches clients de la campagne déjà présentes (même type, même NIF, même nom). Lecture seule. */
export async function findCampaignCustomers(
  customers: CustomersService,
  organizationId: string,
): Promise<CustomerResolution[]> {
  const out: CustomerResolution[] = [];
  for (const c of HOMOLOGATION_CUSTOMERS) {
    const page = await customers.list(organizationId, {
      type: c.type,
      q: c.nif,
      status: 'all',
      limit: 100,
    });
    const same = page.items.filter((x) => (x.nif ?? '').toUpperCase() === c.nif.toUpperCase());
    if (same.length > 1) {
      throw new CampaignStop(`Plusieurs fiches clients ${c.type} portent le NIF ${c.nif} : arrêt.`);
    }
    const found = same[0];
    if (found && found.name !== c.name) {
      throw new CampaignStop(
        `Une fiche client ${c.type} porte déjà le NIF fictif ${c.nif} sous un autre nom ` +
          `(« ${found.name} ») : la campagne n’utilise que ses propres fiches « TEST HOMOLOGATION ».`,
      );
    }
    if (found && !found.active) {
      throw new CampaignStop(
        `La fiche client « ${c.name} » est désactivée : réactivez-la (Ventes › Clients), puis relancez.`,
      );
    }
    out.push({ type: c.type, name: c.name, nif: c.nif, existingId: found?.id ?? null });
  }
  return out;
}

/** Crée une fois les fiches manquantes, réutilise les autres. */
export async function ensureCampaignCustomers(
  customers: CustomersService,
  organizationId: string,
  actor: SalesActor,
  out: (line: string) => void,
): Promise<Partial<Record<CustomerType, string>>> {
  const ids: Partial<Record<CustomerType, string>> = {};
  for (const r of await findCampaignCustomers(customers, organizationId)) {
    if (r.existingId !== null) {
      ids[r.type] = r.existingId;
      continue;
    }
    const def = HOMOLOGATION_CUSTOMERS.find((c) => c.type === r.type)!;
    const parsed = CreateCustomerSchema.safeParse({
      type: def.type,
      name: def.name,
      nif: def.nif,
      exemptionReference: def.exemptionReference,
    });
    if (!parsed.success) invalid(`Fiche client ${def.type}`, parsed.error.issues);
    const created = await customers.create(organizationId, parsed.data, actor);
    ids[r.type] = created.id;
    out(`  fiche client créée : ${def.name} (${def.type})`);
  }
  return ids;
}

// ── Exécution ────────────────────────────────────────────────────────────────

function entryOf(
  step: PlannedStep,
  doc: InvoiceLean,
  durationMs: number | null,
  recovered: boolean,
): CampaignEntry {
  const n = doc.normalization;
  const calc = doc.normalizedAmounts?.calculation;
  if (!n || !calc || !doc.number) {
    throw new CampaignStop(`Cas ${step.caseNumber} (${step.mode}) : document normalisé incomplet.`);
  }
  const dgi = n.dgiTotals ?? {};
  const comparison = compareSubmission(
    calc,
    (doc.taxRates?.rates ?? {}) as TaxRateTable,
    dgi,
    doc.normalizedAmounts?.counterValueUsd?.amount ?? null,
  );
  return {
    key: step.key,
    caseNumber: step.caseNumber,
    mode: step.mode,
    title: step.title,
    type: doc.type,
    invoiceId: String(doc._id),
    number: doc.number,
    codeDefDgi: n.codeDefDgi,
    nim: n.nim,
    counters: n.counters,
    dgiDateTime: n.dgiDateTime,
    uid: n.uid,
    totals: {
      lalanda: { total: calc.total, vatTotal: calc.vatTotal, specificTax: calc.specificTax },
      dgi: { total: dgi['total'] ?? null, vtotal: dgi['vtotal'] ?? null, ts: dgi['ts'] ?? null },
      identical: comparison.identical,
      differences: comparison.differences,
    },
    durationMs,
    normalizedAt: n.normalizedAt ? new Date(n.normalizedAt).toISOString() : null,
    recoveredFromDatabase: recovered,
    pdfFile: null,
  };
}

export async function runCampaign(input: RunCampaignInput): Promise<void> {
  const { services, organizationId, actor, campaignId, steps, state, outDir, out } = input;
  const now = input.now ?? (() => new Date());
  const spacing = input.spacingMs ?? CALL_SPACING_MS;
  const originSettle = input.originSettleMs ?? ORIGIN_SETTLE_MS;
  /** Instant de normalisation, dans cette exécution, de chaque cas (pour l'avoir qui suit). */
  const normalizedAtMs = new Map<StepKey, number>();
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let normalizations = 0;
  const save = () => {
    writeState(outDir, state, now());
    writeReports(outDir, buildReport(state, steps, now()));
  };

  const labelled = async (mode: PriceMode, caseNumber: number): Promise<InvoiceLean[]> =>
    (await services.drafts.campaignDocuments(organizationId, campaignId)).filter(
      (d) => d.campaign?.caseNumber === caseNumber && d.campaign?.priceMode === mode,
    );

  const writePdf = async (entry: CampaignEntry): Promise<void> => {
    const file = pdfFileName(entry.caseNumber, entry.mode, entry.number);
    if (entry.pdfFile === file && existsSync(join(outDir, file))) return;
    const rendered = await services.documents.original(organizationId, entry.invoiceId, actor);
    writeAtomic(join(outDir, file), rendered.pdf);
    entry.pdfFile = file;
  };

  const customerIds = await ensureCampaignCustomers(services.customers, organizationId, actor, out);

  const originId = (mode: PriceMode, n: number): string => {
    const e = state.entries[stepKey(mode, n)];
    if (!e) {
      throw new CampaignStop(
        `Le cas ${n} (${mode.toUpperCase()}) n’est pas normalisé : son avoir ne peut pas suivre.`,
      );
    }
    return e.invoiceId;
  };

  let index = 0;
  for (const step of steps) {
    index += 1;
    const label = `[${index}/${steps.length}] cas ${String(step.caseNumber).padStart(2, '0')} ${step.mode.toUpperCase()} — ${step.title}`;

    const done = state.entries[step.key];
    if (done) {
      await writePdf(done);
      save();
      out(`${label} : déjà normalisé (${done.number}), sauté.`);
      continue;
    }

    // Reprise : ce que la base sait de ce cas (étiquette de campagne).
    const previous = await labelled(step.mode, step.caseNumber);
    const normalized = previous.filter((d) => d.status === 'normalized');
    if (normalized.length > 1) {
      throw new CampaignStop(
        `${label} : ${normalized.length} documents normalisés portent l’étiquette de ce cas ` +
          `(${normalized.map((d) => d.number).join(', ')}) : arrêt, vérification humaine requise.`,
      );
    }
    const stuck = previous.filter((d) => d.status !== 'normalized' && d.status !== 'draft');
    if (normalized.length === 0 && stuck.length > 0) {
      const d = stuck[0]!;
      throw new CampaignStop(
        `${label} : un document de ce cas est « ${d.status} » (pro forma ${d.proformaRef}, id ${String(d._id)}). ` +
          'Il n’est jamais renormalisé automatiquement : réglez-le dans Lalanda (Ventes › Factures), puis relancez.',
      );
    }
    for (const draft of previous.filter((d) => d.status === 'draft')) {
      await services.drafts.remove(organizationId, String(draft._id), actor);
      out(`${label} : brouillon abandonné ${draft.proformaRef} supprimé.`);
    }
    if (normalized.length === 1) {
      const entry = entryOf(step, normalized[0]!, null, true);
      state.entries[step.key] = entry;
      save();
      await writePdf(entry);
      save();
      out(`${label} : retrouvé normalisé en base (${entry.number}), PDF écrit, sans renormaliser.`);
      continue;
    }

    // Avoir : l'origine doit être normalisée (état, ou base pour une origine hors
    // du plan de cette exécution) ; sinon arrêt AVANT tout brouillon.
    if (step.originCase !== null && !state.entries[stepKey(step.mode, step.originCase)]) {
      const origins = (await labelled(step.mode, step.originCase)).filter(
        (d) => d.status === 'normalized',
      );
      if (origins.length === 1) {
        const originStep: PlannedStep = {
          key: stepKey(step.mode, step.originCase),
          caseNumber: step.originCase,
          mode: step.mode,
          title: homologationCase(step.originCase).title,
          type: homologationCase(step.originCase).type,
          originCase: null,
        };
        state.entries[originStep.key] = entryOf(originStep, origins[0]!, null, true);
        save();
      }
    }

    // Nouveau document : brouillon, paiements, contrôle, « Normaliser ».
    const c = homologationCase(step.caseNumber);
    const body = homologationDraftBody(c, step.mode, {
      customerIds,
      originInvoiceId: (n) => originId(step.mode, n),
      pointOfSaleId: null,
    });
    const created = CreateInvoiceSchema.safeParse(body);
    if (!created.success) invalid(`${label} — brouillon`, created.error.issues);
    let view: InvoiceView;
    try {
      view = await services.drafts.create(organizationId, created.data, actor, {
        campaign: { id: campaignId, caseNumber: step.caseNumber, priceMode: step.mode },
      });
      const total = view.documentAmounts.calculation.totals?.total;
      if (total === undefined) {
        throw new CampaignStop(
          `${label} : le calcul du brouillon a échoué (${view.documentAmounts.calculation.issues
            .map((i) => i.message)
            .join(' ; ')}).`,
        );
      }
      const put = PutInvoiceSchema.safeParse({
        ...body,
        payments: homologationPayments(c, total),
        expectedRevision: view.revision,
      });
      if (!put.success) invalid(`${label} — paiements`, put.error.issues);
      view = await services.drafts.put(
        organizationId,
        view.id,
        put.data.expectedRevision,
        put.data.draft,
        actor,
      );
    } catch (err) {
      if (err instanceof CampaignStop) throw err;
      throw new CampaignStop(`${label} : brouillon refusé — ${describeError(err)}`);
    }
    if (!view.readiness.ready) {
      throw new CampaignStop(
        `${label} : brouillon non normalisable (${view.readiness.blockers
          .map((b) => `${b.code} : ${b.message}`)
          .join(' ; ')}). Le brouillon ${view.proformaRef} reste ; il sera remplacé à la relance.`,
      );
    }

    if (normalizations > 0 && spacing > 0) await sleep(spacing);
    if (step.originCase !== null && originSettle > 0) {
      const originAt = normalizedAtMs.get(stepKey(step.mode, step.originCase));
      const wait = originAt === undefined ? 0 : originAt + originSettle - Date.now();
      if (wait > 0) {
        out(
          `${label} : attente de ${Math.ceil(wait / 1000)} s pour que la DGI enregistre la facture d’origine.`,
        );
        await sleep(wait);
      }
    }
    normalizations += 1;
    const started = Date.now();
    let result: InvoiceView;
    try {
      result = await services.freezing.normalize(
        organizationId,
        view.id,
        view.revision,
        null,
        actor,
      );
    } catch (err) {
      throw new CampaignStop(`${label} : normalisation refusée — ${describeError(err)}`);
    }
    const durationMs = Date.now() - started;
    if (result.status !== 'normalized') {
      const e = result.normalization?.lastError;
      throw new CampaignStop(
        `${label} : non normalisé (statut ${result.status}${
          e
            ? ` ; ${e.code} — ${e.message}${e.dgiErrorCode ? ` ; DGI ${e.dgiErrorCode} : ${e.dgiMessage ?? ''}` : ''}`
            : ''
        }). Arrêt : aucun cas suivant n’est tenté.`,
      );
    }
    normalizedAtMs.set(step.key, Date.now());
    await input.hooks?.afterNormalize?.(step);

    const doc = (await labelled(step.mode, step.caseNumber)).find(
      (d) => String(d._id) === result.id,
    );
    if (!doc)
      throw new CampaignStop(`${label} : document normalisé introuvable par son étiquette.`);
    const entry = entryOf(step, doc, durationMs, false);
    state.entries[step.key] = entry;
    save();
    await writePdf(entry);
    save();
    out(
      `${label} : normalisé ${entry.number} — Code DEF/DGI ${entry.codeDefDgi ?? '—'} — ` +
        `${entry.totals.identical ? 'totaux identiques' : 'TOTAUX DIFFÉRENTS'} — ${durationMs} ms`,
    );
  }
}

/** Clés déjà normalisées d'après la base (étiquettes) : pour le plan et le dry-run. */
export function normalizedKeysOf(docs: readonly InvoiceLean[]): Set<StepKey> {
  const keys = new Set<StepKey>();
  for (const d of docs) {
    if (d.status === 'normalized' && d.campaign) {
      keys.add(stepKey(d.campaign.priceMode, d.campaign.caseNumber));
    }
  }
  return keys;
}
