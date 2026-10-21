# ADR-0032 — GROW, premier lot : santé de l'entreprise, indicateurs investisseurs, parcours

Statut : Proposed
Date : 2026-10-21
Décideurs : Gracy Omokoso (dirigeante) ; CTO Lalanda (contrat technique). Les seuils, les
pondérations et les règles d'étape ci-dessous sont des **propositions** : ils sont versionnés
pour pouvoir être changés sans rien casser, et soumis à la dirigeante (§ Décisions ouvertes).

> **Applique [ADR-0018](ADR-0018-trajectoire-erp-trois-modules.md)** (amendement du 18 oct.
> 2026 : « GROW fera l'objet d'un ADR dédié »). N'amende ni ADR-0012 (aucune action RBAC
> nouvelle), ni la grille de [docs/13](../13-PRICING.md) (aucun droit d'abonnement nouveau).
> S'aligne sur ADR-0031 (encaissements, en cours sur
> une autre branche) pour la règle du chiffre d'affaires des ventes.

## Contexte

ADR-0018 découpe Lalanda en trois ensembles : **BUILD** (concevoir : modèle économique, plan
financier), **RUN** (exploiter : ventes, facture normalisée, encaissements, dépenses) et
**GROW** (croître : pilotage, financement, croissance). Chacun fonctionne seul, et prend sa
valeur relié aux autres. BUILD et RUN existent ; GROW = 0 %.

Le brief stratégique (réflexion, pas cahier des charges — ADR-0001) décrit pour GROW un
*Business Health Score*, des indicateurs investisseurs (MRR, ARR, burn, runway, croissance,
CAC, LTV, churn, marge brute), un *Startup Journey* en huit étapes, puis des connecteurs
marketing, une data room, des pitch decks et une place de marché d'experts.

Quatre règles du dépôt encadrent tout ce lot :

| Règle | Source |
|---|---|
| Le moteur est l'unique source des calculs ; l'API et l'interface consomment ses résultats | CLAUDE.md, docs/21 |
| Ne jamais fabriquer un chiffre : une valeur impossible se dit, elle ne se comble pas par un `0` | docs/08 § Règle cardinale |
| Hypothèses, prévisions, réalisés et suggestions restent distincts et étiquetés | ADR-0018 (amendement) |
| Un diagnostic rend code stable, période, métriques et seuils, faits chiffrés, explication, recommandation, version de règle ; une recommandation cite ses métriques et ne promet pas un résultat | docs/10 |

### Ce que les données permettent aujourd'hui (vérifié le 21 oct. 2026, `origin/main` v0.9.4)

| Donnée | Où | Ce qu'elle porte | Limite |
|---|---|---|---|
| Réalisé BUILD | `actual_periods` | montants mensuels **par projet**, par ligne du compte d'exploitation (`ca`, `charges_operationnelles`, `excedent_brut`, `resultat_net`, et selon le modèle `marge_brute` ou `marge_matiere`), mois d'**exercice** 1 à 12 des exercices 1 à 5, statut `open`/`closed`, `closedAt` | pas de date civile ; aucune ligne de trésorerie (docs/08, convention 4) ; dans la devise du projet |
| Ventes RUN | `sales_invoices` | factures et avoirs finaux, `issuedAt`, devise, client, bases HT par groupe, `catalogItemId` par ligne, montants CDF normalisés | rien ne marque un article comme « récurrent » |
| Catalogue RUN | `catalog_items` | articles actifs | idem |
| Plans BUILD | `financial_plans` | plans validés | — |
| Encaissements, dépenses, trésorerie réelle | — | **n'existent pas encore** (ADR-0031, ADR-0034, autres branches) | — |
| Acquisition marketing (CAC, leads, ROAS) | — | **aucune source** | — |

Conséquence : **CAC, LTV, churn et ROAS ne sont pas calculables** dans ce lot, et le *burn
rate* ne peut être qu'une **approximation par le résultat** tant que la trésorerie réelle
n'existe pas. GROW le dit au lieu de le cacher.

## Options considérées

### O1 — Où se calculent score, indicateurs et étape suggérée

1. Dans l'API. Écarté (CLAUDE.md).
2. Par l'IA. Écarté : l'IA explique, elle ne produit pas les calculs (docs/11) ; le brief du
   matin (ADR-0033, autre lot) **consommera** ces résultats.
