// Modèles et listes d'entrée et de sortie (ADR-0045 § 2.9, § 3.3, § 6.1). ADR-0045 — H4.
//
// - Modèles : deux proposés à l'activation (accueil, départ), créés à la première
//   lecture, idempotents ; libellés SANS portée légale. Retirer un modèle le désactive :
//   les listes déjà instanciées gardent leurs éléments.
// - Liste : instanciée pour un collaborateur ; chaque élément est copié avec son
//   assigné RÉSOLU (`hr` = un détenteur effectif de `hr.manage` choisi par l'auteur,
//   l'auteur par défaut ; `manager` = compte du manager ; `employee` = compte du
//   collaborateur ; un assigné sans compte membre : `hr`) et son échéance = date pivot
//   (entrée ou sortie) + décalage. Une notification par assigné (sauf l'auteur).
// - Cocher : l'assigné, ou `hr.manage`. Pour tout autre lecteur, la liste n'existe pas
//   (404) : un départ ne se découvre pas par un identifiant.
// - L'élément « Accès Lalanda retiré » N'AGIT PAS : retirer l'accès reste un geste
//   d'`organization.manage` (décision ouverte n° 13).

import { randomBytes } from 'node:crypto';

import { addDays } from '@lalanda/shared/work';
import {
  HR_CHECKLIST_KIND_LABELS,
  type ChecklistItemView,
  type ChecklistPage,
  type ChecklistTemplatePage,
  type ChecklistTemplateView,
  type ChecklistView,
  type CreateChecklistTemplateBody,
  type HrChecklistAssignee,
  type HrChecklistKind,
  type HrMyChecklistItemView,
  type InstantiateChecklistBody,
  type ListChecklistsQuery,
  type UpdateChecklistTemplateBody,
} from '@lalanda/shared/hr';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { AuthzService } from '../../authz/authz.service.js';
import { conflict, isDuplicateKey, staleRevision } from '../../sales/sales.errors.js';
import type { EmployeeLean } from '../employees/employee.schema.js';
import { displayNameOf } from '../leave/display-name.js';
import { employeeNotFound, hrToday } from '../scope/hr-errors.js';
import type { HrViewer } from '../scope/hr-scope.service.js';
import {
  Checklist,
  ChecklistTemplate,
  type ChecklistDocument,
  type ChecklistItemDoc,
  type ChecklistLean,
  type ChecklistTemplateDocument,
  type ChecklistTemplateItemDoc,
  type ChecklistTemplateLean,
} from './checklist.schemas.js';
import { HrChecklistsNotifier } from './hr-checklists-notifier.js';

export interface HrChecklistActor {
  userId: string;
  role: string;
}

/** Modèles proposés à l'activation (§ 2.9) : modifiables, sans portée légale. */
export const HR_DEFAULT_CHECKLIST_TEMPLATES: readonly {
  key: string;
  kind: HrChecklistKind;
  label: string;
  items: ChecklistTemplateItemDoc[];
}[] = Object.freeze([
  {
    key: 'default_onboarding',
    kind: 'onboarding',
    label: 'Accueil d’un collaborateur',
    items: [
      { id: 'contrat-signe', label: 'Contrat signé', assignee: 'hr', offsetDays: 0, note: null },
      { id: 'acces-lalanda', label: 'Accès Lalanda', assignee: 'hr', offsetDays: 0, note: null },
      {
        id: 'materiel-remis',
        label: 'Matériel remis',
        assignee: 'manager',
        offsetDays: 0,
        note: null,
      },
      {
        id: 'presentation-equipe',
        label: 'Présentation à l’équipe',
        assignee: 'manager',
        offsetDays: 1,
        note: null,
      },
    ],
  },
  {
    key: 'default_offboarding',
    kind: 'offboarding',
    label: 'Départ d’un collaborateur',
    items: [
      {
        id: 'materiel-repris',
        label: 'Matériel repris',
        assignee: 'manager',
        offsetDays: 0,
        note: null,
      },
      {
        id: 'acces-lalanda-retire',
        label: 'Accès Lalanda retiré',
        assignee: 'hr',
        offsetDays: 0,
        note: 'Ouvre la page du membre : retirer l’accès reste un geste de gestion de l’organisation.',
      },
      {
        id: 'documents-fin',
        label: 'Documents de fin remis',
        assignee: 'hr',
        offsetDays: 0,
        note: null,
      },
    ],
  },
]);

