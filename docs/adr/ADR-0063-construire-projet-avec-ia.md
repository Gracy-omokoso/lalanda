# ADR-0063 — « Construire avec l'IA » : plan Scrum/Agile proposé, relu, puis créé

Statut : **Proposé** (à valider par la dirigeante sur les captures `docs/refonte-ui/v5/`)
Date : 2026-11-05
Décideur : Gracy Omokoso (dirigeante de Go freelance SARLU).

> Applique la règle du projet « L'IA explique ; elle ne produit pas les calculs officiels » au module
> Projets ([ADR-0039](ADR-0039-projets-et-taches-run.md)) : **l'IA propose, l'utilisateur relit et
> valide, rien n'est créé sans confirmation**. Réutilise le client OpenAI, le quota commun
> (`AiQuotaService.runGuarded`), `generation-guard` (`sansChevrons`) et le créateur commun
> d'[ADR-0062](ADR-0062-import-projet-fichier.md). Aucun montant.

## Contexte

Démarrer un projet demande de découper le travail. La dirigeante veut qu'une description (objectif,
livrables, dates, équipe) produise une première version Scrum/Agile — jalons, sprints, tâches — que
l'équipe corrige avant de la créer.

## Décision

### 1. Formulaire

`POST /work/ai/plan` (`work.manage`, fonction `run_work`) : nom, contexte, **objectif**, livrables,
**date de début**, **date butoir**, équipe (0 à 20 membres de l'organisation détenant `work.update`),
durée des sprints (1, 2 ou 3 semaines), contraintes et risques, niveau de détail (léger ≈ 12 tâches,
standard ≈ 25, détaillé ≈ 40). Au plus 26 sprints sur la période (sinon 400, message clair).

### 2. Ce que l'IA décide, ce que le serveur décide

| Élément | Qui |
|---|---|
| Titres, descriptions courtes, découpage, priorités, estimations (heures), dépendances, étiquettes métier, responsable proposé | l'IA **propose** |
| Calendrier des sprints (`sprintCalendar` : semaines entières depuis le début, le dernier coupé à la date butoir) | le **serveur** |
| Dates d'une tâche | le **serveur** : celles de son sprint (l'IA ne donne qu'un numéro de sprint) |
| Date d'un jalon | l'IA peut la proposer ; hors [début, butoir] ou illisible → fin du sprint (correction signalée) |
| Responsable | l'IA ne voit que `m1, m2…` et des **prénoms** ; une référence inconnue → sans responsable |

### 3. Représentation des sprints : des étiquettes « Sprint N »

Le modèle n'a pas de sprint. Deux possibilités : des **colonnes** (sections) ou des **étiquettes**. Les
colonnes sont des **statuts** (À faire, En cours, Terminé — ADR-0039 § 2.2, une seule « terminé ») :
une tâche qui avance changerait de colonne et perdrait son sprint, et 12 colonnes au plus limiteraient
à ~9 sprints. **Choix : une étiquette « Sprint N » par tâche** (créée au besoin dans les réglages,
partagée d'un projet à l'autre), dates de la tâche = dates du sprint ; les colonnes restent celles par
défaut. L'objectif de chaque sprint et ses dates sont écrits dans la **description du projet**
(modifiable à la relecture). Les jalons sont des tâches `isMilestone` datées.

### 4. Vérification de la réponse (`work-ai-plan.ts`, pur, testé)

JSON strict (`response_format: json_object`) validé par **zod** (`AiRawPlanSchema`). Puis :
références réécrites (`T1…`, `J1…`) et doublons retirés ; nombre de tâches borné au niveau choisi
(8 jalons au plus) ; sprints inexistants replacés ; dépendances inconnues ou vers soi retirées ; **cycle
cassé** ; textes sans chevrons, bornés ; étiquettes « Sprint… » proposées par l'IA ignorées (le serveur
pose la sienne) ; puis le plan entier repasse par `WorkPlanTasksSchema` — le **même** contrôle que la
création. Chaque correction est rendue en français (`corrections`) et affichée à la relecture. JSON
illisible, forme invalide, aucune tâche → **rejet**.

### 5. Quota, erreurs, journal

- `AiQuotaService.runGuarded({ action: 'ai.work_plan' })` : **403 avant l'appel** si le quota du mois
  est épuisé (message qui nomme la limite et la date de remise à zéro) ; seule une proposition
  **acceptée** est décomptée ; **régénérer** est une nouvelle proposition, donc décomptée.
- IA indisponible (pas de client, pas de clé, panne, délai) → `503 WORK_AI_UNAVAILABLE` ; réponse
  inutilisable → `422 WORK_AI_INVALID_RESPONSE` ; rien n'est décompté dans ces cas. Coupe-circuit
  plateforme `WORK_AI_PLAN=off` → `503 WORK_AI_DISABLED`.
- Bornes propres à cet appel : 4 096 jetons en sortie, 45 s (le client OpenAI accepte désormais une
  borne **par appel**, toujours encadrée par `AI_LIMITS_BOUNDS`).
- Journal `work_ai_plan_logs` (TTL 90 jours), comme l'Idea Lab : empreinte SHA-256 de l'entrée,
  réponse brute bornée, issue (`accepted`, `rejected`, `error`, `disabled`), durée, nombre de
  corrections, et `projectId` une fois le projet créé (`aiDraftId`). Le prompt n'est pas conservé.
- 20 propositions par heure et par utilisateur, en plus du quota mensuel.
- **Confidentialité** : la charge utile ne contient que le formulaire et les prénoms des membres choisis
  de l'organisation active — ni identifiant, ni e-mail, ni donnée d'une autre organisation.

### 6. Relecture et création

L'écran `/projets/construire-ia` montre le résumé, la mention « l'IA propose… », les corrections, la
description du projet (modifiable), les **jalons**, puis chaque **sprint** (dates, objectif) et ses
tâches. On peut modifier le **titre**, l'**échéance**, le **responsable**, **retirer** une tâche (ses
dépendants ne l'attendent plus), **régénérer** (signalé : compte dans le quota) ou revenir au formulaire.
**Créer le projet** appelle `POST /work/plans/projects` (`work.manage`, `origin: 'ai'`, `aiDraftId`) :
le plan modifié est revérifié en entier et créé par `WorkPlanBuilder`, exactement comme un import.

### 7. Développement sans clé

`WORK_AI_PLAN_SIMULATED=on` (ignoré si `NODE_ENV=production`) remplace le modèle par un client simulé
déterministe qui rend un plan plausible au même format — il passe par les mêmes vérifications. Les tests
remplacent le client ; **aucun test n'appelle une vraie IA**.

## Conséquences

- Un plan IA crée des étiquettes « Sprint 1… » partagées par l'organisation (50 étiquettes au plus).
- Chaque responsable reçoit la notification d'assignation habituelle à la création.
- Le plan est une proposition : aucune estimation n'entre dans un calcul de coût (ADR-0039 § 2.3).

## Points ouverts

1. Un vrai objet « sprint » (dates, objectif, vélocité) plutôt que des étiquettes ?
2. Proposer aussi des sous-tâches et des sections ?
3. Laisser choisir le responsable du projet et sa nature (client) à la relecture.
