// Statut de complétude de la mise en route (ADR-0052 § 3, option O1-b). ADR-0052 — O0.
//
// LECTURE des autres modules : aucun document n'est créé « au premier accès » chez eux
// (ADR-0052 — O2 : la seule collection ÉCRITE ici est `organization_setup`, les
// déclarations de § 4, par les méthodes `confirmCountry`, `defer`, `undefer`,
// `setModules`) : `AccountingSettingsService.ensure`
// n'est PAS appelé (il crée le document de réglages) — sans document, ce sont les
// défauts d'ADR-0049, exactement ce que `activate` lirait (critère 9 : une organisation
// neuve reste vide).
//
// Les `missing[]` des actes viennent des fonctions qui gardent ces actes :
//   émettre      → `FiscalProfileService.find` (verrou `FISCAL_PROFILE_REQUIRED`) ;
//   normaliser   → `NormalizedInvoicingService.missingPrerequisites` (R1) ;
//   comptabilité → `AccountingSettingsService.activationMissing` (§ 3.1).
// Toutes les lectures sont filtrées par l'organisation de la session.

import { ACCOUNTING_SETTINGS_DEFAULTS } from '@lalanda/shared/accounting';
import {
  isDeferrableStep,
  normalizeSetupModules,
  type OrganizationSetupDeferrableStep,
  type OrganizationSetupModuleId,
  type OrganizationSetupView,
} from '@lalanda/shared/organization-setup';
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import type { AccountingSettingsLean } from '../accounting/settings/accounting-settings.schema.js';
import { AccountingSettings } from '../accounting/settings/accounting-settings.schema.js';
import { AccountingSettingsService } from '../accounting/settings/accounting-settings.service.js';
import { BrandingService } from '../branding/branding.service.js';
import { FiscalProfileService } from '../fiscal/fiscal-profile.service.js';
import { NormalizedInvoicingStateReader } from '../fiscal/normalized-invoicing-state.reader.js';
import { NormalizedInvoicingService } from '../fiscal/normalized-invoicing.service.js';
import { OrganizationSettings } from '../organization-space/organization-settings.schema.js';
import { Invitation } from '../organizations/invitation.schema.js';
import { Membership } from '../organizations/membership.schema.js';
import { AuditService } from '../authz/audit.service.js';
import type { Action } from '../authz/permissions.js';
import { TreasuryAccount } from '../treasury/treasury.schemas.js';
import {
  buildOrganizationSetupView,
  doneSteps,
  type OrganizationSetupFacts,
} from './organization-setup.model.js';
import { OrganizationSetup, type OrganizationSetupLean } from './organization-setup.schema.js';

/** Auteur d'une déclaration (journal d'audit). */
export interface SetupActor {
  userId: string;
  role: string;
}