3. **Dans le moteur, module pur `packages/engine/src/grow/`**, sans horloge (la date du calcul
   est un paramètre), sans accès base. **Retenu.**

### O2 — Portée : organisation ou projet

1. Par projet (comme le réalisé). Écarté : les ventes RUN sont rattachées à l'**organisation**,
   et un investisseur juge l'entreprise, pas un dossier de plan.
2. **Par organisation, avec un « projet de référence »** dont le réalisé représente
   l'entreprise. Retenu. Le projet de référence est **choisi** par l'utilisateur ; à défaut,
   si l'organisation n'a **qu'un** projet, c'est lui (la source affichée le dit). Avec
   plusieurs projets et aucun choix, les indicateurs tirés du réalisé sont indisponibles
   (`PROJET_DE_REFERENCE_A_CHOISIR`) : GROW ne devine pas lequel est « l'entreprise ».

### O3 — Revenu récurrent (MRR/ARR)

1. Ajouter un drapeau « récurrent » au catalogue RUN. Écarté **dans ce lot** : GROW n'écrit
   pas dans RUN (§ 1). Proposé pour plus tard (décision ouverte n° 3).
2. Deviner la récurrence (même client, même montant chaque mois). Écarté : invention.
3. **L'utilisateur déclare, dans GROW, quels articles du catalogue sont des revenus
   récurrents** (abonnements, contrats mensuels). La déclaration vit dans la collection de
   GROW. Retenu. Sans déclaration, MRR et ARR sont **indisponibles et disent pourquoi**.

### O4 — Accès selon le forfait

1. Nouveau droit `growEnabled` dans `PLAN_CATALOG`. Écarté : ce serait fixer une règle
   commerciale (quelles offres ?) sans la dirigeante (docs/13, CLAUDE.md).
2. **Réutiliser `actualsEnabled`** (« Suivi du réalisé », Pro et au-delà) pour la santé et
   les indicateurs investisseurs : ils **sont** une lecture du réalisé et des ventes. Le
   **parcours** (étape, checklist) reste ouvert à toutes les offres : il ne calcule aucun
   indicateur financier. Retenu, à confirmer (décision ouverte n° 1).

### O5 — Permissions

1. Nouvelles actions `grow.read` / `grow.manage`. Écarté dans ce lot : la matrice d'ADR-0012
   est amendée en parallèle par trois autres lots ; une action de plus n'apporterait aucune
   règle que les actions existantes ne portent déjà.
2. **Actions existantes**, au plus près de leur sens (§ 6). Retenu.

## Décision

### 1. GROW lit ; il n'écrit jamais dans BUILD ni dans RUN

- GROW **lit** : `actual_periods`, `projects`, `financial_plans`, `sales_invoices`,
  `catalog_items` — en lecture seule (`find`, `countDocuments`, `exists`).
- GROW **n'écrit que** dans sa propre collection `grow_profiles` (une fiche par
  organisation) et dans le journal d'audit.
- Un test de surface (`apps/api/src/grow/grow-readonly.surface.test.ts`) lit les sources du
  module et échoue si une méthode d'écriture vise un modèle de BUILD ou de RUN.
- Aucune valeur de GROW n'alimente le plan, le réalisé, une facture ou un encaissement. Les
  **déclarations** faites dans GROW (projet de référence, étape, articles récurrents, solde de
  trésorerie déclaré, cases de checklist) sont des **hypothèses de l'utilisateur**, étiquetées
  comme telles partout où elles servent.

### 2. Sources et étiquettes

Chaque indicateur rend sa **source**, sa **période** et ses **hypothèses** :

| Source | Étiquette | Période |
|---|---|---|
| Réalisé BUILD clôturé du projet de référence | `build.actuals` | mois d'exercice (`E1-M03`…) ; **seuls les mois clôturés** comptent (docs/08 : « seule la clôture transforme une saisie en observation ferme ») |
| Ventes RUN | `run.sales` | mois civils **complets** de Kinshasa (UTC+1) antérieurs à la date du calcul |
| Solde de trésorerie déclaré dans GROW | `grow.declared_cash` | date déclarée |
| Encaissements, trésorerie réelle (à venir) | `run.receipts`, `run.treasury` | lot suivant (§ 9) |

