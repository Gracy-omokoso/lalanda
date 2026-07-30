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
- règles pays par pack/date d’effet/statut.

## Rétention

La politique définit données actives, exports, journaux, IA, pièces et sauvegardes. La suppression d’une organisation suit une période de récupération puis une purge contrôlée, sous réserve des obligations légales.
