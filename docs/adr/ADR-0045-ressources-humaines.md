# ADR-0045 — Ressources humaines (R4) : dossiers collaborateurs, organigramme, absences et congés, documents RH, entrées et sorties — paie exclue

Statut : Proposed
Date : 2026-10-30
Décideurs : Gracy Omokoso (dirigeante) — **ordre du RUN validé** (R0 navigation, R1 projets, R2 CRM,
R3 achats, **R4 RH sans la paie**, R5 stocks, équipements et documents) et consigne du 30 oct.
2026 : « continue, ne t'arrête pas » ; CTO Lalanda (contrat technique). Le cadrage est **proposé** :
chaque choix qui lui appartient porte une valeur par défaut, appliquée tant qu'elle ne tranche pas
autrement (§ Décisions ouvertes). Les points de droit du travail et de protection des données sont
soumis à un juriste (docs/28 § 1.3) ; **cet ADR n'en pose aucun**.

> **Lève le refus d'[ADR-0018](ADR-0018-trajectoire-erp-trois-modules.md)** (« Refusés à ce stade :
> RH et paie, stocks, achats… ») **pour les RH seulement, paie exclue d'emblée**, à la demande de la
> dirigeante (RUN complet, « pour ne plus utiliser d'autres outils »). La paie, les cotisations et
> les déclarations sociales restent refusées (§ Hors périmètre).
> **Amende [ADR-0012](ADR-0012-modele-rbac-complet.md) et docs/12** : cinq actions nouvelles
> (`hr.read`, `hr.manage`, `hr.sensitive.read`, `leave.request`, `leave.approve`) et **un rôle
> nouveau, Responsable RH** (`hr_manager`, § 4.2). **Étend [ADR-0041](ADR-0041-autorisations-par-membre.md)** :
> neuvième domaine « Ressources humaines », dépendances, `leave.approve` parmi les actions
> d'approbation à séparation dynamique. **Étend [ADR-0039](ADR-0039-projets-et-taches-run.md)**
> (« Mes tâches », cloche, calendrier, absences des assignés, feuille de temps en lecture, un constat
> de marge), **[ADR-0033](ADR-0033-brief-du-matin.md)** (port `HR_SOURCE`, règles R13 à R15).
> **Reprend sans le modifier** le motif de chiffrement des coordonnées fournisseurs
> d'[ADR-0044](ADR-0044-achats-et-fournisseurs.md) § 2.1.1 (lui-même fondé sur
> [ADR-0013](ADR-0013-stockage-secrets-integration.md)) et celui des pièces jointes d'ADR-0039 § 2.5.
> **N'introduit aucune règle légale** : ni durée de congé, ni durée de période d'essai, ni préavis,
> ni durée de conservation ; tout est paramétré par l'organisation (§ 9).

## Contexte

