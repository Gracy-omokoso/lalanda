# ADR-0080 — Projets : heures de début et d'échéance, fuseau de l'organisation

Statut : **Accepté** (décision de la dirigeante du 18 nov. 2026 : portée projets, tâches et
jalons ; fuseau de l'organisation ; les points tranchés seuls sont repris en fin de document)
Date : 2026-11-18
Décideur : Gracy Omokoso (dirigeante de Go freelance SARLU).

> Étend [ADR-0039](ADR-0039-projets-et-taches-run.md) § 2.3 (dates, jalons) et § 6.6 (rappels),
> [ADR-0057](ADR-0057-interieur-projet-facon-asana.md) (Aperçu, santé),
> [ADR-0058](ADR-0058-accueil-projets-et-mes-taches-equipe.md) (portefeuille, « Mes tâches »),
> [ADR-0062](ADR-0062-import-projet-fichier.md) (import),
> [ADR-0078](ADR-0078-projets-membres-externes.md) (espace externe) et
> [ADR-0079](ADR-0079-notifications-modes-canaux-evenements.md) (catalogue des notifications).
> Remplace la règle « jour de Kinshasa » d'[ADR-0027](ADR-0027-numerotation-des-factures.md) **pour
> les échéances des Projets seulement** : elle devient « jour du fuseau de l'organisation », qui
> vaut Kinshasa par défaut. **Aucune action ajoutée** à `authz/permissions.ts`.
>
> Numérotation : le lot « options Asana » annoncé jusqu'ici sous le numéro ADR-0080 prendra le
> numéro **ADR-0081** (aucune mention écrite n'existait encore dans `docs/`).

## Contexte

Toutes les dates du module Projets sont des **jours** (`AAAA-MM-JJ`) : une tâche à rendre « mardi »
est en retard mercredi à 0 h. La dirigeante veut pouvoir dire « mardi **à 14 h** » — une remise à
un client, un départ de chantier, une réunion — et que Lalanda prévienne avant l'heure, puis
signale le retard **à l'heure**, pas le lendemain. La RDC a **deux fuseaux** : l'Ouest (Kinshasa,
UTC+1, WAT) et l'Est (Lubumbashi, UTC+2, CAT). Une heure écrite sans fuseau serait ambiguë pour une
équipe répartie.

Choix validés le 18 nov. 2026 :

- portée : **projets, tâches et jalons** (partout où il y a un début ou une échéance) ;
- l'heure est **facultative** (comme `due_on` / `due_at` d'Asana) : sans heure, **rien ne change** ;
- fuseau : celui de l'**organisation**, Kinshasa par défaut, modifiable dans ses paramètres ;
  l'heure s'affiche **avec l'abréviation du fuseau** ;
- avec heure : retard à l'heure exacte, « aujourd'hui » dans le fuseau de l'organisation, rappel
  « échéance dans 1 h ».

## § 1 — Modèle de données (additif, aucune migration)

`work_projects` et `work_tasks` gagnent **`startTime`** et **`dueTime`** : `'HH:mm'` (24 h) ou
`null`. Les jours `startDate` / `dueDate` restent **inchangés** et restent la clé de tout ce qui
compare des jours (tri, filtres, index, Gantt, calendrier, absences). L'heure se lit dans le fuseau
de l'organisation. Un document ancien n'a pas ces champs : Mongoose et les lectures les traitent
comme `null` — **aucune migration, aucune donnée réécrite**.

Alternative écartée : un instant UTC unique (`dueAt`). Il aurait obligé à recalculer le jour de
chaque échéance à chaque lecture et à chaque requête (index, filtres « échéance du jour »,
calendrier), à migrer toutes les données, et un changement de fuseau de l'organisation aurait
déplacé les jours déjà saisis. Le couple jour + heure locale garde le **jour voulu par la
personne** quel que soit le fuseau, et seul le calcul « en retard » a besoin de l'instant
(`zonedInstant`, `dueDeadline`).

`work_tasks.reminders` gagne `dueInHourFor` (§ 4). `organization_settings` gagne
**`fuseauHoraire`** (§ 2).

## § 2 — Fuseau de l'organisation

Aucun réglage de fuseau d'organisation n'existait : les références `Africa/Kinshasa` du code sont
des constantes (factures, encaissements, CRM) et le seul réglage existant, `user_preferences.timezone`,
est **personnel** (affichage du compte). Le réglage vit donc dans **`organization_settings`**
(paramètres d'affichage de l'organisation, déjà écrits par `organization-space/`), champ
`fuseauHoraire`, liste fermée `WORK_TIME_ZONES` :

| Valeur | Libellé | Abréviation |
|---|---|---|
| `Africa/Kinshasa` (défaut) | Heure de Kinshasa — Ouest de la RDC (WAT, UTC+1) | WAT |
| `Africa/Lubumbashi` | Heure de Lubumbashi — Est de la RDC (CAT, UTC+2) | CAT |

- `GET /organizations/current/settings` le sert (`fuseauHoraire`, `options.timeZones`) ;
  `PUT` l'accepte **facultatif** (absent : inchangé — un client plus ancien reste valide ; valeur
  hors liste : `400`) ; journal `organization.settings_updated` (`fuseauAvant`, `fuseauApres`).
  Droit inchangé : `organization.manage`.
