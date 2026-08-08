# Objectifs et mesures de succès

**Statut :** Draft  
**Version :** 0.1

## Objectifs produit

### O1 — Rendre la planification accessible

- taux de complétion du wizard;
- temps jusqu’au premier plan;
- abandon par étape;
- incohérences détectées avant validation.

### O2 — Produire un plan crédible et traçable

- concordance avec les cas de référence du classeur source;
- absence d’écart inexpliqué dans les exports;
- couverture des règles par tests;
- traçabilité des résultats jusqu’aux entrées.

### O3 — Transformer le plan en outil de pilotage

- projets ayant au moins une période de réalisé;
- fréquence mensuelle de retour;
- consultation des écarts et recommandations;
- actions suivies après une alerte.

### O4 — S’adapter à plusieurs pays

- temps nécessaire à l’ajout d’un Country Pack;
- part des règles configurables sans déploiement;
- couverture et date de validation de chaque pack;
- projets verrouillés sur une version de pack.

### O5 — Construire un SaaS viable

- activation après inscription;
- conversion essai vers abonnement;
- rétention à 3 et 12 mois;
- revenu mensuel récurrent;
- utilisation des limites de projets et membres.

## Objectifs financiers de l’utilisateur

Chaque projet enregistre au minimum :

- chiffre d’affaires cible à 1 an et à 5 ans;
- résultat net cible à 1 an et à 5 ans;
- trésorerie cible;
- objectif de croissance;
- objectifs facultatifs de marge, emplois et financement.

Ils sont comparés séparément au prévisionnel validé, au réalisé et à la dernière projection.

## Efficacité, efficience et performance

- **Efficacité** : degré d’atteinte de l’objectif.
- **Efficience** : atteinte de l’objectif au regard des ressources consommées.
- **Performance** : synthèse contextualisée des résultats, de l’efficacité, de l’efficience et du risque.

L’interface affiche toujours la cible, la valeur observée, l’écart, les causes et les actions suggérées. Les seuils exacts seront définis dans la spécification des diagnostics.

## Implémenté (S18d)

Première tranche des « Objectifs financiers de l’utilisateur » : saisie des cibles et taux d’atteinte **contre le plan validé**. Les deux autres bases de comparaison (réalisé, dernière projection) suivront avec le module Réalisé.

- **Modèle `FinancialObjectives`** (collection `financial_objectives`, module `apps/api/src/objectives/`) : un document par projet, cibles toutes optionnelles et ≥ 0 — `ca_cible_an1`, `ca_cible_an5`, `resultat_net_cible_an1`, `resultat_net_cible_an5`, `tresorerie_cible`. Montants exprimés dans la devise d’affichage du projet.
- **Endpoints** (AuthGuard + scope organisation, 404 cross-tenant) : `GET /projects/:id/objectives`, `PUT /projects/:id/objectives` (remplacement complet : une cible absente du corps est **effacée**, pas fusionnée), `GET /projects/:id/objectives/attainment`.
- **Validation zod** : objet `.strict()` — une clé d’objectif inconnue ou une cible négative est refusée en `400 INVALID_REQUEST`.
- **Taux d’atteinte** = `valeur observée / cible`, en %, arrondi à 0,1. Il est calculé **côté API** (docs/26 : aucune règle financière dans un composant d’interface) et **jamais par le moteur** : c’est une comparaison, pas un calcul financier.
- **Base de comparaison** : le snapshot du **dernier plan validé** (module `apps/api/src/plans/`, en lecture seule — aucune ré-exécution du moteur). Le mapping objectif → valeur observée se fait **par id de ligne** du snapshot (`ca_annuel_1`, `ca_annuel_5`, `resultat_annuel_1`, `resultat_annuel_5`, `tresorerie_fin_m12`), jamais par position dans un tableau. La réponse porte `source: 'plan_valide'`, `planVersion` et `planApprovedAt` pour que le chiffre affiché reste traçable.
- **Aucun plan validé** → `409 { code: 'NO_APPROVED_PLAN' }` : sans chiffres figés, il n’y a rien à comparer.
- **Ligne absente du snapshot** (par exemple `ca_annuel_5` sur un plan à horizon 3 exercices) → `atteinte: null` et `raison: 'LIGNE_INDISPONIBLE'`, **jamais 0, jamais une valeur inventée, jamais une erreur 500**. L’objectif s’activera de lui-même dès que le plan validé exposera la ligne.
- **Ligne présente mais valeur non exploitable** (`NaN`, `Infinity`) → même traitement, avec `raison: 'VALEUR_NON_NUMERIQUE'`. Sans cette garde, un `NaN` produirait un « non atteint » silencieux : un faux négatif présenté comme un jugement de performance.
- **Statuts** : `atteint` (≥ 100 %), `partiel` (≥ 80 %), `non_atteint` (< 80 %), `indisponible` (non mesurable). Le seuil « partiel » est provisoire — les seuils définitifs relèvent de la spécification des diagnostics (docs/10) ; il est renvoyé dans la réponse (`seuilPartielPct`) plutôt que codé en dur dans l’interface.
- **Web** : onglet « Objectifs » de la vue projet (`/projects/:id/objectifs`) — formulaire des cibles et carte d’atteinte affichant, par objectif, cible et valeur du plan validé avec une **pastille de couleur accompagnée du libellé de statut en toutes lettres** (la couleur ne porte jamais seule l’information). Un objectif non mesurable affiche « Non mesurable » et l’explique, sans taux.
- **Tests** : `apps/api/src/objectives/attainment.test.ts` (unitaires) et `apps/api/src/__tests__/objectives.e2e.test.ts` (cas chiffré sur plan validé seedé, 409 sans plan, ligne indisponible, isolation organisation).

### Reste à faire

Objectif de croissance, objectifs facultatifs de marge, emplois et financement ; comparaison au **réalisé** et à la **dernière projection** ; écart, causes et actions suggérées (docs/10) ; efficience et performance.

## Hors objectifs initiaux

- remplacer le jugement d’un expert-comptable;
- garantir l’obtention d’un financement;
- couvrir immédiatement tous les pays;
- devenir dès la V1 un logiciel complet de comptabilité, paie ou déclaration;
- laisser un modèle d’IA produire les montants officiels.
