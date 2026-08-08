# Workflows et machines d’état

**Statut :** Draft  
**Version :** 0.1

## Projet

`draft → active → archived → restored`  
Suppression : demande, délai de récupération, purge selon politique.

## Scénario

`draft → ready → calculating → calculated → approved`

Transitions d’erreur : `calculation_failed`, retour à `draft` après modification. Un scénario approuvé reste lisible; une évolution crée un dérivé.

## Plan

`approved → superseded`  
Un plan n’est ni modifié ni supprimé par une opération ordinaire.

### Implémenté (S16c — FIN-003)

- Un plan naît `approved` via `POST /projects/:id/plans` (version incrémentale par projet). La validation de vN+1 bascule automatiquement vN en `superseded` — seule mutation autorisée sur un plan existant.
- Transition refusée : re-valider des entrées identiques (même empreinte SHA-256 canonique des drivers résolus + template + pack + version moteur) → `409 { code: 'PLAN_UNCHANGED' }`. Une validation concurrente sur la même version → `409 { code: 'PLAN_VERSION_CONFLICT' }` (index unique `{projectId, version}`).
- Les exports `?planVersion=N` référencent la version exacte du plan et son empreinte, et repartent du snapshot figé sans recalcul (voir docs/07 § Version validée). Limite connue : pas de ré-exécution des moteurs historiques — seule la mise en forme utilise le template courant.

## Période réalisée

`open → review → closed → reopened → closed`

La réouverture exige permission et motif. Les modifications après réouverture sont auditables.

### Implémenté (S18b)

- Machine d’état réduite à `open ↔ closed` : l’état `review` et le workflow de validation par un tiers ne sont pas livrés. Une période naît `open` au premier `PUT /projects/:id/actual-periods/:year/:month`, ou vide à la clôture d’un mois sans activité.
- Transitions refusées explicitement : saisir sur une période clôturée → `409 { code: 'PERIOD_CLOSED' }` ; re-clôturer → `409 { code: 'PERIOD_ALREADY_CLOSED' }` ; rouvrir une période ouverte → `409 { code: 'PERIOD_NOT_CLOSED' }`.
- Réouverture = action sensible : **owner de l’organisation uniquement** (`403 REOPEN_OWNER_ONLY`), motif non vide obligatoire (`400 REOPEN_REASON_REQUIRED`), et trace append-only `{ reopenedAt, reopenedBy, reason }` jamais purgée. Voir docs/08 § Implémenté (S18b).

## Country Pack

`draft → review → approved → active → retired`

Publication soumise aux tests, sources obligatoires et validation métier.

## Import

`uploaded → mapped → validated → processing → completed`

Branches : `rejected`, `failed`, `rolled_back`. Chaque étape est idempotente.

## Export

`requested → queued → rendering → validating → available → expired`

Branche `failed`. Un export disponible référence la version exacte du plan et une empreinte.

## Abonnement

`trialing → active → past_due → grace → suspended → canceled`

Les webhooks sont vérifiés et idempotents. Les capacités sont dérivées de l’état et du catalogue.

## Alerte et action

Alerte : `new → acknowledged → resolved → dismissed`.  
Action : `open → in_progress → done` ou `canceled`.

## Invitations

`pending → accepted`, `expired` ou `revoked`.

## Règles communes

- transition autorisée côté serveur;
- acteur et motif pour action sensible;
- événement d’audit;
- notification éventuelle;
- traitement répétable sans doublon;
- refus explicite d’une transition invalide.
