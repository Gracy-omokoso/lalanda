# ADR-0041 — Autorisations par membre : le rôle comme titre et modèle de départ, ajouts et retraits d'actions

Statut : Proposed
Date : 2026-10-29
Décideurs : Gracy Omokoso (dirigeante) — **demande du 29 oct. 2026**, transcrite telle quelle
(§ Contexte) ; CTO Lalanda (contrat technique). Les choix marqués « proposition » sont soumis à
la dirigeante (§ Décisions ouvertes).

> **Amende [ADR-0012](ADR-0012-modele-rbac-complet.md) et docs/12.** Les droits effectifs d'un
> membre ne sont plus la seule ligne de son rôle dans la matrice : ils valent **matrice du rôle +
> ajouts − retraits**, portés par l'appartenance (`memberships`). La matrice rôle × action, les
> rôles, les actions, la matrice plateforme et l'accès délégué sont **inchangés**. R7 (pas
> d'élévation de privilège) est étendue aux actions ; R1 (dernier propriétaire), R2 (séparation
> validation / saisie) et R3 (clôture / réouverture) sont conservées et protégées contre le cumul
> par ajouts. **S'insère dans R2 après le lot C0 d'[ADR-0040](ADR-0040-crm-complet.md)** (rôle
> Commercial `sales_rep`, action `sales.quote`), qui possède `permissions.ts` : tous les chiffres
> ci-dessous comptent **9 rôles et 28 actions**.

## Contexte

### La demande de la dirigeante (29 oct. 2026)

> « En invitant un membre d'équipe, on peut aussi désigner les autorisations qu'on lui donne. Les
> titres comme admin, comptable, DG, conseiller, commercial sont des titres qu'on attribue au
> membre, mais aussi des filtres de niveau d'accès avec les autorisations correspondantes. Ce
> n'est pas figé : on peut rajouter d'autres autorisations et/ou en retirer. »

Trois exigences en sortent :

1. **Le titre reste** : on continue d'inviter « un Comptable », « un Commercial ». Le titre dit qui
   est la personne et fournit un ensemble d'autorisations par défaut.
2. **Le titre n'est pas une prison** : on peut ajouter une autorisation que le titre n'a pas (un
   Commercial qui doit voir la trésorerie) ou en retirer une qu'il a (un Comptable qui ne doit pas
   émettre de facture).
3. **Dès l'invitation** : les ajouts et retraits se choisissent en même temps que le titre.

### Faits du dépôt qui commandent les décisions

- **La matrice est la seule source de décision.** `apps/api/src/authz/permissions.ts` porte
  `ORG_PERMISSION_MATRIX` (rôle × action, cases `allow`, `deny`, `allow_sod`, `allow_project`,
  `conditional`), `can(role, action, ctx)`, `actionsOf`, `grantableRoles` / `canGrantRole` (R7),
  `sodDecision`, `APPROVER_ROLES`, `ORG_ROLE_RANK`, `isOwnerRole`, et `normalizeOrgRole` (`member`
  historique → `finance_director`). ADR-0012 § 8 : « aucun `if (role === …)` hors de
  `permissions.ts` ».
- **Un précédent existe déjà : `canClosePeriods`.** Le Comptable porte sur son appartenance un
  drapeau qui lève sa case ⚙ `period.close`. `OrgPermissionContext` transporte ce drapeau jusqu'à
  `can()`. Ce que demande la dirigeante en est la généralisation : au lieu d'un drapeau sur une
  case, deux listes sur toutes les cases.
- **Le guard relit l'appartenance à chaque requête.** `PermissionsGuard` appelle
  `AuthzService.resolveOrgRole(userId, orgId)` (lecture Mongo, `select({ role, canClosePeriods })`),
  puis `canAll(role, actions, context)`. Il n'existe **aucun cache serveur** des permissions, et la
  session better-auth ne transporte aucun droit. Côté web, `ShellProvider`
  (`apps/web/src/app/(app)/_components/shell-context.tsx`) lit `GET /me/permissions` une fois au
  montage.
- **Beaucoup de code décide hors du guard, avec le rôle seul.** Une trentaine d'appels à `can()`
  dans les contrôleurs, services et tâches planifiées reçoivent `role` sans contexte, et trois
  requêtes Mongo cherchent des destinataires **par rôle** (`role: { $in: … }`). Ils deviendraient
  faux dès qu'un retrait ou un ajout existe ; leur inventaire est au § 9.
- **Les actions réservées au Propriétaire, vérifiées dans le code** :
  - `billing.manage` : seule action dont la ligne est `allow` pour `owner` et `deny` pour les huit
    autres rôles ;
  - le **transfert de propriété** : `MembersService.transferOwnership` refuse tout acteur dont le
    rôle n'est pas `owner` (`403 OWNER_ROLE_REQUIRED`), quelle que soit la permission de la route
    (`organization.manage`) ;
  - la **suppression de l'organisation** : réservée au Propriétaire par docs/12 ; **aucune route ne
    l'implémente aujourd'hui** (seule la suppression de compte existe, et
    `account.service.ts` la refuse au dernier propriétaire via `isOwnerRole`) ;
  - R1 (dernier propriétaire) et le consentement à un accès délégué (ADR-0012 § 5) portent sur
    l'**identité** de propriétaire, pas sur une action.
- **La séparation des tâches dans le code** :
  - R2 dynamique : `sodDecision()` refuse l'auto-approbation d'un plan
    (`409 SELF_APPROVAL_FORBIDDEN`) sauf approbateur unique, marqué `soleApprover` ; le nombre
    d'approbateurs vient de `AuthzService.countApprovers`, qui compte **par rôle**
    (`role ∈ APPROVER_ROLES`) ;
  - R2 statique : aucun rôle subalterne ne détient à la fois `inputs.update` et `plan.approve` ;
  - R3 : rouvrir une période exige `period.close` **et** `plan.approve` ; « un Comptable à qui on a
    accordé `canClosePeriods` peut clôturer mais ne peut pas rouvrir » ;
  - facturation DGI : émettre ou normaliser (`sales.invoice`) et piloter le jeton e-MCF, le régime
    et la déclaration « non normalisée » (`fiscal.manage`) sont deux actions distinctes. **Aucune
    règle du code n'interdit leur cumul** : seule la répartition par rôle les sépare (le Comptable
    émet, il n'a pas `fiscal.manage`).
- **Sièges** : docs/13 fixe des sièges par offre (1, 1, 3, 20, négocié), non encore appliqués.
  Aucune offre ne limite les rôles.

## Options considérées

### O1 — Rôles personnalisés (l'organisation crée ses propres rôles)

