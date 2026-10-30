# ADR-0040 — CRM complet (R2) : application RUN, comptes 360°, pipeline v2, relances dans « Mes tâches », rôle Commercial

Statut : Proposed
Date : 2026-10-29
Décideurs : Gracy Omokoso (dirigeante) — **quatre décisions prises le 29 oct. 2026**, appliquées
telles quelles (§ Contexte) ; CTO Lalanda (contrat technique). Les choix marqués « proposition »
sont soumis à la dirigeante (§ Décisions ouvertes).

> **Prolonge [ADR-0035](ADR-0035-crm-et-devis.md)** (CRM minimal et devis) sans en changer le
> cycle du devis ni le calcul des montants. **Amende [ADR-0012](ADR-0012-modele-rbac-complet.md)
> et docs/12** : un neuvième rôle d'organisation, **Commercial** (`sales_rep`), et une action
> nouvelle, **`sales.quote`** (vingt-huitième), qui sépare les devis de `sales.manage`.
> **Amende [ADR-0038](ADR-0038-navigation-par-modules-et-initiatives.md) § 2** : le CRM quitte
> l'espace Ventes et devient l'application RUN `/crm`. **Étend
> [ADR-0039](ADR-0039-projets-et-taches-run.md)** : « Mes tâches », le calendrier de mes tâches,
> la cloche et le brief reçoivent les relances CRM, et une opportunité gagnée peut donner un
> projet (§ 6.1 réutilisé). **Étend [ADR-0033](ADR-0033-brief-du-matin.md)** : un point
> d'extension (`CRM_SOURCE`), une règle R10. **S'appuie sans les modifier** sur
> [ADR-0022](ADR-0022-clients-catalogue-et-calcul-des-factures.md) (fiche client, NIF, catalogue),
> [ADR-0023](ADR-0023-factures-et-avoirs.md), [ADR-0024](ADR-0024-normalisation-dgi.md) et
> [ADR-0031](ADR-0031-encaissements-et-realise.md) (factures, normalisation, encaissements).

## Contexte

Le CRM d'ADR-0035 est « minimal » à dessein : contacts et prospects, opportunités sur un pipeline
personnalisable, activités et relances, probabilité historique par étape, import et export CSV.
Il vit sous `/ventes/crm`, dans l'espace Ventes. À l'usage, quatre manques ressortent :

1. **Pas de fiche entreprise.** Un prospect n'est qu'un `companyName` recopié sur chaque contact
   et un `prospectName` recopié sur chaque opportunité ; un client est une fiche de Ventes qui ne
   montre ni ses contacts, ni ses opportunités, ni ses devis. Personne ne voit « tout ce qui
   concerne cette entreprise » au même endroit.
2. **Pas de responsable.** Une opportunité n'a pas de propriétaire ; une activité n'a pas
   d'assigné. Une équipe de vente ne peut ni répartir ni mesurer.
3. **Deux listes de tâches.** Les relances CRM vivent dans le CRM, les tâches dans « Mes
   tâches » (R1, ADR-0039). Un commercial qui ouvre « Mes tâches » le matin ne voit pas ses
   rappels clients ; la cloche et le brief non plus.
4. **Pas de rôle pour vendre.** Gérer le CRM et préparer des devis exige aujourd'hui
   `sales.manage`, qui ouvre aussi la création et la modification des clients et des prix du
   catalogue, et les brouillons de facture. Les rôles qui ont `crm.manage` (Propriétaire,
   Administrateur, Directeur financier, Comptable) voient tous la trésorerie.

### Décisions déjà prises par la dirigeante (29 oct. 2026)

| N° | Décision | Où elle est traduite |
|---|---|---|
| D1 | **Le CRM devient sa propre application RUN**, route web `/crm`, sous-options Pipeline, Comptes, Contacts, Activités, Rapports, Réglages ; les anciennes routes `/ventes/crm/**` redirigent en **308** ; l'application Ventes garde Factures, Devis, Encaissements, Clients, Catalogue et Modèle de facture | § 8 |
| D2 | **Une seule liste de tâches** : les relances et activités CRM restent dans `crm_activities` ; celles qui sont assignées à l'utilisateur et ont une échéance apparaissent **aussi** dans « Mes tâches », le calendrier de mes tâches, la cloche (échéance proche ou dépassée, assignation) et le brief du matin ; on les coche au même endroit, **sans doublon de données** | § 5, O3 |
| D3 | **Nouveau rôle « Commercial »** : gère le CRM (`crm.manage`) et les devis ; consulte les clients et le catalogue ; ne voit ni la trésorerie ni les dépenses ; n'émet ni ne normalise de facture | § 4 |
| D4 | **Opportunité gagnée → « Créer le projet » proposé, jamais automatique**, en réutilisant la logique devis → projet de R1 | § 6.4 |

### Faits du dépôt qui commandent les décisions

| Fait | Où | Conséquence |
|---|---|---|
| Le prospect est un `companyName` (contact) ou un `prospectName` (opportunité), sans identifiant | `crm/crm.schemas.ts` | aucune fiche à laquelle rattacher un fil chronologique ; migration nécessaire |
| La fiche client porte le **type DGI** (`PP PM PC PL AO`), le **NIF obligatoire** pour PM, PC, PL, un index **unique** `organizationId + nif`, et `firstInvoicedAt` | `sales/customer.schema.ts`, `sales/sales.dto.ts` | un prospect ne peut pas y vivre sans affaiblir ces règles (O1) |
| Un devis vise un client (`customerId`) **ou** un client de passage (`walkIn { name, type }`) | `sales/invoices/invoices.dto.ts` (`CustomerInput`) | on peut déjà chiffrer un prospect sans fiche client |
| **Toutes** les routes d'écriture des devis portent `sales.manage`, y compris `convert` | `sales/quotes/quotes.controller.ts` | donner les devis au Commercial sans lui ouvrir clients et catalogue exige une action séparée (O2) |
| `crm_activities` n'a **ni assigné ni jour civil** : `dueAt` est un instant, `createdBy` l'auteur | `crm/crm.schemas.ts` | champs à ajouter ; « Mes tâches » groupe par jour de Kinshasa (`groupMyTasks`) |
| `GET /work/my-tasks` sert aussi le calendrier de mes tâches (`calendar-mes-taches.tsx` appelle `myTasks()`) | `apps/web/.../projets/_components/` | étendre une seule route suffit pour la liste **et** le calendrier |
| Le brief se branche par des **ports** (`WORK_SOURCE`, fournisseur nul par défaut) ; R8 et R9 citent leurs faits ; le fait `pipeline` est encore `unavailable` (« Module non livré ») | `morning-brief/morning-brief.ports.ts`, `engine/src/morning-brief/compute.ts` | nouveau port `CRM_SOURCE`, règle R10, fait `pipeline` enfin connu |
| La boîte de notifications est commune ; ajouter un type = l'ajouter à `NOTIFICATION_KINDS` et un module à `NOTIFICATION_SOURCE_MODULES` | `packages/shared/src/notifications/index.ts` | types `crm.*` sans nouveau module de notifications |
| `POST /work/projects/from-quote` crée un projet depuis un devis accepté, idempotent par index unique partiel | `work/billing/work-billing.service.ts` | D4 réutilise ce code (§ 6.4) |
| `SalesModule` importe `CrmModule` (règle de gain) ; le CRM lit `customers` et `sales_quotes` en **lecture seule** | `crm/crm.module.ts` | la synchronisation client → compte passe par ce sens d'import (§ 2.1) |
| **Fuite de trésorerie sous `analytics.read`** : le brief charge `cash` sans contrôle de `treasury.read` ; GROW (`/grow/health`, `/grow/indicators`, `/grow/journey`) lit les soldes de trésorerie sous `analytics.read` ; `GET /projects/:id/variances` et `…/updated-projection` (réalisé, donc dépenses) ne portent que `analytics.read` | `morning-brief.service.ts`, `grow/grow-reader.service.ts`, `actuals/actuals.controller.ts` | sans correctif, un Commercial verrait des soldes et des dépenses : D3 ne serait pas tenue (§ 4.4) |
| Les rôles sont une **union fermée** (`ORG_ROLES`) ; il n'existe **pas** de rôles personnalisés ; `member` est normalisé en `finance_director` ; `project_manager` est non attribuable | `authz/permissions.ts` | ajouter un rôle = ajouter un slug, une colonne de matrice et un rang (§ 4.3) |

## Options considérées

### O1 — Comptes 360° : nouveau modèle, ou clients avec un statut « prospect » ?

1. **Réutiliser `customers` avec un statut `prospect`.** Écarté :
   - la fiche client est une **donnée fiscale** : type DGI, NIF obligatoire pour PM/PC/PL, index
     unique sur le NIF, `firstInvoicedAt`, pièces de la facture normalisée (ADR-0022, ADR-0024).
     Un prospect n'a souvent ni type sûr ni NIF : il faudrait rendre ces règles conditionnelles au
     statut, c'est-à-dire affaiblir le contrôle à l'endroit précis où la DGI le demande ;
   - tous les sélecteurs de client (facture, avoir, encaissement, devis, import CSV par NIF)
     devraient filtrer les prospects ; un oubli produit une facture à un prospect sans NIF ;
   - écrire un prospect deviendrait un geste `sales.manage` : le Commercial, qui ne doit que
     **consulter** les clients (D3), ne pourrait pas créer de prospect ;
   - ADR-0035 O4 a déjà écarté cette option pour les mêmes raisons.
2. **Comptes CRM sans lien : les clients restent dans Ventes, les prospects dans le CRM, l'écran
   « Comptes » fusionne deux listes.** Écarté : une liste paginée par curseur sur deux collections
   triées par nom est fragile ; une entreprise convertie change d'identifiant et perd son fil
   chronologique.
3. **Nouvelle collection `crm_accounts` : un compte par entreprise, prospect ou client ; un compte
   client est lié 1-1 à sa fiche `customers`, qui reste la seule source de son identité fiscale.**
   **Retenu.** La facturation DGI ne change pas d'un octet ; le compte porte ce qui est
   commercial (responsable, secteur, origine, notes) ; la conversion prospect → client crée la
   fiche client **par le service et les règles de Ventes** (NIF compris) puis lie le compte, qui
   garde son identifiant, ses contacts, ses opportunités et son fil.

### O2 — Comment donner les devis au Commercial sans lui ouvrir clients et catalogue ?

1. Donner `sales.manage` au Commercial. Écarté : il pourrait créer et modifier des fiches client
   (NIF, type DGI), changer les prix du catalogue et préparer des brouillons de facture — contraire
   à D3 (« consulte les clients et le catalogue »).
2. Faire porter les devis par `crm.manage`. Écarté : l'Analyste et le Lecteur ont `crm.read` mais
   les rôles qui préparent des devis aujourd'hui les préparent sous une action **de ventes** ; un
   devis est un document de vente (PDF au modèle de facture, numéro `DV`), pas une fiche CRM.
