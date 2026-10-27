// Schéma Zod d'un ParameterPack — paramètres fiscaux/comptables par pays × année.
//
// Un template sectoriel est fiscalement neutre : ses formules font appel à des drivers
// classiques (couverts_jour, food_cost_pct, …) ET à des paramètres fiscaux (ibp_taux,
// tva_taux, cnss_employeur_pct, …). Ces derniers sont pré-remplis par le ParameterPack
// attaché au projet, mais restent des drivers "normaux" du point de vue du moteur
// — l'utilisateur peut donc les visualiser et les surcharger.
//
// Précédence lors de l'évaluation (du plus fort au plus faible) :
//   1. valeurs fournies dans la requête utilisateur (driverValues explicites)
//   2. paramètres du ParameterPack
//   3. `defaut` déclaré par le template

import { z } from 'zod';

const IdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, 'identifiant invalide (attendu : ^[a-z][a-z0-9_]*$)');

const SlugSchema = z
  .string()
  .min(1)
  .regex(/^[a-z][a-z0-9-]*$/, 'slug invalide (attendu : ^[a-z][a-z0-9-]*$)');

/**
 * Un paramètre du pack, avec une valeur numérique et des métadonnées d'audit.
 * Le champ `a_confirmer` est CRITIQUE : il porte le doute et sera affiché dans le PDF
 * pour ne pas induire un banquier en erreur.
 */
const ParamSchema = z
  .object({
    valeur: z.number(),
    unite: z.string().optional(),
    aide: z.string().optional(),
    source: z.string().optional(),
    a_confirmer: z.boolean().default(false),
  })
  .strict();

export type Param = z.infer<typeof ParamSchema>;

/**
 * Révision en place d'un pack — erratum tracé (ADR-0021 §7, docs/09).
 *
 * La révision 1 est implicite (le pack tel que publié). Une révision n'est
 * admise que pour corriger un paramètre qu'AUCUN modèle ne consomme : un plan
 * reste alors strictement reproductible, et l'empreinte (`packVersion` = l'année)
 * ne change pas. `parametres` nomme les paramètres corrigés : c'est ce que lit le
 * test verrou, qui tombe le jour où un modèle consommerait l'un d'eux — une
 * correction devra alors passer par une vraie nouvelle version.
 */
const RevisionSchema = z
  .object({
    numero: z.number().int().min(2),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date attendue au format AAAA-MM-JJ'),
    objet: z.string().min(10),
    parametres: z.array(IdSchema).min(1),
  })
  .strict();

export type ParameterPackRevision = z.infer<typeof RevisionSchema>;

/**
 * Un ParameterPack cible un pays (ISO-2), une année de référence et un système comptable.
 * Le slug par convention = `<pays>-<annee>` (ex. `cd-2026`) ou `<zone>-<annee>` (ex. `ohada-generic-2026`).
 */
export const ParameterPackSchema = z
  .object({
    slug: SlugSchema,
    pays: z.string().length(2),
    /** Liste ISO-2 des pays supplémentaires couverts (packs génériques de zone). */
    pays_couverts: z.array(z.string().length(2)).optional(),
    annee: z.number().int().min(2000).max(2100),
    systeme_comptable: z.enum(['syscohada-revise-2017', 'ifrs', 'pcg-france']),
    devise_principale: z.enum(['USD', 'CDF', 'XOF', 'XAF', 'EUR']),
    /** Second choix d'affichage (ex. RDC : USD principal + CDF secondaire). */
    devise_secondaire: z.enum(['USD', 'CDF', 'XOF', 'XAF', 'EUR']).optional(),
    label: z.string().min(1),
    description: z.string().optional(),
    /** Table des paramètres, clé = identifiant (ex. `ibp_taux`), valeur = Param. */
    params: z.record(IdSchema, ParamSchema),
    /** Errata en place, numérotés à partir de 2 (voir `RevisionSchema`). */
    revisions: z.array(RevisionSchema).optional(),
    /** Note d'avertissement légal — affichée dans le PDF. */
    avertissement: z.string().optional(),
  })
  .strict();

export type ParameterPack = z.infer<typeof ParameterPackSchema>;

/** Vue publique légère pour listing UI (sans les params). */
export interface ParameterPackSummary {
  slug: string;
  pays: string;
  pays_couverts?: string[];
  annee: number;
  systeme_comptable: ParameterPack['systeme_comptable'];
  devise_principale: ParameterPack['devise_principale'];
  devise_secondaire?: ParameterPack['devise_secondaire'];
  label: string;
  description?: string;
}

export function toSummary(pack: ParameterPack): ParameterPackSummary {
  return {
    slug: pack.slug,
    pays: pack.pays,
    pays_couverts: pack.pays_couverts,
    annee: pack.annee,
    systeme_comptable: pack.systeme_comptable,
    devise_principale: pack.devise_principale,
    devise_secondaire: pack.devise_secondaire,
    label: pack.label,
    description: pack.description,
  };
}

/**
 * Aplati un pack en Record<paramId, number> — utilisable directement comme merge
 * partiel de driverValues à l'évaluation.
 */
export function packToDriverValues(pack: ParameterPack): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(pack.params)) {
    out[k] = v.valeur;
  }
  return out;
}
