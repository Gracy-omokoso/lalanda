import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/**
 * Scénario — un jeu d'hypothèses COMPLET pour un projet (ADR-0015 §1.1).
 *
 * ── Pourquoi une collection dédiée, et pas un sous-document du projet ─────────
 *
 * L'autosave du wizard écrit les hypothèses toutes les 800 ms. Deux membres
 * travaillant sur deux scénarios d'un même projet écriraient le MÊME document
 * projet : dernier arrivé, dernier servi, perte silencieuse. Un document par
 * scénario isole les écritures concurrentes. C'est aussi la forme que
 * `docs/15-DATABASE.md:73-74` prescrit (« scénarios par projet »).
 *
 * ── Pourquoi `driverValues` COMPLET, et pas un delta sur une base ────────────
 *
 * ADR-0015 § Options B, rejetée : un stockage différentiel rendrait l'empreinte
 * SHA-256 du plan validé ambiguë et ferait varier le résultat d'un scénario sans
 * que personne ne l'ait touché — un chiffre montré à une banque changerait tout
 * seul. `docs/07-PLAN-FINANCIER.md:54` dit d'ailleurs que les scénarios
 * « possèdent leurs propres entrées ».
 *
 * ── Ce qu'un scénario ne peut PAS changer ────────────────────────────────────
 *
 * Ni `templateSlug`, ni `parameterPackSlug`, ni `pays` : ces trois champs restent
 * sur le projet. Comparer deux scénarios calculés sous deux packs fiscaux
 * différents n'est pas une comparaison (ADR-0015 §1.1).
 *
 * ── Pas d'état ───────────────────────────────────────────────────────────────
 *
 * `docs/22-WORKFLOWS.md:11-15` décrit `draft → ready → calculating → calculated
 * → approved`. Ce cycle suppose un calcul asynchrone qui n'existe pas.
 * Décision ADR-0015 §1.6 : le scénario est toujours modifiable ; l'état figé vit
 * sur `FinancialPlan` (`approved → superseded`), là où il est déjà.
 */
@Schema({ collection: 'scenarios', timestamps: true, strict: true })
export class Scenario {
  /** Isolation tenant — comme partout ailleurs. */
  @Prop({ type: String, required: true, index: true })
  organizationId!: string;

  @Prop({ type: String, required: true, index: true })
  projectId!: string;

  /**
   * Slug stable, cité dans les URL web (`?scenario=<key>`) et figé dans les plans
   * validés (`FinancialPlan.scenarioKey`, lot 3). Immuable après création : le
   * renommage porte sur `label`, jamais sur `key`.
   */
  @Prop({
    type: String,
    required: true,
    match: /^[a-z][a-z0-9-]*$/,
    maxlength: 40,
  })
  key!: string;

  /** Libellé affiché et exporté. Libre — voir ADR-0015 § Décisions ouvertes n°8. */
  @Prop({ type: String, required: true, trim: true, maxlength: 120 })
  label!: string;

  /** « Ce qui change et pourquoi ». */
  @Prop({ type: String, maxlength: 500 })
  description?: string;

  /**
   * Scénario de référence du projet — UN SEUL, garanti par l'index partiel
   * déclaré plus bas et non par du code applicatif (ADR-0015 §1.2).
   *
   * Un seul concept, pas deux : c'est simultanément la base de comparaison par
   * défaut, la référence des écarts du réalisé, la référence du taux d'atteinte
   * des objectifs, et le scénario servi aux routes existantes sans `scenarioId`.
   */
  @Prop({ type: Boolean, required: true, default: false })
  isReference!: boolean;

  /** `Record<string, number>` — mêmes clés que `Project.driverValues`. */
  @Prop({ type: Object, default: {} })
  driverValues!: Record<string, number>;

  /**
   * Dernier auteur d'une écriture d'hypothèses SUR CE SCÉNARIO — socle de la
   * séparation des tâches dynamique (R2, ADR-0012 §6). Migre depuis
   * `Project.driversUpdatedBy` ; le lot 3 le lira à la place de celui du projet.
   *
   * `null` = auteur inconnu, traité comme « séparé » faute de preuve du
   * contraire (même règle que sur le projet depuis S20a).
   */
  @Prop({ type: String, default: null })
  driversUpdatedBy!: string | null;

  @Prop({ type: Date, default: null })
  driversUpdatedAt!: Date | null;

  @Prop({ type: String, required: true })
  createdBy!: string;

  /** Ordre d'affichage et de colonnes dans la comparaison. */
  @Prop({ type: Number, required: true, default: 0 })
  ordre!: number;

  /** Convention ADR-0004. */
  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  // Champs auto-ajoutés par `timestamps: true`. Déclarés pour le typage.
  createdAt!: Date;
  updatedAt!: Date;
}

export type ScenarioDocument = HydratedDocument<Scenario>;
export const ScenarioSchema = SchemaFactory.createForClass(Scenario);

/** Clé fonctionnelle : une `key` ne se répète pas dans un projet. */
ScenarioSchema.index({ projectId: 1, key: 1 }, { unique: true });

/** Lecture ordonnée « les scénarios de ce projet », scopée par tenant. */
ScenarioSchema.index({ organizationId: 1, projectId: 1, ordre: 1 });

/**
 * L'INVARIANT CENTRAL d'ADR-0015 §1.1 : un projet a AU PLUS un scénario de
 * référence, garanti par la base.
 *
 * L'index est UNIQUE et PARTIEL. Le filtre partiel est ce qui rend la
 * combinaison possible : sans lui, un index unique sur `{ projectId, isReference }`
 * interdirait à un projet d'avoir deux scénarios `isReference: false`,
 * c'est-à-dire interdirait d'avoir plus de deux scénarios. Avec le filtre, seuls
 * les documents `isReference: true` entrent dans l'index — les autres en sont
 * absents et ne se gênent pas.
 *
 * Pourquoi la base et pas le code : un « vérifier puis écrire » applicatif est
 * une course perdue d'avance sous deux requêtes concurrentes. Ici la deuxième
 * écriture échoue en E11000, et il n'existe aucun chemin — route, migration,
 * script d'exploitation, réparation manuelle — capable de la contourner.
 *
 * Corollaire assumé : la promotion d'un nouveau scénario en référence ne peut PAS
 * être un simple `$set` ; il faut démettre l'ancien d'abord (voir
 * `ScenariosService.setReference`).
 */
ScenarioSchema.index(
  { projectId: 1, isReference: 1 },
  { unique: true, partialFilterExpression: { isReference: true } },
);