Une collection `org_roles` par organisation, chacun avec sa liste d'actions. Rejeté : ce n'est pas
la demande (« ce sont des titres qu'on attribue au membre », les titres restent ceux de Lalanda) ;
la matrice exhaustive testée case par case (420 cases) perdrait son sens, puisque chaque
organisation aurait sa matrice ; le rang, les libellés, R7 et le support deviendraient des données
clientes. Un deuxième « Comptable » maison avec trois actions de plus serait un rôle de plus à
comprendre pour tout le monde, pour un écart qui ne concerne qu'une personne.

### O2 — Liste d'actions explicite par membre, le rôle n'étant qu'une étiquette

L'appartenance porte la liste complète des actions ; le rôle ne sert plus qu'à l'affichage.
Rejeté : on perd « ce qui change par rapport au titre », qui est précisément ce que la dirigeante
veut voir ; une évolution de la matrice (une action nouvelle, comme `sales.quote`) ne se
propagerait à personne et exigerait une migration de chaque appartenance ; et toute appartenance
existante devrait être réécrite.

### O3 — Drapeaux par case conditionnelle (prolonger `canClosePeriods`)

Ajouter un drapeau par case qu'on voudrait ouvrir. Rejeté par ADR-0012 dès l'origine (« ingérable
au-delà de trois drapeaux ») et ne couvre pas le retrait.

### O4 — Le rôle comme modèle de départ, avec ajouts et retraits par membre — **retenu**

L'appartenance garde son rôle et gagne deux listes, `grants` (ajouts) et `revokes` (retraits),
vides par défaut. Droits effectifs = ligne du rôle + ajouts − retraits. La matrice reste la vérité
du titre et reste testée case par case ; l'écart est petit, lisible, audité ; une action nouvelle
de la matrice se propage à tous les titulaires du rôle sans migration ; sans écart, rien ne change.

## Décision

### 1. Modèle : titre + écart

- Le **rôle** (`OrgRole`) est inchangé : un titre, un rang (`ORG_ROLE_RANK`, inchangé, toujours
  par titre), un libellé, une description, une ligne de matrice. Il reste obligatoire.
- Chaque appartenance porte deux listes d'actions, **sans doublon, triées dans l'ordre d'`ACTIONS`** :
  - `grants` — **ajouts** : actions que la ligne du rôle refuse (`deny`) et que ce membre détient ;
  - `revokes` — **retraits** : actions que la ligne du rôle accorde (`allow`, `allow_sod`,
    `allow_project`, `conditional`) et que ce membre ne détient pas.
- **Droits effectifs** :

  ```
  effectif(m) = ( actionsOf(m.role, { canClosePeriods }) ∪ m.grants ) − m.revokes
  ```

  Le retrait l'emporte toujours. Une action ajoutée est accordée **pleinement** (`allow`), jamais
  avec une portée.
- Invariants de stockage, vérifiés à chaque écriture : `grants ∩ revokes = ∅` ; une action
  `deny` dans la ligne du rôle ne peut pas être retirée (retrait sans objet) ; une action non
  `deny` ne peut pas être ajoutée (ajout sans objet). Sinon `400 PERMISSION_OVERRIDE_REDUNDANT`.
- **Case ⚙ du Comptable** : `canClosePeriods` reste le stockage du droit de clôture d'un
  Comptable (aucune migration). L'écran la présente comme une case de la grille et l'API des
  permissions (§ 6) l'écrit dans ce drapeau : `grants` ne contient jamais `period.close` pour un
  `accountant`. Pour tout autre rôle qui n'a pas `period.close`, c'est un ajout ordinaire.

### 2. Garde-fous de sécurité (non négociables)

Chacun est vérifié **côté serveur**, dans une fonction pure de `permissions.ts`
(`validateOverrides`), appelée par le service des membres et par celui des invitations. L'écran
ne fait que les anticiper.

**G1 — On n'accorde que ce que l'on détient.** Tout ajout doit appartenir aux droits effectifs
**actuels** de l'acteur. Plus largement, R7 devient : après l'opération, **l'ensemble potentiel
de la cible** (droits effectifs, case ⚙ comptée comme détenue, comme `potentialActionsOf`
aujourd'hui) **est inclus dans les droits effectifs de l'acteur**, et, pour une modification,
**l'ensemble potentiel de la cible avant l'opération l'était déjà** (on ne touche pas à un membre
plus puissant que soi, règle actuelle de `changeRole` et `revoke`). Le titre lui-même reste soumis
à R7 tel qu'aujourd'hui (`canGrantRole`), calculé désormais sur les droits effectifs de l'acteur
(décision ouverte n° 5). Refus : `403 PERMISSION_ESCALATION` avec la liste des actions en cause.
*Justification :* sans G1, un Administrateur à qui l'on a confié la gestion des membres pourrait
fabriquer un membre plus puissant que lui (par exemple un Lecteur + `sales.invoice`), puis agir à
travers lui : c'est l'escalade par composition qu'ADR-0012 R7 interdit déjà pour les rôles.

**G2 — Personne ne modifie ses propres autorisations.** `actorUserId === targetUserId` →
`403 SELF_PERMISSIONS_FORBIDDEN`, sur la route des autorisations et sur le droit de clôture. Le
changement de son propre titre reste régi par les règles actuelles (R7 ne permet que de descendre ;
R1 protège le dernier propriétaire). *Justification :* G1 empêche déjà de s'ajouter ce que l'on
n'a pas ; G2 ferme le cas restant — se retirer une action pour échapper à une règle qui en dépend
(par exemple se retirer `plan.approve` pour faire passer un collègue en « approbateur unique »
et lui ouvrir l'auto-approbation), et garantit qu'un écart a toujours **deux** personnes : celle
qui le décide et celle qui le reçoit, ce que l'audit montre.

**G3 — Ce qui est réservé au Propriétaire ne se délègue pas.** `NON_DELEGABLE_ACTIONS =
['billing.manage']` : jamais dans `grants` (`400 PERMISSION_NOT_DELEGABLE`). Le transfert de
propriété, la suppression de l'organisation (non implémentée), R1 et le consentement à un accès
délégué ne sont pas des actions : ils restent attachés au **titre** `owner` (`isOwnerRole`,
`OWNER_ROLE_REQUIRED`) et ne peuvent donc pas être ajoutés par construction. Enfin, **les
autorisations d'un Propriétaire ne se personnalisent pas** : `grants` et `revokes` restent vides
pour `owner` (`409 OWNER_PERMISSIONS_FIXED`). *Justification :* un propriétaire privé de
`billing.manage` ou de `organization.manage` par un co-propriétaire deviendrait un propriétaire
sans gouvernance ; la voie prévue pour réduire un propriétaire est le changement de titre, déjà
protégé par R1.

**G4 — La séparation des tâches ne se contourne pas par ajouts.** Trois paires sont
**incompatibles par ajout** (`SOD_PAIRS`) : si le titre ne détient pas nativement les deux
actions (au sens de `potentialActionsOf`), l'**ensemble potentiel** du membre (droits effectifs,
case ⚙ comptée comme détenue) ne peut pas les contenir toutes les deux — ainsi, accorder plus
tard le droit de clôture ne complète jamais une paire en silence. Refus : `409 SOD_CONFLICT { pair }`.

| Paire | Règle d'origine | Effet |
|---|---|---|
| `inputs.update` + `plan.approve` | R2 statique (ADR-0012 § 6) | un Analyste ne reçoit pas `plan.approve` ; un Lecteur qui a reçu `plan.approve` ne reçoit pas `inputs.update` |
| `period.close` + `plan.approve` | R3 : la réouverture exige les deux | un Comptable (qui peut se voir accorder la clôture) ne reçoit pas `plan.approve` |
| `sales.invoice` + `fiscal.manage` | **proposition** (décision ouverte n° 3) : celui qui émet et normalise ne pilote pas le jeton e-MCF, le régime ni la déclaration « non normalisée » de ses propres factures | un Comptable ne reçoit pas `fiscal.manage` |

Le Propriétaire et le Directeur financier, qui cumulent nativement ces paires, ne sont pas
concernés : leur cumul est celui de la matrice, déjà arbitré (et R2 dynamique s'y applique).
**R2 dynamique reste intact** et devient exact : `countApprovers` compte les **détenteurs
effectifs** de `plan.approve` (rôle qui l'a, sans retrait, ou ajout), et plus les rôles. Sans ce
correctif, une organisation « Propriétaire + Comptable ayant reçu `plan.approve` » se croirait à
approbateur unique et laisserait le Propriétaire s'auto-approuver sans que ce soit justifié (exemple :
« Propriétaire + Lecteur ayant reçu `plan.approve` ») — et,
à l'inverse, un Directeur financier privé de `plan.approve` bloquerait à tort l'auto-approbation
marquée du Propriétaire.

**G5 — Les portées `allow_project` sont conservées.** Un ajout n'élargit jamais une case
`allow_project` de la ligne du rôle (l'action n'est pas `deny`, l'ajout est donc refusé comme
redondant) ; un retrait la supprime entièrement. `project_manager` reste non attribuable
(`ROLE_NOT_ASSIGNABLE`) tant que `project_assignments` n'existe pas : cet ADR n'y change rien.

**G6 — Le rôle plateforme et l'accès délégué ne sont pas touchés.** `grants` et `revokes` ne
concernent que les appartenances. `canPlatform`, `PLATFORM_PERMISSION_MATRIX`,
`PLATFORM_FORBIDDEN_ACTIONS` et `support_grants` ne lisent jamais ces listes. Un rôle plateforme
sans appartenance reçoit `404` sur les routes des membres (comportement actuel du guard) : aucun
chemin plateforme n'écrit d'écart.

**G7 — Tout changement est journalisé.** Chaque écriture d'écart (route des autorisations,
invitation, acceptation, changement de titre qui efface un écart, transfert) produit un
`audit_events` `member.permissions_changed` avec `actorUserId`, `actorRole`, `targetId`, et
`metadata: { before: { role, grants, revokes, canClosePeriods, effective }, after: { … },
reason? }`. L'écriture d'audit est **stricte** (`AuditService.recordStrict`) et faite **dans la
même transaction** que l'appartenance : si l'audit échoue, l'écart n'est pas appliqué (même
principe que R4 pour les exports). La lecture reste celle d'`audit.read`.

**G8 — Les sessions et permissions en cache sont invalidées.** Aujourd'hui il n'existe aucun
cache serveur : le guard relit l'appartenance à chaque requête, donc **le changement prend effet
à la requête suivante**, sans déconnexion (la session better-auth ne transporte aucun droit ;
la révoquer déconnecterait la personne sans rien protéger de plus). Pour que cela reste vrai :
- l'appartenance gagne `permissionsRevision` (entier, incrémenté à chaque écriture de rôle,
  d'écart ou de droit de clôture) ; tout cache futur de permissions **doit** avoir cette révision
  dans sa clé — règle écrite dans `authz.service.ts` et testée ;
- côté web, `ShellProvider` relit `GET /me/permissions` au retour de focus de l'onglet et à toute
  réponse `403 FORBIDDEN`, et la page des membres le relit après chaque écriture ;
- le membre concerné reçoit une notification in-app « Vos autorisations ont changé » (décision
  ouverte n° 10).

### 3. Changement de titre

**Proposition : changer le titre efface l'écart** (`grants = []`, `revokes = []`, et
`canClosePeriods = false` hors Comptable, comme aujourd'hui). Le titre est un nouveau modèle de
départ ; reporter un écart fait sur un autre modèle produirait des combinaisons que personne n'a
choisies (un retrait devenu sans objet, un ajout devenu redondant, une paire G4 nouvellement
complétée). L'écran prévient avant de confirmer (« Les 2 ajouts et 1 retrait de cette personne
seront effacés »), et `PATCH …/members/:userId/role` accepte **dans le même appel** un nouvel écart
optionnel `{ role, grants?, revokes?, expectedRevision }`, validé contre le nouveau titre et écrit
atomiquement. L'audit `member.role_changed` porte l'écart effacé (`droppedOverrides`). Le transfert
de propriété efface de même l'écart des deux personnes (la cible devient `owner`, G3 ; l'ancien
propriétaire devient `admin` sans écart). Décision ouverte n° 1.

