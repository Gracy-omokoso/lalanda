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

## Rétention

La politique définit données actives, exports, journaux, IA, pièces et sauvegardes. La suppression d’une organisation suit une période de récupération puis une purge contrôlée, sous réserve des obligations légales.
