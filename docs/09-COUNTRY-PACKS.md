# Country Packs

**Statut :** Draft  
**Version :** 0.1

## Objectif

Isoler les paramètres dépendant d’un pays ou référentiel afin d’ajouter et maintenir des juridictions sans dupliquer le produit ni modifier les plans historiques.

## Contenu d’un pack

- pays, territoires couverts et codes normalisés;
- langues, formats de date et nombres;
- devise principale et devises admises;
- référentiel comptable et nomenclature;
- types de taxes et contributions;
- taux, seuils, assiettes, exceptions et dates d’effet;
- règles sociales utiles à la planification;
- calendriers et échéances indicatives;
- méthodes d’amortissement admises;
- règles d’arrondi et de présentation;
- libellés légaux;
- sources, date de vérification et expert validateur;
- avertissements et limites.

## Modèle de version

Un pack suit `draft → review → approved → active → retired`.

Une version active est immuable. Une correction crée une nouvelle version avec date d’effet et notes de migration. Un plan conserve sa version d’origine.

## Hiérarchie

```text
Référentiel commun
└── Zone/référentiel comptable
    └── Pays
        └── Version datée
            └── Paramètres spécifiques au secteur ou régime
```

Les surcharges sont explicites; aucune valeur implicite ne doit masquer son origine.

## Sources

Une règle réglementaire possède :

- URL ou référence officielle;
- organisme émetteur;
- titre;
- date de publication;
- période d’application;
- extrait ou résumé;
- date de dernière vérification;
- personne ou rôle ayant validé.

Les blogs et agrégateurs servent uniquement d’orientation. Les règles actives nécessitent une source officielle ou une validation professionnelle documentée.

## Pack initial RDC

Le premier pack cible la République démocratique du Congo et l’application pertinente de SYSCOHADA. Les taux et obligations seront renseignés après vérification officielle; ce document ne fixe aucun taux.

Travail requis :

- cartographier le plan comptable utilisé par les états Lalanda;
- identifier impôts, TVA, retenues et charges sociales nécessaires au prévisionnel;
- distinguer régime général, seuils et exceptions;
- établir les dates d’effet;
- faire valider par un professionnel local;
- produire des cas de référence.

## Sélection et changement

Le pays est choisi à la création du projet. Un changement après validation d’un plan crée une migration ou un nouveau projet/scénario; il ne recalcule jamais silencieusement l’historique.

## Administration

Les changements exigent permissions dédiées, double validation pour les règles critiques, aperçu des projets affectés, tests, journal d’audit et capacité de retrait rapide.

## Critères d’acceptation

- Toute valeur réglementaire affiche source et date.
- Un plan est reproductible avec une version retirée.
- Un pack incomplet ne peut pas être publié comme complet.
- Les tests détectent une période sans règle applicable.
- L’application avertit lorsque la règle nécessite une validation humaine.
