// Client IA SIMULÉ pour la construction de plan — ADR-0063 § 7.
//
// Développement et démonstration seulement : actif quand `WORK_AI_PLAN_SIMULATED=on`
// ET hors production (`NODE_ENV !== 'production'`). Aucune requête réseau : il
// relit la charge utile du prompt et rend un plan Scrum plausible, au même
// format JSON que le vrai modèle, qui passe donc par les MÊMES vérifications.

import type { OpenAIChatClient } from '../ai/ai-actions.service.js';

export function simulatedPlanEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env['NODE_ENV'] !== 'production' &&
    (env['WORK_AI_PLAN_SIMULATED'] ?? '').trim().toLowerCase() === 'on'
  );
}

interface Payload {
  projet: { nom: string; livrables: string | null };
  sprints: { numero: number; debut: string; fin: string }[];
  membres: { ref: string; prenom: string }[];
  tachesMax: number;
}

function payloadOf(user: string): Payload {
  const m = /<donnees>\s*([\s\S]*?)\s*<\/donnees>/.exec(user);
  return JSON.parse(m?.[1] ?? '{}') as Payload;
}

export class SimulatedWorkPlanClient implements OpenAIChatClient {
  chatJson(args: { system: string; user: string; model: string }): Promise<string> {
    const p = payloadOf(args.user);
    const n = Math.max(1, p.sprints.length);
    const sprintAt = (ratio: number) => Math.min(n, Math.max(1, Math.round(ratio * (n - 1)) + 1));
    const livrables = (p.projet.livrables ?? '')
      .split(/[\n,;]/)
      .map((s) => s.replace(/^[-•*]\s*/, '').trim())
      .filter((s) => s !== '')
      .slice(0, 4);
    if (livrables.length === 0) livrables.push(p.projet.nom);
    const who = (i: number) => (p.membres.length ? p.membres[i % p.membres.length]!.ref : null);

    const taches: Record<string, unknown>[] = [];
    const add = (
      titre: string,
      description: string,
      sprint: number,
      h: number,
      priorite: string,
      dependDe: string[],
      etiquettes: string[],
    ) => {
      const ref = `T${taches.length + 1}`;
      taches.push({
        ref,
        titre,
        description,
        sprint,
        estimationHeures: h,
        priorite,
        dependDe,
        responsable: who(taches.length),
        etiquettes,
      });
      return ref;
    };
    const cadrage = add(
      'Cadrer le projet avec l’équipe',
      'Objectifs, rôles, rituels et définition de « terminé ».',
      1,
      4,
      'haute',
      [],
      ['Pilotage'],
    );
    const backlog = add(
      'Écrire le backlog initial',
      'Lister et prioriser les éléments à livrer.',
      1,
      6,
      'haute',
      [cadrage],
      ['Pilotage'],
    );
    const jalons: Record<string, unknown>[] = [];
    livrables.forEach((l, i) => {
      const s = sprintAt((i + 1) / (livrables.length + 1));
      const c = add(
        `Concevoir : ${l}`,
        `Préciser le contenu attendu et les critères d’acceptation de « ${l} ».`,
        Math.max(1, s - 1 || 1),
        8,
        'haute',
        [backlog],
        ['Conception'],
      );
      const r = add(
        `Réaliser : ${l}`,
        `Produire « ${l} » par incréments démontrables.`,
        s,
        16,
        'moyenne',
        [c],
        ['Réalisation'],
      );
      const v = add(
        `Faire valider : ${l}`,
        'Revue de sprint avec la dirigeante ; corrections.',
        s,
        4,
        'moyenne',
        [r],
        ['Recette'],
      );
      jalons.push({ ref: `J${i + 1}`, titre: `${l} validé`, sprint: s, dependDe: [v] });
    });
    const recette = add(
      'Recette finale et corrections',
      'Vérifier l’ensemble avant la mise en service.',
      n,
      8,
      'haute',
      taches.slice(-1).map((t) => String(t['ref'])),
      ['Recette'],
    );
    add(
      'Préparer la mise en service',
      'Communication, formation de l’équipe, passage en production.',
      n,
      6,
      'urgente',
      [recette],
      ['Lancement'],
    );
    add(
      'Rétrospective du projet',
      'Ce qui a marché, ce qui est à améliorer.',
      n,
      2,
      'basse',
      [],
      ['Pilotage'],
    );
    jalons.push({
      ref: `J${jalons.length + 1}`,
      titre: 'Livraison finale',
      sprint: n,
      dependDe: [recette],
    });

    const sprints = Array.from({ length: n }, (_, i) => ({
      numero: i + 1,
      objectif:
        i === 0
          ? 'Cadrer et préparer le backlog'
          : i === n - 1
            ? 'Recette, mise en service et rétrospective'
            : `Livrer un incrément démontrable (${livrables[Math.min(i - 1, livrables.length - 1)]})`,
    }));
    return Promise.resolve(
      JSON.stringify({
        resume: `Plan en ${n} sprint${n > 1 ? 's' : ''} pour « ${p.projet.nom} » : cadrage, livraisons successives validées en revue de sprint, puis recette et mise en service.`,
        sprints,
        jalons: jalons.slice(0, 8),
        taches: taches.slice(0, p.tachesMax),
      }),
    );
  }
}
