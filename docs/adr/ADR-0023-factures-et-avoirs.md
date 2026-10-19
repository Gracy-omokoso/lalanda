# ADR-0023 — Factures et avoirs, en deux temps : document commercial puis normalisation (lot S25e)

Statut : Proposed
Date : 2026-10-19
Décideurs : Gracy Omokoso (décisions produit, dont la décision du 19 oct. 2026 sur la devise) ;
CTO Lalanda (contrat technique)

> **Amende ADR-0022.** (1) § S25c.3 : le champ `currency` de `catalog_items` accepte
> désormais `'CDF' | 'USD'` (au lieu de `'CDF'` seul) ; le prix d'un article s'entend dans
> sa devise. (2) La décision ouverte n° 2 d'ADR-0022 (« prix en dollars ? ») est
> **tranchée** par la décideuse (ci-dessous). Chantier E4 du présent ADR.
>
> **Amendé par [ADR-0024](ADR-0024-normalisation-dgi.md) (19 oct. 2026).** Ajouts aux
> fichiers figés au jalon E0 : `normalization.port.ts` (phases et champs de
> `InvoiceNormalizationState`), `invoice.contract.ts` (vue `NormalizationView`, trois
> événements de journal, deux codes 409, `DgiExchangePage`) ; trois méthodes
> d'`InvoiceNumberingService` (`holdLease`, `dropLease`, `abandon`). Aucun champ retiré,
> aucun sens changé.

## Contexte

### Où l'on en est

Priorité : l'**homologation DGI** (32 cas de test officiels, 29 factures et 3 rapports,
chacun en mode de prix TTC **et** HT). Plan RUN : S25c clients et catalogue · S25d calcul
conforme (ADR-0022, fusionnés) · **S25e factures et avoirs (cet ADR)** · S25f connexion DGI
(envoi, comparaison, confirmation, verrou, étalonnage des arrondis) · S25g PDF, QR code,
duplicata · S25h campagne d'homologation.

S25e prépare **tout ce que les cas de test exigent avant l'envoi à la DGI**. Périmètre
retenu par défaut (ADR-0022, décision ouverte n° 3) : les **seize groupes** A à P et les
**six types** de facture.

Trajectoire (ADR-0018 amendé) : BUILD → RUN → GROW. RUN alimente le **réalisé**, jamais le
plan figé ; hypothèses, prévisions, réalisés et suggestions de l'IA restent distincts. Une
facture est un **fait** (réalisé), pas une prévision.

### Décision de la décideuse du 19 oct. 2026 (elle fait foi)

> « Une double partie : le système gère tout selon un modèle et une devise définis par
> l'utilisateur ; les factures émises ne sont normalisées que quand on clique sur
> Normaliser — là une conversion s'applique. »

Traduction retenue :

1. Catalogue et documents de vente acceptent **CDF ou USD**, au choix de l'utilisateur.
2. **Deux temps distincts** : (a) le **document commercial**, composé et calculé dans la
   devise de l'utilisateur ; (b) l'action explicite **« Normaliser »**, qui convertit en
   **CDF** au taux de référence, fige la facture et la passe « en attente DGI » pour S25f.
   Les deux jeux de montants sont **conservés et étiquetés** ; le calcul des deux, et la
   conversion, passent par le moteur `invoice-totals`.
3. **Contrainte de conformité** (pièce du dossier d'homologation : aucune facture non
   normalisée ne doit sortir quand la normalisation est activée) : pour une organisation où
   `emissionModeOf = 'normalized'`, un document non encore normalisé n'est **jamais**
   présentable comme une facture. C'est un **pro forma** : libellé explicite, pas de numéro
   de facture définitif. Le numéro définitif et le statut « facture » ne s'acquièrent qu'à
   la **normalisation réussie** (S25f). Une organisation non normalisée émet directement,
   dans sa devise.

### Règles DGI qui s'appliquent (résumé, reformulé)

Source : documentation du compte développeur DGI (non publique, hors dépôt ; synthèses
locales `dgi/`) et spécification publique e-DEF v2.0
(`docs/sources/dgi-rdc/edef-api-v2.0-2026-10-18.json`). Seul ce qui fixe le contrat est
repris, en substance.

**Six types de facture** (`type` e-DEF) : `FV` vente · `FT` acompte ou avance · `FA` avoir ·
`EV` vente à l'exportation · `ET` acompte à l'exportation · `EA` avoir à l'exportation.
Chacun impose sa mention imprimée (S25g).

**Quatre natures d'avoir** (`referenceType`) : `COR` correction (avant paiement ou
fourniture) · `RAN` annulation (ni paiement ni fourniture) · `RAM` avoir après reprise
(après paiement ou fourniture) · `RRR` remise, ristourne, rabais (pas nécessairement
rattaché à une facture ; la référence vaut alors `RRR`).

**Avoir hors RRR** : la référence est le **code DEF/DGI** de l'origine ; les articles
crédités figurent sur l'origine ; quantité ≤ quantité vendue, **y compris en cumul** ;
**prix unitaire identique** à l'origine ; plusieurs avoirs partiels permis. `FA` se
rattache à une `FV` ou une `FT`, `EA` à une `EV` ou une `ET`. Montants **positifs**.

**Exigences fonctionnelles** qui touchent ce lot :

- **numéro de facture** unique, série **ascendante et ininterrompue par année de gestion**,
  indépendant des éléments de sécurité ; il part **avec** la requête (`rn`) ; un duplicata
  garde le même numéro ;
- **journal électronique** de toutes les factures avec leur code DEF/DGI ; conservation de
  chaque échange avec la DGI ;
- aucune facture sans article ; aucun montant nul ou négatif ;
- type de client et champs exigés selon le type (imposés par S25c) ;
- paiements multiples parmi `ESPECES VIREMENT CARTEBANCAIRE MOBILEMONEY CHEQUES CREDIT
  AUTRE` ; **total = somme des paiements** ;
- la facture normalisée est **libellée en CDF** ; un paiement en USD impose d'indiquer le
  montant en USD et le taux, à **±1 %** du taux moyen de la Banque centrale du Congo
  (`curCode`, `curRate`, `curDate`) ;
- **huit lignes de commentaire** A à H : A « Réf. Exo. : » pour un client `AO` (et la
  référence de dérogation du groupe D), C pour rappeler le code d'une facture d'acompte,
  les autres réservées ;
- nom de l'**opérateur** obligatoire ; **ISF** du logiciel sur chaque facture normalisée ;
- une organisation en facture normalisée n'émet plus de facture non normalisée (ADR-0019,
  ADR-0021 R2) ; aucune facture normalisée sans éléments de sécurité (verrou S25f).

Le flux DGI (envoi, comparaison, confirmation ou annulation d'un seul tenant, expiration à
deux minutes, dix demandes en attente au plus par e-MCF, refus d'une demande en attente
portant le même `rn`) appartient à S25f.

### Faits du dépôt vérifiés le 19 oct. 2026 (commit `6f3f6cf`)

| Fait | Où |
|---|---|
| Matrice RBAC : **18 actions**, dont `sales.read`, `sales.manage` ; `PLATFORM_FORBIDDEN_ACTIONS` = 4, dont `fiscal.manage` | `apps/api/src/authz/permissions.ts` |
| `markInvoiced(organizationId, { customerId, catalogItemIds }, { session })` sans appelant ; seul écrivain de `firstInvoicedAt` | `apps/api/src/sales/sales-usage.service.ts` |
| `catalog_items.currency` limité à `'CDF'` | `apps/api/src/sales/catalog-item.schema.ts`, `sales.dto.ts` |
| `emissionModeOf(organizationId)` ; pas de paramètre `session` | `apps/api/src/fiscal/normalized-invoicing.service.ts:89` |
| `FiscalModule` n'exporte pas `FiscalProfileService` | `apps/api/src/fiscal/fiscal.module.ts:59` |
| Fiche fiscale : `legalName`, `tradeName`, `nif`, `rccm`, `vatRegistered`, `headOffice`, `phone`, `email` | `fiscal/fiscal-profile.schema.ts` |
| Point de vente : `environment`, `enabled`, `dgi.{nif, nim, address[], shopName}`, état `active`… | `fiscal/points-of-sale.service.ts` |
| `EdefReferenceSnapshotsService.latest(environment, list)` ; listes `taxGroups`, `currencyRates`… | `apps/api/src/edef/` |
| Transactions : `inFiscalTransaction`, `inFiscalTransactionWithReplay` ; replica set `rs0` | `fiscal/fiscal-transaction.ts`, ADR-0020 |
| Audit : `record()` et `recordStrict()`, avec `session` | `authz/audit.service.ts` |
| Moteur : `computeInvoiceTotals` (indifférent à la devise), `convertUnitPrice`, `discountedUnitPrice`, `usdCounterValue`, `isExchangeRateWithinTolerance`, `INVOICE_TOTALS_VERSION = '1.0.0'`, politique `dgi-cd-2026.1` | `packages/engine/src/invoice-totals/` |
| Réalisé : `actual_periods` par projet, exercice 1–5, mois d'exercice 1–12 | `apps/api/src/actuals/`, docs/08 |
| Aucune collection de facture, d'encaissement ni de journal de ventes | — |
| `GET /sales/tax-groups` ne retient de l'instantané que les lettres de `DEFAULT_TAX_GROUPS` (A–P) ; `parseRates` du moteur ne lit que A–P | `sales/tax-groups.service.ts:90`, `invoice-totals/compute.ts:85` |

### Premier échange réel avec l'environnement de test DGI (19 oct. 2026)

