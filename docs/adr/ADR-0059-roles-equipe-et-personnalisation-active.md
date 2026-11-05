# ADR-0059 — Rôles de l'équipe (Salarié, Manager, Stagiaire, Invité externe) et personnalisation des accès active par défaut

Statut : **Accepté** (demande de la dirigeante du 5 nov. 2026 ; livré en v1.14.0)
Date : 2026-11-05
Décideur : Gracy Omokoso (dirigeante de Go freelance SARLU).

> **Amende [ADR-0012](ADR-0012-modele-rbac-complet.md)** (quatre rôles d'organisation de plus, rang,
> rôle par défaut à l'invitation) et **[ADR-0041](ADR-0041-autorisations-par-membre.md)** § 9.1
> (interrupteur `MEMBER_PERMISSIONS_ENABLED` allumé par défaut). Les 57 actions, la matrice
> plateforme, les garde-fous G1 à G8, R1, R2, R3 et R7 sont **inchangés**. Prépare le chantier
> v1.15 « membres de projet » ([ADR-0039](ADR-0039-projets-et-taches-run.md), droits `work.*`).

## Contexte

Le 5 nov. 2026, toute l'équipe de l'entreprise arrive sur Lalanda. La dirigeante signale deux
problèmes :

> « La personnalisation des accès n'est pas fonctionnelle : je vois la liste de toutes les
> autorisations mais on ne sait pas modifier pour attribuer ou retirer, même pour les personnes qui
> ont déjà accès. »

> « Tout le monde devra être sur Lalanda : rajouter un rôle par défaut pour un salarié lambda, et
> d'autres niveaux de responsabilité manquants. »

### Cause exacte du premier problème

ADR-0041 § 9.1 plaçait l'écriture des écarts derrière l'interrupteur `MEMBER_PERMISSIONS_ENABLED`,
**éteint par défaut** (`memberPermissionsEnabled()` ne valait vrai que pour la chaîne exacte
`"true"`), à allumer quand les lots A3, A4 et A5 seraient fusionnés. Ils le sont depuis la v1.10,
mais la variable n'a **jamais été posée** sur l'instance de production. Conséquences en chaîne :
`GET /authz/catalog` publiait `memberPermissionsEnabled: false` ; l'écran
(`permissions-model.ts` → `verrouFiche`, `personnalisationDesactivee`) affichait alors la grille
**en lecture seule** sur la fiche du membre comme à l'invitation (`invite-panel.tsx`), avec un
message « sera bientôt disponible » facile à manquer ; et l'API aurait de toute façon refusé tout
écart (`409 MEMBER_PERMISSIONS_DISABLED`). Le code de personnalisation était juste ; seul le défaut
était faux.

### Faits du dépôt pour le second problème

- Rôles existants : 12 (`permissions.ts`). Aucun ne correspond à « un salarié qui travaille sur
  ses tâches sans voir la finance » : le **Lecteur** (`viewer`, ancien défaut d'invitation) lit les
  ventes, la trésorerie, les achats et la comptabilité, mais ne peut **ni cocher une tâche ni en
  être responsable** (pas de `work.update`) — piège déjà relevé par ADR-0058.
- Le libre-service RH existe : `leave.request`, `expenses.claim`, `attendance.clock` (ADR-0045,
  ADR-0051), plus les routes « moi » (sa fiche, ses documents, ses objectifs) gardées par le socle
  `analytics.read`.
- Le socle `analytics.read` (ADR-0041, décision n° 4) est exigé par toute autre action : Accueil,
  brief, cloche des notifications.
- Les restrictions par projet n'existent pas encore : le chantier v1.15 (membres de projet,
  `apps/api/src/work/`) les câble.

## Décision

### 1. Personnalisation des accès allumée par défaut

`memberPermissionsEnabled(env)` vaut **vrai sauf** `MEMBER_PERMISSIONS_ENABLED=false` (casse et
espaces ignorés). Couper reste possible et reste le retour arrière sans migration : les écarts
stockés sont alors lus comme vides, l'application se comporte comme avant ADR-0041. Aucun garde-fou
ne change : on ne modifie pas ses propres autorisations (G2), un Propriétaire ne se personnalise pas
(G3), on ne modifie pas un membre plus privilégié que soi ni n'accorde au-delà de ses droits (G1),
les dépendances (§ 4) et la séparation des tâches (G4) sont vérifiées par le serveur.

L'écran gagne en clarté : tant qu'une case diffère de l'état enregistré, un bandeau collant
« N modifications non enregistrées — cliquez sur « Enregistrer » » reste visible en bas de la fiche,
et le bouton s'appelle « Enregistrer les autorisations ». Le message de coupure dit désormais
« désactivée sur cette instance » au lieu de « bientôt disponible ».

### 2. Quatre rôles d'organisation (slugs anglais imposés)

Ajoutés **en fin** de `ORG_ROLES` (ordre de fusion), tous attribuables, aucun dans
`OWNER_ONLY_ROLES`, aucun approbateur (aucune case ⓢ, ⚙ ni P).

| Action | Salarié `employee` | Manager / Chef d'équipe `team_manager` | Stagiaire `intern` | Invité externe `guest` |
|---|:--:|:--:|:--:|:--:|
| `analytics.read` (socle : Accueil, brief, cloche) | ✓ | ✓ | ✓ | ✓ |
| `work.read` (voir projets et tâches) | ✓ | ✓ | ✓ | ✓ |
| `work.update` (cocher, commenter, être responsable, saisir son temps) | ✓ | ✓ | ✓ | ✓ |
| `work.manage` (créer, régler, archiver des projets) | ✗ | ✓ | ✗ | ✗ |
| `leave.request` (ses congés) | ✓ | ✓ | ✓ | ✗ |
| `expenses.claim` (ses frais, ses avances) | ✓ | ✓ | ✓ | ✗ |
| `attendance.clock` (son pointage) | ✓ | ✓ | ✓ | ✗ |
| Les 50 autres actions (ventes, trésorerie, CRM, achats, paiements, plans financiers, réalisé, exports, stocks, équipements, bibliothèque, comptabilité, RH d'autorité, gouvernance) | ✗ | ✗ | ✗ | ✗ |
| **Total** | **6** | **7** | **6** | **3** |

- **Salarié** : le rôle de tout le personnel. Aucune donnée financière, ni stock (même en
  quantités), ni bibliothèque, ni équipements : accordables un par un par la personnalisation si
  le poste l'exige.
- **Manager / Chef d'équipe** : Salarié + `work.manage`. **Pas de validation RH** dans cette
  version (`leave.approve`, `expenses.approve` restent aux autorités RH et financières) : la
  validation par le manager de son équipe arrive avec les équipes (v1.15). Note : la chaîne
  hiérarchique des absences et des frais (étape `manager`, ADR-0045/0051) n'exige déjà aucune
  action — elle suit le rattachement du dossier du personnel.
- **Stagiaire** : **même ligne que le Salarié**. La différence voulue — n'assigner une tâche qu'à
  soi-même — n'est pas une action et n'est pas exprimable dans la matrice ; elle relève du module
  `work` (décision ouverte n° 3).
- **Invité externe** : client ou freelance. Projets et tâches seulement, socle compris (exigé par
  toute action). Comme le Conseiller et l'Expert-comptable, il est externe : ni RH, ni frais, ni
  pointage.

### 3. Rang (`ORG_ROLE_RANK`) — le rang n'est pas un droit

Manager 8, Salarié 9, Stagiaire 10, insérés après le Magasinier (7) ; l'Expert-comptable externe,
le Chef de projet, le Conseiller et le Lecteur glissent de trois crans (11 à 14) ; l'Invité externe
ferme la marche (15) : une personne propriétaire de son organisation et invitée d'une autre ouvre
la sienne. Miroir web : `RANG_DE_PRIVILEGE` (`members-model.ts`).

### 4. Rôle par défaut à l'invitation : le Salarié

`DEFAULT_INVITATION_ROLE = 'employee'` (`permissions.ts`), appliqué par le serveur quand
l'invitation ne nomme pas de rôle (`InvitationsService`, défaut du schéma `Invitation`) et proposé
par l'écran (`roleParDefaut`, miroir `ROLE_INVITATION_PAR_DEFAUT`) dès que l'acteur peut
l'attribuer. Sinon, le moins puissant des rôles proposables **internes** : l'Invité externe n'est
jamais choisi par défaut. Le principe de moindre exposition d'ADR-0012 § 7 est conservé : le
Salarié ne lit **aucune** donnée financière, là où le Lecteur lisait ventes, trésorerie, achats et
comptabilité.

Les membres existants **gardent leur rôle** : aucune migration, aucune réécriture.

### 5. Projets bornés pour l'Invité externe : `PROJECT_SCOPED_ROLES`

`permissions.ts` exporte `PROJECT_SCOPED_ROLES: readonly OrgRole[] = ['guest']`. Le chantier v1.15
(membres de projet) la lit pour borner `work.read` / `work.update` aux projets dont la personne est
membre. *Câblé à la fusion de la v1.15 (5 nov. 2026)* : `isProjectScopedRole` d'ADR-0060 lit cette
constante ; l'Invité externe ne voit plus que les projets dont il est membre.

### 6. R7 et attribution

Propriétaire, Administrateur et Directeur financier détiennent les actions des quatre rôles : ils
peuvent les attribuer (R7) ; seuls ceux qui ont `members.invite` invitent. Le Lecteur, sans
`work.update`, n'attribue aucun d'eux. Le Salarié n'attribue pas le Manager.

## Conséquences

- Les écrans qui énumèrent les rôles les reçoivent du serveur (`roleOptions`, catalogue) ; les
  miroirs web (`ORG_ROLES` de `lib/api.ts`, `RANG_DE_PRIVILEGE`, libellés de la console
  d'annonces) sont mis à jour et vérifiés par les tests.
- `GET /authz/catalog` publie `memberPermissionsEnabled: true` et les lignes des quatre rôles ; le
  contrat de `POST /organizations/:orgId/invitations` change de défaut (`role` omis ⇒ `employee`).
- **Déploiement** : une instance N-1 lit `employee`, `team_manager`, `intern`, `guest` comme des
  rôles inconnus et refuse. Déployer toutes les instances avant d'inviter avec ces rôles (consigne
  identique à ADR-0040 pour `sales_rep`).

### Risque relevé, non traité dans cette version

Le socle `analytics.read` ouvre l'espace **Croissance** (`/grow/health`, `/grow/indicators`,
`/grow/journey`) : la trésorerie y est masquée sans `treasury.read` (ADR-0040 § 4.4) et le réalisé
sans `project.read`, mais les indicateurs calculés **sur les factures** (chiffre d'affaires, clients)
restent visibles à tout détenteur du socle. C'est déjà le cas du Magasinier, du Responsable RH et du
Commercial ; avec le Salarié et l'Invité externe, cela touche tout le personnel et des externes.
Corriger touche des rôles existants (le Conseiller, banquier ou mentor, a besoin de ces indicateurs
sans `sales.read`) : décision n° 1, **tranchée le 5 nov. 2026** (voir plus bas).

## Critères d'acceptation (testables)

1. Sans variable d'environnement, `memberPermissionsEnabled()` est vrai, le catalogue le publie,
   une invitation avec écart est acceptée ; `false` explicite le coupe (`authz.service.test.ts`,
   `invitations.e2e.test.ts`).
2. La matrice littérale à 16 rôles × 57 actions (`permissions.test.ts`) ; les quatre lignes
   ci-dessus exactement ; aucune action financière ; dépendances satisfaites ; aucun approbateur.
3. Le Salarié est proposé par défaut à l'invitation ; l'Invité externe jamais par défaut
   (`members-model.test.ts`) ; le serveur applique `employee` quand le rôle est omis.
4. Chaque sonde de `rbac-matrix.e2e.test.ts` passe pour les quatre rôles (invitation réelle,
   brief, GROW, `/me/permissions`).
5. Les membres existants gardent leur rôle (aucune migration).

## Décisions ouvertes — elles appartiennent à la dirigeante

1. **Croissance et socle** — *tranchée par la dirigeante le 5 nov. 2026* : la santé
   (`GET /grow/health`) et les indicateurs (`GET /grow/indicators`) sont réservés à qui lit les
   ventes (`sales.read`, par son rôle ou par un écart individuel), plus le Conseiller. Les autres
   reçoivent un 403 `GROW_FIGURES_RESTRICTED` et l'écran l'explique ; le profil et le parcours
   restent ouverts à `analytics.read`. Perdent ces chiffres : Salarié, Manager, Stagiaire, Invité,
   Responsable RH, Magasinier, Chef de projet et Expert-comptable externe.
2. **Salarié et bibliothèque** : ajouter `docs.read` (règlement intérieur, politiques) au
   Salarié, au Manager et au Stagiaire. *Défaut : non (accordable par personne).*
3. **Stagiaire** : « n'assigner une tâche qu'à soi-même », à câbler dans le module `work` (v1.15).
   *Défaut : même droits que le Salarié.*
4. **Manager et validation RH** : étape `manager` des absences et des frais pour le Manager de
   l'équipe. *Défaut : avec les équipes, v1.15.*

## Liens

- [ADR-0012](ADR-0012-modele-rbac-complet.md), [ADR-0041](ADR-0041-autorisations-par-membre.md)
  (amendés) ; [ADR-0039](ADR-0039-projets-et-taches-run.md) (`work.*`) ;
  [ADR-0045](ADR-0045-ressources-humaines.md) et
  [ADR-0051](ADR-0051-rh-frais-avances-presences-evaluations.md) (libre-service RH) ;
  [ADR-0058](ADR-0058-accueil-projets-et-mes-taches-equipe.md) (piège du Lecteur).
- `apps/api/src/authz/permissions.ts`, `authz.service.ts` ;
  `apps/api/src/organizations/invitations.service.ts`, `invitation.schema.ts`,
  `member-permissions.ts` ; `apps/web/src/app/(app)/organisation/membres/**`.
- `docs/12-ROLES-PERMISSIONS.md`, `docs/16-API.md`, `docs/guide-projets-equipe.md`.
