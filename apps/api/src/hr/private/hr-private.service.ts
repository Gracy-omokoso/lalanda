// Données sensibles du collaborateur (ADR-0045 § 2.4). ADR-0045 — H2.
//
// - Écriture par section (`hr.manage` ET `hr.sensitive.read`, vérifiés au guard) :
//   chiffrée ici, audit STRICT `hr.private.changed` dans la MÊME transaction (avant et
//   après MASQUÉS), puis, pour les coordonnées bancaires, alerte hors transaction et
//   bandeau de sept jours.
// - Lecture en clair (`reveal`) : `hr.sensitive.read` ou le collaborateur lui-même
//   (décidé par l'appelant) ; au plus 30 par heure et par utilisateur, compté sur le
//   journal lui-même (une trace par affichage, partagée entre instances) ; audit STRICT
//   `hr.private.revealed` (sections, jamais de valeur) écrit AVANT tout déchiffrement :
//   sans trace, rien n'est révélé (`503 HR_AUDIT_UNAVAILABLE`).
// - Ni les listes, ni les fiches, ni les notifications, ni les journaux d'exploitation
//   ne reçoivent un clair : seules les formes masquées sortent d'ici hors `reveal`.

import {
  HR_LIMITS,
  type EmployeePrivateRevealView,
  type EmployeePrivateSummary,
  type HrPrivateField,
  type HrPrivateSections,
} from '@lalanda/shared/hr';
import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';

import { AuditEvent, type AuditEventDocument } from '../../authz/audit-event.schema.js';
import { AuditService } from '../../authz/audit.service.js';
import { MASTER_KEYRING } from '../../integrations/keyring.provider.js';
import type { EncryptedValue, MasterKeyring } from '../../integrations/secrets-crypto.js';
import { isDuplicateKey, staleRevision } from '../../sales/sales.errors.js';
import type { EmployeeLean } from '../employees/employee.schema.js';
import {
  auditUnavailable,
  inHrTransaction,
  privateUnreadable,
  revealRateLimited,
  secretsNotConfigured,
} from '../scope/hr-errors.js';
import {
  EmployeePrivate,
  PRIVATE_FIELD_KEYS,
  type EmployeePrivateDocument,
  type EmployeePrivateLean,
  type PrivateFieldDoc,
} from './employee-private.schema.js';
import { decryptHrPrivate, encryptHrPrivate, maskHrPrivate } from './hr-private-crypto.js';
import { HrPrivateNotifier } from './hr-private-notifier.js';

export interface HrPrivateActor {
  userId: string;
  role: string;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function stamp(f: PrivateFieldDoc): { changedAt: string; changedBy: string } {
  return { changedAt: new Date(f.changedAt).toISOString(), changedBy: f.changedBy };
}

/** Formes masquées d'un dossier sensible (ou d'aucun). */
export function privateSummaryOf(
  employeeId: string,
  doc: EmployeePrivateLean | null,
  now: Date = new Date(),
): EmployeePrivateSummary {
  const field = (key: HrPrivateField) => {
    const f = doc?.[key] ?? null;
    return f ? { ...(f.masked as object), ...stamp(f) } : null;
  };
  const changedAt = doc?.bankDetailsChangedAt ? new Date(doc.bankDetailsChangedAt) : null;
  const until = changedAt
    ? new Date(changedAt.getTime() + HR_LIMITS.bankDetailsAlertDays * DAY_MS)
    : null;
  return {
    employeeId,
    revision: doc?.revision ?? 0,
    compensation: field('compensation') as EmployeePrivateSummary['compensation'],
    bankDetails: field('bankDetails') as EmployeePrivateSummary['bankDetails'],
    identity: field('identity') as EmployeePrivateSummary['identity'],
    personalContact: field('personalContact') as EmployeePrivateSummary['personalContact'],
    exitNote: field('exitNote') as EmployeePrivateSummary['exitNote'],
    bankDetailsAlert:
      changedAt && until && until > now
        ? {
            changedAt: changedAt.toISOString(),
            changedBy: doc!.bankDetailsChangedBy ?? '',
            until: until.toISOString(),
          }
        : null,
  };
}

function displayNameOf(e: EmployeeLean): string {
  return e.preferredName ?? `${e.firstName} ${e.lastName}`;
}

@Injectable()
export class HrPrivateService {
  constructor(
    @InjectModel(EmployeePrivate.name) private readonly privates: Model<EmployeePrivateDocument>,
    @InjectModel(AuditEvent.name) private readonly auditEvents: Model<AuditEventDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(HrPrivateNotifier) private readonly notifier: HrPrivateNotifier,
    @Inject(MASTER_KEYRING) private readonly keyring: MasterKeyring | null,
  ) {}

  async summary(organizationId: string, employeeId: string): Promise<EmployeePrivateSummary> {
    const doc = await this.privates
      .findOne({ organizationId, employeeId })
      .lean<EmployeePrivateLean>()
      .exec();
    return privateSummaryOf(employeeId, doc ?? null);
  }

