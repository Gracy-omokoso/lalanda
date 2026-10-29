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
  activités), `ownerId`, `lines`, `lostReasonKey` (opportunités), `assigneeUserId`, `dueDay`
  (jour de Kinshasa), `reminders` (activités), `lostReasons`, `forecastProbability` (réglages) ;
  index `organizationId + assigneeUserId + done + dueDay` (« Mes tâches »), `organizationId +
  ownerId + status`, `organizationId + status + expectedCloseDate` ; `work_projects` : unique
  partiel `organizationId + source.opportunityId`. Migration
  `20261030-0001-crm-accounts.mjs` (prospects regroupés par nom normalisé exact).

## Rétention

La politique définit données actives, exports, journaux, IA, pièces et sauvegardes. La suppression d’une organisation suit une période de récupération puis une purge contrôlée, sous réserve des obligations légales.
