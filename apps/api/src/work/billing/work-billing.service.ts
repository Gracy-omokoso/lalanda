// Branchements « argent » des projets du RUN — ADR-0039 § 6.1, § 6.3 et § 2.9
// (lot L4a).
//
//   - devis accepté → projet client : une tâche par ligne retenue, SANS aucun
//     montant (le devis fait foi) ; idempotent par l'index unique partiel
//     `{ organizationId, source.quoteId }` → `409 WORK_PROJECT_EXISTS_FOR_QUOTE` ;
//   - jalon terminé → BROUILLON de facture `FV` par `InvoiceDraftsService.create`
//     (le service existant, sans changement), lignes du devis à PRIX FIXÉS
//     (`lineInputOf(l, true)`, comme la conversion d'ADR-0035). Le brouillon n'est
//     JAMAIS émis, JAMAIS normalisé, JAMAIS envoyé : aucun appel e-MCF/DGI ici ;
//   - liens facture ↔ projet (`work_invoice_links`), la facture ignore le projet ;
//   - ADR-0040 — C7 § 6.4 : opportunité gagnée → projet, en déléguant à la logique
//     devis → projet quand un devis accepté existe ; sinon une tâche par ligne de
//     l'opportunité, idempotent par `{ organizationId, source.opportunityId }`
//     → `409 WORK_PROJECT_EXISTS_FOR_OPPORTUNITY`.
//
// Les devis et les factures sont LUS en lecture seule par la connexion
// (`sales_quotes`, `sales_invoices`), sans toucher au service des devis. Toute
// référence d'une autre organisation répond 404.

import {
  WORK_LIMITS,
  rankBetween,
  type CreateProjectFromOpportunityBody,
  type CreateProjectFromQuoteBody,
  type PrepareInvoiceBody,
  type WorkInvoiceLinkView,
  type WorkProjectView,
  type WorkTaskView,
} from '@lalanda/shared/work';
import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';

import type { InvoiceDraftInput } from '../../sales/invoices/invoices.dto.js';
import type {
  InvoiceActor,
  StoredCustomer,
  StoredLine,
} from '../../sales/invoices/invoice.types.js';
import { InvoiceDraftsService } from '../../sales/invoices/invoice-drafts.service.js';
import { lineInputOf } from '../../sales/quotes/quotes.service.js';
import { searchKeyOf } from '../../sales/search.js';
import {
  conflict,
  forbidden,
  invalid,
  isWorkId,
  notFound,
  oid,
  projectArchived,
  type WorkActor,
} from '../work.common.js';
import { WorkActivityService, type ActivityInput } from '../work-activity.service.js';
import { WorkProjectsService } from '../work-projects.service.js';
import { WorkSettingsService } from '../work-settings.service.js';
import { WorkTasksService } from '../work-tasks.service.js';
import {
  WorkProject,
  WorkTask,
  type WorkProjectDocument,
  type WorkProjectLean,
  type WorkTaskDocument,
  type WorkTaskLean,
} from '../work.schemas.js';
import {
  WorkInvoiceLink,
  type WorkInvoiceLinkDocument,
  type WorkInvoiceLinkLean,
} from './work-invoice-link.schema.js';
import { opportunityProjectFilter } from './work-opportunity-events.js';

/** Collections d'autres modules, lues en lecture seule. */
const QUOTES = 'sales_quotes';
const INVOICES = 'sales_invoices';
// ADR-0040 — C7 : opportunités et comptes du CRM, lus en lecture seule.
const OPPORTUNITIES = 'crm_opportunities';
const ACCOUNTS = 'crm_accounts';

/** Types de facture qu'un projet peut porter : factures de vente, jamais un avoir ni un acompte. */
const LINKABLE_TYPES: readonly string[] = ['FV', 'EV'];

/** Ce qu'on lit d'un devis (`sales_quotes`). */
export interface QuoteRead {
  _id: unknown;
  number: string;
  version: number;
  status: string;
  title: string | null;
  opportunityId: string | null;
  currency: 'CDF' | 'USD';
  priceMode: 'ttc' | 'ht';
  customer: StoredCustomer;
  lines: StoredLine[];
}

/** Ce qu'on lit d'une facture (`sales_invoices`). */
interface InvoiceRead {
  _id: unknown;
  type: string;
  status: string;
  number: string | null;
  currency: 'CDF' | 'USD';
}

