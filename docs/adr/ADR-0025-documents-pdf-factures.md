# ADR-0025 — Documents PDF des factures et avoirs : mentions, QR code, duplicata, filigrane de test (lot S25g)

Statut : Proposed
Date : 2026-10-20
Décideurs : Gracy Omokoso (décisions produit, dont l'exigence du filigrane de test) ;
CTO Lalanda (contrat technique)

> **Complète [ADR-0023](ADR-0023-factures-et-avoirs.md)** (tableau « ce qui s'imprime »,
> § S25e.1 ; champ `duplicateCount`, § S25e.2 ; événement `duplicate_issued`, § S25e.12) et
> **[ADR-0024](ADR-0024-normalisation-dgi.md)** (§ 4.3 : `documentKind` est l'unique entrée de
> l'intitulé du PDF ; éléments de sécurité imprimés tels que reçus). **Réutilise
> [ADR-0007](ADR-0007-generation-pdf-excel.md)** (Puppeteer) et l'infrastructure de rendu des
> rapports (navigateur partagé, portillon S22e, confinement réseau et JavaScript). Aucun
> champ figé n'est ajouté ni retiré ; aucun événement de journal n'est ajouté.

## Contexte

### Où l'on en est

Plan RUN : S25c clients et catalogue · S25d calcul conforme · S25e factures et avoirs ·
S25f connexion DGI (livré, en production : une facture de test `TEST-2026-000001` a été
normalisée et porte ses éléments de sécurité) · **S25g documents PDF (cet ADR)** · S25h
campagne des 32 cas officiels, dont **chaque capture est une facture Lalanda imprimée**.

S25g ne calcule rien et ne décide d'aucun état : il **met en page** un document figé.
Tout ce qu'il imprime est déjà dans `sales_invoices` (ADR-0023 § S25e.2) :

| Donnée | Champ figé |
|---|---|
| Intitulé | `documentKindOf(doc)` (`invoice-view.ts`) — seule entrée |
| Vendeur | `seller` (au gel) ; fiche fiscale courante pour un brouillon |
| Client | `customer` (instantané, `printContactDetails`) |
| Lignes, totaux par groupe, TVA, taxe spécifique, total | `documentAmounts.calculation.totals` (devise d'origine) ; `normalizedAmounts.calculation` et `normalizedAmounts.lines` (CDF) |
| Paiements | `payments` ; `normalizedAmounts.payments` (CDF) |
| Contre-valeur USD | `normalizedAmounts.counterValueUsd` (`amount`, `rate`, `date`) |
| Numéro, série, date d'émission | `number`, `series`, `issuedAt` (définitifs seulement) |
| Éléments de sécurité | `normalization.{codeDefDgi, nim, counters, dgiDateTime, qrCode}` |
| ISF, environnement | `isf`, `environment` |
| Opérateur | `operator.name` |
| Avoir | `creditNote.{nature, originNumber, reference}` |
| Commentaires | `comments.A`, `comments.C` |
| Duplicata | `duplicateCount` (seul écrivain : S25g) |

### Règles DGI qui s'appliquent (résumé, reformulé)

Sources : documentation du compte développeur DGI (non publique, hors dépôt ; lue dans le
dossier local `dgi/`, jamais versionné) — note de service n° 01/022 du 19 févr. 2026 et son
annexe « spécifications fonctionnelles et techniques des SFE » (règles 1.1.x et 2.1 a à x),
présentation « Mise à jour et homologation des SFE » v1.2 (26 déc. 2025), protocole
SFE-MCF v1.0, tableaux de conformité v1.2, cas de test v1.2 ; spécification publique e-DEF
v2.0 (`docs/sources/dgi-rdc/edef-api-v2.0-2026-10-18.json`). Seul ce qui fixe le contrat
est repris, en substance.

- **Format libre** (A4 ou ticket) ; seul le **contenu** est imposé.
- **Données imprimées = données échangées** avec l'e-MCF : on imprime ce qui a été envoyé et
  reçu, jamais un recalcul.
- **Mentions obligatoires** (règle 2.1, lettres a à x) : dénomination, NIF, adresse du lieu
  de vente et contacts du vendeur ; NIF, nom et **type** du client (adresse et contact sur sa
  demande) ; « DUPLICATA » sur une copie ; « FACTURE D'AVOIR » et la nature de l'avoir ;
  « EXPORTATION » ; « D'ACOMPTE » ; étiquette du groupe de taxation ; numéro de série
  ininterrompu par année ; pour chaque article : désignation, groupe, type, quantité, prix,
  montant, remise ou modification de prix ; total par groupe, taux, impôt par groupe ; total
  TTC **en chiffres et en lettres** ; **montant en USD et taux de change** ; modes de
  paiement ; taxe spécifique ; date et heure ; **ISF** ; **nom de l'opérateur** ; **éléments
  de sécurité**.
- **Éléments de sécurité** (bloc du modèle de facture) : « Code DEF/DGI », « DEF NIM »,
  « DEF Compteurs », « DEF Heure », QR code, ISF. L'e-MCF renvoie la chaîne du QR prête
  (`qrCode`). Correction d'erreur annoncée : **M (15 %)** ; le QR doit être lisible au
  scanner.
- **Duplicata** : une copie porte « DUPLICATA » et garde **le même numéro** que l'original
  (règles 1.1.8, 1.1.15, 2.1 f).
- **Mode de prix** TTC ou HT indiqué sur la facture (règle 1.5.4).
- **Type de client** imprimé sous la forme « [PM] Personne morale », etc.
- **Type d'article** `[BIE]`, `[SER]`, `[TAX]` affiché.

## Options considérées

### O1 — Où rendre le PDF

1. **Puppeteer, HTML à CSS inline, navigateur partagé avec les rapports** (retenu) :
   ADR-0007 ; le portillon S22e (2 rendus simultanés, file de 8, refus `503`) et le
   confinement (JavaScript coupé, toute requête réseau avortée) s'appliquent sans rien
   réécrire. Le code de navigateur de `ReportsService` est extrait dans
   `PdfRenderingService` (module `PdfModule`), que les rapports et les factures partagent :
   **un seul** Chromium, **un seul** portillon.
2. Bibliothèque PDF bas niveau (pdfkit…) : nouvelle dépendance, mise en page à la main,
   second chemin de rendu à durcir. Rejeté.
3. Rendu par le web (Next) : le PDF ferait foi depuis le navigateur de l'utilisateur ;
   aucune garantie que les données imprimées sont les données figées. Rejeté.

### O2 — Conserver le PDF (MinIO) ou le reproduire

1. **Reproduire** à chaque demande depuis le contenu figé (retenu). Le contenu figé et son
   empreinte `contentSha256` sont la seule source ; un fichier stocké serait une seconde
   vérité, et sa perte ou sa divergence un incident fiscal. Le rendu est **déterministe** :
   même document figé → même PDF, octet pour octet (dates de métadonnées du PDF fixées à la
   date du gel, aucun horodatage d'impression dans le contenu).
2. Stocker chaque PDF émis dans le bucket des exports : utile si la mise en page devait
   changer après coup (le gabarit est versionné, `INVOICE_PDF_LAYOUT_VERSION`, imprimé en
   pied de page). Reporté : à décider avant la production si la DGI exige la conservation
   du rendu lui-même (question ouverte n° 4).

### O3 — Original et duplicata

1. **L'original se télécharge autant que voulu, à l'identique ; le duplicata est une action
   distincte, numérotée et journalisée** (retenu). L'original électronique est un seul
   document, reproduit sans variation ; un duplicata est une copie remise **en plus**, qui
   porte « DUPLICATA n° k » et le même numéro de facture.
2. Seul le premier téléchargement est l'original, tout autre est un duplicata : un simple
   aperçu à l'écran ou un téléchargement interrompu consommerait l'original. Rejeté pour
   un logiciel en ligne ; reste la lecture probable d'une caisse avec imprimante (question
   ouverte n° 1).

## Décision

### 1. Intitulé : `documentKind`, et lui seul

L'intitulé du PDF est choisi par `documentKindOf(doc)` (ADR-0024 § 4.3), jamais par le
statut directement :

| `documentKind` | Statut | Intitulé imprimé | Mentions d'état |
|---|---|---|---|
| `proforma` | `draft` | **PRO FORMA — non valable comme facture** | référence `PF-…` |
| `proforma` | `pending_normalization` | idem | + « Normalisation DGI en cours » |
| `proforma` | `normalization_failed` | idem | + « Normalisation DGI refusée ou interrompue » |
| `invoice` | `issued` (organisation ordinaire) | **Facture** / **Facture d'avoir** | numéro définitif |
| `invoice` | `normalized` | **Facture normalisée** / **Facture d'avoir normalisée** | numéro définitif + bloc DGI |

Règles :

- **Un pro forma ne contient pas le mot « facture »**, hors de la phrase « non valable comme
  facture ». Les libellés de type deviennent neutres (« Vente », « Acompte », « Avoir »,
  « Vente à l'exportation »…), le total en lettres dit « Arrêté le présent pro forma à la
  somme de », et la référence est « Référence pro forma : PF-… », jamais « N° ». Aucun
  numéro de la série fiscale, aucun élément de sécurité (même réservé ou reçu partiellement).
- Un document `normalized` sans `codeDefDgi` ou sans `qrCode` (impossible par construction)
  se lit `proforma` (verrou d'ADR-0024) : il s'imprime donc en pro forma, et l'alerte
  existante se déclenche.
- **Aucune route n'imprime « facture » pour un document non final.** Le duplicata est refusé
  (`409 DUPLICATE_NOT_ALLOWED`) tant que `documentKind` vaut `proforma`.
- Un brouillon dont le calcul échoue (`calculation.ok = false`) n'est pas imprimable :
  `409 DOCUMENT_NOT_PRINTABLE` avec les problèmes du moteur. Le PDF n'imprime jamais un
  montant absent ou provisoire.

### 2. Montants : imprimés tels que figés

- **Facture normalisée** : lignes, totaux par groupe, TVA, taxe spécifique, total et
  paiements en **CDF**, lus dans `normalizedAmounts` (prix unitaires CDF de
  `normalizedAmounts.lines`, montants de ligne et de groupe de
  `normalizedAmounts.calculation`). Ce sont les montants envoyés et confirmés : **seuls à
  valeur fiscale**. La mention « Montants en francs congolais (CDF) — font foi » les titre.
  Les montants d'origine en USD ne sont **pas** imprimés (la DGI n'en connaît que la
  contre-valeur) ; la contre-valeur l'est (§ 4).
- **Facture ordinaire** (`issued`) et **pro forma** : montants du document dans sa devise
  (`documentAmounts.calculation.totals`, `payments`). Un pro forma `pending_normalization` ou
  `normalization_failed` imprime aussi les montants du document : ses montants CDF n'ont
  pas encore de valeur fiscale.
- **Aucune opération** sur un montant dans le code du PDF : formatage seulement (séparateur
  de milliers, virgule décimale). Le total en lettres est une transcription de la chaîne
  décimale, chiffre par chiffre, sans conversion en nombre.

### 3. Mentions imprimées, par type

En-tête vendeur (toujours) : dénomination (et nom commercial), NIF, RCCM s'il existe,
adresse (point de vente si normalisé, siège sinon — celle figée au gel), téléphone, e-mail.
Pour un brouillon, la fiche fiscale **courante** (aucun vendeur n'est figé avant le gel) ;
sans fiche, l'en-tête se limite au nom de l'organisation.

Client (toujours) : « [PM] Personne morale » (ou PP, PC, PL, AO), nom, NIF ; adresse,
téléphone et e-mail **seulement si** `printContactDetails`.

| Type | Intitulé (final) | Mentions DGI ajoutées |
|---|---|---|
| `FV` | Facture | — |
| `FT` | Facture | « D'ACOMPTE » |
| `FA` | Facture d'avoir | « FACTURE D'AVOIR » + nature (`COR` « Correction », `RAN` « Annulation », `RAM` « Avoir suite reprise », `RRR` « Remise, ristourne, rabais (RRR) ») + référence de l'origine |
| `EV` | Facture | « EXPORTATION » |
| `ET` | Facture | « EXPORTATION » + « D'ACOMPTE » |
| `EA` | Facture d'avoir | « EXPORTATION » + « FACTURE D'AVOIR » + nature + référence |

Référence d'un avoir : « Facture d'origine : n° … » (`creditNote.originNumber`) et « Code
DEF/DGI d'origine : … » (`creditNote.reference`) ; pour un `RRR` sans origine,
« Référence : RRR ». Sur un pro forma d'avoir, « AVOIR » remplace « FACTURE D'AVOIR ».

Lignes : désignation, code, `[BIE]`/`[SER]`/`[TAX]`, étiquette du groupe « [B] » (« hors
champ » si `outOfScope`), quantité et unité, prix unitaire, remise ou modification de prix
(`priceModification`, prix d'origine), taxe spécifique « T.S. », montant.

Totaux : un tableau par groupe utilisé (groupe, taux, base, TVA, total), taxe spécifique,
total TVA, **total TTC** ; mode de prix « Prix unitaires TTC » ou « Prix unitaires HT » ;
paiements (mode, montant) et part à crédit le cas échéant.

Pied : date et heure d'établissement (heure de Kinshasa) — `issuedAt` pour un document
final, date du gel ou de dernière modification pour un pro forma ; opérateur (« Établi
par ») ; commentaires A (« Réf. Exo. : … ») et C quand ils existent ; version du gabarit.

### 4. Total en lettres et contre-valeur

- **Total en lettres** (français, orthographe traditionnelle : « quatre-vingts »,
  « deux cents », « deux cent un », « vingt et un », « mille » invariable, « un million de
  francs congolais ») du **total qui fait foi** : CDF pour une facture normalisée, devise du
  document sinon. Devises : « franc(s) congolais », « dollar(s) américain(s) » ; partie
  décimale en « centime(s) » (CDF) ou « cent(s) » (USD), omise si nulle. Phrase :
  « Arrêté(e) la présente facture à la somme de : … ».
- **Contre-valeur USD** (normalisée, quand `counterValueUsd` existe — toujours pour un
  document en USD) : « Contre-valeur : X USD — taux appliqué : 1 USD = R CDF (taux du
  JJ/MM/AAAA) », valeurs figées, aucun recalcul.

### 5. Cadre DGI (facture normalisée seulement)

Bloc « Éléments de sécurité DGI », chaînes imprimées **telles que reçues** (aucun
reformatage, aucun découpage) :

| Libellé | Champ |
|---|---|
| Code DEF/DGI | `normalization.codeDefDgi` |
| DEF NIM | `normalization.nim` |
| DEF Compteurs | `normalization.counters` |
| DEF Heure | `normalization.dgiDateTime` |
| ISF | `isf` |
| QR code | `normalization.qrCode` |

**QR code** : la chaîne `qrCode` est encodée **telle quelle**, sans reconstruction ni
transformation (pas de majuscules forcées, pas d'espaces retirés), niveau de correction
**M**, par la bibliothèque `qrcode` (rendu SVG vectoriel inline, aucune image distante). Le
mode d'encodage est choisi par la bibliothèque (le `;` n'appartient pas au jeu
alphanumérique de la norme QR : la chaîne passe en mode octet, ce qui ne change pas son
contenu décodé). Taille imprimée ≥ 30 mm, zone de silence de 4 modules.

### 6. Filigrane OBLIGATOIRE en environnement de test

Exigence de la décideuse : **tout document issu de l'environnement de test DGI le dit, sans
ambiguïté possible**.

Condition (défense en profondeur, la première vraie suffit) :
`environment === 'test'` **ou** `series === 'test'` (numéro `TEST-…`) **ou**, pour un
brouillon, l'organisation est en facture normalisée dans l'environnement de test.

Alors, sur **chaque page** :

1. bandeau en tête et en pied : « **Environnement de test DGI — sans valeur fiscale** » ;
2. le mot **TEST** en filigrane diagonal, grand, visible sans masquer le texte ;
3. à côté de l'intitulé, la pastille « TEST ».

En environnement `production` (série réelle), aucun de ces éléments n'apparaît. Tests :
présence avec `environment: 'test'`, absence avec `production`.

### 7. Duplicata

`POST /sales/invoices/:invoiceId/duplicate` :

1. refus `409 DUPLICATE_NOT_ALLOWED` si `documentKind` vaut `proforma` ;
2. lecture de `duplicateCount = n` ; rendu du PDF avec « **DUPLICATA n° n+1** » (en tête,
   à côté de l'intitulé, et en pied de chaque page) ;
3. **une transaction** : `updateOne({ _id, organizationId, status ∈ {issued, normalized},
   duplicateCount: n }, { $inc: { duplicateCount: 1 } })` — incrément **atomique et
   conditionnel** ; s'il ne correspond à rien (duplicata concurrent), on recommence au
   point 2 (trois essais, puis `409 DUPLICATE_CONFLICT`) ; entrée de journal
   `duplicate_issued` (numéro, série, type, totaux, `contentSha256`, acteur) dans la même
   transaction ; audit `sales_invoice.duplicate_issued` ;
4. envoi du PDF.

Le rendu précède l'incrément : un rendu refusé (`503`) ou en échec ne consomme aucun numéro
de duplicata et n'écrit rien au journal. `duplicateCount` n'entre pas dans `contentSha256`
et ne change ni `revision` ni aucun champ figé (champ de suivi, ADR-0023 § S25e.1).
**Seul écrivain** de `duplicateCount` : `InvoiceDocumentsService` (test de lecture des
sources).

L'original (`GET …/pdf`) ne porte jamais « DUPLICATA » et n'écrit rien au journal
électronique (aucun événement `printed` n'existe dans ADR-0023 ; on n'en ajoute pas) ; il
est tracé par l'audit strict `sales_invoice.pdf_exported` (ADR-0012 R4 : un export non
tracé n'est pas émis).

### 8. Contrat HTTP

| Route | Permission | Réponse |
|---|---|---|
| `GET /sales/invoices/:invoiceId/pdf` | `sales.read` | `200 application/pdf`, `content-disposition: attachment; filename="<numéro ou PF-…>.pdf"` |
| `POST /sales/invoices/:invoiceId/duplicate` | `sales.manage` | `200 application/pdf`, `filename="<numéro>-duplicata-<k>.pdf"`, en-tête `x-duplicate-number: k` |

Erreurs : `404 INVOICE_NOT_FOUND` (autre organisation comprise), `409 DOCUMENT_NOT_PRINTABLE`,
`409 DUPLICATE_NOT_ALLOWED`, `409 DUPLICATE_CONFLICT`, `503 REPORT_RENDER_BUSY` (portillon
partagé). Le duplicata est réservé à `sales.manage` (Propriétaire, Administrateur,
Directeur financier, Comptable) : il écrit au journal électronique ; la lecture et
l'original restent à `sales.read`. **Proposition soumise à la décideuse** (décision ouverte
n° 2).

Aucun quota d'exports n'est appliqué aux factures (le quota PDF des rapports est une limite
commerciale de l'offre BUILD) ; le portillon borne la mémoire.

### 9. Fichiers

- `apps/api/src/reports/pdf-rendering.service.ts`, `pdf.module.ts` : navigateur, portillon,
  confinement, métadonnées fixées (extraits de `ReportsService`, qui délègue).
- `apps/api/src/sales/documents/` : `invoice-document.model.ts` (choix de l'intitulé, des
  mentions et des montants — pur, testé), `amount-in-words.ts`, `invoice-qr.ts`,
  `invoice-document-html.ts` (mise en page, échappement systématique),
  `invoice-documents.service.ts` (lecture, duplicata), `invoice-documents.controller.ts`.
- Web : boutons « Télécharger le PDF » (tout document imprimable) et « Duplicata » (document
  final, `sales.manage`) sur la fiche.

## Conséquences

- Les captures de la campagne S25h sortent de Lalanda, avec le bloc DGI et le QR exact.
- Tant que l'environnement est `test`, aucun PDF ne peut être pris pour une facture valable.
- Une nouvelle dépendance de production : `qrcode` (MIT), dans `apps/api` seulement.
- Le rendu PDF dépend de Chromium : la CI (sans Chromium) teste le modèle et le HTML ; le
  rendu réel est testé là où Chromium existe (test unitaire conditionnel) et en production.

## Plan de validation

- Unitaires : intitulé par `documentKind` × statut × type ; aucun « facture » dans un pro
  forma hors de la phrase consacrée ; mentions par type et nature ; montants CDF pour une
  facture normalisée, devise d'origine sinon ; filigrane présent si `test`, absent si
  `production` ; total en lettres (zéro, un, vingt et un, quatre-vingts, deux cents, mille,
  un million de, milliards, décimales) ; contenu du QR = `qrCode` exact ; HTML déterministe ;
  échappement des champs utilisateur.
- Rendu réel (si Chromium) : deux rendus du même document → mêmes octets ; PDF d'exemple
  test et production écrits dans `apps/api/.pdf-samples/` (ignoré par Git).
- E2E (faux serveur e-MCF, jamais la DGI) : original d'une facture normalisée et d'un pro
  forma ; duplicata 1 puis 2, `duplicateCount` et journal ; duplicata d'un pro forma → 409 ;
  `contentSha256` inchangé ; RBAC (Analyste : original oui, duplicata 403) ; autre
  organisation → 404 ; `routes-coverage`.

## Décisions ouvertes — elles appartiennent à la décideuse

1. **Original répétable** : le téléchargement de l'original reste libre et identique ; seule
   l'action « Duplicata » produit une copie marquée. Lecture à confirmer avec la DGI
   (question n° 1).
2. **Permission du duplicata** : `sales.manage` (proposé) ou `sales.invoice`.
3. **Montants d'origine en USD** sur une facture normalisée : non imprimés (proposé) — seule
   la contre-valeur l'est. À revoir si les clients en dollars le demandent.

## Questions à poser à la DGI (complètent ADR-0023 et ADR-0024)

1. Un logiciel en ligne peut-il laisser télécharger l'original électronique plusieurs fois à
   l'identique, le « duplicata » étant réservé à une copie remise en plus ?
2. Le contenu `qrCode` de l'e-MCF est-il à encoder tel quel (déjà posée, ADR-0024) ; le mode
   octet est-il accepté malgré l'« AlphaNumeric » annoncé ?
3. Faut-il imprimer les huit lignes de commentaire, même vides, ou seulement celles qui ont
   un contenu ?
4. Le rendu PDF lui-même doit-il être conservé (durée), ou les données de la facture
   suffisent-elles ?
5. Libellé exact attendu pour la nature `RRR` et format d'impression de « DEF Compteurs »
   (reçu tel quel, ex. « 7/8 FV »).
6. Le régime fiscal (mention j) se limite-t-il à l'étiquette du groupe par ligne, ou faut-il
   une mention de régime du vendeur (assujetti / non assujetti) ?

## Liens

- [ADR-0007](ADR-0007-generation-pdf-excel.md), [ADR-0012](ADR-0012-modele-rbac-complet.md),
  [ADR-0019](ADR-0019-facture-normalisee-dgi-rdc.md), [ADR-0022](ADR-0022-clients-catalogue-et-calcul-des-factures.md),
  [ADR-0023](ADR-0023-factures-et-avoirs.md), [ADR-0024](ADR-0024-normalisation-dgi.md)
- `docs/sources/dgi-rdc/README.md`
