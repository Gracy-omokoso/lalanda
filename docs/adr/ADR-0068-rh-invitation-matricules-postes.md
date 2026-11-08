# ADR-0068 — RH lot 1 : invitation à la création d'un collaborateur, matricules automatiques, référentiel des postes, import du personnel, jours fériés de la RDC proposés

Statut : **Accepted** (décisions de la dirigeante du 7 nov. 2026)
Date : 2026-11-07
Décideur : Gracy Omokoso (dirigeante de Go freelance SARLU) ; CTO Lalanda (contrat technique).

> **Étend [ADR-0045](ADR-0045-ressources-humaines.md)** : § 2.1 (`employeeNumber` devient attribué
> automatiquement, `positionId` s'ajoute), § 2.6 (des jours fériés peuvent être **proposés**, chacun
> marqué « à vérifier » ; tranche en partie la décision ouverte n° 12), § 6.6 (l'invitation part de la
> fiche), O1 (le lien `userId` reste facultatif et unique par organisation) et **lève** la phrase « pas
> de référentiel des postes en R4 ». **Réutilise sans le modifier** le parcours d'invitation
> d'[ADR-0041](ADR-0041-autorisations-par-membre.md) § 6 (même service, même courriel, même
> revalidation à l'acceptation) et le lecteur de fichiers d'[ADR-0062](ADR-0062-import-projet-fichier.md)
> (`readTable` : `.xlsx` sans formule ni macro, `.csv` `;`/`,` avec BOM). Reprend le motif des
> compteurs `hr_counters` d'[ADR-0051](ADR-0051-rh-frais-avances-presences-evaluations.md) § 1.
> **Aucune action ajoutée** à `authz/permissions.ts` : la matrice est inchangée.

## Contexte

Go freelance commence à utiliser Lalanda le lundi 9 novembre 2026. Il lui faut : enregistrer son
personnel existant (classeur), donner un compte Lalanda à ceux qui travaillent dans l'outil, numéroter
les personnes **et** les postes comme le font les services du personnel en RDC (un poste « pourvu
poste pour poste » garde son numéro, la personne reçoit un nouveau matricule), et partir d'un
calendrier des jours fériés. ADR-0045 laissait le matricule libre, sans référentiel des postes, et la
liste des fériés vide faute de source.

## Décision

### 1. Créer un collaborateur, c'est l'inviter sur Lalanda

- La fiche (création et modification) porte une case **« Inviter sur Lalanda »**, **cochée par défaut
  dès qu'un e-mail professionnel est saisi**. Côté API, le corps porte `invite: boolean` (absent =
  `false`, compatibilité des clients existants).
- Avec `invite: true` et un `workEmail` :
  - **(a)** l'e-mail est celui d'un **compte membre de cette organisation** → la fiche est **reliée
    immédiatement** (`userId`), aucune invitation. Si ce compte est déjà relié à une autre fiche, rien
    n'est relié et la réponse le dit (`member_already_linked`) ;
  - **(b)** sinon → l'**invitation existante** (ADR-0041 : `InvitationsService.create`, même gabarit
    de courriel, même jeton, 7 jours) est créée avec une référence **`employeeId`**. **À
    l'acceptation**, le compte qui accepte est relié à la fiche, dans l'organisation de l'invitation
    seulement, si la fiche n'est reliée à personne et n'est pas anonymisée ; l'unicité
    `{ organizationId, userId }` est respectée (déjà relié ailleurs → aucun lien, journal).
- **Consentement et non-énumération.** Un compte Lalanda d'une **autre** organisation n'est **jamais**
  relié sans qu'il accepte l'invitation (l'acceptation exige la session de l'adresse invitée). Dans le
  cas (b), la réponse est **identique** que l'adresse ait un compte ailleurs ou non
  (`invitation_sent`) : rien ne révèle l'existence d'un compte hors de l'organisation.
- **Rôle donné à l'acceptation : Salarié (`employee`)**, `DEFAULT_INVITATION_ROLE` d'ADR-0059 § 4.
  Raison : c'est le rôle le plus bas utilisable par le personnel (projets, tâches, libre-service RH,
  six actions, **aucun accès financier**). Le Stagiaire (`intern`) est aussi bas mais réservé aux
  stagiaires (il n'assigne qu'à lui-même, ADR-0066 § 2) ; l'Invité externe (`guest`) est borné à des
  projets et ne convient pas à un salarié. Le rôle se change ensuite dans `/organisation/membres`.
