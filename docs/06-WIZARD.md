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

## Critères d’acceptation

- Aucune perte après actualisation ou déconnexion.
- Les erreurs bloquantes empêchent la validation, pas la sauvegarde.
- Chaque montant indique devise et période.
- Chaque valeur par défaut expose sa source.
- Une version validée des entrées peut être reproduite.
