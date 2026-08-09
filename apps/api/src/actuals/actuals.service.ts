import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { ActualPeriod, type ActualPeriodDocument } from './actual-period.schema.js';

/** Identifiants de ligne du DSL : snake_case ASCII, mêmes règles que le moteur. */
const LINE_ID_PATTERN = /^[a-z][a-z0-9_]*$/;
const MAX_LINES_PER_PERIOD = 200;

export interface PeriodKey {
  organizationId: string;
  projectId: string;
  year: number;
  month: number;
}

/**
 * Périodes réalisées d'un projet (S18b — docs/08, docs/22 § Période réalisée).
 *
 * Règles :
 * - upsert refusé si la période est clôturée (409 PERIOD_CLOSED) ;
 * - clôture idempotente refusée (409 PERIOD_ALREADY_CLOSED) ;
 * - réouverture réservée au rôle `owner` de l'org, motif obligatoire,
 *   journalisée en append-only dans `reopenedLog`.
 */
@Injectable()
export class ActualsService {
  constructor(
    @InjectModel(ActualPeriod.name) private readonly model: Model<ActualPeriodDocument>,
  ) {}

  /** Valide year/month d'URL — 400 sinon (année d'exercice 1..5, mois 1..12). */
  assertValidPeriod(year: number, month: number): void {
    if (!Number.isInteger(year) || year < 1 || year > 5) {
      throw new BadRequestException({
        code: 'INVALID_PERIOD',
        message: "L'année d'exercice doit être un entier entre 1 et 5.",
      });
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new BadRequestException({
        code: 'INVALID_PERIOD',
        message: 'Le mois doit être un entier entre 1 et 12.',
      });
    }
  }

  /**
   * Upsert des valeurs réalisées d'un mois. Fusionne les clés soumises avec les
   * valeurs déjà saisies (saisie incrémentale : CA d'abord, charges ensuite).
   *
   * Une valeur `null` EFFACE la ligne du mois (`$unset` logique) : c'est la seule
   * façon de revenir à « non saisi » après une erreur, distinct d'un montant 0 qui,
   * lui, est une observation réelle.
   *
   * `allowedLineIds` (lignes du compte d'exploitation du plan validé courant) borne
   * la saisie : un identifiant inconnu est refusé plutôt que stocké en ligne
   * fantôme impossible à corriger depuis l'interface.
   *
   * Refusé si la période est clôturée — les périodes clôturées sont protégées
   * (docs/08 § Critères d'acceptation).
   */
  async upsertValues(
    key: PeriodKey,
    values: Record<string, number | null>,
    allowedLineIds: ReadonlySet<string>,
  ): Promise<ActualPeriodDocument> {
    this.assertValidPeriod(key.year, key.month);
    this.assertValidValues(values, allowedLineIds);

    const existing = await this.findOne(key);
    if (existing?.status === 'closed') {
      throw new ConflictException({
        code: 'PERIOD_CLOSED',
        message: `La période ${key.month}/${key.year} est clôturée — rouvrez-la avant de modifier le réalisé.`,
      });
    }

    if (existing) {
      existing.values = mergeValues(existing.values, values);
      existing.markModified('values');
      await existing.save();
      return existing;
    }

    try {
      return await this.model.create({
        organizationId: key.organizationId,
        projectId: key.projectId,
        year: key.year,
        month: key.month,
        status: 'open',
        values: mergeValues({}, values),
        reopenedLog: [],
        _schemaVersion: 1,
      });
    } catch (err) {
      // Course sur l'index unique {projectId, year, month} — un autre upsert a créé
      // la période entre notre lecture et notre écriture.
      if (typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000) {
        throw new ConflictException({
          code: 'PERIOD_CONFLICT',
          message: 'Écriture concurrente sur cette période — réessayez.',
        });
      }
      throw err;
    }
  }

  /**
   * Clôture une période : open → closed. Une période jamais saisie peut être
   * clôturée (mois sans activité) — elle est créée vide puis fermée.
   */
  async close(key: PeriodKey, userId: string): Promise<ActualPeriodDocument> {
    this.assertValidPeriod(key.year, key.month);
    let period = await this.findOne(key);
    if (period?.status === 'closed') {
      throw new ConflictException({
        code: 'PERIOD_ALREADY_CLOSED',
        message: `La période ${key.month}/${key.year} est déjà clôturée.`,
      });
    }
    // Aucune valeur à valider : la période naît vide (mois sans activité).
    period ??= await this.upsertValues(key, {}, new Set<string>());
    period.status = 'closed';
    period.closedAt = new Date();
    period.closedBy = userId;
    await period.save();
    return period;
  }

