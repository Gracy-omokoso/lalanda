// Empreinte déterministe des entrées d'un plan financier (S16c — FIN-003).
//
// Objectif : détecter qu'une validation repartirait exactement des mêmes entrées
// (drivers résolus + template + pack + version moteur) que le dernier plan approuvé.
// Dans ce cas on refuse de créer une nouvelle version (409 PLAN_UNCHANGED) : un
// chiffre déjà montré à une banque ne doit jamais être « re-figé » sous un autre numéro.
//
// Le JSON est canonique (clés triées récursivement) pour que l'empreinte ne dépende
// pas de l'ordre d'insertion des propriétés.

import { createHash } from 'node:crypto';

/** Entrées couvertes par l'empreinte. Tout changement de l'une invalide l'empreinte. */
export interface PlanFingerprintInput {
  /** Drivers RÉSOLUS (user > pack > défaut template) — capture l'entrée réelle du moteur. */
  driverValues: Record<string, number>;
  templateSlug: string;
  templateVersion: string;
  parameterPackSlug?: string;
  /** Version du pack — aujourd'hui l'année de référence (ex. "2026"), les packs n'ayant pas encore de semver. */
  packVersion?: string;
  engineVersion: string;
}

/**
 * Sérialisation JSON canonique : clés d'objets triées récursivement.
 * Les tableaux gardent leur ordre (significatif). Les `undefined` sont omis
 * (comportement JSON.stringify standard).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** SHA-256 hex du JSON canonique des entrées. */
export function computePlanFingerprint(input: PlanFingerprintInput): string {
  const canonical = canonicalJson({
    driverValues: input.driverValues,
    templateSlug: input.templateSlug,
    templateVersion: input.templateVersion,
    parameterPackSlug: input.parameterPackSlug ?? null,
    packVersion: input.packVersion ?? null,
    engineVersion: input.engineVersion,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
