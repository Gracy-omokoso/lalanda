# ADR-0077 — Projets synchronisés : contrat → projet, dépenses récurrentes et filtres, validation des feuilles de temps

Statut : **Accepted**
Date : 2026-11-16
Décideuse : Gracy Omokoso (fermeture des trous de synchronisation du module Projets, validée le
16 nov. 2026) ; CTO Lalanda (contrat technique). Les choix marqués « **à revoir avec Gracy** » ont
été tranchés par défaut et peuvent être changés sans casser le contrat.

> **Tranche** [ADR-0050](ADR-0050-contrats-commandes-acomptes-abonnements.md) § 4.2 (« Créer le
> projet » d'un contrat ; `projectId` du contrat, jusque-là « non posé par ce lot ») et
> [ADR-0039](ADR-0039-projets-et-taches-run.md) § 6.4 (« les dépenses récurrentes ne portent pas de
> projet en R1 »). **Prolonge** [ADR-0075](ADR-0075-depense-fournisseur-telephones.md) (A) aux
> dépenses récurrentes et ferme deux de ses « Reste ouvert » (formulaire de règle récurrente, filtre
> `supplierId`). **Lève**, pour la validation seulement, l'écart d'[ADR-0045](ADR-0045-ressources-humaines.md)
> O5 (option 2, « lot futur », décision ouverte n° 10) : soumission hebdomadaire, validation par le
> manager, verrou. **Étend** [ADR-0033](ADR-0033-brief-du-matin.md) (un fait, une règle,
> `MORNING_BRIEF_VERSION` 1.7.0) et « Mes tâches » (ADR-0040 § 5.2, un port de plus).
> **Ne touche pas à la paie** ([ADR-0070](ADR-0070-paie-rdc.md), exclue tant que la dirigeante ne
> la rouvre pas) ni à aucune règle fiscale, comptable ou DGI : aucune facture émise, aucun appel
> e-MCF.

## Contexte

Le module Projets (ADR-0039) se branche déjà sur les devis acceptés, les opportunités gagnées
(ADR-0040), les factures (`work_invoice_links`), les dépenses (`treasury_expenses.workProjectId`),
les achats, le stock et les frais RH (marge). Quatre trous restaient :

1. **Contrat ↔ projet.** Un contrat signé (ADR-0050) est l'engagement durable qui lance la
   production, mais aucun lien n'existe : `sales_contracts.projectId` est déclaré et rendu `null`,
   jamais écrit ; le projet ignore son contrat ; un même client peut finir avec un projet issu du
   devis et un autre « à la main » pour le contrat.
2. **Dépenses récurrentes.** L'API accepte déjà `supplierId` sur une règle (ADR-0044 P2) mais
   l'écran ne propose ni fournisseur ni projet ; un loyer de chantier ou un abonnement propre à un
   projet ne pouvait pas y être rattaché, et ses occurrences confirmées non plus.
3. **Liste des dépenses.** Filtre par projet côté API, rien à l'écran ; aucun filtre fournisseur :
   la fiche fournisseur ne montre que les dépenses directes récentes (ADR-0075, « Reste ouvert »).
4. **Feuilles de temps.** `GET /work/timesheets` est une lecture (ADR-0045 § 6.3) : personne ne
   valide le temps saisi, et une saisie ancienne peut être modifiée à tout moment.

## Options considérées

### O1 — Où vit le lien contrat ↔ projet ?

1. Nouvelle origine `source.kind = 'contract'` sur `work_projects` (index unique partiel côté
   projet). Écarté : `work.schemas.ts` est en cours de modification par un chantier parallèle
   (rôles projet, validation des tâches), et un projet déjà issu d'un devis ne peut pas changer
   d'origine pour suivre un contrat.
2. Collection de liens `work_contract_links`. Écarté : `sales_contracts.projectId` existe déjà
   (ADR-0050 § 2.3, rendu dans la vue) ; deux sources de vérité pour un même lien.
3. **`sales_contracts.projectId`, écrit par le module Projets**, avec un **index unique partiel**
   `{ organizationId, projectId }` (`projectId` chaîne) : un projet suit au plus un contrat, un
   contrat a au plus un projet. **Retenu.** `projectId` n'entre pas dans le contenu figé du contrat
   (`SalesContractContent`, `contentSha256`) : l'écrire ne touche ni à l'empreinte ni à un avenant.

### O2 — Les échéances du contrat deviennent-elles des jalons ?

1. Jamais. Écarté : l'échéancier (`billing.kind = 'schedule'`) est précisément le découpage en
   étapes que l'équipe doit livrer.
2. **Oui, sur option (défaut : oui) pour un échéancier** : un jalon par échéance, titre = libellé de
   l'échéance, échéance = `dueDate`, description = référence de l'échéance et numéro du contrat,
   **sans montant**. Pas de jalon pour un contrat `recurring` (abonnement, une échéance par période
   sans fin) ni `none`. **Retenu.**
3. Une tâche par ligne **et** un jalon par échéance reprenant les lignes de l'échéance. Écarté :
   une ligne d'échéance est une fraction de ligne du contrat ; la recopier en tâches doublerait le
   travail affiché.

### O3 — Facturer depuis un jalon d'un projet sous contrat ?

Le contrat facture lui-même ses échéances et ses périodes (ADR-0050 § 4.3, `sales_document_links`).
Laisser `POST /work/tasks/:taskId/prepare-invoice` créer un brouillon `FV` sur un tel projet ferait
facturer deux fois la même échéance. **Retenu** : refus `409 WORK_CONTRACT_BILLS_ITSELF` quand le
projet suit un contrat dont `billing.kind` vaut `schedule` ou `recurring` ; un contrat sans
facturation (`none`) garde la préparation par jalon.

### O4 — Que verrouille une semaine ?

1. Soumise ET approuvée. Écarté : le membre ne pourrait plus corriger une erreur avant la
   décision, et un renvoi serait le seul chemin.
2. **Approuvée seulement** (consigne). La semaine soumise reste modifiable ; l'approbation porte sur
   l'état au moment de la décision (`approvedMinutes` figé pour information). **Retenu — à revoir
   avec Gracy** (verrou dès la soumission possible sans changer le contrat HTTP).

## Décision

### 1. Contrat → projet

**Route** (module `work/billing/`, aucune route `sales` nouvelle) :

| Route | Droits (conjonctifs) | Effet |
|---|---|---|
| `POST /work/projects/from-contract` `{ contractId, name?, lineIndexes?, scheduleMilestones? }` | `work.manage` + `sales.read` | crée ou relie le projet ; rend `{ project, outcome: 'created' \| 'linked' }` |
| `GET /work/contracts/:contractId/project` | `work.read` + `sales.read` | `{ projectId \| null }` |
| `GET /work/projects/:projectId/contract` | `work.read` + `sales.read` | `{ contract: WorkProjectContractView \| null }` |

1. **Lecture seule du contrat** (`sales_contracts`, par la connexion, motif des devis) ; autre
   organisation ou identifiant invalide : `404 CONTRACT_NOT_FOUND`.
2. **Statut** : seul un contrat `signed` (« signé », quel que soit son statut dérivé : à venir, en
   vigueur, fin proche, terme échu) crée ou relie son projet ; sinon
   `409 WORK_CONTRACT_NOT_SIGNED` (`details.status`). Résilié ou annulé : refusé.
3. **Idempotence** : un contrat qui a déjà son projet → `409 WORK_PROJECT_EXISTS_FOR_CONTRACT`
   (`details.projectId`). La création **réserve** d'abord le contrat (`projectId: null →
   'pending:<contractId>'`, valeur propre à chaque contrat, donc compatible avec l'index unique),
   crée le projet, puis pose l'identifiant ; un échec rend la réservation. Deux appels concurrents
   ne créent qu'un projet. Un `projectId` dont le projet n'existe plus (projet supprimé) est
   remis à `null` à la lecture et la création reprend.
4. **Relier plutôt que doublonner** : avant toute création, le projet existant du **devis
   d'origine** (`source.quoteId` du contrat → projet `source.kind = 'quote'`) puis de
   l'**opportunité** (filtre `opportunityProjectFilter` d'ADR-0040) est cherché ; s'il existe et ne
   suit pas déjà un autre contrat, il est **relié** (`outcome: 'linked'`, rien n'est recréé, aucune
   tâche ajoutée). S'il suit déjà un autre contrat (index unique) :
   `409 WORK_PROJECT_HAS_CONTRACT` (`details.projectId`). Projet archivé : `409 WORK_PROJECT_ARCHIVED`.
5. **Réciproque** : `from-quote` et `from-opportunity` refusent désormais
   (`409 WORK_PROJECT_EXISTS_FOR_QUOTE` / `…_FOR_OPPORTUNITY`) quand un contrat issu de ce devis
   (ou de cette opportunité) a déjà son projet ; `GET /work/quotes/:id/project` et
   `GET /work/opportunities/:id/project` le rendent aussi.
6. **Création** (`outcome: 'created'`) : projet `kind: 'client'`, nom = titre du contrat (ou
   « Projet CT… »), `links.customerId` = client du contrat, `links.opportunityId` = celle du contrat,
   `links.quoteIds` = son devis d'origine s'il en a un, `source: null` (l'origine est le lien du
   contrat). **Une tâche par ligne retenue** (`lineIndexes`, défaut : toutes) : désignation,
   quantité et unité, numéro du contrat — **aucun montant recopié** : le contrat fait foi. Puis
   **un jalon par échéance** si `billing.kind = 'schedule'` et `scheduleMilestones` ≠ `false` (O2).
   Mêmes réglages de création, même borne de projets actifs, même retrait complet en cas d'échec
   que `from-quote`. Activité `project.created` avec `{ contractId, contractNumber }`.
7. **Affichage** : la fiche du contrat (`/ventes/contrats/[id]`) montre « Ouvrir le projet » si
   `projectId` est posé, sinon « Créer le projet » (avec la case « Un jalon par échéance » pour un
   échéancier) aux détenteurs de `work.manage` ; la vue du projet (`/projets/[id]/apercu`) montre un
   bloc **Contrat** (numéro, titre, statut, client, période, facturation) aux détenteurs de
   `sales.read`, sans montant.
8. **Marge** (O3 et lecture) : la marge du projet compte les factures liées au projet
   (`work_invoice_links`) **et** celles que le contrat a préparées (`sales_document_links.contractId`),
   **sans doublon** (union par identifiant de facture) ; les avoirs suivent leur facture d'origine
   comme avant. Aucun montant du contrat n'entre dans la marge : seule une facture définitive porte
   de l'argent (ADR-0039 § 5). Moteur inchangé (`computeProjectMargin`).
9. **Rien d'automatique** : signer un contrat ne crée aucun projet ; aucune facture n'est émise ni
   préparée par ce lot, aucun appel DGI.

### 2. Dépenses récurrentes : fournisseur et projet

1. **Fournisseur**, exactement comme une dépense directe depuis ADR-0075 : `supplierId` facultatif
   (fiche de l'organisation : `404 EXPENSE_SUPPLIER_UNKNOWN` ; fusionnée `409 SUPPLIER_MERGED` ;
   archivée `409 SUPPLIER_ARCHIVED`, sauf la fiche déjà rattachée), ou nom libre « Fournisseur de
   passage » (`supplierName` sans `supplierId`) ; copie `supplierName` jamais réécrite ; la liste des
   règles affiche le **nom courant** de la fiche ; l'audit `treasury.recurring.created|updated` porte
   `supplierId` (identifiant seulement). Écran : `ChoixFournisseurDepense` et `fournisseur-depense.ts`
   réutilisés tels quels ; « + » sous `purchase.manage` seulement.
2. **Projet** : `workProjectId` facultatif sur `treasury_recurring_expenses`, mêmes règles que sur
   une dépense (projet de l'organisation, sinon `404 EXPENSE_WORK_PROJECT_UNKNOWN` ; archivé
   `409 WORK_PROJECT_ARCHIVED`) ; absent à la modification : inchangé ; `null` : détaché. Sélecteur
   « Projet » visible avec `work.read`. Audit : `workProjectId`.
3. **Héritage** : une occurrence confirmée devient une dépense qui porte la fiche (ou le nom libre)
   **et** le projet de sa règle. Projet archivé depuis : la confirmation est refusée
   (`409 WORK_PROJECT_ARCHIVED`) ; on détache le projet de la règle ou on restaure le projet —
   **à revoir avec Gracy** (alternative : confirmer sans projet).
4. Prévision, catégories, pont vers le réalisé, comptabilité : **inchangés** (le projet n'est lu
   que par la marge).

### 3. Filtres de la liste des dépenses

1. `GET /treasury/expenses` accepte `supplierId` (identifiant validé, fiche de l'organisation :
   sinon liste vide, jamais l'existence d'une fiche d'autrui) en plus de `workProjectId`.
2. Écran Dépenses : filtres « Fournisseur » (`EntityPicker` en lecture, fiches seulement) et
   « Projet » (avec `work.read`), lus et écrits dans l'URL (`?fournisseur=<id>&projet=<id>`).
3. Fiche fournisseur (Achats) : lien « Voir toutes ses dépenses » →
   `/tresorerie/depenses?fournisseur=<id>`, visible avec `treasury.read`.

### 4. Validation hebdomadaire des feuilles de temps

**Modèle** `work_timesheet_weeks` (une ligne par membre et par semaine, absente = « en cours ») :
`organizationId`, `userId`, `week` (lundi `AAAA-MM-JJ`), `status` (`submitted` | `approved` |
`returned` | `reopened`), `submittedAt/By`, `decidedAt/By`, `approvedMinutes` (minutes de la
semaine au moment de l'approbation, information), `reason` (motif du dernier renvoi ou de la
dernière réouverture), `history[]` (`{ action, at, by, reason }`, ajout seul), `revision`.
Index unique `{ organizationId, userId, week }` ; index `{ organizationId, status, week }`.

**Routes** (garde `work.read` ; la décision « validateur » est prise dans le service) :

| Route | Qui | Effet |
|---|---|---|
| `GET /work/timesheets?userId=&week=` | inchangé | la vue porte `approval` (statut, dates, motif, `canSubmit`, `canDecide`, `canReopen`) |
| `POST /work/timesheets/submit` `{ week, expectedRevision }` | le membre, pour lui-même | en cours, renvoyée ou rouverte → `submitted` |
| `POST /work/timesheets/approve` `{ userId, week, expectedRevision }` | validateur | `submitted` → `approved` (verrou) |
| `POST /work/timesheets/return` `{ userId, week, expectedRevision, reason }` | validateur | `submitted` → `returned`, motif obligatoire |
| `POST /work/timesheets/reopen` `{ userId, week, expectedRevision, reason }` | validateur | `approved` → `reopened`, motif obligatoire, tracé |
| `GET /work/timesheets/pending` | tout membre | semaines soumises que l'appelant peut valider (200 au plus) |

1. **Validateur** : le **manager** du membre — même relation que le moteur RH (`hrViewerScope`,
   équipe directe et indirecte, sur les fiches, jamais sur un rôle) — **ou** un détenteur effectif
   de `work.manage`. **Jamais soi-même** : `403 WORK_TIMESHEET_SELF_APPROVAL`, même avec
   `work.manage`. Hors portée : `404` (membre introuvable), comme la lecture.
2. **Semaine** : un lundi (`400 WORK_TIMESHEET_WEEK`), jamais future (lundi ≤ aujourd'hui,
   Kinshasa). Révision optimiste : `409 STALE_REVISION` ; transition impossible :
   `409 WORK_TIMESHEET_STATE` (`details.status`).
3. **Verrou** : tant que la semaine est `approved`, toute saisie de temps du membre datée de cette
   semaine — création, modification (y compris déplacer une saisie **vers** ou **depuis** la
   semaine), suppression — est refusée : `409 WORK_TIMESHEET_LOCKED` (`details.week`), quel que
   soit l'auteur (le membre ou un `work.manage`). Seule la **réouverture** par un validateur lève le
   verrou ; elle est tracée (`history`, activité, audit `work.timesheet.reopened` avec le motif).
4. **Audit** : `work.timesheet.submitted|approved|returned|reopened` (`targetType:
   'work_timesheet_week'`, métadonnées : `userId`, `week`, minutes ; motif pour renvoi et
   réouverture). Aucun nom, aucun coût.
5. **Marge** : **tout** le temps saisi reste compté (inchangé) ; la vue porte en plus
   `timeApproval: { totalMinutes, approvedMinutes }` — minutes du projet dans une semaine approuvée —
   **à titre informatif**, calculé par le moteur (`timeApprovalShare`, `packages/engine/src/work`),
   jamais soustrait.
6. **« Mes tâches »** : port `WORK_TIMESHEET_AGENDA_SOURCE` (`work/my-tasks.ports.ts`), fournisseur
   réel dans `work/timesheets/`. Élément `source: 'work_timesheet'`, `kind: 'timesheet_approval'`
   (`id: 'work:timesheet:<userId>:<week>'`, nom du membre, semaine, minutes, échéance = dimanche
   de la semaine, lien vers la feuille), sans case à cocher (valider est une décision). Un élément
   va au **manager** ; s'il n'y en a pas (pas de fiche, pas de manager, manager sans compte), aux
   détenteurs de `work.manage`. Un `work.manage` peut toujours suppléer depuis la feuille.
7. **Brief du matin** : fait `mes_validations_temps.en_attente` (nombre seulement, même audience que
   « Mes tâches ») et règle **R21 `validations_temps_en_attente`** (rang 21, `attention`),
   `actionPath: '/projets/mes-taches/temps/a-valider'` ; `MORNING_BRIEF_VERSION` **1.7.0** ; sans
   l'entrée, le fait est « non disponible » et R1 à R20 sont inchangées.
8. **Paie** : rien n'est relié (ADR-0070). Le temps validé n'alimente ni salaire, ni taux, ni
   bulletin, ni `work_member_rates`.
9. **Écran** (`feuille-temps.tsx`, `temps-model.ts`) : pastille de statut, « Soumettre la semaine »
   pour soi, « Approuver », « Renvoyer » (motif), « Rouvrir » (motif) pour le validateur ; la
   page `/projets/mes-taches/temps/a-valider` liste les semaines à valider. Les saisies d'une
   semaine approuvée ne proposent plus de modifier ni de supprimer.

## Conséquences

- Le parcours « devis → contrat → projet » ne crée plus deux projets pour un même engagement.
- Un projet sous contrat à échéancier ne prépare plus de facture par jalon : la facturation passe
  par le contrat ; sa marge lit les factures du contrat.
- Le temps d'une semaine approuvée ne bouge plus sans une réouverture tracée.
- `sales_contracts` gagne un index unique partiel (aucune donnée existante concernée : `projectId`
  toujours `null` avant ce lot). `treasury_recurring_expenses` gagne `workProjectId` (défaut
  `null`, aucune migration).

## Critères d'acceptation (testés)

- Contrat signé → projet créé, une tâche par ligne sans montant, un jalon par échéance ; second
  appel → `409 WORK_PROJECT_EXISTS_FOR_CONTRACT` ; projet du devis existant → relié ; contrat
  brouillon → `409 WORK_CONTRACT_NOT_SIGNED` ; contrat d'une autre organisation → 404 ; puis
  `from-quote` du même devis → `409 WORK_PROJECT_EXISTS_FOR_QUOTE`.
- Jalon d'un projet sous contrat à échéancier → `409 WORK_CONTRACT_BILLS_ITSELF`.
- Règle récurrente avec fiche et projet → occurrence confirmée qui porte les deux ; fiche d'autrui →
  404, archivée → 409, fusionnée → 409 ; projet d'autrui → 404.
- `GET /treasury/expenses?supplierId=` rend les seules dépenses de la fiche ; identifiant invalide
  → 400.
- Soumettre, approuver, renvoyer (motif), rouvrir (motif) ; s'approuver soi-même → 403 ; non
  manager sans `work.manage` → 404 ; saisie dans une semaine approuvée → `409 WORK_TIMESHEET_LOCKED`
  (création, modification, suppression), puis possible après réouverture ; semaine à valider dans
  « Mes tâches » du manager et dans le brief.

## Hors périmètre

- Lier un contrat à un projet **quelconque** à la main, ou délier : non fait (le lien suit le devis
  ou l'opportunité, ou naît avec le projet) — **à revoir avec Gracy**.
- Notifications (cloche, e-mail, Slack, WhatsApp) pour les feuilles soumises ou décidées : non
  faites ; « Mes tâches » et le brief suffisent pour ce lot.
- Rappel automatique « semaine non soumise », validation en masse, verrou à la soumission (O4).
- Toute relation avec la paie (ADR-0070).

## Liens

[ADR-0033](ADR-0033-brief-du-matin.md), [ADR-0039](ADR-0039-projets-et-taches-run.md),
[ADR-0040](ADR-0040-crm-complet.md), [ADR-0044](ADR-0044-achats-et-fournisseurs.md),
[ADR-0045](ADR-0045-ressources-humaines.md), [ADR-0050](ADR-0050-contrats-commandes-acomptes-abonnements.md),
[ADR-0070](ADR-0070-paie-rdc.md), [ADR-0074](ADR-0074-formulaires-modernes.md),
[ADR-0075](ADR-0075-depense-fournisseur-telephones.md).