3. **Nouvelle action `sales.quote` — « Préparer les devis »** : créer, modifier, envoyer,
   accepter, refuser, nouvelle version. Tous les rôles qui détiennent `sales.manage` la reçoivent
   (iso-privilège, aucune perte) ; le Commercial la reçoit seul en plus. **Convertir** un devis en
   brouillon de facture exige `sales.quote` **et** `sales.manage` (le brouillon de facture reste
   un geste de facturation). **Retenu.**

### O3 — « Une seule liste » : copier les relances dans `work_tasks`, ou agréger à la lecture ?

1. **Copier** chaque activité CRM en tâche `work_tasks` (projet « CRM » caché). Écarté : deux
   écrivains pour un même fait, désynchronisation à la première écriture concurrente, une tâche
   sans projet réel dans les vues Kanban et Gantt, et le CRM perdrait la propriété de ses
   relances (D2 : « restent des activités CRM »).
2. **Agréger à la lecture.** `GET /work/my-tasks` lit en plus, **en lecture seule** et par un
   port, les activités CRM non faites, assignées à l'appelant, avec échéance ; chaque élément
   porte sa **source** (`work` | `crm`) ; cocher appelle la route **du module propriétaire**
   (`POST /work/tasks/:id/complete` ou `POST /crm/activities/:id/complete`). **Retenu.** Un seul
   écrivain par donnée, aucune copie, aucune migration de tâches ; le contrat est explicite
   (§ 5.2).
3. Une collection « agenda » commune alimentée par événements. Écarté : une troisième copie,
   pour un volume qui tient dans deux requêtes indexées.

### O4 — Prévision pondérée quand la probabilité historique est indisponible

1. Pondérer par un pourcentage fixé par Lalanda (10 %, 25 %…). Écarté (ADR-0035 O5, brief § 5.1 :
   « ne pas inventer de pourcentages »).
2. **Pondérer par la probabilité historique de l'étape (`stageWinRates`) quand elle est
   `available` ; sinon l'opportunité est comptée à part, « non pondérable », avec son montant
   brut et le nombre d'opportunités concernées — jamais multipliée par un nombre inventé.**
   **Retenu** comme comportement par défaut.
3. Laisser l'organisation **saisir** un pourcentage par étape, étiqueté « saisi par
   l'organisation ». Proposé comme **option désactivée par défaut** (décision ouverte n° 6) : ce
   n'est pas un chiffre inventé par Lalanda, mais il doit rester visiblement distinct d'une
   mesure.

### O5 — Où vivent les nouveaux contrats

Comme ADR-0039 O5 : les contrats **nouveaux** (comptes, lignes d'opportunité, rapports, élément
d'agenda CRM, notifications `crm.*`) vivent dans **`packages/shared/src/crm/`** (entrée
`@lalanda/shared/crm`, zod en `peerDependency` déjà posé par R1). Les DTO existants de
`crm.dto.ts` **ne sont pas déménagés** dans ce lot (pas de réécriture sans besoin) ; les champs
qu'on y ajoute suivent ses conventions (`.strict()`, `params.code`, `z.unknown().optional()`
pour les champs normalisés à la main).

## Décision

### 1. Vocabulaire

| Interface (français) | Code | Collection |
|---|---|---|
| Compte (entreprise, prospect ou client) | `CrmAccount`, `kind: 'prospect' \| 'customer'` | `crm_accounts` (nouvelle) |
| Contact | `CrmContact` | `crm_contacts` (+ `accountId`) |
| Opportunité, ligne d'opportunité | `CrmOpportunity`, `CrmOpportunityLine` | `crm_opportunities` (+ `accountId`, `ownerId`, `lines`, `lostReasonKey`) |
| Activité, relance | `CrmActivity` | `crm_activities` (+ `accountId`, `assigneeUserId`, `dueDay`, `reminders`) |
| Motif de perte | `CrmLostReason` | dans `crm_settings.lostReasons` |
| Responsable (d'un compte, d'une opportunité) | `ownerId` | — |
| Assigné (d'une activité) | `assigneeUserId` | — |
| Prévision pondérée | `weightedForecast` (moteur) | calculée, jamais stockée |
| Commercial | rôle `sales_rep` | `memberships.role` |

Dates civiles `AAAA-MM-JJ` au **jour de Kinshasa** (UTC+1, ADR-0027) ; horodatages en UTC. Tout
document porte `organizationId`, `revision`, `createdBy`, `updatedBy`, horodatages,
`_schemaVersion`. Ressource d'une autre organisation : **404**, y compris par identifiant forgé
dans un corps (`accountId`, `ownerId`, `assigneeUserId`, `catalogItemId`, `targetAccountId`).
Écriture concurrente : `expectedRevision` → `409 STALE_REVISION`.

### 2. Modèle de données

#### 2.1 `crm_accounts` (nouvelle)

| Champ | Règle |
|---|---|
| `kind` | `prospect` \| `customer` ; **dénormalisé** de `customerId` (non nul ⇒ `customer`), écrit par le service dans la même mise à jour |
| `customerId` | `null` (prospect) ou une fiche `customers` de l'organisation ; **unique partiel** `{ organizationId, customerId }` (`customerId` de type chaîne) : une fiche client a au plus un compte |
| `name` | prospect : 1 à 200, saisi. Client : **copie d'affichage** du nom de la fiche client, réécrite par la synchronisation (ci-dessous) ; jamais modifiable depuis le CRM (`409 CRM_ACCOUNT_IDENTITY_FROM_CUSTOMER`) — la fiche client fait foi |
| `sortName`, `searchKey` | normalisés (motif de `customers`) ; tri et recherche |
| `ownerId` | responsable du compte : `null` ou un membre détenant `crm.manage` (`CRM_OWNER_NOT_ELIGIBLE`, contrôle par `can()`) ; défaut : le créateur |
| `industry` | ≤ 80, texte libre (secteur) |
| `origin` | ≤ 80, texte libre (« salon », « recommandation »…) ; aucune liste imposée en R2 |
| `website`, `phone`, `email`, `address` | facultatifs, mêmes bornes que la fiche client ; **pour un compte client, ce sont des coordonnées commerciales** — celles imprimées sur les factures restent celles de la fiche client |
| `notes` | ≤ 5 000, texte brut |
| `active` | `false` = archivé (masqué des listes par défaut) ; miroir de `customers.active` pour un compte client |
| `conversion` | `null` \| `{ customerId, convertedAt, convertedBy, mode: 'created' \| 'linked' }` |
| `mergedInto` | `null` \| identifiant d'un compte : prospect fusionné (§ 3.1), conservé pour la trace, exclu des listes |

Index : `{ organizationId, sortName, _id }` (liste) ; `{ organizationId, active, kind }` ;
`{ organizationId, ownerId }` ; unique partiel `{ organizationId, customerId }` ; unique partiel
`{ organizationId, searchKey }` **non** (deux prospects homonymes sont permis : l'écran avertit,
`warnings: [{ code: 'CRM_ACCOUNT_SIMILAR_NAME', accountId }]`).

**Synchronisation client → compte.** `CustomersService` (Ventes) appelle, **après** son écriture et
hors de sa transaction, `CrmAccountsSync.onCustomerWritten(organizationId, customerId)` — même
sens d'import que la règle de gain (`SalesModule` importe déjà `CrmModule`) :

- création d'une fiche client → compte `customer` créé s'il n'existe pas (idempotent par l'index
  unique) ;
- renommage, désactivation, réactivation → `name`, `sortName`, `searchKey`, `active` recopiés ;
- suppression d'une fiche jamais facturée (ADR-0022 § O7) → le compte **redevient prospect**
  (`customerId: null`, nom conservé), journalisé ; ses contacts et opportunités perdent leur
  `customerId` dénormalisé.

Une synchronisation perdue (panne entre les deux écritures) est rattrapée par la tâche
d'ordonnanceur `crm.accounts-reconcile` (quotidienne, lot de 1 000 fiches, idempotente) et par la
migration. Elle ne bloque jamais l'écriture de la fiche client.

#### 2.2 Champs ajoutés à `crm_contacts`

| Champ | Règle |
|---|---|
| `accountId` | `null` (personne sans entreprise) ou un compte de l'organisation, non fusionné |
| `customerId`, `companyName` | **conservés** en lecture pour la compatibilité N-1 ; écrits par le service à partir du compte (`customerId` du compte, `name` du compte) ; dépréciés en entrée : un corps qui les envoie sans `accountId` est accepté une version (résolution par le service), puis refusé (`CRM_USE_ACCOUNT_ID`) |

Index ajouté : `{ organizationId, accountId }`.

#### 2.3 Champs ajoutés à `crm_opportunities`

