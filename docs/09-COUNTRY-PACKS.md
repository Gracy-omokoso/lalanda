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

## Amortissements SYSCOHADA révisé (AUDCIF 2017)

Les durées standard livrées dans les packs OHADA (RDC, CI, SN, générique) sont
consommées par la feuille moteur `amortissements` (méthode linéaire, prorata
temporis 1re année). Elles servent de valeur par défaut par catégorie
d’immobilisation et peuvent être surchargées ligne par ligne quand la nature
de l’actif justifie une durée différente à l’intérieur des plages admises.

| Catégorie                     | Durée standard | Plage indicative |
| ----------------------------- | -------------- | ---------------- |
| Constructions                 | 20 ans         | 20 ans           |
| Matériel et outillage         | 10 ans         | 5 à 10 ans       |
| Matériel de transport         | 5 ans          | 4 à 5 ans        |
| Matériel informatique         | 3 ans          | 3 ans            |
| Mobilier de bureau            | 10 ans         | 10 ans           |
| Aménagements, agencements     | 10 ans         | 10 ans           |
| Logiciels                     | 3 ans          | 3 ans            |

**Sources :** Acte Uniforme SYSCOHADA relatif au droit comptable et à
l’information financière (AUDCIF), révisé 2017, Titre I chapitre 3 —
immobilisations amortissables ; guide d’application SYSCOHADA révisé,
tables sectorielles indicatives.

**Avertissement :** ces durées sont conformes aux usages du référentiel
SYSCOHADA mais restent indicatives. Pour un dossier bancaire officiel, elles
doivent être revalidées par un expert-comptable local, en particulier
lorsque plusieurs valeurs sont admises (matériel : 5-10, transport : 4-5).

## Critères d’acceptation

- Toute valeur réglementaire affiche source et date.
- Un plan est reproductible avec une version retirée.
- Un pack incomplet ne peut pas être publié comme complet.
- Les tests détectent une période sans règle applicable.
- L’application avertit lorsque la règle nécessite une validation humaine.
