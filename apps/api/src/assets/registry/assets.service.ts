// Registre des équipements (ADR-0046 § 3.1, § 3.2, § 5.2, § 6.5). ADR-0046 — S5.
//
// - Isolation : chaque lecture et écriture porte `organizationId` ; tout identifiant
//   d'une autre organisation (équipement, catégorie, fournisseur, facture fournisseur,
//   dépense, collaborateur, projet, emplacement, membre) répond 404.
// - Calculs au MOTEUR (`@lalanda/engine`, assets) : estimation de gestion, coût de
//   possession, historique et contrôle des affectations, échéances, registre.
// - VALEURS (coûts, prix de cession, estimation) : seulement si `visible` (l'appelant
//   détient aussi `purchase.read` ou `treasury.read`, décidé par le contrôleur sur les
//   droits EFFECTIFS) ; sinon `null` et `valuesHidden: true`.
// - Un collaborateur affecté n'est lu que par son nom d'usage et son poste.
// - Aucune règle comptable ni fiscale : l'estimation est étiquetée « estimation de
//   gestion », sans durée par défaut ; une cession est DÉCLARÉE (aucune facture, aucun
//   encaissement) ; une acquisition se RELIE à une facture ou une dépense sans rien créer.

import {
  assetDeadlines,
  assetRegisterSummary,
  assetTotalCostOfOwnership,
  assignmentHistory,
  checkNewAssignment,
  managementDepreciationEstimate,
  MANAGEMENT_ESTIMATE_NOTICE,
  type AssetDeadlinesResult,
  type AssetInput,
} from '@lalanda/engine';
import {
  ASSET_NUMBER_PATTERN,
  ASSET_NUMBER_PREFIX,
  type AssetAcquisitionBody,
  type AssetAssigneeInput,
  type AssetAssigneeView,
  type AssetAssignmentView,
  type AssetAssignmentsView,
  type AssetDeadlinesQuery,
  type AssetDeadlinesView,
  type AssetDetailView,
  type AssetEstimateView,
  type AssetFindingCode,
  type AssetPageView,
  type AssetReportsQuery,
  type AssetReportsView,
  type AssetView,
  type AssignAssetBody,
  type CreateAssetBody,
  type DisposeAssetBody,
  type ListAssetsQuery,
  type ReinstateAssetBody,
  type ReturnAssetBody,
  type UpdateAssetBody,
} from '@lalanda/shared/assets';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type ClientSession, type Connection, type Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { toCsv } from '../../crm/crm-csv.js';
import type { CsvFile } from '../../crm/crm-csv.service.js';
import { conflict, isDuplicateKey, staleRevision } from '../../sales/sales.errors.js';
import { isObjectIdHex, normalizeForSearch } from '../../sales/search.js';
import {
  assetNotFound,
  assetsToday,
  ENGINE_REMINDER_DAYS_MAX,
  engineAssetOf,
  engineAssignmentOf,
  engineCoverageOf,
  engineMaintenanceOf,
  inAssetsTransaction,
} from '../assets-common.js';
import { AssetsLinks, type AssetEmployeeCard } from '../assets-links.js';
import {
  Asset,
  AssetAssignment,
  AssetCounter,
  AssetCoverage,
  AssetMaintenance,
  type AssetAcquisitionDoc,
  type AssetAssignmentDocument,
  type AssetAssignmentLean,
  type AssetCounterDocument,
  type AssetCoverageDocument,
  type AssetCoverageLean,
  type AssetDocument,
  type AssetLean,
  type AssetMaintenanceDocument,
  type AssetMaintenanceLean,
} from '../assets.schemas.js';
import { AssetSettingsService, type AssetActor } from '../settings/asset-settings.service.js';

/** Contexte de lecture : l'appelant voit-il les valeurs ? */
export interface AssetReader {
  visible: boolean;
}

interface Resolved {
  employees: Map<string, AssetEmployeeCard>;
  projects: Map<string, string>;
  locations: Map<string, string>;
  members: Map<string, string>;
  categories: Map<string, string>;
}

const REGISTER_COLUMNS = [
  'Numéro',
  'Étiquette',
  'Nom',
  'Catégorie',
  'Marque',
  'Modèle',
  'Numéro de série',
  'Statut',
  'Affecté à',
  'Depuis le',
  'Acquis le',
  'Coût d’acquisition',
  'Devise',
  'Cédé le',
] as const;

const STATUS_LABELS: Record<string, string> = {
  in_service: 'En service',
  in_storage: 'En réserve',
  under_maintenance: 'En maintenance',
  lost: 'Perdu',
  disposed: 'Cédé',
};

function formatNumber(seq: number): string {
  return `${ASSET_NUMBER_PREFIX}${String(seq).padStart(6, '0')}`;
}

