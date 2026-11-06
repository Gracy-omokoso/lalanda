# ADR-0066 — Suites des équipes et des Projets : validation par le responsable d'équipe, Stagiaire, notifications groupées, numéros de tâche, assignation dans un projet privé

Statut : **Accepté** (suites validées par la dirigeante le 6 nov. 2026 ; à valider sur les captures
`docs/refonte-ui/v7/`)
Date : 2026-11-06
Décideur : Gracy Omokoso (dirigeante de Go freelance SARLU).

> Tranche les **décisions ouvertes n° 3 et n° 4 d'[ADR-0059](ADR-0059-roles-equipe-et-personnalisation-active.md)**
> et le **point ouvert n° 1 d'[ADR-0062](ADR-0062-import-projet-fichier.md)** ; étend
> [ADR-0061](ADR-0061-parametres-projets-notifications-couleurs.md) § 3 (numéros de tâche) et
> [ADR-0060](ADR-0060-equipes-membres-projet-visibilite.md) § 4 (membres d'un projet). S'appuie
> sur [ADR-0045](ADR-0045-ressources-humaines.md) § 4.3 et
> [ADR-0051](ADR-0051-rh-frais-avances-presences-evaluations.md) § 3 (chaînes de validation).
> **Aucune action ajoutée** à `authz/permissions.ts` : les 57 actions et la matrice sont
> inchangées. Une liste exportée de plus : `SELF_ASSIGN_ONLY_ROLES`.

## Contexte

Avec toute l'entreprise sur Lalanda (ADR-0059) et les équipes RH (ADR-0060), cinq suites restaient
ouvertes. Règle de la maison : **trancher selon ce qui s'applique en RDC**, puis améliorer avec les
experts. En RDC, une PME ou une agence fonctionne par **chefs d'équipe** (chef de chantier, chef
de bureau, chef d'agence) qui visent les congés et les frais de terrain de leurs gens avant le
service du personnel ou la comptabilité ; les stagiaires (stages académiques, professionnels) sont
encadrés et ne distribuent pas le travail ; les plans arrivent d'Excel par dizaines de lignes.

## Décision

### 1. Le responsable d'une équipe valide l'étape « manager » de son équipe (ADR-0059, n° 4)

Le **responsable** (`leadUserId`) d'une équipe RH (`hr_teams`) tient l'étape `manager` des
**absences**, des **notes de frais** et des **avances de frais** des **autres membres** de son
équipe, exactement comme le manager désigné de leur fiche (`managerEmployeeId`), **sans**
`leave.approve` ni `expenses.approve`.

- C'est une **relation**, pas un droit : `isTeamLead` dans `leaveApprovalDecision` et
  `expenseApprovalDecision` (`authz/permissions.ts`), lue à **chaque requête** dans `hr_teams`
  (`apps/api/src/hr/teams/team-leads.ts` : `usersLedBy`, `teamLeadsOf`). Aucun cache : retiré de
  l'équipe, l'équipe supprimée ou un autre responsable nommé, il perd le droit **immédiatement**.
- **Aucune escalade** :
  - il ne valide **jamais sa propre** demande (le responsable n'est pas compté parmi « ses »
    membres ; le refus `SELF_APPROVAL_FORBIDDEN` passe d'abord) ;
  - il ne tient **que** l'étape `manager` : l'étape `hr` (absences) ou `finance` (frais) reste
    exigée si la chaîne la prévoit, et reste aux détenteurs de `leave.approve` /
    `expenses.approve` ; « deux étapes, deux personnes » est inchangé ;
  - une **avance sur salaire** ne lui est jamais montrée (étape `finance` seule, donnée sensible) ;
  - il ne voit que les **demandes** de ses membres (« À valider », la note, l'avance de frais, leurs
    justificatifs comme le manager) : **ni la fiche, ni le dossier, ni les soldes, ni les
    documents** (`HrViewer.ledEmployeeIds` n'élargit pas `teamEmployeeIds`) ; un type d'absence
    confidentiel reste masqué (« Absence ») et n'a d'ailleurs pas d'étape manager.
- Sa validation est enregistrée comme celle du manager (`onBehalfOfManager: false`) ; il reçoit la
  notification « à valider » avec le manager désigné ; « Mes tâches » et le brief du matin le
  comptent.
- `GET /hr/me` publie `isTeamLead` et `ledEmployeeIds` ; `canApprove` le compte. L'écran « Mon
  espace » offre « Absences à valider » et « Frais à valider », « Mes frais » « À valider pour mon
  équipe ».
- **Composition de la chaîne inchangée** : l'étape `manager` existe quand la fiche du demandeur a
  un manager désigné relié à un compte (ADR-0045 § 2.7, ADR-0051 § 3.1). Sans manager désigné, la
  demande va directement aux RH ou à la finance, même si le demandeur a un responsable d'équipe
  (voir décision ouverte n° 1).

### 2. Le Stagiaire n'assigne une tâche qu'à lui-même (ADR-0059, n° 3)

`authz/permissions.ts` exporte `SELF_ASSIGN_ONLY_ROLES: readonly OrgRole[] = ['intern']`, lu par
`isSelfAssignOnlyRole` (`apps/api/src/work/work-access.ts`) — motif de `PROJECT_SCOPED_ROLES` ;
aucun nom de rôle n'est écrit ailleurs. Pour ces rôles :

- créer une tâche : responsable **soi-même** ou **aucun** ; un autre → `403 WORK_ASSIGN_SELF_ONLY` ;
- modifier le responsable : seulement d'« aucun » vers soi, ou de soi vers « aucun » ; réassigner
  (ou désassigner) la tâche d'un collègue → `403 WORK_ASSIGN_SELF_ONLY` ;
- tout le reste est inchangé : il coche, déplace, commente, saisit son temps (`work.update`) ;
- import : une ligne assignée à un autre est importée **sans responsable** (avertissement
  `IMPORT_ASSIGNEE_SELF_ONLY` à l'aperçu) ;
- `GET /work/members` publie `assignSelfOnly` pour l'appelant ; le panneau de tâche ne propose que
  « Moi » et se verrouille sur la tâche d'un collègue (le serveur reste juge).

### 3. Assigner dans un projet que la personne ne voit pas (ADR-0060 § 4)

Un responsable doit **voir** le projet de sa tâche (sinon il ne la voit pas). Quand l'assigné ne voit
pas le projet (projet **privé** dont il n'est ni responsable, ni membre, ni membre d'une équipe
ajoutée ; ou **Invité externe** hors du projet, même ouvert) :

- l'acteur détient `work.manage` → l'assigné est **ajouté comme membre direct** du projet, par le
  chemin habituel (`WorkProjectMembersService.add` : historique `project.member_added`,
  notification « ajouté au projet »), puis reçoit la notification d'assignation ;
- sinon → `400 INVALID_REQUEST`, problème `WORK_ASSIGNEE_NOT_MEMBER` sur `assigneeUserId`
  (« Cette personne ne voit pas ce projet : demandez à un gestionnaire de l'ajouter… ») ; **rien
  n'est écrit**.

Le refus est rendu avant toute écriture ; l'ajout suit l'écriture de la tâche. Même règle à la
création, à la modification et à l'import (un membre sans `work.manage` : ligne importée sans
responsable, avertissement `IMPORT_ASSIGNEE_NOT_MEMBER`). `GET /work/members?projectId=` ajoute
`seesProject` à chaque membre (même règle que la portée, ADR-0060 § 5 : `seesProjectAudience`) ;
projet hors portée de l'appelant → 404. Le sélecteur ne propose que les personnes qui voient le
projet ; un gestionnaire voit « N personnes ne voient pas ce projet. Ajouter un membre ».

### 4. Numéros de tâche dans la Chronologie et le Calendrier (ADR-0061 § 3)

Le réglage `showTaskNumbers` (« Numéros de tâche », défaut oui) s'applique aussi à la
**Chronologie** (liste des lignes, infobulle et titre des barres, tâches non planifiées, annonce
d'un déplacement) et au **Calendrier** du projet (puces, agenda, libellés d'accessibilité, annonce).
Coupé : le titre seul. Les relances du CRM gardent leur repère « ↻ ».

### 5. Notifications d'un import regroupées (ADR-0062, point ouvert n° 1)

Un import (`/work/import/projects`, `/work/projects/:id/import`) ou un projet construit avec l'IA
(`/work/plans/projects`) retient les assignations **par personne** (`WorkAssignmentBatch`) pendant
l'écriture, puis, **une fois le plan entier écrit** :

- plusieurs tâches pour une personne → **une** notification `work.task_assigned` « 12 tâches vous ont
  été assignées dans le projet X » (lien : la Liste du projet), remise sur **chaque canal** choisi par
  la personne (cloche, e-mail, message privé Slack) ;
- une seule tâche → la notification habituelle (« Awa vous a assigné #3 … ») ;
- canal Slack du projet : un événement par personne (« 12 tâches assignées à Bea par Awa »), pas
  par tâche ;
- l'auteur n'est jamais notifié de ses propres assignations ;
- un import refusé ou compensé n'envoie **rien** (avant : les tâches créées avant l'échec avaient
  déjà notifié).

Les gestes unitaires (créer, modifier, assigner une tâche) gardent leur comportement.

## Conséquences

- Aucune migration : équipes, rôles et chaînes existants gardent leur sens ; un responsable
  d'équipe gagne l'étape manager de ses membres dès la livraison.
- Coût : une lecture de `hr_teams` (index `{ organizationId, leadUserId }` et
  `{ organizationId, memberUserIds }`) par lecture RH relationnelle, une par notification « à
  valider » ; une lecture de l'audience du projet par `GET /work/members?projectId=`.
- Une personne ajoutée à un projet privé par une assignation reste membre si la tâche est ensuite
  supprimée ou réassignée (retrait par « Membres »).
- Contrats : `GET /hr/me` (+ `isTeamLead`, `ledEmployeeIds`), `GET /work/members` (+
  `assignSelfOnly`, `?projectId=` → `seesProject`). Une instance N-1 ignore ces champs ; l'écran
  les lit avec repli.

## Critères d'acceptation (testables)

1. Le responsable valide l'étape manager d'un membre ; l'étape RH ou finance suivante reste requise ;
   hors équipe 403 ; sa propre demande 409 ; retiré de l'équipe, plus de droit
   (`hr-team-lead-approvals.e2e.test.ts`, `permissions.test.ts`).
2. Le Stagiaire : soi ou personne à la création ; 403 `WORK_ASSIGN_SELF_ONLY` pour un autre et sur
   la tâche d'un collègue ; import sans responsable (`work-assign-self-only.e2e.test.ts`,
   `taches-model.test.ts`).
3. Assigné qui ne voit pas le projet : ajouté par un gestionnaire (membre, historique, notification),
   400 sinon sans écriture ; Invité externe d'un projet ouvert ; `seesProject`
   (`work-assignee-member.e2e.test.ts`).
4. Numéros masqués dans la Chronologie et le Calendrier (`gantt-model.test.ts`,
   `calendar-model.test.ts`).
5. Import de 12 tâches pour une personne : une cloche, un e-mail, un message Slack ; une tâche :
   notification habituelle ; geste unitaire inchangé ; import refusé : rien
   (`work-grouped-assignments.e2e.test.ts`).

## Décisions ouvertes — elles appartiennent à la dirigeante

1. **Étape manager sans manager désigné** : quand la fiche n'a pas de manager mais que la personne a
   un responsable d'équipe, créer l'étape `manager` pour ce responsable ? *Défaut : non (la chaîne
   reste celle de la fiche ; renseigner le manager dans le dossier).* Raison : changer la composition
   des chaînes ajouterait une étape aux demandes de personnes aujourd'hui validées directement par
   les RH.
2. **Plusieurs responsables** (personne membre de plusieurs équipes) : chacun peut tenir l'étape ;
   le premier qui agit la tient. *Défaut : oui.*
3. **Stagiaire et import** : faut-il refuser l'import entier plutôt qu'importer sans responsable ?
   *Défaut : importer sans responsable, signalé.*
4. **Retrait automatique** d'un membre ajouté par une assignation quand la tâche est supprimée ?
   *Défaut : non.*

## Liens

- `apps/api/src/hr/teams/team-leads.ts`, `apps/api/src/hr/scope/hr-scope.service.ts`,
  `apps/api/src/hr/agenda/*.reader.ts`, `apps/api/src/hr/leave/*`, `apps/api/src/hr/expenses/*`,
  `apps/api/src/hr/advances/*` ;
- `apps/api/src/authz/permissions.ts` (`isTeamLead`, `SELF_ASSIGN_ONLY_ROLES`) ;
- `apps/api/src/work/work-tasks.service.ts`, `work-access.ts`, `work-members.*`,
  `work-project-members.service.ts`, `work-import.service.ts`, `work-plan-builder.ts`,
  `work-notifier.ts` ;
- `apps/web/src/app/(app)/rh/_components/*`, `apps/web/src/app/(app)/projets/_components/*` ;
- `docs/12-ROLES-PERMISSIONS.md`, `docs/16-API.md`, `docs/04-UX-UI.md`,
  `docs/guide-projets-equipe.md`.
