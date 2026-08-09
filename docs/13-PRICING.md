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

## Implémenté (S22b)

Cycle de vie complet, essai, prorata et paiements vérifiés. Le lot rend la
plateforme **facturable** ; il ne décide d'aucun prix.

### Machine d'état

- `apps/api/src/billing/subscription-state.ts` — table de transitions explicite
  sur les six statuts de ce document. Toute écriture de `status` passe par
  `applyEvent()` : il n'existe aucun chemin qui pose un statut à la main, et une
  transition non déclarée lève `InvalidTransitionError` (409 côté HTTP).
- `apps/api/src/billing/subscription-lifecycle.ts` — transitions **temporelles**
  (essai échu, grâce échue, baisse de gamme différée), appliquées **à la
  lecture**. Il n'y a aucun ordonnanceur dans l'application (ADR-0009) : un essai
  qui n'expirerait qu'au passage d'un cron inexistant n'expirerait jamais.
  `POST /payments/maintenance/sweep` fait le même travail en lot pour les
  rapports d'exploitation — c'est une commodité, jamais la source de vérité.

### Essai

- 14 jours, **sans carte bancaire** : `POST /organizations/current/subscription/trial`
  n'appelle aucun fournisseur, c'est une écriture locale.
- Une seule période par organisation : `trialStartedAt` ne redevient jamais
  `null`, résilier ne libère donc pas un second essai.
- Plan accordé : `pro` (et non `business`) — « accès généreux, quotas
  raisonnables » ; les 20 sièges de Business feraient de l'essai une licence
  d'équipe gratuite de deux semaines.
- À l'expiration, **aucune donnée n'est supprimée** : `plan` reste inchangé en
  base et c'est `effectivePlan()` qui répond `free`. La limite s'applique aux
  créations futures. Couvert par `subscriptions.e2e.test.ts`.

### Changements de plan

- `apps/api/src/billing/proration.ts`, fonction pure : crédit du non-consommé,
  coût de la période restante, **jamais de remboursement** (un crédit excédentaire
  est reporté dans `carriedCreditCents`).
- Montée en gamme immédiate et payante ; baisse programmée à l'échéance.
  `POST .../subscription/plan` **refuse** une montée en gamme
  (`UPGRADE_REQUIRES_PAYMENT`) : l'accorder donnerait Business à qui sait envoyer
  un POST.
- `GET .../subscription/quote` chiffre sans encaisser — le client voit le montant
  avant d'être envoyé chez un fournisseur.
- Montants **hors taxes**, et la réponse le déclare (`taxIncluded: false`) : la
  fiscalité de la vente numérique n'est pas arbitrée (voir plus bas).

### Paiements

- `apps/api/src/payments/payment-provider.ts` — interface `PaymentProvider`
  commune. Trois implémentations : `stripe`, `paypal`, `manual`.
- **Signature vérifiée avant toute lecture du corps.** Un rappel non signé est un
  formulaire public qui accorde des abonnements. Comparaison en temps constant,
  tolérance d'horodatage de 5 minutes, et **aucun repli** : sans secret
  configuré, le fournisseur est indisponible (503), jamais permissif.
- **Idempotence** par index unique `{provider, eventId}` sur `payment_events`,
  inséré *avant* traitement. Un rejeu répond 200 sans rien refaire.
- Rattachement à une organisation par métadonnées, à défaut par jointure exacte
  sur `subscriptions.{provider, providerSubscriptionId}`. Aucune heuristique :
  un rappel non rattachable reste **orphelin et visible**, jamais crédité à une
  organisation approchante.
- Chaque transition est journalisée dans `audit_events` (S20a).

### Ce qui marche sans compte marchand, et ce qui attend

| Moyen | Fournisseur | État |
|---|---|---|
| Mobile money | `manual` | **Opérationnel.** Dépôt + référence, confirmation par un rôle plateforme. |
| Virement | `manual` | **Opérationnel.** Même circuit. |
| Carte bancaire | `stripe` | Code complet, **attend** `LALANDA_STRIPE_RESTRICTED_KEY` et `LALANDA_STRIPE_WEBHOOK_SECRET`. |
| PayPal | `paypal` | Code complet, **attend** identifiants OAuth, `webhookId` et des `plan_id` créés dans le catalogue marchand. |

**Aucun agrégateur mobile money n'a été intégré**, et c'est délibéré. pawaPay,
Flutterwave et MaxiCash exigent tous un compte marchand vérifié pour obtenir des
identifiants **et** pour connaître le schéma exact de signature de leurs rappels,
qui n'est pas vérifiable publiquement de bout en bout. Un fournisseur écrit sur
des suppositions passerait des tests écrits contre ces mêmes suppositions : une
intégration verte qui accepte n'importe quel rappel. Le fournisseur `manual` ne
prétend rien et fonctionne aujourd'hui.