Constaté dans `edef_exchanges` (point de vente de test de l'éditeur ; réponses en ~150 ms) :

- `GET /api/info/currencyRates` renvoie le **taux officiel** sous la forme
  `[{ "type": "USD", "description": "United States Dollar", "date":
  "2026-10-19T00:00:00+01:00", "rate": 2262.320000 }]`. C'est **la source par défaut** du
  taux de conversion de « Normaliser » (§ S25e.4). Le taux est un nombre JSON pouvant
  porter plus de deux décimales ; la date porte un décalage horaire.
- `GET /api/info/taxGroups` renvoie **19** groupes : A à P aux taux attendus (B et F 16,
  C et G 5, O et P 1, les autres 0) **plus Q, R (8) et S (0)**, qu'aucun document ne
  définit (vraisemblablement l'ancien régime à 8 %). Question posée à la DGI. En attendant,
  **Lalanda ne propose et ne calcule que A à P** : le catalogue (D1) et le moteur filtrent
  déjà ; le gel d'une facture (§ S25e.6) fige `taxRates` par le même filtre, et une
  différence de taux sur A–P entre deux instantanés successifs est journalisée (contrôle
  S25f, recommandation de la conformité fiscale).

## Options considérées

### O1 — Moment d'attribution du numéro définitif

1. **Au brouillon.** Écarté : un brouillon abandonné laisse un trou.
2. **Au clic « Normaliser ».** Écarté : contraire à la décision (le numéro ne s'acquiert
   qu'à la normalisation réussie) ; un refus DGI laisserait un numéro sans facture.
3. **Organisation ordinaire : à l'émission, dans la transaction qui fige la facture.
   Organisation normalisée : numéro *réservé* juste avant l'envoi à la DGI (le `rn` doit
   partir avec la requête), *confirmé* à la normalisation réussie, *rendu* en cas de refus
   s'il est toujours le dernier de la série.** **Retenu** (§ S25e.3).

### O2 — Mécanisme de numérotation sans trou

1. `countDocuments() + 1` ou `max(number) + 1`. Écarté : course entre émissions
   simultanées, ordre chronologique non garanti.
2. Redis `INCR`. Écarté : aucune atomicité avec l'écriture de la facture.
3. **Compteur dédié dans MongoDB, incrémenté dans la transaction qui écrit le numéro sur
   la facture, plus un bail de normalisation par série.** **Retenu** :
   - `findOneAndUpdate({ organizationId, series, year }, { $inc: { last: 1 } }, { upsert,
     session })` et écriture du numéro sur la facture **dans la même transaction** : un
     échec annule l'incrément ;
   - deux transactions concurrentes écrivent le même compteur → conflit d'écriture
     (`TransientTransactionError`), la seconde est rejouée par `withTransaction` et prend le
     numéro suivant ; la première création d'un compteur (upsert concurrent) bute sur
     l'index unique et est rejouée une fois (`inFiscalTransactionWithReplay`) ;
   - `issuedAt` est lu **après** l'incrément et borné par `max(maintenant, lastIssuedAt)` :
     un numéro plus grand n'a jamais une date plus ancienne ;
   - en mode normalisé, le compteur porte un **bail** (`inFlight: { invoiceId, until }`) :
     une seule facture à la fois entre réservation et issue DGI, par organisation et par
     série. C'est ce qui permet de **rendre** un numéro refusé sans trou (personne n'a pu
     prendre le suivant) et de garder l'ordre chronologique.

   Coût : les émissions d'une organisation sont sérialisées par série et par année ; c'est
   voulu (série unique), et S25f sérialise déjà par e-MCF.

### O3 — Séries

1. Une série par type. Écarté : rien ne l'exige ; la DGI tient ses propres compteurs par
   type ; plus de séries, plus de risques de trou.
2. Une série par point de vente. Écarté : la règle vise le contribuable et l'année.
3. **Une série « réelle » par organisation et par année, tous types confondus ; une série
   « essai » pour l'environnement de test DGI ; des références de pro forma hors série
   fiscale.** **Retenu.** Les factures ordinaires et normalisées en production sont toutes
   des factures légales du même contribuable. Des factures de test qui consommeraient la
   série réelle y feraient des trous.

### O4 — Où calculer totaux, conversion, paiements et contrôles d'avoir

1. Dans l'API. Écarté : le moteur est l'unique source des calculs (CLAUDE.md, ADR-0022).
2. **Dans le moteur, fonctions pures nouvelles à côté de `computeInvoiceTotals`.**
   **Retenu** (§ S25e.9). `computeInvoiceTotals` n'est pas modifié ; il est appelé **deux
   fois** à la normalisation (devise d'origine, puis CDF) ; `INVOICE_TOTALS_VERSION` reste
   `1.0.0`. La conversion a sa propre version (`CURRENCY_CONVERSION_VERSION`).

### O5 — Conversion : sur les prix unitaires ou sur les totaux

1. **Convertir les totaux** (total USD × taux). Écarté : la DGI reçoit des **articles** en
   CDF et recalcule ses totaux à partir des prix unitaires ; un total converti ne
   coïnciderait pas avec son recalcul, et la facture serait annulée pour écart.
2. **Convertir chaque prix unitaire (et prix d'origine, taxe spécifique par unité), puis
   recalculer en CDF par le moteur.** **Retenu.** Les totaux CDF diffèrent alors de quelques
   centimes du « total USD × taux » ; c'est assumé, affiché et étiqueté : les montants
   normalisés CDF sont **les seuls** qui ont valeur fiscale.

### O6 — Taux de conversion d'un avoir

1. **Taux du jour de l'avoir.** Écarté : le prix unitaire CDF de l'avoir différerait de celui
   de l'origine, alors que la DGI exige un **prix unitaire identique** (l'avoir serait
   refusé) ; et la TVA reprise différerait de la TVA collectée, ce qui fausse la
   déclaration.
2. **Taux de la facture d'origine.** **Retenu.** Les lignes d'un avoir hors RRR recopient
   **directement** les prix unitaires CDF normalisés de l'origine (aucune reconversion) et
   la conversion de l'origine (taux, date, source). L'avoir annule exactement, en CDF, ce qui
   a été facturé ; l'écart de change entre la facture et son règlement relève de la
   comptabilité des encaissements, pas de l'avoir. Un RRR rattaché à une origine prend le
   taux de l'origine ; un RRR sans origine, le taux de référence du jour. Point à confirmer
   par la DGI : le contrôle ±1 % du `curRate` d'un avoir se fait-il à la date de l'avoir
   (question DGI n° 3).

### O7 — Permissions

1. `sales.manage` pour tout. Écarté : préparer un document n'engage personne ; émettre ou
   normaliser engage le contribuable. ADR-0022 (O2) l'avait annoncé.
2. `fiscal.manage`. Écarté : réservée au paramétrage fiscal ; le Comptable ne l'a pas.
3. **Nouvelle action `sales.invoice`** pour émettre et normaliser. **Retenu** (§ S25e.11).

### O8 — Encaissements et lien avec le réalisé

Aucun cas de test ni aucune exigence obligatoire ne les demande (le mode `CREDIT` déclare
la part non réglée ; l'encaissement ultérieur n'appelle aucun document normalisé).
**Reportés**, en figeant ce qu'il faut pour les construire (§ S25e.13).

## Décision — S25e

### S25e.1 Deux temps et cycle de vie

Un **document de vente** (`sales_invoices`) naît en brouillon, dans la devise choisie par
l'utilisateur. Ce qu'il devient dépend du mode de l'organisation, lu par
`emissionModeOf` :

```
ORGANISATION ORDINAIRE ('standard')
  draft ──« Émettre » (sales.invoice)──▶ issued
          (numéro définitif, contenu figé, devise de l'utilisateur)

ORGANISATION EN FACTURE NORMALISÉE ('normalized')
  draft ──« Normaliser » (sales.invoice)──▶ pending_normalization
    ▲      conversion en CDF par le moteur,        │ S25f : réserve le numéro, envoie,
    │      contenu figé, AUCUN numéro définitif    │ compare, confirme
    │                                              ├──▶ normalized   (numéro définitif,
    │                                              │                  éléments de sécurité)
    └──« Reprendre en brouillon » (sales.manage)───┴── normalization_failed
         (conversion abandonnée, numéro rendu ou jamais pris)
```

**Ce qu'on peut faire et imprimer dans chaque état** (l'impression relève de S25g ; ce
tableau la contraint) :

| Statut | Mode | Montants | Numéro | Actions possibles | Document imprimable |
|---|---|---|---|---|---|
| `draft` | les deux | devise d'origine, calculés à chaque enregistrement | **référence de pro forma** `PF-AAAA-NNNNNN` | modifier, supprimer, émettre (`standard`) ou normaliser (`normalized`) | **« Pro forma — non valable comme facture »** |
| `issued` | `standard` | devise d'origine, figés | numéro définitif (série réelle) | créer un avoir, imprimer, dupliquer (S25g) | **Facture** (non normalisée ; jamais pour une organisation en mode normalisé) |
| `pending_normalization` | `normalized` | devise d'origine **et** CDF normalisés, figés | aucun définitif (S25f peut avoir **réservé** un numéro, non imprimé) | consulter ; S25f poursuit | **« Pro forma — non valable comme facture »**, avec la mention « normalisation en cours » |
| `normalized` | `normalized` | les deux, figés ; seuls les CDF ont valeur fiscale | numéro définitif + code DEF/DGI, NIM, compteurs | créer un avoir, imprimer, duplicata (S25g) | **Facture normalisée** |
| `normalization_failed` | `normalized` | les deux, figés ; code et libellé d'erreur DGI conservés | aucun (numéro rendu) ou réservé (reprise S25f) | reprendre en brouillon, ou relancer (S25f) | **« Pro forma — non valable comme facture »** |

Règles :

- **Aucun document d'une organisation en mode normalisé ne porte le mot « facture » sans
  être `normalized`.** Aucun numéro de la série fiscale n'est affiché avant la
  normalisation réussie. La référence de pro forma n'appartient pas à la série fiscale ;
  elle peut avoir des trous (brouillons supprimés) et ne se présente jamais comme un numéro
  de facture.
- **Immuable** : après `draft`, aucun champ marqué « figé » au § S25e.2 ne change, sauf le
  retour `normalization_failed → draft`, qui **efface** la conversion et redonne un
  brouillon modifiable (aucun numéro définitif n'a existé). Les champs de suivi ont chacun
  un seul écrivain : `status`, `normalization` (S25f), `credited`/`creditRevision`
  (émission d'un avoir), `duplicateCount` (S25g). `contentSha256` le prouve (test).
- Une facture `issued` ou `normalized` ne se corrige que par un **avoir** ; elle ne
  s'annule ni ne se supprime.
- Si l'organisation **active** la facture normalisée alors qu'elle a des brouillons, ils se
  normalisent ensuite (plus d'« Émettre ») ; si elle la **désactive** pendant qu'un
  document est `pending_normalization`, il reste entre les mains de S25f (aucune bascule
  silencieuse vers `issued`, ADR-0021 R4).

### S25e.2 Collection `sales_invoices`

Montants : **toujours des chaînes décimales canoniques** (`"4064.00"`), jamais des
`number` (docs/26).

| Champ | Type | Règle |
|---|---|---|
| `organizationId` | string | requis |
| `status` | § S25e.1 | `draft` à la création |
| `proformaRef` | string | `PF-AAAA-NNNNNN`, attribué à la création (compteur `proforma`, trous admis) ; jamais imprimé comme numéro de facture |
| `type` | `'FV' \| 'FT' \| 'FA' \| 'EV' \| 'ET' \| 'EA'` | requis ; figé |
| `currency` | `'CDF' \| 'USD'` | devise du document commercial, choisie par l'utilisateur ; figé |
| `priceMode` | `'ttc' \| 'ht'` | unique pour le document ; figé |
| `customer` | instantané | figé (ci-dessous) |
| `pointOfSaleId` | string \| null | requis à la normalisation ; figé |
| `lines` | 1 à 200 | dans la devise du document ; figé |
| `payments` | `[{ method, amount }]` dans la devise du document | ≥ 1 à l'émission ou à la normalisation ; figé |
| `comments` | `{ A … H }`, ≤ 255 \| null | § S25e.7 ; figé |
| `creditNote` | objet \| null | `FA`/`EA` (§ S25e.5) ; figé |
| `documentAmounts` | `{ currency, calculation }` | **montants dans la devise d'origine** ; `calculation` = résultat de `computeInvoiceTotals` (recalculé à chaque enregistrement du brouillon ; figé ensuite) |
| `conversion` | objet \| null | normalisation seulement (§ S25e.4) ; figé |
| `normalizedAmounts` | objet \| null | **montants normalisés CDF** : lignes CDF, paiements CDF, `calculation` CDF, `counterValueUsd` ; normalisation seulement ; figé |
| `calculationVersion`, `roundingPolicyId` | string | figés au premier gel |
| `taxRates` | `{ source: 'dgi_snapshot', environment, fetchedAt, sha256, rates }` | instantané des taux figé au gel |
| `number` | string \| null | **définitif seulement** : à l'émission (`standard`) ou à la normalisation réussie (`normalized`, écrit par S25f via § S25e.3) |
| `series`, `fiscalYear`, `issuedAt` | | avec `number` |
| `emissionMode` | `'standard' \| 'normalized'` \| null | lu **dans** la transaction de gel |
| `environment`, `isf` | | mode normalisé |
| `seller` | instantané \| null | au gel : `legalName`, `tradeName`, `nif`, `rccm`, `address` (point de vente si normalisé, siège sinon), `phone`, `email`, `vatRegistered` |
| `operator` | `{ userId, name }` \| null | utilisateur qui émet ou normalise |
| `frozenAt`, `frozenFromRevision`, `contentSha256` | | gel du contenu |
| `credited`, `creditRevision` | | sur une origine : quantités déjà créditées par des avoirs non revenus en brouillon |
| `normalization` | objet \| null | **propriété de S25f** (§ S25e.10) |
| `duplicateCount` | entier | S25g |
| `revision`, `sortAt` (`issuedAt ?? createdAt`), `createdBy`, `updatedBy`, `createdAt`, `updatedAt`, `_schemaVersion: 1` | | |

**Instantané client**, recopié à chaque enregistrement du brouillon et figé au gel :
`customerId` (\| `null`), `type`, `name`, `nif`, `exemptionReference`, `phone`, `email`,
`address`, `printContactDetails` (le client demande que ses coordonnées figurent). Vente de
comptoir sans fiche : `customerId: null`, type `PP` imposé (décision ouverte n° 4).

**Ligne** (dans la devise du document) : `source` (`catalog` \| `free` \| `origin`),
`catalogItemId`, `originLineIndex`, `code`, `edefCode` (`OUT_OF_SCOPE_ITEM_CODE` si
`outOfScope`), `name`, `unit`, `itemType`, `taxGroup`, `outOfScope`, `specificTax`,
`quantity` (≤ 3 déc.), `originalPrice`, `discount` (`percent` \| `total_amount`),
`unitPrice` (après remise), `priceModification`, `priceOverridden`.

- Une ligne de catalogue reprend le prix de l'article **si l'article est dans la devise du
  document** ; sinon l'utilisateur saisit le prix (`CATALOG_CURRENCY_MISMATCH` tant qu'il
  ne l'a pas fait). Aucune conversion implicite au brouillon : la seule conversion est celle
  de « Normaliser ».
- Mode de l'article ≠ mode du document : `convertUnitPrice` (moteur). Remise :
  `discountedUnitPrice` (moteur). L'API ne fait **aucune** opération sur un montant.

Index : `{ organizationId: 1, sortAt: -1, _id: -1 }` ; `{ organizationId: 1, status: 1 }` ;
**unique partiel** `{ organizationId: 1, series: 1, number: 1 }` ; unique
`{ organizationId: 1, proformaRef: 1 }` ; `{ organizationId: 1, 'creditNote.originInvoiceId': 1 }`.

### S25e.3 Numérotation

**Collection `sales_invoice_counters`** : `organizationId`, `series` (`real` \| `test` \|
`proforma`), `year`, `last`, `lastIssuedAt`, `inFlight` (`{ invoiceId, until }` \| `null`,
séries `real`/`test` en mode normalisé), `_schemaVersion: 1`. Index **unique**
`{ organizationId: 1, series: 1, year: 1 }`. Seul écrivain : `InvoiceNumberingService`
(test de lecture des sources).

- **Série** : `test` pour une facture normalisée en environnement de test ; `real` sinon.
- **Année de gestion** : année civile au fuseau **Africa/Kinshasa** (UTC+1, sans heure
  d'été) de la date d'émission ou de réservation ; le cadre OHADA fait coïncider exercice et
  année civile — **à confirmer** par l'expert-comptable (décision ouverte n° 2). Le compteur
  repart à 1 au 1ᵉʳ janvier.
- **Format** : `AAAA-NNNNNN` (série réelle), `TEST-AAAA-NNNNNN` (essai), `PF-AAAA-NNNNNN`
  (pro forma) ; au-delà de 999 999, le nombre s'allonge.

**Interface** (livrée par E2 ; S25f n'utilise que les trois dernières méthodes) :

```ts
// apps/api/src/sales/invoices/invoice-numbering.service.ts
assignOnIssue(organizationId: string, opts: { session: ClientSession }):
  Promise<{ number: string; series: 'real'; fiscalYear: number; issuedAt: Date }>;   // mode standard
nextProformaRef(organizationId: string, opts?: { session?: ClientSession }): Promise<string>;

/** Mode normalisé. Pose le bail (durée ≤ 3 min) et incrémente le compteur, dans la
 *  transaction de l'appelant, qui écrit le numéro dans `normalization.reservedNumber`.
 *  409 NORMALIZATION_IN_PROGRESS si un bail non expiré est tenu par une autre facture.
 *  Rejouée pour une facture qui détient déjà un numéro réservé : renvoie le même. */
reserve(organizationId: string, invoiceId: string, series: 'real' | 'test',
        opts: { session: ClientSession }): Promise<{ number: string; fiscalYear: number }>;

/** Normalisation réussie : le numéro réservé devient définitif (`number`, `issuedAt`),
 *  `lastIssuedAt` avance, le bail tombe. */
confirm(organizationId: string, invoiceId: string, issuedAt: Date,
        opts: { session: ClientSession }): Promise<void>;

/** Refus définitif : rend le numéro si `last` vaut encore ce numéro (décrément
 *  conditionnel), sinon le laisse réservé à cette facture ; le bail tombe. */
release(organizationId: string, invoiceId: string,
        opts: { session: ClientSession }): Promise<{ released: boolean }>;
```

Garanties : sous le bail, aucune autre facture ne prend de numéro de la même série ; un
refus rend donc toujours son numéro — **aucun trou** dans le cas nominal. Le seul cas où un
numéro reste réservé est l'issue **incertaine** (S25f) : le numéro reste attaché à la
facture et repart avec elle lors de la reprise (la DGI refuse seulement un `rn` déjà **en
attente**). Un numéro réservé n'est jamais abandonné sans entrée de journal (question DGI
n° 2).

### S25e.4 Devise et conversion

**Document commercial.** Composé, calculé (`computeInvoiceTotals`) et payé dans sa devise
(`CDF` ou `USD`). Les taux de TVA viennent de l'instantané DGI, quelle que soit la devise.
Une organisation **ordinaire** émet tel quel, en USD ou en CDF.

**Normalisation** (mode `normalized` seulement), dans la transaction du § S25e.6 :

1. **Taux de référence = taux officiel publié par la DGI** : entrée `type: "USD"` du
   dernier instantané `currencyRates` de l'environnement (`edef_reference_snapshots`),
   avec sa `date` DGI (conservée telle quelle, décalage compris), `fetchedAt` et `sha256`
   de l'instantané. Le nombre JSON est lu par `decimalFromJsonRate` (moteur, jusqu'à 8
   décimales), jamais par un `number` conservé. Instantané absent, sans entrée USD ou plus
   ancien que la veille (fuseau de Kinshasa) → `409 EXCHANGE_RATE_REFERENCE_UNAVAILABLE` :
   l'interface propose alors de rafraîchir les listes du point de vente (route S25b
   existante) avant de normaliser.
2. **Taux appliqué** : **par défaut le taux officiel**, sans saisie. Le contrôle ±1 %
   (`isExchangeRateWithinTolerance`) n'est qu'un **garde-fou** quand l'utilisateur saisit
   un autre taux → hors tolérance, `422 EXCHANGE_RATE_OUT_OF_TOLERANCE`.
3. **Conversion par le moteur** (`convertDocumentToCdf`, § S25e.9) : chaque prix unitaire,
   prix d'origine et taxe spécifique **par unité** converti en CDF (arrondi au plus proche,
   2 décimales) ; taxes en pourcentage et remises en pourcentage inchangées ; remise en
   montant reconvertie et libellé recalculé ; paiements convertis, l'écart d'arrondi porté
   sur le plus gros paiement pour que **somme des paiements CDF = total CDF**.
4. **Calcul CDF** par `computeInvoiceTotals` sur les lignes converties : ce sont les
   montants que S25f enverra et comparera.
5. **Contre-valeur USD** (`curCode`, `curRate`, `curDate`) : pour un document en USD,
   toujours (le paiement est en USD) ; `counterValueUsd = usdCounterValue(totalCdf, taux)`
   (moteur). Pour un document en CDF, la conversion est l'identité (taux `1`, aucune
   ligne modifiée) et la contre-valeur USD est **facultative** : l'utilisateur peut
   demander de l'indiquer (cas de test de la contre-valeur), avec le même contrôle ±1 %.
6. Stocké, figé et étiqueté :

```ts
conversion: {
  from: 'USD' | 'CDF'; to: 'CDF';
  rate: DecimalString;                 // CDF pour 1 USD ; "1" si from = CDF
  rateDate: string;                    // date du taux appliqué
  rateSource: 'dgi_currency_rates' | 'user_within_tolerance' | 'identity' | 'origin_invoice';
  reference: { rate: DecimalString; date: string; environment: string; sha256: string } | null;
  originInvoiceId: string | null;      // avoir : conversion reprise de l'origine
  conversionVersion: string;           // CURRENCY_CONVERSION_VERSION
}
normalizedAmounts: {
  currency: 'CDF';
  lines: readonly { index: number; unitPrice; originalPrice; priceModification; specificTax }[];
  payments: readonly { method; amount }[];
  calculation: InvoiceTotals;          // CDF, valeur fiscale
  counterValueUsd: { amount: DecimalString; rate: DecimalString; date: string } | null;
}
```

L'interface affiche toujours les deux jeux, sous deux libellés fixes : **« Montants du
document (USD) »** et **« Montants normalisés (CDF) — font foi »**.

### S25e.5 Avoirs

Un avoir est un document `FA` ou `EA` avec :

```ts
creditNote: {
  nature: 'COR' | 'RAN' | 'RAM' | 'RRR';
  originInvoiceId: string | null;   // requis sauf RRR
  originNumber: string | null;      // recopié au gel
  reference: string | null;         // au gel : code DEF/DGI de l'origine normalisée,
                                    // 'RRR' pour un RRR, numéro de l'origine ordinaire
}
```

| Règle | Code d'erreur |
|---|---|
| `FA` → origine `FV`/`FT` ; `EA` → `EV`/`ET` | `CREDIT_NOTE_ORIGIN_TYPE` |
| origine de la même organisation, en statut `issued` ou `normalized` | `CREDIT_NOTE_ORIGIN_NOT_FINAL` |
| même mode d'émission que l'origine et, en normalisé, même environnement (décision ouverte n° 5) | `CREDIT_NOTE_ORIGIN_MODE_MISMATCH` |
| **même devise et même mode de prix** que l'origine | `CREDIT_NOTE_CURRENCY_MISMATCH` · `CREDIT_NOTE_PRICE_MODE_MISMATCH` |
| hors RRR : lignes `source: 'origin'` d'une ligne existante ; code, désignation, groupe, type, taxe spécifique, **prix unitaire** recopiés, non modifiables | `CREDIT_NOTE_LINE_NOT_IN_ORIGIN` |
| hors RRR : quantité + déjà crédité ≤ vendu, par ligne | `CREDIT_NOTE_QUANTITY_EXCEEDED` (`details.lineIndex`, `remaining`) |
| client = instantané de l'origine (recopié) | — |
| RRR : lignes libres ou de catalogue ; aucune contrainte de quantité | — |

**Conversion d'un avoir (O6).** Normaliser un avoir d'une origine normalisée **ne
reconvertit rien** : les prix CDF de chaque ligne sont **recopiés** de
`normalizedAmounts.lines` de l'origine, et `conversion` est celle de l'origine
(`rateSource: 'origin_invoice'`). Le prix unitaire CDF est donc identique à l'origine, comme
l'exige la DGI. RRR rattaché : taux de l'origine ; RRR sans origine : taux de référence du
jour (§ S25e.4).

**Partiel ou total.** `POST /sales/invoices/:id/credit-notes` crée un brouillon d'avoir
prérempli (`scope: 'remaining'` toutes les quantités restantes, `'empty'` aucune ligne).
Plusieurs avoirs partiels successifs sont permis tant qu'il reste une quantité.

**Concurrence.** Le gel d'un avoir (émission ou « Normaliser ») met à jour **dans sa
transaction** l'origine (`credited`, `creditRevision`) par un `findOneAndUpdate` conditionné
par la révision lue : deux avoirs simultanés se heurtent, le second se recontrôle. Un avoir
qui revient de `normalization_failed` en brouillon **restitue** ses quantités dans la même
transaction.

**À étalonner (S25f).** La DGI refuse un avoir dont le montant excède l'origine ; avec
l'arrondi par groupe, des avoirs partiels cumulés peuvent dépasser d'un centime. Le moteur
le signale (`CREDIT_NOTE_AMOUNT_EXCEEDS_ORIGIN` : avertissement en brouillon, refus au gel).

### S25e.6 Émettre (mode ordinaire) et Normaliser (mode normalisé)

Deux routes, une seule mécanique de **gel** dans **une transaction MongoDB** :

| | `POST …/issue` | `POST …/normalize` |
|---|---|---|
| Mode exigé (lu dans la transaction) | `standard`, sinon `409 NORMALIZATION_REQUIRED` | `normalized`, sinon `409 NORMALIZATION_NOT_ENABLED` |
| Permission | `sales.invoice` | `sales.invoice` |
| Conversion CDF | non | oui (§ S25e.4) |
| Numéro définitif | **oui** (`assignOnIssue`) | **non** (S25f, à la réussite) |
| Statut final | `issued` | `pending_normalization`, puis selon S25f |

Étapes communes, dans la transaction :

1. relire le brouillon `{ _id, organizationId, status: 'draft', revision: expectedRevision }` ;
2. `mode = emissionModeOf(organizationId, { session })` (paramètre `session` ajouté) ;
3. exiger la **fiche fiscale** (`409 FISCAL_PROFILE_REQUIRED`) ; en normalisé, un point de
   vente de l'organisation, de l'environnement courant, `active` (`409
   POINT_OF_SALE_NOT_ACTIVE`) ;
4. dernier instantané `taxGroups` de l'environnement ; absent → `409 TAX_RATES_UNAVAILABLE` ;
   `taxRates` ne retient que les lettres A à P (même filtre que `GET /sales/tax-groups`) :
   les groupes Q, R, S renvoyés par la DGI ne sont ni proposés ni figés ;
5. avoir : relire l'origine avec la session, contrôler (§ S25e.5), mettre à jour `credited` ;
6. moteur : totaux dans la devise du document, `checkPayments`, contrôles d'avoir ; en
   normalisé, conversion et totaux CDF, `checkPayments` en CDF — tout problème → `422
   INVOICE_NOT_ISSUABLE` avec **tous** les problèmes ;
7. `issue` seulement : numéro définitif ;
8. écrire le statut, les instantanés (vendeur, taux, opérateur, ISF), les montants,
   `conversion`, `contentSha256`, `normalization: { attempts: 0, … }` en normalisé ;
9. `markInvoiced(organizationId, { customerId, catalogItemIds }, { session })` ;
10. entrée de journal (`issued` ou `submitted`) ;
11. audit (`record` avec la session ; identifiant, référence, type, mode — jamais de donnée
    personnelle du client).

Après la validation de la transaction, `normalize` appelle
`SalesInvoiceNormalizer.normalizeNow(organizationId, invoiceId)` (§ S25e.10) et renvoie
l'état qui en résulte. Dans S25e, l'implémentation par défaut ne fait rien : le document
reste `pending_normalization` (pro forma).

**Fenêtre résiduelle.** Le mode est lu dans la transaction ; si l'activation se valide
pendant une émission déjà commencée, une facture `issued` peut naître quelques
millisecondes après l'activation. Elle est **détectée** : test de cohérence et contrôle S25f
signalent toute facture `issued` dont `issuedAt` suit `firstActivatedAt` (ADR-0021).

**Idempotence.** `issue` ou `normalize` rejoués avec la même `expectedRevision` sur un
document déjà gelé depuis cette révision (`frozenFromRevision`) → `200` avec l'état courant,
sans réécriture ; sinon `409 INVOICE_NOT_DRAFT` (`details.status`) ou `409 STALE_REVISION`.

**Reprendre en brouillon** (`POST …/back-to-draft`, `sales.manage`) : seulement depuis
`normalization_failed` **et** sans numéro réservé (`normalization.reservedNumber = null`,
sinon `409 NUMBER_RESERVED`, la reprise appartient à S25f) ; efface `conversion`,
`normalizedAmounts`, le gel ; restitue les quantités d'un avoir ; entrée de journal
`returned_to_draft`.

### S25e.7 Commentaires

- **A** : automatique pour un client `AO` (« Réf. Exo. : » + référence d'exonération) et
  alors non modifiable ; saisissable si une ligne est du groupe D avec un client non `AO`
  (cas non couvert par la documentation) ; refusé sinon.
- **C** : saisissable (rappel du code d'une facture d'acompte sur la facture finale).
- **B, D, E, F, G, H** : réservés → `400 COMMENT_LINE_RESERVED`.

### S25e.8 Paiements

- Dans la devise du document ; convertis en CDF à la normalisation (§ S25e.4).
- **Somme = total**, vérifiée par le moteur (`checkPayments`) : avertissement en brouillon,
  `422 PAYMENTS_TOTAL_MISMATCH` au gel. Au moins un paiement au gel ; l'interface propose un
  paiement unique égal au total, à confirmer.
- `CREDIT` = part non réglée ; `amountOnCredit` conservé pour les encaissements (§ S25e.13).

### S25e.9 Fonctions ajoutées au moteur

Nouveaux fichiers purs de `packages/engine/src/invoice-totals/`, sur l'arithmétique
`bigint` interne ; `computeInvoiceTotals` et `INVOICE_TOTALS_VERSION` **inchangés**.

```ts
// invoice-checks.types.ts — jalon E0 (figé)
export const DOCUMENT_CURRENCIES = ['CDF', 'USD'] as const;
export type DocumentCurrency = (typeof DOCUMENT_CURRENCIES)[number];
export const PAYMENT_METHODS = [
  'ESPECES', 'VIREMENT', 'CARTEBANCAIRE', 'MOBILEMONEY', 'CHEQUES', 'CREDIT', 'AUTRE',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export interface PaymentInput { method: PaymentMethod; amount: DecimalString }

export type InvoiceCheckIssueCode =
  | 'NO_PAYMENTS' | 'PAYMENT_AMOUNT_INVALID' | 'PAYMENTS_TOTAL_MISMATCH'
  | 'CREDIT_NOTE_LINE_NOT_IN_ORIGIN' | 'CREDIT_NOTE_QUANTITY_EXCEEDED'
  | 'CREDIT_NOTE_PRICE_MISMATCH' | 'CREDIT_NOTE_AMOUNT_EXCEEDS_ORIGIN'
  | 'EXCHANGE_RATE_INVALID' | 'CONVERTED_AMOUNT_ZERO';
export interface InvoiceCheckIssue {
  code: InvoiceCheckIssueCode; lineIndex: number | null; message: string;   // français
  details?: Readonly<Record<string, string>>;
}

export interface PaymentsCheck {
  ok: boolean; issues: readonly InvoiceCheckIssue[];
  paidTotal: DecimalString; amountOnCredit: DecimalString;
}

export interface ConvertibleLine {
  unitPrice: DecimalString; originalPrice: DecimalString | null;
  discount: LineDiscount | null; quantity: DecimalString; specificTax: SpecificTax | null;
}
export interface CurrencyConversionInput {
  from: DocumentCurrency; rate: DecimalString;           // CDF pour 1 USD ; "1" si CDF
  lines: readonly ConvertibleLine[]; payments: readonly PaymentInput[];
}
export type CurrencyConversionResult =
  | { ok: true; conversionVersion: string;
      lines: readonly { index: number; unitPrice: DecimalString; originalPrice: DecimalString | null;
                        priceModification: string | null; specificTax: SpecificTax | null }[];
      /** Paiements convertis ; à réconcilier avec le total CDF par reconcilePayments. */
      payments: readonly PaymentInput[] }
  | { ok: false; issues: readonly InvoiceCheckIssue[] };

export interface OriginLine { index: number; quantity: DecimalString; unitPrice: DecimalString }
export interface CreditNoteCheck {
  ok: boolean; issues: readonly InvoiceCheckIssue[];
  creditedAfter: readonly { lineIndex: number; quantity: DecimalString }[];
  remainingAfter: readonly { lineIndex: number; quantity: DecimalString }[];
}
```

```ts
// payments.ts (E1)
export function checkPayments(total: DecimalString, payments: readonly PaymentInput[]): PaymentsCheck;
/** Porte l'écart d'arrondi sur le plus gros paiement (le premier à égalité) pour que la
 *  somme égale exactement `total` ; refuse si un paiement devient ≤ 0. */
export function reconcilePayments(total: DecimalString, payments: readonly PaymentInput[]):
  { ok: true; payments: readonly PaymentInput[] } | { ok: false; issues: readonly InvoiceCheckIssue[] };

// conversion.ts (E1)
/** Taux de change reçu de la DGI (nombre JSON) → décimal canonique, jusqu'8 décimales ;
 *  null si non fini, ≤ 0, en notation exponentielle ou plus précis. */
export function decimalFromJsonRate(value: number): DecimalString | null;
export const CURRENCY_CONVERSION_VERSION = '1.0.0';
/** USD → CDF : prix × taux arrondi au plus proche (demi vers le haut), 2 déc. ;
 *  taxe spécifique par unité idem ; pourcentages inchangés ; remise en montant
 *  reconvertie et libellé recalculé par discountedUnitPrice. CDF → CDF : identité. */
export function convertDocumentToCdf(input: CurrencyConversionInput): CurrencyConversionResult;

// credit-notes.ts (E1)
export function checkCreditNote(input: {
  originLines: readonly OriginLine[];
  alreadyCredited: readonly { lineIndex: number; quantity: DecimalString }[];
  lines: readonly { originLineIndex: number; quantity: DecimalString; unitPrice: DecimalString }[];
  originTotal: DecimalString; previousCreditTotals: readonly DecimalString[]; creditTotal: DecimalString;
}): CreditNoteCheck;
export function remainingQuantities(
  originLines: readonly OriginLine[],
  alreadyCredited: readonly { lineIndex: number; quantity: DecimalString }[],
): readonly { lineIndex: number; quantity: DecimalString }[];
```

### S25e.10 Interface avec S25f

S25e **ne spécifie pas l'appel DGI** ; il fixe l'état d'entrée, le contenu figé et
l'interface.

```ts
// apps/api/src/sales/invoices/normalization.port.ts — jalon E0 (figé)
export const SALES_INVOICE_NORMALIZER = Symbol('SALES_INVOICE_NORMALIZER');
export type NormalizeNowOutcome = 'normalized' | 'failed' | 'uncertain' | 'deferred';
export interface SalesInvoiceNormalizer {
  /** Après la validation du gel, pour un document pending_normalization. Idempotent ;
   *  ne lève pas pour un refus DGI. */
  normalizeNow(organizationId: string, invoiceId: string): Promise<NormalizeNowOutcome>;
}
/** Sous-document `normalization`, ÉCRIT PAR S25f SEULEMENT après sa création par S25e. */
export interface InvoiceNormalizationState {
  pointOfSaleId: string;
  attempts: number;                      // 0 à la création
  lastAttemptAt: Date | null;
  reservedNumber: string | null;         // via InvoiceNumberingService.reserve
  uid: string | null;
  dgiTotals: Readonly<Record<string, string>> | null;
  codeDefDgi: string | null; nim: string | null; counters: string | null;
  dgiDateTime: string | null; qrCode: string | null;
  lastError: { code: string; message: string } | null;   // affichés à l'utilisateur
  normalizedAt: Date | null;
}
```

- S25e livre `NoopSalesInvoiceNormalizer` (`'deferred'`) ; S25f remplace le fournisseur
  dans `SalesModule` sans toucher au reste.
- Transitions de S25f, chacune par `findOneAndUpdate` conditionné par le statut précédent,
  avec son entrée de journal (`InvoiceJournalService.append`, exporté) :
  `pending_normalization → normalized` (`InvoiceNumberingService.confirm` dans la même
  transaction) et `pending_normalization → normalization_failed` (`release`).
- **Correspondance contenu figé → requête e-DEF** : `nif` ← `seller.nif` ; `rn` ←
  `normalization.reservedNumber` ; `mode` ← `priceMode` ; `isf` ← `isf` ; `type` ← `type` ;
  `items[]` ← `lines` + `normalizedAmounts.lines` (`code` ← `edefCode`, `price` ←
  `unitPrice` **CDF**, `originalPrice`, `priceModification`, taxe spécifique) ; `client` ←
  `customer` ; `operator` ← `operator` ; `payment[]` ← `normalizedAmounts.payments` ;
  `reference`, `referenceType` ← `creditNote` ; `cmta…cmth` ← `comments` ; `curCode`,
  `curRate`, `curDate` ← `normalizedAmounts.counterValueUsd`. Le `confirm` envoie `total` et
  `vtotal` de `normalizedAmounts.calculation`. **Aucun montant en USD ne part à la DGI.**
- **Verrou** (S25f, S25g) : seul `normalized` donne un document intitulé « facture » dans une
  organisation en mode normalisé.
- **Avoir d'une origine normalisée** : `creditNote.reference` = `normalization.codeDefDgi`
  de l'origine, recopié au gel ; une origine sans code est refusée par construction.

### S25e.11 Permissions et audit

Une action nouvelle, en fin de `ACTIONS` (dix-neuvième) et de docs/12 :
`sales.invoice` — « Émettre et normaliser des factures et des avoirs ».

| Action | PRO | ADM | DIR | CPT | ANA | CDP | CON | LEC |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| `sales.read` (inchangée : documents, journal) | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ |
| `sales.manage` (inchangée : brouillons, pro forma, reprise en brouillon) | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| `sales.invoice` | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |

Justification : émettre ou normaliser engage le contribuable ; le Comptable le fait au
quotidien ; l'Administrateur (membres, compte) prépare mais n'émet pas par défaut.
**Proposition soumise à la décideuse** (décision ouverte n° 1). Plateforme :
`sales.invoice` **interdite** à tous les rôles plateforme et ajoutée à
`PLATFORM_FORBIDDEN_ACTIONS` (cinq) : le support n'émet jamais au nom d'un contribuable.

Audit : `sales_invoice.issued`, `sales_invoice.submitted`, `sales_invoice.returned_to_draft`
(`record`, avec la session) ; métadonnées : identifiant, référence ou numéro, type, nature,
mode, devise — jamais de donnée personnelle du client.

### S25e.12 Journal électronique et traçabilité

**Collection `sales_invoice_journal`**, en ajout seul (seul écrivain
`InvoiceJournalService`, test dédié) : `organizationId`, `seq` (1, 2, 3… par organisation,
**sans trou**, compteur `sales_journal_heads` incrémenté dans la même transaction), `at`,
`event` (`issued` · `submitted` · `number_reserved` · `normalized` ·
`normalization_failed` · `number_released` · `returned_to_draft` · `duplicate_issued`
(S25g) · `report_issued` (lot des rapports)), `invoiceId`, `proformaRef`, `number`, `series`,
`type`, `creditNature`, `originNumber`, `documentTotals` (`{ currency, total, vatTotal }`),
`normalizedTotals` (`{ total, vatTotal, specificTax }` CDF), `conversion` (`{ rate, rateDate,
rateSource }`), `contentSha256`, `codeDefDgi`/`nim`/`counters` (événement `normalized`),
`actor` (`{ userId, name }` ou `null` pour l'ordonnanceur), `prevHash`, `hash` (`sha256` de
`prevHash` + forme canonique : chaînage qui rend visible toute altération ou suppression).

Index **unique** `{ organizationId: 1, seq: 1 }`. Chaque transition s'écrit avec son entrée
**dans la même transaction**. `GET /sales/journal` le restitue avec `chainValid`. Les
échanges bruts DGI restent dans `edef_exchanges` (ADR-0021).

### S25e.13 Encaissements et réalisé — reportés, préparés

Non livrés. Chaque facture finale porte `payments`, `amountOnCredit`, `issuedAt`, totaux par
groupe dans sa devise et, si normalisée, en CDF. Prévu (ADR dédié) :

- **Encaissements** (`sales_receipts`) : date, mode, montant et devise, taux du jour,
  factures lettrées ; soldent `amountOnCredit` ; l'écart de change entre facture et
  règlement s'y constate. Aucun appel DGI.
- **Réalisé** : chiffre d'affaires mensuel = somme des **bases HT** des groupes qui forment
  un chiffre d'affaires (exclus H, I, J, L, N et toute TVA), factures finales moins avoirs
  finaux, par mois civil d'`issuedAt`, dans la devise du projet (conversion par le moteur,
  taux daté). Restent à choisir : le projet qui reçoit le réalisé, le passage du mois civil
  au mois d'exercice d'`actual_periods`, la ligne du plan visée. La valeur sera **étiquetée**
  `source: 'run.sales'`, ne touchera **jamais** le plan validé ni ne sera produite par l'IA.

### S25e.14 Contrat HTTP

Toutes les routes : `@UseGuards(AuthGuard, PermissionsGuard)`, organisation active, quota
global ; ressource d'une autre organisation → **404** ; Zod `.strict()` ; montants en
chaînes (`DECIMAL_MUST_BE_STRING`).

| Méthode et chemin | Permission | Réponse |
|---|---|---|
| `GET /sales/invoices` | `sales.read` | 200 `InvoicePage` |
| `POST /sales/invoices` | `sales.manage` | 201 `InvoiceView` (brouillon) |
| `GET /sales/invoices/:invoiceId` | `sales.read` | 200 `InvoiceView` |
| `PUT /sales/invoices/:invoiceId` | `sales.manage` | 200 (brouillon seulement) |
| `DELETE /sales/invoices/:invoiceId` | `sales.manage` | 204 (brouillon seulement) |
| `POST /sales/invoices/:invoiceId/credit-notes` | `sales.manage` | 201 (brouillon d'avoir) |
| `POST /sales/invoices/:invoiceId/issue` | `sales.invoice` | 200 (mode ordinaire) |
| `POST /sales/invoices/:invoiceId/normalize` | `sales.invoice` | 200 (mode normalisé) |
| `POST /sales/invoices/:invoiceId/back-to-draft` | `sales.manage` | 200 |
| `GET /sales/journal` | `sales.read` | 200 `JournalPage` |
| `GET /sales/exchange-rate-reference` | `sales.read` | 200 `ExchangeRateReference` |

```
GET /sales/invoices?status=draft|issued|pending_normalization|normalized|normalization_failed|final|all
                   &type=FV&currency=USD&customerId=…&year=2026&q=…&limit=50&cursor=…
```

`final` = `issued` + `normalized`. `q` cherche dans le numéro, la référence de pro forma et
le nom du client. Tri `sortAt` décroissant puis `_id` ; curseur opaque (`INVALID_CURSOR`).

```jsonc
// POST /sales/invoices — brouillon (PUT : même corps COMPLET + "expectedRevision")
{
  "type": "FV",
  "currency": "USD",
  "priceMode": "ht",
  "customer": { "customerId": "6713a0c4e1a2b3c4d5e6f701", "printContactDetails": false },
  //  comptoir : { "customerId": null, "walkIn": { "name": null } }
  "pointOfSaleId": null,                          // défaut : le seul point de vente actif
  "lines": [
    { "source": "catalog", "catalogItemId": "6713a0c4e1a2b3c4d5e6f702",
      "quantity": "2.375", "unitPrice": null, "discount": null },
    { "source": "free", "code": null, "name": "Débours de transport", "itemType": "SER",
      "taxGroup": "J", "outOfScope": false, "unit": "forfait", "quantity": "1",
      "unitPrice": "25.00", "specificTax": null, "discount": { "kind": "percent", "value": "10" } }
  ],
  "payments": [ { "method": "VIREMENT", "amount": "…" } ],   // dans la devise du document
  "comments": { "A": null, "C": null },
  "creditNote": null,                             // FA/EA : { "nature": "RRR", "originInvoiceId": null }
  "showUsdCounterValue": false                    // document en CDF : indiquer la contre-valeur USD
}

// POST /sales/invoices/:invoiceId/credit-notes  { "nature": "RAM", "scope": "remaining" }
// ligne d'avoir dans le PUT : { "source": "origin", "originLineIndex": 0, "quantity": "1" }

// POST /sales/invoices/:invoiceId/issue      { "expectedRevision": 7 }
// POST /sales/invoices/:invoiceId/normalize  { "expectedRevision": 7,
//                                              "exchangeRate": null }  // ou { "rate": "2270.00", "date": "2026-10-19" }
// POST /sales/invoices/:invoiceId/back-to-draft { "expectedRevision": 9 }
```

```jsonc
// InvoiceView
{
  "id": "6714b1d5f2a3b4c5d6e7f801",
  "status": "pending_normalization",
  "documentKind": "proforma",                     // "proforma" | "invoice" — CE QUE L'ON PEUT IMPRIMER
  "documentLabel": "Pro forma — non valable comme facture",
  "proformaRef": "PF-2026-000045",
  "number": null, "series": null, "fiscalYear": null, "issuedAt": null,
  "type": "FV", "typeLabel": "Facture de vente",
  "currency": "USD", "priceMode": "ht",
  "emissionMode": "normalized", "environment": "test", "isf": "TEST-ISF",
  "customer": { "customerId": "6713…701", "type": "PM", "typeLabel": "Personne morale",
                "name": "Exemple SARL", "nif": "A0000000X", "exemptionReference": null,
                "phone": null, "email": null, "address": null, "printContactDetails": false },
  "pointOfSaleId": "6712…a01",
  "lines": [
    { "index": 0, "source": "catalog", "catalogItemId": "6713…702",
      "code": "CONSEIL-H", "edefCode": "CONSEIL-H", "name": "Conseil (heure)",
      "unit": "heure", "itemType": "SER", "taxGroup": "B", "outOfScope": false,
      "quantity": "2.375", "originalPrice": null, "discount": null,
      "unitPrice": "40.00", "priceModification": null, "priceOverridden": false,
      "specificTax": null, "amount": "95.00",
      "credited": "0", "remaining": "2.375" }     // facture d'origine seulement
  ],
  "documentAmounts": {
    "label": "Montants du document (USD)", "currency": "USD",
    "calculation": { "ok": true, "issues": [],
                     "totals": { "groups": [ { "group": "B", "ratePercent": "16", "total": "…",
                                               "ht": "…", "vat": "…", "specificTax": "0.00" } ],
                                 "specificTax": "0.00", "total": "…", "vatTotal": "…" } },
    "payments": [ { "method": "VIREMENT", "methodLabel": "Virement", "amount": "…" } ],
    "paymentsCheck": { "ok": true, "paidTotal": "…", "amountOnCredit": "0.00", "issues": [] }
  },
  "conversion": { "from": "USD", "to": "CDF", "rate": "2262.32", "rateDate": "2026-10-19T00:00:00+01:00",
                  "rateSource": "dgi_currency_rates",
                  "reference": { "rate": "2262.32", "date": "2026-10-19T00:00:00+01:00", "environment": "test", "sha256": "…" },
                  "originInvoiceId": null, "conversionVersion": "1.0.0" },
  "normalizedAmounts": {
    "label": "Montants normalisés (CDF) — font foi", "currency": "CDF",
    "lines": [ { "index": 0, "unitPrice": "90492.80", "originalPrice": null,
                 "priceModification": null, "specificTax": null } ],
    "payments": [ { "method": "VIREMENT", "amount": "…" } ],
    "calculation": { "groups": [ … ], "specificTax": "0.00", "total": "…", "vatTotal": "…" },
    "counterValueUsd": { "amount": "…", "rate": "2262.32", "date": "2026-10-19T00:00:00+01:00" }
  },
  "calculationVersion": "1.0.0", "roundingPolicyId": "dgi-cd-2026.1",
  "taxRates": { "source": "dgi_snapshot", "environment": "test", "fetchedAt": "…", "sha256": "…" },
  "comments": { "A": null, "B": null, "C": null, "D": null, "E": null, "F": null, "G": null, "H": null },
  "creditNote": null,
  "creditNotes": [],                              // avoirs émis sur ce document
  "seller": { "legalName": "…", "tradeName": null, "nif": "…", "rccm": "…",
              "address": "…", "phone": "…", "email": "…", "vatRegistered": true },
  "operator": { "userId": "…", "name": "Comptable Exemple" },
  "normalization": { "attempts": 0, "reservedNumber": null, "codeDefDgi": null, "nim": null,
                     "counters": null, "dgiDateTime": null, "qrCode": null,
                     "lastError": null, "normalizedAt": null },
  "readiness": { "action": "normalize", "ready": false, "blockers": [] },  // brouillon : "issue" | "normalize"
  "revision": 8, "createdAt": "…", "updatedAt": "…"
}
// InvoicePage : { "items": [ InvoiceSummary ], "nextCursor": null }
// InvoiceSummary : id, status, documentKind, proformaRef, number, type, currency, issuedAt,
//                  customer.name, customer.type, documentAmounts.calculation.totals.total (ou null),
//                  normalizedAmounts.calculation.total (ou null), emissionMode, revision
```

`documentKind` vaut `invoice` **seulement** pour `issued` et `normalized` : c'est le champ
que S25g lit pour choisir l'intitulé du PDF. En brouillon, `calculation` peut valoir
`{ "ok": false, "totals": null, "issues": [ … ] }` : le brouillon s'enregistre quand même ;
`readiness.blockers` dit ce qui empêche l'émission ou la normalisation (`NO_LINES`,
`PAYMENTS_TOTAL_MISMATCH`, `CATALOG_CURRENCY_MISMATCH`, `POINT_OF_SALE_REQUIRED`,
`TAX_RATES_UNAVAILABLE`, `EXCHANGE_RATE_REFERENCE_UNAVAILABLE`, `CUSTOMER_INACTIVE`…).

```jsonc
// GET /sales/journal?cursor=…&limit=100  →  JournalPage
{ "items": [ { "seq": 41, "at": "…", "event": "submitted", "invoiceId": "…",
               "proformaRef": "PF-2026-000045", "number": null, "series": null, "type": "FV",
               "documentTotals": { "currency": "USD", "total": "…", "vatTotal": "…" },
               "normalizedTotals": { "total": "…", "vatTotal": "…", "specificTax": "0.00" },
               "conversion": { "rate": "2262.32", "rateDate": "2026-10-19T00:00:00+01:00", "rateSource": "dgi_currency_rates" },
               "contentSha256": "…", "codeDefDgi": null, "actor": { "userId": "…", "name": "…" },
               "hash": "…" } ],
  "nextCursor": null, "chainValid": true }

// GET /sales/exchange-rate-reference  →  ExchangeRateReference
{ "currency": "USD", "rate": "2262.32", "date": "2026-10-19T00:00:00+01:00", "source": "dgi_snapshot",
  "environment": "test", "fetchedAt": "…", "tolerancePercent": "1" }
```

**Erreurs** (`code`, `message` en français, `details`) :

| HTTP | Code | Quand |
|---|---|---|
| 400 | `INVALID_REQUEST` | corps invalide ; `details.issues` dont `DECIMAL_MUST_BE_STRING`, `COMMENT_LINE_RESERVED`, `LINE_LIMIT_EXCEEDED`, `CREDIT_NOTE_REQUIRED_FOR_TYPE`, `CREDIT_NOTE_NOT_ALLOWED_FOR_TYPE`, `WALK_IN_MUST_BE_PP`, problèmes d'article d'ADR-0022 pour une ligne libre |
| 400 | `INVALID_CURSOR` | curseur illisible |
| 404 | `INVOICE_NOT_FOUND` · `CUSTOMER_NOT_FOUND` · `CATALOG_ITEM_NOT_FOUND` · `POINT_OF_SALE_NOT_FOUND` · `EXCHANGE_RATE_REFERENCE_UNAVAILABLE` | inconnu ou d'une autre organisation |
| 409 | `STALE_REVISION` · `INVOICE_NOT_DRAFT` | concurrence, document gelé |
| 409 | `NORMALIZATION_REQUIRED` · `NORMALIZATION_NOT_ENABLED` | mauvaise route pour le mode de l'organisation |
| 409 | `CUSTOMER_INACTIVE` · `CATALOG_ITEM_INACTIVE` · `TAX_GROUP_UNAVAILABLE` | référence désactivée, groupe absent de l'instantané |
| 409 | `FISCAL_PROFILE_REQUIRED` · `POINT_OF_SALE_NOT_ACTIVE` · `TAX_RATES_UNAVAILABLE` · `EXCHANGE_RATE_REFERENCE_UNAVAILABLE` | prérequis de gel |
| 409 | `CREDIT_NOTE_ORIGIN_TYPE` · `CREDIT_NOTE_ORIGIN_NOT_FINAL` · `CREDIT_NOTE_ORIGIN_MODE_MISMATCH` · `CREDIT_NOTE_CURRENCY_MISMATCH` · `CREDIT_NOTE_PRICE_MODE_MISMATCH` · `CREDIT_NOTE_NOTHING_REMAINING` | avoir |
| 409 | `NOT_RETURNABLE_TO_DRAFT` · `NUMBER_RESERVED` | reprise en brouillon refusée |
| 422 | `INVOICE_NOT_ISSUABLE` | moteur ou contrôles refusent au gel ; `details.issues` : **tous** les problèmes (`PAYMENTS_TOTAL_MISMATCH`, `CREDIT_NOTE_QUANTITY_EXCEEDED`, `EXCHANGE_RATE_OUT_OF_TOLERANCE`, `CONVERTED_AMOUNT_ZERO`, codes de `computeInvoiceTotals`…) |

## Découpage en chantiers parallèles

Règle inchangée (ADR-0011) : **un fichier, un seul écrivain** ; toute exception passe par le
CTO.

### Jalon E0 — contrats (développeur E2, fusionné **avant** tout le reste)

- `apps/api/src/authz/permissions.ts` : `sales.invoice`, les deux matrices,
  `PLATFORM_FORBIDDEN_ACTIONS` (cinq) ; `authz/permissions.test.ts` : 8 × 19 + 6 × 19 =
  **266 assertions** ; texte « 19 actions » de `routes-coverage.test.ts` ;
- `packages/engine/src/invoice-totals/invoice-checks.types.ts` (figé) ; `payments.ts`,
  `conversion.ts`, `credit-notes.ts` réduits à leurs signatures (corps `throw new
  Error('E1')`) ; exports ajoutés au barrel `invoice-totals/index.ts` ;
- `apps/api/src/sales/invoices/normalization.port.ts` et `invoice.contract.ts` (types des
  vues, corps, `JournalPage`, `ExchangeRateReference`, codes d'erreur) — figés ;
- `docs/12-ROLES-PERMISSIONS.md` (une action) ; note « amendé par ADR-0023 » en tête
  d'ADR-0012 et d'ADR-0022.

### E1 — moteur (paiements, conversion, avoirs)

| Possède | Ne touche pas |
|---|---|
| `invoice-totals/payments.ts`, `conversion.ts`, `credit-notes.ts` (corps) et leurs tests ; nouvel export `INVOICE_CHECK_REFERENCE_CASES` dans un nouveau fichier `check-reference-cases.ts` | `compute.ts`, `types.ts`, `tax-groups.ts`, `reference-cases.ts`, `INVOICE_TOTALS_VERSION`, `ENGINE_VERSION`, `apps/**` |
| `docs/21-MOTEUR-FINANCIER.md` (section « Calcul des factures » : contrôles et conversion) | |

### E2 — API documents de vente

| Possède | Ne touche pas |
|---|---|
| nouveau `apps/api/src/sales/invoices/**` (hors fichiers figés d'E0) : schémas (`invoice`, `invoice-counter`, `invoice-journal`, `journal-head`), `invoice-drafts.service.ts`, `invoice-freezing.service.ts` (émettre, normaliser, reprendre), `invoice-numbering.service.ts`, `invoice-journal.service.ts`, `credit-notes.service.ts`, `exchange-rate-reference.service.ts`, `noop-normalizer.ts`, `invoices.controller.ts`, `journal.controller.ts`, `invoices.dto.ts`, `invoices.errors.ts`, `canonical.ts`, tests unitaires et e2e | `packages/engine/**`, `apps/web/**`, clients et catalogue (E4) |
| **Ajouts purs** : modèles, services et fournisseur `SALES_INVOICE_NORMALIZER` dans `sales/sales.module.ts` ; `opts.session` facultatif d'`emissionModeOf` et de `NormalizedInvoicingStateReader.read` (+ tests) ; export de `FiscalProfileService` dans `fiscal/fiscal.module.ts` ; deux contrôleurs dans `routes-coverage.test.ts` | le reste de `fiscal/**`, `edef/**`, `authz/permissions.ts` après E0 |
| docs/15 et docs/16 (fin de lot) | |

### E3 — interface Factures

| Possède | Ne touche pas |
|---|---|
| `apps/web/src/lib/api.ts` : `OrgAction` + `'sales.invoice'`, types et méthodes du § S25e.14 | `apps/api/**`, `packages/**` |
| `ventes/layout.tsx` : onglet « Factures » (premier) ; `ventes/page.tsx` redirige vers `factures` | `clients/**`, `catalogue/**` |
| nouveau `ventes/factures/` : `page.tsx`, `nouvelle/page.tsx`, `[invoiceId]/page.tsx`, `journal/page.tsx` ; `_components/invoice-list.tsx`, `invoice-editor.tsx`, `invoice-lines.tsx`, `payments-editor.tsx`, `amounts-panel.tsx` (les deux jeux étiquetés), `credit-note-dialog.tsx`, `issue-dialog.tsx`, `normalize-dialog.tsx`, `invoice-model.ts` (+ test) | |
| docs/04 (section Ventes : factures, pro forma, normalisation) | |

### E4 — devise du catalogue (amendement d'ADR-0022)

| Possède | Ne touche pas |
|---|---|
| `apps/api/src/sales/catalog-item.schema.ts` et `sales.dto.ts` : `currency` ∈ `'CDF' \| 'USD'` ; tests du catalogue mis à jour ; `catalog-items.service.ts` si la vue l'exige | `sales/invoices/**`, `customers*` |
| `apps/web/.../ventes/_components/catalog-item-form.tsx`, `catalog-list.tsx`, `sales-model.ts` (+ test) : choix de la devise, affichage `1 234,50 USD` | `ventes/factures/**`, `lib/api.ts` (E3 y ajoute le type `'USD'`) |

Aucune migration : les articles existants valent `CDF`.

### Ordre

1. **E0** fusionné. 2. **E1, E2, E3, E4 en parallèle**, rebasés sur E0 ; E2 rebase sur E1
avant fusion ; E3 code contre `invoice.contract.ts` avec réponses simulées. 3. Fusion **E4**
et **E1**, puis **E2**, puis **E3** (vérifié contre l'API réelle).

## Critères d'acceptation et tests

### E0

- 266 assertions ; `sales.invoice` exactement selon § S25e.11 ; `PLATFORM_FORBIDDEN_ACTIONS`
  = cinq ; aucune autre case modifiée.

### E1

- `checkPayments` exact en chaînes (`"0.10" + "0.20" = "0.30"`) ; montant ≤ 0 refusé ;
  `amountOnCredit` ; `reconcilePayments` : trois paiements convertis dont la somme diffère
  d'un centime → écart porté sur le plus gros, somme exacte.
- `convertDocumentToCdf` : 40,00 USD à 2 262,32 → 90 492,80 CDF ; `decimalFromJsonRate(2262.32)` → `"2262.32"`, `2262.3215` accepté, `1e3` et valeurs négatives refusés ; 0,335 × taux arrondi
  au plus proche ; pourcentages inchangés ; remise en montant reconvertie, libellé
  recalculé ; CDF → identité ; prix converti à 0,00 → `CONVERTED_AMOUNT_ZERO` ; taux ≤ 0
  ou non décimal → `EXCHANGE_RATE_INVALID` ; puis `computeInvoiceTotals` sur le résultat :
  invariants d'ADR-0022 vérifiés (propriétés, 1 000 documents, graine fixe).
- `checkCreditNote` : ligne inconnue ; restant exact à 3 décimales ; cumul de trois avoirs ;
  dépassement d'un millième refusé ; prix différent refusé ; dépassement d'un centime du
  montant d'origine signalé.
- Aucun `number` hors des conversions JSON existantes (test de lecture des sources étendu) ;
  tests existants inchangés et verts ; `INVOICE_TOTALS_VERSION` inchangée.

### E2

- **Numérotation, mode ordinaire** : 50 émissions concurrentes → 1 à 50 sans trou ni doublon,
  `issuedAt` croissant ; deux organisations → séries indépendantes ; 31 déc. 23 h 59 et
  1ᵉʳ janv. 0 h 00 (Kinshasa) → deux années ; échec injecté après l'incrément → aucun numéro
  consommé ; un brouillon n'a qu'une référence `PF-`.
- **Numérotation, mode normalisé** (avec un faux S25f) : après « Normaliser », `number`
  reste `null` ; `reserve` concurrent sur deux documents → un seul bail, l'autre `409
  NORMALIZATION_IN_PROGRESS` ; refus → `release` rend le numéro et le suivant le reprend ;
  numéro réservé non dernier → conservé ; `confirm` → numéro définitif ; série `TEST-` en
  environnement de test.
- **Pro forma et conformité** : dans une organisation en mode normalisé, `issue` → 409 ;
  `documentKind` = `proforma` pour `draft`, `pending_normalization`,
  `normalization_failed`, `invoice` seulement pour `normalized` ; aucun numéro de série
  fiscale exposé avant `normalized` ; organisation ordinaire → `issue` donne `invoice`.
- **Conversion** : document USD normalisé → `conversion` et `normalizedAmounts` présents,
  étiquetés, calculés par le moteur ; taux hors ±1 % → 422 ; instantané `currencyRates`
  absent → 409 ; document CDF → conversion identité ; contre-valeur USD demandée → présente.
- **Immuabilité** : après gel, `PUT`/`DELETE` → 409 ; `contentSha256` stable sous toutes les
  opérations permises ; seuls le gel, la reprise en brouillon et l'édition de brouillon
  touchent les champs figés (lecture des sources) ; l'API ne fait aucune opération
  arithmétique sur un montant (`Number(`, `parseFloat`, opérateurs proscrits dans
  `sales/invoices/**`).
- **Avoirs** : chaque règle du § S25e.5 ; avoir d'une origine USD normalisée → prix CDF
  **identiques** à ceux de l'origine, conversion `origin_invoice`, aucun appel de
  `convertDocumentToCdf` sur ses lignes ; deux avoirs concurrents excédant la quantité → un
  seul gelé ; reprise en brouillon → quantités restituées ; RRR sans origine → référence
  `RRR`.
- **Groupes non documentés** : un instantané `taxGroups` contenant Q, R, S (forme réelle
  relevée le 19 oct. 2026) → `taxRates` figé ne contient que A à P ; une ligne en Q est
  refusée (`UNKNOWN_TAX_GROUP`).
- **Contenu figé complet** : tous les champs de la correspondance du § S25e.10 présents ;
  aucun montant USD dans les champs destinés à la DGI.
- **Paiements, commentaires, idempotence** : somme ≠ total → 422 ; A automatique pour AO ;
  B → 400 ; deux `normalize` identiques simultanés → un seul gel, deux 200 identiques.
- **Journal** : une entrée par transition, dans la même transaction ; `seq` sans trou sous
  concurrence ; altération → `chainValid: false`.
- **`markInvoiced`** dans la transaction de gel.
- **Isolation et RBAC e2e** : Propriétaire, Directeur financier, Comptable → émettre et
  normaliser 200 ; Administrateur → brouillon 200, gel 403 ; Analyste, Lecteur → lecture ;
  Conseiller → 403 ; autre organisation → 404 sur **chaque** route ; super-administrateur
  sous accès délégué → gel refusé. Audit sans donnée personnelle. `routes-coverage` vert.

### E3

- Bouton **« Émettre »** pour une organisation ordinaire, **« Normaliser »** pour une
  organisation en mode normalisé, jamais les deux ; seulement avec `sales.invoice`.
- Tant que `documentKind = proforma`, l'en-tête affiche « Pro forma — non valable comme
  facture » et la référence `PF-…`, jamais « Facture n° ».
- Dialogue « Normaliser » : taux de référence du jour, date et source, saisie d'un autre
  taux avec rappel ±1 %, aperçu des montants CDF **renvoyés par l'API** ; « Mode test » si
  l'environnement est `test`.
- Panneau des montants : deux colonnes étiquetées « Montants du document (USD) » et
  « Montants normalisés (CDF) — font foi ».
- Avoirs (nature, total ou partiel, restants), reprise en brouillon, journal ; montants
  formatés sans `Number()` ni `parseFloat` (test sur `invoice-model.ts`).

### E4

- Article en USD créé, listé, modifié ; `currency` hors `CDF`/`USD` → 400 ; articles existants
  lus en `CDF` ; tests du catalogue d'ADR-0022 verts.

### Correspondance avec les cas de test officiels

Ce lot rend **constructibles et normalisables jusqu'à l'état « en attente DGI »** les 29 cas
de facture, en TTC et en HT ; la normalisation réelle vient avec S25f, l'impression avec
S25g. Un test e2e d'E2 (`invoices.homologation.e2e.test.ts`) construit un scénario par
fonctionnalité ci-dessous, dans les deux modes de prix, et le fait passer en
`pending_normalization`.

| Cas officiels | Ce que S25e apporte |
|---|---|
| ventes simples et mixtes, quantités décimales, types de client (1 à 7) | document `FV`, client typé, mode TTC/HT |
| taxe spécifique (8) | ligne avec taxe spécifique |
| acompte (9), acompte à l'export (17) | types `FT`, `ET` |
| avoirs RAN, RAM, COR, RRR (10 à 13), avoir à l'export (16) | `FA`, `EA`, quatre natures, contrôles, prix CDF repris de l'origine |
| client AO, groupe D (14) | commentaire A automatique |
| export (15) | type `EV` |
| groupes F à P, prélèvements, TVA spécifique, hors champ (18 à 24, 27 à 29) | lignes de ces groupes, `TAX` pour L et N, code « HORS CHAMP » |
| remises (25) | remise en % et en montant, prix d'origine |
| contre-valeur USD (26) | document en USD converti, ou document en CDF avec contre-valeur, contrôle ±1 % |
| exigences : numérotation, paiements, montants positifs, commentaires, natures d'avoir, avoirs partiels, journal, garantie « aucune facture non normalisée » | §§ S25e.1, 3, 5, 7, 8, 12 |

**Hors de ce lot** : éléments de sécurité et verrou (S25f) ; duplicata, QR code, mentions
imprimées, total en lettres (S25g) ; rapports X, Z, A ; numéraire et stock (reportables).

### Tous

`pnpm format`, lint, typecheck et tests verts à la racine ; `git diff --stat origin/main`
sans suppression hors périmètre ; aucun fichier de `dgi/`, aucun jeton, aucune donnée
client réelle dans un commit.

## Conséquences

- Quatre collections nouvelles (`sales_invoices`, `sales_invoice_counters`,
  `sales_invoice_journal`, `sales_journal_heads`), indexées par `IndexesService`. Matrice à
  19 actions ; ADR-0012, ADR-0022 et docs/12 amendés.
- S25f trouvera : des documents figés et convertis en `pending_normalization`, le
  sous-document `normalization`, `reserve`/`confirm`/`release`, le port de normalisation,
  le journal exporté et la correspondance champ par champ. Il devra **tenir le bail** entre
  réservation et issue, et ne jamais laisser un numéro réservé sans journal.
- Le chiffre d'affaires d'une organisation existe en deux devises : la devise du document
  (gestion) et le CDF normalisé (fiscal). Les rapports fiscaux (X, Z, A, TVA) liront
  **toujours** les montants normalisés.
- Les gels d'une organisation sont sérialisés par série et par année, et les normalisations
  par bail : acceptable au volume B2B visé, à revoir pour une caisse à fort débit.
- **Risque** : sans instantané `taxGroups` (et `currencyRates` pour normaliser) relevé pour
  l'environnement, aucun gel n'est possible. S25f doit prévoir un rafraîchissement régulier
  des listes de référence par l'ordonnanceur.
- **Risque** : si la DGI contrôle le `curRate` d'un avoir à la date de l'avoir, la reprise du
  taux d'origine peut être refusée au-delà de ±1 % de variation ; repli prévu : contre-valeur
  au taux du jour, prix CDF inchangés (question DGI n° 3).

## Plan de validation

Critères ci-dessus par chantier ; revue CTO avant chaque fusion (isolation, absence de
calcul dans l'API, numérotation sous concurrence, pro forma jamais présenté comme facture en
mode normalisé, immuabilité, conformité au contrat). Essai de la décideuse : dans une
organisation de test en mode normalisé, composer une vente en USD, la normaliser (taux du
jour), vérifier qu'elle reste « Pro forma » avant S25f, puis préparer les quatre natures
d'avoir, en TTC et en HT ; dans une organisation ordinaire, émettre directement en USD.

## Décisions ouvertes — elles appartiennent à la décideuse

1. **Qui peut émettre et normaliser ?** Proposé : Propriétaire, Directeur financier et
   Comptable ; l'Administrateur prépare des brouillons mais n'émet pas. Faut-il lui donner
   ce droit ?
2. **Numéro de facture.** Proposé : une série unique pour factures et avoirs, remise à zéro
   chaque 1ᵉʳ janvier (année civile, à confirmer par votre expert-comptable), format
   `2026-000123` ; les pro forma ont leur propre référence `PF-2026-000045`. Voulez-vous un
   préfixe propre à chaque entreprise, ou des séries séparées pour les avoirs ?
3. **Fiche fiscale obligatoire pour toute facture**, même hors facture normalisée (une
   facture doit porter le NIF et l'adresse du vendeur). D'accord ?
4. **Vente de comptoir sans fiche client** (personne physique non enregistrée) : proposé
   autorisée. D'accord ?
5. **Avoir d'une facture faite avant l'activation de la facture normalisée** : proposé
   refusé dans le logiciel tant que la DGI n'a pas répondu. Acceptable ?
6. **Encaissements et lien avec le réalisé reportés** à un lot suivant (ils ne conditionnent
   pas l'homologation). D'accord ?

Tranché par la décideuse le 19 oct. 2026 : devise au choix (CDF ou USD) et normalisation en
deux temps avec conversion en CDF. Tranché par le CTO (technique) : numéro définitif à
l'émission (ordinaire) ou à la normalisation réussie (réservé puis confirmé ou rendu, sous
bail) ; série d'essai séparée ; conversion sur les prix unitaires par le moteur ; **avoir
au taux de la facture d'origine** (prix CDF recopiés) ; immuabilité par empreinte ; journal
chaîné ; port de normalisation ; `sales.invoice` interdite à la plateforme.

## Questions à poser à la DGI (complètent ADR-0019 et ADR-0022)

1. La série « ininterrompue par année de gestion » couvre-t-elle tous les types dans une
   seule série, ou une série par type est-elle attendue ?
2. Un `rn` dont la demande a été refusée, annulée ou a expiré peut-il être renvoyé (même
   facture corrigée, ou facture suivante) ?
3. Pour un avoir d'une facture payée en USD : le taux `curRate` doit-il être à ±1 % du taux
   BCC du jour de l'avoir, ou celui de la facture d'origine est-il admis ?
4. Le contrôle « montant de l'avoir ≤ montant de l'origine » est-il cumulatif sur plusieurs
   avoirs partiels ?
5. Groupe D avec un client non AO : où porter la référence de dérogation ?
6. Montants des paiements USD : en CDF ou en devise dans `payment[]` ?
7. Un avoir peut-il référencer une facture ordinaire émise avant l'activation ?
8. Les groupes Q, R (8 %) et S renvoyés par `/api/info/taxGroups` en environnement de test
   sont-ils l'ancien régime, à ignorer ? Seront-ils absents en production ?

## Liens

- [ADR-0012](ADR-0012-modele-rbac-complet.md) — RBAC (amendé : 19ᵉ action) ;
  [ADR-0018](ADR-0018-trajectoire-erp-trois-modules.md) — BUILD → RUN → GROW ;
  [ADR-0019](ADR-0019-facture-normalisee-dgi-rdc.md) — facture normalisée ;
  [ADR-0020](ADR-0020-ordonnanceur-mongodb.md) — ordonnanceur ;
  [ADR-0021](ADR-0021-modules-erp-et-identite-fiscale.md) — `emissionModeOf`, points de vente ;
  [ADR-0022](ADR-0022-clients-catalogue-et-calcul-des-factures.md) — clients, catalogue
  (amendé : devise), `invoice-totals`.
- [docs/08](../08-PREVISIONNEL-REALISE.md) — réalisé ; [docs/16](../16-API.md) ;
  [docs/26](../26-CONVENTIONS.md) — pas de flottant pour les montants officiels.
- [docs/sources/dgi-rdc](../sources/dgi-rdc/README.md) — spécification e-DEF v2.0 publique ;
  règles détaillées : documentation du compte développeur DGI (hors dépôt).
- Code : `apps/api/src/sales/`, `apps/api/src/fiscal/`, `apps/api/src/edef/`,
  `apps/api/src/authz/`, `packages/engine/src/invoice-totals/`.
