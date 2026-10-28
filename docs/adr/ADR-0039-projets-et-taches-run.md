# ADR-0039 — Projets et tâches (RUN) : gestionnaire de travail, notifications in-app, marge par projet

Statut : Proposed
Date : 2026-10-29
Décideurs : Gracy Omokoso (dirigeante, besoin validé) ; CTO Lalanda (contrat technique). Les
choix marqués « proposition » sont soumis à la dirigeante (§ Décisions ouvertes).

> **Nouveau module RUN**, hors des trois modules d'[ADR-0018](ADR-0018-trajectoire-erp-trois-modules.md),
> demandé par la dirigeante : un gestionnaire de projets « style Asana », synchronisé avec le
> reste de Lalanda, pour ne plus avoir besoin d'un autre outil. **Amende
> [ADR-0012](ADR-0012-modele-rbac-complet.md) et docs/12** : trois actions nouvelles,
> `work.read`, `work.update`, `work.manage`. **S'appuie sans les modifier** sur
> [ADR-0035](ADR-0035-crm-et-devis.md) (devis, opportunités), [ADR-0023](ADR-0023-factures-et-avoirs.md)
> (brouillon de facture, circuit d'émission), [ADR-0031](ADR-0031-encaissements-et-realise.md)
> (encaissements, `computeSettlement`), [ADR-0034](ADR-0034-depenses-et-tresorerie.md)
> (dépenses), [ADR-0020](ADR-0020-ordonnanceur-mongodb.md) (ordonnanceur), le stockage objet
> (S22j). **Étend** [ADR-0033](ADR-0033-brief-du-matin.md) § 10 (un point d'extension de
> plus : tâches et projets à risque). **Se coordonne avec ADR-0038** (navigation, chantier
> parallèle) : dans l'interface, « Projets » désigne désormais ce gestionnaire de RUN ; le
> plan financier de BUILD s'affiche « Initiative » mais garde, dans le code, `project`,
> `Project`, `projects` et les actions `project.*`.

## Contexte

Les équipes qui utilisent Lalanda pour vendre (devis, factures, encaissements) et dépenser
(trésorerie) suivent leur exécution ailleurs : tableur, WhatsApp, Asana, Trello. Le devis
accepté, les heures passées, les jalons facturables et les dépenses d'un chantier ne se
rejoignent donc nulle part, et la question « ce projet client m'a-t-il rapporté ? » reste sans
réponse. Le brief du matin (ADR-0033) affiche « tâches en retard » et « projets à risque »
**non disponibles** faute de source.

Besoin validé par la dirigeante (oct. 2026) :

- projets **clients** ou **internes** ; tâches, sous-tâches, responsables (membres de
  l'organisation), échéances, priorités, dépendances fin → début, jalons, étiquettes ;
- vues **liste**, **Kanban** (colonnes de statut), **calendrier**, **chronologie** (Gantt), et
  **« Mes tâches »** transverse ;
- commentaires avec **mentions**, **pièces jointes**, **historique d'activité** ;
- **temps passé** saisi par tâche ;
- **boîte de notifications in-app** commune à tout Lalanda (assignation, mention, échéance
  proche ou dépassée), réutilisable par les modules futurs ;
- branchements : devis accepté → projet client pré-rempli ; projet ↔ client, opportunité,
  devis ; jalon terminé → **brouillon** de facture ; **marge par projet** ; tâches en retard et
  du jour dans le brief du matin et sur l'Accueil ;
- isolation stricte par organisation ; ouvert à **toutes les offres** pour l'instant (décision
  du 27 oct. 2026 : on marque, on arbitrera plus tard — docs/13 « À ARBITRER »).

### Faits du dépôt qui commandent les décisions

| Fait | Où | Conséquence |
|---|---|---|
| `projects`, `ProjectsModule`, `/projects`, `project.create/read/update` désignent le **plan financier** BUILD | `apps/api/src/projects/`, `apps/web/src/app/(app)/projects/`, `authz/permissions.ts` | collision de vocabulaire (déjà relevée par ADR-0018 § Contexte) |
| `CDP` (« Chef de projet ») est `allow_project` sur les actions BUILD et **non attribuable** (`ROLE_NOT_ASSIGNABLE`) | `permissions.ts` | il ne peut pas porter le module seul |
| La facture est figée par `contentSha256` ; le devis garde le lien vers sa facture, la facture ne connaît pas le devis | ADR-0023, ADR-0035 § 1 | la facture ne connaîtra pas non plus le projet |
| Un module lit la collection d'un autre **en lecture seule** sans importer son module (le CRM lit `sales_quotes`) | `crm/crm.module.ts` | même motif pour lire devis, dépenses, factures |
| `SalesModule` exporte `InvoiceDraftsService` et `SettlementsService` | `sales/sales.module.ts` | brouillon de facture et encaissé réel réutilisés tels quels |
| Les DTO zod vivent aujourd'hui dans l'API (`*.dto.ts`), le web recopie les types (`lib/api-crm.ts`) | `crm/crm.dto.ts`, `web/src/lib/api-crm.ts` | voir O5 |
| Ordonnanceur en base, tâches récurrentes `every()`, au moins une fois | `scheduler/scheduler.service.ts` | rappels d'échéance |
| Stockage objet à clé tirée au hasard, validateur d'image assaini | `storage/object-key.ts`, `account/image-validation.ts` | pièces jointes |
| Le brief se branche par des **ports** à fournisseur « non disponible » par défaut | `morning-brief/morning-brief.ports.ts` | nouveau port `WORK_SOURCE` |
| Toute route porte `@RequirePermission` ou figure dans `SANS_PERMISSION`, contrôleurs listés exhaustivement | `authz/routes-coverage.test.ts` | chaque contrôleur nouveau y est inscrit |

## Options considérées

### O1 — Nom interne du module

1. **Réutiliser `projects`** (ajouter un `type: 'run'` aux plans). Écarté : un plan financier
   porte versions figées, empreintes, scénarios, réalisé ; un projet d'exécution n'a rien de
   cela. Mêler les deux casserait `project.*`, `maxProjects` (docs/13) et le pont vers le
   réalisé.
2. `run-projects`, `run_projects`, `runProject.*`. Écarté : le préfixe `run` répète le module
   d'interface, se lit mal (`run.read`) et entre en collision avec `run.sales` / `run.expenses`
   (origines du réalisé, ADR-0031) et `run_actuals_bridges`.
3. **`work`** : module `apps/api/src/work/`, collections `work_*`, actions `work.*`, types
   `WorkProject`, `WorkTask`. **Retenu.** Court, sans aucune occurrence dans le dépôt (vérifié
   le 29 oct. 2026), sans ambiguïté avec `project.*` ; « work management » est le nom du
   domaine (Asana, monday). Le **libellé d'interface** reste « Projets » et « Tâches » ; la
   correspondance libellé ↔ code est écrite dans le glossaire (lot L0).

### O2 — Permissions

1. Réutiliser `project.*`. Écarté : ce sont les droits du **plan financier** ; un Analyste
   modélise un plan, il ne gère pas forcément les chantiers, et le Conseiller externe lit les
   plans mais ne doit pas lire les projets clients.
2. Réutiliser `crm.*` ou `sales.*`. Écarté : un projet **interne** n'a rien de commercial ; un
   Lecteur doit pouvoir suivre les tâches sans voir les factures.
3. **Trois actions `work.read`, `work.update`, `work.manage`.** **Retenu.** Trois niveaux et non
   deux : dans un gestionnaire de tâches, la population qui **travaille** (cocher, commenter,
   saisir son temps) est plus large que celle qui **gouverne** (créer, archiver, supprimer un
   projet, régler colonnes et étiquettes). Deux actions forceraient soit à ouvrir la
   suppression de projets à tout contributeur, soit à interdire au contributeur de cocher sa
   tâche.

### O3 — Où vit le lien projet ↔ facture et projet ↔ dépense

1. Champ `workProjectId` sur `sales_invoices`. Écarté : la facture est figée et entre dans le
   journal électronique ; la toucher est un risque sur l'homologation (ADR-0035 O1, même
   raisonnement pour le devis).
2. **Factures : collection de liens côté projet (`work_invoice_links`)** ; la facture ignore le
   projet, comme elle ignore le devis. **Retenu.**
3. **Dépenses : champ facultatif `workProjectId` sur `treasury_expenses`.** **Retenu.** La
   dépense n'est pas figée, et c'est à la saisie de la dépense que l'utilisateur sait à quel
   chantier elle appartient ; une collection de liens imposerait un second geste. Écrit par le
   service des dépenses, qui vérifie l'appartenance en lisant `work_projects` en lecture seule.

### O4 — Où vit le calcul de la marge

1. Dans l'API. Écarté (CLAUDE.md : le moteur est l'unique source des calculs).
2. **Module pur `packages/engine/src/work/`** (`WORK_MARGIN_VERSION = '1.0.0'`), sans horloge ni
   base, centimes en `bigint`, montants échangés en chaînes décimales, comme `receivables` et
   `treasury`. **Retenu.** Il ne touche ni `ENGINE_VERSION` ni les autres versions.
