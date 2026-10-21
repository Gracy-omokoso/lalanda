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
| 1 | FV, 1 × B + 1 × C, PM | OK | types `sales/invoices/invoice.contract.ts:54` ; client `sales/invoices/invoice-drafts.service.ts:515` ; groupes `sales/normalization/request-builder.ts:107-134` (`code` ← `edefCode` l. 115) | — |
| 2 | FV, 1 × A, PM | OK | idem | — |
| 3 | FV, 2 × B + 3 × A, PM (origine du 11) | OK | idem | — |
| 4 | quantités 2,375 et 3,5 | OK | `request-builder.ts:117` (`decimalToJsonNumber(line.quantity)`) ; PDF `sales/documents/invoice-document.model.ts:370` | — |
| 5 | client PP, champs facultatifs | OK | vente de comptoir `invoice-drafts.service.ts:101-110, 520` ; mention `invoice-document.model.ts:236` | — |
| 6 | client PC, nom + NIF (origine du 12) | OK | NIF exigé `sales/sales.dto.ts:44, 109` | — |
| 7 | client PL, nom + NIF | OK | idem | — |
| 8 | taxe spécifique sur B et C, base TVA augmentée | OK | `request-builder.ts:122-125` (`taxSpecificValue`, `taxSpecificAmount`) ; PDF « T.S. » `invoice-document.model.ts:373-376` ; par unité **et** en % (`SpecificTax`, moteur) | — |
| 9 | FT, mention « D'ACOMPTE » | OK | `invoice-document.model.ts:202` | — |
| 10 | FA RAN, référence = code DEF/DGI du cas 1 | OK | référence figée au gel `sales/invoices/invoice-freezing.service.ts:518-522` ; envoi `request-builder.ts:166-179` ; mention `invoice-document.model.ts:203-207, 255` | — |
| 11 | FA RAM, quantités ≤ vendues, mêmes prix (cas 3) | OK | lignes d'origine recopiées, seule la quantité varie `invoice-drafts.service.ts:599-620` ; contrôle `checkCreditNote` `invoice-freezing.service.ts:464` | — |
| 12 | FA COR (cas 6, client PC) | OK | client de l'origine `invoice-drafts.service.ts:453-455` | — |
| 13 | FA RRR, référence « RRR » | OK | `invoice-freezing.service.ts:519-520` ; PDF « Référence : RRR » `invoice-document.model.ts:254` | — (longueur de la référence : question DGI, § 5) |
| 14 | AO, 2 × D, ligne A « Réf. Exo. : » | **Écart (PDF) — corrigé** | ligne A automatique `invoice-drafts.service.ts:460-473` et envoyée `request-builder.ts:181-184` (OK) ; mais la mention imprimée du type est « [AO] Ambassade, organisation internationale » (`sales/sales.dto.ts:40`) alors que la DGI impose « [AO] Ambassades et organisations internationales » (cas de test, tableau « Types de client » ; annexe n° 01/022, p. 13) | Libellé `AO` aligné sur la mention DGI (§ 3.1) |
| 15 | EV, 3 × E, « EXPORTATION » | OK | `invoice-document.model.ts:201` | — |
| 16 | EA RAN, référence = code du cas 15 | OK | `sales/invoices/credit-note-rules.ts:12-16` (EA ↔ EV/ET) | — |
| 17 | acompte à l'export, 3 × E | OK | type `ET` produit ; mentions « EXPORTATION » + « D'ACOMPTE » | — (ET ou FT : question DGI, § 5) |
| 18 | FV, 2 × F + 2 × G | OK | groupes A–P du moteur, taux lus dans l'instantané DGI | — |
| 19 | 2 × B + 2 × H | OK | idem | — |
| 20 | 1 × C + 1 × I | OK | idem | — |
| 21 | 2 × J | OK | idem | — |
| 22 | 2 × K (vendeur non assujetti) | OK, avertissement | K admis ; avertissement non bloquant `TAX_GROUP_K_WHILE_VAT_REGISTERED` si la fiche fiscale dit « assujetti » (`packages/engine/src/invoice-totals/seller-vat-status.ts:124-133`) | — (fiche du vendeur pour ce cas : décision ouverte n° 2) |
| 23 | 2 × B + 2 × L (TAX) | OK | `TAX` ⇔ L, N `packages/engine/src/invoice-totals/tax-groups.ts:30-31, 103-106` | — |
| 24 | 3 × M + 3 × N (TAX), N entièrement TVA | OK | nature `vat_only` de N `tax-groups.ts:66-72` | — |
| 25 | remise 10 % ; remise totale 300 CDF ; prix d'origine affiché | OK | `discountedUnitPrice` (moteur) `invoice-drafts.service.ts:751-770` ; `originalPrice` + `priceModification` envoyés `request-builder.ts:126-130` ; PDF « Prix d'origine … — Remise … » `invoice-document.model.ts:263-280` | — |
| 26 | total équivalent en USD, taux ±1 % | OK | `showUsdCounterValue` (document CDF), contre-valeur figée `invoice-freezing.service.ts:798-812` ; `curCode`, `curRate`, `curDate` `request-builder.ts:186-191` ; PDF `invoice-document.model.ts:400-404` | — (source du taux : question DGI, § 5) |
| 27 | 1 × O (1 %) | OK | groupe O | — |
| 28 | 1 × P (1 %, marché public) | OK | groupe P | — |
| 29 | 1 × A, code d'article « HORS CHAMP » | **Écart (PDF) — corrigé** | la requête envoie bien `code: "HORS CHAMP"` (`edefCode`, `invoice-drafts.service.ts:718` ; `request-builder.ts:115`), mais le PDF imprime le code **interne** de l'article (`invoice-document.model.ts:366`) : données imprimées ≠ données échangées (exigence 1.4) | Le PDF imprime le code envoyé à la DGI (§ 3.2) |

