# ADR-0078 — Projets : membres externes (contact client, consultant), espace externe et connexion par code

Statut : **Accepté** (besoin et règles validés par la dirigeante le 17 nov. 2026 ; les points
marqués « **à revoir avec Gracy** » ou « **à revoir avec l'expert** » ont été tranchés par défaut
et sont repris en décisions ouvertes)
Date : 2026-11-17
Décideuse : Gracy Omokoso (dirigeante de Go freelance SARLU) ; CTO Lalanda (contrat technique).

> **Prolonge** [ADR-0076](ADR-0076-projets-roles-collaboration-validation.md) (rôles dans le
> projet, validation des jalons) et [ADR-0077](ADR-0077-projets-synchronisation-contrats-depenses-temps.md)
> (validation des feuilles de temps, contrat qui facture lui-même). **Réutilise**
> [ADR-0075](ADR-0075-depense-fournisseur-telephones.md) (fiches fournisseurs),
> [ADR-0039](ADR-0039-projets-et-taches-run.md) § 5 (marge, moteur inchangé),
> [ADR-0048](ADR-0048-formulaire-public-de-prospects.md) (motif des routes publiques bornées) et
> [ADR-0074](ADR-0074-formulaires-modernes.md) (kit de formulaires, `OtpInput`). **Conserve** le
> rôle « Invité externe » (`guest`, ADR-0059) tel quel. **Ne touche pas** à la paie
> (ADR-0070), à la DGI, à l'IA, à Slack ni à WhatsApp. **Aucune action ajoutée** à
> `authz/permissions.ts` (matrice inchangée).

## Contexte

