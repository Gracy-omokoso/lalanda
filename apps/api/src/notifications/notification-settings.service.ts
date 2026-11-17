// Réglages de notification — ADR-0079 § 4.
//
// Lus par le répartiteur à CHAQUE émission (mode, surcharges, obligations, heures
// calmes), écrits par la personne pour elle-même (`PUT /notifications/settings`) ou par
// l'administrateur pour l'organisation (`PUT /notifications/organization-settings`).
//
// ── Conversion des préférences ADR-0061 (§ 4.3) ──────────────────────────────
//
// Paresseuse, rejouable, sans perte : à la première lecture d'une personne qui n'a pas
// encore de réglages mais avait ENREGISTRÉ ses cases des Projets (`revision ≥ 1`), un
// document `notification_settings` est créé : mode `null` (défaut de l'organisation) et,
// dans CHACUN des trois modes, les surcharges minimales qui reproduisent exactement ses
// cases pour les douze événements d'alors. Quel que soit le mode appliqué, ces douze
// événements donnent donc le même résultat qu'avant. L'ancien document n'est ni modifié
// ni supprimé (le résumé quotidien continue d'y vivre). Un double appel concurrent
// bute sur l'index unique : le second relit.

import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_MODES,
  NOTIFICATION_SETTINGS_LIMITS,
  isModeCustomized,
  notificationSpecOf,
  overridesFor,
  type MandatoryNotification,
  type NotificationChannelOverride,
  type NotificationKind,
  type NotificationMode,
  type NotificationModeOverrides,
  type NotificationOrgSettingsView,
  type NotificationSettingsView,
  type PutNotificationOrgSettingsBody,
  type PutNotificationSettingsBody,
  type QuietHours,
} from '@lalanda/shared/notifications';
import { WORK_NOTIFICATION_EVENTS, resolveWorkNotificationPreferences } from '@lalanda/shared/work';
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';

import { ORG_ROLES } from '../authz/permissions.js';
import { Membership, type MembershipDocument } from '../organizations/membership.schema.js';
import {
  NotificationPreferences,
  type NotificationPreferencesDocument,
} from './notification.schemas.js';
import {
  NotificationOrgSettingsDoc,
  NotificationSettingsDoc,
  decodeKind,
  encodeKind,
  type NotificationOrgSettingsDocument,
  type NotificationOrgSettingsLean,
  type NotificationSettingsDocument,
  type NotificationSettingsLean,
  type StoredOverrides,
} from './notification-settings.schemas.js';

/** Collection des préférences ADR-0061 (module `work`), lue en lecture seule. */
export const LEGACY_WORK_PREFERENCES = 'work_notification_preferences';

/** Réglages résolus d'une personne (ce que le répartiteur applique). */
export interface ResolvedNotificationSettings {
  mode: NotificationMode | null;
  overrides: Record<NotificationMode, NotificationModeOverrides>;
  notifyOwnActions: boolean;
  quietHours: QuietHours;
  mutedKinds: NotificationKind[];
  role: string | null;
  migratedFrom: 'adr-0061' | null;
  revision: number;
}

export interface ResolvedOrgSettings {
  projectLeadMode: NotificationMode;
  memberMode: NotificationMode;
  byRole: Partial<Record<string, NotificationMode>>;
  mandatory: MandatoryNotification[];
  whatsappDailyCap: number;
  revision: number;
}

function isMode(v: unknown): v is NotificationMode {
  return typeof v === 'string' && (NOTIFICATION_MODES as readonly string[]).includes(v);
}

/**
 * `NOTIFICATIONS_QUIET_HOURS_DEFAULT` : `off` ou `HH-HH` (Kinshasa) ; défaut 21-7.
 * Les suites de bout en bout le règlent à `off` (aucune dépendance à l'heure du jour).
 */
