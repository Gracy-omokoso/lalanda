// E-mail quotidien du brief du matin (ADR-0033 § 8).
//
// Tâche récurrente `morning-brief.daily-email`, toutes les 15 minutes. À partir
// de 7 h à Kinshasa, chaque abonnement actif non encore servi ce jour est
// RÉCLAMÉ atomiquement (`lastSentOn` posé avant l'envoi), puis servi.
//
// « Au plus une fois par jour », pas « au moins une fois » : un e-mail en double
// chaque matin agace plus qu'un e-mail perdu un jour de panne, et c'est la
// politique de tous les e-mails du produit (docs/17 : pas de reprise sur échec
// d'envoi). L'ordonnanceur peut rejouer la tâche ; la réclamation la rend
// idempotente.
//
// Avant chaque envoi, le droit est RE-VÉRIFIÉ : un ancien membre, un rôle qui a
// perdu `analytics.read`, une organisation suspendue ne reçoivent rien. Le bloc
// ventes suit `sales.read`, exactement comme à l'écran.

import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { formatFr, type BriefFact, type MorningBrief } from '@lalanda/engine';

import { OrganizationSuspension } from '../admin/organization-suspension.schema.js';
import { can, normalizeOrgRole } from '../authz/permissions.js';
import { MailService } from '../mail/mail.service.js';
import { MembersService } from '../organizations/members.service.js';
import { Membership, type MembershipDocument } from '../organizations/membership.schema.js';
import { Organization, type OrganizationDocument } from '../organizations/organization.schema.js';
import { SchedulerService } from '../scheduler/scheduler.service.js';
import { MorningBriefService, kinshasaClock } from './morning-brief.service.js';
import {
  MorningBriefSubscription,
  type MorningBriefSubscriptionDocument,
} from './morning-brief.schemas.js';

export const DAILY_EMAIL_JOB = 'morning-brief.daily-email';
export const DAILY_EMAIL_EVERY_MS = 15 * 60_000;
/** Heure d'envoi à Kinshasa (ADR-0033, décision ouverte n° 2). */
export const DAILY_EMAIL_HOUR = 7;
/** Envois au plus par passage. */
export const DAILY_EMAIL_BATCH = 200;

export interface DailyEmailReport {
  claimed: number;
  sent: number;
  skipped: number;
  failed: number;
}

/** Ligne de fait affichée dans l'e-mail. */
export function factLine(f: BriefFact): string {
  if (f.status === 'to_fill') return `${f.label} : à renseigner`;
  if (f.status === 'unavailable') return `${f.label} : non disponible`;
  if (f.status === 'hidden' || f.value === null) return `${f.label} : masqué pour votre rôle`;
  return f.kind === 'amount'
    ? `${f.label} : ${formatFr(f.value)} ${f.currency ?? ''}`.trim()
    : `${f.label} : ${f.value}`;
}

/** Faits retenus pour l'e-mail : l'essentiel du brief § 8, pas le détail. */
const EMAIL_FACTS = [
  'ca_mois.CDF',
  'ca_mois.USD',
  'tresorerie',
  'tresorerie.CDF',
  'tresorerie.USD',
  'creances.CDF',
  'creances.USD',
  'normalisation.echec',
  'normalisation.a_verifier',
  'echeances.depassees',
];

export function emailContent(
  brief: MorningBrief,
  organizationName: string,
): {
  organizationName: string;
  dateLabel: string;
  facts: string[];
  alerts: string[];
  recommendations: string[];
} {
  const { year, month, day } = brief.period;
  const dateLabel = new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'full',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
  return {
    organizationName,
    dateLabel,
    facts: EMAIL_FACTS.map((id) => brief.facts.find((f) => f.id === id))
      .filter((f): f is BriefFact => f !== undefined)
      // Un montant nul dans une devise inutilisée n'apprend rien.
      .filter((f) => !(f.kind === 'amount' && f.value !== null && /^-?0+(\.0+)?$/.test(f.value)))
      .map(factLine),
    alerts: brief.alerts.map((a) => `${a.title} — ${a.message}`),
    recommendations: brief.recommendations.map((r) => r.recommendation),
  };
}

@Injectable()
export class MorningBriefEmailJob implements OnModuleInit {
  private readonly logger = new Logger('BriefDuMatin');

  constructor(
    @InjectModel(MorningBriefSubscription.name)
    private readonly subscriptions: Model<MorningBriefSubscriptionDocument>,
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @InjectModel(Organization.name) private readonly organizations: Model<OrganizationDocument>,
    @InjectModel(OrganizationSuspension.name)
    private readonly suspensions: Model<OrganizationSuspension>,
    @Inject(MorningBriefService) private readonly briefs: MorningBriefService,
    @Inject(MembersService) private readonly members: MembersService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(SchedulerService) private readonly scheduler: SchedulerService,
  ) {}

  onModuleInit(): void {
    this.scheduler.every(DAILY_EMAIL_JOB, DAILY_EMAIL_EVERY_MS, async (_payload, ctx) => {
      await this.run(ctx.now);
    });
  }

  async run(now: Date = new Date()): Promise<DailyEmailReport> {
    const report: DailyEmailReport = { claimed: 0, sent: 0, skipped: 0, failed: 0 };
    const { day, hour } = kinshasaClock(now);
    if (hour < DAILY_EMAIL_HOUR) return report;

    while (report.claimed < DAILY_EMAIL_BATCH) {
      const sub = await this.subscriptions
        .findOneAndUpdate(
          { emailDaily: true, lastSentOn: { $ne: day } },
          { $set: { lastSentOn: day } },
          { new: true },
        )
        .lean()
        .exec();
      if (!sub) break;
      report.claimed += 1;
      try {
        const outcome = await this.serve(sub.organizationId, sub.userId, now);
        report[outcome] += 1;
      } catch (err) {
        report.failed += 1;
        this.logger.warn(
          `Brief du matin non envoyé (organisation ${sub.organizationId}) : ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    if (report.claimed > 0) {
      this.logger.log(
        `Brief du matin ${day} : ${report.sent} envoyé(s), ${report.skipped} ignoré(s), ${report.failed} en échec.`,
      );
    }
    return report;
  }

  private async serve(
    organizationId: string,
    userId: string,
    now: Date,
  ): Promise<'sent' | 'skipped' | 'failed'> {
    const [membership, suspended, org] = await Promise.all([
      this.memberships.findOne({ organizationId, userId }, { role: 1 }).lean().exec(),
      this.suspensions.exists({ organizationId, liftedAt: null }).exec(),
      this.organizations.findById(organizationId, { name: 1 }).lean().exec(),
    ]);
    const role = normalizeOrgRole(membership?.role);
    if (!membership || !role || !can(role, 'analytics.read') || suspended || !org) {
      return 'skipped';
    }
    const email = (await this.members.identitiesOf([userId])).get(userId)?.email;
    if (!email) return 'skipped';

    const brief = await this.briefs.build(organizationId, role, now);
    const res = await this.mail.sendMorningBrief({ to: email, ...emailContent(brief, org.name) });
    return res.delivered ? 'sent' : 'failed';
  }
}