### 4. Dépendances entre actions

Certaines actions n'ont pas de sens sans une autre (gérer sans lire). **Le serveur refuse un
ensemble effectif incohérent** (`400 PERMISSION_DEPENDENCY_MISSING { action, missing }`) et **ne
complète jamais en silence** : l'état journalisé est exactement celui qui a été demandé.
**L'écran complète pour l'utilisateur** : cocher `sales.manage` coche `sales.read` ; décocher
`sales.read` décoche ce qui en dépend ; un message dit ce qui a été coché ou décoché avec lui.
Décision ouverte n° 2.

`ACTION_DEPENDENCIES` (dans `permissions.ts`, vérifiée par un test contre la matrice : **chaque
ligne de rôle satisfait déjà toutes les dépendances**, sinon le test échoue) :

| Action | Exige |
|---|---|
| `project.create`, `project.update`, `canvas.update`, `inputs.update`, `plan.calculate`, `actuals.import`, `period.close` | `project.read` |
| `plan.approve` | `project.read` (`plan.calculate` n'est pas exigé : on valide ce qu'un autre a calculé) |
| `report.export` | `project.read`, `analytics.read` |
| `sales.manage`, `sales.quote`, `sales.receipt` | `sales.read` |
| `sales.invoice` | `sales.manage` (donc `sales.read`) |
| `treasury.manage` | `treasury.read` |
| `crm.manage` | `crm.read` |
| `work.update` | `work.read` |
| `work.manage` | `work.update` (donc `work.read`) |
| toutes les actions | `analytics.read` reste le **socle** : non retirable tant que le membre détient une autre action (décision ouverte n° 4) |

`organization.manage`, `members.invite`, `billing.manage`, `audit.read`, `fiscal.manage` n'ont pas
d'autre dépendance. Le cumul de deux actions exigé par certaines routes (`work.read` +
`sales.read` + `treasury.read` pour la marge d'un projet, `sales.quote` + `sales.manage` pour
convertir un devis) **n'est pas une dépendance** : c'est la route qui l'exige, et un membre qui
n'a que l'une reçoit `403`, comme aujourd'hui.

### 5. Regroupement et libellés (français clair)

`ACTION_DOMAINS` et `ACTION_LABELS` vivent dans `permissions.ts` (source unique) et sont servis à
l'écran par l'API (§ 6) : le web ne recopie plus la liste des actions. Sept domaines, 28 actions :

| Domaine | Action | Libellé |
|---|---|---|
| **Organisation et équipe** | `organization.manage` | Gérer l'organisation et les membres |
| | `members.invite` | Inviter des membres |
| | `billing.manage` | Gérer l'abonnement — *réservé au Propriétaire* |
| | `audit.read` | Consulter le journal d'audit |
| **Initiatives et plan financier** | `project.read` | Consulter les initiatives |
| | `project.create` | Créer une initiative |
| | `project.update` | Modifier une initiative |
| | `canvas.update` | Rédiger le modèle économique, l'Idea Lab et le business plan |
| | `inputs.update` | Saisir les hypothèses |
| | `plan.calculate` | Calculer le plan |
| | `plan.approve` | Valider un plan |
| **Réalisé et rapports** | `analytics.read` | Consulter le tableau de bord, le brief et les analyses |
| | `actuals.import` | Saisir et importer le réalisé |
| | `period.close` | Clôturer une période |
| | `report.export` | Exporter des rapports |
| **Ventes et facturation** | `sales.read` | Consulter clients, catalogue, devis, factures et encaissements |
| | `sales.manage` | Gérer les clients, le catalogue et les brouillons de facture |
| | `sales.quote` | Préparer et envoyer les devis |
| | `sales.invoice` | Émettre et normaliser les factures et les avoirs |
| | `sales.receipt` | Enregistrer les encaissements |
| | `fiscal.manage` | Gérer l'identité fiscale et la facture normalisée |
| **Trésorerie** | `treasury.read` | Consulter les dépenses, les comptes et la prévision de trésorerie |
| | `treasury.manage` | Enregistrer les dépenses, les comptes et les virements |
| **CRM** | `crm.read` | Consulter le CRM |
| | `crm.manage` | Gérer prospects, contacts, opportunités et relances |
| **Projets et tâches** | `work.read` | Consulter les projets et les tâches |
| | `work.update` | Travailler sur les tâches |
| | `work.manage` | Gérer les projets |