  /**
   * Écrit (ou efface, `data: null`) une section. L'appelant a vérifié que le
   * collaborateur appartient à l'organisation et n'est pas anonymisé.
   */
  async write<F extends HrPrivateField>(
    organizationId: string,
    employee: EmployeeLean,
    field: F,
    data: HrPrivateSections[F] | null,
    expectedRevision: number,
    actor: HrPrivateActor,
  ): Promise<EmployeePrivateSummary> {
    const employeeId = String(employee._id);
    const keyring = this.requireKeyring();
    const current = await this.privates
      .findOne({ organizationId, employeeId })
      .lean<EmployeePrivateLean>()
      .exec();
    const revision = current?.revision ?? 0;
    if (revision !== expectedRevision) staleRevision(revision);

    const now = new Date();
    let next: PrivateFieldDoc | null = null;
    if (data !== null) {
      next = {
        cipher: encryptHrPrivate({
          organizationId,
          employeeId,
          field,
          value: data,
          keyring,
          updatedBy: actor.userId,
        }),
        masked: maskHrPrivate(organizationId, field, data, keyring),
        changedAt: now,
        changedBy: actor.userId,
      };
    }
    const set: Record<string, unknown> = { [field]: next, updatedBy: actor.userId };
    if (field === 'identity') {
      const identity = data as HrPrivateSections['identity'] | null;
      set['idExpiries'] = (identity?.idDocuments ?? [])
        .filter((d) => d.expiresOn)
        .map((d) => ({ kind: d.kind, expiresOn: d.expiresOn! }));
    }
    const bankChanged = field === 'bankDetails';
    if (bankChanged) {
      set['bankDetailsChangedAt'] = now;
      set['bankDetailsChangedBy'] = actor.userId;
    }
    const before = current?.[field]?.masked ?? null;

    await inHrTransaction(this.connection, async (session) => {
      if (current === null) {
        try {
          await this.privates.create(
            [
              {
                organizationId,
                employeeId,
                ...PRIVATE_FIELD_KEYS.reduce(
                  (acc, k) => ({ ...acc, [k]: null }),
                  {} as Record<string, null>,
                ),
                idExpiries: [],
                bankDetailsChangedAt: null,
                bankDetailsChangedBy: null,
                ...set,
                revision: 1,
                createdBy: actor.userId,
                _schemaVersion: 1,
              },
            ],
            { session },
          );
        } catch (err) {
          if (isDuplicateKey(err)) staleRevision(1);
          throw err;
        }
      } else {
        const res = await this.privates
          .updateOne(
            { _id: current._id, organizationId, revision: current.revision },
            { $set: set, $inc: { revision: 1 } },
            { session },
          )
          .exec();
        if (res.matchedCount !== 1) staleRevision(current.revision + 1);
      }
      await this.audit.recordStrict(
        {
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'hr.private.changed',
          targetType: 'employee',
          targetId: employeeId,
          metadata: {
            section: field,
            change: data === null ? 'cleared' : current?.[field] ? 'updated' : 'added',
            before: before as never,
            after: (next?.masked ?? null) as never,
          },
        },
        { session },
      );
    });

    if (bankChanged) {
      await this.notifier.bankDetailsChanged({
        organizationId,
        employeeId,
        employeeUserId: employee.userId ?? null,
        displayName: displayNameOf(employee),
        actorUserId: actor.userId,
      });
    }
    return this.summary(organizationId, employeeId);
  }

  /**
   * Le clair des sections demandées. L'appelant a décidé du droit (`hr.sensitive.read`
   * ou soi). Débit, puis audit strict, puis déchiffrement.
   */
  async reveal(
    organizationId: string,
    employeeId: string,
    fields: readonly HrPrivateField[],
    actor: HrPrivateActor & { self: boolean },
  ): Promise<EmployeePrivateRevealView> {
    const since = new Date(Date.now() - HOUR_MS);
    const recent = await this.auditEvents
      .countDocuments({
        actorUserId: actor.userId,
        action: 'hr.private.revealed',
        createdAt: { $gte: since },
      })
      .exec();
    if (recent >= HR_LIMITS.revealsPerHour) revealRateLimited(HR_LIMITS.revealsPerHour);

    const doc = await this.privates
      .findOne({ organizationId, employeeId })
      .lean<EmployeePrivateLean>()
      .exec();
    const present = fields.filter((f) => doc?.[f]);
    if (present.length > 0) this.requireKeyring();

    try {
      await this.audit.recordStrict({
        organizationId,
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'hr.private.revealed',
        targetType: 'employee',
        targetId: employeeId,
        // Les sections, jamais une valeur ni un masque.
        metadata: { sections: [...fields], self: actor.self },
      });
    } catch {
      auditUnavailable();
    }

    const sections: EmployeePrivateRevealView['sections'] = {};
    for (const field of fields) {
      const f = doc?.[field] ?? null;
      if (!f) {
        sections[field] = null;
        continue;
      }
      try {
        (sections as Record<string, unknown>)[field] = decryptHrPrivate({
          organizationId,
          employeeId,
          field,
          record: f.cipher as EncryptedValue,
          keyring: this.keyring!,
        });
      } catch {
        privateUnreadable();
      }
    }
    return { employeeId, revealedAt: new Date().toISOString(), sections };
  }

  /** Anonymisation (§ 3.1) : le dossier sensible est effacé, dans la transaction de l'appelant. */
  async erase(organizationId: string, employeeId: string, session: ClientSession): Promise<void> {
    await this.privates.deleteOne({ organizationId, employeeId }, { session }).exec();
  }

  private requireKeyring(): MasterKeyring {
    if (!this.keyring) secretsNotConfigured();
    return this.keyring;
  }
}
