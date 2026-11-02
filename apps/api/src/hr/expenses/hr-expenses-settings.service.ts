// Réglages `hr_settings.expenses` et `hr_settings.advances` (ADR-0051 § 2.7). ADR-0051 — H10.
//
// Même document que les réglages RH d'ADR-0045 (`hr_settings`, schéma souple), même
// révision : chaque champ est relu et VÉRIFIÉ, une valeur absente ou hors contrat retombe
// sur son défaut (le plus prudent) :
//   - `expenses` : ouvertes, circuit `manager_then_finance`, justificatif exigé (un motif
//     sinon, AUCUN seuil de montant) ;
//   - `advances` : avance de frais ouverte, avance SUR SALAIRE ÉTEINTE, AUCUN plafond,
//     régularisation déclarée sur la paie ÉTEINTE (J1, décisions ouvertes n° 4 et 5) ;
//   - `retention.expenseReceiptsYears` : `null`, aucune purge (J4, C5).
// Écriture : `expenses.*` par `hr.manage` (le circuit exige en plus `expenses.approve`),
// `advances.*` par `hr.manage` ET `expenses.approve` (changer qui valide exige d'être
// soi-même validateur). Audit `hr.settings.updated` (champs, avant, après — aucun montant
// de plafond n'est un secret, il est journalisé comme valeur de réglage).

import {
  EXPENSE_APPROVAL_FLOWS,
  HR_ADVANCES_SETTINGS_DEFAULTS,
  HR_CURRENCIES,
  HR_EXPENSES_SETTINGS_DEFAULTS,
  HR_SETTINGS_DEFAULTS,
  canonicalHrAmount,
  type HrAdvancesSettingsView,
  type HrCurrency,
  type HrExpensesAdvancesSettingsView,
  type HrExpensesSettingsView,
  type UpdateHrAdvancesSettingsBody,
  type UpdateHrExpensesSettingsBody,
} from '@lalanda/shared/hr';
import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { AuditService, type AuditMetadataValue } from '../../authz/audit.service.js';
import { isDuplicateKey, staleRevision } from '../../sales/sales.errors.js';
import type { HrActor } from '../departments/hr-departments.service.js';
import { HrSettings, type HrSettingsDocument } from '../settings/hr-settings.schema.js';

const E = HR_EXPENSES_SETTINGS_DEFAULTS;
const A = HR_ADVANCES_SETTINGS_DEFAULTS;

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

function amountOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const c = canonicalHrAmount(v);
  return c === null || c === '0.00' ? null : c;
}

/** Réglages lus d'un document `hr_settings` brut (ou `null`). */
export function expensesSettingsOf(doc: Record<string, unknown> | null): {
  expenses: HrExpensesSettingsView;
  advances: HrAdvancesSettingsView;
  allowSoleApprover: boolean;
  revision: number;
} {
  const raw = doc ?? {};
  const e = (raw['expenses'] ?? {}) as Record<string, unknown>;
  const a = (raw['advances'] ?? {}) as Record<string, unknown>;
  const enabled = (a['enabled'] ?? {}) as Record<string, unknown>;
  const max = (a['maxAmount'] ?? {}) as Record<string, unknown>;
  const retention = (raw['retention'] ?? {}) as Record<string, unknown>;
  const years = retention['expenseReceiptsYears'];
  return {
    expenses: {
      enabled: bool(e['enabled'], E.enabled),
      approvalFlow:
        typeof e['approvalFlow'] === 'string' &&
        (EXPENSE_APPROVAL_FLOWS as readonly string[]).includes(e['approvalFlow'])
          ? (e['approvalFlow'] as HrExpensesSettingsView['approvalFlow'])
          : E.approvalFlow,
      receiptRequired: bool(e['receiptRequired'], E.receiptRequired),
      receiptsRetentionYears:
        typeof years === 'number' && Number.isInteger(years) && years >= 1 && years <= 50
          ? years
          : null,
    },
    advances: {
      enabled: {
        expenses: bool(enabled['expenses'], A.enabled.expenses),
        salary: bool(enabled['salary'], A.enabled.salary),
      },
      maxAmount: Object.fromEntries(HR_CURRENCIES.map((c) => [c, amountOrNull(max[c])])) as Record<
        HrCurrency,
        string | null
      >,
      allowDeclaredPayrollSettlement: bool(
        a['allowDeclaredPayrollSettlement'],
        A.allowDeclaredPayrollSettlement,
      ),
    },
    allowSoleApprover: bool(raw['allowSoleApprover'], HR_SETTINGS_DEFAULTS.allowSoleApprover),
    revision: typeof raw['revision'] === 'number' ? raw['revision'] : 0,
  };
}

