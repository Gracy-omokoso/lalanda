// Contrat signé → projet — ADR-0077 § 1 (tranche ADR-0050 § 4.2).
//
//   - le contrat est LU en lecture seule (`sales_contracts`) ; seul son champ
//     `projectId` est écrit, jamais son contenu (hors `contentSha256`) ;
//   - idempotent : réservation `projectId: null → 'pending:<id>'`, puis l'identifiant
//     réel ; un second appel → `409 WORK_PROJECT_EXISTS_FOR_CONTRACT` ; l'index unique
//     partiel `{ organizationId, projectId }` empêche un projet de suivre deux contrats
//     (`409 WORK_PROJECT_HAS_CONTRACT`) ;
//   - relier plutôt que doublonner : projet du devis d'origine, puis de l'opportunité ;
//   - création : une tâche par ligne SANS montant (le contrat fait foi), un jalon par
//     échéance d'un échéancier ; aucune facture, aucun appel DGI.

import {
  WORK_LIMITS,
  type CreateProjectFromContractBody,
  type WorkContractBillingKind,
  type WorkProjectContractView,
  type WorkProjectFromContractView,
} from '@lalanda/shared/work';
import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';

import {
  conflict,
  invalid,
  isWorkId,
  notFound,
  oid,
  projectArchived,
  type WorkActor,
} from '../work.common.js';
import { WorkActivityService } from '../work-activity.service.js';
import { WorkProjectsService } from '../work-projects.service.js';
import { WorkProject, type WorkProjectDocument } from '../work.schemas.js';
import { WorkBillingService, type TaskSeed } from './work-billing.service.js';
import { CONTRACTS, contractOfProject, isRealProjectId, pendingOf } from './work-contract-links.js';
import { opportunityProjectFilter } from './work-opportunity-events.js';

/** Ce qu'on lit d'un contrat (`sales_contracts`). */
interface ContractRead {
  _id: unknown;
  number: string;
  title: string;
  status: string;
  customerId: string;
  opportunityId: string | null;
  source: { kind: 'quote'; quoteId: string } | null;
  customer?: { name?: string | null } | null;
  lines: { name: string; quantity: string; unit: string | null; lineRef?: string }[];
  billing: {
    kind: WorkContractBillingKind;
    items?: { itemRef: string; dueDate: string; label: string }[];
  };
  startDate: string;
  initialTermMonths: number | null;
  projectId: string | null;
}

function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: number } | null)?.code === 11000;
}

/** Lignes retenues d'un contrat : toutes par défaut ; un indice hors du contrat est refusé. */
export function pickContractLines(
  contract: Pick<ContractRead, 'number' | 'lines'>,
  lineIndexes: readonly number[] | undefined,
): { index: number; line: ContractRead['lines'][number] }[] {
  const all = contract.lines.map((line, index) => ({ index, line }));
  if (lineIndexes === undefined) return all;
  const bad = lineIndexes.find((i) => i >= contract.lines.length);
  if (bad !== undefined) {
    invalid(
      'lineIndexes',
      'INVALID_VALUE',
      `Le contrat ${contract.number} n’a pas de ligne d’indice ${bad} (${contract.lines.length} ligne(s)).`,
    );
  }
  return [...lineIndexes].sort((a, b) => a - b).map((i) => all[i]!);
}

/** Graines du projet d'un contrat : lignes (sans montant), puis un jalon par échéance. */
export function contractSeeds(
  contract: Pick<ContractRead, 'number' | 'lines' | 'billing'>,
  lineIndexes: readonly number[] | undefined,
  scheduleMilestones: boolean,
): TaskSeed[] {
  const lines: TaskSeed[] = pickContractLines(contract, lineIndexes).map(({ index, line }) => ({
    title: line.name || `Ligne ${index + 1}`,
    description: `Quantité : ${line.quantity}${line.unit ? ` ${line.unit}` : ''}\nLigne ${index + 1} du contrat ${contract.number}.`,
    source: null,
  }));
  const items =
    scheduleMilestones && contract.billing.kind === 'schedule'
      ? (contract.billing.items ?? [])
      : [];
  const milestones: TaskSeed[] = items.map((item) => ({
    title: (item.label || `Échéance ${item.itemRef}`).slice(0, WORK_LIMITS.milestoneTitleMax),
    description: `Échéance ${item.itemRef} du contrat ${contract.number} : la facture se prépare depuis le contrat.`,
    source: null,
    milestone: { dueDate: item.dueDate },
  }));
  return [...lines, ...milestones];
}

