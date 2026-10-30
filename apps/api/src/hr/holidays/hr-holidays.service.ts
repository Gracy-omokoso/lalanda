// Jours fériés et de fermeture (ADR-0045 § 2.6, § 3.2). ADR-0045 — H3.
//
// Liste VIDE par défaut (décision ouverte n° 12) : rien n'est créé à la lecture. Une
// date par organisation (`409 HOLIDAY_EXISTS`) ; écriture `hr.manage`, auditée.

import type {
  CreateHolidayBody,
  HolidayListView,
  HolidayView,
  ListHolidaysQuery,
} from '@lalanda/shared/hr';
import type { HolidayInput } from '@lalanda/engine';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { conflict, isDuplicateKey } from '../../sales/sales.errors.js';
import { isObjectIdHex } from '../../sales/search.js';
import type { HrActor } from '../departments/hr-departments.service.js';
import { Holiday, type HolidayDocument, type HolidayLean } from './holiday.schema.js';

function holidayNotFound(): never {
  throw new NotFoundException({ code: 'HOLIDAY_NOT_FOUND', message: 'Jour férié introuvable.' });
}

function viewOf(h: HolidayLean): HolidayView {
  return {
    id: String(h._id),
    date: h.date,
    label: h.label,
    halfDay: h.halfDay ?? null,
    recurring: h.recurring,
    createdAt: new Date(h.createdAt).toISOString(),
  };
}

@Injectable()
export class HrHolidaysService {
  constructor(
    @InjectModel(Holiday.name) private readonly holidays: Model<HolidayDocument>,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Entrée du moteur : tous les fériés de l'organisation (les récurrents valent chaque année). */
  async engineInput(organizationId: string): Promise<HolidayInput[]> {
    const docs = await this.holidays.find({ organizationId }).lean<HolidayLean[]>().exec();
    return docs.map((h) => ({
      date: h.date,
      halfDay: h.halfDay ?? null,
      recurring: h.recurring,
      label: h.label,
    }));
  }

  async list(organizationId: string, query: ListHolidaysQuery): Promise<HolidayListView> {
    const filter: Record<string, unknown> = { organizationId };
    if (query.year !== undefined) {
      filter['$or'] = [{ date: { $regex: `^${query.year}-` } }, { recurring: true }];
    }
    const docs = await this.holidays
      .find(filter)
      .sort({ date: 1, _id: 1 })
      .lean<HolidayLean[]>()
      .exec();
    return { items: docs.map(viewOf) };
  }

  async create(
    organizationId: string,
    body: CreateHolidayBody,
    actor: HrActor,
  ): Promise<HolidayView> {
    let id: string;
    try {
      const created = await this.holidays.create({
        organizationId,
        ...body,
        createdBy: actor.userId,
        _schemaVersion: 1,
      });
      id = String(created._id);
    } catch (err) {
      if (isDuplicateKey(err))
        conflict('HOLIDAY_EXISTS', 'Un jour férié est déjà saisi à cette date.');
      throw err;
    }
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.holiday.created',
      targetType: 'holiday',
      targetId: id,
      metadata: { date: body.date },
    });
    const doc = await this.holidays.findById(id).lean<HolidayLean>().exec();
    return viewOf(doc!);
  }

  async remove(organizationId: string, holidayId: string, actor: HrActor): Promise<void> {
    if (!isObjectIdHex(holidayId)) holidayNotFound();
    const doc = await this.holidays
      .findOneAndDelete({ _id: new Types.ObjectId(holidayId), organizationId })
      .lean<HolidayLean>()
      .exec();
    if (!doc) holidayNotFound();
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.holiday.deleted',
      targetType: 'holiday',
      targetId: holidayId,
      metadata: { date: doc.date },
    });
  }
}
