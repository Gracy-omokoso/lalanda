// Registre des templates disponibles en mémoire.
// S3-lite : hardcodé, un seul template (le jouet).
// S6-lite : 3 templates sectoriels de lancement ajoutés (restaurant-kinshasa,
// quincaillerie-negoce, prestation-services — brief §8). Les manifests vivent
// dans packages/engine/src/templates/*.yaml.
// S19b : ajout du template e-commerce à paiement à la livraison (ecommerce-cod).
// Les templates réels vivront en MongoDB à partir de S7 (voir @lalanda/templates/README.md).

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseTemplate, type Template } from '@lalanda/engine';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Chemins résolus depuis apps/api/src/evaluate → packages/engine/src/*.
// Fonctionne à la fois en dev (tsx) et en build : les paths relatifs restent stables au sein du monorepo.
const templateFiles: Record<string, string> = {
  'hello-world': resolve(__dirname, '../../../../packages/engine/src/toy-template.yaml'),
  'restaurant-kinshasa': resolve(
    __dirname,
    '../../../../packages/engine/src/templates/restaurant-kinshasa.yaml',
  ),
  'quincaillerie-negoce': resolve(
    __dirname,
    '../../../../packages/engine/src/templates/quincaillerie-negoce.yaml',
  ),
  'prestation-services': resolve(
    __dirname,
    '../../../../packages/engine/src/templates/prestation-services.yaml',
  ),
  'ecommerce-cod': resolve(
    __dirname,
    '../../../../packages/engine/src/templates/ecommerce-cod.yaml',
  ),
};

const templates = new Map<string, Template>();

function loadAll(): void {
  if (templates.size > 0) return;
  for (const [slug, path] of Object.entries(templateFiles)) {
    const yaml = readFileSync(path, 'utf8');
    const parsed = parseTemplate(yaml);
    if (parsed.slug !== slug) {
      // Garde-fou : si le slug du YAML diverge du slug enregistré, on refuse au démarrage
      // — sinon getTemplate('restaurant-kinshasa') retournerait un template au mauvais slug.
      throw new Error(
        `Template registry mismatch: fichier ${path} déclare slug "${parsed.slug}" mais est enregistré comme "${slug}"`,
      );
    }
    templates.set(slug, parsed);
  }
}

/** Retourne un template par slug, ou undefined s'il n'existe pas. */
export function getTemplate(slug: string): Template | undefined {
  loadAll();
  return templates.get(slug);
}

/** Liste les slugs connus, dans l'ordre d'enregistrement. */
export function listTemplateSlugs(): string[] {
  loadAll();
  return [...templates.keys()];
}

/**
 * Liste les templates avec leurs métadonnées d'affichage — utilisé par l'UI de
 * création de projet (S6) pour afficher un sélecteur avec secteur et description.
 */
export interface TemplateSummary {
  slug: string;
  version: string;
  secteur?: string;
  pays?: string[];
  devise_base?: string;
  horizon_mois?: number;
}

export function listTemplateSummaries(): TemplateSummary[] {
  loadAll();
  return [...templates.values()].map((t) => ({
    slug: t.slug,
    version: t.version,
    secteur: t.secteur,
    pays: t.pays,
    devise_base: t.devise_base,
    horizon_mois: t.horizon_mois,
  }));
}