Un test vérifie que chaque action figure dans exactement un domaine et a un libellé.

### 6. Contrats d'API

- **`PATCH /organizations/:orgId/members/:userId/permissions`** —
  `@RequirePermission('organization.manage')` (même permission que le changement de titre).
  Corps `{ grants: Action[], revokes: Action[], expectedRevision: number, reason?: string }`
  (`.strict()`, actions validées par `isAction`, 280 caractères de motif). Remplace l'écart entier
  (pas de fusion). Pour un Comptable, `period.close` dans `grants`/`revokes` écrit
  `canClosePeriods`. Réponse : la ligne du membre (ci-dessous). Erreurs : `403 PERMISSION_ESCALATION`,
  `403 SELF_PERMISSIONS_FORBIDDEN`, `400 PERMISSION_NOT_DELEGABLE`,
  `400 PERMISSION_OVERRIDE_REDUNDANT`, `400 PERMISSION_DEPENDENCY_MISSING`, `409 SOD_CONFLICT`,
  `409 OWNER_PERMISSIONS_FIXED`, `409 STALE_REVISION`, `404 MEMBER_NOT_FOUND`.
- **`PATCH /organizations/:orgId/members/:userId/role`** — accepte en plus `grants?`, `revokes?`,
  `expectedRevision` (§ 3). `PATCH …/close-right` est conservé (compatibilité N-1) et soumis à G2.
- **`GET /organizations/:orgId/members`** — chaque ligne gagne `grants`, `revokes`, `effective`
  (actions effectives), `customized` (écart non vide), `permissionsRevision` ; `manageable` est
  calculé par G1 (ensemble potentiel de la cible inclus dans celui de l'acteur).
- **`POST /organizations/:orgId/invitations`** — corps `{ email, role?, grants?, revokes? }` ;
  validé par `validateOverrides` contre les droits effectifs de l'invitant. À l'acceptation,
  `InvitationsService` revalide contre les droits effectifs **actuels** de l'invitant (aujourd'hui
  `canGrantRole(inviterRole, invitedRole)`) ; sinon `403 INVITATION_INVITER_NO_LONGER_AUTHORIZED`
  (code existant). L'invitation listée affiche son écart.
- **`GET /me/permissions`** — inchangé pour `actions` (désormais effectives), et gagne :
  `roleActions` (ligne du rôle), `grants`, `revokes`, `customized`, `grantableActions` (ce que
  l'appelant peut ajouter à autrui : ses droits effectifs moins `NON_DELEGABLE_ACTIONS`),
  `permissionsRevision`. `grantableRoles` est calculé sur ses droits effectifs.
- **`GET /authz/catalog`** (nouveau, authentifié, sans permission — donnée statique) :
  `domains` (ordre, libellés, actions), `labels`, `dependencies`, `sodPairs`, `nonDelegable`,
  `roleMatrix` (ligne de chaque rôle attribuable, pour l'aperçu à l'invitation).
- **403 du guard** : `{ code: 'FORBIDDEN', action, role, customized }` — `customized: true`
  quand le refus vient d'un retrait, pour que l'écran dise « autorisation retirée à votre compte »
  plutôt que « votre rôle ne le permet pas ».

### 7. Interface

**À l'invitation** (`invite-panel.tsx`) : l'adresse et le titre comme aujourd'hui, puis un lien
« Personnaliser les autorisations ». Fermé, il montre une phrase : « Comptable — 14 autorisations,
celles du titre. » Ouvert, il déplie la grille ci-dessous, préremplie par la ligne du titre.

**La fiche du membre** (nouveau panneau dans `organisation/membres`, ouvert depuis la ligne) :

- en-tête : titre, puis **l'écart en une phrase** : « Comptable, personnalisé : + Gérer les projets,
  − Émettre et normaliser les factures » ; bouton « Revenir aux autorisations
  du titre » (vide l'écart) ;
- grille par domaine (§ 5), une ligne par action, **quatre états lisibles sans couleur** :
  « Inclus dans le titre » (coché), « Ajouté » (coché, étiquette « ajout »), « Retiré » (décoché,
  étiquette « retrait », libellé barré), « Non inclus » (décoché) ; chaque domaine montre son
  compte (« Ventes : 4 sur 6 ») ;
- une case **indisponible** est désactivée **avec sa raison** : « Vous ne détenez pas cette
  autorisation » (G1), « Réservé au Propriétaire » (G3), « Incompatible avec “Valider un plan” —
  séparation des tâches » (G4), « Vous ne pouvez pas modifier vos propres autorisations » (G2) ;
- les dépendances se cochent et se décochent avec un message (§ 4) ;
- enregistrer envoie l'écart entier avec `expectedRevision` ; un `409 STALE_REVISION` recharge la
  fiche et le dit.

**La liste des membres** : à côté du titre, un badge « personnalisé (+2 −1) » ; aucun autre
changement. Le modèle d'écran (calcul des états, raisons, dépendances, phrase d'écart) est une
fonction pure `permissions-model.ts`, testée, qui lit `GET /authz/catalog` et ne décide de rien :
le serveur reste seul juge. Tout le vocabulaire visible dit « autorisation » et « titre », jamais
« action », « grant » ni « override ».

### 8. Offres d'abonnement

**Proposition : aucune limite par offre.** Personnaliser les autorisations est une mesure de
sécurité (retirer un droit), pas un confort premium ; la réserver à une offre pousserait les
petites équipes à donner trop de droits. L'offre gratuite et l'offre solo n'ont qu'un siège :
la question ne s'y pose pas. Décision ouverte n° 6.

### 9. Impact technique

#### 9.1 Où vivent les écarts

`Membership` (`apps/api/src/organizations/membership.schema.ts`) gagne :

```
grants:              { type: [String], enum: ACTIONS, default: [] }
revokes:             { type: [String], enum: ACTIONS, default: [] }
permissionsRevision: { type: Number, default: 0 }
```

`Invitation` gagne `grants` et `revokes` (mêmes définitions). **Aucune migration** : les tableaux
vides par défaut signifient « exactement le titre ». **Piège** : les lectures `.lean()` n'appliquent
pas les valeurs par défaut du schéma ; tout lecteur traite un champ absent comme `[]` (fonction
`overridesOf(doc)` unique dans `authz/`, testée sur un document sans les champs). `_schemaVersion`
reste 2 (champs additifs). L'index `{ organizationId, role }` reste ; un index
`{ organizationId, grants }` sert la recherche des détenteurs effectifs (§ 9.3).

**Compatibilité N-1** : une ancienne instance d'API ignorerait `revokes` et rendrait un droit
retiré. L'écran et la route d'écriture restent derrière l'interrupteur
`MEMBER_PERMISSIONS_ENABLED` (désactivé), allumé **seulement** quand toutes les instances lisent
les écarts **et** que le lot A3 (§ 12) est fusionné (consigne de déploiement, docs/24).

#### 9.2 La décision : `permissions.ts`

- `OrgPermissionContext` gagne `grants?: readonly Action[]` et `revokes?: readonly Action[]`.
  `can(role, action, ctx)` calcule l'effectif (§ 1) ; `canAll`, `firstDeniedAction`, `actionsOf`
  en héritent. **Le paramètre `ctx` devient obligatoire** (plus de `= {}`) : chaque appel qui
  décide avec le rôle seul cesse de compiler, et le compilateur dresse l'inventaire exact du
  § 9.4. Un appel qui n'a vraiment aucun membre derrière lui (rare) passe `NO_OVERRIDES`
  explicitement.
- Nouveaux : `effectiveActions(role, ctx)`, `potentialEffectiveActions(role, ctx)`,
  `validateOverrides({ actorRole, actorCtx, targetRole, targetCtxBefore?, grants, revokes, actorIsTarget })`
  (G1 à G5 et § 4, renvoie un résultat typé, jamais une exception HTTP), `ACTION_DOMAINS`,
  `ACTION_LABELS`, `ACTION_DEPENDENCIES`, `SOD_PAIRS`, `NON_DELEGABLE_ACTIONS`.
- `grantableRoles` / `canGrantRole` prennent les droits effectifs de l'acteur (et non plus son
  rôle). `potentialActionsOf` reste le calcul « case ⚙ comptée ».
