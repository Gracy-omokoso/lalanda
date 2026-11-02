// Avenants — ADR-0050 § 2.5, § 3, § 5.3. ADR-0050 — V3.
//
// - Un avenant ne s'ouvre que sur un contrat SIGNÉ (non résilié) : une version approuvée
//   ou signée ne se modifie plus, on passe par un avenant.
// - Contenu COMPLET des champs changés ; les lignes (et celles des échéances d'un
//   `schedule`) sont validées par le schéma du brouillon de facture et composées par le
//   code des factures, avec la devise, le mode de prix et le client du contrat.
// - Date d'effet ≥ début du contrat (`422 AMENDMENT_BEFORE_CONTRACT_START`) et jamais
//   antérieure à une échéance DÉJÀ PRÉPARÉE (`409 AMENDMENT_BEFORE_PREPARED_OCCURRENCE`),
//   contrôlée à la création, à la modification et à la signature.
// - Même cycle que le contrat, sans « Résilier » ; même séparation des tâches
//   (`contractApprovalDecision`) ; signature DÉCLARÉE avec copie PDF signée exigée.
// - Un avenant non signé n'a AUCUN effet : `termsAt` n'applique que les signés.
// - Renouvellement EXPRÈS (`purpose: 'renewal'`, clause `explicit`) : à la signature, le
//   terme suivant est enregistré dans `renewals` (`explicit_amendment`), ses dates
//   calculées par le moteur à partir de la période saisie.

import { contractTerms, termsAt, type AmendmentInput, type ContractInput } from '@lalanda/engine';
import type { SalesContractAmendmentPurpose } from '@lalanda/shared/sales-contracts';
import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';

import type { InvoiceActor } from '../../invoices/invoice.types.js';
import { conflict, isDuplicateKey, staleRevision } from '../../sales.errors.js';
import { isObjectIdHex } from '../../search.js';
import { contractsNotFound, unprocessable } from '../common/contracts.common.js';
import type { EngagementLine } from '../common/engagement-document.js';
import {
  SalesContractFilesService,
  salesContractFileView,
  type SalesContractFileView,
} from '../files/sales-contract-files.service.js';
import {
  SALES_CONTRACT_AMENDMENT_STATUS_LABELS,
  amendmentNumberOf,
  amendmentSha256,
  draftInputForLines,
  engineAmendmentOf,
  engineContractOf,
  type ContractDocumentBase,
} from '../contracts/sales-contract-model.js';
import type {
  SalesContractLean,
  StoredApproval,
  StoredContractBilling,
  StoredRenewal,
} from '../contracts/sales-contract.schema.js';
import {
  contractNotInStatus,
  SalesContractsService,
} from '../contracts/sales-contracts.service.js';
import {
  SalesContractAmendment,
  type SalesContractAmendmentDocument,
  type SalesContractAmendmentLean,
  type StoredAmendmentChanges,
} from './sales-contract-amendment.schema.js';

/** Corps validé par `SalesContractAmendmentSchema` (lignes encore brutes). */
export interface SalesContractAmendmentBody {
  expectedRevision?: number;
  effectiveDate: string;
  purpose: SalesContractAmendmentPurpose;
  changes: {
    lines?: unknown[];
    billing?:
      | { kind: 'none' }
      | {
          kind: 'schedule';
          items: { itemRef: string; dueDate: string; label: string; lines: unknown[] }[];
        }
      | Extract<StoredContractBilling, { kind: 'recurring' }>;
    initialTermMonths?: number | null;
    renewal?: SalesContractLean['renewal'];
    noticeDays?: number;
    clauses?: string | null;
  };
}

export interface SalesContractAmendmentActions {
  edit: boolean;
  submit: boolean;
  cancel: boolean;
  approve: boolean;
  reject: boolean;
  declareSignature: boolean;
  addFile: boolean;
}

