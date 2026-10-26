# ADR-0031 — Encaissements, statut de règlement et pont vers le réalisé

Statut : Proposed
Date : 2026-10-21 (amendé le 2026-10-26)
Décideurs : Gracy Omokoso (dirigeante) ; CTO Lalanda (contrat technique). Les points
comptables sont soumis à l'expert-comptable de la dirigeante (§ Décisions ouvertes).

> **Complète [ADR-0023](ADR-0023-factures-et-avoirs.md) § S25e.13** (« Encaissements et
> réalisé — reportés, préparés ») et **amende [ADR-0012](ADR-0012-modele-rbac-complet.md)**
> (vingtième action `sales.receipt`). Applique la règle d'[ADR-0018](ADR-0018-trajectoire-erp-trois-modules.md) :
> « RUN alimente le réalisé, jamais le plan figé ».

## Contexte

Le module RUN émet des factures et des avoirs (ADR-0023) ; chaque facture déclare, au gel,
ses **paiements** (somme = total, vérifiée par le moteur) et la part `CREDIT`, c'est-à-dire
**non réglée** (`amountOnCredit`, ADR-0023 § S25e.8). Ce qui manque :

1. enregistrer l'argent **reçu ensuite** sur cette part non réglée (l'encaissement) ;
2. dire, pour chaque facture, où en est son règlement ;
3. relier RUN au **réalisé** du prévisionnel BUILD (`actual_periods`, docs/08), ce
   qu'ADR-0018 appelle la synchronisation raisonnée : hypothèses, prévisions, réalisés et
   suggestions de l'IA restent distincts et étiquetés ; chaque module fonctionne seul.

### Ce que les documents disent déjà (sources de cet ADR)

| Règle | Source |
|---|---|
| Encaissements : date, mode, montant et devise, factures lettrées ; ils soldent `amountOnCredit` ; aucun appel DGI | ADR-0023 § S25e.13 |
| `CREDIT` = part non réglée d'une facture | ADR-0023 § S25e.8, docs/21 § Contrôles des factures |
| Les sept modes e-DEF : `ESPECES`, `VIREMENT`, `CARTEBANCAIRE`, `MOBILEMONEY`, `CHEQUES`, `CREDIT`, `AUTRE` | ADR-0023 § S25e.9 (`PAYMENT_METHODS`) |
| Chiffre d'affaires réalisé = somme des **bases HT** des groupes qui forment un chiffre d'affaires (exclus **H, I, J, L, N** et toute TVA), factures finales moins avoirs finaux, par **mois civil d'`issuedAt`**, dans la devise du projet ; valeur étiquetée `source: 'run.sales'`, jamais écrite dans le plan validé ni produite par l'IA | ADR-0023 § S25e.13 |
| RUN agrège vers `actual_periods` ; aucun module RUN n'écrit dans un plan | ADR-0018 § Règles transverses |
| Chaque donnée réalisée conserve source, auteur, date, devise, taux de conversion | docs/08 § Saisie et import |
| Les périodes clôturées sont protégées ; les imports s'annulent sans effacer d'autres données | docs/08 § Critères d'acceptation |
| Ne jamais fabriquer un chiffre : un écart impossible se dit, il ne se comble pas | docs/08 § Règle cardinale |
| Les dates d'encaissement et de décaissement déterminent la trésorerie | docs/21 § Périodes |
| Saisie du réalisé bornée aux lignes du **compte d'exploitation** (feuille `activite`) du plan validé courant | docs/08 § Conventions MVP, 4 |
| Le moteur est l'unique source des calculs ; aucune opération sur un montant dans l'API | CLAUDE.md, ADR-0023 § O4 |
| Mois civil de Kinshasa (UTC+1) | ADR-0027 (`fiscalPeriodOf`) |

