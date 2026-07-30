# Stratégie de tests

**Statut :** Draft  
**Version :** 0.1

## Pyramide

- unitaires : formules, règles, validations et permissions;
- intégration : base, files, stockage, paiement et Country Packs;
- contrats : API et événements;
- parcours : onboarding, wizard, validation, réalisé, export;
- non fonctionnels : sécurité, performance, accessibilité et reprise.

## Moteur financier

Chaque formule possède cas normal, limites, zéros, valeurs négatives, arrondis et propriétés invariantes.

Golden files :

- entrées extraites du classeur source;
- résultats attendus;
- version de référence;
- tolérance documentée;
- justification de tout écart.

Les résultats API, écran, Excel et PDF sont comparés à la même exécution.

## Validation Excel

Les classeurs générés sont ouverts et recalculés par LibreOffice en automatisation. Les tests contrôlent absence d’erreur de formule, feuilles, cellules clés, formats et valeurs attendues.

## Multi-tenant et permissions

Tests systématiques de lecture, écriture, recherche, export, tâche asynchrone et URL de fichier entre deux organisations. Toute nouvelle ressource cliente ajoute ces cas.

## Country Packs

- périodes avant/après date d’effet;
- règle absente;
- surcharge;
- version retirée;
- source obligatoire;
- reproduction historique;
- publication empêchée si validation incomplète.

## Imports

Fichiers volumineux, colonnes manquantes, types invalides, doublons, formules malveillantes, encodages, annulation et idempotence.

## Performance

Budgets à fixer pour navigation, calcul, export, import et dashboards. Les tests utilisent volumes réalistes par plan et détectent les requêtes non bornées.

## Accessibilité

Contrôles automatisés et scénarios clavier/lecteur d’écran sur onboarding, wizard, tableaux, modales et erreurs.

## CI

Sur pull request : format, lint, types, unitaires, contrats et sécurité rapide. Sur branche principale : intégration, golden files et parcours. Planifié : dépendances, performance et restauration.

## Sortie

Un défaut financier ou d’isolation bloque la livraison. Les exceptions documentent risque, propriétaire, échéance et mesure compensatoire.
