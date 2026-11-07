// Jours fériés de la RDC proposés — ADR-0068 § 5.
//
//   GET  /hr/holidays/country/cd?year=     hr.manage  aperçu (rien n'est écrit)
//   POST /hr/holidays/country/cd?year=     hr.manage  ajoute les dates absentes, « à vérifier »
//   POST /hr/holidays/:holidayId/verify    hr.manage  lève la marque « à vérifier »
//
// La liste, sa source et sa version viennent du moteur (`RDC_PUBLIC_HOLIDAYS`) : rien
// n'est affirmé ici. Dates NON récurrentes : à recharger chaque année.

import { RDC_HOLIDAYS_SOURCE, RDC_HOLIDAYS_VERSION, rdcHolidaysFor } from '@lalanda/engine';
import {
  CountryHolidaysQuery,
  type CountryHolidaysLoadResult,
  type CountryHolidaysProposalView,
  type HolidayView,
} from '@lalanda/shared/hr';
import {
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { AuditService } from '../../authz/audit.service.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { CurrentOrgRole } from '../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import type { OrgRole } from '../../authz/permissions.js';
import { RequireFeature } from '../../billing/feature.guard.js';
import { invalidRequest, isDuplicateKey } from '../../sales/sales.errors.js';
import { isObjectIdHex } from '../../sales/search.js';
import { Holiday, type HolidayDocument, type HolidayLean } from './holiday.schema.js';
import { holidayViewOf } from './hr-holidays.service.js';

const SOURCE_LABEL = `${RDC_HOLIDAYS_SOURCE.text} — lu via ${RDC_HOLIDAYS_SOURCE.readVia} (${RDC_HOLIDAYS_SOURCE.consultedOn})`;

@Controller('hr/holidays')
@RequireFeature('hr')
@UseGuards(AuthGuard, PermissionsGuard)
export class HrCountryHolidaysController {
  constructor(
    @InjectModel(Holiday.name) private readonly holidays: Model<HolidayDocument>,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private yearOf(query: unknown): number {
    const parsed = CountryHolidaysQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Année attendue (2023 à 2100).');
    return parsed.data.year;
  }

  private async present(organizationId: string, dates: string[]): Promise<Set<string>> {
    const docs = await this.holidays
      .find({ organizationId, date: { $in: dates } }, { date: 1 })
      .lean<HolidayLean[]>()
      .exec();
    return new Set(docs.map((d) => d.date));
  }

  @Get('country/cd')
  @RequirePermission('hr.manage')
  async proposal(
    @CurrentOrgId() orgId: string,
    @Query() query: unknown,
  ): Promise<CountryHolidaysProposalView> {
    const year = this.yearOf(query);
    const list = rdcHolidaysFor(year);
    const present = await this.present(
      orgId,
      list.map((h) => h.date),
    );
    return {
      country: 'CD',
      year,
      version: RDC_HOLIDAYS_VERSION,
      source: { ...RDC_HOLIDAYS_SOURCE },
      items: list.map((h) => ({ ...h, alreadyPresent: present.has(h.date) })),
    };
  }

  @Post('country/cd')
  @RequirePermission('hr.manage')
  async load(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Query() query: unknown,
  ): Promise<CountryHolidaysLoadResult> {
    const year = this.yearOf(query);
    const list = rdcHolidaysFor(year);
    const present = await this.present(
      orgId,
      list.map((h) => h.date),
    );
    let created = 0;
    let alreadyPresent = 0;
    for (const h of list) {
      if (present.has(h.date)) {
        alreadyPresent += 1;
        continue;
      }
      try {
        await this.holidays.create({
          organizationId: orgId,
          date: h.date,
          label: h.label,
          halfDay: null,
          recurring: false,
          toVerify: true,
          source: SOURCE_LABEL,
          createdBy: user.id,
          _schemaVersion: 1,
        });
        created += 1;
      } catch (err) {
        // Saisie concurrente du même jour : il est déjà là.
        if (!isDuplicateKey(err)) throw err;
        alreadyPresent += 1;
      }
    }
    await this.audit.record({
      organizationId: orgId,
      actorUserId: user.id,
      actorRole: role ?? 'unknown',
      action: 'hr.holidays.country_loaded',
      targetType: 'holiday',
      targetId: `CD-${year}`,
      metadata: { year, version: RDC_HOLIDAYS_VERSION, created, alreadyPresent },
    });
    return { created, alreadyPresent };
  }

  @Post(':holidayId/verify')
  @HttpCode(200)
  @RequirePermission('hr.manage')
  async verify(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('holidayId') holidayId: string,
  ): Promise<HolidayView> {
    if (!isObjectIdHex(holidayId)) holidayNotFound();
    const doc = await this.holidays
      .findOneAndUpdate(
        { _id: new Types.ObjectId(holidayId), organizationId: orgId },
        { $set: { toVerify: false } },
        { new: true },
      )
      .lean<HolidayLean>()
      .exec();
    if (!doc) holidayNotFound();
    await this.audit.record({
      organizationId: orgId,
      actorUserId: user.id,
      actorRole: role ?? 'unknown',
      action: 'hr.holiday.verified',
      targetType: 'holiday',
      targetId: holidayId,
      metadata: { date: doc.date },
    });
    return holidayViewOf(doc);
  }
}

function holidayNotFound(): never {
  throw new NotFoundException({ code: 'HOLIDAY_NOT_FOUND', message: 'Jour férié introuvable.' });
}
