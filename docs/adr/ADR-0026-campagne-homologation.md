# ADR-0026 — Campagne d'homologation DGI : audit des 29 cas, corrections, jeu e2e (lot S25h)

Statut : Proposed
Date : 2026-10-20
Décideurs : Gracy Omokoso (décisions produit et fiscales ouvertes ci-dessous) ; CTO Lalanda
(contrat technique)

> **Complète [ADR-0023](ADR-0023-factures-et-avoirs.md)** (le test
> `invoices.homologation.e2e.test.ts` prévu par ses critères E2 est écrit ici, et va jusqu'à
> la normalisation), **[ADR-0024](ADR-0024-normalisation-dgi.md)** (faux serveur e-MCF) et
> **[ADR-0025](ADR-0025-documents-pdf-factures.md)** (mentions du PDF : deux corrections,
> § 3). Ne touche ni la politique d'arrondi, ni le client e-MCF, ni le contrat HTTP.

## Contexte

Plan RUN : S25c clients et catalogue · S25d calcul conforme · S25e factures et avoirs ·
S25f normalisation (en production : une facture de test a été normalisée avec succès) ·
S25g PDF · **S25h campagne d'homologation (cet ADR)**.

Le dossier d'homologation exige, pour chacun des **29 cas de facture officiels** (cas de test
du SFE, v1.2), une facture normalisée **en TTC et en HT** (le SFE gère les deux modes,
exigence 5.3) : **58 normalisations**, plus 3 rapports (X, Z, A). Chaque pièce est une
facture **imprimée par Lalanda**, vérifiée sur le site DGI. Les avoirs 10, 11, 12 et 16
portent le code DEF/DGI des factures des cas 1, 3, 6 et 15 : ordre imposé.

Sources : documentation du compte développeur DGI (**non publique**, hors dépôt, lue dans le
dossier local `dgi/`, jamais versionné) — cas de test v1.2, tableaux de conformité v1.2,
annexe de la note de service n° 01/022 (spécifications des SFE), présentation « Mise à jour
et homologation des SFE » v1.2. Seul ce qui fixe le contrat est repris, **en substance**.
Spécification publique e-DEF v2.0 : `docs/sources/dgi-rdc/edef-api-v2.0-2026-10-18.json`.

## 1. Audit des écarts — les 29 cas

Méthode : lecture du code (`main` à `e203b10`), puis **exécution** de chaque cas, dans les
deux modes, contre le faux serveur e-MCF (§ 4). « OK » = Lalanda produit le cas, la requête
envoyée porte ce que le cas exige et le PDF ses mentions. Chemins relatifs à
`apps/api/src/` ; numéros de ligne au commit `e203b10`.

