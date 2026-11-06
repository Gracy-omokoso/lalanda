# ADR-0061 — Paramètres de la rubrique Projets : notifications, comportement, couleurs des cartes

Statut : **Proposé** (besoin validé par la dirigeante le 5 nov. 2026 ; à valider sur les captures
`docs/refonte-ui/v5/`)
Date : 2026-11-05
Décideur : Gracy Omokoso (dirigeante de Go freelance SARLU).

> Étend [ADR-0039](ADR-0039-projets-et-taches-run.md) § 2.1 (`work_settings`), § 2.11
> (notifications) et § 6.6 (rappels) sans les casser ; s'appuie sur le service mail
> ([ADR-0042](ADR-0042-envoi-des-documents-par-email.md), ZeptoMail en production) et le design
> system ([ADR-0055](ADR-0055-themes-et-design-professionnel.md), [ADR-0056](ADR-0056-ecran-factures-et-tableau-de-bord.md)).
> Accompagne [ADR-0060](ADR-0060-equipes-membres-projet-visibilite.md) (visibilité). **Aucune
> action ajoutée** à `authz/permissions.ts`.

## Contexte

Avec toute l'entreprise sur les Projets, chacun veut régler ce qui le dérange (trop de cloches,
pas assez d'e-mails) et la direction veut fixer quelques règles communes. Asana, monday et ClickUp
séparent les deux : préférences **personnelles** de notification, réglages de **l'espace**.
La dirigeante veut aussi colorer les cartes du Tableau « comme des post-it ».

Règle imposée : **aucun réglage décoratif** — chacun a un effet serveur ou écran, testé.

## Décision

### 1. Écran `Projets › Paramètres` (`/projets/parametres`)

Deux onglets : **Mes notifications** (tout détenteur de `work.read`, pour soi) et **Comportement
des projets** (`work.manage`). Les colonnes de départ et les étiquettes restent éditées dans
« Réglages » d'un projet (même document `work_settings`), rappelées ici.

### 2. Mes notifications (par utilisateur)

