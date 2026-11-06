# ADR-0060 — Équipes, membres d'un projet et visibilité des projets

Statut : **Proposé** (besoin validé par la dirigeante le 5 nov. 2026 ; à valider sur les captures
`docs/refonte-ui/v5/`)
Date : 2026-11-05
Décideur : Gracy Omokoso (dirigeante de Go freelance SARLU).

> Tranche la **décision ouverte n° 2 d'[ADR-0039](ADR-0039-projets-et-taches-run.md)** (O7, projets
> privés « reportés ») et réserve le champ `visibility` qu'ADR-0039 avait prévu « pour ouvrir
> `members` plus tard sans migration ». S'appuie sur [ADR-0045](ADR-0045-ressources-humaines.md)
> (module RH, actions `hr.read` / `hr.manage`) et [ADR-0012](ADR-0012-modele-rbac-complet.md) /
> [ADR-0041](ADR-0041-autorisations-par-membre.md) (droits effectifs `can(rôle, action, contexte)`).
> **N'ajoute aucune action** à `authz/permissions.ts`.

## Contexte

Toute l'entreprise passe sur le module Projets (« style Asana »). Jusqu'ici, tout détenteur de
`work.read` voyait **tous** les projets de l'organisation, et « ajouter un membre » revenait à
l'assigner à une tâche. La dirigeante veut :

