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

## Modèle générique et questionnaire de cadrage (S23b)

### Le modèle `custom`

Un cinquième modèle, `packages/engine/src/templates/custom.yaml`, sert les
utilisateurs dont le secteur n'est pas dans la liste. Il reprend **exactement
l'ossature d'étapes** des modèles sectoriels (mêmes ids, même ordre : chiffre
d'affaires → coûts variables → charges fixes et personnel → investissement et
financement → fiscalité), de sorte que les liens profonds `?champ=` et les tests
de parcours restent valables partout.

Sa particularité est **éditoriale** : il ne nomme aucun secteur ni aucune ville.
Les modèles sectoriels s'autorisent des fourchettes de marché dans l'aide de
leurs drivers parce qu'ils savent de quel métier ils parlent ; celui-ci ne le
sait pas, et une fourchette inventée pour un métier inconnu serait une hypothèse
déguisée en conseil — que l'utilisateur recopierait. L'aide dit donc ce que le
champ mesure et où le trouver dans ses propres documents. Un test le vérifie sur
tous les libellés, aides, étapes et immobilisations. Les trois drivers de BFR
partent à `0` pour la même raison : une absence assumée plutôt qu'une moyenne
sectorielle qui ne serait celle de personne.

### Les deux chemins

Choisir ce modèle ouvre un dialogue à deux chemins, nommés par le **livrable**
avec lequel on repart :

- **« Mon plan financier, tout de suite »** — l'utilisateur nomme son projet et
  entre directement dans l'assistant, à l'étape du chiffre d'affaires. C'est le
  seul modèle qui atterrit sur `/projects/:id/saisie` plutôt que sur les
  résultats;
- **« Mon Business Model Canvas d'abord »** — un questionnaire d'une quinzaine
  d'écrans, un champ par écran, **dans le dialogue**.

« Commencer directement » et « en savoir plus » ont été écartés : ils décrivent
un geste et une promesse vague, et ne permettent pas de choisir sans avoir
essayé.

### Le questionnaire

- **un champ par étape**, progression `Étape n sur N` doublée d'une barre
  `role="progressbar"`, focus déplacé sur le titre à chaque changement d'étape;
- **retour arrière sans perte** : les réponses vivent dans l'état du dialogue et
  les sorties sont des fonctions pures de ces réponses — corriger une étape déjà
  passée équivaut à l'avoir saisie ainsi du premier coup;
- **trois échappatoires**, à toutes les étapes : « Passer » (avance sans rien
  écrire), « Arrêter ici et passer à la saisie » (crée le projet avec ce qui a
  été répondu), et le retour aux deux choix (conserve les réponses). Un
  questionnaire dont on ne peut pas sortir est un piège;
- **une seule réponse obligatoire**, le nom du projet : sans lui aucun projet ne
  peut être créé, donc aucune sortie n'est possible.

### Les champs numériques

Ils sont rendus par `WizardField`, le composant de l'assistant : mêmes bornes,
même unité, même validation à trois niveaux, même badge « Valeur suggérée ». Une
question numérique ne porte que l'**id de son driver** ; libellé, unité et bornes
viennent du template, jamais d'une copie.

Tant que l'utilisateur n'a pas touché le champ, la valeur affichée est le défaut
du modèle et **rien n'est posé**. Sans cette distinction, passer une étape
reviendrait à saisir le défaut sans le savoir — et un défaut du modèle
deviendrait, silencieusement, une hypothèse de l'utilisateur.

Drivers couverts : `ca_moyen_jour`, `jours_ouverture_mois`, `marge_brute_pct`,
`personnel_mois`, `loyer_mois`. Tout le reste part des défauts et se complète
dans l'assistant.

### Ce qui est annoncé à l'arrivée

L'assistant affiche un encadré « Ce que vos réponses ont prérempli » : le nombre
de cartes de Canvas écrites (avec le lien vers le Canvas), puis **chaque
hypothèse préremplie, nommée, avec sa valeur et son unité**. Un montant posé sans
qu'on sache d'où il vient n'est jamais relu — il a l'air d'avoir été saisi.

### Restes propres à ce parcours

- les réponses ne survivent pas à une fermeture complète du dialogue par la croix
  (elles survivent au retour aux deux choix, pas à un rechargement de page);
- `relations_clients` et `activites_cles` ne sont pas couverts par le
  questionnaire (voir docs/05);
- « charges » du brief est couvert par deux drivers sur trois : les autres
  charges d'exploitation restent à saisir dans l'assistant.

## Critères d’acceptation

- Aucune perte après actualisation ou déconnexion.
- Les erreurs bloquantes empêchent la validation, pas la sauvegarde.
- Chaque montant indique devise et période.
- Chaque valeur par défaut expose sa source.
- Une version validée des entrées peut être reproduite.
