# ADR-0012 — Modèle RBAC complet : rôles, actions granulaires et guards

Statut : Accepted
Date : 2026-08-08
Décideurs : CTO Lalanda (délégation Gracy Omokoso), décideur produit

## Contexte

Le chantier « espaces membres » ouvre trois espaces distincts :

| Espace | Public | Condition d'accès |
|---|---|---|
| `/compte` | tout utilisateur authentifié | session valide, **aucun rôle requis** |
| `/organisation` | membres d'une organisation | un rôle organisation sur l'org active |
| `/admin` | équipe Lalanda | un rôle plateforme |

L'état actuel du code ne permet pas de les servir : `apps/api/src/organizations/membership.schema.ts`
n'expose que `owner | member`, `AuthGuard` (`apps/api/src/auth/auth.guard.ts`) ne fait
qu'authentifier et résoudre l'organisation active, et aucun contrôle par action n'existe.
Les seules restrictions actuelles sont ad hoc (invitations réservées à `owner`).

`docs/12-ROLES-PERMISSIONS.md` (Draft v0.1) définit **8 rôles organisation**, **6 rôles
plateforme** et **15 actions granulaires**. Le décideur produit a arbitré : on implémente
la totalité de docs/12, sans inventer de rôle ni d'action. Cet ADR fige la matrice
rôle × action, la cohabitation plateforme/organisation, la migration depuis `owner | member`,
l'emplacement des guards et la stratégie de test.

### Contradiction de documentation arbitrée

`ADR-0006` (auth better-auth) annonce des guards pour les rôles du brief §6 :
`owner | admin | fondateur | comptable | mentor | viewer`. `docs/12` en définit huit,
différents. **docs/12 fait foi** (choix explicite du décideur produit) ; ADR-0006 est
*superseded* sur ce seul point, le reste (better-auth, isolation par `organizationId`)
reste applicable. Correspondance indicative brief → docs/12 : `fondateur` → Chef de projet,
`mentor` → Conseiller, `viewer` → Lecteur, `comptable` → Comptable.

## Options considérées

1. **Deux rôles + drapeaux booléens** (`canApprove`, `canClose`, …). Rejeté : ingérable
   au-delà de trois drapeaux, aucune lisibilité pour l'utilisateur, pas testable en matrice.
2. **Rôles seuls, sans actions granulaires.** Rejeté : docs/12 §Modèle impose « rôle,
   organisation, projet, action et conditions » et docs/17 §Autorisation impose
   « contrôle par ressource et action ».
3. **ABAC / policy engine (CASL, Casbin, OPA).** Rejeté pour la v1 : dépendance
   supplémentaire, courbe d'apprentissage, et notre besoin est une matrice statique de
   14 × 15 cases. Une constante gelée + un guard NestJS suffisent et se testent
   exhaustivement. La forme retenue (matrice de données, pas de `if` dispersés) permet de
   basculer sur un moteur plus tard sans réécrire les contrôleurs.
4. **Rôles plateforme stockés comme des memberships d'une « org système ».** Rejeté :
   pollue `memberships`, casse l'invariant « un membership = un client », et rendrait un
   super-admin membre d'organisations clientes. Collection dédiée (voir §Cohabitation).

**Retenu : option 3** — matrice statique typée, guard NestJS, refus par défaut.

## Décision

### 1. Rôles organisation (8) — identifiants de code

