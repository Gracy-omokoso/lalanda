# ADR-0058 — Accueil des projets et « Mes tâches » façon Asana, prêts pour l'équipe

Statut : **Proposé** (à valider par la dirigeante sur les captures `docs/refonte-ui/v4/`)
Date : 2026-11-04
Décideur : Gracy Omokoso (dirigeante de Go freelance SARLU).

> Prolonge [ADR-0039](ADR-0039-projets-et-taches-run.md) (module `work`, libellé « Projets ») et
> [ADR-0056](ADR-0056-ecran-factures-et-tableau-de-bord.md) (modèle visuel : `StatusPill`, jetons
> `--chart-*`, `--row-h`, mouvement 120/180/240 ms). Ne touche ni l'intérieur d'un projet
> (`/projets/[id]/**`, chantier parallèle) ni les droits `work.*`.

## Contexte

Toute l'équipe utilise le module Projets à partir du 5 nov. 2026. La dirigeante veut un accueil
« à la Asana » : voir d'un coup d'œil où en est chaque projet, et une liste « Mes tâches » où l'on
coche en un clic. L'API ne rendait que des compteurs bruts (`GET /work/projects`) : ni santé, ni
membres, ni chiffres de l'organisation.

## Décision

### 1. `GET /work/portfolio?scope=mine|all|archived` (`work.read`)

Organisation active de la session, `@RequireFeature('run_work')` comme le reste du module. Rend, pour
au plus 500 projets (borne technique d'ADR-0039 ; au-delà `truncated: true`, dit à l'écran) : nom,
nature, statut, client, responsable, échéance, nombre de tâches, terminées, en retard, jalons en
retard, **avancement** (terminées / toutes, entier arrondi vers le bas), **santé**, **membres**
(responsable puis assignés des tâches, par nombre de tâches ; 5 avatars, `memberCount` pour le
total), **couleur** et `mine`. Chiffres de l'organisation, projets non archivés, **quel que soit le
filtre** : projets au statut actif, tâches ouvertes en retard, tâches terminées depuis lundi 0 h
(Kinshasa). Contrat et règles pures : `@lalanda/shared/work` (`portfolio.ts`).

**Visibilité** : inchangée (ADR-0039, `visibility: 'organization'`) — tout détenteur de `work.read`
voit tous les projets de son organisation. « Mes projets » = responsable du projet, ou assigné ou
abonné d'au moins une tâche. Il n'existe **pas** de liste de membres d'un projet : un membre de
l'organisation « rejoint » un projet quand on lui en confie la responsabilité ou une tâche.

### 2. Santé d'un projet (règle simple, documentée)

| Santé | Règle |
|---|---|
| **En retard** | l'échéance du projet est passée (jour de Kinshasa) et des tâches restent ouvertes |
| **À risque** | sinon : au moins un **jalon** en retard, ou au moins **3** tâches en retard (seuil S7 d'ADR-0039 § 6.5, le même que le brief du matin) |
| **En bonne voie** | sinon |
| *Terminé / Archivé* | statut du projet : la santé ne s'applique plus |

Un projet « en pause » garde sa santé, suffixée « · en pause ». Le seuil reste celui de la décision
ouverte n° 11 d'ADR-0039 ; le changer change les deux écrans à la fois.

### 3. « Mes tâches » en sections de semaine civile

Le serveur garde ses groupes (`groupMyTasks` : retard, aujourd'hui, 7 jours, plus tard, sans date).
L'écran les présente en **En retard · Aujourd'hui · Cette semaine · Plus tard · Sans échéance**,
« Cette semaine » allant du lendemain au **dimanche** de la semaine du jour `asOf` rendu par le
serveur (jour de Kinshasa) ; l'ordre du serveur est conservé. Le dimanche, « Cette semaine » est
vide. « Récemment assignées » n'est **pas** proposée : l'API ne date pas l'assignation.

Ligne dense (`--row-h`), cercle à cocher qui termine en un clic (coche tracée en 180 ms, coupée
sous `prefers-reduced-motion`), titre (toute la ligne ouvre `/projets/<id>/liste?tache=<id>`),
projet avec sa pastille, échéance écrite et colorée. Ajout rapide : titre, projet actif, échéance
facultative ; la tâche est assignée à l'appelant (`work.update`). Onglets Liste · Calendrier · Temps
communs aux trois vues.

### 4. Couleur d'un projet

Aucun champ couleur n'est stocké : la pastille est tirée de l'identifiant (FNV-1a) dans la palette
fermée des étiquettes, **sans gris ni rouge** (le rouge se lirait « alerte »). Elle est stable et
identique dans l'accueil et dans « Mes tâches ». Choisir sa couleur demanderait un champ en base :
reporté.

## Conséquences

- Aucune écriture nouvelle, aucune collection, aucun index : l'agrégation lit l'index
  `organizationId, projectId, …` existant.
- **Piège relevé pour le déploiement** : le rôle proposé par défaut à l'invitation est « Lecteur »,
  qui n'a pas `work.update` ; un Lecteur ne peut ni cocher ni être responsable d'une tâche
  (`WORK_ASSIGNEE_NOT_ELIGIBLE`). Pour l'équipe : inviter en « Analyste » (ou Commercial, Comptable,
  Responsable RH, Magasinier selon le métier), ou accorder `work.update` en écart. Fixé par un test.
- Les notifications de rappel d'échéance dépendent de l'ordonnanceur (`work.due-reminders`) ;
  l'assignation et la mention sont immédiates.

## Points ouverts

1. Faut-il une vraie liste de membres par projet (et des projets privés) ? Aujourd'hui tout le monde
   voit tout.
2. Couleur choisie par projet (champ stocké) plutôt que tirée de l'identifiant ?
3. Seuil « à risque » (S7) : 3 tâches en retard, ou un pourcentage des tâches ouvertes ?
4. Rôle par défaut de l'invitation : passer à « Analyste » pour les équipes qui utilisent Projets ?
