# ADR-0051 — Ressources humaines, second volet (R4 bis) : notes de frais, avances au personnel, présences et pointage simple, plannings, objectifs individuels et évaluations — paie exclue

Statut : Proposed

> **3 nov. 2026 — décisions ouvertes tranchées par [ADR-0054](ADR-0054-decisions-du-3-novembre.md)** (valeurs par défaut gardées sauf mention contraire, à revoir avec le juriste et l'expert-comptable).

Date : 2026-11-01
Décideurs : Gracy Omokoso (dirigeante) — **RUN complet** (brief § 5.7 : « employés, départements,
postes, contrats, rémunérations, congés, absences, présences, avances, notes de frais, objectifs,
évaluations et plannings ») et **paie exclue** par sa décision ; CTO Lalanda (contrat technique). Le
cadrage est **proposé** : chaque choix qui lui appartient porte une valeur par défaut, la plus
prudente, appliquée tant qu'elle ne tranche pas autrement (§ Décisions ouvertes). **Cet ADR ne pose
aucune règle sociale, fiscale ni de droit du travail congolais** : plafonds, quotités de retenue,
durée légale du travail, repos, heures supplémentaires, conservation des données de pointage et des
évaluations, barèmes d'indemnités sont des **questions au juriste ou à l'expert-comptable** (§ Questions)
et restent des réglages vides tant qu'ils n'ont pas répondu.

> **Complète [ADR-0045](ADR-0045-ressources-humaines.md)** (R4, RH sans la paie) en reprenant cinq
> sujets qu'il avait renvoyés : notes de frais (sa décision ouverte n° 15), objectifs et évaluation
> (n° 16), pointage et plannings (§ Hors périmètre, n° 10). Il en **reprend sans les modifier** la
> fiche collaborateur (`hr_employees`, `managerEmployeeId`, `userId`), la portée relationnelle
> (`hrViewerScope`), le chiffrement des sections sensibles (§ 2.4), le motif des documents (§ 2.8)
> et l'approbation à deux étapes (manager par relation, puis détenteur d'une action, § 4.3).
> **Amende [ADR-0012](ADR-0012-modele-rbac-complet.md) et docs/12** : quatre actions nouvelles
> (`expenses.claim`, `expenses.approve`, `attendance.clock`, `performance.read`), **aucun rôle
> nouveau** (§ 5). **Étend [ADR-0041](ADR-0041-autorisations-par-membre.md)** : neuvième domaine
> « Ressources humaines » agrandi, dépendances, une paire `SOD_PAIRS`, `expenses.approve` parmi les
> actions à séparation dynamique. **Étend [ADR-0034](ADR-0034-depenses-et-tresorerie.md)** : une
> dépense ou un mouvement de trésorerie peut être **possédé par les RH**, motif exact de la dépense
> possédée par les achats d'[ADR-0044](ADR-0044-achats-et-fournisseurs.md) § 2.8 et § 6.2.
> **Demande un amendement d'[ADR-0049](ADR-0049-comptabilite-syscohada.md) § 6.3** : le filtre
> « `origin` nulle seulement » écarterait aujourd'hui **toute** dépense possédée, y compris un
> remboursement de frais (§ 7.4, lot H13). **Étend [ADR-0039](ADR-0039-projets-et-taches-run.md)**
> (« Mes tâches », cloche, marge par la dépense) et **[ADR-0033](ADR-0033-brief-du-matin.md)**
> (règles R19 et R20). La **paie** reste hors périmètre, comme dans ADR-0045 : aucun brut, aucun net,
> aucune retenue calculée, aucune cotisation.

## Contexte

R4 (ADR-0045) a livré le dossier du personnel, les services, les postes (intitulés), les contrats
(type, dates), la rémunération **déclarée** (section chiffrée), les congés et les absences, les
documents RH, les entrées et sorties, la feuille de temps **en lecture**. Restent six besoins du brief
§ 5.7, aujourd'hui tenus sur papier, dans un classeur ou par message :

1. **Notes de frais.** Un collaborateur avance un taxi, un repas client, un plein ; il garde le ticket,
   le remet « quand il y pense » ; personne ne sait ce qui est dû, ni à qui, ni si c'est validé. Le
   remboursement, quand il est payé, entre en trésorerie comme une dépense sans lien avec la demande.
