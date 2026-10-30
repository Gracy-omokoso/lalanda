// Rappel du double comptage salaire + coût du temps (ADR-0045 § 6.3) — lot H7.
// Logique pure.
//
// La marge d'un projet soustrait déjà le coût du temps saisi (taux horaires) ; y
// rattacher aussi une dépense « personnel » compte deux fois la même personne. Rien
// n'est retranché automatiquement : le formulaire le rappelle, la marge lève le
// constat `PERSONNEL_EXPENSES_AND_TIME_COST`.

export const CATEGORIE_PERSONNEL = 'personnel';

export const RAPPEL_PERSONNEL_PROJET =
  'Attention au double comptage : la marge de ce projet compte déjà le coût du temps saisi par l’équipe. Rattacher aussi un salaire au projet compte deux fois la même personne. Lalanda ne retranche rien seul ; la marge du projet le signalera.';

/** Le rappel s'affiche pour une dépense « personnel » rattachée à un projet. */
export function rappelPersonnel(categorie: string, workProjectId: string): string | null {
  return categorie === CATEGORIE_PERSONNEL && workProjectId.trim() !== ''
    ? RAPPEL_PERSONNEL_PROJET
    : null;
}