Les identifiants sont en anglais `snake_case` (docs/26 « noms de code en anglais » ;
l'exception « français métier » d'ADR-0011 vise les ids DSL/feuilles SYSCOHADA, pas
le contrôle d'accès).

| Libellé docs/12 | Slug | Code matrice |
|---|---|---|
| Propriétaire | `owner` | PRO |
| Administrateur | `admin` | ADM |
| Directeur financier | `finance_director` | DIR |
| Comptable | `accountant` | CPT |
| Analyste | `analyst` | ANA |
| Chef de projet | `project_manager` | CDP |
| Conseiller | `advisor` | CON |
| Lecteur | `viewer` | LEC |

### 2. Rôles plateforme (6) — identifiants de code

Préfixe `platform_` obligatoire : les deux espaces de noms cohabitent dans le même
type TypeScript, la collision doit être impossible.

| Libellé docs/12 | Slug | Code matrice |
|---|---|---|
| Super administrateur | `platform_super_admin` | SA |
| Administrateur plateforme | `platform_admin` | PA |
| Support | `platform_support` | SUP |
| Finance/facturation | `platform_billing` | FAC |
| Éditeur de templates | `platform_template_editor` | TPL |
| Gestionnaire comptable/fiscal | `platform_country_pack_manager` | CPK |

### 3. Matrice rôle organisation × action

Les 15 actions sont celles de docs/12 §Actions granulaires, dans l'ordre du document.

Légende : **✓** autorisé · **✗** refusé · **⚙** conditionnel (droit explicite à accorder,
désactivé par défaut) · **P** limité aux projets assignés · **ⓢ** soumis à la séparation
des tâches (§Règles critiques, R2).

| Action | PRO | ADM | DIR | CPT | ANA | CDP | CON | LEC |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| `organization.manage` | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `billing.manage` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `members.invite` | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `project.create` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `project.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ P | ✓ | ✓ |
| `project.update` | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ P | ✗ | ✗ |
| `canvas.update` | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ P | ✗ | ✗ |
| `inputs.update` | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ P | ✗ | ✗ |
| `plan.calculate` | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ P | ✗ | ✗ |
| `plan.approve` | ✓ ⓢ | ✗ | ✓ ⓢ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `actuals.import` | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| `period.close` | ✓ | ✗ | ✓ | ⚙ | ✗ | ✗ | ✗ | ✗ |
| `analytics.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ P | ✓ | ✓ |
| `report.export` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ P | ✗ | ✗ |
| `audit.read` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |

Justifications des cases non évidentes :

- **ADM sans `billing.manage`** — docs/12 réserve l'abonnement au Propriétaire
  (« abonnement, membres, suppression et transfert ») et attribue à l'Administrateur les
  « paramètres non critiques » côté plateforme, « membres, projets, paramètres » côté org.
- **ADM sans `plan.approve` ni `period.close`** — approuver un plan et clôturer une période
  sont des actes financiers engageants (un plan validé part chez un banquier, docs/07).
  Ils appartiennent à l'autorité financière (PRO, DIR), pas à l'administration technique.
- **CPT sans `inputs.update` ni `plan.calculate`** — docs/12 : « réalisé, mapping, clôture ».
  Le comptable saisit le réalisé (docs/08), il ne fabrique pas le prévisionnel. C'est la
  contrepartie de R2 : celui qui constate n'est pas celui qui projette.
- **CPT `period.close` en ⚙** — docs/12 dit littéralement « clôture **selon permission** ».
  Traduit par un droit `canClosePeriods` porté par le membership, `false` par défaut,
  accordable par PRO/ADM. C'est le seul droit conditionnel du modèle.
- **CDP sans `actuals.import`** — « projets autorisés et saisie » : saisie des hypothèses
  de son projet, pas de l'écriture comptable réalisée qui reste la ligne du Comptable.
- **CON sans `report.export`** — le Conseiller est typiquement externe (mentor, consultant,
  banquier invité). L'export non autorisé est une menace prioritaire de docs/17 ; on lui
  ouvre la consultation en ligne, pas l'exfiltration de fichier. Un besoin d'export
  passe par un membre interne, tracé par R4.
- **`analytics.read` pour tous** — c'est la lecture des analyses du projet ; refuser au
  Lecteur reviendrait à vider le rôle « lecture seulement » de son sens.

### 4. Matrice rôle plateforme × action

Les rôles plateforme n'ont **aucun droit implicite sur les données d'une organisation
cliente**. Légende : **✓** natif (portée plateforme) · **⚙D** possible uniquement sous
un accès délégué actif (§5) · **✗** interdit, y compris au super-administrateur.

| Action | SA | PA | SUP | FAC | TPL | CPK |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| `organization.manage` | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| `billing.manage` | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ |
| `members.invite` | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| `project.create` | ⚙D | ✗ | ✗ | ✗ | ✗ | ✗ |
| `project.read` | ⚙D | ⚙D | ⚙D | ✗ | ✗ | ✗ |
| `project.update` | ⚙D | ✗ | ✗ | ✗ | ✗ | ✗ |
| `canvas.update` | ⚙D | ✗ | ✗ | ✗ | ✗ | ✗ |
| `inputs.update` | ⚙D | ✗ | ✗ | ✗ | ✗ | ✗ |
| `plan.calculate` | ⚙D | ✗ | ✗ | ✗ | ✗ | ✗ |
| `plan.approve` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `actuals.import` | ⚙D | ✗ | ✗ | ✗ | ✗ | ✗ |
| `period.close` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `analytics.read` | ⚙D | ✗ | ⚙D | ✗ | ✗ | ✗ |
| `report.export` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `audit.read` | ✓ | ✓ | ⚙D | ✗ | ✗ | ✗ |

Trois interdits absolus, non contournables par un accès délégué :

- **`plan.approve`** — aucun acteur Lalanda n'approuve le plan financier d'un client.
  L'approbation engage le client vis-à-vis de sa banque ; docs/17 §Finance impose la
  séparation création/approbation, elle serait vidée de sens si l'éditeur pouvait approuver.
- **`period.close`** — même raisonnement : la clôture fige un exercice comptable.
- **`report.export`** — un acteur plateforme ne produit jamais de fichier contenant les
  données financières d'un client (menace « export non autorisé », docs/17).

`platform_support` illustre la règle docs/12 « le support ne voit jamais les données
financières sans consentement explicite, durée limitée et audit » : ses trois `⚙D`
exigent un accès délégué **avec consentement d'un Propriétaire** (§5).

`platform_template_editor` et `platform_country_pack_manager` sont vides sur cette matrice :
ils opèrent sur des ressources de portée plateforme (templates sectoriels, Country Packs)
qui n'ont pas d'action granulaire dans docs/12 — voir §Lacunes identifiées.

### 5. Cohabitation rôle plateforme / rôle organisation

**Principe : les deux espaces sont additifs et jamais fusionnés.** Un principal porte
zéro ou un rôle organisation *par organisation*, et zéro à N rôles plateforme. Un
super-administrateur n'est **pas** membre des organisations clientes : aucun document
`memberships` n'est créé pour lui.

**Stockage.** Nouvelle collection `platform_roles` :
`{ userId, role, grantedBy, grantedAt, revokedAt?, _schemaVersion }`, index unique
`{ userId, role }`. Elle n'est pas dans le schéma better-auth (ADR-0006 laisse
better-auth propriétaire de `user`/`session`) et pas dans `memberships`.
L'attribution d'un rôle plateforme est réservée à `platform_super_admin` (docs/12
« attribution des rôles internes ») et exige la ré-authentification (§ADR-0013 §Ré-auth,
même mécanisme).