/** Réponse de `POST /work/tasks/:taskId/prepare-invoice`. */
export interface PreparedInvoiceView {
  invoiceId: string;
  link: WorkInvoiceLinkView;
  task: WorkTaskView;
}

/** Utilisateur de la requête, tel que le rend `@CurrentUser()`. */
export interface BillingUser {
  id: string;
  name?: string | null;
  email?: string | null;
}

function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: number } | null)?.code === 11000;
}

/** Lignes retenues d'un devis : toutes par défaut ; un indice hors du devis est refusé. */
export function pickQuoteLines(
  quote: QuoteRead,
  lineIndexes: readonly number[] | undefined,
): { index: number; line: StoredLine }[] {
  const all = quote.lines.map((line, index) => ({ index, line }));
  if (lineIndexes === undefined) return all;
  const bad = lineIndexes.find((i) => i >= quote.lines.length);
  if (bad !== undefined) {
    invalid(
      'lineIndexes',
      'INVALID_VALUE',
      `Le devis ${quote.number} n’a pas de ligne d’indice ${bad} (${quote.lines.length} ligne(s)).`,
    );
  }
  return [...lineIndexes].sort((a, b) => a - b).map((i) => all[i]!);
}

/** Ce qu'on lit d'une opportunité (`crm_opportunities`, ADR-0040 — C7). */
export interface OpportunityRead {
  _id: unknown;
  title: string;
  status: string;
  customerId: string | null;
  accountId?: string | null;
  lines?: { label: string; quantity: string; unit: string | null }[];
}

/** Tâche à créer avec un projet : jamais de montant. */
interface TaskSeed {
  title: string;
  description: string;
  source: Record<string, unknown> | null;
}

/** « Quantité : 12 m² » — la quantité et l'unité, jamais un prix. */
function quantityText(quantity: string | number, unit: string | null | undefined): string {
  return `Quantité : ${quantity}${unit ? ` ${unit}` : ''}`;
}

/** Nom de projet borné, avec repli. */
function projectNameOf(name: string | null | undefined, fallback: string): string {
  const n = (name ?? '').trim().slice(0, WORK_LIMITS.projectNameMax).trim();
  return n || fallback.slice(0, WORK_LIMITS.projectNameMax);
}

/** Lignes retenues d'une opportunité : toutes par défaut ; un indice hors limites est refusé. */
export function pickOpportunityLines(
  opp: OpportunityRead,
  lineIndexes: readonly number[] | undefined,
): { index: number; line: NonNullable<OpportunityRead['lines']>[number] }[] {
  const lines = opp.lines ?? [];
  const all = lines.map((line, index) => ({ index, line }));
  if (lineIndexes === undefined) return all;
  const bad = lineIndexes.find((i) => i >= lines.length);
  if (bad !== undefined) {
    invalid(
      'lineIndexes',
      'INVALID_VALUE',
      `L’opportunité n’a pas de ligne d’indice ${bad} (${lines.length} ligne(s)).`,
    );
  }
  return [...lineIndexes].sort((a, b) => a - b).map((i) => all[i]!);
}

@Injectable()
export class WorkBillingService {
  constructor(
    @InjectModel(WorkInvoiceLink.name) private readonly links: Model<WorkInvoiceLinkDocument>,
    @InjectModel(WorkProject.name) private readonly projectModel: Model<WorkProjectDocument>,
    @InjectModel(WorkTask.name) private readonly taskModel: Model<WorkTaskDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(WorkProjectsService) private readonly projects: WorkProjectsService,
    @Inject(WorkTasksService) private readonly tasks: WorkTasksService,
    @Inject(WorkSettingsService) private readonly settings: WorkSettingsService,
    @Inject(WorkActivityService) private readonly activity: WorkActivityService,
    @Inject(InvoiceDraftsService) private readonly drafts: InvoiceDraftsService,
  ) {}

  // ── Lectures d'autres modules ────────────────────────────────────────────

  private async quoteOf(organizationId: string, quoteId: string): Promise<QuoteRead> {
    if (!isWorkId(quoteId)) notFound('QUOTE_NOT_FOUND', 'Devis introuvable.');
    const doc = await this.connection.collection(QUOTES).findOne(
      { _id: oid(quoteId), organizationId },
      {
        projection: {
          number: 1,
          version: 1,
          status: 1,
          title: 1,
          opportunityId: 1,
          currency: 1,
          priceMode: 1,
          customer: 1,
          lines: 1,
        },
      },
    );
    if (!doc) notFound('QUOTE_NOT_FOUND', 'Devis introuvable.');
    return doc as unknown as QuoteRead;
  }

