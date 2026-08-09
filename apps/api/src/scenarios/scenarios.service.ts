import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, type Model } from 'mongoose';

import { BillingService } from '../billing/billing.service.js';
import { Scenario, type ScenarioDocument } from './scenario.schema.js';
import {
  SCENARIO_REFERENCE_KEY,
  SCENARIO_REFERENCE_LABEL,
  type ScenarioSummaryView,
  type ScenarioView,
} from './scenarios.dto.js';

/** Code d'erreur MongoDB « duplicate key ». */
const DUPLICATE_KEY = 11000;

/** Vrai si l'erreur est un `E11000` portant sur l'index donné. */
function estDoublonSur(err: unknown, champ: 'key' | 'isReference'): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: number; keyPattern?: Record<string, unknown> };
  if (e.code !== DUPLICATE_KEY) return false;
  // `keyPattern` est renseigné par le driver depuis longtemps ; en son absence on
  // ne devine pas — l'appelant reçoit l'erreur brute plutôt qu'un message faux.
  return e.keyPattern !== undefined && champ in e.keyPattern;
}

/**
 * Slug dérivé d'un libellé : « Scénario prudent » → `scenario-prudent`.
 *
 * Les accents sont décomposés puis retirés (NFD + suppression des diacritiques)
 * plutôt que translittérés par une table : `é → e` ne demande pas de table, et
 * une table partielle produirait des slugs différents selon la langue du libellé.
 * Un libellé qui ne produit aucun caractère utilisable (idéogrammes, emoji) rend
 * `null` : l'appelant fournit alors une `key` explicite, ce qui vaut mieux qu'un
 * `scenario-1` opaque.
 */