export function templateNotFound(): never {
  throw new NotFoundException({
    code: 'CHECKLIST_TEMPLATE_NOT_FOUND',
    message: 'Modèle de liste introuvable.',
  });
}

export function checklistNotFound(): never {
  throw new NotFoundException({ code: 'CHECKLIST_NOT_FOUND', message: 'Liste introuvable.' });
}

function newItemId(): string {
  return `e${randomBytes(6).toString('hex')}`;
}

function asObjectId(id: string): Types.ObjectId | null {
  return /^[0-9a-f]{24}$/i.test(id) ? new Types.ObjectId(id) : null;
}

function templateViewOf(t: ChecklistTemplateLean): ChecklistTemplateView {
  return {
    id: String(t._id),
    kind: t.kind,
    label: t.label,
    items: t.items.map((i) => ({
      id: i.id,
      label: i.label,
      assignee: i.assignee,
      offsetDays: i.offsetDays,
      note: i.note ?? null,
    })),
    isDefault: t.key !== null && t.key !== undefined,
    revision: t.revision,
    updatedAt: new Date(t.updatedAt).toISOString(),
  };
}

export function checklistItemViewOf(i: ChecklistItemDoc): ChecklistItemView {
  return {
    id: i.id,
    label: i.label,
    note: i.note ?? null,
    assigneeUserId: i.assigneeUserId,
    dueDate: i.dueDate,
    doneAt: i.doneAt ? new Date(i.doneAt).toISOString() : null,
    doneBy: i.doneBy ?? null,
  };
}

function checklistViewOf(c: ChecklistLean, employeeName: string): ChecklistView {
  const items = c.items.map(checklistItemViewOf);
  return {
    id: String(c._id),
    employeeId: c.employeeId,
    employeeName,
    kind: c.kind,
    kindLabel: HR_CHECKLIST_KIND_LABELS[c.kind],
    templateId: c.templateId,
    label: c.label,
    pivotDate: c.pivotDate,
    items,
    done: items.filter((i) => i.doneAt !== null).length,
    total: items.length,
    revision: c.revision,
    createdBy: c.createdBy,
    createdAt: new Date(c.createdAt).toISOString(),
  };
}

function itemsOfInput(items: CreateChecklistTemplateBody['items']): ChecklistTemplateItemDoc[] {
  const used = new Set(items.map((i) => i.id).filter((id): id is string => Boolean(id)));
  return items.map((i) => {
    let id = i.id;
    if (!id) {
      do id = newItemId();
      while (used.has(id));
      used.add(id);
    }
    return {
      id,
      label: i.label,
      assignee: i.assignee as HrChecklistAssignee,
      offsetDays: i.offsetDays,
      note: i.note ?? null,
    };
  });
}

@Injectable()
export class HrChecklistsService {
  constructor(
    @InjectModel(ChecklistTemplate.name)
    private readonly templates: Model<ChecklistTemplateDocument>,
    @InjectModel(Checklist.name) private readonly checklists: Model<ChecklistDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(AuthzService) private readonly authz: AuthzService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(HrChecklistsNotifier) private readonly notifier: HrChecklistsNotifier,
  ) {}

  // ── Modèles ──────────────────────────────────────────────────────────────