**Accès à une organisation cliente.** Deux mécanismes, jamais un accès implicite :

1. **Lecture plateforme** — `/admin` liste les organisations avec leurs *métadonnées*
   (nom, plan, nombre de membres, nombre de projets, dates, état d'abonnement). Aucune
   donnée financière, aucun contenu de projet. C'est une ressource de portée plateforme,
   distincte de `project.read`.
2. **Accès délégué** (`support_grants`) — un document par accès :
   `{ id, organizationId, requestedBy, role: 'platform_support'|'platform_super_admin',
   mode: 'read'|'write', reason, consentedBy?, consentedAt?, expiresAt, revokedAt?,
   createdAt, _schemaVersion }`.
   - Durée **bornée** : 60 minutes par défaut, 4 heures maximum, jamais renouvelable
     automatiquement.
   - `mode: 'read'` sur les métadonnées : validé par un `platform_super_admin`.
   - Accès aux **données financières** (`project.read`, `analytics.read`) : exige
     `consentedBy` = un `owner` de l'organisation cible, consentement donné dans
     `/organisation` (docs/12 : « consentement explicite »).
   - `mode: 'write'` : `platform_super_admin` **et** consentement d'un `owner`, motif
     obligatoire, et jamais sur les trois actions interdites ci-dessus.
   - Révocable à tout instant par n'importe quel `owner` de l'org cible, effet immédiat
     (vérification à chaque requête, pas de cache de plus de 30 s).

**Traçabilité — l'identité réelle n'est jamais réécrite.** Sous un accès délégué, chaque
requête produit un `audit_events` :
`{ actorUserId (le compte Lalanda réel), actorPlatformRole, impersonatedUserId (nullable),
organizationId, action, resource, grantId, result, ip, userAgent, correlationId, at }`.
Le champ `createdBy`/`updatedBy` des documents métier écrits sous grant porte **l'id du
compte plateforme**, jamais celui d'un membre client. Un bandeau permanent est affiché
côté web pendant toute la durée du grant, et les `owner` de l'organisation reçoivent une
notification à l'ouverture et à la fermeture du grant.

### 6. Règles critiques (docs/12 §Règles critiques)

**R1 — Dernier propriétaire.** Une organisation a en permanence au moins un `owner`.
Toute rétrogradation ou retrait d'un `owner` s'exécute dans une transaction Mongoose
(ADR-0004 §3) qui **recompte les `owner` après l'écriture** et avorte si le compte tombe
à zéro → `409 LAST_OWNER`. Le recomptage post-écriture dans la transaction est ce qui
protège de la course « deux rétrogradations concurrentes voient chacune 2 propriétaires » ;
le conflit d'écriture MongoDB force le rejeu. Le transfert est une opération atomique
dédiée (`POST /organizations/:id/transfer-ownership`) : promotion de la cible et
rétrogradation de l'acteur dans la **même** transaction, jamais deux appels.

**R2 — Séparation validation / saisie.** Deux niveaux :

- *Statique* : `inputs.update` et `plan.approve` sont deux actions distinctes ; `admin`,
  `analyst`, `project_manager` saisissent sans jamais approuver.
- *Dynamique* : l'approbateur d'une version de plan ne peut pas être le dernier auteur
  des entrées de cette version. Sinon `409 SELF_APPROVAL_FORBIDDEN`.
- *Échappatoire assumée* : si l'organisation ne compte **qu'un seul** principal détenant
  `plan.approve` (cas majoritaire en RDC : entrepreneur seul dans son organisation
  auto-provisionnée), l'auto-approbation est autorisée mais **marquée** :
  `approval: { soleApprover: true }` dans le snapshot `FinancialPlan` et dans l'audit.
  Un plan approuvé sans séparation des tâches le dit ; c'est une information de
  bancabilité, pas un détail technique.

**R3 — Double permission clôture / réouverture.** Clôturer une période exige
`period.close`. **Rouvrir** une période exige `period.close` **et** `plan.approve`
détenues par le même principal — c'est la « deuxième permission distincte » de docs/12,
obtenue sans inventer de seizième action. Conséquence voulue : un Comptable à qui on a
accordé `canClosePeriods` peut clôturer mais **ne peut pas rouvrir**. La réouverture
exige en outre un motif (déjà prévu par ADR-0011 Contrat 4) et produit un `audit_events`.

**R4 — Exports journalisés.** Tout `report.export` réussi écrit un `audit_events`
`{ action: 'report.export', format, projectId, planVersion, periodRange, actorUserId,
ip, correlationId }`. L'échec d'écriture de l'audit **annule l'export** (pas d'export
non traçable). Quota dédié via `apps/api/src/security/` (bucket plus strict que le
global 100 req/min). `advisor` et `viewer` n'ont pas l'action.

**R5 — Usurpation support limitée et auditée.** Couverte par §5 : durée bornée, motif,
consentement pour les données financières, révocation immédiate, bandeau visible,
identité réelle conservée dans l'audit, notification aux propriétaires.

**R6 — Country Packs.** Les modifications sont réservées à `platform_country_pack_manager`
et suivent un workflow d'approbation à quatre yeux : le gestionnaire *propose* une
version, un second `platform_country_pack_manager` ou un `platform_super_admin`
*approuve*. Le proposant ne peut pas approuver sa propre proposition (même logique que R2).
Module concerné : `apps/api/src/parameter-packs/`.

**R7 — Invitations sans élévation de privilège.** Une invitation porte le rôle attribué à
l'acceptation. Un acteur ne peut inviter qu'à un rôle dont l'ensemble de permissions est
un **sous-ensemble du sien** (`grantableRoles(actorRole)`), sinon `403 ROLE_ESCALATION`.
Conséquence opérationnelle assumée : un `admin` ne peut pas inviter un `finance_director`
(qui détient `plan.approve` qu'il n'a pas) ; seul un `owner` le peut. C'est volontaire —
l'alternative (liste blanche par rôle) est plus souple mais ouvre la porte à une
escalade par composition. Les invariants existants restent : expiration, liaison à une
organisation, révocation, pas de doublon sur une adresse déjà membre.

### 7. Migration depuis `owner | member`

Documents concernés : `memberships` et `invitations` (tous deux `_schemaVersion: 1`,
enum `['owner','member']`).

**Décision : `member` → `finance_director`. `owner` → `owner` (inchangé).**

Principe directeur : **iso-privilège**. Aujourd'hui un `member` peut, dans le code livré,
créer et modifier des projets, saisir des hypothèses, évaluer, valider un plan (S16c),
importer du réalisé, clôturer une période, exporter — tout sauf gérer l'organisation,
l'abonnement et les invitations, réservés à `owner`. C'est exactement le périmètre de
`finance_director` dans la matrice §3. La migration ne retire ni n'ajoute aucun droit.

Alternatives rejetées :

- **`member` → `viewer`** (moindre privilège). Rejeté : régression silencieuse pour tous
  les comptes bêta existants, qui perdraient du jour au lendemain la capacité de travailler
  sur leurs propres projets. Un durcissement ne se fait pas par surprise sur des données
  vivantes ; il se fait en donnant à un `owner` les moyens de rétrograder ses membres.
- **`member` → `admin`**. Rejeté : `admin` détient `members.invite` et
  `organization.manage` qu'un `member` n'a pas aujourd'hui → **élévation de privilège**
  par migration, exactement la menace que docs/17 place en priorité.

**Mécanique.** Migration idempotente dans `apps/api/src/migrations/` (répertoire prévu par
ADR-0004 §8, **à créer** — il n'existe pas encore) :

```
1. memberships : updateMany({ _schemaVersion: 1, role: 'member' },
                            { $set: { role: 'finance_director', _schemaVersion: 2 } })
2. memberships : updateMany({ _schemaVersion: 1, role: 'owner' },
                            { $set: { _schemaVersion: 2 } })
3. invitations : idem sur les invitations non encore acceptées et non expirées
4. platform_roles : insertion du (ou des) super-administrateur(s) initiaux,
                    depuis une liste d'emails fournie hors code, jamais en dur
```

Idempotence garantie par le filtre sur `_schemaVersion: 1`. Pas de transaction globale
(volume potentiellement supérieur aux limites de transaction MongoDB) : des `updateMany`
filtrés, rejouables sans effet de bord. L'ordre 1 puis 2 importe : l'inverse ferait passer
tous les documents en v2 avant la conversion des rôles.

**Piège découvert, à corriger dans la même PR.**
`apps/api/src/organizations/organizations.service.ts:48` sélectionne l'organisation
primaire avec `.sort({ role: -1, createdAt: 1 })`, en s'appuyant sur le fait que
`'owner' > 'member'` **en ordre alphabétique**. Avec les nouveaux slugs, cette astuce se
casse : `'project_manager' > 'owner'` et `'viewer' > 'owner'`. Un utilisateur `owner`
d'une organisation et `viewer` d'une autre serait basculé sur la mauvaise organisation
par défaut, silencieusement. Le tri alphabétique doit être remplacé par un **rang
explicite** (constante `ORG_ROLE_RANK`, `owner` = 0), appliqué en mémoire ou via un
`$addFields` d'agrégation. Un test de non-régression sur ce cas précis est obligatoire.

Autres points d'attention de la migration :

- `enum` à étendre dans `membership.schema.ts` **et** `invitation.schema.ts`.
- `default: 'member'` à remplacer par `default: 'viewer'` pour les **nouveaux**
  memberships créés sans rôle explicite (moindre privilège pour le futur ; la migration
  ci-dessus ne concerne que l'existant).
- `project_manager` n'est **pas attribuable** tant que l'assignation de projets
  (`project_assignments`) n'existe pas : l'API refuse ce rôle avec
  `409 ROLE_NOT_AVAILABLE`. Le rôle est présent dans l'enum et la matrice, inactif à
  l'attribution. Mieux vaut un rôle documenté et bloqué qu'un rôle qui ne restreint rien.
- `provisionPersonalOrgForUser` continue de créer un `owner` — inchangé.

### 8. Emplacement des guards et forme du code

Le pattern existant est `AuthGuard` dans `apps/api/src/auth/`, injecté par contrôleur
(`@UseGuards(AuthGuard)`), avec `CurrentUser` / `CurrentOrgId` en décorateurs de
paramètre. On l'étend sans le remplacer.

| Fichier | Rôle |
|---|---|
| `apps/api/src/auth/permissions.ts` | **Source de vérité unique** : types `OrgRole`, `PlatformRole`, `Action` ; les deux matrices en constantes `as const` gelées ; `can(role, action)`. Aucune logique HTTP. |
| `apps/api/src/auth/auth.guard.ts` | *existant, étendu* : après résolution de `req.orgId`, attache `req.orgRole`, `req.platformRoles`, `req.grant` (accès délégué actif). Ne décide d'aucune permission. |
| `apps/api/src/auth/require-permission.decorator.ts` | `@RequirePermission('plan.approve')` — pose la métadonnée lue par le guard. |
| `apps/api/src/auth/permission.guard.ts` | Lit la métadonnée, applique `can()`, applique les conditions (⚙, P, ⓢ, accès délégué). **Refus par défaut** : route annotée sans permission connue → 500 au démarrage, pas 200 à l'exécution. |
| `apps/api/src/auth/permissions.test.ts` | Test de matrice (§Plan de validation). |
| `apps/api/src/audit/` | *nouveau* : `audit_events`, service d'écriture append-only, consommé par R4/R5/R6 et ADR-0013. |
| `apps/api/src/organizations/` | `memberships`, `platform_roles`, `support_grants`, transferts, invitations. |

Règles de codage :

- `PermissionGuard` s'enregistre **par contrôleur, après `AuthGuard`**, jamais en
  `APP_GUARD` global : il a besoin de `req.orgRole` que `AuthGuard` pose.
- **Aucun `if (role === …)` hors de `permissions.ts`.** Un contrôleur qui a besoin d'une
  condition non exprimable par la matrice remonte au CTO — c'est le signal d'une action
  manquante dans docs/12.
- Codes d'erreur `SCREAMING_SNAKE_CASE`, format `{ error: { code, message, details,
  correlationId } }` (docs/16, ADR-0011 Contrat 4).
- **Distinction 403 / 404 :** rôle insuffisant **dans sa propre organisation** → `403
  FORBIDDEN` (l'utilisateur sait que la ressource existe, il travaille dedans).
  Ressource d'une **autre** organisation → `404`, jamais 403 (ADR-0011 Contrat 4) : un 403
  révélerait l'existence de l'organisation. Cette distinction est testée dans les deux sens.
- Côté web, l'autorisation n'est **jamais** décidée par le client (docs/12 §Modèle :
  « les contrôles sont exécutés côté serveur »). Le front appelle
  `GET /me/permissions?organizationId=…` qui renvoie la liste plate des actions effectives
  et masque le reste. Masquer n'est qu'un confort d'interface ; le serveur refuse quand même.

### 9. Frontières de fichiers — deux chantiers en parallèle

Deux développeurs démarrent pendant la rédaction de cet ADR. Règle inchangée depuis
ADR-0011 : **un fichier = un seul écrivain**. Toute exception passe par le CTO.

| Zone | Propriétaire | Les autres |
|---|---|---|
| `apps/api/src/auth/**` (guard, permissions, décorateurs) | **Dev RBAC** | lecture seule |
| `apps/api/src/auth/auth.ts` (config better-auth) | **Dev RBAC** (merge), Dev Compte (proposition) | — |
| `apps/api/src/organizations/**` | **Dev RBAC** | ne pas modifier |
| `apps/api/src/migrations/**` (nouveau) | **Dev RBAC** | ne pas créer |
| `apps/api/src/audit/**` (nouveau) | **Dev RBAC** | ne pas créer |
| `apps/api/src/account/**` (nouveau : profil, sessions, préférences) | **Dev Compte** | ne pas créer |
| `apps/web/src/app/(app)/compte/**` (nouveau) | **Dev Compte** | — |
| `apps/web/src/app/(app)/members/**`, `invitations/**` | **Dev RBAC** | — |
| `apps/web/src/app/(app)/organisation/**`, `admin/**` | **personne** — chantier ultérieur | — |
| `packages/shared/src/env/index.ts` | **aucun des deux** (touché par ADR-0013) | — |
| `apps/api/src/app.module.ts` | partagé — **ajout d'imports uniquement**, une ligne par dev | tous |

Interdictions explicites :

- **Le Dev Compte ne modifie pas `auth.guard.ts`.** Les endpoints `/compte` ont besoin de
  `req.user` mais pas de `req.orgRole` ; ils consomment le guard tel quel. Si un besoin
  d'évolution du guard apparaît, il est porté par le Dev RBAC.
- **Le Dev Compte ne modifie pas `membership.schema.ts`.** Si `/compte` doit lister les
  organisations de l'utilisateur avec leur rôle, il consomme `OrganizationsService`
  (`listOrgsForUser`) et type la sortie via `OrgRole` importé de `permissions.ts` — il ne
  duplique pas la liste des rôles.
- **Le Dev RBAC ne crée aucune page `/compte`.**
- `/compte` **n'exige aucun rôle** : c'est le seul espace accessible à un utilisateur sans
  organisation (profil, sessions, mot de passe, suppression de compte). Il ne doit donc pas
  dépendre de `CurrentOrgId`, qui lève si `AuthGuard` n'a pas résolu d'organisation.
  Ce point est le principal risque d'interférence entre les deux chantiers : le Dev Compte
  doit utiliser `CurrentUser` seul.

**Ordre de merge : Dev RBAC d'abord** si les deux PR sont prêtes simultanément (la
migration et `permissions.ts` sont des prérequis de tout le reste) ; sinon les deux sont
indépendantes et mergeables dans n'importe quel ordre.

## Conséquences

- `memberships` et `invitations` passent en `_schemaVersion: 2` ; le répertoire
  `apps/api/src/migrations/` est créé (première migration du projet).
- Trois collections nouvelles : `platform_roles`, `support_grants`, `audit_events`.
- Le tri d'organisation primaire est corrigé (bug latent révélé par la migration).
- Les comptes bêta existants conservent exactement leurs capacités actuelles.
- `project_manager` et les restrictions par projet sont documentés mais inactifs tant que
  `project_assignments` n'existe pas — dette assumée et bornée.
- `docs/12-ROLES-PERMISSIONS.md` passe de Draft à une version alignée sur cet ADR (slugs
  de code, conditions ⚙/P/ⓢ, distinction 403/404). ADR-0006 est annoté *superseded* sur
  la liste de rôles.
- Coût MFA : docs/17 exige le MFA pour les rôles sensibles ; il n'existe pas encore. Les
  rôles plateforme sont donc protégés par la ré-authentification par mot de passe
  (ADR-0013 §Ré-auth) en attendant, ce qui est **plus faible que la cible** et doit être
  levé avant l'ouverture réelle de `/admin` en production.

### Lacunes identifiées dans docs/12 (à arbitrer, hors périmètre de cet ADR)

1. **Les commentaires n'ont pas d'action granulaire.** Analyste et Conseiller ont pour
   capacité « commentaires » mais aucune des 15 actions ne les couvre. Provisoirement :
   commenter est ouvert à tout rôle détenant `project.read`, sauf `viewer`. À trancher.
2. **Templates et Country Packs n'ont pas d'action granulaire.** `platform_template_editor`
   et `platform_country_pack_manager` sont donc vides dans la matrice §4. Leurs droits sont
   portés par le rôle lui-même sur les modules `templates` et `parameter-packs`.
3. **La lecture des métadonnées d'organisation** (liste `/admin`) n'est couverte par
   aucune des 15 actions ; c'est une ressource de portée plateforme, gouvernée par le rôle.
4. **Les restrictions par projet** (docs/12 §Modèle : « des restrictions de projet peuvent
   le réduire ») sont modélisées (`P`) mais non implémentées.

## Plan de validation

- **Test de matrice exhaustif** (`permissions.test.ts`) : la matrice attendue est
  **redupliquée en littéral dans le test**, pas importée de `permissions.ts`. 8 × 15 +
  6 × 15 = **210 assertions** générées. Toute modification de la matrice de production
  casse le test → force une mise à jour consciente de l'ADR et de docs/12. C'est le
  garde-fou central.
- **Test de couverture des routes** : introspection du routeur NestJS ; toute route non
  explicitement listée comme publique doit porter `AuthGuard` **et** une métadonnée
  `@RequirePermission`. Une route ajoutée sans permission fait échouer la CI. C'est ce qui
  transforme « refus par défaut » d'une intention en une propriété vérifiée.
- **e2e par rôle** : huit sessions authentifiées, une par rôle organisation, une route
  représentative par action, assertions 200/403. Plus les cas plateforme avec et sans
  grant actif.
- **Tests des règles critiques** : dernier propriétaire (dont deux rétrogradations
  concurrentes), transfert atomique, auto-approbation refusée puis autorisée en mode
  `soleApprover`, clôture par un Comptable puis réouverture refusée, export journalisé
  (et export annulé si l'audit échoue), grant expiré → 403 immédiat, grant révoqué →
  403 en moins de 30 s.
- **Isolation inter-organisations** : le test e2e existant (ADR-0006) reste vert ;
  ajout du couple 403 (même org, rôle insuffisant) / 404 (autre org).
- **Migration** : test sur un jeu de documents v1 → v2, rejoué deux fois (idempotence),
  plus le test de non-régression sur la sélection d'organisation primaire.
- **Non-régression** : les 183+ tests de `main` passent sans modification ; modifier un
  test existant exige une justification en description de PR (règle ADR-0011).
- `pnpm format`, lint, typecheck verts avant PR.

## Liens

- `docs/12-ROLES-PERMISSIONS.md` (source des rôles, actions et règles critiques)
- `docs/17-SECURITE.md` §Autorisation, §Finance, §Journalisation
- `docs/16-API.md` (format d'erreur, `/audit-events`), `docs/26-CONVENTIONS.md`
- `docs/08-PREVISIONNEL-REALISE.md` (clôture/réouverture), `docs/07-PLAN-FINANCIER.md`
- ADR-0004 (transactions, `_schemaVersion`, migrations), ADR-0006 (better-auth —
  *superseded* sur la liste de rôles), ADR-0011 (contrats d'intégration, 404 cross-tenant)
- ADR-0013 (secrets d'intégration — consomme `platform_super_admin` et l'audit)
- `apps/api/src/auth/auth.guard.ts`, `apps/api/src/organizations/membership.schema.ts`,
  `apps/api/src/organizations/organizations.service.ts`