2. **Avances.** Avance **de frais** (de l'argent remis avant une mission, à justifier) et avance
   **sur salaire** (de l'argent remis avant la paie, à régulariser). Les deux sortent de la caisse
   sans être des charges ; elles se perdent si rien ne suit leur régularisation.
3. **Présences.** Qui était là, à quelle heure, pour une PME qui en a besoin (boutique, chantier,
   accueil) — sans badgeuse, sans géolocalisation, sans biométrie.
4. **Plannings.** Qui travaille quand et où, pour des équipes à horaires (accueil, hôtesses,
   chauffeurs), avec le recoupement des absences déjà connues.
5. **Objectifs individuels.** Ce qu'on attend de chacun sur une période, et où il en est.
6. **Évaluations.** L'entretien annuel ou périodique : une trame, une auto-évaluation, l'appréciation
   du manager, un échange, une trace — **données parmi les plus sensibles** du dossier.

### Faits du dépôt qui commandent les décisions

| Fait | Où | Conséquence |
|---|---|---|
| Dix actions et deux rôles RH déjà en place : `hr.read`, `hr.manage`, `hr.sensitive.read`, `leave.request`, `leave.approve` ; rôle `hr_manager` (rang 6) | `apps/api/src/authz/permissions.ts`, docs/12 § ADR-0045 | les nouveaux objets s'appuient sur ces actions ; quatre actions seulement s'ajoutent |
| **12 rôles, 51 actions, 918 cases** (12 × 51 + 6 × 51) ; treize domaines ; `APPROVAL_ACTIONS` = `plan.approve`, `purchase.approve`, `leave.approve`, `stock.manage`, `accounting.post`, `accounting.manage` ; `SOD_PAIRS` = trois paires dont `purchase.approve` + `payables.pay` | `permissions.ts` ; docs/12 § ADR-0049 | matrice **12 × 55 + 6 × 55 = 990** cases si cet ADR fusionne seul ; numérotation recalée si ADR-0050 ajoute des actions avant |
| `payables.pay` (« Payer les fournisseurs ») : Propriétaire, Directeur financier, Comptable ; dépend de `purchase.read` et `treasury.read` | ADR-0044 § 4.1, § 4.3 | le **décaissement** d'un remboursement ou d'une avance réutilise `payables.pay` (§ 5.1) au lieu d'une action de plus |
| `leaveApprovalDecision`, `purchaseApprovalDecision` jugent des **personnes** (bénéficiaire, auteur, approbations antérieures, nombre de détenteurs effectifs) ; approbateur unique marqué `soleApprover` | `permissions.ts` ; ADR-0041 § 4 ; ADR-0045 § 4.3 | `expenseApprovalDecision` et `reviewCloseDecision` suivent ce motif, exception d'approbateur unique comprise |
| `treasury_expenses.origin` : `null` (directe) \| `{ kind: 'supplier_payment', … }` ; non nulle ⇒ `409 EXPENSE_OWNED_BY_PURCHASES` sur les routes de la trésorerie ; `recordOwnedBySupplierPayment` seul écrivain | `treasury/treasury.schemas.ts` ; ADR-0044 § 2.8, § 6.2 | le remboursement d'une note de frais crée des dépenses **possédées par les RH** (`origin.kind = 'expense_report'`), même motif, même service |
| `treasury_movements` : `transfer`, `other_in`, `other_out` ; **pas** de champ `origin` ; `other_out` = « autre sortie hors dépenses » | `treasury.schemas.ts` ; ADR-0034 § 4 | une avance n'est **pas une charge** : son versement est un `other_out`, son remboursement un `other_in`, tous deux possédés par les RH (champ `origin` ajouté) |
| Quatorze catégories de dépense (`EXPENSE_CATEGORIES`) ; seules les catégories d'exploitation vont au pont vers le réalisé | ADR-0034 § 1, § 5 | une ligne de note de frais porte **une de ces quatorze catégories** ; aucune catégorie nouvelle |
| La comptabilité ignore toute dépense dont `origin` n'est pas nulle (`skipped: 'CREATED_BY_SUPPLIER_PAYMENT'`) | `packages/engine/src/accounting/entries/purchases.ts` l. 48 ; ADR-0049 § 6.3 | sans amendement, un remboursement de frais **disparaîtrait** de la comptabilité : le filtre doit viser `origin.kind = 'supplier_payment'` seulement (lot H13) |
| `other_in` et `other_out` vont au **compte d'attente** (nature inconnue de la pièce) | ADR-0049 § 6.6 ; `accounting/entries/treasury.ts` | une avance versée ou remboursée est en attente par défaut ; la clé d'opération propre est une **question à l'expert-comptable** (C2) |
| Marge d'un projet : coût du temps + dépenses `workProjectId` ; `WORK_MARGIN_VERSION = '1.3.0'` | `engine/src/work/types.ts` ; ADR-0039 § 5 | une ligne de frais imputée à un projet entre dans la marge **par sa dépense de remboursement**, sans code nouveau dans la marge |
| Brouillon de facture depuis un projet ou une tâche (`POST /work/tasks/:id/prepare-invoice`) ; jamais émis seul | `work/billing/work-billing.controller.ts` (ADR-0039 lot L4a) | « refacturable » est une **marque** qui alimente une liste ; refacturer reste un geste de `sales.manage` |
| Pièces jointes : motif d'ADR-0039 § 2.5 (images assainies ≤ 2 Mio, PDF ≤ 10 Mio inerte, clé au hasard, 30 envois par heure, 1 Gio par organisation) ; documents RH sensibles chiffrés par enveloppe | ADR-0044 § 2.7 ; ADR-0045 § 2.8 | justificatifs de frais : même motif, préfixe `hr-expense-receipts/` ; **les pièces RH ne sortent jamais de `/rh`** (ADR-0046 O5) |
| `hr_employee_private.compensation` : salaire **déclaré**, chiffré, jamais calculé | ADR-0045 § 2.4 | une avance sur salaire **ne lit pas** le salaire : aucun plafond « en pourcentage du salaire » n'est calculé |
| `work_time_entries` (temps passé sur les projets) ; `GET /work/timesheets` en lecture ; `availabilityOf` | ADR-0045 § 6.3 ; `work/timesheets/**` ; `engine/src/hr/` (`HR_VERSION = '1.0.0'`) | la **présence** (être là) est distincte du **temps** (sur quel projet) ; aucune saisie n'est dupliquée |
| `apps/api/src/objectives/` = **objectifs financiers** du plan (taux d'atteinte, S18d) | `objectives/attainment.ts` | les objectifs individuels prennent un autre nom de code (`Goal`, `hr_goals`) pour éviter toute confusion |
| `MORNING_BRIEF_VERSION = '1.5.0'`, règles R1 à R18 | `engine/src/morning-brief/` | R19 et R20, version **1.6.0** (recalée si ADR-0050 avance la version avant) |
| Ports « Mes tâches » : `CRM_`, `PURCHASES_`, `HR_`, `STOCK_`, `ASSETS_AGENDA_SOURCE` | `work/my-tasks.ports.ts` | **aucun port nouveau** : `HR_AGENDA_SOURCE` gagne des natures d'éléments |
| docs/28 § 1.3 : protection des données et conservation sont des **questions au juriste** | `docs/28-CONFORMITE-LEGALE.md` | aucune durée de conservation n'est fixée ; réglages vides par défaut |

## Options considérées

### O1 — Le remboursement d'une note de frais : dépense, paiement, ou dette ?

1. **Nouvelle sortie de trésorerie** lue par port. Écarté pour la raison d'ADR-0044 O2 : soldes, marge,
   pont vers le réalisé, résumés et prévision lisent `treasury_expenses` ; il faudrait les modifier tous.
2. **Une dette envers le salarié** (compte de tiers) constatée à l'approbation, payée ensuite. Écarté
   **pour la trésorerie** : le réalisé de Lalanda est un réalisé de trésorerie (docs/08, ADR-0044 § 6.2) ;
   la dette existe déjà, sans collection nouvelle, comme **« approuvée, à rembourser »** (prévision,
   § 7.2). Sa comptabilisation à l'approbation est une **question à l'expert-comptable** (C1).
3. **Le remboursement crée des dépenses `treasury_expenses`, possédées par les RH**, une par ligne de
   la note (catégorie, projet, montant de la ligne), `origin.kind = 'expense_report'`. Modifiables et
   annulables **seulement** par le module RH (`409 EXPENSE_OWNED_BY_HR`). **Retenu** : c'est
   exactement le chemin du paiement fournisseur ; marge, pont, résumés et prévision les voient sans
   changement.

### O2 — L'avance : dépense ou mouvement ?

1. **Une dépense** de catégorie `personnel` ou `charges_diverses`. Écarté : une avance n'est pas une
   charge ; elle irait au réalisé (pont ADR-0034 § 5) et serait comptée **deux fois** — à l'avance, puis
   au salaire ou aux frais justifiés.
2. **Un mouvement `other_out`** (sortie hors dépenses) au versement, `other_in` au remboursement en
   espèces, tous deux **possédés par les RH** ; la justification par une note de frais crée les
   dépenses **sans compte** (l'argent est déjà sorti à l'avance). **Retenu.** Soldes justes (une seule
   sortie), réalisé juste (la charge naît à la justification), comptabilité prudente (attente).

### O3 — Avance sur salaire et paie exclue

1. **Calculer la retenue** sur le prochain salaire. Écarté : c'est de la paie, exclue par la dirigeante ;
   les plafonds et quotités sont du droit du travail non établi dans `docs/` (J1).
2. **Suivre sans calculer** : l'avance est versée, puis **régularisée** par un remboursement en espèces
   (`other_in`) ou par une **déclaration** « régularisée sur la paie de {mois}, hors Lalanda » (montant
   saisi, aucun calcul, aucun mouvement). Le reste dû est calculé par le moteur à partir de ces faits.
   **Retenu**, avec un constat qui rappelle que le salaire payé net de l'avance doit être saisi pour son
   montant **net payé** (§ 7.2).

### O4 — Pointage : quel niveau ?

1. Badgeuse, géolocalisation, photo, biométrie. Écarté : matériel, données sensibles sans base légale
   établie (J4), et hors cible (PME de quelques personnes).
2. **Pointage simple** : « J'arrive » / « Je pars » depuis Lalanda (horodatage serveur, **aucune
   position**), ou saisie par le manager ou les RH pour un collaborateur sans compte ; corrections
   motivées et tracées. **Désactivé par défaut**, activé par l'organisation. **Retenu.**

### O5 — Plannings : outil d'optimisation ou grille ?

1. Optimiseur (affectation automatique selon contraintes). Écarté : contraintes légales non sourcées
   (repos, durée, J3) ; une affectation automatique est une **décision sur les personnes**.
2. **Grille de créneaux** saisie par le manager ou les RH, publiée, avec **constats** calculés par le
   moteur (créneau pendant une absence, chevauchement, effectif sous le minimum que l'organisation a
   saisi). L'IA **explique** les constats ; elle ne place personne. **Retenu.**

### O6 — Évaluations : où et comment protéger ?

1. Dans `hr_documents` (un PDF). Écarté : pas de trame, pas de circuit, pas de lien aux objectifs.
2. **Collection dédiée**, contenu (appréciations, notes, commentaires) **chiffré** par section (motif
   d'ADR-0045 § 2.4), action de lecture **dédiée** (`performance.read`) distincte de
   `hr.sensitive.read` : le Directeur financier lit les salaires, il n'a pas à lire les entretiens.
   **Retenu.** Toute note est **posée par une personne** ; le moteur n'en calcule aucune.

### O7 — Actions : réutiliser ou ajouter ?

- **Réutilisées** : `hr.read` (registre), `hr.manage` (plannings et présences de tous, campagnes,
  réglages), `hr.sensitive.read` (avances sur salaire), `payables.pay` (décaisser), `leave.approve`
  n'est **pas** réutilisée pour les frais (autorité sur le temps, pas sur l'argent).
- **Ajoutées** : `expenses.claim` (déclarer pour soi), `expenses.approve` (autorité de dépense sur les
  frais et avances, ⓢ), `attendance.clock` (pointer pour soi), `performance.read` (lire objectifs et
  évaluations de tous). **Aucun rôle nouveau** : le Responsable RH et les rôles financiers couvrent les
  profils. **Retenu.**

### O8 — Où vivent les contrats et les calculs

Comme ADR-0045 O7 : contrats zod dans `packages/shared/src/hr/` (fichiers ajoutés), calculs dans le
moteur pur `packages/engine/src/hr/` (`HR_VERSION` **1.1.0**, sorties 1.0.0 inchangées), montants en
chaînes décimales (`bigint` en centimes), minutes entières pour les présences, jour de référence en
paramètre.

## Décision

### 1. Vocabulaire

| Interface (français) | Code | Collection |
|---|---|---|
| Note de frais | `ExpenseReport` | `hr_expense_reports` (nouvelle) |
| Ligne de frais | `ExpenseLine` | incluse dans la note |
| Justificatif | `ExpenseReceipt` | objet `hr-expense-receipts/<objectId>`, métadonnées dans la ligne |
| Avance (de frais, sur salaire) | `EmployeeAdvance` | `hr_advances` (nouvelle) |
| Régularisation d'une avance | `AdvanceSettlement` | incluse dans l'avance (ajout seul) |
| Pointage (arrivée, départ) | `AttendanceEvent` | `hr_attendance_events` (nouvelle, ajout seul) |
| Journée de présence | `AttendanceDay` | calculée par le moteur, jamais stockée |
| Demande de correction de pointage | `AttendanceCorrection` | `hr_attendance_corrections` (nouvelle) |
| Créneau de planning | `Shift` | `hr_shifts` (nouvelle) |
| Besoin minimal d'effectif | `StaffingNeed` | `hr_staffing_needs` (nouvelle) |
| Objectif individuel | `Goal` | `hr_goals` (nouvelle) |
| Campagne d'évaluation | `ReviewCycle` | `hr_review_cycles` (nouvelle) |
| Évaluation (entretien) | `Review` | `hr_reviews` (nouvelle) |
| Réglages du second volet | — | champs ajoutés à `hr_settings` (§ 2.7) |

Conventions d'ADR-0045 § 1 inchangées : dates civiles au jour de Kinshasa, horodatages UTC,
`organizationId`, `revision`, `createdBy`, `updatedBy`, `_schemaVersion` ; ressource d'une autre
organisation ou hors portée : **404** ; `expectedRevision` → `409 STALE_REVISION` ; devises `CDF` et
`USD`, **jamais de conversion**. Numéros de pièce internes : notes `NF{AA}{MM}-NNNNNN`, avances
`AV{AA}{MM}-NNNNNN` (compteur par organisation, motif `PF…` d'ADR-0044).

### 2. Modèle de données

#### 2.1 `hr_expense_reports`

| Champ | Règle |
|---|---|
| `number` | `NF…`, attribué à la **soumission** (un brouillon n'a pas de numéro) |
| `employeeId` | le bénéficiaire : la fiche reliée à l'appelant (`409 EMPLOYEE_NOT_LINKED` sinon) ; un détenteur de `hr.manage` **et** `expenses.claim` peut saisir pour un collaborateur **sans compte** (chauffeur) |
| `title` | 1 à 120 (« Mission Matadi, 3–5 nov. ») |
| `currency` | `CDF` \| `USD` ; **une devise par note** : une ligne dans une autre devise va dans une autre note (`422 EXPENSE_REPORT_CURRENCY_MISMATCH`) |
| `lines` | 1 à 50 `ExpenseLine` (ci-dessous) |
| `total` | **calculé par le moteur** (`expenseReportTotals`), jamais saisi |
| `advanceId` | `null` \| une avance **de frais** versée du même collaborateur, même devise, non soldée : la note **justifie** cette avance (§ 3.3) |
| `status` | `draft` → `submitted` → `approved` \| `rejected` ; `approved` → `reimbursed` (ou `settled_by_advance`, ou `partially_settled`) ; `cancelled` (par le bénéficiaire tant que `draft` ou `submitted` ; par `expenses.approve` tant que rien n'est remboursé, motif obligatoire) |
| `steps` | figés à la soumission (`expenseApprovalSteps`, § 3.1) : `['manager', 'finance']`, `['finance']` |
| `approvals` | `[{ step, userId, decision, at, comment, soleApprover, onBehalfOfManager }]` |
| `reimbursement` | `null` \| `{ paidOn, accountId, method, reference, paidBy, expenseIds[] }` (§ 3.1) |
| `submittedAt`, `submittedBy` | — |

**Ligne de frais** :

| Champ | Règle |
|---|---|
| `spentOn` | date civile, jamais future (`EXPENSE_IN_FUTURE`) |
| `category` | l'une des **quatorze catégories** d'ADR-0034 § 1 ; `investissement` et `remboursement_emprunt` refusées (`422 EXPENSE_LINE_CATEGORY_NOT_ALLOWED` : une immobilisation passe par les achats) |
| `label` | 1 à 200 |
| `amount` | montant **payé par le collaborateur**, chaîne décimale > 0, deux décimales au plus |
| `merchant` | facultatif, ≤ 120 (texte ; aucun lien vers une fiche fournisseur) |
| `deductibleVat` | TVA **déclarée**, facultative, ≤ montant ; **conservée, jamais utilisée dans un calcul** (motif d'ADR-0034, d.o. n° 1) |
| `workProjectId` | `null` \| projet RUN non archivé de l'organisation (`422 EXPENSE_WORK_PROJECT_UNKNOWN`) |
| `rebillable` | défaut `false` ; vrai seulement avec `workProjectId` ; **marque informative** (§ 6.5), aucune facture créée |
| `receipt` | `null` \| `{ objectId, contentType, size, uploadedAt, uploadedBy }` ; motif d'ADR-0044 § 2.7 (images PNG, JPEG, WebP ≤ 2 Mio **assainies** ; PDF ≤ 10 Mio par signature `%PDF-`, **non analysés**, servis en téléchargement inerte) ; `415 EXPENSE_RECEIPT_TYPE` ; clé `hr-expense-receipts/<objectId>` au hasard ; borne commune de 1 Gio par organisation |
| `missingReceiptReason` | requis si `receipt` est nul et que `hr_settings.expenses.receiptRequired` est vrai (≤ 300) ; l'écran le dit ; **aucun seuil de montant** n'est posé par Lalanda (décision ouverte n° 6) |

Aucun barème : ni indemnité kilométrique, ni forfait de repas, ni indemnité journalière (per diem) ;
une ligne est un montant réellement payé (J5, C4). Index : `{ organizationId, employeeId, status,
submittedAt }` ; `{ organizationId, status, submittedAt }` ; `{ organizationId,
'lines.workProjectId' }` (partiel) ; unique partiel `{ organizationId, number }`.

#### 2.2 `hr_advances`

| Champ | Règle |
|---|---|
| `number` | `AV…`, à la soumission |
| `employeeId` | le bénéficiaire (mêmes règles que § 2.1) |
| `kind` | `expenses` (avance **de frais**, à justifier par des notes) \| `salary` (avance **sur salaire**, à régulariser) |
| `amount`, `currency` | demandé ; chaîne décimale > 0 ; **aucun plafond** posé par Lalanda ; un plafond **saisi** par l'organisation (`hr_settings.advances.maxAmount[currency]`, défaut `null`) refuse au-delà (`422 ADVANCE_ABOVE_ORGANIZATION_LIMIT`) — sa valeur est une décision de l'organisation, sa licéité une question au juriste (J1) |
| `reason` | ≤ 500 ; pour `salary`, **sensible** (§ 4) |
| `purpose` | pour `expenses` : ≤ 200, et `workProjectId` facultatif |
| `expectedSettlement` | facultatif : date ou mois de régularisation **annoncé** (`AAAA-MM`) ; informatif |
| `status` | `draft` → `submitted` → `approved` \| `rejected` → `disbursed` → `partially_settled` → `settled` ; `cancelled` (avant versement) ; `written_off` (abandon de créance, `expenses.approve` + motif, **jamais** automatique ; traitement fiscal et social : J2, C3) |
| `steps` | `expenses` : comme une note de frais ; `salary` : **`['finance']` seul** — le manager n'est **pas** informé d'une avance sur salaire (vie privée financière ; décision ouverte n° 4) |
| `approvals` | comme § 2.1 |
| `disbursement` | `null` \| `{ paidOn, accountId, method, reference, paidBy, movementId }` |
| `settlements` | ajout seul, 0 à 100 `{ id, kind, amount, on, reference, by, at, note, movementId? , expenseReportId? }` (§ 3.3) |
| `outstanding` | **calculé par le moteur** (`advanceOutstanding`) : versé − Σ régularisations ; jamais stocké |

Une avance sur salaire **ne lit pas** `hr_employee_private.compensation` : aucun « pourcentage du
salaire » n'est calculé ni affiché. Index : `{ organizationId, employeeId, status }` ; `{ organizationId,
status, kind }` ; unique partiel `{ organizationId, number }`.

#### 2.3 `hr_attendance_events` et `hr_attendance_corrections`

**Pointage** (ajout seul, jamais modifié ni effacé hors purge réglée) :

| Champ | Règle |
|---|---|
| `employeeId` | requis |
| `kind` | `in` \| `out` |
| `at` | horodatage **serveur** pour un pointage par soi (`source: 'self'`) ; saisi pour `source: 'manager'` ou `'hr'` (jamais futur) |
| `source` | `self` \| `manager` \| `hr` \| `correction` |
| `note` | ≤ 200 ; obligatoire si `source ≠ self` |
| `voidedBy` | `null` \| identifiant de la correction qui l'annule (le document reste) |

**Aucune** adresse IP, position, photo, empreinte, identifiant d'appareil n'est stockée (O4). Débit :
au plus 20 pointages par jour et par collaborateur (`429 ATTENDANCE_RATE_LIMITED`). Deux `in`
consécutifs ne sont pas refusés : le moteur les signale (`ATTENDANCE_UNPAIRED`).

**Correction** : `{ employeeId, date, proposed: [{ kind, at }], voidEventIds[], reason (1–300), status:
'pending' | 'approved' | 'rejected', decidedBy, decidedAt, comment }`. Demandée par le collaborateur
(pour soi) ou saisie par le manager ou les RH ; décidée par le manager (relation) ou `hr.manage`,
**jamais par le demandeur** (§ 3.4). Approuvée : écrit les événements `source: 'correction'` et pose
`voidedBy` sur les annulés, **dans la même transaction**.

**Journée de présence** (moteur `attendanceDay`) : paires `in`/`out` du jour civil, durée en
**minutes**, premiers et derniers horaires, constats : `ATTENDANCE_UNPAIRED`, `ATTENDANCE_ON_LEAVE_DAY`
(pointage un jour d'absence approuvée), `ATTENDANCE_WITHOUT_SHIFT` (pointage sans créneau publié, si
les plannings sont actifs), `SHIFT_WITHOUT_ATTENDANCE` (créneau publié passé sans pointage),
`ATTENDANCE_LATE_START` (arrivée après le début du créneau **plus la tolérance saisie** par
l'organisation, défaut `null` = constat éteint). **Aucun calcul d'heures supplémentaires, aucune durée
légale** (J3) ; les constats sont des **faits**, jamais des sanctions.

Index : `{ organizationId, employeeId, at }` ; `{ organizationId, at }`.

#### 2.4 `hr_shifts` et `hr_staffing_needs`

**Créneau** : `{ employeeId, date, start: 'HH:MM', end: 'HH:MM', crossesMidnight, label (≤ 60),
location (≤ 120), departmentId?, workProjectId?, status: 'draft' | 'published' | 'cancelled',
publishedAt, publishedBy, note (≤ 300) }`. Durée ≤ 24 h. Chevauchement de deux créneaux non annulés du
même collaborateur : `409 SHIFT_OVERLAP`. Créneau pendant une absence **approuvée** : accepté, constat
`SHIFT_DURING_LEAVE` (le planificateur décide). Copier une semaine (`POST /hr/shifts/copy-week`) crée
des brouillons. Publier envoie une notification au collaborateur relié. **Aucun contrôle** de durée
maximale, de repos quotidien ou hebdomadaire, de travail de nuit : ce sont des règles légales non
établies (J3) ; une organisation peut saisir des **seuils indicatifs** (`hr_settings.planning.
indicativeMaxMinutesPerWeek`, défaut `null` = constat éteint) qui lèvent `SHIFT_ABOVE_INDICATIVE_LIMIT`,
jamais un refus.

**Besoin minimal** (facultatif) : `{ departmentId | location, weekday, start, end, minStaff (1–200),
label }`, saisi par l'organisation. Le moteur (`staffingGaps`) compare les créneaux publiés au besoin et
lève `UNDERSTAFFED_SLOT` (effectif planifié, effectif disponible après absences). C'est l'**alerte de
capacité** du brief § 5.7 : un constat calculé, expliqué par l'IA, jamais une réaffectation.

Index : `{ organizationId, date, employeeId }` ; `{ organizationId, employeeId, date }`.

#### 2.5 `hr_goals`

| Champ | Règle |
|---|---|
| `employeeId` | requis |
| `period` | `{ from, to }` (dates civiles) ; `reviewCycleId` facultatif |
| `title`, `description` | 1–200, ≤ 2 000 |
| `measure` | ≤ 300, texte : comment on saura que c'est atteint |
| `target` | facultatif : `{ kind: 'text', value }` \| `{ kind: 'number', value, unit (≤ 20) }` |
| `weight` | facultatif, entier 0–100 ; **aucune somme imposée** |
| `workProjectId` | facultatif (lien de lecture vers un projet RUN ; ne donne aucun droit sur le projet) |
| `status` | `proposed` (par le collaborateur) \| `agreed` (validé par le manager ou `hr.manage`, **jamais par le collaborateur seul**) → `achieved` \| `partially_achieved` \| `not_achieved` \| `dropped` (posés **par une personne**, commentaire) |
| `progress` | déclarations ajout seul `{ at, by, percent? (0–100), note }` ; **aucun avancement calculé** |
| `visibility` | `private` (soi, chaîne de managers, `performance.read`) — seule valeur en H15 |

Index : `{ organizationId, employeeId, 'period.to' }`.

#### 2.6 `hr_review_cycles` et `hr_reviews`

**Campagne** : `{ label, period: { from, to }, template: { sections: 1–20 [{ id, title, kind: 'text' |
'scale' | 'goals', scale?: { min, max, labels[] } }] }, includesSelfAssessment (défaut true),
openOn, dueOn, status: 'draft' | 'open' | 'closed', employeeIds[] }`. La **trame et l'échelle sont
saisies par l'organisation** ; Lalanda propose un modèle vide (titres seulement : « Bilan de la période
», « Objectifs », « Besoins de formation », « Commentaire du collaborateur »), **sans échelle ni
critère imposés**. Ouvrir une campagne crée une évaluation par collaborateur listé, avec pour
`reviewerUserId` l'utilisateur de son **manager** à cette date (sinon : un détenteur de `hr.manage`
choisi par l'auteur ; jamais le collaborateur lui-même).

**Évaluation** :

| Champ | Règle |
|---|---|
| `cycleId`, `employeeId`, `reviewerUserId` | figés à l'ouverture ; changer d'évaluateur : `hr.manage` + `performance.read`, motif, audit |
| `status` | `not_started` → `self_submitted` (si auto-évaluation) → `manager_submitted` → `shared` (le collaborateur voit l'appréciation) → `acknowledged` (il signe **avoir pris connaissance**, avec son commentaire ; **ce n'est pas un accord**) → `closed` (étape RH) ; `cancelled` |
| `selfAssessment`, `managerAssessment`, `employeeComment`, `hrNote` | **sections chiffrées** (motif d'ADR-0045 § 2.4 : AES-256-GCM sous `MASTER_KEYRING`, emplacement `org:hr_reviews`, **AAD = `organizationId + reviewId + section`**) ; jamais en clair dans une liste, un journal, une notification, le brief ni l'IA |
| `ratings` | dans `managerAssessment` : par section `scale`, une valeur **choisie par l'évaluateur** ; `overall` facultatif, **choisi**, jamais calculé (pas de moyenne pondérée) |
| `goalIds` | objectifs de la période, **instantané** de leurs titres et statuts à `manager_submitted` |
| `closedBy`, `closedAt` | `reviewCloseDecision` (§ 3.5) |

Index : `{ organizationId, cycleId, status }` ; `{ organizationId, employeeId }` ; `{ organizationId,
reviewerUserId, status }`.

**Aucun effet automatique** d'une évaluation : ni sur la rémunération, ni sur le contrat, ni sur une
sortie, ni sur un objectif. Une évaluation n'est **jamais** proposée, rédigée, résumée ni notée par
l'IA (§ 8).

#### 2.7 Champs ajoutés à `hr_settings`

| Champ | Défaut | Note |
|---|---|---|
| `expenses.enabled` | `true` | notes de frais ouvertes dès la fusion |
| `expenses.approvalFlow` | `manager_then_finance` | ou `finance_only` (décision ouverte n° 3) |
| `expenses.receiptRequired` | `true` | une ligne sans justificatif exige un motif (§ 2.1) ; aucun seuil |
| `advances.enabled` | `{ expenses: true, salary: false }` | l'avance sur salaire est **éteinte** par défaut (décision ouverte n° 5) |
| `advances.maxAmount` | `{ CDF: null, USD: null }` | aucun plafond posé par Lalanda (J1) |
| `advances.allowDeclaredPayrollSettlement` | `false` | régularisation « sur la paie, hors Lalanda » ; éteinte tant que le juriste n'a pas répondu (J1, décision ouverte n° 5) |
| `attendance.enabled` | `false` | pointage éteint (décision ouverte n° 8) |
| `attendance.selfClock` | `true` (si activé) | sinon saisie par manager et RH seulement |
| `attendance.lateToleranceMinutes` | `null` | constat de retard éteint |
| `planning.enabled` | `false` | plannings éteints (décision ouverte n° 9) |
| `planning.indicativeMaxMinutesPerWeek` | `null` | seuil indicatif, jamais légal |
| `performance.enabled` | `false` | objectifs et évaluations éteints (décision ouverte n° 11) |
| `performance.managerChainDepth` | `1` | le manager direct seul voit l'évaluation ; `2` ouvre au N+2 (décision ouverte n° 12) |
| `retention.attendanceMonths` | `null` | **aucune purge** ; durée au juriste (J4) |
| `retention.reviewsYearsAfterExit` | `null` | **aucune purge** ; durée au juriste (J4) |
| `retention.expenseReceiptsYears` | `null` | **aucune purge** ; durée à l'expert-comptable et au juriste (C5, J4 ; docs/28 § 1.3 question 6) |

Changer `expenses.approvalFlow` exige `expenses.approve` ; changer un réglage `attendance.*`,
`planning.*`, `performance.*` exige `hr.manage` ; changer `advances.*` exige `hr.manage` **et**
`expenses.approve` (motif d'ADR-0045 § 3.3 : changer qui valide exige d'être soi-même validateur).

### 3. Parcours et séparation des tâches

Règle commune, motif d'ADR-0045 § 4.3 et d'ADR-0044 § 2.3 : **celui qui demande ne valide pas**, à
aucune étape ; **deux étapes, deux personnes** ; l'**exception de l'approbateur unique** (un seul
détenteur **effectif** de l'action, `countApprovers(org, action)`) s'applique seulement si le réglage
le permet, est **marquée** `soleApprover: true`, journalisée et dite à l'écran. Fonctions pures dans
`permissions.ts`, jugeant des personnes, jamais un rôle.

#### 3.1 Note de frais

```
brouillon ──soumettre──▶ soumise ──manager──▶ (finance) ──▶ approuvée ──rembourser──▶ remboursée
     │                       │                    │                │
     └── annuler             └── refuser ◀────────┘                └── (avance liée) soldée par l'avance
```

1. **Soumettre** (`expenses.claim`, bénéficiaire ou saisie pour autrui) : contrôle des lignes, numéro
   `NF…`, étapes figées par `expenseApprovalSteps(settings, employee)` : `manager_then_finance` ⇒
   `['manager', 'finance']` ; l'étape `manager` devient `finance` seule si le collaborateur n'a pas de
   manager, si le manager n'a pas de compte, ou si le manager est le bénéficiaire.
2. **Étape `manager`** : l'utilisateur relié au manager désigné (relation, sans action), ou un
   détenteur effectif d'`expenses.approve` en **suppléance** (`onBehalfOfManager: true`).
3. **Étape `finance`** : un détenteur effectif d'`expenses.approve`, **distinct** de celui qui a tenu
   l'étape manager (`409 APPROVER_ALREADY_APPROVED`).
4. **`expenseApprovalDecision`** : refuse le bénéficiaire (`409 SELF_APPROVAL_FORBIDDEN`) et **l'auteur
   d'une saisie pour autrui** (`409 CREATOR_APPROVAL_FORBIDDEN` — à la différence d'une absence, une
   note engage de l'argent : qui l'a saisie ne l'approuve pas) ; exception approbateur unique marquée.
   Un refus, à toute étape, clôt la note (commentaire obligatoire) ; le bénéficiaire peut la dupliquer
   en brouillon pour la corriger.
5. **Rembourser** (`payables.pay` + `treasury.read`) : `{ paidOn, accountId?, method: 'cash' |
   'mobile_money' | 'bank_transfer' | 'other', reference, expectedRevision }`. **`reimbursementDecision`** :
   le payeur n'est **pas le bénéficiaire** (`409 SELF_PAYMENT_FORBIDDEN`, sauf payeur unique marqué) et
   **pas l'approbateur de l'étape `finance`** quand un autre détenteur effectif de `payables.pay` existe
   (`409 APPROVER_CANNOT_PAY`, sinon marqué `soleApprover`) — motif de la paire `purchase.approve` +
   `payables.pay`. Le service RH appelle **dans sa transaction** la méthode nouvelle de la trésorerie
   `recordOwnedByExpenseReport` (§ 7.1) : une dépense par ligne. Les coordonnées de paiement du
   collaborateur restent dans `hr_employee_private` (`hr.sensitive.read`) ; le payeur ne les voit pas
   en clair (décision ouverte n° 7).
6. **Annuler un remboursement** (`payables.pay`, motif) : annule, dans la même transaction, les dépenses
   possédées ; la note revient à `approved`.

#### 3.2 Avance (versement)

1. **Demander** (`expenses.claim`) : `kind`, montant, motif ; refus si le type est éteint
   (`409 ADVANCE_KIND_DISABLED`) ou au-delà du plafond **saisi** par l'organisation.
2. **Valider** : `expenses` ⇒ mêmes étapes et même fonction qu'une note de frais ; `salary` ⇒ étape
   `finance` seule, par un détenteur effectif d'`expenses.approve` **et** de `hr.sensitive.read`
   (`403 ADVANCE_SALARY_NOT_YOUR_STEP` sinon) — l'avance sur salaire est une donnée sensible (§ 4).
3. **Verser** (`payables.pay`, mêmes règles que § 3.1 point 5) : crée un mouvement `treasury_movements`
   `other_out` **possédé par les RH** (`origin.kind = 'employee_advance'`), libellé **neutre**
   (« Avance au personnel AV2611-000012 », **sans le nom** pour une avance sur salaire), par la méthode
   nouvelle `recordOwnedByAdvance` (§ 7.1). Aucune dépense, aucun effet sur le réalisé.

#### 3.3 Avance (régularisation)

| Régularisation (`settlements[].kind`) | Qui | Effet trésorerie | Effet réalisé |
|---|---|---|---|
| `expense_report` — une note de frais **approuvée** liée (`advanceId`) | automatique à l'approbation finale de la note | les dépenses de la note sont créées **sans compte** (`accountId: null`, `origin.settledByAdvanceId`) : l'argent est déjà sorti au versement | la charge entre au réalisé par catégorie, à la date des lignes |
| `cash_return` — le collaborateur rend le reliquat | `payables.pay` (≠ bénéficiaire) | `other_in` possédé par les RH vers le compte choisi | aucun |
| `declared_payroll` — « régularisée sur la paie de {mois}, hors Lalanda » | `expenses.approve` + `hr.sensitive.read` (≠ bénéficiaire) ; seulement si `allowDeclaredPayrollSettlement` | aucun (la paie est hors Lalanda) | aucun ; constat `ADVANCE_SETTLED_ON_PAYROLL` (§ 7.2) |
| `top_up` — la note dépasse l'avance : le reliquat dû **au collaborateur** est remboursé comme une note (§ 3.1 point 5) pour la différence | `payables.pay` | dépenses avec compte pour la seule différence | la charge entière, une seule fois |
| `write_off` — abandon | `expenses.approve` (≠ bénéficiaire), motif | aucun | aucun ; question C3 |

Le moteur (`advanceOutstanding`, `advanceSettlementPlan`) rend le reste dû, refuse une régularisation
au-delà du reste (`409 ADVANCE_SETTLEMENT_EXCEEDS_OUTSTANDING`) et répartit une note entre l'avance et
le complément à rembourser, au centime, de façon déterministe. Aucune régularisation n'est **jamais
déclenchée par le temps** : une avance non régularisée à son échéance annoncée lève seulement un rappel.

#### 3.4 Présences

- **Pointer** (`attendance.clock`, pour soi, si `attendance.enabled` et `selfClock`) : `POST
  /hr/attendance/clock { kind }`, horodatage serveur.
- **Saisir pour autrui** : le manager (relation, son équipe) ou `hr.manage` ; `note` obligatoire.
- **Corriger** : le collaborateur **demande** ; le manager ou `hr.manage` **décide** ;
  `attendanceCorrectionDecision` refuse le bénéficiaire (`409 SELF_APPROVAL_FORBIDDEN`) et l'auteur
  d'une correction saisie pour autrui (`409 CREATOR_APPROVAL_FORBIDDEN`), avec l'exception de
  l'approbateur unique (un seul détenteur effectif de `hr.manage`, sans manager) marquée.

#### 3.5 Objectifs et évaluations

- **Objectif** : proposé par le collaborateur ou posé par le manager ; `agreed` par le manager ou
  `hr.manage`, **jamais par le collaborateur pour lui-même** ; statut final posé par le manager.
- **Évaluation** : le collaborateur remplit son auto-évaluation (si prévue) ; l'évaluateur rédige et
  note, puis **partage** ; le collaborateur **prend connaissance** et commente ; l'étape RH **clôt**.
  `reviewCloseDecision` : le cloteur détient `hr.manage` **et** `performance.read`, n'est **ni**
  l'évalué **ni** l'évaluateur (`409 REVIEW_CLOSE_FORBIDDEN`), sauf détenteur unique marqué. Un
  collaborateur qui ne signe pas la prise de connaissance dans le délai : rappel ; l'étape RH peut
  clore avec la mention « non signée » (jamais un consentement présumé).

#### 3.6 Plannings

Établir et publier : le manager (son équipe) ou `hr.manage`. Pas d'approbation : un planning est une
organisation du travail, pas une dépense. Le collaborateur ne publie pas son propre créneau ; il peut
**signaler une indisponibilité** (commentaire sur le créneau, notification au planificateur). Aucune
affectation automatique (O5).

### 4. Confidentialité

| Donnée | Qui la voit | Jamais |
|---|---|---|
| Note de frais (lignes, montants, justificatifs) | le bénéficiaire ; l'auteur d'une saisie ; le manager de l'étape ; détenteurs d'`expenses.approve` ; détenteurs de `payables.pay` (pour payer) ; `hr.read` (liste et totaux, sans justificatif) | dans un projet RUN autrement que par la dépense de remboursement (libellé « Frais NF… », sans nom si l'organisation le règle, décision ouverte n° 10) |
| Avance **de frais** | comme une note de frais | — |
| Avance **sur salaire** (montant, motif, reste dû) | le bénéficiaire ; détenteurs d'`expenses.approve` **et** `hr.sensitive.read` ; le payeur (`payables.pay`) voit **numéro, montant, date**, jamais le motif | le manager ; `hr.read` seul ; brief ; notification à un tiers ; libellé de trésorerie nominatif ; IA |
| Pointages, présences | le collaborateur ; son manager (équipe) ; `hr.read` | autres collègues ; projets ; IA nominative |
| Plannings publiés | le collaborateur ; son équipe et son service (selon `teamCalendarVisibility` d'ADR-0045) ; `hr.read` | — (un planning est fait pour être vu de l'équipe) |
| Objectifs individuels | le collaborateur ; sa chaîne de managers (profondeur `managerChainDepth`) ; `performance.read` | `hr.read` seul ; projets ; IA |
| Évaluations (contenu) | le collaborateur (dès `shared`) ; l'évaluateur ; la chaîne selon `managerChainDepth` ; `performance.read` ; `hrNote` : `performance.read` seul | `hr.read` seul ; `hr.sensitive.read` seul ; Administrateur ; plateforme (interdit absolu) ; export CSV ; IA ; brief ; notification (statut seulement) |

- **Lecture du contenu d'une évaluation** : `POST /hr/reviews/:id/reveal { sections[] }`, audit
  **strict** écrit avant la réponse (`hr.review.revealed`, sections sans valeur), **30 par heure**
  (`429 HR_REVEAL_RATE_LIMITED`), motif exact d'ADR-0045 § 2.4. L'évaluateur qui rédige et le
  collaborateur qui lit la sienne passent par la même route (traçabilité uniforme).
- **Avance sur salaire** : `reason` chiffré (section `advanceReason`, AAD = organisation + avance) ;
  lecture du motif journalisée strictement.
- **Hors portée** : **404**, jamais 403 (on ne confirme pas l'existence d'une évaluation ou d'une avance).
- **Rapports partagés** : agrégats par service, jamais une personne (motif d'`absenteeism`, ADR-0045
  § 7) ; aucune moyenne de notes par personne ; aucun classement.
- **Anonymisation** (ADR-0045 § 3.1) étendue : à l'anonymisation d'un collaborateur, ses évaluations
  chiffrées et ses motifs d'avance sont effacés, ses pointages agrégés en journées sans horaires ; ses
  notes de frais et avances **restent** (pièces de trésorerie), nom remplacé.

### 5. Permissions (amende ADR-0012, docs/12 ; étend ADR-0041)

#### 5.1 Quatre actions nouvelles (en fin d'`ACTIONS`)

Numérotées **cinquante-deuxième à cinquante-cinquième** si cet ADR fusionne avant ADR-0050 ; recalées
à la suite de celles d'ADR-0050 sinon (lot H8, § Zones de conflit).

| Action | Libellé (ADR-0041 § 5) | Couvre |
|---|---|---|
| `expenses.claim` | Déclarer ses frais et demander une avance | ses notes de frais et avances : brouillon, justificatifs, soumission, suivi ; avec `hr.manage`, saisie pour un collaborateur sans compte |
| `expenses.approve` | Valider les notes de frais et les avances | étape `finance`, suppléance du manager, toute note ou avance de frais ; avances sur salaire avec `hr.sensitive.read` ; régularisations déclarées, abandons ; case ⓢ |
| `attendance.clock` | Pointer sa présence | ses pointages, ses demandes de correction, sa présence et son planning |
| `performance.read` | Consulter les objectifs et les évaluations du personnel | objectifs et évaluations de tous ; avec `hr.manage`, campagnes, changement d'évaluateur, clôture |

| Action | PRO | ADM | DIR | CPT | ANA | CDP | CON | LEC | COM | RH | MAG | EXP |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| `expenses.claim` | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ |
| `expenses.approve` | ✓ⓢ | ✗ | ✓ⓢ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `attendance.clock` | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ |
| `performance.read` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ |

Justifications :

- **`expenses.claim`, `attendance.clock`** suivent `leave.request` : tout rôle **interne** qui travaille,
  Lecteur, Commercial et Magasinier compris ; déclarer ses frais ou pointer ne lit aucune donnée de
  l'organisation. Sans fiche reliée : `409 EMPLOYEE_NOT_LINKED`. Le **Conseiller** et l'**Expert-comptable
  externe** (externes) non ; le **Chef de projet** n'a rien (non attribuable).
- **`expenses.approve`** suit `purchase.approve` : **autorité de dépense**. Propriétaire et Directeur
  financier, en case ⓢ. Le **Comptable** constate et paie, il n'autorise pas (motif d'ADR-0044 § 4.1) ;
  le **Responsable RH** non plus : il ne voit ni la trésorerie ni les achats (ADR-0045 § 4.2) — il voit
  les notes **en liste** par `hr.read` (décision ouverte n° 2).
- **Payer** : `payables.pay` **réutilisée** (Propriétaire, Directeur financier, Comptable) ; son libellé
  devient « Payer les fournisseurs et rembourser le personnel » (docs/12, ADR-0041 § 5) ; sa dépendance
  vers `purchase.read` est **inchangée** (décision ouverte n° 2 : une action `expenses.pay` séparée si la
  dirigeante veut un payeur sans accès aux achats).
- **`performance.read`** : le moins de personnes possible. Propriétaire et Responsable RH. **Ni le
  Directeur financier** (il lit les salaires, pas les entretiens), **ni l'Administrateur** (décision
  ouverte n° 12). Le **manager** n'a besoin d'aucune action : la relation suffit pour son équipe.
- **Plateforme** : `expenses.claim`, `expenses.approve`, `attendance.clock` refusées à tous les rôles
  plateforme par la matrice ; **`performance.read` rejoint `PLATFORM_FORBIDDEN_ACTIONS`** (interdit
  absolu, motif de `hr.sensitive.read`).

#### 5.2 Compatibilité avec ADR-0041

- **Dépendances** : `expenses.claim` → socle ; `attendance.clock` → socle ; `expenses.approve` →
  `hr.read` **et** `treasury.read` (l'approbateur relit la trésorerie qu'il engage et le dossier du
  bénéficiaire) ; `performance.read` → `hr.read`. Chaque ligne de la matrice du § 5.1 les satisfait
  (test).
- **Domaine** : les quatre actions rejoignent le neuvième domaine **« Ressources humaines »** (aucun
  domaine nouveau).
- **`APPROVAL_ACTIONS`** : `expenses.approve` rejoint la liste (cases ⓢ).
- **`SOD_PAIRS`** : **`expenses.approve` + `payables.pay`** (par ajout : un Comptable ne reçoit pas
  `expenses.approve`) ; Propriétaire et Directeur financier les cumulent nativement, la séparation
  dynamique du § 3.1 s'y applique.
- **Approbateur unique** compté sur les détenteurs **effectifs** (`countApprovers`) ; destinataires par
  `holdersOf`, jamais par `role: { $in: … }`.
- **R7** inchangée ; **aucun rôle nouveau** ; matrice **12 × 55 + 6 × 55 = 990** cases (si seul).

### 6. Contrat HTTP

Tous les contrôleurs : `@UseGuards(AuthGuard, PermissionsGuard)`, `@RequirePermission(…)` par route,
corps `.strict()`, listes par curseur. Routes **relationnelles** (manager, soi) : `analytics.read` au
guard, portée décidée dans le service par `hrViewerScope` (ADR-0045 § 4.4). Une fonction éteinte par
réglage rend `409 HR_FEATURE_DISABLED`.

#### 6.1 Notes de frais et avances

| Méthode et chemin | Permission | Effet |
|---|---|---|
| `GET /hr/expense-reports?employeeId=&status=&from=&to=&cursor=` | `expenses.claim` (siennes) ; manager (équipe, à valider) ; `expenses.approve`, `payables.pay`, `hr.read` (toutes, `hr.read` sans justificatif) | liste |
| `POST /hr/expense-reports` · `PUT …/:id` · `DELETE …/:id` (brouillon) | `expenses.claim` | brouillon |
| `POST …/:id/lines/:lineId/receipt` · `GET …/receipt` | `expenses.claim` (le sien, brouillon) · lecteurs de la note sauf `hr.read` seul | justificatif ; téléchargement inerte |
| `POST …/:id/submit` · `…/cancel` · `…/duplicate` | `expenses.claim` (bénéficiaire ou auteur) ; `cancel` aussi `expenses.approve` | § 3.1 |
| `POST …/:id/approve` · `…/reject` | manager de l'étape, ou `expenses.approve` | `expenseApprovalDecision` |
| `POST …/:id/reimburse` · `…/reimbursement/cancel` | `payables.pay` + `treasury.read` | `reimbursementDecision` ; dépenses possédées |
| `GET /hr/advances?…` · `POST` · `PUT …/:id` · `…/submit` · `…/cancel` | comme les notes ; avances sur salaire : § 4 | § 3.2 |
| `POST /hr/advances/:id/approve` · `…/reject` | § 3.2 point 2 | — |
| `POST …/:id/disburse` · `…/disbursement/cancel` | `payables.pay` + `treasury.read` | mouvement `other_out` possédé |
| `POST …/:id/settlements` `{ kind, amount, on, accountId?, reference, note }` | § 3.3 | ajout seul |
| `POST …/:id/reveal-reason` | `expenses.approve` + `hr.sensitive.read`, ou le bénéficiaire | audit strict |
| `GET /hr/expenses/summary?from=&to=&groupBy=category\|department\|project` | `expenses.approve` ou `hr.read` | totaux **approuvés et remboursés**, par devise ; aucun nom en `groupBy=department` |
| `GET /hr/expenses/to-pay` | `payables.pay` | notes approuvées non remboursées, avances approuvées non versées (prévision, § 7.2) |

#### 6.2 Présences et plannings

| Méthode et chemin | Permission | Effet |
|---|---|---|
| `POST /hr/attendance/clock` `{ kind }` | `attendance.clock` | horodatage serveur |
| `POST /hr/attendance/events` `{ employeeId, kind, at, note }` | manager (équipe) ou `hr.manage` | saisie pour autrui |
| `GET /hr/attendance/days?employeeId=&from=&to=` | soi ; manager ; `hr.read` | journées (moteur), constats |
| `POST /hr/attendance/corrections` · `…/:id/approve` · `…/reject` | `attendance.clock` (pour soi) ou manager / `hr.manage` · décideur § 3.4 | — |
| `GET /hr/shifts?from=&to=&scope=me\|team\|department\|organization` | `attendance.clock` ou `leave.request` (soi) ; portée § 4 | créneaux publiés (brouillons : planificateurs) |
| `POST /hr/shifts` · `PUT …/:id` · `…/cancel` · `POST /hr/shifts/publish` `{ ids[] }` · `POST /hr/shifts/copy-week` | manager (équipe) ou `hr.manage` | § 2.4 |
| `GET /hr/staffing-needs` · `POST` · `PUT` · `DELETE` | `hr.read` · `hr.manage` | besoins minimaux |
| `GET /hr/planning/gaps?from=&to=` | manager (équipe) ou `hr.read` | `staffingGaps`, constats |

#### 6.3 Objectifs et évaluations

| Méthode et chemin | Permission | Effet |
|---|---|---|
| `GET /hr/goals?employeeId=&period=` · `POST` · `PUT …/:id` · `…/agree` · `…/close` · `…/progress` | soi (proposer, progresser) ; manager de la chaîne ; `performance.read` (+ `hr.manage` pour écrire) | § 3.5 |
| `GET /hr/review-cycles` · `POST` · `PUT …/:id` · `…/open` · `…/close` | `performance.read` + `hr.manage` | campagnes |
| `GET /hr/reviews?cycleId=&mine=&toWrite=` | soi ; évaluateur ; chaîne ; `performance.read` | **statuts seulement**, jamais de contenu |
| `PUT /hr/reviews/:id/sections/:section` | soi (`selfAssessment`, `employeeComment`) ; évaluateur (`managerAssessment`) ; `performance.read` (`hrNote`) | chiffré ; audit `hr.review.changed` (section, sans valeur) |
| `POST /hr/reviews/:id/reveal` | lecteurs du § 4 | audit strict, 30 par heure |
| `POST …/:id/submit-self` · `…/submit-manager` · `…/share` · `…/acknowledge` · `…/close` · `…/reassign` | § 3.5 | `reviewCloseDecision` |

Contrôleurs nouveaux à inscrire dans `routes-coverage.test.ts` : `HrExpenseReportsController`,
`HrAdvancesController`, `HrAttendanceController`, `HrShiftsController`, `HrGoalsController`,
`HrReviewsController`.

### 7. Raccords avec les modules existants

#### 7.1 Trésorerie (ADR-0034) et dépenses : suivre l'existant

| Collection | Champ ajouté | Règle |
|---|---|---|
| `treasury_expenses` | `origin.kind = 'expense_report'` | `{ kind, reportId, reportNumber, lineIndex, settledByAdvanceId: string \| null }` ; non nulle ⇒ dépense **possédée par les RH** : `PUT`, `cancel` et pièce jointe par `/treasury/expenses/**` → **`409 EXPENSE_OWNED_BY_HR`** |
| `treasury_movements` | `origin` (nouveau, `null` par défaut) | `null` \| `{ kind: 'employee_advance', advanceId, advanceNumber, settlementId? }` ; non nul ⇒ mouvement possédé par les RH (`409 MOVEMENT_OWNED_BY_HR`) |

- **Deux méthodes nouvelles**, seuls écrivains de ces pièces, appelées **dans la transaction** du service
  RH : `TreasuryExpensesService.recordOwnedByExpenseReport(session, input)` (une dépense par ligne :
  `spentOn` = date de la ligne, **montant de la ligne**, catégorie, `workProjectId`, `deductibleVat`
  déclarée, `supplierName` = marchand en texte, `label` = « Frais NF… — {libellé de la ligne} »,
  `reference`, `accountId` du remboursement **ou `null` si soldée par une avance**) et
  `TreasuryMovementsService.recordOwnedByAdvance(session, input)` (`other_out` au versement, `other_in`
  au remboursement en espèces). La trésorerie garde ses règles (compte actif, même devise, postérieure à
  l'ouverture) ; une ligne datée **avant** l'ouverture du compte payeur reste permise, la dépense étant
  datée de la ligne — c'est la date de la charge ; le décaissement, lui, est daté du remboursement
  (décision ouverte n° 13, question C1).
- **Pièce jointe** : la dépense ne copie pas le justificatif ; l'écran de la dépense affiche « Ouvrir la
  note de frais NF… », servie par `/hr` avec ses propres droits (ADR-0046 O5 : les pièces RH ne sortent
  pas de `/rh`).
- **Pont vers le réalisé** (ADR-0034 § 5) : inchangé ; les dépenses de remboursement y vont par leur
  catégorie, au montant payé. Une note **approuvée non remboursée** n'entre pas au réalisé (réalisé de
  trésorerie, docs/08) ; une avance (mouvement) n'y entre jamais.
- **Résumé des dépenses** et page « Dépenses » : les dépenses possédées apparaissent avec la marque
  « Note de frais ».

#### 7.2 Prévision de trésorerie et constats

- Nouvelle composante **« Remboursements au personnel »** (estimation) : notes `approved` non
  remboursées et avances `approved` non versées, **à J+1** (motif des récurrences en retard), dans leur
  devise ; port `TREASURY_HR_PAYABLES_SOURCE` (`treasury-sources.ts`), fournisseur nul par défaut
  (constat `HR_PAYABLES_NOT_INTEGRATED`). `TREASURY_VERSION` **1.2.0**, sorties inchangées si vide.
- Les dépenses **soldées par une avance** (`accountId: null`, `settledByAdvanceId`) sont **exclues** du
  constat existant `EXPENSES_WITHOUT_ACCOUNT` : l'argent est déjà sorti (au versement).
- Constat **`ADVANCE_SETTLED_ON_PAYROLL`** (moteur RH, écran de l'avance et fiche trésorerie) : « Cette
  avance a été régularisée sur la paie de {mois}. Saisissez la dépense de salaire pour le **montant
  net effectivement payé** ; l'avance, déjà sortie de la caisse, ne doit pas être saisie une seconde
  fois. » Rien n'est retranché seul ; le traitement en charge du montant de l'avance est la question C3.
- Constat **`ADVANCE_OVERDUE`** (rappel) : avance versée non soldée après la date annoncée.

#### 7.3 Projets (ADR-0039) : frais refacturables

- Une ligne imputée à un projet (`workProjectId`) entre dans la **marge** par sa dépense de remboursement,
  **sans code nouveau** dans `computeProjectMargin`.
- **Informatif** : par devise, `pendingExpenseClaims` = lignes approuvées **non remboursées** imputées au
  projet (« Frais approuvés non remboursés — informatif »), **jamais soustraites** ; port en lecture
  `WORK_HR_EXPENSES_SOURCE`, fournisseur nul par défaut ; `WORK_MARGIN_VERSION` **1.4.0**, sorties
  existantes inchangées.
- **Refacturables** : la fiche projet liste les lignes `rebillable` remboursées et non encore marquées
  « refacturées » (`GET /work/projects/:id/rebillable-expenses`, `work.read` + `sales.read` +
  `treasury.read`). « Préparer une facture » réutilise le brouillon existant d'ADR-0039 L4a avec ces
  lignes en texte (libellé, montant) ; **l'émission reste un geste de `sales.invoice`** ; la ligne est
  marquée `rebilledInvoiceId` quand la facture est **émise**. Le traitement fiscal d'une refacturation
  (débours ou prestation, groupe de taxation DGI) n'est **pas** tranché : l'utilisateur choisit le groupe
  comme pour toute ligne de facture ; question C4.

#### 7.4 Comptabilité (ADR-0049) : ce qui est prévu, ce qui ne l'est pas

- **Prévu sans amendement** : un `other_out` ou `other_in` va au **compte d'attente** (ADR-0049 § 6.6) ;
  une avance versée et son remboursement en espèces y vont donc par défaut, **à reclasser** par
  l'expert. Les clés d'opération proposées (`hr.advance.disbursed`, `hr.advance.returned`) restent
  **sans règle** tant que l'expert n'a pas répondu (C2) ; aucun compte n'est écrit ici.
- **Non prévu, amendement nécessaire** : ADR-0049 § 6.3 et `engine/src/accounting/entries/purchases.ts`
  ignorent **toute** dépense dont `origin` n'est pas nulle. Le lot **H13** restreint ce filtre à
  `origin.kind = 'supplier_payment'` et traite `expense_report` comme une dépense : débit
  `expense.<catégorie>`, crédit `{treasuryAccount}` ; **sans compte** (soldée par une avance) : crédit au
  **compte d'attente** avec le motif `SETTLED_BY_EMPLOYEE_ADVANCE`, que l'expert reclasse (C2). Clé de
  source : `treasury_expense:<id>:r<revision>` (inchangée).
- **Non prévu, question ouverte** : constater la dette envers le salarié **à l'approbation** (compte de
  tiers) plutôt qu'au remboursement (C1). Défaut : **au remboursement**, comme une dépense directe
  (décision ouverte n° 13).

#### 7.5 « Mes tâches », cloche, calendrier (ADR-0039, ADR-0045 § 6.1)

- **Aucun port nouveau** : `HR_AGENDA_SOURCE` gagne cinq natures d'éléments `source: 'hr'` :
  `expense_approval` (note ou avance à valider, **jamais** « avance sur salaire » dans le libellé pour
  un tiers : « Avance AV… à valider »), `expense_to_pay` (pour `payables.pay`), `attendance_correction`
  (à décider), `review_to_write` (évaluateur, collaborateur pour son auto-évaluation, prise de
  connaissance), `goal_to_agree`. Non cochables : valider est une décision.
- **Calendrier** : mes créneaux publiés en bandeaux horaires, distincts des tâches et des absences.
- **Notifications** (module `hr`, entités nouvelles `expense_report`, `advance`, `shift`, `review`,
  `goal`, `attendance_correction`) ; **aucune ne porte un montant d'avance sur salaire, un motif, une
  note ni un extrait d'évaluation** :

| Type | Déclencheur | Destinataires |
|---|---|---|
| `hr.expense_submitted` | soumission, passage d'étape | validateurs de l'étape (sauf le bénéficiaire) |
| `hr.expense_approved` · `hr.expense_rejected` · `hr.expense_reimbursed` | décision, remboursement | le bénéficiaire (et l'auteur) ; `hr.expense_approved` aussi aux détenteurs de `payables.pay` |
| `hr.advance_submitted` · `hr.advance_decided` · `hr.advance_disbursed` · `hr.advance_overdue` | § 3.2, § 7.2 | validateurs ; bénéficiaire ; payeurs (« Avance AV… à verser », sans nature ni nom pour `salary`) |
| `hr.attendance_correction_requested` · `…_decided` | § 3.4 | manager ou `hr.manage` ; le demandeur |
| `hr.shifts_published` · `hr.shift_changed` | publication, modification d'un créneau publié | le collaborateur relié |
| `hr.review_step` | ouverture, partage, rappel de prise de connaissance | la personne attendue |
| `hr.goal_proposed` · `hr.goal_agreed` | § 3.5 | manager ; collaborateur |

#### 7.6 Brief du matin (ADR-0033)

`HR_SOURCE` gagne deux faits, **des nombres seulement** : `mes_validations_frais.en_attente` (notes et
avances que l'appelant peut traiter) et `rh.remboursements_a_payer` (`payables.pay`, sinon `hidden`).
**R19 `validations_frais_en_attente`** (rang 19, `attention`) → `/rh/frais?vue=a-valider` ; **R20
`remboursements_personnel_a_payer`** (rang 20, `attention`) → `/rh/frais?vue=a-payer`.
`MORNING_BRIEF_VERSION` **1.6.0**. Aucun fait sur les évaluations, les objectifs ni les avances sur
salaire.

#### 7.7 Documents (ADR-0046) et documents RH (ADR-0045)

- Justificatifs : objets `hr-expense-receipts/`, **non** chiffrés côté application par défaut (un ticket
  de taxi n'est pas une pièce d'identité), chiffrement du stockage objet ; servis inertes, journalisés
  (`hr.expense_receipt.downloaded`, audit simple) ; **jamais** dans la bibliothèque ni dans
  `entity-pieces` (décision ouverte n° 14).
- Une **reconnaissance d'avance** signée, si l'organisation en tient une, se dépose dans `hr_documents`
  sous une catégorie nouvelle `advance_acknowledgement` (**sensible imposé**) ; son contenu et sa forme
  sont une question au juriste (J2) ; Lalanda n'en génère aucun modèle.
- Évaluations : **pas de PDF généré** en H15 ; une évaluation signée sur papier se dépose dans
  `hr_documents` catégorie nouvelle `review` (sensible imposé, visible du collaborateur).

#### 7.8 Feuille de temps et marge

La présence ne crée **aucune** saisie de temps. `weeklyTimesheet` (ADR-0045 § 6.3) gagne une colonne
« présence » (minutes pointées) et le constat `PROJECT_TIME_ABOVE_ATTENDANCE` (temps projet > présence
du jour), **information seulement**. La marge n'est pas modifiée.

### 8. IA : explique, ne décide jamais

- **Planification des ressources** : l'IA du brief et de l'écran Planning peut **expliquer** les
  constats calculés par le moteur (`UNDERSTAFFED_SLOT`, `SHIFT_DURING_LEAVE`) ; elle ne crée, ne
  déplace, ne publie aucun créneau. Elle reçoit des **nombres par service et par créneau**, jamais de
  nom.
- **Évolution des coûts** : agrégats calculés par le moteur (frais remboursés par catégorie, service,
  mois ; `personnel` reste lu de la trésorerie) ; l'IA les commente, sans les produire.
- **Alertes de capacité** : `staffingGaps` et `availabilityOf` (moteur) ; l'IA explique.
- **Interdits** : l'IA ne rédige, ne résume, ne note ni ne compare **aucune** évaluation ; ne propose
  aucun objectif nominatif ; ne valide ni ne refuse aucune note, avance, correction ; ne reçoit **aucun**
  justificatif, motif, montant d'avance, pointage nominatif ni contenu d'évaluation.
  `ai-contexts.audit.test.ts` étendu : aucun champ `hr_expense_reports`, `hr_advances`,
  `hr_attendance_*`, `hr_goals`, `hr_review*` dans un contexte IA.

### 9. Moteur (`packages/engine/src/hr/`, `HR_VERSION` 1.1.0)

| Fonction | Rôle |
|---|---|
| `expenseReportTotals(lines)` | total par note, par catégorie, par projet ; centimes exacts |
| `expenseApprovalSteps(settings, employee, beneficiaryUserId)` | § 3.1 |
| `advanceOutstanding(advance)` · `advanceSettlementPlan(advance, report)` | § 3.3 ; plus fort reste, déterministe |
| `attendanceDay(events, shifts, absences, holidays, date, tolerance)` | § 2.3, minutes, constats |
| `staffingGaps(shifts, needs, absences, from, to)` | § 2.4 |
| `shiftConflicts(shifts, absences)` | chevauchements, créneaux pendant une absence, seuil indicatif |
| `expenseSummary(reports, from, to, groupBy)` | § 6.1 |
| `reviewProgress(reviews)` | décompte des statuts d'une campagne (jamais de note agrégée) |

Fonctions pures de `permissions.ts` (lot H8) : `expenseApprovalDecision`, `reimbursementDecision`,
`attendanceCorrectionDecision`, `reviewCloseDecision`. Modifiés ailleurs : `engine/src/treasury/**`
(composante, constat ; 1.2.0), `engine/src/work/margin.ts` (informatif ; 1.4.0),
`engine/src/morning-brief/**` (1.6.0), `engine/src/accounting/entries/purchases.ts` (filtre, H13).

### 10. Interface (web)

Sous-options ajoutées à l'application **Ressources humaines** (`/rh`), créées dans `rh/layout.tsx` :

| Sous-option | Route | Condition |
|---|---|---|
| Mes frais | `/rh/moi/frais` : mes notes, mes avances, nouvelle note (photo du ticket depuis le téléphone) | `expenses.claim` |
| Frais et avances | `/rh/frais?vue=a-valider\|a-payer\|toutes` | manager, `expenses.approve`, `payables.pay`, `hr.read` |
| Présences | `/rh/presences` (moi : bouton « J'arrive / Je pars » ; équipe ; corrections) | `attendance.enabled` ; `attendance.clock` ou manager ou `hr.read` |
| Planning | `/rh/planning` (semaine, par personne ou par lieu ; brouillon, publier, copier) | `planning.enabled` |
| Objectifs | `/rh/objectifs` | `performance.enabled` ; soi, manager, `performance.read` |
| Évaluations | `/rh/evaluations` (campagnes ; mes évaluations ; à rédiger) | `performance.enabled` ; idem |

- Montants rendus par l'API, jamais additionnés à l'écran ; « Avance sur salaire » jamais visible hors
  ayants droit (une liste partagée dit « Avance »).
- Évaluation : le contenu s'affiche après « Afficher » (journalisé), disparaît au changement d'onglet ;
  l'écran rappelle « Aucune note n'est calculée ; l'évaluation n'a aucun effet automatique ».
- Pointage : le bouton dit ce qui est enregistré (« l'heure du serveur, rien d'autre »).
- Trésorerie : marque « Note de frais » ou « Avance au personnel » sur les pièces possédées, lien vers
  `/rh` (ouvert selon les droits).

### 11. Ce que cet ADR n'invente pas

| Sujet | Ce que fait Lalanda |
|---|---|
| Plafond d'une avance, quotité saisissable ou cessible du salaire, nombre d'avances | **aucun** ; plafond **saisi** par l'organisation, vide par défaut (J1) |
| Retenue sur salaire pour régulariser une avance | **non calculée** ; déclaration éteinte par défaut (J1) |
| Abandon de créance sur avance : avantage en nature, impôt, cotisations | non traité (J2, C3) |
| Barèmes (kilométrique, repas, per diem, grands déplacements), exonération des frais professionnels | **aucun** ; frais réels déclarés (J5, C4) |
| Pièces exigées pour un remboursement, conditions de déductibilité, TVA récupérable | TVA déclarée conservée, jamais calculée ; aucune condition posée (C5 ; ADR-0049 E2) |
| Durée légale du travail, repos, travail de nuit, heures supplémentaires, majorations | **aucun calcul** ; seuil indicatif saisi, vide par défaut (J3) |
| Licéité et conditions du pointage, information des salariés, base légale | pointage éteint par défaut ; aucune donnée de localisation ou biométrique (J4) |
| Durée de conservation des pointages, évaluations, justificatifs | **non fixée** ; réglages `null`, aucune purge (J4, C5) |
| Entretien obligatoire, périodicité, droit de réponse, usage disciplinaire d'une évaluation | non posés ; prise de connaissance **n'est pas** un accord (J6) |
| Écritures comptables des frais et avances | compte d'attente ou règle validée par l'expert (C1, C2) |

## Hors périmètre, dit explicitement

- **Paie** : bulletins, brut et net, retenues calculées (y compris d'avance), cotisations (**CNSS**,
  **INPP**, **ONEM**), impôt (**IPR**), déclarations, virements de salaire. Inchangé depuis ADR-0045.
- **Prêts au personnel** (échéancier, intérêts) : seule l'avance, sans échéancier ni intérêt.
- Cartes de paiement d'entreprise, import de relevés, lecture automatique (OCR) des tickets, conversion
  de devises sur une note, notes multi-devises.
- Badgeuse, géolocalisation, photo, biométrie, pointage hors ligne, kiosque partagé.
- Optimisation ou affectation automatique des plannings ; échanges de créneaux entre collègues.
- Calcul d'heures supplémentaires, compteurs de récupération, annualisation.
- Évaluation à 360°, évaluation par les pairs, calibrage, grilles de compétences, plans de formation,
  lien évaluation → rémunération ou promotion.
- **IA qui agit** (§ 8).

## Conséquences

- Collections nouvelles : `hr_expense_reports`, `hr_advances`, `hr_attendance_events`,
  `hr_attendance_corrections`, `hr_shifts`, `hr_staffing_needs`, `hr_goals`, `hr_review_cycles`,
  `hr_reviews` ; champs ajoutés à `hr_settings`, `treasury_expenses.origin` (valeur nouvelle),
  `treasury_movements.origin` (champ nouveau, `null` pour l'existant, **aucune migration**) ; deux
  catégories `hr_documents` (`advance_acknowledgement`, `review`).
- RBAC : **cinquante-cinq actions** (si seul), douze rôles, matrice **990** cases ; une paire
  `SOD_PAIRS` ; `expenses.approve` dans `APPROVAL_ACTIONS` ; `performance.read` dans
  `PLATFORM_FORBIDDEN_ACTIONS` ; libellé de `payables.pay` élargi.
- Nouveaux actifs sensibles : évaluations (chiffrées, `reveal` journalisé), motifs d'avance sur salaire ;
  docs/17 et docs/28 complétés (finalités « frais professionnels », « présences », « évaluation »).
- Moteur : `HR_VERSION` 1.1.0, `TREASURY_VERSION` 1.2.0, `WORK_MARGIN_VERSION` 1.4.0,
  `MORNING_BRIEF_VERSION` 1.6.0 ; comptabilité : filtre des dépenses possédées corrigé.
- Une tâche d'ordonnanceur étendue : `hr.reminders` (avances en retard, prises de connaissance, campagne
  à échéance) ; `hr.retention` étendue (éteinte).

## Critères d'acceptation (testables)

1. **Permissions** : un `accountant` crée sa note (`200`), reçoit `403` sur `approve` à l'étape finance
   et `200` sur `reimburse` ; un `hr_manager` lit la liste des notes sans justificatif, reçoit `403` sur
   `approve` et `reimburse` ; un `advisor` et un `external_accountant` : `403` sur `POST
   /hr/expense-reports` ; un `finance_director` : `404` sur le contenu d'une évaluation ; matrice 990
   cases et sonde e2e vertes.
2. **Plateforme** : le super-administrateur sous accès délégué reçoit `403` sur `POST
   /hr/reviews/:id/reveal` (interdit absolu).
3. **Séparation (note)** : B (bénéficiaire) ne valide pas sa note (`409 SELF_APPROVAL_FORBIDDEN`) ; RH
   saisit une note pour le chauffeur D, puis ne la valide pas (`409 CREATOR_APPROVAL_FORBIDDEN`) ; A
   (manager) valide l'étape manager puis reçoit `409 APPROVER_ALREADY_APPROVED` à l'étape finance ; la
   Directrice financière valide ; elle ne rembourse pas si un Comptable existe (`409
   APPROVER_CANNOT_PAY`) ; le Comptable rembourse.
4. **Approbateur unique** : organisation où la Propriétaire est seule détentrice d'`expenses.approve` et
   de `payables.pay`, sans manager : elle valide et rembourse sa propre note ; décisions marquées
   `soleApprover: true`, audit présent, écran le dit.
5. **Trésorerie** : rembourser une note de deux lignes (`transport` 15,00 USD projet P ; `charges_diverses`
   7,50 USD) crée deux `treasury_expenses` possédées (`origin.kind = 'expense_report'`), solde du compte
   −22,50 ; `PUT /treasury/expenses/:id` sur l'une : `409 EXPENSE_OWNED_BY_HR` ; annuler le remboursement
   annule les deux et rend la note `approved`.
6. **Marge** : la ligne de 15,00 USD entre dans la marge de P après remboursement ; avant remboursement,
   elle apparaît dans `pendingExpenseClaims`, **montant de la marge inchangé**.
7. **Avance de frais** : versement de 100,00 USD → un `other_out` possédé, solde −100, **aucune** dépense,
   réalisé inchangé ; note liée de 80,00 USD approuvée → dépenses de 80,00 **sans compte**, solde
   inchangé, réalisé +80 par catégorie, reste dû 20,00 ; retour en espèces de 20,00 → `other_in`,
   avance `settled` ; une note de 130,00 liée à une avance de 100,00 → 100,00 sans compte + 30,00
   remboursés avec compte (`top_up`), charge totale 130,00 une seule fois.
8. **Avance sur salaire** : éteinte par défaut (`409 ADVANCE_KIND_DISABLED`) ; activée, le manager
   n'en voit rien (`404`), ni notification ni élément « Mes tâches » ; le libellé du mouvement ne porte
   pas le nom ; `declared_payroll` refusé tant que le réglage est éteint ; activé, il pose le constat
   `ADVANCE_SETTLED_ON_PAYROLL` sans aucun mouvement.
9. **Aucun plafond inventé** : sans `maxAmount`, une avance de tout montant est acceptée ; avec 200,00
   USD saisi, 250,00 est refusé (`422 ADVANCE_ABOVE_ORGANIZATION_LIMIT`).
10. **Comptabilité** (après H13, mode simulation) : une dépense de remboursement produit une écriture
    `expense.<catégorie>` ; une dépense soldée par avance crédite le compte d'attente (motif
    `SETTLED_BY_EMPLOYEE_ADVANCE`) ; une dépense de paiement fournisseur reste ignorée (pas de double
    comptage) ; un versement d'avance va en attente.
11. **Présences** : éteint par défaut (`409 HR_FEATURE_DISABLED`) ; activé, « J'arrive » 08:02 et « Je
    pars » 17:10 → 548 minutes ; un deuxième `in` sans `out` lève `ATTENDANCE_UNPAIRED` ; la correction
    demandée par B est refusée à B (`409 SELF_APPROVAL_FORBIDDEN`), acceptée par A ; l'événement corrigé
    reste, marqué `voidedBy` ; aucun champ IP, position ou appareil dans le document.
12. **Plannings** : deux créneaux qui se chevauchent : `409 SHIFT_OVERLAP` ; un créneau pendant un congé
    approuvé : accepté avec `SHIFT_DURING_LEAVE` ; besoin minimal 2 personnes, 1 planifiée → `UNDERSTAFFED_SLOT` ;
    aucun refus pour une durée hebdomadaire sans seuil saisi.
13. **Objectifs** : B propose, B ne peut pas `agree` (`409 SELF_APPROVAL_FORBIDDEN`), A le peut ; un
    collègue C hors chaîne : `404`.
14. **Évaluations** : contenu absent du document Mongo en clair, des listes, `audit_events`,
    notifications, brief et contextes IA (test anti-fuite) ; `reveal` écrit l'audit **avant** de répondre
    (audit en échec ⇒ `503`) ; 31e `reveal` de l'heure : `429` ; A (évaluateur) ne clôt pas (`409
    REVIEW_CLOSE_FORBIDDEN`), la RH le peut ; la prise de connaissance de B ne change aucun autre champ ;
    aucune note `overall` n'apparaît si A ne l'a pas choisie.
15. **Mes tâches, brief, cloche** : une note soumise crée un élément `expense_approval` chez A et R19 ;
    une note approuvée crée `expense_to_pay` et R20 chez le Comptable ; aucun libellé ne contient « sur
    salaire », un motif ni un montant d'avance sur salaire.
16. **Isolation** : toute route nouvelle rend `404` pour une ressource d'une autre organisation, y compris
    par `employeeId`, `advanceId`, `reportId`, `workProjectId`, `cycleId`, `accountId` forgés.
17. **Aucune règle légale** : à l'activation, aucun plafond, aucun barème, aucun seuil horaire, aucune
    durée de conservation n'est appliqué ; avance sur salaire, pointage, plannings, évaluations éteints.
18. **IA** : `ai-contexts.audit.test.ts` prouve qu'aucun champ des neuf collections nouvelles n'entre
    dans un contexte IA ; l'explication d'`UNDERSTAFFED_SLOT` ne reçoit que des nombres.

## Plan de validation

- **Moteur (vitest)** : `expenseReportTotals`, `advanceOutstanding`, `advanceSettlementPlan` (propriétés :
  somme exacte, jamais négatif), `attendanceDay` (minuit, paires, corrections), `staffingGaps`,
  `shiftConflicts`, `expenseApprovalSteps`, `reviewProgress` ; trésorerie 1.2.0 (sorties identiques si
  vide) ; marge 1.4.0 ; brief 1.6.0 (rangs uniques) ; filtre comptable (H13).
- **Authz (vitest)** : matrice 990 ; dépendances ; tables de vérité de `expenseApprovalDecision`,
  `reimbursementDecision`, `attendanceCorrectionDecision`, `reviewCloseDecision` ; paire `SOD_PAIRS` ;
  `performance.read` interdit plateforme.
- **API e2e** : `hr-expenses.e2e`, `hr-advances.e2e`, `hr-attendance.e2e`, `hr-shifts.e2e`,
  `hr-performance.e2e` (anti-fuite), `treasury-hr-owned.e2e`, `accounting-sync-hr.e2e`, `my-tasks.e2e` et
  `morning-brief.e2e` étendus, `rbac-matrix.e2e`, `ai-contexts.audit.test.ts`.
- **Web (modèles purs)** : `rh/_components/frais-model.ts`, `presences-model.ts`, `planning-model.ts`,
  `evaluations-model.ts` ; `nav` et `routes` étendus.
- **Essai de la dirigeante** : déposer une note de taxi depuis le téléphone ; la voir dans « Mes tâches »
  du manager, puis de la Directrice financière ; la rembourser comme Comptable ; constater la dépense en
  trésorerie et dans la marge du projet ; verser une avance de mission, la justifier par une note, rendre
  le reliquat ; activer le pointage pour un service, pointer, corriger ; publier un planning d'accueil
  et voir l'alerte de sous-effectif ; ouvrir une campagne d'évaluation de deux personnes et la clore.

## Questions pour le juriste

À lui remettre avec le dossier ; chaque réponse est consignée (nom, date) dans docs/28.

**J1 — Avances sur salaire.** Existe-t-il en droit congolais un plafond d'avance, une limite au nombre
d'avances, une quotité de salaire au-delà de laquelle une retenue est interdite ? Une avance peut-elle
être retenue sur le salaire, à quelles conditions (accord écrit, échelonnement) ? Un employeur peut-il
refuser une avance demandée ?

**J2 — Forme et sort des avances.** Faut-il une reconnaissance écrite ? Que devient une avance non
régularisée à la sortie du salarié (retenue sur le solde de tout compte, recouvrement) ? Un abandon de
créance est-il un avantage à déclarer ?

**J3 — Temps de travail.** Durées légales (jour, semaine), repos quotidien et hebdomadaire, travail de
nuit, heures supplémentaires et majorations, régimes particuliers (gardiennage, transport, hôtellerie) :
quelles règles un outil de planning devrait-il **signaler** ? Avec quelles sources (Code du travail,
arrêtés, conventions collectives) et dates d'effet ?

**J4 — Pointage et données personnelles.** Le pointage est-il licite sans formalité ? Faut-il informer ou
consulter les représentants du personnel, informer chaque salarié, déclarer le traitement ? Durée de
conservation des pointages, des évaluations, des justificatifs de frais et des données des anciens
salariés ? (docs/28 § 1.3, questions 3 et 6.)

**J5 — Frais professionnels.** Le remboursement de frais réels sur justificatif est-il exclu du salaire ?
Existe-t-il des barèmes ou forfaits reconnus (kilométrique, repas, déplacement) ?

**J6 — Évaluations.** Un entretien d'évaluation est-il obligatoire ou encadré (périodicité, information
préalable, droit de réponse) ? Une évaluation peut-elle fonder une sanction ou un licenciement, et quelle
trace faut-il garder ? La mention « pris connaissance » suffit-elle ?

## Questions pour l'expert-comptable

**C1 — Notes de frais.** Faut-il constater la dette envers le salarié à l'approbation (compte de tiers)
puis la solder au remboursement, ou comptabiliser la charge au remboursement ? Quel compte de tiers ?
La date de la charge est-elle la date de la dépense ou celle du remboursement ?

**C2 — Avances.** Quels comptes pour une avance de frais et une avance sur salaire au versement, à la
justification par une note, au retour d'espèces ? Faut-il distinguer les deux natures ?

**C3 — Régularisation sur la paie et abandon.** Quand une avance est retenue sur le salaire (paie hors
Lalanda), comment l'écriture de paie doit-elle la solder ? Quel traitement pour un abandon de créance ?

**C4 — Refacturation.** Des frais refacturés à un client sont-ils des débours (groupe J) ou une
prestation taxable ? Quel compte de produit ?

**C5 — Justificatifs.** Quelles pièces exiger pour qu'une note de frais soit une charge déductible ?
Une photo suffit-elle, ou faut-il conserver l'original, et combien de temps ? TVA déclarée sur un ticket :
récupérable à quelles conditions (ADR-0049, question E2) ?

## Découpage en lots parallélisables (worktrees séparés)

Règle d'ADR-0011 et d'ADR-0012 § 9 : **un fichier = un seul écrivain** par lot ; les fichiers partagés ne
reçoivent que des **ajouts** d'une ligne ou d'un bloc, sous un commentaire `// ADR-0051 — <lot>`. Les
lots suivent la numérotation d'ADR-0045 (H0 à H7).

| Lot | Contenu | Fichiers possédés (probables) | Critères | Tests | Dépend de |
|---|---|---|---|---|---|
| **H8 — Socle RBAC et contrats** (petit, en premier) | quatre actions, matrice, dépendances, domaine, `APPROVAL_ACTIONS`, `SOD_PAIRS`, `PLATFORM_FORBIDDEN_ACTIONS`, libellé de `payables.pay`, quatre fonctions de décision ; contrats partagés ; types et entités de notification | `apps/api/src/authz/permissions.ts`, `permissions.test.ts`, `overrides.test.ts`, `__tests__/rbac-matrix.e2e.test.ts` ; `packages/shared/src/hr/{expenses,advances,attendance,planning,performance}.ts` (nouveaux), une ligne par fichier dans `packages/shared/src/hr/index.ts` ; `packages/shared/src/notifications/index.ts` ; `apps/web/src/lib/api.ts` (`OrgAction`) ; `docs/12` | 1, 2 ; 3, 4, 13, 14 (fonctions pures) | matrice 990 ; tables de vérité | ADR-0050 K0-équivalent s'il touche `permissions.ts` |
| **H9 — Moteur** | § 9 (hors trésorerie, marge, brief, comptabilité) | `packages/engine/src/hr/{expenses,advances,attendance,planning,performance}.ts` (nouveaux), une ligne par fichier dans `packages/engine/src/hr/index.ts`, `hr/types.ts` (`HR_VERSION`) | 7, 11, 12 (calculs) | vitest, propriétés | — (parallèle à H8) |
| **H10 — Notes de frais et avances (API)** | collections, justificatifs, circuits, versement, régularisations, résumés, réglages `expenses.*` et `advances.*`, rappels d'avance | `apps/api/src/hr/{expenses,advances}/**` (nouveaux) ; une ligne par contrôleur dans `hr/hr.module.ts` ; `hr/settings/hr-settings.schema.ts` (bloc) ; `hr/reminders/hr-reminders.job.ts` (bloc) ; e2e `hr-expenses`, `hr-advances` | 3, 4, 7, 8, 9, 16 | e2e | H8, H9, H11 (méthodes de trésorerie) |
| **H11 — Trésorerie : pièces possédées par les RH** | `origin.kind = 'expense_report'`, `treasury_movements.origin`, `recordOwnedByExpenseReport`, `recordOwnedByAdvance`, `409 …_OWNED_BY_HR`, port `TREASURY_HR_PAYABLES_SOURCE`, exclusion du constat sans compte ; moteur trésorerie 1.2.0 | `apps/api/src/treasury/{treasury.schemas.ts,treasury-expenses.service.ts,treasury-movements.service.ts,treasury-sources.ts}` (blocs) ; `packages/engine/src/treasury/**` ; e2e `treasury-hr-owned` | 5, 7 (trésorerie) | e2e ; moteur | H8 |
| **H12 — Présences et plannings (API)** | pointages, corrections, créneaux, besoins, constats, réglages `attendance.*` et `planning.*` | `apps/api/src/hr/{attendance,planning}/**` (nouveaux) ; une ligne par contrôleur dans `hr.module.ts` ; e2e `hr-attendance`, `hr-shifts` | 11, 12 | e2e | H8, H9 |
| **H13 — Comptabilité : dépenses possédées par les RH** | filtre `origin.kind = 'supplier_payment'` ; `expense_report` comptabilisé ; motif d'attente `SETTLED_BY_EMPLOYEE_ADVANCE` ; clés `hr.advance.*` sans règle ; amendement d'ADR-0049 § 6.3 | `packages/engine/src/accounting/entries/purchases.ts`, `accounting/rules/operation-keys.ts` (bloc), `apps/api/src/accounting/sources/source-views.ts` (bloc) ; e2e `accounting-sync-hr` ; `docs/adr/ADR-0049…` (§ 6.3, une note) | 10 | e2e (pas de double comptage) | H11 |
| **H14 — Liens : Mes tâches, brief, projets, temps** | natures d'éléments `HR_AGENDA_SOURCE`, R19 et R20, port `WORK_HR_EXPENSES_SOURCE`, refacturables, colonne présence de la feuille de temps | `apps/api/src/hr/{agenda,brief}/**` (blocs) ; `apps/api/src/work/margin/**` et `work/billing/**` (blocs) ; `packages/engine/src/work/margin.ts`, `types.ts` ; `packages/engine/src/morning-brief/**` ; `apps/api/src/morning-brief/**` ; `apps/api/src/work/timesheets/**` ; `ai/ai-contexts.audit.test.ts` | 6, 15, 18 | e2e brief, marge, my-tasks | H10, H12 |
| **H15 — Objectifs et évaluations (API)** | `hr_goals`, campagnes, évaluations chiffrées, `reveal`, clôture, anonymisation étendue, réglages `performance.*`, rotation `secrets:rewrap` | `apps/api/src/hr/performance/**` (nouveau) ; une ligne dans `hr.module.ts` ; `hr/employees/hr-employees.service.ts` (**méthode d'anonymisation seulement**, un bloc) ; `apps/api/src/integrations/rewrap.ts` (un bloc) ; e2e `hr-performance` ; `docs/17`, `docs/28` | 13, 14 | e2e, anti-fuite | H8, H9 |
| **H16 — Web** | sous-options du § 10, marques en trésorerie, refacturables sur la fiche projet | `apps/web/src/app/(app)/rh/{moi/frais,frais,presences,planning,objectifs,evaluations}/**` (nouveaux) ; `rh/layout.tsx` (sous-options, un bloc) ; `apps/web/src/lib/api-rh-2.ts` (nouveau) ; `apps/web/src/lib/routes.ts` (+ test) ; `tresorerie/depenses/_components/**` (une marque) ; `projets/[id]/_components/**` (un panneau) | écrans § 10 | modèles purs | H8 (squelette) ; données après H10, H12, H15 |

### Zones de conflit entre lots

| Fichier | Lots | Règle |
|---|---|---|
| `apps/api/src/authz/permissions.ts`, `packages/shared/src/notifications/index.ts`, `apps/web/src/lib/api.ts` | **H8 seul** ; **conflit probable avec le socle d'ADR-0050** | fusionner après le socle d'ADR-0050 s'il est prêt, puis recaler numéros d'actions, nombre de cases (`12 × N + 6 × N`) et docs/12 |
| `apps/api/src/hr/hr.module.ts` | H10, H12, H15 | une ligne par lot, sous son commentaire |
| `apps/api/src/hr/settings/hr-settings.schema.ts` | H10 (`expenses`, `advances`), H12 (`attendance`, `planning`), H15 (`performance`, `retention.reviews…`) | un bloc par lot ; **H10 d'abord** |
| `apps/api/src/treasury/**`, `packages/engine/src/treasury/**` | **H11 seul** | H10 n'appelle que les deux méthodes exportées |
| `packages/engine/src/accounting/**`, `apps/api/src/accounting/**` | **H13 seul** | lecture seule ailleurs ; exception assumée à la règle d'ADR-0049 « aucun lot n'écrit dans `treasury` » : c'est l'inverse ici, la comptabilité change pour lire une pièce nouvelle |
| `packages/engine/src/hr/index.ts`, `packages/shared/src/hr/index.ts` | H8, H9 | une ligne d'export par fichier |
| `apps/api/src/work/**`, `packages/engine/src/work/**`, `morning-brief/**` | **H14 seul** | `MORNING_BRIEF_VERSION` et `WORK_MARGIN_VERSION` recalés si ADR-0050 les avance avant |
| `apps/api/src/authz/routes-coverage.test.ts` | H10, H12, H15 | un bloc par lot, **à la fin** |
| `apps/web/src/app/(app)/rh/layout.tsx`, `apps/web/src/lib/routes.ts` | **H16 seul** | — |
| `docs/12`, `docs/15`, `docs/16`, `docs/17`, `docs/28`, index des ADR | ce lot de documentation ; chaque lot passe sa ligne « proposé » à « implémenté » ; **entrée d'index à côté de celle d'ADR-0050** | une section par lot |

### Ordre de fusion conseillé

```
H8 ──┬── H11 ── H10 ──┬── H13
H9 ──┘                ├── H14 (après H12)
      └── H12 ────────┘
      └── H15
H16 (squelette dès H8 ; écrans au fil de H10, H12, H15)
```

1. **H8** et **H9** en parallèle (H8 après le socle d'ADR-0050 s'il touche `permissions.ts`).
2. **H11**, **H12** et **H15** en parallèle.
3. **H10** (après H11) ; puis **H13** et **H14**.
4. Écrans **H16**.

Chemin critique : H8 → H11 → H10 → H13. Si H12 ou H15 glissent, la chaîne utile « note → validation →
remboursement → trésorerie → marge » est déjà livrée ; présences, plannings et évaluations restent
**éteints par défaut**, donc sans effet tant qu'ils ne sont pas fusionnés.

## Décisions ouvertes — elles appartiennent à la dirigeante

Chacune a une **valeur par défaut**, la plus prudente, appliquée si rien n'est tranché.

1. **Actions** : `expenses.claim`, `expenses.approve`, `attendance.clock`, `performance.read`, matrice du
   § 5.1. *Défaut : oui.*
2. **Qui valide et qui paie les frais** : validation par Propriétaire et Directeur financier
   (`expenses.approve`), paiement par `payables.pay` réutilisée ; le Responsable RH lit sans valider.
   *Défaut : oui ; une action `expenses.pay` séparée, ou `expenses.approve` au Responsable RH, sur
   demande.*
3. **Circuit des notes de frais** : manager puis finance. *Défaut : `manager_then_finance` ; `finance_only`
   possible par réglage.*
4. **Avance sur salaire hors du manager** : le manager n'est ni consulté ni informé. *Défaut : oui.*
5. **Avances sur salaire et régularisation déclarée sur la paie** : *Défaut : avance sur salaire
   éteinte ; régularisation déclarée éteinte jusqu'à la réponse du juriste (J1) ; avance de frais
   active.*
6. **Justificatif exigé** : une ligne sans justificatif exige un motif ; aucun seuil. *Défaut : oui.*
7. **Coordonnées de paiement pour rembourser** : le payeur ne voit pas les coordonnées bancaires du
   collaborateur (`hr.sensitive.read`). *Défaut : oui ; le collaborateur indique le moyen (espèces,
   mobile money, virement) dans sa note, sans numéro.*
8. **Pointage** : *Défaut : éteint ; activé par l'organisation après la réponse du juriste (J4) ;
   pointage par soi autorisé une fois activé ; aucune localisation, jamais.*
9. **Plannings** : *Défaut : éteints ; aucun contrôle légal, seuils indicatifs vides.*
10. **Nom du bénéficiaire dans le libellé de la dépense de remboursement** (visible en trésorerie et dans
    la marge d'un projet) : *Défaut : « Frais NF… — {libellé} » sans nom ; le nom reste dans `/rh`.*
11. **Objectifs et évaluations** : *Défaut : éteints ; trame et échelle saisies par l'organisation,
    aucun modèle de notation fourni.*
12. **Qui lit les évaluations** : Propriétaire, Responsable RH, évaluateur, manager direct, l'évalué.
    *Défaut : oui ; ni Directeur financier, ni Administrateur, ni N+2 (`managerChainDepth = 1`).*
13. **Date et moment de la charge d'une note de frais** : dépense datée de la ligne, créée au
    remboursement. *Défaut : oui, jusqu'à la réponse de l'expert (C1).*
14. **Justificatifs hors bibliothèque, sans chiffrement applicatif** : *Défaut : oui ; chiffrement
    applicatif sur demande.*
15. **Frais refacturables** : marque informative et liste sur le projet, facture préparée à la demande,
    jamais émise seule. *Défaut : oui.*
16. **Conservation** (pointages, évaluations, justificatifs) : *Défaut : aucune purge automatique ;
    durées à fixer avec le juriste et l'expert-comptable (J4, C5), puis réglées dans `hr_settings.retention`.*
17. **Offres** (docs/13) : ce second volet ouvert aux mêmes offres que les RH d'ADR-0045. *Défaut : oui.*

## Liens

- [ADR-0011](ADR-0011-contrats-integration-s18.md) ; [ADR-0012](ADR-0012-modele-rbac-complet.md)
  (amendé) ; [ADR-0013](ADR-0013-stockage-secrets-integration.md) ;
  [ADR-0020](ADR-0020-ordonnanceur-mongodb.md) ; [ADR-0033](ADR-0033-brief-du-matin.md) (étendu) ;
  [ADR-0034](ADR-0034-depenses-et-tresorerie.md) (étendu : pièces possédées par les RH) ;
  [ADR-0039](ADR-0039-projets-et-taches-run.md) (étendu) ;
  [ADR-0041](ADR-0041-autorisations-par-membre.md) (étendu) ;
  [ADR-0044](ADR-0044-achats-et-fournisseurs.md) (motif des dépenses possédées, `payables.pay`) ;
  [ADR-0045](ADR-0045-ressources-humaines.md) (complété) ;
  [ADR-0046](ADR-0046-stocks-equipements-documents.md) (pièces RH hors bibliothèque) ;
  [ADR-0049](ADR-0049-comptabilite-syscohada.md) (§ 6.3 à amender, § 6.6 appliqué).
- [docs/08](../08-PREVISIONNEL-REALISE.md) ; [docs/12](../12-ROLES-PERMISSIONS.md) ;
  [docs/13](../13-PRICING.md) ; [docs/15](../15-DATABASE.md) ; [docs/16](../16-API.md) ;
  [docs/17](../17-SECURITE.md) ; [docs/28](../28-CONFORMITE-LEGALE.md).
- Code existant : `apps/api/src/hr/**`, `apps/web/src/app/(app)/rh/**`, `apps/api/src/authz/permissions.ts`,
  `apps/api/src/treasury/{treasury.schemas.ts,treasury-expenses.service.ts}`,
  `apps/api/src/work/{my-tasks.ports.ts,billing/,timesheets/}`,
  `packages/engine/src/accounting/entries/purchases.ts`, `packages/engine/src/hr/`.