- `APPROVER_ROLES` reste, mais n'est plus utilisé seul pour compter (§ 9.3).
- La matrice, `PLATFORM_*`, `sodDecision`, `ORG_ROLE_RANK`, `isOwnerRole`, `OWNER_ROLE`,
  `normalizeOrgRole` sont inchangés.

#### 9.3 La garde et la résolution

- `AuthzService.resolveOrgRole` sélectionne aussi `grants`, `revokes`, `permissionsRevision` et
  les met dans `context`. `PermissionsGuard` est inchangé dans sa forme : il appelle déjà
  `canAll(role, actions, context)` et pose `req.orgRoleContext`.
- `AuthzService.countApprovers` compte les **détenteurs effectifs** de `plan.approve` :
  `{ organizationId, $or: [ { role ∈ APPROVER_ROLES, revokes ≠ 'plan.approve' }, { grants: 'plan.approve' } ] }`.
- Nouveau `AuthzService.holdersOf(organizationId, action)` : même forme de requête pour toute
  action, utilisé par tout destinataire « qui détient X ».
- Nouveau décorateur `@CurrentOrgPermissions()` → `{ role, context }` posé par le guard ;
  `@CurrentOrgRole()` reste pour l'audit et l'affichage, **plus jamais pour décider**.

#### 9.4 Code qui raisonne par rôle et deviendrait faux

Inventaire par recherche dans tout `apps/api/src` (`role ===`, `role !==`, `APPROVER_ROLES`,
`ORG_ROLE_RANK`, `isOwnerRole`, `'owner'`, `role: { $in`, `can(` sans contexte). Trois familles.

**A — Devient faux : à corriger (sécurité ou exactitude).**

| Fichier : ligne | Ce qui raisonne par rôle | Correctif |
|---|---|---|
| `authz/authz.service.ts:45-57` `resolveOrgRole` | ne lit que `role` et `canClosePeriods` | lire l'écart (§ 9.3) — **sans cela rien ne marche** |
| `authz/authz.service.ts:98-101` `countApprovers` (+ `permissions.ts:945` `APPROVER_ROLES`) ; appelants `plans/plans.controller.ts:164`, `business-plan/business-plan.controller.ts:388` | compte `role ∈ APPROVER_ROLES` | détenteurs effectifs — **faille R2 sinon** (G4) |
| `sales/normalization/normalization-alerts.service.ts:46-48, 148` `FISCAL_ADMIN_ROLES` | destinataires des alertes DGI par rôle (et `=== 'allow'` seulement) | `holdersOf(org, 'fiscal.manage')` |
| `permissions.ts:866-897` `potentialActionsOf` / `grantableRoles` / `canGrantRole` ; appelants `organizations/members.service.ts:280`, `members.controller.ts:91, 107, 233` (`manageable`), `organizations/invitations.service.ts:89, 227`, `authz/me.controller.ts:61` | R7 sur la ligne du rôle de l'acteur | G1 sur les droits effectifs |
| `authz/me.controller.ts:49-68` | renvoie `actionsOf(role, ctx)` sans écart | effectif + champs du § 6 |
| `work/work-members.service.ts:51-58, 93-116` `roleOf` + `can(role, …)` | assignables, `canUpdate`, `canManage` des membres d'un projet | lire l'écart des appartenances |
| `work/work.common.ts:23-35` `WorkActor { role }`, `actorCan` ; appelants `work/margin/project-margin.service.ts` (taux horaire sous `treasury.manage`), `work-comments.service.ts`, `work-tasks.service.ts`, `work-projects.service.ts`, `work-attachments.service.ts`, `work-time.service.ts`, `work/billing/work-billing.service.ts` | décision sur le rôle seul | `WorkActor { role, context }` |
| `work/work-reminders.job.ts:134` | `can(role, 'work.read')` sur une carte rôle par utilisateur | carte (rôle, écart) |
| `morning-brief/morning-brief-email.job.ts:170-176` | projection `{ role: 1 }`, `can(role, 'analytics.read')` | projection de l'écart |
| `morning-brief/morning-brief.service.ts:145-146` | `can(role, 'sales.read' / 'work.read')` (et la garde `treasury.read` ajoutée par C0) | passer le contexte |
| `morning-brief/morning-brief.controller.ts:96` | `canManageAi: can(effective, 'organization.manage')` | contexte |
| `notifications/notifications.service.ts:116, 261-265` | projection `{ role, canClosePeriods }` utilisée comme contexte | projeter l'écart (la forme est déjà la bonne) |
| `grow/grow.controller.ts:143` | noms de clients si `can(role, 'sales.read')` (et masquage trésorerie de C0) | contexte |
| `projects/projects.controller.ts:213` | `can(role, 'inputs.update')` pour un calcul qui persiste | contexte |
| `business-plan/business-plan.controller.ts:228-230` | `write`, `validate`, `export` | contexte |
| `business-plan/business-plan-org.controller.ts:61` | `can(role ?? 'viewer', 'organization.manage')` | contexte |
| `idea-lab/idea-lab.controller.ts:89-99` | `canEdit`, `canManageAi` | contexte |
| `organizations/invitations.service.ts:215-245` (acceptation) | revalide par rôle de l'invitant ; crée l'appartenance sans écart | revalider sur l'effectif ; copier l'écart |
| `organizations/members.service.ts:83-125` `changeRole`, `:212-262` `transferOwnership` | ne connaissent pas l'écart | effacer l'écart (§ 3), audit, révision |

**B — Déjà correct si le contexte porte l'écart (aucun changement de logique, test à ajouter).**
`authz/permissions.guard.ts:88-106` ; `organization-space/dashboard.ts:358, 369, 411`,
`organization-space.service.ts:265, 408` (via `CurrentOrgRoleContext`) ;
`sales/normalization/normalization-actions.interceptor.ts:34-36, 60` (via `req.orgRoleContext`) ;
`edef/homologation/homologation.ts:182-185` (via `resolveOrgRole`) ;
`notifications/notifications.rules.ts:82`.

