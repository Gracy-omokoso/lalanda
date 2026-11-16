# ADR-0076 — Projets : rôles dans le projet, collaborateurs et abonnés, validation des tâches, liste de contrôle, statut du projet

Statut : **Accepté** (besoin validé par la dirigeante le 16 nov. 2026 ; les points marqués « à
revoir avec Gracy » ont été tranchés par défaut et sont repris en décisions ouvertes)
Date : 2026-11-16
Décideur : Gracy Omokoso (dirigeante de Go freelance SARLU).

> Étend [ADR-0039](ADR-0039-projets-et-taches-run.md) (projets et tâches du RUN),
> [ADR-0060](ADR-0060-equipes-membres-projet-visibilite.md) § 4 (membres d'un projet),
> [ADR-0061](ADR-0061-parametres-projets-notifications-couleurs.md) § 2 (préférences de
> notification) et [ADR-0066](ADR-0066-suites-equipes-projets.md) § 2 et § 3 (Stagiaire, assigné
> membre). S'appuie sur [ADR-0057](ADR-0057-interieur-projet-facon-asana.md) (Aperçu) et
> [ADR-0058](ADR-0058-accueil-projets-et-mes-taches-equipe.md) (portefeuille) et suit
> [ADR-0074](ADR-0074-formulaires-modernes.md) pour les formulaires.
> **Aucune action ajoutée** à `authz/permissions.ts` : les rôles dans le projet sont des
> RELATIONS lues à chaque requête (motif du responsable d'équipe, ADR-0066 § 1), plafonnées par
> le rôle d'organisation.

## Contexte

Le module Projets ne connaissait qu'un « Responsable du projet » (`ownerUserId`) sans droit propre :
tout venait du rôle d'organisation (`work.read`, `work.update`, `work.manage`). Un Salarié ne
pouvait donc ni gérer le projet qu'on lui confie, ni être distingué d'un simple observateur. En RDC,
une agence ou une PME confie un chantier à un **chef de projet** secondé d'un **adjoint** ; le
travail est **visé** par le chef avant d'être déclaré fait (et facturé au client) ; les autres
membres exécutent, et certains (client, direction d'un partenaire) suivent sans toucher. La
dirigeante a validé ce modèle et ses règles le 16 nov. 2026.

## Décision

### 1. Rôles dans le projet

Quatre rôles dans un projet, lus à **chaque requête** (aucun cache) :

| Rôle | Stockage | Droits sur LE projet |
|---|---|---|
| **Chef de projet** | `ownerUserId` (champ existant, libellé « Chef de projet ») | gestion (ci-dessous) |
| **Adjoint** | `deputyUserId` (nouveau, **un seul**) | gestion, comme le chef |
| **Membre** | défaut d'un membre (personne ou équipe) | crée des tâches, commente, saisit son temps, modifie les tâches dont il est responsable ou collaborateur |
| **Lecteur** | `memberRoles[]` (`role: 'viewer'`) | lit et commente seulement ; ni assignable, ni collaborateur, ni validateur |

- **Gestion** (chef, adjoint) : réglages du projet (nom, dates, statut, visibilité, colonnes),
  membres et leurs rôles, jalons (créer, marquer ou démarquer un jalon), archivage et restauration,
  suppression de tâches, validation des tâches, publication du statut du projet, modification et
  achèvement de toute tâche. Le chef nomme et change l'adjoint ; il peut passer la main à un autre
  chef. L'adjoint ne change ni le chef ni l'adjoint.
- **Plafond du rôle d'organisation** : sans `work.update`, personne ne modifie rien, quel que soit
  son rôle dans le projet (un rôle Lecteur d'organisation reste en lecture). Les droits de gestion
  du chef et de l'adjoint exigent `work.update` et un rôle **interne** : ni l'Invité externe
  (`PROJECT_SCOPED_ROLES`) ni le Stagiaire (`SELF_ASSIGN_ONLY_ROLES`) ne peuvent être nommés chef
  ou adjoint (`400 WORK_PROJECT_LEAD_NOT_ELIGIBLE`), et un chef devenu Stagiaire perd la gestion
  immédiatement.
- **`work.manage`** (la direction, les Managers) garde la main sur **tous** les projets, comme
  avant. Créer un projet, le supprimer, l'import en nouveau projet, l'IA, le canal Slack du projet,
  les liens de facture restent sous `work.manage` (inchangé).
- **Stockage compatible** : `memberRoles: [{ kind: 'user' | 'team', id, role: 'member' | 'viewer' }]`
  sur `work_projects`. Une entrée absente vaut **Membre** (défaut à la lecture, aucun script). Les
  membres existants deviennent donc Membres ; les projets existants sans chef restent sans chef ;
  l'adjoint absent vaut `null`. `_schemaVersion` inchangé (champs additifs).
- **Résolution** (fonction pure `resolveProjectRole`, `@lalanda/shared/work`) : chef → adjoint →
  rôle de l'entrée **personnelle** s'il y en a une (elle prime sur les équipes : un Lecteur nommé
  personnellement reste Lecteur même si une de ses équipes est Membre) → meilleur rôle de ses
  équipes ajoutées (Membre l'emporte sur Lecteur) → **non membre**.
- **Non membre d'un projet ouvert** (`visibility: organization`) : il garde le comportement
  d'avant, celui d'un **Membre implicite** (créer, commenter, saisir son temps, faire avancer ses
  tâches). Raison : la plupart des projets existants n'ont aucun membre listé ; les fermer
  rendrait le module inutilisable au lendemain de la livraison. *À revoir avec Gracy* (décision
  ouverte n° 1).
- L'adjoint compte parmi les personnes du projet comme le chef : il voit le projet privé
  (`membershipClauses`, audience, nombre de membres).
- Un utilisateur ou une équipe s'ajoute avec un rôle (`POST …/members` accepte `role`, défaut
  Membre) ; le rôle se change par `PUT /work/projects/:projectId/members/users/:userId/role` et
  `…/teams/:teamId/role` (corps `{ role }`). Historique `project.member_role_changed`.
- Passer quelqu'un en **Lecteur** ne retire rien de ce qui existe (ses tâches restent assignées) :
  il ne peut simplement plus les modifier ; le gestionnaire les réassigne. *Défaut retenu.*

### 2. Tâches et sous-tâches : responsable, collaborateurs, abonnés

- **Responsable** : un seul (`assigneeUserId`, existant). Règles d'ADR-0066 inchangées (Stagiaire :
  soi seulement ; l'assigné doit voir le projet, `WORK_ASSIGNEE_NOT_MEMBER`). Nouveau : un
  **Lecteur** du projet n'est pas assignable (`400 WORK_ASSIGNEE_VIEWER`).
- **Collaborateurs** (`collaboratorUserIds`, nouveau, 10 au plus) : mêmes conditions que le
  responsable (membre de l'organisation avec `work.update`, voit le projet, pas Lecteur ; le
  Stagiaire ne s'ajoute ou ne se retire que lui-même). Un collaborateur **modifie** la tâche,
  **commente**, coche la liste de contrôle, est **abonné** d'office et **notifié** de son ajout
  (`work.task_collaborator_added`). « Mes tâches » lui montre la section **« Je collabore »**.
- **Abonnés** (`followerUserIds`, existant) : l'interface les affiche, les ajoute et les retire
  (qui peut modifier la tâche) ; chacun peut **Suivre / Ne plus suivre** une tâche qu'il voit
  (`POST` et `DELETE /work/tasks/:taskId/follow`, sans révision attendue, Lecteur compris).
- **Modifier une tâche** (titre, dates, colonne, étiquettes, responsable…) : la gestion du projet,
  le responsable, un collaborateur, le **créateur** de la tâche, ou tout Membre si la tâche est
  **sans responsable** (pour pouvoir la prendre). Sinon `403 WORK_TASK_EDIT_FORBIDDEN`. Le créateur
  et la tâche libre sont des ajouts tranchés seul : *à revoir avec Gracy*.
- **Terminer ou rouvrir** (règle validée) : le **responsable** de la tâche, le chef, l'adjoint et
  `work.manage`. Un collaborateur ne termine pas la tâche d'un autre ; il termine celles, ou les
  sous-tâches, dont il est responsable. Sinon `403 WORK_TASK_COMPLETE_FORBIDDEN`. Glisser une
  carte vers la colonne « terminé » (ou l'en sortir) suit la même règle.
- **Tâche sans responsable** : la gestion du projet ; pour une **sous-tâche**, aussi le responsable
  de la **tâche parente** (proposition retenue). Pour un projet **sans chef ni adjoint** (projets
  d'avant), tout Membre qui peut la modifier la termine, comme avant — sinon personne d'autre que
  la direction ne pourrait clore une tâche libre. *À revoir avec Gracy* (décision ouverte n° 2).
- Les fonctions pures `taskRights` (`@lalanda/shared/work`) disent `canEdit`, `canComplete`,
  `canCheck` ; l'API les applique, le web les lit pour masquer les gestes (le serveur reste juge).

### 3. Validation des tâches (approbation)

- Une tâche ou un jalon peut être marqué **« à valider »** (`approval.required`) par la gestion du
  projet. Le **validateur** est désigné (`approval.approverUserId`) ; absent, c'est le **chef**, à
  défaut l'**adjoint**. Sans validateur possible : `400 WORK_APPROVER_REQUIRED`. Le validateur
  désigné doit voir le projet, détenir `work.update` et ne pas être Lecteur.
- Le **responsable** (ou la gestion) **soumet** la tâche (`POST /work/tasks/:taskId/approval/submit`) :
  état `pending`, validateur résolu et figé à la soumission (`pendingApproverUserId`), notification
  `work.task_approval_requested`. Une tâche à valider ne passe **jamais** à « terminé » par
  `complete` ni par le Kanban : `409 WORK_TASK_APPROVAL_REQUIRED`.
- Le validateur — ou, à défaut de lui, la gestion du projet — **décide**
  (`POST …/approval/decide`, `decision` = `approve` | `request_changes` | `reject`) :
  - **Approuver** : la tâche passe à « terminé » (colonne terminée, `completedBy` = le
    validateur) ; pour un jalon, la notification « jalon terminé » et la suggestion
    `PREPARE_INVOICE` partent **à ce moment-là** ;
  - **Demander des modifications** (motif obligatoire) : la tâche revient au responsable, non
    terminée ; il la resoumet ;
  - **Refuser** (motif obligatoire) : la tâche reste ouverte, marquée « Refusée » ; une nouvelle
    soumission reste possible. *À revoir avec Gracy* (décision ouverte n° 3).
  - **Séparation** : personne ne valide **sa propre** soumission (`409 WORK_SELF_APPROVAL_FORBIDDEN`,
    motif d'ADR-0045) ; si le validateur est l'auteur de la soumission, un autre gestionnaire décide.
- Rouvrir une tâche approuvée remet la validation à zéro (`none`) : il faudra la resoumettre.
- Tout est tracé (`task.approval_submitted`, `task.approval_approved`,
  `task.approval_changes_requested`, `task.approval_rejected`, motif borné à 500 caractères) et
  notifié (`work.task_approval_decided` au responsable). Le validateur voit la tâche dans
  « Mes tâches », section **« À valider »**, et le brief du matin compte ses validations en attente
  (fait `mes_validations_taches.en_attente`).
- **Jalon et facture** : le brouillon de facture d'un jalon « à valider » ne se prépare qu'après
  l'approbation (`prepareInvoice` exige déjà un jalon terminé ; il refuse en plus
  `409 WORK_MILESTONE_NOT_APPROVED` si la validation n'est pas `approved`). Jamais d'émission,
  jamais d'appel DGI : seul le brouillon `FV` d'ADR-0039 § 6.3.

### 4. Liste de contrôle d'une tâche

- Éléments cochables (`checklist[]` : `id`, `text` ≤ 200 caractères, `done`, `doneBy`, `doneAt`),
  **30 au plus** par tâche, dans l'ordre du tableau. Ce ne sont pas des sous-tâches : ni
  responsable, ni échéance, ni historique par élément.
- `PUT /work/tasks/:taskId/checklist` remplace la liste (`expectedRevision`, révision optimiste
  de la tâche). Le serveur compare à l'existant : **cocher ou décocher** est permis au
  responsable, aux collaborateurs et à la gestion ; **ajouter, renommer, retirer, réordonner** est
  permis à qui peut modifier la tâche. Le Lecteur ne fait ni l'un ni l'autre
  (`403 WORK_CHECKLIST_FORBIDDEN`). `doneBy`/`doneAt` sont posés par le serveur.
- La progression « 3/5 » (`checklistDone`/`checklistTotal`) est publiée sur la vue allégée et
  affichée sur les cartes du Kanban et la Liste. Historique : `task.checklist_changed` (compteurs).

### 5. Mise à jour de statut du projet

- Le chef ou l'adjoint (ou `work.manage`) publie un statut : **Dans les temps** (`on_track`),
  **À risque** (`at_risk`), **En retard** (`off_track`), **Terminé** (`done`), un texte
  (≤ 2 000 caractères) et une date (jour de Kinshasa, aujourd'hui par défaut). Collection
  `work_project_status_updates`, en ajout seulement ; `GET /work/projects/:projectId/status-updates`
  rend l'historique (50 derniers).
- Le dernier statut est affiché dans l'**Aperçu** et le **portefeuille** à côté de la santé
  calculée (`overviewHealth`), **sans la remplacer** : deux informations distinctes, l'une
  déclarée, l'autre calculée.
- Les personnes du projet (chef, adjoint, membres directs et membres des équipes, hors l'auteur)
  sont notifiées (`work.project_status_posted`), selon leurs préférences : cloche, e-mail, Slack,
  WhatsApp (`work-notifier.ts`), et le canal Slack du projet reçoit l'événement.

### 6. Notifications

Quatre événements réglables s'ajoutent aux huit d'ADR-0061 § 2 : « Je suis ajouté comme
collaborateur » (cloche, e-mail, Slack), « Une tâche attend ma validation » (cloche, e-mail, Slack,
WhatsApp), « Ma tâche a été validée, renvoyée ou refusée » (cloche, e-mail), « Nouveau statut d'un
de mes projets » (cloche). Un client N-1 qui n'envoie pas ces événements garde les valeurs
enregistrées (champs facultatifs de `PUT /work/notification-preferences`).

## Conséquences

- **Changement de comportement assumé** : un Membre (ou un détenteur de `work.update` non membre
  d'un projet ouvert) ne modifie plus la tâche d'un collègue qui lui est confiée sans qu'il y soit
  associé ; il demande à être collaborateur. Les suites e2e qui supposaient l'inverse ont été mises à
  jour (Stagiaire, ADR-0066).
- Les routes de gestion d'un projet (`PUT /work/projects/:id`, archivage, restauration, membres,
  suppression de tâche) passent de `@RequirePermission('work.manage')` à `work.update` : le service
  tient la règle (gestion du projet), 403 `WORK_PROJECT_MANAGE_FORBIDDEN` sinon. Un projet hors
  portée répond toujours 404.
- Coût : une lecture des équipes de l'appelant (`hr_teams`) par écriture de tâche, déjà faite pour la
  portée.
- Contrats additifs : `WorkProjectView` (+ `deputy`, `myRole`, `myRights`, `latestStatus`),
  `WorkTaskView` (+ `collaboratorUserIds`, `checklistDone`, `checklistTotal`, `approval`),
  `WorkTaskDetail` (+ `collaborators`, `checklist`, `myRights`), `WorkProjectMembersView`
  (+ `deputy`, `role`), `MyTasksView` (+ `collaborating`, `toApprove`), portefeuille
  (+ `latestStatus`). Une instance N-1 ignore ces champs ; l'écran les lit avec repli.

## Critères d'acceptation (testables)

1. Rôles : chef et adjoint `employee` gèrent leur projet (réglages, membres, archivage, suppression
   de tâche) sans `work.manage` ; un Membre reçoit 403 ; un Invité ou un Stagiaire n'est pas nommé
   chef ; un rôle d'organisation sans `work.update` reste en lecture
   (`work-roles.e2e.test.ts`, `roles.test.ts`).
2. Lecteur : ni assignable, ni collaborateur ; ne crée pas de tâche ; commente
   (`work-roles.e2e.test.ts`).
3. Collaborateur : modifie et commente ; ne termine pas la tâche d'un autre ; voit « Je collabore » ;
   notifié ; Suivre / Ne plus suivre (`work-collaboration.e2e.test.ts`).
4. Validation : soumission, approbation → terminé, modifications (motif obligatoire), refus,
   auto-validation refusée, « À valider » du validateur, jalon : suggestion de facture à
   l'approbation seulement, `prepare-invoice` refusé avant (`work-approval.e2e.test.ts`).
5. Liste de contrôle : 30 éléments au plus, coche par le responsable et le collaborateur, refus du
   Lecteur, progression sur la vue (`work-collaboration.e2e.test.ts`).
6. Statut du projet : publié par le chef, refusé au Membre, historique, dernier statut dans le projet
   et le portefeuille, membres notifiés (`work-approval.e2e.test.ts`).

## Décisions ouvertes — elles appartiennent à la dirigeante

1. **Non membre d'un projet ouvert** : Membre implicite (défaut) ou Lecteur ? *Défaut : Membre
   implicite, pour ne pas fermer les projets existants sans membre listé.*
2. **Tâche libre (sans responsable)** : modifiable par tout Membre (pour la prendre) et, dans un
   projet sans chef ni adjoint, terminée par tout Membre. *Défaut : oui.* Le **créateur** d'une tâche
   peut la modifier. *Défaut : oui.*
3. **Refus** d'une validation : définitif (seule la gestion relance) ou resoumission permise ?
   *Défaut : resoumission permise, la mention « Refusée » restant dans l'historique.*
4. **Qui marque « à valider »** : la gestion seulement (défaut) ou aussi le responsable ?
5. **Bornes** : 10 collaborateurs, 30 éléments de liste de contrôle par tâche. *Défaut retenu.*

## Liens

- `packages/shared/src/work/roles.ts`, `schemas.ts`, `views.ts`, `members.ts`,
  `notification-preferences.ts` ; `packages/shared/src/notifications/index.ts` ;
- `apps/api/src/work/work-access.ts`, `work-access.service.ts`, `work-tasks.service.ts`,
  `work-task-collab.service.ts`, `work-projects.service.ts`, `work-project-members.service.ts`,
  `work-project-status.service.ts`, `work-notifier.ts`, `billing/work-billing.service.ts`,
  `brief/work-brief.source.ts` ; `packages/engine/src/morning-brief/` ;
- `apps/web/src/app/(app)/projets/_components/*`, `apps/web/src/lib/work-api.ts`.