- **Permissions.** Il faut **`members.invite` en plus de `hr.manage`**. Sans `members.invite`
  (Responsable RH par défaut), la fiche est créée, **rien n'est envoyé**, la réponse vaut
  `not_sent_permission` et l'écran le dit (« Un administrateur pourra l'inviter depuis la fiche »).
  Le cas (a) ne crée pas d'accès : il relie un membre existant ; il reste toutefois soumis à
  `members.invite`, pour que « Inviter sur Lalanda » ait un seul sens côté droits.
- **État affiché sur la fiche** (`GET /hr/employees/:id/account`, `hr.read`) : **relié** (compte
  membre), **invitation en attente** (adresse, échéance ; **Renvoyer** = révoquer puis réémettre,
  **Annuler** = révoquer ; `hr.manage` + `members.invite`), **invitation expirée** (Renvoyer), **sans
  compte** (bouton « Inviter sur Lalanda »).
- **Courriel en test** : `MailService` passe par le transport, qui n'envoie rien sans
  `ZEPTOMAIL_TOKEN` ni `SMTP_HOST` (`delivered: false`) ; les suites e2e n'en posent aucun. Le jeton
  n'est pas renvoyé par les routes RH (le lien reste dans le courriel ; la page des membres garde le
  lien copiable d'ADR-0041).

### 2. Matricule automatique, jamais réutilisé

- **Réglage d'organisation** dans `hr_settings.employeeNumbering` : `prefix` (défaut **dérivé du nom**
  de l'organisation par le moteur : initiales des mots significatifs, « Go freelance » → `GF-`, un
  seul mot → trois premières lettres ; repli `MAT-`) et `width` (défaut **4**, de 3 à 8) → `GF-0001`.
  Modifiable par `hr.manage` (`PUT /hr/settings/numbering`, révision propre, audit).
- **Compteur** : nouveau `kind: 'EMP'` dans **`hr_counters`**, `year: 0` (non annuel). Choix : la
  collection existe, son index unique `{ organizationId, kind, year }` et la montée atomique
  (`findOneAndUpdate` + `$inc`, upsert) sont déjà éprouvés par les notes de frais ; une collection
  dédiée n'apporterait rien. Le compteur ne connaît **que `$inc` et `$max`** : jamais décrémenté.
  L'attribution se fait **hors transaction** : un échec après tirage laisse un trou, jamais un doublon
  (trous admis, comme `NF…`).
- **Jamais réutilisé**, y compris après sortie ou anonymisation : l'anonymisation **efface le matricule
  affiché** (`employeeNumber: null`) mais **garde sa réservation** (`employeeNumberKey`, index unique
  partiel) ; le numéro ne peut donc plus être saisi ni attribué. À revoir avec le juriste : la clé
  conservée reste un identifiant en base (pseudonyme), jamais servi par l'API.