**C — Raisonne par titre à dessein : inchangé.** Ce sont des règles d'**identité** de
propriétaire ou d'ordre d'affichage, pas des autorisations :
`organizations/members.service.ts:229-262, 247, 308` (transfert, R1),
`authz/authz.service.ts:89-91` `countOwners`, `organizations/members.controller.ts:90, 106, 222, 232`
(`isLastOwner`), `account/account.service.ts:188, 202` (`isOwnerRole`, suppression de compte),
`organizations/organizations.service.ts:44, 81, 161` (`ORG_ROLE_RANK`, création de l'organisation
personnelle), `organizations/organizations.controller.ts:73`,
`organizations/members.service.ts:108, 145` (case ⚙ réservée au Comptable, § 1),
`fiscal/normalized-invoicing.service.ts:406` (les **propriétaires** sont prévenus de la
désactivation de la facture normalisée — décision ouverte n° 11), et les rôles utilisés comme
**étiquette d'audit** : `billing/billing.controller.ts:168, 275, 299`,
`fiscal/normalized-invoicing.controller.ts:225`, `actorOf(user, role)` des contrôleurs de ventes,
CRM, trésorerie et Idea Lab (l'audit garde le titre ; G7 y ajoute l'écart quand il change).
Les rôles plateforme (`admin/admin.service.ts:433`, `admin/platform-access.controller.ts:78`) ne
sont pas concernés (G6).

Côté web, `members-model.ts:70` (case ⚙ du Comptable), `:81` et `:132` (transfert, propriétaire)
restent par titre ; tout le reste lit `actions` de `GET /me/permissions`, qui devient effectif.

#### 9.5 Tests de la matrice

- `permissions.test.ts` : la matrice littérale (**9 × 28 + 6 × 28 = 420** cases après C0) est
  **inchangée** ; s'y ajoute l'équivalence « écart vide ⇒ effectif = ligne du rôle » sur les 252
  cases organisation.
- `overrides.test.ts` (nouveau) : un cas par garde-fou et par code d'erreur ; dépendances
  satisfaites par chaque ligne de la matrice ; chaque action dans un seul domaine ; propriété à
  graine fixe (2 000 tirages acteur × cible × écart) : **tout écart accepté** vérifie
  `potentiel(cible) ⊆ effectif(acteur)`, aucune paire `SOD_PAIRS` ajoutée, `billing.manage ∉ grants`,
  écart vide pour `owner`, acteur ≠ cible.
- `rbac-matrix.e2e` : inchangé (aucun écart) ; nouveau `member-permissions.e2e` (§ Critères).
- `routes-coverage.test.ts` : deux routes nouvelles déclarées (`PATCH …/permissions` sous
  `organization.manage`, `GET /authz/catalog` en liste des routes sans permission, justifiée).

#### 9.6 Migration

Aucune (§ 9.1). Un test de lecture d'une appartenance et d'une invitation **sans** les champs
nouveaux prouve qu'elles valent « exactement le titre ».

## Conséquences

- Le titre garde tout son sens (libellé, rang, R1, modèle de départ) ; la dirigeante peut
  ajuster une personne sans inventer de rôle.
- La matrice reste la seule table de vérité des titres, testée case par case ; l'écart est petit,
  stocké sur l'appartenance, borné par huit garde-fous et journalisé.
- R7 devient plus juste (sur les droits effectifs) ; R2 devient exact (compte des approbateurs
  effectifs) — correctif utile même sans écart, puisqu'il prépare toute évolution de la matrice.
- Coût : environ trente appels à `can()` passent par le contexte, trois recherches de
  destinataires passent par `holdersOf`, et le type `WorkActor` change. Rendre `ctx` obligatoire
  fait faire l'inventaire au compilateur : aucun oubli silencieux.
- Une seule nouvelle propriété de déploiement : l'interrupteur `MEMBER_PERMISSIONS_ENABLED` ne
  s'allume qu'après A3 et la mise à jour de toutes les instances.
- Ce qui ne change pas : les rôles, les actions, la matrice, la matrice plateforme, l'accès
  délégué, la case ⚙ et son stockage, `project_manager` non attribuable, le tri de l'organisation
  primaire.

## Critères d'acceptation (testables)

1. Sans écart, `GET /me/permissions` renvoie pour chacun des 9 rôles exactement la ligne de la
   matrice ; `rbac-matrix.e2e` reste vert sans modification.
2. Le Propriétaire ajoute `treasury.read` à un Commercial : `GET /treasury/accounts` passe de `403`
   à `200` **à la requête suivante, sans reconnexion** ; `GET /me/permissions` le montre dans
   `actions` et `grants`, `customized: true`.
3. Le Propriétaire retire `sales.invoice` à un Comptable : `POST /sales/invoices/:id/issue` →
   `403 { code: 'FORBIDDEN', action: 'sales.invoice', customized: true }` à la requête suivante ;
   la vue de normalisation de ses factures ne propose plus « Relancer » ni « Vérifier ».
4. Un Administrateur ajoute `crm.manage` à un Lecteur (avec `crm.read` déjà détenu) : `200`. Il
   tente d'ajouter `sales.invoice` ou `plan.approve` : `403 PERMISSION_ESCALATION`. Il tente de
   modifier un Comptable : `403 PERMISSION_ESCALATION` (cible plus puissante que lui).
5. Tout membre qui vise ses propres autorisations ou son propre droit de clôture :
   `403 SELF_PERMISSIONS_FORBIDDEN`.