export function defaultQuietHours(env: NodeJS.ProcessEnv = process.env): QuietHours {
  const raw = (env['NOTIFICATIONS_QUIET_HOURS_DEFAULT'] ?? '').trim().toLowerCase();
  const base = {
    start: NOTIFICATION_SETTINGS_LIMITS.quietHoursStartDefault,
    end: NOTIFICATION_SETTINGS_LIMITS.quietHoursEndDefault,
  };
  if (raw === 'off') return { enabled: false, ...base };
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (m) {
    const start = Number(m[1]);
    const end = Number(m[2]);
    if (start <= 23 && end <= 23) return { enabled: true, start, end };
  }
  return { enabled: true, ...base };
}

function emptyOverrides(): Record<NotificationMode, NotificationModeOverrides> {
  return { perroquet: {}, attenue: {}, essentiel: {} };
}

/** Surcharges stockées → surcharges typées (types inconnus ou retirés ignorés). */
export function decodeOverrides(
  stored: StoredOverrides | null | undefined,
): Record<NotificationMode, NotificationModeOverrides> {
  const out = emptyOverrides();
  for (const mode of NOTIFICATION_MODES) {
    const rec = stored?.[mode];
    if (!rec || typeof rec !== 'object') continue;
    for (const [key, ch] of Object.entries(rec)) {
      const kind = decodeKind(key);
      if (!notificationSpecOf(kind) || !ch || typeof ch !== 'object') continue;
      const clean: NotificationChannelOverride = {};
      for (const c of NOTIFICATION_CHANNELS) {
        if (typeof ch[c] === 'boolean') clean[c] = ch[c];
      }
      if (Object.keys(clean).length > 0) out[mode][kind as NotificationKind] = clean;
    }
  }
  return out;
}

export function encodeOverrides(
  overrides: Partial<Record<NotificationMode, NotificationModeOverrides | undefined>>,
): StoredOverrides {
  const out: StoredOverrides = {};
  for (const mode of NOTIFICATION_MODES) {
    const rec: Record<string, Partial<Record<string, boolean>>> = {};
    for (const [kind, ch] of Object.entries(overrides[mode] ?? {})) {
      if (!ch || !notificationSpecOf(kind)) continue;
      const clean: Partial<Record<string, boolean>> = {};
      for (const c of NOTIFICATION_CHANNELS) {
        if (typeof ch[c] === 'boolean') clean[c] = ch[c];
      }
      if (Object.keys(clean).length > 0) rec[encodeKind(kind)] = clean;
    }
    out[mode] = rec;
  }
  return out;
}

/**
 * Réglage ADR-0061 (douze événements, quatre canaux) → surcharges des trois modes qui
 * le reproduisent exactement (pur, testé).
 */
export function overridesFromLegacy(
  legacy: Parameters<typeof resolveWorkNotificationPreferences>[0],
): Record<NotificationMode, NotificationModeOverrides> {
  const resolved = resolveWorkNotificationPreferences(legacy);
  const wanted: Partial<Record<NotificationKind, NotificationChannelOverride>> = {};
  for (const e of WORK_NOTIFICATION_EVENTS) {
    wanted[`work.${e}` as NotificationKind] = { ...resolved.events[e] };
  }
  const out = emptyOverrides();
  for (const mode of NOTIFICATION_MODES) out[mode] = overridesFor(mode, wanted);
  return out;
}

const ORG_DEFAULTS = {
  projectLeadMode: 'attenue' as NotificationMode,
  memberMode: 'essentiel' as NotificationMode,
};

