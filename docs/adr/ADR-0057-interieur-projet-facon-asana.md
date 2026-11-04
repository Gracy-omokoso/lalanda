# ADR-0057 — Intérieur d'un projet « façon Asana » : Aperçu, Liste, Tableau, panneau de tâche

Statut : **Proposé** (à valider par la dirigeante sur les captures `docs/refonte-ui/v4/`)
Date : 2026-11-04
Décideur : Gracy Omokoso (dirigeante de Go freelance SARLU).

> Prolonge [ADR-0039](ADR-0039-projets-et-taches-run.md) § 8 (page d'un projet) et applique
> [ADR-0055](ADR-0055-themes-et-design-professionnel.md) / [ADR-0056](ADR-0056-ecran-factures-et-tableau-de-bord.md)
> (jetons, graphiques SVG maison, `StatusPill`, `--row-h`, mouvement 120/180/240 ms) à l'intérieur d'un
> projet. Aucune règle financière ; aucun montant.

## Contexte

L'équipe utilise les Projets au bureau dès le 5 nov. 2026. La dirigeante veut retrouver à l'intérieur
d'un projet le confort et la clarté d'Asana, dans le style Lalanda et ses trois thèmes. Les fonctions
existaient (Liste, Kanban, panneau, collaboration) ; il manquait une vue d'ensemble, des lignes denses,
la saisie en ligne et un panneau lisible.

## Décision

### 1. Onglets et entrée

Ordre : **Aperçu**, Liste, **Tableau** (l'ancien « Kanban », segment `kanban` inchangé), Chronologie,
Calendrier, **Fichiers** (l'ancien « Documents », segment `documents` inchangé), Marge, Réglages.
`/projets/<id>` mène à l'**Aperçu** ; `/projets/<id>?tache=<id>` (notifications, ADR-0039 § 2.11) mène à
la **Liste**, panneau ouvert (`ongletDEntree`, testé). Les liens existants vers `/liste` et `/kanban`
restent valides.

### 2. Statut de santé d'un projet — règle simple, calculée par le serveur

`GET /work/projects/:projectId/overview` (`work.read`, organisation active, 404 entre organisations).
Calcul pur partagé `computeWorkProjectOverview` (`@lalanda/shared/work`, testé), au **jour de Kinshasa**,
sur les tâches de **premier niveau** (comme la progression existante) :

| Statut | Règle |
|---|---|
| **En retard** | l'échéance du projet est dépassée alors que des tâches restent ouvertes, **ou** au moins 3 tâches ouvertes sont en retard et elles font au moins le quart des tâches ouvertes |
| **À risque** | au moins une tâche ouverte est en retard, **ou** l'échéance du projet tombe dans les 7 jours et moins de 75 % des tâches sont terminées |
| **En bonne voie** | sinon (projet sans tâche compris) ; un projet **terminé** est toujours « en bonne voie » |

Une tâche est **en retard** si elle est ouverte et que son échéance est antérieure à aujourd'hui.
La règle est affichée en clair (infobulle de l'étiquette, bloc « Statut » de l'Aperçu). Ce n'est pas un
statut saisi : aucun champ nouveau, aucune écriture.

Le même appel sert les **compteurs de commentaires** par tâche (Liste, Tableau) sans modifier la
projection des tâches.

### 3. Aperçu

Description, statut (étiquette, phrase, ouvertes / terminées / en retard / sans responsable),
anneau d'avancement, barres « tâches ouvertes par responsable », courbe des tâches terminées et créées
(cumul) sur les 8 dernières semaines (lundi de Kinshasa), jalons ouverts à venir (5), tâches en retard
(10, plus anciennes d'abord). Graphiques `DonutChart`, `BarList`, `LineChart` de `packages/ui`.

### 4. Liste, Tableau, panneau

- **Liste** : un groupe **repliable par colonne** (le modèle n'a pas de « sections » : la colonne en tient
  lieu, sans nouveau concept), lignes de 40 px (`--row-h`), **cercle à cocher** (coche dessinée et fond
  vert en 180 ms, optimiste, sans confettis), nom **éditable sur place** (Entrée / sortie : enregistre ;
  Échap : annule), avatar, échéance colorée (rouge en retard, vert aujourd'hui/demain, toujours écrite),
  priorité, étiquettes, compteurs sous-tâches et commentaires ; en-têtes de colonnes ; **« + Ajouter une
  tâche » en ligne** en bas de chaque groupe (Entrée crée et garde le champ ouvert) ; **« + Ajouter une
  section »** pour `work.manage` = nouvelle colonne « en cours » avant « Terminé » (même `PUT` que les
  Réglages, mêmes limites).
- **Tableau** : cartes épurées (cercle, nom, avatar, échéance, compteurs), « + Ajouter une tâche » en bas
  de chaque colonne, glisser-déposer et menu « Déplacer… » (clavier) conservés.
- **Panneau** : bouton « Marquer comme terminée », titre grand éditable, **grille de champs enregistrés
  à la volée** (Responsable, Échéance, Début, Projet et statut, Priorité, Dépendances, Étiquettes,
  Estimation, Jalon) — plus de bouton « Enregistrer » ; description enregistrée à la sortie du champ ;
  sous-tâches à cercles ; pièces jointes et temps ; puis le **fil** commentaires + activité, du plus
  ancien au plus récent, avec avatars et mentions, **zone de commentaire collée en bas**. Échap ferme,
  `?tache=` conservé.

### 5. Atomes et droits

`Avatar` (teinte stable par membre sur les paires `--label-*`), `PileAvatars`, `CercleCoche`,
`DateEcheance` dans `elements.tsx`. Un lecteur (`work.read` seul) ne voit ni cercle actif, ni ajout en
ligne, ni champ modifiable ; « Partager » (vers Organisation › Membres) n'apparaît qu'avec
`members.invite`. Le serveur reste seul juge.

## Conséquences

- Le panneau enregistre chaque champ aussitôt : un geste = un `PATCH` (révision attendue). Pendant un
  envoi, les champs sont désactivés pour éviter un conflit de révision.
- L'aperçu est relu 600 ms après la dernière écriture de tâche : le statut suit le travail sans
  recharger la page.
- Pas de vue « Chronologie » ni « Calendrier » refaites : alignement par les jetons seulement.

## Points ouverts

1. Seuils de la santé (3 retards / 25 %, 7 jours / 75 %) : à ajuster avec l'usage.
2. De vraies **sections** distinctes des statuts (comme Asana) : nouveau modèle, à décider si besoin.
3. Membres **du projet** (aujourd'hui : toute l'organisation lit ; la pile montre responsable et
   assignés).
