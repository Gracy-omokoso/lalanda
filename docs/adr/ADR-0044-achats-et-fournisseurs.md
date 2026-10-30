# ADR-0044 — Achats et fournisseurs (R3) : fiches fournisseurs, demandes et bons de commande approuvés, réceptions, factures fournisseurs, dettes et paiements

Statut : Proposed
Date : 2026-10-30
Décideurs : Gracy Omokoso (dirigeante) — **ordre du RUN validé** (R0 navigation, R1 projets, R2 CRM,
**R3 achats**, R4 RH, R5 stocks et documents) et consigne du 30 oct. 2026 : « continuons, vas-y et
ne t'arrête pas » ; CTO Lalanda (contrat technique). Le cadrage est **proposé** : chaque choix qui
lui appartient porte une valeur par défaut, appliquée tant qu'elle ne tranche pas autrement
(§ Décisions ouvertes). Les points fiscaux et comptables sont soumis à son expert-comptable.

> **Lève le refus d'[ADR-0018](ADR-0018-trajectoire-erp-trois-modules.md)** (« Refusés à ce stade :
> RH et paie, stocks, achats… ») **pour les seuls achats**, à la demande de la dirigeante (RUN
> complet, « pour ne plus utiliser d'autres outils ») ; stocks et RH restent hors de cet ADR.
> **Amende [ADR-0012](ADR-0012-modele-rbac-complet.md) et docs/12** : cinq actions nouvelles
> (`purchase.read`, `purchase.request`, `purchase.manage`, `purchase.approve`, `payables.pay`),
> aucun rôle nouveau. **Étend [ADR-0041](ADR-0041-autorisations-par-membre.md)** : dépendances,
> domaine « Achats et fournisseurs » et une paire incompatible par ajout. **Étend
> [ADR-0034](ADR-0034-depenses-et-tresorerie.md)** : un paiement fournisseur **est** une dépense
> réalisée (`treasury_expenses`), la fiche fournisseur remplace le texte libre, la prévision lit
> les échéances fournisseurs ; tranche, pour ce module, sa décision ouverte n° 2 (fiche
> fournisseur) et, pour les seules factures fournisseurs, sa décision n° 6 (PDF servi inerte, motif
> d'ADR-0039 § 2.5). **Étend [ADR-0039](ADR-0039-projets-et-taches-run.md)** (marge, « Mes
> tâches », cloche), **[ADR-0033](ADR-0033-brief-du-matin.md)** (port `PURCHASES_SOURCE`, règles
> R11 et R12) et **[ADR-0042](ADR-0042-envoi-des-documents-par-email.md)** (envoi du bon de commande
> au fournisseur). **S'appuie sans les modifier** sur [ADR-0013](ADR-0013-stockage-secrets-integration.md)
> (chiffrement des secrets), [ADR-0025](ADR-0025-documents-pdf-factures.md) et
> [ADR-0028](ADR-0028-modeles-de-facture-et-identite.md) (rendu PDF, identité),
> [ADR-0027](ADR-0027-numerotation-des-factures.md) (format des numéros, jour de Kinshasa).
> **N'introduit aucune règle fiscale** : voir § 9 et les décisions ouvertes n° 12 à 16.

## Contexte

Aujourd'hui, Lalanda enregistre l'argent **dépensé** (ADR-0034) mais pas l'argent **dû** ni
l'argent **engagé**. Une PME qui achète à crédit, commande avant de payer ou paie en plusieurs fois
tient ces informations ailleurs (cahier, tableur, WhatsApp). Cinq manques :

1. **Pas de fournisseur.** `treasury_expenses.supplierName` est un texte libre de 120 caractères
   (`supplierKey` normalisé pour l'autocomplétion, `GET /treasury/suppliers`). Ni NIF, ni contact,
   ni conditions de paiement, ni coordonnées bancaires ; « Socimex » et « SOCIMEX SARL » sont deux
   fournisseurs ; personne ne sait combien on doit à qui.
2. **Pas d'engagement.** Rien n'autorise une dépense avant qu'elle ait lieu : pas de demande, pas
   d'approbation, pas de bon de commande. La séparation « celui qui demande n'approuve pas » n'existe
   que pour le plan financier (R2, ADR-0012 § 6).
3. **Pas de dette.** Une facture fournisseur reçue et non payée n'existe nulle part ; la prévision
   de trésorerie (ADR-0034 § 7) ignore ce qu'il faudra payer, alors qu'elle connaît ce qu'on doit
   encaisser.
4. **Pas de contrôle.** Rien ne compare ce qui a été commandé, ce qui a été livré et ce qui est
   facturé. Une facture payée deux fois ou une livraison partielle facturée en entier passent.
5. **Pas de coût engagé par projet.** La marge d'un projet (ADR-0039 § 5) ne voit une dépense
   qu'une fois payée ; un achat commandé pour un client n'apparaît pas tant qu'il n'est pas réglé.

### Faits du dépôt qui commandent les décisions

| Fait | Où | Conséquence |
|---|---|---|
| Le fournisseur d'une dépense est `supplierName` (texte) + `supplierKey` (minuscules, sans accents) ; `GET /treasury/suppliers?q=` liste les noms déjà saisis | `treasury/treasury.schemas.ts`, `treasury-expenses.controller.ts` | migration par clé normalisée **exacte**, comme les prospects d'ADR-0040 § 2.7 |
| Une dépense porte déjà `deductibleVat` (déclarée, **jamais calculée**), `reference`, `attachment` (images seules), `workProjectId` (marge), `accountId` (soldes), `category` (pont vers le réalisé) | `treasury.schemas.ts`, ADR-0034 § 2, ADR-0039 § 2.10 | un paiement fournisseur qui **crée une dépense** est vu sans rien changer par les soldes, la marge, le pont, les résumés et la prévision |
| La prévision lit les encaissements et le reste à encaisser par un **port** (`TREASURY_RECEIPTS_SOURCE`) | `treasury/treasury-sources.ts` | même motif pour les dettes : port `TREASURY_PAYABLES_SOURCE` |
| La marge d'un projet = encaissé − remboursé − dépenses (`workProjectId`) − coût du temps, par devise, sans conversion | `engine/src/work/margin.ts`, `WORK_MARGIN_VERSION = '1.0.0'` | un paiement fournisseur rattaché au projet y entre déjà ; l'**engagé** non payé est une information à ajouter, pas une soustraction |
| `work_attachments` accepte le PDF ≤ 10 Mio, reconnu par sa signature, **non analysé**, servi en téléchargement inerte | ADR-0039 § 2.5, `work/work-attachments.service.ts` | la facture fournisseur scannée en PDF suit ce motif |
| Les secrets sont chiffrés AES-256-GCM sous le trousseau `MASTER_KEYRING`, avec rotation | ADR-0013, `integrations/keyring.provider.ts`, `secrets-crypto.ts` | coordonnées bancaires et mobile money chiffrées en base, jamais rendues en clair par défaut |
| `MailMessage` porte déjà `cc`, `replyTo`, `fromName`, `attachments` ; le seau de débit des envois de documents est `security/document-email-throttler.guard.ts` | ADR-0042 § 4 et § 6 | l'envoi du bon de commande réutilise transport, audit strict et seau |
| Numérotation des devis `DV{AA}{MM}-NNNNNN`, compteur annuel au jour de Kinshasa, trous admis, hors série fiscale | ADR-0035, ADR-0027 | `DA…` et `BC…` suivent ce format |
| R2 dynamique : `sodDecision()` refuse l'auto-approbation, sauf **approbateur unique** marqué `soleApprover` ; le compte porte sur les détenteurs **effectifs** (ADR-0041 G4) | `authz/permissions.ts` | la séparation des tâches des achats reprend ce motif, sans `if (role === …)` |
| `ACTION_DEPENDENCIES`, `ACTION_DOMAINS`, `SOD_PAIRS`, `NON_DELEGABLE_ACTIONS` vivent dans `permissions.ts` ; écarts par membre implémentés derrière `MEMBER_PERMISSIONS_ENABLED` (éteint) | ADR-0041 § 2, § 4, § 5 ; docs/16 | les actions nouvelles y sont déclarées une fois ; un « acheteur » sans rôle dédié passe par un écart |
| « Mes tâches » agrège à la lecture (port `CRM_AGENDA_SOURCE`, éléments `source: 'crm'`) ; la cloche est commune (`NOTIFICATION_KINDS`, `NOTIFICATION_SOURCE_MODULES`) | `work/my-tasks.ports.ts`, `packages/shared/src/notifications/index.ts` | approbations à faire : `source: 'purchases'`, module de notification `purchases` |
| Brief : ports par module ; dix règles (R1 à R10) ; `MORNING_BRIEF_VERSION = '1.2.0'` | `morning-brief/morning-brief.ports.ts`, `engine/src/morning-brief/compute.ts` | port `PURCHASES_SOURCE`, règles R11 et R12, version 1.3.0 |
| Moteur trésorerie `TREASURY_VERSION = '1.0.0'` ; créances `RECEIVABLES_VERSION = '1.0.0'` | `engine/src/treasury`, `engine/src/receivables` | nouveau module pur `engine/src/purchases` ; la prévision passe en 1.1.0 |

## Options considérées

### O1 — Demande d'achat et bon de commande : un document ou deux ?

1. **Deux collections** (`purchase_requests`, `purchase_orders`), une demande pouvant donner
   plusieurs commandes. Écarté pour R3 : deux cycles de vie, deux approbations à synchroniser, et
   le découpage d'une demande en plusieurs commandes n'est pas un besoin exprimé ; on le réalise
   par plusieurs demandes.
2. **Un seul document `purchase_orders`, deux phases** : il naît **demande** (brouillon, soumise,
   approuvée ou refusée), devient **bon de commande** à l'approbation (numéro `BC`), puis vit sa
   vie de commande (envoyée, reçue en partie ou en totalité, clôturée, annulée). L'approbation
   porte sur ce qui sera commandé, sans recopie. **Retenu.**
3. Pas de demande : le bon de commande est saisi puis approuvé. Écarté : la dirigeante veut que
   « celui qui demande » soit une personne distincte de celui qui approuve, et qu'un membre puisse
   exprimer un besoin sans pouvoir commander.

### O2 — Paiement fournisseur et trésorerie : nouvelle sortie de compte, ou dépense ?

1. **Nouveau mouvement** lu par la trésorerie par un port (motif des encaissements). Écarté : la
   marge (`workProjectId`), le pont vers le réalisé (catégories), les résumés de dépenses et la
   prévision lisent `treasury_expenses` ; il faudrait les modifier tous, et un décaissement
   fournisseur serait absent de « Dépenses ».
2. **Le paiement crée des dépenses `treasury_expenses`, possédées par les achats.** Chaque paiement
   produit une ou plusieurs dépenses (une par ligne d'imputation de la facture, § 2.6), avec
   `origin.kind = 'supplier_payment'`. Elles sont modifiables et annulables **seulement** par le
   module achats (`409 EXPENSE_OWNED_BY_PURCHASES` sur les routes de la trésorerie). Soldes,
   marge, pont, résumés et prévision les voient sans changement. **Retenu.**
3. Tenir les dettes sans toucher à la trésorerie, l'utilisateur saisissant la dépense à la main.
   Écarté : double saisie, donc double comptage ou oubli.

### O3 — Double comptage avec les dépenses saisies à la main

1. Interdire la saisie directe d'une dépense chez un fournisseur qui a des factures. Écarté : les
   petits achats au comptant restent des dépenses directes, c'est le chemin le plus simple.
2. **Trois garde-fous** : (a) une dépense créée par un paiement n'est jamais saisissable ni
   modifiable par la trésorerie ; (b) une dépense directe **déjà saisie** peut devenir le paiement
   d'une facture fournisseur (`POST /purchases/payments/from-expense`) : elle est **rattachée**, pas
   recopiée ; (c) le moteur signale les doublons probables (`POSSIBLE_DUPLICATE_EXPENSE` : même
   fournisseur, même devise, même montant, dates à trois jours ou moins) sur l'écran « À payer »
   et sur la fiche fournisseur, sans jamais rien annuler seul. **Retenu.**

### O4 — Circuit d'approbation : règles libres, ou paliers par montant ?

1. Moteur de règles général (par catégorie, projet, fournisseur, demandeur). Écarté : complexe à
   expliquer, à tester et à auditer pour la cible (PME de quelques personnes).
2. **Paliers par devise** : pour chaque devise, une liste ordonnée de seuils ; chaque palier dit
   combien d'approbations **distinctes** il faut (0, 1 ou 2). Le palier est choisi par le **total
   TTC** de la commande (l'argent engagé). Aucune conversion entre devises : chaque devise a ses
   propres seuils. **Retenu.**

### O5 — Rapprochement commande, réception, facture

1. Trois voies obligatoires. Écarté : beaucoup d'achats sont des services sans réception physique,
   ou des factures sans commande (eau, électricité).
2. **Mode déduit, contrôle chiffré, décision humaine** : une facture **sans commande** n'est pas
   rapprochée (`not_applicable`) ; liée à une commande, elle est rapprochée **à deux voies**
   (facture ↔ commande : prix, quantités facturées ≤ commandées) ; si la commande a des lignes
   « à réceptionner », **à trois voies** (quantités facturées ≤ quantités reçues). Les écarts sont
   calculés par le moteur, au-delà de tolérances réglables (zéro par défaut) ; une facture en écart
   ne devient payable que **forcée** par un approbateur, avec motif. **Retenu.**

### O6 — Rôle « Acheteur » : oui ou non ?

1. **Rôle nouveau `buyer`.** Écarté **par défaut** (décision ouverte n° 2) :
   - la cible de R3 achète par le Propriétaire, le Directeur financier ou le Comptable, qui ont déjà
     tout ce qu'il faut ; la personne « qui exprime un besoin » est n'importe quel membre interne,
     servie par `purchase.request` donnée largement (§ 4) ;
   - un rôle coûte une colonne aux deux matrices exhaustives, un rang, des libellés, des tests et un
     nouveau compte pour R7 ; ADR-0040 ne l'a fait que sur une décision explicite (D3) ;
   - ADR-0041 permet déjà de faire d'un Lecteur ou d'un Analyste un acheteur par **ajouts**
     (`purchase.manage`), sans approbation ni paiement ; ce chemin attend seulement l'activation de
     `MEMBER_PERMISSIONS_ENABLED`.
2. **Le rôle reste spécifié, prêt à ajouter** si la dirigeante le demande : slug `buyer`, libellé
   « Acheteur », rang 6 (après `sales_rep`), actions `analytics.read`, `purchase.read`,
   `purchase.request`, `purchase.manage`, `work.read`, `work.update` ; **ni** `purchase.approve`,
   **ni** `payables.pay`, **ni** `treasury.*`. Matrice alors 10 × 33 + 6 × 33 = 528 cases.

### O7 — Où vivent les contrats et les calculs

Comme ADR-0039 O5 et ADR-0040 O5 : contrats zod dans **`packages/shared/src/purchases/`** (entrée
`@lalanda/shared/purchases`) ; calculs dans un module **pur** `packages/engine/src/purchases/`
(`PURCHASES_VERSION = '1.0.0'`), sans horloge (jour de référence en paramètre), entiers `bigint`,
montants en chaînes décimales, **jamais de conversion entre devises**.

## Décision

### 1. Vocabulaire

| Interface (français) | Code | Collection |
|---|---|---|
| Fournisseur | `Supplier` | `suppliers` (nouvelle) |
| Demande d'achat, bon de commande | `PurchaseOrder`, `phase: 'request' \| 'order'` | `purchase_orders` (nouvelle) |
| Approbation | `PurchaseApproval` | dans `purchase_orders.approvals` |
| Réception (livraison ou service fait) | `PurchaseReception` | `purchase_receptions` (nouvelle) — **pas** `receipts`, déjà pris par les encaissements |
| Facture fournisseur | `SupplierInvoice` | `supplier_invoices` (nouvelle) |
| Paiement fournisseur | `SupplierPayment` | `supplier_payments` (nouvelle) |
| Dette fournisseur, reste à payer | `payable`, `remaining` | calculés, jamais stockés |
| Réglages des achats | `PurchaseSettings` | `purchase_settings` (un document par organisation) |
| Compteurs | — | `purchase_counters` (`organizationId + kind + year`) |

Dates civiles `AAAA-MM-JJ` au **jour de Kinshasa** (ADR-0027) ; horodatages en UTC. Tout document
porte `organizationId`, `revision`, `createdBy`, `updatedBy`, horodatages, `_schemaVersion`.
Ressource d'une autre organisation : **404**, y compris par identifiant forgé dans un corps
(`supplierId`, `orderId`, `orderLineId`, `invoiceId`, `accountId`, `workProjectId`, `expenseId`).
Écriture concurrente : `expectedRevision` → `409 STALE_REVISION`. Devises : `CDF` et `USD` (celles
de la trésorerie). Montants : chaînes décimales, deux décimales au plus.

### 2. Modèle de données

#### 2.1 `suppliers`

| Champ | Règle |
|---|---|
| `name` | 1 à 200 ; `sortName`, `searchKey` normalisés (motif de `customers` et de `supplierKey`) |
| `kind` | `company` \| `individual` (informatif) |
| `nif` | **facultatif** ; normalisé comme le NIF de l'organisation (majuscules, espaces et tirets retirés, `^[A-Z0-9]{5,20}$`) ; **unique partiel** `{ organizationId, nif }` (`409 SUPPLIER_NIF_EXISTS` avec l'identifiant existant). Aucun contrôle de validité auprès de la DGI (décision ouverte n° 14) |
| `rccm`, `nationalId` | facultatifs, ≤ 64, format libre |
| `address`, `phone`, `email`, `website` | facultatifs, bornes de la fiche client |
| `contacts` | 0 à 10 `{ id, name (1–120), role (≤ 80), phone, email, isPrimary }` ; un seul `isPrimary` ; l'adresse du contact principal préremplit l'envoi du bon de commande |
| `defaultCurrency` | `CDF` \| `USD` ; proposée à la saisie d'une commande ou d'une facture, jamais imposée |
| `paymentTerms` | `{ kind: 'immediate' }` \| `{ kind: 'net', days: 1–180 }` \| `{ kind: 'end_of_month', days: 0–180 }` ; défaut `immediate` ; l'échéance d'une facture en est **déduite par le moteur** (`dueDateOf`, § 7) et reste modifiable |
| `defaultCategory` | facultative, l'une des quatorze catégories d'ADR-0034 § 1 ; préremplit l'imputation des factures |
| `paymentMethods` | 0 à 5 moyens de paiement, **chiffrés** (§ 2.1.1) |
| `notes` | ≤ 5 000, texte brut |
| `active` | `false` = archivé (masqué des sélecteurs, conservé) |
| `legacyKeys` | clés `supplierKey` des dépenses texte rattachées à cette fiche (migration, fusion) ; sert à rattacher les futures saisies texte identiques |
| `mergedInto` | `null` \| identifiant : fiche fusionnée, conservée pour la trace, exclue des listes |

Index : `{ organizationId, sortName, _id }` ; `{ organizationId, active }` ; unique partiel
`{ organizationId, nif }` ; `{ organizationId, legacyKeys }`. Deux fournisseurs homonymes sont
permis (avertissement `SUPPLIER_SIMILAR_NAME`, motif d'ADR-0040).

##### 2.1.1 Coordonnées de paiement (données protégées)

Un moyen de paiement : `{ id, kind: 'bank' | 'mobile_money', label (≤ 60), isDefault, masked,
fingerprint, cipher, changedAt, changedBy }`.

- **En clair, seulement à l'écriture** : banque `{ bankName, accountHolder, accountNumber, iban?,
  swift? }` ; mobile money `{ operator, phoneNumber, holderName }`. Validation de forme seulement
  (longueurs, caractères), aucune vérification auprès d'une banque ou d'un opérateur.
- **Chiffrement** : `cipher` = AES-256-GCM sous le trousseau `MASTER_KEYRING` (ADR-0013 § 2), données
  associées (AAD) = `organizationId + supplierId + methodId` : un chiffré déplacé vers une autre
  fiche ne se déchiffre pas. Rotation : comprise dans `secrets:rewrap`. Sans trousseau configuré,
  l'écriture est refusée (`503 SECRETS_NOT_CONFIGURED`), jamais stockée en clair.
- **Lecture** : listes et fiches ne rendent que `masked` (`Rawbank •••• 4521`, `M-Pesa •••• 78`) et
  `fingerprint` (HMAC tronqué, pour signaler deux fournisseurs qui partagent un même compte :
  avertissement `SUPPLIER_PAYMENT_DETAILS_SHARED`, cas classique de fraude). Le clair se lit par
  `POST /purchases/suppliers/:id/payment-methods/:methodId/reveal`, réservé à `payables.pay`
  (celui qui paie en a besoin), **journalisé strictement** (`supplier.payment_details_revealed`),
  limité à 30 par heure et par utilisateur.
- **Changement** : ajouter, modifier ou retirer un moyen de paiement est journalisé strictement
  (`supplier.payment_details_changed`, avant et après **masqués**), notifie les détenteurs de
  `payables.pay` et `purchase.approve` (`purchases.supplier_payment_details_changed`), et pose sur
  la fiche un bandeau « Coordonnées de paiement modifiées le … par … » repris sur l'écran de
  paiement pendant **7 jours** (décision ouverte n° 9). Personne n'est bloqué par défaut.
- Jamais exportées en CSV, jamais servies à l'IA, jamais écrites dans les journaux d'exploitation.

#### 2.2 `purchase_settings`

| Champ | Règle |
|---|---|
| `approvalTiers` | par devise : `{ CDF: Tier[], USD: Tier[] }`, `Tier = { from: chaîne ≥ 0, approvals: 0 \| 1 \| 2 }`, triés par `from` strictement croissant, le premier à `from = '0'` ; **défaut : `[{ from: '0', approvals: 1 }]` pour chaque devise** (toute commande approuvée une fois — décision ouverte n° 3) |
| `allowSoleApprover` | défaut `true` : l'organisation qui n'a qu'**un** détenteur effectif de `purchase.approve` peut approuver ses propres demandes, marquées `soleApprover` (motif R2) |
| `matchingTolerances` | `{ pricePercent: '0'–'10', amountAbsolute: { CDF, USD } }` ; défaut `0` partout (décision ouverte n° 6) |
| `dueSoonDays` | 1 à 30, défaut 7 : « à payer bientôt » (brief, cloche, échéancier) |
| `requireOrderForInvoice` | défaut `false` : une facture sans commande est permise |
| `paymentDetailsAlertDays` | 0 à 30, défaut 7 (§ 2.1.1) |

#### 2.3 `purchase_orders` (demande puis commande)

| Champ | Règle |
|---|---|
| `phase` | `request` \| `order` ; passe à `order` à l'approbation complète |
| `status` | demande : `draft` → `submitted` → `approved` \| `rejected` ; commande : `approved` → `sent` → `partially_received` → `received` → `closed` ; `cancelled` à tout moment avant `received` (motif obligatoire) ; `partially_received` et `received` sont **dérivés** des réceptions par le moteur et dénormalisés dans la même transaction |
| `requestNumber` | `DA{AA}{MM}-NNNNNN`, attribué à la **soumission** |
| `orderNumber` | `BC{AA}{MM}-NNNNNN`, attribué à l'**approbation complète** ; compteurs annuels au jour de Kinshasa, trous admis, **hors série fiscale** (motif ADR-0035) |
| `requestedBy` | membre qui exprime le besoin (défaut : le créateur) ; doit détenir `purchase.request` |
| `title`, `justification` | 1 à 200 ; ≤ 2 000 |
| `supplierId` | requis à la soumission ; fiche active de l'organisation |
| `currency` | `CDF` \| `USD`, non modifiable après soumission |
| `lines` | 1 à 100 `{ id, label (1–200), quantity (> 0, trois décimales au plus), unit (≤ 20), unitPrice (≥ 0, HT), discountPercent (0–100, facultatif), kind: 'goods' \| 'service', receivable: boolean (défaut : `true` pour `goods`, `false` pour `service`), category (ADR-0034 § 1, défaut celle du fournisseur), workProjectId \| null, itemRef \| null }` |
| `declaredTaxes` | 0 à 5 `{ label (1–60), amount }` : taxes **indiquées par le fournisseur** sur son devis (TVA, autres) ; **jamais calculées** (§ 9) |
| `totals` | rendus par le moteur (`computeOrderTotals`) : `subtotal` (HT), `taxes` (Σ des taxes déclarées), `total` (TTC) ; stockés pour l'affichage et l'approbation, recalculés à chaque écriture |
| `expectedOn` | date de livraison souhaitée, facultative |
| `deliveryAddress` | facultative, ≤ 500 ; défaut : siège de l'organisation |
| `requiredApprovals` | 0, 1 ou 2, figé à la soumission par le moteur (`requiredApprovals`, § 7) |
| `approvals` | `[{ userId, decision: 'approved' \| 'rejected', at, comment, soleApprover }]` |
| `approvedTotal` | total TTC à l'approbation complète |
| `sentAt`, `sentVia` | `email` (§ 3.3) \| `manual` |
| `cancellation` | `{ at, by, reason }` |

**Règles de cycle de vie**

- Modifier une demande `submitted` ou `approved` (fournisseur, lignes, taxes, quantités, prix)
  **efface les approbations** et la remet à `submitted` (`requiredApprovals` recalculé) ; une
  commande `sent` n'est plus modifiable : on annule le reste et on en fait une autre (avenants :
  hors R3).
- **Séparation des tâches** (vérifiée dans le service par une fonction pure de `permissions.ts`,
  `purchaseApprovalDecision`, sans aucun `if (role === …)`) :
  - un approbateur détient `purchase.approve` (droits **effectifs**, ADR-0041) ;
  - il n'est ni `requestedBy` ni le créateur de la demande (`409 SELF_APPROVAL_FORBIDDEN`) ;
  - pour deux approbations, les deux approbateurs sont **distincts** (`409 APPROVER_ALREADY_APPROVED`) ;
  - **exception** : si `allowSoleApprover` et que l'organisation compte **un seul** détenteur
    effectif de `purchase.approve` (motif `countApprovers` d'ADR-0041 G4), il approuve sa propre
    demande, l'approbation porte `soleApprover: true`, et le palier à deux approbations se réduit
    à une (l'écran le dit) ;
  - un refus, par n'importe quel approbateur éligible, clôt la demande (`rejected`, commentaire
    obligatoire) ; elle se duplique pour être resoumise.
- Palier à 0 approbation : la soumission vaut approbation (`approvals: []`, numéro `BC` attribué),
  journalisée comme telle.
- Toute transition est journalisée (`audit_events` : `purchase_order.submitted|approved|rejected|
  sent|cancelled|closed`).

Index : `{ organizationId, status, updatedAt }` ; `{ organizationId, supplierId, createdAt }` ;
`{ organizationId, requestedBy, status }` ; `{ organizationId, 'lines.workProjectId' }` (partiel) ;
uniques partiels `{ organizationId, requestNumber }`, `{ organizationId, orderNumber }`.

#### 2.4 `purchase_receptions`

| Champ | Règle |
|---|---|
| `orderId` | commande `sent` ou `partially_received` (une commande `approved` non envoyée peut être reçue : livraison sur appel, l'écran le signale) |
| `receivedOn` | date civile, jamais future |
| `lines` | 1 à 100 `{ orderLineId (ligne `receivable`), quantity (> 0) }` ; la somme reçue d'une ligne peut **dépasser** la commande : l'excédent est un écart (`RECEIVED_OVER_ORDERED`), pas un refus |
| `deliveryNoteRef` | n° du bon de livraison, ≤ 100 |
| `attachment` | une pièce (§ 2.7) |
| `note` | ≤ 1 000 |
| `status` | `recorded` \| `cancelled` (motif ; jamais d'effacement) |

Une ligne de **service** (`receivable: false`) se constate par une réception « service fait » de
quantité 1 ou par la facture seule (deux voies). **Aucune quantité en stock n'est tenue** : voir
§ 6.6 (accroche R5). Index : `{ organizationId, orderId, receivedOn }`.

#### 2.5 `supplier_invoices`

| Champ | Règle |
|---|---|
| `internalNumber` | `FF{AA}{MM}-NNNNNN`, attribué à la création (pièce interne, hors série fiscale) |
| `supplierId` | requis |
| `supplierReference` | n° de la facture du fournisseur, 1 à 100 ; **unique partiel** `{ organizationId, supplierId, supplierReferenceKey }` hors annulées (clé normalisée : majuscules, sans espaces) : `409 SUPPLIER_INVOICE_DUPLICATE` avec l'identifiant existant — premier rempart contre la double facture |
| `kind` | `invoice` \| `credit_note` (avoir fournisseur : diminue la dette ; imputé à une facture du même fournisseur et de la même devise) |
| `invoiceDate`, `receivedOn` | dates civiles, jamais futures |
| `dueDate` | défaut : `dueDateOf(paymentTerms, invoiceDate)` (moteur) ; modifiable ; ≥ `invoiceDate` |
| `currency` | `CDF` \| `USD` ; égale à celle de la commande liée (`SUPPLIER_INVOICE_CURRENCY_MISMATCH`) |
| `orderIds` | 0 à 10 commandes du même fournisseur (une facture peut solder plusieurs commandes) |
| `lines` | 0 à 100 `{ orderLineId \| null, label, quantity, unitPrice (HT), discountPercent }` ; obligatoires si `orderIds` est non vide (rapprochement) |
| `subtotal` | HT : **calculé** par le moteur si des lignes existent, **saisi** sinon |
| `taxes` | 0 à 5 `{ label, amount }`, **recopiées de la facture du fournisseur**, jamais calculées |
| `total` | TTC, **saisi tel qu'imprimé** sur la facture ; le moteur vérifie `total = subtotal + Σ taxes` au centime (`SUPPLIER_INVOICE_TOTAL_MISMATCH`, l'écran montre la différence) |
| `deductibleVat` | TVA déductible **déclarée par l'utilisateur**, facultative, ≤ Σ taxes ; **conservée pour le comptable, jamais utilisée dans un calcul** (reprend ADR-0034 § 2, décision ouverte n° 12) |
| `costAllocations` | 1 à 20 `{ category, workProjectId \| null, amount }` dont la somme = `total` (`SUPPLIER_INVOICE_ALLOCATION_MISMATCH`) ; défaut : une ligne, catégorie du fournisseur, projet des lignes de la commande s'il est unique. Sert au paiement (§ 2.6) et à l'« engagé » de la marge (§ 6.1) |
| `attachment` | la facture scannée (§ 2.7) ; facultative, l'écran la réclame (« sans pièce ») |
| `status` | `draft` (saisie) → `validated` (dette reconnue, « bon à payer ») → `cancelled` (motif) ; payée ou partiellement payée est **dérivé** des paiements par le moteur, jamais stocké comme vérité |
| `matching` | rendu par le moteur (§ 5) : `{ mode: 'none' \| 'two_way' \| 'three_way', status: 'not_applicable' \| 'matched' \| 'variance', variances[] }`, recalculé à chaque écriture de la facture, d'une réception ou de la commande |
| `forcedValidation` | `null` \| `{ by, at, reason }` : validation malgré un écart (§ 5.3) |
| `disputed` | `null` \| `{ by, at, reason }` : litige ; bloque le paiement (`409 SUPPLIER_INVOICE_DISPUTED`), visible dans l'échéancier |

Index : `{ organizationId, status, dueDate }` (échéancier, retards) ; `{ organizationId, supplierId,
invoiceDate }` ; `{ organizationId, orderIds }` ; `{ organizationId, 'costAllocations.workProjectId' }`
(partiel) ; unique partiel de la référence.

#### 2.6 `supplier_payments`

| Champ | Règle |
|---|---|
| `number` | `PF{AA}{MM}-NNNNNN` (pièce interne) |
| `supplierId`, `currency` | la devise de toutes les imputations |
| `paidOn` | date civile, jamais future ; ≥ ouverture du compte |
| `amount` | > 0 |
| `accountId` | compte de trésorerie qui a payé, **facultatif** comme pour une dépense (ADR-0034 § 2), même devise, actif ; sans compte, la prévision le compte comme incertitude (constat existant `EXPENSES_WITHOUT_ACCOUNT`) |
| `method` | `bank_transfer` \| `mobile_money` \| `cash` \| `cheque` \| `other` ; `paymentMethodId` facultatif (moyen du fournisseur utilisé, § 2.1.1) |
| `reference` | n° de transaction ou de chèque, ≤ 100 |
| `allocations` | 1 à 50 `{ invoiceId, amount }` : factures `validated` du fournisseur, non en litige, même devise ; Σ = `amount` (`SUPPLIER_PAYMENT_ALLOCATION_MISMATCH`) ; aucune imputation au-delà du reste à payer (`SUPPLIER_PAYMENT_EXCEEDS_REMAINING`) |
| `expenseIds` | dépenses `treasury_expenses` créées ou rattachées (§ 6.2) |
| `origin` | `recorded` (saisi dans les achats) \| `linked_expense` (dépense directe existante rattachée) |
| `status` | `recorded` \| `cancelled` (motif) : l'annulation annule, **dans la même transaction**, les dépenses qu'il a créées (jamais une dépense rattachée, qui redevient directe) |

**Acomptes fournisseurs** (paiement avant facture) : **hors R3** par défaut (décision ouverte n° 7) ;
un paiement exige au moins une facture validée. Index : `{ organizationId, supplierId, paidOn }` ;
`{ organizationId, 'allocations.invoiceId' }`.

#### 2.7 Pièces jointes des achats

Motif exact d'ADR-0039 § 2.5 (`work_attachments`), sans analyse de PDF : images PNG, JPEG, WebP ≤ 2
Mio **assainies** (`account/image-validation.ts`) ; PDF ≤ 10 Mio reconnus par la signature
`%PDF-`, **non analysés**, servis **uniquement en téléchargement** (`Content-Disposition:
attachment`, `nosniff`, `Content-Security-Policy: sandbox`) ; tout autre type `415
PURCHASE_ATTACHMENT_TYPE`. Clé `purchase-attachments/<objectId>` tirée au hasard ; corps binaire,
nom en `X-File-Name` ; 30 envois par heure et par utilisateur ; borne commune avec les pièces de
projet : 1 Gio par organisation. Une pièce par réception, une par facture fournisseur (R3).

#### 2.8 Champs ajoutés à la trésorerie (ADR-0034)

| Collection | Champ | Règle |
|---|---|---|
| `treasury_expenses` | `supplierId` | `null` ou une fiche de l'organisation, active à l'écriture ; quand il est posé, `supplierName` devient une **copie d'affichage** du nom de la fiche ; un `supplierName` texte sans `supplierId` reste permis (« fournisseur de passage ») |
| `treasury_expenses` | `origin` | `null` (dépense directe) \| `{ kind: 'supplier_payment', paymentId, invoiceId, allocationIndex }` ; non nul ⇒ dépense **possédée par les achats** : `PUT`, `cancel` et pièce jointe par `/treasury/expenses/**` → `409 EXPENSE_OWNED_BY_PURCHASES` |
| `treasury_recurring_expenses` | `supplierId` | comme ci-dessus |

Index ajoutés : `{ organizationId, supplierId, spentOn }` (partiel, non nul) ; unique partiel
`{ organizationId, 'origin.paymentId', 'origin.invoiceId', 'origin.allocationIndex' }` (un paiement
ne crée jamais deux fois la même dépense).

#### 2.9 Migration `20261031-0001-suppliers-from-expenses.mjs`

Idempotente, par organisation, en lot (motif de `20261030-0001-crm-accounts.mjs`) :

1. regroupe les `supplierKey` non nuls de `treasury_expenses` et `treasury_recurring_expenses` par
   **clé exacte** — aucun rapprochement approché (« SOCIMEX » et « Socimex » : une fiche ; « Socimex »
   et « Socimex SARL » : deux) ;
2. crée une fiche par groupe : nom = graphie la plus fréquente, `legacyKeys = [clé]`, devise par
   défaut = devise la plus fréquente du groupe, conditions `immediate`, catégorie = la plus
   fréquente ;
3. pose `supplierId` sur les dépenses et règles du groupe (`supplierName` inchangé) ;
4. rapport (journal de migration et `GET /purchases/suppliers/migration-report`, `purchase.manage`) :
   fiches créées, graphies par fiche, dépenses rattachées. Les doublons réels se fusionnent ensuite
   (`POST /purchases/suppliers/:id/merge`).

Après migration, saisir une dépense avec un texte dont la clé figure dans `legacyKeys` d'une fiche
pose `supplierId` (rattachement automatique, exact). Rejouée deux fois, la migration ne crée rien de
plus (test).

### 3. Contrat HTTP

Tous les contrôleurs : `@UseGuards(AuthGuard, PermissionsGuard)`, `@RequirePermission(…)` par route
(liste = toutes requises) ; corps `.strict()`, montants en chaînes, erreurs au format des
contrôleurs de ventes et de trésorerie, listes paginées par curseur (`time-cursor.ts`). Module API
`apps/api/src/purchases/` (`PurchasesModule`), web `/achats`.

#### 3.1 Fournisseurs

| Méthode et chemin | Permission | Effet |
|---|---|---|
| `GET /purchases/suppliers?q=&active=&cursor=` | `purchase.read` | liste ; reste dû par devise si l'appelant a aussi `treasury.read` |
| `POST /purchases/suppliers` · `PUT /purchases/suppliers/:id` | `purchase.manage` | fiche (hors moyens de paiement) |
| `POST …/:id/archive` · `…/restore` | `purchase.manage` | archivage ; refusé avec des factures validées non soldées (`409 SUPPLIER_HAS_OPEN_PAYABLES`) |
| `DELETE /purchases/suppliers/:id` | `purchase.manage` | seulement sans commande, facture, paiement ni dépense ; sinon `409 SUPPLIER_IN_USE` |
| `POST …/:id/merge` `{ targetSupplierId, expectedRevision }` | `purchase.manage` | réassigne commandes, factures, paiements, dépenses, `legacyKeys` en une transaction ; la source garde `mergedInto` ; refusé si les deux ont des NIF différents |
| `POST …/:id/payment-methods` · `PUT …/:methodId` · `DELETE …/:methodId` | `purchase.manage` | § 2.1.1 ; audit strict, notification |
| `POST …/:id/payment-methods/:methodId/reveal` | `payables.pay` | clair, audit strict, débit borné |
| `GET …/:id/overview` | `purchase.read` (sections : § 3.1.1) | fiche 360° |
| `GET /purchases/suppliers/migration-report` | `purchase.manage` | § 2.9 |

`GET /treasury/suppliers` (autocomplétion de la trésorerie) rend désormais les fiches **et** les
textes libres restants, chaque élément avec `supplierId | null` ; permission inchangée
(`treasury.read`).

**3.1.1 Fiche 360°** — sections `{ status: 'known' | 'hidden' | 'empty' }` (motif d'ADR-0040 § 3.1.2) :

| Section | Condition | Contenu | Calcul |
|---|---|---|---|
| Identité, contacts, conditions | `purchase.read` | fiche ; moyens de paiement **masqués** | — |
| Demandes et commandes | `purchase.read` | par statut, montants TTC par devise | `computeOrderTotals` |
| Réceptions | `purchase.read` | par commande, reste à recevoir | `orderReceptionStatus` |
| Factures et avoirs | `purchase.read` | statut, rapprochement, échéance, reste à payer | `payableSettlement` |
| **Solde dû et ancienneté** | `purchase.read` | reste à payer **par devise** ; non échu, 1–30, 31–60, 61–90, > 90 jours ; en litige à part | `payablesAging` |
| Paiements | `purchase.read` + `treasury.read` | paiements, compte, dépenses créées | — |
| Dépenses directes | `treasury.read` | dépenses `supplierId` sans `origin`, doublons probables signalés | `possibleDuplicateExpenses` |

#### 3.2 Demandes et commandes

| Méthode et chemin | Permission | Effet |
|---|---|---|
| `GET /purchases/orders?phase=&status=&supplierId=&requestedBy=me\|<id>&workProjectId=&cursor=` | `purchase.read` | liste |
| `GET /purchases/orders/:id` | `purchase.read` | fiche, totaux, approbations, réceptions, factures liées |
| `POST /purchases/orders` | `purchase.request` | crée une demande `draft` ; `requestedBy` = l'appelant, ou un autre membre si l'appelant a `purchase.manage` |
| `PUT /purchases/orders/:id` | `purchase.request` (sa demande `draft`) ou `purchase.manage` | § 2.3 ; une modification efface les approbations |
| `DELETE /purchases/orders/:id` | idem | brouillon seulement |
| `POST …/:id/submit` | `purchase.request` | `requestNumber`, `requiredApprovals` ; notifie les approbateurs éligibles |
| `POST …/:id/approve` `{ comment?, expectedRevision }` | `purchase.approve` | § 2.3 ; à la dernière approbation : `phase = order`, `orderNumber` |
| `POST …/:id/reject` `{ comment, expectedRevision }` | `purchase.approve` | refus motivé |
| `POST …/:id/duplicate` | `purchase.request` | nouvelle demande `draft` |
| `POST …/:id/mark-sent` | `purchase.manage` | commande `approved` → `sent` (`sentVia: 'manual'`) |
| `POST …/:id/cancel` `{ reason }` | `purchase.manage` | refusé si une facture validée la vise (`409 PURCHASE_ORDER_INVOICED`) |
| `POST …/:id/close` | `purchase.manage` | clôture le reste à recevoir d'une commande partiellement reçue |
| `GET …/:id/pdf` | `purchase.read` | bon de commande PDF (§ 3.3) ; audit `purchase_order.pdf_exported` |
| `GET …/:id/email` · `POST …/:id/email` | `purchase.manage` | § 3.3 |
| `GET /purchases/approvals/pending` | `purchase.approve` | demandes que l'appelant peut approuver (exclut les siennes, sauf approbateur unique) |

**3.3 Bon de commande PDF et envoi au fournisseur (étend ADR-0042).** Le PDF est rendu par la chaîne
des documents de vente (ADR-0025, identité et modèle d'ADR-0028 : en-tête, logo, coordonnées de
l'organisation), modèle de présentation propre `purchase-order-document.model.ts` : numéro `BC`,
date d'approbation, fournisseur (nom, NIF s'il existe, adresse), lignes, sous-total HT, taxes
**telles que déclarées**, total, adresse et date de livraison, conditions de paiement, mention fixe
« Bon de commande — ce document n'est pas une facture ». **Ni QR code, ni élément de sécurité DGI,
ni coordonnées bancaires du fournisseur.** Envoyable aux statuts `approved` et `sent` (sinon `409
DOCUMENT_NOT_SENDABLE`) ; destinataire prérempli par le contact principal du fournisseur ; objet,
message, copie, expéditeur, « répondre à », pièce jointe, journaux masqués et **audit strict**
(`purchase_order.email_requested` avant, `purchase_order.emailed` après) **exactement comme ADR-0042
§ 3 à § 8** ; même seau de débit (`document-email-throttler.guard.ts` : 20 par heure et par
utilisateur, 100 par organisation, tous documents confondus). Un envoi réussi d'une commande
`approved` la passe à `sent` (`sentVia: 'email'`) — contrairement au devis (ADR-0042, décision n° 2),
l'envoi **est** ici le geste de transmission (décision ouverte n° 8).

#### 3.4 Réceptions

| Méthode et chemin | Permission | Effet |
|---|---|---|
| `GET /purchases/receptions?orderId=&from=&to=&cursor=` | `purchase.read` | liste |
| `POST /purchases/receptions` | `purchase.manage` | § 2.4 ; statut de la commande recalculé ; port de stock appelé (§ 6.6) |
| `POST …/:id/cancel` `{ reason }` | `purchase.manage` | idem |
| `POST …/:id/attachment` · `GET …/:id/attachment` | `purchase.manage` · `purchase.read` | § 2.7 |

#### 3.5 Factures fournisseurs

| Méthode et chemin | Permission | Effet |
|---|---|---|
| `GET /purchases/invoices?status=&supplierId=&due=overdue\|soon\|all&matching=&disputed=&cursor=` | `purchase.read` | liste avec reste à payer et rapprochement |
| `GET /purchases/invoices/:id` | `purchase.read` | fiche, rapprochement détaillé, paiements |
| `POST /purchases/invoices` · `PUT …/:id` | `purchase.manage` | `draft` ; `POST /purchases/invoices/from-order` `{ orderId }` préremplit les lignes au reste à facturer |
| `POST …/:id/validate` `{ expectedRevision }` | `purchase.manage` | `draft` → `validated` si `matching.status ≠ 'variance'`, sinon `409 SUPPLIER_INVOICE_VARIANCE` avec les écarts |
| `POST …/:id/force-validate` `{ reason, expectedRevision }` | `purchase.approve` | valide malgré l'écart (§ 5.3) |
| `POST …/:id/dispute` `{ reason }` · `…/resolve-dispute` | `purchase.manage` | litige |
| `POST …/:id/cancel` `{ reason }` | `purchase.manage` | refusé si un paiement non annulé l'impute (`409 SUPPLIER_INVOICE_PAID`) |
| `POST …/:id/attachment` · `GET …/:id/attachment` | `purchase.manage` · `purchase.read` | § 2.7 |

#### 3.6 Dettes et paiements

| Méthode et chemin | Permission | Effet |
|---|---|---|
| `GET /purchases/payables?asOf=&supplierId=` | `purchase.read` | échéancier par devise : en retard, à payer sous `dueSoonDays`, à venir par semaine puis par mois, ancienneté ; litiges à part |
| `GET /purchases/payments?supplierId=&from=&to=&cursor=` | `purchase.read` + `treasury.read` | liste |
| `POST /purchases/payments` | `payables.pay` | § 2.6 ; crée les dépenses (§ 6.2) dans la même transaction ; audit `supplier_payment.recorded` |
| `POST /purchases/payments/from-expense` `{ expenseId, allocations, expectedRevision }` | `payables.pay` + `treasury.manage` | rattache une dépense directe existante (§ 6.2, O3) |
| `POST …/:id/cancel` `{ reason }` | `payables.pay` | annule le paiement et les dépenses qu'il a créées |
| `GET /purchases/duplicates` | `purchase.read` + `treasury.read` | doublons probables dépense directe ↔ paiement (O3) |

#### 3.7 Réglages, rapports

| Méthode et chemin | Permission | Effet |
|---|---|---|
| `GET /purchases/settings` · `PUT /purchases/settings` | `purchase.read` · `purchase.manage` **et** `purchase.approve` (changer les paliers, c'est changer qui approuve : il faut être soi-même approbateur) | § 2.2 |
| `GET /purchases/summary?from=&to=` | `purchase.read` | engagé (commandes approuvées non facturées), facturé, payé, reste à payer, par devise, par fournisseur et par catégorie |

Contrôleurs nouveaux à inscrire dans `routes-coverage.test.ts` : `PurchaseSuppliersController`,
`PurchaseOrdersController`, `PurchaseReceptionsController`, `SupplierInvoicesController`,
`SupplierPaymentsController`, `PurchaseSettingsController`.

### 4. Permissions (amende ADR-0012, docs/12 ; étend ADR-0041)

#### 4.1 Cinq actions nouvelles (vingt-neuvième à trente-troisième, en fin d'`ACTIONS`)

| Action | Libellé (ADR-0041 § 5) | Couvre |
|---|---|---|
| `purchase.read` | Consulter les achats et les fournisseurs | fiches (paiement masqué), demandes, commandes, réceptions, factures, échéancier, PDF |
| `purchase.request` | Demander un achat | créer, modifier, soumettre, dupliquer **ses** demandes |
| `purchase.manage` | Gérer les fournisseurs, commandes, réceptions et factures fournisseurs | fiches et moyens de paiement, toute demande, envoi des bons de commande, réceptions, saisie et validation des factures sans écart, litiges |
| `purchase.approve` | Approuver les demandes d'achat | approuver ou refuser ; forcer une facture en écart ; régler les paliers (avec `purchase.manage`) |
| `payables.pay` | Payer les fournisseurs | enregistrer et annuler les paiements, voir les coordonnées de paiement en clair |

| Action | PRO | ADM | DIR | CPT | ANA | CDP | CON | LEC | COM |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| `purchase.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ |
| `purchase.request` | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| `purchase.manage` | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `purchase.approve` | ✓ⓢ | ✗ | ✓ⓢ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `payables.pay` | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |

Justifications :

- **`purchase.read`** suit `treasury.read` : les achats révèlent fournisseurs, prix et dettes. Le
  **Conseiller** (externe) et le **Commercial** (D3 d'ADR-0040 : ni trésorerie ni dépenses) n'y ont
  pas accès ; le **Chef de projet** n'a rien (rôle non attribuable).
- **`purchase.request`** est donnée à tout rôle interne qui travaille (Analyste compris) : exprimer
  un besoin n'engage rien. Le **Lecteur** reste en lecture seule ; le **Commercial** n'en a pas
  (décision ouverte n° 4 : la lui donner exigerait `purchase.read`, donc la vue des prix d'achat).
- **`purchase.manage`** suit `sales.manage` : l'**Administrateur** prépare (fiches, commandes,
  factures) sans approuver ni payer, comme il prépare une facture sans l'émettre.
- **`purchase.approve`** est une **autorité de dépense** : Propriétaire et Directeur financier, en
  case ⓢ (séparation des tâches appliquée par le service, § 2.3). Le **Comptable** constate et paie,
  il n'autorise pas la dépense (motif de `plan.approve`) ; l'**Administrateur** non plus (gouvernance
  technique, pas financière).
- **`payables.pay`** suit `treasury.manage` (Propriétaire, Directeur financier, Comptable) : payer
  est un décaissement.
- **Plateforme** : `purchase.read` sous accès délégué pour le super-administrateur et le support ;
  `purchase.request` et `purchase.manage` sous accès délégué pour le seul super-administrateur ;
  `purchase.approve` et `payables.pay` refusées à tous les rôles plateforme par la matrice (motif de
  `sales.receipt`), sans être des interdits absolus.

#### 4.2 Rôle Acheteur : non (O6)

Aucun rôle nouveau ; matrice **9 × 33 + 6 × 33 = 495** cases. Le rôle `buyer` reste spécifié en O6,
prêt si la dirigeante le demande (décision ouverte n° 2). En attendant, un membre « acheteur » est
un Analyste ou un Lecteur avec ajout de `purchase.manage` (ADR-0041, dès l'activation de
`MEMBER_PERMISSIONS_ENABLED`).

#### 4.3 Compatibilité avec les autorisations par membre (ADR-0041)

- **Dépendances** (`ACTION_DEPENDENCIES`) : `purchase.request`, `purchase.manage`,
  `purchase.approve` exigent `purchase.read` ; `payables.pay` exige `purchase.read` **et**
  `treasury.read` (le paiement crée une dépense que le payeur doit pouvoir relire). Le test « chaque
  ligne de rôle satisfait déjà ses dépendances » reste vert avec la matrice du § 4.1.
- **Domaine** (`ACTION_DOMAINS`) : huitième domaine **« Achats et fournisseurs »**, cinq actions,
  libellés du § 4.1.
- **Paire incompatible par ajout** (`SOD_PAIRS`, G4) : **`purchase.approve` + `payables.pay`** — celui
  qui autorise la dépense et celui qui paie ne se cumulent pas par ajout (un Comptable ne reçoit pas
  `purchase.approve`). Propriétaire et Directeur financier les cumulent nativement (matrice déjà
  arbitrée) ; la séparation dynamique du § 2.3 s'y applique.
- **Approbateur unique** : compté sur les détenteurs **effectifs** de `purchase.approve` (ajouts
  compris, retraits déduits), par la fonction de comptage d'ADR-0041 G4 généralisée à une action.
- **Non délégable** : rien de nouveau (`billing.manage` seule).
- **R7** : inchangée ; les rôles attribuables par chacun ne changent pas (aucun rôle nouveau).
- **Destinataires des notifications** (approbateurs, payeurs) : choisis par droits **effectifs**,
  jamais par une requête `role: { $in: … }` (ADR-0041 § 9.4).

### 5. Rapprochement commande, réception, facture

#### 5.1 Mode

| Facture | Mode | Contrôles |
|---|---|---|
| sans commande | `none` → `not_applicable` | total = sous-total + taxes ; doublon de référence |
| liée à une commande, ligne non `receivable` | `two_way` | prix unitaire facturé vs commandé ; quantité facturée cumulée (toutes factures validées de la ligne) ≤ commandée |
| liée à une commande, ligne `receivable` | `three_way` | les contrôles à deux voies **et** quantité facturée cumulée ≤ quantité reçue (réceptions non annulées) |

Le mode d'une facture est le plus exigeant de ses lignes.

#### 5.2 Écarts (moteur `matchInvoice`)

Codes : `PRICE_ABOVE_ORDER` (prix facturé > prix commandé au-delà de la tolérance),
`QUANTITY_ABOVE_ORDER`, `QUANTITY_ABOVE_RECEIVED`, `LINE_NOT_ON_ORDER` (ligne sans `orderLineId`
sur une facture liée), `TOTAL_ABOVE_ORDER` (total facturé cumulé > total approuvé, tolérance
absolue), `TAXES_DIFFER_FROM_ORDER` (**information** seulement : taxes déclarées différentes de
celles de la commande ; ce n'est pas un contrôle fiscal), `RECEIVED_OVER_ORDERED` (information).
Chaque écart porte la ligne, l'attendu, le constaté, la différence et l'unité. Un prix **inférieur**
ou une quantité **inférieure** n'est pas un écart bloquant (facture partielle) ; il est rendu en
information.

#### 5.3 Décision

Sans écart bloquant : `validate` (`purchase.manage`). Avec écart : `409 SUPPLIER_INVOICE_VARIANCE` ;
trois issues : corriger la saisie, mettre en **litige** (le fournisseur refait sa facture), ou
**forcer** (`purchase.approve`, motif obligatoire, audit `supplier_invoice.force_validated` avec les
écarts) ; le créateur de la facture ne la force pas lui-même, sauf approbateur unique (même règle que
§ 2.3). Une notification `purchases.invoice_variance` part aux approbateurs.

### 6. Liens avec les modules existants

#### 6.1 Projets RUN et marge (ADR-0039 § 5)

- Une ligne de commande et une imputation de facture peuvent viser un projet (`workProjectId`, projet
  non archivé de l'organisation, `PURCHASE_WORK_PROJECT_UNKNOWN`).
- **Ce qui entre dans la marge ne change pas** : la marge reste encaissée ; un paiement fournisseur y
  entre **par sa dépense** (`workProjectId` recopié de l'imputation), donc sans code nouveau dans le
  calcul de la marge et sans double comptage.
- **Ajout informatif** (`WORK_MARGIN_VERSION` 1.1.0, sortie existante inchangée) : par devise,
  `committed` = reste à payer des factures **validées** imputées au projet, et `ordered` = part des
  commandes approuvées **non encore facturée** imputée au projet. **Jamais soustraits** de la marge ;
  l'écran les montre sous la marge : « Coûts engagés non payés — informatif » (décision ouverte n° 10).
  Lus par l'API par un port `WORK_PURCHASES_SOURCE` (lecture seule de `supplier_invoices` et
  `purchase_orders`), fournisseur nul par défaut.
- La fiche projet liste ses commandes et factures fournisseurs (`GET /purchases/orders?workProjectId=`)
  si l'appelant détient `purchase.read`.

#### 6.2 Trésorerie : le paiement est une dépense réalisée (O2, O3)

- `TreasuryExpensesService` gagne **une** méthode, `recordOwnedBySupplierPayment(session, input)`,
  seul écrivain de `treasury_expenses` (la trésorerie garde ses règles : compte actif, même devise,
  postérieure à l'ouverture, `spentOn` = `paidOn`). Le service des paiements l'appelle **dans sa
  transaction**.
- **Ventilation** : le montant imputé à une facture est réparti sur ses `costAllocations` au
  prorata, par le moteur (`splitAllocation`, méthode du plus fort reste, déterministe, somme exacte
  au centime) ; **une dépense par part** : `amount` = la part, `category` et `workProjectId` de
  l'imputation, `supplierId`, `supplierName` (copie), `label` = « Paiement FF… — <référence
  fournisseur> », `reference` = celle du paiement, `accountId` du paiement, `deductibleVat` = part au
  prorata de la TVA déductible **déclarée** de la facture (aucun calcul de déductibilité : simple
  répartition d'un montant saisi), `origin = { kind: 'supplier_payment', … }`.
- **Rattacher une dépense directe** (`from-expense`) : la dépense existante devient le paiement ; si
  la facture a plusieurs imputations, la dépense est **remplacée** par les parts (dépense d'origine
  annulée avec le motif « Rattachée au paiement PF… », parts créées, en une transaction) ; si elle
  n'en a qu'une, la dépense reçoit seulement `origin` et `supplierId`.
- **Pont vers le réalisé (ADR-0034 § 5)** : inchangé ; les dépenses de paiement y vont par leur
  catégorie, au **montant payé** (décision ouverte n° 1 d'ADR-0034, inchangée). Une facture
  **validée mais non payée n'entre pas dans le réalisé** (le réalisé de Lalanda est un réalisé de
  trésorerie, docs/08) ; une charge constatée à la facture relève de la comptabilité d'engagement,
  hors périmètre (décision ouverte n° 11).

#### 6.3 Prévision de trésorerie (ADR-0034 § 7)

- Nouvelle composante **« Échéances fournisseurs »** (estimation) : reste à payer de chaque facture
  `validated` non en litige, à sa `dueDate` (une échéance passée est comptée à J+1, comme les
  récurrences en retard), dans sa devise. Port `TREASURY_PAYABLES_SOURCE` (`treasury-sources.ts`),
  fournisseur réel `PurchasesPayablesSource` (lecture seule), nul par défaut (constat
  `PAYABLES_NOT_INTEGRATED`).
- **Scénarios** : pas d'hypothèse nouvelle ; dans **tous** les scénarios, les dettes sont payées à
  l'échéance (le plus prudent pour la trésorerie : la sortie la plus tôt). Les litiges sont exclus et
  comptés en incertitude (`PAYABLES_DISPUTED`) ; les commandes approuvées non facturées ne sont
  **pas** prévues par défaut (montant et date inconnus), mais signalées (`ORDERS_NOT_INVOICED`, total
  par devise) — décision ouverte n° 5.
- **Double comptage avec le plan et les récurrences** : une dépense récurrente dont le `supplierId`
  a des factures validées à venir lève le constat `RECURRING_AND_PAYABLES_SAME_SUPPLIER` ; rien n'est
  retranché automatiquement.
- Moteur : `forecastTreasury` accepte `payables[]` ; `TREASURY_VERSION` **1.1.0** (sorties existantes
  inchangées quand `payables` est vide).

#### 6.4 Brief du matin (ADR-0033)

- Port **`PURCHASES_SOURCE`** (`morning-brief.ports.ts`), fournisseur réel
  `apps/api/src/purchases/brief/purchases-brief.source.ts`, nul par défaut ; chargé si l'appelant
  détient `purchase.read` (sinon faits `hidden`).
- Faits (`MORNING_BRIEF_VERSION` **1.3.0**) : `fournisseurs.factures_en_retard` (nombre) et
  `fournisseurs.a_payer_bientot` (nombre, sous `dueSoonDays`) — organisation ; leurs **montants par
  devise** seulement si l'appelant détient aussi `treasury.read` ; `mes_approbations.en_attente`
  (demandes soumises que **l'appelant** peut approuver).
- **R11 `factures_fournisseurs_en_retard`** (rang 11, `attention`) : `fournisseurs.factures_en_retard`
  > 0 ; « N factures fournisseurs ont dépassé leur échéance » ; « Ouvrir l'échéancier et planifier
  les paiements » ; `actionPath: '/achats/a-payer'`. **R12 `approbations_achat_en_attente`** (rang 12,
  `info`) : `mes_approbations.en_attente` > 0 ; « N demandes d'achat attendent votre approbation » ;
  `actionPath: '/achats/commandes?vue=a-approuver'`. L'IA du brief les explique sans les produire.
- E-mail quotidien : mêmes faits, même garde.

#### 6.5 « Mes tâches » et cloche (ADR-0039, ADR-0040 § 5)

- **Approbations à faire** dans « Mes tâches » : port `PURCHASES_AGENDA_SOURCE`
  (`work/my-tasks.ports.ts`), agrégation **à la lecture**, motif exact de `CRM_AGENDA_SOURCE` ;
  élément `{ source: 'purchases', id: 'purchases:<orderId>', orderId, requestNumber, title,
  supplierName, total, currency, dueDate: jour de soumission, priority: 'none', href }`, présent pour
  chaque demande `submitted` que l'appelant peut approuver ; il disparaît dès que la demande est
  approuvée, refusée ou modifiée. Pas de case à cocher : le bouton ouvre la demande (approuver
  exige une décision, pas une coche). Au plus 200 éléments, `truncated` signalé.
- **Notifications** (`NOTIFICATION_KINDS`, module `purchases`, entités `purchase_order`,
  `supplier_invoice`, `supplier`), refiltrées à la lecture par `purchase.read` :

| Type | Déclencheur | Destinataires |
|---|---|---|
| `purchases.approval_requested` | soumission | détenteurs effectifs de `purchase.approve` éligibles (pas le demandeur, sauf approbateur unique) |
| `purchases.request_approved` · `purchases.request_rejected` | décision finale | le demandeur (et le créateur s'il diffère) |
| `purchases.invoice_variance` | facture en écart | détenteurs de `purchase.approve` |
| `purchases.invoice_due_soon` · `purchases.invoice_overdue` | rappel quotidien (tâche `purchases.due-reminders`, motif de `work.due-reminders`, une fois par facture et par échéance, `dedupeKey`) | détenteurs effectifs de `payables.pay` |
| `purchases.supplier_payment_details_changed` | § 2.1.1 | détenteurs de `payables.pay` et `purchase.approve`, sauf l'auteur |

#### 6.6 Accroche des stocks (R5)

Aucune quantité n'est stockée. Chaque réception enregistrée ou annulée appelle, **après** sa
transaction, le port `PURCHASE_RECEPTION_SINK.onReceptionChanged({ organizationId, receptionId,
status, lines: [{ orderLineId, itemRef, quantity, unit }] })`, fournisseur **nul** en R3. Le champ
`itemRef` des lignes de commande (`null` en R3, ou une référence libre) recevra l'article de stock
de R5 ; R5 branchera son fournisseur sans toucher aux achats.

#### 6.7 GROW

Rien en R3 (décision ouverte n° 17) : un indicateur « délai moyen de paiement fournisseurs » est un
candidat naturel, mais il exige une définition sourcée et il relève de `treasury.read` (ADR-0040
§ 4.4).

### 7. Moteur (`packages/engine/src/purchases/`)

`PURCHASES_VERSION = '1.0.0'`, fonctions pures, jour de référence en paramètre, `bigint` en
centimes, montants en chaînes, **jamais de conversion** ; chaque résultat porte `{ version }`.

| Fonction | Rôle |
|---|---|
| `computeOrderTotals(lines, declaredTaxes)` | ligne = quantité × prix × (1 − remise), **un seul arrondi** au centime par ligne (demi vers le haut), sous-total, taxes déclarées, total |
| `requiredApprovals(tiers, currency, total)` | palier applicable (`from` ≤ total, le plus haut) |
| `orderReceptionStatus(order, receptions)` | reçu et reste à recevoir par ligne ; `approved`/`sent` → `partially_received` → `received` |
| `matchInvoice(order[], receptions[], invoices[], invoice, tolerances)` | § 5 ; cumul sur les factures validées non annulées |
| `checkInvoiceTotal(subtotal, taxes, total)` | égalité au centime |
| `dueDateOf(terms, invoiceDate)` | `immediate` = date de facture ; `net` = + N jours ; `end_of_month` = dernier jour du mois de la facture + N jours |
| `payableSettlement(invoice, allocations, creditNotes)` | payé, reste à payer, statut `unpaid` \| `partially_paid` \| `paid` |
| `payablesAging(invoices, today)` | par devise : non échu, 1–30, 31–60, 61–90, > 90 jours ; litiges à part |
| `payablesSchedule(invoices, today, dueSoonDays)` | en retard, bientôt, semaines puis mois à venir, par devise |
| `splitAllocation(amount, costAllocations)` | plus fort reste, somme exacte |
| `possibleDuplicateExpenses(payments, expenses)` | O3 (c) |
| `purchasesSummary(...)` | engagé, facturé, payé, reste, par devise, fournisseur, catégorie |

Modifiés : `treasury/forecast.ts` (`TREASURY_VERSION` 1.1.0, § 6.3), `work/margin.ts`
(`WORK_MARGIN_VERSION` 1.1.0, § 6.1), `morning-brief` (1.3.0, § 6.4). Rien n'écrit dans
`actual_periods`, un plan ou un scénario, hormis les dépenses déjà prévues par ADR-0034 par le pont
existant.

### 8. Interface (web)

Application RUN **Achats** (`/achats`, icône `achats`), dans `nav-model.ts` **juste avant
Trésorerie** (on engage, puis on paie), visible avec `purchase.read` :

| Sous-option | Route | Condition |
|---|---|---|
| Vue d'ensemble (défaut) | `/achats` : à approuver, à recevoir, factures en écart, à payer cette semaine, en retard | `purchase.read` |
| Demandes et commandes | `/achats/commandes`, fiche `/achats/commandes/[id]` (aperçu PDF, envoi par e-mail, approbation) | `purchase.read` |
| Réceptions | `/achats/receptions` | `purchase.read` |
| Factures fournisseurs | `/achats/factures`, fiche `/achats/factures/[id]` (rapprochement ligne à ligne, pièce, paiements) | `purchase.read` |
| À payer | `/achats/a-payer` : échéancier, ancienneté, paiement groupé par fournisseur, doublons probables | `purchase.read` (paiement : `payables.pay`) |
| Fournisseurs | `/achats/fournisseurs`, fiche 360° `/achats/fournisseurs/[id]` | `purchase.read` |
| Réglages | `/achats/reglages` (paliers, tolérances, échéances) | `purchase.read` (écriture : § 3.7) |

- Un membre qui n'a que `purchase.request` **et** `purchase.read` voit « Demandes et commandes » ; un
  bouton « Demander un achat » figure aussi sur la fiche projet (préremplit `workProjectId`).
- Montants : l'écran affiche ce que rend l'API, sans additionner ni convertir ; chaque devise sur sa
  ligne ; les taxes portent « telles qu'indiquées par le fournisseur ».
- Formulaire de dépense (trésorerie) : le champ fournisseur devient un **sélecteur de fiche** avec
  saisie libre (« fournisseur de passage ») ; une dépense possédée par les achats s'affiche en
  lecture seule avec le lien « Ouvrir le paiement PF… ».
- « Mes tâches » : éléments « Approbation » (forme et libellé, pas seulement une couleur), lien
  vers la demande.
- Coordonnées de paiement : masquées ; « Afficher » (avec `payables.pay`) demande une confirmation
  et dit que l'affichage est journalisé.
- Accessibilité et composants : ADR-0030 ; aperçu PDF en modale : motif d'ADR-0042 § 9.

### 9. Fiscalité : ce que cet ADR n'invente pas

Les documents fiscaux du dépôt (ADR-0021 à ADR-0028) portent sur les **ventes** : NIF et type DGI du
client, groupes de taxation, facture normalisée e-MCF, numérotation. **Aucun ne règle les achats.**
Cet ADR applique la règle d'ADR-0034 : ce qui n'est pas sourcé est **déclaré par l'utilisateur,
conservé, affiché, jamais calculé**.

| Sujet | Ce que fait Lalanda en R3 |
|---|---|
| TVA sur facture fournisseur | recopiée telle qu'imprimée (`taxes`) ; contrôle d'addition seulement |
| TVA déductible | **déclarée** (`deductibleVat`), conservée pour le comptable, répartie au prorata sur les dépenses de paiement, **jamais utilisée dans un calcul** de charge, de marge, de prévision ou de réalisé |
| Charge HT ou TTC | inchangé : montant **payé** (ADR-0034, décision ouverte n° 1) |
| Retenues à la source, précomptes, impôts retenus sur paiement | **aucune** ; un paiement est un décaissement brut (décision ouverte n° 13) |
| Validité d'une facture fournisseur (mentions, normalisation, éléments de sécurité DGI) | **non contrôlée** ; la pièce est conservée (décision ouverte n° 15) |
| NIF du fournisseur | facultatif, forme seulement (décision ouverte n° 14) |
| Importations, droits de douane | hors R3 (décision ouverte n° 16) |

## Hors périmètre (R3), dit explicitement

- **Stocks** : quantités, valorisation, articles de stock, inventaires, mouvements de magasin — R5
  (accroche § 6.6).
- **Comptabilité générale** : écritures, journaux, plan comptable OHADA, charges constatées à la
  facture, lettrage comptable, déclaration de TVA (ADR-0018 : pas de comptabilité générale).
- **Paiement réel automatique** : Lalanda **enregistre** un paiement fait ailleurs ; il n'émet aucun
  virement, aucun ordre de paiement bancaire, aucun transfert mobile money, ne se connecte à aucune
  banque ni opérateur.
- **IA qui agit** : l'IA peut expliquer une facture en écart, un retard ou une prévision ; elle ne
  crée, n'approuve, ne valide ni ne paie rien.
- Appels d'offres, comparaison de devis fournisseurs, contrats-cadres, catalogues fournisseurs,
  avenants de commande, portail fournisseur, lecture automatique (OCR) des factures, acomptes
  fournisseurs (décision ouverte n° 7), notes de frais (R4), conversion de devises, achats
  multi-sociétés.

## Conséquences

- Collections nouvelles : `suppliers`, `purchase_settings`, `purchase_counters`, `purchase_orders`,
  `purchase_receptions`, `supplier_invoices`, `supplier_payments` ; champs additionnels
  `supplierId`, `origin` sur `treasury_expenses`, `supplierId` sur `treasury_recurring_expenses` ;
  migration `20261031-0001-suppliers-from-expenses.mjs`. Toutes portent `organizationId`.
- RBAC : neuf rôles, **trente-trois actions** ; matrice 495 cases ; un domaine, des dépendances et une
  paire G4 de plus (ADR-0041) ; docs/12, ADR-0012, sonde e2e, couverture des routes et types web
  alignés.
- La trésorerie perd l'exclusivité d'écriture « à la main » de ses dépenses : certaines appartiennent
  aux achats (`EXPENSE_OWNED_BY_PURCHASES`) ; son service reste le seul écrivain.
- Moteur : `PURCHASES_VERSION` 1.0.0 ; `TREASURY_VERSION` 1.1.0 ; `WORK_MARGIN_VERSION` 1.1.0 ;
  `MORNING_BRIEF_VERSION` 1.3.0.
- `@lalanda/shared` gagne l'entrée `./purchases` ; `@lalanda/shared/notifications` sept types, un
  module, trois natures d'entité.
- Une tâche d'ordonnanceur : `purchases.due-reminders`.
- Les coordonnées de paiement des fournisseurs sont un nouvel actif sensible : chiffrement, audit
  strict de lecture, alerte de changement ; docs/17 à compléter au lot P2.
- Navigation : une application RUN de plus (`/achats`).

## Critères d'acceptation (testables)

1. **Permissions** : un `analyst` crée et soumet une demande (`200`) mais `403` sur `approve`,
   `POST /purchases/invoices`, `POST /purchases/payments` ; un `admin` saisit une facture (`200`),
   `403` sur `approve` et `payments` ; un `accountant` paie (`200`), `403` sur `approve` ; un
   `viewer` lit (`200`), `403` sur toute écriture ; un `sales_rep` et un `advisor` : `403` sur
   `GET /purchases/orders`. Matrice 495 cases et sonde e2e vertes.
2. **Séparation des tâches** : dans une organisation à deux approbateurs (Propriétaire, Directeur
   financier), le Propriétaire qui a demandé ne peut pas approuver (`409 SELF_APPROVAL_FORBIDDEN`),
   le Directeur financier le peut ; à palier 2, la même personne n'approuve pas deux fois (`409
   APPROVER_ALREADY_APPROVED`) ; dans une organisation à **un seul** approbateur, il approuve sa
   demande, `soleApprover: true`, palier réduit à 1, audit présent.
3. **Paliers** : USD `[0 → 0, 500 → 1, 5000 → 2]` : une demande de 499,99 USD est `approved` dès la
   soumission avec un `BC` ; 500,00 en exige une ; 5 000,00 deux ; une demande CDF suit ses propres
   paliers, jamais ceux de l'USD.
4. **Modification après approbation** : changer une quantité d'une demande approuvée efface les
   approbations et la remet à `submitted` ; une commande `sent` : `409`.
5. **Numérotation** : `DA` à la soumission, `BC` à l'approbation complète, compteurs annuels au jour
   de Kinshasa ; un brouillon supprimé laisse un trou.
6. **PDF et envoi** : le PDF du bon de commande porte « Bon de commande — ce document n'est pas une
   facture », aucun QR ni coordonnée bancaire du fournisseur ; l'envoi écrit l'audit strict avant
   l'envoi (échec de l'audit ⇒ rien ne part), passe la commande à `sent`, et le 21e envoi d'un
   utilisateur dans l'heure rend `429 DOCUMENT_EMAIL_RATE_LIMITED`.
7. **Trois voies** : commande de 10 unités à 5,00 USD, réception de 6 ; facture de 10 à 5,00 →
   `QUANTITY_ABOVE_RECEIVED`, `validate` rend `409 SUPPLIER_INVOICE_VARIANCE` ; `force-validate`
   par un approbateur avec motif → `validated`, audit avec les écarts ; facture de 6 → `matched`.
8. **Deux voies** : ligne de service à 100,00 facturée 110,00 avec tolérance 0 % →
   `PRICE_ABOVE_ORDER` ; avec tolérance 10 % → `matched`.
9. **Doublon** : une seconde facture du même fournisseur avec la référence « fa-001 » quand
   « FA 001 » existe → `409 SUPPLIER_INVOICE_DUPLICATE`.
10. **Paiement et trésorerie** : une facture de 1 000,00 USD imputée 600,00 au projet P (catégorie
    `achats`) et 400,00 sans projet (`services_exterieurs`), payée 500,00 depuis la banque USD :
    deux dépenses de 300,00 et 200,00, `origin` posé, solde du compte diminué de 500,00, reste à payer
    500,00, marge de P diminuée de 300,00, `committed` de P = 300,00 ; `PUT /treasury/expenses/:id`
    sur l'une : `409 EXPENSE_OWNED_BY_PURCHASES` ; annuler le paiement annule les deux dépenses et
    rend le reste à 1 000,00.
11. **Pas de double comptage** : une dépense directe de 200,00 USD chez ce fournisseur, rattachée par
    `from-expense` à une facture de 200,00 à une seule imputation : aucune dépense nouvelle, la
    dépense porte `origin`, la facture est payée ; le total des dépenses du mois est inchangé.
12. **Prévision** : une facture validée de 300,00 USD échue hier et une de 200,00 dans 10 jours
    font baisser la prévision USD de 300,00 à J+1 et de 200,00 à J+10 dans les trois scénarios ; une
    facture en litige n'y est pas et lève `PAYABLES_DISPUTED` ; aucune somme CDF + USD.
13. **Échéancier** : conditions « fin de mois + 30 » sur une facture du 15 janv. → échéance au 2 mars
    (année non bissextile) ; ancienneté au bon intervalle au changement de jour de Kinshasa.
14. **Coordonnées** : la liste et la fiche ne contiennent jamais le numéro complet ; `reveal` sans
    `payables.pay` : `403` ; avec : `200` et un `supplier.payment_details_revealed` au journal ;
    modifier un IBAN notifie les payeurs et affiche le bandeau 7 jours ; le document Mongo ne contient
    pas le numéro en clair (test sur la base).
15. **Brief, Mes tâches, cloche** : deux factures en retard → `fournisseurs.factures_en_retard = 2`
    et R11 ; une demande soumise apparaît dans « Mes tâches » du Directeur financier et non dans
    celle du demandeur ; approuvée, elle disparaît ; sans `purchase.read`, faits `hidden`.
16. **Migration** : « SOCIMEX » et « Socimex » donnent une fiche ; « Socimex SARL » une autre ;
    rejouée, rien de plus ; une nouvelle dépense saisie « socimex » reçoit le `supplierId`.
17. **Isolation** : toute route nouvelle rend `404` pour une ressource d'une autre organisation, y
    compris par `supplierId`, `orderLineId`, `invoiceId`, `accountId`, `workProjectId`, `expenseId`
    forgés.
18. **Aucune règle fiscale** : aucune sortie du moteur des achats ne dépend de `deductibleVat` ;
    `actual_periods` n'est modifié que par le pont existant, au montant payé.

## Plan de validation

- **Moteur (vitest)** : `computeOrderTotals` (arrondi unique, remises), `requiredApprovals` (bornes
  exactes des paliers), `orderReceptionStatus`, `matchInvoice` (deux et trois voies, cumul
  multi-factures, tolérances, réceptions annulées), `dueDateOf` (fins de mois, années bissextiles),
  `payableSettlement` (avoirs), `payablesAging` et `payablesSchedule`, `splitAllocation` (propriétés
  à graine fixe : somme exacte, parts ≥ 0), `possibleDuplicateExpenses` ; `forecastTreasury` 1.1.0
  (sans `payables` : sorties identiques à 1.0.0) ; `computeProjectMargin` 1.1.0 (idem).
- **Shared (vitest)** : schémas `@lalanda/shared/purchases` (`.strict()`, montants en chaînes,
  codes) ; types de notification.
- **API e2e (Mongo en mémoire)** : `purchase-suppliers.e2e` (fiche, NIF unique, fusion, chiffrement,
  `reveal`, alerte), `purchase-orders.e2e` (cycle, paliers, séparation, approbateur unique,
  numérotation, PDF, envoi avec espion de transport), `purchase-receptions.e2e`,
  `supplier-invoices.e2e` (rapprochement, doublon, forçage, litige, pièce PDF inerte),
  `supplier-payments.e2e` (dépenses créées, ventilation, annulation, `from-expense`, verrou de la
  trésorerie), `treasury-forecast.e2e` étendu, `work-margin.e2e` étendu, `morning-brief.e2e` (R11,
  R12), `my-tasks.e2e` étendu, `rbac-matrix.e2e` (cinq actions), migration (deux passages).
- **Web (vitest, modèles purs)** : `achats/_components/*-model.ts` (paliers, rapprochement affiché,
  échéancier par devise), `nav-model.test.ts` (Achats avant Trésorerie), `routes.test.ts` (`/achats`
  protégé), formulaire de dépense (sélecteur de fiche), `mes-taches-model.ts` (éléments
  « Approbation »).
- **Essai de la dirigeante** : créer deux fournisseurs (dont un avec compte bancaire) ; régler les
  paliers USD 0 / 500 / 5 000 ; avec un Analyste, demander 800 USD de fournitures pour un projet ;
  l'approuver, voir le `BC`, l'envoyer par e-mail ; recevoir 6 sur 10 ; saisir la facture de 10 avec
  sa photo, constater l'écart, la mettre en litige puis la corriger à 6 ; la valider ; voir la
  prévision baisser à l'échéance et R11 le lendemain de l'échéance ; payer en deux fois depuis la
  banque USD ; relire la marge du projet, « Dépenses », la fiche 360° du fournisseur et l'audit.

## Découpage en lots parallélisables (worktrees séparés)

Règle d'ADR-0011 et d'ADR-0012 § 9 : **un fichier = un seul écrivain** par lot ; les fichiers
partagés ne reçoivent que des **ajouts** d'une ligne ou d'un bloc, chacun dans sa zone, sous un
commentaire `// ADR-0044 — <lot>`.

| Lot | Contenu | Fichiers possédés (probables) | Critères | Tests | Dépend de |
|---|---|---|---|---|---|
| **P0 — Socle RBAC et contrats** (petit, en premier) | cinq actions, matrices, dépendances, domaine, paire G4, `purchaseApprovalDecision`, comptage d'approbateurs par action ; contrats partagés ; types de notification | `apps/api/src/authz/permissions.ts`, `permissions.test.ts`, `__tests__/rbac-matrix.e2e.test.ts` ; `packages/shared/src/purchases/**`, `packages/shared/package.json` (export `./purchases`) ; `packages/shared/src/notifications/index.ts` (sept types, module, entités) ; `apps/web/src/lib/api.ts` (`OrgAction`) ; `docs/12` (statut « appliqué ») | 1 (matrice), 2 (fonction pure) | matrice 495 cases ; dépendances ; G4 | — |
| **P1 — Moteur des achats** | `packages/engine/src/purchases/**` (§ 7, hors trésorerie et marge) | `packages/engine/src/purchases/**`, une ligne dans `packages/engine/src/index.ts` | 3, 7, 8, 13 (parties calcul) | vitest moteur, propriétés | — (parallèle à P0) |
| **P2 — Fournisseurs et migration** | `suppliers`, chiffrement des coordonnées, `reveal`, fusion, `supplierId` sur la trésorerie, rattachement par `legacyKeys`, migration et rapport, `PurchasesModule` | `apps/api/src/purchases/suppliers/**`, `purchases/purchases.module.ts` (crée), `apps/api/src/app.module.ts` (une ligne) ; `treasury.schemas.ts` et `treasury.dto.ts` (**champ `supplierId` seulement**), `treasury-expenses.service.ts` et `treasury-recurring.service.ts` (validation de `supplierId`, rattachement), `treasury-expenses.controller.ts` (`GET /treasury/suppliers`) ; `apps/api/migrations/20261031-0001-suppliers-from-expenses.mjs` (+ test) ; `__tests__/purchase-suppliers.e2e.test.ts` ; `docs/17` (coordonnées) | 14, 16, 17 (fournisseurs) | e2e ; migration deux passages | P0 |
| **P3 — Demandes, commandes, approbations** | `purchase_orders`, `purchase_settings`, compteurs, cycle, séparation des tâches, PDF, envoi (ADR-0042), notifications d'approbation, « Mes tâches » | `apps/api/src/purchases/orders/**`, `purchases/settings/**`, `purchases/documents/**`, `purchases/agenda/**`, `purchases/purchases-notifier.ts` ; `apps/api/src/work/my-tasks.ports.ts` et `work-tasks.service.ts` (**méthode `myTasks` seulement**, ajout d'une source) ; `packages/shared/src/work/views.ts` (élément `purchases`) ; `__tests__/purchase-orders.e2e.test.ts` | 2, 3, 4, 5, 6, 15 (Mes tâches) | e2e ; PDF ; espion de transport | P0, P1, P2 |
| **P4 — Réceptions, factures, rapprochement** | `purchase_receptions`, `supplier_invoices`, pièces jointes, `from-order`, validation, forçage, litige, port de stock nul | `apps/api/src/purchases/receptions/**`, `purchases/invoices/**`, `purchases/attachments/**`, `purchases/stock-sink.port.ts` ; `__tests__/purchase-receptions.e2e.test.ts`, `supplier-invoices.e2e.test.ts` | 7, 8, 9 | e2e | P2 ; P3 pour le rapprochement (factures sans commande livrables avant) |
| **P5 — Paiements et trésorerie** | `supplier_payments`, ventilation, dépenses possédées, `from-expense`, verrou `EXPENSE_OWNED_BY_PURCHASES`, doublons, prévision (`TREASURY_PAYABLES_SOURCE`, moteur 1.1.0) | `apps/api/src/purchases/payments/**`, `purchases/treasury/**` (source des dettes) ; `treasury.schemas.ts` et `treasury.dto.ts` (**champ `origin` seulement**), `treasury-expenses.service.ts` (méthode `recordOwnedBySupplierPayment` et verrou), `treasury-sources.ts` (port), `treasury-planning.service.ts` (lecture du port) ; `packages/engine/src/treasury/forecast.ts`, `types.ts`, `index.ts` (version) ; `__tests__/supplier-payments.e2e.test.ts`, `treasury-forecast` étendu | 10, 11, 12 | e2e ; moteur prévision | P1, P4 ; **après P2** sur les fichiers de trésorerie |
| **P6 — Liens : brief, marge, rappels, fiche 360°** | `PURCHASES_SOURCE`, R11, R12 ; `committed`/`ordered` de la marge ; tâche `purchases.due-reminders` ; `GET …/overview`, `GET /purchases/payables`, `GET /purchases/summary` | `apps/api/src/purchases/brief/**`, `purchases/reminders/**`, `purchases/overview/**`, `purchases/payables/**` ; `apps/api/src/morning-brief/morning-brief.ports.ts`, `morning-brief.module.ts`, `morning-brief.service.ts` (chargement), `mail/mail.templates.ts` (bloc du brief) ; `packages/engine/src/morning-brief/**` ; `packages/engine/src/work/margin.ts`, `types.ts` ; `apps/api/src/work/margin/**` (port `WORK_PURCHASES_SOURCE`) | 15 (brief, cloche), 10 (`committed`) | e2e brief, marge, rappels | P3, P5 |
| **P7 — Web, application `/achats` (1)** | navigation, vue d'ensemble, fournisseurs et fiche 360°, demandes et commandes, approbations, aperçu et envoi du BC, réglages ; « Mes tâches » (élément Approbation) ; bouton sur la fiche projet | `apps/web/src/app/(app)/achats/**` sauf `factures/**`, `receptions/**`, `a-payer/**` ; `apps/web/src/lib/api-achats.ts` ; `_components/nav-model.ts` (+ test) ; `apps/web/src/lib/routes.ts` (+ test) ; `projets/_components/mes-taches*.tsx` (rendu `purchases`) | écrans § 8 | modèles purs, nav, routes | P0 ; données réelles après P2, P3 |
| **P8 — Web (2) : réceptions, factures, à payer, dépense** | écrans réceptions, factures (rapprochement, pièce, litige, forçage), à payer (échéancier, paiement, doublons) ; sélecteur de fiche dans le formulaire de dépense ; dépense possédée en lecture seule | `apps/web/src/app/(app)/achats/{receptions,factures,a-payer}/**`, `apps/web/src/lib/api-achats-payables.ts` ; `apps/web/src/app/(app)/tresorerie/depenses/_components/**` (fournisseur, lecture seule) | écrans § 8 | modèles purs | P7 (coquille `achats/layout.tsx`) ; P4, P5 |

### Zones de conflit entre lots

| Fichier | Lots | Règle |
|---|---|---|
| `apps/api/src/authz/permissions.ts`, `packages/shared/src/notifications/index.ts`, `apps/web/src/lib/api.ts` | **P0 seul** | aucun autre lot n'y écrit |
| `apps/api/src/treasury/treasury.schemas.ts`, `treasury.dto.ts`, `treasury-expenses.service.ts` | P2 (`supplierId`), P5 (`origin`, méthode possédée, verrou) | **P2 d'abord**, P5 rebasé ; propriétés distinctes, chacune sous son commentaire |
| `apps/api/src/treasury/treasury-sources.ts`, `treasury-planning.service.ts`, `packages/engine/src/treasury/**` | P5 seul | — |
| `apps/api/src/purchases/purchases.module.ts` | P2 crée ; P3, P4, P5, P6 ajoutent une ligne chacun dans `controllers` / `providers` / `forFeature` | sous son commentaire de lot |
| `apps/api/src/app.module.ts` | P2 | une ligne |
| `apps/api/src/authz/routes-coverage.test.ts` | P2, P3, P4, P5, P6 | un bloc par lot, **à la fin** |
| `apps/api/src/work/my-tasks.ports.ts`, `work-tasks.service.ts` (`myTasks`) | P3 seul | ajout d'une source à côté de celle du CRM |
| `apps/api/src/work/margin/**`, `packages/engine/src/work/**` | P6 seul | — |
| `apps/api/src/morning-brief/**`, `packages/engine/src/morning-brief/**`, `mail/mail.templates.ts` | P6 seul | — |
| `packages/engine/src/index.ts` | P1 (export `./purchases`) | une ligne |
| `packages/shared/src/purchases/**` | P0 crée ; P3 à P6 **ajoutent** des fichiers, jamais dans ceux d'un autre | `index.ts` : une ligne d'export par lot |
| `apps/web/src/app/(app)/_components/nav-model.ts`, `apps/web/src/lib/routes.ts` | P7 seul | — |
| `apps/web/src/app/(app)/achats/layout.tsx` | P7 crée ; P8 l'utilise sans l'écrire | sous-options demandées à P7 |
| `apps/web/src/app/(app)/projets/_components/mes-taches*` | P7 seul | — |
| `docs/12`, `docs/15`, `docs/16`, index des ADR | ce lot de documentation ; chaque lot passe sa ligne « proposé » à « implémenté » | une section par lot |

### Ordre de fusion conseillé

```
P0 ──┬── P2 ──┬── P3 ──┬── P4 ── P5 ── P6
P1 ──┘        │        └── P7 (écrans au fil de P2, P3)
              └── P4 (factures sans commande, avant P3 si P3 glisse)
P8 après P7, P4, P5.
```

1. **P0** et **P1** en parallèle (P1 ne dépend d'aucun contrat d'API).
2. **P2** ; en parallèle, le squelette de **P7** (navigation, routes, coquille).
3. **P3** ; **P4** commence par les factures sans commande, branche le rapprochement dès P3 fusionné.
4. **P5** (après P4 ; rebasé sur P2 pour la trésorerie).
5. **P6** ; **P8**.

Chemin critique : P0 → P2 → P3 → P4 → P5 → P6. Si P3 glisse, P4 et P5 livrent la chaîne « facture
sans commande → paiement → trésorerie », déjà utile seule.

## Décisions ouvertes — elles appartiennent à la dirigeante

Chacune a une **valeur par défaut**, appliquée si rien n'est tranché.

1. **Actions** : cinq actions (`purchase.read`, `purchase.request`, `purchase.manage`,
   `purchase.approve`, `payables.pay`) et la matrice du § 4.1. *Défaut : oui.*
2. **Rôle Acheteur** (`buyer`, O6). *Défaut : non ; un acheteur est un membre avec ajout de
   `purchase.manage` (ADR-0041). Spécification prête si la dirigeante le veut.*
3. **Paliers d'approbation par défaut**. *Défaut : une approbation pour toute commande, dans chaque
   devise ; l'organisation ajoute ses seuils (aucun montant n'est fixé par Lalanda).*
4. **Le Commercial peut-il demander un achat ?** *Défaut : non (il verrait les prix d'achat et les
   fournisseurs) ; possible par ajout de `purchase.read` + `purchase.request`.*
5. **Commandes approuvées non facturées dans la prévision**. *Défaut : non prévues, signalées
   (`ORDERS_NOT_INVOICED`).*
6. **Tolérances de rapprochement**. *Défaut : 0 % et 0,00 (strict).*
7. **Acomptes fournisseurs** (payer avant la facture). *Défaut : hors R3 ; à cadrer en lot suivant
   (imputation à la commande, puis à la facture).*
8. **L'envoi par e-mail d'une commande approuvée la marque « envoyée »**. *Défaut : oui.*
9. **Changement de coordonnées bancaires** : alerte seulement, ou blocage des paiements vers ces
   coordonnées tant qu'une seconde personne ne les a pas confirmées ? *Défaut : alerte, bandeau
   7 jours, audit strict ; pas de blocage.*
10. **Coûts engagés dans la marge** : informatifs seulement. *Défaut : oui, jamais soustraits.*
11. **Réalisé à la facture** (charge constatée à la réception de la facture plutôt qu'au paiement).
    *Défaut : non ; le réalisé reste un réalisé de trésorerie (ADR-0034) ; à trancher avec
    l'expert-comptable.*
12. **TVA déductible** : déduction, prorata, assujettissement du fournisseur, report dans le réalisé
    ou la marge. *Défaut : déclarée et conservée, jamais calculée (ADR-0034, décision n° 1 inchangée).*
13. **Retenues à la source et précomptes** sur paiement fournisseur (règles DGI). *Défaut : aucune ;
    le paiement est brut. À sourcer (texte, date d'effet) avant tout calcul, sous un Country Pack.*
14. **NIF fournisseur** : obligatoire au-delà d'un montant, contrôle de validité. *Défaut :
    facultatif, forme seulement.*
15. **Factures fournisseurs normalisées** (vérifier les éléments de sécurité e-MCF d'une facture
    reçue). *Défaut : non contrôlé ; la pièce est conservée.*
16. **Importations** (droits de douane, frais d'approche, devises étrangères autres que CDF et USD).
    *Défaut : hors R3.*
17. **GROW** : indicateur de délai de paiement fournisseurs. *Défaut : rien en R3.*
18. **Offres** (docs/13) : achats ouverts à toutes les offres, comme le CRM et les projets. *Défaut :
    toutes les offres, à arbitrer avec le reste du tableau.*
19. **Migration** des fournisseurs texte par clé normalisée **exacte**, rapport à relire. *Défaut :
    oui, aucun rapprochement approché.*

## Liens

- [ADR-0011](ADR-0011-contrats-integration-s18.md) ; [ADR-0012](ADR-0012-modele-rbac-complet.md)
  (amendé) ; [ADR-0013](ADR-0013-stockage-secrets-integration.md) ;
  [ADR-0018](ADR-0018-trajectoire-erp-trois-modules.md) (refus des achats levé) ;
  [ADR-0020](ADR-0020-ordonnanceur-mongodb.md) ; [ADR-0021](ADR-0021-modules-erp-et-identite-fiscale.md) à
  [ADR-0028](ADR-0028-modeles-de-facture-et-identite.md) (ventes, rien n'est repris pour les achats) ;
  [ADR-0030](ADR-0030-refonte-ui-ux.md) ; [ADR-0031](ADR-0031-encaissements-et-realise.md) ;
  [ADR-0033](ADR-0033-brief-du-matin.md) (étendu) ; [ADR-0034](ADR-0034-depenses-et-tresorerie.md)
  (étendu) ; [ADR-0035](ADR-0035-crm-et-devis.md) ; [ADR-0039](ADR-0039-projets-et-taches-run.md)
  (étendu) ; [ADR-0040](ADR-0040-crm-complet.md) (modèle) ; [ADR-0041](ADR-0041-autorisations-par-membre.md)
  (étendu) ; [ADR-0042](ADR-0042-envoi-des-documents-par-email.md) (étendu).
- [docs/08](../08-PREVISIONNEL-REALISE.md) ; [docs/12](../12-ROLES-PERMISSIONS.md) ;
  [docs/13](../13-PRICING.md) ; [docs/15](../15-DATABASE.md) ; [docs/16](../16-API.md) ;
  [docs/17](../17-SECURITE.md) ; [docs/26](../26-CONVENTIONS.md).
- Code existant : `apps/api/src/treasury/`, `apps/api/src/sales/documents/`,
  `apps/api/src/security/document-email-throttler.guard.ts`, `apps/api/src/integrations/keyring.provider.ts`,
  `apps/api/src/work/` (`margin/`, `my-tasks.ports.ts`), `apps/api/src/morning-brief/`,
  `apps/api/src/authz/permissions.ts`, `packages/engine/src/treasury/`, `packages/engine/src/work/`.
- Code à créer : `apps/api/src/purchases/`, `packages/engine/src/purchases/`,
  `packages/shared/src/purchases/`, `apps/web/src/app/(app)/achats/`.
