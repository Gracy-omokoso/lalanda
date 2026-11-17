# ADR-0079 — Notifications : modes, canaux et événements pour tout Lalanda

Statut : **Accepté** (besoin et choix validés par la dirigeante le 17 nov. 2026 ; les points
tranchés seuls sont marqués « à revoir avec l'expert » et repris en fin de document)
Date : 2026-11-17
Décideur : Gracy Omokoso (dirigeante de Go freelance SARLU).

> Étend [ADR-0039](ADR-0039-projets-et-taches-run.md) § 2.11 (boîte commune),
> [ADR-0061](ADR-0061-parametres-projets-notifications-couleurs.md) § 2 (préférences des Projets,
> **remplacées sans perte**), [ADR-0064](ADR-0064-notifications-projets-par-slack.md) (Slack),
> [ADR-0065](ADR-0065-notifications-projets-par-whatsapp.md) (WhatsApp),
> [ADR-0066](ADR-0066-suites-equipes-projets.md) § 5 (assignations groupées),
> [ADR-0076](ADR-0076-projets-roles-collaboration-validation.md) (chef et adjoint) et
> [ADR-0077](ADR-0077-projets-synchronisation-contrats-depenses-temps.md) § 4 (feuilles de temps).
> Écrans conformes à [ADR-0074](ADR-0074-formulaires-modernes.md). **Aucune action ajoutée** à
> `authz/permissions.ts`. Visibilité des projets (ADR-0060) et confidentialité RH (ADR-0045,
> ADR-0051) inchangées.

## Contexte

La dirigeante juge les notifications « trop réductrices » : seules une douzaine d'actions des
Projets notifiaient, toujours les mêmes personnes, et la cloche lui paraissait « ne même pas
fonctionner ». Elle veut que **chaque action importante notifie l'équipe**, que le **chef de
projet** (et son adjoint) suive la vie de son projet, sur quatre canaux — **cloche**, **e-mail**
(le plus important), **WhatsApp**, **Slack** — et pouvoir activer ou couper chaque notification.

Choix validés le 17 nov. 2026 :

- **trois modes** : **Perroquet** (tout), **Atténué**, **Essentiel** ; on choisit un mode puis on
  **personnalise ce mode** ; les personnalisations sont **gardées par mode** (passer de l'un à
  l'autre ne perd rien), un bouton « revenir au mode d'origine », l'écran affiche
  « Perroquet (personnalisé) » ;
- défauts : **chef de projet → Atténué**, **membre → Essentiel** ; l'administrateur choisit le mode
  par défaut par rôle et rend **obligatoires** certaines notifications ;
- périmètre : **tout Lalanda**, en commençant par les Projets.

## § 1 — Diagnostic de la cloche (fait AVANT toute évolution)

Prouvé par `notifications-modes.e2e.test.ts` à **deux** utilisateurs (A agit, B reçoit) : la
cloche de B **reçoit** l'assignation, le **compteur** monte de un, la **liste** la sert, le
**marquage** la fait redescendre ; A ne reçoit rien. Revus un à un :

| Piste | Constat |
|---|---|
| Compteur (`unread-count`) | juste : même filtre que la liste |
| Refiltrage à la lecture (droit `requiredAction`, visibilité ADR-0060) | juste : une notification d'un projet privé que l'on ne voit plus disparaît, rien d'autre |
| Types non reconnus | aucun : l'énumération du schéma Mongo vient de `NOTIFICATION_KINDS` |
| Préférences qui coupent la cloche | conformes au réglage (types coupés, case « Cloche ») |
| `deliver` qui avale des erreurs | **inverse** : une panne de lecture des préférences dans `WorkNotifier.deliver` n'était PAS rattrapée et pouvait remonter au geste (500 après écriture). Corrigé : le répartiteur ne lève jamais (§ 4.5) |
| L'auteur n'est jamais notifié | voulu, mais déroutant en test solo : **option « Me notifier aussi de mes propres actions »** (désactivée par défaut) |
| **Organisation active** | **panne réelle.** Chaque inscrit reçoit une organisation personnelle dont il est propriétaire ; sans cookie `active_org_id` (nouvel appareil, cookie expiré, autre navigateur), l'organisation **primaire** est la sienne (propriétaire d'abord) : la cloche n'y montre rien, et rien n'indiquait que l'équipe l'attendait ailleurs. Corrigé : `GET /notifications/unread-elsewhere` et, dans le panneau de la cloche, « 3 non lues dans Go freelance — Basculer et les voir » |
| Écrans | « Préférences » du compte affirmait qu'aucun e-mail n'était envoyé, la page `/notifications` « Pas d'e-mail » : faux depuis ADR-0061. Textes corrigés, liens vers l'écran unique |

Aucune autre panne : la cloche fonctionnait pour qui regardait la bonne organisation et n'était
pas l'auteur du geste — exactement les deux situations d'un test fait seul.

## § 2 — Catalogue des événements (`@lalanda/shared/notifications`, `catalog.ts`)

Chaque type de la boîte commune (sauf l'annonce de la plateforme et le test) a une fiche :
**module**, **famille**, **libellé** (à la première personne), **destinataires** (phrase),
**audience** (`assignee`, `collaborators`, `followers`, `mentioned`, `project_lead` = chef et
adjoint, `project_members`, `approver`, `requester`, `manager`, `permission_holders`,
`record_owner`, `concerned`), **palier**, **importance**, **canaux permis**, **modèle WhatsApp**,
regroupement des rafales. Un test vérifie que le catalogue couvre exactement l'union fermée.

### 2.1 Modes, paliers, importance

**Palier** = le mode le plus calme qui active l'événement (`essentiel` : les trois modes ;
`attenue` : Atténué et Perroquet ; `perroquet` : Perroquet seul). Canaux par défaut d'un
événement actif :

| Importance | Essentiel | Atténué | Perroquet |
|---|---|---|---|
| **urgent** (assignation, mention, validation attendue, échéance dépassée) | cloche, e-mail, Slack, WhatsApp | cloche, e-mail, Slack, WhatsApp | cloche, e-mail, Slack, WhatsApp |
| **important** | cloche, e-mail | cloche, e-mail, Slack | cloche, e-mail, Slack, WhatsApp |
| **info** | cloche | cloche | cloche, e-mail, Slack |

Puis : restriction aux **canaux permis**, surcharges de la personne **pour ce mode**, types coupés
depuis l'ancienne page (cloche), **obligations** de l'organisation (elles l'emportent). Une seule
fonction pure, `effectiveChannels`, sert le serveur (envoi) et l'écran (aperçu). *Table tranchée
seule — à revoir avec l'expert.*

### 2.2 Projets (catalogue complet)

| Famille | Événement (type) | Destinataires | Palier · importance |
|---|---|---|---|
| Tâches | créée (`work.task_created`, **nouveau**) | chef, adjoint | Atténué · info |
| | assignée (`work.task_assigned`) | nouveau responsable | Essentiel · urgent |
| | échéance modifiée (`work.task_due_date_changed`, **nouveau**) | responsable, collaborateurs, chef, adjoint | Essentiel · info |
| | terminée (`work.task_completed`, **nouveau**) — un jalon s'annonce par « jalon atteint » | chef, adjoint, abonnés (hors responsable et collaborateurs) | Atténué · info |
| | rouverte (`work.task_reopened`, **nouveau**) | chef, adjoint (hors responsable) | Atténué · info |
| | statut (colonne) changé (`work.task_status_changed`) | responsable, collaborateurs | Essentiel · info |
| | échéance proche (`work.task_due_soon`) | responsable | Essentiel · important |
| | en retard (`work.task_overdue`) | responsable | Essentiel · urgent |
| | en retard, vue du chef (`work.project_task_overdue`, **nouveau**) | chef, adjoint (s'ils ne sont pas le responsable) | Atténué · important |
| | collaborateur ajouté (`work.task_collaborator_added`) | le collaborateur | Essentiel · important |
| Validation | demandée (`work.task_approval_requested`) | valideur | Essentiel · urgent |
| | approuvée, modifications demandées, refusée (`work.task_approval_decided`) | responsable | Essentiel · important |
| Échanges | mention (`work.mentioned`) | mentionnés | Essentiel · urgent |
| | commentaire sur tâche suivie (`work.comment_on_followed`) | abonnés | Essentiel · info · rafale |
| | commentaire (`work.comment_added`, **nouveau**) | chef, adjoint (s'ils ne suivent pas la tâche) | Atténué · info · rafale |
| | pièce jointe (`work.attachment_added`, **nouveau**) | responsable, collaborateurs, abonnés, chef, adjoint | Atténué · info · rafale |
| Jalons et facturation | jalon atteint (`work.milestone_completed`) | chef | Essentiel · important |
| | brouillon de facture préparé (`work.invoice_draft_prepared`, **nouveau**) — jamais un montant | chef, adjoint | Atténué · important |
| Projet | ajouté au projet (`work.added_to_project`) | personnes et équipes ajoutées | Essentiel · important |
| | membre ajouté (`work.project_member_added`, **nouveau**) | chef, adjoint | Atténué · info |
| | statut publié (`work.project_status_posted`) | chef, adjoint, membres | Essentiel · info |
| | à risque (`work.project_at_risk`) | chef, membres | Essentiel · important |
| | archivé, restauré (`work.project_archived`, `work.project_restored`, **nouveaux**) | chef, adjoint, membres directs | Atténué · info |
| | créé depuis devis, opportunité, contrat (`work.project_created`, **nouveau**) | détenteurs de `work.manage` (ces projets naissent sans chef) | Essentiel · info |
| Temps (ADR-0077 n'émettait rien) | feuille soumise (`work.timesheet_submitted`) | le manager (RH), à défaut les détenteurs de `work.manage` | Essentiel · important |
| | validée, renvoyée, rouverte (`work.timesheet_approved`, `_returned`, `_reopened`) | la personne | Essentiel · info / important / important |

Le libellé « collaborateur ajouté » côté chef n'est pas émis : le chef voit le membre ajouté et la
tâche ; *à revoir sur retour d'usage*. Les trois décisions d'une validation gardent **un seul type**
(`task_approval_decided`), le titre dit laquelle (pas de rupture des préférences ADR-0076).

### 2.3 Autres modules (types existants, classés)

Tous au palier **Essentiel** (aucune cloche existante n'est retirée) ; l'importance règle l'e-mail,
Slack et WhatsApp. CRM : relance assignée, en retard, opportunité confiée (important), échéance de
relance, opportunité gagnée (info). Organisation : autorisations changées (important). Achats :
demande à approuver (urgent), approuvée, refusée, écart de facture, facture en retard, coordonnées
de paiement d'un fournisseur changées (important), échéance (info). Stocks, équipements, documents :
inventaire à valider (urgent), seuils, négatif, inventaire confié, entretien, couverture (important),
lignes à traiter, document qui expire (info). Ventes : contrat à approuver (urgent), approuvé,
refusé, préavis, terme (important), brouillons d'abonnement (info).

**Ressources humaines** : canaux permis **cloche et e-mail seulement** (jamais Slack ni WhatsApp :
service tiers hors de l'entreprise) ; demandes à décider (absence, frais, avance, correction de
pointage) urgentes, le reste important ou info. Les titres RH sont ceux des producteurs
(ADR-0045, ADR-0051) : **aucun montant, motif, note** n'est ajouté. *À revoir avec l'expert*
(confidentialité et droit du travail RDC).

## § 3 — Émission

- Les émissions nouvelles des Projets sont faites **après** l'écriture, aux points métier :
  `work-tasks.service.ts` (créée, échéance, terminée, rouverte), `work-comments.service.ts`,
  `work-attachments.service.ts`, `work-reminders.job.ts`, `work-projects.service.ts` (archivé,
  restauré), `work-project-members.service.ts`, `billing/work-billing.service.ts` (brouillon de
  facture ; projet créé depuis devis, opportunité, contrat — `materialize` sert les trois),
  `timesheets/work-timesheet-approvals.service.ts`. Un geste de masse (import, IA) n'émet pas
  « tâche créée » : il s'annonce par ses assignations groupées (ADR-0066 § 5).
- Destinataires **toujours** filtrés par la visibilité du projet (`visibleRecipients`, ADR-0060) ;
  les feuilles de temps (hors projet) par `work.read` (`memberEvent`).
- **Chef et adjoint** : `WorkNotifier` marque chaque destinataire chef ou adjoint du projet de
  l'objet (`audience: project_lead`) ; sans mode choisi, c'est le **mode du chef** qui s'applique
  à ces événements-là (Atténué par défaut), et le mode « membre » ailleurs.
- Les modules qui notifient déjà (CRM, achats, RH, organisation, stocks, ventes) passent par le
  même port `NOTIFICATIONS_PORT` : `notify` applique désormais **le même répartiteur** (§ 4.5) —
  ils gagnent l'e-mail, Slack (si l'organisation est connectée) et le journal, sans changer d'appel.

## § 4 — Préférences

### 4.1 Modèle (additif)

- `notification_settings` (une par organisation et personne) : `mode` (`null` = défaut de
  l'organisation), `overrides` **par mode** (`{ mode: { type: { canal: booléen } } }`, clés de type
  encodées `work:task_assigned`), `notifyOwnActions` (faux), `quietHours` (`null` = défaut),
  `migratedFrom`, `revision`.
- `notification_org_settings` (une par organisation, `organization.manage`) : `projectLeadMode`
  (Atténué), `memberMode` (Essentiel), `byRole` (facultatif, rôles d'organisation), `mandatory`
  (type × canal permis), `whatsappDailyCap` (20), `revision`.
- **Obligations par défaut : aucune.** L'écran d'administration propose en un clic « Rendre les
  validations obligatoires dans la cloche » (tâche à valider, feuille de temps, demande d'achat,
  absence, frais, avance, correction de pointage, contrat, inventaire). Les imposer d'office aurait
  changé le résultat de personnes qui les avaient coupées (§ 4.3). *Tranché seul.*

### 4.2 Mode et personnalisation

Choisir un mode n'efface rien ; le corps de `PUT /notifications/settings` porte les surcharges des
modes (un mode absent du corps garde les siennes). « Revenir au mode d'origine » vide les
surcharges du mode affiché seulement. `customized` est vrai dès qu'une surcharge diffère du défaut.

### 4.3 Conversion sans perte des préférences ADR-0061

Paresseuse et rejouable : à la première lecture d'une personne sans `notification_settings` qui
avait **enregistré** ses cases (`work_notification_preferences.revision ≥ 1`, `events` non vide), un
document est créé avec `mode: null` et, **dans chacun des trois modes**, les surcharges minimales
qui reproduisent ses douze événements × quatre canaux. Quel que soit le mode appliqué (membre ou
chef), ces douze événements donnent **exactement** le même résultat qu'avant (test unitaire sur
toutes les combinaisons, test e2e sur un ancien document). L'ancien document n'est **ni modifié ni
supprimé** ; le **résumé quotidien** y reste (tâche `work.daily-digest` inchangée). Les types
coupés de `notification_preferences` continuent de s'appliquer (cloche) ; les rallumer depuis le
nouvel écran les retire de cette liste. Une personne qui n'avait rien enregistré prend les
nouveaux défauts (changement voulu par la dirigeante).

### 4.4 Ancienne route (compatibilité, non dépréciée en R1)

- `GET /work/notification-preferences` rend les canaux **effectifs** des douze événements (mode
  appliqué hors projets dirigés, surcharges, obligations), le résumé et la révision de l'ancien
  document ;
- `PUT /work/notification-preferences` enregistre comme avant (révision, colonnes facultatives,
  `409 WHATSAPP_NUMBER_NOT_VERIFIED`) **et** convertit les cases en surcharges du mode choisi, ou
  des trois modes si la personne suit le défaut ;
- `PUT /work/notification-preferences/digest` (**nouveau**) : le résumé seul, pour l'écran unique.

Changement de défaut assumé, visible par l'ancienne route : en Essentiel, « échéance dépassée »
part aussi sur Slack (urgente) — `work-settings-notifications` et `slack` e2e mis à jour.

### 4.5 Répartiteur (`NotificationDispatcher`)

Pour chaque destinataire déjà retenu par le producteur : auteur écarté sauf option ; mode ;
canaux effectifs ; cloche (port fourni par l'appelant — les Projets gardent `WorkNotifier.port`,
jeton `NOTIFICATIONS_BELL_PORT` qui n'envoie que la cloche, sinon l'e-mail partirait deux fois) ;
e-mail attendu (gabarit des Projets, pied de page vers `/compte/notifications`) ; Slack et
WhatsApp **non bloquants**, leur sort revient par rappel (`report`) ; journal. Ne lève **jamais**.
Slack et WhatsApp s'**enregistrent** auprès du répartiteur (le module générique ne les importe pas).
Le répartiteur lit les identités dans `user` directement : injecter `MembersService` (qui dépend
du port pour « autorisations changées ») bloquait le démarrage de Nest par un cycle — piège noté.

## § 5 — Garde-fous

- **Rafales** (types marqués : commentaires, pièces jointes) : dans une fenêtre de **10 min**, une
  notification **non lue** du même type sur le même objet absorbe la suivante — une ligne,
  « 3 nouveaux commentaires — Gracy a commenté #12 Maquette », `count` dans la vue ; l'e-mail,
  Slack et WhatsApp ne repartent pas (`grouped` au journal). Jamais pour un rappel (`dedupeKey`).
- **Heures calmes** (WhatsApp et Slack seulement) : par personne, défaut **21 h → 7 h, heure de
  Kinshasa** (`NOTIFICATIONS_QUIET_HOURS_DEFAULT` = `off` ou `HH-HH`) ; pendant ces heures, le
  message n'est **pas** envoyé (`quiet_hours` au journal), la cloche et l'e-mail partent. Pas de
  file différée en R1. *Tranché seul — à revoir avec l'expert.*
- **Plafond quotidien WhatsApp** : par personne et par jour de Kinshasa, défaut **20** (0 à 200),
  réglé par l'organisation ; tests compris ; au-delà `daily_cap`. Le plafond mensuel de la
  plateforme (ADR-0065 § 7) reste.
- **Résumé quotidien** : inchangé (ADR-0061), réglé depuis l'écran unique.

## § 6 — Vérifiabilité

- **« M'envoyer un test »** par canal (`POST /notifications/test`) : cloche (type
  `organization.notification_test`), e-mail, Slack (message privé), WhatsApp (modèle
  `lalanda_notification_projet`) ; le sort est rendu (Slack et WhatsApp attendus 20 s au plus) ;
  **5 par heure** et par personne (`429 NOTIFICATION_TEST_RATE_LIMITED`). Les heures calmes ne
  s'appliquent pas (geste explicite), le plafond WhatsApp si.
- **Journal d'envoi** (`notification_deliveries`) : une ligne par notification et destinataire,
  le sort de chaque canal — `sent`, `queued`, `skipped`, `failed` — et le motif (`channel_off`,
  `not_permitted`, `muted`, `grouped`, `duplicate`, `quiet_hours`, `daily_cap`, `monthly_quota`,
  `no_email`, `mail_not_configured`, `slack_unavailable`, `slack_not_connected`,
  `slack_unmatched`, `whatsapp_unavailable`, `whatsapp_not_verified`, `template_unavailable`,
  `provider_error`, `not_member`, `not_allowed`, `error`). **Ni titre, ni lien, ni contenu** : type,
  module, identifiants. La personne lit le sien ; l'administrateur (`organization.manage`) celui de
  l'organisation, avec le nom du destinataire. **Conservation 90 jours** (index TTL).
- **État des canaux** (`GET /notifications/channels`) : cloche, e-mail (adresse masquée), Slack
  (connecté ?), WhatsApp (vérifié ? plafond du jour), types dont le modèle WhatsApp est approuvé.

## § 7 — WhatsApp : modèles

Les modèles d'ADR-0065 restent utilisés ; **`lalanda_notification_projet`** sert tous les nouveaux
événements des Projets et le test : **aucun nouveau modèle n'est nécessaire pour les Projets**.
Hors Projets, deux modèles sont **proposés** (texte exact dans `docs/integrations/whatsapp.md`,
vérifié par test) :

| Nom | Catégorie | Texte (variables) |
|---|---|---|
| `lalanda_notification_generale` | Utilitaire | « Bonjour, vous avez une nouvelle notification dans Lalanda. Événement : {{1}} · Détail : {{2}} · Organisation : {{3}} · Ouvrez Lalanda pour en savoir plus. » + bouton « Ouvrir dans Lalanda » |
| `lalanda_validation_attendue` | Utilitaire | « Bonjour, une demande attend votre validation dans Lalanda. Demande : {{1}} · Détail : {{2}} · Organisation : {{3}} · Ouvrez Lalanda pour la traiter. » + bouton |

Tant qu'un modèle n'est pas approuvé par Meta **et** inscrit dans `WHATSAPP_APPROVED_TEMPLATES`
(liste séparée par des virgules), WhatsApp est « indisponible pour cet événement » : rien ne part,
le journal dit `template_unavailable`, l'écran affiche « En attente ». Rien ne casse.

## § 8 — Écrans (kit ADR-0074)

- **« Mes notifications »**, écran unique : `/compte/notifications` (onglet « Notifications » du
  compte) et Projets › Paramètres › « Mes notifications ». Cartes de mode (`ChoiceCards`, une phrase
  par mode, « (personnalisé) »), « Revenir au mode d'origine », « Suivre le défaut de
  l'organisation » ; état des canaux et test par canal ; numéro WhatsApp ; options (« Me notifier
  aussi de mes propres actions », heures calmes) ; tableau événement × canal **groupé par module et
  famille** (sections repliables, « 12 actifs sur 18 »), un `Switch` par cellule, « — » pour un
  canal non permis, cadenas pour une obligation, « En attente » pour un modèle WhatsApp non
  approuvé ; résumé quotidien ; journal d'envoi. Sur téléphone, chaque événement passe sur deux
  lignes (libellé, puis les quatre interrupteurs), cibles de 44 px.
- **Réglages de l'organisation** (onglet réservé à `organization.manage`) : modes par défaut (chef
  et adjoint, autres membres, par rôle avec les libellés servis par l'API), obligations par
  module, plafond WhatsApp, journal de l'organisation.
- Cloche : non lues des autres organisations et « Basculer et les voir », lien « Réglages ».

## Routes

| Route | Droit | Effet |
|---|---|---|
| `GET /notifications/unread-elsewhere` | `analytics.read` | non lues des autres organisations de l'appelant |
| `GET`, `PUT /notifications/settings` | `analytics.read` | réglages de l'appelant (révision attendue) |
| `GET /notifications/organization-settings` | `analytics.read` | défauts et obligations (`canManage`) |
| `PUT /notifications/organization-settings` | `organization.manage` | modes, obligations, plafond (`400 NOTIFICATION_ROLE_UNKNOWN`, `NOTIFICATION_CHANNEL_NOT_PERMITTED`) |
| `GET /notifications/channels` | `analytics.read` | état des canaux de l'appelant |
| `POST /notifications/test` | `analytics.read` | test d'un canal (5 / heure) |
| `GET /notifications/deliveries` | `analytics.read` | journal de l'appelant (curseur, `channel`, `status`) |
| `GET /notifications/deliveries/organization` | `organization.manage` | journal de l'organisation |
| `PUT /work/notification-preferences/digest` | `work.read` | résumé quotidien seul |

## Conséquences

- Trois collections (`notification_settings`, `notification_org_settings`,
  `notification_deliveries`), un champ `groupCount` facultatif dans `notifications`, dix-sept types
  ajoutés à l'union fermée, une nature d'entité (`timesheet`), un jeton (`NOTIFICATIONS_BELL_PORT`),
  un paramètre facultatif `report` aux ports Slack et WhatsApp, un champ facultatif
  `preferencesPath` à `MailService.sendWorkNotification`. Aucune donnée supprimée.
- **Changements de comportement assumés** : les modules hors Projets envoient désormais des
  e-mails (événements importants et urgents, Essentiel) et, si l'organisation a connecté Slack, des
  messages privés selon le mode ; « échéance dépassée » part sur Slack par défaut ; le chef reçoit
  la vie de son projet.
- Coût : une écriture de journal par notification et destinataire ; une lecture de réglages par
  émission ; la recherche des valideurs d'une feuille de temps parcourt au plus 200 membres.
- Tests : `catalog.test.ts` (shared), `notification-settings.unit.test.ts` (conversion sans perte,
  heures calmes, modèles WhatsApp), `notifications-modes.e2e.test.ts` (21 cas : diagnostic à deux,
  « mes actions », autre organisation, chef Atténué et membre Essentiel, surcharges par mode,
  organisation et obligations, conversion, ancienne route, rafale, heures calmes, plafond, feuilles
  de temps, archivage, producteur CRM, tests par canal, état des canaux, journal et isolation),
  `reglages-model.test.ts` (web), `routes-coverage.test.ts`.

## Coordination

ADR-0078 (membres externes, branche `feat/projets-externes`) entre dans `main` avant ce lot : ce lot
reste additif dans `apps/api/src/work/**` et `apps/api/src/mail/**` et ne touche pas
`apps/api/src/work/external/`. Après rebase, les événements externes (validation client,
commentaire du client) seront ajoutés au catalogue et branchés sur le même répartiteur.

## Décisions prises seules — à revoir avec l'expert

1. Table importance × mode (§ 2.1) et classement de chaque événement (§ 2.2, § 2.3).
2. Hors Projets, tous les types au palier Essentiel (aucune cloche retirée).
3. RH : cloche et e-mail seulement, jamais Slack ni WhatsApp.
4. Mode « chef » appliqué au chef **et** à l'adjoint, pour les seuls événements de leur projet.
5. Aucune obligation par défaut ; proposition en un clic des validations dans la cloche.
6. Heures calmes 21 h → 7 h (Kinshasa) par défaut, message non envoyé (pas différé).
7. Plafond WhatsApp 20 par personne et par jour ; tests compris.
8. Rafales : 10 minutes, commentaires et pièces jointes ; place de la ligne inchangée.
9. Journal : 90 jours ; nom du destinataire visible de l'administrateur, jamais le contenu.
10. Tests : 5 par heure ; WhatsApp par `lalanda_notification_projet`.
11. Conversion : surcharges reproduites dans les trois modes ; ancienne route conservée, non
    dépréciée.
12. Feuille soumise : manager relié (RH), sinon détenteurs de `work.manage` ; projet créé depuis un
    document commercial : détenteurs de `work.manage` ; archivage : chef, adjoint, membres directs.
13. Modèles WhatsApp d'ADR-0065 tenus pour approuvés (comportement inchangé) ; nouveaux modèles
    activés par `WHATSAPP_APPROVED_TEMPLATES`.

## Décisions ouvertes

1. File différée après les heures calmes (au lieu de ne pas envoyer).
2. Réglages par projet (couper un projet bruyant) — toujours non en R1 (ADR-0061 n° 1).
3. Résumé quotidien sur Slack et WhatsApp.
4. Événements du canal Slack d'un projet (commentaires, tâches créées) : inchangés (ADR-0064 n° 3).
5. Facturation du coût WhatsApp aux organisations (ADR-0065 n° 4).
6. Dépréciation datée de `PUT /work/notification-preferences` une fois tous les clients migrés.