**Chiffre d'affaires des ventes** : la règle d'ADR-0023 § S25e.13 reprise par ADR-0031 —
somme des **bases HT** des groupes qui forment un chiffre d'affaires (exclus H, I, J, L, N et
toute TVA), factures finales (`issued`, `normalized`) de la série réelle, `FV`/`EV` moins
avoirs `FA`/`EA`, par mois civil d'`issuedAt`. Les factures d'acompte `FT`/`ET` sont
**exclues et comptées** (ADR-0031, décision ouverte n° 1). **Aucun taux de change** : les
ventes sont lues dans une **devise de référence** — celle du projet de référence, à défaut
l'unique devise des ventes ; une facture normalisée offre aussi ses montants CDF. Un document
sans représentation dans la devise de référence est **exclu et compté** ; si la devise de
référence est indéterminée, les indicateurs de ventes sont indisponibles
(`DEVISE_DE_REFERENCE_INDETERMINEE`).

> Dette assumée : ADR-0031 prévoit `revenueAmountsFor` dans `packages/engine/src/receivables/`.
> Tant qu'il n'est pas fusionné, `grow/sales-revenue.ts` applique la même règle ; à la fusion,
> GROW consommera la fonction d'ADR-0031 et supprimera la sienne (une seule source).

### 3. Indicateurs investisseurs (`computeInvestorIndicators`)

Chaque indicateur est soit `disponible: true` (valeur, unité, devise, source, période,
méthode, hypothèses), soit `disponible: false` avec un **code de raison** et une phrase. Jamais
de `0` par défaut.

