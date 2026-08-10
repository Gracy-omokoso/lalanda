'use client';

// Chargement commun aux deux vues d'un projet (S23a) : saisie et résultats.
//
// L'éclatement du wizard et des feuilles de résultats en deux écrans crée un
// besoin nouveau : les deux ont besoin du projet, de son template et de ses
// hypothèses effectives, mais plus au même moment ni pour le même usage. Ce
// hook porte cette partie commune pour qu'une seule règle décide de ce que
// « les hypothèses courantes » veut dire — un écart entre les deux vues
// afficherait des chiffres qui ne correspondent pas à la saisie.

import { useCallback, useEffect, useState } from 'react';

import { api, type ProjectView, type TemplateMeta } from '@/lib/api';

export interface ProjectContext {
  project: ProjectView | null;
  template: TemplateMeta | null;
  /** Défauts du DSL écrasés par les valeurs persistées du projet. */
  values: Record<string, number>;
  /** `true` une fois projet, template et valeurs en place. */
  ready: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

/**
 * Hypothèses effectives : défauts déclarés par le template, écrasés par ce que
 * le projet a persisté. Le moteur reste la source des défauts — l'interface ne
 * fabrique aucune valeur.
 */
export function effectiveDriverValues(
  template: TemplateMeta,
  project: ProjectView,
): Record<string, number> {
  const defaults = Object.fromEntries(template.drivers.map((d) => [d.id, d.defaut ?? 0]));
  return { ...defaults, ...project.driverValues };
}

/**
 * `true` si l'utilisateur n'a encore rien saisi : le projet ne porte aucune
 * valeur propre et tout ce qui s'affiche vient du modèle sectoriel. Les chiffres
 * sont calculables, mais ce ne sont pas les siens — la vue résultats doit le
 * dire plutôt que de laisser croire à un prévisionnel personnel.
 */
export function isUntouched(project: ProjectView): boolean {
  return Object.keys(project.driverValues).length === 0;
}

export function useProjectContext(projectId: string): ProjectContext {
  const [project, setProject] = useState<ProjectView | null>(null);
  const [template, setTemplate] = useState<TemplateMeta | null>(null);
  const [values, setValues] = useState<Record<string, number>>({});
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const p = await api.getProject(projectId);
      const { template: tmpl } = await api.getTemplate(p.templateSlug);
      // Ces `set` sont dans le même tick : les consommateurs voient un état
      // cohérent, jamais un template sans ses valeurs.
      setProject(p);
      setTemplate(tmpl);
      setValues(effectiveDriverValues(tmpl, p));
      setReady(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement');
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { project, template, values, ready, error, reload };
}
