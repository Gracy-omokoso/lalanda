// Changement de poste d'un collaborateur (mutation) — ADR-0068, amendement du
// 8 nov. 2026.
//
// Vers un poste VACANT de l'organisation (`replacement`) ou un poste créé (`new`).
// Dans UNE transaction : la fiche pointe le nouveau poste (révision attendue), l'ancien
// redevient vacant (historique clos à la date d'effet), le nouveau est pourvu
// (historique ouvert à la même date), trace d'audit stricte. Le MATRICULE ne change
// JAMAIS : il n'est pas lu ni écrit ici. Dates : moteur `positionChangeCheck`.

import { positionChangeCheck } from '@lalanda/engine';
import type { ChangeEmployeePositionBody, EmployeeView } from '@lalanda/shared/hr';
import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { conflict, invalidRequestOf, staleRevision } from '../../sales/sales.errors.js';
import { HrDepartmentsService, type HrActor } from '../departments/hr-departments.service.js';
import { Employee, type EmployeeDocument } from '../employees/employee.schema.js';
import { HrEmployeesService, keysOf } from '../employees/hr-employees.service.js';
import { hrToday, inHrTransaction } from '../scope/hr-errors.js';
import { HrPositionsService } from './hr-positions.service.js';

const DATE_MESSAGES = {
  DATE_BEFORE_START: 'La date d’effet précède la date d’entrée du collaborateur.',
  DATE_BEFORE_CURRENT_HOLDING: 'La date d’effet précède le début de l’occupation du poste actuel.',
} as const;

@Injectable()
export class HrPositionChangeService {
  constructor(
    @InjectModel(Employee.name) private readonly employees: Model<EmployeeDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(HrEmployeesService) private readonly fiches: HrEmployeesService,
    @Inject(HrPositionsService) private readonly positions: HrPositionsService,
    @Inject(HrDepartmentsService) private readonly departments: HrDepartmentsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async change(
    organizationId: string,
    employeeId: string,
    body: ChangeEmployeePositionBody,
    actor: HrActor,
  ): Promise<EmployeeView> {
    const current = await this.fiches.requireOwn(organizationId, employeeId);
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    if (current.status !== 'active') {
      conflict(
        'EMPLOYEE_NOT_ACTIVE',
        'Seul un collaborateur actif change de poste : annulez la sortie d’abord.',
      );
    }
    const oldPositionId = current.positionId ?? null;
    const old = oldPositionId
      ? await this.positions.requireOwn(organizationId, oldPositionId)
      : null;
    const choice = body.position;
    if (choice.mode === 'replacement' && choice.positionId === oldPositionId) {
      conflict('POSITION_UNCHANGED', 'Le collaborateur occupe déjà ce poste.');
    }
    const target =
      choice.mode === 'replacement'
        ? await this.positions.requireOpen(organizationId, choice.positionId)
        : null;

    const effectiveDate = body.effectiveDate ?? hrToday();
    const openHolding =
      old?.holders.find((h) => h.employeeId === employeeId && h.to === null) ?? null;
    const check = positionChangeCheck({
      startDate: current.startDate,
      currentHoldingFrom: openHolding?.from ?? null,
      effectiveDate,
    });
    if (!check.ok) {
      invalidRequestOf([
        { path: 'effectiveDate', code: check.issue!, message: DATE_MESSAGES[check.issue!] },
      ]);
    }

    // Intitulé et service affichés sur la fiche : ceux demandés, sinon ceux du poste
    // choisi (remplacement), sinon ceux de la fiche (nouveau poste).
    const jobTitle = body.jobTitle ?? target?.title ?? current.jobTitle;
    const departmentId =
      body.departmentId !== undefined
        ? body.departmentId
        : target
          ? (target.departmentId ?? current.departmentId ?? null)
          : (current.departmentId ?? null);
    if (departmentId && departmentId !== current.departmentId) {
      await this.departments.requireActive(organizationId, departmentId);
    }

    let newPositionId = '';
    await inHrTransaction(this.connection, async (session) => {
      newPositionId =
        choice.mode === 'replacement'
          ? choice.positionId
          : await this.positions.insert(
              organizationId,
              { title: jobTitle, departmentId },
              actor,
              session,
            );
      const res = await this.employees
        .updateOne(
          {
            _id: current._id,
            organizationId,
            revision: current.revision,
            status: 'active',
            positionId: oldPositionId,
          },
          {
            $set: {
              positionId: newPositionId,
              jobTitle,
              departmentId,
              ...keysOf({ ...current, jobTitle }),
              updatedBy: actor.userId,
            },
            $inc: { revision: 1 },
          },
          { session },
        )
        .exec();
      if (res.matchedCount !== 1) staleRevision(current.revision + 1);
      // L'ancien poste d'abord : `release` vise le poste pourvu par ce collaborateur.
      if (oldPositionId) {
        await this.positions.release(
          organizationId,
          employeeId,
          effectiveDate,
          actor.userId,
          session,
        );
      }
      await this.positions.fill(
        organizationId,
        newPositionId,
        employeeId,
        effectiveDate,
        actor.userId,
        session,
      );
      await this.audit.recordStrict(
        {
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'hr.employee.position_changed',
          targetType: 'employee',
          targetId: employeeId,
          metadata: {
            fromPositionId: oldPositionId,
            toPositionId: newPositionId,
            mode: choice.mode,
            effectiveDate,
          },
        },
        { session },
      );
    });
    const [view] = await this.fiches.withNames(organizationId, [
      this.fiches.view(await this.fiches.requireOwn(organizationId, employeeId), true),
    ]);
    return view!;
  }
}
