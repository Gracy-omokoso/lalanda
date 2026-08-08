# Rôles et permissions

**Statut :** Draft  
**Version :** 0.1

## Modèle

Le contrôle combine rôle, organisation, projet, action et conditions. Les contrôles sont exécutés côté serveur. Le rôle définit un ensemble par défaut; des restrictions de projet peuvent le réduire.

## Rôles plateforme

| Rôle | Portée |
|---|---|
| Super administrateur | contrôle total, attribution des rôles internes |
| Administrateur plateforme | organisations, utilisateurs, paramètres non critiques |
| Support | diagnostic limité, accès temporaire approuvé |
| Finance/facturation | abonnements, paiements, factures |
| Éditeur de templates | templates sectoriels et versions |
| Gestionnaire comptable/fiscal | Country Packs et validations |

Le support ne voit jamais les données financières sans consentement explicite, durée limitée et audit.

## Rôles organisation

| Rôle | Capacités principales |
|---|---|
| Propriétaire | abonnement, membres, suppression et transfert |
| Administrateur | membres, projets, paramètres |
| Directeur financier | plans, validation, réalisé, rapports |
| Comptable | réalisé, mapping, clôture selon permission |
| Analyste | scénarios, analyses, commentaires |
| Chef de projet | projets autorisés et saisie |
| Conseiller | consultation, commentaires, recommandations |
| Lecteur | lecture seulement |

## Actions granulaires

`organization.manage`, `billing.manage`, `members.invite`, `project.create`, `project.read`, `project.update`, `canvas.update`, `inputs.update`, `plan.calculate`, `plan.approve`, `actuals.import`, `period.close`, `analytics.read`, `report.export`, `audit.read`.

## Règles critiques

- Un propriétaire ne peut pas retirer le dernier propriétaire sans transfert.
- Validation de plan et modification des entrées sont séparées.
- Une clôture et une réouverture peuvent exiger deux permissions distinctes.
- Les exports sensibles sont journalisés.
- Les changements de Country Pack sont réservés aux rôles plateforme habilités et suivent un workflow d’approbation.
- L’usurpation de session support est limitée, visible et auditée.

## Invitations

Une invitation expire, est liée à une organisation, indique rôle et projets, et peut être révoquée. Une adresse déjà membre ne crée pas de doublon.

## Tests obligatoires

Matrice rôle/action, isolation entre organisations, restrictions de projet, révocation immédiate, invitation expirée, dernier propriétaire, support temporaire et protection des exports.

## Implémenté (S20a)

Référence : ADR-0012 (Accepted, 2026-08-08). La source de vérité exécutable est
`apps/api/src/authz/permissions.ts` — aucun `if (role === …)` ne vit ailleurs.

### Rôles

Les 8 rôles d'organisation sont livrés, en slugs `snake_case` : `owner`, `admin`,
`finance_director`, `accountant`, `analyst`, `project_manager`, `advisor`,
`viewer`. Les 6 rôles plateforme sont préfixés `platform_` et vivent dans une
collection distincte : un rôle plateforme est indépendant de toute appartenance à
une organisation.

Trois actions restent **interdites à tous les rôles plateforme, y compris au
super-administrateur** : `plan.approve`, `period.close`, `report.export`. Un
employé de la plateforme ne valide jamais un plan client et n'exporte jamais ses
données.

### Migration depuis `owner | member`

`owner` conserve sa valeur — aucun document à réécrire. `member` devient
`finance_director`, choisi **par iso-privilège** : avant S20a un `member` pouvait
créer des projets, saisir des hypothèses et calculer. `finance_director` reproduit
exactement ces droits sans en ajouter (`admin` aurait accordé `members.invite` et
`organization.manage`, un `analyst` aurait retiré `project.create`). Script
idempotent piloté par `_schemaVersion` :
`apps/api/migrations/20260808-0001-rbac-roles-organisation.mjs`.

L'API accepte encore `member` en entrée pendant une version (compatibilité N-1).

### Rang de privilège explicite

`ORG_ROLE_RANK` classe les rôles par un ordre total stable. Il existe pour une
raison concrète : la sélection de l'organisation primaire s'appuyait sur un
`.sort({ role: -1 })` qui exploitait l'ordre alphabétique des deux anciennes
valeurs (`'owner' > 'member'`). Avec huit slugs, `'viewer' > 'project_manager' >
'owner'` — un utilisateur propriétaire d'une organisation et lecteur d'une autre
basculait silencieusement sur la mauvaise. Le rang est désormais une donnée, pas
un effet de bord du tri. Il ne se dérive pas de la matrice : deux rôles peuvent
avoir des ensembles d'actions incomparables.

### Séparation validation / saisie, et l'entrepreneur seul

`plan.approve` et `inputs.update` ne sont pas détenus par les mêmes rôles
subalternes. Appliquée telle quelle, cette règle rendrait le produit inutilisable
pour une organisation d'une seule personne — le cas majoritaire en RDC.

Le plan validé porte donc `approval.soleApprover` et `approval.inputsAuthor` : un
propriétaire unique membre de son organisation peut saisir puis valider, et le
fait qu'il ait été son propre approbateur est **tracé dans le snapshot du plan**.
La séparation des tâches n'est pas contournée en silence, elle est documentée sur
la pièce elle-même.

### Journal d'audit

Collection `audit_events` (acteur, action, cible, organisation, date), alimentée
par la validation de plan et l'export de rapport. Lecture réservée aux rôles
portant `audit.read`.

### Couverture de tests

- Matrice rôle × action : 210 cas unitaires, exhaustifs (une case absente ne
  compile pas).
- Matrice appliquée bout en bout : 91 cas vérifiés sur le réseau — la preuve que
  les guards l'appliquent, pas seulement qu'elle est déclarée.
- Règles critiques : 18 cas e2e, dont le parcours entrepreneur seul, le dernier
  propriétaire non rétrogradable sans transfert, la révocation immédiate,
  l'invitation expirée et l'isolation entre organisations.
- Couverture des routes : un test échoue si une route sensible ne déclare aucune
  permission.

### Reste à faire

- **Restrictions par projet** (`✓P` dans la matrice d'ADR-0012) : un
  `project_manager` est aujourd'hui limité au niveau organisation, pas au
  sous-ensemble de projets qui lui est assigné.
- **Usurpation de session support** : les rôles plateforme sont posés, mais les
  `support_grants` (accès délégué consenti, limité dans le temps et audité) ne
  sont pas implémentés. Le support n'a donc aucun accès aux données clientes —
  refus par défaut, ce qui est le bon état par défaut.
- **MFA** : docs/17 l'exige pour les rôles sensibles. Absent. On se rabat sur la
  ré-authentification par mot de passe, plus faible que la cible. À lever avant
  d'ouvrir `/admin` en production.