6. `billing.manage` dans `grants` : `400 PERMISSION_NOT_DELEGABLE` ; tout écart sur un `owner` :
   `409 OWNER_PERMISSIONS_FIXED` ; un ajout de `transfer` est impossible (ce n'est pas une action) et
   `POST …/transfer-ownership` par un Administrateur reste `403 OWNER_ROLE_REQUIRED`.
7. `plan.approve` ajouté à un Analyste : `409 SOD_CONFLICT { pair: ['inputs.update','plan.approve'] }` ;
   à un Comptable : `409 SOD_CONFLICT { pair: ['period.close','plan.approve'] }` (R3, droit de
   clôture potentiel) ; `fiscal.manage` ajouté à un
   Comptable : `409 SOD_CONFLICT` (si la décision ouverte n° 3 est retenue).
8. Séparation des tâches dynamique : organisation « Propriétaire + Directeur financier privé de
   `plan.approve` » → le Propriétaire auto-approuve, plan marqué `soleApprover: true` ;
   organisation « Propriétaire + Lecteur ayant reçu `plan.approve` » →
   l'auto-approbation du Propriétaire est refusée `409 SELF_APPROVAL_FORBIDDEN`.
9. `sales.manage` ajouté sans `sales.read` : `400 PERMISSION_DEPENDENCY_MISSING { missing: ['sales.read'] }` ;
   retirer `sales.read` à un Comptable qui garde `sales.manage` : même refus ; retirer
   `analytics.read` à un membre qui détient d'autres actions : refus.
10. Un Comptable « + `work.manage`, − `sales.invoice` » devient Analyste : son écart est
    vide, `canClosePeriods` faux, et l'audit `member.role_changed` porte `droppedOverrides`. Le même
    appel portant `{ role: 'analyst', grants: ['crm.manage'] }` écrit le titre et le nouvel écart
    atomiquement.
11. Une invitation « Lecteur + `crm.manage` » créée par un Administrateur donne, à l'acceptation,
    une appartenance avec cet écart ; si l'Administrateur a perdu `crm.manage` entre-temps :
    `403 INVITATION_INVITER_NO_LONGER_AUTHORIZED`, aucune appartenance créée.
12. Chaque écriture d'écart crée un `audit_events` `member.permissions_changed` avec `before` et
    `after` complets ; si l'écriture d'audit échoue (simulée), l'appartenance est inchangée.
13. Deux écritures concurrentes avec la même `expectedRevision` : l'une `200`, l'autre
    `409 STALE_REVISION`.
14. Alertes DGI : un Directeur financier privé de `fiscal.manage` ne reçoit plus l'alerte de
    normalisation incertaine ; un Administrateur ayant reçu `fiscal.manage` la reçoit.
15. Projets : un Lecteur ayant reçu `work.update` est proposé comme responsable d'une tâche et peut
    la cocher ; un Comptable privé de `work.update` ne l'est plus. Sans `treasury.manage`, le taux
    horaire n'est pas visible même avec `work.manage` ajouté.
16. Isolation : `PATCH …/permissions` sur un membre d'une autre organisation → `404` ; un rôle
    plateforme sans appartenance → `404` ; `canPlatform` rend les mêmes 168 réponses avant et après.
17. Une appartenance et une invitation lues **sans** les champs nouveaux valent exactement le titre.
18. Web : la fiche montre les quatre états, la phrase d'écart, les raisons d'indisponibilité ; les
    dépendances se cochent avec message ; après une écriture, la navigation de la personne
    concernée se met à jour au retour de focus.

## Plan de validation

- **Unitaires (vitest)** : `permissions.test.ts` (420 cases inchangées + équivalence écart vide) ;
  `overrides.test.ts` (garde-fous, dépendances, domaines, propriété à graine fixe) ;
  `authz.service.test.ts` (`countApprovers`, `holdersOf`, `overridesOf` sur document sans champs).
- **API e2e (Mongo en mémoire)** : `member-permissions.e2e` (critères 2 à 10, 12, 13, 16) ;
  `invitations.e2e` étendu (critère 11) ; `critical-rules.e2e` étendu (critère 8, R1 et transfert
  avec écart) ; `normalization-alerts` (critère 14) ; `work-*.e2e` (critère 15) ;
  `morning-brief.e2e` (un retrait de `sales.read` masque les faits de ventes).
- **Web (vitest, modèles purs)** : `permissions-model.test.ts` (états, raisons, dépendances,
  phrase d'écart, regroupement) ; `members-model.test.ts` (badge, `manageable`) ;
  `shell-context` (relecture au focus et sur `403`).
- **Contrôles du dépôt** : format, lint, typecheck (l'obligation de `ctx` doit compiler partout),
  `routes-coverage`.
- **Essai de la dirigeante** : inviter une Commerciale avec « + Consulter la trésorerie » ; avec
  elle, ouvrir la trésorerie ; retirer l'ajout depuis sa fiche ; vérifier qu'au retour sur
  l'onglet la trésorerie a disparu ; essayer de se retirer une autorisation à soi-même ; changer
  le titre d'un Comptable personnalisé et lire l'avertissement ; relire le journal d'audit.

## Découpage en lots parallélisables (worktrees séparés)

**Préalable bloquant : la fusion du lot C0 d'ADR-0040** (rôle `sales_rep`, action `sales.quote`,
correctif de trésorerie), qui possède `permissions.ts`, `permissions.test.ts`, `rbac-matrix.e2e`,
`apps/web/src/lib/api.ts`, `members-model.ts` et `invite-panel.tsx`. Aucun lot ci-dessous ne
démarre avant. Règle d'ADR-0011 et d'ADR-0012 § 9 : **un fichier = un seul écrivain** par lot ;
les fichiers partagés ne reçoivent que des ajouts sous un commentaire `// ADR-0041 — <lot>`.

| Lot | Contenu | Fichiers probables (possédés) | Critères | Tests | Dépend de |
|---|---|---|---|---|---|
| **A1 — Décision pure** (petit) | contexte avec écart, `ctx` obligatoire **avec `NO_OVERRIDES` passé explicitement partout où le compilateur l'exige** (aucune logique changée ailleurs), `effectiveActions`, `validateOverrides`, R7 sur l'effectif, domaines, libellés, dépendances, paires, non-délégables | `apps/api/src/authz/permissions.ts`, `permissions.test.ts`, `authz/overrides.test.ts` (nouveau) ; ajout mécanique de `NO_OVERRIDES` dans les appelants (une ligne chacun) | 1 ; parties unitaires de 4 à 9 | unitaires, propriété à graine fixe | **C0 fusionné** |
| **A2 — Stockage, résolution, garde** | champs de `Membership` et `Invitation`, `overridesOf`, `resolveOrgRole`, `countApprovers`, `holdersOf`, `@CurrentOrgPermissions`, `GET /me/permissions` étendu, `GET /authz/catalog`, payload `403` | `organizations/membership.schema.ts`, `invitation.schema.ts`, `authz/authz.service.ts` (+ test), `permissions.guard.ts`, `me.controller.ts`, `authz/catalog.controller.ts` (nouveau), `authz.module.ts`, `authz/current-org-permissions.decorator.ts` (nouveau), `auth/auth.guard.ts` (type seulement) | 1, 8, 16, 17 | unitaires service ; e2e `me/permissions` | A1 |
| **A3 — Appelants qui décident par rôle** (famille A du § 9.4, hors membres et invitations) | passage au contexte effectif | `work/work.common.ts`, `work-members.service.ts`, `work-reminders.job.ts`, `work/margin/project-margin.service.ts` ; `morning-brief/morning-brief.service.ts` (lignes 145-146), `morning-brief.controller.ts`, `morning-brief-email.job.ts` ; `notifications/notifications.service.ts` (projection) ; `sales/normalization/normalization-alerts.service.ts` ; `grow/grow.controller.ts` ; `projects/projects.controller.ts` ; `business-plan/business-plan*.controller.ts` ; `idea-lab/idea-lab.controller.ts` | 3, 14, 15 | e2e work, brief, alertes ; typecheck | A2 ; **après C4** pour `morning-brief.service.ts` et le module `notifications` (rebase sinon) |
| **A4 — Routes de gestion et invitations** | `PATCH …/permissions`, `PATCH …/role` avec écart et effacement, `close-right` sous G2, transfert, acceptation, audit strict en transaction, révision, interrupteur `MEMBER_PERMISSIONS_ENABLED`, notification « Vos autorisations ont changé » | `organizations/members.service.ts`, `members.controller.ts`, `invitations.service.ts`, `invitations.controller.ts` ; `__tests__/member-permissions.e2e.test.ts` (nouveau), `invitations.e2e.test.ts`, `critical-rules.e2e.test.ts` (blocs ajoutés) ; `authz/routes-coverage.test.ts` (bloc en fin) ; `packages/shared/src/notifications/index.ts` (une ligne de type, **après C4**) | 2 à 13 | e2e | A2 (A3 en parallèle) |
| **A5 — Interface** | grille par domaine, fiche du membre, personnalisation à l'invitation, badge, relecture des permissions au focus et sur `403`, article d'aide | `apps/web/src/app/(app)/organisation/membres/**` (dont `_components/permissions-model.ts` + test, `member-permissions-panel.tsx` nouveaux ; `invite-panel.tsx`, `members-model.ts` + test, `members-panel.tsx`) ; `apps/web/src/lib/api-permissions.ts` (nouveau, pour ne pas écrire dans `lib/api.ts`) ; `app/(app)/_components/shell-context.tsx` ; `lib/aide/articles/travailler-a-plusieurs.ts` | 18 | modèles purs web | A4 (contrats) ; **après C0** (mêmes fichiers web) |

Documentation : chaque lot passe sa ligne de docs/12 de « proposé » à « appliqué » ; A4 met à
jour docs/16 (routes), A2 docs/15 (schéma).

### Zones de conflit avec ADR-0040 (lots C1 à C9)

| Fichier | Lots en conflit | Règle |
|---|---|---|
| `apps/api/src/authz/permissions.ts`, `permissions.test.ts`, `rbac-matrix.e2e.test.ts` | C0 | **A1 après C0**, sans exception ; aucun lot C1–C9 n'y écrit |
| `apps/api/src/authz/routes-coverage.test.ts` | C1, C2, C3, C4, C7, C8 ; A2, A4 | blocs ajoutés en fin, un par lot |
| Appels `can(role, …)` sans contexte dans le code **nouveau** de C1–C9 (`crm/accounts/**`, `crm/overview/**` — sections par permission —, `crm/agenda/**`, `crm/brief/**`, `crm/reports/**`, `work/billing/**` de C7) | C1, C2, C3, C4, C7, C8 | consigne aux lots C : décider avec `req.orgRoleContext` / `CurrentOrgRoleContext`, jamais le rôle seul. **Le lot C qui fusionne après A1 recompile avec `ctx` obligatoire** ; celui qui fusionne avant est corrigé par A3 (le compilateur le signale) |
| `apps/api/src/morning-brief/morning-brief.service.ts` | C0, C4 ; A3 | ordre **C0 → C4 → A3** ; A3 ne touche que la décision `can()` |
| `apps/api/src/work/work.common.ts` (`WorkActor`), `work-tasks.service.ts` | C4 (`myTasks`), C7 (`work-billing.service.ts` consomme `WorkActor`) ; A3 | A3 change le type ; **rebaser C4 et C7 si fusionnés après A3**, sinon A3 les corrige |
| `apps/api/src/notifications/**`, `packages/shared/src/notifications/index.ts` | C4 ; A3 (projection), A4 (type nouveau) | **après C4** ; une ligne chacun |
| `apps/web/src/lib/api.ts`, `organisation/membres/_components/members-model.ts`, `invite-panel.tsx`, `lib/aide/articles/travailler-a-plusieurs.ts` | C0 ; A5 | A5 après C0 ; A5 ajoute `lib/api-permissions.ts` plutôt que d'écrire dans `lib/api.ts` |
| `apps/web/src/app/(app)/_components/shell-context.tsx` | aucun lot C | A5 seul |
| `apps/web/src/app/(app)/_components/nav-model.ts` | C5 | A5 n'y touche pas (la navigation lit déjà `actions`, qui devient effectif) |
| `crm/**`, `packages/engine/**`, `apps/web/src/app/(app)/crm/**` | C1–C9 | **aucun lot A n'y écrit** |

### Ordre de fusion conseillé

```
C0 ── A1 ── A2 ──┬── A3 (après C4 pour le brief et les notifications)
                 └── A4 ── A5
Interrupteur MEMBER_PERMISSIONS_ENABLED allumé après A3 + A4 + A5 et toutes les instances à jour.
```

Les lots A sont indépendants du CRM : ils peuvent avancer en parallèle de C1, C2, C3, C5, C6, C8 et
C9. Chemin critique : C0 → A1 → A2 → A4 → A5. Si A3 glisse, l'interrupteur reste éteint : un
retrait non honoré par le brief ou les projets serait une fuite.

## Décisions ouvertes — elles appartiennent à la dirigeante

Chacune a une **valeur par défaut**, appliquée si rien n'est tranché.

1. **Changement de titre** : l'écart est effacé, avec avertissement, et peut être redéfini dans le
   même geste. *Défaut : oui.* Alternative : conserver ce qui reste cohérent avec le nouveau titre
   (plus souple, plus difficile à lire).
2. **Dépendances** : refus par le serveur, complément automatique par l'écran avec message.
   *Défaut : oui.*
3. **Paire `sales.invoice` + `fiscal.manage`** incompatible par ajout (celui qui émet ne pilote pas
   le jeton ni la déclaration « non normalisée »). *Défaut : oui.* Les deux autres paires (R2, R3)
   ne sont pas ouvertes : elles découlent de règles déjà approuvées.
4. **`analytics.read` socle** (tableau de bord, brief, cloche) : non retirable tant qu'une autre
   autorisation est détenue. *Défaut : oui.*
5. **Le titre reste soumis à R7** : un Administrateur ne peut toujours pas inviter un Comptable ni
   un Directeur financier, même en retirant ce qu'il n'a pas. *Défaut : oui (prudent).*
   Alternative : ne juger que l'ensemble effectif, ce qui permettrait « Comptable sans émission »
   invité par un Administrateur.
6. **Offres** : personnalisation ouverte à toutes les offres, sans limite. *Défaut : oui.*
7. **Libellés et domaines** du § 5. *Défaut : cette liste.*
8. **Propriétaire non personnalisable**. *Défaut : oui.*
9. **Case ⚙ du Comptable** : `canClosePeriods` reste son stockage, l'écran l'unifie avec la grille.
   *Défaut : oui ; le replier dans `grants` serait une migration, pour un autre ADR.*
10. **Notification au membre** « Vos autorisations ont changé » (sans détail, lien vers « Mes
    autorisations » dans `/compte`). *Défaut : oui.*
11. **Destinataires de la désactivation de la facture normalisée** : les propriétaires (titre),
    comme aujourd'hui, ou les détenteurs de `fiscal.manage`. *Défaut : les propriétaires,
    inchangé.*
12. **Motif** d'un changement d'écart : facultatif. *Défaut : facultatif, journalisé s'il est
    donné.*

Aucune règle financière, fiscale ou comptable RDC n'est introduite : la paire n° 3 est une règle
de contrôle interne proposée, pas une obligation DGI.

## Liens

- [ADR-0012](ADR-0012-modele-rbac-complet.md) (amendé) ; [ADR-0040](ADR-0040-crm-complet.md) § 4
  (lot C0, préalable) ; [ADR-0011](ADR-0011-contrats-integration-s18.md) ;
  [ADR-0021](ADR-0021-modules-erp-et-identite-fiscale.md) ; [ADR-0023](ADR-0023-factures-et-avoirs.md) ;
  [ADR-0024](ADR-0024-normalisation-dgi.md) ; [ADR-0037](ADR-0037-business-plan-narratif.md) ;
  [ADR-0039](ADR-0039-projets-et-taches-run.md).
- `docs/12-ROLES-PERMISSIONS.md`, `docs/13-PRICING.md` (sièges), `docs/16-API.md`,
  `docs/17-SECURITE.md`.
- `apps/api/src/authz/permissions.ts`, `authz.service.ts`, `permissions.guard.ts`,
  `me.controller.ts`, `audit.service.ts` ; `apps/api/src/organizations/membership.schema.ts`,
  `invitation.schema.ts`, `members.service.ts`, `invitations.service.ts` ;
  `apps/web/src/app/(app)/organisation/membres/**`, `apps/web/src/app/(app)/_components/shell-context.tsx`.