  /**
   * Réouverture closed → open — motif obligatoire, journalisée.
   *
   * S20a : le contrôle d'accès a QUITTÉ ce service. Il était ici un
   * `membership.role !== 'owner'` codé en dur, exactement ce qu'ADR-0012 §8
   * interdit (« aucun `if (role === …)` hors de `permissions.ts` »). La règle est
   * désormais déclarée sur la route :
   * `@RequirePermission('period.close', 'plan.approve')` — la « deuxième
   * permission distincte » de docs/12 § Règles critiques, obtenue sans inventer
   * de seizième action (R3).
   *
   * Conséquence voulue : un Comptable à qui on a accordé `canClosePeriods` peut
   * clôturer mais NE PEUT PAS rouvrir, faute de `plan.approve`. Un
   * `finance_director`, lui, peut désormais rouvrir — il ne le pouvait pas avant,
   * alors qu'il porte l'autorité financière.
   */
  async reopen(
    key: PeriodKey,
    userId: string,
    reason: string | undefined,
  ): Promise<ActualPeriodDocument> {
    this.assertValidPeriod(key.year, key.month);
    // (S22e) `reason` vient du corps de requête, typé mais NON validé par le
    // contrôleur (`@Body() body: { reason?: string }` est une assertion, pas une
    // garde). Un corps `{"reason": {"x":1}}` rendait `reason.trim` non-fonction
    // → TypeError → 500 sur une route pourtant privilégiée. On rejette tout ce
    // qui n'est pas une chaîne en 400, comme la validation applicative des
    // valeurs plus bas dans ce service.
    if (reason !== undefined && typeof reason !== 'string') {
      throw new BadRequestException({
        code: 'REOPEN_REASON_INVALID',
        message: 'Le motif de réouverture doit être une chaîne de caractères.',
      });
    }
    const trimmedReason = reason?.trim() ?? '';
    if (trimmedReason.length === 0) {
      throw new BadRequestException({
        code: 'REOPEN_REASON_REQUIRED',
        message: 'Un motif de réouverture est obligatoire (trace d’audit docs/08).',
      });
    }

    const period = await this.findOne(key);
    if (!period || period.status !== 'closed') {
      throw new ConflictException({
        code: 'PERIOD_NOT_CLOSED',
        message: `La période ${key.month}/${key.year} n'est pas clôturée — rien à rouvrir.`,
      });
    }

    period.status = 'open';
    period.closedAt = undefined;
    period.closedBy = undefined;
    period.reopenedLog.push({ reopenedAt: new Date(), reopenedBy: userId, reason: trimmedReason });
    await period.save();
    return period;
  }

  /** Périodes d'une année d'exercice, triées par mois. Scope org TOUJOURS appliqué. */
  listByYear(
    organizationId: string,
    projectId: string,
    year: number,
  ): Promise<ActualPeriodDocument[]> {
    return this.model.find({ organizationId, projectId, year }).sort({ month: 1 }).exec();
  }

  private findOne(key: PeriodKey): Promise<ActualPeriodDocument | null> {
    return this.model
      .findOne({
        organizationId: key.organizationId,
        projectId: key.projectId,
        year: key.year,
        month: key.month,
      })
      .exec();
  }

  /**
   * 400 si une clé n'est pas un lineId DSL valide, si elle est inconnue du plan
   * validé courant, ou si la valeur n'est ni un nombre fini ni `null`.
   */
  private assertValidValues(
    values: Record<string, number | null>,
    allowedLineIds: ReadonlySet<string>,
  ): void {
    if (typeof values !== 'object' || values === null || Array.isArray(values)) {
      throw new BadRequestException({
        code: 'INVALID_VALUES',
        message: '`values` doit être un objet { lineId: montant | null }.',
      });
    }
    const entries = Object.entries(values);
    if (entries.length > MAX_LINES_PER_PERIOD) {
      throw new BadRequestException({
        code: 'INVALID_VALUES',
        message: `Trop de lignes (max ${MAX_LINES_PER_PERIOD}).`,
      });
    }
    for (const [lineId, value] of entries) {
      if (lineId.length > 64 || !LINE_ID_PATTERN.test(lineId)) {
        throw new BadRequestException({
          code: 'INVALID_VALUES',
          message: `Identifiant de ligne invalide : "${lineId}".`,
        });
      }
      // `null` = effacement : autorisé même sur un id devenu inconnu, pour permettre
      // de NETTOYER une ligne héritée d'un plan précédent.
      if (value === null) continue;
      if (!allowedLineIds.has(lineId)) {
        throw new BadRequestException({
          code: 'UNKNOWN_LINE',
          message: `La ligne "${lineId}" n'appartient pas au compte d'exploitation du plan validé — saisie refusée.`,
        });
      }
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new BadRequestException({
          code: 'INVALID_VALUES',
          message: `Montant invalide pour "${lineId}" — nombre fini ou null attendu.`,
        });
      }
    }
  }
}

/** Applique la fusion, `null` effaçant la clé (retour à « non saisi »). */
function mergeValues(
  current: Record<string, number>,
  patch: Record<string, number | null>,
): Record<string, number> {
  const next: Record<string, number> = { ...current };
  for (const [lineId, value] of Object.entries(patch)) {
    if (value === null) delete next[lineId];
    else next[lineId] = value;
  }
  return next;
}
