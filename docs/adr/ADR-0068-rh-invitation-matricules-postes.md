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