export interface SalesContractAmendmentView {
  id: string;
  contractId: string;
  index: number;
  number: string;
  effectiveDate: string;
  purpose: SalesContractAmendmentPurpose;
  changes: StoredAmendmentChanges;
  status: SalesContractAmendmentLean['status'];
  statusLabel: string;
  submittedAt: string | null;
  submittedBy: string | null;
  approvedAt: string | null;
  approvals: (Omit<StoredApproval, 'at'> & { at: string })[];
  signature:
    | (Omit<NonNullable<SalesContractAmendmentLean['signature']>, 'declaredAt'> & {
        declaredAt: string;
      })
    | null;
  cancellation: { at: string; by: string; reason: string } | null;
  contentSha256: string | null;
  files: SalesContractFileView[];
  actions: SalesContractAmendmentActions;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

const iso = (d: Date | null | undefined): string | null => (d ? new Date(d).toISOString() : null);

function amendmentNotFound(): never {
  contractsNotFound('SALES_CONTRACT_AMENDMENT_NOT_FOUND', 'Avenant introuvable.');
}

function amendmentNotInStatus(
  code: string,
  status: SalesContractAmendmentLean['status'],
  action: string,
): never {
  conflict(
    code,
    `Action « ${action} » impossible : l’avenant est « ${SALES_CONTRACT_AMENDMENT_STATUS_LABELS[
      status
    ].toLowerCase()} ».`,
    { status },
  );
}

@Injectable()
export class SalesContractAmendmentsService {
  constructor(
    @InjectModel(SalesContractAmendment.name)
    private readonly amendments: Model<SalesContractAmendmentDocument>,
    @Inject(SalesContractsService) private readonly contracts: SalesContractsService,
    @Inject(SalesContractFilesService) private readonly files: SalesContractFilesService,
  ) {}

  // ── Lecture ──────────────────────────────────────────────────────────────

  private async requireOwn(
    organizationId: string,
    contractId: string,
    amendmentId: string,
  ): Promise<SalesContractAmendmentLean> {
    if (!isObjectIdHex(amendmentId)) amendmentNotFound();
    const doc = await this.amendments
      .findOne({ _id: new Types.ObjectId(amendmentId), organizationId, contractId })
      .lean<SalesContractAmendmentLean>()
      .exec();
    if (!doc) amendmentNotFound();
    return doc;
  }

  async list(organizationId: string, contractId: string): Promise<SalesContractAmendmentView[]> {
    await this.contracts.requireOwn(organizationId, contractId);
    const docs = await this.contracts.amendmentsOf(organizationId, contractId);
    return Promise.all(docs.map((a) => this.viewOf(organizationId, a)));
  }

  async view(
    organizationId: string,
    contractId: string,
    amendmentId: string,
  ): Promise<SalesContractAmendmentView> {
    await this.contracts.requireOwn(organizationId, contractId);
    return this.viewOf(
      organizationId,
      await this.requireOwn(organizationId, contractId, amendmentId),
    );
  }

  private async viewOf(
    organizationId: string,
    a: SalesContractAmendmentLean,
  ): Promise<SalesContractAmendmentView> {
    const files = await this.files.list(organizationId, {
      contractId: a.contractId,
      amendmentId: String(a._id),
    });
    const s = a.status;
    return {
      id: String(a._id),
      contractId: a.contractId,
      index: a.index,
      number: a.number,
      effectiveDate: a.effectiveDate,
      purpose: a.purpose,
      changes: a.changes,
      status: s,
      statusLabel: SALES_CONTRACT_AMENDMENT_STATUS_LABELS[s],
      submittedAt: iso(a.submittedAt),
      submittedBy: a.submittedBy ?? null,
      approvedAt: iso(a.approvedAt),
      approvals: (a.approvals ?? []).map((x) => ({ ...x, at: iso(x.at)! })),
      signature: a.signature ? { ...a.signature, declaredAt: iso(a.signature.declaredAt)! } : null,
      cancellation: a.cancellation
        ? { at: iso(a.cancellation.at)!, by: a.cancellation.by, reason: a.cancellation.reason }
        : null,
      contentSha256: a.contentSha256 ?? null,
      files: files.map(salesContractFileView),
      actions: {
        edit: s === 'draft',
        submit: s === 'draft',
        cancel: s === 'draft' || s === 'submitted' || s === 'approved',
        approve: s === 'submitted',
        reject: s === 'submitted',
        declareSignature: s === 'approved',
        addFile: s !== 'cancelled',
      },
      createdBy: a.createdBy,
      createdAt: new Date(a.createdAt).toISOString(),
      updatedAt: new Date(a.updatedAt).toISOString(),
      revision: a.revision,
    };
  }

