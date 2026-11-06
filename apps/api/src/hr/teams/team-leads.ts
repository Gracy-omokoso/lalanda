// Responsable d'équipe et validation RH de son équipe — ADR-0066 § 1 (tranche la
// décision ouverte n° 4 d'ADR-0059).
//
// Le responsable (`leadUserId`) d'une équipe RH (`hr_teams`, ADR-0060) tient l'étape
// « manager » des absences, des notes de frais et des avances de frais des AUTRES
// membres de son équipe, comme le manager désigné de leur fiche. Ce n'est pas une
// action de la matrice : c'est une RELATION, lue à CHAQUE requête (aucun cache) —
// quitter l'équipe, en perdre la responsabilité ou supprimer l'équipe retire le droit
// immédiatement. Le responsable n'est jamais compté parmi « ses » membres : il ne
// valide jamais sa propre demande par ce chemin.
//
// LECTURE SEULE de `hr_teams` par la connexion (motif de `work-access.ts`) : ce
// fichier n'importe aucun service et peut être lu par les lecteurs sans `HrViewer`
// (« Mes tâches », brief du matin).

import type { Connection } from 'mongoose';

const HR_TEAMS = 'hr_teams';

/** Équipes lues au plus pour une personne (borne de sûreté ; 200 par organisation). */
const TEAMS_SCAN_MAX = 200;

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Comptes des membres des équipes dont `leadUserId` est responsable, LUI EXCLU.
 * Vide s'il ne dirige aucune équipe.
 */
export async function usersLedBy(
  connection: Connection,
  organizationId: string,
  leadUserId: string,
): Promise<Set<string>> {
  const rows = await connection
    .collection(HR_TEAMS)
    .find({ organizationId, leadUserId }, { projection: { memberUserIds: 1 } })
    .limit(TEAMS_SCAN_MAX)
    .toArray();
  const out = new Set<string>();
  for (const row of rows) {
    for (const id of stringsOf(row['memberUserIds'])) if (id !== leadUserId) out.add(id);
  }
  return out;
}

/**
 * Responsables des équipes dont `memberUserId` est membre, LUI EXCLU (un responsable
 * n'est pas son propre validateur). Destinataires de la notification « à valider ».
 */
export async function teamLeadsOf(
  connection: Connection,
  organizationId: string,
  memberUserId: string | null,
): Promise<string[]> {
  if (memberUserId === null) return [];
  const rows = await connection
    .collection(HR_TEAMS)
    .find(
      { organizationId, memberUserIds: memberUserId, leadUserId: { $type: 'string' } },
      { projection: { leadUserId: 1 } },
    )
    .limit(TEAMS_SCAN_MAX)
    .toArray();
  const out = new Set<string>();
  for (const row of rows) {
    const lead = row['leadUserId'];
    if (typeof lead === 'string' && lead !== memberUserId) out.add(lead);
  }
  return [...out];
}
