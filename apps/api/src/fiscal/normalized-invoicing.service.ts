// Facture normalisée par organisation — ADR-0021 §3 (chantier B).
//
// SEUL ÉCRIVAIN de `normalized_invoicing_settings` (R4). Aucun autre code ne
// désactive la facture normalisée : ni l'expiration d'un jeton, ni une panne DGI,
// ni le retrait d'un point de vente. Un jeton expiré bloquera l'émission (S25f),
// il ne fera jamais repasser l'organisation en facturation ordinaire.
//
// Chaque transition est un `findOneAndUpdate` conditionné par l'état précédent
// (R6), DANS une transaction avec son événement d'audit strict : deux
// activations simultanées produisent un seul événement, et une écriture d'audit
// en échec annule la transition.

import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';

import { AuditService } from '../authz/audit.service.js';
import { MailService } from '../mail/mail.service.js';
import { Membership, type MembershipDocument } from '../organizations/membership.schema.js';
import { MembersService } from '../organizations/members.service.js';
import { Organization, type OrganizationDocument } from '../organizations/organization.schema.js';
import {
  DGI_PLATFORM_CONFIG,
  type DgiPlatformConfig,
  type EdefEnvironment,
} from '../platform-config/dgi-platform.config.js';
import { FiscalProfileService, type FiscalActor } from './fiscal-profile.service.js';
import { conflict, productionUnavailable } from './fiscal.errors.js';
import { inFiscalTransaction } from './fiscal-transaction.js';
import {
  NormalizedInvoicingSettings,
  type NormalizedInvoicingSettingsDocument,
} from './normalized-invoicing-settings.schema.js';
import { NormalizedInvoicingStateReader } from './normalized-invoicing-state.reader.js';
import { PointsOfSaleService, type PointOfSaleView } from './points-of-sale.service.js';

/** Prérequis manquants (R1), dans l'ordre du contrat. */
export type NormalizedInvoicingPrerequisite =
  | 'fiscal_profile'
  | 'country_cd'
  | 'active_point_of_sale'
  | 'production_unavailable'
  | 'nif_elsewhere';

export interface NormalizedInvoicingView {
  state: 'disabled' | 'enabled';
  environment: EdefEnvironment;
  firstActivatedAt: string | null;
  activatedAt: string | null;
  deactivatedAt: string | null;
  deactivationReason: string | null;
  prerequisites: {
    fiscalProfileComplete: boolean;
    countryIsCd: boolean;
    activePointOfSaleInEnvironment: boolean;
    productionAvailable: boolean;
    nifAvailable: boolean;
  };
  canActivate: boolean;
  pointsOfSale: PointOfSaleView[];
}

/** La transition visée n'a pas eu lieu : l'état était déjà en place (R6). */
class AlreadyInState extends Error {}

@Injectable()
export class NormalizedInvoicingService {
  private readonly logger = new Logger('NormalizedInvoicing');

  constructor(
    @InjectModel(NormalizedInvoicingSettings.name)
    private readonly model: Model<NormalizedInvoicingSettingsDocument>,
    @InjectModel(Organization.name) private readonly organizations: Model<OrganizationDocument>,
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(NormalizedInvoicingStateReader) private readonly state: NormalizedInvoicingStateReader,
    @Inject(FiscalProfileService) private readonly profiles: FiscalProfileService,
    @Inject(PointsOfSaleService) private readonly pointsOfSale: PointsOfSaleService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(MembersService) private readonly members: MembersService,
    @Inject(DGI_PLATFORM_CONFIG) private readonly config: DgiPlatformConfig,
  ) {}

  /**
   * Mode d'émission des factures (contrat des lots suivants, ADR-0021 §11) :
   * `'normalized'` si et seulement si la facture normalisée est activée.
   * `opts.session` : lecture dans la transaction de gel d'une facture
   * (ADR-0023 § S25e.6, étape 2).
   */
  async emissionModeOf(
    organizationId: string,
    opts: { session?: ClientSession } = {},
  ): Promise<'normalized' | 'standard'> {
    const settings = await this.state.read(organizationId, opts);
    return settings.state === 'enabled' ? 'normalized' : 'standard';
  }

  async view(organizationId: string): Promise<NormalizedInvoicingView> {
    const [settings, pointsOfSale] = await Promise.all([
      this.state.read(organizationId),
      this.pointsOfSale.list(organizationId),
    ]);
    const missing = await this.missingPrerequisites(
      organizationId,
      settings.environment,
      pointsOfSale,
    );
    return {
      state: settings.state,
      environment: settings.environment,
      firstActivatedAt: iso(settings.firstActivatedAt),
      activatedAt: iso(settings.activatedAt),
      deactivatedAt: iso(settings.deactivatedAt),
      deactivationReason: settings.deactivationReason,
      prerequisites: {
        fiscalProfileComplete: !missing.includes('fiscal_profile'),
        countryIsCd: !missing.includes('country_cd'),
        activePointOfSaleInEnvironment: !missing.includes('active_point_of_sale'),
        productionAvailable: this.config.productionEnabled,
        nifAvailable: !missing.includes('nif_elsewhere'),
      },
      canActivate: settings.state === 'disabled' && missing.length === 0,
      pointsOfSale,
    };
  }