  // ── Contrôles ────────────────────────────────────────────────────────────

  private async signedContract(
    organizationId: string,
    contractId: string,
    action: string,
  ): Promise<SalesContractLean> {
    const contract = await this.contracts.requireOwn(organizationId, contractId);
    if (contract.status !== 'signed') {
      contractNotInStatus('CONTRACT_NOT_SIGNED', contract.status, action);
    }
    return contract;
  }

  /** Date d'effet : ≥ début du contrat, jamais ≤ une échéance déjà préparée. */
  private async assertEffectiveDate(
    organizationId: string,
    contract: SalesContractLean,
    effectiveDate: string,
  ): Promise<void> {
    if (effectiveDate < contract.startDate) {
      unprocessable(
        'AMENDMENT_BEFORE_CONTRACT_START',
        'La date d’effet d’un avenant ne précède pas le début du contrat.',
        { startDate: contract.startDate },
      );
    }
    const prepared = await this.contracts.preparedOccurrenceDates(organizationId, contract);
    const blocking = prepared.filter((d) => d >= effectiveDate).sort();
    if (blocking.length > 0) {
      conflict(
        'AMENDMENT_BEFORE_PREPARED_OCCURRENCE',
        'Une échéance à cette date ou après a déjà été préparée : choisissez une date d’effet postérieure, ou supprimez d’abord ce brouillon.',
        { preparedOccurrences: blocking },
      );
    }
  }

  /** Changements stockés : lignes et échéances composées par le code des factures. */
  private async changesOf(
    organizationId: string,
    contract: SalesContractLean,
    body: SalesContractAmendmentBody,
  ): Promise<StoredAmendmentChanges> {
    const base: ContractDocumentBase = {
      currency: contract.currency,
      priceMode: contract.priceMode,
      customerId: contract.customerId,
      printContactDetails: contract.customer.printContactDetails,
    };
    const ch = body.changes;
    const out: StoredAmendmentChanges = {};
    if (ch.lines !== undefined) {
      const doc = await this.contracts.compose(
        organizationId,
        draftInputForLines(base, ch.lines, 'changes.lines'),
      );
      out.lines = doc.lines;
      out.documentAmounts = doc.documentAmounts;
    }
    if (ch.billing !== undefined) {
      out.billing = await this.contracts.composeBilling(
        organizationId,
        ch.billing.kind === 'schedule'
          ? {
              kind: 'schedule',
              items: ch.billing.items.map((item, i) => ({
                itemRef: item.itemRef,
                dueDate: item.dueDate,
                label: item.label,
                draft: draftInputForLines(base, item.lines, `changes.billing.items.${i}.lines`),
              })),
            }
          : ch.billing,
      );
    }
    if (ch.initialTermMonths !== undefined) out.initialTermMonths = ch.initialTermMonths;
    if (ch.renewal !== undefined) out.renewal = ch.renewal;
    if (ch.noticeDays !== undefined) out.noticeDays = ch.noticeDays;
    if (ch.clauses !== undefined) out.clauses = ch.clauses;
    if (Object.keys(out).length === 0) {
      unprocessable('AMENDMENT_WITHOUT_CHANGES', 'Un avenant change au moins un champ du contrat.');
    }
    return out;
  }