| Code | Calcul | Source | Indisponible si |
|---|---|---|---|
| `mrr` | Σ CA HT, sur le **dernier mois civil complet**, des factures dont **toutes** les lignes sont des articles déclarés récurrents | `run.sales` | aucun article déclaré (`REVENU_RECURRENT_NON_DECLARE`) ; facture du mois mêlant récurrent et non récurrent (`FACTURES_MIXTES`, la ventilation par ligne n'est pas calculée) ; devise |
| `arr` | `mrr × 12` (convention annoncée en hypothèse) | `run.sales` | `mrr` indisponible |
| `burn_rate` | `max(0, −moyenne(resultat_net))` sur les **3 derniers mois clôturés** portant la ligne | `build.actuals` | moins de 3 mois clôturés (`MOIS_CLOTURES_INSUFFISANTS`) ; pas de projet de référence |
| `runway` | `solde déclaré ÷ burn_rate`, en mois | `grow.declared_cash` + `build.actuals` | pas de solde (`TRESORERIE_NON_DECLAREE`) ; solde de plus de 90 jours (`SOLDE_PERIME`) ; devise du solde ≠ devise du projet ; burn nul (`PAS_DE_CONSOMMATION`, état favorable dit comme tel) |
| `croissance_ventes` | (Σ 3 derniers mois civils complets − Σ 3 précédents) ÷ Σ 3 précédents | `run.sales` | moins de 6 mois complets depuis la première vente (`HISTORIQUE_INSUFFISANT`) ; base ≤ 0 (`BASE_NULLE`) |
| `croissance_ca_realise` | même formule sur `ca`, 3 derniers mois clôturés contre les 3 précédents | `build.actuals` | moins de 6 mois clôturés portant `ca` ; base ≤ 0 |
| `marge_brute` | Σ ligne de marge ÷ Σ `ca`, 3 derniers mois clôturés | `build.actuals` | aucune ligne de marge brute dans le réalisé (`LIGNE_MARGE_ABSENTE`) ; base ≤ 0 |
| `concentration_clients` | part du 1ᵉʳ client et des 3 premiers dans le CA HT des 12 derniers mois civils complets | `run.sales` | aucun client identifié ; CA ≤ 0 ; moins de 3 mois d'historique |

Hypothèses toujours annoncées :

- **burn rate** — « approximation : le résultat net saisi au réalisé tient lieu de flux de
  trésorerie ; il ignore le BFR, les investissements et les emprunts. Il sera remplacé par les
  flux réels quand la trésorerie réelle existera (ADR-0034). »
- **lignes de marge** — seules `marge_brute` et `marge_matiere` (modèle restaurant : CA moins
  coût matière) sont reconnues ; table explicite et versionnée, **aucune équivalence devinée**
  (même règle que docs/08, convention 2). Le modèle « prestation de services » n'a pas de
  marge brute : l'indicateur y est indisponible, et c'est juste.
- **ventes sans client identifié** — exclues du classement, incluses dans le dénominateur de
  la concentration.
- **MRR** — « un article déclaré récurrent est facturé chaque mois ».

### 4. Business Health Score (`computeHealthScore`)

**Quatre axes couverts** par une donnée réelle : `finance`, `tresorerie`, `ventes`,
`fidelisation`. Les axes du brief sans source — marketing, opérations, RH — sont **listés
comme non couverts** et n'entrent pas dans la pondération.

Chaque métrique devient une note 0–100 par **interpolation linéaire entre des points
d'ancrage** (table `GROW_SCORING_V1`, versionnée) :

| Axe | Métrique | Points d'ancrage (valeur → note) |
|---|---|---|
| finance | marge nette = Σ `resultat_net` ÷ Σ `ca` (3 mois clôturés) | −20 % → 0 ; 0 % → 50 ; +15 % → 100 |
| tresorerie | runway (mois) ; burn nul → 100 | 0 → 0 ; 3 → 15 ; 6 → 40 ; 12 → 75 ; 18 → 100 |
| ventes | `croissance_ventes`, à défaut `croissance_ca_realise` | −30 % → 0 ; 0 % → 50 ; +30 % → 100 |
| fidelisation | part du CA des 6 derniers mois réalisée avec des clients déjà facturés les 6 mois précédents (12 mois d'historique) | 0 % → 0 ; 60 % → 100 |
| fidelisation | part du 1ᵉʳ client (12 mois) | 20 % → 100 ; 50 % → 40 ; 80 % → 0 |

Note d'axe = moyenne des notes disponibles de l'axe.

**Pondérations selon le stade** (table `GROW_WEIGHTS_V1`), le stade étant l'étape **retenue**
du parcours (déclarée, à défaut suggérée — § 5) :

| Groupe d'étapes | finance | tresorerie | ventes | fidelisation |
|---|---:|---:|---:|---:|
| Amorçage — IDEA, VALIDATION, MVP | 15 | 45 | 25 | 15 |
| Traction — FIRST_CUSTOMER, PMF | 20 | 35 | 25 | 20 |
| Croissance — GROWTH, SCALE, FUNDRAISING | 30 | 25 | 25 | 20 |

**Score global** = Σ poids × note ÷ Σ poids des axes **disponibles**, arrondi à l'entier.
Il est **indisponible** (`DONNEES_INSUFFISANTES`) si moins de 2 axes sont disponibles **ou**
si les axes disponibles couvrent moins de 60 % du poids total ; la réponse liste alors ce qui
manque. Les notes d'axe restent affichées.

**Trois risques prioritaires** (table `GROW_RISK_RULES_V1`), règles déterministes ; chaque
risque rend sa preuve : donnée, valeur, seuil, version de règle.

| Code | Condition | Gravité |
|---|---|---|
| `RUNWAY_CRITIQUE` | runway < 3 mois | critique |
| `RUNWAY_COURT` | 3 ≤ runway < 6 mois | haute |
| `PERTES` | marge nette < 0 (critique sous −20 %) | haute / critique |
| `VENTES_EN_BAISSE` | croissance < −10 % (haute sous −30 %) | moyenne / haute |
| `CONCENTRATION_CLIENT` | 1ᵉʳ client > 50 % (haute au-delà de 70 %) | moyenne / haute |
| `FIDELISATION_FAIBLE` | clients revenants < 20 % | moyenne |
| `REALISE_NON_A_JOUR` | dernière clôture (`closedAt`) il y a plus de 60 jours | faible |

Tri : gravité, puis ordre de la table. **Trois actions** : l'action associée à chaque risque
retenu, puis, s'il reste de la place, les actions de **complétion des données** des axes
indisponibles (déclarer le solde, clôturer des mois, choisir le projet de référence…).
Chaque action dit **pourquoi** (« donnée X = v, seuil Y, règle Z ») et nomme la variable
actionnable ; aucune ne promet un résultat (docs/10). **Aucun LLM** n'intervient.

### 5. Startup Journey (`suggestJourneyStage`)

Étapes : `IDEA → VALIDATION → MVP → FIRST_CUSTOMER → PMF → GROWTH → SCALE → FUNDRAISING`.

**Étape suggérée** = la plus avancée dont **toutes** les conditions sont remplies (table
`GROW_JOURNEY_RULES_V1`). Chaque condition est rendue `remplie`, `non remplie` ou `inconnue`
(donnée absente), avec sa valeur et son seuil :

| Étape | Conditions |
|---|---|
| IDEA | aucune (point de départ) |
| VALIDATION | au moins un plan financier validé |
| MVP | au moins un article actif au catalogue |
| FIRST_CUSTOMER | au moins une vente finale **ou** un mois clôturé avec `ca` > 0 |
| PMF | ≥ 10 clients distincts facturés sur 12 mois **et** clients revenants ≥ 30 % |
| GROWTH | conditions de PMF **et** `croissance_ventes` ≥ 20 % |
| SCALE | conditions de GROWTH **et** ≥ 50 clients distincts sur 12 mois **et** marge nette ≥ 0 |
| FUNDRAISING | **jamais suggérée** : c'est une intention, pas un fait mesurable ; seulement déclarée |

L'utilisateur peut **déclarer** son étape ; la déclaration l'emporte, et l'écart avec la
suggestion est montré, jamais corrigé. Chaque étape a une **checklist** versionnée : certains
points se cochent d'eux-mêmes depuis les données (plan validé, première facture, trois mois
clôturés…), les autres se cochent à la main et sont conservés dans `grow_profiles`.

### 6. API, permissions, forfait

| Méthode et chemin | Permission | Forfait |
|---|---|---|
| `GET /grow/profile` | `analytics.read` | toutes offres |
| `GET /grow/journey` | `analytics.read` | toutes offres |
| `GET /grow/health` | `analytics.read` | `actualsEnabled` |
| `GET /grow/indicators` | `analytics.read` | `actualsEnabled` |
| `PUT /grow/profile` (projet de référence, étape déclarée, articles récurrents) | `inputs.update` | toutes offres |
| `PUT /grow/checklist/:itemId` | `inputs.update` | toutes offres |
| `PUT /grow/declared-cash` · `DELETE /grow/declared-cash` | `actuals.import` | toutes offres |

- `analytics.read` : c'est l'action « consulter analyses et indicateurs » ; elle est détenue
  par tous les rôles d'organisation, Conseiller et Lecteur compris.
- **Données personnelles** : le Conseiller (externe) a `analytics.read` mais pas
  `sales.read`. La concentration clients lui est servie **sans noms** (« Client 1 : 42 % ») ;
  les noms ne sont rendus qu'à un appelant qui détient `sales.read` (ADR-0022 § S25c.1).
- Déclarer un solde de trésorerie est une **observation** financière : `actuals.import`
  (Propriétaire, Administrateur, Directeur financier, Comptable), comme la saisie du réalisé.
- Étape, projet de référence et articles récurrents sont des **hypothèses** : `inputs.update`.
- Forfait sans `actualsEnabled` → `403 PLAN_FEATURE_UNAVAILABLE` avec `feature: 'grow'`,
  l'offre courante, une phrase et `upgradeUrl`. L'interface l'explique, l'API l'impose (docs/13).
- Projet ou article d'une autre organisation → `404` (jamais `403`). Corps Zod `.strict()`.
- Chaque écriture est journalisée : `grow.profile.updated`, `grow.checklist.updated`,
  `grow.declared_cash.updated|cleared`.

### 7. Moteur

`packages/engine/src/grow/` (`GROW_VERSION = '1.0.0'`) : `salesRevenue`,
`computeInvestorIndicators`, `computeHealthScore`, `suggestJourneyStage`, tables versionnées
`GROW_SCORING_V1`, `GROW_WEIGHTS_V1`, `GROW_RISK_RULES_V1`, `GROW_JOURNEY_RULES_V1`,
`GROW_CHECKLISTS_V1`. Arithmétique des ventes exacte (chaînes décimales, entiers `bigint`) ;
les ratios et notes sont des nombres arrondis explicitement. Toute réponse porte
`growVersion` : changer un seuil, c'est publier une nouvelle version.

### 8. Interface

Espace **Croissance** (`/croissance`), entrée du menu du compte : onglets **Santé**,
**Indicateurs investisseurs**, **Parcours**. Construit avec les composants et jetons
existants (la refonte de la coquille est un autre lot). Chaque chiffre porte sa source, sa
période et ses hypothèses ; chaque indisponibilité dit pourquoi et quoi faire.

### 9. Hors périmètre — étapes suivantes

1. **Connecteurs marketing** (Meta Ads, Google Ads, TikTok Ads, Google Analytics, Search
   Console) : CAC, CPL, ROAS, revenus attribués, en distinguant **observé** et **attribution
   estimée** ; axe `marketing` du score. Exige ADR-0013 (secrets par organisation) et un
   ADR par connecteur.
2. **Encaissements et trésorerie réelle** (ADR-0031, ADR-0034) : remplacer l'approximation du
   burn par les flux réels (`run.receipts`, `run.treasury`) et le solde déclaré par le solde
   observé ; LTV et churn sur les encaissements récurrents.
3. **Data room** : pièces versionnées, accès invité tracé, expiration.
4. **Pitch deck et rapports investisseurs générés** depuis les données réelles, hypothèses
   signalées ; l'IA rédige, le moteur chiffre.
5. **Place de marché d'experts**, sans imposer de prestataire (refusée à ce stade par ADR-0018).
6. **Cap table, pipeline investisseurs** ; axes `operations` et `rh` du score quand ces
   données existeront.

## Conséquences

- Nouvelle collection `grow_profiles` ; aucune modification de schéma BUILD ou RUN.
- Le moteur gagne un module versionné à part (`GROW_VERSION`) : il ne touche aucun calcul de
  plan ni de facture (`ENGINE_VERSION`, `INVOICE_TOTALS_VERSION` inchangés).
- `actualsEnabled` devient, pour la première fois, un droit **appliqué** par l'API (il
  n'était jusqu'ici qu'annoncé sur la page tarifs).
- Le brief du matin (ADR-0033) pourra citer le score et ses trois risques **tels que calculés
  ici**, sans les recalculer.

## Plan de validation

Moteur : propriétés sur générateur déterministe (note bornée 0–100, monotonie de chaque
barème, score indisponible sous le seuil de couverture, invariance par permutation des
documents, avoir qui annule sa facture) et cas limites (aucune donnée, base nulle, un seul
mois, devise étrangère, acompte, série d'essai, facture mixte, solde périmé, burn nul). API :
e2e d'isolation, RBAC (Lecteur lit, ne déclare pas ; Conseiller sans noms), forfait
(`free` → 403 sur santé et indicateurs, parcours ouvert), lecture seule vérifiée. Web : modèle
des écrans. Essai de la dirigeante sur une organisation de test : trois mois clôturés, un
solde déclaré, quelques factures.

## Décisions ouvertes — pour la dirigeante

1. **Forfait** : santé et indicateurs réservés aux offres avec suivi du réalisé (Pro et
   au-delà), parcours ouvert à tous. Ou un droit GROW distinct dans la grille ?
2. **Seuils et pondérations** (§ 4, § 5) : propositions de l'équipe, non sourcées. À valider,
   idéalement avec un conseiller qui accompagne des startups en RDC.
3. **Drapeau « récurrent » au catalogue RUN** : à la place de la déclaration dans GROW ?
4. **Mois ouverts** : GROW ne lit que les mois **clôturés**. Faut-il montrer aussi une
   estimation sur les mois saisis non clôturés, étiquetée « provisoire » ?
5. **Fenêtres** : 3 mois pour les moyennes, 6 + 6 pour la fidélisation, 12 pour la
   concentration, 90 jours de validité d'un solde déclaré.
6. **Actions RBAC dédiées** `grow.read` / `grow.manage` quand GROW s'étoffera (data room,
   pipeline investisseurs) ?

## Liens

- [ADR-0001](ADR-0001-autorite-brief-vs-docs.md) ; [ADR-0012](ADR-0012-modele-rbac-complet.md) ;
  [ADR-0018](ADR-0018-trajectoire-erp-trois-modules.md) ; [ADR-0022](ADR-0022-clients-catalogue-et-calcul-des-factures.md) ;
  [ADR-0023](ADR-0023-factures-et-avoirs.md) § S25e.13 ; ADR-0031 (encaissements, autre branche).
- [docs/08](../08-PREVISIONNEL-REALISE.md) ; [docs/10](../10-DIAGNOSTICS.md) ;
  [docs/11](../11-ANALYTICS-IA.md) ; [docs/13](../13-PRICING.md) ; [docs/21](../21-MOTEUR-FINANCIER.md).
- Code : `packages/engine/src/grow/`, `apps/api/src/grow/`, `apps/web/src/app/(app)/croissance/`.
