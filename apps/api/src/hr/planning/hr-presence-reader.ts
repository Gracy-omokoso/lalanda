// Lectures communes des présences et des plannings (ADR-0051 § 2.3, § 2.4). ADR-0051 — H12.
//
// Met en forme, pour le MOTEUR, ce que les deux services lisent : créneaux (`ShiftInput`)
// et absences APPROUVÉES (`EmployeeLeaveInput`, ADR-0045 : demandes `approved`). Aucun
// calcul ici : jours, durées, chevauchements et constats viennent du moteur. Une absence
// confidentielle n'expose que sa période (le moteur ne reçoit ni type ni motif).

import type { EmployeeLeaveInput, ShiftInput } from '@lalanda/engine';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import {
  LeaveRequest,
  type LeaveRequestDocument,
  type LeaveRequestLean,
} from '../leave/leave-request.schema.js';
import { Shift, type ShiftDocument, type ShiftLean } from './planning.schemas.js';

const DAY_MS = 86_400_000;

/** Jour civil `AAAA-MM-JJ` décalé de `n` jours (calendrier pur, sans fuseau). */
export function addDaysIso(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Nombre de jours de `from` à `to`, bornes comprises. */
export function spanDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

/** Lundi ? (jour civil). */
export function isMonday(day: string): boolean {
  return new Date(`${day}T00:00:00Z`).getUTCDay() === 1;
}

/** Lundi de la semaine d'un jour civil. */
export function mondayOfIso(day: string): string {
  const wd = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDaysIso(day, -((wd + 6) % 7));
}

export function shiftInputOf(s: ShiftLean): ShiftInput {
  return {
    id: String(s._id),
    employeeId: s.employeeId,
    date: s.date,
    start: s.start,
    end: s.end,
    crossesMidnight: s.crossesMidnight,
    status: s.status,
    departmentId: s.departmentId ?? null,
    location: s.location ?? null,
  };
}

export function leaveInputOf(r: LeaveRequestLean): EmployeeLeaveInput {
  return {
    employeeId: r.employeeId,
    start: { date: r.start.date, half: r.start.half },
    end: { date: r.end.date, half: r.end.half },
  };
}

@Injectable()
export class HrPresenceReader {
  constructor(
    @InjectModel(Shift.name) private readonly shifts: Model<ShiftDocument>,
    @InjectModel(LeaveRequest.name) private readonly requests: Model<LeaveRequestDocument>,
  ) {}

  /** Créneaux dont le jour de début tombe dans `[from, to]` ; `null` = tous les collaborateurs. */
  async shiftsIn(
    organizationId: string,
    employeeIds: readonly string[] | null,
    from: string,
    to: string,
    statuses: readonly string[] = ['draft', 'published'],
  ): Promise<ShiftLean[]> {
    if (employeeIds !== null && employeeIds.length === 0) return [];
    return this.shifts
      .find({
        organizationId,
        ...(employeeIds === null ? {} : { employeeId: { $in: [...employeeIds] } }),
        status: { $in: [...statuses] },
        date: { $gte: from, $lte: to },
      })
      .sort({ date: 1, start: 1, _id: 1 })
      .lean<ShiftLean[]>()
      .exec();
  }

  /** Absences approuvées qui croisent `[from, to]` ; `null` = tous les collaborateurs. */
  async approvedLeaves(
    organizationId: string,
    employeeIds: readonly string[] | null,
    from: string,
    to: string,
  ): Promise<EmployeeLeaveInput[]> {
    if (employeeIds !== null && employeeIds.length === 0) return [];
    const docs = await this.requests
      .find({
        organizationId,
        ...(employeeIds === null ? {} : { employeeId: { $in: [...employeeIds] } }),
        status: 'approved',
        'start.date': { $lte: to },
        'end.date': { $gte: from },
      })
      .lean<LeaveRequestLean[]>()
      .exec();
    return docs.map(leaveInputOf);
  }
}