  /** Crée les modèles de l'activation s'ils manquent (idempotent, sûr en concurrence). */
  async ensureDefaults(organizationId: string): Promise<void> {
    const keys = HR_DEFAULT_CHECKLIST_TEMPLATES.map((t) => t.key);
    const present = await this.templates
      .countDocuments({ organizationId, key: { $in: keys } })
      .exec();
    if (present >= keys.length) return;
    for (const d of HR_DEFAULT_CHECKLIST_TEMPLATES) {
      try {
        await this.templates
          .updateOne(
            { organizationId, key: d.key },
            {
              $setOnInsert: {
                organizationId,
                key: d.key,
                kind: d.kind,
                label: d.label,
                items: d.items,
                active: true,
                revision: 1,
                createdBy: 'system',
                updatedBy: 'system',
                _schemaVersion: 1,
              },
            },
            { upsert: true },
          )
          .exec();
      } catch (err) {
        if (!isDuplicateKey(err)) throw err;
      }
    }
  }

  async listTemplates(organizationId: string): Promise<ChecklistTemplatePage> {
    await this.ensureDefaults(organizationId);
    const rows = await this.templates
      .find({ organizationId, active: true })
      .sort({ kind: 1, label: 1, _id: 1 })
      .lean<ChecklistTemplateLean[]>()
      .exec();
    return { items: rows.map(templateViewOf) };
  }