@Injectable()
export class NotificationSettingsService {
  constructor(
    @InjectModel(NotificationSettingsDoc.name)
    private readonly settings: Model<NotificationSettingsDocument>,
    @InjectModel(NotificationOrgSettingsDoc.name)
    private readonly orgSettings: Model<NotificationOrgSettingsDocument>,
    @InjectModel(NotificationPreferences.name)
    private readonly muted: Model<NotificationPreferencesDocument>,
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  // ── Organisation ─────────────────────────────────────────────────────────

  async org(organizationId: string): Promise<ResolvedOrgSettings> {
    const doc = await this.orgSettings
      .findOne({ organizationId })
      .lean<NotificationOrgSettingsLean>()
      .exec();
    const byRole: Partial<Record<string, NotificationMode>> = {};
    for (const [role, mode] of Object.entries(doc?.byRole ?? {})) {
      if ((ORG_ROLES as readonly string[]).includes(role) && isMode(mode)) byRole[role] = mode;
    }
    return {
      projectLeadMode: isMode(doc?.projectLeadMode)
        ? doc.projectLeadMode
        : ORG_DEFAULTS.projectLeadMode,
      memberMode: isMode(doc?.memberMode) ? doc.memberMode : ORG_DEFAULTS.memberMode,
      byRole,
      mandatory: (doc?.mandatory ?? [])
        .filter(
          (m) =>
            !!notificationSpecOf(m.kind) &&
            (NOTIFICATION_CHANNELS as readonly string[]).includes(m.channel),
        )
        .map((m) => ({
          kind: m.kind as NotificationKind,
          channel: m.channel as MandatoryNotification['channel'],
        })),
      whatsappDailyCap:
        typeof doc?.whatsappDailyCap === 'number'
          ? doc.whatsappDailyCap
          : NOTIFICATION_SETTINGS_LIMITS.whatsappDailyCapDefault,
      revision: doc?.revision ?? 0,
    };
  }

  async orgView(organizationId: string, canManage: boolean): Promise<NotificationOrgSettingsView> {
    const o = await this.org(organizationId);
    return {
      projectLeadMode: o.projectLeadMode,
      memberMode: o.memberMode,
      byRole: o.byRole,
      mandatory: o.mandatory,
      whatsappDailyCap: o.whatsappDailyCap,
      revision: o.revision,
      canManage,
    };
  }

  async putOrg(
    organizationId: string,
    body: PutNotificationOrgSettingsBody,
    actorUserId: string,
  ): Promise<NotificationOrgSettingsView> {
    for (const role of Object.keys(body.byRole)) {
      if (!(ORG_ROLES as readonly string[]).includes(role)) {
        throw new BadRequestException({
          code: 'NOTIFICATION_ROLE_UNKNOWN',
          message: `Rôle inconnu : ${role}.`,
        });
      }
    }
    for (const m of body.mandatory) {
      if (!notificationSpecOf(m.kind)!.channels.includes(m.channel)) {
        throw new BadRequestException({
          code: 'NOTIFICATION_CHANNEL_NOT_PERMITTED',
          message: 'Ce canal n’est pas permis pour cet événement.',
          details: { kind: m.kind, channel: m.channel },
        });
      }
    }
    const seen = new Set(body.mandatory.map((m) => `${m.kind}|${m.channel}`));
    const mandatory = [...seen].map((k) => {
      const [kind, channel] = k.split('|');
      return { kind: kind!, channel: channel! };
    });
    const values = {
      projectLeadMode: body.projectLeadMode,
      memberMode: body.memberMode,
      byRole: body.byRole,
      mandatory,
      whatsappDailyCap: body.whatsappDailyCap,
      updatedBy: actorUserId,
    };
    const current = await this.org(organizationId);
    if (current.revision !== body.expectedRevision) this.stale(current.revision);
    if (body.expectedRevision === 0) {
      try {
        await this.orgSettings.create({
          organizationId,
          ...values,
          revision: 1,
          _schemaVersion: 1,
        });
      } catch (err) {
        if ((err as { code?: number }).code === 11000) {
          this.stale((await this.org(organizationId)).revision);
        }
        throw err;
      }
    } else {
      const res = await this.orgSettings
        .updateOne(
          { organizationId, revision: body.expectedRevision },
          { $set: values, $inc: { revision: 1 } },
        )
        .exec();
      if (res.matchedCount !== 1) this.stale((await this.org(organizationId)).revision);
    }
    return this.orgView(organizationId, true);
  }

  // ── Personne ─────────────────────────────────────────────────────────────

  /** Mode appliqué à une personne pour un événement (§ 4.1). */
  static modeFor(
    s: Pick<ResolvedNotificationSettings, 'mode' | 'role'>,
    org: ResolvedOrgSettings,
    projectLead: boolean,
  ): NotificationMode {
    if (s.mode) return s.mode;
    if (projectLead) return org.projectLeadMode;
    return (s.role ? org.byRole[s.role] : undefined) ?? org.memberMode;
  }

  /** Réglages de plusieurs personnes (une émission, plusieurs destinataires). */
  async many(
    organizationId: string,
    userIds: readonly string[],
  ): Promise<Map<string, ResolvedNotificationSettings>> {
    const ids = [...new Set(userIds)];
    const out = new Map<string, ResolvedNotificationSettings>();
    if (ids.length === 0) return out;
    const [docs, mutedDocs, members] = await Promise.all([
      this.settings
        .find({ organizationId, userId: { $in: ids } })
        .lean<NotificationSettingsLean[]>()
        .exec(),
      this.muted
        .find({ organizationId, userId: { $in: ids } })
        .lean()
        .exec(),
      this.memberships
        .find({ organizationId, userId: { $in: ids } }, { userId: 1, role: 1 })
        .lean()
        .exec(),
    ]);
    const byUser = new Map(docs.map((d) => [d.userId, d]));
    const missing = ids.filter((u) => !byUser.has(u));
    if (missing.length > 0) {
      for (const d of await this.migrate(organizationId, missing)) byUser.set(d.userId, d);
    }
    const mutedOf = new Map(mutedDocs.map((d) => [d.userId, d.mutedKinds ?? []]));
    const roleOf = new Map(members.map((m) => [m.userId, String(m.role)]));
    const quiet = defaultQuietHours();
    for (const u of ids) {
      const d = byUser.get(u);
      out.set(u, {
        mode: isMode(d?.mode) ? d.mode : null,
        overrides: decodeOverrides(d?.overrides),
        notifyOwnActions: d?.notifyOwnActions === true,
        quietHours: d?.quietHours ?? quiet,
        mutedKinds: (mutedOf.get(u) ?? []).filter(
          (k): k is NotificationKind => !!notificationSpecOf(k),
        ),
        role: roleOf.get(u) ?? null,
        migratedFrom: d?.migratedFrom === 'adr-0061' ? 'adr-0061' : null,
        revision: d?.revision ?? 0,
      });
    }
    return out;
  }

  async one(organizationId: string, userId: string): Promise<ResolvedNotificationSettings> {
    return (await this.many(organizationId, [userId])).get(userId)!;
  }

  /** « Me notifier aussi de mes propres actions » (§ 1). */
  async notifyOwnActions(organizationId: string, userId: string): Promise<boolean> {
    const d = await this.settings
      .findOne({ organizationId, userId }, { notifyOwnActions: 1 })
      .lean()
      .exec();
    return d?.notifyOwnActions === true;
  }

  async view(organizationId: string, userId: string): Promise<NotificationSettingsView> {
    const [s, org] = await Promise.all([
      this.one(organizationId, userId),
      this.org(organizationId),
    ]);
    const defaultMode = NotificationSettingsService.modeFor({ ...s, mode: null }, org, false);
    const customized = {} as Record<NotificationMode, boolean>;
    for (const m of NOTIFICATION_MODES) customized[m] = isModeCustomized(m, s.overrides[m]);
    return {
      mode: s.mode,
      defaultMode,
      projectLeadMode: s.mode ?? org.projectLeadMode,
      effectiveMode: s.mode ?? defaultMode,
      overrides: s.overrides,
      customized,
      notifyOwnActions: s.notifyOwnActions,
      quietHours: s.quietHours,
      mandatory: org.mandatory,
      mutedKinds: s.mutedKinds,
      migratedFrom: s.migratedFrom,
      revision: s.revision,
    };
  }

  async put(
    organizationId: string,
    userId: string,
    body: PutNotificationSettingsBody,
  ): Promise<NotificationSettingsView> {
    const current = await this.one(organizationId, userId);
    if (current.revision !== body.expectedRevision) this.stale(current.revision);
    const overrides = { ...current.overrides } as Record<
      NotificationMode,
      NotificationModeOverrides
    >;
    for (const m of NOTIFICATION_MODES) {
      const sent = body.overrides[m];
      // Mode absent du corps : ses surcharges sont GARDÉES (§ 4.2).
      if (sent !== undefined) overrides[m] = sent as NotificationModeOverrides;
    }
    await this.write(organizationId, userId, body.expectedRevision, {
      mode: body.mode,
      overrides: encodeOverrides(overrides),
      notifyOwnActions: body.notifyOwnActions,
      quietHours: body.quietHours,
    });
    return this.view(organizationId, userId);
  }

  /**
   * Ancienne route (`PUT /work/notification-preferences`, § 4.4) : les cases des douze
   * événements deviennent des surcharges du mode choisi — ou des trois modes si la
   * personne suit le défaut de l'organisation. Le reste est inchangé.
   */
  async applyLegacyWork(
    organizationId: string,
    userId: string,
    wanted: Partial<Record<NotificationKind, NotificationChannelOverride>>,
  ): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.one(organizationId, userId);
      const modes = current.mode ? [current.mode] : [...NOTIFICATION_MODES];
      const overrides = { ...current.overrides };
      for (const m of modes) {
        const next = { ...overrides[m] };
        for (const kind of Object.keys(wanted) as NotificationKind[]) delete next[kind];
        overrides[m] = { ...next, ...overridesFor(m, wanted) };
      }
      try {
        await this.write(organizationId, userId, current.revision, {
          mode: current.mode,
          overrides: encodeOverrides(overrides),
          notifyOwnActions: current.notifyOwnActions,
          quietHours: current.quietHours,
        });
        return;
      } catch (err) {
        if (!(err instanceof ConflictException)) throw err;
      }
    }
  }

  // ── Interne ──────────────────────────────────────────────────────────────

  private async write(
    organizationId: string,
    userId: string,
    expectedRevision: number,
    values: Record<string, unknown>,
  ): Promise<void> {
    if (expectedRevision === 0) {
      try {
        await this.settings.create({
          organizationId,
          userId,
          ...values,
          migratedFrom: null,
          revision: 1,
          _schemaVersion: 1,
        });
      } catch (err) {
        if ((err as { code?: number }).code === 11000) {
          this.stale((await this.one(organizationId, userId)).revision);
        }
        throw err;
      }
      return;
    }
    const res = await this.settings
      .updateOne(
        { organizationId, userId, revision: expectedRevision },
        { $set: values, $inc: { revision: 1 } },
      )
      .exec();
    if (res.matchedCount !== 1) this.stale((await this.one(organizationId, userId)).revision);
  }

  /** Conversion paresseuse des préférences ADR-0061 enregistrées (§ 4.3). */
  private async migrate(
    organizationId: string,
    userIds: readonly string[],
  ): Promise<NotificationSettingsLean[]> {
    const db = this.connection.db;
    if (!db) return [];
    const legacy = await db
      .collection(LEGACY_WORK_PREFERENCES)
      .find(
        // `events` vide : seul le résumé quotidien a été réglé (écran ADR-0079) — rien à convertir.
        {
          organizationId,
          userId: { $in: [...userIds] },
          revision: { $gte: 1 },
          events: { $exists: true, $ne: {} },
        },
        { projection: { userId: 1, events: 1, digest: 1 } },
      )
      .toArray();
    const out: NotificationSettingsLean[] = [];
    for (const l of legacy) {
      const userId = String(l['userId']);
      const overrides = overridesFromLegacy({
        events: (l['events'] ?? null) as never,
        digest: null,
      });
      try {
        await this.settings
          .updateOne(
            { organizationId, userId },
            {
              $setOnInsert: {
                organizationId,
                userId,
                mode: null,
                overrides: encodeOverrides(overrides),
                notifyOwnActions: false,
                quietHours: null,
                migratedFrom: 'adr-0061',
                revision: 1,
                _schemaVersion: 1,
              },
            },
            { upsert: true },
          )
          .exec();
      } catch (err) {
        if ((err as { code?: number }).code !== 11000) throw err;
      }
      const doc = await this.settings
        .findOne({ organizationId, userId })
        .lean<NotificationSettingsLean>()
        .exec();
      if (doc) out.push(doc);
    }
    return out;
  }

  private stale(current: number): never {
    throw new ConflictException({
      code: 'STALE_REVISION',
      message: 'Ces réglages ont changé entre-temps : rechargez la page.',
      details: { currentRevision: current },
    });
  }
}
