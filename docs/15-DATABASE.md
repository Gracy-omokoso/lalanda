# Modèle de données

**Statut :** Draft conceptuel  
**Version :** 0.1

## Principes

- identifiants non devinables;
- `organizationId` obligatoire sur toute donnée cliente;
- dates en UTC, fuseau conservé séparément;
- montants stockés en unités décimales sûres avec devise;
- versions immuables pour plans, règles et exports;
- suppression logique ou rétention explicite;
- index conçus avec les requêtes et l’isolation.

## Agrégats

### Identité et SaaS

`User`, `Organization`, `Membership`, `Invitation`, `Role`, `Permission`, `Subscription`, `PlanCatalog`, `Entitlement`, `InvoiceReference`.

### Produit

`Project`, `ProjectAccess`, `Canvas`, `CanvasVersion`, `CanvasItem`, `FinancialObjective`, `Scenario`, `InputSet`, `InputValue`.

Idea Lab (ADR-0036), en amont du projet : `idea_lab_ideas` (une fiche par idée, isolée par
organisation : problème, cible, solution, alternatives, hypothèses, taille de marché
déclarée **avec sa source**, notes de la grille avec leur preuve, expériences et leurs
résultats saisis, traces de promotion ; aucun score stocké, le moteur le recalcule),
`idea_lab_settings` (IA permise ou non, unique par organisation), `idea_lab_ai_logs`
(tentatives d'assistance IA, empreinte de l'entrée sans le prompt, expiration TTL).

### Finance

`CalculationRun`, `FinancialPlan`, `FinancialStatement`, `FinancialLine`, `FormulaVersion`, `DiagnosticResult`, `DebtSchedule`, `AssetSchedule`.

### Réalisé

`ActualPeriod`, `ActualEntry`, `ImportBatch`, `MappingRule`, `Variance`, `Forecast`, `Alert`, `ActionItem`.

### International

`CountryPack`, `CountryPackVersion`, `AccountingRule`, `TaxRule`, `RuleSource`, `SectorTemplate`.

### Plateforme

`Report`, `ExportJob`, `Attachment`, `Comment`, `AuditEvent`, `Notification`, `AiInteraction`.

**Proposé, ADR-0053 (console Lalanda, aucune collection créée au lot P0).** Collections de portée
plateforme, sans `organizationId` de locataire (une cible se nomme `targetOrganizationId`) :
`platform_plan_grants`, `platform_feature_overrides`, `platform_announcements`,
`platform_announcement_receipts` (index unique `{ announcementId, userId }`) ; champs ajoutés à
`organization_suspensions` (`reasonCategory`, `clientMessage`, `internalNote`, `mode`, `liftReason`,
`liftedClientMessage`) et à `user` (`disabledReasonCategory`, `disabledInternalNote`, `disabledBy`).
`user.disabledAt` (existant) est **lu** dès P0 par `PlatformAuthGuard`. `audit_events` inchangé : le
miroir pseudonyme s'écrit avec `actorUserId: 'platform:lalanda'`.

**Créée au lot P4 (ADR-0053 § 6.3) : `platform_feature_overrides`** — `{ targetOrganizationId, feature,
value (toujours `true` en v1 : une dérogation ouvre, elle ne ferme pas), reasonCategory, internalNote,
endsAt (90 jours au plus), grantedBy, revokedAt, revokedBy, _schemaVersion }`, index
`{ targetOrganizationId, feature, revokedAt, endsAt }`. Rien n'est supprimé : une levée pose `revokedAt`.

## Valeur financière

```ts
type Money = {
  amount: string;       // décimal canonique
  currency: string;     // ISO 4217
};
```

Les conversions conservent montant source, devise source, taux, date, fournisseur et politique d’arrondi.

## Version immuable

`FinancialPlan` référence :

- `inputSetVersion`;
- `engineVersion`;
- `countryPackVersion`;
- `scenarioId`;
- `calculatedAt`;
- `approvedAt` et `approvedBy`;
- empreinte du résultat.

## Audit

Un événement contient acteur, organisation, action, cible, horodatage, adresse/session pertinente, avant/après filtré, motif et corrélation. Les secrets et données inutiles sont exclus.

## Index critiques