export type HrExpensesSettings = ReturnType<typeof expensesSettingsOf>;

@Injectable()
export class HrExpensesSettingsService {
  constructor(
    @InjectModel(HrSettings.name) private readonly settings: Model<HrSettingsDocument>,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async of(organizationId: string): Promise<HrExpensesSettings> {
    const doc = await this.settings
      .findOne({ organizationId })
      .lean<Record<string, unknown>>()
      .exec();
    return expensesSettingsOf(doc ?? null);
  }

  async view(organizationId: string): Promise<HrExpensesAdvancesSettingsView> {
    const s = await this.of(organizationId);
    return { expenses: s.expenses, advances: s.advances, revision: s.revision };
  }

  /** `PUT /hr/settings/expenses` — le droit sur le circuit est vérifié par l'appelant. */
  async updateExpenses(
    organizationId: string,
    body: UpdateHrExpensesSettingsBody,
    actor: HrActor,
  ): Promise<HrExpensesAdvancesSettingsView> {
    const { expectedRevision, ...patch } = body;
    const set: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) set[`expenses.${k}`] = v;
    return this.write(organizationId, expectedRevision, set, actor);
  }

  /** `PUT /hr/settings/advances`. */
  async updateAdvances(
    organizationId: string,
    body: UpdateHrAdvancesSettingsBody,
    actor: HrActor,
  ): Promise<HrExpensesAdvancesSettingsView> {
    const { expectedRevision, ...patch } = body;
    const set: Record<string, unknown> = {};
    if (patch.enabled) set['advances.enabled'] = patch.enabled;
    if (patch.maxAmount) set['advances.maxAmount'] = patch.maxAmount;
    if (patch.allowDeclaredPayrollSettlement !== undefined) {
      set['advances.allowDeclaredPayrollSettlement'] = patch.allowDeclaredPayrollSettlement;
    }
    return this.write(organizationId, expectedRevision, set, actor);
  }

  private async write(
    organizationId: string,
    expectedRevision: number,
    set: Record<string, unknown>,
    actor: HrActor,
  ): Promise<HrExpensesAdvancesSettingsView> {
    const before = await this.of(organizationId);
    if (before.revision !== expectedRevision) staleRevision(before.revision);
    if (Object.keys(set).length === 0) return this.view(organizationId);
    if (before.revision === 0) {
      // Aucun document : il naît ici, sous l'index unique de l'organisation.
      const nested: Record<string, Record<string, unknown>> = {};
      for (const [path, v] of Object.entries(set)) {
        const [head, field] = path.split('.') as [string, string];
        nested[head] = { ...(nested[head] ?? {}), [field]: v };
      }
      try {
        await this.settings.create({
          organizationId,
          ...nested,
          revision: 1,
          createdBy: actor.userId,
          updatedBy: actor.userId,
          _schemaVersion: 1,
        });
      } catch (err) {
        if (isDuplicateKey(err)) staleRevision((await this.of(organizationId)).revision);
        throw err;
      }
    } else {
      const res = await this.settings
        .updateOne(
          { organizationId, revision: before.revision },
          { $set: { ...set, updatedBy: actor.userId }, $inc: { revision: 1 } },
        )
        .exec();
      if (res.matchedCount !== 1) staleRevision((await this.of(organizationId)).revision);
    }
    const after = await this.of(organizationId);
    const keys = Object.keys(set).sort();
    const pick = (s: HrExpensesSettings) =>
      Object.fromEntries(
        keys.map((k) => {
          const [head, field] = k.split('.') as ['expenses' | 'advances', string];
          return [k, (s[head] as unknown as Record<string, unknown>)[field] ?? null];
        }),
      );
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.settings.updated',
      targetType: 'hr_settings',
      targetId: organizationId,
      metadata: {
        fields: keys,
        before: JSON.parse(JSON.stringify(pick(before))) as AuditMetadataValue,
        after: JSON.parse(JSON.stringify(pick(after))) as AuditMetadataValue,
      },
    });
    return { expenses: after.expenses, advances: after.advances, revision: after.revision };
  }
}
