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
//   - liens facture ↔ projet (`work_invoice_links`), la facture ignore le projet.
//
// Les devis et les factures sont LUS en lecture seule par la connexion
// (`sales_quotes`, `sales_invoices`), sans toucher au service des devis. Toute
// référence d'une autre organisation répond 404.

import {
  WORK_LIMITS,
  rankBetween,
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

/** Collections d'autres modules, lues en lecture seule. */
const QUOTES = 'sales_quotes';
const INVOICES = 'sales_invoices';

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

    const quoteId = body.quoteId;
    const name = (body.name ?? quote.title?.trim() ?? `Projet ${quote.number}`)
      .trim()
      .slice(0, WORK_LIMITS.projectNameMax);
    const columns = (await this.settings.get(organizationId)).defaultColumns;
    const todo = columns.find((c) => c.category === 'todo') ?? columns[0]!;
    const taskCount = picked.length + (body.milestone ? 1 : 0);

    let created: WorkProjectDocument;
    try {
      created = await this.projectModel.create({
        organizationId,
        name: name || `Projet ${quote.number}`,
        description: null,
        kind: 'client',
        status: 'active',
        ownerUserId: null,
        startDate: null,
        dueDate: null,
        links: {
          customerId: quote.customer?.customerId ?? null,
          opportunityId: quote.opportunityId ?? null,
          quoteIds: [quoteId],
        },
        source: { kind: 'quote', quoteId, quoteVersion: quote.version, createdAt: new Date() },
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
      const winner = await this.projectModel
        .findOne({ organizationId, 'source.kind': 'quote', 'source.quoteId': quoteId }, { _id: 1 })
        .lean<{ _id: unknown }>()
        .exec();
      this.alreadyExists(winner ? String(winner._id) : null);
    }
    const projectId = String(created._id);

    // Une tâche par ligne, sans montant : désignation, quantité et unité seulement.
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
    const docs: Record<string, unknown>[] = picked.map(({ index, line }, i) => {
      rank = rankBetween(rank, null);
      const quantity = `Quantité : ${line.quantity}${line.unit ? ` ${line.unit}` : ''}`;
      return {
        ...base,
        number: i + 1,
        title: (line.name || `Ligne ${index + 1}`).slice(0, WORK_LIMITS.taskTitleMax),
        description: `${quantity}\nLigne ${index + 1} du devis ${quote.number} v${quote.version}.`,
        rank,
        dueDate: null,
        isMilestone: false,
        source: { kind: 'quote_line', quoteId, lineIndex: index },
      };
    });
    if (body.milestone) {
      rank = rankBetween(rank, null);
      docs.push({
        ...base,
        number: docs.length + 1,
        title: body.milestone.title,
        description: null,
        rank,
        dueDate: body.milestone.dueDate,
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
          data: { name, kind: 'client', quoteId, quoteNumber: quote.number },
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
