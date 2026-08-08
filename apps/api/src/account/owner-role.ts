// Résolution du rôle « propriétaire » pour l'espace compte (S20b).
//
// ───────────────────────────────────────────────────────────────────────────────
// POURQUOI CE FICHIER EXISTE, ET CE QU'IL FAUDRA EN FAIRE AU REBASE.
//
// La règle « un dernier propriétaire ne peut pas supprimer son compte » (docs/12
// § Règles critiques) a besoin de savoir quel rôle est « propriétaire ». Cette
// information appartiendra à `apps/api/src/auth/permissions.ts` — fichier créé
// par la refonte RBAC (ADR-0012 §9), qui N'EST PAS ENCORE MERGÉE. L'ADR interdit
// par ailleurs au dev de l'espace compte de toucher `membership.schema.ts` ou
// `auth/**`.
//
// Dépendre aujourd'hui de types qui n'existent pas rendrait ce lot immergeable ;
// dupliquer les huit slugs de rôles créerait une seconde source de vérité qui se
// désynchroniserait au premier ajout de rôle. On isole donc ICI, dans un seul
// fichier de dix lignes, le seul fait dont l'espace compte a besoin :
//
//     le rôle propriétaire a pour slug `owner`.
//
// Ce fait est STABLE d'après ADR-0012 §7 : la migration `owner | member` →
// 8 rôles convertit `member` en `finance_director` et laisse `owner` INCHANGÉ.
// Le code ci-dessous est donc correct avant comme après la migration.
//
// POINT DE REBASE (à traiter quand la PR RBAC est mergée) : remplacer
// `OWNER_ROLE` par l'import de la constante correspondante de `permissions.ts`
// et supprimer ce fichier. Le test associé (`owner-role.test.ts`) documente les
// cas à conserver.
// ───────────────────────────────────────────────────────────────────────────────

/** Slug du rôle propriétaire d'une organisation (ADR-0012 §1, libellé « Propriétaire »). */
export const OWNER_ROLE = 'owner';

/**
 * Ce rôle est-il celui d'un propriétaire ?
 *
 * Défensif à dessein : la valeur vient de la base, pas d'un type. Une casse
 * inattendue ou des espaces de bord ne doivent pas faire passer un propriétaire
 * pour un simple membre — ce serait autoriser la suppression d'un compte qui
 * laisserait derrière lui une organisation sans gouvernance, exactement ce que
 * la règle interdit. L'erreur silencieuse est ici plus grave que le refus.
 */
export function isOwnerRole(role: unknown): boolean {
  return typeof role === 'string' && role.trim().toLowerCase() === OWNER_ROLE;
}