- Le module Projets le **lit seulement** (`WorkClockService`, une lecture indexée par appel, sans
  cache : un changement s'applique à la requête suivante) et le sert aux écrans dans
  `GET /work/settings` (`timeZone`, `work.read`), `GET /work/my-tasks` (`asOfTime`, `timeZone`),
  `GET /work/portfolio` (`timeZone`) et l'espace externe (`timeZone` du projet et de la tâche).
- Les deux fuseaux de la RDC n'ont pas d'heure d'été ; les calculs passent quand même par `Intl`
  (`orgClock`, `zonedInstant`), sans table d'offsets codée en dur.
- **Changer de fuseau** ne réécrit rien : « 14:00 » reste « 14:00 », lu dans le nouveau fuseau.

## § 3 — Règles (`@lalanda/shared/work`, `time.ts`, fonctions pures)

- **Format** : `HH:mm` sur 24 h (`00:00` à `23:59`), sinon `400 WORK_TIME_INVALID`.
- **Une heure exige sa date** : `400 WORK_TIME_WITHOUT_DATE` (création sans jour, corps qui efface
  le jour en posant une heure, heure posée sur une tâche ou un projet sans jour stocké).
  **Effacer le jour efface son heure** (sans erreur) ; retirer l'heure seule est toujours permis.
- **Ordre** : échéance (jour + heure) ≥ début (jour + heure), sinon `400 WORK_DATES_INVERTED`. Une
  heure absente vaut 0 h pour le début et **la fin de journée** pour l'échéance : seul le cas
  « même jour, deux heures, échéance avant début » s'ajoute à la règle des jours. L'égalité est
  permise. Le schéma vérifie le corps, le service revérifie l'état final (corps partiel).
- **Jalon** : pas d'heure de début (`WORK_MILESTONE_HAS_START`), heure d'échéance permise ; le jalon
  créé depuis un devis ou une opportunité accepte `milestone.dueTime`.
- **En retard** (`isPastDue`) : jour passé, **ou** jour même et heure atteinte (`14:00` est en
  retard dès 14 h 00) ; sans heure, le lendemain (règle d'avant, inchangée).
- **Aujourd'hui** : jour du fuseau de l'organisation (`orgClock`) pour « Mes tâches », l'Aperçu,
  le portefeuille, la liste des projets, la veille des projets, le résumé quotidien et les rappels.
- **Tri** : le même jour, une heure passe avant « toute la journée » (`compareDue`).
- **Dépendances** : le même jour, un successeur qui commence à l'heure d'échéance de son
  prédécesseur ou après n'est plus en conflit ; sans heure, la règle du jour reste.

Ce qui reste au jour de Kinshasa (hors périmètre, aucune échéance en jeu) : saisies de temps et
feuilles de temps, dates de statut du projet, plafonds de l'espace externe, brief du matin (jours
seulement), heure de déclenchement du résumé quotidien et de la veille (7 h Kinshasa).

## § 4 — Rappels (`work.due-reminders`) et notification « échéance dans 1 h »

- Tâche récurrente toutes les **5 minutes** (15 avant) pour que le retard à l'heure parte à
  l'heure (à 5 minutes près). Fuseau lu **par organisation**.
- **Nouveau type `work.task_due_in_hour`** : échéance **avec heure** qui tombe dans l'heure qui
  vient ; destinataire le responsable (droits relus) ; une fois par échéance
  (`reminders.dueInHourFor`, `dedupeKey = work.task_due_in_hour:<tâche>:<AAAA-MM-JJTHH:mm>`).
- **Retard à l'heure** : `work.task_overdue` (et `work.project_task_overdue` pour le chef et
  l'adjoint) part dès l'heure atteinte. La clé d'échéance vaut `AAAA-MM-JJ` sans heure (valeurs
  déjà en base inchangées) et `AAAA-MM-JJTHH:mm` avec heure : **changer le jour ou l'heure rouvre
  le rappel**. « Échéance proche » reste au jour (`dueSoonFor` = jour).