3. Les calculs **non financiers** (détection de cycle des dépendances, conflits de dates,
   rangs du Kanban, regroupement de « Mes tâches ») ne sont pas des calculs financiers : ils
   vivent dans `packages/shared/src/work/scheduling.ts`, fonctions pures partagées par l'API
   (validation) et le web (Gantt, calendrier), pour que l'écran et le serveur ne divergent pas.

### O5 — Où vivent les contrats (zod)

1. Dans l'API, recopiés à la main par le web (pratique actuelle du CRM). Écarté pour ce
   module : quatre vues et un panneau de tâche éditent les mêmes champs ; recopier ~30 corps et
   vues est la source d'écart la plus probable.
2. **`packages/shared/src/work/` et `packages/shared/src/notifications/`**, nouvelles entrées
   d'export `@lalanda/shared/work` et `@lalanda/shared/notifications`. **Retenu.** Contraintes :
   `zod` devient **`peerDependency`** de `@lalanda/shared` (même version que l'API, `^4.6.6`)
   pour partager l'instance et donc la carte d'erreurs globale installée par
   `validation/zod-compat.ts` ; tous les corps sont `.strict()` ; les champs normalisés à la
   main s'écrivent `z.unknown().optional()` (piège zod 4 documenté dans `zod-compat.ts`) ; les
   codes d'erreur métier passent par `params.code`, comme `crm.dto.ts`. Les contrôleurs
   appellent `safeParse` et `invalidRequest()` exactement comme le CRM.

### O6 — Notifications : propres au module ou communes

1. Notifications dans `work_*`. Écarté : la dirigeante veut une boîte **commune** ; le CRM
   (relances), les factures (échéances) et le brief s'y brancheront.
2. **Module générique `apps/api/src/notifications/`**, alimenté par un **port**
   (`NOTIFICATIONS_PORT`) que les modules producteurs injectent, avec un fournisseur nul par
   défaut (motif de `morning-brief.ports.ts`). **Retenu.** Le module de notifications ne connaît
   aucun module producteur ; il stocke, déduplique, sert et marque comme lu.

### O7 — Visibilité des projets

1. Projets privés avec liste de membres (Asana). Reporté : impose un second contrôle d'accès,
   par ressource, sur chaque lecture (liste, Mes tâches, calendrier, brief, notifications).
2. **Tout membre détenant `work.read` voit tous les projets de son organisation.** **Retenu pour
   R1** (proposition, décision ouverte n° 2). Le modèle réserve un champ `visibility` (valeur
   unique `organization`) pour ouvrir `members` plus tard sans migration.

## Décision

### 1. Vocabulaire

| Interface (français) | Code | Collection |
|---|---|---|
| Projet | `WorkProject` | `work_projects` |
| Tâche, sous-tâche, jalon | `WorkTask` (`parentTaskId`, `isMilestone`) | `work_tasks` |
| Statut (colonne du Kanban) | `WorkColumn` | dans `work_projects.columns` |
| Étiquette | `WorkLabel` | dans `work_settings.labels` |
| Commentaire | `WorkComment` | `work_comments` |
| Pièce jointe | `WorkAttachment` | `work_attachments` |
| Temps passé | `WorkTimeEntry` | `work_time_entries` |
| Coût horaire d'un membre | `WorkMemberRate` | `work_member_rates` |
| Historique | `WorkActivity` | `work_activity` |
| Facture liée | `WorkInvoiceLink` | `work_invoice_links` |
| Réglages | `WorkSettings` | `work_settings` |
| Notification | `Notification` | `notifications`, `notification_preferences` |

Dates civiles `AAAA-MM-JJ` au **jour de Kinshasa** (UTC+1, ADR-0027) ; horodatages en UTC.
Tous les documents portent `organizationId`, `revision` (sauf journaux), `createdBy`,
`updatedBy`, horodatages et `_schemaVersion: 1`. Ressource d'une autre organisation : **404**.
Écriture concurrente : `expectedRevision` → `409 STALE_REVISION`.

### 2. Modèles de données

#### 2.1 `work_settings` (un document par organisation, défaut implicite)

| Champ | Règle |
|---|---|
| `labels` | 0 à 50 `{ key, label (1–40), color }` ; `key` stable `^[a-z0-9_-]{1,32}$` ; `color` dans la palette fermée du design system (`packages/ui`), jamais un code libre |
| `defaultColumns` | colonnes proposées à la création d'un projet (règles de 2.2) ; défaut : `todo` « À faire » (`todo`), `doing` « En cours » (`in_progress`), `review` « En revue » (`in_progress`), `done` « Terminé » (`done`) |
| `dueSoonDays` | 0 à 14, défaut **1** (« échéance proche » = aujourd'hui ou dans N jours) |
| `revision`, horodatage | |

Retirer une étiquette utilisée : refusé (`409 WORK_LABEL_IN_USE`, avec le nombre de tâches).

#### 2.2 `work_projects`

| Champ | Règle |
|---|---|
| `name` | 1 à 120 caractères |
| `description` | ≤ 5 000, texte brut (rendu sans HTML) |
| `kind` | `client` \| `internal` |
| `status` | `active` · `on_hold` · `completed` · `archived` ; seul `archived` masque le projet des listes par défaut et de « Mes tâches » |
| `ownerUserId` | responsable du projet, membre de l'organisation détenant `work.update`, ou `null` |
| `startDate`, `dueDate` | facultatives ; `dueDate ≥ startDate` (`WORK_DATES_INVERTED`) |
| `links.customerId` | `null` ou un client (`customers`) de l'organisation ; requis non nul seulement si le projet vient d'un devis client |
| `links.opportunityId` | `null` ou une opportunité (`crm_opportunities`) de l'organisation |
| `links.quoteIds` | 0 à 10 devis (`sales_quotes`) de l'organisation |
| `source` | `null` \| `{ kind: 'quote', quoteId, quoteVersion, createdAt }` |
| `columns` | 2 à 12 `{ key, label (1–40), category }`, `category` ∈ `todo · in_progress · done` ; **au moins une** `todo` et **exactement une** `done` (la colonne « terminée » est unique : terminer une tâche a un sens) ; renommer, ajouter, réordonner : libre ; retirer une colonne qui porte des tâches ou changer sa catégorie : `409 WORK_COLUMN_IN_USE` / `WORK_COLUMN_CATEGORY_CHANGED` |
| `visibility` | `organization` (seule valeur en R1, O7) |
| `taskSeq` | compteur des numéros de tâche du projet (`$inc` atomique) |
| `archivedAt`, `completedAt` | |

Index : `{ organizationId: 1, status: 1, updatedAt: -1 }` ; `{ organizationId: 1, 'links.customerId': 1 }` ;
`{ organizationId: 1, 'links.opportunityId': 1 }` ; **unique partiel**
`{ organizationId: 1, 'source.quoteId': 1 }` (`source.kind = 'quote'`) : créer un projet depuis
le même devis deux fois rend `409 WORK_PROJECT_EXISTS_FOR_QUOTE` avec l'identifiant existant.

Bornes techniques (pas des droits d'offre) : 500 projets non archivés par organisation
(`WORK_PROJECT_LIMIT`), 5 000 tâches par projet (`WORK_TASK_LIMIT`).

#### 2.3 `work_tasks`

| Champ | Règle |
|---|---|
| `projectId` | projet de l'organisation, non archivé pour toute écriture (`WORK_PROJECT_ARCHIVED`) |
| `number` | entier attribué à la création (`taskSeq`), affiché `#12` ; jamais réutilisé |
| `parentTaskId` | `null` ou une tâche **du même projet** sans parent : **un seul niveau** de sous-tâches (`WORK_SUBTASK_DEPTH`) ; 100 sous-tâches au plus |
| `title` | 1 à 300 |
| `description` | ≤ 10 000, texte brut |
| `columnKey` | une colonne du projet ; `done` (booléen) et `completedAt`/`completedBy` sont **dénormalisés** de la catégorie de la colonne, écrits par le service dans la même mise à jour |
| `rank` | chaîne d'ordre fractionnaire (rang lexicographique, `shared/work/scheduling.ts`) dans la colonne ; la vue liste suit le même rang |
| `assigneeUserId` | `null` ou un membre de l'organisation détenant `work.update` (`WORK_ASSIGNEE_NOT_ELIGIBLE`) — vérifié par `can(rôle, 'work.update')`, jamais par un nom de rôle |
| `followerUserIds` | 0 à 20 membres détenant `work.read` ; l'auteur, le responsable et toute personne mentionnée y sont ajoutés |
| `priority` | `none` · `low` · `medium` · `high` · `urgent` |
| `labelKeys` | 0 à 10 clés de `work_settings.labels` |
| `startDate`, `dueDate` | facultatives ; `dueDate ≥ startDate` |
| `isMilestone` | jalon : `startDate` interdite (durée nulle), `dueDate` **requise** (`WORK_MILESTONE_NEEDS_DATE`), pas de sous-tâche |
| `blockedBy` | 0 à 20 dépendances `{ taskId, type: 'finish_to_start' }` : la tâche ne devrait pas commencer avant la fin de `taskId` ; prédécesseur **du même projet** (décision ouverte n° 4), jamais elle-même, **aucun cycle** (`WORK_DEPENDENCY_CYCLE`, détection par `detectCycle`) |
| `loggedMinutes` | **cache** de la somme des saisies de temps non supprimées, maintenu par `$inc` dans la même transaction que la saisie ; recalculable (`recomputeLoggedMinutes`) |
| `estimateMinutes` | facultatif, 0 à 100 000 ; informatif, jamais utilisé dans un calcul de coût |
| `source` | `null` \| `{ kind: 'quote_line', quoteId, lineIndex }` |
| `billing` | jalon seulement : `null` \| `{ invoiceId, preparedAt, preparedBy }` (brouillon préparé, § 6.3) |

**Invariants vérifiés par le service** : un conflit de dates entre une tâche et son prédécesseur
(début du successeur ≤ échéance du prédécesseur) n'est **pas bloquant** : la réponse porte
`warnings: [{ code: 'WORK_DEPENDENCY_DATE_CONFLICT', taskId, predecessorId }]` et le Gantt le
montre ; aucune date n'est déplacée automatiquement (décision ouverte n° 5). Une tâche dont un
prédécesseur n'est pas terminé est affichée « bloquée » (calcul de lecture, jamais stocké).
Terminer une tâche parent ne termine pas ses sous-tâches ; l'écran le signale.

**Suppression** : `DELETE` seulement si ni la tâche ni ses sous-tâches ne portent de temps saisi
(`409 WORK_TASK_HAS_TIME`) ni de facture préparée (`409 WORK_TASK_HAS_INVOICE`) ; sinon on la
termine. La suppression retire la tâche des `blockedBy` des autres, supprime ses commentaires,
marque ses pièces jointes supprimées et écrit l'historique.

Index : unique `{ organizationId: 1, projectId: 1, number: 1 }` ;
`{ organizationId: 1, projectId: 1, columnKey: 1, rank: 1 }` (Kanban, liste) ;
`{ organizationId: 1, projectId: 1, parentTaskId: 1 }` ;
`{ organizationId: 1, assigneeUserId: 1, done: 1, dueDate: 1 }` (Mes tâches, brief) ;
`{ organizationId: 1, done: 1, dueDate: 1 }` (rappels, projets à risque) ;
`{ organizationId: 1, projectId: 1, startDate: 1, dueDate: 1 }` (calendrier, Gantt) ;
`{ organizationId: 1, 'blockedBy.taskId': 1 }`.

#### 2.4 `work_comments`

`projectId`, `taskId`, `authorUserId`, `body` (1 à 5 000, texte brut), `mentionedUserIds` (0 à
20 ; **le client envoie la liste**, le serveur la vérifie : membres détenant `work.read`,
`WORK_MENTION_NOT_ELIGIBLE` sinon ; dans le texte, une mention s'écrit `@[userId]` et se rend
avec le nom courant du membre), `attachmentIds` (0 à 10, pièces de la même tâche), `editedAt`,
`deletedAt` (suppression **logique** : « Commentaire supprimé » reste dans le fil, texte effacé).
Modifier : l'auteur seul. Supprimer : l'auteur, ou un détenteur de `work.manage` (contrôle de
ressource dans le service, avec `can()`). Index `{ organizationId: 1, taskId: 1, createdAt: 1 }`.

#### 2.5 `work_attachments`

`projectId`, `taskId`, `commentId | null`, `objectId` (32 hex, `newObjectId()`), clé
`work-attachments/<objectId>` dans `S3_BUCKET_UPLOADS`, `fileName` (nom assaini, ≤ 200 :
séparateurs de chemin et caractères de contrôle retirés), `contentType` **déduit du contenu**,
`size`, `sha256`, `uploadedBy`, `deletedAt`.

- **Images** PNG, JPEG, WebP ≤ 2 Mio : **assainies** par `account/image-validation.ts` (octets
  reconstruits, métadonnées retirées), servies `inline` avec leur type.
- **PDF** ≤ 10 Mio : reconnus par leur signature `%PDF-`, **non analysés**, servis
  **uniquement en téléchargement** (`Content-Disposition: attachment`,
  `Content-Type: application/pdf`, `X-Content-Type-Options: nosniff`,
  `Content-Security-Policy: sandbox`). Proposition (décision ouverte n° 7) ; ADR-0034 décision
  n° 6 a refusé le PDF pour les reçus de dépense parce qu'il aurait fallu l'analyser ; ici on
  ne l'analyse pas, on le sert inerte.
- Tout autre type : `415 WORK_ATTACHMENT_TYPE`.
- Corps **binaire brut** (motif du logo et des reçus), nom transmis en en-tête `X-File-Name`
  (encodé URI) ; 30 envois par heure et par utilisateur (`UserThrottlerGuard`).
- Borne technique : 1 Gio de pièces non supprimées par organisation (`WORK_STORAGE_FULL`).
- Supprimer marque `deletedAt` puis efface l'objet (`deleteObject`) ; un objet orphelin est
  inoffensif (clé au hasard, aucune URL publique).

#### 2.6 `work_time_entries`

| Champ | Règle |
|---|---|
| `projectId`, `taskId` | tâche de l'organisation (le projet est dénormalisé de la tâche) |
| `userId` | qui a travaillé ; défaut : l'appelant ; saisir pour un autre exige `work.manage` (`403 WORK_TIME_FOR_OTHER`) ; membre de l'organisation |
| `workedOn` | `AAAA-MM-JJ`, jamais futur (`WORK_TIME_IN_FUTURE`) |
| `minutes` | entier 1 à 1 440 ; **somme par (utilisateur, jour) ≤ 1 440** (`WORK_TIME_DAY_OVERFLOW`) |
| `note` | ≤ 500 |
| `deletedAt` | suppression logique (le coût passé d'un projet ne disparaît pas sans trace) |

Modifier ou supprimer sa propre saisie : `work.update` ; celle d'un autre : `work.manage`. Le
coût **n'est pas stocké** : il se calcule à la lecture avec le taux en vigueur au jour
`workedOn` (§ 5). Index : `{ organizationId: 1, projectId: 1, workedOn: 1 }`,
`{ organizationId: 1, userId: 1, workedOn: 1 }`, `{ organizationId: 1, taskId: 1 }`.

Hors R1 : minuteur (chronomètre), temps facturable, feuilles de temps à valider (§ Hors
périmètre).

#### 2.7 `work_member_rates` (facultatif)

`userId`, `currency` (`CDF` | `USD`), `hourlyCost` (chaîne décimale > 0, deux décimales au
plus), `effectiveFrom` (`AAAA-MM-JJ`), `createdBy`. Unique
`{ organizationId: 1, userId: 1, effectiveFrom: 1 }`. Le taux applicable à une saisie est celui
dont `effectiveFrom` est le plus récent ≤ `workedOn` ; sans taux, la saisie est **sans coût** et
comptée comme telle (`minutesWithoutRate`), jamais valorisée à zéro en silence. Un taux est
une donnée salariale : lecture et écriture réservées (§ 7). Journalisé (`audit_events` :
`work.rate.set|removed`).

#### 2.8 `work_activity` (historique)

Journal **append-only**, distinct d'`audit_events` (qui reste le journal de sécurité) :
`projectId`, `taskId | null`, `actorUserId`, `kind`, `data` (petit différentiel
`{ from, to }`, ≤ 2 Kio, sans texte de commentaire), `at`. Types : `project.created|updated|archived|restored|completed`,
`task.created|updated|moved|assigned|unassigned|due_changed|completed|reopened|deleted`,
`dependency.added|removed`, `comment.added|edited|deleted`, `attachment.added|removed`,
`time.logged|updated|deleted`, `invoice.linked|unlinked|prepared`. Index
`{ organizationId: 1, taskId: 1, at: -1 }`, `{ organizationId: 1, projectId: 1, at: -1 }`.
Conservation : illimitée en R1 (volume faible) ; `audit_events` reçoit en plus les actes
sensibles (suppression de projet, taux, export).

#### 2.9 `work_invoice_links`

`projectId`, `invoiceId` (`sales_invoices` de l'organisation, type `FV`/`EV`, pas un avoir),
`milestoneTaskId | null`, `origin` (`milestone` | `manual`), `linkedAt`, `linkedBy`. **Unique
`{ organizationId: 1, invoiceId: 1 }`** : une facture appartient à un projet au plus. Une
facture brouillon supprimée laisse un lien orphelin, ignoré à la lecture et nettoyé au
passage.

#### 2.10 Champ additionnel `treasury_expenses.workProjectId`

`null` par défaut ; sinon un projet de l'organisation non archivé à l'écriture
(`EXPENSE_WORK_PROJECT_UNKNOWN`). Index `{ organizationId: 1, workProjectId: 1 }` (partiel,
non nul). Aucun autre comportement de la dépense ne change (pont vers le réalisé, catégories,
prévision : inchangés).

#### 2.11 `notifications` et `notification_preferences` (module générique)

`notifications` :

| Champ | Règle |
|---|---|
| `organizationId`, `recipientUserId` | destinataire, membre de l'organisation |
| `kind` | union fermée déclarée dans `shared/notifications` : `work.task_assigned`, `work.mentioned`, `work.comment_on_followed`, `work.task_due_soon`, `work.task_overdue`, `work.milestone_completed` (les modules futurs ajoutent leurs types, ex. `crm.follow_up_due`) |
| `requiredAction` | action que le destinataire doit **encore** détenir pour voir la notification (ex. `work.read`) ; filtrée à la lecture |
| `source` | `{ module: 'work', entityType: 'task' \| 'project', entityId, projectId? }` |
| `title` | ≤ 200, **figé à l'émission** (« Kevin vous a assigné #12 Poser le carrelage ») |
| `href` | chemin **relatif** de l'application (`/projets/<id>?tache=<id>`), validé `^/[^/]` (jamais une URL absolue) |
| `actorUserId` | `null` pour un rappel automatique |
| `dedupeKey` | facultatif ; unique `{ organizationId, recipientUserId, dedupeKey }` (partiel) : un rappel d'échéance ne part qu'une fois par (tâche, échéance, type) |
| `readAt`, `createdAt` | |

Index : `{ recipientUserId: 1, organizationId: 1, readAt: 1, createdAt: -1 }` ; **TTL 180 jours**
sur `createdAt` (`NOTIFICATIONS_RETENTION_DAYS`, 30 à 365).

`notification_preferences` : un document par (utilisateur, organisation), `mutedKinds` (types
coupés), défaut : rien de coupé. L'**auteur d'un geste n'est jamais notifié de son propre
geste**.

### 3. Contrats partagés (`packages/shared`)

| Fichier | Contenu |
|---|---|
| `src/work/constants.ts` | `WORK_PROJECT_KINDS`, `WORK_PROJECT_STATUSES`, `WORK_COLUMN_CATEGORIES`, `WORK_PRIORITIES`, `WORK_DEPENDENCY_TYPES`, `DEFAULT_WORK_COLUMNS`, bornes (§ 2) |
| `src/work/schemas.ts` | corps zod `.strict()` : `CreateWorkProjectBody`, `UpdateWorkProjectBody`, `CreateProjectFromQuoteBody`, `CreateWorkTaskBody`, `PatchWorkTaskBody`, `MoveWorkTaskBody`, `AddDependencyBody`, `CreateWorkCommentBody`, `UpdateWorkCommentBody`, `CreateTimeEntryBody`, `UpdateTimeEntryBody`, `SetMemberRateBody`, `LinkInvoiceBody`, `PrepareInvoiceBody`, `PutWorkSettingsBody`, requêtes de liste (`ListWorkProjectsQuery`, `ListWorkTasksQuery`, `ListTimeEntriesQuery`) |
| `src/work/views.ts` | types de réponse : `WorkProjectView`, `WorkProjectSummary`, `WorkTaskView`, `WorkTaskDetail`, `MyTasksView`, `WorkCommentView`, `WorkAttachmentView`, `TimeEntryView`, `TimeSummaryView`, `ProjectMarginView`, `WorkActivityView`, `WorkWarning` |
| `src/work/scheduling.ts` | fonctions pures, sans horloge : `detectCycle`, `dependencyConflicts`, `isBlocked`, `rankBetween`, `groupMyTasks(tasks, today, dueSoonDays)` (en retard · aujourd'hui · 7 jours · plus tard · sans date), `ganttRows(tasks)` |
| `src/notifications/index.ts` | `NOTIFICATION_KINDS`, `NotificationView`, `ListNotificationsQuery`, `PutNotificationPreferencesBody` |

Montants : **chaînes décimales**, jamais des `number` (`DECIMAL_MUST_BE_STRING`, docs/26). Les
réponses de liste sont paginées par **curseur** (`time-cursor.ts` du CRM), sauf
`GET /work/projects/:id/tasks`, qui rend tout le projet (≤ 5 000, Kanban et Gantt en ont
besoin) avec une projection allégée (sans `description`).

### 4. Routes API

Préfixes `/work/…` et `/notifications/…`. Tous les contrôleurs : `@UseGuards(AuthGuard, PermissionsGuard)`,
`@RequirePermission(…)` par route ; une liste d'actions signifie « toutes requises ».

**Projets** — `WorkProjectsController`

| Méthode et chemin | Permission | Corps / requête |
|---|---|---|
| `GET /work/projects` | `work.read` | `ListWorkProjectsQuery` (statut, nature, client, `q`, curseur) ; compteurs : tâches ouvertes, en retard, prochain jalon |
| `POST /work/projects` | `work.manage` | `CreateWorkProjectBody` |
| `GET /work/projects/:projectId` | `work.read` | — |
| `PUT /work/projects/:projectId` | `work.manage` | `UpdateWorkProjectBody` (+ `expectedRevision`) |
| `POST /work/projects/:projectId/archive` · `…/restore` | `work.manage` | `{ expectedRevision }` |
| `DELETE /work/projects/:projectId` | `work.manage` | refusé si temps saisi, facture liée ou dépense rattachée (`409 WORK_PROJECT_NOT_EMPTY` : archiver) |
| `POST /work/projects/from-quote` | `work.manage` + `sales.read` | `CreateProjectFromQuoteBody` (§ 6.1) |
| `GET /work/projects/:projectId/activity` | `work.read` | curseur |

**Tâches** — `WorkTasksController`

| Méthode et chemin | Permission | Corps / requête |
|---|---|---|
| `GET /work/projects/:projectId/tasks` | `work.read` | filtres : responsable, étiquette, terminé, échéance de/à |
| `POST /work/projects/:projectId/tasks` | `work.update` | `CreateWorkTaskBody` (avec `parentTaskId`, `afterTaskId` facultatifs) |
| `GET /work/tasks` | `work.read` | `ListWorkTasksQuery` transverse (`assignee=me\|<id>`, projet, échéance de/à, terminé, étiquette, curseur) : calendrier transverse |
| `GET /work/my-tasks` | `work.read` | — ; rend `MyTasksView` groupé par `groupMyTasks` (projets archivés exclus) |
| `GET /work/tasks/:taskId` | `work.read` | détail : sous-tâches, dépendances (avec état bloqué), compteurs commentaires et pièces, `loggedMinutes` |
| `PATCH /work/tasks/:taskId` | `work.update` | `PatchWorkTaskBody` : champs partiels + `expectedRevision` ; réponse `{ task, warnings }` |
| `POST /work/tasks/:taskId/move` | `work.update` | `MoveWorkTaskBody` `{ columnKey, beforeTaskId?, afterTaskId?, expectedRevision }` (glisser-déposer et menu clavier) |
| `POST /work/tasks/:taskId/complete` · `…/reopen` | `work.update` | `{ expectedRevision }` : vers la colonne `done`, ou vers la première `todo` |
| `DELETE /work/tasks/:taskId` | `work.manage` | — (§ 2.3) |
| `POST /work/tasks/:taskId/dependencies` | `work.update` | `AddDependencyBody` `{ predecessorTaskId }` |
| `DELETE /work/tasks/:taskId/dependencies/:predecessorTaskId` | `work.update` | — |

**Commentaires et pièces jointes** — `WorkCommentsController`, `WorkAttachmentsController`

| Méthode et chemin | Permission |
|---|---|
| `GET /work/tasks/:taskId/comments` | `work.read` |
| `POST /work/tasks/:taskId/comments` | `work.update` |
| `PUT /work/comments/:commentId` · `DELETE /work/comments/:commentId` | `work.update` (auteur ; suppression aussi par `work.manage`, contrôle de ressource) |
| `GET /work/tasks/:taskId/attachments` | `work.read` |
| `POST /work/tasks/:taskId/attachments` | `work.update` (corps binaire, débit limité) |
| `GET /work/attachments/:attachmentId` | `work.read` (octets, en-têtes inertes) |
| `DELETE /work/attachments/:attachmentId` | `work.update` (déposant ; sinon `work.manage`) |

**Temps et coûts** — `WorkTimeController`

| Méthode et chemin | Permission |
|---|---|
| `GET /work/time-entries` | `work.read` (minutes seulement, jamais de coût) |
| `POST /work/tasks/:taskId/time-entries` | `work.update` (pour autrui : `work.manage`, contrôle de service) |
| `PUT /work/time-entries/:entryId` · `DELETE /work/time-entries/:entryId` | `work.update` (les siennes ; celles d'autrui : `work.manage`) |
| `GET /work/projects/:projectId/time-summary` | `work.read` (minutes par membre, par tâche, par semaine) |
| `GET /work/rates` | `work.read` + `treasury.manage` |
| `POST /work/rates` · `DELETE /work/rates/:rateId` | `work.manage` + `treasury.manage` |

**Branchements** — `WorkBillingController` (lot L4a)

| Méthode et chemin | Permission |
|---|---|
| `GET /work/projects/:projectId/invoices` | `work.read` + `sales.read` |
| `POST /work/projects/:projectId/invoices` | `work.manage` + `sales.read` (`LinkInvoiceBody { invoiceId }`) |
| `DELETE /work/projects/:projectId/invoices/:invoiceId` | `work.manage` |
| `POST /work/tasks/:taskId/prepare-invoice` | `work.read` + `sales.manage` (`PrepareInvoiceBody`, § 6.3) |
| `GET /work/projects/:projectId/margin` | `work.read` + `sales.read` + `treasury.read` (§ 5) |

**Réglages** — `WorkSettingsController` : `GET /work/settings` (`work.read`), `PUT /work/settings`
(`work.manage`).

**Notifications** — `NotificationsController`

| Méthode et chemin | Permission |
|---|---|
| `GET /notifications` | `analytics.read` (les siennes, organisation active, curseur, `unreadOnly`) |
| `GET /notifications/unread-count` | `analytics.read` |
| `POST /notifications/:notificationId/read` · `POST /notifications/read-all` | `analytics.read` |
| `GET /notifications/preferences` · `PUT /notifications/preferences` | `analytics.read` |

Pourquoi `analytics.read` : c'est la convention établie par le brief du matin pour une donnée
**personnelle de l'appelant dans l'organisation active** (`MorningBriefController.getPreferences`) :
les huit rôles la détiennent, la route exige une organisation et `PermissionsGuard` l'applique.
Une action `notifications.read` détenue par tous n'apporterait rien d'autre qu'une ligne de
matrice. Chaque notification porte en outre son `requiredAction`, revérifiée à la lecture :
un membre qui perd `work.read` ne voit plus les titres de tâches qu'on lui avait notifiés.

Erreurs au format des contrôleurs de ventes (`{ error: { code, message, details, correlationId } }`),
codes `SCREAMING_SNAKE_CASE` listés au § 2.

### 5. Marge par projet (moteur `packages/engine/src/work/`)

**Où** : `computeProjectMargin(input)`, fonction pure ; l'API (`work/margin/project-margin.service.ts`)
ne fait que **lire** et passer les données. `WORK_MARGIN_VERSION = '1.0.0'` est rendu avec le
résultat.

**Entrées** (lues par l'API, organisation courante seulement) :

| Composante | Source | Règle |
|---|---|---|
| **Encaissé** | factures de `work_invoice_links` du projet | par facture **finale** de la série réelle (`issued`, `normalized`) : paiements **non `CREDIT`** déclarés au gel (réglé à l'émission) **+** lettrages des encaissements non annulés (`received` de `computeSettlement`, ADR-0031 § 2, via `SettlementsService.byIds`). Un brouillon, une pro forma ou une facture de la série d'essai n'apporte rien |
| **Remboursé** | avoirs finaux qui visent une facture liée | leurs paiements **non `CREDIT`** sont de l'argent rendu : retranchés de l'encaissé (proposition, décision ouverte n° 9) |
| **Dépenses** | `treasury_expenses` avec ce `workProjectId`, `status = recorded` | montant **payé** (TTC si une TVA a été payée : même choix prudent qu'ADR-0034 § 5) |
| **Coût du temps** | `work_time_entries` non supprimées du projet | Σ (minutes × taux en vigueur au jour `workedOn`) ÷ 60, calcul **exact** en `bigint` (centimes × minutes), **un seul arrondi** au centime (demi vers le haut) par devise à la fin ; une saisie sans taux → `minutesWithoutRate` |

**Résultat**, **par devise** (`CDF`, `USD`), **aucune conversion** (ADR-0031 décision n° 3) :

```
marge(devise) = encaissé(devise) − remboursé(devise) − dépenses(devise) − coût du temps(devise)
```

avec, pour chaque devise, les quatre composantes, le nombre de documents, et des **constats**
codés : `MULTI_CURRENCY` (plusieurs devises : jamais additionnées), `TIME_WITHOUT_RATE`
(minutes non valorisées, avec leur nombre), `NO_INVOICE_LINKED`, `DRAFT_INVOICES_IGNORED`,
`AMOUNTS_INCLUDE_TAX` (encaissements et dépenses sont des montants payés, TVA comprise —
décision ouverte n° 8). Filtre de période facultatif `from`/`to` (dates de l'encaissement, de
la dépense, du travail). Le **facturé** des factures liées (bases HT, `revenueBaseOf`
d'ADR-0031) est rendu à côté, **pour information**, jamais soustrait.

**Ce que la marge n'est pas** : ni un réalisé, ni une prévision, ni une donnée du plan. Elle
**n'alimente jamais** `actual_periods` ni un plan figé (ADR-0018 : « RUN alimente le réalisé,
jamais le plan figé » — et le pont vers le réalisé reste celui des ventes et des dépenses,
inchangé ; la marge par projet n'écrit nulle part, elle se recalcule à chaque lecture).
L'interface l'étiquette « Marge encaissée du projet — calculée par Lalanda à partir des
encaissements, des dépenses et du temps saisis ».

**Détail par membre** (minutes × taux) : rendu seulement si l'appelant détient
`treasury.manage` (contrôle `can()` dans le service, comme le bloc ventes du brief) ; sinon,
seul le total du coût du temps paraît, pour ne pas révéler un taux horaire.

### 6. Branchements avec les modules existants

#### 6.1 Devis accepté → projet client (ADR-0035)

- **Proposer, jamais imposer.** Sur la fiche d'un devis `accepted` (web, `/ventes/devis/[id]`),
  un encadré « Créer le projet » paraît si l'appelant détient `work.manage` et qu'aucun projet
  n'existe pour ce devis ; sinon, un lien « Ouvrir le projet ». Le service des devis **n'est
  pas modifié** : aucun projet n'est créé automatiquement à l'acceptation.
- `POST /work/projects/from-quote` `{ quoteId, name?, lineIndexes?: number[], milestone?: { title, dueDate } }` :
  lit `sales_quotes` **en lecture seule** (motif du CRM) ; exige `status = accepted`
  (`WORK_QUOTE_NOT_ACCEPTED`) ; crée un projet `kind: 'client'`, nom par défaut = objet du
  devis ou « Projet DV… », `links.customerId` = client du devis (`null` pour un client de
  passage), `links.opportunityId` = celle du devis, `links.quoteIds = [quoteId]`,
  `source = { kind: 'quote', quoteId, quoteVersion }` ; **une tâche par ligne retenue**
  (`lineIndexes`, défaut : toutes), titre = désignation de la ligne, description = quantité et
  unité (**aucun montant recopié** : le devis fait foi), `source = { kind: 'quote_line', … }` ;
  un jalon final facultatif. Idempotent par l'index unique (§ 2.2).

#### 6.2 Références client, opportunité, devis

Lecture seule des collections `customers`, `crm_opportunities`, `sales_quotes` pour valider et
afficher les noms (404 si autre organisation). La fiche d'opportunité du CRM et la fiche client
affichent « Projets liés » (`GET /work/projects?customerId=…|opportunityId=…`) si l'appelant
détient `work.read` ; le CRM n'écrit rien dans `work_*`.

#### 6.3 Jalon terminé → brouillon de facture

- Quand un **jalon** passe dans la colonne `done`, la réponse porte
  `suggestions: [{ code: 'PREPARE_INVOICE', taskId }]` si le projet a un client et que le
  jalon n'a pas de facture préparée ; l'écran propose « Préparer la facture » aux détenteurs de
  `sales.manage`. Une notification `work.milestone_completed` va au responsable du projet.
- `POST /work/tasks/:taskId/prepare-invoice` `{ source: 'quote_lines', quoteId, lineIndexes } | { source: 'empty' }` :
  crée un **brouillon** `FV` par `InvoiceDraftsService.create` (le service existant, sans
  changement) : client du projet, devise du devis ; lignes du devis **à prix fixés** comme la
  conversion d'ADR-0035 (O3, `lineInputOf(l, true)`), ou aucune ligne (`empty`) ; commentaire C
  « Projet <nom> — jalon <titre> ». Puis lien `work_invoice_links` (`origin: 'milestone'`) et
  `billing` sur le jalon. Une seule facture préparée par jalon (`409 WORK_MILESTONE_ALREADY_INVOICED`,
  sauf si le brouillon a été supprimé).
- **Jamais émise, jamais normalisée, jamais envoyée** : la facture suit son circuit
  (ADR-0023), « Émettre » ou « Normaliser » restent des gestes de l'utilisateur sous
  `sales.invoice`. Aucun appel e-MCF/DGI n'est fait par ce module.
- Facturation au pourcentage du devis ou par échéancier : hors R1 (décision ouverte n° 10) —
  ce serait un calcul nouveau à définir dans le moteur, pas une règle à inventer ici.

#### 6.4 Dépenses rattachées (ADR-0034)

Champ `workProjectId` sur la dépense (§ 2.10) ; formulaire de dépense : sélecteur « Projet »
(facultatif, visible si `work.read`) ; liste des dépenses filtrable par projet. Les dépenses
récurrentes ne portent pas de projet en R1.

#### 6.5 Brief du matin et Accueil (ADR-0033)

- **Port** `WORK_SOURCE` dans `morning-brief.ports.ts`, fournisseur réel dans
  `morning-brief.run-sources.ts` (`WorkBriefSource`, lecture de `work_tasks`/`work_projects`),
  fournisseur nul par défaut pour les tests.
- **Faits** (moteur `morning-brief`, version mineure suivante), visibles seulement si
  l'appelant détient `work.read` (sinon `hidden`) :
  `mes_taches.en_retard`, `mes_taches.aujourdhui` (tâches non terminées assignées à
  l'appelant, échéance < ou = aujourd'hui), `taches.en_retard` (organisation),
  `projets_a_risque` (projets actifs ayant un **jalon** en retard, ou ≥ **3** tâches en retard —
  seuil S7, paramètre produit à valider). Remplacent les faits « non disponibles » du § 2
  d'ADR-0033.
- **Règles** : R8 `taches_en_retard` (attention si `mes_taches.en_retard` > 0, recommandation
  « ouvrir Mes tâches ») ; R9 `jalon_depasse` (attention si `projets_a_risque` > 0). Elles
  citent leurs faits et leur seuil, comme les sept existantes ; l'IA du brief les explique sans
  les produire.
- **E-mail quotidien** : les deux faits personnels y figurent pour le destinataire (chaque
  destinataire a ses propres tâches) ; même garde de membership et de rôle.
- **Accueil** (page d'arrivée d'ADR-0038) : carte « Mes tâches » (en retard, aujourd'hui, 5
  premières, lien vers `/projets/mes-taches`) alimentée par `GET /work/my-tasks` ; masquée sans
  `work.read`.

#### 6.6 Notifications émises par le module

| Type | Déclencheur | Destinataires |
|---|---|---|
| `work.task_assigned` | responsable posé ou changé | le nouveau responsable |
| `work.mentioned` | commentaire avec mention | chaque mentionné (s'il détient encore `work.read`) |
| `work.comment_on_followed` | commentaire | abonnés de la tâche, hors auteur et hors mentionnés (déjà notifiés) |
| `work.task_due_soon` | rappel : échéance dans `[aujourd'hui, aujourd'hui + dueSoonDays]` | responsable |
| `work.task_overdue` | rappel : échéance dépassée, tâche non terminée | responsable (une fois par échéance) |
| `work.milestone_completed` | jalon terminé | responsable du projet |

**Rappels** : tâche récurrente `work.due-reminders` de l'ordonnanceur, toutes les **15 minutes**,
active à partir de **7 h à Kinshasa** (alignée sur le brief) ; lot de 500 tâches par passage ;
`dedupeKey = <type>:<taskId>:<dueDate>` : changer l'échéance rouvre un rappel, rejouer la tâche
n'en crée pas de doublon. Avant l'envoi : membership existante et `work.read` détenue.
L'émission passe toujours par le port, **hors** de la transaction métier (une notification
perdue ne défait pas une assignation).

**In-app seulement en R1.** Pas d'e-mail par notification, pas de push (décision ouverte n° 6).
L'interface interroge `GET /notifications/unread-count` toutes les **60 s** quand l'onglet est
visible (pas de WebSocket en R1).

### 7. Permissions (amende ADR-0012 et docs/12)

Trois actions, **en fin de `ACTIONS`**, ordre de fusion (25ᵉ, 26ᵉ, 27ᵉ si rien d'autre n'est
fusionné avant) :

| Action | PRO | ADM | DIR | CPT | ANA | CDP | CON | LEC |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| `work.read` — « Consulter les projets et les tâches » | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ |
| `work.update` — « Travailler sur les tâches » (créer, modifier, déplacer, commenter, joindre, saisir son temps) | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| `work.manage` — « Gérer les projets » (créer, archiver, supprimer, colonnes, étiquettes, réglages, temps d'autrui) | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |

Justifications :

- **ADM gère** : « membres, projets, paramètres » (docs/12) ; l'organisation du travail est de
  la gouvernance, pas un acte financier.
- **CPT et ANA travaillent, ne gouvernent pas** (proposition, décision ouverte n° 3).
- **CON refusé** : externe (banquier, mentor) ; un projet client porte des données de clients,
  comme le CRM.
- **LEC lit** : « lecture seulement », comme `crm.read` et `treasury.read`.
- **CDP refusé** : le rôle est non attribuable et borné aux plans BUILD ; l'ouvrir au
  gestionnaire de tâches est une décision ouverte (n° 1), car c'est le rôle le plus naturel
  pour ce module.
- Les gestes qui touchent l'argent **cumulent** les actions : marge (`work.read` + `sales.read`
  + `treasury.read`), taux (`treasury.manage`), facture préparée (`sales.manage`), projet depuis
  un devis (`sales.read`). Aucun `if (role === …)` : les contrôles de ressource (auteur d'un
  commentaire, saisie d'autrui, détail par membre) utilisent `can(rôle, action)`.

Plateforme, comme `crm.*` : `work.read` sous accès délégué (super-administrateur, support) ;
`work.update` et `work.manage` sous accès délégué (super-administrateur seul) ; aucune n'est un
interdit absolu. Rôles attribuables (R7) inchangés.

Fichiers et tests touchés : `apps/api/src/authz/permissions.ts` (ACTIONS, deux matrices,
commentaires d'en-tête), `permissions.test.ts` (8 × 27 + 6 × 27 = **378** cases, longueur 27),
`apps/api/src/__tests__/rbac-matrix.e2e.test.ts` (sonde de bout en bout),
`routes-coverage.test.ts` (contrôleurs et `attendu`), `docs/12-ROLES-PERMISSIONS.md`, type
`OrgAction` de `apps/web/src/lib/api.ts`.

### 8. Interface (web)

- **Barre latérale, groupe RUN** : entrées « Projets » (`/projets`, `work.read`) et « Mes
  tâches » (`/projets/mes-taches`, `work.read`), placées **en tête de RUN** (le travail du
  jour) — position finale arrêtée avec ADR-0038, qui possède `nav-model.ts`.
- **Chemin** `/projets` (français, comme `/ventes`, `/tresorerie`, `/idees`), distinct de
  `/projects` (plans BUILD). Si ADR-0038 renomme ou redirige `/projects`, il prévaut sur ce
  point ; aucun chemin de ce module ne commence par `/projects`.
- `/projets` : liste des projets (filtres statut, nature, client), « Nouveau projet ».
- `/projets/[id]` : en-tête (nom, client, devis, responsable, dates, progression) et onglets
  **Liste** (`/liste`, défaut), **Kanban** (`/kanban`), **Calendrier** (`/calendrier`),
  **Chronologie** (`/chronologie`), **Temps**, **Marge** (si permissions), **Activité**,
  **Réglages** (`work.manage`).
- **Panneau de tâche** (`?tache=<id>`, tiroir latéral, plein écran sous 768 px) : titre,
  statut, responsable, dates, priorité, étiquettes, dépendances, sous-tâches, description,
  pièces jointes, commentaires avec mentions (`@` propose les membres détenant `work.read`),
  temps saisi, historique.
- **Kanban** : colonnes = statuts ; glisser-déposer **et** équivalent clavier (menu « Déplacer
  vers… », flèches) — accessibilité ADR-0030 § 5 ; 360 px : une colonne à la fois, défilement
  horizontal par colonne.
- **Calendrier** : mois et semaine, tâches à échéance (jalons distingués par la forme, pas
  seulement la couleur) ; déplacer change l'échéance.
- **Chronologie (Gantt)** : barres début → échéance, losanges pour les jalons, flèches de
  dépendance, conflit de dates surligné **et** libellé ; tâche sans dates listée à part
  (« non planifiées ») ; rendu en SVG/CSS maison, **aucune dépendance nouvelle** ; lecture
  seule sous 768 px.
- **Mes tâches** : groupes en retard · aujourd'hui · 7 jours · plus tard · sans date, tous
  projets ; bascule liste / calendrier.
- **Cloche de notifications** dans la barre du haut (compteur, panneau des 20 dernières,
  « Tout marquer comme lu ») et page `/notifications`.
- Aucun montant calculé côté web : marge, coût et totaux viennent de l'API.

### 9. Offres (docs/13)

Ouvert à **toutes les offres**, sans garde d'offre (décision du 27 oct. 2026). Ligne ajoutée
au tableau « À ARBITRER ». Bornes techniques actuelles (500 projets actifs, 5 000 tâches par
projet, 1 Gio de pièces jointes) : ce ne sont pas des droits d'offre ; la question de les
transformer en droits fait partie de l'arbitrage.

## Hors périmètre (R1)

- Temps **facturable** et facturation automatique du temps ; taux de vente horaires.
- Gestion des **ressources et de la charge** (capacité, disponibilité, équilibrage).
- Minuteur, feuilles de temps à valider, congés.
- Projets privés, invités externes, portail client ; dépendances entre projets.
- Modèles de projet, tâches récurrentes, automatisations (« quand… alors… »), formulaires.
- Recalcul automatique des dates selon les dépendances.
- Notifications par e-mail ou push ; temps réel (WebSocket).
- Facturation au pourcentage ou par échéancier ; envoi de facture.
- Import depuis Asana, Trello ou un CSV ; export CSV (à venir, sur le motif du CRM).
- Toute écriture de la marge dans le réalisé ou dans un plan.
- IA (résumé de projet, suggestions de tâches) : l'IA reste explicative et passera par un ADR.

## Conséquences

- Collections nouvelles : `work_settings`, `work_projects`, `work_tasks`, `work_comments`,
  `work_attachments`, `work_time_entries`, `work_member_rates`, `work_activity`,
  `work_invoice_links`, `notifications`, `notification_preferences` ; champ additionnel
  `treasury_expenses.workProjectId`. Toutes portent `organizationId`.
- Trois actions RBAC (27 au total) ; docs/12, ADR-0012, matrices de test, sonde e2e, couverture
  des routes et type web alignés.
- Nouveau module moteur `work` (marge) ; extension du moteur `morning-brief` (faits et règles
  R8, R9).
- `@lalanda/shared` gagne deux entrées (`./work`, `./notifications`) et `zod` en
  `peerDependency` — première fois que des contrats zod y vivent (O5).
- Nouvelle tâche récurrente `work.due-reminders`.
- Le brief du matin ne dit plus « non disponible » pour les tâches et projets à risque.

## Critères d'acceptation (testables)

1. Un membre `viewer` voit projets et tâches et reçoit `403` sur toute écriture ; un `advisor`
   reçoit `403` sur `GET /work/projects` ; un `analyst` crée et déplace une tâche mais reçoit
   `403` sur `POST /work/projects`.
2. Toute ressource `work_*` d'une autre organisation répond `404`, y compris par identifiant
   forgé dans un corps (`parentTaskId`, `predecessorTaskId`, `quoteId`, `invoiceId`,
   `attachmentIds`, `mentionedUserIds`, `workProjectId` d'une dépense).
3. Ajouter une dépendance qui ferme un cycle répond `409 WORK_DEPENDENCY_CYCLE` ; un conflit
   de dates rend `200` avec l'avertissement `WORK_DEPENDENCY_DATE_CONFLICT`.
4. Déplacer une tâche vers la colonne `done` pose `done`, `completedAt`, `completedBy` ; la
   rouvrir les efface ; deux déplacements concurrents : le second reçoit `409 STALE_REVISION`.
5. Une sous-tâche de sous-tâche est refusée ; un jalon sans échéance est refusé.
6. « Mes tâches » ne contient que les tâches assignées à l'appelant dans l'organisation
   active, hors projets archivés, groupées selon le jour de Kinshasa (test à 23 h 30 UTC).
7. Mentionner un membre sans `work.read` répond `400 WORK_MENTION_NOT_ELIGIBLE` ; mentionner
   un membre éligible lui crée **une** notification ; l'auteur n'en reçoit aucune.
8. Le rappel d'échéance ne crée qu'une notification par (tâche, échéance, type), même rejoué
   trois fois ; changer l'échéance en crée une nouvelle ; un ancien membre n'en reçoit plus.
9. Une notification dont le destinataire a perdu `work.read` disparaît de sa liste et du
   compteur.
10. Une image jointe est réécrite (métadonnées retirées) ; un PDF est servi en
    `Content-Disposition: attachment` ; un fichier HTML renommé `.pdf` est refusé `415`.
11. La saisie de temps future, ou qui porterait un jour au-delà de 1 440 minutes, est refusée ;
    saisir pour autrui sans `work.manage` répond `403`.
12. Créer un projet depuis un devis `accepted` crée une tâche par ligne retenue sans aucun
    montant ; une seconde fois répond `409 WORK_PROJECT_EXISTS_FOR_QUOTE` ; depuis un devis
    `sent`, `409 WORK_QUOTE_NOT_ACCEPTED`.
13. Préparer la facture d'un jalon crée un brouillon `FV` sans numéro fiscal, dont les lignes
    et le total sont ceux du devis (mêmes prix) ; aucune normalisation n'est déclenchée (faux
    serveur e-MCF non appelé) ; une seconde préparation répond `409`.
14. Marge : projet avec une facture USD réglée à moitié à l'émission puis par un encaissement,
    une dépense USD, 90 minutes à 12,50 USD/h et 30 minutes sans taux → valeurs exactes
    attendues, constat `TIME_WITHOUT_RATE` (30 min) ; une dépense CDF produit une seconde
    devise et le constat `MULTI_CURRENCY`, jamais une somme. `actual_periods` est inchangé
    avant et après.
15. Sans `treasury.manage`, la marge ne rend pas le détail par membre ; sans `treasury.read`,
    la route répond `403`.
16. Brief : un utilisateur avec deux tâches en retard voit `mes_taches.en_retard = 2` et la
    règle R8 ; un rôle sans `work.read` voit ces faits `hidden` et les règles non évaluées.
17. Couverture des routes verte ; matrice 378 cases verte ; `OrgAction` web compile.

## Plan de tests

- **Shared (vitest)** : `detectCycle` (graphe vide, boucle sur soi, cycle long, diamant),
  `dependencyConflicts`, `rankBetween` (insertion entre deux rangs, en tête, 1 000 insertions
  successives sans collision), `groupMyTasks` (bornes de jour à Kinshasa), schémas zod
  (`.strict()`, montants en chaînes, codes).
- **Moteur (vitest)** : `computeProjectMargin` — arrondi unique, taux par période
  (`effectiveFrom`), saisies sans taux, devises séparées, avoir remboursé, factures non
  finales ignorées ; tests par propriétés à graine fixe (marge = somme des composantes, en
  arithmétique de contrôle propre au test).
- **API e2e (Mongo en mémoire, motif des e2e existants)** : `work-projects.e2e`,
  `work-tasks.e2e` (Kanban, dépendances, sous-tâches, suppression bloquée),
  `work-collab.e2e` (commentaires, mentions, pièces jointes avec stockage simulé),
  `work-time.e2e`, `work-billing.e2e` (devis → projet, jalon → brouillon puis émission par le
  circuit normal, marge), `notifications.e2e` (déduplication, préférences, filtrage par
  permission, rappels avec horloge injectée), isolation entre deux organisations sur chaque
  route, RBAC par rôle (sonde `rbac-matrix.e2e`).
- **Brief** : faits et règles R8/R9 au seuil exact ; e-mail avec faits personnels.
- **Web (vitest, modèles purs)** : `projets/_components/*-model.ts` (filtres, colonnes, menu
  clavier de déplacement, rendu des mentions), `gantt-model.ts`, `calendar-model.ts`,
  `notifications-model.ts`, `nav-model.test.ts` (entrées et conditions), `routes.test.ts`
  (`/projets`, `/notifications` protégés).
- **Essai de la dirigeante** : accepter un devis de trois lignes, créer le projet, assigner
  deux tâches à un membre, mentionner ce membre, poser un jalon, saisir 2 h, rattacher une
  dépense, terminer le jalon, préparer la facture, l'émettre elle-même, enregistrer un
  encaissement, lire la marge ; le lendemain, voir la tâche en retard dans le brief.

## Découpage en lots d'implémentation

Règle d'ADR-0011 et d'ADR-0012 § 9 : **un fichier = un seul écrivain** par lot ; les fichiers
partagés ne reçoivent que des **ajouts** d'une ligne ou d'un bloc, chacun dans sa zone.

| Lot | Contenu | Fichiers possédés | Dépend de |
|---|---|---|---|
| **L0 — Socle** (petit, en premier) | contrats partagés, actions RBAC, port de notifications | `packages/shared/src/work/**`, `packages/shared/src/notifications/**`, `packages/shared/package.json` (exports, `zod` en peer), `packages/shared/src/index.ts` (rien : sous-chemins seulement) ; `apps/api/src/authz/permissions.ts`, `permissions.test.ts`, `apps/api/src/__tests__/rbac-matrix.e2e.test.ts` ; `apps/api/src/notifications/notifications.port.ts` (jeton, interface `NotificationsPort.notify(input)`, `noNotifications`) ; `apps/web/src/lib/api.ts` (type `OrgAction` seulement) ; `docs/12`, amendement d'ADR-0012, `docs/GLOSSAIRE.md` | — |
| **L1 — API cœur** | projets, tâches, dépendances, commentaires, pièces jointes, temps, taux, réglages, historique, rappels | `apps/api/src/work/**` **sauf** `work/billing/**` et `work/margin/**` ; `apps/api/src/__tests__/work-*.e2e.test.ts` (sauf `work-billing`) | L0 |
| **L2 — Notifications** | module générique, cloche, page | `apps/api/src/notifications/**` sauf le port ; `apps/api/src/__tests__/notifications.e2e.test.ts` ; `apps/web/src/lib/notifications-api.ts` ; `apps/web/src/app/(app)/notifications/**` ; `apps/web/src/app/(app)/_components/notifications-bell*.tsx` | L0 (indépendant de L1 : le port est le contrat) |
| **L3a — Web liste, Kanban, Mes tâches** | coquille du module et vues principales | `apps/web/src/lib/work-api.ts` ; `apps/web/src/app/(app)/projets/**` **sauf** `[id]/calendrier/**`, `[id]/chronologie/**`, `mes-taches/calendrier/**` | L0 (contrats) ; e2e réel avec L1 |
| **L3b — Web calendrier et chronologie** | vues temporelles | `apps/web/src/app/(app)/projets/[id]/calendrier/**`, `projets/[id]/chronologie/**`, `projets/mes-taches/calendrier/**`, `projets/_components/gantt-*`, `projets/_components/calendar-*` | L0 ; onglets posés par L3a (`projets/[id]/layout.tsx`) ; lit `work-api.ts` sans l'écrire (ajout demandé à L3a) |
| **L4a — Branchements argent** | devis → projet, jalon → brouillon, liens facture, dépense rattachée, marge | `packages/engine/src/work/**` ; `apps/api/src/work/billing/**`, `apps/api/src/work/margin/**` ; `apps/api/src/__tests__/work-billing.e2e.test.ts` ; `apps/api/src/treasury/treasury.schemas.ts`, `treasury.dto.ts`, `treasury-expenses.service.ts` (champ `workProjectId`) ; `apps/web/src/app/(app)/ventes/devis/[id]/**` (encadré « Créer le projet ») ; formulaire de dépense de `apps/web/src/app/(app)/tresorerie/**` ; onglet Marge `projets/[id]/marge/**` | L1 |
| **L4b — Brief et Accueil** | faits, règles, e-mail, carte d'Accueil | `packages/engine/src/morning-brief/**` (faits et règles R8, R9) ; `apps/api/src/morning-brief/morning-brief.ports.ts`, `morning-brief.run-sources.ts`, `morning-brief.module.ts`, `morning-brief.service.ts`, `mail/mail.templates.ts` (bloc du brief) ; `apps/web/src/app/(app)/organisation/brief/**` ; carte « Mes tâches » de l'Accueil (fichier fixé par ADR-0038) | L1 ; ADR-0038 livré pour l'Accueil |

**Ordre** : L0 → { L1, L2, L3a } en parallèle → { L3b (après le squelette de L3a), L4a, L4b }
en parallèle. Chemin critique : L0 → L1 → L4a.

**Fichiers partagés à risque de conflit** (ajouts seulement, une zone par lot) :

| Fichier | Lots | Règle |
|---|---|---|
| `apps/api/src/app.module.ts` | L1 (`WorkModule`), L2 (`NotificationsModule`, **avant** `WorkModule`, `@Global` comme `MailModule`) | une ligne d'import et une d'`imports` chacun |
| `apps/api/src/authz/routes-coverage.test.ts` | L1, L2, L4a | contrôleurs et bloc `attendu` ajoutés **à la fin**, chacun sous un commentaire `// ADR-0039 — <lot>` ; L0 n'y touche pas (aucune route) |
| `apps/web/src/lib/routes.ts` | L2 (`/notifications`), L3a (`/projets`) | une entrée chacun dans `PROTECTED_PREFIXES` |
| `apps/web/src/app/(app)/_components/nav-model.ts` (+ test) | **ADR-0038 (R0) est propriétaire** ; L3a ajoute ses deux entrées et l'icône `projets`/`mes-taches` **après** la fusion de R0, ou les lui confie | risque le plus élevé : R0 réécrit ce fichier |
| barre du haut de la coquille (`_components/`, fichier fixé par R0) | L2 (insertion de la cloche) | une ligne ; après la fusion de R0 |
| `packages/engine/src/index.ts` | L4a (`export * from './work/index.js'`) | une ligne |
| `apps/web/src/lib/api.ts` | L0 seulement (`OrgAction`) | les autres lots n'y écrivent pas : ils ont `work-api.ts` et `notifications-api.ts` |
| `apps/api/src/treasury/**` | L4a seulement | trois fichiers, champ additionnel |
| `docs/13-PRICING.md` | ce lot de documentation | déjà fait ici |

## Décisions ouvertes — elles appartiennent à la dirigeante

1. **Chef de projet (CDP)** : le rendre attribuable avec `work.read`, `work.update` et
   `work.manage` (sans accès aux ventes ni à la trésorerie) ? *Recommandation : oui, dans un lot
   suivant (R2), car c'est le rôle naturel du module ; refusé en R1 tant que ses actions BUILD
   restent bornées aux assignations qui n'existent pas.*
2. **Visibilité** : tout membre lecteur voit tous les projets. *Recommandation : garder pour R1 ;
   projets privés en R2 si une équipe le demande (le champ `visibility` est réservé).*
3. **Comptable et Analyste** : contribuent sans gouverner (pas de `work.manage`). *Recommandation :
   confirmer ; dans une petite équipe, le Propriétaire ou l'Administrateur crée les projets.*
4. **Dépendances entre projets** : refusées en R1. *Recommandation : confirmer ; le Gantt d'un
   projet resterait lisible.*
5. **Décalage automatique des dates** quand un prédécesseur glisse : non, avertissement
   seulement. *Recommandation : confirmer ; un décalage silencieux surprend plus qu'il n'aide.*
6. **E-mail de notification** (assignation, mention) : non en R1, le brief quotidien porte déjà
   les tâches du jour. *Recommandation : ajouter un résumé quotidien optionnel en R2 plutôt qu'un
   e-mail par événement.*
7. **Pièces jointes PDF** servies en téléchargement, sans analyse, 10 Mio ; images 2 Mio.
   *Recommandation : accepter ; les documents Office restent refusés en R1.*
8. **Marge TTC ou HT** : encaissements et dépenses sont des montants payés, TVA comprise, ce
   qui surestime la marge d'un assujetti. *Recommandation : TTC en R1, étiqueté, en attendant la
   décision n° 1 d'ADR-0034 (charge HT ou TTC) — à trancher avec l'expert-comptable, et à
   appliquer aux deux en même temps.*
9. **Avoirs remboursés** retranchés de l'encaissé du projet. *Recommandation : oui (argent rendu).*
10. **Facturation au pourcentage ou par échéancier** d'un devis depuis un jalon. *Recommandation :
    R2, avec une règle de calcul ajoutée au moteur et validée par l'expert-comptable.*
11. **Seuil « projet à risque »** (S7 : un jalon en retard ou trois tâches en retard) et
    **échéance proche** (1 jour) : paramètres produit. *Recommandation : confirmer ces valeurs.*
12. **Offres** : ouvert à toutes les offres, bornes techniques seulement. *Recommandation :
    arbitrer avec le reste du tableau « À ARBITRER » ; le temps et la marge (qui croisent ventes
    et trésorerie) sont les candidats naturels à une offre payante.*
13. **Nom du chemin** `/projets` : dépend d'ADR-0038. *Recommandation : `/projets` ; si ADR-0038
    garde `/projects` pour les initiatives, envisager de le rediriger vers `/initiatives` pour
    lever la confusion.*

## Liens

- [ADR-0011](ADR-0011-contrats-integration-s18.md) ; [ADR-0012](ADR-0012-modele-rbac-complet.md) (amendé) ;
  [ADR-0018](ADR-0018-trajectoire-erp-trois-modules.md) ; [ADR-0020](ADR-0020-ordonnanceur-mongodb.md) ;
  [ADR-0023](ADR-0023-factures-et-avoirs.md) ; [ADR-0030](ADR-0030-refonte-ui-ux.md) ;
  [ADR-0031](ADR-0031-encaissements-et-realise.md) ; [ADR-0033](ADR-0033-brief-du-matin.md) (étendu) ;
  [ADR-0034](ADR-0034-depenses-et-tresorerie.md) ; [ADR-0035](ADR-0035-crm-et-devis.md) ;
  ADR-0038 (navigation, chantier parallèle).
- [docs/12](../12-ROLES-PERMISSIONS.md) ; [docs/13](../13-PRICING.md) ; [docs/17](../17-SECURITE.md) ;
  [docs/26](../26-CONVENTIONS.md).
- Code (à créer) : `packages/shared/src/work/`, `packages/shared/src/notifications/`,
  `packages/engine/src/work/`, `apps/api/src/work/`, `apps/api/src/notifications/`,
  `apps/web/src/app/(app)/projets/`, `apps/web/src/app/(app)/notifications/`.
