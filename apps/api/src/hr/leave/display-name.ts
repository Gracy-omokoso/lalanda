// Nom d'usage d'un collaborateur (ADR-0045 § 2.1) — sans dépendance, réutilisable
// par les lecteurs à part (« Mes tâches »). ADR-0045 — H3.

export function displayNameOf(e: {
  preferredName?: string | null;
  firstName: string;
  lastName: string;
}): string {
  return e.preferredName ?? `${e.firstName} ${e.lastName}`;
}