  private async invoicesOf(
    organizationId: string,
    ids: readonly string[],
  ): Promise<Map<string, InvoiceRead>> {
    const valid = [...new Set(ids.filter(isWorkId))];
    if (valid.length === 0) return new Map();
    const docs = (await this.connection
      .collection(INVOICES)
      .find(
        { _id: { $in: valid.map(oid) }, organizationId },
        { projection: { type: 1, status: 1, number: 1, currency: 1 } },
      )
      .toArray()) as unknown as InvoiceRead[];
    return new Map(docs.map((d) => [String(d._id), d]));
  }

  private static invoiceActorOf(user: BillingUser, actor: WorkActor): InvoiceActor {
    const name = user.name?.trim();
    return {
      userId: actor.userId,
      name: name ? name : (user.email ?? actor.userId),
      role: actor.role ?? 'unknown',
    };
  }

  // ── Devis accepté → projet client (§ 6.1) ────────────────────────────────

  async createFromQuote(
    organizationId: string,
    body: CreateProjectFromQuoteBody,
    actor: WorkActor,
  ): Promise<WorkProjectView> {
    const quote = await this.quoteOf(organizationId, body.quoteId);
    const existing = await this.projectModel
      .findOne(
        { organizationId, 'source.kind': 'quote', 'source.quoteId': body.quoteId },
        { _id: 1 },
      )
      .lean<{ _id: unknown }>()
      .exec();
    if (existing) this.alreadyExists(String(existing._id));
    if (quote.status !== 'accepted') {
      conflict('WORK_QUOTE_NOT_ACCEPTED', 'Seul un devis accepté se transforme en projet.', {
        status: quote.status,
      });
    }
    const picked = pickQuoteLines(quote, body.lineIndexes);
    await this.assertProjectRoom(organizationId);

    const quoteId = body.quoteId;
    const name = projectNameOf(body.name ?? quote.title, `Projet ${quote.number}`);
    return this.materialize(
      organizationId,
      {
        name,
        links: {
          customerId: quote.customer?.customerId ?? null,
          opportunityId: quote.opportunityId ?? null,
          quoteIds: [quoteId],
        },
        source: { kind: 'quote', quoteId, quoteVersion: quote.version, createdAt: new Date() },
        seeds: picked.map(({ index, line }) => ({
          title: line.name || `Ligne ${index + 1}`,
          description: `${quantityText(line.quantity, line.unit)}\nLigne ${index + 1} du devis ${quote.number} v${quote.version}.`,
          source: { kind: 'quote_line', quoteId, lineIndex: index },
        })),
        milestone: body.milestone,
        activity: { name, kind: 'client', quoteId, quoteNumber: quote.number },
        duplicate: async () => {
          const winner = await this.projectModel
            .findOne(
              { organizationId, 'source.kind': 'quote', 'source.quoteId': quoteId },
              { _id: 1 },
            )
            .lean<{ _id: unknown }>()
            .exec();
          this.alreadyExists(winner ? String(winner._id) : null);
        },
      },
      actor,
    );
  }

  // ── Opportunité gagnée → projet (ADR-0040 — C7 § 6.4) ───────────────────

  /**
   * Jamais automatique : geste d'un détenteur de `work.manage` + `crm.read`.
   * Avec un devis accepté de l'opportunité (`quoteId`, ou son unique devis
   * accepté) : délègue à `createFromQuote` (même idempotence, `links.opportunityId`
   * posé). Sans devis : une tâche par ligne de l'opportunité, sans montant,
   * `source.kind = 'opportunity'`, idempotent par l'index unique partiel.
   * `salesRead` : l'appelant détient `sales.read` (exigé pour désigner un devis).
   */
  async createFromOpportunity(
    organizationId: string,
    body: CreateProjectFromOpportunityBody,
    actor: WorkActor,
    access: { salesRead: boolean },
  ): Promise<WorkProjectView> {
    const opp = await this.opportunityOf(organizationId, body.opportunityId);
    const opportunityId = String(opp._id);
    const existing = await this.projectModel
      .findOne(opportunityProjectFilter(organizationId, opportunityId), { _id: 1 })
      .lean<{ _id: unknown }>()
      .exec();
    if (existing) this.alreadyExistsForOpportunity(String(existing._id));
    if (opp.status !== 'won') {
      conflict(
        'WORK_OPPORTUNITY_NOT_WON',
        'Seule une opportunité gagnée se transforme en projet.',
        { status: opp.status },
      );
    }

    const quoteId = await this.acceptedQuoteOf(organizationId, opportunityId, body, access);
    if (quoteId !== null) {
      return this.createFromQuote(
        organizationId,
        {
          quoteId,
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.lineIndexes !== undefined ? { lineIndexes: body.lineIndexes } : {}),
          ...(body.milestone !== undefined ? { milestone: body.milestone } : {}),
        },
        actor,
      );
    }