- unicité d’adhésion organisation/utilisateur;
- projets par organisation et statut;
- scénarios par projet;
- entrées par scénario/version/clé/période;
- réalisé par projet/période/catégorie;
- audit par organisation/date/action;
- règles pays par pack/date d’effet/statut;
- documents de vente (`sales_invoices`) : unicité partielle `organizationId + series + number`, unicité `organizationId + proformaRef`; compteurs (`sales_invoice_counters`) uniques par `organizationId + series + year`; journal électronique (`sales_invoice_journal`, ajout seul, chaîné par empreinte) unique par `organizationId + seq`, tête `sales_journal_heads` (ADR-0023);
- idées (`idea_lab_ideas`) par `organizationId + archived + updatedAt` ; réglages
  `idea_lab_settings` uniques par `organizationId` ; `idea_lab_ai_logs` à expiration TTL sur
  `expiresAt` (ADR-0036).
- CRM (ADR-0035, implémenté) : `crm_settings` unique par `organizationId` ; `crm_contacts`,
  `crm_opportunities`, `crm_activities` par `organizationId` + date de création et par
  rattachement (client, opportunité, contact).
- **Proposé, ADR-0040 (non implémenté)** : `crm_accounts` (compte prospect ou client), unique
  partiel `organizationId + customerId` (une fiche client a au plus un compte), liste par
  `organizationId + sortName` ; champs ajoutés : `accountId` (contacts, opportunités,
  activités), `assigneeUserId`, `dueDay`
  (jour de Kinshasa), `reminders` (activités) ;
  index `organizationId + assigneeUserId + done + dueDay` (« Mes tâches ») ; `work_projects` : unique
  partiel `organizationId + source.opportunityId`. Migration
  `20261030-0001-crm-accounts.mjs` (prospects regroupés par nom normalisé exact).

- **Implémenté, ADR-0040 lot C2 (pipeline v2)** : `crm_opportunities` gagne `accountId`
  (identifiant de compte en chaîne, comme l'écrit C1), `ownerId`, `lines` (0 à 50 : article,
  libellé, quantité, unité, prix unitaire HT, remise en %), `amountSource` (`manual` \| `lines`),
  `lostReasonKey` (`lostReason` reste le détail), `wonAt` ; index `organizationId + accountId`,
  `organizationId + ownerId + status`, `organizationId + status + expectedCloseDate`,
  `organizationId + status + closedAt`. `crm_settings` gagne `lostReasons` (`key`, `label`,
  `active` ; absent → six motifs par défaut) et `lostReasonRequired` (absent → `true`). Champs
  additifs, `_schemaVersion` inchangé ; aucune migration propre (celle de C1 pose `accountId`).