  /** R1 — prérequis d'activation dans `environment`, tous vérifiés côté serveur. */
  async missingPrerequisites(
    organizationId: string,
    environment: EdefEnvironment,
    knownPointsOfSale?: PointOfSaleView[],
  ): Promise<NormalizedInvoicingPrerequisite[]> {
    const [profile, pointsOfSale] = await Promise.all([
      this.profiles.find(organizationId),
      knownPointsOfSale
        ? Promise.resolve(knownPointsOfSale)
        : this.pointsOfSale.list(organizationId),
    ]);
    const missing: NormalizedInvoicingPrerequisite[] = [];
    if (!profile) missing.push('fiscal_profile');
    if (profile?.headOffice.country !== 'CD') missing.push('country_cd');
    if (!pointsOfSale.some((p) => p.environment === environment && p.status === 'active')) {
      missing.push('active_point_of_sale');
    }
    if (environment === 'production' && !this.config.productionEnabled) {
      missing.push('production_unavailable');
    }
    if (profile) {
      // Décision ouverte n° 4 : un NIF, une seule organisation Lalanda activée par
      // environnement — une seule série de numérotation par contribuable.
      const others = await this.state.enabledOrganizationsIn(environment, organizationId);
      if ((await this.profiles.organizationsWithNif(profile.nif, others)) > 0) {
        missing.push('nif_elsewhere');
      }
    }
    return missing;
  }

