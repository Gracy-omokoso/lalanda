// Alertes e-mail de la normalisation DGI (ADR-0024, décision ouverte n° 3,
// amendement du 21 oct. 2026).
//
// Destinataires : les ADMINISTRATEURS FISCAUX de l'organisation, c'est-à-dire
// les membres qui détiennent EFFECTIVEMENT `fiscal.manage` (ADR-0041 § 9.3-9.4,
// lot A3) : par titre (Propriétaire, Directeur financier — lus dans la matrice,
// jamais recopiés ici) sans retrait, ou par ajout. Interrupteur
// `MEMBER_PERMISSIONS_ENABLED` éteint : par titre seulement, comme avant.
//
// Causes :
//  - `normalization_uncertain` : une normalisation reste incertaine (phase
//    `uncertain` depuis `uncertainSince`, ou `needs_review`) au-delà de
//    `UNCERTAIN_ALERT_AFTER_MS` — une alerte par épisode ;
//  - `number_abandoned` : un numéro réservé n'a pas pu être rendu (trou tracé) ;
//  - `token_rejected` : la DGI a refusé le jeton d'un point de vente (401) —
//    au plus une par heure et par point de vente ;
//  - `token_expired` : le jeton d'un point de vente activé a expiré — une par
//    échéance.
//
// Dédoublonnage par l'index unique de `normalization_alerts`, posé AVANT
// l'envoi : deux instances, deux passages de la tâche ou deux échecs simultanés
// ne produisent qu'un message. Une alerte n'est jamais bloquante : `notify` ne
// lève pas, tout échec est journalisé (journal serveur et ligne de la
// collection).

import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';

import { holdersFilter } from '../../authz/authz.service.js';
import { MailService } from '../../mail/mail.service.js';
import type { NormalizationAlertCause } from '../../mail/mail.templates.js';
import { Membership, type MembershipDocument } from '../../organizations/membership.schema.js';
import { MembersService } from '../../organizations/members.service.js';
import {
  Organization,
  type OrganizationDocument,
} from '../../organizations/organization.schema.js';
import {
  NormalizationAlert,
  type NormalizationAlertDocument,
} from './normalization-alert.schema.js';

/** Une normalisation incertaine depuis 15 min déclenche l'alerte. */
export const UNCERTAIN_ALERT_AFTER_MS = 15 * 60_000;

export interface NormalizationAlertInput {
  organizationId: string;
  cause: NormalizationAlertCause;
  subject:
    | { type: 'sales_invoice'; id: string; label: string; number?: string | null }
    | { type: 'point_of_sale'; id: string; label: string };
  /** Instant qui date l'alerte. */
  since: Date;
  /** Fenêtre de dédoublonnage (voir `bucketOf`). */
  bucket: Date;
  now?: Date;
}

export type NormalizationAlertOutcome = 'sent' | 'duplicate' | 'no_recipient' | 'failed';

/** Heure pleine (UTC) d'un instant : fenêtre « une par heure ». */
export function hourOf(at: Date): Date {
  return new Date(Math.floor(at.getTime() / 3_600_000) * 3_600_000);
}

@Injectable()
export class NormalizationAlertsService {
  private readonly logger = new Logger('AlertesNormalisation');

  constructor(
    @InjectModel(NormalizationAlert.name)
    private readonly alerts: Model<NormalizationAlertDocument>,
    @InjectModel(Organization.name) private readonly organizations: Model<OrganizationDocument>,
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @Inject(MembersService) private readonly members: MembersService,
    @Inject(MailService) private readonly mail: MailService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /**
   * La DGI a refusé le jeton d'un point de vente (HTTP 401) : au plus une alerte
   * par heure et par point de vente. Appelé sans attendre par la normalisation
   * et le rattrapage (`void`) : ne lève jamais.
   */
  async tokenRejected(
    organizationId: string,
    pointOfSaleId: string,
    at: Date = new Date(),
  ): Promise<NormalizationAlertOutcome> {
    const label = await this.pointOfSaleLabel(organizationId, pointOfSaleId).catch(() => null);
    return this.notify({
      organizationId,
      cause: 'token_rejected',
      subject: { type: 'point_of_sale', id: pointOfSaleId, label: label ?? 'point de vente' },
      since: at,
      bucket: hourOf(at),
      now: at,
    });
  }

  private async pointOfSaleLabel(
    organizationId: string,
    pointOfSaleId: string,
  ): Promise<string | null> {
    if (!Types.ObjectId.isValid(pointOfSaleId)) return null;
    const pos = await this.connection
      .collection<{ _id: Types.ObjectId; organizationId: string; label: string }>(
        'emcf_points_of_sale',
      )
      .findOne(
        { _id: new Types.ObjectId(pointOfSaleId), organizationId },
        { projection: { label: 1 } },
      );
    return pos?.label ?? null;
  }

  /** Décide et envoie une alerte ; ne lève jamais. */
  async notify(input: NormalizationAlertInput): Promise<NormalizationAlertOutcome> {
    const tag = `${input.cause} ${input.subject.type} ${input.subject.id} (organisation ${input.organizationId})`;
    try {
      let row: NormalizationAlertDocument;
      try {
        row = await this.alerts.create({
          organizationId: input.organizationId,
          cause: input.cause,
          subjectType: input.subject.type,
          subjectId: input.subject.id,
          bucket: input.bucket,
          since: input.since,
          at: input.now ?? new Date(),
          recipients: 0,
          delivered: 0,
          _schemaVersion: 1,
        });
      } catch (err) {
        if ((err as { code?: number }).code === 11000) return 'duplicate';
        throw err;
      }

      const [org, admins] = await Promise.all([
        this.organizations.findById(input.organizationId, { name: 1 }).lean().exec(),
        this.memberships
          // Détenteurs effectifs de `fiscal.manage` (même filtre que `AuthzService.holdersOf`).
          .find(holdersFilter(input.organizationId, 'fiscal.manage'), { userId: 1 })
          .lean()
          .exec(),
      ]);
      const identities = await this.members.identitiesOf(admins.map((m) => m.userId));
      const emails = [
        ...new Set(
          admins
            .map((m) => identities.get(m.userId)?.email ?? null)
            .filter((e): e is string => typeof e === 'string' && e !== ''),
        ),
      ];
      if (emails.length === 0) {
        this.logger.warn(`Alerte ${tag} : aucun administrateur fiscal joignable.`);
        return 'no_recipient';
      }

      let delivered = 0;
      for (const to of emails) {
        const res = await this.mail
          .sendNormalizationAlert({
            to,
            cause: input.cause,
            organizationName: org?.name ?? 'votre organisation',
            subjectLabel: input.subject.label,
            since: input.since,
            invoiceId: input.subject.type === 'sales_invoice' ? input.subject.id : null,
            number: input.subject.type === 'sales_invoice' ? (input.subject.number ?? null) : null,
          })
          .catch(() => ({ delivered: false }));
        if (res.delivered) delivered += 1;
      }
      await this.alerts
        .updateOne({ _id: row._id }, { $set: { recipients: emails.length, delivered } })
        .exec();
      const line = `Alerte ${tag} : ${delivered}/${emails.length} message(s) remis.`;
      if (delivered === emails.length) this.logger.log(line);
      else this.logger.warn(line);
      return 'sent';
    } catch (err) {
      this.logger.error(
        `Alerte ${tag} impossible : ${err instanceof Error ? err.message : String(err)}`,
      );
      return 'failed';
    }
  }
}
