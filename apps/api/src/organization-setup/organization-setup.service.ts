// Statut de complétude de la mise en route (ADR-0052 § 3, option O1-b). ADR-0052 — O0.
//
// LECTURE SEULE. Aucune collection n'est créée ni écrite ici, et aucun document n'est
// créé « au premier accès » chez les autres modules : `AccountingSettingsService.ensure`
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
import type { OrganizationSetupView } from '@lalanda/shared/organization-setup';
import { Inject, Injectable } from '@nestjs/common';
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
import type { Action } from '../authz/permissions.js';
import { TreasuryAccount } from '../treasury/treasury.schemas.js';
import {
  buildOrganizationSetupView,
  type OrganizationSetupFacts,
} from './organization-setup.model.js';

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
  ) {}

  async view(organizationId: string, actions: readonly Action[]): Promise<OrganizationSetupView> {
    return buildOrganizationSetupView(organizationId, await this.facts(organizationId), actions);
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
    ] = await Promise.all([
      this.fiscal.find(organizationId),
      this.normalizedState.read(organizationId),
      this.accountingSettingsOf(organizationId),
      this.branding.state(organizationId),
      this.orgSettings.exists({ organizationId }).exec(),
      this.treasuryAccounts.exists({ organizationId, active: true }).exec(),
      this.invitations.exists({ organizationId }).exec(),
      this.memberships.countDocuments({ organizationId }, { limit: 2 }).exec(),
    ]);
    const [normalizeMissing, accountingMissing] = await Promise.all([
      // Même appel, même environnement que `activate` : la liste est celle du 409 (critère 4).
      this.normalized.missingPrerequisites(organizationId, normalizedState.environment),
      accounting.mode === 'active' ? [] : this.accounting.activationMissing(accounting),
    ]);
    return {
      // Aucune déclaration n'est mémorisée en O0 (§ 4) : le pays n'est jamais « confirmé ».
      countryConfirmed: false,
      fiscalProfile: profile !== null,
      displayCurrencySaved: displayCurrency !== null,
      brandIdentity: brand.logos.primary !== null || brand.primaryColor !== null,
      normalizedInvoicingEnabled: normalizedState.state === 'enabled',
      normalizeMissing,
      treasuryAccount: treasuryAccount !== null,
      accountingMode: accounting.mode,
      accountingMissing,
      teamStarted: invitation !== null || members > 1,
      // Choix de modules côté serveur : lot O3 (ADR-0030 D3).
      modulesChosen: false,
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
