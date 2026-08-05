// Registre en mémoire des ParameterPacks disponibles. Même pattern que template-registry :
// hardcodé S9-lite, MongoDB à partir de S12+ (packs signés + versionnés en base).

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseParameterPack, type ParameterPack } from '@lalanda/engine';

const __dirname = dirname(fileURLToPath(import.meta.url));

const packFiles: Record<string, string> = {
  'cd-2026': resolve(__dirname, '../../../../packages/engine/src/parameter-packs/cd-2026.yaml'),
  'ci-2026': resolve(__dirname, '../../../../packages/engine/src/parameter-packs/ci-2026.yaml'),
  'sn-2026': resolve(__dirname, '../../../../packages/engine/src/parameter-packs/sn-2026.yaml'),
  'ohada-generic-2026': resolve(
    __dirname,
    '../../../../packages/engine/src/parameter-packs/ohada-generic-2026.yaml',
  ),
};

const packs = new Map<string, ParameterPack>();

function loadAll(): void {
  if (packs.size > 0) return;
  for (const [slug, path] of Object.entries(packFiles)) {
    const yaml = readFileSync(path, 'utf8');
    const parsed = parseParameterPack(yaml);
    if (parsed.slug !== slug) {
      throw new Error(
        `ParameterPack registry mismatch: ${path} déclare "${parsed.slug}" mais est enregistré comme "${slug}"`,
      );
    }
    packs.set(slug, parsed);
  }
}

/** Récupère un pack par slug, ou `undefined` si absent. */
export function getParameterPack(slug: string): ParameterPack | undefined {
  loadAll();
  return packs.get(slug);
}

/** Liste tous les slugs de packs enregistrés. */
export function listParameterPackSlugs(): string[] {
  loadAll();
  return [...packs.keys()];
}

/** Vue résumée de tous les packs (sans les params complets). */
export function listParameterPackSummaries(): Array<{
  slug: string;
  pays: string;
  pays_couverts?: string[];
  annee: number;
  systeme_comptable: string;
  devise_principale: string;
  devise_secondaire?: string;
  label: string;
  description?: string;
}> {
  loadAll();
  return [...packs.values()].map((p) => ({
    slug: p.slug,
    pays: p.pays,
    pays_couverts: p.pays_couverts,
    annee: p.annee,
    systeme_comptable: p.systeme_comptable,
    devise_principale: p.devise_principale,
    devise_secondaire: p.devise_secondaire,
    label: p.label,
    description: p.description,
  }));
}

/**
 * Trouve le pack le plus récent (annee max) couvrant un pays donné.
 * D'abord match exact sur `pays`, puis fallback sur `pays_couverts` (packs génériques),
 * enfin fallback sur `ohada-generic-{max annee}`.
 */
export function findDefaultPackForCountry(paysIso2: string): ParameterPack | undefined {
  loadAll();
  const all = [...packs.values()];
  const exact = all.filter((p) => p.pays === paysIso2).sort((a, b) => b.annee - a.annee);
  if (exact[0]) return exact[0];
  const covered = all
    .filter((p) => p.pays_couverts?.includes(paysIso2))
    .sort((a, b) => b.annee - a.annee);
  if (covered[0]) return covered[0];
  return all
    .filter((p) => p.slug.startsWith('ohada-generic-'))
    .sort((a, b) => b.annee - a.annee)[0];
}