  async activate(
    organizationId: string,
    environment: EdefEnvironment,
    actor: FiscalActor,
  ): Promise<NormalizedInvoicingView> {
    const current = await this.state.read(organizationId);
    if (current.state === 'enabled') {
      if (current.environment === environment) return this.view(organizationId);
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message:
          'La facture normalisée est déjà activée dans l’autre environnement : utilisez le ' +
          'changement d’environnement.',
      });
    }

    const pointsOfSale = await this.pointsOfSale.list(organizationId);
    const missing = await this.missingPrerequisites(organizationId, environment, pointsOfSale);
    if (missing.length > 0) {
      conflict(
        'NORMALIZED_INVOICING_PREREQUISITES',
        'La facture normalisée ne peut pas encore être activée : des prérequis manquent.',
        { missing },
      );
    }
    const actifs = pointsOfSale.filter(
      (p) => p.environment === environment && p.status === 'active',
    ).length;

    await this.ensureDocument(organizationId);
    const now = new Date();
    await this.transition(async (session) => {
      const updated = await this.model
        .findOneAndUpdate(
          { organizationId, state: 'disabled' },
          {
            $set: {
              state: 'enabled',
              environment,
              activatedAt: now,
              activatedBy: actor.userId,
            },
          },
          { session, new: true },
        )
        .exec();
      if (!updated) throw new AlreadyInState();
      // `firstActivatedAt` : posé à la PREMIÈRE activation, jamais remis à null.
      await this.model
        .updateOne(
          { organizationId, firstActivatedAt: null },
          { $set: { firstActivatedAt: now } },
          { session },
        )
        .exec();
      await this.audit.recordStrict(
        {
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'normalized_invoicing.enabled',
          targetType: 'organization',
          targetId: organizationId,
          metadata: { environment, pointsOfSale: actifs },
        },
        { session },
      );
    });
    return this.view(organizationId);
  }

  /** R3 — désactivation : possible, jamais silencieuse. */
  async deactivate(
    organizationId: string,
    reason: string,
    actor: FiscalActor & { name?: string | null },
  ): Promise<NormalizedInvoicingView> {
    const now = new Date();
    let environment: EdefEnvironment = 'test';
    const changed = await this.transition(async (session) => {
      const before = await this.model
        .findOneAndUpdate(
          { organizationId, state: 'enabled' },
          {
            $set: {
              state: 'disabled',
              deactivatedAt: now,
              deactivatedBy: actor.userId,
              deactivationReason: reason,
            },
          },
          { session, new: false },
        )
        .exec();
      if (!before) throw new AlreadyInState();
      environment = before.environment;
      await this.audit.recordStrict(
        {
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'normalized_invoicing.disabled',
          targetType: 'organization',
          targetId: organizationId,
          metadata: { environment, reason },
        },
        { session },
      );
    });
    if (changed) await this.notifyOwners(organizationId, now, reason, actor.name ?? null);
    return this.view(organizationId);
  }

  /** R5 — changement d'environnement. */
  async changeEnvironment(
    organizationId: string,
    target: EdefEnvironment,
    reason: string | null,
    actor: FiscalActor,
  ): Promise<NormalizedInvoicingView> {
    const current = await this.state.read(organizationId);
    if (current.environment === target) return this.view(organizationId);

    if (target === 'production' && !this.config.productionEnabled) productionUnavailable();

    if (current.state === 'disabled') {
      // Facture normalisée désactivée : changement libre, audit non bloquant.
      await this.ensureDocument(organizationId);
      const res = await this.model
        .updateOne(
          { organizationId, state: 'disabled', environment: current.environment },
          { $set: { environment: target } },
        )
        .exec();
      if (res.modifiedCount > 0) {
        await this.audit.record({
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'normalized_invoicing.environment_changed',
          targetType: 'organization',
          targetId: organizationId,
          metadata: { from: current.environment, to: target, reason },
        });
      }
      return this.view(organizationId);
    }

    // Activée : production → test exige un motif (les factures suivantes
    // n'auraient plus de valeur fiscale) ; test → production exige un point de
    // vente actif en production. Dans les deux cas : audit strict.
    if (target === 'test' && !reason) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message:
          'Un motif de 20 à 500 caractères est exigé pour quitter la production pendant ' +
          'l’activation de la facture normalisée.',
      });
    }
    const missing = (await this.missingPrerequisites(organizationId, target)).filter(
      (m) => m === 'active_point_of_sale' || m === 'production_unavailable',
    );
    if (missing.length > 0) {
      conflict(
        'NORMALIZED_INVOICING_PREREQUISITES',
        'Le changement d’environnement est impossible : des prérequis manquent.',
        { missing },
      );
    }
    await this.transition(async (session) => {
      const updated = await this.model
        .findOneAndUpdate(
          { organizationId, state: 'enabled', environment: current.environment },
          { $set: { environment: target } },
          { session, new: true },
        )
        .exec();
      if (!updated) throw new AlreadyInState();
      await this.audit.recordStrict(
        {
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'normalized_invoicing.environment_changed',
          targetType: 'organization',
          targetId: organizationId,
          metadata: { from: current.environment, to: target, reason },
        },
        { session },
      );
    });
    return this.view(organizationId);
  }

  // ── Internes ───────────────────────────────────────────────────────────────

  /**
   * Crée la fiche par défaut si elle n'existe pas (désactivée, test). Ce n'est
   * pas une transition : l'état décrit est celui qu'implique déjà l'absence de
   * document. Hors transaction, pour que la transition qui suit ne bute jamais
   * sur l'index unique `organizationId`.
   */
  private async ensureDocument(organizationId: string): Promise<void> {
    await this.model
      .updateOne(
        { organizationId },
        {
          $setOnInsert: {
            organizationId,
            state: 'disabled',
            environment: 'test',
            _schemaVersion: 1,
          },
        },
        { upsert: true },
      )
      .exec()
      .catch((err: unknown) => {
        if ((err as { code?: number }).code !== 11000) throw err;
      });
  }

  /** Exécute une transition ; `false` si l'état visé était déjà en place (R6). */
  private async transition(fn: (session: ClientSession) => Promise<void>): Promise<boolean> {
    try {
      await inFiscalTransaction(this.connection, fn);
      return true;
    } catch (err) {
      if (err instanceof AlreadyInState) return false;
      throw err;
    }
  }

  /**
   * Avertit chaque Propriétaire (décision n° 5). Un échec d'envoi est journalisé
   * et ne bloque pas la désactivation, déjà validée et tracée.
   */
  private async notifyOwners(
    organizationId: string,
    deactivatedAt: Date,
    reason: string,
    actorName: string | null,
  ): Promise<void> {
    try {
      const [org, owners] = await Promise.all([
        this.organizations.findById(organizationId, { name: 1 }).lean().exec(),
        this.memberships.find({ organizationId, role: 'owner' }, { userId: 1 }).lean().exec(),
      ]);
      const identities = await this.members.identitiesOf(owners.map((o) => o.userId));
      for (const owner of owners) {
        const email = identities.get(owner.userId)?.email;
        if (!email) continue;
        const res = await this.mail
          .sendNormalizedInvoicingDisabled({
            to: email,
            organizationName: org?.name ?? 'votre organisation',
            deactivatedAt,
            reason,
            actorName,
          })
          .catch(() => ({ delivered: false }));
        if (!res.delivered) {
          this.logger.warn(
            `Avertissement de désactivation non remis (organisation ${organizationId}).`,
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `Avertissement de désactivation impossible (organisation ${organizationId}) : ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

function iso(d: Date | null): string | null {
  return d ? new Date(d).toISOString() : null;
}