  /** Blocages d'un avenant (calcul de ses lignes et échéances). */
  private blockersOf(changes: StoredAmendmentChanges): { code: string; message: string }[] {
    const out: { code: string; message: string }[] = [];
    const check = (doc: {
      lines: EngagementLine[];
      documentAmounts: SalesContractLean['documentAmounts'];
    }) => {
      if (doc.lines.length === 0) {
        out.push({ code: 'NO_LINES', message: 'Ajoutez au moins une ligne.' });
        return;
      }
      const calc = doc.documentAmounts.calculation;
      if (!calc.ok) {
        out.push(
          ...(calc.issues.length > 0
            ? calc.issues.map((i) => ({ code: i.code, message: i.message }))
            : [
                {
                  code: 'TAX_RATES_UNAVAILABLE',
                  message: 'Aucun taux de TVA DGI relevé : impossible de calculer l’avenant.',
                },
              ]),
        );
      }
    };
    if (changes.lines !== undefined && changes.documentAmounts !== undefined) {
      check({ lines: changes.lines, documentAmounts: changes.documentAmounts });
    }
    if (changes.billing?.kind === 'schedule') changes.billing.items.forEach(check);
    return out;
  }

  // ── Écritures ────────────────────────────────────────────────────────────

  private async transition(
    organizationId: string,
    current: SalesContractAmendmentLean,
    expectedRevision: number,
    update: { $set?: Record<string, unknown>; $push?: Record<string, unknown> },
  ): Promise<SalesContractAmendmentLean> {
    const updated = await this.amendments
      .findOneAndUpdate(
        {
          _id: current._id,
          organizationId,
          status: current.status,
          revision: expectedRevision,
        },
        { ...update, $inc: { revision: 1 } },
        { new: true },
      )
      .lean<SalesContractAmendmentLean>()
      .exec();
    if (!updated) {
      const again = await this.requireOwn(organizationId, current.contractId, String(current._id));
      if (again.status !== current.status) {
        amendmentNotInStatus('SALES_CONTRACT_AMENDMENT_STATUS_CONFLICT', again.status, 'modifier');
      }
      staleRevision(again.revision);
    }
    return updated;
  }

  private async load(
    organizationId: string,
    contractId: string,
    amendmentId: string,
    expectedRevision: number,
  ): Promise<SalesContractAmendmentLean> {
    await this.contracts.requireOwn(organizationId, contractId);
    const current = await this.requireOwn(organizationId, contractId, amendmentId);
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    return current;
  }

  private assertRenewalPurpose(
    contract: SalesContractLean,
    amendments: readonly SalesContractAmendmentLean[],
    body: {
      effectiveDate: string;
      purpose: SalesContractAmendmentPurpose;
      changes: StoredAmendmentChanges;
    },
  ): void {
    if (body.purpose !== 'renewal') return;
    const renewal =
      body.changes.renewal ??
      termsAt(engineContractOf(contract), amendments.map(engineAmendmentOf), body.effectiveDate)
        .terms.renewal;
    if (renewal.mode !== 'explicit' || renewal.periodMonths === null) {
      conflict(
        'AMENDMENT_RENEWAL_NOT_EXPLICIT',
        'Un avenant de renouvellement suppose une clause de renouvellement exprès avec sa période.',
        { renewal },
      );
    }
  }

