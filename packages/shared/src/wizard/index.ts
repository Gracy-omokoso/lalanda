// Résolution des étapes du wizard de saisie (S18c) — implémentation UNIQUE, partagée
// par le moteur (`packages/engine/src/dsl/schema.ts`) et le web
// (`apps/web/.../wizard-model.ts`), qui dépendent tous deux de @lalanda/shared.
//
// Elle vivait en double au départ ; la duplication est supprimée pour que les deux
// côtés ne puissent pas diverger (revue CTO S18c, point I5).
//
// Purement présentationnel : aucune règle financière ici. Le module est volontairement
// sans dépendance (ni zod ni pino) pour rester embarquable dans un bundle navigateur.

/** Groupe virtuel qui porte tous les drivers quand le template ne déclare aucun groupe. */
export const GROUPE_TOUS = '_all';

/** Étape telle que déclarée dans le bloc `wizard` du template. */
export interface WizardEtapeInput {
  id: string;
  label: string;
  description?: string;
  groupes: readonly string[];
  ordre?: number;
}

/** Groupe d'hypothèses tel que déclaré par le template. */
export interface WizardGroupeInput {
  id: string;
  label: string;
}

/** Étape prête à afficher : ordre appliqué, groupes garantis existants. */
export interface ResolvedEtape {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly groupes: readonly string[];
}

/**
 * Calcule la liste ordonnée des étapes de saisie.
 *
 * Règles (présentation uniquement, aucun impact sur les calculs) :
 * 1. étapes déclarées → triées par `ordre` croissant, celles sans `ordre` conservant
 *    leur ordre de déclaration et passant en dernier;
 * 2. un groupe référencé mais inexistant est **ignoré silencieusement**, et une étape
 *    dont plus aucun groupe ne subsiste est écartée. Une clé de présentation ne doit
 *    jamais faire tomber le parsing ni l'évaluation d'un template (ADR-0011,
 *    Contrat 3) : la cohérence stricte est vérifiée par un test de lint sur les
 *    templates livrés, pas à l'exécution;
 * 3. tout groupe non rattaché à une étape est ajouté en fin de liste comme étape
 *    autonome — un groupe ajouté au template reste toujours saisissable;
 * 4. aucune étape déclarée (ou toutes écartées) → fallback « une étape par groupe »;
 * 5. aucun groupe non plus → une unique étape `hypotheses` portant {@link GROUPE_TOUS}.
 */
export function resolveWizardEtapes(
  groupes: readonly WizardGroupeInput[],
  etapes: readonly WizardEtapeInput[],
): ResolvedEtape[] {
  const connus = new Set(groupes.map((g) => g.id));

  const ordered = etapes
    .map((e, index) => ({ e, index }))
    .sort((a, b) => {
      const oa = a.e.ordre ?? Number.POSITIVE_INFINITY;
      const ob = b.e.ordre ?? Number.POSITIVE_INFINITY;
      return oa === ob ? a.index - b.index : oa - ob;
    })
    .map(({ e }): ResolvedEtape => {
      const retenus = e.groupes.filter((g) => connus.has(g));
      const base: ResolvedEtape = { id: e.id, label: e.label, groupes: retenus };
      return e.description === undefined ? base : { ...base, description: e.description };
    })
    .filter((e) => e.groupes.length > 0);

  if (ordered.length === 0) {
    if (groupes.length === 0) {
      return [{ id: 'hypotheses', label: 'Hypothèses', groupes: [GROUPE_TOUS] }];
    }
    return groupes.map((g) => ({ id: g.id, label: g.label, groupes: [g.id] }));
  }

  const couverts = new Set(ordered.flatMap((e) => e.groupes));
  const orphelins = groupes.filter((g) => !couverts.has(g.id));
  return [...ordered, ...orphelins.map((g) => ({ id: g.id, label: g.label, groupes: [g.id] }))];
}

/**
 * Groupes référencés par une étape mais absents de `groupes_hypotheses`.
 *
 * Sert au test de lint des templates livrés : à l'exécution ces références sont
 * ignorées ({@link resolveWizardEtapes}), mais dans le dépôt elles signalent un bloc
 * `wizard` désynchronisé après un renommage de groupe — à corriger avant merge.
 */
export function findUnknownWizardGroupes(
  groupes: readonly WizardGroupeInput[],
  etapes: readonly WizardEtapeInput[],
): { etapeId: string; groupeId: string }[] {
  const connus = new Set(groupes.map((g) => g.id));
  return etapes.flatMap((e) =>
    e.groupes.filter((g) => !connus.has(g)).map((groupeId) => ({ etapeId: e.id, groupeId })),
  );
}