  async createTemplate(
    organizationId: string,
    body: CreateChecklistTemplateBody,
    actor: HrChecklistActor,
  ): Promise<ChecklistTemplateView> {
    const [created] = await this.templates.create([
      {
        organizationId,
        key: null,
        kind: body.kind,
        label: body.label,
        items: itemsOfInput(body.items),
        active: true,
        revision: 1,
        createdBy: actor.userId,
        updatedBy: actor.userId,
        _schemaVersion: 1,
      },
    ]);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.checklist_template.created',
      targetType: 'hr_checklist_template',
      targetId: String(created!._id),
      metadata: { kind: body.kind, items: body.items.length },
    });
    return templateViewOf(created!.toObject() as ChecklistTemplateLean);
  }

  async updateTemplate(
    organizationId: string,
    templateId: string,
    body: UpdateChecklistTemplateBody,
    actor: HrChecklistActor,
  ): Promise<ChecklistTemplateView> {
    const current = await this.requireTemplate(organizationId, templateId);
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    const set: Record<string, unknown> = { updatedBy: actor.userId };
    if (body.label !== undefined) set['label'] = body.label;
    if (body.items !== undefined) set['items'] = itemsOfInput(body.items);
    const updated = await this.templates
      .findOneAndUpdate(
        { _id: current._id, organizationId, revision: current.revision, active: true },
        { $set: set, $inc: { revision: 1 } },
        { new: true },
      )
      .lean<ChecklistTemplateLean>()
      .exec();
    if (!updated) staleRevision(current.revision + 1);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.checklist_template.updated',
      targetType: 'hr_checklist_template',
      targetId: templateId,
    });
    return templateViewOf(updated);
  }

  async removeTemplate(
    organizationId: string,
    templateId: string,
    actor: HrChecklistActor,
  ): Promise<void> {
    const current = await this.requireTemplate(organizationId, templateId);
    await this.templates
      .updateOne(
        { _id: current._id, organizationId },
        { $set: { active: false, updatedBy: actor.userId }, $inc: { revision: 1 } },
      )
      .exec();
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.checklist_template.removed',
      targetType: 'hr_checklist_template',
      targetId: templateId,
    });
  }

  // ── Listes ───────────────────────────────────────────────────────────────

  async instantiate(
    organizationId: string,
    viewer: HrViewer,
    employeeId: string,
    body: InstantiateChecklistBody,
    actor: HrChecklistActor,
  ): Promise<ChecklistView> {
    const employee = viewer.byId.get(employeeId);
    if (!employee) employeeNotFound();
    if (employee.status === 'anonymized') {
      conflict(
        'EMPLOYEE_ANONYMIZED',
        'Ce collaborateur est anonymisé : aucune liste ne peut être lancée.',
      );
    }
    const template = await this.requireTemplate(organizationId, body.templateId);

    const hrHolders = new Set(await this.authz.holdersOf(organizationId, 'hr.manage'));
    const hrUserId = body.hrAssigneeUserId ?? actor.userId;
    if (!hrHolders.has(hrUserId)) {
      // Un compte d'une autre organisation n'est pas confirmé : même refus.
      conflict(
        'CHECKLIST_ASSIGNEE_NOT_HR',
        'L’assigné RH doit gérer les dossiers du personnel dans cette organisation.',
      );
    }
    const manager = employee.managerEmployeeId
      ? viewer.byId.get(employee.managerEmployeeId)
      : undefined;
    const candidates = new Set<string>();
    if (manager?.userId) candidates.add(manager.userId);
    if (employee.userId) candidates.add(employee.userId);
    for (const i of template.items) {
      if (typeof i.assignee === 'object') candidates.add(i.assignee.userId);
    }
    const members = await this.membersAmong(organizationId, [...candidates]);
    const resolve = (a: HrChecklistAssignee): string => {
      const userId =
        a === 'hr'
          ? hrUserId
          : a === 'manager'
            ? manager?.status === 'active'
              ? manager.userId
              : null
            : a === 'employee'
              ? employee.userId
              : a.userId;
      return userId && (userId === hrUserId || members.has(userId)) ? userId : hrUserId;
    };

    const pivotDate =
      template.kind === 'onboarding' ? employee.startDate : (employee.endDate ?? hrToday());
    const items: ChecklistItemDoc[] = template.items.map((i) => ({
      id: i.id,
      label: i.label,
      note: i.note ?? null,
      assigneeUserId: resolve(i.assignee),
      dueDate: addDays(pivotDate, i.offsetDays),
      doneAt: null,
      doneBy: null,
    }));
    const [created] = await this.checklists.create([
      {
        organizationId,
        employeeId,
        templateId: String(template._id),
        kind: template.kind,
        label: template.label,
        pivotDate,
        items,
        revision: 1,
        createdBy: actor.userId,
        updatedBy: actor.userId,
        _schemaVersion: 1,
      },
    ]);
    const checklist = created!.toObject() as ChecklistLean;
    const checklistId = String(checklist._id);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.checklist.created',
      targetType: 'hr_checklist',
      targetId: checklistId,
      metadata: { employeeId, kind: template.kind, items: items.length },
    });
    const name = displayNameOf(employee);
    const counts = new Map<string, number>();
    for (const i of items) counts.set(i.assigneeUserId, (counts.get(i.assigneeUserId) ?? 0) + 1);
    await this.notifier.itemsAssigned({
      organizationId,
      checklistId,
      kind: template.kind,
      employeeName: name,
      assignees: counts,
      actorUserId: actor.userId,
    });
    return checklistViewOf(checklist, name);
  }

  async list(
    organizationId: string,
    viewer: HrViewer,
    query: ListChecklistsQuery,
  ): Promise<ChecklistPage> {
    const filter: Record<string, unknown> = { organizationId };
    if (query.employeeId) filter['employeeId'] = query.employeeId;
    if (query.open === true) filter['items.doneAt'] = null;
    const rows = await this.checklists
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(200)
      .lean<ChecklistLean[]>()
      .exec();
    return {
      items: rows.map((c) => checklistViewOf(c, this.nameOf(viewer.byId.get(c.employeeId)))),
    };
  }

  /** Coche ou décoche un élément : l'assigné, ou `hr.manage` ; sinon 404. */
  async toggle(
    organizationId: string,
    viewer: HrViewer,
    checklistId: string,
    itemId: string,
    done: boolean,
    actor: HrChecklistActor,
  ): Promise<ChecklistItemView> {
    const _id = asObjectId(checklistId);
    if (!_id) checklistNotFound();
    const current = await this.checklists
      .findOne({ _id, organizationId })
      .lean<ChecklistLean>()
      .exec();
    if (!current) checklistNotFound();
    const manage = viewer.actions.has('hr.manage');
    const item = current.items.find((i) => i.id === itemId);
    if (!item) {
      if (!manage && !current.items.some((i) => i.assigneeUserId === actor.userId)) {
        checklistNotFound();
      }
      throw new NotFoundException({
        code: 'CHECKLIST_ITEM_NOT_FOUND',
        message: 'Élément de liste introuvable.',
      });
    }
    if (!manage && item.assigneeUserId !== actor.userId) checklistNotFound();
    const updated = await this.checklists
      .findOneAndUpdate(
        { _id, organizationId, 'items.id': itemId },
        {
          $set: {
            'items.$.doneAt': done ? new Date() : null,
            'items.$.doneBy': done ? actor.userId : null,
            updatedBy: actor.userId,
          },
          $inc: { revision: 1 },
        },
        { new: true },
      )
      .lean<ChecklistLean>()
      .exec();
    if (!updated) checklistNotFound();
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: done ? 'hr.checklist_item.done' : 'hr.checklist_item.undone',
      targetType: 'hr_checklist',
      targetId: checklistId,
      metadata: { itemId },
    });
    return checklistItemViewOf(updated.items.find((i) => i.id === itemId)!);
  }

  /** Mes éléments de liste non faits (`GET /hr/me`). */
  async mine(organizationId: string, userId: string): Promise<HrMyChecklistItemView[]> {
    const rows = await this.checklists
      .find({
        organizationId,
        items: { $elemMatch: { assigneeUserId: userId, doneAt: null } },
      })
      .sort({ createdAt: 1, _id: 1 })
      .limit(200)
      .lean<ChecklistLean[]>()
      .exec();
    const employees = await this.employeesById(
      organizationId,
      rows.map((r) => r.employeeId),
    );
    const out: HrMyChecklistItemView[] = [];
    for (const c of rows) {
      for (const i of c.items) {
        if (i.assigneeUserId !== userId || i.doneAt) continue;
        out.push({
          checklistId: String(c._id),
          itemId: i.id,
          kind: c.kind,
          label: i.label,
          employeeName: this.nameOf(employees.get(c.employeeId)),
          dueDate: i.dueDate,
          doneAt: null,
        });
      }
    }
    return out.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
  }

  // ── Interne ──────────────────────────────────────────────────────────────

  private nameOf(e: EmployeeLean | undefined): string {
    return e ? displayNameOf(e) : 'Collaborateur';
  }

  private async employeesById(
    organizationId: string,
    ids: readonly string[],
  ): Promise<Map<string, EmployeeLean>> {
    const oids = [...new Set(ids)].map(asObjectId).filter((x): x is Types.ObjectId => x !== null);
    if (oids.length === 0) return new Map();
    const rows = (await this.connection
      .collection('hr_employees')
      .find(
        { organizationId, _id: { $in: oids } },
        { projection: { firstName: 1, lastName: 1, preferredName: 1 } },
      )
      .toArray()) as unknown as EmployeeLean[];
    return new Map(rows.map((e) => [String(e._id), e]));
  }

  private async membersAmong(
    organizationId: string,
    userIds: readonly string[],
  ): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const rows = await this.connection
      .collection('memberships')
      .find({ organizationId, userId: { $in: [...userIds] } }, { projection: { userId: 1 } })
      .toArray();
    return new Set(rows.map((m) => String(m['userId'])));
  }

  private async requireTemplate(
    organizationId: string,
    templateId: string,
  ): Promise<ChecklistTemplateLean> {
    const _id = asObjectId(templateId);
    if (!_id) templateNotFound();
    const t = await this.templates
      .findOne({ _id, organizationId, active: true })
      .lean<ChecklistTemplateLean>()
      .exec();
    if (!t) templateNotFound();
    return t;
  }
}
