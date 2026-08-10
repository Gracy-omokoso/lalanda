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

Le découpage en étapes est déclaré par le template via un bloc **optionnel**
`wizard: { etapes: [...] }` (`packages/engine/src/dsl/schema.ts`, conforme à ADR-0011
Contrat 3). Chaque étape porte `id`, `label`, `description`, `groupes` rattachés et
`ordre`. Le bloc est purement présentationnel : le compilateur et l’évaluateur
l’ignorent, et son absence laisse les templates S6–S14 valides à l’identique.

Résolution — implémentation **unique**, dans `@lalanda/shared/wizard`
(`resolveWizardEtapes`), appelée aussi bien par le moteur (`resolveEtapes`) que par le
web (`buildWizardSteps`) :

1. étapes déclarées, triées par `ordre` croissant, celles sans `ordre` restant dans
   l’ordre de déclaration et passant en dernier;
2. un groupe référencé mais inexistant est **ignoré**, et une étape dont plus aucun
   groupe ne subsiste est écartée;
3. tout groupe d’hypothèses non rattaché à une étape est ajouté en fin de parcours;
4. sans bloc `wizard` (ou toutes les étapes écartées) : **une étape par groupe
   d’hypothèses**;
5. sans groupes non plus : une étape unique portant tous les drivers;
6. une étape finale « Synthèse » est toujours ajoutée par l’interface.

Une clé de présentation ne peut jamais empêcher un template de parser ni le moteur
d’évaluer (ADR-0011, Contrat 3) : un renommage de groupe côté structure financière
dégrade le parcours de saisie, il ne met pas le moteur à terre. La cohérence stricte
est vérifiée par `findUnknownWizardGroupes` en **test de lint sur les templates
livrés**, où un bloc `wizard` désynchronisé doit être corrigé avant merge.

Les 3 templates de lancement déclarent leurs étapes : chiffre d’affaires → coûts
variables (hors prestation de services) → charges fixes et personnel → investissement et
financement → fiscalité. Le personnel vit dans `charges_fixes` et l’investissement dans
`financement` : ces deux étapes du tableau ci-dessus restent fusionnées tant que la
structure financière des templates ne les sépare pas.

### Validations

Trois niveaux, appliqués à la frappe (`validateDriver`) :

- **bloquante** : champ vide, texte non numérique, valeur hors `min`/`max` du DSL →
  bordure danger, message sous le champ, étape marquée en erreur dans la progression;
- **avertissement** : valeur atypique, c’est-à-dire dans les 5 % extrêmes de l’intervalle
  autorisé (ou exactement sur une borne unique) → message orange, n’empêche rien.
  Un `0` dont le plancher déclaré est `0` n’est jamais signalé : c’est une absence
  (pas d’employé, pas d’emprunt), pas une valeur atypique;
- **information** : `aide` du driver, affichée en permanence sous le champ, et badge
  « Valeur suggérée » tant que le champ porte le défaut du modèle — retiré dès la
  première frappe, pour ne jamais confondre suggestion et saisie.

L’écrêtage silencieux sur `min`/`max` hérité de S5a est **supprimé** : la valeur saisie
est conservée telle quelle et signalée.

Le respect des bornes est garanti **côté serveur**, seule autorité : `POST
/projects/:id/plans` rejette en `400 DRIVERS_OUT_OF_RANGE` (avec la liste des drivers
fautifs et leurs bornes) avant toute évaluation ou gel. L’interface refuse en plus les
exports PDF/Excel avec un message explicite. Conformément aux critères d’acceptation,
une erreur bloquante empêche la **validation et l’export**, jamais la **sauvegarde** :
un brouillon hors bornes reste persistable, un document remis à une banque non.

### Auto-save

Débounce de 800 ms sur l’endpoint drivers existant (`POST /projects/:id/drivers`).
États annoncés en `aria-live="polite"` : « Modifications non enregistrées… », «
Enregistrement… », « Enregistré à HH:MM:SS », erreur avec bouton « Réessayer ». La file
est vidée (`flush`) avant tout export et avant la validation d’un plan, qui figent les
valeurs persistées.

Deux garanties de non-perte (docs/06 § Critères — « aucune perte après actualisation ou
déconnexion ») : enregistrement immédiat au démontage du composant (une navigation
interne pendant le debounce ne perd rien) et confirmation native `beforeunload` tant
qu’une modification n’est pas acquittée par le serveur. Les enregistrements sont
sérialisés et numérotés : une réponse doublée par une plus récente est ignorée, pour ne
jamais marquer « enregistré » un instantané qui ne l’est pas.

### Synthèse

Récapitulatif par étape avec accès direct en modification, cadre du plan (modèle
sectoriel et version, devise, Country Pack et année, système comptable), avertissement
légal du pack et liste de ses paramètres `a_confirmer`, puis « Recalculer » et « Valider
ce plan ». Les résultats (onglets de feuilles et bandeau de ratios), les exports et la
liste des plans validés restent accessibles à toutes les étapes.

Le recalcul reste différé — il n’est pas déclenché à chaque frappe — mais l’obsolescence
est explicite : dès que les hypothèses divergent du dernier calcul, un bandeau
« Résultats obsolètes » et un bouton « Recalculer » s’affichent au-dessus des résultats,
depuis n’importe quelle étape.

### Place dans la navigation

> **Décision révisée le 2026-08-10.** Ce paragraphe décrivait l'arbitrage de S18d :
> « le wizard n'a pas d'onglet dédié, il **est** le contenu de l'onglet Plan », saisie
> et résultats en deux colonnes d'un même écran. Motif de l'époque : conserver
> l'aperçu immédiat de l'impact d'une hypothèse. **Ce n'est plus le cas.**
>
> À l'usage, les deux colonnes saturaient l'écran : l'assistant était comprimé, et les
> onze feuilles de résultats illisibles dans une demi-largeur. Le décideur a tranché
> pour la séparation après appréciation du produit en ligne.

L'assistant occupe **son propre écran**, en pleine largeur : `/projects/:id/saisie`.
Les résultats occupent la racine du projet, `/projects/:id`, en **lecture seule**, et
sont organisés en onglets — un par feuille réellement produite par le moteur, l'onglet
courant porté par `?tab=` pour qu'un lien soit partageable.

Modifier une hypothèse suppose donc de revenir explicitement dans l'assistant. C'est
le prix de la séparation, et c'est assumé : la lecture d'un dossier bancaire et sa
saisie sont deux gestes différents, faits à des moments différents.

**Aucune saisie n'est perdue au passage.** Le bouton « Voir les résultats » vide la
file d'auto-save AVANT de naviguer, et ne navigue pas si l'enregistrement échoue — la
fenêtre de 800 ms de l'auto-save ne peut donc pas avaler la dernière frappe.

**« Valider ce plan » reste en fin d'assistant**, et à cet endroit seulement : figer
une version est un acte versionné, et deux chemins pour un même acte fort est une
invitation à l'erreur.

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
- provenance **fine** d’une valeur suggérée : le champ distingue « saisi » de « défaut
  du modèle », mais n’expose pas encore l’origine exacte d’un défaut (template ou
  ParameterPack — cette dernière n’est visible que dans la synthèse);
- tests de rendu React (apps/web n’a pas d’environnement DOM : seule la logique pure du
  wizard est couverte par vitest).

## Critères d’acceptation

- Aucune perte après actualisation ou déconnexion.
- Les erreurs bloquantes empêchent la validation, pas la sauvegarde.
- Chaque montant indique devise et période.
- Chaque valeur par défaut expose sa source.
- Une version validée des entrées peut être reproduite.