| Cas | Ce qu'il exige | Statut | Preuve (fichier:ligne) | Correction |
|---|---|---|---|---|
| 1 | FV, 1 × B + 1 × C, PM | OK | types `sales/invoices/invoice.contract.ts:54` ; client `sales/invoices/invoice-drafts.service.ts:515` ; groupes `sales/normalization/request-builder.ts:107-133` | — |
| 2 | FV, 1 × A, PM | OK | idem | — |
| 3 | FV, 2 × B + 3 × A, PM (origine du 11) | OK | idem | — |
| 4 | quantités 2,375 et 3,5 | OK | `request-builder.ts:117` (`decimalToJsonNumber(line.quantity)`) ; PDF `sales/documents/invoice-document.model.ts:370` | — |
| 5 | client PP, champs facultatifs | OK | vente de comptoir `invoice-drafts.service.ts:101-110, 520` ; mention `invoice-document.model.ts:236` | — |
| 6 | client PC, nom + NIF (origine du 12) | OK | NIF exigé `sales/sales.dto.ts:44, 109` | — |
| 7 | client PL, nom + NIF | OK | idem | — |
| 8 | taxe spécifique sur B et C, base TVA augmentée | OK | `request-builder.ts:122-125` (`taxSpecificValue`, `taxSpecificAmount`) ; PDF « T.S. » `invoice-document.model.ts:373-376` ; par unité **et** en % (`SpecificTax`, moteur) | — |
| 9 | FT, mention « D'ACOMPTE » | OK | `invoice-document.model.ts:202` | — |
| 10 | FA RAN, référence = code DEF/DGI du cas 1 | OK | référence figée au gel `sales/invoices/invoice-freezing.service.ts:518-522` ; envoi `request-builder.ts:166-178` ; mention `invoice-document.model.ts:203-207, 255` | — |
| 11 | FA RAM, quantités ≤ vendues, mêmes prix (cas 3) | OK | lignes d'origine recopiées, seule la quantité varie `invoice-drafts.service.ts:599-620` ; contrôle `checkCreditNote` `invoice-freezing.service.ts:464` | — |
| 12 | FA COR (cas 6, client PC) | OK | client de l'origine `invoice-drafts.service.ts:453-455` | — |
| 13 | FA RRR, référence « RRR » | OK | `invoice-freezing.service.ts:519-520` ; PDF « Référence : RRR » `invoice-document.model.ts:254` | — (longueur de la référence : question DGI, § 5) |
| 14 | AO, 2 × D, ligne A « Réf. Exo. : » | **Écart (PDF)** | ligne A automatique `invoice-drafts.service.ts:460-473` et envoyée `request-builder.ts:180-183` (OK) ; mais la mention imprimée du type est « [AO] Ambassade, organisation internationale » (`sales/sales.dto.ts:40`) alors que la DGI impose « [AO] Ambassades et organisations internationales » (cas de test, tableau « Types de client » ; annexe n° 01/022, p. 13) | Libellé `AO` aligné sur la mention DGI (§ 3.1) |
| 15 | EV, 3 × E, « EXPORTATION » | OK | `invoice-document.model.ts:201` | — |
| 16 | EA RAN, référence = code du cas 15 | OK | `sales/invoices/credit-note-rules.ts:12-16` (EA ↔ EV/ET) | — |
| 17 | acompte à l'export, 3 × E | OK | type `ET` produit ; mentions « EXPORTATION » + « D'ACOMPTE » | — (ET ou FT : question DGI, § 5) |
| 18 | FV, 2 × F + 2 × G | OK | groupes A–P du moteur, taux lus dans l'instantané DGI | — |
| 19 | 2 × B + 2 × H | OK | idem | — |
| 20 | 1 × C + 1 × I | OK | idem | — |
| 21 | 2 × J | OK | idem | — |
| 22 | 2 × K (vendeur non assujetti) | OK, avertissement | K admis ; avertissement non bloquant `TAX_GROUP_K_WHILE_VAT_REGISTERED` si la fiche fiscale dit « assujetti » (`packages/engine/src/invoice-totals/seller-vat-status.ts:121-133`) | — (fiche du vendeur pour ce cas : décision ouverte n° 2) |
| 23 | 2 × B + 2 × L (TAX) | OK | `TAX` ⇔ L, N `packages/engine/src/invoice-totals/tax-groups.ts:28-31, 98-101` | — |
| 24 | 3 × M + 3 × N (TAX), N entièrement TVA | OK | nature `vat_only` de N `tax-groups.ts:64-71` | — |
| 25 | remise 10 % ; remise totale 300 CDF ; prix d'origine affiché | OK | `discountedUnitPrice` (moteur) `invoice-drafts.service.ts:751-770` ; `originalPrice` + `priceModification` envoyés `request-builder.ts:126-130` ; PDF « Prix d'origine … — Remise … » `invoice-document.model.ts:263-280` | — |
| 26 | total équivalent en USD, taux ±1 % | OK | `showUsdCounterValue` (document CDF), contre-valeur figée `invoice-freezing.service.ts:798-812` ; `curCode`, `curRate`, `curDate` `request-builder.ts:185-190` ; PDF `invoice-document.model.ts:400-404` | — (source du taux : question DGI, § 5) |
| 27 | 1 × O (1 %) | OK | groupe O | — |
| 28 | 1 × P (1 %, marché public) | OK | groupe P | — |
| 29 | 1 × A, code d'article « HORS CHAMP » | **Écart (PDF)** | la requête envoie bien `code: "HORS CHAMP"` (`edefCode`, `invoice-drafts.service.ts:718` ; `request-builder.ts:113`), mais le PDF imprime le code **interne** de l'article (`invoice-document.model.ts:366`) : données imprimées ≠ données échangées (exigence 1.4) | Le PDF imprime le code envoyé à la DGI (§ 3.2) |