1. des **équipes** gérées dans les RH (nom, description, responsable, membres = utilisateurs de
   l'organisation), qui peuvent **traverser plusieurs services** ;
2. des **membres de projet** : des personnes ajoutées une à une, ou une **équipe entière** — dont
   les membres, y compris ceux qui la rejoignent plus tard, accèdent au projet ;
3. une **visibilité** à la Asana : projet visible de toute l'organisation (comportement actuel) ou
   **privé** (ses membres seulement).

Un chantier parallèle ajoute un rôle `guest` « limité aux projets dont il est membre » et exporte
`PROJECT_SCOPED_ROLES` depuis `authz/permissions.ts` ; il n'est pas visible sur cette branche.

## Options considérées

### O1 — Où vivent les équipes

1. Réutiliser les **services** (`hr_departments`). Écarté : un service range des **dossiers du
   personnel** dans un arbre ; une équipe de projet rassemble des **utilisateurs** (un
   prestataire invité n'a pas de dossier) et traverse les services.
2. Dans le module `work`. Écarté : la dirigeante range les équipes dans les RH, et d'autres modules
   (planning, CRM) pourront s'en servir.
3. **Collection `hr_teams`, module `apps/api/src/hr/teams/`, écran `RH › Équipes`.** **Retenu.**
   Le module `work` la lit **en lecture seule** par la connexion (motif du CRM), sans importer le
   module RH.

### O2 — Comment une équipe donne accès

1. Recopier ses membres dans le projet à l'ajout. Écarté : qui rejoint l'équipe plus tard
   n'accède pas, qui la quitte garde l'accès — exactement l'inverse de la demande.
2. **Résolution dynamique** : le projet garde `memberTeamIds` ; la portée d'un appelant est
   calculée à **chaque requête** à partir des équipes dont il est membre ou responsable.
   **Retenu.** Aucun cache : rejoindre, quitter, retirer l'équipe prend effet immédiatement.

### O3 — Où appliquer la visibilité

1. Dans l'écran. Écarté : c'est une frontière de sécurité.
2. Dans chaque service, au cas par cas. Insuffisant seul : un point d'entrée oublié fuit.
3. **Deux mécanismes serveur complémentaires.** **Retenu.**
   - une **garde** `WorkVisibilityGuard`, posée après `AuthGuard` et `PermissionsGuard` sur **tous**
     les contrôleurs du module : elle lit `projectId`, `taskId`, `commentId`, `attachmentId`,
     `entryId` dans le chemin ET `projectId`, `taskId` dans la requête, et répond **404** quand la
     ressource relève d'un projet hors portée — toute route future qui porte l'un de ces paramètres
     est protégée sans y penser ;
   - un **filtre de portée** dans chaque LISTE (projets, recherche, portefeuille et ses chiffres,
     liste transverse et calendrier, Mes tâches et ses constats d'absence, temps, feuille de temps,
     brief du matin, notifications, résumé quotidien).

### O4 — Qui voit tout

1. Les détenteurs de `work.manage`. Écarté : le Directeur financier gère les projets mais un projet
   privé RH ne le concerne pas.
2. **Les détenteurs de `organization.manage`** (Propriétaire, Administrateur), décidé par
   `can()` et jamais par un nom de rôle (ADR-0012 § 8). **Retenu** (« direction »).

## Décision

### 1. Vocabulaire

| Interface | Code | Collection |
|---|---|---|
| Équipe | `Team` | `hr_teams` |
| Membres d'un projet | `memberUserIds`, `memberTeamIds` | dans `work_projects` |
| Visibilité | `visibility` : `organization` · `private` | dans `work_projects` |
| Portée d'un appelant | `WorkProjectScope` (`all` · `deny` · `allow`) | calculée, jamais stockée |

### 2. Équipes (`hr_teams`)

`organizationId`, `name` (1–80, **unique** dans l'organisation, `nameKey` normalisé),
`description` (≤ 1 000), `leadUserId` (membre de l'organisation, **toujours compté parmi les
membres**), `memberUserIds` (≤ 200 utilisateurs de l'organisation, `404 MEMBER_NOT_FOUND`
sinon), `revision`, journal `audit_events` (`hr.team.created|updated|members_added|member_removed|deleted`).
200 équipes au plus par organisation. Supprimer une équipe retire l'accès qu'elle donnait ; aucun
projet n'est réécrit (un identifiant d'équipe disparu ne donne plus rien).

| Route | Droit |
|---|---|
| `GET /hr/teams`, `GET /hr/teams/:teamId`, `GET /hr/teams/candidates` | `hr.read` (lecture large) |
| `POST /hr/teams`, `PUT /hr/teams/:teamId`, `POST …/members`, `DELETE …/members/:userId`, `DELETE /hr/teams/:teamId` | `hr.manage` (RH et direction) |
| `GET /work/teams` (sélecteur des Projets : nom et nombre de membres) | `work.read` |

### 3. Visibilité d'un projet

- `organization` (**défaut**, et valeur de **tous les projets existants** : aucune migration, aucun
  accès changé) : tout détenteur de `work.read` le voit.
- `private` : le voient son **responsable**, ses **membres directs**, les **membres courants de ses
  équipes**, et la **direction** (`organization.manage`).
- Un projet privé créé (ou passé en privé) compte son auteur parmi ses membres directs.
- Hors portée, **toute** ressource du projet répond **404** (`WORK_PROJECT_NOT_FOUND`,
  `WORK_TASK_NOT_FOUND`, …) — jamais 403 : un projet privé n'existe pas pour qui n'en est pas membre.
- La visibilité se change par `PUT /work/projects/:projectId` (`visibility`, `work.manage`) ; la
  valeur par défaut des nouveaux projets est un réglage (ADR-0061 § 3).

### 4. Membres d'un projet

| Route | Droit | Effet |
|---|---|---|
| `GET /work/projects/:projectId/members` | `work.read` | responsable, personnes, équipes avec leurs membres courants, nombre de personnes distinctes, `canManage` |
| `POST /work/projects/:projectId/members` | `work.manage` | `{ userIds?, teamIds? }` ; personne : membre de l'organisation (404) détenant `work.read` (`400 WORK_MEMBER_NOT_ELIGIBLE`) ; équipe de l'organisation (`404 HR_TEAM_NOT_FOUND`) ; déjà présents : ignorés ; 200 personnes et 50 équipes au plus |
| `DELETE /work/projects/:projectId/members/users/:userId` | `work.manage` | retire la personne |
| `DELETE /work/projects/:projectId/members/teams/:teamId` | `work.manage` | retire l'équipe (ses membres perdent l'accès qu'elle donnait) |

Historique `project.member_added` / `project.member_removed` ; notification « ajouté à un projet »
aux personnes ajoutées et aux membres des équipes ajoutées (ADR-0061 § 2).

*Depuis [ADR-0066](ADR-0066-suites-equipes-projets.md) § 3* : assigner une tâche à quelqu'un qui ne
voit pas le projet l'en rend **membre direct** si l'acteur a `work.manage`, sinon
`400 WORK_ASSIGNEE_NOT_MEMBER` ; `GET /work/members?projectId=` dit qui voit le projet (`seesProject`).

### 5. Portée, rôles limités, notifications

`WorkAccessService.scopeOf(organisation, appelant)` :

1. rôle **limité aux projets dont il est membre** (`isProjectScopedRole(role)`) → `allow` : les
   projets dont il est responsable, membre direct ou membre d'une équipe — **quelle que soit la
   visibilité** ;
2. sinon, `organization.manage` → `all` ;
3. sinon → `deny` : les projets privés dont il n'est ni responsable, ni membre, ni membre d'une équipe.

**Rôle limité** : `isProjectScopedRole(role)` (`apps/api/src/work/work-access.ts`) vaut
`PROJECT_SCOPED_ROLES.includes(role)`, la liste d'ADR-0059 (aujourd'hui `guest`). Câblé à la fusion
du 5 nov. 2026 : aucun nom de rôle n'apparaît plus hors de `permissions.ts`.

Notifications : `WorkNotifier` n'émet jamais vers un destinataire qui ne voit pas le projet ; à la
lecture, le module de notifications applique un **filtre enregistré** par le module `work`
(`registerReadFilter`) — il ne connaît toujours aucun producteur — qui masque les notifications
d'un projet devenu invisible (retiré de l'équipe, projet passé en privé). Le compteur de non-lues
suit le même filtre.