Lalanda connaît ses **membres** (des comptes qui se connectent : `memberships`, rôle, ajouts et
retraits d'ADR-0041) et le **temps** qu'ils saisissent sur les projets (`work_time_entries`, coût
horaire `work_member_rates`, ADR-0039). Il ne connaît pas ses **collaborateurs**. Une PME tient
aujourd'hui ailleurs (classeur, papier, WhatsApp) le registre du personnel, les contrats, les congés
et les échéances. Six manques :

1. **Pas de personne hors compte.** Un chauffeur, une hôtesse ou un agent d'entretien est employé
   sans jamais se connecter à Lalanda ; à l'inverse, un expert-comptable externe est membre sans être
   salarié. Le membre n'est pas le collaborateur.
2. **Pas de structure.** Ni service, ni poste, ni manager : on ne sait pas qui valide quoi pour qui.
3. **Pas d'absences.** Personne ne sait qui est absent demain, combien de jours il reste à chacun, ni
   si un congé a été accordé ; la charge des projets (ADR-0039) ignore qu'un assigné est en congé.
4. **Pas de pièces ni d'échéances.** Un CDD finit, une période d'essai se termine, une pièce d'identité
   expire : rien ne le rappelle.
5. **Pas de procédure d'entrée et de sortie.** Le badge, l'ordinateur, l'accès à Lalanda ne sont ni
   remis ni repris de façon tracée.
6. **Des données sensibles sans protection.** Salaire, coordonnées bancaires, pièce d'identité,
   contacts d'urgence, motif médical d'une absence circulent sans contrôle d'accès ni trace.

### Faits du dépôt qui commandent les décisions

| Fait | Où | Conséquence |
|---|---|---|
| Une appartenance porte `userId`, `organizationId`, `role`, `grants`, `revokes`, `permissionsRevision` ; aucune donnée de personne (poste, service, manager) | `organizations/membership.schema.ts` | la fiche collaborateur est une **collection distincte**, reliée facultativement à un `userId` |
| La matrice rôle × action, `ACTION_DEPENDENCIES`, `ACTION_DOMAINS` (huit), `SOD_PAIRS` (trois), `APPROVAL_ACTIONS` (`plan.approve`, `purchase.approve`), `PLATFORM_FORBIDDEN_ACTIONS` vivent dans `permissions.ts` ; 9 rôles, 33 actions, 495 cases | `authz/permissions.ts` ; docs/12 | cinq actions et un rôle s'y déclarent une fois ; matrice 10 × 38 + 6 × 38 = **608** cases |
| `purchaseApprovalDecision` juge les **personnes** (demandeur, créateur, approbations antérieures, nombre de détenteurs effectifs), jamais le rôle ; `AuthzService.countApprovers(org, action)` et `holdersOf(org, action)` comptent les détenteurs **effectifs** | `permissions.ts`, `authz/authz.service.ts` | `leaveApprovalDecision` suit ce motif ; destinataires choisis par `holdersOf` |
| Écarts par membre implémentés derrière `MEMBER_PERMISSIONS_ENABLED`, **éteint** | ADR-0041 § 4 ; docs/16 | sans rôle dédié, une personne RH ne peut aujourd'hui recevoir les droits RH qu'en étant Administrateur, Directeur financier ou Propriétaire (§ 4.2) |
| Coordonnées fournisseurs : AES-256-GCM sous `MASTER_KEYRING`, AAD = organisation + fiche + moyen, `masked` + empreinte HMAC, `reveal` réservé et journalisé strictement (`recordStrict`), 30 par heure, rotation par `secrets:rewrap` | `purchases/suppliers/supplier-payment-crypto.ts`, docs/17 (ADR-0044 P2) | les champs sensibles RH reprennent **exactement** ce motif (§ 2.4) |
| Pièces jointes : PDF ≤ 10 Mio reconnu par signature, **non analysé**, servi en téléchargement inerte ; images ≤ 2 Mio assainies ; clé `work-attachments/<objectId>` au hasard ; 1 Gio par organisation | ADR-0039 § 2.5, `work/work-attachments.storage.ts` | documents RH : même motif, préfixe `hr-documents/`, plus chiffrement côté application des pièces sensibles (§ 2.8) |
| Les projets RUN sont visibles par **tout** détenteur de `work.read` (`visibility: 'organization'`, seule valeur) | ADR-0039 O7, § 2.1 | une liste de départ dans une tâche RUN révélerait un licenciement à toute l'équipe : les listes d'entrée et de sortie **ne sont pas** des tâches RUN (O4) |
| Temps : `work_time_entries` (≤ 1 440 minutes par jour et par personne), coût calculé à la lecture avec `work_member_rates` ; la marge soustrait le coût du temps **et** les dépenses `workProjectId` | ADR-0039 § 2.6, § 2.7, § 5 ; `engine/src/work/margin.ts` (`WORK_MARGIN_VERSION = '1.1.0'`) | une feuille de temps RH ne crée **aucune** saisie nouvelle ; le risque de double comptage salaire + temps est signalé, jamais corrigé seul (O5) |
| Catégorie de dépense `personnel` — « Salaires et charges sociales » | ADR-0034 § 1 | les salaires payés restent des dépenses saisies en trésorerie ; R4 n'en crée aucune |
| « Mes tâches » agrège à la lecture par ports (`CRM_AGENDA_SOURCE`, `PURCHASES_AGENDA_SOURCE`) ; calendrier `/projets/mes-taches/calendrier` (`calendar-model.ts`) | `work/my-tasks.ports.ts`, web `projets/_components/calendar-*` | port `HR_AGENDA_SOURCE` ; absences rendues en bandeaux d'une journée sur le calendrier |
| Cloche : `NOTIFICATION_KINDS`, `NOTIFICATION_SOURCE_MODULES` (`work`, `crm`, `organization`, `purchases`), `NOTIFICATION_ENTITY_TYPES` | `packages/shared/src/notifications/index.ts` | module `hr`, neuf types, quatre natures d'entité |
| Brief : ports par module (`PURCHASES_SOURCE`…), règles R1 à R12, `MORNING_BRIEF_VERSION = '1.3.0'` | `morning-brief/morning-brief.ports.ts`, `engine/src/morning-brief/types.ts` | port `HR_SOURCE`, règles R13 à R15, version 1.4.0 |
| Docs/28 § 1.3 : le régime congolais de protection des données et la conservation des pièces sont des **questions ouvertes au juriste** ; l'éditeur est Go freelance SARLU, de droit congolais (ADR-0043) | `docs/28-CONFORMITE-LEGALE.md` | aucune durée de conservation n'est fixée par Lalanda ; décision ouverte n° 14 |

## Options considérées

### O1 — Collaborateur et membre : une seule entité ou deux ?

1. **Enrichir `memberships`** (poste, manager, contrat). Écarté : une personne sans compte n'aurait pas
   de fiche ; supprimer un accès effacerait un dossier du personnel ; la collection des droits
   porterait des données personnelles lues à chaque requête par le guard.
2. **Deux entités, un lien facultatif** : `hr_employees` décrit la personne employée ; `userId`
   (facultatif, unique par organisation) la relie à un compte membre. Un membre sans fiche (conseiller
   externe) et une fiche sans compte (chauffeur) sont tous deux normaux. **Retenu.**

### O2 — Où vivent les données sensibles ?

1. Des champs chiffrés dans `hr_employees`. Écarté : toute liste chargerait les chiffrés ; une
   projection oubliée suffirait à les servir.
2. **Une collection à part, `hr_employee_private`** (un document par collaborateur), dont chaque
   section est chiffrée (motif d'ADR-0044 § 2.1.1) ; les listes et fiches ne la lisent **jamais** ; seul
   le service des données sensibles l'ouvre, derrière `hr.sensitive.read`, avec audit strict.
   **Retenu.**

### O3 — Qui valide une absence ?

1. Une action seule (`leave.approve`) : tout détenteur valide tout le monde. Écarté : le manager, qui
   connaît la charge de son équipe, ne serait pas consulté, ou il faudrait lui donner l'accès à toute
   l'organisation.
2. **Relation + action** : l'étape « manager » est tenue par le **manager désigné** dans la fiche
   (relation, vérifiée par une fonction pure, sans action dédiée) ; l'étape « RH », facultative, par un
   détenteur effectif de `leave.approve`, qui peut aussi **suppléer** un manager absent (marqué). Le
   circuit est réglable (§ 2.2). **Retenu.**

### O4 — Listes d'entrée et de sortie : tâches RUN ou listes RH ?

1. **Tâches d'un projet RUN** « Intégrations et départs ». Écarté : la visibilité des projets est
   l'organisation entière (ADR-0039 O7) ; « Reprendre l'ordinateur de X » annoncerait un départ avant
   qu'il soit public.
2. **Listes RH** (`hr_checklists`), éléments assignés à une personne ; chaque élément apparaît dans
   « Mes tâches » **de son seul assigné** (port, à la lecture), avec la cloche et le calendrier.
   **Retenu.** À revoir quand les projets privés existeront (ADR-0039, décision ouverte n° 2).

### O5 — Feuilles de temps : les retenir ?

1. **Nouvelle saisie RH** (heures de présence, pointage). Écarté : doublon de `work_time_entries`,
   et le pointage relève de la paie ou d'un matériel.
2. **Feuille de temps à valider** (soumission hebdomadaire, validation par le manager, verrou).
   Écarté **pour R4** : ADR-0039 l'a mise hors périmètre ; elle change le cycle de vie des saisies de
   temps et la marge ; lot futur (décision ouverte n° 10).
3. **Vue hebdomadaire en lecture** des saisies existantes, croisée avec les absences et les jours
   fériés, sans validation et **sans changer le calcul de la marge** ; un **constat** signale le risque
   de double comptage salaire + coût du temps. **Retenu** (§ 6.3).

### O6 — Rôle « Responsable RH » : oui ou non ?

1. **Non** (motif d'ADR-0044 O6 pour l'Acheteur) : un écart d'ADR-0041 suffirait. Écarté **ici**, pour
   trois raisons qui ne valaient pas pour l'Acheteur :
   - les données sensibles du personnel exigent un **titre visible et auditable** : l'accès au salaire
     d'autrui caché dans un ajout sur un « Analyste » se lit mal dans la liste des membres ;
   - la fonction RH est **disjointe** de la finance : un Responsable RH ne doit voir ni trésorerie, ni
     ventes, ni achats ; aucun titre existant n'a ce profil (Administrateur : gouvernance de
     l'organisation ; Directeur financier : argent) ;
   - `MEMBER_PERMISSIONS_ENABLED` est éteint : sans rôle, une personne RH devrait être nommée
     Administrateur, Directeur financier ou Propriétaire, ce qui lui ouvre bien plus que les RH.
2. **Oui, rôle `hr_manager`** « Responsable RH », rang 6, huit actions socle compris (§ 4.2). **Retenu** (décision
   ouverte n° 2).

### O7 — Où vivent les contrats et les calculs

Comme ADR-0044 O7 : contrats zod dans **`packages/shared/src/hr/`** (entrée `@lalanda/shared/hr`) ;
calculs dans un module **pur** `packages/engine/src/hr/` (`HR_VERSION = '1.0.0'`), sans horloge (jour
de référence en paramètre), jours en **centièmes de jour** (`bigint`), rendus en chaînes décimales.

## Décision

### 1. Vocabulaire

| Interface (français) | Code | Collection |
|---|---|---|
| Collaborateur, dossier collaborateur | `Employee` | `hr_employees` (nouvelle) |
| Données sensibles du collaborateur | `EmployeePrivate` | `hr_employee_private` (nouvelle) |
| Service | `Department` | `hr_departments` (nouvelle) |
| Organigramme | `OrgChart` | calculé, jamais stocké |
| Type d'absence | `LeaveType` | `hr_leave_types` (nouvelle) |
| Jour férié ou de fermeture | `Holiday` | `hr_holidays` (nouvelle) |
| Demande d'absence | `LeaveRequest` | `hr_leave_requests` (nouvelle) |
| Mouvement de solde (acquisition, attribution, ajustement, prise, report, expiration) | `LeaveLedgerEntry` | `hr_leave_ledger` (nouvelle, ajout seul) |
| Solde | `LeaveBalance` | calculé par le moteur, jamais stocké |
| Document RH | `HrDocument` | `hr_documents` (nouvelle) |
| Modèle de liste d'entrée ou de sortie | `ChecklistTemplate` | `hr_checklist_templates` (nouvelle) |
| Liste d'entrée ou de sortie | `Checklist` | `hr_checklists` (nouvelle) |
| Réglages RH | `HrSettings` | `hr_settings` (un document par organisation) |
| Feuille de temps | `WeeklyTimesheet` | calculée, lue sur `work_time_entries` |

Dates civiles `AAAA-MM-JJ` au **jour de Kinshasa** (ADR-0027) ; horodatages UTC. Tout document porte
`organizationId`, `revision`, `createdBy`, `updatedBy`, horodatages, `_schemaVersion`. Ressource d'une
autre organisation : **404**, y compris par identifiant forgé dans un corps (`employeeId`,
`departmentId`, `managerEmployeeId`, `userId`, `typeId`, `documentId`, `templateId`). Écriture
concurrente : `expectedRevision` → `409 STALE_REVISION`. Montants (salaire) : chaînes décimales, deux
décimales au plus, devises `CDF` et `USD`. Durées d'absence : chaînes décimales en jours, demi-journée
au plus fin pour une demande, deux décimales pour une acquisition.

### 2. Modèle de données

#### 2.1 `hr_employees` (dossier, données non sensibles)

| Champ | Règle |
|---|---|
| `firstName`, `lastName` | 1 à 100 chacun ; `sortName`, `searchKey` normalisés (motif de `suppliers`) |
| `preferredName` | facultatif, ≤ 100 (nom d'usage affiché) |
| `employeeNumber` | matricule, facultatif, ≤ 30, format libre ; **unique partiel** `{ organizationId, employeeNumberKey }` (`409 EMPLOYEE_NUMBER_EXISTS`) |
| `userId` | `null` \| compte **membre de l'organisation** à l'écriture (`422 EMPLOYEE_USER_NOT_MEMBER`) ; **unique partiel** `{ organizationId, userId }` (`409 EMPLOYEE_USER_ALREADY_LINKED`) ; un compte qui quitte l'organisation laisse le lien **inerte** (les vues « moi » vérifient l'appartenance à chaque requête) |
| `workEmail`, `workPhone` | facultatifs, bornes de la fiche client ; coordonnées **professionnelles** seulement |
| `jobTitle` | intitulé de poste, 1 à 120 ; autocomplétion sur les intitulés existants (pas de référentiel des postes en R4) |
| `departmentId` | `null` \| service actif de l'organisation |
| `managerEmployeeId` | `null` \| collaborateur actif de l'organisation, **jamais soi-même ni un subordonné** (`409 MANAGER_CYCLE`, moteur `reportingCycle`) |
| `contractType` | clé parmi les types de contrat de l'organisation (`hr_settings.contractTypes`) ; **informative, sans effet juridique calculé** |
| `startDate` | date d'entrée, requise |
| `probationEndDate` | facultative, **saisie**, jamais calculée (aucune durée légale d'essai n'est posée) ; ≥ `startDate` |
| `contractEndDate` | facultative ; **requise** si le type de contrat porte `hasEndDate` (cohérence de donnée, pas règle légale) ; ≥ `startDate` |
| `endDate`, `exitCategory` | posés par la sortie (§ 3.1) ; `exitCategory` : `resignation` \| `end_of_contract` \| `dismissal` \| `mutual_agreement` \| `retirement` \| `death` \| `other` (rapports) ; le **commentaire** de sortie est sensible (§ 2.4) |
| `status` | `active` \| `exited` \| `anonymized` ; « à venir » (`startDate` future) et « en période d'essai » sont **dérivés** par le moteur, jamais stockés |
| `workPattern` | `null` (= réglage de l'organisation) \| jours travaillés `{ mon…sun: 0 \| 0.5 \| 1 }` ; sert au décompte des jours d'absence et à la feuille de temps |
| `workLocation` | facultatif, ≤ 120 (site, ville) |
| `leavePolicyOverrides` | `null` \| par type : acquisition propre (`accrual`, § 2.5) — un temps partiel, un contrat négocié |
| `notes` | ≤ 2 000, texte brut, **non sensible** par contrat d'interface (l'écran le rappelle : « ne rien noter ici de médical, de disciplinaire ou de financier ») |

**Minimisation** : aucun sexe, aucune date de naissance, aucune nationalité, aucune photo, aucune
situation familiale dans le dossier courant. La date de naissance, l'adresse et les coordonnées
personnelles, si l'organisation les tient, vont dans les données sensibles (§ 2.4) ; rien n'est
obligatoire au-delà du nom, du poste et de la date d'entrée.

Index : `{ organizationId, status, sortName, _id }` ; `{ organizationId, departmentId }` ;
`{ organizationId, managerEmployeeId }` ; `{ organizationId, contractEndDate }` (partiel) ;
`{ organizationId, probationEndDate }` (partiel) ; uniques partiels du matricule et de `userId`.

#### 2.2 `hr_settings`

| Champ | Règle |
|---|---|
| `workPattern` | jours travaillés par défaut ; **défaut : lundi à vendredi** (décision ouverte n° 5) |
| `leaveYearStart` | `MM-JJ`, défaut `01-01` (année de congé civile) |
| `approvalFlow` | `manager_only` \| `manager_then_hr` \| `hr_only` ; **défaut `manager_only`** (décision ouverte n° 6) ; un type d'absence peut exiger l'étape RH (§ 2.5) |
| `allowSoleApprover` | défaut `true` : l'organisation qui n'a qu'**un** détenteur effectif de `leave.approve` valide ses propres absences, marquées `soleApprover` (motif R2) |
| `contractTypes` | 1 à 20 `{ key, label (1–60), hasEndDate, active }` ; **défaut** : `permanent` « CDI », `fixed_term` « CDD » (`hasEndDate`), `internship` « Stage » (`hasEndDate`), `freelance` « Prestataire », `daily` « Journalier », `other` « Autre » — libellés modifiables, **aucun effet légal calculé** |
| `reminders` | jours d'avance : `probationEnd` (défaut 15), `contractEnd` (défaut 30), `documentExpiry` (défaut 30), chacun 0 à 120 (décision ouverte n° 11) |
| `teamCalendarVisibility` | `department` \| `organization` \| `managers_and_hr` ; **défaut `department`** : chacun voit les absences de son service et de son équipe (décision ouverte n° 8) |
| `orgChartVisibility` | `members` \| `hr_only` ; **défaut `members`** : tout membre relié à une fiche voit nom, poste, service et manager (décision ouverte n° 9) |
| `retention` | `{ privateDataMonthsAfterExit: null \| 1–600, anonymizeYearsAfterExit: null \| 1–50 }` ; **défaut `null` partout : aucune purge automatique** (décision ouverte n° 14) |

#### 2.3 `hr_departments`

`name` (1–120, unique par organisation parmi les actifs, `409 DEPARTMENT_NAME_EXISTS`), `parentId`
(`null` ou service de l'organisation, **sans cycle**, profondeur ≤ 8 : `409 DEPARTMENT_CYCLE`,
`DEPARTMENT_TOO_DEEP`), `headEmployeeId` (facultatif, responsable affiché ; **n'est pas** le manager
des membres du service : la ligne hiérarchique est portée par chaque fiche), `active`. Archivage refusé
tant qu'un collaborateur actif ou un service actif y est rattaché (`409 DEPARTMENT_IN_USE`). Index :
`{ organizationId, parentId }`.

**Organigramme** : deux vues calculées par le moteur (`orgChart`, § 7) : par **services** (arbre des
services, effectifs) et par **ligne hiérarchique** (arbre des managers, racines = collaborateurs sans
manager). Les collaborateurs `exited` et `anonymized` n'y figurent pas.

#### 2.4 `hr_employee_private` (données sensibles, chiffrées)

Un document par collaborateur (`{ organizationId, employeeId }` unique), créé à la première écriture.
Quatre **sections**, chacune `{ cipher, masked, changedAt, changedBy } | null` :

| Section | En clair (seulement à l'écriture et au `reveal`) | Forme masquée lisible sans `reveal` |
|---|---|---|
| `compensation` | historique ≤ 50 `{ effectiveFrom, amount, currency, period: 'month' \| 'day' \| 'hour', note }` (salaire de base **contractuel**, déclaré, jamais calculé) | « Salaire renseigné depuis le … » (ni montant, ni devise) |
| `bankDetails` | 0 à 3 `{ kind: 'bank' \| 'mobile_money', bankName \| operator, holderName, accountNumber \| phoneNumber, iban?, swift? }` (forme seulement) | `Rawbank •••• 4521`, `M-Pesa •••• 78` + empreinte HMAC |
| `identity` | `{ birthDate?, nationality?, idDocuments: [{ kind: 'national_id' \| 'passport' \| 'voter_card' \| 'residence_permit' \| 'other', number, issuedOn?, expiresOn? }] }` | type et **date d'expiration** seulement (pour les rappels), jamais le numéro |
| `personalContact` | `{ address?, personalPhone?, personalEmail?, emergencyContacts: 0–3 { name, relation, phone } }` | « 2 contacts d'urgence renseignés » |

Plus `exitNote` (≤ 2 000, chiffré, motif détaillé de sortie).

- **Chiffrement** : AES-256-GCM sous le trousseau `MASTER_KEYRING`, réutilisation telle quelle de
  `secrets-crypto.ts` (ADR-0013) ; emplacement `org:hr_employee_private`, dérivation HKDF et **AAD =
  `organizationId + employeeId + section`** : un chiffré recopié vers un autre collaborateur, une autre
  section ou une autre organisation ne se déchiffre pas. Sans trousseau : `503 SECRETS_NOT_CONFIGURED`,
  jamais stocké en clair. Rotation comprise dans `secrets:rewrap`. `toJSON`/`toObject` remplacent tout
  chiffré par `[redacted]`.
- Les dates d'expiration des pièces d'identité sont **recopiées en clair** dans `idExpiries:
  [{ kind, expiresOn }]` (sans numéro) pour que la tâche de rappel n'ait jamais à déchiffrer (§ 6.4).
- **Lecture en clair** : `POST /hr/employees/:id/private/reveal { sections[] }` — `hr.sensitive.read`,
  **ou** le collaborateur lui-même pour son propre dossier (droit d'accès, décision ouverte n° 4) ;
  audit **strict** écrit avant la réponse (`hr.private.revealed` : sections, sans valeur ; sans trace,
  rien n'est révélé) ; **30 par heure et par utilisateur** (`429 HR_REVEAL_RATE_LIMITED`).
- **Écriture** : `PUT /hr/employees/:id/private/:section` — `hr.manage` **et** `hr.sensitive.read` ;
  audit strict dans la même transaction (`hr.private.changed` : section, avant et après **masqués**) ;
  changer `bankDetails` notifie le collaborateur relié (s'il a un compte) et les détenteurs effectifs de
  `hr.sensitive.read` sauf l'auteur (`hr.bank_details_changed`) et pose un bandeau sept jours sur la
  fiche : un détournement de salaire est la fraude classique.
- **Jamais** exportées en CSV, servies à l'IA, écrites dans les journaux d'exploitation, ni rendues
  dans une liste, un rapport, une notification ou le brief.

#### 2.5 `hr_leave_types`

| Champ | Règle |
|---|---|
| `label` | 1 à 60, unique parmi les actifs |
| `unit` | `day` \| `half_day` (granularité minimale d'une demande) |
| `deductsFromBalance` | si vrai, une demande approuvée débite le solde de ce type |
| `accrual` | `{ kind: 'none' }` \| `{ kind: 'monthly', days }` \| `{ kind: 'yearly', days, on: 'leave_year_start' \| 'anniversary' }` ; `days` 0 à 60, deux décimales ; **défaut `none`** sur tous les types créés par Lalanda : aucun droit n'est posé par défaut (décision ouverte n° 7) |
| `proration` | `calendar_days` (acquisition au prorata des jours civils d'activité du mois ou de l'année) \| `none` ; défaut `calendar_days` |
| `carryOver` | `{ maxDays: null \| 0–365, expiresAfterMonths: null \| 1–36 }` ; défaut `{ null, null }` (report illimité, sans expiration) |
| `allowNegative` | défaut `false` (`409 LEAVE_BALANCE_INSUFFICIENT`) |
| `requiresDocument` | défaut `false` ; si vrai, une pièce est réclamée (non bloquante : l'écran l'indique, la validation reste possible) |
| `confidential` | si vrai, le type et le motif ne sont visibles que du collaborateur, des détenteurs de `hr.sensitive.read` et de l'étape RH ; partout ailleurs (calendrier, manager, projets, brief) : « Absent » ; **impose l'étape RH seule** (le manager est informé, il ne valide pas) |
| `requiresHrApproval` | ajoute l'étape RH après celle du manager |
| `countsAsAbsenteeism` | pour le rapport d'absentéisme (§ 7) ; défaut vrai sauf pour le type « Congés » |
| `active` | archivage (jamais d'effacement si une demande l'utilise) |

**Types créés à l'activation** (modifiables, aucun droit chiffré) : « Congés » (`deductsFromBalance`,
`accrual: none`), « Maladie » (`confidential`, sans solde), « Absence autorisée » (sans solde),
« Absence non justifiée » (saisie par les RH seulement, sans solde). Décision ouverte n° 7.

#### 2.6 `hr_holidays`

`date`, `label` (1–80), `halfDay` (`am` \| `pm` \| `null`), `recurring` (même jour chaque année).
**Liste vide par défaut** : Lalanda ne publie pas de calendrier des jours fériés de la RDC tant qu'il
n'est pas sourcé (Country Pack, docs/09 ; décision ouverte n° 12). Unique `{ organizationId, date }`.

#### 2.7 `hr_leave_requests` et `hr_leave_ledger`

**Demande** :

| Champ | Règle |
|---|---|
| `employeeId` | le demandeur (fiche reliée à l'appelant) ; un détenteur de `hr.manage` peut saisir pour **tout** collaborateur, y compris sans compte |
| `typeId` | type actif |
| `start`, `end` | `{ date, half: 'full' \| 'am' \| 'pm' }` ; `end ≥ start` ; ≤ 366 jours civils |
| `days` | **calculé par le moteur** (`leaveDays` : jours travaillés du collaborateur, moins jours fériés, demi-journées comprises) ; `0` → `422 LEAVE_NO_WORKING_DAY` |
| `reason` | ≤ 500 ; masqué comme le type si `confidential` |
| `attachmentId` | facultatif : un `hr_documents` de catégorie `leave_justification` (§ 2.8) |
| `status` | `pending` → `approved` \| `rejected` ; `cancelled` (par le demandeur tant que `pending`, ou tant que `start` est future une fois approuvée ; par `hr.manage` à tout moment, motif obligatoire) |
| `steps` | figés à la soumission par le moteur (`leaveApprovalSteps`, § 7) : `['manager']`, `['manager', 'hr']` ou `['hr']` ; l'étape `manager` est **remplacée par `hr`** si le collaborateur n'a pas de manager, si le manager n'a pas de compte, ou si le type est `confidential` |
| `approvals` | `[{ step, userId, decision, at, comment, soleApprover, onBehalfOfManager }]` |
| `overlaps` | refus si une demande `pending` ou `approved` du même collaborateur chevauche (`409 LEAVE_OVERLAP`) |

**Grand livre des soldes** (`hr_leave_ledger`, **ajout seul**, jamais modifié) : `{ employeeId, typeId,
kind: 'accrual' | 'allocation' | 'adjustment' | 'taken' | 'taken_reversal' | 'carry_over' | 'expiry',
days (signé), effectiveOn, leaveYear, requestId?, period?, note, createdBy }`.

- L'approbation complète écrit `taken` (−`days`) **dans la même transaction** ; une annulation après
  approbation écrit `taken_reversal`.
- Les acquisitions sont écrites par la tâche quotidienne `hr.leave-accruals` (ADR-0020), **idempotente**
  par l'unique partiel `{ organizationId, employeeId, typeId, kind: 'accrual', period }`.
- Report et expiration : écrits par la même tâche au changement d'année de congé, montants rendus par le
  moteur (`carryOverOf`), idempotents par `{ …, kind, leaveYear }`.
- `allocation` et `adjustment` (reprise d'un solde existant à l'ouverture, correction) : `hr.manage`,
  note obligatoire, audit `hr.leave_balance.adjusted`.
- **Solde** = moteur `leaveBalance(ledger, asOf)` : acquis, pris, à venir (approuvé futur), en attente,
  disponible ; jamais stocké. Index : `{ organizationId, employeeId, typeId, effectiveOn }`.

Index des demandes : `{ organizationId, employeeId, 'start.date' }` ; `{ organizationId, status,
'start.date' }` ; `{ organizationId, 'end.date' }`.

#### 2.8 `hr_documents`

| Champ | Règle |
|---|---|
| `employeeId` | requis |
| `category` | `contract` \| `amendment` \| `id_document` \| `diploma` \| `medical` \| `leave_justification` \| `onboarding` \| `other` |
| `sensitive` | **imposé vrai** pour `id_document`, `medical`, `leave_justification` ; libre pour les autres (défaut faux) |
| `label`, `issuedOn`, `expiresOn` | 1–120 ; dates facultatives ; `expiresOn` alimente les rappels (§ 6.4) |
| `visibleToEmployee` | défaut vrai pour `contract`, `amendment`, `onboarding` ; faux sinon ; un justificatif déposé par le collaborateur lui reste visible |
| fichier | motif d'ADR-0039 § 2.5 : PNG, JPEG, WebP ≤ 2 Mio **assainis** ; PDF ≤ 10 Mio reconnus par `%PDF-`, **non analysés**, servis **en téléchargement inerte** (`Content-Disposition: attachment`, `nosniff`, `Content-Security-Policy: sandbox`) ; autre type : `415 HR_DOCUMENT_TYPE` ; clé `hr-documents/<objectId>` au hasard ; 30 envois par heure et par utilisateur ; borne commune de 1 Gio par organisation |
| chiffrement | les documents **sensibles** sont chiffrés **côté application** avant stockage (enveloppe : clé de données aléatoire par fichier, enveloppée sous `MASTER_KEYRING`, AAD = organisation + collaborateur + document) ; les autres reposent sur le chiffrement du stockage objet |
| `deletedAt` | suppression logique puis effacement de l'objet |

Télécharger un document sensible exige `hr.sensitive.read` (ou être le collaborateur, si
`visibleToEmployee`) et écrit un audit **strict** (`hr.document.downloaded`). Index : `{ organizationId,
employeeId, category }` ; `{ organizationId, expiresOn }` (partiel).

#### 2.9 `hr_checklist_templates` et `hr_checklists`

- **Modèle** : `kind: 'onboarding' | 'offboarding'`, `label`, 1 à 50 éléments `{ id, label (1–200),
  assignee: 'hr' | 'manager' | 'employee' | { userId }, offsetDays (−90 à +90, relatif à la date d'entrée
  ou de sortie), note }`. Deux modèles proposés à l'activation (accueil : contrat signé, accès Lalanda,
  matériel remis, présentation à l'équipe ; départ : matériel repris, **accès Lalanda retiré**, documents
  de fin remis), libellés **sans portée légale**.
- **Liste** : instanciée pour un collaborateur à son entrée ou à sa sortie (`POST /hr/employees/:id/
  checklists { templateId }`), éléments copiés avec assigné résolu (`hr` = détenteurs de `hr.manage`
  au choix de l'auteur, `manager` = utilisateur du manager, `employee` = utilisateur du collaborateur ;
  un assigné sans compte : `hr`) et échéance = date pivot + `offsetDays`. Élément : `{ …, assigneeUserId,
  dueDate, doneAt, doneBy }`. Index : `{ organizationId, 'items.assigneeUserId', 'items.doneAt' }`.
- L'élément « Accès Lalanda retiré » **n'agit pas** : il ouvre la page du membre ; retirer l'accès reste
  un geste d'`organization.manage` (décision ouverte n° 13).

### 3. Contrat HTTP

Tous les contrôleurs : `@UseGuards(AuthGuard, PermissionsGuard)`, `@RequirePermission(…)` par route ;
corps `.strict()` ; erreurs au format des contrôleurs des achats ; listes paginées par curseur
(`time-cursor.ts`). Module API `apps/api/src/hr/` (`HrModule`), web `/rh`. Les routes **relationnelles**
(manager, soi-même) portent `analytics.read` (socle) au guard et la décision de portée dans le service,
par la fonction pure `hrViewerScope` (§ 4.4), comme la cloche d'ADR-0039.

#### 3.1 Collaborateurs, services, organigramme

| Méthode et chemin | Permission | Effet |
|---|---|---|
| `GET /hr/employees?q=&status=&departmentId=&managerId=&cursor=` | `hr.read` | liste (aucune donnée sensible) |
| `GET /hr/employees/:id` | `hr.read`, ou manager (équipe), ou soi | fiche ; sections masquées (§ 2.4) seulement avec `hr.sensitive.read` ou pour soi |
| `POST /hr/employees` · `PUT …/:id` | `hr.manage` | dossier |
| `POST /hr/employees/from-members` `{ userIds[] }` | `hr.manage` | crée une fiche par membre choisi (nom tiré du compte, poste à compléter) ; aucune fiche automatique |
| `POST …/:id/exit` `{ endDate, exitCategory, expectedRevision }` | `hr.manage` | sortie ; demandes futures approuvées annulées (`taken_reversal`) ; propose la liste de départ |
| `POST …/:id/reinstate` | `hr.manage` | annule une sortie dont `endDate` est future |
| `POST …/:id/anonymize` `{ confirm: true }` | `hr.manage` + `hr.sensitive.read` | collaborateur `exited` seulement ; noms remplacés (« Ancien collaborateur n° N »), données sensibles et documents sensibles effacés, `userId` délié ; demandes et grand livre conservés pour les rapports ; audit strict ; irréversible |
| `GET`/`PUT /hr/employees/:id/private…` · `POST …/private/reveal` | § 2.4 | données sensibles |
| `GET /hr/departments` · `POST` · `PUT …/:id` · `…/archive` | `hr.read` · `hr.manage` | services |
| `GET /hr/org-chart?view=departments\|reporting` | `hr.read`, ou tout membre relié à une fiche si `orgChartVisibility = members` | arbre : nom d'usage, poste, service, manager — rien d'autre |
| `GET /hr/me` | `analytics.read` | ma fiche (si reliée), mes soldes, mes demandes, mes documents visibles, mes éléments de liste, `isManager`, `canApprove` |
| `GET /hr/team` | `analytics.read` (manager) | mon équipe (directs et indirects) : fiches réduites, absences, soldes |

#### 3.2 Absences et congés

| Méthode et chemin | Permission | Effet |
|---|---|---|
| `GET /hr/leave-types` · `POST` · `PUT …/:id` · `…/archive` | `analytics.read` (lecture : nom, unité, confidentialité) · `hr.manage` | types |
| `GET /hr/holidays?year=` · `POST` · `DELETE …/:id` | `analytics.read` · `hr.manage` | jours fériés |
| `POST /hr/leave-requests` | `leave.request` (pour soi) ; `hr.manage` (pour un autre) | `days` calculé, chevauchement, solde ; notifie l'étape 1 |
| `GET /hr/leave-requests?employeeId=&status=&from=&to=&cursor=` | `leave.request` (siennes) ; manager (équipe) ; `hr.read` (toutes) | type et motif masqués selon § 2.5 |
| `POST …/:id/approve` `{ comment?, expectedRevision }` · `…/reject` `{ comment }` | manager de l'étape, ou `leave.approve` | § 4.3 ; à la dernière approbation : `taken` au grand livre |
| `POST …/:id/cancel` `{ reason? }` | le demandeur (§ 2.7), ou `hr.manage` | `taken_reversal` si approuvée |
| `GET /hr/leave-approvals/pending` | `analytics.read` | demandes que l'appelant peut traiter (jamais les siennes, sauf approbateur unique) |
| `GET /hr/leave-balances?employeeId=&asOf=` | soi ; manager ; `hr.read` | soldes par type (moteur) |
| `GET /hr/leave-ledger?employeeId=&typeId=` | soi ; `hr.read` | mouvements |
| `POST /hr/leave-ledger` `{ employeeId, typeId, kind: 'allocation' \| 'adjustment', days, effectiveOn, note }` | `hr.manage` | audit `hr.leave_balance.adjusted` |
| `GET /hr/calendar?from=&to=&scope=me\|team\|department\|organization` | `analytics.read` ; portée bornée par `teamCalendarVisibility` et `hrViewerScope` | absences approuvées (et en attente pour soi, son équipe, les RH) ; « Absent » pour les types confidentiels hors ayants droit |

#### 3.3 Documents, listes, réglages, rapports

| Méthode et chemin | Permission | Effet |
|---|---|---|
| `GET /hr/employees/:id/documents` | `hr.read` (non sensibles) ; `hr.sensitive.read` (tous) ; soi (`visibleToEmployee`) | liste sans contenu |
| `POST /hr/employees/:id/documents` | `hr.manage` (+ `hr.sensitive.read` si sensible) ; soi pour `leave_justification` | § 2.8 |
| `GET /hr/documents/:id/file` · `DELETE /hr/documents/:id` | lecture comme ci-dessus, audit strict si sensible · `hr.manage` | — |
| `GET /hr/checklist-templates` · `POST` · `PUT` · `DELETE` | `hr.read` · `hr.manage` | modèles |
| `POST /hr/employees/:id/checklists` · `GET /hr/checklists?employeeId=` | `hr.manage` · `hr.read` | listes |
| `POST /hr/checklists/:id/items/:itemId/done` · `…/undone` | l'assigné, ou `hr.manage` | coche |
| `GET /hr/deadlines?within=` | `hr.read` | fins d'essai, fins de contrat, documents qui expirent (moteur `hrDeadlines`) |
| `GET /hr/reports?from=&to=&departmentId=` | `hr.read` | effectif, entrées et sorties, absentéisme, ancienneté (§ 7) ; **aucune donnée salariale** |
| `GET /hr/reports/export.csv` | `hr.read` + `report.export` | registre non sensible ; audit `hr.register.exported` |
| `GET /hr/settings` · `PUT` | `hr.read` · `hr.manage` (et `leave.approve` pour changer `approvalFlow` ou `allowSoleApprover` : changer qui valide exige d'être soi-même validateur, motif d'ADR-0044 § 3.7) | § 2.2 |
| `GET /work/timesheets?userId=&week=` | `work.read` (soi) ; `work.manage` ou manager (autrui) | § 6.3 |

Contrôleurs nouveaux à inscrire dans `routes-coverage.test.ts` : `HrEmployeesController`,
`HrPrivateController`, `HrDepartmentsController`, `HrLeaveController`, `HrDocumentsController`,
`HrChecklistsController`, `HrSettingsController`, `HrReportsController`, `WorkTimesheetsController`.

### 4. Permissions (amende ADR-0012, docs/12 ; étend ADR-0041)

#### 4.1 Cinq actions nouvelles (trente-quatrième à trente-huitième, en fin d'`ACTIONS`)

| Action | Libellé (ADR-0041 § 5) | Couvre |
|---|---|---|
| `hr.read` | Consulter les dossiers du personnel | fiches non sensibles de tous, services, organigramme complet, toutes les absences (types confidentiels exclus), documents non sensibles, échéances, rapports |
| `hr.manage` | Gérer les dossiers du personnel | fiches, services, entrées et sorties, documents non sensibles, types d'absence, jours fériés, ajustements de solde, listes, réglages, saisie d'une absence pour autrui |
| `hr.sensitive.read` | Consulter les données sensibles du personnel | salaire, coordonnées bancaires, identité, coordonnées personnelles, documents sensibles, types confidentiels ; avec `hr.manage`, les modifier |
| `leave.request` | Demander une absence | ses propres demandes, soldes, documents et listes |
| `leave.approve` | Valider les absences | étape RH, suppléance du manager, toute demande ; case ⓢ |

| Action | PRO | ADM | DIR | CPT | ANA | CDP | CON | LEC | COM | RH |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| `hr.read` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| `hr.manage` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| `hr.sensitive.read` | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| `leave.request` | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ |
| `leave.approve` | ✓ⓢ | ✗ | ✓ⓢ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ⓢ |

Justifications :

- **`hr.read`, `hr.manage`** : l'**Administrateur** tient l'organisation et ses membres ; tenir le
  registre (poste, service, dates) en est le prolongement, sans les données sensibles. Le **Comptable**,
  l'**Analyste**, le **Lecteur** et le **Commercial** n'ont pas à connaître le dossier de leurs collègues
  (minimisation) ; le **Conseiller**, externe, jamais ; le **Chef de projet** n'a rien (non attribuable).
- **`hr.sensitive.read`** : le moins de personnes possible. Propriétaire, Directeur financier (le salaire
  est un engagement financier) et Responsable RH. **Ni l'Administrateur** (gouvernance technique), **ni
  le Comptable** : la paie étant exclue, il n'a pas besoin des coordonnées bancaires du personnel dans
  Lalanda (décision ouverte n° 3).
- **`leave.request`** à **tout rôle interne**, Lecteur et Commercial compris : demander un congé ne lit
  ni n'écrit aucune donnée de l'organisation, seulement la sienne ; sans fiche reliée, la route rend
  `409 EMPLOYEE_NOT_LINKED` (un membre non salarié n'a rien à demander). Le Conseiller, externe, non.
- **`leave.approve`** : autorité RH. Propriétaire, Directeur financier, Responsable RH, en case ⓢ
  (séparation dynamique, § 4.3). L'**Administrateur** ne valide pas (il n'a pas l'autorité sur le temps
  de travail ; décision ouverte n° 3). Le **manager** n'a besoin d'aucune action : la relation suffit.
- **Plateforme** : `hr.read` et `hr.manage` sous accès délégué pour le **seul super-administrateur**
  (pas le support : données personnelles) ; **`hr.sensitive.read` rejoint `PLATFORM_FORBIDDEN_ACTIONS`**
  (interdit absolu, même sous accès délégué : un employé de Lalanda ne lit jamais le salaire ou la pièce
  d'identité du personnel d'un client) ; `leave.request` et `leave.approve` refusées par la matrice.

#### 4.2 Rôle nouveau Responsable RH (O6)

- Slug `hr_manager`, colonne **RH**, libellé « Responsable RH », description « Dossiers du personnel,
  absences et documents RH. Ne voit ni la trésorerie, ni les ventes, ni les achats. », **rang 6**
  (après `sales_rep` ; `project_manager`, `advisor`, `viewer` passent à 7, 8 et 9 — le rang n'est pas
  un droit).
- **Huit actions**, socle compris : `analytics.read`, `hr.read`, `hr.manage`, `hr.sensitive.read`,
  `leave.request`, `leave.approve`, `work.read`, `work.update` ; tout le reste ✗, dont
  `organization.manage`, `members.invite`, `treasury.*`, `sales.*`, `purchase.*`, `crm.*`, `project.*`,
  `report.export`, `audit.read`. (`work.read` et `work.update` : suivre les projets internes et
  saisir son temps, comme tout membre qui travaille.)
- **R7** : seul un acteur dont les droits effectifs contiennent les huit actions l'attribue — le
  **Propriétaire**, nativement. L'Administrateur, qui n'a ni `hr.sensitive.read` ni `leave.approve`,
  **ne peut pas** nommer un Responsable RH : c'est voulu (nommer qui lit les salaires est un acte du
  Propriétaire).
- Avant d'attribuer `hr_manager`, toutes les instances de l'API doivent être à jour (consigne de
  déploiement de `sales_rep`, docs/12). Aucune migration.
- Matrice : **10 × 38 + 6 × 38 = 608** cases.

#### 4.3 Séparation des tâches des absences

Fonction pure **`leaveApprovalDecision`** dans `permissions.ts` (motif de `purchaseApprovalDecision`,
aucun `if (role === …)`), entrée : `{ decision, approverUserId, beneficiaryUserId | null, step,
isDesignatedManager, holdsLeaveApprove, priorApproverUserIds, approverCountInOrg, allowSoleApprover }`.

- **On ne valide pas sa propre absence** (`409 SELF_APPROVAL_FORBIDDEN`), à aucune étape, ni comme
  manager ni comme RH. Le créateur d'une demande saisie pour autrui peut la valider (il n'en est pas
  bénéficiaire).
- **Étape `manager`** : l'utilisateur relié au `managerEmployeeId` du collaborateur, **ou** un détenteur
  effectif de `leave.approve` en suppléance (`onBehalfOfManager: true`, journalisé). Sinon
  `403 LEAVE_NOT_YOUR_STEP`.
- **Étape `hr`** : un détenteur effectif de `leave.approve`, **distinct** de celui qui a validé l'étape
  manager (`409 APPROVER_ALREADY_APPROVED`) — deux étapes, deux personnes.
- **Approbateur unique** : si `allowSoleApprover` et que l'organisation compte **un seul** détenteur
  effectif de `leave.approve` (`countApprovers(org, 'leave.approve')`), il valide sa propre absence et
  une étape RH qu'il a déjà tenue comme manager ; la décision porte `soleApprover: true` et l'écran le
  dit (la dirigeante seule de sa PME pose ses congés).
- Un refus, à n'importe quelle étape, clôt la demande (commentaire obligatoire).
- `leave.approve` rejoint **`APPROVAL_ACTIONS`** (cases ⓢ).

#### 4.4 Portée relationnelle : soi, équipe, service

`hrViewerScope({ viewerUserId, employees, effectiveActions, settings })` — fonction pure du moteur RH
(elle ne lit aucun rôle) : rend `selfEmployeeId`, `directReportIds`, `teamEmployeeIds` (subordonnés
directs et indirects, profondeur ≤ 10), `departmentEmployeeIds`, et les drapeaux `seesAll`
(`hr.read`), `seesConfidential` (`hr.sensitive.read`). Le service ne sert **que** ce que la portée
autorise ; un collaborateur hors portée rend **404** (pas 403 : on ne confirme pas l'existence).

#### 4.5 Compatibilité avec ADR-0041

- **Dépendances** : `hr.manage` → `hr.read` ; `hr.sensitive.read` → `hr.read` ; `leave.approve` →
  `hr.read` ; `leave.request` → socle seulement. Chaque ligne de la matrice du § 4.1 les satisfait (test).
- **Domaine** : neuvième domaine **« Ressources humaines »**, cinq actions, libellés du § 4.1.
- **Paires incompatibles par ajout** : aucune nouvelle. La séparation utile (ne pas valider sa propre
  absence) est **dynamique** (§ 4.3) ; une paire statique `hr.manage` + `leave.approve` empêcherait le
  Responsable RH d'exister.
- **Non délégable** : rien de nouveau. Ajouter `hr.sensitive.read` à un membre reste possible par écart
  (R7 : seul qui la détient l'accorde), journalisé `member.permissions_changed` comme tout écart.
- **Destinataires** (validateurs, RH, porteurs de `hr.sensitive.read`) : par `holdersOf` (droits
  effectifs), jamais par `role: { $in: … }` (ADR-0041 § 9.4).

### 5. Absences : règles de calcul (moteur), sans règle légale

- **Jours décomptés** (`leaveDays`) : pour chaque jour civil de `start` à `end`, la fraction travaillée
  du `workPattern` du collaborateur (ou de l'organisation), moins les jours fériés de l'organisation
  (demi-journée comprise), bornée par les demi-journées de début et de fin. Calcul exact en centièmes.
- **Solde** (`leaveBalance`) : somme du grand livre jusqu'à `asOf` ; « disponible » = acquis + attribué
  + ajusté + reporté − expiré − pris − **en attente** (une demande en attente réserve ses jours).
- **Acquisition** (`accrualsDue`) : selon le type (ou l'exception du collaborateur), pour chaque période
  close depuis la dernière écrite ; prorata `calendar_days` = jours civils d'activité (entre `startDate`
  et `endDate`) ÷ jours civils de la période ; arrondi au centième, demi vers le haut.
- **Report et expiration** (`carryOverOf`) au début de l'année de congé : reporté = min(disponible,
  `maxDays`) ; expiration du reporté non pris après `expiresAfterMonths`.
- Toute valeur chiffrée (jours acquis par mois, plafonds) vient du **paramétrage** de l'organisation ;
  Lalanda n'en fixe **aucune** (décision ouverte n° 7).

### 6. Liens avec les modules existants

#### 6.1 « Mes tâches », cloche, calendrier (ADR-0039, ADR-0040 § 5)

- Port **`HR_AGENDA_SOURCE`** (`work/my-tasks.ports.ts`), agrégation **à la lecture**, motif exact de
  `PURCHASES_AGENDA_SOURCE` ; fournisseur réel `hr/agenda/hr-agenda.source.ts`. Deux natures
  d'éléments `source: 'hr'` :
  - `kind: 'leave_approval'` — demande que l'appelant peut traiter : `{ id: 'hr:leave:<id>',
    employeeName, typeLabel (ou « Absence » si confidentiel), start, end, days, href }` ; pas de case à
    cocher (valider est une décision) ;
  - `kind: 'checklist_item'` — élément de liste assigné à l'appelant : `{ id: 'hr:item:<checklistId>:
    <itemId>', label, employeeName, dueDate, href }`, cochable (route du § 3.3).
  Au plus 200 éléments, `truncated` signalé.
- **Calendrier** (`/projets/mes-taches/calendrier`) : ajoute mes absences et celles de ma portée
  (`GET /hr/calendar?scope=team`) en bandeaux d'une journée, forme et libellé distincts des tâches.
- **Notifications** (`NOTIFICATION_KINDS`, module `hr`, entités `leave_request`, `employee`,
  `hr_document`, `hr_checklist`), refiltrées à la lecture par `analytics.read` (destinataire choisi par
  relation ou par droits effectifs à l'émission) ; **aucune ne porte un type confidentiel, un montant ni
  un numéro** :

| Type | Déclencheur | Destinataires |
|---|---|---|
| `hr.leave_requested` | soumission, passage à l'étape suivante | validateurs de l'étape (manager ; ou détenteurs effectifs de `leave.approve`, sauf le bénéficiaire) |
| `hr.leave_approved` · `hr.leave_rejected` | décision finale | le bénéficiaire (et le créateur s'il diffère) ; le manager, informé, pour un type confidentiel |
| `hr.leave_cancelled` | annulation d'une demande approuvée | le manager et les validateurs |
| `hr.probation_ending` · `hr.contract_ending` · `hr.document_expiring` | tâche `hr.reminders` (une fois par échéance, `dedupeKey`) | détenteurs effectifs de `hr.manage` et le manager (fin d'essai, fin de contrat) |
| `hr.checklist_item_assigned` | instanciation d'une liste | l'assigné |
| `hr.bank_details_changed` | § 2.4 | le collaborateur relié, détenteurs de `hr.sensitive.read` sauf l'auteur |

#### 6.2 Projets : absences des assignés (informatif)

- Port **`WORK_ABSENCES_SOURCE`** (lecture seule de `hr_leave_requests` approuvées, par `userId`),
  fournisseur nul par défaut. Sur un projet et une tâche, un assigné absent porte un badge « Absent du …
  au … » — **jamais le type** ; une tâche dont l'échéance tombe pendant l'absence de son assigné lève le
  constat `ASSIGNEE_ABSENT_ON_DUE_DATE` (vue de projet et « Mes tâches » du créateur). Rien n'est
  déplacé ni réassigné seul. Visible par tout détenteur de `work.read` : c'est le fait « absent », que
  l'équipe d'un projet voit de toute façon (décision ouverte n° 8).
- Aucune « capacité » n'est calculée en R4 (ADR-0039 l'a mise hors périmètre) ; le moteur expose
  `availabilityOf(userId, from, to)` (jours travaillés − absences − fériés) pour un futur plan de charge.

#### 6.3 Feuille de temps (O5) et marge (ADR-0039 § 5)

- `GET /work/timesheets` rend, par semaine, la grille **jour × projet** des `work_time_entries` existants,
  les jours d'absence approuvée et les jours fériés, et deux constats : `TIME_ON_LEAVE_DAY` (temps saisi
  un jour d'absence pleine), `NO_TIME_ON_WORKING_DAY` (jour travaillé sans saisie, information). Calcul :
  moteur `weeklyTimesheet`. **Aucune saisie, aucune validation, aucun verrou nouveaux.**
- **Double comptage salaire + temps** : la marge d'un projet soustrait déjà le coût du temps
  (`work_member_rates`) **et** les dépenses rattachées au projet. Si l'utilisateur rattache aussi un
  salaire (catégorie `personnel`) au projet, la même personne est comptée deux fois. Règle : **rien
  n'est retranché automatiquement** ; `computeProjectMargin` lève le constat
  **`PERSONNEL_EXPENSES_AND_TIME_COST`** (dépenses `personnel` et coût du temps sur le même projet et la
  même devise) — `WORK_MARGIN_VERSION` **1.2.0**, sorties existantes inchangées ; le formulaire de dépense
  le rappelle quand on choisit `personnel` avec un projet.
- Le salaire de base (§ 2.4) **n'alimente pas** `work_member_rates` : un taux horaire déduit d'un salaire
  révélerait le salaire à quiconque lit la marge détaillée (décision ouverte n° 10).

#### 6.4 Rappels d'échéance

Tâche quotidienne **`hr.reminders`** (ordonnanceur ADR-0020, motif de `purchases.due-reminders`) :
fins de période d'essai, fins de contrat (`contractEndDate`), documents (`expiresOn`) et pièces
d'identité (`idExpiries`, en clair sans numéro) à `reminders.*` jours ; une notification par échéance
(`dedupeKey` = organisation + collaborateur + nature + date). Elle ne déchiffre rien. Tâche
**`hr.leave-accruals`** (§ 2.7) et, si `retention` est réglé, **`hr.retention`** (purge des sections
sensibles, anonymisation ; audit strict ; désactivée par défaut).

#### 6.5 Brief du matin (ADR-0033)

- Port **`HR_SOURCE`** (`morning-brief.ports.ts`), fournisseur réel `hr/brief/hr-brief.source.ts`, nul par
  défaut. Faits (`MORNING_BRIEF_VERSION` **1.4.0**), **des nombres seulement**, jamais de nom, de type
  confidentiel ni de montant :
  - `rh.absents_aujourdhui` — personnes absentes aujourd'hui **dans la portée** de l'appelant (équipe
    pour un manager, organisation pour `hr.read`) ; `hidden` sans portée ;
  - `mes_validations_absence.en_attente` — demandes que l'appelant peut traiter ;
  - `rh.echeances` — échéances RH sous `reminders.*` jours (`hr.read`, sinon `hidden`).
- **R13 `absences_du_jour`** (rang 13, `info`) : `rh.absents_aujourdhui` > 0 ; « N personnes de votre
  équipe sont absentes aujourd'hui » ; `actionPath: '/rh/calendrier'`.
  **R14 `validations_absence_en_attente`** (rang 14, `attention`) : > 0 ; « N demandes d'absence attendent
  votre validation » ; `actionPath: '/rh/absences?vue=a-valider'`.
  **R15 `echeances_rh_proches`** (rang 15, `attention`) : > 0 ; « N échéances RH dans les prochains
  jours (fin d'essai, fin de contrat, document) » ; `actionPath: '/rh/echeances'`.
- L'IA du brief les **explique** sans les produire ; elle ne reçoit que ces nombres. E-mail quotidien :
  mêmes faits, même garde.

#### 6.6 Membres de l'organisation

La page des membres (`/organisation/membres`) affiche, pour un membre relié, un lien « Dossier
collaborateur » (si `hr.read`) ; la page d'un collaborateur sans compte propose « Inviter à Lalanda »
(préremplit l'invitation, `members.invite`) — l'invitation reste celle d'ADR-0041, rien n'est créé seul.
La sortie d'un collaborateur **ne retire pas** son accès (décision ouverte n° 13) : elle le propose.

#### 6.7 Trésorerie, GROW, IA

- **Aucune** écriture en trésorerie, au réalisé ou au plan. Les salaires payés restent des dépenses
  saisies (`personnel`, ADR-0034).
- GROW : rien en R4 (un indicateur d'effectif pour les investisseurs exigerait une définition sourcée).
- **IA** : aucune donnée RH nominative n'est servie à OpenAI ; les contextes IA restent figés par
  `ai-contexts.audit.test.ts`, étendu pour prouver qu'aucun champ `hr_*` n'y figure.

### 7. Moteur (`packages/engine/src/hr/`)

`HR_VERSION = '1.0.0'`, fonctions pures, jour de référence en paramètre, `bigint` en centièmes de jour,
chaque résultat porte `{ version }`.

| Fonction | Rôle |
|---|---|
| `leaveDays(start, end, workPattern, holidays)` | § 5, demi-journées, fériés |
| `leaveBalance(ledger, pending, asOf)` | acquis, pris, à venir, en attente, disponible, par type |
| `accrualsDue(type, employee, lastPeriod, asOf)` | périodes et jours à créditer, prorata |
| `carryOverOf(balance, type, leaveYear)` | reporté, expiré |
| `leaveApprovalSteps(settings, type, employee)` | étapes figées à la soumission (§ 2.7) |
| `reportingCycle(employees, employeeId, managerId)` · `departmentCycle(...)` | refus des cycles |
| `orgChart(departments, employees, view)` | arbres, effectifs par nœud |
| `hrViewerScope(...)` | § 4.4 |
| `headcount(employees, asOf, groupBy)` | effectif actif par service, type de contrat |
| `movements(employees, from, to)` | entrées, sorties par catégorie, **taux de sortie** = sorties ÷ effectif moyen de la période (indicateur Lalanda, défini ici, pas une norme) |
| `absenteeism(requests, types, employees, holidays, from, to)` | jours d'absence (types `countsAsAbsenteeism`) ÷ jours travaillés théoriques, par service ; jamais par personne dans un rapport partagé |
| `seniority(employees, asOf)` | ancienneté par tranches (< 1 an, 1–3, 3–5, 5–10, > 10) |
| `hrDeadlines(employees, documents, idExpiries, today, horizons)` | § 6.4 |
| `availabilityOf(workPattern, absences, holidays, from, to)` | § 6.2 |
| `weeklyTimesheet(entries, absences, holidays, workPattern, week)` | § 6.3 |

Modifiés : `engine/src/work/margin.ts` (constat `PERSONNEL_EXPENSES_AND_TIME_COST`, 1.2.0),
`engine/src/morning-brief/**` (1.4.0, R13 à R15). Rien n'écrit dans `actual_periods`, un plan ou un
scénario.

### 8. Interface (web)

Application RUN **Ressources humaines** (`/rh`, icône `rh`), dans `nav-model.ts` **juste après
Projets** (le travail, puis les personnes), visible avec `leave.request` **ou** `hr.read` :

| Sous-option | Route | Condition |
|---|---|---|
| Mon espace (défaut sans `hr.read`) | `/rh/moi` : ma fiche, mes soldes, demander une absence, mes demandes, mes documents, mes éléments de liste | `leave.request` |
| Mon équipe | `/rh/equipe` : fiches réduites, absences, soldes, à valider | `GET /hr/me` → `isManager` |
| À valider | `/rh/absences?vue=a-valider` | `canApprove` (manager ou `leave.approve`) |
| Calendrier | `/rh/calendrier` (mois, semaine ; filtres service, équipe) | `leave.request` |
| Collaborateurs (défaut avec `hr.read`) | `/rh/collaborateurs`, fiche `/rh/collaborateurs/[id]` (onglets : dossier, données sensibles, absences et soldes, documents, entrées et sorties, historique) | `hr.read` |
| Organigramme | `/rh/organigramme` (services, ligne hiérarchique) | § 3.1 |
| Échéances | `/rh/echeances` | `hr.read` |
| Rapports | `/rh/rapports` | `hr.read` |
| Réglages | `/rh/reglages` (types d'absence, jours fériés, types de contrat, circuit, modèles de listes, rappels, conservation) | `hr.read` (écriture : § 3.3) |

- **Données sensibles** : onglet visible avec `hr.sensitive.read` (ou pour soi), formes masquées ;
  « Afficher » demande une confirmation et dit que l'affichage est **journalisé** ; le clair disparaît
  au changement d'onglet ou après 60 secondes ; jamais mis en cache côté client.
- Types confidentiels : « Absent » partout hors ayants droit, sans couleur distinctive qui trahirait le
  type.
- Durées en jours avec virgule décimale (« 2,5 jours »), telles que rendues par l'API ; l'écran
  n'additionne rien.
- Projets : badge « Absent » sur les assignés (§ 6.2) ; « Mes tâches » : éléments « Validation
  d'absence » et « Liste d'accueil / de départ » (forme et libellé, pas seulement une couleur).
- Accessibilité et composants : ADR-0030.

### 9. Droit du travail et données personnelles : ce que cet ADR n'invente pas

| Sujet | Ce que fait Lalanda en R4 |
|---|---|
| Droit annuel à congé, acquisition mensuelle, congés d'ancienneté, congés spéciaux (mariage, naissance, décès) | **aucun** droit posé ; types et acquisitions **paramétrés** par l'organisation ; défaut `accrual: none` (décision ouverte n° 7) |
| Durée de la période d'essai, du préavis, d'un CDD, renouvellements | **saisies**, jamais calculées ni contrôlées ; seules la cohérence des dates et les rappels sont assurés |
| Jours fériés légaux de la RDC | liste vide, saisie par l'organisation ; publication par Country Pack sourcé (décision ouverte n° 12) |
| Durée hebdomadaire du travail, heures supplémentaires | hors R4 ; `workPattern` sert au seul décompte des absences |
| Arrêt maladie, certificat médical, régime de maintien de salaire | type confidentiel et pièce justificative **conservée** ; aucun effet calculé |
| Durée de conservation des dossiers et pièces après la sortie | **non fixée** ; réglage `retention` vide par défaut ; purge manuelle (`anonymize`) ; à trancher avec le juriste (docs/28 § 1.3, questions 3 et 6 ; décision ouverte n° 14) |
| Registre de traitement, information des salariés, base légale | à compléter par le lot H2 dans docs/17 § Confidentialité et docs/28 (finalité « gestion du personnel », catégories, destinataires, durée à fixer) ; l'organisation cliente reste responsable de son traitement, Go freelance SARLU sous-traitant (qualification au juriste) |

## Hors périmètre (R4), dit explicitement

- **Paie** : bulletins, calcul du brut au net, primes, heures supplémentaires, avances et prêts au
  personnel, virements de salaire, écritures de paie. **Cotisations et impôts** : **CNSS**, **IPR**,
  **INPP**, **ONEM**, et toute autre retenue ou contribution. **Déclarations sociales et fiscales** du
  personnel. Le salaire de base est une **donnée déclarée et conservée**, jamais un calcul.
- **Recrutement** (offres, candidats, entretiens, intégration du candidat retenu) : **lot futur
  proposé (R4bis)**, accroché à `hr_employees` (un candidat retenu devient une fiche) et aux listes
  d'accueil.
- **Évaluation annuelle**, objectifs individuels, entretiens professionnels, formation : **lot futur**.
- **Notes de frais** (renvoyées à R4 par ADR-0044) : **reportées** à un lot qui les branchera sur les
  dépenses de la trésorerie et l'approbation (motif d'ADR-0044) ; elles touchent l'argent, pas le
  dossier du personnel (décision ouverte n° 15).
- Pointage, badgeuse, géolocalisation, plannings d'équipes postées, feuilles de temps **à valider**
  (décision ouverte n° 10).
- Portail ou application mobile pour les collaborateurs sans compte, signature électronique des
  contrats, lecture automatique (OCR) des pièces.
- Discipline (avertissements, sanctions), médecine du travail, accidents du travail.
- **IA qui agit** : l'IA peut expliquer un fait du brief ; elle ne crée, ne valide, ne refuse ni ne
  modifie rien, et ne reçoit aucune donnée nominative.
- Multi-sociétés, mobilité entre organisations, conversion de devises.

## Conséquences

- Collections nouvelles : `hr_settings`, `hr_departments`, `hr_employees`, `hr_employee_private`,
  `hr_leave_types`, `hr_holidays`, `hr_leave_requests`, `hr_leave_ledger`, `hr_documents`,
  `hr_checklist_templates`, `hr_checklists`. Toutes portent `organizationId`. Aucune migration de
  données (les fiches se créent depuis les membres, à la main).
- RBAC : **dix rôles, trente-huit actions** ; matrice **608** cases ; un domaine, trois dépendances,
  `leave.approve` dans `APPROVAL_ACTIONS`, `hr.sensitive.read` dans `PLATFORM_FORBIDDEN_ACTIONS` ;
  docs/12, ADR-0012, sonde e2e, couverture des routes, types web et rangs alignés.
- Nouvel actif sensible : les données du personnel (chiffrées, `reveal` journalisé, alerte de changement
  bancaire) ; docs/17 complété au lot H2.
- Moteur : `HR_VERSION` 1.0.0 ; `WORK_MARGIN_VERSION` 1.2.0 ; `MORNING_BRIEF_VERSION` 1.4.0.
- `@lalanda/shared` gagne l'entrée `./hr` ; `@lalanda/shared/notifications` neuf types, un module
  (`hr`), quatre natures d'entité.
- Trois tâches d'ordonnanceur : `hr.leave-accruals`, `hr.reminders`, `hr.retention` (éteinte).
- Navigation : une application RUN de plus (`/rh`), ouverte à presque tous les membres (self-service).

## Critères d'acceptation (testables)

1. **Permissions** : un `admin` crée une fiche (`200`) mais `403` sur `POST …/private/reveal` et sur
   `approve` à l'étape RH ; un `accountant` : `403` sur `GET /hr/employees`, `200` sur sa propre demande
   d'absence ; un `viewer` et un `sales_rep` demandent une absence (`200`) ; un `advisor` : `403` partout
   sauf `/hr/me` (vide) ; un `hr_manager` : `200` sur fiches, données sensibles et validation, `403` sur
   `GET /treasury/expenses`, `GET /purchases/orders`, `GET /sales/invoices`. Matrice 608 cases et sonde
   e2e vertes.
2. **R7** : un `admin` qui tente d'inviter un `hr_manager` : `403` ; le Propriétaire : `200`.
3. **Plateforme** : le super-administrateur sous accès délégué lit `GET /hr/employees` mais reçoit `403`
   sur `reveal` (interdit absolu) ; le support : `403` sur `GET /hr/employees`.
4. **Lien membre** : une fiche sans `userId` est valide ; relier deux fiches au même compte : `409
   EMPLOYEE_USER_ALREADY_LINKED` ; relier un compte d'une autre organisation : `404`.
5. **Hiérarchie** : A manager de B, B manager de C ; faire de C le manager de A : `409 MANAGER_CYCLE` ;
   A voit B et C dans `/hr/team`, C ne voit ni A ni B en fiche (`404`), mais les voit dans l'organigramme
   (nom, poste) si `orgChartVisibility = members`.
6. **Chiffrement** : après écriture d'un IBAN et d'un numéro de passeport, ni l'un ni l'autre
   n'apparaît dans le document Mongo, les réponses de liste et de fiche, `audit_events`, les notifications
   ni le brief (test anti-fuite, motif de `no-secret-leak.test.ts`) ; un chiffré recopié vers une autre
   fiche ne se déchiffre pas ; `reveal` écrit `hr.private.revealed` **avant** de répondre (audit en
   échec ⇒ `503`, rien de révélé) ; le 31e `reveal` de l'heure : `429`.
7. **Alerte bancaire** : modifier les coordonnées bancaires de B notifie B et les détenteurs de
   `hr.sensitive.read` sauf l'auteur, et pose le bandeau sept jours.
8. **Décompte** : semaine lundi–vendredi, férié saisi le mercredi, demande du lundi matin au vendredi
   midi → `days = 3,5` ; demande sur un samedi et un dimanche seuls : `422 LEAVE_NO_WORKING_DAY`.
9. **Circuit et séparation** : `manager_only` : B demande, A (manager) valide → `approved`, `taken = −3,5`
   au grand livre ; B ne valide pas sa demande (`409 SELF_APPROVAL_FORBIDDEN`) ; C (non manager de B,
   sans `leave.approve`) : `403 LEAVE_NOT_YOUR_STEP` ; `manager_then_hr` : A valide, puis A ne peut
   valider l'étape RH (`409 APPROVER_ALREADY_APPROVED`), le Responsable RH le peut ; organisation à un
   seul détenteur de `leave.approve` (la Propriétaire, sans manager) : elle valide sa propre absence,
   `soleApprover: true`, audit présent.
10. **Confidentialité** : une absence « Maladie » de B est validée par l'étape RH seule ; A (manager) la
    voit « Absent » au calendrier et dans `/hr/team` ; aucune notification, aucun brief, aucun badge de
    projet ne contient « Maladie ».
11. **Solde** : type « Congés » réglé à 2,00 jours par mois, prorata, B entré le 16 janv. (31 jours) →
    acquisition de janvier = 1,03 (16 ÷ 31 × 2, arrondi au centième, demi vers le haut) ; la tâche rejouée
    n'écrit rien de plus ; une demande de 3 jours avec 2,5 disponibles : `409
    LEAVE_BALANCE_INSUFFICIENT` ; annuler une absence approuvée future rend les jours (`taken_reversal`).
12. **Chevauchement** : deux demandes qui se recouvrent d'une demi-journée : `409 LEAVE_OVERLAP`.
13. **Documents** : un PDF de contrat est servi en `attachment` avec `sandbox` ; une pièce d'identité
    (sensible) est chiffrée dans le stockage (l'objet brut ne contient pas `%PDF-`), son téléchargement
    exige `hr.sensitive.read` et écrit `hr.document.downloaded` ; un `admin` reçoit `403`.
14. **Échéances** : un CDD qui finit dans 30 jours, une fin d'essai dans 15, un passeport qui expire dans
    30 → trois notifications, une seule fois chacune (tâche rejouée deux fois) ; `rh.echeances = 3` et R15.
15. **Listes** : instancier la liste de départ de B crée un élément « Matériel repris » dans « Mes
    tâches » de l'assigné et **dans aucun projet RUN** ; un détenteur de `work.read` ne voit nulle part le
    départ de B.
16. **Brief, Mes tâches, cloche** : deux absents dans l'équipe de A → `rh.absents_aujourdhui = 2` et R13
    pour A ; une demande en attente → R14 pour A et un élément `leave_approval` dans sa liste, absent de
    celle de B ; sans portée, faits `hidden`.
17. **Projets et temps** : C absent du 3 au 5 ; une tâche de C à échéance le 4 lève
    `ASSIGNEE_ABSENT_ON_DUE_DATE` ; 120 minutes saisies par C le 4 lèvent `TIME_ON_LEAVE_DAY` dans sa
    feuille de temps ; un projet avec du temps valorisé et une dépense `personnel` lève
    `PERSONNEL_EXPENSES_AND_TIME_COST`, **montant de la marge inchangé** par rapport à 1.1.0.
18. **Rapports** : effectif, entrées et sorties, taux de sortie, absentéisme par service, ancienneté par
    tranches, calculés par le moteur ; aucun champ de `hr_employee_private` dans la réponse ni dans le CSV.
19. **Sortie et anonymisation** : la sortie de B annule ses absences futures approuvées et propose la
    liste de départ, sans retirer son accès ; l'anonymisation efface les sections sensibles et documents
    sensibles, délie `userId`, garde les chiffres des rapports ; refusée sur un collaborateur actif.
20. **Isolation** : toute route nouvelle rend `404` pour une ressource d'une autre organisation, y
    compris par `employeeId`, `managerEmployeeId`, `departmentId`, `typeId`, `documentId`, `userId`
    forgés ; un collaborateur hors portée rend `404`.
21. **Aucune règle légale** : à l'activation, aucun type d'absence n'acquiert de jours, aucun férié
    n'existe, aucune durée d'essai ni de conservation n'est appliquée.

## Plan de validation

- **Moteur (vitest)** : `leaveDays` (demi-journées, fériés, temps partiel, changement d'année),
  `leaveBalance`, `accrualsDue` (prorata, entrée et sortie en cours de période, idempotence par période),
  `carryOverOf`, `leaveApprovalSteps`, cycles (hiérarchie, services), `orgChart`, `hrViewerScope`,
  `headcount`, `movements`, `absenteeism`, `seniority`, `hrDeadlines`, `weeklyTimesheet`,
  `availabilityOf` ; `computeProjectMargin` 1.2.0 (sans dépense `personnel` : sorties identiques à 1.1.0) ;
  brief 1.4.0 (R13 à R15, rangs uniques).
- **Authz (vitest)** : matrice 608 cases ; dépendances ; neuvième domaine ; `leaveApprovalDecision`
  (table de vérité : soi, manager, suppléance, deux étapes, approbateur unique) ; R7 pour `hr_manager` ;
  `hr.sensitive.read` interdit plateforme.
- **Shared (vitest)** : schémas `@lalanda/shared/hr` (`.strict()`, durées et montants en chaînes, codes) ;
  types de notification.
- **API e2e (Mongo en mémoire)** : `hr-employees.e2e` (fiche, lien membre, cycles, sortie,
  anonymisation, portée), `hr-private.e2e` (chiffrement, `reveal`, audit strict, débit, anti-fuite,
  alerte bancaire), `hr-leave.e2e` (décompte, circuits, séparation, confidentialité, soldes, acquisitions
  rejouées, chevauchement, annulation), `hr-documents.e2e` (inertie PDF, chiffrement des sensibles,
  audit), `hr-checklists.e2e`, `hr-reminders.e2e`, `hr-reports.e2e`, `my-tasks.e2e` et `morning-brief.e2e`
  étendus, `work-margin.e2e` et `work-timesheets.e2e`, `rbac-matrix.e2e` (cinq actions, colonne RH),
  `ai-contexts.audit.test.ts` étendu.
- **Web (vitest, modèles purs)** : `rh/_components/*-model.ts` (durées, masquage des types, portée),
  `nav-model.test.ts` (RH après Projets, visible avec `leave.request`), `routes.test.ts` (`/rh` protégé),
  `calendar-model.ts` (bandeaux d'absence), `mes-taches-model.ts` (éléments `hr`).
- **Essai de la dirigeante** : activer les RH ; créer deux services et quatre fiches (dont un chauffeur
  sans compte et elle-même) ; nommer une Responsable RH ; régler « Congés » à la valeur qu'elle choisit ;
  saisir un férié ; demander une absence comme Analyste, la voir dans « Mes tâches » de son manager, la
  valider ; constater la baisse du solde, le badge sur un projet et R13 le jour même ; déposer un contrat
  et une pièce d'identité ; afficher un IBAN et relire l'audit ; lancer la liste de départ d'un
  collaborateur fictif, puis l'anonymiser.

## Découpage en lots parallélisables (worktrees séparés)

Règle d'ADR-0011 et d'ADR-0012 § 9 : **un fichier = un seul écrivain** par lot ; les fichiers partagés ne
reçoivent que des **ajouts** d'une ligne ou d'un bloc, chacun dans sa zone, sous un commentaire
`// ADR-0045 — <lot>`.

| Lot | Contenu | Fichiers possédés (probables) | Critères | Tests | Dépend de |
|---|---|---|---|---|---|
| **H0 — Socle RBAC et contrats** (petit, en premier) | cinq actions, rôle `hr_manager` (rang, libellés, description), matrice, dépendances, domaine, `APPROVAL_ACTIONS`, `PLATFORM_FORBIDDEN_ACTIONS`, `leaveApprovalDecision` ; contrats partagés ; types de notification | `apps/api/src/authz/permissions.ts`, `permissions.test.ts`, `overrides.test.ts`, `__tests__/rbac-matrix.e2e.test.ts` ; `packages/shared/src/hr/**`, `packages/shared/package.json` (export `./hr`) ; `packages/shared/src/notifications/index.ts` ; `apps/web/src/lib/api.ts` (`OrgAction`, `OrgRole`) ; libellés de rôle web ; `docs/12` (statut « appliqué ») | 1, 2, 3, 9 (fonction pure) | matrice 608 ; dépendances ; table de vérité | — |
| **H1 — Moteur RH** | `packages/engine/src/hr/**` (§ 7, hors marge et brief) | `packages/engine/src/hr/**`, une ligne dans `packages/engine/src/index.ts` | 8, 11, 18, 21 (calculs) | vitest, propriétés à graine fixe | — (parallèle à H0) |
| **H2 — Dossiers, services, organigramme, données sensibles** | `hr_settings` (lecture, valeurs par défaut), `hr_departments`, `hr_employees`, `hr_employee_private` (chiffrement, `reveal`, alerte), `from-members`, sortie, anonymisation, `/hr/me`, `/hr/team`, portée, `HrModule`, rotation `secrets:rewrap` | `apps/api/src/hr/{employees,private,departments,settings,scope}/**`, `hr/hr.module.ts` (crée), `apps/api/src/app.module.ts` (une ligne), `apps/api/src/integrations/rewrap.ts` (un bloc) ; `__tests__/hr-employees.e2e.test.ts`, `hr-private.e2e.test.ts` ; `docs/17`, `docs/28` (registre, questions) | 4, 5, 6, 7, 19, 20 | e2e, anti-fuite | H0, H1 |
| **H3 — Absences et congés** | types, fériés, demandes, circuit, séparation, grand livre, `hr.leave-accruals`, notifications d'absence, calendrier, port `HR_AGENDA_SOURCE` (deux natures d'éléments ; lecteur des éléments de liste en port nul) | `apps/api/src/hr/{leave,holidays,agenda,calendar,accruals}/**`, `hr/hr-notifier.ts` ; `apps/api/src/work/my-tasks.ports.ts` et `work-tasks.service.ts` (**méthode `myTasks` seulement**, ajout d'une source) ; `packages/shared/src/work/views.ts` (élément `hr`) ; `__tests__/hr-leave.e2e.test.ts`, `my-tasks.e2e` étendu | 8 à 12, 16 (Mes tâches) | e2e ; acquisitions rejouées | H0, H1, H2 |
| **H4 — Documents, échéances, entrées et sorties** | `hr_documents` (stockage, chiffrement des sensibles), `hr_checklist_templates`, `hr_checklists`, fournisseur du lecteur d'éléments de liste, `hr.reminders`, `hr.retention` (éteinte), `/hr/deadlines` | `apps/api/src/hr/{documents,checklists,reminders,retention}/**` ; `__tests__/hr-documents.e2e.test.ts`, `hr-checklists.e2e.test.ts`, `hr-reminders.e2e.test.ts` | 13, 14, 15 | e2e | H2 ; H3 pour l'agenda (port déjà déclaré) |
| **H5 — Liens : brief, projets, temps, rapports** | `HR_SOURCE`, R13 à R15 ; `WORK_ABSENCES_SOURCE`, badge et constat d'échéance ; `GET /work/timesheets` ; constat de marge 1.2.0 ; `/hr/reports` et export CSV | `apps/api/src/hr/{brief,reports,work}/**` ; `apps/api/src/morning-brief/morning-brief.ports.ts`, `morning-brief.module.ts`, `morning-brief.service.ts`, `mail/mail.templates.ts` (bloc du brief) ; `packages/engine/src/morning-brief/**` ; `packages/engine/src/work/margin.ts`, `types.ts` ; `apps/api/src/work/timesheets/**` (nouveau), `work/work-absences.port.ts` (nouveau), `work/work-tasks.service.ts` (**lecture du port d'absences seulement**, après H3) ; `apps/api/src/ai/ai-contexts.audit.test.ts` | 16 (brief), 17, 18 | e2e brief, marge, feuille de temps, rapports | H1, H3, H4 |
| **H6 — Web (1) : self-service et équipe** | navigation, coquille `/rh`, Mon espace, demande d'absence, Mon équipe, À valider, calendrier RH, organigramme, liste et fiche des collaborateurs (dossier non sensible) ; éléments `hr` de « Mes tâches » ; bandeaux d'absence du calendrier des projets ; lien depuis la page des membres | `apps/web/src/app/(app)/rh/**` sauf `rapports/**`, `reglages/**`, `echeances/**`, `collaborateurs/[id]/{sensible,documents,parcours}/**` ; `apps/web/src/lib/api-rh.ts` ; `_components/nav-model.ts` (+ test) ; `apps/web/src/lib/routes.ts` (+ test) ; `projets/_components/mes-taches*.tsx`, `calendar-model.ts`, `calendar-vue.tsx` ; `organisation/membres/_components/members-panel.tsx` (un lien) | écrans § 8 | modèles purs, nav, routes | H0 ; données réelles après H2, H3 |
| **H7 — Web (2) : sensible, documents, parcours, rapports, réglages, temps** | onglets sensibles (révélation), documents, entrées et sorties, échéances, rapports, réglages ; feuille de temps (`/projets/mes-taches/temps`) ; badge « Absent » sur les projets ; rappel `personnel` dans le formulaire de dépense | `apps/web/src/app/(app)/rh/{rapports,reglages,echeances}/**`, `rh/collaborateurs/[id]/{sensible,documents,parcours}/**`, `apps/web/src/lib/api-rh-admin.ts` ; `projets/mes-taches/temps/**` (nouveau) ; `projets/[id]/_components/*assign*` (badge) ; `tresorerie/depenses/_components/**` (un avertissement) | écrans § 8 | modèles purs | H6 (coquille `rh/layout.tsx`) ; H4, H5 |

### Zones de conflit entre lots

| Fichier | Lots | Règle |
|---|---|---|
| `apps/api/src/authz/permissions.ts`, `packages/shared/src/notifications/index.ts`, `apps/web/src/lib/api.ts` | **H0 seul** | aucun autre lot n'y écrit |
| `apps/api/src/hr/hr.module.ts` | H2 crée ; H3, H4, H5 ajoutent une ligne chacun dans `controllers` / `providers` / `forFeature` | sous son commentaire de lot |
| `apps/api/src/app.module.ts`, `integrations/rewrap.ts` | H2 | une ligne, un bloc |
| `apps/api/src/authz/routes-coverage.test.ts` | H2, H3, H4, H5 | un bloc par lot, **à la fin** |
| `apps/api/src/work/my-tasks.ports.ts` | H3 seul | ajout d'un port à côté de celui des achats |
| `apps/api/src/work/work-tasks.service.ts` | H3 (`myTasks` : source RH), puis H5 (lecture du port d'absences pour le constat d'échéance) | **H3 d'abord**, H5 rebasé ; méthodes distinctes, chacune sous son commentaire |
| `packages/engine/src/work/**`, `apps/api/src/morning-brief/**`, `packages/engine/src/morning-brief/**`, `mail/mail.templates.ts` | H5 seul | — |
| `packages/engine/src/index.ts` | H1 (export `./hr`) | une ligne |
| `packages/shared/src/hr/**` | H0 crée ; H2 à H5 **ajoutent** des fichiers, jamais dans ceux d'un autre | `index.ts` : une ligne d'export par lot |
| `apps/web/src/app/(app)/_components/nav-model.ts`, `apps/web/src/lib/routes.ts` | H6 seul | — |
| `apps/web/src/app/(app)/rh/layout.tsx` | H6 crée ; H7 l'utilise sans l'écrire | sous-options demandées à H6 |
| `apps/web/src/app/(app)/projets/_components/mes-taches*`, `calendar-*` | H6 seul | — |
| `docs/12`, `docs/15`, `docs/16`, index des ADR | ce lot de documentation ; chaque lot passe sa ligne « proposé » à « implémenté » | une section par lot |

**Fenêtre avec R3** : les lots P7 et P8 d'ADR-0044 sont fusionnés (`nav-model.ts` porte déjà Achats) ;
H0 ne doit démarrer qu'après la dernière fusion qui touche `permissions.ts`.

### Ordre de fusion conseillé

```
H0 ──┬── H2 ──┬── H3 ──┬── H4 ── H5
H1 ──┘        │        └── H6 (écrans au fil de H2, H3)
              └── H6 (squelette : navigation, coquille, Mon espace en lecture)
H7 après H6, H4, H5.
```

1. **H0** et **H1** en parallèle (H1 ne dépend d'aucun contrat d'API).
2. **H2** ; en parallèle, le squelette de **H6** (navigation, routes, coquille).
3. **H3** ; puis **H4** (l'agenda des listes se branche sur le port posé par H3).
4. **H5** (rebasé sur H3 pour `work-tasks.service.ts`).
5. **H7**.

Chemin critique : H0 → H2 → H3 → H4 → H5. Si H4 glisse, H3 + H5 (sans les échéances) livrent déjà la
chaîne utile « dossier → absence → validation → solde → brief ».

## Décisions ouvertes — elles appartiennent à la dirigeante

Chacune a une **valeur par défaut**, appliquée si rien n'est tranché.

1. **Actions** : cinq actions (`hr.read`, `hr.manage`, `hr.sensitive.read`, `leave.request`,
   `leave.approve`) et la matrice du § 4.1. *Défaut : oui.*
2. **Rôle Responsable RH** (`hr_manager`, O6, § 4.2). *Défaut : oui, rang 6, attribuable par le seul
   Propriétaire.*
3. **Qui voit les données sensibles et qui valide** : Administrateur sans `hr.sensitive.read` ni
   `leave.approve` ; Comptable sans accès RH. *Défaut : oui ; ajouts possibles par écart (ADR-0041).*
4. **Le collaborateur voit ses propres données sensibles en clair** (droit d'accès), avec audit.
   *Défaut : oui ; il ne les modifie pas lui-même (il le demande aux RH).*
5. **Semaine de travail par défaut**. *Défaut : lundi à vendredi, modifiable par organisation et par
   collaborateur.*
6. **Circuit de validation**. *Défaut : manager seul ; étape RH ajoutée par type ; types confidentiels
   validés par les RH seules.*
7. **Droits à congé** : jours acquis par mois ou par an, prorata, report, expiration, types spéciaux.
   *Défaut : aucun droit posé par Lalanda (`accrual: none`) ; l'organisation saisit ses règles ou des
   attributions annuelles. Un modèle « RDC » ne viendra que sourcé (texte, date d'effet) sous un Country
   Pack.*
8. **Visibilité des absences** : calendrier d'équipe par service ; badge « Absent » sur les projets
   pour tout détenteur de `work.read`. *Défaut : oui aux deux, sans jamais le type.*
9. **Organigramme visible par tous les membres reliés** (nom, poste, service, manager). *Défaut : oui.*
10. **Feuilles de temps** : vue hebdomadaire en lecture seulement ; pas de validation ; le salaire
    n'alimente pas le coût horaire. *Défaut : oui ; la feuille à valider est un lot futur.*
11. **Délais de rappel** : fin d'essai 15 jours, fin de contrat 30, document 30. *Défaut : ces valeurs,
    réglables.*
12. **Jours fériés** : liste vide, saisie par l'organisation. *Défaut : oui ; liste RDC publiée seulement
    une fois sourcée.*
13. **Sortie et accès à Lalanda** : la sortie ne retire pas l'accès, elle le propose (élément de liste).
    *Défaut : oui ; retrait automatique à `endDate` possible en lot suivant.*
14. **Conservation des données des anciens salariés** : durée de conservation des sections sensibles,
    des documents et du dossier après la sortie, purge ou anonymisation automatique. *Défaut : aucune
    purge automatique, anonymisation manuelle possible ; durée à fixer avec le juriste (docs/28 § 1.3),
    puis réglée dans `hr_settings.retention`.*
15. **Notes de frais**. *Défaut : hors R4, lot ultérieur branché sur la trésorerie et l'approbation.*
16. **Recrutement et évaluation annuelle**. *Défaut : lots futurs, dans cet ordre.*
17. **Chiffrement applicatif des documents sensibles**. *Défaut : oui pour pièces d'identité,
    certificats médicaux et justificatifs ; non pour contrats et diplômes (chiffrement du stockage).*
18. **Offres** (docs/13) : RH ouvertes à toutes les offres, comme le CRM, les projets et les achats.
    *Défaut : toutes les offres, à arbitrer avec le reste du tableau.*
19. **Libellé de l'application** : « Ressources humaines » (`/rh`), après Projets. *Défaut : oui.*

## Liens

- [ADR-0011](ADR-0011-contrats-integration-s18.md) ; [ADR-0012](ADR-0012-modele-rbac-complet.md)
  (amendé) ; [ADR-0013](ADR-0013-stockage-secrets-integration.md) ;
  [ADR-0018](ADR-0018-trajectoire-erp-trois-modules.md) (refus des RH levé, paie maintenue hors) ;
  [ADR-0020](ADR-0020-ordonnanceur-mongodb.md) ; [ADR-0027](ADR-0027-numerotation-des-factures.md)
  (jour de Kinshasa) ; [ADR-0030](ADR-0030-refonte-ui-ux.md) ; [ADR-0033](ADR-0033-brief-du-matin.md)
  (étendu) ; [ADR-0034](ADR-0034-depenses-et-tresorerie.md) (catégorie `personnel`, inchangée) ;
  [ADR-0039](ADR-0039-projets-et-taches-run.md) (étendu) ; [ADR-0040](ADR-0040-crm-complet.md) ;
  [ADR-0041](ADR-0041-autorisations-par-membre.md) (étendu) ; [ADR-0043](ADR-0043-editeur-go-freelance-sarlu.md)
  (éditeur de droit congolais) ; [ADR-0044](ADR-0044-achats-et-fournisseurs.md) (modèle, chiffrement).
- [docs/09](../09-COUNTRY-PACKS.md) ; [docs/12](../12-ROLES-PERMISSIONS.md) ; [docs/13](../13-PRICING.md) ;
  [docs/15](../15-DATABASE.md) ; [docs/16](../16-API.md) ; [docs/17](../17-SECURITE.md) ;
  [docs/28](../28-CONFORMITE-LEGALE.md).
- Code existant : `apps/api/src/organizations/` (membres, invitations), `apps/api/src/authz/`
  (`permissions.ts`, `authz.service.ts`), `apps/api/src/work/` (`my-tasks.ports.ts`, `work-time.service.ts`,
  `margin/`), `apps/api/src/purchases/suppliers/supplier-payment-crypto.ts`,
  `apps/api/src/morning-brief/`, `packages/engine/src/work/`, `packages/engine/src/morning-brief/`.
- Code à créer : `apps/api/src/hr/`, `packages/engine/src/hr/`, `packages/shared/src/hr/`,
  `apps/web/src/app/(app)/rh/`.