@Injectable()
export class OrganizationSetupService {
  constructor(
    @Inject(FiscalProfileService) private readonly fiscal: FiscalProfileService,
    @Inject(NormalizedInvoicingStateReader)
    private readonly normalizedState: NormalizedInvoicingStateReader,
    @Inject(NormalizedInvoicingService) private readonly normalized: NormalizedInvoicingService,
    @Inject(AccountingSettingsService) private readonly accounting: AccountingSettingsService,
    @Inject(BrandingService) private readonly branding: BrandingService,
    @InjectModel(AccountingSettings.name)
    private readonly accountingSettings: Model<AccountingSettingsLean>,
    @InjectModel(OrganizationSettings.name) private readonly orgSettings: Model<unknown>,
    @InjectModel(TreasuryAccount.name) private readonly treasuryAccounts: Model<unknown>,
    @InjectModel(Invitation.name) private readonly invitations: Model<unknown>,
    @InjectModel(Membership.name) private readonly memberships: Model<unknown>,
    @InjectModel(OrganizationSetup.name) private readonly setups: Model<OrganizationSetup>,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async view(organizationId: string, actions: readonly Action[]): Promise<OrganizationSetupView> {
    const facts = await this.facts(organizationId);
    // § 4 : « retiré dès que l'étape devient `done` ». Nettoyage idempotent, borné à
    // l'organisation de la session ; la vue ignore déjà un report d'étape faite.
    const stale = doneSteps(facts, facts.deferred ?? []);
    if (stale.length > 0) {
      await this.setups
        .updateOne(
          { organizationId },
          { $unset: Object.fromEntries(stale.map((id) => [`deferred.${id}`, ''])) },
        )
        .exec();
    }
    return buildOrganizationSetupView(organizationId, facts, actions);
  }

  // ── Déclarations (ADR-0052 § 4) ────────────────────────────────────────────

  /** Étape 1 : le pays de l'organisation est confirmé (`organization.manage`). */
  async confirmCountry(organizationId: string, actor: SetupActor): Promise<void> {
    const now = new Date();
    await this.upsert(organizationId, {
      $set: { countryConfirmedAt: now, countryConfirmedBy: actor.userId, updatedBy: actor.userId },
    });
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'organization_setup.country_confirmed',
      targetType: 'organization_setup',
      targetId: organizationId,
    });
  }

  /**
   * « Pas maintenant » (ou « je travaille seul ») : refusé pour une étape déjà faite —
   * il serait aussitôt retiré (§ 4), et le dire « reportée » serait faux.
   */
  async defer(
    organizationId: string,
    step: OrganizationSetupDeferrableStep,
    actor: SetupActor,
  ): Promise<void> {
    const facts = await this.facts(organizationId);
    if (doneSteps(facts, [step]).length > 0) {
      throw new ConflictException({
        code: 'SETUP_STEP_ALREADY_DONE',
        message: 'Cette étape est déjà faite : il n’y a rien à reporter.',
      });
    }
    await this.upsert(organizationId, {
      $set: { [`deferred.${step}`]: { at: new Date(), by: actor.userId }, updatedBy: actor.userId },
    });
    await this.recordDeferred(organizationId, step, true, actor);
  }

  /** Retire un « pas maintenant » : l'étape redevient « à faire ». Idempotent. */
  async undefer(
    organizationId: string,
    step: OrganizationSetupDeferrableStep,
    actor: SetupActor,
  ): Promise<void> {
    const res = await this.setups
      .updateOne(
        { organizationId, [`deferred.${step}`]: { $exists: true } },
        { $unset: { [`deferred.${step}`]: '' }, $set: { updatedBy: actor.userId } },
      )
      .exec();
    if (res.modifiedCount > 0) await this.recordDeferred(organizationId, step, false, actor);
  }

  /** Choix des modules de l'organisation (tranche ADR-0030 D3) ; `null` = tous. */
  async setModules(
    organizationId: string,
    modules: readonly OrganizationSetupModuleId[] | null,
    actor: SetupActor,
  ): Promise<void> {
    const after = normalizeSetupModules(modules);
    const before = await this.setups
      .findOne({ organizationId }, { modules: 1, modulesChosenAt: 1 })
      .lean<OrganizationSetupLean>()
      .exec();
    await this.upsert(organizationId, {
      $set: { modules: after, modulesChosenAt: new Date(), updatedBy: actor.userId },
    });
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'organization_setup.modules_changed',
      targetType: 'organization_setup',
      targetId: organizationId,
      metadata: {
        before: before?.modulesChosenAt ? (before.modules ?? 'all') : null,
        after: after ?? 'all',
      },
    });
  }

  private async recordDeferred(
    organizationId: string,
    step: OrganizationSetupDeferrableStep,
    deferred: boolean,
    actor: SetupActor,
  ): Promise<void> {
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'organization_setup.deferred',
      targetType: 'organization_setup',
      targetId: organizationId,
      metadata: { step, deferred },
    });
  }

  /** Crée le document à la première déclaration ; une course sur l'index unique est rejouée. */
  private async upsert(organizationId: string, update: Record<string, unknown>): Promise<void> {
    const run = () =>
      this.setups
        .updateOne({ organizationId }, update, { upsert: true, setDefaultsOnInsert: true })
        .exec();
    try {
      await run();
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
      await run();
    }
  }

  async facts(organizationId: string): Promise<OrganizationSetupFacts> {
    const [
      profile,
      normalizedState,
      accounting,
      brand,
      displayCurrency,
      treasuryAccount,
      invitation,
      members,
      declared,
    ] = await Promise.all([
      this.fiscal.find(organizationId),
      this.normalizedState.read(organizationId),
      this.accountingSettingsOf(organizationId),
      this.branding.state(organizationId),
      this.orgSettings.exists({ organizationId }).exec(),
      this.treasuryAccounts.exists({ organizationId, active: true }).exec(),
      this.invitations.exists({ organizationId }).exec(),
      this.memberships.countDocuments({ organizationId }, { limit: 2 }).exec(),
      this.setups.findOne({ organizationId }).lean<OrganizationSetupLean>().exec(),
    ]);
    const [normalizeMissing, accountingMissing] = await Promise.all([
      // Même appel, même environnement que `activate` : la liste est celle du 409 (critère 4).
      this.normalized.missingPrerequisites(organizationId, normalizedState.environment),
      accounting.mode === 'active' ? [] : this.accounting.activationMissing(accounting),
    ]);
    return {
      // ADR-0052 — O2 : déclarations de § 4 (`organization_setup`).
      countryConfirmed: Boolean(declared?.countryConfirmedAt),
      fiscalProfile: profile !== null,
      displayCurrencySaved: displayCurrency !== null,
      brandIdentity: brand.logos.primary !== null || brand.primaryColor !== null,
      normalizedInvoicingEnabled: normalizedState.state === 'enabled',
      normalizeMissing,
      treasuryAccount: treasuryAccount !== null,
      accountingMode: accounting.mode,
      accountingMissing,
      teamStarted: invitation !== null || members > 1,
      // ADR-0052 — O3 : choix de modules côté serveur (ADR-0030 D3).
      modulesChosen: Boolean(declared?.modulesChosenAt),
      modules: declared?.modulesChosenAt ? (declared.modules ?? null) : null,
      deferred: Object.keys(declared?.deferred ?? {}).filter(isDeferrableStep),
    };
  }

  /**
   * Réglages comptables SANS les créer : le document s'il existe, sinon les défauts que
   * `ensure` poserait (mode `off`, aucune monnaie, aucune bascule, aucun pack).
   */
  private async accountingSettingsOf(organizationId: string): Promise<AccountingSettingsLean> {
    const found = await this.accountingSettings
      .findOne({ organizationId })
      .lean<AccountingSettingsLean>()
      .exec();
    if (found) return found;
    return {
      organizationId,
      ...ACCOUNTING_SETTINGS_DEFAULTS,
      chartPack: null,
      ruleSetVersion: null,
      activatedAt: null,
      activatedBy: null,
    } as AccountingSettingsLean;
  }
}
