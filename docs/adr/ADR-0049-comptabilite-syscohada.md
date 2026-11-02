# ADR-0049 — Comptabilité SYSCOHADA (projet à valider) : plan comptable sourcé et versionné, écritures générées depuis le RUN, journaux, grand livre, balance, lettrage, états présentés comme projets, clôtures et exports pour l'expert-comptable

Statut : Proposed
Date : 2026-11-01
Décideurs : Gracy Omokoso (dirigeante) — **principe décidé** : « La comptabilité, c'est le plus
important » ; modèle de maîtrise du risque retenu par elle (plan comptable sourcé, daté et versionné ;
écritures générées depuis le RUN et reliées à leur pièce ; états présentés comme projets à valider par
un expert-comptable, avec un export propre pour lui ; Lalanda ne dépose rien et n'affirme jamais une
conformité) ; CTO Lalanda (contrat technique). Le cadrage est **proposé** : chaque choix qui appartient
à la dirigeante porte une valeur par défaut, la plus prudente, appliquée tant qu'elle ne tranche pas
autrement (§ Décisions ouvertes). **Aucune règle comptable ni fiscale n'est posée par cet ADR** : chaque
correspondance de compte, chaque traitement de TVA, de change ou d'amortissement est une **question pour
l'expert-comptable** (§ Questions pour l'expert-comptable) et reste inactif tant qu'il n'a pas répondu.

> **Précise [ADR-0018](ADR-0018-trajectoire-erp-trois-modules.md)** sans le contredire : ADR-0018
> refuse une « comptabilité générale **certifiée** » et une « vérité comptable parallèle au moteur ».
> Cet ADR propose une comptabilité **non certifiée**, dont les états sont toujours des **projets**, et
> dont les calculs vivent **dans le moteur** (`packages/engine/src/accounting`) : ce n'est pas une
> seconde source de vérité de calcul, c'est une **lecture** des pièces du RUN.
> **Lève le refus d'[ADR-0046](ADR-0046-stocks-equipements-documents.md) § Hors périmètre**
> (« Comptabilité générale : écritures de stock, journaux, plan OHADA ») pour les journaux et le plan
> comptable ; les écritures de stock restent **optionnelles et éteintes** (§ 6.7).
> **Amende [ADR-0012](ADR-0012-modele-rbac-complet.md) et docs/12** : cinq actions nouvelles
> (`accounting.read`, `accounting.post`, `accounting.close`, `accounting.export`,
> `accounting.manage`) et **un rôle nouveau externe, Expert-comptable** (`external_accountant`,
> § 8.2). **Étend [ADR-0041](ADR-0041-autorisations-par-membre.md)** : treizième domaine
> « Comptabilité », dépendances, deux actions à séparation dynamique (`APPROVAL_ACTIONS`).
> **Lit, sans jamais les écrire**, les factures et avoirs figés d'[ADR-0023](ADR-0023-factures-et-avoirs.md)
> et d'[ADR-0024](ADR-0024-normalisation-dgi.md), les encaissements d'[ADR-0031](ADR-0031-encaissements-et-realise.md),
> les dépenses, comptes et mouvements d'[ADR-0034](ADR-0034-depenses-et-tresorerie.md), les factures et
> paiements fournisseurs d'[ADR-0044](ADR-0044-achats-et-fournisseurs.md), les mouvements de stock
> d'[ADR-0046](ADR-0046-stocks-equipements-documents.md) : **aucune ligne** de `sales/`, `treasury/`,
> `purchases/`, `stock/`, `assets/`, `hr/` ni du circuit DGI ne change. **N'écrit jamais** dans
> `actual_periods` ni dans un plan (règle centrale de docs/08, § 7).

## Contexte

Depuis R1 à R5, Lalanda enregistre ce qu'une PME **vend** (factures normalisées DGI, avoirs),
**encaisse**, **dépense**, **achète et paie**, **stocke**, et **qui** y travaille. Ces pièces existent,
datées, figées, avec leurs montants, leur devise et leur tiers. Pourtant l'entrepreneur paie encore un
cabinet pour **ressaisir** ces mêmes pièces dans un logiciel comptable, ou tient un tableur que son
expert-comptable reprend chaque trimestre. Le brief stratégique (§ 5.4, réflexion de la dirigeante, hors
dépôt) demande : plan comptable configurable, journaux, écritures, grand livre, balance, bilan, compte de
résultat, flux de trésorerie, clôtures et exports, en étudiant OHADA/SYSCOHADA et les paramètres fiscaux
nationaux, **sans promettre de conformité sans vérification spécialisée**.

Quatre manques :

1. **Pas d'écriture.** Une facture émise n'est inscrite dans aucun journal ; aucun compte client ne
   reçoit son débit ; la TVA collectée n'existe nulle part ailleurs que sur la facture.
2. **Pas de balance.** Personne ne sait, à une date, ce que doit chaque client, ce que l'on doit à chaque
   fournisseur, ce que vaut la TVA à reverser, si les comptes de trésorerie concordent avec les pièces.
3. **Pas de clôture.** Un mois « fini » peut encore être modifié par l'annulation d'une dépense datée du
   mois ; rien ne fige ce qui a été remis à l'expert.
4. **Pas d'export comptable.** L'export du journal électronique des ventes (ADR-0026 § 6.3) sert aux
   vérificateurs DGI ; il ne contient ni compte, ni contrepartie, ni les autres pièces.

### Faits du dépôt qui commandent les décisions