Collection `work_notification_preferences` (une par organisation et utilisateur) ;
`GET|PUT /work/notification-preferences` (`work.read`, l'appelant seulement, révision attendue).

| Événement | Type (boîte commune) | Cloche par défaut | E-mail par défaut |
|---|---|---|---|
| Une tâche m'est assignée | `work.task_assigned` | oui | **oui** |
| Je suis mentionné | `work.mentioned` | oui | **oui** |
| Commentaire sur une tâche que je suis | `work.comment_on_followed` | oui | non |
| Échéance proche | `work.task_due_soon` | oui | non |
| Échéance dépassée | `work.task_overdue` | oui | **oui** |
| Statut (colonne) d'une de mes tâches changé | `work.task_status_changed` (**nouveau**) | oui | non |
| Ajouté à un projet | `work.added_to_project` (**nouveau**) | oui | non |
| Projet passé à risque | `work.project_at_risk` (**nouveau**) | oui | non |

**Application** : `WorkNotifier` lit les préférences de chaque destinataire à **chaque émission**
(gestes et rappels) : cloche → port `NOTIFICATIONS_PORT` ; e-mail → `MailService.sendWorkNotification`
(lien **relatif** de l'application, jamais une URL absolue reçue). Les `mutedKinds` du module de
notifications continuent de s'appliquer en plus. Destinataires filtrés par la visibilité (ADR-0060).

- « Statut changé » : déplacement de colonne (glisser, terminer, rouvrir) par **un autre** que l'assigné.
- « Projet passé à risque » : tâche récurrente `work.project-watch` (horaire, dès 7 h Kinshasa) ;
  santé par la **règle unique** de l'accueil et de l'Aperçu (`projectHealth`, ADR-0058) ;
  notification à l'**entrée** dans `at_risk` ou `late` (champ `healthAlert`, réarmé quand le projet
  redevient sain) au responsable, aux membres directs et aux membres des équipes.

**Résumé quotidien** (oui/non, heure de Kinshasa 0–23, jours ouvrés seulement) : tâche
`work.daily-digest` (15 min) ; au plus **un par jour** (jour réclamé avant l'envoi, comme le brief
du matin) ; contenu : SES tâches en retard, du jour et à échéance proche (fenêtre en jours ouvrés),
nombre de notifications non lues des Projets ; projets archivés et privés hors portée exclus ; droit
`work.read` revérifié. En local et en test, le transport journalise : **aucun envoi réel**.

### 3. Comportement des projets (organisation, `work.manage`)

Champs **facultatifs** ajoutés à `PUT /work/settings` (absent : valeur gardée ; un ancien client
continue d'enregistrer), défauts = comportement antérieur.

| Réglage | Défaut | Effet réel |
|---|---|---|
| Qui peut créer un projet (`projectCreatorRoles`) | `null` = tout détenteur de `work.manage` | restreint **parmi** les gestionnaires (rôle hors `work.manage` refusé `WORK_CREATOR_ROLE_INVALID`) ; `403 WORK_PROJECT_CREATION_RESTRICTED` ; vaut aussi pour devis et opportunité ; la direction crée toujours |
| Visibilité par défaut (`defaultVisibility`) | `organization` | nouveaux projets (formulaire, devis, opportunité) ; choix explicite prioritaire |
| Vue à l'ouverture (`defaultView`) | `overview` | `/projets/<id>` ouvre Aperçu, Liste ou Tableau (lien de tâche : toujours la Liste) |
| Colonnes de départ (`defaultColumns`) | 4 colonnes | existant (ADR-0039) |
| Jours ouvrés (`workingDays`) | lundi–vendredi | fenêtre « échéance proche » en **jours ouvrés** (rappels, Mes tâches, résumé) ; résumé « jours ouvrés seulement » |
| Échéance proche (`dueSoonDays`) | 1 | existant, désormais en jours ouvrés |
| Archivage automatique (`autoArchiveCompletedDays`) | jamais | `work.project-watch` archive les projets `completed` depuis N jours (historique `project.archived`, auteur `system`) |
| Modération des commentaires (`managersModerateComments`) | oui | les gestionnaires modifient **et** suppriment les commentaires des autres ; non : l'auteur seul (avant : suppression seulement) |
| Numéros de tâche (`showTaskNumbers`) | oui | `#12` sur les cartes du Tableau et dans le panneau ; aussi la Chronologie et le Calendrier ([ADR-0066](ADR-0066-suites-equipes-projets.md) § 4) |

Pas de nouvelle action : la restriction des créateurs s'ajoute à `work.manage` exigé par la route.

### 4. Couleur des cartes (post-it)

- Champ facultatif `color` d'une tâche (`CreateWorkTaskBody`, `PatchWorkTaskBody`) : clé de la
  palette **fermée** `WORK_CARD_COLORS` = `yellow, orange, pink, purple, blue, teal, green, gray`,
  `null` pour retirer ; hors palette : `400`. Sans couleur : affichage **inchangé**.
- Jetons `--card-<clé>-bg` et `--card-<clé>-dot` dans `packages/ui/src/styles/tokens.css`, miroir
  typé `CARD_TOKENS` (`tokens.ts`) : pastels **clairs** en Lalanda et Lagune clairs ; versions
  **désaturées sombres** en mode sombre et en Ébène.
- Contrastes vérifiés par `tokens.test.ts` dans les **5 combinaisons** : texte du thème
  (`foreground`) **et** texte secondaire (`foreground-muted`) ≥ 4,5:1 sur chaque fond ; liseré ≥ 3:1
  sur la surface.
- Tableau : fond de la carte + liseré gauche ; Liste : pastille discrète ; panneau : nuancier
  (radio, « Aucune couleur »).

## Conséquences

- Trois types de notification ajoutés à l'union fermée `NOTIFICATION_KINDS` (ajout pur).
- `MailService` gagne deux intentions (`sendWorkNotification`, `sendWorkDigest`) et deux gabarits.
- Deux tâches récurrentes de plus (`work.project-watch` horaire, `work.daily-digest` 15 min).
- Tests : `work-settings-notifications.e2e.test.ts` (préférences cloche/e-mail respectées, statut
  changé, ajout au projet, résumé une fois par jour à l'heure et jamais un jour fermé, chaque
  réglage de comportement, couleurs), `tokens.test.ts`, tests unitaires web.

## Décisions ouvertes

1. Préférences **par projet** (couper un projet bruyant) : non en R1.
2. Résumé hebdomadaire en plus du quotidien : non en R1.
3. Libellés des rôles créateurs recopiés côté web (Propriétaire, Administrateur, Directeur
   financier) : à remplacer par `roleOptions` du serveur quand le chantier « accès et rôles » l'expose.