function assigneeIdsOf(list: readonly AssetAssigneeInput[]) {
  const ids = {
    employees: [] as string[],
    projects: [] as string[],
    locations: [] as string[],
    members: [] as string[],
  };
  for (const a of list) {
    if (a.kind === 'employee') ids.employees.push(a.employeeId);
    else if (a.kind === 'project') ids.projects.push(a.workProjectId);
    else if (a.kind === 'location') ids.locations.push(a.locationId);
    else ids.members.push(a.userId);
  }
  return ids;
}

function assigneeView(a: AssetAssigneeInput, r: Resolved, today: string): AssetAssigneeView {
  switch (a.kind) {
    case 'employee': {
      const card = r.employees.get(a.employeeId);
      return {
        kind: 'employee',
        employeeId: a.employeeId,
        name: card?.name ?? null,
        jobTitle: card?.jobTitle ?? null,
        exited: card
          ? card.status !== 'active' || (card.endDate !== null && card.endDate < today)
          : false,
      };
    }
    case 'project':
      return {
        kind: 'project',
        workProjectId: a.workProjectId,
        name: r.projects.get(a.workProjectId) ?? null,
      };
    case 'location':
      return {
        kind: 'location',
        locationId: a.locationId,
        name: r.locations.get(a.locationId) ?? null,
      };
    default:
      return { kind: 'member', userId: a.userId, name: r.members.get(a.userId) ?? null };
  }
}

function assignmentView(a: AssetAssignmentLean, r: Resolved, today: string): AssetAssignmentView {
  return {
    id: String(a._id),
    assetId: a.assetId,
    assignee: assigneeView(a.assignee, r, today),
    from: a.from,
    to: a.to ?? null,
    handedOverBy: a.handedOverBy,
    conditionOut: a.conditionOut ?? null,
    conditionIn: a.conditionIn ?? null,
    note: a.note ?? null,
    createdAt: new Date(a.createdAt).toISOString(),
  };
}

