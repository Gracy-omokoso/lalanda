// Packs de plan comptable : lecture pour les organisations, chargement et cycle de
// version pour la plateforme (ADR-0049 § 2.1, docs/09 § Modèle de version et
// § Administration). ADR-0049 — K4.
//
// Le chargement lit UNIQUEMENT un YAML livré avec le moteur
// (`packages/engine/src/accounting/packs/<slug>-v<version>.yaml`) par `parseChartPack` :
// aucun contenu n'arrive par le réseau, aucun numéro n'est créé par le code. Le statut
// part toujours de `draft`, quel que soit celui du fichier, et ne progresse que par
// transitions de la plateforme. `approved` et `active` exigent :
//   - `validateChartPack` sans défaut au statut visé (aucun `to_confirm`, relecture
//     renseignée, etc.) — le pack v1, entièrement `to_confirm`, est donc refusé ;
//   - une DOUBLE validation (docs/09 § Administration) : l'acteur qui approuve n'est pas
//     celui qui a mis le pack en relecture, ni celui qui l'a approuvé pour l'activer.

import { existsSync, readFileSync } from 'node:fs';

import {
  ChartPackError,
  chartPackFingerprint,
  parseChartPack,
  validateChartPack,
  type ChartPack,
} from '@lalanda/engine';
import {
  ACCOUNTING_ACTIVATABLE_PACK_STATUSES,
  ACCOUNTING_TO_CONFIRM_LABEL,
  type AccountingChartPackDetail,
  type AccountingChartPackRef,
  type AccountingChartPackStatus,
  type AccountingChartPackSummary,
  type TransitionAccountingChartPackBody,
} from '@lalanda/shared/accounting';
import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { engineAsset } from '../../engine-assets.js';
import { PLATFORM_AUDIT_SCOPE } from '../../integrations/platform-audit.service.js';
import {
  badRequest,
  conflict,
  isDuplicateKey,
  notFound,
  staleRevision,
} from '../accounting.common.js';
import {
  AccountingChartPack,
  type AccountingChartPackLean,
  type ChartPackHistoryEntry,
} from './chart-pack.schema.js';

/** Acteur PLATEFORME (aucune organisation) : identité et rôles détenus, pour l'audit. */
export interface PlatformPackActor {
  userId: string;
  roles: string;
}

/** Transitions admises (docs/09) ; `review → draft` rend le pack à la correction. */
const TRANSITIONS: Readonly<
  Record<AccountingChartPackStatus, readonly AccountingChartPackStatus[]>
> = {
  draft: ['review'],
  review: ['draft', 'approved'],
  approved: ['active', 'retired'],
  active: ['retired'],
  retired: [],
};

/** Statuts qui exigent un pack sans défaut au sens de `validateChartPack`. */
const VALIDATED_STATUSES: readonly AccountingChartPackStatus[] = ['approved', 'active'];

