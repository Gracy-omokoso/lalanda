// Détection de cycle sur le graphe des lignes (drivers = feuilles).
// Algorithme : DFS avec coloration WHITE/GRAY/BLACK.
// - WHITE : non visité.
// - GRAY  : en cours de visite (dans la pile d'appels).
// - BLACK : entièrement exploré.
// Un back-edge vers un nœud GRAY révèle un cycle ; on remonte la pile pour l'afficher.

import { CycleError } from '../dsl/errors.js';

type Color = 'WHITE' | 'GRAY' | 'BLACK';

/**
 * @param edges  Map d'un id de ligne vers l'ensemble des ids de lignes qu'elle référence.
 *               Les références vers des drivers sont exclues par l'appelant (drivers = feuilles du graphe).
 */
export function assertAcyclic(edges: ReadonlyMap<string, ReadonlySet<string>>): void {
  const color = new Map<string, Color>();
  for (const id of edges.keys()) color.set(id, 'WHITE');

  const stack: string[] = [];

  const visit = (node: string): void => {
    color.set(node, 'GRAY');
    stack.push(node);
    for (const next of edges.get(node) ?? []) {
      if (!edges.has(next)) continue; // ref hors du graphe (déjà validée ailleurs)
      const c = color.get(next);
      if (c === 'GRAY') {
        // cycle : construit le chemin depuis `next` jusqu'à la fin de la pile puis reboucle sur `next`.
        const cycleStart = stack.indexOf(next);
        const path = stack.slice(cycleStart).concat(next);
        throw new CycleError(path);
      }
      if (c === 'WHITE') visit(next);
    }
    stack.pop();
    color.set(node, 'BLACK');
  };

  for (const node of edges.keys()) {
    if (color.get(node) === 'WHITE') visit(node);
  }
}
