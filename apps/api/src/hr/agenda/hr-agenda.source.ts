// Fournisseur RÉEL du port `HR_AGENDA_SOURCE` de « Mes tâches » — ADR-0045 § 6.1.
// ADR-0045 — H3.
//
// LECTURE SEULE de `hr_leave_requests` : rien n'est copié dans `work_tasks`. Deux
// natures d'éléments `source: 'hr'` :
//   - `leave_approval` : demande que l'appelant peut traiter (`HrLeaveApprovalsReader`),
//     sans case à cocher ; le type d'une absence confidentielle reste « Absence » hors
//     ayants droit ;
//   - `checklist_item` : élément de liste d'entrée ou de sortie assigné à l'appelant,
//     lu par le port `HR_CHECKLIST_AGENDA` (nul jusqu'au lot H4).

import {
  HR_LEAVE_APPROVALS_HREF,
  HR_LEAVE_APPROVAL_KIND_LABEL,
  hrLeaveAgendaId,
  type HrMyTaskItem,
} from '@lalanda/shared/hr';
import { Inject, Injectable, Optional } from '@nestjs/common';

import type { HrAgendaActor, HrAgendaPage, HrAgendaReader } from '../../work/my-tasks.ports.js';
import { displayNameOf } from '../leave/display-name.js';
import { MASKED_AGENDA_LABEL, seesLeaveType } from '../leave/leave-model.js';
import { HrLeaveApprovalsReader } from './hr-leave-approvals.reader.js';
import {
  HR_CHECKLIST_AGENDA,
  noHrChecklistAgenda,
  type HrChecklistAgendaReader,
} from './hr-checklist-agenda.port.js';

@Injectable()
export class HrAgendaSource implements HrAgendaReader {
  private readonly checklists: HrChecklistAgendaReader;

  constructor(
    @Inject(HrLeaveApprovalsReader) private readonly approvals: HrLeaveApprovalsReader,
    @Optional() @Inject(HR_CHECKLIST_AGENDA) checklists: HrChecklistAgendaReader | null,
  ) {
    this.checklists = checklists ?? noHrChecklistAgenda;
  }

  async agendaOf(
    organizationId: string,
    actor: HrAgendaActor,
    limit: number,
  ): Promise<HrAgendaPage> {
    const [pending, items] = await Promise.all([
      this.approvals.pendingFor(organizationId, actor.userId, actor.holdsLeaveApprove),
      this.checklists.itemsOf(organizationId, actor.userId, limit),
    ]);
    const out: HrMyTaskItem[] = pending.requests.slice(0, limit).map((r) => {
      const employee = pending.employees.get(r.employeeId)!;
      const type = pending.types.get(r.typeId);
      const visible = seesLeaveType({
        confidential: type?.confidential ?? true,
        isSelf: employee.userId === actor.userId,
        seesConfidential: actor.seesConfidential,
        holdsLeaveApprove: actor.holdsLeaveApprove,
      });
      const requestId = String(r._id);
      return {
        source: 'hr',
        kind: 'leave_approval',
        id: hrLeaveAgendaId(requestId),
        requestId,
        employeeName: displayNameOf(employee),
        typeLabel: visible && type ? type.label : MASKED_AGENDA_LABEL,
        start: { date: r.start.date, half: r.start.half },
        end: { date: r.end.date, half: r.end.half },
        days: r.days,
        dueDate: r.start.date,
        priority: 'none',
        rank: new Date(r.createdAt).toISOString(),
        done: false,
        kindLabel: HR_LEAVE_APPROVAL_KIND_LABEL,
        href: HR_LEAVE_APPROVALS_HREF,
      };
    });
    const room = Math.max(0, limit - out.length);
    out.push(...items.items.slice(0, room));
    return {
      items: out,
      truncated: pending.requests.length > limit || items.truncated || items.items.length > room,
    };
  }
}
