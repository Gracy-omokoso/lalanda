# Pricing, essai et entitlements

**Statut :** Draft à valider commercialement  
**Version :** 0.1

## Principes

- Quatre packs commerciaux maximum.
- Essai gratuit de 14 jours.
- Paiement mensuel ou annuel.
- Prix annuel présenté avec économie réelle.
- Limites appliquées par entitlements, pas par conditions dispersées.
- Les montants restent à valider avant commercialisation.

## Packs proposés

| Capacité | Starter | Pro | Business | Enterprise |
|---|---:|---:|---:|---:|
| Organisations | 1 | 1 | plusieurs | configurable |
| Projets actifs | limité | supérieur | élevé | configurable |
| Membres | 1 | petite équipe | équipe étendue | configurable |
| Plan 5 ans | oui | oui | oui | oui |
| Canvas | oui | oui | oui | oui |
| PDF | oui | oui | oui | oui |
| Excel | option/limité | oui | oui | oui |
| Réalisé/analytics | essentiel | complet | complet | complet |
| Scénarios | limité | plusieurs | avancé | avancé |
| Copilote IA | quota | quota supérieur | quota équipe | contrat |
| API/SSO | non | non | option | oui |
| Multi-entités | non | non | oui | oui |
| Support | standard | prioritaire | prioritaire | dédié |

Les nombres exacts sont des paramètres de catalogue, pas du code.

## Essai

- commence au niveau de l’organisation;
- dure 14 jours calendaires;
- une seule période d’essai par organisation économique selon règles antifraude;
- accès fonctionnel généreux mais quotas raisonnables;
- rappels avant expiration;
- aucune suppression immédiate à l’expiration;
- passage en lecture limitée pendant une période de grâce à définir;
- export des données disponible selon politique.

La carte bancaire obligatoire ou non est une décision commerciale à tester.

## États d’abonnement

`trialing`, `active`, `past_due`, `grace`, `suspended`, `canceled`.

Chaque transition est idempotente et pilotée par des événements de paiement vérifiés.

## Entitlements

Exemples : `projects.max`, `members.max`, `scenarios.max`, `actuals.enabled`, `excel_export.enabled`, `ai.monthly_quota`, `api.enabled`, `sso.enabled`.

L’interface peut expliquer une limite, mais l’API l’impose.

## Changements de plan

- montée en gamme immédiate avec prorata selon fournisseur;
- baisse à la prochaine échéance;
- ressources au-dessus de la future limite signalées;
- aucune suppression automatique de projet;
- annulation et reprise documentées;
- factures et taxes conservées selon obligations.

## Implémenté (S16b)

Première tranche d'entitlements appliqués côté API — sans intégration paiement.

### Modèle

- Collection `subscriptions` (`apps/api/src/billing/subscription.schema.ts`) :
  `organizationId` (unique), `plan: free | pro | business`, `status: active`,
  `_schemaVersion`. Une organisation **sans** document est en plan `free`.
- Catalogue typé `PLAN_ENTITLEMENTS` (`apps/api/src/billing/entitlements.ts`) :
  - `free` : `maxProjects: 1`, `pdfWatermark: true`;
  - `pro` : projets illimités, PDF sans filigrane;
  - `business` : tout Pro + `seats: 20`.

### Limites appliquées par l'API

- `POST /projects` : limite atteinte → `403 { code: 'PLAN_LIMIT_PROJECTS', limit, plan }`.
  Le web affiche un message avec lien vers `/pricing` (pas d'UI d'upgrade).
- Export PDF : filigrane discret « Généré avec Lalanda — offre gratuite » répété
  sur chaque page si le plan est `free` (décidé côté API, jamais par l'UI).
- `GET /organizations/current/subscription` → `{ plan, entitlements, usage: { projects } }`.

### Hors périmètre S16b

- **Aucune intégration paiement** : pas d'endpoint public de changement de plan.
  `BillingService.setPlan` est interne (seed, support, tests) en attendant les
  événements de paiement vérifiés décrits plus haut.
- Essai 14 jours, états `trialing`/`past_due`/`grace`/…, quotas scénarios/membres/IA.

### Divergence page publique / ce document

La page `/pricing` (apps/web) publie **trois** offres — Free, Pro (9 USD/mois),
Business (49 USD/mois) — alors que ce document décrit **quatre** packs
(Starter/Pro/Business/Enterprise) encore à valider commercialement. S16b implémente
la promesse publique (la page), qui fait foi tant que la grille ci-dessus n'est pas
arbitrée. À réconcilier lors de la validation commerciale.

## Validation commerciale requise

Étude de la volonté de payer par segment, coûts d’IA et d’exports, moyens de paiement locaux, devises de facturation, fiscalité de vente numérique, politique de remboursement et remise annuelle.