  async create(
    organizationId: string,
    contractId: string,
    body: SalesContractAmendmentBody,
    actor: InvoiceActor,
  ): Promise<SalesContractAmendmentView> {
    const contract = await this.signedContract(organizationId, contractId, 'ajouter un avenant');
    await this.assertEffectiveDate(organizationId, contract, body.effectiveDate);
    const changes = await this.changesOf(organizationId, contract, body);
    const existing = await this.contracts.amendmentsOf(organizationId, contractId);
    this.assertRenewalPurpose(contract, existing, { ...body, changes });
    let created: SalesContractAmendmentLean | null = null;
    for (let attempt = 0; attempt < 3 && created === null; attempt += 1) {
      const last = await this.amendments
        .findOne({ organizationId, contractId }, { index: 1 })
        .sort({ index: -1 })
        .lean<{ index: number }>()
        .exec();
      const index = (last?.index ?? 0) + 1;
      try {
        const doc = await this.amendments.create({
          organizationId,
          contractId,
          index,
          number: amendmentNumberOf(contract.number, index),
          effectiveDate: body.effectiveDate,
          purpose: body.purpose,
          changes,
          status: 'draft',
          submittedAt: null,
          submittedBy: null,
          approvedAt: null,
          approvals: [],
          signature: null,
          cancellation: null,
          contentSha256: null,
          revision: 1,
          createdBy: actor.userId,
          updatedBy: actor.userId,
          _schemaVersion: 1,
        });
        created = doc.toObject() as SalesContractAmendmentLean;
      } catch (err) {
        if (!isDuplicateKey(err)) throw err;
      }
    }
    if (created === null) {
      conflict('AMENDMENT_INDEX_CONFLICT', 'Un autre avenant vient d’être créé : réessayez.');
    }
    await this.contracts.record(
      organizationId,
      actor,
      contractId,
      'sales_contract.amendment_created',
      {
        amendmentId: String(created._id),
        number: created.number,
        effectiveDate: created.effectiveDate,
        purpose: created.purpose,
        fields: Object.keys(changes),
      },
    );
    return this.viewOf(organizationId, created);
  }

  async put(
    organizationId: string,
    contractId: string,
    amendmentId: string,
    body: SalesContractAmendmentBody & { expectedRevision: number },
    actor: InvoiceActor,
  ): Promise<SalesContractAmendmentView> {
    const current = await this.load(organizationId, contractId, amendmentId, body.expectedRevision);
    if (current.status !== 'draft') {
      amendmentNotInStatus('AMENDMENT_NOT_DRAFT', current.status, 'modifier');
    }
    const contract = await this.signedContract(organizationId, contractId, 'modifier un avenant');
    await this.assertEffectiveDate(organizationId, contract, body.effectiveDate);
    const changes = await this.changesOf(organizationId, contract, body);
    const others = (await this.contracts.amendmentsOf(organizationId, contractId)).filter(
      (a) => String(a._id) !== amendmentId,
    );
    this.assertRenewalPurpose(contract, others, { ...body, changes });
    // `changes` est remplacé en entier (contenu COMPLET des champs changés).
    const updated = await this.transition(organizationId, current, body.expectedRevision, {
      $set: {
        effectiveDate: body.effectiveDate,
        purpose: body.purpose,
        changes,
        updatedBy: actor.userId,
      },
    });
    await this.contracts.record(
      organizationId,
      actor,
      contractId,
      'sales_contract.amendment_updated',
      {
        amendmentId,
        number: current.number,
        effectiveDate: body.effectiveDate,
        fields: Object.keys(changes),
      },
    );
    return this.viewOf(organizationId, updated);
  }

  async submit(
    organizationId: string,
    contractId: string,
    amendmentId: string,
    expectedRevision: number,
    actor: InvoiceActor,
  ): Promise<SalesContractAmendmentView> {
    const current = await this.load(organizationId, contractId, amendmentId, expectedRevision);
    if (current.status !== 'draft') {
      amendmentNotInStatus('AMENDMENT_NOT_DRAFT', current.status, 'soumettre');
    }
    await this.signedContract(organizationId, contractId, 'soumettre un avenant');
    const blockers = this.blockersOf(current.changes);
    if (blockers.length > 0) {
      conflict('AMENDMENT_NOT_READY', 'Cet avenant ne peut pas encore être soumis.', { blockers });
    }
    const updated = await this.transition(organizationId, current, expectedRevision, {
      $set: {
        status: 'submitted',
        submittedAt: new Date(),
        submittedBy: actor.userId,
        updatedBy: actor.userId,
      },
    });
    await this.contracts.record(
      organizationId,
      actor,
      contractId,
      'sales_contract.amendment_submitted',
      {
        amendmentId,
        number: current.number,
      },
    );
    return this.viewOf(organizationId, updated);
  }

