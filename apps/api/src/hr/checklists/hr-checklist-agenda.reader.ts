// Lecteur RÉEL du port `HR_CHECKLIST_AGENDA` (déclaré par H3) — ADR-0045 § 2.9, § 6.1.
// ADR-0045 — H4.
//
// LECTURE SEULE de `hr_checklists` : les éléments NON FAITS assignés à l'appelant,
// et à lui seul. Rien n'est copié dans `work_tasks` ; aucun projet RUN ne les voit
// (O4 : une liste de départ n'annonce pas un départ à toute l'équipe). Fourni dans
// `HrAgendaModule` (sans dépendance) : les modèles viennent de ce module.

import {
  HR_CHECKLIST_KIND_LABELS,
  hrChecklistAgendaId,
  type HrChecklistTaskItem,
} from '@lalanda/shared/hr';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import type { HrChecklistAgendaReader } from '../agenda/hr-checklist-agenda.port.js';
import {
  Employee,
  type EmployeeDocument,
  type EmployeeLean,
} from '../employees/employee.schema.js';
import { displayNameOf } from '../leave/display-name.js';
import { Checklist, type ChecklistDocument, type ChecklistLean } from './checklist.schemas.js';

/** Écran ouvert par un clic : « Mon espace », où l'élément se coche. */
export const HR_CHECKLIST_ITEM_HREF = '/rh/moi';

@Injectable()
export class HrChecklistAgendaSource implements HrChecklistAgendaReader {
  constructor(
    @InjectModel(Checklist.name) private readonly checklists: Model<ChecklistDocument>,
    @InjectModel(Employee.name) private readonly employees: Model<EmployeeDocument>,
  ) {}

  async itemsOf(
    organizationId: string,
    userId: string,
    limit: number,
  ): Promise<{ items: HrChecklistTaskItem[]; truncated: boolean }> {
    const rows = await this.checklists
      .find({
        organizationId,
        items: { $elemMatch: { assigneeUserId: userId, doneAt: null } },
      })
      .sort({ createdAt: 1, _id: 1 })
      .limit(limit + 1)
      .lean<ChecklistLean[]>()
      .exec();
    if (rows.length === 0) return { items: [], truncated: false };
    const people = await this.employees
      .find(
        { organizationId, _id: { $in: [...new Set(rows.map((r) => r.employeeId))] } },
        { firstName: 1, lastName: 1, preferredName: 1 },
      )
      .lean<EmployeeLean[]>()
      .exec();
    const names = new Map(people.map((e) => [String(e._id), displayNameOf(e)]));
    const items: HrChecklistTaskItem[] = [];
    for (const c of rows) {
      const checklistId = String(c._id);
      for (const i of c.items) {
        if (i.assigneeUserId !== userId || i.doneAt) continue;
        items.push({
          source: 'hr',
          kind: 'checklist_item',
          id: hrChecklistAgendaId(checklistId, i.id),
          checklistId,
          itemId: i.id,
          label: i.label,
          employeeName: names.get(c.employeeId) ?? 'Collaborateur',
          dueDate: i.dueDate,
          priority: 'none',
          rank: new Date(c.createdAt).toISOString(),
          done: false,
          kindLabel: HR_CHECKLIST_KIND_LABELS[c.kind],
          href: HR_CHECKLIST_ITEM_HREF,
        });
      }
    }
    return { items: items.slice(0, limit), truncated: items.length > limit };
  }
}