Un projet client (agence, bureau d'études, PME de services à Kinshasa) associe deux sortes de
personnes extérieures à l'organisation :

- le **contact client**, qui doit suivre l'avancement et **valider les livrables** sans voir la
  cuisine interne (marge, prix, temps passé, discussions de l'équipe) ;
- le **consultant** (prestataire indépendant ou cabinet), qui exécute une partie du travail, saisit
  son temps et facture l'organisation ; son temps est un **coût d'achat** du projet.

Le rôle « Invité externe » (`guest`) d'ADR-0059 en fait un **membre de l'organisation** limité aux
projets dont il est membre : il entre dans l'ERP avec une session better-auth, voit les montants
du module Projets selon sa matrice, et n'a ni fiche client, ni fiche fournisseur, ni validation
client. La dirigeante a décidé le 17 nov. 2026 :

1. contact client relié à la fiche client, invité sur des projets `kind: client` de ce client ;
2. connexion « avec un compte et un code reçu par mail, à chaque connexion » ;
3. espace client séparé et minimal ; commentaires internes ou partagés ; validation des livrables ;
4. consultant relié à une fiche fournisseur, ses tâches (ou le projet sur option), son temps
   valorisé au taux d'achat dans la marge, feuilles validées selon ADR-0077 ;
5. fermeture automatique, audit, isolement strict ; `guest` conservé, conversion manuelle.

## Options considérées

### O1 — Quel compte, quelle session ?

1. **better-auth et son greffon « email OTP »**. Un code par e-mail existe dans better-auth
   (`emailOTP`), mais il **n'est pas activé** dans ce dépôt (aucun greffon : `auth/auth.ts`). Il
   ouvrirait une session better-auth ordinaire : `AuthGuard` l'accepterait sur **toutes** les
   routes de l'ERP, et `databaseHooks.user.create.after` provisionnerait une **organisation
   personnelle** au compte externe (S4a) — il pourrait alors utiliser l'ERP complet dans cette
   organisation. Il faudrait modifier `AuthGuard` (garde de chaque route) pour refuser ces
   comptes : une régression possible sur la connexion des comptes internes et Google. **Écarté.**
2. **Membre d'organisation avec un nouveau rôle** (motif de `guest`). Même session, même risque :
   l'isolement reposerait sur la matrice de 57 actions et sur chaque contrôleur. **Écarté.**
3. **Compte externe propre (`work_external_accounts`) et session externe distincte**
   (`work_external_sessions`, cookie `lalanda_ext_session`), servis par des routes `/portal/*` et
   leur garde (`ExternalAuthGuard`). Réutilise ce qui existe : le service d'envoi (`MailService`,
   donc ZeptoMail en production, faux transport en test), l'audit (`AuditService`), les gardes de
   débit (`ThrottlerGuard`, motif d'ADR-0048), les clés dérivées d'`AUTH_SECRET` (HKDF, motif de
   `lead-form-crypto.ts`), le domaine de cookie (`AUTH_COOKIE_DOMAIN`). better-auth n'est **pas
   modifié** : une session externe n'est jamais reconnue par `AuthGuard`, aucune route de l'ERP ne
   lui répond (`401`), par construction. **Retenu.**

Un seul type de compte, deux **genres** : `client` | `consultant` (recommandation suivie). Une
adresse a au plus un compte externe par organisation (index unique `{ organizationId, email }`) ;
la même personne peut avoir un compte interne et un compte externe sans lien entre eux.

### O2 — Où vivent les droits d'un consultant sur une tâche ?

1. Le compte externe dans `assigneeUserId` / `collaboratorUserIds`. Écarté : ces champs passent par
   les règles d'éligibilité des **membres de l'organisation** (ADR-0066, ADR-0076 : `work.update`,
   portée, Stagiaire, Lecteur), réécrites ici pour un non-membre ; risque de régression large.
2. **Champs dédiés `consultantAssigneeId` et `consultantCollaboratorIds`** sur la tâche, réglés par
   la gestion du projet (`PUT /work/tasks/:taskId/client-settings`). Le responsable interne reste
   celui qui termine et soumet la tâche (ADR-0076). **Retenu — à revoir avec Gracy** (un
   consultant qui termine lui-même sa tâche serait un ajout).

### O3 — Où ranger le taux d'achat d'un consultant ?

Dans `work_member_rates` (même forme que les taux des membres, clé = identifiant du compte
externe) : la marge (`computeProjectMargin`) le lit **sans changement du moteur**, et le
« Coût par membre » le nomme. Le récapitulatif temps × taux est calculé par une fonction **pure du
moteur** (`consultantTimeRecap`, `packages/engine/src/work/consultant-recap.ts`). **Retenu.**

## Décision

### 1. Contact client

1. **Rattachement** : fiche client (`customers`) de l'organisation, **obligatoire** ; compte CRM
   (`crm_accounts`) facultatif, relié à la **même** fiche (`400 WORK_EXTERNAL_CRM_MISMATCH`).
2. **Invitation** (`POST /work/projects/:projectId/external-members`, `work.update` + gestion du
   projet d'ADR-0076, sinon `403 WORK_PROJECT_MANAGE_FORBIDDEN`) : projet `kind: client` seulement
   (`409 WORK_EXTERNAL_PROJECT_NOT_CLIENT`), dont la fiche client est **celle du contact**
   (`400 WORK_EXTERNAL_CUSTOMER_MISMATCH`) ; fiche archivée ou fusionnée :
   `409 WORK_EXTERNAL_RECORD_INACTIVE` ; projet archivé : `409 WORK_PROJECT_ARCHIVED`. Un compte de
   la même adresse est **réutilisé** (rouvert s'il était fermé) ; d'un autre genre ou d'une autre
   fiche : `409 WORK_EXTERNAL_KIND_CONFLICT` / `409 WORK_EXTERNAL_RECORD_CONFLICT`. Un e-mail
   d'invitation part (gabarit `renderExternalInvitation`, aucun jeton dans le lien). Bornes : 50
   projets ouverts par compte, 50 membres externes par projet (`409 WORK_EXTERNAL_LIMIT`).
3. **Espace client** (`/portail`) : seulement **ses** projets (adhésion active, projet non archivé,
   `kind: client` de **sa** fiche) ; dans un projet, seulement les tâches **« visibles par le
   client »** (`clientVisible`, nouveau champ, réglé par la gestion du projet) ; titre, étape (à
   faire, en cours, terminé), échéance, jalon, description, validation. **Jamais** : montant,
   marge, temps, coût, estimation, responsable, abonnés, collaborateurs ; le seul membre interne
   nommé est le **chef de projet**.
4. **Commentaires** : champ `visibility` = `internal` (défaut, et valeur des commentaires
   existants, champ absent) | `shared`. L'espace externe ne lit et n'écrit que des commentaires
   **partagés** ; ce que l'externe écrit est **toujours** partagé et le reste
   (`409 WORK_COMMENT_EXTERNAL_SHARED`). Bascule `PUT /work/comments/:commentId/visibility` : auteur
   ou gestion du projet (`403 WORK_COMMENT_VISIBILITY_FORBIDDEN`). L'auteur interne d'un
   commentaire partagé est affiché « L'équipe projet », sauf le chef de projet (nommé).
5. **Validation des livrables** : sur une tâche ou un jalon **visible** et marqué « validation
   client requise » (`clientApproval.required`, exige `clientVisible` :
   `400 WORK_CLIENT_APPROVAL_NEEDS_VISIBLE`), l'état passe à `pending` ; le contact client
   **approuve** ou **demande des modifications** (motif **obligatoire**) par
   `POST /portal/tasks/:taskId/client-decision`. Hors attente : `409 WORK_CLIENT_APPROVAL_NOT_PENDING`.
   Après « modifications demandées », la gestion du projet **remet en attente**
   (`POST /work/tasks/:taskId/client-approval/reset`) une fois la reprise faite. **Jalon
   facturable** : `prepare-invoice` refuse `409 WORK_MILESTONE_NOT_CLIENT_APPROVED` tant que la
   validation client requise n'est pas `approved`, **en plus** de l'approbation interne
   (`WORK_MILESTONE_NOT_APPROVED`, ADR-0076) et de la règle du contrat qui facture lui-même
   (`WORK_CONTRACT_BILLS_ITSELF`, ADR-0077). Jamais d'émission, jamais d'appel DGI : seul le
   brouillon d'ADR-0039 § 6.3. Notifications internes (`work.task_approval_decided`) au
   responsable, au chef et à l'adjoint ; historique `task.client_approval_approved` |
   `…_changes_requested` | `…_reset`.

### 2. Consultant

1. **Rattachement** : fiche fournisseur (`suppliers`) active et non fusionnée, **obligatoire** ;
   **référent interne obligatoire** (membre avec `work.update`, ni Invité ni Stagiaire :
   `400 WORK_EXTERNAL_REFERENT_NOT_ELIGIBLE`).
2. **Visibilité** : par défaut **seulement ses tâches** (`consultantAssigneeId` ou
   `consultantCollaboratorIds`) ; option par projet **« peut ouvrir le projet »**
   (`PUT /work/projects/:projectId/external-members/:accountId { canOpenProject }`, gestion du
   projet) : toutes les tâches du projet, toujours **sans** montant, marge, coût ni nom interne
   (sauf le chef). Commentaires : partagés seulement, comme le client (O4 ci-dessous).
3. **Temps** : il saisit, modifie et supprime son temps **sur ses tâches** seulement
   (`403 WORK_EXTERNAL_TIME_FORBIDDEN`), pour lui seul (`userId` refusé) ; mêmes règles que les
   membres (pas de date future, 1 440 minutes par jour, verrou d'une semaine validée). Le temps est
   rangé dans `work_time_entries` (`userId` = compte externe) et entre dans la **marge** du projet
   au **taux d'achat** du consultant (O3) : `byMember` le nomme (`external: 'consultant'`).
4. **Taux d'achat et base de facture fournisseur** : taux horaire HT daté par consultant
   (`POST /work/external-accounts/:accountId/rates`, `work.manage` + `purchase.manage` ; lecture
   `work.read` + `purchase.read`) ; **récapitulatif temps × taux** par mois et par projet
   (`GET …/time-recap`, export `…/time-recap.csv`), un arrondi au centime par ligne, totaux par
   devise, minutes sans taux jamais valorisées à zéro ; fiche fournisseur : consultants, projets et
   temps valorisé (`GET /work/suppliers/:supplierId/consultants`). **Aucune pièce comptable, aucune
   facture fournisseur n'est créée** : la saisie de la facture reste celle d'ADR-0044.
5. **Feuilles de temps** (ADR-0077) : il **soumet** sa semaine depuis l'espace externe ; le
   **valideur** est **son référent interne** ou un détenteur de `work.manage` ; jamais lui-même. Le
   référent la voit dans « Mes tâches » et `GET /work/timesheets/pending` ; un `work.manage` la
   voit dans la liste « à valider » (pas dans son « Mes tâches », le consultant ayant toujours un
   référent). Verrou d'une semaine approuvée : `409 WORK_TIMESHEET_LOCKED`.

### 3. Connexion par code, cycle de vie, sécurité

1. **Connexion** (`/portal/auth/*`, routes publiques bornées) : adresse → code **à six chiffres**
   (`randomInt`, uniforme) envoyé par e-mail **à chaque connexion** (aucune mémorisation
   d'appareil, aucun mot de passe) ; validité **10 minutes** ; **5 essais** au plus (le 5ᵉ échec
   invalide le code) ; **usage unique** (consommation atomique) ; un nouveau code invalide le
   précédent ; code stocké **haché** (HMAC-SHA256 lié à l'identifiant du défi, clé HKDF d'`AUTH_SECRET`),
   comparé **à temps constant**. **Débit** : 5 demandes et 10 vérifications par adresse, 20
   demandes et 30 vérifications par IP, par 15 minutes (empreintes salées, jamais l'adresse ni
   l'IP en clair) ; plus le garde global. **Aucune énumération** : même réponse `202 { sent: true }`
   qu'un compte existe ou non (envoi non attendu : la durée ne trahit rien) ; même `400
   EXTERNAL_CODE_INVALID` pour adresse inconnue, code faux, expiré ou épuisé. Une adresse qui
   ouvre plusieurs organisations : `409 EXTERNAL_ORGANIZATION_REQUIRED` avec la liste **après** un
   code juste, puis choix.
2. **Session** : jeton aléatoire de 32 octets en cookie `httpOnly`, `SameSite=Lax`, `Secure` en
   HTTPS, domaine `AUTH_COOKIE_DOMAIN` ; seul son SHA-256 est stocké ; durée **absolue de 12 h** ;
   révoquée à la déconnexion. La journalisation HTTP est coupée pour `/portal/auth/`.
3. **Fermeture automatique** : à l'**archivage** (ou la suppression) du projet, au **retrait** du
   membre externe, à la **désactivation** (ou la fusion) de la fiche client ou fournisseur
   (constatée à chaque requête de l'espace externe et à chaque demande de code), et à la fermeture
   manuelle (`POST /work/external-accounts/:accountId/close`, `work.manage`). Un compte sans plus
   aucun accès ouvert voit ses **sessions révoquées**. Restaurer un projet ne rouvre pas les accès :
   on réinvite. *Défaut retenu.*
4. **Audit** (`audit_events`, identifiants seulement, jamais d'adresse ni de nom) :
   `work.external.account_created`, `…invited`, `…reactivated`, `…access_changed`,
   `…code_requested`, `…code_failed`, `…signed_in`, `…signed_out`, `…client_approved`,
   `…client_changes_requested`, `…access_closed`, `…sessions_revoked`, `…closed`,
   `…rate_set|rate_removed`, `…account_updated`, `…guest_converted` ; rôle d'audit d'un externe :
   `external_client` | `external_consultant`.
5. **Isolement** : toute lecture de l'espace externe part du **compte de la session** et de ses
   accès ouverts, dans **son** organisation ; hors portée : `404`. Une session externe n'ouvre
   aucune route de l'ERP (`401` : ventes, trésorerie, RH, achats, organisations, projets) ; une
   session interne n'ouvre pas l'espace externe (`401`). Écritures de l'espace externe soumises à
   la fonctionnalité `run_work` de l'organisation, comme `/work`.
6. **Invité externe conservé** ; **conversion manuelle**, au cas par cas
   (`POST /work/guests/:userId/convert`, `work.manage`) : compte externe créé à l'adresse de
   l'invité, ouvert sur les projets choisis **dont il est membre** (contact client : projets
   client de la fiche), invité **retiré de ces projets** comme membre interne. Son appartenance à
   l'organisation et son rôle `guest` ne sont **pas** touchés : le retrait reste un geste de
   l'écran Membres (`organization.manage`). Aucune migration automatique.

### 3 bis. Durcissement après revue de sécurité (17 nov. 2026)

Une revue indépendante de la branche (aucune faille critique ni haute) a conduit aux règles
suivantes, toutes testées (`work-external.e2e.test.ts`, `work-external-throttler.guard.test.ts`,
`mail.transport.test.ts`) :

1. **M1 — invitation sans effet sur le compte entier.** La gestion d'un projet (chef, adjoint)
   invite sur SON projet sans toucher au compte de l'organisation : un compte **fermé** ne se
   rouvre qu'avec `work.manage` (`409 WORK_EXTERNAL_ACCOUNT_CLOSED` sinon) ; le **référent** d'un
   compte existant ne change qu'avec `work.manage` (sinon le référent demandé est ignoré) ; un
   compte CRM n'est posé que s'il n'y en avait aucun ; l'accès déjà ouvert
   (`WORK_EXTERNAL_ALREADY_MEMBER`) et les bornes sont vérifiés **avant toute écriture**.
2. **M2 — pas de déni de connexion par un tiers.** Les seaux de débit par adresse deviennent des
   seaux par **(adresse + IP)** : un tiers qui tourne d'IP n'épuise plus le quota du titulaire.
   Une nouvelle demande **ne remplace plus** le code vivant : délai minimal de **60 s** entre deux
   codes d'une adresse (dans ce délai, rien n'est créé ni envoyé, même réponse), **deux codes
   vivants** au plus (le précédent reste valable), un code juste consomme son jumeau. Plafond
   **par compte**, tenu en base : **60 demandes par jour** (au-delà, aucun envoi, audit
   `work.external.code_requests_capped`).
3. **B1 — durée de réponse égale.** `request-code` répond **avant** tout accès à la base ; la
   recherche des comptes, le défi, l'e-mail et l'audit se font ensuite, en arrière-plan.
4. **B2 — pauses croissantes, pas de verrou long** (révisé le 17 nov. 2026 à la demande du
   coordinateur : un verrou de 24 h déclenché par un tiers qui connaît l'adresse recréait le déni
   de service de M2, un client bloqué une journée avant une échéance). La devinette est déjà
   bornée (60 s entre deux codes, deux codes vivants, 5 essais par code, plafond de demandes :
   au plus environ 150 essais par jour, une chance infime sur un million de codes). Désormais,
   **tous les 20 codes faux** du jour (compteur en base, jour de Kinshasa) : codes vivants
   invalidés et **pause** des demandes de code, **croissante le même jour** — 15 min, puis 1 h,
   puis 4 h au plus (`pausedUntil`, `pauseLevel`) ; audit `work.external.paused` ; e-mail
   d'avertissement au titulaire **une fois par palier** (`renderExternalLockWarning`, masqué des
   journaux). Pendant la pause, aucun code ne part et un code d'avant ne vaut plus rien (message
   unique). **Déblocage** : `POST /work/external-accounts/:accountId/unlock` (`work.manage`,
   audité `work.external.unlocked`, bouton « Débloquer la connexion » de `/projets/externes`)
   remet à zéro les codes faux, la pause et son palier, et le plafond quotidien de demandes. Une
   connexion réussie remet le compteur de codes faux à zéro.
5. **B3** — la vérification ne lit que les défis dont les essais restent (`attempts < 5`).
6. **B4** — retirer la validation client d'un **jalon** en attente ou « modifications
   demandées » exige un **motif** (`400 WORK_CLIENT_APPROVAL_REASON_REQUIRED`) ; ajouter ou retirer
   une validation client et la remettre en attente sont audités
   (`work.external.client_approval_required|removed|reset`, motif borné à 500 caractères).
7. **B5** — un nom de compte externe n'est résolu que dans **son** organisation
   (`WorkMembersService.refs(ids, organizationId)`).
8. **B6** — invitation, code et avertissement partent avec `redactInLogs` : adresse masquée et
   objet remplacé par un libellé dans les journaux.
9. **B7** — le récapitulatif temps × taux (JSON, CSV) et la vue de la fiche fournisseur ne
   détaillent que les projets **visibles** par l'appelant ; le reste est compté à part
   (`hiddenMinutes`), jamais nommé ni valorisé. Le CSV passe par l'utilitaire du dépôt (`toCsv`,
   cellule commençant par `= + - @`, tabulation ou retour chariot neutralisée).
10. **B8** — toute écriture `/portal/*` (connexion comprise) est refusée si l'en-tête `Origin` est
    présent et différent de `WEB_URL` (`403 EXTERNAL_ORIGIN_FORBIDDEN`) ; un corps doit être du
    JSON (`415 EXTERNAL_JSON_REQUIRED`).

### 4. Correctif d'ADR-0076/0077

Un **Lecteur** du projet ne modifie plus ni ne supprime ses saisies de temps existantes sur ce
projet (`403 WORK_TASK_CREATE_FORBIDDEN`, comme la création) : `PUT` et `DELETE
/work/time-entries/:entryId` appliquent le contrôle d'ADR-0076 (`work-roles.e2e.test.ts`).

### 5. Écrans (kit d'ADR-0074)

- **Membres du projet** : section « Membres externes » (invitation : genre, adresse, nom, compte
  CRM ou fiche fournisseur, référent, « Peut ouvrir le projet » ; liste, bascule, retrait, accès
  fermés) ; page `/projets/externes` (comptes, taux d'achat, CSV, fermeture, conversion d'un Invité).
- **Panneau de tâche** : bloc « Espace externe » (visible par le client, validation client requise
  et son état, remise en attente, consultant responsable) ; fil : mention « partagé », étiquette
  client/consultant, « Partager avec l'externe » / « Rendre interne », interrupteur à la rédaction.
- **Fiche fournisseur** : « Consultants et temps valorisé » (projets, mois × projet, totaux, CSV).
- **Espace externe** `/portail` (hors de la coquille de l'ERP, non indexé) : connexion (adresse,
  `OtpInput` à six cases, choix de l'organisation), mes projets, un projet (tâches, échanges
  partagés, validation), mon temps sur la tâche, ma feuille de temps (consultant).

## Conséquences

- Contrats additifs : `WorkTaskView` + `clientVisible`, `clientApprovalState`,
  `consultantAssigneeId` ; `WorkCommentView` + `visibility` ; `WorkMemberRef` + `external?` ;
  `CreateWorkCommentBody` + `visibility?`. Une instance N-1 ignore ces champs.
- Quatre collections nouvelles (`work_external_accounts`, `work_external_memberships`,
  `work_external_challenges` — sans `organizationId` : un défi peut couvrir plusieurs
  organisations, purgé par TTL —, `work_external_sessions`) ; champs additifs sur `work_tasks` et
  `work_comments` ; aucune migration.
- `MailService` gagne deux intentions (`sendExternalAccessCode`, `sendExternalInvitation`).
- `WorkMembersService.refs` nomme aussi les comptes externes (lecture seule), d'où leurs noms
  dans l'historique, le temps, la marge et les fils internes.

## Critères d'acceptation (testés : `work-external.e2e.test.ts`, `work-roles.e2e.test.ts`, `consultant-recap.test.ts`)

1. Invitation : projet interne `409`, fiche d'un autre client `400`, non-gestion `403`, sans
   référent `400` ; contact et consultant invités, e-mail intercepté ; doublon `409` ; autre
   organisation `404`.
2. Code : même réponse pour une adresse inconnue, aucun envoi ; code absent de la base en clair ;
   faux code et adresse inconnue → même `400` ; usage unique ; 5 essais ; expiration ; 6ᵉ demande
   → `429` ; jeton de session stocké haché ; audits sans adresse.
3. Isolement : ses projets seulement ; projets d'un autre client, internes, d'une autre
   organisation → `404` ; tâche non visible → `404` ; aucune clé de montant, de temps ou de
   personne interne dans les vues ; huit routes de l'ERP → `401` avec la session externe ; session
   interne → `401` sur `/portal`.
4. Commentaires : interne par défaut, partagé visible, auteur interne masqué, commentaire du client
   partagé et non repassable en interne, commentaire d'avant (sans champ) jamais visible.
5. Validation client d'un jalon : motif obligatoire, modifications demandées, `409` hors attente,
   remise en attente, approbation ; `prepare-invoice` refusé avant, plus après ; audit
   `external_client`.
6. Consultant : aucune tâche puis la sienne, tâche d'autrui `404`, décision client `403` ; « peut
   ouvrir le projet » → toutes les tâches sans montant ; temps sur sa tâche seulement, `userId`
   refusé ; taux d'achat (`403` sans `purchase.manage`) ; marge (`timeCost` 60,00 USD pour 90 min à
   40 USD/h), récapitulatif, CSV, fiche fournisseur ; semaine soumise, `404` pour un non-référent,
   approuvée par le référent, puis `409 WORK_TIMESHEET_LOCKED`.
7. Cycle de vie : retrait → session révoquée ; archivage → `401` ; fiche client désactivée → compte
   fermé `customer_inactive` ; audits présents.
8. Conversion d'un Invité : projets proposés, membre non invité `400`, compte créé, invité retiré
   du projet, rôle `guest` inchangé.
9. Lecteur : modification et suppression de ses saisies refusées, permises redevenu Membre.

## Décisions ouvertes — elles appartiennent à la dirigeante (prises par défaut, à revoir)

1. **Consultant et commentaires** : il ne voit et n'écrit que des commentaires **partagés**, comme
   le client (défaut prudent : un commentaire interne peut parler de prix). Alternative : lui
   ouvrir les commentaires internes des tâches qu'il voit. *À revoir avec Gracy.*
2. **Consultant et achèvement** : il ne termine ni ne soumet ses tâches ; le responsable interne
   le fait (O2). *À revoir avec Gracy.*
3. **Description d'une tâche visible** : montrée au client (l'équipe a choisi de rendre la tâche
   visible). Alternative : un texte « pour le client » distinct. *À revoir avec Gracy.*
4. **Restauration d'un projet** : ne rouvre pas les accès externes fermés à l'archivage. *Défaut.*
5. **Droits des taux d'achat** : poser `work.manage` + `purchase.manage`, lire `work.read` +
   `purchase.read` (prix d'achat, pas donnée salariale ; les taux des membres restent sous
   `treasury.manage`). *À revoir avec Gracy.*
6. **Durées et bornes** : code 10 min, 5 essais, session 12 h, débits ci-dessus, 60 s entre deux
   codes, 60 demandes par jour et par compte, pause tous les 20 codes faux (15 min, 1 h, 4 h).
   *Usage courant ; à
   revoir avec l'expert sécurité.*
7. **Fiscalité du récapitulatif** : montants **HT** au taux d'achat, sans TVA ni retenue à la
   source (IBP/IRL sur prestations de non-salariés, à confirmer selon le statut du consultant en
   RDC) : le récapitulatif n'est qu'une **base** ; la facture fournisseur et ses taxes restent
   saisies dans Achats. *À revoir avec l'expert-comptable.*
8. **Données personnelles** : adresse et nom du contact conservés tant que le compte existe (fermé
   compris, pour la trace) ; durée de conservation à fixer (protection des données à caractère
   personnel du Code du numérique de la RDC, référence à confirmer). *À revoir avec l'expert juridique.*

## Hors périmètre

- Pièces jointes dans l'espace externe (lecture et dépôt) ; notifications e-mail aux externes
  (nouveau commentaire, livrable à valider) ; mentions d'un externe.
- Création automatique d'une facture fournisseur ou d'une écriture comptable depuis le temps du
  consultant.
- Lien client ↔ consultant ; plusieurs fiches pour un même contact.
- Paie (ADR-0070).

## Liens

- `packages/shared/src/work/external.ts` ; `packages/engine/src/work/consultant-recap.ts` ;
- `apps/api/src/work/external/*` (schémas, crypto, débit, cycle de vie, services, gardes,
  contrôleurs, module) ; `work-comments.*`, `work-time.service.ts`,
  `timesheets/work-timesheet-approvals.service.ts`, `billing/work-billing.service.ts`,
  `work-projects.service.ts`, `work-members.service.ts`, `mail/*` ;
- `apps/web/src/app/portail/**`, `apps/web/src/app/(app)/projets/_components/{membres-externes,tache-externe,comptes-externes}.tsx`,
  `apps/web/src/app/(app)/achats/_components/consultants-fournisseur.tsx`,
  `apps/web/src/lib/{work-external-api,portal-api,externes-model}.ts`.