export function slugifyKey(label: string): string | null {
  const slug = label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    // La `key` doit COMMENCER par une lettre (`^[a-z]`) : un libellé « 2026 »
    // donnerait sinon un slug refusé par le schéma.
    .replace(/^[^a-z]+/, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : null;
}

export interface CreateScenarioInput {
  organizationId: string;
  projectId: string;
  createdBy: string;
  label: string;
  key?: string;
  description?: string;
  driverValues?: Record<string, number>;
  /** Réservé aux chemins internes (création de projet, réparation). */
  isReference?: boolean;
  /** Passe outre le plafond d'entitlement — création du scénario de référence. */
  skipLimit?: boolean;
}

/**
 * Scénarios d'un projet (ADR-0015 §1).
 *
 * ── Ce service ne connaît pas les projets ────────────────────────────────────
 *
 * Il ne dépend PAS de `ProjectsService` : c'est `ProjectsModule` qui importe
 * `ScenariosModule` (création du scénario de référence à la création du projet),
 * et l'inverse ferait un cycle. Conséquence : l'existence du projet et son
 * appartenance à l'organisation sont vérifiées par l'APPELANT (le contrôleur,
 * lot 1-B) avant tout appel ici. Les méthodes de ce service filtrent malgré tout
 * systématiquement sur `organizationId` — une défense en profondeur, pas une
 * redondance : c'est le dernier filet contre une fuite cross-tenant si un
 * appelant futur oubliait la vérification.
 */
@Injectable()
export class ScenariosService {
  constructor(
    @InjectModel(Scenario.name) private readonly model: Model<ScenarioDocument>,
    @Inject(BillingService) private readonly billing: BillingService,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Lectures
  // ───────────────────────────────────────────────────────────────────────────

  /** Scénarios d'un projet, dans l'ordre d'affichage. */
  listByProject(organizationId: string, projectId: string): Promise<ScenarioDocument[]> {
    return this.model
      .find({ organizationId, projectId })
      .sort({ ordre: 1, createdAt: 1 })
      .exec();
  }

  countByProject(organizationId: string, projectId: string): Promise<number> {
    return this.model.countDocuments({ organizationId, projectId }).exec();
  }

  /**
   * Scénario scopé par organisation ET par projet. 404 si l'identifiant est
   * invalide, inexistant, appartient à un autre projet, ou à une autre
   * organisation — jamais 403 (ADR-0011 : ne pas révéler l'existence d'une
   * ressource cross-tenant).
   */
  async findScoped(
    organizationId: string,
    projectId: string,
    scenarioId: string,
  ): Promise<ScenarioDocument> {
    if (!isValidObjectId(scenarioId)) {
      throw new NotFoundException({ code: 'SCENARIO_NOT_FOUND' });
    }
    const doc = await this.model
      .findOne({ _id: scenarioId, organizationId, projectId })
      .exec();
    if (!doc) throw new NotFoundException({ code: 'SCENARIO_NOT_FOUND' });
    return doc;
  }

  findByKey(
    organizationId: string,
    projectId: string,
    key: string,
  ): Promise<ScenarioDocument | null> {
    return this.model.findOne({ organizationId, projectId, key }).exec();
  }

  /** Scénario de référence, ou `null` s'il n'existe pas encore. */
  findReference(organizationId: string, projectId: string): Promise<ScenarioDocument | null> {
    return this.model.findOne({ organizationId, projectId, isReference: true }).exec();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Écritures
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Crée un scénario. Applique le plafond `maxScenariosPerProject` (ADR-0015
   * §3.4) — sauf pour le scénario de référence, qui n'est pas un choix de
   * l'utilisateur : refuser à un compte Free le scénario que tout projet doit
   * avoir rendrait le projet inutilisable.
   *
   * Le plafond est un « compter puis créer » sans transaction, comme
   * `PLAN_LIMIT_PROJECTS` (`projects.controller.ts:80-94`) : une course peut
   * dépasser d'un scénario. C'est un quota commercial, pas une invariante de
   * sécurité — contrairement à l'unicité de la référence, qui est tenue par
   * l'index.
   */
  async create(input: CreateScenarioInput): Promise<ScenarioDocument> {
    if (input.skipLimit !== true) {
      await this.assertUnderLimit(input.organizationId, input.projectId);
    }

    const key = input.key ?? (await this.deriveKey(input.projectId, input.label));
    const ordre = await this.countByProject(input.organizationId, input.projectId);

    try {
      return await this.model.create({
        organizationId: input.organizationId,
        projectId: input.projectId,
        key,
        label: input.label,
        description: input.description,
        isReference: input.isReference ?? false,
        driverValues: input.driverValues ?? {},
        driversUpdatedBy: null,
        driversUpdatedAt: null,
        createdBy: input.createdBy,
        ordre,
        _schemaVersion: 1,
      });
    } catch (err) {
      if (estDoublonSur(err, 'key')) {
        throw new ConflictException({
          code: 'SCENARIO_KEY_TAKEN',
          message: `Un scénario « ${key} » existe déjà dans ce projet.`,
        });
      }
      if (estDoublonSur(err, 'isReference')) {
        // L'index partiel a fait son travail : deux références concurrentes.
        throw new ConflictException({
          code: 'SCENARIO_REFERENCE_CONFLICT',
          message: 'Ce projet a déjà un scénario de référence.',
        });
      }
      throw err;
    }
  }

  /**
   * Garantit qu'un projet a bien son scénario de référence, et le renvoie.
   *
   * CEINTURE PAR-DESSUS LES BRETELLES (ADR-0015 §1.4). La création d'un projet
   * crée déjà son scénario `base`, et la migration l'a créé pour les projets
   * antérieurs. Mais le précédent de `provisionPersonalOrgForUser` — un crochet
   * non transactionnel — montre qu'un objet peut naître sans son satellite. Un
   * projet sans scénario ferait échouer toute évaluation en 500 ; ici il est
   * réparé en silence.
   *
   * Trois états possibles, trois traitements :
   *   1. une référence existe → renvoyée telle quelle ;
   *   2. aucun scénario → `base` créé, en référence ;
   *   3. des scénarios, mais aucun en référence → le PREMIER dans l'ordre
   *      d'affichage est promu. Choisir plutôt qu'échouer : l'alternative serait
   *      un 500 sur un projet dont les données sont intégralement lisibles.
   *
   * La course est traitée : deux appels simultanés sur le cas 2 font échouer le
   * second sur l'index partiel, qui relit alors la référence gagnante.
   */
  async ensureReference(
    organizationId: string,
    projectId: string,
    fallback: { createdBy: string; driverValues?: Record<string, number> },
  ): Promise<ScenarioDocument> {
    const existante = await this.findReference(organizationId, projectId);
    if (existante) return existante;

    const premier = await this.model
      .findOne({ organizationId, projectId })
      .sort({ ordre: 1, createdAt: 1 })
      .exec();

    if (premier) {
      premier.isReference = true;
      try {
        await premier.save();
        return premier;
      } catch (err) {
        if (estDoublonSur(err, 'isReference')) return this.requireReference(organizationId, projectId);
        throw err;
      }
    }

    try {
      return await this.create({
        organizationId,
        projectId,
        createdBy: fallback.createdBy,
        key: SCENARIO_REFERENCE_KEY,
        label: SCENARIO_REFERENCE_LABEL,
        driverValues: fallback.driverValues ?? {},
        isReference: true,
        skipLimit: true,
      });
    } catch (err) {
      // Course : un autre appel a créé la référence entre-temps. Les deux codes
      // sont possibles selon l'index touché en premier.
      if (
        err instanceof ConflictException &&
        ['SCENARIO_KEY_TAKEN', 'SCENARIO_REFERENCE_CONFLICT'].includes(codeDe(err))
      ) {
        return this.requireReference(organizationId, projectId);
      }
      throw err;
    }
  }

  /**
   * Désigne un nouveau scénario de référence.
   *
   * L'ORDRE DES DEUX ÉCRITURES N'EST PAS NÉGOCIABLE : démettre d'abord, promouvoir
   * ensuite. L'index unique partiel refuse tout instant où deux documents
   * porteraient `isReference: true` — un `$set` sur le nouveau avant de démettre
   * l'ancien échouerait systématiquement en E11000.
   *
   * Ces deux écritures ne sont pas atomiques hors transaction. Un incident entre
   * les deux laisse le projet SANS référence, jamais avec deux : c'est le sens
   * choisi parce qu'il est réparable — `ensureReference` promeut alors le premier
   * scénario — alors que deux références ne le seraient pas sans arbitrage humain.
   *
   * Les refus de politique (409 `SCENARIO_HAS_NO_PLAN`, ADR-0015 §3.1) ne sont PAS
   * ici : ils exigent `PlansService`, qui n'appartient pas à ce lot, et
   * `docs/07` ne tranche pas encore la rétroactivité (ADR-0015 § Décisions
   * ouvertes n°3). Ce service fournit la mécanique ; la politique viendra avec la
   * route.
   */
  async setReference(
    organizationId: string,
    projectId: string,
    scenarioId: string,
  ): Promise<ScenarioDocument> {
    const cible = await this.findScoped(organizationId, projectId, scenarioId);
    if (cible.isReference) return cible;

    await this.model
      .updateMany(
        { organizationId, projectId, isReference: true, _id: { $ne: cible._id } },
        { $set: { isReference: false } },
      )
      .exec();

    cible.isReference = true;
    await cible.save();
    return cible;
  }

  /** Met à jour libellé, description et ordre. `key` est immuable (voir le DTO). */
  async update(
    organizationId: string,
    projectId: string,
    scenarioId: string,
    patch: { label?: string; description?: string; ordre?: number },
  ): Promise<ScenarioDocument> {
    const doc = await this.findScoped(organizationId, projectId, scenarioId);
    if (patch.label !== undefined) doc.label = patch.label;
    if (patch.description !== undefined) doc.description = patch.description;
    if (patch.ordre !== undefined) doc.ordre = patch.ordre;
    await doc.save();
    return doc;
  }

  /**
   * Écrit les hypothèses d'un scénario et trace leur auteur (R2, ADR-0012 §6).
   * `updatedBy` reste optionnel pour les appels internes sans acteur, comme sur
   * `ProjectsService.updateDrivers`.
   */
  async updateDrivers(
    organizationId: string,
    projectId: string,
    scenarioId: string,
    driverValues: Record<string, number>,
    updatedBy?: string,
  ): Promise<ScenarioDocument> {
    const doc = await this.findScoped(organizationId, projectId, scenarioId);
    doc.driverValues = driverValues;
    if (updatedBy !== undefined) {
      doc.driversUpdatedBy = updatedBy;
      doc.driversUpdatedAt = new Date();
    }
    await doc.save();
    return doc;
  }

  /**
   * Supprime un scénario. Le scénario de référence est INDESTRUCTIBLE : le
   * supprimer laisserait le projet sans base de comparaison ni référence pour le
   * réalisé.
   *
   * Le second refus prévu par ADR-0015 §3.1 — `SCENARIO_HAS_APPROVED_PLAN` — exige
   * `PlansService` et relève du lot 3 ; il est posé dans la route (lot 1-B), pas
   * ici. Tant qu'il n'existe pas, ce service ne doit PAS être présenté comme
   * protégeant les scénarios porteurs d'un plan validé.
   */
  async remove(organizationId: string, projectId: string, scenarioId: string): Promise<void> {
    const doc = await this.findScoped(organizationId, projectId, scenarioId);
    if (doc.isReference) {
      throw new ConflictException({
        code: 'SCENARIO_IS_REFERENCE',
        message:
          'Le scénario de référence ne peut pas être supprimé. Désignez-en un autre au préalable.',
      });
    }
    await this.model.deleteOne({ _id: doc._id, organizationId, projectId }).exec();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Entitlements
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Refuse la création au-delà du plafond du plan (403 `PLAN_LIMIT_SCENARIOS`),
   * calqué sur `PLAN_LIMIT_PROJECTS`. Règle docs/13 : « l'interface peut
   * expliquer une limite, mais l'API l'impose ».
   */
  async assertUnderLimit(organizationId: string, projectId: string): Promise<void> {
    const { plan, entitlements } = await this.billing.getPlanEntitlements(organizationId);
    const limite = entitlements.maxScenariosPerProject;
    if (limite === null) return;
    const count = await this.countByProject(organizationId, projectId);
    if (count >= limite) {
      throw new ForbiddenException({
        code: 'PLAN_LIMIT_SCENARIOS',
        limit: limite,
        plan,
        message: `Limite de ${limite} scénario(s) par projet atteinte pour le plan ${plan}.`,
      });
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Interne
  // ───────────────────────────────────────────────────────────────────────────

  private async requireReference(
    organizationId: string,
    projectId: string,
  ): Promise<ScenarioDocument> {
    const doc = await this.findReference(organizationId, projectId);
    if (!doc) {
      // Ne peut se produire que si la référence a disparu entre l'échec d'unicité
      // et cette relecture. Échouer bruyamment vaut mieux que rendre `null` à un
      // appelant qui a demandé une garantie.
      throw new ConflictException({
        code: 'SCENARIO_REFERENCE_CONFLICT',
        message: 'Le scénario de référence est introuvable après une écriture concurrente.',
      });
    }
    return doc;
  }

  /**
   * `key` dérivée du libellé, suffixée en cas de collision (`prudent`,
   * `prudent-2`, …). La boucle est bornée : au-delà, l'appelant fournit une clé.
   */
  private async deriveKey(projectId: string, label: string): Promise<string> {
    const base = slugifyKey(label);
    if (base === null) {
      throw new ConflictException({
        code: 'SCENARIO_KEY_REQUIRED',
        message: "Le libellé ne produit aucun identifiant utilisable — fournissez une clé « key ».",
      });
    }
    const existantes = new Set(
      (await this.model.find({ projectId }, { key: 1 }).exec()).map((d) => d.key),
    );
    if (!existantes.has(base)) return base;
    for (let n = 2; n <= 50; n += 1) {
      const candidat = `${base.slice(0, 37)}-${n}`;
      if (!existantes.has(candidat)) return candidat;
    }
    throw new ConflictException({
      code: 'SCENARIO_KEY_TAKEN',
      message: `Impossible de dériver une clé libre depuis « ${label} ».`,
    });
  }
}

/** Code d'erreur applicatif porté par le corps d'une HttpException Nest. */
function codeDe(err: ConflictException): string {
  const reponse = err.getResponse();
  return typeof reponse === 'object' && reponse !== null
    ? String((reponse as { code?: unknown }).code ?? '')
    : '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Projections
// ─────────────────────────────────────────────────────────────────────────────

export function toScenarioView(doc: ScenarioDocument): ScenarioView {
  return {
    id: String(doc._id),
    organizationId: doc.organizationId,
    projectId: doc.projectId,
    key: doc.key,
    label: doc.label,
    description: doc.description ?? null,
    isReference: doc.isReference,
    driverValues: doc.driverValues ?? {},
    driversUpdatedBy: doc.driversUpdatedBy ?? null,
    driversUpdatedAt: doc.driversUpdatedAt ? doc.driversUpdatedAt.toISOString() : null,
    createdBy: doc.createdBy,
    ordre: doc.ordre,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export function toScenarioSummaryView(doc: ScenarioDocument): ScenarioSummaryView {
  const { driverValues: _dv, driversUpdatedBy: _du, driversUpdatedAt: _da, ...resume } =
    toScenarioView(doc);
  return resume;
}
