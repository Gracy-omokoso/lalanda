// Matricules et numéros de poste (ADR-0068 § 2 et § 3).
//
// Réglage : `hr_settings.employeeNumbering = { prefix, width, revision }` (préfixe
// `null` = dérivé du nom de l'organisation par le moteur). Compteurs : `hr_counters`,
// `kind: 'EMP' | 'POS'`, `year: 0` (non annuels). Le compteur ne connaît que `$inc`
// (tirage) et `$max` (numéro manuel compatible, changement de préfixe) : JAMAIS
// décrémenté. Le tirage est HORS transaction : un échec laisse un trou, jamais un
// doublon. Un numéro tiré déjà porté (fiche ou réservation d'une fiche anonymisée)
// est sauté.

import {
  EMPLOYEE_NUMBER_WIDTH,
  POSITION_NUMBER_PREFIX,
  POSITION_NUMBER_WIDTH,
  defaultEmployeeNumberPrefix,
  formatSequenceNumber,
  highestSequenceRank,
  normalizeEmployeeNumberPrefix,
  sequenceRankOf,
} from '@lalanda/engine';
import {
  employeeNumberKey,
  type EmployeeNumberingView,
  type UpdateEmployeeNumberingBody,
} from '@lalanda/shared/hr';
import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { OrganizationsService } from '../../organizations/organizations.service.js';
import {
  conflict,
  invalidRequestOf,
  isDuplicateKey,
  staleRevision,
} from '../../sales/sales.errors.js';
import type { HrActor } from '../departments/hr-departments.service.js';
import { Employee, type EmployeeDocument } from '../employees/employee.schema.js';
import { HrCounter, type HrCounterDocument } from '../expenses/hr-counter.schema.js';

type CounterKind = 'EMP' | 'POS';

/** Tirages au plus pour trouver un numéro libre (préfixe revenu sur d'anciens numéros). */
const MAX_DRAWS = 50;

interface StoredNumbering {
  prefix: string | null;
  width: number;
  revision: number;
}

function storedOf(raw: unknown): StoredNumbering {
  const r = (raw ?? {}) as Record<string, unknown>;
  const prefix =
    typeof r['prefix'] === 'string' ? normalizeEmployeeNumberPrefix(r['prefix']) : null;
  const width =
    typeof r['width'] === 'number' &&
    Number.isInteger(r['width']) &&
    r['width'] >= EMPLOYEE_NUMBER_WIDTH.min &&
    r['width'] <= EMPLOYEE_NUMBER_WIDTH.max
      ? r['width']
      : EMPLOYEE_NUMBER_WIDTH.default;
  const revision = typeof r['revision'] === 'number' ? r['revision'] : 0;
  return { prefix, width, revision };
}