### 6. Points d'entrée filtrés (frontière testée)

`apps/api/src/__tests__/work-visibility.e2e.test.ts`, 22 cas : fiche, aperçu, tâches du projet,
liste transverse filtrée et calendrier, détail de tâche, historiques, commentaires, pièces jointes
(liste et téléchargement), temps (liste filtrée, liste transverse, résumé), marge, membres, liste et
recherche des projets, portefeuille et ses chiffres, Mes tâches, notifications (liste, compteur),
brief du matin ; écritures (tâche, commentaire, saisie, création de tâche) → 404 ; accès par équipe
(rejoindre ouvre, quitter ferme, retirer l'équipe ferme) ; retrait d'un membre direct ; jamais
d'émission vers un non-membre ; bascule organisation ↔ privé ; isolation entre organisations ;
membre sans `work.read` refusé ; rôle limité (`'guest'`).

## Conséquences

- Les projets existants ne changent pas d'audience. Le Propriétaire et l'Administrateur voient tout.
- Coût : une à trois requêtes par appel (équipes de l'appelant, projets privés hors portée). Index
  `{ organizationId, visibility }`, `{ organizationId, memberUserIds }`,
  `{ organizationId, memberTeamIds }`, `hr_teams { organizationId, memberUserIds }`.
- `GET /work/quotes/:quoteId/project` et `…/opportunities/:id/project` rendent l'identifiant d'un
  projet issu du devis même s'il est privé (pour éviter un doublon de création) ; l'ouvrir répond 404.
- Hors périmètre : les modules qui citent un projet par son identifiant (dépenses, achats, stocks,
  documents) affichent son nom à leurs propres lecteurs ; ils restent gouvernés par leurs droits.
- La feuille de temps d'un collaborateur, lue par son manager, compte ses heures sur un projet
  privé mais en masque le nom (« Projet privé »).

## Décisions ouvertes

1. Un responsable d'équipe peut-il gérer **sa** équipe sans `hr.manage` ? (proposé : non en R1).
2. Les membres d'un projet sans `work.manage` peuvent-ils inviter d'autres membres (Asana : oui
   pour les « éditeurs du projet ») ? (proposé : non en R1).