@Injectable()
export class ChartPacksService {
  constructor(
    @InjectModel(AccountingChartPack.name)
    private readonly packs: Model<AccountingChartPackLean>,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async find(ref: AccountingChartPackRef): Promise<AccountingChartPackLean | null> {
    return this.packs
      .findOne({ slug: ref.slug, version: ref.version })
      .lean<AccountingChartPackLean>()
      .exec();
  }

  async get(ref: AccountingChartPackRef): Promise<AccountingChartPackLean> {
    const found = await this.find(ref);
    if (!found) notFound('CHART_PACK_NOT_FOUND', 'Pack de plan comptable introuvable.');
    return found;
  }

  async list(): Promise<AccountingChartPackSummary[]> {
    const rows = await this.packs
      .find({})
      .sort({ slug: 1, version: -1 })
      .lean<AccountingChartPackLean[]>()
      .exec();
    return rows.map(summaryOf);
  }

  async detail(ref: AccountingChartPackRef): Promise<AccountingChartPackDetail> {
    return detailOf(await this.get(ref));
  }

  // ── Plateforme ─────────────────────────────────────────────────────────────

  /**
   * Charge (ou recharge) un pack livré avec le moteur. Idempotent : même empreinte →
   * rien ne change. Contenu différent : admis tant que le pack est `draft` (correction
   * par le gestionnaire), refusé au-delà (`409 CHART_PACK_IMMUTABLE`).
   */
  async load(
    ref: AccountingChartPackRef,
    actor: PlatformPackActor,
  ): Promise<{ pack: AccountingChartPackDetail; created: boolean; changed: boolean }> {
    const content = readBundledPack(ref);
    const fingerprint = chartPackFingerprint(content);
    const now = new Date();
    const existing = await this.find(ref);
    if (!existing) {
      try {
        await this.packs.create({
          slug: ref.slug,
          version: ref.version,
          status: 'draft',
          content,
          fingerprint,
          loadedBy: actor.userId,
          history: [{ action: 'loaded', from: null, to: 'draft', by: actor.userId, at: now }],
          revision: 1,
          _schemaVersion: 1,
        });
      } catch (err) {
        if (!isDuplicateKey(err)) throw err;
        return this.load(ref, actor);
      }
      await this.trace(actor, 'accounting.chart_pack.loaded', ref, {
        fingerprint,
        status: 'draft',
      });
      return { pack: detailOf((await this.find(ref))!), created: true, changed: true };
    }
    if (existing.fingerprint === fingerprint) {
      return { pack: detailOf(existing), created: false, changed: false };
    }
    if (existing.status !== 'draft') {
      conflict(
        'CHART_PACK_IMMUTABLE',
        'Ce pack a quitté le brouillon : il ne change plus. Publiez une version nouvelle.',
        { status: existing.status },
      );
    }
    const entry: ChartPackHistoryEntry = {
      action: 'reloaded',
      from: 'draft',
      to: 'draft',
      by: actor.userId,
      at: now,
    };
    const updated = await this.packs
      .findOneAndUpdate(
        { _id: existing._id, revision: existing.revision, status: 'draft' },
        {
          $set: { content, fingerprint, loadedBy: actor.userId },
          $push: { history: entry },
          $inc: { revision: 1 },
        },
        { new: true },
      )
      .lean<AccountingChartPackLean>()
      .exec();
    if (!updated) staleRevision(existing.revision);
    await this.trace(actor, 'accounting.chart_pack.reloaded', ref, {
      fingerprint,
      previousFingerprint: existing.fingerprint,
    });
    return { pack: detailOf(updated), created: false, changed: true };
  }

  async transition(
    ref: AccountingChartPackRef,
    body: TransitionAccountingChartPackBody,
    actor: PlatformPackActor,
  ): Promise<AccountingChartPackDetail> {
    const pack = await this.get(ref);
    if (pack.revision !== body.expectedRevision) staleRevision(pack.revision);
    const from = pack.status;
    const to = body.to;
    if (!TRANSITIONS[from].includes(to)) {
      conflict('CHART_PACK_TRANSITION_FORBIDDEN', `Passage de « ${from} » à « ${to} » interdit.`, {
        from,
        to,
        allowed: [...TRANSITIONS[from]],
      });
    }
    if (VALIDATED_STATUSES.includes(to)) {
      const issues = validateChartPack({ ...pack.content, status: to });
      if (issues.length > 0) {
        conflict(
          'CHART_PACK_NOT_APPROVABLE',
          'Ce pack n’est pas relu : des éléments restent à confirmer par l’expert-comptable, ou la relecture n’est pas renseignée.',
          { issues: issues.slice(0, 50), total: issues.length },
        );
      }
      // Double validation (docs/09 § Administration) : un second acteur que celui de
      // l'étape précédente (mise en relecture, puis approbation).
      const previous = [...pack.history].reverse().find((h) => h.action === 'transition');
      if (previous === undefined || previous.by === actor.userId) {
        conflict(
          'CHART_PACK_DOUBLE_VALIDATION_REQUIRED',
          'Une seconde personne de la plateforme doit confirmer ce passage.',
        );
      }
    }
    const entry: ChartPackHistoryEntry = {
      action: 'transition',
      from,
      to,
      by: actor.userId,
      at: new Date(),
    };
    const updated = await this.packs
      .findOneAndUpdate(
        { _id: pack._id, revision: pack.revision, status: from },
        { $set: { status: to }, $push: { history: entry }, $inc: { revision: 1 } },
        { new: true },
      )
      .lean<AccountingChartPackLean>()
      .exec();
    if (!updated) staleRevision(pack.revision);
    await this.trace(actor, 'accounting.chart_pack.transition', ref, { from, to });
    return detailOf(updated);
  }

  /** Trace STRICTE dans l'espace plateforme du journal (jamais celui d'un client). */
  private async trace(
    actor: PlatformPackActor,
    action: string,
    ref: AccountingChartPackRef,
    metadata: Record<string, string | number>,
  ): Promise<void> {
    await this.audit.recordStrict({
      organizationId: PLATFORM_AUDIT_SCOPE,
      actorUserId: actor.userId,
      actorRole: actor.roles,
      action,
      targetType: 'accounting_chart_pack',
      targetId: `${ref.slug}@${ref.version}`,
      metadata: { slug: ref.slug, version: ref.version, ...metadata },
    });
  }
}

/** Lit et valide un YAML livré avec le moteur ; 404 s'il n'existe pas, 409 s'il est invalide. */
function readBundledPack(ref: AccountingChartPackRef): ChartPack {
  // `slug` est contraint à `^[a-z][a-z0-9-]*$` par le contrat : aucun séparateur de chemin.
  const path = engineAsset('accounting', 'packs', `${ref.slug}-v${ref.version}.yaml`);
  if (!existsSync(path)) {
    notFound('CHART_PACK_FILE_NOT_FOUND', 'Aucun pack livré sous ce nom et cette version.');
  }
  let pack: ChartPack;
  try {
    pack = parseChartPack(readFileSync(path, 'utf8'));
  } catch (err) {
    if (err instanceof ChartPackError) {
      conflict('CHART_PACK_INVALID', 'Le pack livré est illisible ou incohérent.', {
        issues: err.issues.slice(0, 50),
      });
    }
    throw err;
  }
  if (pack.slug !== ref.slug || pack.version !== ref.version) {
    badRequest('CHART_PACK_FILE_MISMATCH', 'Le fichier déclare un autre pack que celui demandé.', {
      declared: { slug: pack.slug, version: pack.version },
    });
  }
  return pack;
}

const mention = (c: string): string | null =>
  c === 'to_confirm' ? ACCOUNTING_TO_CONFIRM_LABEL : null;

function summaryOf(d: AccountingChartPackLean): AccountingChartPackSummary {
  const c = d.content;
  const toConfirm =
    c.classes.filter((x) => x.confirmation === 'to_confirm').length +
    c.accounts.filter((x) => x.confirmation === 'to_confirm').length +
    c.proposedRules.filter((x) => x.confirmation === 'to_confirm').length;
  return {
    slug: d.slug,
    version: d.version,
    framework: c.framework,
    countries: [...c.countries],
    label: c.label,
    status: d.status,
    activatable: ACCOUNTING_ACTIVATABLE_PACK_STATUSES.includes(d.status),
    warnings: [...c.warnings],
    fingerprint: d.fingerprint,
    counts: {
      classes: c.classes.length,
      accounts: c.accounts.length,
      toConfirm,
      expectedAccounts: c.expectedAccounts.length,
      proposedRules: c.proposedRules.length,
    },
    loadedAt: new Date(d.createdAt).toISOString(),
    revision: d.revision,
  };
}

function detailOf(d: AccountingChartPackLean): AccountingChartPackDetail {
  const c = d.content;
  return {
    ...summaryOf(d),
    sources: c.sources.map((s) => ({ ...s })),
    classes: c.classes.map((k) => ({
      number: k.number,
      label: k.label,
      sourceId: k.sourceId,
      confirmation: k.confirmation,
      mention: mention(k.confirmation),
    })),
    accounts: c.accounts.map((a) => ({
      number: a.number,
      label: a.label,
      classNumber: a.classNumber,
      parent: a.parent,
      nature: a.nature,
      collective: a.collective,
      auxiliaryKind: a.auxiliaryKind,
      sourceId: a.sourceId,
      confirmation: a.confirmation,
      mention: mention(a.confirmation),
    })),
    expectedAccounts: c.expectedAccounts.map((e) => ({ ...e })),
    statementTemplates: { ...c.statementTemplates },
    proposedRules: c.proposedRules.map((r) => ({ ...r, mention: mention(r.confirmation) })),
    suspenseAccount: c.suspenseAccount ?? null,
    review: c.review === null ? null : { ...c.review },
    history: d.history.map((h) => ({
      action: h.action,
      from: h.from,
      to: h.to,
      by: h.by,
      at: new Date(h.at).toISOString(),
    })),
  };
}
