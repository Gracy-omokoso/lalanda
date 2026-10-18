# ADR-0018 — Trajectoire ERP : trois modules, ordonnanceur d'abord

Statut : Proposed
Date : 2026-10-18
Décideurs : Gracy Omokoso

## Contexte

Un brief « Startup Operating System — Build. Run. Grow. » (réflexion préparée avec
un autre assistant, pas un cahier des charges) décrivait neuf modules ERP, un volet
marketing/investisseurs et une IA à cinq niveaux. Le diagnostic du 17 oct. 2026 a
établi : BUILD ≈ 30 % (l'aval — le chiffrage — existe, l'amont manque), RUN = 0 %,
GROW = 0 %. Le 18 oct. 2026, le décideur a retenu la trajectoire resserrée
ci-dessous et confié l'exécution (ordre, découpage, refus) à l'équipe de développement.

Trois faits du dépôt conditionnent tout le reste :

- **Le produit ne sait rien déclencher dans le temps.** Ni `@nestjs/schedule`, ni
  file de messages, ni bus d'événements (`billing/subscription-lifecycle.ts` : les
  transitions d'abonnement sont appliquées paresseusement à la lecture). Redis tourne
  mais l'API ne s'en sert pas. Une échéance de facture, une relance, ou la reprise
  d'une facture normalisée restée en attente côté DGI exigent un ordonnanceur.
- **Collisions de vocabulaire.** `payment_events`, `manual_payment_requests` et
  `subscriptions` désignent le chiffre d'affaires **de Lalanda** (abonnements SaaS),
  pas la facturation des clients de nos utilisateurs ; `projects` désigne un plan
  financier. Les nouveaux modules prennent des noms qui ne se confondent pas.
- **La couture plan ↔ réalisé existe.** Hypothèse (plan), plan figé (versionné,
  empreinte), réalisé (`actual_periods`). C'est exactement la distinction qu'un ERP
  doit respecter.

## Options considérées

1. **Le brief tel quel** (9 modules + GROW + IA niveau 5). Écarté : programme de
   plusieurs années, parité impossible avec des ERP de vingt ans d'âge, et une IA qui
   exécute paiements ou écritures est un risque disproportionné.
2. **Renforcer BUILD seulement.** Écarté par le décideur.
3. **Trois modules RUN, en commençant par le socle temporel.** Retenu.

## Décision

**Ordre d'exécution :**

0. **Ordonnanceur** — tâches planifiées persistées en base, exécution unique même
   avec plusieurs instances d'API, reprise après redémarrage. Première brique, sans
   fonctionnalité visible.
1. **Ventes** — clients, catalogue (produits et services), devis, factures, avoirs,
   encaissements, PDF ; **facture normalisée DGI intégrée** ([ADR-0019](ADR-0019-facture-normalisee-dgi-rdc.md)).
2. **Dépenses et trésorerie réelle** — dépenses, rapprochement de la trésorerie
   réelle avec le prévisionnel. C'est la valeur propre de Lalanda : aucun outil de
   facturation générique ne compare au plan financier.
3. **CRM minimal** — contacts, opportunités, historique, branché sur les devis.

**Règles transverses :**

- **RUN alimente le réalisé, jamais le plan figé.** Les encaissements et dépenses
  agrègent vers `actual_periods` ; aucun module RUN n'écrit dans un plan. Une vérité
  comptable parallèle au moteur est interdite (CLAUDE.md : le moteur est l'unique
  source des calculs).
- **Pas de comptabilité générale certifiée.** Un module OHADA qui produirait une
  liasse fausse engagerait la responsabilité de l'éditeur. Les ventes et dépenses
  produisent des données exportables vers un logiciel comptable, pas des états
  financiers légaux.
- **Refusés à ce stade** : RH et paie, stocks, achats, marketplace, IA niveau 5
  (« Act »). L'IA reste explicative.
- **Données isolées par organisation**, comme le reste du produit ; chaque nouvelle
  action passe par la matrice RBAC unique (`authz/permissions.ts`, ADR-0012).

## Conséquences

- Nouvelles actions RBAC (ventes, encaissements, réglages fiscaux) : ADR-0012 et
  docs/12 à amender lot par lot.
- Nouvelles collections nommées sans ambiguïté (`customers`, `catalog_items`,
  `quotes`, `sales_invoices`, `receipts`…) ; le préfixe `sales_` évite toute
  confusion avec `billing/` (abonnements SaaS).
- L'ordonnanceur devient une dépendance d'infrastructure ; il remplacera à terme les
  transitions paresseuses d'abonnement.

## Plan de validation

Chaque lot est présenté (exigences, critères d'acceptation, fichiers, tests,
décisions ouvertes) puis validé par le décideur avant implémentation, conformément à
CLAUDE.md. Un lot est livré quand ses tests e2e passent, qu'il est déployé et qu'il a
été essayé en production par le décideur.

## Liens

- Diagnostic : brief ERP du 17 oct. 2026 (hors dépôt).
- [ADR-0012](ADR-0012-modele-rbac-complet.md) — RBAC ; [ADR-0013](ADR-0013-stockage-secrets-integration.md) — secrets ; [ADR-0019](ADR-0019-facture-normalisee-dgi-rdc.md) — facture normalisée.
- docs/08 — prévisionnel / réalisé.