- **Saisie manuelle permise** (reprise de l'existant) : à la création et à l'import. Un numéro
  **compatible avec le format courant** (préfixe puis chiffres, comparé sans tirets ni espaces) pousse
  le compteur **au-dessus** (`$max`) ; un changement de préfixe recale le compteur sur le plus grand
  numéro compatible existant. Un numéro tiré qui serait déjà porté est sauté.
- **Non modifiable ensuite.** `PUT /hr/employees/:id` refuse un changement de matricule déjà posé
  (`409 EMPLOYEE_NUMBER_LOCKED`). La correction passe par `PUT /hr/employees/:id/employee-number`,
  réservée au **droit RH administrateur** = `hr.sensitive.read` **et** `hr.manage` (Responsable RH,
  Propriétaire), avec un **motif obligatoire** et une trace d'audit **stricte**
  (`hr.employee.number_changed`, ancien et nouveau numéro). Une fiche ancienne sans matricule en reçoit
  un par `POST /hr/employees/:id/employee-number/auto` (`hr.manage`) ou par la modification ordinaire.

### 3. Référentiel des postes (`hr_positions`)

| Champ | Règle |
|---|---|
| `positionNumber` | `POS-001`, compteur propre `kind: 'POS'` de `hr_counters`, **jamais réutilisé** ; unique `{ organizationId, positionNumberKey }` |
| `title` | 1 à 120 |
| `departmentId` | `null` \| service actif de l'organisation |
| `status` | `open` (vacant) \| `filled` (pourvu) \| `deleted` (supprimé, seulement s'il est vacant ; le numéro reste réservé) |
| `holderEmployeeId` | titulaire actuel ou `null` |
| `holders` | historique `{ employeeId, from, to }` (dates d'entrée et de sortie) |

- À la création d'un collaborateur, `position` vaut **`{ mode: 'replacement', positionId }`**
  (« Remplacement poste pour poste » : un poste **vacant** de l'organisation ; même numéro de poste,
  **nouveau matricule** personne) ou **`{ mode: 'new' }`** (« Nouveau poste » : crée un numéro de poste,
  intitulé = `jobTitle`, service de la fiche). Absent = sans poste (**migration douce** : les fiches
  existantes et `jobTitle` restent valides ; `jobTitle` reste l'intitulé affiché).
- La **sortie** libère le poste (vacant, historique clos à la date de sortie) **sans le supprimer**,
  dans la même transaction que la sortie. La réintégration reprend le poste s'il est encore vacant ;
  sinon la fiche perd son lien de poste.
- Routes : `GET /hr/positions` et `GET /hr/positions/:id` (`hr.read`), `POST /hr/positions`,
  `PUT /hr/positions/:id`, `POST /hr/positions/:id/delete` (`hr.manage`).

### 4. Import du personnel existant (CSV / XLSX)

- **Réutilise `readTable`** d'ADR-0062 (même contrôle zip, mêmes bornes : 2 Mo, lignes plafonnées).
  Modèle CSV téléchargeable (`GET /hr/employees/import/template.csv`, `hr.read`).
- `POST /hr/employees/import/preview` (`hr.manage`) : aperçu **ligne par ligne**, rien n'est écrit ;
  erreurs (nom, poste, date d'entrée, contrat, e-mail, matricule en double dans le fichier ou déjà
  porté) et avertissements (service inconnu → sans service). `POST /hr/employees/import/apply`
  (`hr.manage`) crée les lignes valides (`skipInvalid=true` exigé s'il y a des erreurs) ; **les
  matricules du fichier sont conservés** (et poussent le compteur), les autres sont attribués ;
  `invite=true` invite en masse les lignes qui ont un e-mail (même règle qu'au § 1 ; sans
  `members.invite`, rien n'est envoyé et le résultat le dit). Pas de transaction globale : chaque ligne
  est créée seule et le résultat liste ce qui a été créé.

### 5. Jours fériés de la RDC proposés, chacun « à vérifier »

- Bouton **« Charger les jours fériés de la RDC »** pour une année (`GET` aperçu et `POST`
  `/hr/holidays/country/cd?year=`, `hr.manage`) : ajoute les dates absentes, **non récurrentes**
  (à recharger chaque année, pour qu'une modification du texte soit revue), chacune avec
  `toVerify: true` et la source ; `POST /hr/holidays/:id/verify` (`hr.manage`) lève la marque.
- **Liste et source** (moteur, `RDC_PUBLIC_HOLIDAYS`, version `cd-holidays-2023-03-30`) :
  **ordonnance n° 23/042 du 30 mars 2023** fixant les jours fériés légaux, telle que reprise par
  l'Agence congolaise de presse (ACP, « Tshisekedi décrète le 6 avril jour férié en mémoire de Simon
  Kimbangu », acp.cd, consulté le 7 nov. 2026) : 1er janvier (Nouvel an), 4 janvier (Martyrs de
  l'indépendance), 16 janvier (Héros national Laurent-Désiré Kabila), 17 janvier (Héros national
  Patrice Emery Lumumba), 6 avril (Combat de Simon Kimbangu et conscience africaine), 1er mai (Fête du
  travail), 17 mai (Journée des Forces armées, libellé de l'ACP), 30 juin (Indépendance), 1er août
  (Fête des parents), 25 décembre (Noël).
- **Ce que Lalanda n'affirme pas** : le texte de l'ordonnance n'a pas été lu au Journal officiel ; le
  2 août (Genocost) est une **journée nationale de commémoration** dont le caractère férié n'est pas
  établi par une source trouvée — **non proposé** ; les règles de report (férié tombant un dimanche) et
  les journées déclarées « chômées et payées » par arrêté ponctuel ne sont pas calculées. Chaque date
  reste « à vérifier » tant qu'une personne RH ne l'a pas confirmée.

## Conséquences

- `hr_employees` : `positionId` (nouveau, `null` par défaut) ; `employeeNumber` attribué à la
  création. `hr_positions` (nouvelle collection). `hr_counters.kind` : `EMP`, `POS`. `invitations` :
  `employeeId` (nouveau, `null`). `hr_holidays` : `toVerify`, `source` (défauts `false`, `null`).
  `hr_settings.employeeNumbering`. Aucune migration : les champs absents valent leur défaut.
- Nouvelles routes dans des contrôleurs nouveaux (`HrPositionsController`,
  `HrEmployeeAccountController`, `HrEmployeeNumbersController`, `HrNumberingController`, `HrEmployeeImportController`,
  `HrCountryHolidaysController`), couvertes par `authz/routes-coverage.test.ts`.

## Critères d'acceptation (testables)

1. Création avec `invite: true` et l'e-mail d'un membre : fiche reliée, aucune invitation.
2. Création avec `invite: true` et une adresse inconnue **ou** celle d'un compte d'une autre
   organisation : même réponse `invitation_sent`, invitation `employeeId` ; à l'acceptation, la fiche
   est reliée ; aucune fiche d'une autre organisation n'est touchée.
3. Sans `members.invite` : fiche créée, aucune invitation, `not_sent_permission`.
4. Renvoyer et annuler une invitation depuis la fiche ; état « relié / en attente / sans compte ».
5. Matricules `GF-0001`, `GF-0002`… ; un manuel `GF-0050` fait repartir à `GF-0051` ; une sortie, une
   anonymisation ne libèrent aucun numéro ; changer un matricule exige le droit RH administrateur, un
   motif, et laisse une trace.
6. Poste nouveau `POS-001` ; sortie → poste vacant ; remplacement → même numéro de poste, nouveau
   matricule ; un poste pourvu ne se choisit pas ni ne se supprime.
7. Import : aperçu avec erreurs par ligne, matricules conservés, invitation en masse.
8. Jours fériés : dix dates proposées pour une année, marquées « à vérifier », sans doublon.
9. Isolation : poste, invitation, fiche d'une autre organisation → 404.

## Décisions ouvertes — elles appartiennent à la dirigeante

1. Conserver la clé du matricule après anonymisation (choisi) ou le matricule affiché.
2. Rôle à l'acceptation : Salarié (choisi) ou choix du rôle dans la fiche.
3. Les fériés proposés sont-ils confirmés par un juriste avant d'être marqués vérifiés ?
4. Faut-il proposer aussi le 2 août si un texte en fait un jour férié ?

## Liens

[ADR-0041](ADR-0041-autorisations-par-membre.md) · [ADR-0045](ADR-0045-ressources-humaines.md) ·
[ADR-0051](ADR-0051-rh-frais-avances-presences-evaluations.md) ·
[ADR-0059](ADR-0059-roles-equipe-et-personnalisation-active.md) ·
[ADR-0062](ADR-0062-import-projet-fichier.md) · docs/09 (Country Packs)

## Amendement du 8 novembre 2026 — manques du lot 1 comblés

Statut : **Accepted** (demande de la dirigeante, Go freelance démarre le 9 nov. 2026). Le lot 1 est en
production depuis v1.21.0 ; cet amendement **ajoute** sans retirer. Aucune action ajoutée à
`authz/permissions.ts`.

### A1. Changer le poste d'une fiche qui en a déjà un (mutation)

- `PUT /hr/employees/:id` garde son refus `409 EMPLOYEE_HAS_POSITION` (message : « utilisez
  Changer de poste »). La mutation passe par **`POST /hr/employees/:id/position-change`**
  (`hr.manage`), corps `{ expectedRevision, position, effectiveDate?, jobTitle?, departmentId? }` :
  `position` = `{ mode: 'replacement', positionId }` (poste **vacant** de l'organisation, autre que le
  poste actuel : `409 POSITION_UNCHANGED`) ou `{ mode: 'new' }` (numéro de poste tiré).
- **Une seule transaction** : la fiche pointe le nouveau poste (révision attendue, statut `active`
  exigé : `409 EMPLOYEE_NOT_ACTIVE`), l'ancien poste redevient **vacant** et son historique est clos à
  la date d'effet, le nouveau est pourvu et son historique ouvert à la même date, trace d'audit
  **stricte** `hr.employee.position_changed` (anciens et nouveaux identifiants de poste, date).
- **Le matricule ne change jamais** : la route ne le lit ni ne l'écrit.
- Date d'effet (défaut : aujourd'hui) : moteur `positionChangeCheck` ; elle ne précède ni l'entrée
  (`DATE_BEFORE_START`) ni le début de l'occupation actuelle (`DATE_BEFORE_CURRENT_HOLDING`). Une date
  future est admise (mutation enregistrée d'avance ; le poste est pourvu dès l'enregistrement).
- Intitulé et service de la fiche : ceux demandés, sinon ceux du poste vacant choisi (service de la
  fiche si le poste n'en a pas), sinon ceux de la fiche (nouveau poste).
- Écran : bouton **« Changer de poste »** dans « Compte Lalanda et matricule » de la fiche
  (`hr.manage`, fiche active qui occupe un poste).

### A2. Import : service et manager

- Colonne **Service** : un nom de service **actif** existant ; sinon, si l'option **« Créer les
  services inconnus »** est cochée (`createDepartments=true` sur l'aperçu et l'application), le
  service est créé à l'application (un par nom distinct, audit `hr.department.created`) ; sinon,
  avertissement et fiche sans service (comportement de v1.21.0). Un nom qui désigne un service
  **archivé** n'est jamais recréé : avertissement, sans service.
- Colonne **Manager** : matricule ou e-mail professionnel d'un collaborateur **existant** de
  l'organisation **ou** d'une **ligne du même fichier**. Résolution en **deux passes** (moteur
  `resolveImportManagers`) : passe 1, chaque référence vers un existant ou une ligne ; passe 2, cycles
  refusés par la règle existante `reportingCycle`, puis propagation (manager sur une ligne écartée →
  ligne écartée). Erreurs ligne par ligne dans l'aperçu : manager introuvable, ambigu, plus actif,
  soi-même, ligne du manager en erreur, cycle.
- Application : passe 1 crée les fiches (manager existant posé à la création) ; passe 2 pose le
  manager des lignes qui désignent une ligne du fichier, par la modification ordinaire (mêmes
  contrôles, même audit). Le résultat dit, ligne par ligne, `manager: none | linked | not_linked`
  (`not_linked` : la ligne du manager n'a pas pu être créée) et liste `createdDepartments`.

### A3. Modèle d'import XLSX

- `GET /hr/employees/import/template.xlsx` (`hr.read`) en plus du CSV : onglets « Guide » puis
  « Collaborateurs », dates en texte `JJ/MM/AAAA`. Bibliothèque **`exceljs`**, déjà dépendance de
  l'API et utilisée par le modèle des projets (ADR-0062) : aucune dépendance ajoutée. Le lecteur
  `readTable` choisit déjà la première feuille qui n'est pas « Guide ».

### A4. Changement d'e-mail avec invitation en attente

- Quand une modification de la fiche porte `workEmail` et qu'une invitation **non acceptée, non
  révoquée** liée à la fiche vise une **autre** adresse (ou que l'adresse est effacée), cette
  invitation est **révoquée** (trace `hr.employee.invitation_revoked`, motif `work_email_changed`).
  Cette révocation n'exige que `hr.manage` : elle retire un accès à une adresse qui n'est plus celle du
  collaborateur, elle n'en donne aucun.
- Si « Inviter sur Lalanda » est coché (`invite: true`), une nouvelle invitation part à la nouvelle
  adresse, aux règles du § 1 (dont `members.invite`). Aucun courriel réel dans les tests.

### Critères d'acceptation ajoutés

10. Mutation vers un poste vacant puis vers un nouveau poste : matricule inchangé, ancien poste
    vacant, historiques des deux postes à jour, deux traces d'audit ; poste pourvu refusé.
11. Import avec services inconnus créés (option) et managers existants ou du fichier ; cycle refusé
    ligne par ligne ; manager du fichier posé à l'application.
12. Modèle XLSX téléchargeable et relu par l'aperçu.
13. E-mail modifié avec invitation en attente : l'ancienne est révoquée, une nouvelle part si
    « Inviter » est coché, trace d'audit.

### Décisions ouvertes ajoutées

5. Faut-il interdire une date d'effet future pour un changement de poste (aujourd'hui admise) ?
6. La mutation doit-elle aussi proposer de changer le manager (aujourd'hui : modification ordinaire) ?