Ce qui **n'est pas** sourcé (traitement des acomptes, imputation des avoirs, écart de change,
choix du taux, échéance par défaut, réalisé de trésorerie) est listé en décisions ouvertes ;
quand le logiciel doit pourtant se comporter d'une façon, il prend la **plus prudente** et le
dit à l'écran.

## Options considérées

### O1 — Où vit l'encaissement

1. **Dans la facture** (tableau `receipts` sur `sales_invoices`). Écarté : la facture est
   figée (`contentSha256`) ; un encaissement multi-factures n'aurait pas de maison.
2. **Collection `sales_receipts`**, un document par encaissement, avec ses lettrages vers une
   ou plusieurs factures ; l'échéance et le verrou de concurrence dans
   `sales_invoice_settlements`, un document par facture. **Retenu** (nom annoncé par ADR-0018).

### O2 — Où se calculent les soldes, les statuts et les agrégats

1. Dans l'API. Écarté (CLAUDE.md).
2. **Dans le moteur, module pur `packages/engine/src/receivables/`**, arithmétique exacte en
   chaînes décimales comme `invoice-totals` (qu'il ne modifie pas). **Retenu.**

### O3 — Permission

1. `sales.manage`. Écarté : l'Administrateur la détient ; enregistrer de l'argent reçu est un
   acte de trésorerie, comme émettre engage le contribuable.
2. `sales.invoice`. Écarté : son sens est « émettre et normaliser » ; un même rôle pourra un
   jour encaisser sans émettre (caissier).
3. **Vingtième action `sales.receipt`** (« Enregistrer et annuler des encaissements »).
   **Retenu.**

### O4 — Valeur issue des ventes et saisie manuelle

1. Valeur RUN librement modifiable à la main. Écarté : elle cesserait d'être un réalisé
   « issu des ventes » sans que personne ne le voie.
2. Modifiable avec écart tracé. Non retenu à ce stade : docs/08 cite « ajustement autorisé »
   parmi les sources sans en fixer la règle (décision ouverte n° 6).
3. **Non modifiable à la main tant que le pont est actif sur cette ligne** ; pour corriger,
   on corrige la vente (avoir), source du chiffre. **Retenu.**

## Décision

### 1. Encaissement (`sales_receipts`)

| Champ | Règle |
|---|---|
| `receivedOn` | date civile `AAAA-MM-JJ` (Kinshasa) ; ni future, ni antérieure à l'émission d'une facture lettrée (`RECEIPT_BEFORE_INVOICE`) |
| `amount`, `currency` | chaîne décimale > 0, deux décimales au plus ; `CDF` ou `USD` |
| `method` | l'un des **six** moyens de règlement e-DEF : `ESPECES`, `VIREMENT`, `CARTEBANCAIRE`, `MOBILEMONEY`, `CHEQUES`, `AUTRE`. `CREDIT` est refusé : il signifie « non réglé » |
| `reference` | facultative (n° de virement, de chèque, de transaction mobile), 100 caractères |
| `accountId` | facultatif : compte de trésorerie qui a reçu l'argent, réservé au module Dépenses et trésorerie (ADR-0034). Identifiant opaque, non vérifié tant que ce module n'est pas intégré |
| `allocations` | 1 à 20 lettrages `{ invoiceId, amount }`, factures distinctes ; **somme des lettrages = montant** (pas d'encaissement non lettré, décision ouverte n° 4) |
| `status` | `recorded` ou `cancelled` (annulation motivée, jamais d'effacement) |

Une facture lettrée est **finale** (`issued` ou `normalized`), de la série réelle (une facture
de la série d'essai DGI n'a pas de valeur), **n'est pas un avoir**, appartient à
l'organisation (sinon 404) et est **dans la devise de l'encaissement**
(`RECEIPT_CURRENCY_MISMATCH`) : aucun taux n'est appliqué, l'encaissement d'une facture USD
en CDF reste une décision ouverte (n° 3). Chaque lettrage est au plus égal au **reste à
encaisser** (`RECEIPT_ALLOCATION_EXCEEDS_BALANCE`). Modifier un encaissement (corps complet,
`expectedRevision`) ou l'annuler rejoue ces contrôles. L'écriture se fait dans une
transaction MongoDB qui incrémente la révision de règlement de chaque facture lettrée : deux
encaissements simultanés sur la même facture ne peuvent pas la dépasser (conflit d'écriture,
la seconde transaction est rejouée et voit la première). Chaque écriture est journalisée
(`audit_events` : `sales.receipt.recorded|updated|cancelled`).

### 2. Statut de règlement d'une facture

Calculé par le moteur (`computeSettlement`), jamais stocké :

```
dû à crédit      = amountOnCredit (part CREDIT déclarée au gel)
avoirs imputés   = Σ part CREDIT des avoirs finaux rattachés à la facture
encaissé         = Σ lettrages des encaissements non annulés
reste à encaisser = max(0, dû − avoirs imputés − encaissé)
```

| Statut | Condition |
|---|---|
| `paid` (payée) | reste = 0 — y compris une facture réglée entièrement à l'émission |
| `partially_paid` (partiellement payée) | 0 < avoirs imputés + encaissé < dû |
| `unpaid` (non payée) | rien d'imputé ni d'encaissé |
| `overdue` (en retard) | reste > 0 **et** échéance renseignée **et** dépassée (date de Kinshasa) |

Le dépassement (avoir à crédit sur une facture déjà réglée) n'est jamais compensé
silencieusement : il est rendu comme `creditBalance` (« crédit client »), à traiter hors
logiciel (décision ouverte n° 2). Brouillons, pro forma, factures en attente de
normalisation et avoirs n'ont pas de statut de règlement (`not_applicable`).

**Échéance : elle n'existait pas.** Proposé et livré : une **date d'échéance facultative par
facture**, saisie après l'émission (`sales.manage`), conservée **hors du document figé**
(`sales_invoice_settlements.dueDate`) : elle ne change ni l'empreinte, ni le PDF, ni ce qui
part à la DGI. Sans échéance, une facture n'est **jamais** « en retard » : le logiciel
n'invente pas de délai de paiement. Un délai par défaut de l'organisation (30 jours ?) est la
décision ouverte n° 5.

### 3. Pont vers le réalisé BUILD

**Désactivé par défaut, par organisation** (`run_actuals_bridges`). L'activer exige que
l'utilisateur choisisse lui-même trois paramètres (ADR-0023 § S25e.13 : « restent à
choisir ») ; le logiciel n'en devine aucun :

- le **projet** qui reçoit le réalisé (de la même organisation) ;
- la **ligne du chiffre d'affaires** : une ligne monétaire du compte d'exploitation du plan
  validé courant du projet (`NO_APPROVED_PLAN`, `UNKNOWN_LINE` sinon) ;
- le **mois civil qui ouvre l'exercice 1** (`AAAA-MM`) : le mois civil `M` tombe dans
  l'exercice `1 + ⌊(M − début) / 12⌋`, mois `1 + (M − début) mod 12` ; hors exercices 1 à 5,
  il n'est pas reporté (`OUTSIDE_PLAN_HORIZON`).

**Ce que reçoit le plan** (moteur, `planRunActuals`) :

| Donnée RUN | Ligne du réalisé | Période | Statut |
|---|---|---|---|
| Bases HT des groupes A–G, K, M, O, P des factures finales `FV`, `EV`, moins celles des avoirs finaux `FA`, `EA` | ligne de CA choisie | mois civil d'`issuedAt` (Kinshasa) | **tranché** (S25e.13) |
| TVA, groupes H, I, J, L, N | aucune | — | **tranché** : hors CA (S25e.13) |
| Factures d'acompte `FT`, `ET` | aucune, comptées à part et signalées | — | décision ouverte n° 1 |
| Encaissements | aucune ligne du plan aujourd'hui ; agrégés par mois et devise et affichés | `receivedOn` (docs/21) | décision ouverte n° 7 |
| Factures de la série d'essai DGI | aucune | — | **tranché** : sans valeur fiscale |

**Devise.** Le moteur ne multiplie par **aucun** taux. Pour chaque document il retient : les
montants du document s'il est dans la devise du projet ; sinon, si le projet est en `CDF` et
que la facture est normalisée, ses montants **CDF normalisés** (les seuls qui ont valeur
fiscale, docs/21) ; sinon le document n'est pas convertible. Un mois qui contient un seul
document non convertible n'est **pas** reporté (`CURRENCY_NOT_CONVERTIBLE`, documents
listés) : un chiffre partiel présenté comme le réalisé serait fabriqué. Le choix d'un taux
(BCC du jour de la facture ? taux DGI ?) est la décision ouverte n° 3.

**Écriture et idempotence** (`POST /sales/actuals-bridge/sync`). La synchronisation recalcule
tout depuis les ventes et compare, période par période, à ce que porte `actual_periods` :

- valeur identique (même empreinte) → rien n'est écrit (`unchanged`) ; rejouer la
  synchronisation ne change rien ;
- période **ouverte**, ligne vide ou déjà issue des ventes → écrite (`written`), avec
  l'étiquette `sources[ligne] = { source: 'run.sales', at, by, version, documents,
  fingerprint }` ;
- période **clôturée** → jamais modifiée ; l'écart entre la valeur stockée et la valeur des
  ventes est rendu (`PERIOD_CLOSED`) ;
- ligne portant une **saisie manuelle** → jamais écrasée (`MANUAL_VALUE_PRESENT`) :
  l'utilisateur efface sa saisie s'il veut que les ventes l'alimentent ;
- une valeur issue des ventes dont la période n'a plus de vente (changement de début
  d'exercice) est retirée d'une période ouverte (`removed`).

`dryRun: true` rend le même rapport sans rien écrire. Chaque synchronisation qui écrit est
journalisée (`run.actuals.synced`).

**Traçabilité et verrou.** Une saisie manuelle porte désormais `sources[ligne] = { source:
'manual', at, by }`. Tant que le pont est **actif** sur `(projet, ligne)`, la saisie manuelle
de cette ligne est refusée (`409 LINE_FED_BY_RUN`), effacement compris. Désactivé, la ligne
redevient saisissable ; la valeur reprise à la main garde la trace de la valeur des ventes
qu'elle remplace (`replaced`).

**Chaque module fonctionne seul.** RUN sans BUILD : encaissements, statuts et totaux mensuels
ne demandent ni projet ni plan ; le pont reste `not_configured` et la synchronisation répond
`409 BRIDGE_NOT_CONFIGURED`. BUILD sans RUN : pont désactivé, le réalisé se saisit à la main
exactement comme avant. Le plan validé n'est **jamais** écrit.

### 4. Permissions

| Action | PRO | ADM | DIR | CPT | ANA | CDP | CON | LEC |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| `sales.receipt` | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |

Plateforme : interdite à tous les rôles (matrice), sans entrer dans les interdits absolus.

| Route | Permission |
|---|---|
| `GET /sales/receipts` · `GET /sales/receipts/:id` · `GET /sales/receipts/summary` | `sales.read` |
| `POST /sales/receipts` · `PUT /sales/receipts/:id` · `POST /sales/receipts/:id/cancel` | `sales.receipt` |
| `GET /sales/settlements?invoiceIds=…` ou `?open=true` · `GET /sales/settlements/:invoiceId` | `sales.read` |
| `PUT /sales/settlements/:invoiceId/due-date` | `sales.manage` |
| `GET /sales/actuals-bridge` | `sales.read` |
| `GET /sales/actuals-bridge/candidates` · `PUT /sales/actuals-bridge` · `POST /sales/actuals-bridge/sync` | `actuals.import` **et** `sales.read` |

### 5. Moteur

`packages/engine/src/receivables/` (`RECEIVABLES_VERSION = '1.0.0'`), fonctions pures, sans
horloge (la date du jour est un paramètre) : `checkReceipt`, `computeSettlement`,
`aggregateReceiptsByMonth`, `revenueAmountsFor`, `aggregateRevenueByMonth`,
`fiscalPeriodOfMonth`, `planRunActuals`. Arithmétique exacte sur les chaînes décimales
(réutilise l'arithmétique interne d'`invoice-totals` sans la modifier).

## Amendement du 26 oct. 2026 — intégration avec ADR-0034 (Dépenses et trésorerie)

Les deux modules RUN ont été livrés en parallèle puis fusionnés. Ce qui change ici :

1. **Un seul vocabulaire d'origine.** `actual_periods.sources[ligne]` est une union fermée :
   `manual` (avec `replaced`, la valeur RUN remplacée, de **l'une ou l'autre** source),
   `run.sales` (ce pont) et `run.expenses` (report des dépenses, ADR-0034 § 5). Les deux
   ponts écrivent la même forme : `at`, `by`, `version`, `calendarMonth`, `documents`,
   `fingerprint` (`RunActualValueSource`, `apps/api/src/actuals/actual-period.schema.ts`).
2. **Un seul verrou.** `RunActualsLocks` réunit les lignes des deux ponts actifs ; la saisie
   manuelle de l'une d'elles est refusée (`409 LINE_FED_BY_RUN`), et la réponse dit quel pont
   l'alimente (`details.sources[ligne]` : `run.sales` ou `run.expenses`).
3. **Un seul rattachement « projet + mois d'ouverture de l'exercice 1 »** (décision ouverte
   n° 10 d'ADR-0034, tranchée). Deux valeurs différentes rangeraient une vente et une dépense
   du même mois civil dans deux mois d'exercice différents : le réalisé serait incohérent.
   Le rattachement vit donc une fois, dans `run_actuals_bridges` (`projectId`,
   `exerciseStart`), lu par les deux ponts (`RunLinkService`). Chaque pont garde son
   interrupteur et sa cible (ici `enabled` et `revenueLineId`). Le régler depuis l'un le
   règle pour l'autre ; c'est **refusé tant que l'autre pont est actif**
   (`409 RUN_LINK_IN_USE`, `details.otherBridge`) : ses valeurs déjà reportées changeraient
   de projet ou de mois d'exercice sans décision.
4. **Une ligne, un pont.** La ligne de chiffre d'affaires ne peut pas être une ligne visée par
   la correspondance des dépenses actives, et inversement (`409 LINE_FED_BY_OTHER_BRIDGE`). La
   synchronisation des ventes rend `OTHER_SOURCE_PRESENT` (jamais d'écrasement) si une
   valeur `run.expenses` occupe la case.
5. **`accountId` n'est plus opaque.** C'est un compte `treasury_accounts` de l'organisation
   (`404 TREASURY_ACCOUNT_NOT_FOUND` sinon), actif (`ACCOUNT_INACTIVE`), de la devise de
   l'encaissement (`400 RECEIPT_ACCOUNT_CURRENCY_MISMATCH`, aucun taux) et ouvert à la date de
   réception (`400 RECEIPT_BEFORE_ACCOUNT_OPENING`) — mêmes règles qu'une dépense. Un
   encaissement rattaché entre dans le solde du compte ; sans compte, il reste hors des
   soldes. La trésorerie lit encaissements et restes à encaisser en lecture seule
   (`SalesTreasuryFeed`) : voir ADR-0034, amendement du même jour.

Décisions ouvertes inchangées ; la n° 7 (réalisé de trésorerie) reste ouverte : les
encaissements alimentent les soldes et la prévision de trésorerie, toujours aucune ligne du
plan.

## Conséquences

- Nouvelles collections : `sales_receipts`, `sales_invoice_settlements`, `run_actuals_bridges` ;
  champ additionnel `sources` sur `actual_periods` (absent des anciennes périodes : lu comme
  « saisie manuelle d'origine inconnue »).
- Écrans : onglet **Encaissements** de l'espace Ventes (liste, saisie, annulation, totaux
  mensuels par devise, réglage et lancement du pont) ; **pastille de règlement** dans la liste
  des factures.
- Vingtième action RBAC ; docs/12 et la matrice de test sont amendées.

## Plan de validation

Tests du moteur (soldes, statuts, agrégats par mois et devise, conversion de période,
réalisé du plan, devises non convertibles) ; e2e API (encaissement partiel puis total,
multi-factures, avoir imputé, isolation, RBAC, synchronisation idempotente, période clôturée,
saisie manuelle protégée, organisation sans plan) ; web (modèle de l'écran). Essai de la
dirigeante : une facture à crédit, deux encaissements, une échéance dépassée, puis le pont
activé sur un projet de test.

## Décisions ouvertes — pour la dirigeante et son expert-comptable

1. **Factures d'acompte (`FT`, `ET`)** : font-elles partie du chiffre d'affaires du mois de
   l'acompte, ou seulement de la facture finale ? Aujourd'hui **exclues** du réalisé et
   signalées.
2. **Avoir à crédit** : sa part `CREDIT` est imputée sur le reste à encaisser de la facture
   d'origine (lecture proposée de « part non réglée »). Si la facture était déjà réglée, le
   « crédit client » qui en résulte est-il remboursé, ou imputé sur une autre facture ?
3. **Taux de change** : une facture en USD réglée en CDF (ou l'inverse), et le réalisé d'un
   projet dans une autre devise que la facture. Quel taux (BCC du jour de la facture, du jour
   de l'encaissement, taux DGI) ? Où se constate l'écart de change ? Aujourd'hui : refusé
   (encaissement) ou non reporté (réalisé).
4. **Encaissement non lettré** (avance d'un client sans facture) : à autoriser ?
5. **Échéance par défaut** : un délai de paiement de l'organisation (ex. 30 jours) doit-il
   s'appliquer à chaque facture à crédit ?
6. **Ajustement du réalisé issu des ventes** : faut-il permettre de corriger à la main avec un
   écart tracé (docs/08 « ajustement autorisé »), plutôt que par un avoir ?
7. **Réalisé de trésorerie** : les encaissements doivent-ils alimenter une ligne de
   trésorerie du plan ? Il faut d'abord que le réalisé accepte des lignes hors compte
   d'exploitation (docs/08, convention 4).
8. **Taxe spécifique** : la base HT DGI d'un groupe inclut la taxe spécifique (droits
   d'accises) ; S25e.13 retient cette base telle quelle. L'expert-comptable confirme-t-il
   qu'elle fait partie du chiffre d'affaires ?
9. **L'Administrateur** peut-il enregistrer un encaissement ? Proposé : non, comme
   `sales.invoice`.

## Liens

- [ADR-0012](ADR-0012-modele-rbac-complet.md) — RBAC (amendé : 20ᵉ action) ;
  [ADR-0018](ADR-0018-trajectoire-erp-trois-modules.md) ; [ADR-0023](ADR-0023-factures-et-avoirs.md)
  § S25e.8, S25e.13 ; [ADR-0027](ADR-0027-numerotation-des-factures.md).
- [docs/08](../08-PREVISIONNEL-REALISE.md) ; [docs/12](../12-ROLES-PERMISSIONS.md) ;
  [docs/21](../21-MOTEUR-FINANCIER.md) ; [docs/22](../22-WORKFLOWS.md).
- Code : `packages/engine/src/receivables/`, `apps/api/src/sales/receipts/`,
  `apps/api/src/actuals/run-bridge/`, `apps/web/src/app/(app)/ventes/encaissements/`.