| Fait | Où | Conséquence |
|---|---|---|
| « Pas de comptabilité générale certifiée. Un module OHADA qui produirait une liasse fausse engagerait la responsabilité de l'éditeur. » ; « RUN alimente le réalisé, jamais le plan figé » ; « une vérité comptable parallèle au moteur est interdite » | ADR-0018 § Règles transverses | états **toujours projets**, jamais « certifiés », jamais déposés ; calcul dans `packages/engine` ; aucune écriture dans le réalisé ni le plan |
| L'éditeur est **Go freelance SARLU**, société de droit congolais | ADR-0043 | c'est elle qui serait mise en cause par un état faux ; le risque est décrit au § Risques juridiques |
| Charte : marché RDC, « normes **SYSCOHADA révisé** », double devise USD/CDF ; brief : « mode comptable (accès direct au plan comptable SYSCOHADA) » ; table `actualEntries` du brief avec `compteSyscohada`, `sens` | `docs/00-CHARTE-PRODUIT.md`, `sources/brief/lalanda-brief.md` (lignes 40, 261, 336–340, 362) | l'ambition est fondatrice ; le brief **ne fixe aucun numéro de compte** |
| Les packs pays déclarent `systeme_comptable: syscohada-revise-2017` (RDC, CI, SN, OHADA générique) ; aucun numéro de compte n'existe dans le dépôt | `packages/engine/src/parameter-packs/*.yaml`, `schema.ts` | le plan comptable est un **pack nouveau**, à sourcer et faire relire ; rien n'est repris du dépôt faute de source |
| Le moteur emploie déjà des notions SYSCOHADA pour le **plan financier** : feuille `amortissements` (durées « indicatives », AUDCIF 2017, Titre I chap. 3), feuille `etats-financiers` (bilan prévisionnel, CAF « définition SYSCOHADA simplifiée », conventions « à revalider par un expert-comptable ») | `docs/09` § Amortissements, `docs/21` §§ amortissements et états, `packages/engine/src/amortissements/`, `packages/engine/src/etats-financiers/index.ts` | ce sont des **projections** ; elles ne sont **pas** reprises pour la comptabilité du réalisé (§ 6.8) |
| Règle de version : `draft → review → approved → active → retired`, version active immuable, source officielle ou validation professionnelle documentée, « un pack incomplet ne peut pas être publié comme complet » | `docs/09` § Modèle de version, § Sources, § Critères | le pack de plan comptable suit **exactement** ce cycle (§ 2.1) |
| Factures figées : `status` (`issued`, `normalized`… ), `type` (`FV FT FA EV ET EA`), `series` (série réelle ou d'essai), `currency` `CDF`/`USD`, `documentAmounts.calculation` (totaux par groupe A à P), `conversion` vers CDF (taux, date, source, référence BCC) pour une facture USD, `payments` déclarés à l'émission (part `CREDIT` = non réglée) | `sales/invoices/invoice.schema.ts`, `invoice.types.ts`, ADR-0022 à ADR-0024 | lecture **après émission**, comme le stock (ADR-0046 O3) ; une facture d'essai n'a aucune valeur (ADR-0031 § 1) ; le taux de la pièce existe pour les factures USD |
| Seize groupes de taxation A à P (sans taux dans le code) ; le pont des ventes exclut **H, I, J, L, N** du chiffre d'affaires | `engine/src/invoice-totals/tax-groups.ts`, ADR-0022, ADR-0031 § 3 | la correspondance se fait **par groupe** ; les groupes H, I, J, L, N ne vont **jamais** d'office à un compte de produit (§ 6.1) |
| Encaissements : lettrés à 1–20 factures finales, **même devise** (`RECEIPT_CURRENCY_MISMATCH`), aucun encaissement non lettré, `accountId` facultatif, annulation motivée | ADR-0031 § 1, `sales/receipts/receipt.schema.ts` | contrepartie de trésorerie parfois inconnue → compte d'attente (§ 6.2) |
| Les paiements **déclarés à l'émission** d'une facture (espèces, mobile money…) ne créent **aucun** encaissement ni mouvement de trésorerie : la trésorerie ne voit que les encaissements | `sales/receipts/treasury-feed.service.ts`, ADR-0031 § 2 | la comptabilité doit les traiter ; faute de compte de trésorerie, ils vont en attente — **écart révélé** avec la trésorerie (§ 6.1, décision ouverte n° 9) |
| Dépenses : quatorze catégories (nature exploitation, investissement, financement — « ce n'est PAS une qualification comptable certifiée »), `deductibleVat` **déclarée, jamais calculée**, `accountId` facultatif, `origin` non nulle quand un paiement fournisseur l'a créée | `engine/src/treasury/types.ts`, `treasury/treasury.schemas.ts`, ADR-0034, ADR-0044 § 2.6 | une dépense créée par un paiement fournisseur n'est **pas** recomptée (§ 6.3) ; la TVA déclarée n'est pas récupérée d'office |
| Virements : même devise, montants égaux ; entre devises, **les deux montants constatés** sont saisis, « ni taux ni écart de change » ; `other_in`, `other_out` sans nature | ADR-0034 § 4, `TreasuryMovementKind` | le taux d'un virement entre devises est **observé** (rapport des deux montants), jamais supposé (§ 5) ; les autres mouvements vont en attente |
| Factures fournisseurs `validated`, avoirs fournisseurs (`credit_note`), `costAllocations` dont la somme = **total** (TTC), `taxes` déclarées (libellé, montant), `deductibleVat` déclarée ; paiements `PF…` lettrés aux factures, qui créent les dépenses | ADR-0044 §§ 2.5–2.6, `supplier-invoice.schema.ts`, `supplier-payment.schema.ts` | le fournisseur devient un compte auxiliaire ; la charge est imputée par catégorie ; la TVA n'est séparée que sur règle validée (§ 6.4) |
| Salaires : **aucune paie** ; la catégorie de dépense `personnel` « Salaires et charges sociales » existe | ADR-0045 § Faits | une seule écriture par dépense `personnel`, sans ventilation brut, retenues, cotisations (§ 6.3, hors périmètre) |
| Stock : grand livre en ajout seul, coût moyen pondéré **de gestion** par devise, « son usage pour un inventaire comptable est à confirmer par l'expert-comptable » ; amortissement des équipements : **estimation de gestion**, « jamais dans un export comptable » | ADR-0046 O2, O7, § 9 | écritures de stock : option éteinte ; amortissements : **hors périmètre** tant que l'expert n'a pas validé une méthode (§ 6.7, § 6.8) |
| Journal électronique des ventes : ajout seul, numéroté sans trou, **chaîné par empreinte** (`prevHash`, `hash`), export CSV avec l'algorithme recopié | ADR-0023 § S25e.12, `sales/invoices/journal-export.ts`, ADR-0026 § 6.3 | même technique pour l'intangibilité des écritures validées (§ 2.6) ; ce n'est pas une affirmation de conformité |
| Réalisé : périodes `open ↔ closed`, réouverture par le seul Propriétaire, motif, journal ; « ne jamais fabriquer un chiffre » ; ponts RUN → réalisé idempotents, étiquetés `sources[ligne]` | `docs/08` §§ Implémenté, Règle cardinale | même vocabulaire de clôture ; la comptabilité **n'écrit pas** le réalisé et rend ses écarts avec lui **visibles** (§ 7) |
| Matrice **11 rôles × 46 actions** (+ 6 plateforme) = 782 cases ; `APPROVAL_ACTIONS` = `plan.approve`, `purchase.approve`, `leave.approve`, `stock.manage` ; `period.close` ⚙ pour le Comptable ; `PLATFORM_FORBIDDEN_ACTIONS` contient `period.close`, `report.export` ; `OWNER_ONLY_ROLES` = `hr_manager` ; douze domaines | `apps/api/src/authz/permissions.ts`, docs/12 | cinq actions et un rôle s'y déclarent une fois ; matrice **12 × 51 + 6 × 51 = 918** cases (§ 8) |
| Écarts par membre (ADR-0041) derrière `MEMBER_PERMISSIONS_ENABLED`, **éteint** | `organizations/member-permissions.ts` | sans rôle dédié, un expert-comptable externe ne peut aujourd'hui lire que s'il reçoit un rôle interne qui écrit (O7) |
| Ordonnanceur en base, « au moins une fois », gestionnaires idempotents | ADR-0020, `scheduler/scheduler.service.ts` | synchronisation par tâches idempotentes, clés de source uniques (§ 6) |
| Exports CSV : `;`, UTF-8 avec BOM, formules neutralisées, audit strict | docs/16 (CRM, devis) | même convention (§ 9) |

## Risques juridiques, en clair

Ce paragraphe dit ce qui pourrait engager l'éditeur, **sans poser de règle de droit**. Ce qui n'est pas
sourcé ici est une question ouverte pour l'expert-comptable ou le juriste.

1. **Un état faux présenté comme vrai.** Si Lalanda affiche un bilan ou un compte de résultat sans
   réserve, un dirigeant peut le remettre à sa banque, à un investisseur ou à l'administration. S'il est
   faux (mauvais compte, TVA mal traitée, change oublié), l'utilisateur pourra soutenir qu'il s'est fié au
   logiciel. **Maîtrise** : aucun état n'est jamais présenté autrement que comme **projet** ; le bandeau
   est imprimé sur chaque page, chaque export, chaque réponse d'API (`status: "draft_unverified"`) ;
   aucun libellé ne dit « conforme », « certifié », « définitif », « liasse » ni « déclaration ».
2. **Une règle comptable inventée.** Un numéro de compte, un traitement de TVA ou d'écart de change
   choisi par le logiciel sans source est une règle posée par l'éditeur. **Maîtrise** : le plan
   comptable est un **pack** sourcé, daté, versionné, au statut `draft` tant qu'un expert-comptable
   mandaté par l'éditeur ne l'a pas relu (§ 2.1) ; chaque compte porte sa source **ou** la mention « à
   confirmer par l'expert-comptable » ; les règles de correspondance de chaque organisation sont
   **validées par elle** (§ 2.4) ; ce qui n'a pas de règle va dans un **compte d'attente** visible, jamais
   dans un compte deviné.
3. **Une comptabilité tenue « par » l'éditeur.** Si Lalanda déposait, signait, transmettait ou
   « validait » des états, l'éditeur pourrait être regardé comme exerçant une activité réservée aux
   professionnels de la comptabilité. Le dépôt ne précise pas ce régime en RDC : **question au juriste**
   (§ Questions, J1). **Maîtrise** : Lalanda **ne dépose rien**, n'envoie rien à une administration, ne
   signe rien ; la tenue reste celle de l'organisation cliente ; l'expert-comptable de l'organisation
   reste seul juge (§ 10).
4. **Une régularité des livres non démontrée.** Le droit OHADA impose des livres et des règles de tenue
   (journal, grand livre, balance, intangibilité, numérotation, conservation) dont le détail n'est **pas**
   sourcé dans le dépôt. **Maîtrise** : les écritures validées sont en ajout seul, numérotées sans trou par
   journal et par exercice, chaînées par empreinte, jamais supprimées (contre-passation à la place) ; mais
   Lalanda **n'affirme pas** que ces garanties suffisent : question à l'expert (§ Questions, E5).
5. **Une monnaie de tenue erronée.** Les opérations sont en CDF et en USD, sans conversion implicite
   aujourd'hui. La monnaie dans laquelle la comptabilité doit être tenue en RDC n'est pas sourcée dans le
   dépôt. **Maîtrise** : aucune valeur par défaut ; le choix est **exigé** à l'activation, avec l'avis de
   l'expert (§ 5, décision ouverte n° 4).
6. **Une donnée sensible exposée.** La comptabilité agrège tout : salaires payés (catégorie `personnel`),
   fournisseurs, marges. Ouvrir ces livres à un tiers externe est un traitement de données du client.
   **Maîtrise** : rôle Expert-comptable attribuable par le **seul Propriétaire** (`OWNER_ONLY_ROLES`),
   lecture et export seulement, exports journalisés (§ 8). La qualification juridique s'ajoute à la
   question 9 de docs/28 § 1.3.
7. **Une contradiction avec le réalisé.** Deux chiffres différents pour « le chiffre d'affaires de mars »
   (réalisé et comptabilité) feraient douter des deux. **Maîtrise** : mêmes pièces, même jour civil de
   Kinshasa, rapprochement **affiché** et expliqué, jamais corrigé en silence (§ 7).

## Options considérées

### O1 — Faut-il une comptabilité dans Lalanda ?

1. **Non : exporter les pièces vers un logiciel comptable tiers** (position d'ADR-0018). Écarté par la
   dirigeante : l'entrepreneur ressaisit ou paie la ressaisie ; aucun logiciel tiers ne relie l'écriture à
   la facture normalisée, au plan financier et au réalisé ; c'est la promesse de « ne plus utiliser
   d'autres outils ».
2. **Une comptabilité « certifiée conforme »**, états définitifs prêts au dépôt. Écarté : impossible à
   garantir sans vérification spécialisée, et c'est exactement le risque d'ADR-0018 et d'ADR-0043.
3. **Une comptabilité générée, sourcée, dont les états sont des projets à valider par un
   expert-comptable**, avec un export propre pour lui. **Retenu** (modèle de la dirigeante).

### O2 — Saisie manuelle des écritures, ou génération depuis le RUN ?

1. **Saisie libre** de toutes les écritures (logiciel comptable classique). Écarté : double saisie, et une
   vérité parallèle aux pièces du RUN (ADR-0018).
2. **Génération automatique depuis les pièces du RUN**, chaque écriture reliée à sa pièce, plus des
   **opérations diverses** saisies à la main et validées. **Retenu**.

### O3 — Comment générer : crochet dans les modules sources, ou lecture après coup ?

1. **Crochets** dans le gel des factures, l'enregistrement des encaissements, dépenses, paiements.
   Écarté : nouveaux écrivains dans le circuit DGI et dans quatre modules ; une panne de la comptabilité
   bloquerait une émission ou un paiement (motif d'ADR-0046 O3).
2. **Lecture après coup** : tâches `accounting.sync` (toutes les 5 minutes, et à la demande) qui lisent les
   pièces depuis leur dernier point et créent les écritures, **idempotentes** par clé de source. Aucune
   ligne des modules sources ne change. **Retenu**. Le prix : quelques minutes de retard.

### O4 — Plan comptable : saisi par chaque organisation, ou pack commun ?

1. **Chaque organisation saisit son plan.** Écarté : la cible n'a pas de compétence comptable (charte) ;
   chaque erreur serait propre à chaque client, donc invisible.
2. **Pack commun versionné, relu par un expert-comptable mandaté par l'éditeur, personnalisable par
   organisation** (sous-comptes, comptes auxiliaires, libellés). **Retenu**, suivant docs/09.

### O5 — Correspondance opération → comptes : codée, ou règles configurables ?

1. **Codée dans le moteur.** Écarté : chaque correction serait un déploiement, et la règle serait posée
   par l'éditeur.
2. **Règles de correspondance en données**, versionnées : un jeu **proposé** par le pack (chaque règle
   « à confirmer »), recopié dans l'organisation, modifiable, **validé** par elle avant usage. Chaque
   écriture retient la version de règles qui l'a produite. **Retenu**.

### O6 — Devises

1. **Convertir au taux du jour** (BCC ou autre) d'office. Écarté : conversion implicite, taux non sourcé,
   interdite par ADR-0031 et ADR-0034.
2. **Une comptabilité par devise**, sans jamais convertir. Écarté comme seule réponse : un bilan doit
   probablement être exprimé dans une seule monnaie (question E3) ; deux bilans juxtaposés ne
   s'additionnent pas.
3. **Monnaie de tenue choisie par l'organisation ; chaque ligne garde le montant et la devise de la pièce
   et porte un montant en monnaie de tenue avec un taux explicite** : même devise (taux 1), taux **de la
   pièce** (conversion figée d'une facture USD), taux **observé** (deux montants d'un virement entre
   devises), taux **saisi** par un humain (table datée, source déclarée). Sans taux, l'écriture attend
   (`awaiting_rate`) et n'entre pas dans la balance. **Retenu**.

### O7 — L'expert-comptable externe : rôle dédié ou rôle existant ?

1. **Conseiller** (`advisor`) avec ajouts. Écarté : les ajouts par membre sont éteints, et le Conseiller
   (banquier, mentor) ne doit pas voir les livres.
2. **Comptable** (`accountant`). Écarté : il écrit (ventes, trésorerie, achats) ; un tiers externe n'a pas à
   émettre une facture ni à payer un fournisseur.
3. **Rôle `external_accountant`** : lecture et export de la comptabilité seulement, attribuable par le seul
   Propriétaire. **Retenu** (décision ouverte n° 2).

### O8 — Où vivent les contrats et les calculs

Comme ADR-0044 O7 et ADR-0046 O8 : contrats zod dans **`packages/shared/src/accounting/`** (entrée
`@lalanda/shared/accounting`) ; calculs dans un module **pur** `packages/engine/src/accounting/`
(`ACCOUNTING_VERSION = '1.0.0'`), sans horloge, sans base, entiers `bigint` (centimes), chaînes décimales
en entrée et en sortie, **aucune conversion de devise sans taux fourni en entrée**. Le pack de plan
comptable est une **donnée** (YAML versionné) lue par le moteur, comme les packs pays.

## Décision

### 1. Vocabulaire

| Terme | Sens dans Lalanda |
|---|---|
| **Pack de plan comptable** | liste versionnée des classes et comptes, des modèles d'états et des règles proposées, avec sources ; propriété de la plateforme |
| **Plan de l'organisation** | comptes du pack actif + sous-comptes et comptes auxiliaires créés par l'organisation |
| **Compte auxiliaire** | compte individuel d'un client (fiche `customers`) ou d'un fournisseur (fiche `suppliers`), rattaché à un compte collectif |
| **Règle de correspondance** | « telle opération → tels comptes au débit et au crédit » ; jeu versionné, validé par l'organisation |
| **Écriture** | ensemble équilibré de lignes (compte, débit ou crédit) daté, dans un journal, reliée à **une** pièce source |
| **Pièce source** | document du RUN (facture, avoir, encaissement, dépense, facture ou paiement fournisseur, virement, mouvement de stock) ou pièce jointe d'une opération diverse |
| **Contre-passation** | écriture inverse qui annule une écriture validée ; on ne supprime jamais |
| **Compte d'attente** | compte où va ce qu'aucune règle validée ne sait classer ; un état n'est pas « complet » tant qu'il n'est pas soldé |
| **Monnaie de tenue** | monnaie unique des montants de la balance et des états, choisie par l'organisation |
| **Bascule** | date à partir de laquelle les pièces du RUN sont comptabilisées ; avant elle, des à-nouveaux de reprise |
| **Projet d'état** | bilan, compte de résultat ou tableau des flux calculé par Lalanda ; **jamais** un état définitif |

### 2. Modèle de données

Toutes les collections portent `organizationId` (isolation stricte, 404 hors organisation), `createdBy`,
`updatedBy`, `revision`, `_schemaVersion`, sauf mention contraire. Préfixe `accounting_`.

#### 2.1 `accounting_chart_packs` (plateforme)

Pack de plan comptable, **sans** `organizationId`. Cycle de docs/09 : `draft → review → approved → active
→ retired`. Une version `active` est immuable ; une correction crée une version nouvelle.

| Champ | Règle |
|---|---|
| `slug`, `version` | ex. `syscohada-revise-2017-cd`, `1` ; unique `slug + version` |
| `framework` | `syscohada-revise-2017` (même énumération que `systeme_comptable` des packs pays) |
| `countries` | `['CD']` d'abord ; `ohada-generic` ensuite |
| `status` | `draft`, `review`, `approved`, `active`, `retired` |
| `sources[]` | `{ id, issuer, title, reference, publishedOn, effectiveFrom, url \| null, verifiedOn, verifiedBy }` (docs/09 § Sources) |
| `classes[]` | `{ number, label, sourceId \| null, confirmation: 'sourced' \| 'to_confirm' }` |
| `accounts[]` | `{ number, label, classNumber, parent \| null, nature: 'asset' \| 'liability' \| 'equity' \| 'expense' \| 'income' \| 'off_balance' \| 'mixed', collective: boolean, auxiliaryKind: 'customer' \| 'supplier' \| null, sourceId \| null, confirmation }` |
| `statementTemplates` | bilan, compte de résultat, tableau des flux : rubriques → plages de comptes, **chaque rubrique `to_confirm`** tant que non relue |
| `proposedRules` | jeu de règles proposé (§ 2.4), chaque règle `to_confirm` |
| `review` | `{ reviewerName, reviewerCapacity, reviewedOn, scope, reportDocumentKey }` — expert-comptable **mandaté par l'éditeur** ; exigé pour passer à `approved` |
| `warnings[]` | avertissements affichés partout où le pack est utilisé |

**Règles du pack**, verrouillées par des tests :

- un pack ne passe à `approved` que si **aucun** compte, classe, rubrique ou règle n'est `to_confirm`, que
  `review` est renseigné et que les **cas de référence** (§ Plan de validation) passent ;
- un compte `sourced` exige `sourceId` ;
- **aucun numéro n'est créé par le code** : le YAML est la seule origine, relu ligne à ligne ;
- seul `platform_country_pack_manager` (rôle plateforme existant) édite un pack `draft` ; la publication
  suit la double validation de docs/09 § Administration.

**Contenu proposé de la version 1 (`draft`)** — voir § 2.1.1.

##### 2.1.1 Ce qui est sourcé, ce qui reste à confirmer

**Texte de référence** : *Acte uniforme relatif au droit comptable et à l'information financière*
(AUDCIF), adopté par le Conseil des ministres de l'OHADA le **26 janvier 2017**, et le *Système comptable
OHADA* (SYSCOHADA révisé) qui lui est annexé, comprenant le **Plan comptable général OHADA** et le guide
d'application. Le dépôt le cite déjà pour les durées d'amortissement indicatives (docs/09). La RDC est
membre de l'OHADA. **Référence de publication au Journal officiel de l'OHADA, dates d'entrée en vigueur et
texte intégral : à joindre au pack** (`sources[]`) par l'expert ou l'équipe produit ; **aucun numéro de
compte n'a été vérifié sur le texte officiel lors de la rédaction de cet ADR**.

**Structure en neuf classes** (connue du référentiel ; **libellés exacts à vérifier mot pour mot sur le
texte**, statut `to_confirm` jusqu'à vérification) :

| Classe | Libellé usuel (à vérifier) |
|---|---|
| 1 | Comptes de ressources durables |
| 2 | Comptes d'actif immobilisé |
| 3 | Comptes de stocks |
| 4 | Comptes de tiers |
| 5 | Comptes de trésorerie |
| 6 | Comptes de charges des activités ordinaires |
| 7 | Comptes de produits des activités ordinaires |
| 8 | Comptes des autres charges et des autres produits |
| 9 | Comptes des engagements hors bilan et de comptabilité analytique de gestion |

**Comptes candidats** dont le moteur a besoin pour les règles du § 6. Ce sont des **candidats d'usage
courant**, pas des règles : **tous** portent `confirmation: to_confirm` et la mention « à confirmer par
l'expert-comptable » dans le pack, à l'écran et dans l'export, jusqu'à la relecture. L'expert peut en
remplacer chacun.

| Besoin | Candidat (à confirmer par l'expert-comptable) |
|---|---|
| Clients (collectif) | 411 |
| Fournisseurs (collectif) | 401 |
| TVA facturée sur ventes (collectée) | 4431 |
| TVA récupérable sur achats | 4452 (et subdivisions par nature : à confirmer) |
| Banques | 521 |
| Caisse | 571 |
| Monnaie électronique (mobile money) | sous-compte de la classe 5 dédié à la monnaie électronique — **numéro à fournir par l'expert** |
| Virements internes de fonds | 585 |
| Comptes d'attente | compte de la classe 47 — **numéro à fournir par l'expert** |
| Achats de marchandises | 601 |
| Autres achats, services extérieurs, impôts et taxes, charges de personnel, frais financiers | comptes des classes 60 à 67 — **un par catégorie de dépense, à fournir par l'expert** (§ 6.3) |
| Ventes de marchandises | 701 |
| Services vendus | 706 |
| Impôt sur le résultat | compte de la classe 89 — **numéro à fournir par l'expert** |
| Immobilisations corporelles (dépenses `investissement`) | comptes de la classe 2 — **à fournir par l'expert** selon la nature |
| Emprunts (dépenses `remboursement_emprunt`) | compte de la classe 16 — **à fournir par l'expert** |
| Résultat de l'exercice, report à nouveau (à-nouveaux) | comptes de la classe 1 — **à fournir par l'expert** |
| Pertes et gains de change | **à fournir par l'expert** (décision ouverte n° 12) |

Le pack v1 est donc livré au statut **`draft`** : il permet le **mode simulation** (§ 3.1), jamais une
comptabilité persistée. Il passe à `review` quand l'expert reçoit le dossier (§ Questions), à `approved`
quand il a répondu.

#### 2.2 `accounting_settings` (une par organisation)

| Champ | Règle |
|---|---|
| `mode` | `off` (défaut), `simulation`, `active` (§ 3.1) |
| `chartPack` | `{ slug, version }` ; `active` exige un pack `approved` ou `active` |
| `bookCurrency` | `CDF` ou `USD` ; **aucun défaut** ; exigé pour `active` ; **non modifiable** après la première écriture validée (décision ouverte n° 4) |
| `cutoverDate` | date de bascule (jour de Kinshasa) ; exigée pour `active` ; non modifiable après la première écriture validée |
| `fiscalYearStartMonth` | défaut `1` (janvier) — **à confirmer par l'expert** (question E6) |
| `stockPosting` | `off` (défaut) ou `perpetual` (§ 6.7) |
| `depreciationPosting` | `off` ; seule valeur admise tant que le pack ne contient pas de méthode validée (§ 6.8) |
| `ruleSetVersion` | version validée en vigueur (§ 2.4) |
| `activatedAt`, `activatedBy` | trace de l'activation |

#### 2.3 `accounting_accounts` (plan de l'organisation)

Copie **référencée** des comptes du pack (`origin: 'pack'`, `packAccountNumber`) et comptes propres
(`origin: 'organization'`).

| Champ | Règle |
|---|---|
| `number` | chaîne de chiffres ; unique `organizationId + number` ; un compte propre **commence par** le numéro d'un compte du pack actif (`409 ACCOUNT_OUTSIDE_PACK`) |
| `label` | libellé ; celui d'un compte du pack peut être précisé, pas remplacé (le libellé du pack reste affiché) |
| `auxiliary` | `{ kind: 'customer' \| 'supplier', customerId \| supplierId }` pour un compte auxiliaire ; un auxiliaire par fiche, créé à la première écriture qui le vise |
| `collectiveNumber` | compte collectif de rattachement d'un auxiliaire |
| `active` | un compte mouvementé ne se supprime pas ; il s'archive |

#### 2.4 `accounting_rule_sets` (règles de correspondance, versionnées)

| Champ | Règle |
|---|---|
| `version` | entier croissant par organisation |
| `status` | `draft` → `validated` → `superseded` ; une version `validated` est **immuable** |
| `rules[]` | `{ key, debit: AccountRef[], credit: AccountRef[], requiresReview: boolean }` où `key` est une **clé d'opération** du § 6 et `AccountRef` un numéro de compte du plan, ou un jeton résolu à l'exécution (`{customer}`, `{supplier}`, `{treasuryAccount}`) |
| `basedOn` | `{ packSlug, packVersion }` |
| `validation` | `{ by, at, soleApprover, expertReview: { declared: boolean, name, date, note } }` |

- Une version naît **brouillon** à partir des règles proposées du pack ; l'organisation peut changer un
  compte, jamais créer une clé d'opération inconnue du moteur (`400 UNKNOWN_OPERATION_KEY`).
- **Validation** : `accounting.manage`, séparation dynamique (`ruleSetDecision` : le dernier auteur ne
  valide pas, sauf approbateur unique, marqué) ; la case « relu par notre expert-comptable » (nom, date)
  est **exigée** (décision ouverte n° 6) : c'est une **déclaration** de l'organisation, enregistrée, que
  Lalanda ne vérifie pas.
- Une clé sans règle validée produit une écriture vers le **compte d'attente** (§ 6.0).
- Changer une règle n'altère **aucune** écriture passée : la version nouvelle vaut pour les pièces
  synchronisées ensuite ; reclasser le passé se fait par opération diverse ou par **régénération
  contrôlée** d'une période ouverte (contre-passation de toutes ses écritures générées, puis génération
  nouvelle ; § 4).

#### 2.5 `accounting_journals`

`{ code, label, kind: 'sales' | 'purchases' | 'treasury' | 'misc' | 'opening', treasuryAccountId | null,
active }`, unique `organizationId + code`. À l'activation : `VE` (ventes), `AC` (achats), `OD` (opérations
diverses), `AN` (à-nouveaux), et **un journal de trésorerie par compte de trésorerie** d'ADR-0034
(`cash`, `bank`, `mobile_money`), code proposé `T01`, `T02`… modifiable. Un compte de trésorerie créé
plus tard reçoit son journal à la synchronisation suivante.

#### 2.6 `accounting_entries` (écritures, ajout seul)

| Champ | Règle |
|---|---|
| `journalCode`, `fiscalYear`, `number` | numéro **attribué à la validation**, séquentiel sans trou par `organizationId + journalCode + fiscalYear` (compteurs `accounting_counters`) |
| `date` | jour de Kinshasa de la pièce (ADR-0027) |
| `status` | `draft` (opération diverse en saisie), `awaiting_rate` (taux manquant), `posted` (validée) ; jamais de suppression d'une `posted` |
| `source` | `{ kind, id, revision \| event, number \| null, date, partyName \| null }` — copie d'affichage de la pièce |
| `sourceKey` | clé déterministe (§ 6) ; **unique partiel** `organizationId + sourceKey` sur les écritures non contre-passées par régénération : l'idempotence |
| `lines[]` | `{ accountNumber, auxiliaryAccountNumber \| null, label, debit, credit, currency, amount, bookAmount, rate, rateSource: 'same_currency' \| 'document' \| 'observed' \| 'entered', rateRef \| null, letteringCode \| null }` ; chaque ligne a **soit** un débit **soit** un crédit, strictement positif |
| `reversalOf`, `reversedBy` | lien de contre-passation |
| `generation` | `{ ruleSetVersion, chartPack, engineVersion: ACCOUNTING_VERSION }` ; `null` pour une saisie manuelle |
| `manual` | `{ authorId, validatorId \| null, soleApprover, attachmentKey \| null, reason }` pour une opération diverse |
| `suspense` | `true` si une ligne vise le compte d'attente (indexé) |
| `seq`, `prevHash`, `hash` | chaînage par organisation **à la validation**, tête `accounting_journal_heads`, même algorithme documenté que le journal des ventes (ADR-0023 § S25e.12) |

**Invariants** (moteur et service, testés) : Σ débits = Σ crédits en **monnaie de tenue** ; pour une
écriture dont toutes les lignes sont dans la même devise, l'égalité vaut aussi en devise de la pièce ;
aucune écriture `posted` dans une période close ; une écriture `posted` n'est jamais modifiée : toute
correction est une contre-passation suivie d'une écriture nouvelle.

#### 2.7 Autres collections

| Collection | Rôle |
|---|---|
| `accounting_fiscal_years` | `{ year, start, end, status: 'open' \| 'closing' \| 'closed', closedAt, closedBy, reopenLog[] }` |
| `accounting_periods` | mois de l'exercice : `open` ↔ `closed`, `closedAt`, `closedBy`, `reopenLog[]` (ajout seul, motif) |
| `accounting_exchange_rates` | taux **saisis** : `{ date, from, to, rate, sourceText, enteredBy }`, unique `organizationId + date + from + to` ; jamais importés d'office |
| `accounting_lettering` | événements de lettrage en ajout seul : `{ code, accountNumber, auxiliary, lineRefs[], action: 'letter' \| 'unletter', at, by }` |
| `accounting_pending` | « À comptabiliser » : pièce non comptabilisable et motif (`NO_TREASURY_ACCOUNT`, `RATE_MISSING`, `PERIOD_CLOSED`, `SOURCE_CHANGED_IN_CLOSED_PERIOD`, `UNSUPPORTED_SOURCE`) |
| `accounting_sync_checkpoints` | point de lecture par source (`sales_invoices`, `sales_receipts`, `treasury_expenses`, `treasury_movements`, `supplier_invoices`, `supplier_payments`, `stock_movements`) |
| `accounting_exports` | journal des exports : paramètres, empreinte SHA-256 du fichier, auteur, date ; fichier en stockage objet à durée limitée |
| `accounting_journal_heads`, `accounting_counters` | tête de chaîne, compteurs de numéros |

**Aucune collection existante ne gagne de champ.** Lectures seules déclarées dans
`apps/api/src/accounting/sources/**` (modèles en lecture, motif d'ADR-0046 § 6.2).

### 3. Activation, simulation, bascule

#### 3.1 Trois modes

| Mode | Ce qui se passe | Bandeau |
|---|---|---|
| `off` (défaut) | rien n'est lu, rien n'est calculé | — |
| `simulation` | les écritures, la balance et les projets d'états sont **calculés à la volée** par le moteur, **rien n'est persisté**, aucune numérotation, aucun export autre que « simulation » ; pack `draft` admis | « **Simulation** — plan comptable non relu par un expert-comptable ; rien n'est enregistré » |
| `active` | écritures persistées, numérotées, chaînées ; clôtures ; exports | « **Projet** — à valider par un expert-comptable » |

Passer à `active` exige, **tous** vérifiés par le serveur (`409 ACCOUNTING_ACTIVATION_PRECONDITION`,
`details.missing[]`) : un pack `approved` ou `active` ; `bookCurrency` choisie ; `cutoverDate` choisie ;
un jeu de règles `validated` avec déclaration de relecture ; un premier exercice ouvert ; l'appelant
détient `accounting.manage` **et** `fiscal.manage` (cumul exigé par la route, pas une dépendance :
activer engage l'organisation comme activer la facture normalisée, ADR-0021 § 8). **Revenir** de `active`
à `off` n'efface rien : la synchronisation s'arrête, les livres restent lisibles et exportables.

#### 3.2 Bascule et reprise de l'existant

- Les pièces du RUN dont la date est **antérieure** à `cutoverDate` ne sont **jamais** comptabilisées.
- La situation à la bascule entre par des **à-nouveaux de reprise** dans le journal `AN`, **saisis et
  validés** par l'organisation (opération diverse à séparation des tâches). Lalanda **propose**, sans
  rien valider : soldes des comptes de trésorerie au début du jour de bascule (moteur `treasury`,
  `computeAccountBalances`), restes à encaisser par facture et par client (moteur `receivables`,
  `computeSettlement`), restes à payer par facture fournisseur (ADR-0044). Les capitaux propres, les
  immobilisations, les emprunts, les stocks, les dettes fiscales et sociales **ne sont pas proposés** :
  Lalanda ne les connaît pas ; ils viennent de la dernière balance de l'expert.
- Une proposition détaille les à-nouveaux de tiers **par facture ouverte** : un encaissement postérieur à
  la bascule se lettre avec la ligne d'à-nouveau de sa facture.
- Tant que les à-nouveaux de reprise ne sont pas validés et équilibrés, chaque projet d'état affiche
  « Reprise incomplète » parmi ses réserves (§ 6.10).

### 4. Périodes, clôture, à-nouveaux

- **Mois** : `accounting.close` clôt un mois (`open → closed`) si aucune écriture `draft` ne l'occupe
  (`409 PERIOD_HAS_DRAFTS`) ; un mois clos refuse toute écriture nouvelle datée en son sein
  (`409 ACCOUNTING_PERIOD_CLOSED`).
- **Pièce modifiée ou annulée après clôture** (dépense annulée, encaissement annulé) : la synchronisation
  ne touche pas le mois clos ; elle passe la contre-passation à la **date du premier jour ouvert**, avec
  le motif `SOURCE_CHANGED_IN_CLOSED_PERIOD` et un lien vers l'écriture d'origine, et l'inscrit dans
  « À comptabiliser » pour revue (décision ouverte n° 10).
- **Réouverture** d'un mois ou d'un exercice : **Propriétaire seul**, motif obligatoire, journal en ajout
  seul, audit strict — même règle que le réalisé (docs/08, `REOPEN_OWNER_ONLY`). Rouvrir un exercice
  contre-passe ses à-nouveaux dans l'exercice suivant (décision ouverte n° 11).
- **Régénération contrôlée** d'un mois **ouvert** après changement de règles : `accounting.manage`,
  aperçu des écritures contre-passées et nouvelles, confirmation, audit.
- **Clôture d'exercice** (`accounting.close`) : tous les mois clos ; aucune écriture `awaiting_rate` ;
  le compte d'attente soldé **ou** son solde **accepté explicitement** avec motif (le projet d'état le
  montre alors en réserve) ; génération, par le moteur, des **à-nouveaux** de l'exercice suivant
  (`computeOpeningEntries`) : soldes des comptes de bilan reportés ; **traitement du résultat (compte
  d'affectation) à confirmer par l'expert** (question E7). L'exercice passe à `closed`.
- Les comptes de gestion ne sont pas soldés par une écriture de Lalanda au-delà de ce que l'expert aura
  validé dans le pack.

### 5. Devises

- Chaque ligne porte `currency` et `amount` **de la pièce** et `bookAmount` en monnaie de tenue.
- **Taux, par ordre** : même devise → 1 ; facture USD avec `conversion` figée → taux **de la pièce**
  (`rateSource: 'document'`, référence BCC recopiée si présente) ; virement entre devises → taux
  **observé** = rapport des deux montants saisis, de sorte que les deux jambes ont le même montant en
  monnaie de tenue (aucun écart créé) ; sinon → taux **saisi** dans `accounting_exchange_rates` pour la
  date de la pièce (`rateSource: 'entered'`).
- **Aucun taux trouvé** → écriture `awaiting_rate`, hors balance, listée dans « À comptabiliser » ; elle
  devient `posted` dès qu'un taux est saisi. **Jamais** de taux de la veille, de moyenne ni de taux
  d'un autre document.
- **Écarts de change** (facture USD prise au taux T1, encaissement USD au taux T2) : la différence en
  monnaie de tenue sur le compte client est portée au **compte d'attente** « écarts de change à
  qualifier » tant que l'expert n'a pas fixé la règle (décision ouverte n° 12, question E3).
- La balance et les états sont en monnaie de tenue ; le grand livre et les auxiliaires montrent **aussi**
  les montants en devise de la pièce ; l'export les porte tous deux.

### 6. Sources d'écritures et clés d'opération

Chaque source est lue **en lecture seule**, à partir de `cutoverDate`. Une écriture par événement ; la clé
de source garantit qu'un rejeu n'écrit rien de plus. Les clés d'opération en `code` sont celles des règles
(§ 2.4). **Aucun compte n'est écrit ici** : les comptes viennent des règles validées.

#### 6.0 Compte d'attente, règle universelle

Toute clé d'opération sans règle validée, tout groupe de taxation sans règle, toute contrepartie de
trésorerie inconnue va au **compte d'attente** (compte de la classe 47 désigné par l'expert ; en mode
simulation, compte technique `ATTENTE` signalé comme tel). L'écriture est **équilibrée** et validée ;
seul son classement attend. Le tableau de bord de la comptabilité montre le solde d'attente, son détail
par motif, et l'outil de **reclassement** (opération diverse préremplie).

#### 6.1 Factures et avoirs de vente (ADR-0023, ADR-0024)

- **Lu** : `sales_invoices` de la **série réelle**, statut `issued` ou `normalized`, type `FV`, `FT`, `EV`,
  `ET` (factures) et `FA`, `EA` (avoirs). **Jamais** un brouillon, une pro forma, une facture
  `pending_normalization` ou `normalization_failed` (motif d'ADR-0046 § 6.2), ni la série d'essai.
- `sourceKey` : `sales_invoice:<id>:issue`.
- Lignes, à partir des **totaux figés par groupe** (`documentAmounts.calculation`, ou `normalizedAmounts`
  qui font foi pour une facture normalisée) :
  - débit `sale.invoice.receivable` (compte client auxiliaire) = total TTC ;
  - crédit `sale.invoice.revenue.<BIE|SER>.<groupe>` = base HT par type d'article et par groupe ;
  - crédit `sale.invoice.vat.<groupe>` = TVA du groupe, **pour les seuls groupes à TVA** ;
  - groupes **H, I, J, L, N** et taxes spécifiques : crédit `sale.invoice.nonrevenue.<groupe>` — **jamais
    un compte de produit d'office** (le dépôt les exclut déjà du chiffre d'affaires, ADR-0031 § 3) ; sans
    règle, compte d'attente.
- **Paiements déclarés à l'émission** (part non `CREDIT`) : seconde écriture `sales_invoice:<id>:paid_at_issue`
  — crédit compte client, débit `sale.payment_at_issue.<moyen>` ; la règle peut viser un compte de
  trésorerie par moyen de règlement ; sans règle, **compte d'attente** « fonds reçus à l'émission, compte de
  trésorerie à préciser ». L'écran signale que **la trésorerie d'ADR-0034 ne voit pas ces fonds**
  (décision ouverte n° 9).
- **Avoirs** : écriture inverse par groupe (`sale.credit_note.*`) ; l'avoir est-il une diminution du
  produit ou un compte de réductions accordées ? **question E1** ; règle proposée `to_confirm`.
- **Acomptes** (`FT`, `ET`) : traitement **à confirmer** (question E1) ; sans règle, compte d'attente.
- Facture en USD : taux de la pièce (§ 5).

#### 6.2 Encaissements (ADR-0031)

- **Lu** : `sales_receipts`. `sourceKey` : `sales_receipt:<id>:r<revision>` ; annulation : contre-passation
  `sales_receipt:<id>:cancel`.
- Débit `receipt.<moyen>` → `{treasuryAccount}` résolu par `accountId` (journal du compte de trésorerie) ;
  sans `accountId` : compte d'attente, pièce dans « À comptabiliser » (`NO_TREASURY_ACCOUNT`).
- Crédit compte client auxiliaire, **une ligne par lettrage** (facture citée) ; **lettrage automatique**
  avec la ligne de facture (§ 6.11).
- Modification d'un encaissement (révision) : contre-passation de la révision précédente, écriture nouvelle.

#### 6.3 Dépenses (ADR-0034, ADR-0045)

- **Lu** : `treasury_expenses` `recorded`, **`origin` nulle seulement** ; une dépense créée par un paiement
  fournisseur (`origin.kind = 'supplier_payment'`) est **ignorée** : le paiement fournisseur la comptabilise
  déjà (§ 6.5) — sans cette règle, la charge serait comptée deux fois.
  > **Amendé par [ADR-0051](ADR-0051-rh-frais-avances-presences-evaluations.md) § 7.4 (lot H13).** Le
  > filtre vise `origin.kind = 'supplier_payment'` **seulement**. Une dépense possédée par les RH
  > (`origin.kind = 'expense_report'`, remboursement d'une note de frais) est comptabilisée comme une
  > dépense directe : débit `expense.<catégorie>`, crédit `{treasuryAccount}`, même `sourceKey`. Soldée
  > par une avance (`accountId: null`, `settledByAdvanceId`), sa contrepartie est la clé
  > `hr.advance.settled`, **toujours** au compte d'attente avec le motif `SETTLED_BY_EMPLOYEE_ADVANCE`
  > (question C2), sans être « À comptabiliser ». Les clés `hr.advance.disbursed` et
  > `hr.advance.returned` sont réservées, sans règle admise. Toute autre nature de propriétaire est
  > « À comptabiliser » (`UNSUPPORTED_SOURCE`). `ACCOUNTING_VERSION` 1.1.0.
- `sourceKey` : `treasury_expense:<id>:r<revision>` ; annulation : contre-passation.
- Débit `expense.<catégorie>` (quatorze catégories ; `investissement` vers la classe 2,
  `remboursement_emprunt` vers la classe 16, `impot_benefices` vers la classe 89 — **tous à confirmer**),
  crédit `{treasuryAccount}` ; sans `accountId` : compte d'attente.
- **Montant** : celui de la dépense, tel que payé. **TVA déclarée** (`deductibleVat`) : **non récupérée par
  défaut** — elle reste dans la charge ; elle n'est portée en TVA récupérable que si l'organisation est
  **assujettie** selon sa fiche fiscale (`seller-vat-status`) **et** qu'une règle validée
  `expense.vat_declared` existe (décision ouverte n° 7, question E2). Lalanda ne calcule jamais une TVA.
- **Salaires** (`personnel`) : une ligne de charge, montant payé ; ni brut, ni retenues, ni cotisations
  (aucune paie, ADR-0045) ; l'expert passe les écritures de paie par opération diverse s'il le juge utile.

#### 6.4 Factures fournisseurs (ADR-0044)

- **Lu** : `supplier_invoices` `validated` (et leur annulation après validation) ; avoirs
  (`kind: credit_note`). `sourceKey` : `supplier_invoice:<id>:validate`, `…:cancel`.
- Débit `purchase.invoice.<catégorie>` par imputation (`costAllocations`, somme = total TTC) ; crédit
  compte fournisseur auxiliaire = total.
- **TVA déductible déclarée** : même règle que § 6.3 (non séparée par défaut ; séparée seulement si
  assujettie et règle `purchase.vat_declared` validée, le montant déclaré venant en diminution des
  imputations au prorata). Les autres taxes déclarées (`taxes[]`, libellés libres) restent dans la charge.
- Avoir fournisseur : écriture inverse.

#### 6.5 Paiements fournisseurs (ADR-0044)

- **Lu** : `supplier_payments` ; `sourceKey` : `supplier_payment:<id>:record`, `…:cancel`.
- Débit compte fournisseur auxiliaire, une ligne par facture imputée ; crédit `{treasuryAccount}` ; sans
  compte : attente. Lettrage automatique avec la facture fournisseur.

#### 6.6 Virements internes et autres mouvements (ADR-0034)

- **Lu** : `treasury_movements`. `transfer` : deux écritures (journal de chaque compte), contrepartie
  `transfer.internal` (virements de fonds, candidat 585, **à confirmer**) ; entre devises, taux observé
  (§ 5). `sourceKey` : `treasury_movement:<id>:out` et `:in`.
- `other_in` (apport, prêt reçu…) et `other_out` (prélèvement de l'exploitant…) : la nature n'est pas
  connue de la pièce → **compte d'attente**, à reclasser par opération diverse (décision ouverte n° 13).
- **Solde d'ouverture** d'un compte de trésorerie postérieur à la bascule : proposé en à-nouveau de
  reprise ou en opération diverse, jamais écrit seul.

#### 6.7 Mouvements de stock valorisés (ADR-0046), en option

- `stockPosting = off` (défaut) : rien. Le stock reste un registre de gestion.
- `perpetual` (inventaire permanent) : seulement si le pack contient des règles validées `stock.*` ;
  écriture par mouvement valorisé (`stock_movement:<id>`), au coût moyen **de gestion** d'ADR-0046 ; un
  mouvement sans coût (`pending_cost`) ou dans une autre devise sans taux attend. **La méthode
  d'inventaire (permanent ou intermittent) et l'usage du coût moyen de gestion sont des questions pour
  l'expert** (E4) ; tant qu'il n'a pas répondu, l'option est refusée (`409 STOCK_POSTING_NOT_VALIDATED`).

#### 6.8 Amortissements

**Hors périmètre** tant que l'expert-comptable n'a pas validé une méthode écrite dans le pack (question
E4). L'estimation de gestion d'ADR-0046 O7 n'est **jamais** comptabilisée ; les durées indicatives du plan
financier (docs/09) ne sont **pas** reprises. En attendant, l'expert passe les dotations par opération
diverse ; Lalanda ne les calcule pas.

#### 6.9 Opérations diverses (saisie manuelle)

- `accounting.post` : saisir un brouillon (journal `OD` ou `AN`), lignes libres sur des comptes du plan,
  pièce jointe facultative (PDF ou image, motif d'ADR-0039 § 2.5), motif obligatoire.
- **Validation** : `accounting.post`, séparation dynamique (`manualEntryDecision` : l'auteur ne valide
  pas, sauf approbateur unique, marqué `soleApprover`) ; à la validation, numéro et chaînage.
- Usages : reclassement de l'attente, régularisations, écritures de l'expert, à-nouveaux de reprise.

#### 6.10 Complétude : ce qu'un projet d'état dit de lui-même

Le moteur rend, avec chaque balance et chaque projet d'état, une liste de **réserves** :
`PACK_NOT_REVIEWED` (simulation), `SUSPENSE_BALANCE` (montant et motifs), `AWAITING_RATE` (nombre),
`PENDING_SOURCES` (« À comptabiliser »), `OPENING_INCOMPLETE` (reprise), `PERIODS_OPEN`,
`DEPRECIATION_NOT_POSTED`, `STOCK_NOT_POSTED`, `PAYMENTS_AT_ISSUE_UNCLASSIFIED`. Une réserve n'est jamais
masquée ; elle s'imprime avec l'état.

#### 6.11 Grand livre, balance, auxiliaires, lettrage

- **Grand livre** : lignes `posted` par compte et période, solde progressif en monnaie de tenue, colonne
  devise de la pièce, lien vers l'écriture et la pièce.
- **Balance** : par compte, à-nouveaux, mouvements débit et crédit de la période, soldes ; balance
  générale et **balances auxiliaires** clients et fournisseurs ; contrôle total débits = total crédits.
- **Lettrage** : automatique quand une écriture d'encaissement ou de paiement cite sa facture ; manuel
  (`accounting.post`) sur des lignes d'un même compte auxiliaire dont la somme est nulle **en devise de
  la pièce** ; délettrage par événement inverse ; code de lettrage et date dans l'export.

### 7. Cohérence avec le réalisé (`actuals`) — règle centrale de docs/08

1. **La comptabilité n'écrit jamais** `actual_periods`, un plan validé, un scénario ou une projection. Le
   réalisé reste alimenté par la saisie et les ponts d'ADR-0031 et d'ADR-0034, inchangés.
2. **Mêmes pièces, même calendrier** : les deux lisent les mêmes documents figés, datés au jour civil de
   Kinshasa (ADR-0027). Aucune pièce n'est comptée dans l'un et inventée dans l'autre.
3. **Deux vues, deux définitions, dites à l'écran** : le réalisé est un **suivi de gestion** du plan (lignes
   du compte d'exploitation, par mois d'exercice, devise du projet, sans conversion) ; la comptabilité est
   une **tenue par comptes** (monnaie de tenue, taux explicites, opérations diverses, à-nouveaux). Elles
   peuvent différer pour des raisons **connues**.
4. **Rapprochement affiché, jamais corrigé** : `GET /accounting/reconciliation/actuals?month=` calcule, par
   le moteur (`reconcileWithActuals`), pour le projet relié des ponts : chiffre d'affaires HT des ventes
   (source `run.sales`) contre crédits des clés `sale.invoice.revenue.*` nets des avoirs ; dépenses par
   catégorie reportées (source `run.expenses`) contre débits des clés `expense.*` ; chaque écart est
   expliqué par une **cause typée** (`OUTSIDE_CUTOVER`, `CURRENCY_NOT_CONVERTIBLE`, `MANUAL_ENTRY`,
   `SUSPENSE`, `PERIOD_MAPPING`, `ACTUALS_MANUAL_VALUE`, `UNEXPLAINED`). Un écart `UNEXPLAINED` est une
   alerte, pas une correction.
5. **Pas de pont comptabilité → réalisé** dans cet ADR : faire du grand livre la source du réalisé
   (correspondance compte → ligne du plan) est la décision ouverte n° 15, défaut non.
6. **Le moteur reste l'unique source des calculs** : les écritures, la balance, les états et le
   rapprochement sont calculés dans `packages/engine/src/accounting` ; l'API persiste et sert, l'interface
   affiche.

### 8. Permissions (amende ADR-0012, docs/12 ; étend ADR-0041)

#### 8.1 Cinq actions nouvelles (quarante-septième à cinquante et unième, en fin d'`ACTIONS`)

| Action | Libellé (ADR-0041 § 5) | Couvre |
|---|---|---|
| `accounting.read` | Consulter la comptabilité | journaux, écritures, grand livre, balances, auxiliaires, projets d'états, rapprochement, « À comptabiliser », réglages en lecture ; la **pièce complète** exige en plus la lecture de son module |
| `accounting.post` | Saisir et valider des écritures | opérations diverses (case ⓢ), reclassement de l'attente, lettrage, taux de change saisis, à-nouveaux de reprise |
| `accounting.close` | Clôturer les périodes comptables | clôture des mois et de l'exercice ; la réouverture reste au Propriétaire |
| `accounting.export` | Exporter la comptabilité | exports pour l'expert (§ 9), audit strict |
| `accounting.manage` | Paramétrer la comptabilité | plan de l'organisation, journaux, règles de correspondance et leur validation (case ⓢ), mode, bascule, régénération ; l'activation exige en plus `fiscal.manage` |

| Action | PRO | ADM | DIR | CPT | ANA | CDP | CON | LEC | COM | RH | MAG | EXP |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| `accounting.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ |
| `accounting.post` | ✓ⓢ | ✗ | ✓ⓢ | ✓ⓢ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `accounting.close` | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `accounting.export` | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| `accounting.manage` | ✓ⓢ | ✗ | ✓ⓢ | ✓ⓢ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

Justifications :

- **`accounting.read`** : la comptabilité agrège ce que ces rôles lisent déjà (`sales.read`,
  `treasury.read`, `purchase.read` ✓ pour PRO, ADM, DIR, CPT, ANA, LEC) ; elle n'ouvre rien de plus à
  eux. Le **Commercial**, le **Responsable RH**, le **Magasinier** n'ont pas la trésorerie : ils n'ont pas
  la comptabilité. Le **Conseiller** (banquier, mentor) n'a pas les livres. Le **Chef de projet** n'est pas
  attribuable.
- **`accounting.post`** : écrire dans les livres est un acte financier ; Propriétaire, Directeur
  financier, Comptable, avec séparation dynamique. L'**Administrateur** gère l'organisation, pas les
  livres (motif de `fiscal.manage`, `sales.invoice`).
- **`accounting.close`** : ceux qui tiennent les livres. Le Comptable clôt sans condition ⚙ ici, à la
  différence de `period.close` du réalisé, parce que la **réouverture** est réservée au Propriétaire
  (décision ouverte n° 11).
- **`accounting.export`** : Propriétaire, Directeur financier, Comptable et **Expert-comptable** ; c'est
  l'usage principal du rôle externe.
- **`accounting.manage`** : les règles décident de tous les comptes ; Propriétaire, Directeur financier,
  Comptable, en case ⓢ (`ruleSetDecision`).
- **Plateforme** : `accounting.read` sous accès délégué pour le super-administrateur et le support ;
  `accounting.post`, `accounting.close`, `accounting.export`, `accounting.manage` rejoignent
  **`PLATFORM_FORBIDDEN_ACTIONS`** : la plateforme n'écrit, ne clôt, n'exporte ni ne paramètre jamais
  les livres d'un client (motif de `period.close` et `report.export`). Le pack de plan comptable relève du
  rôle plateforme existant `platform_country_pack_manager`, hors matrice organisation.

#### 8.2 Rôle nouveau Expert-comptable (O7)

- Slug `external_accountant`, colonne **EXP**, libellé « Expert-comptable (externe) », description
  « Consulte et exporte la comptabilité de l'organisation pour la réviser. N'écrit rien : ni écriture, ni
  vente, ni paiement. Externe à l'organisation. », **rang 8** (après `storekeeper` ; `project_manager`,
  `advisor`, `viewer` passent à 9, 10 et 11 — le rang n'est pas un droit).
- **Trois actions**, socle compris : `analytics.read`, `accounting.read`, `accounting.export` ; tout le
  reste ✗ (dont `sales.read`, `purchase.read`, `treasury.read` : il voit la **copie d'affichage** de la
  pièce portée par l'écriture, pas le module ; décision ouverte n° 3).
- **R7** : attribuable par le **Propriétaire seul** — `external_accountant` rejoint `OWNER_ONLY_ROLES`
  (il lit les salaires payés et tous les tiers). Avant d'attribuer le rôle, toutes les instances de l'API
  doivent être à jour (consigne de `sales_rep`, `hr_manager`, `storekeeper`). Aucune migration.
- Matrice : **12 × 51 + 6 × 51 = 918** cases.

#### 8.3 Compatibilité avec ADR-0041

- **Dépendances** : `accounting.post`, `accounting.close`, `accounting.export`, `accounting.manage` →
  `accounting.read`. Chaque ligne de la matrice les satisfait (test).
- **Domaine** : treizième, « Comptabilité » (cinq actions, libellés du § 8.1).
- **Séparation des tâches** : dynamique (`manualEntryDecision`, `ruleSetDecision`) ; `accounting.post` et
  `accounting.manage` rejoignent `APPROVAL_ACTIONS` (cases ⓢ, comptage des détenteurs effectifs pour
  l'approbateur unique). **Aucune paire `SOD_PAIRS` nouvelle** : la règle utile (« ne pas valider sa
  propre écriture ») est dynamique ; une paire statique empêcherait l'entrepreneur seul de tenir ses
  livres.
- **Non délégable** : rien de nouveau. **Destinataires** des notifications : par `holdersOf` (droits
  effectifs), jamais par `role: { $in: … }`.

### 9. Exports pour l'expert-comptable

- **Format exact : décision ouverte n° 14** ; rien n'est présumé de l'outil de l'expert.
- **Défaut proposé** : CSV (`;`, UTF-8 avec BOM, formules neutralisées), une ligne par ligne d'écriture,
  colonnes inspirées du « fichier des écritures comptables » utilisé en France (code et libellé du
  journal, numéro et date de l'écriture, compte et libellé, compte auxiliaire et libellé, référence et
  date de la pièce, libellé, débit, crédit, code et date de lettrage, date de validation, montant en
  devise, devise) — ce format **n'est pas** présenté comme une obligation congolaise ; plus quatre colonnes
  Lalanda : clé de source, version des règles, version du moteur, empreinte de l'écriture.
- **Autres exports** : balance générale et auxiliaires (CSV et `.xlsx`, ADR-0007 et ADR-0010), grand livre
  (CSV, `.xlsx`), projets d'états (PDF et `.xlsx`, bandeau sur chaque page), état des réserves.
- **Chaque export** : en-tête « Projet — à valider par un expert-comptable », période, monnaie de tenue,
  pack et version des règles, liste des réserves ; empreinte SHA-256 du fichier enregistrée
  (`accounting_exports`) ; audit strict (`accounting.export.created`) ; limite de débit (motif
  d'ADR-0042) ; en mode `simulation`, nom de fichier et en-tête « SIMULATION ».

### 10. Projets d'états financiers

- **Bilan, compte de résultat, tableau des flux de trésorerie**, au **format du modèle d'états du pack**
  (rubriques → plages de comptes) ; tant qu'une rubrique est `to_confirm`, elle s'affiche avec ce statut.
- **Toujours** : bandeau « Projet — à valider par un expert-comptable. Établi automatiquement par Lalanda
  à partir des opérations enregistrées ; non vérifié, non déposé. » (amendé le 1er nov. 2026 : « ni certifié » contenait un mot interdit par le critère 14) sur l'écran, chaque page PDF, chaque
  feuille `.xlsx` et dans la réponse d'API (`status: "draft_unverified"`, `disclaimer`) ; réserves du
  § 6.10 imprimées.
- **Jamais** : dépôt, transmission à une administration ou à une banque, signature, libellé
  « définitif », « certifié », « conforme », « liasse », « déclaration » — verrouillé par un test sur les
  gabarits et les chaînes de l'interface.
- **Tableau des flux** : la méthode et le classement des flux sont des questions pour l'expert (E8) ;
  jusqu'à sa réponse, l'état est rendu « non disponible » plutôt que deviné. Le bilan et le compte de
  résultat sont rendus dès que le pack contient leurs modèles (même `to_confirm`, marqués).
- L'IA n'élabore ni ne commente un état comme s'il était définitif ; elle peut expliquer une écriture à
  partir de sa pièce (ADR-0008, docs/11), jamais en produire une.

### 11. Contrat HTTP (préfixe `/accounting`, `AuthGuard`, organisation de la session, 404 hors organisation)

| Méthode et chemin | Permission | Effet |
|---|---|---|
| `GET /accounting/settings` · `PUT /accounting/settings` | `accounting.read` · `accounting.manage` | mode, monnaie de tenue, bascule, options ; `409 BOOK_CURRENCY_LOCKED`, `CUTOVER_LOCKED` |
| `POST /accounting/activate` · `POST /accounting/deactivate` | `accounting.manage` + `fiscal.manage` | `409 ACCOUNTING_ACTIVATION_PRECONDITION` (`details.missing[]`) ; audit strict |
| `GET /accounting/chart-packs` · `GET …/:slug/:version` | `accounting.read` | packs publiés, sources, statut de chaque compte |
| `GET /accounting/accounts` · `POST` · `PUT …/:number` · `…/archive` | `accounting.read` · `accounting.manage` | plan de l'organisation ; `409 ACCOUNT_OUTSIDE_PACK`, `ACCOUNT_IN_USE`, `ACCOUNT_NUMBER_EXISTS` |
| `GET /accounting/rule-sets` · `GET …/:version` · `POST` (brouillon) · `PUT …/:version` · `POST …/:version/validate` | `accounting.read` · `accounting.manage` | `400 UNKNOWN_OPERATION_KEY` ; `409 SELF_APPROVAL_FORBIDDEN`, `EXPERT_REVIEW_DECLARATION_REQUIRED`, `RULE_SET_IMMUTABLE` |
| `GET /accounting/journals` · `POST` · `PUT …/:code` | `accounting.read` · `accounting.manage` | journaux |
| `GET /accounting/entries` (filtres en **corps** `POST /accounting/entries/search`) · `GET …/:id` | `accounting.read` | écritures, pièce (copie), réserves ; en simulation, calculées à la volée |
| `POST /accounting/entries` · `PUT …/:id` · `POST …/:id/validate` · `POST …/:id/reverse` · `DELETE …/:id` (brouillon seulement) | `accounting.post` | opérations diverses ; `409 ENTRY_UNBALANCED`, `ACCOUNTING_PERIOD_CLOSED`, `SELF_APPROVAL_FORBIDDEN`, `ENTRY_ALREADY_REVERSED`, `ENTRY_NOT_DRAFT` |
| `GET /accounting/pending` · `POST …/:id/resolve` | `accounting.read` · `accounting.post` | « À comptabiliser » |
| `POST /accounting/sync` | `accounting.manage` | synchronisation immédiate (idempotente) ; rend compteurs créés, ignorés, en attente |
| `POST /accounting/periods/:year/:month/regenerate` (aperçu puis `?confirm=true`) | `accounting.manage` | régénération contrôlée d'un mois ouvert |
| `GET /accounting/exchange-rates` · `PUT …/:date/:from/:to` | `accounting.read` · `accounting.post` | taux saisis ; `409 RATE_IN_USE_IN_CLOSED_PERIOD` |
| `POST /accounting/ledger` · `POST /accounting/trial-balance` · `POST /accounting/auxiliary-balance` | `accounting.read` | grand livre, balances (critères en corps) |
| `POST /accounting/lettering` · `POST /accounting/lettering/:code/unletter` | `accounting.post` | `409 LETTERING_NOT_BALANCED`, `LETTERING_MIXED_ACCOUNTS` |
| `GET /accounting/statements/:kind?year=&month=` | `accounting.read` | `kind` ∈ `balance-sheet`, `income-statement`, `cash-flow` ; `status: "draft_unverified"`, `disclaimer`, `reserves[]` ; `cash-flow` : `409 STATEMENT_NOT_AVAILABLE` tant que E8 n'est pas tranchée |
| `GET /accounting/fiscal-years` · `POST` · `POST /accounting/periods/:year/:month/close` · `POST …/reopen` · `POST /accounting/fiscal-years/:year/close` · `POST …/reopen` | `accounting.read` · `accounting.close` · Propriétaire (réouverture) | `409 PERIOD_HAS_DRAFTS`, `FISCAL_YEAR_NOT_CLOSABLE` (`details.reasons[]`), `REOPEN_OWNER_ONLY`, `REOPEN_REASON_REQUIRED` |
| `GET /accounting/opening/proposal` · `POST /accounting/opening` | `accounting.read` · `accounting.post` | proposition d'à-nouveaux de reprise (§ 3.2), saisie en brouillon |
| `GET /accounting/reconciliation/actuals?month=` | `accounting.read` + `project.read` | rapprochement avec le réalisé (§ 7) |
| `POST /accounting/exports` · `GET /accounting/exports` · `GET …/:id/file` | `accounting.export` · `accounting.read` · `accounting.export` | exports (§ 9), audit strict, limite de débit |

Codes d'erreur en `SCREAMING_SNAKE_CASE` ; aucune donnée comptable dans l'URL au-delà des identifiants
et périodes (recherches et filtres en corps `POST`, motif d'ADR-0046 § 4.3).

### 12. Moteur — `packages/engine/src/accounting/`, `ACCOUNTING_VERSION = '1.0.0'`

Module **pur** (aucune base, aucun réseau, aucune horloge), `bigint` en centimes, chaînes décimales :

| Fonction | Rôle |
|---|---|
| `parseChartPack`, `validateChartPack` | lecture du YAML ; refus d'un pack `approved` contenant un `to_confirm` ; compte `sourced` sans source |
| `resolveRule(ruleSet, key)` | règle validée, ou compte d'attente avec motif |
| `entriesForSalesInvoice`, `entriesForReceipt`, `entriesForExpense`, `entriesForSupplierInvoice`, `entriesForSupplierPayment`, `entriesForTreasuryMovement`, `entriesForStockMovement` | **pièce figée → écritures proposées** + clés de source ; déterministes |
| `reverseEntry` | contre-passation exacte |
| `applyRate` | monnaie de tenue selon § 5 ; `awaiting_rate` sans taux ; jamais de conversion implicite |
| `checkEntry` | équilibre, signes, comptes du plan, période ouverte (fournie en entrée) |
| `computeLedger`, `computeTrialBalance`, `computeAuxiliaryBalances` | grand livre, balances |
| `suggestLettering`, `checkLettering` | lettrage |
| `computeStatement(trialBalance, template)` | projet d'état ; rubriques `to_confirm` marquées |
| `computeReserves` | réserves du § 6.10 |
| `computeOpeningEntries` | à-nouveaux de l'exercice suivant (traitement du résultat selon le pack) |
| `proposeCutoverOpening` | proposition de reprise (§ 3.2), à partir des sorties des moteurs `treasury` et `receivables` |
| `reconcileWithActuals` | rapprochement typé (§ 7) |
| `exportRows` | lignes d'export (§ 9) |

Rien dans ce module ne choisit un compte : il applique les règles reçues en entrée.

**Note du 1er novembre 2026 — raccord K2/K3.** Les lots K2 et K3, écrits en parallèle, ne se
raccordaient pas : `toReportingEntry(écriture K2, persistance)` (`accounting/bridge.ts`) traduit une
écriture du moteur d'écritures en vue de restitution (côté inactif `'0.00'` → `null`, `matchRef` →
`documentRef`, `operationKey`, `suspenseReason`, `exchangeDifference` et `bookCurrency` recopiés ;
identifiant, journal, exercice, numéro, statut et date de validation fournis par la persistance). K3
admet en outre, explicitement et seulement : une ligne **convertie** (devise ≠ monnaie de tenue de
l'écriture) arrondie à `0.00` en monnaie de tenue si son montant en devise est strictement positif — elle
compte pour 0 dans la balance, pour son montant par devise ; une ligne d'**écart de change** de montant en
devise nul, son montant de tenue restant strictement positif. Une ligne porte toujours un seul côté non
nul ; toutes les autres validations demeurent. `generation.ruleSetVersion` et `generation.chartPack`
peuvent être `null` (aucun jeu validé, aucun pack). Un test de propriété à graine fixe enchaîne
`entriesFor…` → `toReportingEntry` → balance, grand livre, état, export.

### 13. Interface — application RUN « Comptabilité », route `/comptabilite`

Colonne d'applications (ADR-0038), visible avec `accounting.read` ; sous-options :

| Écran | Contenu |
|---|---|
| **Vue d'ensemble** | mode et bandeau ; réserves (§ 6.10) en premier ; solde du compte d'attente ; « À comptabiliser » ; dernières clôtures ; rapprochement du mois avec le réalisé |
| **Écritures** | liste filtrable par journal, période, compte, pièce ; détail avec la pièce (lien vers le module si l'appelant le lit), la règle et sa version ; saisie d'opération diverse, validation, contre-passation |
| **Grand livre** · **Balance** · **Clients et fournisseurs** | comptes, soldes, devise de la pièce à côté de la monnaie de tenue ; lettrage par sélection |
| **États** | bilan, compte de résultat, tableau des flux : **bandeau projet et réserves en tête**, rubriques `to_confirm` marquées |
| **Clôtures** | mois et exercice, conditions manquantes listées, réouverture (Propriétaire) |
| **Exports** | choix du format, période, historique avec empreintes |
| **Réglages** | activation (assistant en quatre étapes : pack et avertissements, monnaie de tenue, bascule et reprise, règles), plan de l'organisation, règles de correspondance (chaque règle `to_confirm` signalée), journaux, taux saisis |

Copie : français simple, sans jargon non expliqué ; chaque terme comptable a une infobulle (glossaire) ;
aucun mot de conformité (§ 10).

### 14. Ce que cet ADR n'invente pas

| Sujet | Ce que fait Lalanda |
|---|---|
| Numéros et libellés de comptes | candidats « à confirmer » ; pack `draft` jusqu'à relecture ; l'organisation valide ses règles |
| TVA RDC (collectée par groupe, déductible, exigibilité, régime des groupes D à P) | lit les montants figés des pièces ; **ne calcule aucune TVA** ; récupération seulement sur règle validée |
| Change | taux de la pièce, observé ou saisi ; écarts en attente |
| Amortissements, provisions, dépréciations | **aucun** calcul comptable |
| Paie | aucune |
| Méthode d'inventaire, valorisation comptable des stocks | option éteinte |
| Régularité des livres, durée de conservation | garanties techniques décrites, **non affirmées suffisantes** |
| États financiers | projets, toujours marqués |
| Format d'export | décision ouverte |

## Hors périmètre, dit explicitement

- **Dépôt, télédéclaration, liasse, déclaration fiscale ou statistique**, transmission à une administration
  ou à une banque ; signature ; « certification ».
- **Paie** et écritures de paie automatiques ; cotisations ; retenues.
- **Amortissements, provisions, dépréciations** calculés par Lalanda (avant validation d'une méthode par
  l'expert) ; tableau des immobilisations comptable.
- **Calcul de la TVA à reverser** et déclaration de TVA ; acomptes d'impôt.
- **Consolidation**, multi-sociétés, comptabilité analytique (classe 9), engagements hors bilan.
- **Rapprochement bancaire** avec relevés importés (docs/08 § Reste à faire) ; import d'écritures d'un
  autre logiciel (lot futur, décision ouverte n° 16).
- **Système minimal de trésorerie** ou régime simplifié pour les très petites entités : à étudier si
  l'expert le juge applicable (question E9).
- **IA qui agit** : elle n'écrit, ne valide, ne clôt ni n'exporte rien.
- Pont **comptabilité → réalisé** (décision ouverte n° 15).

## Conséquences

- Collections nouvelles : `accounting_chart_packs`, `accounting_settings`, `accounting_accounts`,
  `accounting_rule_sets`, `accounting_journals`, `accounting_entries`, `accounting_journal_heads`,
  `accounting_counters`, `accounting_fiscal_years`, `accounting_periods`, `accounting_exchange_rates`,
  `accounting_lettering`, `accounting_pending`, `accounting_sync_checkpoints`, `accounting_exports`.
  Aucune migration ; aucune collection existante ne change.
- Matrice RBAC : 12 rôles × 51 actions + 6 × 51 = **918** cases ; treizième domaine ; deux actions dans
  `APPROVAL_ACTIONS` ; quatre dans `PLATFORM_FORBIDDEN_ACTIONS` ; `external_accountant` dans
  `OWNER_ONLY_ROLES`.
- Tâches planifiées : `accounting.sync` (toutes les 5 minutes, idempotente).
- Un **dossier pour l'expert-comptable** (pack v1, règles proposées, cas de référence, questions) devient
  une dépendance **avant** toute comptabilité persistée ; sans lui, seul le mode simulation existe.
- L'écart « paiements déclarés à l'émission invisibles de la trésorerie » devient visible (réserve
  `PAYMENTS_AT_ISSUE_UNCLASSIFIED`) ; il relève d'ADR-0031/ADR-0034 (décision ouverte n° 9).
- docs/28 gagne une question au juriste (J1, activité réservée) et voit la question 6 (conservation)
  précisée.
- Charge de maintenance : chaque version du pack suit docs/09 (relecture, double validation, tests).

## Critères d'acceptation (testables)

1. **Permissions** : un `external_accountant` lit `GET /accounting/entries` et exporte (`200`), mais
   `403` sur `POST /accounting/entries`, `POST /accounting/periods/…/close`, `PUT /accounting/settings`,
   `GET /sales/invoices`, `GET /treasury/expenses` ; un `admin` lit, `403` sur toute écriture ; un
   `sales_rep`, un `hr_manager`, un `storekeeper`, un `advisor` : `403` sur `/accounting` ; seul un
   Propriétaire attribue `external_accountant` ; matrice **918** cases et sonde e2e vertes ; un acteur
   plateforme sous accès délégué lit, `403` sur post, close, export, manage.
2. **Activation** : sans pack approuvé, `POST /accounting/activate` → `409 ACCOUNTING_ACTIVATION_PRECONDITION`
   avec `missing` contenant `CHART_PACK_NOT_APPROVED` ; un Comptable (sans `fiscal.manage`) → `403` ; le
   mode simulation fonctionne avec le pack `draft` et ne persiste **aucune** écriture.
3. **Facture** : une facture `FV` normalisée en CDF, groupes B et C, part `CREDIT` totale → une écriture
   `VE` équilibrée : débit client = TTC, crédits par groupe (HT) et TVA par groupe, montants égaux aux
   totaux figés ; rejouer la synchronisation n'écrit rien ; un brouillon, une facture `normalization_failed`
   et une facture de la série d'essai ne produisent rien ; **les documents de vente sont égaux octet pour
   octet** avant et après.
4. **Groupes non produits** : une ligne en groupe J (débours) sans règle → ligne vers le compte
   d'attente, réserve `SUSPENSE_BALANCE` ; jamais vers un compte de produit.
5. **Paiement à l'émission** : facture réglée en `ESPECES` à l'émission, sans règle de moyen → deux
   écritures, la seconde vers l'attente ; réserve `PAYMENTS_AT_ISSUE_UNCLASSIFIED`.
6. **Encaissement** : encaissement lettré à deux factures, compte de trésorerie renseigné → écriture dans
   le journal du compte, deux lignes client, **lettrage automatique** ; annulation → contre-passation,
   délettrage ; sans compte → attente et « À comptabiliser » `NO_TREASURY_ACCOUNT`.
7. **Pas de double comptage** : un paiement fournisseur qui crée deux dépenses → une écriture de
   paiement, **aucune** écriture pour les deux dépenses (`origin` non nulle).
8. **TVA déclarée** : dépense avec `deductibleVat` dans une organisation assujettie sans règle validée →
   charge au montant total, aucune TVA récupérable ; avec règle validée → ligne de TVA = montant déclaré ;
   organisation non assujettie avec règle → règle ignorée, constat.
9. **Devises** : tenue en CDF, facture USD avec conversion figée → `rateSource: 'document'` ; dépense USD
   sans taux saisi → `awaiting_rate`, absente de la balance ; taux saisi → `posted` ; virement 280 000 CDF
   → 100 USD → deux jambes de 280 000,00 CDF en monnaie de tenue, taux observé 2 800 ; encaissement USD à
   un autre taux que la facture → différence au compte d'attente « écarts de change à qualifier ».
10. **Intangibilité** : une écriture `posted` ne se modifie ni ne se supprime (`409`) ; la contre-passation
    est liée ; la chaîne `hash` se vérifie de bout en bout ; numéros sans trou par journal et exercice,
    y compris sous concurrence (deux validations simultanées).
11. **Séparation des tâches** : deux détenteurs de `accounting.post` : l'auteur d'une opération diverse ne
    la valide pas (`409 SELF_APPROVAL_FORBIDDEN`), l'autre oui ; un seul détenteur : il valide,
    `soleApprover: true`, audit ; même règle pour la validation d'un jeu de règles.
12. **Clôture** : mois clos → une dépense datée du mois et annulée ensuite produit une contre-passation au
    premier jour ouvert, motif `SOURCE_CHANGED_IN_CLOSED_PERIOD` ; clôture d'exercice refusée avec une
    écriture `awaiting_rate` ou un solde d'attente non accepté (`details.reasons`) ; réouverture par un
    Directeur financier → `403 REOPEN_OWNER_ONLY`.
13. **Bascule** : une facture datée de la veille de la bascule n'est pas comptabilisée ; la proposition de
    reprise liste ses restes à encaisser ; l'encaissement postérieur se lettre avec la ligne d'à-nouveau.
14. **États** : chaque réponse `GET /accounting/statements/*` porte `status: "draft_unverified"`, le
    `disclaimer` et les réserves ; le PDF porte le bandeau sur chaque page ; un test échoue si une chaîne
    de l'interface ou d'un gabarit contient « conforme », « certifié », « définitif », « liasse » ;
    `cash-flow` → `409 STATEMENT_NOT_AVAILABLE` tant que E8 n'est pas tranchée.
15. **Réalisé intact** : avec les deux ponts actifs, activer la comptabilité, synchroniser, clôturer :
    `actual_periods` et les plans validés sont **égaux octet pour octet** ; le rapprochement du mois rend
    des écarts typés, aucun `UNEXPLAINED` sur le jeu de référence.
16. **Export** : l'export CSV d'un mois contient une ligne par ligne d'écriture, l'en-tête « Projet », les
    réserves, une empreinte enregistrée ; audit `accounting.export.created` ; en simulation, « SIMULATION »
    dans le nom et l'en-tête.
17. **Pack** : un pack `approved` contenant un compte `to_confirm` est refusé par `validateChartPack` ; un
    compte `sourced` sans source est refusé ; aucun numéro de compte n'apparaît dans le code TypeScript
    hors fichiers de test (test d'analyse statique).

## Plan de validation

- **Dossier pour l'expert-comptable (préalable, hors code)** : pack v1 `draft` en tableau lisible,
  règles proposées, **cas de référence** (une vingtaine d'opérations types : vente B et C, vente avec
  débours J, avoir partiel, acompte, encaissement USD, paiement à l'émission, dépense par catégorie,
  dépense d'investissement, remboursement d'emprunt, facture et paiement fournisseur, virement entre
  devises, apport, clôture, à-nouveaux) avec l'écriture **attendue laissée en blanc**, à remplir par
  l'expert ; questions du § suivant. Ses réponses deviennent : le pack v2 `review` puis `approved`, les
  règles proposées, et les **cas de référence du moteur** (`reference-cases.ts`, motif d'ADR-0022
  `check-reference-cases`).
- **Moteur (vitest)** : chaque `entriesFor…` sur les cas de référence ; équilibre (propriété à graine
  fixe sur des pièces aléatoires) ; `applyRate` (aucune conversion sans taux) ; `reverseEntry` ;
  balances ; lettrage ; `computeStatement` (rubriques marquées) ; `computeReserves` ;
  `computeOpeningEntries` ; `reconcileWithActuals` ; `validateChartPack`.
- **Shared (vitest)** : schémas `.strict()` de `@lalanda/shared/accounting`.
- **API e2e (Mongo en mémoire)** : `accounting-settings.e2e` (activation, simulation),
  `accounting-sync-sales.e2e` (statuts, série d'essai, groupes, **égalité des factures**),
  `accounting-sync-treasury.e2e` (dépenses, origine achats, virements, devises),
  `accounting-sync-purchases.e2e`, `accounting-entries.e2e` (opérations diverses, séparation,
  intangibilité, chaîne, concurrence des numéros), `accounting-periods.e2e` (clôtures, pièce modifiée
  après clôture, réouverture), `accounting-exports.e2e`, `accounting-actuals-isolation.e2e` (réalisé
  intact), `rbac-matrix.e2e` (cinq actions, rôle EXP), `routes-coverage.test.ts`.
- **Web (vitest, modèles purs)** : `comptabilite/_components/*-model.ts` (bandeau présent, réserves en tête,
  `to_confirm` signalé), `nav-model.test.ts`, test des mots interdits.
- **Essai de la dirigeante** : passer en simulation ; voir ses factures, encaissements et dépenses d'octobre
  devenir des écritures ; lire la balance et le projet de compte de résultat, ses réserves ; inviter son
  expert-comptable en rôle EXP ; lui remettre l'export ; **ne passer en mode actif qu'après sa relecture**.

## Questions pour l'expert-comptable

À lui remettre avec le dossier ; chaque réponse est consignée (nom, date) dans le pack ou dans les règles.

**E1 — Correspondance des comptes, par type d'opération.**
1. Confirmez-vous les classes et les comptes candidats du § 2.1.1 (411, 401, 4431, 4452, 521, 571, 585,
   601, 701, 706) ? Quels numéros pour la monnaie électronique (mobile money), le compte d'attente, l'impôt
   sur le résultat, le résultat de l'exercice et le report à nouveau ?
2. Pour chacune des **quatorze catégories de dépense** (achats, personnel, loyer, transport, marketing,
   outils et logiciels, énergie et télécoms, services extérieurs, impôts et taxes, impôt sur les
   bénéfices, frais financiers, charges diverses, investissement, remboursement d'emprunt) : quel compte ?
   La catégorie suffit-elle, ou faut-il une précision à la saisie ?
3. Ventes : quel compte de produit pour les biens (`BIE`) et les services (`SER`) ? Quels traitements pour
   les groupes **H** (consignation d'emballage), **I** (garantie et caution), **J** (débours), **L**
   (prélèvements sur ventes), **N** (TVA spécifique), **M** (ventes réglementées), **D** (régimes
   dérogatoires), **E** (exportation), **F, G, P** (marchés publics à financement extérieur), **K**
   (opérations des non-assujettis), **A** (exonéré et hors champ) ?
4. Avoirs de vente : diminution du produit ou compte de réductions accordées ? Factures d'acompte (`FT`,
   `ET`) : quel traitement, et comment la facture finale l'impute-t-elle ?
5. Apports, prêts reçus, prélèvements de l'exploitant (mouvements `other_in`, `other_out`) : quels comptes,
   et quelle information faut-il demander à la saisie ?

**E2 — TVA RDC.**
1. La TVA collectée doit-elle être ventilée par groupe de taxation DGI (un sous-compte par taux) ?
2. TVA déductible : à quelles conditions peut-on porter en TVA récupérable le montant **déclaré** par
   l'utilisateur sur une dépense ou une facture fournisseur ? Quelles pièces faut-il exiger ?
3. Exigibilité : la TVA collectée naît-elle à la facture ou à l'encaissement, selon la nature (biens,
   services) ? Cela change-t-il les écritures ou seulement la déclaration ?
4. Organisation non assujettie (groupe K) : quel traitement de la TVA supportée ?

**E3 — Monnaie de tenue et écarts de change.**
1. En RDC, dans quelle monnaie la comptabilité doit-elle être tenue (CDF obligatoire, USD admis) ?
2. Quel taux pour convertir une opération en devise : taux de la pièce, taux BCC du jour, autre ? Le taux
   figé d'une facture normalisée USD convient-il ?
3. Écart entre le taux de la facture et celui de l'encaissement : quels comptes (pertes et gains de
   change) ? Faut-il réévaluer les créances et dettes en devise à la clôture, et avec quels comptes ?
4. Virement entre comptes de devises différentes : le taux observé (rapport des deux montants) est-il
   acceptable ?

**E4 — Amortissements et stocks.**
1. Quelle méthode d'amortissement Lalanda pourrait-elle appliquer (linéaire, prorata, durées), et pour
   quelles catégories ? Les durées indicatives du plan financier (docs/09) sont-elles utilisables ?
2. Inventaire permanent ou intermittent pour une PME cliente ? Le coût moyen pondéré de gestion
   d'ADR-0046 peut-il valoriser le stock comptable ?

**E5 — Régularité des journaux et des livres.**
1. Quels livres sont obligatoires (journal, grand livre, balance, livre d'inventaire…) et sous quelle
   forme pour une tenue informatisée ?
2. Les garanties prévues — ajout seul, numérotation sans trou par journal et exercice, chaînage par
   empreinte, contre-passation au lieu de suppression, clôture mensuelle et annuelle — suffisent-elles ?
   Que manque-t-il (procédure de clôture, « validation » des écritures, piste d'audit) ?
3. Une écriture générée automatiquement depuis une pièce du RUN, sans intervention humaine, est-elle
   recevable, ou faut-il une validation humaine par lot ?
4. Durée de conservation des écritures et des pièces (rejoint docs/28 § 1.3, question 6).

**E6 — Exercice.** Exercice civil obligatoire ou au choix ? Premier exercice plus court ou plus long ?

**E7 — Clôture et à-nouveaux.** Quels comptes reporte-t-on ? Comment traiter le résultat avant
affectation ? Les à-nouveaux doivent-ils être détaillés par facture ouverte pour les tiers ?

**E8 — États financiers.** Modèles du bilan, du compte de résultat et du tableau des flux de trésorerie
(rubriques et plages de comptes) ; méthode du tableau des flux ; présentation exigée pour une PME.

**E9 — Régime applicable.** Système normal ou système minimal de trésorerie selon la taille de
l'entité : à partir de quels seuils, et que faudrait-il adapter ?

**E10 — Format d'export.** Quel format votre logiciel importe-t-il (colonnes, séparateur, encodage,
format de date et de montant) ? Le CSV proposé au § 9 vous convient-il ?

**Au juriste (s'ajoutent à docs/28 § 1.3)** — **J1** : un logiciel qui génère des écritures et des projets
d'états pour ses clients exerce-t-il, en RDC ou dans la zone OHADA, une activité réservée aux
professionnels de la comptabilité ? Quelles mentions protègent l'éditeur (le bandeau du § 10
suffit-il) ? **J2** : l'accès d'un expert-comptable externe aux livres du client (rôle EXP) appelle-t-il
une formalité ou une clause particulière ?

## Découpage en lots parallélisables (worktrees séparés)

Règle d'ADR-0011 et d'ADR-0012 § 9 : **un fichier = un seul écrivain** par lot ; les fichiers partagés ne
reçoivent que des **ajouts** d'une ligne ou d'un bloc, sous un commentaire `// ADR-0049 — <lot>`.

| Lot | Contenu | Fichiers possédés (probables) | Critères | Tests | Dépend de |
|---|---|---|---|---|---|
| **K0 — Socle RBAC, rôle, contrats** (petit, en premier) | cinq actions, rôle `external_accountant`, matrices, dépendances, treizième domaine, `APPROVAL_ACTIONS`, `PLATFORM_FORBIDDEN_ACTIONS`, `OWNER_ONLY_ROLES`, `manualEntryDecision`, `ruleSetDecision` ; contrats partagés | `apps/api/src/authz/permissions.ts`, `permissions.test.ts`, `overrides.test.ts`, `__tests__/rbac-matrix.e2e.test.ts` ; `packages/shared/src/accounting/**`, `packages/shared/package.json` (un export) ; `apps/web/src/lib/api.ts` (`OrgAction`, rôle) ; `docs/12` (statut « appliqué ») | 1, 11 (fonctions pures) | matrice 918 ; dépendances ; tables de vérité | — |
| **K1 — Pack de plan comptable (données)** | YAML v1 `draft` (classes, candidats `to_confirm`, sources), schéma, `parseChartPack`, `validateChartPack`, modèles d'états `to_confirm`, règles proposées | `packages/engine/src/accounting/chart/**`, `packages/engine/src/accounting/packs/*.yaml` | 17 | vitest | — (parallèle à K0) |
| **K2 — Moteur d'écritures** | `entriesFor…`, `resolveRule`, `applyRate`, `checkEntry`, `reverseEntry`, clés de source | `packages/engine/src/accounting/entries/**`, `accounting/rules/**`, `accounting/index.ts` (crée), **une ligne** dans `packages/engine/src/index.ts` | 3 à 9 (calcul) | vitest, propriétés | — (parallèle) |
| **K3 — Moteur de restitution** | grand livre, balances, lettrage, états, réserves, à-nouveaux, reprise, rapprochement, lignes d'export | `packages/engine/src/accounting/{ledger,statements,closing,reconciliation,export}/**` ; une ligne dans `accounting/index.ts` | 9, 12 à 16 (calcul) | vitest | — (parallèle ; types de K2 par fichier `accounting/types.ts` créé par K2, lu seulement) |
| **K4 — API référentiel et réglages** | réglages, activation, simulation, packs (lecture, chargement plateforme), plan de l'organisation, règles (validation), journaux, taux, exercices et périodes (structure) | `apps/api/src/accounting/{settings,chart,rules,journals,rates,periods}/**`, `accounting/accounting.module.ts` (crée), `apps/api/src/app.module.ts` (**une ligne**) ; e2e `accounting-settings.e2e` | 2 | e2e | K0, K1 |
| **K5 — API écritures et synchronisation** | `accounting_entries`, chaîne, compteurs, modèles en lecture des sources, `accounting.sync`, « À comptabiliser », opérations diverses, contre-passation, lettrage, régénération | `apps/api/src/accounting/{entries,sources,sync,pending,lettering}/**` ; une ligne dans `accounting.module.ts` ; e2e `accounting-sync-*.e2e`, `accounting-entries.e2e` | 3 à 11 | e2e (égalité des factures, pas de double comptage) | K2, K4 |
| **K6 — API restitution, clôtures et exports** | grand livre, balances, états, clôtures, à-nouveaux, rapprochement avec le réalisé, exports (CSV, `.xlsx`, PDF avec bandeau), audit, limite de débit | `apps/api/src/accounting/{reports,statements,closing,reconciliation,exports}/**` ; une ligne dans `accounting.module.ts` ; e2e `accounting-periods.e2e`, `accounting-exports.e2e`, `accounting-actuals-isolation.e2e` | 12, 14 à 16 | e2e | K3, K5 |
| **K7 — Reprise de l'existant** | proposition d'à-nouveaux (lecture des moteurs `treasury` et `receivables`, des restes à payer R3), saisie et validation de la reprise | `apps/api/src/accounting/opening/**` ; une ligne dans `accounting.module.ts` ; e2e `accounting-opening.e2e` | 13 | e2e | K5 |
| **K8 — Web `/comptabilite`** | navigation, coquilles, vue d'ensemble, écritures, grand livre, balance, auxiliaires et lettrage, états avec bandeau, clôtures, exports, assistant d'activation, réglages ; test des mots interdits | `apps/web/src/app/(app)/comptabilite/**` ; `apps/web/src/lib/api-accounting.ts` ; `_components/nav-model.ts` (+ test) ; `apps/web/src/lib/routes.ts` (+ test) | écrans § 13, 14 | modèles purs, nav, routes | K0 (coquilles) ; données avec K4 à K7 |

### Zones de conflit entre lots

| Fichier | Lots | Règle |
|---|---|---|
| `apps/api/src/authz/permissions.ts`, `apps/web/src/lib/api.ts` | **K0 seul** | aucun autre lot n'y écrit |
| `packages/engine/src/index.ts` | **K2 seul** | une ligne d'export `accounting` |
| `packages/engine/src/accounting/index.ts`, `accounting/types.ts` | K2 crée ; K1, K3 ajoutent une ligne d'export chacun | sous leur commentaire ; `types.ts` modifié par K2 seul |
| `apps/api/src/app.module.ts` | **K4 seul** | une ligne |
| `apps/api/src/accounting/accounting.module.ts` | K4 crée ; K5, K6, K7 ajoutent une ligne chacun | sous leur commentaire |
| `apps/api/src/authz/routes-coverage.test.ts` | K4, K5, K6, K7 | un bloc par lot, **à la fin** |
| `apps/api/src/{sales,treasury,purchases,stock,assets,hr,actuals}/**`, `packages/engine/src/{invoice-totals,treasury,receivables,purchases,stock}/**` | **aucun** | lecture seule, par modèles en lecture déclarés dans `accounting/sources/**` et appels aux fonctions exportées du moteur |
| `packages/shared/src/accounting/**` | K0 crée ; K4 à K7 **ajoutent** des fichiers | `index.ts` : une ligne d'export par lot |
| `apps/web/src/app/(app)/_components/nav-model.ts`, `apps/web/src/lib/routes.ts` | **K8 seul** | — |
| `docs/12`, `docs/15`, `docs/16`, `docs/28`, index des ADR | ce lot de documentation ; chaque lot passe sa ligne « proposé » à « implémenté » | une section par lot |

### Ordre de fusion conseillé

```
K0 ──┬─────────── K4 ── K5 ──┬── K6
K1 ──┘                       └── K7
K2 ───────────────────── (K5)
K3 ───────────────────────────── (K6)
K8 (coquilles dès K0 ; écrans au fil de K4 à K7)
```

1. **K0**, **K1**, **K2**, **K3** en parallèle (les moteurs ne dépendent d'aucun contrat d'API).
2. **K4** ; squelette de **K8**.
3. **K5** (après K2 et K4) : la simulation devient vivante.
4. **K6** et **K7** en parallèle (après K5 ; K6 après K3).
5. Écrans **K8**.

Chemin critique : K0 → K4 → K5 → K6. **Le mode `active` reste inaccessible en production tant que le pack
n'est pas `approved`** : tous les lots peuvent être livrés et essayés en simulation avant la réponse de
l'expert.

## Décisions ouvertes — elles appartiennent à la dirigeante

Chacune a une **valeur par défaut**, la plus prudente, appliquée si rien n'est tranché.

1. **Actions** : cinq actions et la matrice du § 8.1. *Défaut : oui.*
2. **Rôle Expert-comptable externe** (`external_accountant`, O7), attribuable par le seul Propriétaire.
   *Défaut : oui, lecture et export seulement.*
3. **L'expert voit-il les pièces complètes** (PDF des factures, factures fournisseurs) ? *Défaut : non ; il
   voit la copie d'affichage portée par l'écriture ; lui donner `sales.read` et `purchase.read` par ajout
   (ADR-0041) dès l'activation des écarts.*
4. **Monnaie de tenue.** *Défaut : aucune ; choix exigé à l'activation, après avis de l'expert (E3),
   verrouillé après la première écriture.*
5. **Activation sans pack relu par un expert mandaté par l'éditeur.** *Défaut : impossible ; seul le mode
   simulation existe.*
6. **Déclaration de relecture des règles par l'expert de l'organisation**, exigée pour les valider.
   *Défaut : exigée (déclarative, non vérifiée par Lalanda).*
7. **TVA déclarée récupérée.** *Défaut : non ; elle reste dans la charge tant qu'une règle validée ne dit
   pas autre chose, et jamais pour une organisation non assujettie.*
8. **Écritures générées validées sans geste humain.** *Défaut : oui, sous règles validées (l'humain valide
   les règles, pas chaque écriture) ; à revoir selon E5.3.*
9. **Paiements déclarés à l'émission d'une facture** (invisibles de la trésorerie). *Défaut : compte
   d'attente et réserve ; la correspondance « moyen de règlement → compte de trésorerie » se règle dans
   les règles ; corriger la trésorerie relève d'un amendement d'ADR-0031/ADR-0034.*
10. **Pièce modifiée après clôture du mois.** *Défaut : contre-passation au premier jour ouvert, signalée.*
11. **Réouverture d'un mois ou d'un exercice.** *Défaut : Propriétaire seul, motif, audit ; rouvrir un
    exercice contre-passe ses à-nouveaux.*
12. **Écarts de change.** *Défaut : compte d'attente « écarts de change à qualifier » ; aucune
    réévaluation de clôture.*
13. **Autres entrées et sorties de trésorerie** (apports, prêts, prélèvements). *Défaut : compte d'attente ;
    reclassement par opération diverse.*
14. **Format d'export.** *Défaut : CSV aux colonnes du § 9 + balance et grand livre CSV et `.xlsx` ; à
    remplacer par le format de l'expert (E10).*
15. **Pont comptabilité → réalisé.** *Défaut : non ; rapprochement affiché seulement.*
16. **Import d'écritures ou d'une balance d'un autre logiciel.** *Défaut : non ; la reprise se fait par
    à-nouveaux saisis.*
17. **Écritures de stock** (inventaire permanent). *Défaut : éteintes ; refusées tant que E4 n'est pas
    tranchée.*
18. **Amortissements.** *Défaut : hors périmètre ; aucune dotation calculée.*
19. **Exercice.** *Défaut : année civile (début en janvier), à confirmer (E6).*
20. **Offres** (docs/13). *Défaut : comptabilité réservée aux offres payantes, mode simulation ouvert à
    toutes ; à arbitrer avec le reste du tableau.*
21. **Rappels** (brief du matin, cloche) : solde d'attente, taux manquants, mois à clôturer. *Défaut : aucun
    dans ce périmètre ; lot futur (port `ACCOUNTING_SOURCE`, règle du brief).*

## Liens

- [ADR-0007](ADR-0007-generation-pdf-excel.md) ; [ADR-0010](ADR-0010-excel-export-only.md) ;
  [ADR-0011](ADR-0011-contrats-integration-s18.md) ; [ADR-0012](ADR-0012-modele-rbac-complet.md)
  (amendé) ; [ADR-0018](ADR-0018-trajectoire-erp-trois-modules.md) (précisé) ;
  [ADR-0020](ADR-0020-ordonnanceur-mongodb.md) ; [ADR-0021](ADR-0021-modules-erp-et-identite-fiscale.md)
  (fiche fiscale, `fiscal.manage`) ; [ADR-0022](ADR-0022-clients-catalogue-et-calcul-des-factures.md)
  à [ADR-0028](ADR-0028-modeles-de-facture-et-identite.md) (ventes, **lues seulement**) ;
  [ADR-0031](ADR-0031-encaissements-et-realise.md) (lu) ; [ADR-0034](ADR-0034-depenses-et-tresorerie.md)
  (lu) ; [ADR-0038](ADR-0038-navigation-par-modules-et-initiatives.md) ;
  [ADR-0041](ADR-0041-autorisations-par-membre.md) (étendu) ;
  [ADR-0043](ADR-0043-editeur-go-freelance-sarlu.md) ; [ADR-0044](ADR-0044-achats-et-fournisseurs.md)
  (lu) ; [ADR-0045](ADR-0045-ressources-humaines.md) (aucune paie) ;
  [ADR-0046](ADR-0046-stocks-equipements-documents.md) (refus de la comptabilité levé ; lu).
- [docs/00](../00-CHARTE-PRODUIT.md) ; [docs/08](../08-PREVISIONNEL-REALISE.md) ;
  [docs/09](../09-COUNTRY-PACKS.md) ; [docs/12](../12-ROLES-PERMISSIONS.md) ;
  [docs/15](../15-DATABASE.md) ; [docs/16](../16-API.md) ; [docs/21](../21-MOTEUR-FINANCIER.md) ;
  [docs/28](../28-CONFORMITE-LEGALE.md).
- Texte de référence à joindre au pack : Acte uniforme OHADA relatif au droit comptable et à l'information
  financière (26 janvier 2017) et Système comptable OHADA annexé (Plan comptable général OHADA).
- Code existant lu : `apps/api/src/sales/invoices/` (`invoice.schema.ts`, `invoice.types.ts`,
  `journal-export.ts`), `sales/receipts/`, `apps/api/src/treasury/`, `apps/api/src/purchases/invoices/`,
  `purchases/payments/`, `apps/api/src/stock/`, `packages/engine/src/{invoice-totals,treasury,receivables,
  parameter-packs,amortissements,etats-financiers}/`, `apps/api/src/authz/permissions.ts`.
- Code à créer : `apps/api/src/accounting/`, `packages/engine/src/accounting/`,
  `packages/shared/src/accounting/`, `apps/web/src/app/(app)/comptabilite/`.