**Rapports R01–R03 (X, Z, A)** : **non applicables** à ce lot. Exigences de catégorie P
(« non validées lors de l'homologation transitoire »), absentes du produit ; question posée à
la DGI (applicabilité en homologation transitoire et équivalent attendu pour un SFE en
ligne). Rien n'est développé ici.

## 2. Audit des exigences transverses (catégorie O)

| Exigence | Statut | Preuve | Correction |
|---|---|---|---|
| 1.24 — au moins 8 lignes de commentaire A–H | OK (conforme à l'annexe) | le modèle et la requête portent les huit lignes `cmta`…`cmth` (`invoice.contract.ts:82-84` ; `request-builder.ts:58-67, 180-183`) ; l'annexe fixe A (« Réf. Exo. : », client AO) et déclare **B à H réservées** : seules A et C sont saisissables (`invoice.contract.ts:157-158`, ADR-0023 § S25e.7), les autres → `400 COMMENT_LINE_RESERVED`. L'hypothèse « seules A et C existent » est donc **infirmée** : huit lignes, dont six réservées par la DGI | — (usage de C et impression des lignes vides : questions DGI, § 5) |
| 1.18 — six moyens de paiement, plusieurs par facture | OK | `PAYMENT_METHODS` (sept, `AUTRE` compris) `packages/engine/src/invoice-totals/invoice-checks.types.ts:21-29` ; liste `payments[]` (`invoices.dto.ts:505-530`) envoyée telle quelle `request-builder.ts:160-163` ; la campagne couvre les six (§ 4) | — |
| 1.19 — total = somme des paiements | OK | `checkPayments` (moteur) au gel | — |
| 1.26 / 1.27 — avoirs partiels cumulés, plafonnés | OK | `credited` de l'origine, `checkCreditNote` (`alreadyCredited`) `invoice-freezing.service.ts:443-493` ; testé (deux avoirs partiels normalisés sur la même origine, puis dépassement refusé) | — |
| 1.15 / 2.1 k — numérotation ininterrompue par année | OK | `TEST-AAAA-NNNNNN` / `AAAA-NNNNNN`, compteur par série et par année `sales/invoices/invoice-numbering.service.ts:46-50` ; la campagne vérifie 58 numéros contigus | — |
| 1.11 — type de client et champs obligatoires | OK, sauf libellé AO | `sales.dto.ts:43-46, 102-137` | libellé AO (§ 3.1) |
| 2.1 — mentions du PDF | OK, sauf cas 14 et 29 | `invoice-document.model.ts` | § 3 |
| 1.4 — données imprimées = données échangées | **Écart** (code hors champ) | voir cas 29 | § 3.2 |

## 3. Corrections (minimales)

### 3.1 Mention du type de client AO

`CUSTOMER_TYPE_LABELS.AO` (`sales/sales.dto.ts`) devient « Ambassades et organisations
internationales », la mention imposée par la DGI ; le PDF imprime donc « [AO] Ambassades et
organisations internationales ». Le libellé est aussi celui de l'écran (`typeLabel`, et le
modèle web `sales-model.ts`) : un seul libellé, celui de la DGI. Aucun champ ne change.

### 3.2 Code d'article imprimé = code envoyé

Le PDF imprime `edefCode` (le code **envoyé** à la DGI : « HORS CHAMP » pour une opération
hors champ, le code de l'article sinon), et non plus le code interne. Le code interne d'un
article hors champ reste dans la fiche et dans la vue, il ne s'imprime plus. Amende ADR-0025
§ 3 (« Lignes : … code … ») : « code » s'y lit désormais « code envoyé à la DGI ».

## 4. Jeu e2e de la campagne

- `apps/api/src/edef/homologation/homologation-cases.ts` : les 29 cas en **données**
  réutilisables (type, client, lignes, nature d'avoir et cas d'origine, contre-valeur,
  paiements, attendus de la requête et du PDF), avec les corps de requête de l'**API
  Lalanda** (`POST /sales/invoices`) et le calcul des paiements (solde posé par
  `reconcilePayments`, moteur). Clients et articles **fictifs**, marqués « TEST ». Un futur
  script pourra rejouer la campagne contre l'environnement de test DGI réel par l'API
  Lalanda ; il n'est pas écrit ici, et rien n'appelle la DGI.
- `apps/api/src/__tests__/invoices.homologation.e2e.test.ts` : un scénario par cas, en TTC
  puis en HT (58 normalisations), contre le **faux serveur e-MCF** ; pour chacun :
  normalisation réussie, requête envoyée conforme (type, mode, groupes, types et codes
  d'article, taxe spécifique, remises, client, référence et nature d'avoir, ligne A,
  contre-valeur, paiements), totaux identiques à ceux du faux serveur
  (`compareWithEdefResponse`, 67 champs), mentions du PDF (double du rendu HTML d'ADR-0025).
  Puis : 58 numéros `TEST-` contigus, six moyens de paiement couverts, avoirs partiels
  cumulés (1.27).

Choix de données (libres selon les cas officiels) : prix en CDF, identiques en TTC et en
HT ; paiements répartis pour couvrir les six moyens, plusieurs sur les cas 1, 6 et 24 ;
cas 8 : taxe spécifique par unité (B) et en pourcentage (C) ; cas 17 : type `ET`.

## 5. Décisions ouvertes et questions DGI

Décisions ouvertes (non tranchées par les sources, **rien n'est inventé ici**) :

1. **Rapports X, Z, A** (R01–R03) : « NON APPLICABLE » dans le dossier transitoire, ou
   développement ? Dépend de la réponse DGI sur l'homologation transitoire.
2. **Cas 22** : le joue-t-on depuis une organisation dont la fiche fiscale dit « non
   assujettie » (le vendeur réel du jeton de test l'est-il ?) ou depuis l'organisation de
   test assujettie (avertissement non bloquant) ? Le jeu e2e prend la seconde.
3. **Cas 17** : `ET` (tableau des cas) ou `FT` (fiche détaillée) ? `ET` retenu en attendant
   la DGI.

Questions à la DGI (déjà listées dans les ADR précédents, rappelées car elles touchent la
campagne) : référence d'un avoir RRR (la chaîne « RRR », 3 caractères, contre 24 annoncés) ;
ligne C (code d'une facture d'acompte) alors que B–H sont « réservées » ; impression des
huit lignes de commentaire même vides ; source et date du « taux moyen BCC » et présence de
la contre-valeur USD sur toutes les factures ; orthographe exacte de « HORS CHAMP ».

## Conséquences

- Les cas 14 et 29 s'impriment conformément à la DGI ; aucun autre rendu ne change (pour un
  article ordinaire, le code envoyé est le code de l'article).
- La campagne réelle se prépare sans écrire de code : les 29 cas sont des données, rejouées
  en CI contre le faux serveur à chaque changement.

## Plan de validation

- Unitaire : `edef/homologation/homologation-cases.test.ts` (29 cas, enchaînements, groupes
  A–P, types d'article, clients, six moyens de paiement, corps de requête).
- Modèle du PDF : code « HORS CHAMP » imprimé ; mention AO.
- E2E : `invoices.homologation.e2e.test.ts` (faux serveur, jamais la DGI).

## Liens

- [ADR-0019](ADR-0019-facture-normalisee-dgi-rdc.md), [ADR-0022](ADR-0022-clients-catalogue-et-calcul-des-factures.md),
  [ADR-0023](ADR-0023-factures-et-avoirs.md), [ADR-0024](ADR-0024-normalisation-dgi.md),
  [ADR-0025](ADR-0025-documents-pdf-factures.md)
- `docs/sources/dgi-rdc/README.md`
