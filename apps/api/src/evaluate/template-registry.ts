// Registre des templates disponibles en mémoire.
// S3-lite : hardcodé, un seul template (le jouet). Les templates réels vivront en MongoDB à partir de S4/S6.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseTemplate, type Template } from '@lalanda/engine';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Chemin résolu depuis apps/api/src/evaluate → packages/engine/src/toy-template.yaml.
// Fonctionne à la fois en dev (tsx) et en build (les paths relatifs restent stables au sein du monorepo).
const toyTemplatePath = resolve(__dirname, '../../../../packages/engine/src/toy-template.yaml');

const templates = new Map<string, Template>();

function loadTemplateFromDisk(path: string): Template {
  const yaml = readFileSync(path, 'utf8');
  return parseTemplate(yaml);
}

/** Retourne un template par slug, ou undefined s'il n'existe pas. */
export function getTemplate(slug: string): Template | undefined {
  if (templates.size === 0) {
    // Chargement paresseux au premier appel — évite de lire un fichier au démarrage inutilement.
    const toy = loadTemplateFromDisk(toyTemplatePath);
    templates.set(toy.slug, toy);
  }
  return templates.get(slug);
}

/** Liste les slugs connus. */
export function listTemplateSlugs(): string[] {
  if (templates.size === 0) getTemplate('hello-world'); // force load
  return [...templates.keys()];
}
