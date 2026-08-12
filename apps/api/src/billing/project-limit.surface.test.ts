// Où la limite de projets a le droit d'être consultée — et nulle part ailleurs.
//
// La décision « aucune antériorité » met une organisation de production à 5
// projets sur une offre qui en autorise 1. La règle non négociable est que ses
// plans financiers restent LISIBLES, EXPORTABLES et MODIFIABLES : seule la
// création est suspendue.
//
// Cette garantie ne tient pas par bonne volonté, elle tient parce qu'AUCUN
// chemin de lecture ne consulte `maxProjects`. Un test de comportement ne peut
// pas le prouver — il faudrait monter chaque route et vérifier qu'elle ne
// refuse pas, ce qui laisserait toujours la route suivante hors couverture.
// Ce test-ci vérifie la SURFACE : la liste des fichiers autorisés à mentionner
// la limite. Ajouter une consultation ailleurs (dans `reports/`, dans
// `evaluate/`, dans un futur `financial-plans/`) fait échouer la suite, et
// c'est le moment où il faut se demander si on est en train de fermer l'accès à
// un dossier bancaire en cours.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('..', import.meta.url));

/**
 * Fichiers de production autorisés à mentionner `maxProjects`, et à quel titre.
 *
 * Chemins relatifs à `apps/api/src`, séparateurs POSIX.
 */
const AUTORISES: Readonly<Record<string, string>> = {
  // La règle elle-même.
  'billing/project-limit.ts': 'porte la règle',
  // Le SEUL point de blocage : la création.
  'projects/projects.controller.ts': 'refuse la création au-delà de la limite',
  // Un commentaire sur le comptage, aucune décision.
  'projects/projects.service.ts': 'compte les projets, ne décide rien',
  // Affichage : rend le dépassement lisible, ne bloque rien.
  'organization-space/dashboard.ts': 'affiche la consommation et les dépassements',
};

function fichiersSource(dir: string, prefixe = ''): string[] {
  const out: string[] = [];
  for (const entree of readdirSync(dir)) {
    const complet = join(dir, entree);
    const relatif = prefixe ? `${prefixe}/${entree}` : entree;
    if (statSync(complet).isDirectory()) {
      out.push(...fichiersSource(complet, relatif));
    } else if (entree.endsWith('.ts') && !entree.includes('.test.')) {
      out.push(relatif);
    }
  }
  return out;
}

describe('surface de la limite de projets', () => {
  const mentions = fichiersSource(SRC).filter((f) =>
    readFileSync(join(SRC, f), 'utf8').includes('maxProjects'),
  );

  it('n’est consultée que par les fichiers qui en ont le droit', () => {
    expect([...mentions].sort()).toEqual(Object.keys(AUTORISES).sort());
  });

  it('n’est consultée par aucun chemin de lecture ou d’export', () => {
    // Formulé en négatif et par répertoire : c'est la garantie qui compte pour
    // l'utilisateur dont les 5 projets doivent rester ouvrables.
    for (const fichier of mentions) {
      for (const interdit of ['reports/', 'evaluate/', 'financial-plans/', 'exports/']) {
        expect(fichier.startsWith(interdit), `${fichier} consulte maxProjects`).toBe(false);
      }
    }
  });

  it('n’est bloquante que dans la création de projet', () => {
    // `projects.controller.ts` porte aussi la lecture, la mise à jour et
    // l'évaluation d'un projet. La limite ne doit vivre que dans `create`.
    const source = readFileSync(join(SRC, 'projects/projects.controller.ts'), 'utf8');
    const apresCreate = source.slice(source.indexOf('async create('));
    const finCreate = apresCreate.indexOf('\n  @');
    const corpsCreate = finCreate === -1 ? apresCreate : apresCreate.slice(0, finCreate);

    expect(corpsCreate).toContain('maxProjects');
    // Toutes les occurrences du fichier sont dans `create`.
    expect(corpsCreate.split('maxProjects').length).toBe(source.split('maxProjects').length);
  });
});