**Rapports R01–R03 (X, Z, A)** : **non applicables** à ce lot. Exigences de catégorie P
(« non validées lors de l'homologation transitoire »), absentes du produit ; question posée à
la DGI (applicabilité en homologation transitoire et équivalent attendu pour un SFE en
ligne). Rien n'est développé ici.

## 2. Audit des exigences transverses (catégorie O)

| Exigence | Statut | Preuve | Correction |
|---|---|---|---|
| 1.24 — au moins 8 lignes de commentaire A–H | OK (conforme à l'annexe) | le modèle et la requête portent les huit lignes `cmta`…`cmth` (`invoice.contract.ts:82-84` ; `request-builder.ts:57-66, 181-184`) ; l'annexe fixe A (« Réf. Exo. : », client AO) et déclare **B à H réservées** : seules A et C sont saisissables (`invoice.contract.ts:157-158`, ADR-0023 § S25e.7), les autres → `400 COMMENT_LINE_RESERVED`. L'hypothèse « seules A et C existent » est donc **infirmée** : huit lignes, dont six réservées par la DGI | — (usage de C et impression des lignes vides : questions DGI, § 5) |
| 1.18 — six moyens de paiement, plusieurs par facture | OK | `PAYMENT_METHODS` (sept, `AUTRE` compris) `packages/engine/src/invoice-totals/invoice-checks.types.ts:21-29` ; liste `payments[]` (`sales/invoices/invoices.dto.ts:502-535`) envoyée telle quelle `request-builder.ts:160-163` ; la campagne couvre les six (§ 4) | — |
| 1.19 — total = somme des paiements | OK | `checkPayments` (moteur) au gel | — |
| 1.26 / 1.27 — avoirs partiels cumulés, plafonnés | OK | `credited` de l'origine, `checkCreditNote` (`alreadyCredited`) `invoice-freezing.service.ts:443-493` ; testé (deux avoirs partiels normalisés sur la même origine, puis dépassement refusé) | — |
| 1.15 / 2.1 k — numérotation ininterrompue par année | OK | `TEST-AAAA-NNNNNN` / `AAAA-NNNNNN`, compteur par série et par année `sales/invoices/invoice-numbering.service.ts:46-50` ; la campagne vérifie 58 numéros contigus | — |
| 1.11 — type de client et champs obligatoires | OK — libellé AO corrigé | `sales.dto.ts:43-46, 102-137` | libellé AO (§ 3.1) |
| 2.1 — mentions du PDF | OK — cas 14 et 29 corrigés | `invoice-document.model.ts` | § 3 |
| 1.4 — données imprimées = données échangées | **Écart — corrigé** (code hors champ) | voir cas 29 | § 3.2 |

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
  `reconcilePayments`, moteur). Clients et articles **fictifs**, marqués « TEST ». La
  campagne **réelle** les rejoue par la ligne de commande `edef:homologation` (§ 7) ; le
  module lui-même n'appelle rien.
- `apps/api/src/__tests__/invoices.homologation.e2e.test.ts` : un scénario par cas, en TTC
  puis en HT (58 normalisations), contre le **faux serveur e-MCF** ; pour chacun :
  normalisation réussie, requête envoyée conforme (type, mode, groupes, types et codes
  d'article, taxe spécifique, remises, client, référence et nature d'avoir, ligne A,
  contre-valeur, paiements), totaux identiques à ceux du faux serveur
  (`compareWithEdefResponse`, 67 champs), mentions du PDF (double du rendu HTML d'ADR-0025).
  Puis : 58 numéros `TEST-` contigus, six moyens de paiement couverts, avoirs partiels
  cumulés (1.27).

**Résultat (20 oct. 2026)** : avant correction, 61 tests, **6 échecs** — les cas 14 et 29 dans
les deux modes (les deux écarts du § 1), et une attente du test lui-même (la taxe spécifique en
pourcentage part sous la forme `10.00%`, conforme à la forme `{valeur}%`). Après les
corrections du § 3 : **61 tests sur 61**, soit 58 normalisations réussies, totaux identiques
au faux serveur sur les 67 champs, 58 numéros contigus, six moyens de paiement, avoirs
partiels cumulés. Les 27 autres cas passaient sans modification du code.

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

## 6. Écarts du dossier d'homologation — corrections du 20 oct. 2026

La liste de travail des écarts (tableau de conformité, onglet 04, vérifié contre `main`) est
tenue hors dépôt avec le dossier DGI ; ses identifiants (B3, C1, C6…) sont repris ici. Seuls
les écarts ci-dessous sont traités par cette branche ; les autres restent ouverts.

| Écart | Exigence | Statut | Correction |
|---|---|---|---|
| **C1** — version du logiciel invisible (`/health` = `0.1.0` du package.json ; rien à l'écran ni sur le PDF) | tableau de conformité, pièce a ; manuel de contrôle | **Corrigé le 20 oct. 2026** | § 6.2 |
| **B3** — journal électronique sans lignes ni export (et, en partie, **C2** : pas d'export pour le vérificateur) | 1.20 | **Corrigé le 20 oct. 2026** (export) ; la lecture « empreinte = contenu » reste à faire accepter par la DGI | § 6.3 |
| **C6** — choix du point de vente impossible à l'écran | exploitation à plusieurs points de vente (aucune exigence numérotée) | **Corrigé le 20 oct. 2026** | § 6.1 |

### 6.1 Choix du point de vente (C6)

- **Avant.** L'éditeur envoyait toujours `pointOfSaleId: null` ; l'API retenait le point de
  vente d'office s'il n'y en avait qu'**un** actif. Avec deux actifs, le brouillon restait
  bloqué (« Choisissez le point de vente… ») sans aucun moyen de choisir.
- **API.** `GET /sales/points-of-sale` (`sales.read`) rend les points de vente **actifs dans
  l'environnement DGI** de l'organisation, avec le mode d'émission : identifiant, nom, NIM et
  nom d'établissement relevés par la DGI — **ni jeton, ni état technique, ni test** (la
  gestion reste en `fiscal.manage`). `sales.read` parce que la personne qui compose un
  brouillon (`sales.manage`) n'a pas forcément `fiscal.manage`, et qu'un nom et un NIM
  imprimés sur toute facture ne sont pas confidentiels. Le champ `pointOfSaleId` du brouillon
  existait déjà ; un point de vente d'une autre organisation répond toujours
  `404 POINT_OF_SALE_NOT_FOUND`.
- **Messages.** Le bloquant `POINT_OF_SALE_REQUIRED` dit quoi faire selon le cas (aucun actif ;
  un seul : enregistrer ; plusieurs : choisir) ; un point de vente choisi puis retiré bloque
  par `POINT_OF_SALE_NOT_ACTIVE` ; « Normaliser » sans point de vente répond
  `409 POINT_OF_SALE_REQUIRED` (nouveau code 409) au lieu d'un « point de vente non actif »
  trompeur.
- **Écran.** L'éditeur affiche le point de vente en facture normalisée : le seul actif est
  retenu par défaut (affiché, non modifiable) ; avec plusieurs, une liste **obligatoire**
  (« Choisir un point de vente… ») et un message sous le champ tant que rien n'est choisi ;
  aucun actif : un message renvoie à Organisation › Fiscalité.
- **Tests.** Modèle web (choix, défaut, corps, message) ; e2e `normalization.e2e.test.ts` :
  deux points de vente actifs, liste lisible par le Lecteur sans jeton, brouillon bloqué avec
  le bon message, `409 POINT_OF_SALE_REQUIRED`, `404` pour un point de vente étranger,
  normalisation par le point choisi (NIM du second), choix retiré → bloquant.

### 6.2 Version du logiciel visible (C1)

- **Source unique : l'étiquette de release.** `deploy.yml` (déclenché par `v*`) passe
  `APP_VERSION` — la version **normalisée par `docker/metadata-action`** (`0.9.3` pour
  `v0.9.3`, jamais le nom brut du tag, qui n'entre dans aucun script) — aux deux builds.
  Les Dockerfile la posent en `ENV`. Aucune nouvelle dépendance.
- **API.** `health/app-version.ts` lit `APP_VERSION` (forme `X.Y.Z[-pré]` vérifiée, « v »
  retiré), repli sur le `package.json` de l'API suivi de « -dev » (`source: 'package'`) :
  une version de développement ne se fait jamais passer pour une release. `/health` rend
  `version` et `versionSource`.
- **Web.** `next.config.mjs` inline `NEXT_PUBLIC_APP_VERSION` au build (même règle, même
  repli). Le pied de page de l'application affiche « Lalanda vX.Y.Z » sur tous les écrans
  (Organisation › Fiscalité compris), et les deux versions si l'API en répond une autre ;
  le `/health` du web rend aussi sa version.
- **PDF : version figée au gel.** Choix et justification : ADR-0025 § 10 (amendement du
  20 oct. 2026). Champ figé optionnel `softwareVersion`, inclus dans `contentSha256` quand il
  existe ; anciens documents inchangés, sans migration. La vue `InvoiceView` l'expose.
- **Tests.** Résolution de la version (release, repli « -dev », valeurs refusées) ; `/health` ;
  version inlinée par `next.config.mjs` ; libellé du pied ; modèle du PDF : version figée
  imprimée, HTML identique quelle que soit la version qui rend, ancien document sans version,
  brouillon à la version courante.

### 6.3 Export du journal pour les vérificateurs (B3, exigence 1.20)

- **Ce qui ne change pas.** Le journal chaîné (`sales_invoice_journal`) n'est ni modifié ni
  réécrit : aucune entrée, aucun champ haché, aucune tête ne bouge. L'export **lit** les
  documents figés et les entrées existantes ; c'est l'empreinte `contentSha256` de chaque
  entrée qui relie le journal au contenu complet de la facture (lignes comprises), et
  l'export met les deux côte à côte.
- **Route.** `GET /sales/journal/export?from=AAAA-MM-JJ&to=AAAA-MM-JJ&format=json|csv
  [&dataset=ventes|echanges]` ; jours de Kinshasa, bornes incluses, 1 à 366 jours ; au-delà de
  5 000 factures, 50 000 entrées ou 20 000 échanges : `400 EXPORT_TOO_LARGE` (réduire la
  période). Fichier en pièce jointe, `cache-control: no-store`.
- **Permission : `fiscal.manage`** (Propriétaire, Directeur financier ; interdite à la
  plateforme, comme `report.export`). Un export est une extraction **en masse** de toutes les
  ventes et de tous les clients d'une période, acte du contribuable envers l'administration ;
  `sales.read` (Analyste, Lecteur…) aurait permis cette extraction en un clic à tout lecteur.
  La consultation page par page reste en `sales.read`. Chaque export est tracé
  (`sales_journal.exported` : période, format, volumes, état de la chaîne).
- **Contenu (JSON, complet).** Organisation (NIF), période, version du logiciel ; pour chaque
  facture **émise ou normalisée** de la période : numéro, série, type, date, client (type, nom,
  NIF), lignes (code envoyé à la DGI, désignation, type, groupe, quantité, prix, prix d'origine,
  modification, montant, taxe spécifique), totaux par groupe (taux, base, TVA, taxe
  spécifique, total), totaux, paiements, conversion et contre-valeur, avoir (nature,
  référence), Code DEF/DGI, NIM, compteurs, date DGI, QR, empreinte et **`contentIntact`**
  (empreinte recalculée à l'identique), entrées du journal qui la portent. Montants **qui font
  foi** recopiés sans calcul : CDF de `normalizedAmounts` pour une facture normalisée, devise
  du document sinon. Puis les entrées du journal de la période avec `prevHash`, et l'état de
  la chaîne : `valid` (chaîne **entière** vérifiée), algorithme du hachage écrit en clair,
  premier et dernier `seq`, `prevHash` d'ancrage — un vérificateur recalcule chaque `hash` hors
  de Lalanda. Enfin les échanges e-MCF de la période (requêtes et réponses, jamais d'en-tête
  donc jamais de jeton).
- **CSV** (séparateur « ; », UTF-8 avec BOM, décimales à point) : `ventes` = une ligne par
  ligne de facture et une par groupe de taxation, colonnes de la facture répétées (dont Code
  DEF/DGI, NIM, compteurs, empreinte, `contenu_intact`, `journal_seq`, `chaine_valide`) ;
  `echanges` = une ligne par entrée du journal des échanges. Un texte commençant par
  `= + - @` est préfixé d'une apostrophe (pas de formule exécutée à l'ouverture).
- **Écran.** Organisation › Fiscalité (déjà réservé à `fiscal.manage`) : bloc « Journal
  électronique — export pour les vérificateurs », dates (mois en cours par défaut), contenu
  (JSON complet, CSV ventes, CSV échanges), bouton « Exporter le journal ».
- **Index.** Aucun index ajouté : les factures se lisent par `{organizationId, sortAt}`
  (existant) ; les entrées par organisation (index `{organizationId, seq}`), volume borné.
- **Reste ouvert.** Question F 6 du courrier DGI : contenu complet dans le journal, ou
  empreinte reliant le journal à la facture immuable. Le PART de 1.20 pour les rapports X/Z/A
  (catégorie P) est hors de ce lot.
- **Tests.** Unitaires (`journal-export.test.ts` : période, montants qui font foi, code hors
  champ, `contentIntact`, CSV aligné, échappement) ; modèle web ; e2e
  (`normalization.e2e.test.ts`) : JSON complet, chaque `hash` de la période recalculé à partir
  de l'export, échanges sans jeton, isolation entre organisations, trace d'audit, CSV ventes et
  échanges, périodes invalides → 400, Propriétaire et DAF 200, Administrateur, Comptable,
  Analyste, Lecteur 403.

## 7. Campagne réelle — ligne de commande `edef:homologation` (21 oct. 2026)

**Décision de la dirigeante** : la campagne RÉELLE des 58 normalisations est autorisée sur
l'environnement de **TEST** de la DGI, avec l'organisation Go Freelance (profil fiscal, point
de vente e-MCF de test et jeton déjà dans le coffre, en production). Le dossier exige le PDF
Lalanda de chaque facture normalisée. Le code livré **n'exécute rien de lui-même** : la
commande se lance à la main (§ 7.6). Sources : `apps/api/src/edef/homologation/`
(`homologation.ts`, `campaign-run.ts`, `campaign-plan.ts`).

### 7.1 Ce que fait la commande

Contexte applicatif Nest (`AppModule`, **sans serveur HTTP**, ordonnanceur coupé :
`SCHEDULER_ENABLED=false` dans ce processus seulement), puis les **vrais services**, exactement
le chemin d'un utilisateur : fiches clients (`CustomersService`), brouillon puis paiements
(`InvoiceDraftsService`, corps validés par les **mêmes** schémas que l'API —
`CreateInvoiceSchema`, `PutInvoiceSchema`), « Normaliser » (`InvoiceFreezingService`, qui
passe par le port de normalisation et le client e-MCF), PDF **original**
(`InvoiceDocumentsService.original`, tel quel ; tracé `sales_invoice.pdf_exported`). Aucun
appel direct à la DGI ; la commande ne voit jamais le jeton (il reste chiffré dans le coffre).
Ordre : les 29 cas en TTC, puis les 29 en HT ; les avoirs 10, 11, 12, 16 suivent leurs
origines 1, 3, 6, 15 **dans le même mode**. Aucun format de numéro n'est supposé : le numéro
est lu du document normalisé.

### 7.2 Garde-fous (tous avant le premier brouillon)

| Garde-fou | Effet |
|---|---|
| `DGI_PRODUCTION_ENABLED` vrai (valeur brute autre que vide, `false`, `0`), ou `productionEnabled` dans la configuration chargée | refus |
| URL de test = hôte de production de la DGI (`assertTestTarget`, ADR-0024 § 7.2) | refus |
| environnement DGI de l'organisation ≠ `test`, ou facture normalisée non active | refus |
| opérateur non membre, ou rôle sans `sales.manage` **et** `sales.invoice` | refus |
| nombre de points de vente actifs ≠ 1 (le brouillon retient le seul actif) | refus |
| dossier `--out` suivi par git (dépôt public) ; sans git, un `.git` parent | refus |
| avoir dont l'origine n'est ni au plan ni déjà normalisée | refus |
| confirmation : affiche organisation, environnement, point de vente, opérateur, nombre de normalisations ; il faut taper `OUI` (sauf `--yes` ; sans terminal ni `--yes` : refus) | abandon sinon |

En cours de campagne : **arrêt à la PREMIÈRE erreur** (brouillon refusé, bloquant de
`readiness`, normalisation refusée ou non aboutie — statut ≠ `normalized`, avec le code et le
libellé DGI tels que reçus). Aucun cas suivant n'est tenté ; un avoir n'est jamais créé si son
origine n'est pas normalisée.

### 7.3 Reprise sans renormaliser : étiquette et fichier d'état

- **Étiquette de campagne** : champ interne optionnel `campaign: { id, caseNumber, priceMode }`
  de `sales_invoices`, posé à la création du brouillon par `InvoiceDraftsService.create`
  (option passée par la commande seulement ; le contrôleur ne la transmet jamais, les corps
  HTTP sont `.strict()`), lu par `campaignDocuments`. **Ni envoyé à la DGI, ni imprimé, ni
  dans `contentSha256`, ni dans la vue.** Pourquoi pas un commentaire : A et C partent à la
  DGI (`cmta`, `cmtc`) et B, D–H sont réservées (§ 2) — une étiquette y changerait le contenu
  fiscal envoyé. La règle « un seul écrivain » de `sales_invoices` est respectée (le service
  de brouillon l'écrit). Identifiant par défaut : `sfe-v1.2` (`--campaign` pour une autre).
- **Fichier d'état** `etat-campagne.json` dans `--out` (écriture atomique), une entrée par cas
  réussi ; refusé s'il appartient à une autre organisation ou campagne.
- **Relance** (même commande) : cas noté → sauté (PDF réécrit s'il manque) ; sinon, d'après
  l'étiquette en base : document **normalisé** non noté (arrêt brutal entre la normalisation et
  l'écriture de l'état, ou conteneur recréé) → repris tel quel, **sans renormaliser** ;
  brouillon laissé en route → supprimé puis recréé ; document **gelé non abouti**
  (`pending_normalization`, `normalization_failed`, `issued`) → **arrêt**, à régler dans
  Lalanda (Ventes › Factures) avant de relancer : jamais de seconde normalisation automatique.

### 7.4 Données

- **Clients** : quatre fiches FICTIVES « TEST HOMOLOGATION … » (PM, PC, PL, AO ; NIF fictifs
  `TEST…0001`), créées une fois puis retrouvées par type, NIF et nom ; le PP est une vente de
  comptoir « TEST HOMOLOGATION Particulier ». Une fiche au même NIF fictif mais d'un autre nom,
  ou désactivée : arrêt.
- **Articles** : les **lignes libres** des cas (désignations « … TEST », codes `TEST-<groupe>`),
  comme une saisie libre dans l'éditeur — rien de persistant, donc rien à dupliquer. Pas
  d'articles de catalogue : le code d'article est unique par organisation alors que les cas
  partagent `TEST-B`, `TEST-C`… entre plusieurs désignations ; les créer obligerait à changer
  les codes envoyés à la DGI (`items[].code`), que le jeu e2e (§ 4) vérifie.

### 7.5 Sorties (`--out`, jamais de jeton)

- un PDF par facture : `cas-XX-ttc|ht-<numéro>.pdf` (numéro lu du document, caractères hors
  `[A-Za-z0-9_-]` remplacés par `_`) ;
- `rapport.json` : par cas et mode — numéro, Code DEF/DGI, NIM, compteurs, date DGI, `uid`,
  totaux Lalanda (`total`, `vatTotal`, `specificTax`) et DGI (`total`, `vtotal`, `ts`, tels
  que reçus), comparaison (`compareSubmission`, le comparateur de la normalisation), durée de
  la normalisation, reprise depuis la base ou non ;
- `rapport.md` : le tableau lisible des 58 ; `etat-campagne.json`.

### 7.6 Lancer la campagne en production

Prérequis : une release qui contient la commande, déployée ; ne pas déployer pendant la
campagne (un conteneur recréé perd `/tmp`, la reprise retrouve alors les cas par l'étiquette
et réécrit les PDF). Listes de référence du point de vente rafraîchies (taux du jour pour le
cas 26). Identifiants : `_id` de l'organisation Go Freelance (collection `organizations`) et
de l'utilisatrice qui normalise (collection `user`).

```sh
ssh <vps> && cd /opt/lalanda
# 1. Plan, sans rien écrire
docker exec -it lalanda-prod-api-1 node --enable-source-maps dist/edef/homologation/homologation.js \
  --org <ORG_ID> --operator <USER_ID> --out /tmp/homologation-sfe-v1.2 --dry-run
# 2. Campagne : vérifier l'écran de confirmation, taper OUI
docker exec -it lalanda-prod-api-1 node --enable-source-maps dist/edef/homologation/homologation.js \
  --org <ORG_ID> --operator <USER_ID> --out /tmp/homologation-sfe-v1.2
# (en cas d'arrêt : corriger la cause affichée, relancer EXACTEMENT la commande 2)
# 3. Récupérer PDF et rapports
mkdir -p /opt/lalanda/dgi/homologation
docker cp lalanda-prod-api-1:/tmp/homologation-sfe-v1.2 /opt/lalanda/dgi/homologation/
# puis, depuis le poste : scp -r <vps>:/opt/lalanda/dgi/homologation/homologation-sfe-v1.2 ./dgi/homologation/
```

`npm run edef:homologation:dist -- …` est l'équivalent dans l'image ; hors image (poste de
développement), `pnpm --filter @lalanda/api edef:homologation -- …`. Le dossier local `dgi/`
est ignoré par git (dépôt public) : les PDF n'y entrent jamais.

### 7.7 Tests

- Unitaires `edef/homologation/campaign-plan.test.ts` : arguments (un jeton collé par erreur
  n'est jamais réaffiché), plan des 58, enchaînements et origine manquante, nom des PDF, état,
  rapports.
- E2E `__tests__/homologation-cli.e2e.test.ts` — la vraie commande contre le **faux serveur
  e-MCF** (jamais la DGI) : refus si production ouverte, organisation hors TEST, opérateur
  étranger, sans terminal ; `--dry-run` n'écrit rien (ni dossier, ni brouillon, ni client, ni
  envoi) ; arrêt simulé **juste après la normalisation du cas 12 TTC** puis reprise : le cas 12
  est retrouvé en base, 58 envois exactement, 58 numéros distincts, 58 PDF, rapports complets,
  Code DEF/DGI, NIM, compteurs et `uid` égaux à ceux du faux serveur, avoir 12 rattaché au
  code du cas 6 ; aucun jeton dans les sorties ; relance idempotente (aucun envoi).

## Conséquences

- Les cas 14 et 29 s'impriment conformément à la DGI ; aucun autre rendu ne change (pour un
  article ordinaire, le code envoyé est le code de l'article).
- La campagne réelle se prépare sans écrire de code : les 29 cas sont des données, rejouées
  en CI contre le faux serveur à chaque changement — et par `edef:homologation` (§ 7) contre
  l'environnement de TEST de la DGI.
- `sales_invoices` gagne un champ interne optionnel `campaign` (§ 7.3), sans migration ni
  effet sur le contenu figé.

## Plan de validation

- Unitaire : `edef/homologation/homologation-cases.test.ts` (29 cas, enchaînements, groupes
  A–P, types d'article, clients, six moyens de paiement, corps de requête).
- Modèle du PDF : code « HORS CHAMP » imprimé ; mention AO.
- E2E : `invoices.homologation.e2e.test.ts` (faux serveur, jamais la DGI).
- Campagne réelle : `campaign-plan.test.ts` et `homologation-cli.e2e.test.ts` (§ 7.7).

## Liens

- [ADR-0019](ADR-0019-facture-normalisee-dgi-rdc.md), [ADR-0022](ADR-0022-clients-catalogue-et-calcul-des-factures.md),
  [ADR-0023](ADR-0023-factures-et-avoirs.md), [ADR-0024](ADR-0024-normalisation-dgi.md),
  [ADR-0025](ADR-0025-documents-pdf-factures.md)
- `docs/sources/dgi-rdc/README.md`
