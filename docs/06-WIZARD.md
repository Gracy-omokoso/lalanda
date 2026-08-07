# Wizard de saisie financière

**Statut :** Draft  
**Version :** 0.1

## Objectif

Collecter les entrées nécessaires au moteur financier dans un ordre compréhensible, avec sauvegarde continue, validation progressive et explications adaptées au pays et au secteur.

## Structure

| Étape | Contenu | Sortie |
|---|---|---|
| 1 | identité, activité, dates | cadre du projet |
| 2 | objectifs 1 an/5 ans | cibles mesurables |
| 3 | offres, prix, volumes | hypothèses de revenus |
| 4 | investissements | immobilisations et calendrier |
| 5 | apports, dettes, subventions | financement initial |
| 6 | achats et coûts variables | coût des ventes |
| 7 | charges fixes | structure de coûts |
| 8 | personnel | effectifs et charges |
| 9 | délais d’encaissement/décaissement | BFR |
| 10 | paramètres fiscaux | règles du Country Pack |
| 11 | trésorerie initiale | solde d’ouverture |
| 12 | synthèse | corrections et validation |

## Métadonnées d’un champ

- clé stable;
- libellé et description;
- catégorie;
- type et unité;
- devise;
- périodicité;
- caractère obligatoire;
- valeur par défaut et provenance;
- contraintes;
- dépendances et condition d’affichage;
- aide et exemple;
- référence au Country Pack;
- niveau de sensibilité;
- droits de lecture/modification.

## Comportement

- sauvegarde au changement avec confirmation visible;
- reprise à la dernière étape;
- navigation arrière sans perte;
- ajout de lignes répétables;
- duplication d’une hypothèse;
- import contrôlé lorsque disponible;
- progression calculée sur les champs applicables;
- recalcul différé tant qu’une entrée est invalide;
- aperçu de l’impact après calcul.

## Validation

Trois niveaux :

- **bloquante** : type invalide, date incohérente, total impossible;
- **avertissement** : croissance inhabituelle, marge faible, donnée manquante non essentielle;
- **information** : suggestion ou explication.

Une valeur suggérée n’est jamais confondue avec une valeur saisie. Sa provenance reste visible.

## États et collaboration

Une étape peut être non commencée, en cours, à revoir ou validée. Les membres autorisés peuvent commenter et assigner une étape. Deux modifications concurrentes déclenchent une résolution explicite.

## Validation finale

Avant le calcul officiel, Lalanda affiche :

- hypothèses principales;
- champs non renseignés;
- avertissements;
- Country Pack et version;
- devise et politique d’arrondi;
- période et granularité;
- confirmation de l’utilisateur.

## Implémenté (S18c)

### Structure

Le découpage en étapes est déclaré par le template via un champ **optionnel** `etapes`
(`packages/engine/src/dsl/schema.ts`) : `id`, `label`, `description`, `groupes` rattachés
et `ordre`. Le champ est purement présentationnel — le moteur l’ignore à l’évaluation.

Résolution (`resolveEtapes`, mêmes règles côté web dans `buildWizardSteps`) :

1. étapes déclarées, triées par `ordre` croissant, celles sans `ordre` restant dans
   l’ordre de déclaration et passant en dernier;
2. tout groupe d’hypothèses non rattaché à une étape est ajouté en fin de parcours;
3. sans `etapes` : **une étape par groupe d’hypothèses**;
4. sans groupes non plus : une étape unique portant tous les drivers;
5. une étape finale « Synthèse » est toujours ajoutée par l’interface.

Une étape référençant un groupe inexistant échoue au build (`UNKNOWN_GROUPE`), de sorte
qu’un renommage de groupe ne peut pas faire disparaître des champs silencieusement.

Les 3 templates de lancement déclarent leurs étapes : chiffre d’affaires → coûts
variables (hors prestation de services) → charges fixes et personnel → investissement et
financement → fiscalité. Le personnel vit dans `charges_fixes` et l’investissement dans
`financement` : ces deux étapes du tableau ci-dessus restent fusionnées tant que la
structure financière des templates ne les sépare pas.

### Validations

Trois niveaux, appliqués à la frappe (`validateDriver`) :

- **bloquante** : champ vide, texte non numérique, valeur hors `min`/`max` du DSL →
  bordure danger, message sous le champ, étape marquée en erreur dans la progression,
  bouton « Valider ce plan » désactivé;
- **avertissement** : valeur atypique, c’est-à-dire dans les 5 % extrêmes de l’intervalle
  autorisé (ou exactement sur une borne unique) → message orange, n’empêche rien;
- **information** : `aide` du driver, affichée en permanence sous le champ.

L’écrêtage silencieux sur `min`/`max` hérité de S5a est **supprimé** : la valeur saisie
est conservée telle quelle et signalée. Conformément aux critères d’acceptation, une
erreur bloquante empêche la validation du plan, jamais la sauvegarde.

### Auto-save

Débounce de 800 ms sur l’endpoint drivers existant (`POST /projects/:id/drivers`).
États annoncés en `aria-live="polite"` : « Modifications non enregistrées… », «
Enregistrement… », « Enregistré à HH:MM:SS », erreur avec bouton « Réessayer ». La file
est vidée (`flush`) avant tout export et avant la validation d’un plan, qui figent les
valeurs persistées.

### Synthèse

Récapitulatif par étape avec accès direct en modification, cadre du plan (modèle
sectoriel et version, devise, Country Pack et année, système comptable), avertissement
légal du pack et liste de ses paramètres `a_confirmer`, puis « Recalculer » et « Valider
ce plan ». Les résultats (onglets de feuilles et bandeau de ratios) restent visibles à
toutes les étapes.

### Accessibilité

`aria-current="step"` sur l’étape courante, `role="progressbar"` doublé d’un compteur
textuel n/N, statut d’étape porté par une pastille **et** un libellé, `aria-invalid` et
`aria-describedby`/`aria-errormessage` reliant chaque champ à ses messages, focus déplacé
sur le titre de l’étape après navigation, tables financières défilables sur mobile.

### Restes

- reprise automatique à la dernière étape consultée (l’étape n’est pas persistée);
- états d’étape « à revoir » / « validée », commentaires et assignation;
- lignes répétables, duplication d’hypothèse et import contrôlé;
- résolution des modifications concurrentes;
- provenance visible d’une valeur suggérée au niveau du champ (elle n’est aujourd’hui
  exposée que pour les paramètres du pack, dans la synthèse);
- tests de rendu React (apps/web n’a pas d’environnement DOM : seule la logique pure du
  wizard est couverte par vitest).

## Critères d’acceptation

- Aucune perte après actualisation ou déconnexion.
- Les erreurs bloquantes empêchent la validation, pas la sauvegarde.
- Chaque montant indique devise et période.
- Chaque valeur par défaut expose sa source.
- Une version validée des entrées peut être reproduite.