Limite assumée du circuit manuel : **aucun renouvellement automatique**. Un dépôt
mobile money est un paiement ponctuel, il n'existe pas de mandat de prélèvement.
L'abonnement arrive à échéance et repasse par `past_due` comme les autres.
L'interface le dit explicitement au moment du choix.

### Notifications : ce que S22b n'envoie pas, et pourquoi

**S22b n'envoie aucun email.** Ce n'est pas un oubli, et surtout ce n'est pas une
seconde interface d'envoi : le module `mail/` livré par S22a (`MailService`,
repli journal sans SMTP) reste le seul chemin d'envoi du dépôt. S22b n'en a
créé aucun autre et n'en créera pas.

L'information d'abonnement circule aujourd'hui **dans l'application**, par
`statusNotice()` (`subscription-lifecycle.ts`), calculée à la lecture : fin
d'essai proche, échec de paiement, période de grâce, suspension. C'est cohérent
avec l'absence d'ordonnanceur (ADR-0009 : ni `@nestjs/schedule`, ni worker).

Deux cas restent ouverts, et ils ne se valent pas :

- **Rappel de fin d'essai — non réalisable en l'état.** Un rappel « il vous reste
  3 jours » n'a de sens qu'envoyé *sans* que l'utilisateur soit là. Or le seul
  déclencheur disponible est la lecture de l'abonnement, c'est-à-dire un
  utilisateur déjà devant l'écran — à qui la bannière a déjà tout dit. Sans
  ordonnanceur, l'email n'ajoute rien. Il demande une décision d'architecture,
  pas quelques lignes.
- **Échec de paiement — réalisable, non fait, assumé.** Le webhook est un
  déclencheur événementiel : il n'a besoin d'aucun cron. Le blocage est le
  destinataire. `BillingService` ne dépend que du modèle `Subscription` et d'un
  `AuditService` optionnel ; `subscription.schema.ts` ne stocke aucune adresse.
  Notifier suppose donc de résoudre organisation → propriétaire → email, soit une
  dépendance nouvelle vers les utilisateurs dans un service dont la surface a été
  tenue volontairement étroite. C'est un ajout défendable, mais c'en est un — pas
  un branchement. Il n'a pas été fait au moment de l'intégration pour ne pas
  glisser une fonctionnalité non testée dans une fusion.

Recommandation : traiter l'email d'échec de paiement en premier (valeur réelle,
coût maîtrisé, `MailService` déjà disponible et `@Global`), et ne rouvrir le
rappel de fin d'essai qu'avec la décision sur l'ordonnanceur.

### Valeurs posées par défaut, à arbitrer

- **Période de grâce : 7 jours.** Ce document la laisse « à définir ». Assez pour
  qu'un client en déplacement remplace une carte, assez court pour que l'impayé
  ne devienne pas un abonnement gratuit. `GRACE_DAYS` dans `pricing-catalog.ts`.
- **Business n'a pas de tarif annuel.** La page publique n'en annonce aucun ; le
  catalogue vaut donc `null` et l'API refuse ce couple (`PLAN_NOT_SELLABLE`)
  plutôt que de deviner un « 490 USD/an » plausible.

## Divergence tarifaire — signalement et avis (S22b)

**Le constat, d'abord.** Trois grilles coexistent :

1. ce document, § *Packs proposés* : **quatre** packs (Starter, Pro, Business,
   Enterprise), sans montants;
2. la page `/pricing` : **trois** offres — Free 0, Pro 9 USD/mois (ou 90/an),
   Business 49 USD/mois;
3. le code (`entitlements.ts`, `pricing-catalog.ts`) : aligné sur la page, qui
   fait foi comme promesse publique.

La divergence était déjà signalée en S16b. Elle n'est **pas** résolue ici, et
elle ne peut pas l'être par un développeur : c'est une décision commerciale.

**L'avis qui suit est une proposition argumentée, pas un changement.** Aucun prix
n'a été modifié dans le code.

### 1. Le coût marginal réel n'est pas l'IA

L'appel IA (`gpt-4o-mini`, `ai-actions.service.ts`) porte un contexte de plan et
rend une explication courte. À quelques milliers de jetons d'entrée et moins d'un
millier en sortie, l'ordre de grandeur est de **l'ordre du millième de dollar par
appel** aux tarifs publics de cette classe de modèle — soit environ un millier
d'appels pour 1 USD. Même en supposant un utilisateur Pro très actif à 200 appels
par mois, la charge IA reste **sous 1 % d'un abonnement à 9 USD**.

Deux réserves, l'une méthodologique et l'autre technique :

