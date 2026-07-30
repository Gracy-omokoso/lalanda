# Conventions de développement

**Statut :** Draft  
**Version :** 0.1

## Dépôt cible

```text
apps/
  web/
  api/
  worker/
packages/
  domain/
  financial-engine/
  country-packs/
  contracts/
  ui/
  config/
docs/
tests/
```

La structure finale est confirmée par ADR S1.

## Dépendances

Les packages de domaine et moteur ne dépendent pas du web. Les adaptateurs d’infrastructure dépendent des interfaces du domaine, pas l’inverse.

## Types

- pas de nombre flottant natif pour les montants officiels;
- dates et périodes typées;
- unités explicites;
- identifiants opaques;
- validation aux frontières;
- états représentés par unions fermées.

## Code

- noms de code en anglais cohérent;
- textes utilisateur externalisés;
- fonctions métier petites et pures;
- aucune règle financière dans un composant UI;
- erreurs métier codifiées;
- commentaires pour le pourquoi, pas pour répéter le code.

## Git

- changements petits et cohérents;
- branche dédiée;
- commits descriptifs;
- pull request avec exigences et tests;
- aucune donnée sensible;
- migration et documentation dans le même lot pertinent.

## Définition de prêt

Exigence comprise, critères d’acceptation, maquette ou contrat si nécessaire, données et règle pays disponibles, dépendances identifiées, stratégie de test.

## Définition de terminé

Code relu, tests, types, lint, sécurité, accessibilité applicable, observabilité, migrations, documentation et preuve de démonstration.

## Dette

Toute exception possède ticket, risque, propriétaire et échéance. Aucun `TODO` anonyme dans le moteur financier ou l’autorisation.