@Injectable()
export class WorkContractProjectsService {
  constructor(
    @InjectModel(WorkProject.name) private readonly projectModel: Model<WorkProjectDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(WorkProjectsService) private readonly projects: WorkProjectsService,
    @Inject(WorkActivityService) private readonly activity: WorkActivityService,
    @Inject(WorkBillingService) private readonly billing: WorkBillingService,
  ) {}

  private async contractOf(organizationId: string, contractId: string): Promise<ContractRead> {
    if (!isWorkId(contractId)) notFound('CONTRACT_NOT_FOUND', 'Contrat introuvable.');
    const doc = await this.connection.collection(CONTRACTS).findOne(
      { _id: oid(contractId), organizationId },
      {
        projection: {
          number: 1,
          title: 1,
          status: 1,
          customerId: 1,
          opportunityId: 1,
          source: 1,
          'customer.name': 1,
          lines: 1,
          billing: 1,
          startDate: 1,
          initialTermMonths: 1,
          projectId: 1,
        },
      },
    );
    if (!doc) notFound('CONTRACT_NOT_FOUND', 'Contrat introuvable.');
    return doc as unknown as ContractRead;
  }

  /**
   * Projet réel posé sur le contrat, ou `null`. Un projet disparu (supprimé) est
   * retiré du contrat au passage ; une réservation en cours rend `'pending'`.
   */
  private async linkedProject(
    organizationId: string,
    contract: ContractRead,
  ): Promise<string | 'pending' | null> {
    const current = contract.projectId ?? null;
    if (current === null) return null;
    if (!isRealProjectId(current)) return 'pending';
    const alive = await this.projectModel
      .countDocuments({ _id: oid(current), organizationId })
      .exec();
    if (alive > 0) return current;
    await this.connection
      .collection(CONTRACTS)
      .updateOne(
        { _id: oid(String(contract._id)), organizationId, projectId: current },
        { $set: { projectId: null } },
      );
    contract.projectId = null;
    return null;
  }

  private alreadyExists(projectId: string | null): never {
    conflict(
      'WORK_PROJECT_EXISTS_FOR_CONTRACT',
      'Un projet existe déjà pour ce contrat : ouvrez-le.',
      projectId ? { projectId } : undefined,
    );
  }

  /** Projet existant du devis d'origine, puis de l'opportunité, ou `null`. */
  private async existingProjectOf(
    organizationId: string,
    contract: ContractRead,
  ): Promise<{ _id: unknown; status: string } | null> {
    const quoteId = contract.source?.kind === 'quote' ? contract.source.quoteId : null;
    if (quoteId) {
      const viaQuote = await this.projectModel
        .findOne(
          { organizationId, 'source.kind': 'quote', 'source.quoteId': quoteId },
          { _id: 1, status: 1 },
        )
        .lean<{ _id: unknown; status: string }>()
        .exec();
      if (viaQuote) return viaQuote;
    }
    if (contract.opportunityId) {
      const viaOpp = await this.projectModel
        .findOne(opportunityProjectFilter(organizationId, contract.opportunityId), {
          _id: 1,
          status: 1,
        })
        .lean<{ _id: unknown; status: string }>()
        .exec();
      if (viaOpp) return viaOpp;
    }
    return null;
  }

  /** Pose `projectId` sur un contrat encore libre (ou réservé par cet appel). */
  private async attach(
    organizationId: string,
    contractId: string,
    from: string | null,
    projectId: string,
  ): Promise<boolean> {
    try {
      const res = await this.connection
        .collection(CONTRACTS)
        .updateOne(
          { _id: oid(contractId), organizationId, projectId: from },
          { $set: { projectId } },
        );
      return res.matchedCount === 1;
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      const other = await this.connection
        .collection(CONTRACTS)
        .findOne({ organizationId, projectId }, { projection: { _id: 1 } });
      conflict('WORK_PROJECT_HAS_CONTRACT', 'Ce projet suit déjà un autre contrat.', {
        projectId,
        ...(other ? { contractId: String(other._id) } : {}),
      });
    }
  }