- les tarifs exacts doivent être revérifiés au moment de l'arbitrage, ils bougent;
- **aucune borne de jetons n'est posée aujourd'hui** (`openai-client.ts` ne
  définit pas de `max_tokens`). Le coût par appel est donc théoriquement non
  borné. C'est un risque d'exploitation avant d'être un risque de marge, et il
  se corrige par une borne, pas par un prix.

Le vrai coût marginal est ailleurs : **l'export PDF passe par Puppeteer**, donc
par un Chromium par rendu. C'est de la mémoire et du CPU, et cela se dimensionne
en serveurs, pas en jetons. Un plan qui promet des exports illimités engage plus
que celui qui promet de l'IA illimitée.

### 2. Quatre packs sont un pack de trop, mais l'écart 9 → 49 est trop large

Les quatre packs du tableau ci-dessus supposent une force de vente pour porter
l'*Enterprise*. En l'absence de contrat cadre, de SSO et de multi-entités livrés,
*Enterprise* n'est pas une offre : c'est une ligne « nous contacter ».

À l'inverse, l'écart entre Pro (9) et Business (49) est un facteur **5,4** pour
un saut fonctionnel qui, aujourd'hui, se résume à *white-label + 20 sièges +
API*. Un cabinet de trois personnes n'a pas besoin de 20 sièges et ne paiera pas
49 USD ; il restera sur un Pro mono-siège, ce qui est exactement la fuite de
revenu que produit un palier manquant.

**Proposition : trois offres payantes plutôt que deux, et un « nous contacter »
qui n'est pas un pack.**

- garder Free et Pro tels quels;
- insérer un palier **Équipe** entre les deux, autour de **19–25 USD/mois**, avec
  **3 à 5 sièges** et l'export sans filigrane — c'est le besoin du cabinet et de
  l'incubateur de quartier, qui est la clientèle réelle en RDC;
- garder Business à 49 USD en le recentrant sur ce qui le justifie
  (white-label, API, 20 sièges, support prioritaire);
- traiter *Enterprise* comme un devis, hors grille.

### 3. Les quotas doivent exister avant d'être vendus

Ce document liste `ai.monthly_quota`, `scenarios.max`, `members.max`. **Aucun
n'est appliqué** : `Entitlements` ne porte que `maxProjects`, `pdfWatermark` et
`seats` (non contrôlé). Vendre un « quota IA supérieur » sans compteur, c'est
vendre une différence que rien ne matérialise — et c'est aussi ce qui empêche de
défendre un palier intermédiaire, qui a besoin d'un axe mesurable.

**Priorité recommandée avant tout changement de grille :** un compteur d'appels
IA par organisation et par mois, et l'application de `seats`. Sans eux, un
nouveau palier ne serait qu'une ligne de plus sur une page.

### 4. L'offre annuelle est sous-exploitée

L'annuel Pro à 90 USD représente **16 % d'économie** (et non 17 : la page arrondit
vers le bas, volontairement). C'est faible face au standard de 2 mois offerts
(≈ 17 %) et surtout face à ce que l'annuel apporte **en RDC** : il supprime onze
occasions d'échec de paiement là où le prélèvement récurrent est fragile et où le
mobile money ne se renouvelle pas tout seul.

**Proposition : pousser l'annuel plus franchement (2 mois offerts, soit 90 USD
maintenu mais présenté comme tel), et ouvrir un annuel Business** — son absence
oblige aujourd'hui le segment le plus solvable à repasser par un prélèvement
mensuel chaque mois.

### 5. La devise et la fiscalité restent les vrais bloquants

Facturer en USD est cohérent avec l'usage congolais, mais **un client qui paie en
mobile money paie en CDF**. La conversion aura lieu quelque part — chez
l'opérateur, ou chez nous. Tant qu'aucune politique de taux daté n'est arbitrée,
le circuit manuel expose l'écart de change à l'administrateur qui confirme le
dépôt, ce qui est un travail invisible et une source d'erreur.

De même, la fiscalité de la vente de service numérique n'est pas tranchée : tous
les montants produits par l'API sont explicitement hors taxes, et l'interface le
dit. **Ce point doit être arbitré avant le premier encaissement réel**, pas après.

### Ce qui est demandé au décideur

1. Trancher entre la grille à quatre packs de ce document et les trois offres de
   la page publique. Une seule doit survivre.
2. Se prononcer sur le palier intermédiaire (§ 2) et sur l'annuel Business (§ 4).
3. Valider ou corriger la période de grâce de 7 jours.
4. Arbitrer devise de règlement et fiscalité (§ 5).

## Validation commerciale requise

Étude de la volonté de payer par segment, coûts d’IA et d’exports, moyens de paiement locaux, devises de facturation, fiscalité de vente numérique, politique de remboursement et remise annuelle.