@Injectable()
export class AssetsService {
  constructor(
    @InjectModel(Asset.name) private readonly assets: Model<AssetDocument>,
    @InjectModel(AssetAssignment.name)
    private readonly assignments: Model<AssetAssignmentDocument>,
    @InjectModel(AssetMaintenance.name)
    private readonly maintenance: Model<AssetMaintenanceDocument>,
    @InjectModel(AssetCoverage.name) private readonly coverages: Model<AssetCoverageDocument>,
    @InjectModel(AssetCounter.name) private readonly counters: Model<AssetCounterDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(AssetsLinks) private readonly links: AssetsLinks,
    @Inject(AssetSettingsService) private readonly settings: AssetSettingsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ── Lecture ────────────────────────────────────────────────────────────────

  /** Équipement de l'organisation, ou 404 (identifiant forgé compris). */
  async requireOwn(
    organizationId: string,
    assetId: string,
    session?: ClientSession,
  ): Promise<AssetLean> {
    if (typeof assetId !== 'string' || !isObjectIdHex(assetId)) assetNotFound();
    const doc = await this.assets
      .findOne(
        { _id: new Types.ObjectId(assetId), organizationId },
        null,
        session ? { session } : {},
      )
      .lean<AssetLean>()
      .exec();
    if (!doc) assetNotFound();
    return doc;
  }

  async list(
    organizationId: string,
    query: ListAssetsQuery,
    reader: AssetReader,
  ): Promise<AssetPageView> {
    const and: Record<string, unknown>[] = [{ organizationId }];
    if (query.status === 'active') and.push({ status: { $ne: 'disposed' } });
    else if (query.status !== 'all') and.push({ status: query.status });
    if (query.categoryId) and.push({ categoryId: query.categoryId });
    if (query.employeeId) and.push({ 'currentAssignment.assignee.employeeId': query.employeeId });
    if (query.workProjectId) {
      and.push({ 'currentAssignment.assignee.workProjectId': query.workProjectId });
    }
    if (query.supplierId) and.push({ 'acquisition.supplierId': query.supplierId });
    if (query.cursor !== undefined) {
      if (!ASSET_NUMBER_PATTERN.test(query.cursor)) {
        throw new BadRequestException({
          code: 'INVALID_CURSOR',
          message: 'Curseur de pagination illisible : reprenez la liste depuis le début.',
        });
      }
      and.push({ number: { $gt: query.cursor } });
    }
    const docs = await this.assets
      .find({ $and: and })
      .sort({ number: 1 })
      .limit(query.limit + 1)
      .lean<AssetLean[]>()
      .exec();
    const page = docs.slice(0, query.limit);
    const resolved = await this.resolve(
      organizationId,
      page.flatMap((d) => (d.currentAssignment ? [d.currentAssignment.assignee] : [])),
    );
    const today = assetsToday();
    return {
      items: page.map((d) => this.view(d, resolved, reader, today, [])),
      nextCursor: docs.length > query.limit ? (page[page.length - 1]?.number ?? null) : null,
      valuesHidden: !reader.visible,
    };
  }

  async detail(
    organizationId: string,
    assetId: string,
    reader: AssetReader,
    on?: string,
  ): Promise<AssetDetailView> {
    const doc = await this.requireOwn(organizationId, assetId);
    const today = assetsToday();
    const [resolved, findings, settings, maint, covers] = await Promise.all([
      this.resolve(organizationId, doc.currentAssignment ? [doc.currentAssignment.assignee] : []),
      this.serialFindings(organizationId, doc),
      this.settings.effective(organizationId),
      this.maintenance.find({ organizationId, assetId }).lean<AssetMaintenanceLean[]>().exec(),
      this.coverages.find({ organizationId, assetId }).lean<AssetCoverageLean[]>().exec(),
    ]);
    const base = this.view(doc, resolved, reader, today, findings);
    const engineAsset = engineAssetOf(doc);
    let estimate: AssetEstimateView | null = null;
    if (reader.visible && settings.showDepreciationEstimate) {
      estimate = this.estimateView(engineAsset, on ?? today);
    }
    let tco: AssetDetailView['totalCostOfOwnership'] = null;
    if (reader.visible) {
      const r = assetTotalCostOfOwnership(
        engineAsset,
        maint.map(engineMaintenanceOf),
        covers.map(engineCoverageOf),
      );
      tco = {
        byCurrency: r.byCurrency.map((c) => ({ ...c })),
        maintenanceCount: r.maintenanceCount,
        unpricedMaintenanceCount: r.unpricedMaintenanceCount,
        coverageCount: r.coverageCount,
      };
    }
    return { ...base, managementEstimate: estimate, totalCostOfOwnership: tco };
  }

  private estimateView(asset: AssetInput, onDate: string): AssetEstimateView {
    const r = managementDepreciationEstimate(asset, onDate);
    if (!r.estimable) {
      return {
        label: r.label,
        notice: MANAGEMENT_ESTIMATE_NOTICE,
        estimable: false,
        reason: r.reason,
        onDate,
        currency: null,
        estimatedValue: null,
        consumed: null,
        consumedPercent: null,
        endOn: null,
        monthsTotal: null,
        monthsElapsed: null,
        stoppedByDisposalOn: null,
        version: r.version,
      };
    }
    return {
      label: r.label,
      notice: MANAGEMENT_ESTIMATE_NOTICE,
      estimable: true,
      reason: null,
      onDate,
      currency: r.currency,
      estimatedValue: r.estimatedValue,
      consumed: r.consumed,
      consumedPercent: r.consumedPercent,
      endOn: r.endOn,
      monthsTotal: r.monthsTotal,
      monthsElapsed: r.monthsElapsed,
      stoppedByDisposalOn: r.stoppedByDisposalOn,
      version: r.version,
    };
  }

  // ── Écriture de la fiche ───────────────────────────────────────────────────

  async create(
    organizationId: string,
    body: CreateAssetBody,
    actor: AssetActor,
    reader: AssetReader,
  ): Promise<AssetDetailView> {
    await this.settings.requireActiveCategory(organizationId, body.categoryId, actor.userId);
    const acquisition = await this.acquisitionOf(organizationId, body.acquisition);
    if (body.stockItemId) await this.links.assertStockItem(organizationId, body.stockItemId);
    if (body.locationId) await this.links.assertLocation(organizationId, body.locationId);
    let id = '';
    try {
      id = await inAssetsTransaction(this.connection, async (session) => {
        const number = await this.nextNumber(organizationId, session);
        const [created] = await this.assets.create(
          [
            {
              organizationId,
              number,
              tag: body.tag ?? null,
              name: body.name,
              sortName: normalizeForSearch(body.name),
              categoryId: body.categoryId,
              brand: body.brand ?? null,
              model: body.model ?? null,
              serialNumber: body.serialNumber ?? null,
              status: body.status ?? 'in_storage',
              acquisition,
              stockItemId: body.stockItemId ?? null,
              locationId: body.locationId ?? null,
              currentAssignment: null,
              managementDepreciation: body.managementDepreciation ?? null,
              disposal: null,
              notes: body.notes ?? null,
              revision: 1,
              createdBy: actor.userId,
              updatedBy: actor.userId,
              _schemaVersion: 1,
            },
          ],
          { session },
        );
        const newId = String(created!._id);
        await this.audit.record(
          {
            organizationId,
            actorUserId: actor.userId,
            actorRole: actor.role,
            action: 'assets.created',
            targetType: 'asset',
            targetId: newId,
            metadata: { number },
          },
          { session },
        );
        return newId;
      });
    } catch (err) {
      if (isDuplicateKey(err)) tagExists();
      throw err;
    }
    return this.detail(organizationId, id, reader);
  }

  async update(
    organizationId: string,
    assetId: string,
    body: UpdateAssetBody,
    actor: AssetActor,
    reader: AssetReader,
  ): Promise<AssetDetailView> {
    const current = await this.requireOwn(organizationId, assetId);
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    if (current.status === 'disposed') disposed();
    const set: Record<string, unknown> = { updatedBy: actor.userId };
    if (body.name !== undefined) {
      set['name'] = body.name;
      set['sortName'] = normalizeForSearch(body.name);
    }
    if (body.categoryId !== undefined && body.categoryId !== current.categoryId) {
      await this.settings.requireActiveCategory(organizationId, body.categoryId, actor.userId);
      set['categoryId'] = body.categoryId;
    }
    for (const k of ['tag', 'brand', 'model', 'serialNumber', 'notes'] as const) {
      if (body[k] !== undefined) set[k] = body[k];
    }
    if (body.acquisition !== undefined) {
      set['acquisition'] = await this.acquisitionOf(organizationId, body.acquisition);
    }
    if (body.stockItemId !== undefined) {
      if (body.stockItemId) await this.links.assertStockItem(organizationId, body.stockItemId);
      set['stockItemId'] = body.stockItemId;
    }
    if (body.locationId !== undefined) {
      if (body.locationId) await this.links.assertLocation(organizationId, body.locationId);
      set['locationId'] = body.locationId;
    }
    if (body.managementDepreciation !== undefined) {
      set['managementDepreciation'] = body.managementDepreciation;
    }
    if (body.status !== undefined) set['status'] = body.status;
    try {
      const res = await this.assets
        .updateOne(
          { _id: current._id, organizationId, revision: current.revision },
          { $set: set, $inc: { revision: 1 } },
        )
        .exec();
      if (res.matchedCount !== 1) {
        staleRevision((await this.requireOwn(organizationId, assetId)).revision);
      }
    } catch (err) {
      if (isDuplicateKey(err)) tagExists();
      throw err;
    }
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'assets.updated',
      targetType: 'asset',
      targetId: assetId,
      metadata: { fields: Object.keys(set).filter((k) => k !== 'updatedBy' && k !== 'sortName') },
    });
    return this.detail(organizationId, assetId, reader);
  }

  /** Cession DÉCLARÉE : clôt l'affectation ouverte ; aucune facture, aucun encaissement. */
  async dispose(
    organizationId: string,
    assetId: string,
    body: DisposeAssetBody,
    actor: AssetActor,
    reader: AssetReader,
  ): Promise<AssetDetailView> {
    await inAssetsTransaction(this.connection, async (session) => {
      const current = await this.requireOwn(organizationId, assetId, session);
      if (current.revision !== body.expectedRevision) staleRevision(current.revision);
      if (current.status === 'disposed') disposed();
      if (current.currentAssignment) {
        if (body.on < current.currentAssignment.from) {
          conflict(
            'DISPOSAL_BEFORE_ASSIGNMENT',
            'La cession ne peut précéder la remise de l’affectation en cours.',
          );
        }
        await this.assignments
          .updateOne(
            {
              _id: new Types.ObjectId(current.currentAssignment.assignmentId),
              organizationId,
              to: null,
            },
            { $set: { to: body.on, returnedBy: actor.userId, note: 'Clôturée par la cession.' } },
            { session },
          )
          .exec();
      }
      const disposal = {
        on: body.on,
        kind: body.kind,
        proceeds: body.proceeds ?? null,
        currency: body.currency ?? null,
        buyer: body.buyer ?? null,
        reason: body.reason,
        by: actor.userId,
      };
      const res = await this.assets
        .updateOne(
          { _id: current._id, organizationId, revision: current.revision },
          {
            $set: {
              status: 'disposed',
              disposal,
              currentAssignment: null,
              updatedBy: actor.userId,
            },
            $inc: { revision: 1 },
          },
          { session },
        )
        .exec();
      if (res.matchedCount !== 1) staleRevision(current.revision);
      await this.audit.record(
        {
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'assets.disposed',
          targetType: 'asset',
          targetId: assetId,
          metadata: { on: body.on, kind: body.kind, previousStatus: current.status },
        },
        { session },
      );
    });
    return this.detail(organizationId, assetId, reader);
  }

  async reinstate(
    organizationId: string,
    assetId: string,
    body: ReinstateAssetBody,
    actor: AssetActor,
    reader: AssetReader,
  ): Promise<AssetDetailView> {
    const current = await this.requireOwn(organizationId, assetId);
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    if (current.status !== 'disposed') {
      conflict('ASSET_NOT_DISPOSED', 'Cet équipement n’est pas cédé.');
    }
    const res = await this.assets
      .updateOne(
        { _id: current._id, organizationId, revision: current.revision },
        {
          $set: { status: 'in_storage', disposal: null, updatedBy: actor.userId },
          $inc: { revision: 1 },
        },
      )
      .exec();
    if (res.matchedCount !== 1)
      staleRevision((await this.requireOwn(organizationId, assetId)).revision);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'assets.reinstated',
      targetType: 'asset',
      targetId: assetId,
      metadata: {
        reason: body.reason,
        disposedOn: current.disposal?.on ?? null,
        disposalKind: current.disposal?.kind ?? null,
      },
    });
    return this.detail(organizationId, assetId, reader);
  }

  // ── Affectations ───────────────────────────────────────────────────────────

  async assign(
    organizationId: string,
    assetId: string,
    body: AssignAssetBody,
    actor: AssetActor,
    reader: AssetReader,
  ): Promise<AssetDetailView> {
    await this.assertAssignee(organizationId, body.assignee);
    const today = assetsToday();
    const from = body.from ?? today;
    try {
      await inAssetsTransaction(this.connection, async (session) => {
        const current = await this.requireOwn(organizationId, assetId, session);
        if (current.revision !== body.expectedRevision) staleRevision(current.revision);
        if (current.status === 'disposed') disposed();
        const rows = await this.assignments
          .find({ organizationId, assetId }, null, { session })
          .lean<AssetAssignmentLean[]>()
          .exec();
        // Moteur : historique sans chevauchement, remise postérieure au dernier mouvement.
        const history = assignmentHistory(rows.map(engineAssignmentOf), assetId, today);
        const verdict = checkNewAssignment(history, body.assignee, from);
        if (!verdict.ok) {
          if (verdict.code === 'SAME_ASSIGNEE') {
            conflict(
              'ASSET_ALREADY_ASSIGNED',
              'Cet équipement est déjà affecté à ce bénéficiaire.',
            );
          }
          if (verdict.code === 'STARTS_BEFORE_LAST_ASSIGNMENT') {
            conflict(
              'ASSET_ASSIGNMENT_OVERLAP',
              'Cette remise chevaucherait une affectation existante : elle ne peut précéder la dernière remise ou le dernier retour.',
            );
          }
          conflict(
            'ASSET_ASSIGNMENT_HISTORY_INVALID',
            'L’historique des affectations de cet équipement est incohérent.',
          );
        }
        if (verdict.closes) {
          await this.assignments
            .updateOne(
              { _id: new Types.ObjectId(verdict.closes.id), organizationId, to: null },
              { $set: { to: verdict.closes.to, returnedBy: actor.userId } },
              { session },
            )
            .exec();
        }
        const [created] = await this.assignments.create(
          [
            {
              organizationId,
              assetId,
              assignee: body.assignee,
              from,
              to: null,
              handedOverBy: actor.userId,
              returnedBy: null,
              conditionOut: body.conditionOut ?? null,
              conditionIn: null,
              note: body.note ?? null,
              _schemaVersion: 1,
            },
          ],
          { session },
        );
        const status = current.status === 'in_storage' ? 'in_service' : current.status;
        const res = await this.assets
          .updateOne(
            { _id: current._id, organizationId, revision: current.revision },
            {
              $set: {
                currentAssignment: {
                  assignmentId: String(created!._id),
                  assignee: body.assignee,
                  from,
                },
                status,
                updatedBy: actor.userId,
              },
              $inc: { revision: 1 },
            },
            { session },
          )
          .exec();
        if (res.matchedCount !== 1) staleRevision(current.revision);
        await this.audit.record(
          {
            organizationId,
            actorUserId: actor.userId,
            actorRole: actor.role,
            action: 'assets.assigned',
            targetType: 'asset',
            targetId: assetId,
            metadata: {
              assigneeKind: body.assignee.kind,
              from,
              closed: verdict.closes?.id ?? null,
            },
          },
          { session },
        );
      });
    } catch (err) {
      // Deux remises concurrentes : l'index unique de l'affectation ouverte tranche.
      if (isDuplicateKey(err)) {
        conflict('ASSET_ASSIGNMENT_OVERLAP', 'Une autre affectation vient d’être enregistrée.');
      }
      throw err;
    }
    return this.detail(organizationId, assetId, reader);
  }

  async return(
    organizationId: string,
    assetId: string,
    body: ReturnAssetBody,
    actor: AssetActor,
    reader: AssetReader,
  ): Promise<AssetDetailView> {
    const today = assetsToday();
    const on = body.on ?? today;
    await inAssetsTransaction(this.connection, async (session) => {
      const current = await this.requireOwn(organizationId, assetId, session);
      if (current.revision !== body.expectedRevision) staleRevision(current.revision);
      if (!current.currentAssignment) {
        conflict('ASSET_NOT_ASSIGNED', 'Cet équipement n’est affecté à personne.');
      }
      const openId = current.currentAssignment.assignmentId;
      const rows = await this.assignments
        .find({ organizationId, assetId }, null, { session })
        .lean<AssetAssignmentLean[]>()
        .exec();
      // Moteur : le retour ne peut précéder la remise.
      const after = assignmentHistory(
        rows.map((r) => ({ ...engineAssignmentOf(r), to: String(r._id) === openId ? on : r.to })),
        assetId,
        today,
      );
      if (!after.valid) {
        conflict('ASSET_RETURN_BEFORE_HANDOVER', 'Le retour ne peut précéder la remise.');
      }
      await this.assignments
        .updateOne(
          { _id: new Types.ObjectId(openId), organizationId, to: null },
          {
            $set: {
              to: on,
              returnedBy: actor.userId,
              conditionIn: body.conditionIn ?? null,
              ...(body.note !== undefined ? { note: body.note } : {}),
            },
          },
          { session },
        )
        .exec();
      const status = current.status === 'in_service' ? 'in_storage' : current.status;
      const res = await this.assets
        .updateOne(
          { _id: current._id, organizationId, revision: current.revision },
          {
            $set: { currentAssignment: null, status, updatedBy: actor.userId },
            $inc: { revision: 1 },
          },
          { session },
        )
        .exec();
      if (res.matchedCount !== 1) staleRevision(current.revision);
      await this.audit.record(
        {
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'assets.returned',
          targetType: 'asset',
          targetId: assetId,
          metadata: { on },
        },
        { session },
      );
    });
    return this.detail(organizationId, assetId, reader);
  }

  async assignmentsOf(organizationId: string, assetId: string): Promise<AssetAssignmentsView> {
    await this.requireOwn(organizationId, assetId);
    const rows = await this.assignments
      .find({ organizationId, assetId })
      .sort({ from: 1, createdAt: 1 })
      .lean<AssetAssignmentLean[]>()
      .exec();
    const today = assetsToday();
    const history = assignmentHistory(rows.map(engineAssignmentOf), assetId, today);
    const resolved = await this.resolve(
      organizationId,
      rows.map((r) => r.assignee),
    );
    return { items: rows.map((r) => assignmentView(r, resolved, today)), valid: history.valid };
  }

  // ── Échéances, rapports, export ────────────────────────────────────────────

  /** Échéances du moteur, avec les fiches et les collaborateurs lus (rappels compris). */
  async deadlinesOf(
    organizationId: string,
    today: string,
    within?: number,
  ): Promise<{
    result: AssetDeadlinesResult;
    assets: Map<string, AssetLean>;
    employees: Map<string, AssetEmployeeCard>;
  }> {
    const settings = await this.settings.effective(organizationId);
    const docs = await this.assets
      .find({ organizationId, status: { $nin: ['disposed', 'lost'] } })
      .lean<AssetLean[]>()
      .exec();
    const ids = docs.map((d) => String(d._id));
    const [maint, covers] = await Promise.all([
      this.maintenance
        .find({ organizationId, assetId: { $in: ids }, status: 'planned' })
        .lean<AssetMaintenanceLean[]>()
        .exec(),
      this.coverages
        .find({ organizationId, assetId: { $in: ids } })
        .lean<AssetCoverageLean[]>()
        .exec(),
    ]);
    const employeeIds = docs.flatMap((d) =>
      d.currentAssignment?.assignee.kind === 'employee'
        ? [d.currentAssignment.assignee.employeeId]
        : [],
    );
    const employees = await this.links.employees(organizationId, employeeIds);
    const horizon =
      within === undefined ? null : Math.min(Math.max(within, 0), ENGINE_REMINDER_DAYS_MAX);
    const result = assetDeadlines(
      docs.map(engineAssetOf),
      maint.map(engineMaintenanceOf),
      covers.map(engineCoverageOf),
      today,
      {
        reminderDays: horizon ?? settings.reminderDays,
        maintenanceDueSoonDays: horizon ?? settings.maintenanceDueSoonDays,
      },
      [...employees.values()].map((e) => ({
        id: e.id,
        // Une fiche sortie sans date connue est traitée comme sortie la veille.
        endDate: e.endDate ?? (e.status === 'active' ? null : '0001-01-01'),
      })),
    );
    return { result, assets: new Map(docs.map((d) => [String(d._id), d])), employees };
  }

  async deadlines(organizationId: string, query: AssetDeadlinesQuery): Promise<AssetDeadlinesView> {
    const today = assetsToday();
    const { result, assets, employees } = await this.deadlinesOf(
      organizationId,
      today,
      query.within,
    );
    return {
      today,
      version: result.version,
      counts: result.counts,
      items: result.deadlines.map((d) => ({
        kind: d.kind,
        assetId: d.assetId,
        assetNumber: assets.get(d.assetId)?.number ?? '',
        assetName: assets.get(d.assetId)?.name ?? '',
        refId: d.refId,
        employeeId: d.employeeId,
        employeeName: d.employeeId ? (employees.get(d.employeeId)?.name ?? null) : null,
        date: d.date,
        daysLeft: d.daysLeft,
      })),
    };
  }

  async reports(
    organizationId: string,
    query: AssetReportsQuery,
    reader: AssetReader,
  ): Promise<AssetReportsView> {
    const [docs, names] = await Promise.all([
      this.assets.find({ organizationId }).lean<AssetLean[]>().exec(),
      this.settings.categoryNames(organizationId),
    ]);
    const onDate = reader.visible ? (query.on ?? assetsToday()) : null;
    const summary = assetRegisterSummary(docs.map(engineAssetOf), onDate);
    const assigned = { employee: 0, project: 0, location: 0, member: 0, none: 0 };
    for (const d of docs) {
      if (d.status === 'disposed') continue;
      const kind = d.currentAssignment?.assignee.kind;
      if (kind === undefined) assigned.none += 1;
      else assigned[kind] += 1;
    }
    const v = reader.visible;
    return {
      version: summary.version,
      total: summary.total,
      byStatus: summary.byStatus,
      byCategory: summary.byCategory.map((c) => ({
        categoryId: c.categoryId,
        categoryName: c.categoryId ? (names.get(c.categoryId) ?? null) : null,
        count: c.count,
        byStatus: c.byStatus,
        acquisitionCosts: v ? c.acquisitionCosts : null,
      })),
      assigned,
      acquisitionCosts: v ? summary.acquisitionCosts : null,
      activeAcquisitionCosts: v ? summary.activeAcquisitionCosts : null,
      managementEstimate:
        v && summary.managementEstimate
          ? { ...summary.managementEstimate, notice: MANAGEMENT_ESTIMATE_NOTICE }
          : null,
      valuesHidden: !v,
    };
  }

  /** Registre (CSV « ; », BOM, formules neutralisées) ; audit STRICT avant le fichier. */
  async exportRegister(
    organizationId: string,
    actor: AssetActor,
    reader: AssetReader,
  ): Promise<CsvFile> {
    const [docs, names] = await Promise.all([
      this.assets.find({ organizationId }).sort({ number: 1 }).lean<AssetLean[]>().exec(),
      this.settings.categoryNames(organizationId),
    ]);
    const resolved = await this.resolve(
      organizationId,
      docs.flatMap((d) => (d.currentAssignment ? [d.currentAssignment.assignee] : [])),
    );
    const today = assetsToday();
    const rows = docs.map((d) => {
      const a = d.currentAssignment
        ? assigneeView(d.currentAssignment.assignee, resolved, today)
        : null;
      return [
        d.number,
        d.tag ?? null,
        d.name,
        names.get(d.categoryId) ?? null,
        d.brand ?? null,
        d.model ?? null,
        d.serialNumber ?? null,
        STATUS_LABELS[d.status] ?? d.status,
        a ? (a.name ?? null) : null,
        d.currentAssignment?.from ?? null,
        d.acquisition.on,
        reader.visible ? d.acquisition.cost : null,
        reader.visible ? d.acquisition.currency : null,
        d.disposal?.on ?? null,
      ];
    });
    await this.audit.recordStrict({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'assets.register.exported',
      targetType: 'asset_register',
      targetId: organizationId,
      metadata: { rows: rows.length, valuesHidden: !reader.visible },
    });
    return { fileName: `registre-equipements-${today}.csv`, body: toCsv(REGISTER_COLUMNS, rows) };
  }

  // ── Interne ────────────────────────────────────────────────────────────────

  view(
    d: AssetLean,
    r: Resolved,
    reader: AssetReader,
    today: string,
    findings: AssetFindingCode[],
  ): AssetView {
    const v = reader.visible;
    const current = d.currentAssignment
      ? {
          id: d.currentAssignment.assignmentId,
          assetId: String(d._id),
          assignee: assigneeView(d.currentAssignment.assignee, r, today),
          from: d.currentAssignment.from,
          to: null,
          handedOverBy: '',
          conditionOut: null,
          conditionIn: null,
          note: null,
          createdAt: new Date(d.updatedAt).toISOString(),
        }
      : null;
    const all = [...findings];
    if (current?.assignee.kind === 'employee' && current.assignee.exited) {
      all.push('ASSET_HELD_BY_FORMER_EMPLOYEE');
    }
    return {
      id: String(d._id),
      number: d.number,
      tag: d.tag ?? null,
      name: d.name,
      categoryId: d.categoryId,
      categoryName: r.categories.get(d.categoryId) ?? null,
      brand: d.brand ?? null,
      model: d.model ?? null,
      serialNumber: d.serialNumber ?? null,
      status: d.status,
      acquisition: {
        on: d.acquisition.on,
        cost: v ? d.acquisition.cost : null,
        currency: d.acquisition.currency,
        supplierId: d.acquisition.supplierId ?? null,
        supplierInvoiceId: d.acquisition.supplierInvoiceId ?? null,
        expenseId: d.acquisition.expenseId ?? null,
        note: d.acquisition.note ?? null,
      },
      stockItemId: d.stockItemId ?? null,
      locationId: d.locationId ?? null,
      currentAssignment: current,
      managementDepreciation: d.managementDepreciation
        ? {
            years: d.managementDepreciation.years,
            residualValue: v ? d.managementDepreciation.residualValue : null,
            startOn: d.managementDepreciation.startOn,
          }
        : null,
      disposal: d.disposal
        ? {
            on: d.disposal.on,
            kind: d.disposal.kind,
            proceeds: v ? (d.disposal.proceeds ?? null) : null,
            currency: d.disposal.currency ?? null,
            buyer: d.disposal.buyer ?? null,
            reason: d.disposal.reason,
            by: d.disposal.by,
          }
        : null,
      notes: d.notes ?? null,
      findings: all,
      valuesHidden: !v,
      revision: d.revision,
      createdAt: new Date(d.createdAt).toISOString(),
      updatedAt: new Date(d.updatedAt).toISOString(),
    };
  }

  private async resolve(
    organizationId: string,
    assignees: readonly AssetAssigneeInput[],
  ): Promise<Resolved> {
    const ids = assigneeIdsOf(assignees);
    const [employees, projects, locations, members, categories] = await Promise.all([
      this.links.employees(organizationId, ids.employees),
      this.links.names('projects', organizationId, ids.projects),
      this.links.names('locations', organizationId, ids.locations),
      this.links.memberNames(organizationId, ids.members),
      this.settings.categoryNames(organizationId),
    ]);
    return { employees, projects, locations, members, categories };
  }

  /** Avertissement `ASSET_SERIAL_DUPLICATE` : même numéro de série dans l'organisation. */
  private async serialFindings(organizationId: string, d: AssetLean): Promise<AssetFindingCode[]> {
    if (!d.serialNumber) return [];
    const other = await this.assets
      .findOne({ organizationId, serialNumber: d.serialNumber, _id: { $ne: d._id } }, { _id: 1 })
      .lean()
      .exec();
    return other ? ['ASSET_SERIAL_DUPLICATE'] : [];
  }

  private async assertAssignee(organizationId: string, a: AssetAssigneeInput): Promise<void> {
    if (a.kind === 'employee') await this.links.assertActiveEmployee(organizationId, a.employeeId);
    else if (a.kind === 'project')
      await this.links.assertLiveProject(organizationId, a.workProjectId);
    else if (a.kind === 'location') await this.links.assertLocation(organizationId, a.locationId);
    else await this.links.assertMember(organizationId, a.userId);
  }

  /** Acquisition : liens facultatifs VÉRIFIÉS dans l'organisation ; rien n'est créé. */
  private async acquisitionOf(
    organizationId: string,
    body: AssetAcquisitionBody,
  ): Promise<AssetAcquisitionDoc> {
    const { supplierId, supplierInvoiceId } = await this.links.supplierLinks(
      organizationId,
      body.supplierId ?? null,
      body.supplierInvoiceId ?? null,
    );
    const expenseId = body.expenseId ?? null;
    if (expenseId !== null) await this.links.assertExpense(organizationId, expenseId);
    return {
      on: body.on,
      cost: body.cost,
      currency: body.currency,
      supplierId,
      supplierInvoiceId,
      expenseId,
      note: body.note ?? null,
    };
  }

  /** `EQ-NNNNNN` : compteur NON annuel par organisation (`year` = 0). */
  private async nextNumber(organizationId: string, session: ClientSession): Promise<string> {
    const bump = () =>
      this.counters
        .findOneAndUpdate(
          { organizationId, kind: 'asset', year: 0 },
          { $inc: { last: 1 }, $setOnInsert: { _schemaVersion: 1 } },
          { upsert: true, new: true, session },
        )
        .lean<AssetCounter>()
        .exec();
    let counter: AssetCounter | null;
    try {
      counter = await bump();
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      counter = await bump();
    }
    return formatNumber(counter!.last);
  }
}

function tagExists(): never {
  conflict('ASSET_TAG_EXISTS', 'Un autre équipement porte déjà cette étiquette.');
}

function disposed(): never {
  conflict('ASSET_DISPOSED', 'Cet équipement est cédé : réouvrez-le avant de le modifier.');
}