  async createFromContract(
    organizationId: string,
    body: CreateProjectFromContractBody,
    actor: WorkActor,
  ): Promise<WorkProjectFromContractView> {
    const contract = await this.contractOf(organizationId, body.contractId);
    const contractId = String(contract._id);
    const linked = await this.linkedProject(organizationId, contract);
    if (linked !== null) this.alreadyExists(linked === 'pending' ? null : linked);
    if (contract.status !== 'signed') {
      conflict('WORK_CONTRACT_NOT_SIGNED', 'Seul un contrat signé crée ou relie son projet.', {
        status: contract.status,
      });
    }

    // Relier plutôt que doublonner (§ 1.4).
    const existing = await this.existingProjectOf(organizationId, contract);
    if (existing) {
      const projectId = String(existing._id);
      if (existing.status === 'archived') projectArchived();
      const ok = await this.attach(organizationId, contractId, null, projectId);
      if (!ok) await this.raceLost(organizationId, contractId);
      await this.activity.record(organizationId, {
        projectId,
        actorUserId: actor.userId,
        kind: 'project.updated',
        data: { contractLinked: { contractId, contractNumber: contract.number } },
      });
      await this.projects.touch(organizationId, projectId);
      return { project: await this.projects.get(organizationId, projectId), outcome: 'linked' };
    }

    // Création (§ 1.6) : contrôles avant la réservation.
    const seeds = contractSeeds(contract, body.lineIndexes, body.scheduleMilestones !== false);
    await this.billing.assertProjectRoom(organizationId);
    const pending = pendingOf(contractId);
    const reserved = await this.attach(organizationId, contractId, null, pending);
    if (!reserved) await this.raceLost(organizationId, contractId);

    const quoteId = contract.source?.kind === 'quote' ? contract.source.quoteId : null;
    const fallback = `Projet ${contract.number}`;
    const name = (body.name ?? contract.title ?? '')
      .trim()
      .slice(0, WORK_LIMITS.projectNameMax)
      .trim();
    try {
      const project = await this.billing.materialize(
        organizationId,
        {
          name: name || fallback.slice(0, WORK_LIMITS.projectNameMax),
          links: {
            customerId: contract.customerId ?? null,
            opportunityId: contract.opportunityId ?? null,
            quoteIds: quoteId ? [quoteId] : [],
          },
          source: null,
          seeds,
          milestone: undefined,
          activity: {
            name: name || fallback,
            kind: 'client',
            contractId,
            contractNumber: contract.number,
          },
          duplicate: async () => this.alreadyExists(null),
        },
        actor,
      );
      await this.connection
        .collection(CONTRACTS)
        .updateOne(
          { _id: oid(contractId), organizationId, projectId: pending },
          { $set: { projectId: project.id } },
        );
      return { project, outcome: 'created' };
    } catch (err) {
      await this.connection
        .collection(CONTRACTS)
        .updateOne(
          { _id: oid(contractId), organizationId, projectId: pending },
          { $set: { projectId: null } },
        );
      throw err;
    }
  }

  /** Un autre appel a posé un projet entre la lecture et l'écriture. */
  private async raceLost(organizationId: string, contractId: string): Promise<never> {
    const winner = await this.connection
      .collection(CONTRACTS)
      .findOne({ _id: oid(contractId), organizationId }, { projection: { projectId: 1 } });
    const id = winner?.['projectId'];
    this.alreadyExists(isRealProjectId(id) ? id : null);
  }

  /** Projet du contrat, ou `null` (fiche du contrat : « Ouvrir le projet »). */
  async projectForContract(
    organizationId: string,
    contractId: string,
  ): Promise<{ projectId: string | null }> {
    if (!isWorkId(contractId)) return { projectId: null };
    const contract = await this.contractOf(organizationId, contractId);
    const linked = await this.linkedProject(organizationId, contract);
    return { projectId: linked === 'pending' ? null : linked };
  }

  /** Bloc « Contrat » d'un projet, sans montant. */
  async contractOfProject(
    organizationId: string,
    projectId: string,
  ): Promise<{ contract: WorkProjectContractView | null }> {
    await this.projects.requireOwn(organizationId, projectId);
    const c = await contractOfProject(this.connection, organizationId, projectId);
    if (!c) return { contract: null };
    const billing = (c['billing'] ?? {}) as { kind?: string; items?: unknown[] };
    const kind: WorkContractBillingKind =
      billing.kind === 'schedule' || billing.kind === 'recurring' ? billing.kind : 'none';
    return {
      contract: {
        contractId: String(c['_id']),
        number: String(c['number']),
        title: String(c['title'] ?? ''),
        status: String(c['status']),
        customerName: String((c['customer'] as { name?: string } | undefined)?.name ?? ''),
        startDate: String(c['startDate'] ?? ''),
        initialTermMonths:
          typeof c['initialTermMonths'] === 'number' ? (c['initialTermMonths'] as number) : null,
        billingKind: kind,
        scheduleItemCount: kind === 'schedule' ? (billing.items?.length ?? 0) : 0,
      },
    };
  }
}