@Injectable()
export class HrNumberingService {
  constructor(
    @InjectModel(HrCounter.name) private readonly counters: Model<HrCounterDocument>,
    @InjectModel(Employee.name) private readonly employees: Model<EmployeeDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(OrganizationsService) private readonly organizations: OrganizationsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ── Réglage ──────────────────────────────────────────────────────────────

  private async stored(organizationId: string): Promise<StoredNumbering> {
    const doc = await this.connection
      .collection('hr_settings')
      .findOne({ organizationId }, { projection: { employeeNumbering: 1 } });
    return storedOf(doc?.['employeeNumbering']);
  }

  private async defaultPrefix(organizationId: string): Promise<string> {
    try {
      return defaultEmployeeNumberPrefix(
        (await this.organizations.findOrgById(organizationId)).name,
      );
    } catch {
      return defaultEmployeeNumberPrefix('');
    }
  }

  /** Préfixe et largeur appliqués. */
  async format(organizationId: string): Promise<{ prefix: string; width: number }> {
    const s = await this.stored(organizationId);
    return { prefix: s.prefix ?? (await this.defaultPrefix(organizationId)), width: s.width };
  }

  async view(organizationId: string): Promise<EmployeeNumberingView> {
    const s = await this.stored(organizationId);
    const defaultPrefix = await this.defaultPrefix(organizationId);
    const prefix = s.prefix ?? defaultPrefix;
    const counter = await this.counters
      .findOne({ organizationId, kind: 'EMP', year: 0 })
      .lean<HrCounter>()
      .exec();
    return {
      prefix,
      configuredPrefix: s.prefix,
      defaultPrefix,
      width: s.width,
      nextNumber: formatSequenceNumber(prefix, s.width, (counter?.last ?? 0) + 1),
      revision: s.revision,
    };
  }

  /** `PUT /hr/settings/numbering`. Le compteur est recalé sur le plus grand numéro compatible. */
  async update(
    organizationId: string,
    body: UpdateEmployeeNumberingBody,
    actor: HrActor,
  ): Promise<EmployeeNumberingView> {
    const prefix = body.prefix === null ? null : normalizeEmployeeNumberPrefix(body.prefix);
    if (body.prefix !== null && prefix === null) {
      invalidRequestOf([
        {
          path: 'prefix',
          code: 'EMPLOYEE_NUMBER_PREFIX_INVALID',
          message: 'Préfixe : 1 à 10 lettres, chiffres ou « - _ / . ».',
        },
      ]);
    }
    const before = await this.stored(organizationId);
    if (before.revision !== body.expectedRevision) staleRevision(before.revision);
    const next = { prefix, width: body.width, revision: before.revision + 1 };
    const filter: Record<string, unknown> = { organizationId };
    if (before.revision === 0) {
      filter['$or'] = [
        { employeeNumbering: { $exists: false } },
        { 'employeeNumbering.revision': { $exists: false } },
        { 'employeeNumbering.revision': 0 },
      ];
    } else {
      filter['employeeNumbering.revision'] = before.revision;
    }
    try {
      const res = await this.connection.collection('hr_settings').updateOne(
        filter,
        {
          $set: { employeeNumbering: next, updatedAt: new Date(), updatedBy: actor.userId },
          // Document créé ici : `revision: 0` garde les réglages RH « non enregistrés »
          // pour leur propre révision (ADR-0045 § 2.2).
          $setOnInsert: { revision: 0, _schemaVersion: 1, createdAt: new Date() },
        },
        { upsert: before.revision === 0 },
      );
      if (res.matchedCount === 0 && res.upsertedCount === 0) {
        staleRevision((await this.stored(organizationId)).revision);
      }
    } catch (err) {
      if (isDuplicateKey(err)) staleRevision((await this.stored(organizationId)).revision);
      throw err;
    }
    const applied = prefix ?? (await this.defaultPrefix(organizationId));
    await this.raiseTo(organizationId, 'EMP', await this.highestExisting(organizationId, applied));
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.numbering.updated',
      targetType: 'hr_settings',
      targetId: organizationId,
      metadata: {
        before: { prefix: before.prefix, width: before.width },
        after: { prefix, width: body.width },
      },
    });
    return this.view(organizationId);
  }

  // ── Compteurs ────────────────────────────────────────────────────────────

  private async bump(organizationId: string, kind: CounterKind): Promise<number> {
    const run = () =>
      this.counters
        .findOneAndUpdate(
          { organizationId, kind, year: 0 },
          { $inc: { last: 1 }, $setOnInsert: { _schemaVersion: 1 } },
          { upsert: true, new: true },
        )
        .lean<HrCounter>()
        .exec();
    let c: HrCounter | null;
    try {
      c = await run();
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      c = await run();
    }
    return c!.last;
  }

  /** Pousse le compteur au moins à `rank` (`$max`, jamais vers le bas). */
  async raiseTo(organizationId: string, kind: CounterKind, rank: number): Promise<void> {
    if (rank < 1) return;
    const run = () =>
      this.counters
        .updateOne(
          { organizationId, kind, year: 0 },
          { $max: { last: rank }, $setOnInsert: { _schemaVersion: 1 } },
          { upsert: true },
        )
        .exec();
    try {
      await run();
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      await run();
    }
  }

  /** Plus grand rang compatible parmi les matricules et réservations de l'organisation. */
  private async highestExisting(organizationId: string, prefix: string): Promise<number> {
    const keys = (await this.employees
      .distinct('employeeNumberKey', { organizationId, employeeNumberKey: { $type: 'string' } })
      .exec()) as string[];
    return highestSequenceRank(prefix, keys);
  }

  /** Prochain matricule libre (ni porté, ni réservé). */
  async nextEmployeeNumber(organizationId: string): Promise<string> {
    const { prefix, width } = await this.format(organizationId);
    for (let i = 0; i < MAX_DRAWS; i += 1) {
      const value = formatSequenceNumber(prefix, width, await this.bump(organizationId, 'EMP'));
      const taken = await this.employees
        .exists({ organizationId, employeeNumberKey: employeeNumberKey(value) })
        .exec();
      if (!taken) return value;
    }
    conflict(
      'EMPLOYEE_NUMBER_EXHAUSTED',
      'Aucun matricule libre n’a été trouvé : changez le préfixe des matricules.',
    );
  }

  /** Numéro saisi à la main : s'il suit le format courant, le compteur repart au-dessus. */
  async reserveManual(organizationId: string, value: string): Promise<void> {
    const { prefix } = await this.format(organizationId);
    const rank = sequenceRankOf(prefix, value);
    if (rank !== null) await this.raiseTo(organizationId, 'EMP', rank);
  }

  /** Prochain numéro de poste (`POS-001`). */
  async nextPositionNumber(
    organizationId: string,
    isTaken: (key: string, session?: ClientSession) => Promise<boolean>,
  ): Promise<string> {
    for (let i = 0; i < MAX_DRAWS; i += 1) {
      const value = formatSequenceNumber(
        POSITION_NUMBER_PREFIX,
        POSITION_NUMBER_WIDTH,
        await this.bump(organizationId, 'POS'),
      );
      if (!(await isTaken(employeeNumberKey(value)))) return value;
    }
    conflict('POSITION_NUMBER_EXHAUSTED', 'Aucun numéro de poste libre n’a été trouvé.');
  }
}
