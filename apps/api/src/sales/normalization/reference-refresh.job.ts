// Rafraîchissement des listes de référence e-MCF — ADR-0024 § 8.
//
// Tâche récurrente `edef.reference.refresh`, toutes les 6 heures : taux de
// TVA (`taxGroups`) et taux de change (`currencyRates`). Une fois par jour,
// peu après 00 h 15 à Kinshasa (`edef.reference.refresh.daily`) : les sept
// listes et le statut du jeton (`PointsOfSaleService.test`, qui tient à jour
// la fin de validité du jeton).
//
// Chaque organisation en facture normalisée rafraîchit avec le jeton de SON
// premier point de vente actif de son environnement, pour son propre besoin
// (O6) ; les instantanés restent partagés par environnement, dédoublonnés par
// empreinte. Le contenu est conservé BRUT (groupes Q, R, S compris, pour la
// preuve) ; le filtrage A–P reste à l'usage (catalogue, gel, moteur).
// Une organisation en échec n'empêche jamais les autres d'être rafraîchies.

import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { EdefReferenceSnapshotsService } from '../../edef/edef-reference-snapshots.service.js';
import { EdefClient } from '../../edef/edef.client.js';
import { EDEF_REFERENCE_LISTS, type EdefReferenceList } from '../../edef/edef.types.js';
import { crossCheckTaxGroups } from '../../fiscal/reference-data.service.js';
import { PointsOfSaleService } from '../../fiscal/points-of-sale.service.js';
import { getParameterPack } from '../../parameter-packs/parameter-pack-registry.js';
import type { EdefEnvironment } from '../../platform-config/dgi-platform.config.js';
import { SchedulerService } from '../../scheduler/scheduler.service.js';
import { DgiCallLimiter } from './dgi-call-limiter.js';

export const REFRESH_JOB = 'edef.reference.refresh';
export const REFRESH_DAILY_JOB = 'edef.reference.refresh.daily';
export const REFRESH_EVERY_MS = 6 * 3600_000;
/** Écart minimal entre deux appels DGI (§ 6). */
export const REFRESH_SPACING_MS = 500;