  async decide(
    organizationId: string,
    contractId: string,
    amendmentId: string,
    expectedRevision: number,
    decision: 'approved' | 'rejected',
    comment: string | null,
    actor: InvoiceActor,
  ): Promise<SalesContractAmendmentView> {
    const current = await this.load(organizationId, contractId, amendmentId, expectedRevision);
    if (current.status !== 'submitted') {
      amendmentNotInStatus(
        'AMENDMENT_NOT_SUBMITTED',
        current.status,
        decision === 'approved' ? 'approuver' : 'rejeter',
      );
    }
    await this.signedContract(organizationId, contractId, 'approuver un avenant');
    const { soleApprover } = await this.contracts.approvalVerdict(
      organizationId,
      actor.userId,
      current.submittedBy ?? null,
      current.createdBy,
    );
    const approval: StoredApproval = {
      userId: actor.userId,
      decision,
      at: new Date(),
      comment,
      soleApprover,
    };
    const updated = await this.transition(organizationId, current, expectedRevision, {
      $set:
        decision === 'approved'
          ? { status: 'approved', approvedAt: new Date(), updatedBy: actor.userId }
          : { status: 'draft', submittedAt: null, submittedBy: null, updatedBy: actor.userId },
      $push: { approvals: approval },
    });
    await this.contracts.record(
      organizationId,
      actor,
      contractId,
      decision === 'approved'
        ? 'sales_contract.amendment_approved'
        : 'sales_contract.amendment_rejected',
      { amendmentId, number: current.number, comment, soleApprover },
    );
    return this.viewOf(organizationId, updated);
  }

  async cancel(
    organizationId: string,
    contractId: string,
    amendmentId: string,
    expectedRevision: number,
    reason: string,
    actor: InvoiceActor,
  ): Promise<SalesContractAmendmentView> {
    const current = await this.load(organizationId, contractId, amendmentId, expectedRevision);
    if (!['draft', 'submitted', 'approved'].includes(current.status)) {
      amendmentNotInStatus('SALES_CONTRACT_AMENDMENT_STATUS_CONFLICT', current.status, 'annuler');
    }
    const updated = await this.transition(organizationId, current, expectedRevision, {
      $set: {
        status: 'cancelled',
        cancellation: { at: new Date(), by: actor.userId, reason },
        updatedBy: actor.userId,
      },
    });
    await this.contracts.record(
      organizationId,
      actor,
      contractId,
      'sales_contract.amendment_cancelled',
      {
        amendmentId,
        number: current.number,
        reason,
        previousStatus: current.status,
      },
    );
    return this.viewOf(organizationId, updated);
  }