- **Proposé, ADR-0044 (non implémenté)** — achats et fournisseurs : `suppliers` (NIF facultatif,
  unique partiel `organizationId + nif` ; coordonnées de paiement **chiffrées** AES-256-GCM sous le
  trousseau d'ADR-0013, seule une forme masquée est lisible ; `legacyKeys` des anciens textes),
  `purchase_settings` (un par organisation : paliers d'approbation par devise, tolérances),
  `purchase_counters` (`organizationId + kind + year`, numéros `DA`, `BC`, `FF`, `PF`),
  `purchase_orders` (demande puis commande ; uniques partiels sur `requestNumber` et
  `orderNumber` ; `organizationId + status + updatedAt`), `purchase_receptions` (aucune quantité
  de stock), `supplier_invoices` (unique partiel `organizationId + supplierId +
  supplierReferenceKey` hors annulées ; `organizationId + status + dueDate`),
  `supplier_payments`. Champs ajoutés : `treasury_expenses.supplierId` et `origin` (dépense
  créée par un paiement fournisseur, unique partiel sur `origin.paymentId + invoiceId +
  allocationIndex`), `treasury_recurring_expenses.supplierId`. Migration
  `20261031-0001-suppliers-from-expenses.mjs` (fournisseurs texte regroupés par clé exacte).

- **Implémenté, ADR-0045 (lots H0 à H3 et H5 ; documents et listes au lot H4)** — ressources
  humaines, paie exclue : `hr_employees`
  (dossier non sensible ; `userId` facultatif, unique partiel `organizationId + userId` ; matricule
  unique partiel ; `organizationId + status + sortName`, `+ departmentId`, `+ managerEmployeeId`,
  partiels sur `contractEndDate` et `probationEndDate`), `hr_employee_private` (un par
  collaborateur, sections **chiffrées** AES-256-GCM sous le trousseau d'ADR-0013 : salaire de base
  déclaré, coordonnées bancaires, identité, coordonnées personnelles et contacts d'urgence ; seules
  des formes masquées sont lisibles sans `reveal`), `hr_departments` (arbre sans cycle),
  `hr_settings` (un par organisation), `hr_leave_types`, `hr_holidays` (unique `organizationId +
  date`), `hr_leave_requests` (`organizationId + employeeId + start.date`, `organizationId + status
  + start.date`), `hr_leave_ledger` (ajout seul ; unique partiel des acquisitions par
  `employeeId + typeId + period`), `hr_documents` (pièces sensibles chiffrées côté application ;
  partiel sur `expiresOn`), `hr_checklist_templates`, `hr_checklists`. Aucune migration.
  Lot H5 : **aucune collection nouvelle** ; le brief, les projets, la feuille de temps et les
  rapports LISENT `hr_employees`, `hr_leave_requests` (approuvées : employé et dates, jamais le
  motif), `hr_holidays`, `hr_settings`, `hr_documents.expiresOn` et `hr_employee_private.idExpiries`
  (en clair, sans numéro) ; jamais une section chiffrée. La marge lit en plus
  `treasury_expenses.category` (constat `personnel`, marge 1.2.0).

- **Implémenté, ADR-0046 (lots S0 à S9)** — stocks, équipements et documents :
  `stock_items` (lien facultatif et unique partiel `organizationId + catalogItemId` vers un article
  du catalogue de type `BIE` ; code unique partiel), `stock_locations` (plusieurs par organisation,
  une par défaut), `stock_movements` (grand livre **en ajout seul**, quantités signées, coût
  d'entrée, unique partiel `organizationId + sourceKey` pour l'idempotence des entrées de réception
  et des sorties de vente ; `organizationId + itemId + occurredOn + _id` pour le rejeu de la
  valorisation), `stock_vouchers` (bons `BS`, `BT`, `BJ`), `stock_levels` (cache des quantités,
  recalculable, jamais source de vérité ; aucune valeur stockée), `stock_pending_lines`
  (« À traiter »), `stock_counts` (inventaires `IV`), `stock_settings`, `stock_sync_checkpoints`,
  `stock_counters` ; `assets` (numéro `EQ-…`, liens facultatifs d'acquisition), `asset_categories`,
  `asset_assignments` (ajout seul, une ouverte par équipement), `asset_maintenance`,
  `asset_coverages`, `asset_settings`, `asset_counters` ; `document_folders` (droits par dossier),
  `library_documents` (liens vers des entités, échéance), `library_document_versions` (objet
  `documents/<objectId>`, clé enveloppée si sensible). **Aucune migration** ; aucune collection
  existante ne gagne de champ. Lectures seules : `purchase_receptions`, `purchase_orders`,
  `sales_invoices` (statuts `issued` et `normalized`), `catalog_items`, `hr_employees`,
  `treasury_expenses` (catégorie `investissement`). Lot S7 : `stock_notification_states`
  (épisodes des notifications de seuil et de stock négatif, unique `organizationId + key`) ; le
  brief, « Mes tâches » et la marge lisent `stock_items`, `stock_levels`, `stock_movements`,
  `stock_counts`, `stock_pending_lines`, `asset_*` et `library_documents` sans les écrire.

- **Proposé, ADR-0049 (non implémenté)** — comptabilité SYSCOHADA, états toujours « projet » :
  `accounting_chart_packs` (plateforme ; pack de plan comptable versionné `draft → review → approved →
  active → retired`, sources, chaque compte `sourced` ou `to_confirm`), `accounting_settings` (un par
  organisation : mode `off | simulation | active`, monnaie de tenue sans défaut, date de bascule),
  `accounting_accounts` (unique `organizationId + number` ; auxiliaires clients et fournisseurs),
  `accounting_rule_sets` (règles de correspondance versionnées, immuables une fois validées),
  `accounting_journals` (unique `organizationId + code`), `accounting_entries` (**ajout seul** ; unique
  partiel `organizationId + sourceKey` pour l'idempotence ; numéros sans trou par journal et exercice ;
  chaînage `prevHash`/`hash`), `accounting_journal_heads`, `accounting_counters`,
  `accounting_fiscal_years`, `accounting_periods`, `accounting_exchange_rates` (taux saisis, unique
  `organizationId + date + from + to`), `accounting_lettering` (ajout seul), `accounting_pending`,
  `accounting_sync_checkpoints`, `accounting_exports` (empreinte SHA-256). **Aucune migration** ; aucune
  collection existante ne gagne de champ. Lectures seules : `sales_invoices` (série réelle, `issued` et
  `normalized`), `sales_receipts`, `treasury_expenses` (`origin` nulle), `treasury_movements`,
  `treasury_accounts`, `supplier_invoices`, `supplier_payments`, `stock_movements` (option éteinte).
  **N'écrit jamais** `actual_periods` ni un plan.

- **Proposé, ADR-0050 (non implémenté ; socle RBAC et contrats partagés appliqués au lot V0)** —
  commandes clients, contrats, avenants, acomptes et abonnements que les organisations vendent à
  **leurs** clients : `sales_orders` (`CC{AA}{MM}-NNNNNN`, hors série fiscale ; une seule commande
  vivante par devis, unique partiel `organizationId + source.quoteId` sur les commandes non
  annulées), `sales_order_counters`, `sales_contracts` (`CT{AA}{MM}-NNNNNN` ; versions avant
  signature dans `previousVersions` ; clauses **saisies** : terme, reconduction, préavis ;
  échéancier `none | schedule | recurring` ; `approvals`, `signature`, `renewals` en ajout seul,
  `termination` ; `contentSha256` à la signature), `sales_contract_counters`,
  `sales_contract_amendments` (avenant numéroté `CT…-A{n}`, date d'effet, même cycle que le
  contrat), `sales_contract_files` (PDF seul, 10 Mio, téléchargement inerte, ajout seul),
  `sales_document_links` (lien facture ↔ commande, contrat ou échéance ; unique
  `organizationId + invoiceId`, partiels `organizationId + contractId + occurrenceDate` et
  `organizationId + contractId + itemRef`), `sales_contract_settings` (un par organisation, défaut
  implicite). Toutes portent `organizationId`, `revision`, `_schemaVersion: 1`. **Aucune
  migration** ; **aucun champ** ajouté à `sales_invoices` (les factures naissent par
  `InvoiceDraftsService.create`, liste fermée des écrivains inchangée). Lectures seules :
  `sales_quotes`, `customers`, `sales_invoices`, `sales_invoice_settlements`, `work_projects`.
  `sales_document_links` n'est lu ni par la comptabilité ni par le pont vers le réalisé.
  **Lot V2 implémenté** : `sales_orders`, `sales_order_counters`, `sales_document_links`,
  `sales_contract_files`. L'unicité « une commande vivante par devis » porte sur le champ
  `liveQuoteId` (identifiant du devis tant que la commande n'est pas annulée, `null` sinon ; unique
  partiel `organizationId + liveQuoteId` sur `$type: 'string'`) ; chaque ligne de commande porte un
  `lineRef` stable (`L1`, `L2`…). Les pièces comptent dans le quota commun de 1 Gio par organisation
  (pièces des projets et des achats).
  **Lot V3 implémenté** : `sales_contracts` (contenu versionné, `previousVersions`, `approvals`,
  `signature`, `renewals` en ajout seul — `{ termIndex, from, to, mode, recordedBy, recordedAt,
  amendmentId }` —, `termination` avec `noticeCheck`, `contentSha256` posé à la signature ; les
  lignes de chaque échéance d'un `schedule` sont composées et stockées avec leurs montants),
  `sales_contract_counters`, `sales_contract_amendments` (unique `organizationId + contractId +
  index`, `changes` partiels composés), `sales_contract_settings` (unique `organizationId`).
  **Lot V4 implémenté** : `sales_deposit_resolutions` (geste déclaratif « traité » d'une facture
  d'acompte émise, ajout seul ; unique `organizationId + invoiceId` ; `orderId` ou `contractId`,
  `reason`, `resolvedBy`, `resolvedAt`) ; lue par le seul module des engagements, jamais par la
  comptabilité, le réalisé ni la trésorerie. Les acomptes eux-mêmes restent des `sales_invoices`
  `FT`/`ET` ordinaires, reliés par `sales_document_links` (`order_deposit`, `contract_deposit`,
  `requestedAmount`).

## Rétention

La politique définit données actives, exports, journaux, IA, pièces et sauvegardes. La suppression d’une organisation suit une période de récupération puis une purge contrôlée, sous réserve des obligations légales.