    const picked = pickOpportunityLines(opp, body.lineIndexes);
    await this.assertProjectRoom(organizationId);
    const customerId = await this.customerOfOpportunity(organizationId, opp);
    const name = projectNameOf(body.name ?? opp.title, 'Projet de l’opportunité');
    return this.materialize(
      organizationId,
      {
        name,
        links: { customerId, opportunityId, quoteIds: [] },
        source: { kind: 'opportunity', opportunityId, createdAt: new Date() },
        seeds: picked.map(({ index, line }) => ({
          title: line.label || `Ligne ${index + 1}`,
          description: `${quantityText(line.quantity, line.unit)}\nLigne ${index + 1} de l’opportunité.`,
          source: null,
        })),
        milestone: body.milestone,
        activity: { name, kind: 'client', opportunityId },
        duplicate: async () => {
          const winner = await this.projectModel
            .findOne(opportunityProjectFilter(organizationId, opportunityId), { _id: 1 })
            .lean<{ _id: unknown }>()
            .exec();
          this.alreadyExistsForOpportunity(winner ? String(winner._id) : null);
        },
      },
      actor,
    );
  }

  /** Projet issu de cette opportunité (ou d'un de ses devis), ou `null`. */
  async projectForOpportunity(
    organizationId: string,
    opportunityId: string,
  ): Promise<{ projectId: string | null }> {
    if (!isWorkId(opportunityId)) return { projectId: null };
    const doc = await this.projectModel
      .findOne(opportunityProjectFilter(organizationId, opportunityId.toLowerCase()), { _id: 1 })
      .lean<{ _id: unknown }>()
      .exec();
    return { projectId: doc ? String(doc._id) : null };
  }

  private async opportunityOf(
    organizationId: string,
    opportunityId: string,
  ): Promise<OpportunityRead> {
    if (!isWorkId(opportunityId)) notFound('CRM_OPPORTUNITY_NOT_FOUND', 'Opportunité introuvable.');
    const doc = await this.connection
      .collection(OPPORTUNITIES)
      .findOne(
        { _id: oid(opportunityId), organizationId },
        { projection: { title: 1, status: 1, customerId: 1, accountId: 1, lines: 1 } },
      );
    if (!doc) notFound('CRM_OPPORTUNITY_NOT_FOUND', 'Opportunité introuvable.');
    return doc as unknown as OpportunityRead;
  }

  /**
   * Devis accepté auquel déléguer : `quoteId` (exige `sales.read`, doit appartenir
   * à l'opportunité), sinon l'unique devis accepté de l'opportunité, sinon `null`.
   * Plusieurs devis acceptés sans choix : `409 WORK_OPPORTUNITY_QUOTE_REQUIRED`.
   */
  private async acceptedQuoteOf(
    organizationId: string,
    opportunityId: string,
    body: CreateProjectFromOpportunityBody,
    access: { salesRead: boolean },
  ): Promise<string | null> {
    if (body.quoteId !== undefined) {
      if (!access.salesRead) {
        forbidden('FORBIDDEN', 'Désigner un devis exige le droit de lire les ventes.');
      }
      const quote = await this.quoteOf(organizationId, body.quoteId);
      if (quote.opportunityId !== opportunityId) {
        invalid(
          'quoteId',
          'WORK_QUOTE_NOT_OF_OPPORTUNITY',
          `Le devis ${quote.number} n’est pas rattaché à cette opportunité.`,
        );
      }
      return body.quoteId;
    }
    const accepted = await this.connection
      .collection(QUOTES)
      .find(
        { organizationId, opportunityId, status: 'accepted' },
        { projection: { _id: 1 }, limit: 2 },
      )
      .toArray();
    if (accepted.length === 1) return String(accepted[0]!._id);
    if (accepted.length > 1) {
      conflict(
        'WORK_OPPORTUNITY_QUOTE_REQUIRED',
        'Plusieurs devis de cette opportunité sont acceptés : choisissez celui que le projet suit.',
      );
    }
    return null;
  }

  /** Client du compte de l'opportunité (`null` pour un prospect). */
  private async customerOfOpportunity(
    organizationId: string,
    opp: OpportunityRead,
  ): Promise<string | null> {
    if (opp.accountId && isWorkId(opp.accountId)) {
      const account = await this.connection
        .collection(ACCOUNTS)
        .findOne({ _id: oid(opp.accountId), organizationId }, { projection: { customerId: 1 } });
      if (account) return (account['customerId'] as string | null | undefined) ?? null;
    }
    return opp.customerId ?? null;
  }

  // ── Création commune (devis, opportunité) ───────────────────────────────

  private async assertProjectRoom(organizationId: string): Promise<void> {
    const active = await this.projectModel
      .countDocuments({ organizationId, status: { $ne: 'archived' } })
      .exec();
    if (active >= WORK_LIMITS.activeProjectsPerOrganization) {
      conflict(
        'WORK_PROJECT_LIMIT',
        `Une organisation compte au plus ${WORK_LIMITS.activeProjectsPerOrganization} projets non archivés : archivez-en un.`,
        { limit: WORK_LIMITS.activeProjectsPerOrganization },
      );
    }
  }

  /**
   * Projet client, une tâche par graine (sans montant) et un jalon final
   * facultatif. Pas de projet à moitié créé : tout est retiré en cas d'échec.
   * Doublon (index unique) : `duplicate()` lève le 409 qui convient.
   */
  private async materialize(
    organizationId: string,
    input: {
      name: string;
      links: { customerId: string | null; opportunityId: string | null; quoteIds: string[] };
      source: Record<string, unknown>;
      seeds: TaskSeed[];
      milestone: { title: string; dueDate: string } | undefined;
      activity: Record<string, unknown>;
      duplicate: () => Promise<void>;
    },
    actor: WorkActor,
  ): Promise<WorkProjectView> {
    const { name } = input;
    const columns = (await this.settings.get(organizationId)).defaultColumns;
    const todo = columns.find((c) => c.category === 'todo') ?? columns[0]!;
    const taskCount = input.seeds.length + (input.milestone ? 1 : 0);

    let created: WorkProjectDocument;
    try {
      created = await this.projectModel.create({
        organizationId,
        name,
        description: null,
        kind: 'client',
        status: 'active',
        ownerUserId: null,
        startDate: null,
        dueDate: null,
        links: input.links,
        source: input.source,
        columns,
        visibility: 'organization',
        taskSeq: taskCount,
        searchKey: searchKeyOf([name]),
        revision: 1,
        createdBy: actor.userId,
        updatedBy: actor.userId,
        _schemaVersion: 1,
      });
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      await input.duplicate();
      throw err;
    }
    const projectId = String(created._id);

    // Une tâche par graine, sans montant : désignation, quantité et unité seulement.
    let rank: string | null = null;
    const base = {
      organizationId,
      projectId,
      parentTaskId: null,
      columnKey: todo.key,
      done: false,
      completedAt: null,
      completedBy: null,
      assigneeUserId: null,
      followerUserIds: [actor.userId],
      priority: 'none',
      labelKeys: [],
      startDate: null,
      blockedBy: [],
      loggedMinutes: 0,
      estimateMinutes: null,
      billing: null,
      reminders: { dueSoonFor: null, overdueFor: null },
      revision: 1,
      createdBy: actor.userId,
      updatedBy: actor.userId,
      _schemaVersion: 1,
    };
    const docs: Record<string, unknown>[] = input.seeds.map((seed, i) => {
      rank = rankBetween(rank, null);
      return {
        ...base,
        number: i + 1,
        title: seed.title.slice(0, WORK_LIMITS.taskTitleMax),
        description: seed.description,
        rank,
        dueDate: null,
        isMilestone: false,
        source: seed.source,
      };
    });
    if (input.milestone) {
      rank = rankBetween(rank, null);
      docs.push({
        ...base,
        number: docs.length + 1,
        title: input.milestone.title,
        description: null,
        rank,
        dueDate: input.milestone.dueDate,
        isMilestone: true,
        source: null,
      });
    }
    try {
      const inserted = docs.length > 0 ? await this.taskModel.insertMany(docs) : [];
      const entries: ActivityInput[] = [
        {
          projectId,
          actorUserId: actor.userId,
          kind: 'project.created',
          data: input.activity,
        },
        // `insertMany` rend les documents dans l'ordre des entrées.
        ...inserted.map((t, i) => ({
          projectId,
          taskId: String(t._id),
          actorUserId: actor.userId,
          kind: 'task.created' as const,
          data: { number: docs[i]!['number'], title: String(docs[i]!['title']) },
        })),
      ];
      await this.activity.record(organizationId, entries);
    } catch (err) {
      // Pas de projet à moitié créé : on retire ce qui a été posé.
      await this.taskModel.deleteMany({ organizationId, projectId }).exec();
      await this.projectModel.deleteOne({ _id: created._id, organizationId }).exec();
      throw err;
    }
    return this.projects.get(organizationId, projectId);
  }

  private alreadyExists(projectId: string | null): never {
    conflict(
      'WORK_PROJECT_EXISTS_FOR_QUOTE',
      'Un projet existe déjà pour ce devis : ouvrez-le.',
      projectId ? { projectId } : undefined,
    );
  }

  private alreadyExistsForOpportunity(projectId: string | null): never {
    conflict(
      'WORK_PROJECT_EXISTS_FOR_OPPORTUNITY',
      'Un projet existe déjà pour cette opportunité : ouvrez-le.',
      projectId ? { projectId } : undefined,
    );
  }

  /** Projet créé depuis ce devis, ou `null` (fiche du devis : « Ouvrir le projet »). */
  async projectForQuote(
    organizationId: string,
    quoteId: string,
  ): Promise<{ projectId: string | null }> {
    if (!isWorkId(quoteId)) return { projectId: null };
    const doc = await this.projectModel
      .findOne({ organizationId, 'source.kind': 'quote', 'source.quoteId': quoteId }, { _id: 1 })
      .lean<{ _id: unknown }>()
      .exec();
    return { projectId: doc ? String(doc._id) : null };
  }

  // ── Liens facture ↔ projet (§ 2.9) ───────────────────────────────────────

  private linkView(link: WorkInvoiceLinkLean, invoice: InvoiceRead): WorkInvoiceLinkView {
    return {
      invoiceId: link.invoiceId,
      number: invoice.number ?? null,
      status: invoice.status,
      currency: invoice.currency,
      milestoneTaskId: link.milestoneTaskId ?? null,
      origin: link.origin,
      linkedAt: new Date(link.linkedAt).toISOString(),
      linkedBy: link.linkedBy,
    };
  }

  /**
   * Factures liées au projet. Un lien dont la facture n'existe plus (brouillon
   * supprimé) est ignoré et nettoyé au passage, avec la facture préparée du jalon.
   */
  async list(organizationId: string, projectId: string): Promise<WorkInvoiceLinkView[]> {
    await this.projects.requireOwn(organizationId, projectId);
    const links = await this.links
      .find({ organizationId, projectId })
      .sort({ linkedAt: -1, _id: -1 })
      .lean<WorkInvoiceLinkLean[]>()
      .exec();
    const invoices = await this.invoicesOf(
      organizationId,
      links.map((l) => l.invoiceId),
    );
    const orphans = links.filter((l) => !invoices.has(l.invoiceId));
    if (orphans.length > 0) await this.dropLinks(organizationId, orphans);
    return links.flatMap((l) => {
      const invoice = invoices.get(l.invoiceId);
      return invoice ? [this.linkView(l, invoice)] : [];
    });
  }

  /** Retire des liens et la facture préparée des jalons qui les désignaient. */
  private async dropLinks(
    organizationId: string,
    links: readonly WorkInvoiceLinkLean[],
  ): Promise<void> {
    await this.links.deleteMany({ organizationId, _id: { $in: links.map((l) => l._id) } }).exec();
    for (const l of links) {
      if (!l.milestoneTaskId || !isWorkId(l.milestoneTaskId)) continue;
      await this.taskModel
        .updateOne(
          { _id: oid(l.milestoneTaskId), organizationId, 'billing.invoiceId': l.invoiceId },
          { $set: { billing: null }, $inc: { revision: 1 } },
        )
        .exec();
    }
  }

  async link(
    organizationId: string,
    projectId: string,
    invoiceId: string,
    actor: WorkActor,
  ): Promise<WorkInvoiceLinkView> {
    const project = await this.projects.requireOwn(organizationId, projectId);
    if (project.status === 'archived') projectArchived();
    const invoice = (await this.invoicesOf(organizationId, [invoiceId])).get(invoiceId);
    if (!invoice) notFound('INVOICE_NOT_FOUND', 'Facture introuvable.');
    if (!LINKABLE_TYPES.includes(invoice.type)) {
      conflict(
        'WORK_INVOICE_TYPE',
        'Seule une facture de vente (FV ou EV) se rattache à un projet ; un avoir suit sa facture.',
        { type: invoice.type },
      );
    }
    const current = await this.links
      .findOne({ organizationId, invoiceId })
      .lean<WorkInvoiceLinkLean>()
      .exec();
    if (current) {
      if (current.projectId === projectId) return this.linkView(current, invoice);
      this.alreadyLinked(current.projectId);
    }
    let created: WorkInvoiceLinkLean;
    try {
      created = (
        await this.links.create({
          organizationId,
          projectId,
          invoiceId,
          milestoneTaskId: null,
          origin: 'manual',
          linkedAt: new Date(),
          linkedBy: actor.userId,
          _schemaVersion: 1,
        })
      ).toObject() as WorkInvoiceLinkLean;
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      const winner = await this.links.findOne({ organizationId, invoiceId }).lean().exec();
      this.alreadyLinked(winner?.projectId ?? null);
    }
    await this.activity.record(organizationId, {
      projectId,
      actorUserId: actor.userId,
      kind: 'invoice.linked',
      data: { invoiceId, number: invoice.number ?? null, origin: 'manual' },
    });
    await this.projects.touch(organizationId, projectId);
    return this.linkView(created, invoice);
  }

  private alreadyLinked(projectId: string | null): never {
    conflict(
      'WORK_INVOICE_ALREADY_LINKED',
      'Cette facture appartient déjà à un autre projet : retirez-la de celui-ci d’abord.',
      projectId ? { projectId } : undefined,
    );
  }

  async unlink(
    organizationId: string,
    projectId: string,
    invoiceId: string,
    actor: WorkActor,
  ): Promise<void> {
    await this.projects.requireOwn(organizationId, projectId);
    const link = isWorkId(invoiceId)
      ? await this.links
          .findOne({ organizationId, projectId, invoiceId })
          .lean<WorkInvoiceLinkLean>()
          .exec()
      : null;
    if (!link) notFound('WORK_INVOICE_LINK_NOT_FOUND', 'Cette facture n’est pas liée au projet.');
    await this.dropLinks(organizationId, [link]);
    await this.activity.record(organizationId, {
      projectId,
      taskId: link.milestoneTaskId ?? null,
      actorUserId: actor.userId,
      kind: 'invoice.unlinked',
      data: { invoiceId, origin: link.origin },
    });
    await this.projects.touch(organizationId, projectId);
  }

  // ── Jalon terminé → brouillon de facture (§ 6.3) ─────────────────────────

  async prepareInvoice(
    organizationId: string,
    taskId: string,
    body: PrepareInvoiceBody,
    actor: WorkActor,
    user: BillingUser,
  ): Promise<PreparedInvoiceView> {
    const task = await this.tasks.requireOwn(organizationId, taskId);
    const project = await this.projects.requireOwn(organizationId, task.projectId);
    if (project.status === 'archived') projectArchived();
    if (!task.isMilestone) {
      conflict('WORK_TASK_NOT_MILESTONE', 'Seul un jalon prépare une facture.');
    }
    if (!task.done) {
      conflict('WORK_MILESTONE_NOT_DONE', 'Terminez le jalon avant de préparer sa facture.');
    }
    const previous = await this.previousBilling(organizationId, task);

    const quote =
      body.source === 'quote_lines' ? await this.quoteOf(organizationId, body.quoteId) : null;
    if (quote && body.source === 'quote_lines') {
      if (!(project.links?.quoteIds ?? []).includes(body.quoteId)) {
        conflict(
          'WORK_QUOTE_NOT_LINKED',
          'Ce devis n’est pas lié au projet : liez-le avant d’en reprendre les lignes.',
        );
      }
      if (quote.status !== 'accepted') {
        conflict('WORK_QUOTE_NOT_ACCEPTED', 'Seules les lignes d’un devis accepté se facturent.', {
          status: quote.status,
        });
      }
    }
    const customerId = project.links?.customerId ?? null;
    if (!customerId && !quote?.customer) {
      conflict(
        'WORK_PROJECT_NO_CUSTOMER',
        'Ce projet n’a pas de client : rattachez-le à un client avant de préparer une facture.',
      );
    }
    const lines =
      quote && body.source === 'quote_lines'
        ? pickQuoteLines(quote, body.lineIndexes).map(({ line }) => lineInputOf(line, true))
        : [];
    // Devise et mode de prix : ceux du devis repris ; sans devis, ceux du devis
    // d'origine du projet s'il en a un, sinon CDF hors taxes (brouillon à compléter).
    const reference = quote ?? (await this.referenceQuote(organizationId, project));
    const printContactDetails = reference?.customer?.printContactDetails ?? false;
    const customer: InvoiceDraftInput['customer'] = customerId
      ? { customerId, printContactDetails }
      : { customerId: null, walkInName: quote!.customer.name ?? '' };
    const comment = `Projet ${project.name} — jalon ${task.title}`.slice(0, 255);
    const input: InvoiceDraftInput = {
      type: 'FV',
      currency: reference?.currency ?? 'CDF',
      priceMode: reference?.priceMode ?? 'ht',
      customer,
      pointOfSaleId: null,
      lines,
      payments: [],
      comments: { A: null, C: comment },
      creditNote: null,
      showUsdCounterValue: false,
    };

    // Réservation du jalon AVANT la création : deux préparations concurrentes ne
    // créent pas deux brouillons.
    const now = new Date();
    const claimed = await this.taskModel
      .updateOne(
        { _id: task._id, organizationId, billing: previous },
        {
          $set: {
            billing: { invoiceId: 'pending', preparedAt: now, preparedBy: actor.userId },
          },
        },
      )
      .exec();
    if (claimed.matchedCount !== 1) this.alreadyInvoiced();

    let invoiceId: string;
    try {
      const invoice = await this.drafts.create(
        organizationId,
        input,
        WorkBillingService.invoiceActorOf(user, actor),
      );
      invoiceId = invoice.id;
    } catch (err) {
      await this.taskModel
        .updateOne(
          { _id: task._id, organizationId, 'billing.invoiceId': 'pending' },
          { $set: { billing: previous } },
        )
        .exec();
      throw err;
    }
    await this.taskModel
      .updateOne(
        { _id: task._id, organizationId },
        {
          $set: { billing: { invoiceId, preparedAt: now, preparedBy: actor.userId } },
          $inc: { revision: 1 },
        },
      )
      .exec();
    const link = (
      await this.links.create({
        organizationId,
        projectId: task.projectId,
        invoiceId,
        milestoneTaskId: taskId,
        origin: 'milestone',
        linkedAt: now,
        linkedBy: actor.userId,
        _schemaVersion: 1,
      })
    ).toObject() as WorkInvoiceLinkLean;
    await this.activity.record(organizationId, {
      projectId: task.projectId,
      taskId,
      actorUserId: actor.userId,
      kind: 'invoice.prepared',
      data: { invoiceId, source: body.source, lineCount: lines.length },
    });
    await this.projects.touch(organizationId, task.projectId);
    const invoice = (await this.invoicesOf(organizationId, [invoiceId])).get(invoiceId)!;
    return {
      invoiceId,
      link: this.linkView(link, invoice),
      task: await this.tasks.view(organizationId, taskId),
    };
  }

  /**
   * Facture préparée existante du jalon : `409` si son brouillon existe encore ;
   * sinon (brouillon supprimé) le lien orphelin est retiré et la préparation
   * reprend. Rend la valeur courante de `billing`, pour la réservation.
   */
  private async previousBilling(
    organizationId: string,
    task: WorkTaskLean,
  ): Promise<WorkTaskLean['billing']> {
    const billing = task.billing ?? null;
    if (!billing) return null;
    if (billing.invoiceId === 'pending') this.alreadyInvoiced();
    const alive = (await this.invoicesOf(organizationId, [billing.invoiceId])).has(
      billing.invoiceId,
    );
    if (alive) this.alreadyInvoiced();
    await this.links.deleteMany({ organizationId, invoiceId: billing.invoiceId }).exec();
    return billing;
  }

  private alreadyInvoiced(): never {
    conflict(
      'WORK_MILESTONE_ALREADY_INVOICED',
      'Une facture a déjà été préparée pour ce jalon : ouvrez-la.',
    );
  }

  /** Devis de référence du projet : son devis d'origine, sinon le premier lié. */
  private async referenceQuote(
    organizationId: string,
    project: WorkProjectLean,
  ): Promise<QuoteRead | null> {
    const id = project.source?.quoteId ?? project.links?.quoteIds?.[0] ?? null;
    if (!id) return null;
    try {
      return await this.quoteOf(organizationId, id);
    } catch {
      return null;
    }
  }
}