  /**
   * « Déclarer la signature » d'un avenant approuvé : copie PDF signée de CET avenant
   * exigée (`422 SIGNED_COPY_REQUIRED`), empreinte posée. Un renouvellement exprès
   * enregistre alors le terme suivant (`explicit_amendment`).
   */
  async declareSignature(
    organizationId: string,
    contractId: string,
    amendmentId: string,
    input: {
      expectedRevision: number;
      signedOn: string;
      signatories: { name: string; title: string | null; side: 'customer' | 'organization' }[];
      fileId: string | null;
    },
    actor: InvoiceActor,
  ): Promise<SalesContractAmendmentView> {
    const current = await this.load(
      organizationId,
      contractId,
      amendmentId,
      input.expectedRevision,
    );
    if (current.status !== 'approved') {
      amendmentNotInStatus('AMENDMENT_NOT_APPROVED', current.status, 'déclarer la signature');
    }
    const contract = await this.signedContract(organizationId, contractId, 'signer un avenant');
    await this.assertEffectiveDate(organizationId, contract, current.effectiveDate);
    const copy = await this.contracts.signedCopy(
      organizationId,
      contractId,
      amendmentId,
      input.fileId,
    );
    if (!copy) {
      unprocessable(
        'SIGNED_COPY_REQUIRED',
        'Téléversez d’abord la copie PDF signée de l’avenant, puis déclarez la signature.',
      );
    }
    const others = (await this.contracts.amendmentsOf(organizationId, contractId)).filter(
      (a) => String(a._id) !== amendmentId,
    );
    const renewal =
      current.purpose === 'renewal' ? this.nextExplicitTerm(contract, others, current) : null;
    const sha = amendmentSha256(current);
    const updated = await this.transition(organizationId, current, input.expectedRevision, {
      $set: {
        status: 'signed',
        signature: {
          signedOn: input.signedOn,
          signatories: input.signatories,
          fileId: String(copy._id),
          declaredBy: actor.userId,
          declaredAt: new Date(),
        },
        contentSha256: sha,
        updatedBy: actor.userId,
      },
    });
    let recorded: StoredRenewal | null = null;
    if (renewal) {
      recorded = { ...renewal, recordedBy: actor.userId, recordedAt: new Date(), amendmentId };
      await this.contracts.appendExplicitRenewal(organizationId, contractId, recorded);
    }
    await this.contracts.record(
      organizationId,
      actor,
      contractId,
      'sales_contract.amendment_signed',
      {
        amendmentId,
        number: current.number,
        signedOn: input.signedOn,
        fileId: String(copy._id),
        fileSha256: copy.sha256,
        contentSha256: sha,
        renewal: recorded
          ? { termIndex: recorded.termIndex, from: recorded.from, to: recorded.to }
          : null,
      },
    );
    return this.viewOf(organizationId, updated);
  }

  /**
   * Terme suivant d'un renouvellement exprès : mêmes dates que le moteur propose pour une
   * reconduction (anniversaire, veille), sur la période SAISIE en vigueur à la date
   * d'effet avec cet avenant ; aucun maximum appliqué (le renouvellement est signé).
   */
  private nextExplicitTerm(
    contract: SalesContractLean,
    others: readonly SalesContractAmendmentLean[],
    amendment: SalesContractAmendmentLean,
  ): Omit<StoredRenewal, 'recordedBy' | 'recordedAt' | 'amendmentId'> {
    const asSigned: AmendmentInput<EngagementLine>[] = [
      ...others.map(engineAmendmentOf),
      engineAmendmentOf({ ...amendment, status: 'signed' }),
    ];
    const engineContract: ContractInput<EngagementLine> = engineContractOf(contract);
    const inForce = termsAt(engineContract, asSigned, amendment.effectiveDate).terms;
    if (inForce.renewal.mode !== 'explicit' || inForce.renewal.periodMonths === null) {
      conflict(
        'AMENDMENT_RENEWAL_NOT_EXPLICIT',
        'Un avenant de renouvellement suppose une clause de renouvellement exprès avec sa période.',
      );
    }
    const asProposal = {
      mode: 'tacit' as const,
      periodMonths: inForce.renewal.periodMonths,
      maxRenewals: null,
    };
    const t = contractTerms(
      { ...engineContract, renewal: asProposal },
      asSigned.map((a) =>
        a.changes.renewal === undefined
          ? a
          : { ...a, changes: { ...a.changes, renewal: asProposal } },
      ),
      this.contracts.engineRenewals(contract),
      null,
      amendment.effectiveDate,
    );
    if (t.proposedNextTerm === null || t.proposedNextTerm.to === null) {
      conflict(
        'RENEWAL_NOT_PROPOSED',
        'Ce contrat est à durée indéterminée : aucun terme à renouveler.',
      );
    }
    return {
      termIndex: t.proposedNextTerm.index,
      from: t.proposedNextTerm.from,
      to: t.proposedNextTerm.to,
      mode: 'explicit_amendment',
    };
  }
}
