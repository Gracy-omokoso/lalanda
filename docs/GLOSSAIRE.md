# Glossaire

**Statut :** Draft évolutif

| Terme | Définition de travail |
|---|---|
| BFR | Besoin en fonds de roulement lié au décalage entre flux d’exploitation |
| CAF | Capacité d’autofinancement générée par l’activité |
| Canvas | Business Model Canvas en neuf blocs |
| Country Pack | Ensemble versionné de règles et paramètres propres à une juridiction |
| DSCR | Capacité à couvrir le service de la dette |
| Efficacité | Degré d’atteinte d’un objectif |
| Efficience | Atteinte d’un objectif relativement aux ressources consommées |
| Initiative | Objet de BUILD qui réunit Canvas, objectifs, plan financier, réalisé et business plan (anciennement « projet » à l'écran ; nom interne inchangé : `Project`, API `/projects`) — ADR-0038 |
| Module | L'un des trois ensembles BUILD (concevoir), RUN (exploiter), GROW (croître) ; chacun a un bureau d'applications — ADR-0038 |
| Moteur | Composant déterministe qui calcule les résultats financiers |
| Objectif | Cible mesurable, datée et orientée |
| Plan | Version validée et immuable du prévisionnel |
| Point mort | Date ou niveau temporel auquel le seuil de rentabilité est atteint |
| Projets | Libellé d'interface du gestionnaire de projets et tâches de RUN (ADR-0039) ; dans le code : module `work` ; ne désigne plus l'objet de BUILD |
| Notification | Message in-app adressé à un membre (assignation, mention, échéance) ; dans le code : `Notification`, collection `notifications` (ADR-0039) |
| Prévisionnel | Valeurs estimées avant observation |
| Projection | Estimation mise à jour combinant réalisé et hypothèses restantes |
| Projet (RUN) | Chantier client ou interne suivi en tâches, distinct du plan financier ; dans le code : `WorkProject`, collection `work_projects`, actions `work.*` (ADR-0039) |
| Réalisé | Valeurs effectivement observées |
| Scénario | Jeu versionné d’hypothèses alternatives |
| Seuil de rentabilité | Niveau d’activité couvrant les charges |
| Source de vérité | Composant ou donnée faisant autorité pour un résultat |
| Tâche, sous-tâche, jalon | Unité de travail d'un projet RUN ; un jalon est une tâche à durée nulle et échéance obligatoire ; dans le code : `WorkTask` (`parentTaskId`, `isMilestone`), collection `work_tasks` (ADR-0039) |
| VAN | Valeur actualisée nette d’un investissement |
| TRI | Taux de rentabilité interne |

Les définitions légales ou comptables propres à un pays appartiennent au Country Pack et peuvent préciser ce glossaire.