- **7 h** : les rappels « au jour » (échéance proche, retard d'une tâche sans heure) partent à
  partir de 7 h dans le fuseau de l'organisation, comme avant ; les rappels « à l'heure » (dans
  1 h, retard d'une tâche avec heure) partent à toute heure — l'heure choisie par la personne
  prime. Les heures calmes de Slack et WhatsApp (ADR-0079 § 5) s'appliquent quand même : ces
  canaux sont différés, la cloche et l'e-mail partent aussitôt.
- Titres (cloche, e-mail, Slack, WhatsApp) : l'heure suit le jour avec son abréviation
  (« En retard : #12 Remise (échéance 2030-04-10 à 14:00 WAT) », « Échéance dans moins d'une
  heure : #12 Remise (14:00 WAT) ») ; « échéance modifiée » (`work.task_due_date_changed`) part
  aussi quand seule l'heure change.

**Niveau par défaut de `work.task_due_in_hour` : Essentiel · important** (catalogue ADR-0079,
famille Tâches, audience `assignee`, tous canaux permis, modèle WhatsApp
`lalanda_notification_projet`). Conséquence par mode : **Essentiel** → cloche et e-mail ;
**Atténué** → cloche, e-mail, Slack ; **Perroquet** → cloche, e-mail, Slack, WhatsApp. Raison :
l'événement n'existe que lorsque la personne a elle-même fixé une heure — c'est un engagement
horaire précis, aussi utile qu'« échéance proche » (même niveau) ; il ne mérite pas « urgent »
(WhatsApp et Slack dès Essentiel) puisqu'il précède l'échéance au lieu de la constater. Chacun peut
le couper ou l'élargir dans « Mes notifications », l'administrateur peut le rendre obligatoire.

## § 5 — Écrans (kit ADR-0074)

- **Organisation › Paramètres** : « Fuseau horaire » (liste servie par l'API, libellés complets).
- **Panneau de tâche** : à côté de chaque `DatePicker`, une heure facultative (`input type="time"`,
  pas d'une minute) suivie de l'abréviation du fuseau (« WAT ») et de son libellé en infobulle ;
  désactivée tant que le jour n'est pas choisi ; vider le jour vide l'heure.
- **Projet › Paramètres** : « Heure de début » et « Heure d'échéance » facultatives (même règle).
- **Affichage** : « 3 nov. · 14:00 WAT » dans l'échéance d'une tâche (liste, Kanban, Mes tâches,
  Aperçu, carte « Mes tâches » de l'accueil), l'en-tête du projet, le portefeuille, l'aperçu
  d'import, les descriptions des barres du Gantt et les phrases de conflit ; l'espace externe écrit
  « 15/01/2027 à 14:00 WAT ». La couleur « en retard » bascule à l'heure exacte.
- **Import de fichier** : une cellule de date accepte une heure (« 15/01/2027 14:30 »,
  « 2027-01-15T14:30 », « 14h30 ») ; l'heure exacte « 00:00 » d'un export de tableur est lue comme
  « sans heure ». L'IA ne propose pas d'heure.
- **Exports** : le module Projets n'exporte aujourd'hui aucune liste de tâches en CSV ou PDF (seul
  le récapitulatif de temps d'un consultant, sans échéance) : rien à changer ; un futur export
  écrira jour, heure et fuseau en colonnes distinctes.

## Routes et contrats

| Route | Changement |
|---|---|
| `POST /work/projects`, `PUT /work/projects/:id` | `startTime`, `dueTime` facultatifs |
| `POST /work/projects/:id/tasks`, `PATCH /work/tasks/:id` | `startTime`, `dueTime` facultatifs |
| `POST /work/projects/from-quote`, `from-opportunity` | `milestone.dueTime` facultatif |
| vues tâche, projet, résumé, portefeuille, Aperçu, espace externe | `startTime`, `dueTime` (absents ou `null` : sans heure) |
| `GET /work/settings` | `timeZone` (lecture seule) |
| `GET /work/my-tasks` | `asOfTime`, `timeZone` ; « en retard » à l'heure |
| `GET`, `PUT /organizations/current/settings` | `fuseauHoraire`, `options.timeZones` |

## Conséquences

- Deux champs facultatifs par projet et par tâche, un champ de rappel, un réglage d'organisation,
  un type de notification (union fermée : 87 types), un service de lecture (`WorkClockService`).
- La tâche des rappels tourne 3 fois plus souvent (5 min) : une requête `distinct` puis une
  requête par organisation candidate ; borne de 500 tâches par passage inchangée.
- Les compteurs « en retard » (liste des projets, portefeuille, veille) comparent l'heure : une
  agrégation par organisation dans la veille (fuseaux différents).
- Tests : `time.test.ts` (shared : format, retard avec et sans heure, changement de fuseau,
  validation, plan, santé, Aperçu, dépendances, Gantt, affichage), `notifications.test.ts`
  (87 types), `work-heures.unit.test.ts` (API : heures retenues, ordre final, filtres, import),
  `work-heures.e2e.test.ts` (fuseau et isolation, projets et tâches avec heure, refus, jalons,
  « Mes tâches » à l'heure et à Lubumbashi, compteurs, rappel 1 h et retard à l'heure dédupliqués
  et rouverts, avant 7 h, fuseau de l'Est), `heures-model.test.ts` (web).

## Décisions prises seules — à revoir avec l'expert

1. Liste fermée de deux fuseaux (RDC Ouest et Est) ; en ajouter un est une ligne de
   `WORK_TIME_ZONES` (calculs déjà génériques).
2. Échéance sans heure = fin de journée ; début sans heure = 0 h (ordre des dates).
3. Rappel « dans 1 h » au niveau **Essentiel · important**.
4. Rappels « à l'heure » sans le seuil de 7 h ; rappels « au jour » toujours à partir de 7 h.
5. Cadence des rappels : 5 minutes (précision du retard à l'heure).
6. Import : « 00:00 » d'une cellule date-heure lu comme « sans heure ».
7. Saisies de temps, feuilles de temps, statuts, brief et heures de déclenchement restent au jour
   de Kinshasa.

## Décisions ouvertes

1. Rappel configurable (30 min, 2 h, la veille) au lieu d'une heure fixe.
2. Heure des événements CRM et RH (relances, absences) : hors périmètre.
3. Fuseau par projet (chantier à l'Est, siège à l'Ouest) : non en R1, le fuseau est celui de
   l'organisation.
4. Export CSV ou PDF des tâches (à venir) : colonnes jour, heure, fuseau.