| Champ | Règle |
|---|---|
| `accountId` | **requis** après migration : le compte visé ; `customerId` et `prospectName` sont désormais dénormalisés du compte (même règle de compatibilité qu'au § 2.2) |
| `ownerId` | responsable : membre détenant `crm.manage` (`CRM_OWNER_NOT_ELIGIBLE`) ; défaut : le créateur ; jamais `null` pour une opportunité ouverte — un responsable qui quitte l'organisation laisse ses opportunités **orphelines**, signalées dans le pipeline (`orphaned: true`) et réassignables en masse (§ 3.2) |
| `lines` | 0 à 50 `{ catalogItemId \| null, label (1–200), quantity (chaîne décimale > 0), unit (≤ 20, facultatif), unitPrice (chaîne décimale ≥ 0, facultatif), discountPercent (chaîne 0–100, facultatif) }` ; un `catalogItemId` d'une autre organisation : 404 ; le libellé et le prix sont **copiés** à l'ajout (le catalogue peut changer ensuite) |
| `amountSource` | `manual` (défaut, comportement d'ADR-0035) \| `lines` : le montant estimé est alors **calculé** (§ 2.6) et rendu en lecture seule |
| `lostReasonKey` | `null` ou une clé de `crm_settings.lostReasons` ; requis pour passer en perdu si `lostReasonRequired` (`CRM_LOST_REASON_REQUIRED`) |
| `lostReason` | **conservé**, devient le **détail** libre du motif (≤ 500) |
| `wonAt` | posé au passage en `won` (déjà déductible de `closedAt` + `status` ; dénormalisé pour les rapports par mois) |

Index ajoutés : `{ organizationId, accountId }` ; `{ organizationId, ownerId, status }` ;
`{ organizationId, status, expectedCloseDate }` (prévision par mois) ;
`{ organizationId, status, closedAt }` (rapports).

#### 2.4 Champs ajoutés à `crm_activities`

| Champ | Règle |
|---|---|
| `accountId` | `null` ou un compte de l'organisation ; déduit de l'opportunité ou du contact s'il n'est pas fourni |
| `assigneeUserId` | membre détenant `crm.manage` (`CRM_ASSIGNEE_NOT_ELIGIBLE`) ; défaut : le créateur ; `null` interdit pour une activité à échéance non faite |
| `dueDay` | `AAAA-MM-JJ`, **dénormalisé** de `dueAt` au jour de Kinshasa (`kinshasaDayOf`), écrit dans la même mise à jour ; `null` si `dueAt` est `null` |
| `reminders` | `{ dueSoonFor: string \| null, overdueFor: string \| null }` : jour d'échéance déjà rappelé (motif des rappels de R1) |

Index ajoutés : `{ organizationId, assigneeUserId, done, dueDay }` (Mes tâches, brief) ;
`{ organizationId, done, dueDay }` (rappels) ; `{ organizationId, accountId, createdAt }` (fil).

#### 2.5 Champs ajoutés à `crm_settings`

| Champ | Règle |
|---|---|
| `lostReasons` | 0 à 30 `{ key (^[a-z0-9_-]{1,32}$), label (1–60), active }` ; défaut proposé : `price` « Prix », `competitor` « Concurrent retenu », `no_budget` « Pas de budget », `no_response` « Sans réponse », `need_dropped` « Besoin abandonné », `other` « Autre » (décision ouverte n° 7) ; retirer un motif utilisé : refusé (`409 CRM_LOST_REASON_IN_USE`) — on le désactive |
| `lostReasonRequired` | défaut `true` |
| `stages[].manualProbabilityPercent` | `null` ou entier 0–100 ; lu **seulement** si `forecastProbability = 'manual'` (O4, décision ouverte n° 6) |
| `forecastProbability` | `historical` (défaut) \| `manual` |

#### 2.6 Montant estimé depuis les lignes

Quand `amountSource = 'lines'`, l'API compose les lignes **comme un devis** (`InvoiceDraftsService.compose`
→ `computeInvoiceTotals`, ADR-0035 O2) dans la devise et le mode de prix de l'opportunité, et
retient le **total hors taxes** comme montant estimé (proposition, décision ouverte n° 8). Aucun
calcul nouveau. Une ligne sans prix compte pour zéro et lève l'avertissement
`CRM_LINE_WITHOUT_PRICE`. Une ligne d'un article dont la devise diffère est refusée
(`CRM_LINE_CURRENCY_MISMATCH`) : jamais de conversion.

#### 2.7 Migration `20261030-0001-crm-accounts.mjs`

Script idempotent piloté par `_schemaVersion` (motif de `20260808-0001-rbac-roles-organisation.mjs`),
par organisation, en lot :

1. **Un compte `customer` par fiche client** (actives et désactivées), `ownerId: null`.
2. **Prospects** : regroupement des `crm_contacts.companyName` (sans `customerId`) et des
   `crm_opportunities.prospectName` par **nom normalisé exact** (`searchKey` : minuscules, sans
   accents, espaces réduits) — **aucun rapprochement approché** ; un compte `prospect` par groupe,
   nom = la graphie la plus fréquente, `ownerId` = le créateur de la plus ancienne opportunité du
   groupe, sinon `null`.
3. `accountId` posé sur les contacts et les opportunités ; sur les activités, déduit de
   l'opportunité, sinon du contact, sinon du client.
4. `ownerId` des opportunités = `createdBy` ; `assigneeUserId` des activités à échéance non
   faites = `createdBy` ; `dueDay` calculé ; `lostReasonKey: null` (le texte reste en détail).
5. **Rapport** (journal de migration, et `GET /crm/accounts/migration-report`, `crm.manage`) :
   comptes créés, groupes fusionnés par nom avec leurs graphies, contacts sans entreprise, membres
   introuvables. Les homonymes réels se séparent après coup par l'écran (« Détacher ce contact »).

Rejouée deux fois, la migration ne crée rien de plus (test). Un contact sans `customerId` ni
`companyName` garde `accountId: null`.

### 3. Contrat HTTP

Tous les contrôleurs : `@UseGuards(AuthGuard, PermissionsGuard)`, `@RequirePermission(…)` par
route ; une liste d'actions signifie « toutes requises ». Corps `.strict()`, montants en chaînes,
erreurs au format des contrôleurs de ventes, listes paginées par curseur (`time-cursor.ts`).

#### 3.1 Comptes — `CrmAccountsController`

| Méthode et chemin | Permission | Effet |
|---|---|---|
| `GET /crm/accounts?kind=&ownerId=me\|<id>&active=&q=&cursor=` | `crm.read` | liste triée par nom ; compteurs : contacts, opportunités ouvertes, prochaine activité |
| `POST /crm/accounts` | `crm.manage` | crée un **prospect** ; un compte client naît de la fiche client (§ 2.1) |
| `GET /crm/accounts/:accountId` | `crm.read` | fiche |
| `PUT /crm/accounts/:accountId` | `crm.manage` | champs commerciaux ; `name` d'un compte client : `409 CRM_ACCOUNT_IDENTITY_FROM_CUSTOMER` |
| `POST /crm/accounts/:accountId/archive` · `…/restore` | `crm.manage` | compte client : refusé (`409 CRM_ACCOUNT_FOLLOWS_CUSTOMER`, l'archivage suit la fiche client) |
| `DELETE /crm/accounts/:accountId` | `crm.manage` | prospect sans contact, opportunité ni activité ; sinon `409 CRM_ACCOUNT_IN_USE` |
| `POST /crm/accounts/:accountId/convert` | `crm.manage` + `sales.manage` | § 3.1.1 |
| `POST /crm/accounts/:accountId/merge` `{ targetAccountId, expectedRevision }` | `crm.manage` | fusionne un **prospect** dans un autre compte : contacts, opportunités, activités réassignés en une transaction ; la source garde `mergedInto` |
| `GET /crm/accounts/:accountId/overview` | `crm.read` (sections : § 3.1.2) | fiche 360° |
| `GET /crm/accounts/:accountId/timeline?cursor=&types=` | `crm.read` (sources filtrées par permission) | fil chronologique unifié (§ 3.1.3) |
| `GET /crm/accounts/migration-report` | `crm.manage` | rapport de la migration (§ 2.7) |

**3.1.1 Conversion prospect → client.** Corps, l'un ou l'autre :

- `{ mode: 'create', customer: <corps de POST /sales/customers>, expectedRevision }` : la fiche est
  créée par **`CustomersService.create`**, avec **exactement** les règles de Ventes (type DGI, NIF
  obligatoire pour PM/PC/PL, unicité du NIF). Un NIF déjà présent rend `409 CUSTOMER_NIF_EXISTS`
  avec l'identifiant de la fiche existante, pour proposer le mode suivant.
- `{ mode: 'link', customerId, expectedRevision }` : rattache à une fiche existante. Si cette fiche a
  déjà son compte (cas normal), le prospect est **fusionné** dans ce compte (comme `merge`).

Puis, dans une transaction : `customerId` et `kind` du compte, `conversion`, et `customerId`
dénormalisé sur ses contacts, opportunités et activités. Les **devis déjà émis** ne sont pas
réécrits (un devis envoyé est figé ; un devis de client de passage le reste) : la fiche 360° les
rattache par `opportunityId`. Journalisé (`audit_events` : `crm.account.converted`). Le
Commercial, qui n'a pas `sales.manage`, voit le bouton désactivé avec la raison (décision ouverte
n° 4).

**3.1.2 Fiche 360°.** `GET …/overview` est servi par un **module de composition**
`apps/api/src/crm/overview/` (`CrmOverviewModule`), qui importe `CrmModule`, `SalesModule` et
`WorkModule` — le `CrmModule` lui-même reste sans dépendance vers Ventes (sinon cycle avec la
règle de gain). Chaque section est rendue `{ status: 'known', … }`, `{ status: 'hidden' }` (droit
manquant) ou `{ status: 'empty' }` :

| Section | Condition | Contenu | Calcul |
|---|---|---|---|
| Identité | `crm.read` | compte ; pour un client : type DGI, NIF, coordonnées de la fiche (lecture seule) | — |
| Contacts | `crm.read` | contacts du compte | — |
| Opportunités | `crm.read` | ouvertes et clôturées, responsable, étape, montant estimé ; **totaux estimés et pondérés par devise** | moteur `crm` (§ 7) |
| Devis | `sales.read` | devis du compte (par `customerId` ou par `opportunityId` d'une opportunité du compte), statut, total | totaux du devis tels que stockés (moteur, ADR-0035) ; somme par devise : `sumAmountsByCurrency` |
| Factures et avoirs | `sales.read` | documents finaux du client (série réelle), statut de règlement | `SettlementsService.byIds` (`computeSettlement`, ADR-0031) |
| Encaissements | `sales.read` | encaissements non annulés imputés aux factures du client | idem |
| **Solde dû** | `sales.read` | reste à encaisser **par devise**, nombre de factures échues | moteur `receivables`, nouvelle fonction pure `sumOutstandingByCurrency` (version mineure : `RECEIVABLES_VERSION` 1.1.0, aucune sortie existante modifiée) |
| Projets RUN | `work.read` | projets dont `links.customerId` = le client ou `links.opportunityId` ∈ opportunités du compte | — |
| Prochaines actions | `crm.read` | activités non faites, par échéance | — |

Aucun montant n'est additionné, converti ni arrondi par le web : il affiche ce que l'API rend
(règle docs/26, CLAUDE.md). Un prospect n'a ni factures ni encaissements : sections `empty`.

**3.1.3 Fil chronologique.** Agrégé **à la lecture** (aucune collection d'événements) : chaque
source est lue avec `at < curseur`, `limit + 1`, puis fusion triée décroissante ; curseur
`(at, type, id)`, 50 éléments par page. Sources et événements :

| Source | Événements | Condition |
|---|---|---|
| `crm_activities` | créée, faite | `crm.read` |
| `crm_opportunities.stageHistory` | créée, changement d'étape, gagnée, perdue (avec motif) | `crm.read` |
| `crm_accounts` | créé, converti, fusionné | `crm.read` |
| `sales_quotes` | créé, envoyé, accepté, refusé, converti | `sales.read` |
| `sales_invoices` | émise, normalisée (documents finaux) | `sales.read` |
| `receipts` | encaissement enregistré, annulé | `sales.read` |
| `work_projects` | projet créé, terminé | `work.read` |

#### 3.2 Opportunités (modifications)

| Méthode et chemin | Permission | Changement |
|---|---|---|
| `POST /crm/opportunities` · `PUT /crm/opportunities/:id` | `crm.manage` | + `accountId`, `ownerId`, `lines`, `amountSource` ; réponse `{ opportunity, warnings }` |
| `POST /crm/opportunities/:id/move` | `crm.manage` | + `lostReasonKey`, `lostReasonDetail` ; passer en `won` rend `suggestions: [{ code: 'CREATE_PROJECT' }, { code: 'CREATE_QUOTE' }]` selon l'état (§ 6.4) |
| `POST /crm/opportunities/reassign` `{ fromOwnerId, toOwnerId, onlyOpen: true }` | `crm.manage` | réassignation en masse (départ d'un membre) ; journalisée ; rend le nombre |
| `GET /crm/opportunities?ownerId=me\|<id>&accountId=` | `crm.read` | filtres ajoutés |

#### 3.3 Devis préremplis depuis une opportunité

| Méthode et chemin | Permission | Effet |
|---|---|---|
| `POST /sales/quotes/from-opportunity` `{ opportunityId, validUntil? }` | `sales.quote` + `crm.read` | crée un devis **brouillon** par `QuotesService.create` : `opportunityId`, devise et mode de prix de l'opportunité, client = fiche du compte client, sinon **client de passage** au nom du compte ; lignes = lignes de l'opportunité (`catalog` à prix fixé explicite, `free` sinon) ; titre = titre de l'opportunité. Opportunité sans ligne : `409 CRM_OPPORTUNITY_HAS_NO_LINES` (l'écran propose un devis vierge) |

Les montants du devis sont **recalculés** par la composition des devis (ADR-0035 O2) ; le montant
estimé de l'opportunité n'est jamais recopié comme total.

#### 3.4 Pipeline, rapports, réglages

| Méthode et chemin | Permission | Effet |
|---|---|---|
| `GET /crm/pipeline?ownerId=me\|<id>` | `crm.read` | inchangé, plus `forecast` (prévision pondérée par devise, § 7), `orphaned` |
| `GET /crm/reports?from=&to=&ownerId=` | `crm.read` | § 7.2 ; période par défaut : 12 mois glissants, au plus 24 (`CRM_REPORT_PERIOD_TOO_LONG`) |
| `GET /crm/settings` · `PUT /crm/settings` | `crm.read` · `crm.manage` | + `lostReasons`, `lostReasonRequired`, `forecastProbability`, `stages[].manualProbabilityPercent` |

#### 3.5 Activités (modifications)

| Méthode et chemin | Permission | Changement |
|---|---|---|
| `POST /crm/activities` · `PUT /crm/activities/:id` | `crm.manage` | + `accountId`, `assigneeUserId` |
| `GET /crm/activities?assignee=me\|<id>&accountId=&dueFrom=&dueTo=&status=` | `crm.read` | filtres ajoutés (jours de Kinshasa) |
| `POST /crm/activities/:id/complete` | `crm.manage` | inchangé ; **cocher depuis « Mes tâches » appelle cette route** |
| `POST /crm/activities/:id/reopen` `{ expectedRevision }` | `crm.manage` | nouveau : décocher (symétrie avec `work`) |

#### 3.6 Travail (extensions d'ADR-0039)

| Méthode et chemin | Permission | Changement |
|---|---|---|
| `GET /work/my-tasks` | `work.read` | éléments `source: 'crm'` ajoutés si l'appelant détient aussi `crm.read` (§ 5.2) |
| `POST /work/projects/from-opportunity` | `work.manage` + `crm.read` | § 6.4 |
| `GET /work/opportunities/:opportunityId/project` | `work.read` + `crm.read` | projet issu de l'opportunité ou de son devis, ou `null` |

Contrôleurs nouveaux à inscrire dans `routes-coverage.test.ts` : `CrmAccountsController`,
`CrmOverviewController`, `CrmReportsController` ; routes ajoutées aux contrôleurs existants
(quotes, opportunities, activities, work-billing) dans leur bloc `attendu`.

### 4. Permissions (amende ADR-0012 et docs/12)

#### 4.1 Action nouvelle `sales.quote` (vingt-huitième, en fin de `ACTIONS`)

« Préparer les devis » : créer, modifier, supprimer un brouillon, marquer envoyé, accepté, refusé,
nouvelle version, créer depuis une opportunité. Lire et imprimer restent `sales.read`. Convertir en
brouillon de facture : `sales.quote` + `sales.manage`.

| Action | PRO | ADM | DIR | CPT | ANA | CDP | CON | LEC | COM |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| `sales.quote` | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ |

Iso-privilège : exactement les détenteurs de `sales.manage`, plus le Commercial. Plateforme :
comme `sales.manage` (sous accès délégué pour le seul super-administrateur ; pas un interdit
absolu). `quotes.controller.ts` passe de `sales.manage` à `sales.quote` sur ses sept routes
d'écriture (création, modification, suppression, envoi, acceptation, refus, nouvelle version),
`convert` à `sales.quote` + `sales.manage`.

#### 4.2 Rôle nouveau « Commercial » (`sales_rep`, colonne COM)

Ses actions, **sept sur vingt-huit**, et tout le reste refusé :

| Action | COM | Ce que cela lui ouvre |
|---|:--:|---|
| `analytics.read` | ✓ | brief du matin, cloche de notifications, tableau de bord — **après** le correctif du § 4.4 |
| `sales.read` | ✓ | **consulter** clients, catalogue, devis (et PDF), factures, avoirs et encaissements (lecture : fiche 360°, relance d'un impayé) |
| `sales.quote` | ✓ | préparer, envoyer, faire accepter ou refuser les devis |
| `crm.read` | ✓ | tout le CRM en lecture |
| `crm.manage` | ✓ | comptes prospects, contacts, opportunités, activités, réglages du pipeline, import et export CSV |
| `work.read` | ✓ | « Mes tâches » (où arrivent ses relances, D2), projets en lecture |
| `work.update` | ✓ | cocher, commenter, saisir son temps sur les tâches qu'on lui confie (proposition, décision ouverte n° 3) |

Refusées, et pourquoi :

- `sales.manage` : ni création ni modification de fiche client (NIF, type DGI) ni de prix du
  catalogue ; ni brouillon de facture ; ni conversion prospect → client ni devis → facture
  (décisions ouvertes n° 4 et n° 5).
- `sales.invoice`, `sales.receipt` : ni émettre, ni normaliser, ni encaisser (D3).
- `treasury.read`, `treasury.manage` : ni trésorerie, ni dépenses, ni comptes (D3) — et pas de
  marge de projet (`work.read` + `sales.read` + `treasury.read`) ni de coût horaire.
- `project.*`, `canvas.update`, `inputs.update`, `plan.*`, `actuals.import`, `period.close`,
  `report.export` : BUILD et le plan financier ne le concernent pas ; les initiatives contiennent
  des prévisions de trésorerie.
- `organization.manage`, `billing.manage`, `members.invite`, `audit.read`, `fiscal.manage` :
  gouvernance.
- `work.manage` : il ne crée pas de projet ; « Créer le projet » d'une opportunité gagnée est
  proposé aux détenteurs de `work.manage` (§ 6.4, décision ouverte n° 3).

Matrice complète des rôles existants pour les actions touchées par R2 (rappel, inchangée sauf la
colonne COM et la ligne `sales.quote`) :

| Action | PRO | ADM | DIR | CPT | ANA | CDP | CON | LEC | COM |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| `analytics.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓P | ✓ | ✓ | ✓ |
| `sales.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ |
| `sales.manage` | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `sales.invoice` | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `sales.receipt` | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `sales.quote` | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ |
| `treasury.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ |
| `treasury.manage` | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `crm.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ |
| `crm.manage` | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ |
| `work.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ |
| `work.update` | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ |
| `work.manage` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

Toutes les autres actions : ✗ pour COM.

#### 4.3 Le système de rôles le permet — vérifications

- **Pas de rôles personnalisés** : les rôles sont l'union fermée `ORG_ROLES`. Ajouter `sales_rep`
  = l'ajouter **en fin** de `ORG_ROLES` (ordre de fusion, comme les actions), une colonne aux deux
  matrices exhaustives (une case absente ne compile pas), un libellé (« Commercial ») et une
  description (« CRM, devis et suivi des clients. Ne voit ni la trésorerie ni les dépenses ;
  n'émet pas de facture. ») dans `ORG_ROLE_LABELS` / `ORG_ROLE_DESCRIPTIONS`.
- **Rang** (`ORG_ROLE_RANK`, ordre total pour choisir l'organisation par défaut) : `sales_rep` = 5,
  entre `analyst` (4) et `project_manager` (désormais 6) ; `advisor` 7, `viewer` 8. Le rang n'est
  pas un droit : le décaler ne change aucune autorisation (test d'unicité des rangs existant).
- **Schémas** : `membership.schema.ts` et `invitation.schema.ts` prennent leur `enum` de
  `ORG_ROLES` : rien à écrire. **Aucune migration** : aucun document existant ne change de rôle.
- **`member` historique** : `normalizeOrgRole('member')` reste `finance_director` ; `sales_rep`
  n'est pas un alias. Rien ne change pour les anciennes adhésions.
- **Attribution (R7)** : un acteur n'attribue qu'un rôle dont les actions sont un sous-ensemble des
  siennes. Les sept actions du Commercial sont détenues par le Propriétaire, l'Administrateur
  (après `sales.quote`) et le Directeur financier ; seuls ceux qui ont `members.invite`
  (Propriétaire, Administrateur) invitent : **l'Administrateur peut inviter un Commercial**. Un
  Commercial n'attribue rien. `isAssignableRole('sales_rep')` = vrai.
- **Compatibilité N-1** : une ancienne instance d'API lirait `sales_rep` comme rôle inconnu
  (`normalizeOrgRole` → `undefined` → refus). On n'attribue donc le rôle qu'une fois toutes les
  instances à jour (consigne de déploiement, docs/24) ; le refus par défaut rend l'erreur sûre.
- **Web** : `ORG_ROLES`, `OrgRole` et `OrgAction` recopiés dans `apps/web/src/lib/api.ts`,
  `members-model.ts`, `invite-panel.tsx`, l'article d'aide « Travailler à plusieurs ».
- **Tests** : matrice **9 × 28 + 6 × 28 = 420** cases ; sonde `rbac-matrix.e2e` étendue à la
  colonne COM et à `sales.quote`.

#### 4.4 Correctif préalable : la trésorerie ne doit pas fuir sous `analytics.read`

Aujourd'hui, tout rôle qui détient `analytics.read` (les huit) voit des chiffres de trésorerie par
trois chemins. Le Commercial ne doit pas les voir (D3). Règle **générale**, sans aucun
`if (role === …)` : **une donnée de trésorerie exige `treasury.read`** ; un réalisé de plan exige
`project.read`.

| Chemin | Correctif |
|---|---|
| Brief : fait `tresorerie` et règle R7 `tresorerie_a_renseigner` | `cash` chargé seulement avec `treasury.read`, sinon `hidden` (motif des faits de ventes) |
| GROW : `/grow/health`, `/grow/indicators`, `/grow/journey` (soldes lus par `grow-reader.service.ts`) | faits issus de la trésorerie masqués (`hidden`) sans `treasury.read`, comme les noms de clients sans `sales.read` |
| `GET /projects/:id/variances`, `…/updated-projection`, `…/objectives/attainment` | `@RequirePermission('project.read', 'analytics.read')` ; aucun rôle ne perd l'accès (tous les détenteurs d'`analytics.read` y ont `project.read`, sauf le nouveau Commercial) |
| Lala (`/lala/messages`, `/interpretations`) | audit des contextes servis au modèle : aucune donnée de trésorerie ni de réalisé sans `treasury.read` / `project.read` (test qui fige la liste des contextes) |
| Tableau de bord (`/organisation`, `organization-space`) | vérifié : blocs déjà filtrés par `can()` ; test ajouté pour un rôle sans `treasury.read` |

**Effet de bord** : le **Conseiller** (`advisor`) n'a pas `treasury.read` ; il perd le fait
`tresorerie` du brief et les faits de trésorerie de GROW (décision ouverte n° 2). Le rôle
Commercial reste **non attribuable** (`ROLE_NOT_ASSIGNABLE`) tant que ce correctif n'est pas
fusionné : c'est le même lot (C0).

### 5. Relances synchronisées — « une seule liste » (D2)

#### 5.1 Ce qui entre dans la liste

Une activité CRM entre dans « Mes tâches » de l'utilisateur U si : `organizationId` = organisation
active, `assigneeUserId = U`, `done = false`, `dueAt ≠ null` (donc `call`, `meeting` ou `follow_up`
à échéance ; une `note` n'a jamais d'échéance), compte non fusionné, **et** U détient `crm.read`.
Les activités faites n'y figurent pas, comme les tâches terminées.

#### 5.2 Contrat de lecture (agrégation, sans copie)

- **Port** `CRM_AGENDA_SOURCE` (`apps/api/src/work/my-tasks.ports.ts`), fournisseur nul par défaut ;
  fournisseur réel `CrmAgendaSource` (`apps/api/src/crm/agenda/`), **lecture seule** de
  `crm_activities`, `crm_opportunities` (titre) et `crm_accounts` (nom). Motif exact de
  `WORK_SOURCE` du brief.
- `WorkTasksService.myTasks` lit les deux sources, les **fusionne** et les passe à `groupMyTasks`
  (inchangé : il lit `id`, `done`, `dueDate`, `priority`, `rank`).
- Forme : `MyTasksView` garde ses groupes ; chaque élément devient
  `MyTaskEntry = (MyTaskItem & { source: 'work' }) | CrmMyTaskItem` avec
  `CrmMyTaskItem = { source: 'crm', id: 'crm:<activityId>', activityId, kind, subject, dueDate
  (dueDay), dueAt, priority: 'none', rank: dueAt ISO, accountId, accountName, opportunityId,
  opportunityTitle, href: '/crm/activites?activite=<id>', done: false }`. Le préfixe `crm:` rend
  les identifiants disjoints.
- Bornes : 500 tâches + 500 activités au plus (`MY_TASKS_MAX` par source), `truncated` signalé.
- `dueSoonCount` compte les deux sources avec **le même** `dueSoonDays` (`work_settings`, lu par le
  service de travail) : une seule notion d'« échéance proche » par organisation.
- **Calendrier de mes tâches** : il lit déjà `myTasks()` ; il affiche les éléments CRM à leur
  `dueDate`, distingués par une **forme et un libellé** (« Relance »), pas seulement une couleur.
  Déplacer un élément CRM dans le calendrier change `dueAt` par `PUT /crm/activities/:id` (heure
  conservée).

#### 5.3 Contrat d'écriture (cocher au même endroit)

L'écran de « Mes tâches » appelle la route **du propriétaire** selon `source` :
`POST /work/tasks/:id/complete` ou `POST /crm/activities/:id/complete` (et `…/reopen`). Pas de
route d'écriture « agenda » commune : chaque module garde son seul écrivain, ses règles
(`lastActivityAt` de l'opportunité mis à jour) et sa concurrence (`expectedRevision`, lue dans
l'élément). Un utilisateur qui a `crm.read` sans `crm.manage` ne peut pas être **assigné** (§ 2.4),
donc ne voit jamais d'activité qu'il ne pourrait pas cocher.

#### 5.4 Notifications

Ajouts à `NOTIFICATION_KINDS` : `crm.activity_assigned`, `crm.activity_due_soon`,
`crm.activity_overdue`, `crm.opportunity_assigned`, `crm.opportunity_won` ; à
`NOTIFICATION_SOURCE_MODULES` : `crm` ; `NotificationSource.entityType` gagne `activity`,
`opportunity`, `account`. `requiredAction: 'crm.read'`, revérifiée à la lecture.

| Type | Déclencheur | Destinataire |
|---|---|---|
| `crm.activity_assigned` | assigné posé ou changé | le nouvel assigné (jamais l'auteur du geste) |
| `crm.activity_due_soon` | rappel : `dueDay` dans `[aujourd'hui, aujourd'hui + dueSoonDays]` | l'assigné |
| `crm.activity_overdue` | rappel : `dueDay` < aujourd'hui, non faite | l'assigné, une fois par échéance |
| `crm.opportunity_assigned` | responsable posé ou changé | le nouveau responsable |
| `crm.opportunity_won` | passage en `won` (manuel ou par devis accepté) | le responsable ; texte « Créer le projet ? » si aucun projet n'existe (§ 6.4) |

**Rappels** : tâche d'ordonnanceur `crm.due-reminders`, mêmes paramètres que `work.due-reminders`
(15 min, à partir de 7 h à Kinshasa, lot de 500), réclamation par écriture conditionnelle sur
`reminders.*For`, `dedupeKey = <type>:<activityId>:<dueDay>`. Émission par le port, hors de la
transaction métier.

#### 5.5 Brief du matin

- **Port** `CRM_SOURCE` dans `morning-brief.ports.ts`, fournisseur réel `CrmBriefSource`
  (`apps/api/src/crm/brief/`), nul par défaut ; chargé seulement si le rôle détient `crm.read`
  (sinon faits `hidden`).
- **Faits** (moteur `morning-brief`, `MORNING_BRIEF_VERSION` **1.2.0**) :
  `mes_relances.en_retard` et `mes_relances.aujourdhui` (activités assignées à l'appelant,
  `dueDay` < ou = aujourd'hui), `relances.en_retard` (organisation) ; le fait **`pipeline`** passe
  de `unavailable` à `known` : nombre d'opportunités ouvertes de l'organisation (aucun montant
  dans le brief — les montants estimés restent dans le CRM).
- **Règle R10 `relances_en_retard`** (rang 10, sévérité `attention`, seuil nul, motif de R8) :
  déclenchée si `mes_relances.en_retard` > 0 ; message « N relances clients ont dépassé leur
  échéance » ; recommandation « Ouvrir Mes tâches et rappeler ces clients » ; `actionPath:
  '/projets/mes-taches'` (la liste unique) ; cite `mes_relances.en_retard`.
- **E-mail quotidien** : les deux faits personnels y figurent pour leur destinataire, même garde.
- L'IA du brief explique R10 sans la produire (ADR-0033).

### 6. Pipeline v2

#### 6.1 Responsable

`ownerId` sur chaque opportunité (§ 2.3). Le pipeline et les listes se filtrent par responsable
(« Les miennes » par défaut pour un rôle qui n'a pas `members.invite` — confort d'affichage, pas un
contrôle d'accès : tout détenteur de `crm.read` voit tout le pipeline, comme en R1 pour les
projets ; visibilité restreinte = décision ouverte n° 9).

#### 6.2 Kanban par glisser-déposer

Colonnes = étapes. Glisser une carte appelle `POST /crm/opportunities/:id/move` ; aucun rang manuel
dans une colonne (tri par date de clôture prévue, puis montant). Glisser **natif HTML5**, motif de
`projets/_components/vue-kanban.tsx`, **aucune dépendance nouvelle**. Accessibilité (ADR-0030 § 5) :
le menu « Déplacer vers… » existant reste, la carte est focalisable, `Espace` la saisit, les
flèches gauche/droite changent de colonne, `Entrée` dépose, `Échap` annule, une zone `aria-live`
annonce « Opportunité X déplacée en Négociation ». Déposer en **perdu** ouvre la boîte du motif
(obligatoire si `lostReasonRequired`) ; déposer en **gagné** ouvre l'encadré du § 6.4. Sous 768 px :
une colonne à la fois, déplacement par menu seulement.

#### 6.3 Motifs de perte et lignes d'articles

Motifs : § 2.5, écran Réglages. Lignes : § 2.3 et § 2.6 ; « Créer le devis » depuis l'opportunité
appelle `POST /sales/quotes/from-opportunity` (§ 3.3).

#### 6.4 Opportunité gagnée → « Créer le projet » (D4)

- **Jamais automatique.** Passer en `won` (glisser, menu, ou devis accepté avec
  `autoWinOnQuoteAccepted`) ne crée aucun projet. La réponse de `move` porte la suggestion
  `CREATE_PROJECT` si aucun projet n'existe pour l'opportunité ni pour son devis accepté ; la
  fiche d'opportunité affiche l'encadré « Créer le projet » aux détenteurs de `work.manage`, un
  lien « Ouvrir le projet » sinon, et au Commercial (sans `work.manage`) la phrase « Un
  responsable des projets peut créer le projet » ; la notification `crm.opportunity_won` part au
  responsable.
- `POST /work/projects/from-opportunity` `{ opportunityId, quoteId?, name?, lineIndexes?, milestone? }`
  (`work.manage` + `crm.read` ; + `sales.read` si `quoteId`) :
  - exige `status = won` (`409 WORK_OPPORTUNITY_NOT_WON`) ;
  - **avec un devis accepté** de l'opportunité (`quoteId`, ou l'unique devis accepté) : délègue à
    la logique **existante** `createFromQuote` (une tâche par ligne du devis, sans montant ;
    `source.kind = 'quote'`) et pose `links.opportunityId` — même idempotence (index unique sur
    `source.quoteId`) ;
  - **sans devis** : projet `kind: 'client'` si le compte est client (sinon `links.customerId:
    null`), une tâche par **ligne de l'opportunité** (libellé, quantité et unité, **aucun
    montant**), `source = { kind: 'opportunity', opportunityId }` ; index **unique partiel**
    `{ organizationId, 'source.opportunityId' }` (`source.kind = 'opportunity'`) →
    `409 WORK_PROJECT_EXISTS_FOR_OPPORTUNITY` avec l'identifiant existant ;
  - `WorkProject.source.kind` gagne la valeur `opportunity` (`_schemaVersion` inchangé : champ
    additif à union élargie).
- Le service des opportunités n'écrit rien dans `work_*` ; le module `work` lit
  `crm_opportunities` en lecture seule (déjà le cas pour `links.opportunityId`).

### 7. Moteur (`packages/engine/src/crm/`)

`CRM_INDICATORS_VERSION` passe de **1.0.0 à 1.1.0** : fonctions **ajoutées**, sorties existantes
(`sumAmountsByCurrency`, `stageWinRates`) inchangées. Pur, sans horloge (le jour de référence est
un paramètre), entiers `bigint`, montants en chaînes, **jamais de conversion entre devises**. Il ne
touche ni `ENGINE_VERSION` ni `INVOICE_TOTALS_VERSION`. Chaque résultat porte
`{ version, basis: 'estimated' }` et l'interface l'étiquette « Montants estimés — calculés par
Lalanda à partir des opportunités ; ni réalisé, ni plan ». **Rien n'alimente `actual_periods`, un
plan ni un scénario.**

#### 7.1 Prévision pondérée — `weightedForecast`

Entrée : opportunités **ouvertes** `{ id, stageKey, amount, currency, expectedCloseDate, ownerId }`,
probabilités par étape (`stageWinRates`, ou pourcentages saisis si `forecastProbability = 'manual'`).
Sortie, **par devise** : `weighted` (Σ montant × probabilité), `unweighted` (Σ montant brut),
`count`, `notWeightable` `{ total, count }` (étape à probabilité `unavailable`, ou montant `null`),
`probabilitySource` (`historical` | `manual`). Probabilité historique prise en **fraction exacte**
`won / sample` (pas le pourcentage arrondi) ; un **seul arrondi** au centime, demi vers le haut,
par devise et par regroupement.

#### 7.2 Rapports — `crmReports(input)`

Période `[from, to]` (jours de Kinshasa), filtre facultatif par responsable. Seuil d'échantillon
`minSample` (défaut 10, celui d'ADR-0035 décision n° 3) pour **tout taux et toute moyenne** :
en dessous, `unavailable` avec l'échantillon.

| Indicateur | Définition |
|---|---|
| **Entonnoir par étape** | pour les opportunités créées dans la période : nombre passé par chaque étape ouverte (`stageHistory`), dans l'ordre des étapes ; montants estimés par devise |
| **Taux de conversion** | étape → étape suivante (part des opportunités passées par S qui ont atteint une étape ultérieure) ; global = gagnées / clôturées dans la période |
| **Durée moyenne du cycle** | opportunités gagnées dans la période : jours civils de Kinshasa entre création et gain ; moyenne (arrondie au jour, demi vers le haut) et médiane ; idem pour les perdues, à part |
| **Résultats par responsable** | par `ownerId` : ouvertes, gagnées, perdues (nombre, montants estimés par devise), taux de gain (seuil), prévision pondérée ; motifs de perte les plus fréquents |
| **Prévision par mois de clôture prévue** | opportunités ouvertes groupées par `AAAA-MM` de `expectedCloseDate`, plus « en retard » (date passée) et « sans date » ; `weighted`, `unweighted`, `notWeightable` par devise |
| **Motifs de perte** | répartition des perdues de la période par `lostReasonKey` (nombre) |

Les noms des responsables sont joints par l'API (membres de l'organisation) ; le moteur ne
manipule que des identifiants.

### 8. Interface (web)

#### 8.1 Application `/crm` (D1, amende ADR-0038 § 2)

| Sous-option | Route | Condition |
|---|---|---|
| Pipeline (défaut) | `/crm` (Kanban et liste), fiche `/crm/opportunites/[id]` | `crm.read` |
| Comptes | `/crm/comptes`, fiche 360° `/crm/comptes/[id]` | `crm.read` |
| Contacts | `/crm/contacts` | `crm.read` |
| Activités | `/crm/activites` (filtres : les miennes, en retard, à venir, faites) | `crm.read` |
| Rapports | `/crm/rapports` | `crm.read` |
| Réglages | `/crm/reglages` (étapes, motifs de perte, prévision, inactivité) | `crm.read` (écriture `crm.manage`) |

- `nav-model.ts` : application **CRM** dans RUN, `href: '/crm'`, juste après Projets et avant
  Factures (le commercial travaille avant de facturer) ; l'entrée Ventes garde Factures (Modèle de
  facture, Journal), Devis, Encaissements, Clients, Catalogue. Icône `crm` inchangée.
- **Redirections 308** (`next.config.mjs`, bloc `redirects()`, du plus précis au plus général) :
  `/ventes/crm/contacts` → `/crm/contacts` ; `/ventes/crm/reglages` → `/crm/reglages` ;
  `/ventes/crm` → `/crm` ; `/ventes/crm/:opportunityId` → `/crm/opportunites/:opportunityId`.
  Chaîne de requête conservée. Aucun e-mail ni lien de notification ne pointe sur `/ventes/crm`
  (vérifié le 29 oct. 2026 : seules `nav-model.ts` et ses tests le citent).
- `lib/routes.ts` : `/crm` dans `PROTECTED_PREFIXES` ; `/ventes` y reste.
- Les fichiers de `apps/web/src/app/(app)/ventes/crm/**` **déménagent** sous `(app)/crm/**` ; le
  dossier ancien disparaît (les redirections suffisent).

#### 8.2 Écrans

- **Fiche 360°** : en-tête (nom, prospect/client, responsable, NIF et type DGI en lecture pour un
  client, bouton « Convertir en client » pour un prospect) ; colonnes : contacts, opportunités,
  devis, factures et encaissements avec **solde dû par devise**, projets liés, prochaines actions ;
  fil chronologique paginé. Une section `hidden` affiche « Réservé aux rôles qui consultent les
  ventes » (jamais un zéro).
- **Pipeline** : Kanban (§ 6.2), liste, filtre responsable, encadrés « relances en retard »,
  « inactives », « orphelines » ; bandeau de prévision pondérée par devise avec la part « non
  pondérable ».
- **Rapports** : six blocs du § 7.2, chiffres et tableaux (les graphiques suivent le design
  system, ADR-0030) ; mention « Montants estimés » sur chaque bloc ; `unavailable` dit « Pas assez
  d'opportunités clôturées (N sur 10) ».
- **Mes tâches** (`/projets/mes-taches`) et son calendrier : éléments CRM avec la pastille
  « Relance » et le compte ; case à cocher identique ; lien vers l'activité.
- **Cloche** : types `crm.*` rendus comme les autres.
- **Devis** (`/ventes/devis`) : les boutons d'écriture suivent `sales.quote` ; « Convertir en
  facture » suit `sales.quote` + `sales.manage`.

## Hors périmètre (R2), dit explicitement

- **Envoi d'e-mails depuis Lalanda** (relance, devis, séquence) : la signature DKIM du domaine
  d'envoi n'est pas réglée, les e-mails partent en spam ; tant que ce n'est pas corrigé, Lalanda
  n'envoie rien au nom d'un commercial. Le devis reste un PDF que l'utilisateur remet.
  **Amendé par [ADR-0042](ADR-0042-envoi-des-documents-par-email.md) (30 oct. 2026)** : l'envoi
  d'un document de vente (devis, facture, avoir, pro forma) à son client, PDF joint, d'un geste
  explicite, est ouvert ; relances et séquences restent hors périmètre.
- **Signature électronique** des devis : non ; l'acceptation reste un geste déclaré (ADR-0035).
- **Formulaire public de capture de prospects** (page web qui crée un prospect) : non. Proposé
  comme **lot futur C-F** : route publique hors session, anti-abus (débit, piège à robots sans
  CAPTCHA tiers), consentement et finalité affichés, prospect créé en `origin: 'formulaire'`
  assigné à un responsable par défaut — à cadrer par un ADR (données personnelles, docs/17,
  docs/28).
- Visibilité restreinte du pipeline par responsable ou par équipe ; objectifs (quotas) de vente ;
  commissions.
- Conversion de devises dans les rapports ; toute écriture dans le réalisé ou un plan.
- Synchronisation d'agenda externe (Google), appels téléphoniques, WhatsApp.
- Scores ou prévisions produits par l'IA : l'IA explique, elle ne calcule pas.

## Conséquences

- Collection nouvelle `crm_accounts` ; champs additionnels sur `crm_contacts`, `crm_opportunities`,
  `crm_activities`, `crm_settings` ; valeur `opportunity` pour `work_projects.source.kind` et index
  unique partiel associé ; migration `20261030-0001-crm-accounts.mjs`. Toutes portent
  `organizationId`.
- RBAC : neuf rôles, vingt-huit actions ; docs/12, ADR-0012, matrices, sonde e2e, couverture des
  routes et types web alignés.
- `quotes.controller.ts` change de permission (`sales.quote`) sans changer de comportement pour
  les rôles existants (iso-privilège).
- Durcissement : trésorerie et réalisé ne sont plus lisibles sous le seul `analytics.read` ; le
  Conseiller perd le fait `tresorerie` du brief (décision ouverte n° 2).
- Moteur : `CRM_INDICATORS_VERSION` 1.1.0, `RECEIVABLES_VERSION` 1.1.0, `MORNING_BRIEF_VERSION`
  1.2.0.
- `@lalanda/shared` gagne l'entrée `./crm` ; `@lalanda/shared/notifications` cinq types.
- Deux tâches d'ordonnanceur : `crm.due-reminders`, `crm.accounts-reconcile`.
- Navigation : le CRM quitte `/ventes` ; quatre redirections 308.
- `SalesModule` (`CustomersService`) appelle la synchronisation des comptes : seul ajout dans
  Ventes en dehors des devis.

## Critères d'acceptation (testables)

1. Un `sales_rep` : `200` sur `GET /crm/pipeline`, `POST /crm/accounts`, `POST /sales/quotes`,
   `POST /sales/quotes/:id/send`, `GET /sales/customers`, `GET /work/my-tasks` ; `403` sur
   `POST /sales/customers`, `PUT /sales/catalog-items/:id`, `POST /sales/quotes/:id/convert`,
   `POST /sales/invoices/:id/issue`, `POST …/normalize`, `POST /sales/receipts`,
   `GET /treasury/accounts`, `GET /treasury/expenses`, `GET /work/projects/:id/margin`,
   `GET /projects`, `GET /projects/:id/variances`, `POST /crm/accounts/:id/convert`.
2. Le brief d'un `sales_rep` rend `tresorerie` `hidden` ; `/grow/health` ne contient aucun fait de
   trésorerie ; un `advisor` idem ; un `viewer` voit toujours la trésorerie.
3. Un `admin` invite un `sales_rep` (`200`) ; un `accountant` ne peut pas (`403`, pas
   `members.invite`) ; la matrice de 420 cases et la sonde e2e sont vertes.
4. Créer un prospect, deux contacts, une opportunité avec deux lignes du catalogue, puis
   « Créer le devis » : le devis porte les deux lignes à leur prix, ses totaux sont ceux de la
   composition des devis, l'opportunité garde son montant.
5. Convertir le prospect avec un type `PM` sans NIF : `400 NIF_REQUIRED_FOR_TYPE` (règle de
   Ventes) ; avec un NIF déjà connu : `409 CUSTOMER_NIF_EXISTS` ; avec un NIF valide : fiche client
   créée, compte devenu client **avec le même identifiant**, contacts et opportunités portant le
   `customerId`, fil chronologique intact.
6. Renommer la fiche client dans Ventes renomme le compte ; `PUT /crm/accounts/:id { name }` sur un
   compte client : `409 CRM_ACCOUNT_IDENTITY_FROM_CUSTOMER`.
7. La fiche 360° d'un client avec une facture USD réglée à moitié et une facture CDF non réglée
   rend un solde dû par devise égal à celui de `GET /sales/settlements` pour ces factures ; sans
   `sales.read`, les sections ventes sont `hidden`.
8. Une relance assignée à U, échéance hier à 23 h 30 UTC (aujourd'hui à Kinshasa) : elle figure
   dans « Mes tâches » de U, groupe `today`, avec `source: 'crm'` ; cochée depuis « Mes tâches »
   par `POST /crm/activities/:id/complete`, elle disparaît de la liste et `crm_activities.done`
   est vrai ; **aucun document `work_tasks` n'a été créé**.
9. U sans `crm.read` (cas théorique : rôle retiré) ne voit plus la relance dans « Mes tâches », ni
   sa notification.
10. Le rappel `crm.activity_overdue` n'est émis qu'une fois par (activité, échéance), même rejoué ;
    changer l'échéance en crée un nouveau ; assigner à V notifie V, pas l'auteur.
11. Brief : deux relances en retard pour U → `mes_relances.en_retard = 2` et R10 ; le fait
    `pipeline` vaut le nombre d'opportunités ouvertes ; sans `crm.read`, faits `hidden` et R10 non
    évaluée.
12. Glisser une opportunité en « Perdu » sans motif alors que `lostReasonRequired` :
    `400 CRM_LOST_REASON_REQUIRED` ; retirer un motif utilisé : `409 CRM_LOST_REASON_IN_USE`.
13. Prévision : trois opportunités USD ouvertes, dont une dans une étape `unavailable` → `weighted`
    n'inclut que les deux autres, `notWeightable.count = 1` ; une opportunité CDF crée une seconde
    devise, jamais une somme. `actual_periods` inchangé avant et après.
14. Rapports : sous dix opportunités clôturées, taux de conversion et durée du cycle sont
    `unavailable` avec l'échantillon ; le filtre `ownerId` restreint tous les blocs.
15. Opportunité gagnée : aucun projet créé ; `POST /work/projects/from-opportunity` crée un projet
    (une tâche par ligne, sans montant) ; une seconde fois `409 WORK_PROJECT_EXISTS_FOR_OPPORTUNITY` ;
    avec un devis accepté, le projet est celui de `from-quote` (et `from-quote` ensuite rend `409`).
16. `GET /ventes/crm`, `/ventes/crm/contacts`, `/ventes/crm/reglages`, `/ventes/crm/<id>` répondent
    `308` vers `/crm`, `/crm/contacts`, `/crm/reglages`, `/crm/opportunites/<id>`.
17. La migration rejouée deux fois produit le même état ; « ACME Sarl » et « acme  sarl » donnent un
    seul compte ; « ACME » et « ACME SA » deux.
18. Isolation : toute route nouvelle répond `404` à une ressource d'une autre organisation, y
    compris `accountId`, `targetAccountId`, `ownerId`, `assigneeUserId`, `catalogItemId` forgés.

## Plan de validation

- **Moteur (vitest)** : `weightedForecast` (fraction exacte, arrondi unique, étapes `unavailable`,
  mode `manual`, devises séparées) ; `crmReports` (entonnoir avec retours en arrière dans
  `stageHistory`, conversion au seuil exact, cycle au changement de jour de Kinshasa, mois de
  clôture « en retard » et « sans date ») ; `sumOutstandingByCurrency` ; propriétés à graine fixe
  (`weighted ≤ unweighted`, somme des mois = total). Tests existants de `stageWinRates` inchangés.
- **Shared (vitest)** : schémas `@lalanda/shared/crm` (`.strict()`, montants en chaînes, codes) ;
  types de notification.
- **API e2e (Mongo en mémoire)** : `crm-accounts.e2e` (prospect, conversion create/link, fusion,
  synchronisation client, suppression de fiche), `crm-overview.e2e` (sections par permission, solde
  dû, fil paginé), `crm-pipeline-v2.e2e` (responsable, motifs, lignes, devis préremplis,
  réassignation, prévision), `crm-reports.e2e`, `crm-agenda.e2e` (Mes tâches mixte, cocher,
  rappels, notifications), `work-billing.e2e` étendu (`from-opportunity`), `morning-brief.e2e`
  (R10, `pipeline`, masquage trésorerie), `grow.e2e` (masquage), `rbac-matrix.e2e` (COM,
  `sales.quote`), migration (jeu v1 → v2, deux passages).
- **Web (vitest, modèles purs)** : `crm/_components/*-model.ts` (Kanban clavier, motif obligatoire,
  regroupement de la prévision), `comptes-model.ts`, `rapports-model.ts`, `mes-taches-model.ts`
  (éléments mixtes), `nav-model.test.ts` (CRM sous `/crm`, Ventes sans CRM), `redirects.test.ts`
  (quatre 308), `routes.test.ts` (`/crm` protégé), `members-model.test.ts` (rôle Commercial).
- **Essai de la dirigeante** : inviter un Commercial ; avec lui, créer un prospect, une
  opportunité à deux lignes, une relance pour demain ; le lendemain, la voir dans le brief, la
  cloche et « Mes tâches », la cocher ; créer le devis, le marquer envoyé puis accepté ; vérifier
  qu'il ne peut ni convertir en facture, ni ouvrir la trésorerie ; avec la dirigeante, convertir le
  prospect en client (NIF), créer le projet depuis l'opportunité gagnée, émettre la facture ;
  relire la fiche 360° (devis, facture, solde dû, projet, fil) puis les rapports.

## Découpage en lots parallélisables (worktrees séparés)

Règle d'ADR-0011 et d'ADR-0012 § 9 : **un fichier = un seul écrivain** par lot ; les fichiers
partagés ne reçoivent que des **ajouts** d'une ligne ou d'un bloc, chacun dans sa zone, sous un
commentaire `// ADR-0040 — <lot>`.

| Lot | Contenu | Fichiers probables (possédés) | Critères d'acceptation | Tests | Dépend de |
|---|---|---|---|---|---|
| **C0 — Socle RBAC, durcissement, contrats** (petit, en premier) | rôle `sales_rep`, action `sales.quote`, permissions des devis, correctif § 4.4, contrats partagés | `apps/api/src/authz/permissions.ts`, `permissions.test.ts`, `apps/api/src/__tests__/rbac-matrix.e2e.test.ts` ; `apps/api/src/sales/quotes/quotes.controller.ts` (décorateurs seulement) ; `apps/api/src/morning-brief/morning-brief.service.ts` (garde `treasury.read` sur `cash`) ; `apps/api/src/grow/grow.controller.ts`, `grow-reader.service.ts` (masquage) ; `apps/api/src/actuals/actuals.controller.ts`, `objectives/objectives.controller.ts` (décorateurs) ; audit des contextes de `apps/api/src/ai/**` (test) ; `packages/shared/src/crm/**`, `packages/shared/package.json` (export `./crm`) ; `apps/web/src/lib/api.ts` (`ORG_ROLES`, `OrgAction`), `organisation/membres/_components/members-model.ts` (+ test), `invite-panel.tsx`, `lib/aide/articles/travailler-a-plusieurs.ts` ; `docs/12` (statut « appliqué ») | critères 1 (partie RBAC), 2, 3 ; Commercial attribuable seulement à la fusion de C0 | matrice 420 cases ; e2e brief et GROW masqués ; `routes-coverage` inchangé (aucune route) | — |
| **C1 — Comptes et migration** | `crm_accounts`, service, contrôleur, conversion, fusion, synchronisation client → compte, `accountId` des contacts, tâche `crm.accounts-reconcile`, migration et rapport | `apps/api/src/crm/accounts/**` (schéma, service, contrôleur, sync, reconcile) ; `apps/api/src/crm/contacts.service.ts`, `crm-contacts.controller.ts` ; bloc `CrmContact` de `crm.schemas.ts` et de `crm.dto.ts` ; `apps/api/src/sales/customers.service.ts` (appel de sync, trois lignes) ; `apps/api/migrations/20261030-0001-crm-accounts.mjs` (+ test) ; `apps/api/src/__tests__/crm-accounts.e2e.test.ts` | critères 5, 6, 17, 18 (comptes) | e2e comptes ; migration deux passages ; unitaires de normalisation de nom | C0 (contrats) |
| **C2 — Pipeline v2 (API + moteur prévision)** | responsable, motifs de perte, lignes, `amountSource`, réassignation, `accountId` des opportunités (consomme `AccountsService` de C1), prévision pondérée, devis préremplis | `apps/api/src/crm/opportunities.service.ts`, `crm-opportunities.controller.ts`, `crm-settings.service.ts`, `crm-settings.controller.ts`, `crm-model.ts` ; blocs `CrmOpportunity` et `CrmSettings` de `crm.schemas.ts` et `crm.dto.ts` ; `packages/engine/src/crm/forecast.ts` (+ test) ; `apps/api/src/sales/quotes/quotes.service.ts` et un **nouveau** `quotes-from-opportunity.controller.ts` (évite d'écrire dans `quotes.controller.ts`, possédé par C0) ; `apps/api/src/__tests__/crm-pipeline-v2.e2e.test.ts` | critères 4, 12, 13 | moteur `weightedForecast` ; e2e pipeline v2 | C0 ; C1 pour `accountId` (branché après fusion de C1, le reste en parallèle) |
| **C3 — Rapports (API + moteur)** | `crmReports`, `GET /crm/reports` | `packages/engine/src/crm/reports.ts` (+ test) ; `apps/api/src/crm/reports/**` ; `apps/api/src/__tests__/crm-reports.e2e.test.ts` | critère 14 | moteur rapports ; e2e | C2 (champs `ownerId`, `lostReasonKey`, `wonAt`) |
| **C4 — Relances synchronisées** | `assigneeUserId`, `dueDay`, `reopen`, port `CRM_AGENDA_SOURCE` et Mes tâches mixte, notifications `crm.*`, rappels, brief (`CRM_SOURCE`, R10, `pipeline`), **web** Mes tâches et calendrier | `apps/api/src/crm/activities.service.ts`, `crm-activities.controller.ts` ; bloc `CrmActivity` de `crm.schemas.ts` et `crm.dto.ts` ; `apps/api/src/crm/agenda/**`, `crm/brief/**`, `crm/crm-reminders.job.ts`, `crm/crm-notifier.ts` ; `apps/api/src/work/my-tasks.ports.ts`, `work-tasks.service.ts` (méthode `myTasks` seulement) ; `packages/shared/src/work/views.ts` (`MyTaskEntry`) ; `packages/shared/src/notifications/index.ts` ; `packages/engine/src/morning-brief/**` ; `apps/api/src/morning-brief/morning-brief.ports.ts`, `morning-brief.module.ts`, `morning-brief.service.ts` (chargement CRM — **après** C0, qui touche la même méthode), `mail/mail.templates.ts` (bloc du brief) ; web `projets/_components/mes-taches*.ts(x)`, `calendar-mes-taches.tsx`, `calendar-model.ts` ; `apps/api/src/__tests__/crm-agenda.e2e.test.ts` | critères 8, 9, 10, 11 | e2e agenda ; moteur brief R10 ; modèles web Mes tâches | C0 ; indépendant de C1–C3 (l'`accountId` des activités est posé par la migration de C1 ; C4 le lit s'il existe) |
| **C5 — Web, application `/crm`** | déménagement `ventes/crm` → `crm`, navigation, redirections, Kanban glisser-déposer clavier, comptes et fiche 360°, contacts, activités, réglages (motifs, prévision) | `apps/web/src/app/(app)/crm/**` sauf `crm/rapports/**` ; suppression de `apps/web/src/app/(app)/ventes/crm/**` ; `apps/web/src/lib/api-crm.ts` ; `_components/nav-model.ts` (+ test) ; `apps/web/next.config.mjs` (+ `redirects.test.ts`) ; `apps/web/src/lib/routes.ts` (+ test) ; `apps/web/src/app/(app)/ventes/devis/**` (boutons `sales.quote`) | critère 16 ; écrans § 8 | modèles purs, nav, redirections, routes | C0 ; données réelles après C1, C2, C8 |
| **C6 — Web rapports** | écran `/crm/rapports` | `apps/web/src/app/(app)/crm/rapports/**`, `apps/web/src/lib/api-crm-reports.ts` | § 8.2 rapports | `rapports-model.test.ts` | C3 ; coquille de C5 (`crm/layout.tsx`) |
| **C7 — Opportunité gagnée → projet** | `from-opportunity`, index unique, suggestion `CREATE_PROJECT`, notification `crm.opportunity_won`, encadré web | `apps/api/src/work/billing/work-billing.service.ts`, `work-billing.controller.ts`, `work.schemas.ts` (union `source.kind`, index) ; `packages/shared/src/work/schemas.ts` (`CreateProjectFromOpportunityBody`) ; `apps/web/src/app/(app)/crm/opportunites/[id]/_components/creer-projet*.tsx` ; `apps/api/src/__tests__/work-billing.e2e.test.ts` (bloc ajouté) | critère 15 | e2e ; modèle web de l'encadré | C2 (lignes, `won`) ; C5 (page d'opportunité) ; C4 (type `crm.opportunity_won`) |
| **C8 — Fiche 360° et fil (API)** | `CrmOverviewModule`, `overview`, `timeline`, `sumOutstandingByCurrency` | `apps/api/src/crm/overview/**` ; `packages/engine/src/receivables/outstanding.ts` (+ test) ; `apps/api/src/__tests__/crm-overview.e2e.test.ts` | critère 7 | e2e sections et pagination du fil ; moteur | C1 |
| **C9 — CSV v2** (petit, en dernier) | colonnes compte, responsable, motif de perte à l'import et à l'export | `apps/api/src/crm/crm-csv.ts`, `crm-csv.service.ts` (+ tests) | import d'un fichier ADR-0035 toujours accepté (compatibilité) | unitaires CSV | C1, C2 |

### Zones de conflit entre lots

| Fichier | Lots | Règle |
|---|---|---|
| `apps/api/src/crm/crm.schemas.ts`, `crm.dto.ts` | C1 (`CrmContact`), C2 (`CrmOpportunity`, `CrmSettings`), C4 (`CrmActivity`) | **une classe par lot** ; aucun lot ne touche la classe d'un autre ; imports ajoutés en fin de bloc d'import |
| `apps/api/src/crm/crm.module.ts` | C1, C2, C3, C4 | une ligne de `controllers`/`providers`/`forFeature` chacun, sous son commentaire ; C8 a son **propre** module |
| `apps/api/src/app.module.ts` | C8 (`CrmOverviewModule`) | une ligne |
| `apps/api/src/authz/routes-coverage.test.ts` | C1, C2, C3, C4, C7, C8 | contrôleurs et bloc `attendu` ajoutés **à la fin**, un bloc par lot ; C0 n'y touche pas |
| `apps/api/src/authz/permissions.ts` | **C0 seul** | aucun autre lot n'y écrit |
| `apps/api/src/morning-brief/morning-brief.service.ts` | C0 (garde `treasury.read` sur `cash`), C4 (chargement CRM) | **C0 d'abord** ; C4 rebasé |
| `apps/api/src/sales/quotes/**` | C0 (`quotes.controller.ts`, décorateurs), C2 (`quotes.service.ts` + contrôleur nouveau) | fichiers distincts |
| `apps/api/src/work/work.schemas.ts`, `work-billing.*` | C7 seul | — |
| `apps/api/src/work/work-tasks.service.ts` | C4 seul (méthode `myTasks`) | — |
| `packages/engine/src/crm/index.ts` | C2 (`export * from './forecast.js'`), C3 (`./reports.js`), version | une ligne chacun ; **C2** porte le passage de `CRM_INDICATORS_VERSION` à 1.1.0 |
| `packages/engine/src/receivables/index.ts` | C8 | une ligne |
| `packages/shared/src/crm/**` | C0 crée ; C2, C3, C4, C7 **ajoutent** des fichiers (`forecast.ts`, `reports.ts`, `agenda.ts`), jamais dans ceux d'un autre | `index.ts` : une ligne d'export par lot |
| `packages/shared/src/notifications/index.ts` | C4 seul (C7 consomme `crm.opportunity_won`, déclaré par C4) | — |
| `apps/web/src/app/(app)/_components/nav-model.ts` (+ test) | C5 seul | — |
| `apps/web/next.config.mjs`, `apps/web/src/lib/routes.ts` | C5 seul | — |
| `apps/web/src/app/(app)/crm/layout.tsx` | C5 crée ; C6, C7 l'utilisent sans l'écrire | onglets et sous-options demandés à C5 |
| `apps/web/src/lib/api.ts` | C0 seul | les autres lots ont `api-crm.ts`, `api-crm-reports.ts` |
| `docs/12`, `docs/15`, `docs/16`, index des ADR | ce lot de documentation ; chaque lot met à jour la ligne « proposé » → « implémenté » de sa section | une section par lot |

### Ordre de fusion conseillé

```
C0 ──┬── C1 ──┬── C8 ─────────────┐
     │        └── C2 ──┬── C3 ── C6 │
     │                 └── C7 ◀── C5 (squelette) ◀── C4 (type de notification)
     ├── C4 (en parallèle de C1, C2)
     └── C5 (squelette et redirections tôt ; écrans au fil de C1, C2, C8)
C9 en dernier (après C1 et C2).
```

1. **C0** (seul, petit) — bloque tout : rôle, action, contrats, correctif de trésorerie.
2. **C1**, **C4** et le **squelette de C5** (déménagement, navigation, redirections) en parallèle.
3. **C2** (branche `accountId` dès C1 fusionné), **C8** (après C1).
4. **C3**, puis **C6** ; **C7** (après C2, C4, C5).
5. **C9**.

Chemin critique : C0 → C1 → C2 → C7. Si C1 glisse, C2 livre responsable, motifs, lignes et
prévision sans `accountId`, puis l'ajoute.

## Décisions ouvertes — elles appartiennent à la dirigeante

Chacune a une **valeur par défaut**, appliquée si rien n'est tranché.

1. **Nom technique et place du rôle** : slug `sales_rep`, libellé « Commercial », rang 5 (entre
   Analyste et Chef de projet). *Défaut : oui.*
2. **Conseiller et trésorerie** : la règle « trésorerie ⇒ `treasury.read` » retire au Conseiller
   le fait `tresorerie` du brief et les faits de trésorerie de GROW. *Défaut : appliquer la règle
   (cohérente avec ADR-0034, qui refuse déjà la trésorerie au Conseiller) ; si la dirigeante veut
   qu'un banquier voie la santé financière, lui donner `treasury.read` est un autre arbitrage.*
3. **Projets pour le Commercial** : `work.read` + `work.update`, sans `work.manage` (il ne crée pas
   le projet d'une opportunité gagnée). *Défaut : oui.*
4. **Conversion prospect → client par le Commercial** : elle crée une fiche client (NIF, type
   DGI), donc exige `sales.manage`, qu'il n'a pas. *Défaut : non ; il chiffre le prospect en client
   de passage et un détenteur de `sales.manage` convertit. Alternative : une action
   `sales.customer.create` à part, autre ADR.*
5. **Conversion devis → brouillon de facture par le Commercial** : *Défaut : non (`sales.quote` +
   `sales.manage`) ; le brouillon de facture est un geste de facturation.*
6. **Probabilités saisies par l'organisation** (`forecastProbability = 'manual'`) quand l'historique
   manque. *Défaut : désactivé ; historique seulement, « non pondérable » sinon (O4).*
7. **Motifs de perte par défaut** (Prix, Concurrent retenu, Pas de budget, Sans réponse, Besoin
   abandonné, Autre) et **motif obligatoire**. *Défaut : cette liste, obligatoire.*
8. **Montant estimé depuis les lignes : hors taxes ou toutes taxes ?** *Défaut : hors taxes (la
   valeur commerciale ; les taxes dépendent des groupes DGI des articles). Ce n'est pas une règle
   fiscale : c'est le choix de la base affichée, étiquetée.*
9. **Visibilité du pipeline** : tout détenteur de `crm.read` voit toutes les opportunités ; le
   filtre « Les miennes » n'est qu'un confort. *Défaut : oui ; visibilité par responsable ou par
   équipe dans un lot suivant si une équipe le demande.*
10. **Fusion des prospects à la migration** : par nom normalisé **exact**, rapport à relire, pas de
    rapprochement approché. *Défaut : oui.*
11. **Seuil d'échantillon des rapports** : 10 (celui des probabilités d'étape) pour les taux et les
    durées. *Défaut : 10.*
12. **Période par défaut des rapports** : 12 mois glissants, 24 au plus. *Défaut : oui.*
13. **Notification « opportunité gagnée »** : au seul responsable de l'opportunité. *Défaut : oui ;
    l'étendre aux détenteurs de `work.manage` si les projets tardent à être créés.*
14. **Offres** (docs/13 « À ARBITRER ») : CRM complet et rôle Commercial ouverts à toutes les
    offres, comme le CRM minimal et les projets. *Défaut : toutes les offres, à arbitrer avec le
    reste du tableau ; le nombre de sièges commerciaux est un candidat naturel à une borne d'offre.*
15. **Formulaire public de capture de prospects** : lot futur C-F, sous ADR propre. *Défaut : hors
    R2.*

Aucune règle fiscale ou légale RDC n'est introduite par cet ADR : les règles de la fiche client
(type DGI, NIF) sont celles de Ventes, appliquées par son service ; la validité des devis reste la
valeur de confort d'ADR-0035.

## Liens

- [ADR-0011](ADR-0011-contrats-integration-s18.md) ; [ADR-0012](ADR-0012-modele-rbac-complet.md)
  (amendé) ; [ADR-0018](ADR-0018-trajectoire-erp-trois-modules.md) ;
  [ADR-0020](ADR-0020-ordonnanceur-mongodb.md) ; [ADR-0022](ADR-0022-clients-catalogue-et-calcul-des-factures.md) ;
  [ADR-0023](ADR-0023-factures-et-avoirs.md) ; [ADR-0030](ADR-0030-refonte-ui-ux.md) ;
  [ADR-0031](ADR-0031-encaissements-et-realise.md) ; [ADR-0033](ADR-0033-brief-du-matin.md)
  (étendu) ; [ADR-0034](ADR-0034-depenses-et-tresorerie.md) ; [ADR-0035](ADR-0035-crm-et-devis.md)
  (prolongé) ; [ADR-0038](ADR-0038-navigation-par-modules-et-initiatives.md) (amendé) ;
  [ADR-0039](ADR-0039-projets-et-taches-run.md) (étendu).
- [docs/12](../12-ROLES-PERMISSIONS.md) ; [docs/13](../13-PRICING.md) ; [docs/15](../15-DATABASE.md) ;
  [docs/16](../16-API.md) ; [docs/17](../17-SECURITE.md) ; [docs/26](../26-CONVENTIONS.md).
- Code existant : `apps/api/src/crm/`, `apps/api/src/work/` (dont `billing/`, `brief/`,
  `work-reminders.job.ts`), `apps/api/src/notifications/`, `apps/api/src/authz/permissions.ts`,
  `packages/engine/src/crm/`, `apps/web/src/app/(app)/ventes/crm/`,
  `apps/web/src/app/(app)/_components/nav-model.ts`.
- Code à créer : `apps/api/src/crm/accounts/`, `crm/overview/`, `crm/reports/`, `crm/agenda/`,
  `crm/brief/`, `packages/shared/src/crm/`, `packages/engine/src/crm/forecast.ts`, `reports.ts`,
  `apps/web/src/app/(app)/crm/`.