/** Lettres de groupe de taxation en vigueur (A–P), en minuscules comme la DGI. */
const DOCUMENTED_GROUPS = 'abcdefghijklmnop'.split('');

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Prochain 00 h 15 à Kinshasa (UTC+1, sans heure d'été) strictement après `now`. */
export function nextDailyRefreshAt(now: Date): Date {
  const kinshasa = new Date(now.getTime() + 3600_000);
  const candidate = Date.UTC(
    kinshasa.getUTCFullYear(),
    kinshasa.getUTCMonth(),
    kinshasa.getUTCDate(),
    0,
    15,
  );
  let at = candidate - 3600_000;
  if (at <= now.getTime()) at += 24 * 3600_000;
  return new Date(at);
}

export interface TaxGroupsChange {
  /** Lettres A–P dont le taux a changé (ou est apparu, ou a disparu). */
  changed: string[];
  /** Lettres hors A–P renvoyées par la DGI. */
  undocumented: string[];
}

/** Compare deux instantanés `taxGroups` bruts (lettres minuscules → taux en %). */
export function diffTaxGroups(
  previous: Readonly<Record<string, unknown>> | null,
  current: Readonly<Record<string, unknown>>,
): TaxGroupsChange {
  const changed =
    previous === null
      ? []
      : DOCUMENTED_GROUPS.filter((l) => (previous[l] ?? null) !== (current[l] ?? null)).map((l) =>
          l.toUpperCase(),
        );
  const undocumented = Object.keys(current)
    .filter((k) => /^[a-z]$/.test(k) && !DOCUMENTED_GROUPS.includes(k))
    .map((k) => k.toUpperCase())
    .sort();
  return { changed, undocumented };
}

interface SettingsRow {
  organizationId: string;
  environment: EdefEnvironment;
}

@Injectable()
export class ReferenceRefreshJob implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger('Normalisation');
  /** Écart entre deux appels ; les tests le ramènent à 0. */
  spacingMs = REFRESH_SPACING_MS;

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @Inject(PointsOfSaleService) private readonly pointsOfSale: PointsOfSaleService,
    @Inject(EdefClient) private readonly edef: EdefClient,
    @Inject(EdefReferenceSnapshotsService)
    private readonly snapshots: EdefReferenceSnapshotsService,
    @Inject(DgiCallLimiter) private readonly limiter: DgiCallLimiter,
    @Inject(SchedulerService) private readonly scheduler: SchedulerService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.scheduler.every(REFRESH_JOB, REFRESH_EVERY_MS, async () => {
      await this.run({ full: false });
    });
    this.scheduler.register(REFRESH_DAILY_JOB, async (_payload, ctx) => {
      await this.run({ full: true });
      await this.scheduleDaily(ctx.now);
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.scheduleDaily(new Date());
  }

  /** Planifie le prochain passage quotidien ; rejouable (clé datée). */
  async scheduleDaily(now: Date): Promise<void> {
    const runAt = nextDailyRefreshAt(now);
    await this.scheduler.schedule({
      name: REFRESH_DAILY_JOB,
      key: `${REFRESH_DAILY_JOB}:${runAt.toISOString().slice(0, 10)}`,
      runAt,
    });
  }

  /**
   * Un passage pour toutes les organisations en facture normalisée. Renvoie,
   * par organisation, les listes enregistrées ou l'échec — pour les tests et
   * le journal serveur.
   */
  async run(opts: { full: boolean }): Promise<Map<string, { ok: string[]; failed: string[] }>> {
    const rows = await this.connection
      .collection<SettingsRow>('normalized_invoicing_settings')
      .find({ state: 'enabled' }, { projection: { organizationId: 1, environment: 1 } })
      .toArray();
    const report = new Map<string, { ok: string[]; failed: string[] }>();
    for (const row of rows) {
      try {
        report.set(
          row.organizationId,
          await this.refreshOrg(row.organizationId, row.environment, opts.full),
        );
      } catch (err) {
        // Jamais de blocage des autres organisations.
        report.set(row.organizationId, { ok: [], failed: ['*'] });
        this.logger.warn(
          `Rafraîchissement des listes DGI de l'organisation ${row.organizationId} en échec : ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return report;
  }

  private async refreshOrg(
    organizationId: string,
    environment: EdefEnvironment,
    full: boolean,
  ): Promise<{ ok: string[]; failed: string[] }> {
    const views = await this.pointsOfSale.list(organizationId);
    const pos = views.find((v) => v.environment === environment && v.status === 'active');
    if (!pos) return { ok: [], failed: ['no_active_point_of_sale'] };
    const resolved = await this.pointsOfSale.resolveActiveToken(organizationId, pos.id);
    if (!resolved) return { ok: [], failed: ['no_token'] };
    const ctx = {
      environment,
      token: resolved.token,
      organizationId,
      pointOfSaleId: pos.id,
    };
    const lists: readonly EdefReferenceList[] = full
      ? EDEF_REFERENCE_LISTS
      : ['taxGroups', 'currencyRates'];
    const ok: string[] = [];
    const failed: string[] = [];
    for (const list of lists) {
      const previous = list === 'taxGroups' ? await this.snapshots.latest(environment, list) : null;
      const out = await this.limiter.run(() => this.edef.getReferenceList(list, ctx));
      if (this.spacingMs > 0) await sleep(this.spacingMs);
      if (!out.ok) {
        failed.push(list);
        this.logger.warn(
          `Liste DGI ${list} non rafraîchie pour l'organisation ${organizationId} : ${out.error.kind}.`,
        );
        if (out.error.kind === 'unauthorized') break;
        continue;
      }
      const recorded = await this.snapshots.record(environment, list, out.data);
      ok.push(list);
      if (list === 'taxGroups' && recorded.created) {
        await this.inspectTaxGroups(
          organizationId,
          (previous?.payload ?? null) as Record<string, unknown> | null,
          out.data as Record<string, unknown>,
          recorded.sha256,
        );
      }
    }
    if (full) {
      // Statut du jeton (fin de validité tenue à jour) : le service existant.
      await this.pointsOfSale.test(organizationId, pos.id).catch((err: unknown) => {
        this.logger.warn(
          `Statut du jeton du point de vente ${pos.id} non relu : ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
    return { ok, failed };
  }

  /** Nouvel instantané `taxGroups` : taux A–P changés, lettres non documentées, contrôle du pack. */
  private async inspectTaxGroups(
    organizationId: string,
    previous: Record<string, unknown> | null,
    current: Record<string, unknown>,
    sha256: string,
  ): Promise<void> {
    const diff = diffTaxGroups(previous, current);
    if (diff.changed.length > 0) {
      this.logger.error(
        `ALERTE EDEF_TAX_RATE_CHANGED : taux DGI modifiés pour les groupes ${diff.changed.join(', ')} (instantané ${sha256}).`,
      );
      await this.audit.record({
        organizationId,
        actorUserId: 'system:scheduler',
        actorRole: 'system',
        action: 'edef.alert.tax_rate_changed',
        targetType: 'edef_reference_snapshot',
        targetId: sha256,
        metadata: { groups: diff.changed.join(',') },
      });
    }
    if (diff.undocumented.length > 0) {
      this.logger.log(
        `EDEF_UNDOCUMENTED_TAX_GROUPS : groupes ${diff.undocumented.join(', ')} renvoyés par la DGI, définis par aucun document ; conservés dans le brut, jamais utilisés (instantané ${sha256}).`,
      );
      await this.audit.record({
        organizationId,
        actorUserId: 'system:scheduler',
        actorRole: 'system',
        action: 'edef.info.undocumented_tax_groups',
        targetType: 'edef_reference_snapshot',
        targetId: sha256,
        metadata: { groups: diff.undocumented.join(',') },
      });
    }
    const pack = getParameterPack('cd-2026');
    const numeric: Record<string, number> = {};
    for (const [k, v] of Object.entries(current)) if (typeof v === 'number') numeric[k] = v;
    const warnings = pack ? crossCheckTaxGroups(numeric, pack.params) : [];
    for (const w of warnings) {
      this.logger.warn(
        `TAX_RATE_DIFFERS_FROM_PACK : groupe ${w.group.toUpperCase()} — DGI ${w.dgi ?? 'absent'} %, pack ${w.pack} %.`,
      );
    }
  }
}
