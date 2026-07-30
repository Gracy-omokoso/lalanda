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
