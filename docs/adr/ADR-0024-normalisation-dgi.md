# ADR-0024 — Normalisation DGI : envoi, comparaison, confirmation, états incertains et étalonnage (lot S25f)

Statut : Proposed
Date : 2026-10-19
Décideurs : Gracy Omokoso (décisions produit ci-dessous) ; CTO Lalanda (contrat technique)

> **Amende ADR-0023.** Les fichiers figés au jalon E0 reçoivent des **ajouts** (aucun champ
> retiré, aucun sens changé) : `normalization.port.ts` (champs de `InvoiceNormalizationState`),
> `invoice.contract.ts` (vue `NormalizationView`, trois événements de journal, codes d'erreur,
> quatre routes). `InvoiceNumberingService` reçoit trois méthodes. Jalon F0 ci-dessous.
> **Amende ADR-0021** : le journal `edef_exchanges` passe en version 2 (entrées liées requête et
> réponse, écriture stricte avant tout envoi de facture) ; un point de vente qui porte une
> normalisation non soldée ne se désactive plus.

## Contexte

### Où l'on en est

Plan RUN : S25c clients et catalogue · S25d calcul conforme · S25e factures et avoirs
(fusionnés) · **S25f connexion DGI (cet ADR)** · S25g PDF, QR code, duplicata · S25h campagne
des 32 cas officiels. S25f est le cœur de l'homologation : c'est lui qui transforme un pro
forma figé en **facture normalisée**, ou qui le refuse proprement.

Ce que S25f trouve en place (vérifié sur `main`, commit `fc8044d`) :

| Fait | Où |
|---|---|
| Port `SalesInvoiceNormalizer.normalizeNow(organizationId, invoiceId)` → `'normalized' \| 'failed' \| 'uncertain' \| 'deferred'` ; implémentation `NoopSalesInvoiceNormalizer` (`'deferred'`) | `apps/api/src/sales/invoices/normalization.port.ts`, `noop-normalizer.ts` |
| `normalize` gèle le document dans une transaction (`pending_normalization`, conversion CDF, `normalization` initialisé à `attempts: 0`), **puis** appelle le port hors transaction | `invoice-freezing.service.ts:171-193` |
| Contenu figé disponible : `seller.nif`, `isf`, `environment`, `priceMode`, `type`, `customer`, `operator`, `lines` + `normalizedAmounts.{lines, payments, calculation, counterValueUsd}`, `creditNote.reference`, `comments`, `taxRates` (A–P seulement) | `invoice.schema.ts`, `invoice.types.ts` |
| Numérotation : `reserve` (bail `inFlight` de **3 min**, rejouable), `confirm(issuedAt)`, `release` (rend le numéro s'il est le dernier) | `invoice-numbering.service.ts:32, 148-293` |
| `documentKindOf(status)` : `invoice` pour `issued` et `normalized`, `proforma` sinon | `invoice-view.ts:46` |
| Client e-MCF : `getStatus`, `getReferenceList` seulement ; ne lève jamais ; aucun réessai ; production fermée = aucun appel ; chaque appel journalisé **sans en-tête**, mais journal **non bloquant** (« S25f devra décider d'un journal strict ») | `apps/api/src/edef/edef.client.ts`, `edef-exchange.journal.ts` |
| `edef_reference_snapshots` : `record` (un document par contenu nouveau), `latest(environment, list)` ; **aucun rafraîchissement planifié** | `edef-reference-snapshots.service.ts` |
| `PointsOfSaleService.resolveActiveToken` ne rend le jeton que si le point de vente est `active` (donc pas s'il est `failing` ou `token_expired`) | `fiscal/points-of-sale.service.ts:167` |
| Ordonnanceur : `register`, `every` (période ≥ 15 s), `schedule` rejouable par clé, **sans session de transaction** ; au moins une fois ; bail de 5 min | `scheduler/scheduler.service.ts` |
| Moteur : `compareWithEdefResponse(ours, rates, response)` compare les 67 champs `EDEF_TOTALS_FIELDS` (taux, totaux, HT, TVA des 16 groupes, `ts`, `total`, `vtotal`), un champ absent vaut 0, une valeur illisible est une différence ; `decimalToJsonNumber` refuse plus de 15 chiffres significatifs | `packages/engine/src/invoice-totals/edef-shape.ts` |
| Cas de calibrage et quatre politiques candidates `CALIBRATION_ROUNDING_POLICIES` ; politique par défaut `dgi-cd-2026.1` (`per_line`, `vat: 'up'`) | `invoice-totals/reference-cases.ts`, `compute.ts` |
| Le web a le bouton « Normaliser » et sa fenêtre ; il connaît trois issues (`normalized`, `normalization_failed`, sinon « en attente de la DGI ») | `apps/web/.../ventes/factures/_components/normalize-dialog.tsx` |
| Quotas : `GLOBAL_THROTTLE`, `INTEGRATION_WRITE_THROTTLE`, `EDEF_TEST_THROTTLE` | `security/throttling.ts` |

### Ce que dit la DGI (en substance)

Sources : spécification **publique** e-DEF v2.0 (`docs/sources/dgi-rdc/edef-api-v2.0-2026-10-18.json`,
ci-après « la spécification ») et documentation du compte développeur (non publique, hors
dépôt ; synthèses locales `dgi/`, jamais commitées). Seul ce qui fixe le contrat est repris.

- **Routes de facturation** (spécification) : `GET /api/invoice` (demandes en attente :
  `pendingRequestsCount`, `pendingRequestsList[]` = `{ date, uid }`, **sans** numéro de
  facture) ; `POST /api/invoice` (`InvoiceRequestDataDto` → `InvoiceResponseDto` : `uid`,
  taux et totaux par groupe, `ts`, `total`, `curTotal`, `vtotal`, ou `errorCode`/`errorDesc`
  avec `uid` nul) ; `GET /api/invoice/{uid}` (`InvoiceDetailsDto` : requête, `totals`,
  `secElements`) ; `PUT /api/invoice/{uid}/confirm` (`{ total, vtotal }` →
  `FinalizeInvoiceResponseDataDto` : `dateTime`, `qrCode`, `codeDEFDGI`, `counters`, `nim`) ;
  `PUT /api/invoice/{uid}/cancel`.
- **Délai** : une demande non finalisée **expire au bout de deux minutes** ; au plus **dix**
  demandes en attente par e-MCF.
- **Idempotence** : aucune clé d'idempotence. La seule protection est le refus d'une demande
  **en attente** portant le même numéro (`rn`) — l'erreur renvoie l'`uid` de la demande
  existante. Rejouer `confirm` sur un `uid` déjà finalisé, annulé ou expiré renvoie une
  erreur **ambiguë** (elle ne dit pas lequel des trois).
- **Coupure** : attendre au moins 10 s ; sans réponse, vérifier le statut puis la facture par
  son `uid`. Un `confirm` resté sans réponse peut avoir normalisé la facture **ou non**.
- `GET /api/invoice/{uid}` décrit une demande **en attente** ; la présence de `secElements`
  dans la spécification laisse **penser** qu'elle répond aussi pour une facture finalisée —
  **non documenté** (question DGI n° 1).
- **Exigences** : conserver date, requête et réponse de chaque échange ; afficher à
  l'utilisateur le **code et le libellé** d'erreur DGI ; aucune facture enregistrée sans
  éléments de sécurité ; données imprimées identiques aux données échangées.

### Faits observés le 19 oct. 2026 sur l'environnement de test DGI

`/api/info/currencyRates` renvoie le taux USD (2 262,32) ; `/api/info/taxGroups` renvoie 19
groupes `a`…`s` (Q, R à 8 %, S à 0 % ne sont définis par aucun document ; Lalanda n'utilise que
A–P) ; environ **150 ms** par appel ; le statut du jeton de test de Go Freelance est valide.
**Aucun appel à `/api/invoice` n'a encore été fait.**

## Options considérées

### O1 — Où se joue l'échange envoi → comparaison → confirmation

1. **Dans une tâche de l'ordonnanceur.** Écarté : passage toutes les 15 s, reprises à 30 s,
   1 min, 2 min — incompatible avec l'expiration à deux minutes ; et une tâche « au moins une
   fois » qui enverrait un `POST` pourrait l'envoyer deux fois.
2. **Dans la requête de l'utilisateur, d'un seul tenant.** **Retenu** (ADR-0019) : quelques
   centaines de millisecondes en temps normal. L'ordonnanceur **ne fait que vérifier** :
   il lit, il peut annuler, il **n'envoie jamais** de `POST` ni de `confirm`.

### O2 — Que faire quand la réponse manque

1. **Réessayer automatiquement.** Écarté : un second `POST` après un `confirm` sans réponse
   peut produire **deux factures normalisées** pour une seule vente. Un doublon fiscal est
   pire qu'un retard.
2. **Machine à états explicite, phases écrites avant chaque envoi, vérification par lecture
   DGI après l'expiration des demandes en attente, intervention humaine quand la DGI ne
   permet pas de conclure.** **Retenu** (§ 3 et § 4).

### O3 — Ce que fait l'ordonnanceur des demandes en attente qui ne sont pas à nous

1. **Annuler toute demande en attente du point de vente.** Écarté : un contribuable peut
   utiliser le même e-MCF avec un autre logiciel ; annuler sa demande serait une faute.
2. **N'annuler que ce que Lalanda reconnaît** (même `rn`, même NIF, même empreinte de
   contenu). **Retenu.** L'expiration à deux minutes fait le reste.

### O4 — Journal `edef_exchanges` pour les factures

1. **Non bloquant, comme pour les listes (ADR-0021).** Écarté : la DGI exige la conservation
   de chaque échange ; une facture normalisée sans trace de l'échange serait indéfendable.
2. **Un document unique mis à jour après la réponse.** Écarté : le journal est en ajout seul.
3. **Deux entrées liées par `exchangeId` : la requête, écrite strictement AVANT l'envoi (pas
   d'envoi sans trace), puis la réponse.** **Retenu** (§ 6).

### O5 — Où enregistrer la politique d'arrondi retenue

1. **Variable d'environnement ou réglage en base.** Écarté : une règle de calcul fiscal doit
   être versionnée avec le code qui l'applique et relue en revue.
2. **Constante du moteur, avec un relevé d'étalonnage daté et sourcé, verrouillé par test.**
   **Retenu** (§ 7) ; c'est déjà la voie d'ADR-0022 (« une ligne et une nouvelle version du
   calcul »).

### O6 — Quel jeton pour rafraîchir les listes de référence

1. **Le jeton d'une organisation au profit de toutes.** Écarté : on n'utilise pas le jeton d'un
   contribuable pour le service d'un autre, même pour lire des données publiques.
2. **Un jeton « plateforme » de Go Freelance.** Écarté : il n'existe qu'en test ; la production
   en serait dépourvue.
3. **Chaque organisation rafraîchit avec son propre jeton, pour son propre besoin ; les
   instantanés restent partagés par environnement (dédoublonnés par empreinte).** **Retenu**
   (§ 8).

## Décision

### 1. Construction de la requête e-MCF (contenu figé → `InvoiceRequestDataDto`)

Fonction **pure** `buildEdefInvoiceRequest(doc, refs)` dans
`apps/api/src/sales/normalization/request-builder.ts` : aucune lecture de base, aucune
arithmétique (tous les montants viennent du moteur, déjà figés ; seules les conversions
`decimalToJsonNumber` du moteur transforment une chaîne en nombre JSON). `refs` = libellés
de l'instantané `clientTypes` et `referenceTypes` de l'environnement (figés au même moment
que les taux ; absents → `409 REFERENCE_LISTS_UNAVAILABLE` avant tout envoi).

| Champ e-MCF | Source (document figé) | Règle |
|---|---|---|
| `nif` | `seller.nif` | doit égaler `dgi.nif` du point de vente, sinon refus avant envoi (`SELLER_NIF_MISMATCH`) |
| `rn` | `normalization.reservedNumber` | réservé dans la transaction qui ouvre l'envoi (§ 3) ; `TEST-AAAA-NNNNNN` en test (`TEST-IN{AA}{MM}-NNNNNN` / `TEST-AV…` depuis ADR-0027) |
| `mode` | `priceMode` | `ttc` ou `ht`, en minuscules |
| `isf` | `isf` (figé au gel) | `null` → refus avant envoi (`ISF_NOT_CONFIGURED`), alerte plateforme |
| `type` | `type` | `FV FT FA EV ET EA` |
| `items[i].code` | `lines[i].edefCode` | « HORS CHAMP » déjà calculé au gel pour un article hors champ ; `null` admis |
| `items[i].name` | `lines[i].name` | |
| `items[i].type` | `lines[i].itemType` | `BIE SER TAX` |
| `items[i].price` | `normalizedAmounts.lines[i].unitPrice` | **CDF**, nombre JSON |
| `items[i].quantity` | `lines[i].quantity` | nombre JSON, 3 décimales au plus |
| `items[i].taxGroup` | `lines[i].taxGroup` | A–P |
| `items[i].taxSpecificValue` · `taxSpecificAmount` | `normalizedAmounts.calculation.lines[i].specificTaxValue` · `specificTaxAmount` | omis si aucune taxe spécifique |
| `items[i].originalPrice` · `priceModification` | `normalizedAmounts.lines[i]` | omis si aucune remise |
| `client.type` · `typeDesc` | `customer.type` · libellé de l'instantané `clientTypes` | |
| `client.name` · `nif` | `customer.name` · `customer.nif` | omis si `null` |
| `client.contact` · `address` | `customer.phone`/`email` (joints par « ; ») · `customer.address` | **seulement si** `printContactDetails` (« données imprimées = données échangées ») |
| `operator.name` | `operator.name` | `operator.id` **non transmis** (aucun identifiant interne chez un tiers) |
| `payment[]` | `normalizedAmounts.payments` | `{ name: method, amount }` en **CDF** ; `curCode`/`curRate` de paiement **non transmis** tant que la DGI n'a pas répondu (ADR-0023, question n° 6) |
| `reference` · `referenceType` · `referenceDesc` | `creditNote.reference` · `creditNote.nature` · libellé `referenceTypes` | avoirs `FA`/`EA` seulement ; `reference` = code DEF/DGI de l'origine **tel que la DGI l'a renvoyé**, ou `RRR` |
| `cmta` … `cmth` | `comments.A` … `comments.H` | omis si `null` |
| `curCode` · `curRate` · `curDate` | `normalizedAmounts.counterValueUsd` | `USD`, taux (jusqu'à 8 décimales), date du taux **telle que reçue** ; omis sinon |

**Aucun montant en USD ne part à la DGI**, sauf la contre-valeur indicative (`curRate`). Le
corps est sérialisé une fois ; son empreinte `sha256` est figée dans
`normalization.requestSha256` et **le même corps** est renvoyé à chaque tentative. Un test
de correspondance (« golden ») couvre chaque type de facture, chaque nature d'avoir, un client
de chaque type, la taxe spécifique, la remise, la contre-valeur, les huit commentaires.

### 2. Client e-MCF : routes de facturation

`EdefClient` (fichier existant, ajouts) :

```ts
submitInvoice(body: EdefInvoiceRequest, ctx: EdefInvoiceCallContext): Promise<EdefOutcome<EdefInvoiceSubmitted>>;
confirmInvoice(uid: string, amounts: { total: number; vtotal: number }, ctx: EdefInvoiceCallContext): Promise<EdefOutcome<EdefSecurityElements>>;
cancelInvoice(uid: string, ctx: EdefInvoiceCallContext): Promise<EdefOutcome<EdefCancelled>>;
getPendingRequests(ctx: EdefCallContext): Promise<EdefOutcome<{ count: number; list: { uid: string; date: string }[] }>>;
getInvoiceDetails(uid: string, ctx: EdefCallContext): Promise<EdefOutcome<EdefInvoiceDetails>>;

interface EdefInvoiceCallContext extends EdefCallContext { invoiceId: string; rn: string }
interface EdefInvoiceSubmitted { uid: string; raw: Readonly<Record<string, unknown>> }   // raw → compareWithEdefResponse
interface EdefSecurityElements { codeDefDgi: string; nim: string; counters: string; dateTime: string; qrCode: string }
interface EdefInvoiceDetails { rn: string | null; nif: string | null; totals: Readonly<Record<string, unknown>> | null;
                               security: EdefSecurityElements | null }   // null si secElements absent ou vide
```

Règles, en plus de celles d'ADR-0021 § 6 :

- **Aucun réessai** dans le client, sur aucune route. `production_disabled` sans appel réseau,
  pour toutes les routes (production fermée tant que `DGI_PRODUCTION_ENABLED=false`).
- Validation Zod : un `200` avec `errorCode` non vide est `business` ; un `uid` absent ou vide
  sans `errorCode` est `invalid_response` ; un `confirm` « réussi » sans `codeDEFDGI` non vide
  est `invalid_response` (jamais une normalisation).
- La réponse brute de `POST` est conservée telle quelle (nombres JSON) pour
  `compareWithEdefResponse` : **jamais** d'arrondi ni de reconversion avant comparaison.
- Délai `DGI_HTTP_TIMEOUT_MS` (15 s par défaut, ≥ 10 s comme le recommande la DGI).

### 3. Le déroulé d'une normalisation (dans la requête de l'utilisateur)

`EdefSalesInvoiceNormalizer` (`apps/api/src/sales/normalization/edef-normalizer.ts`)
remplace `NoopSalesInvoiceNormalizer` dans `SalesModule`. Chaque étape est un
`findOneAndUpdate` **conditionné par la phase précédente** ; chaque phase « en vol » est écrite
**avant** l'appel réseau qu'elle annonce, de sorte qu'un arrêt brutal du processus laisse une
trace interprétable.

1. **Prise en main** (transaction T1) : document `pending_normalization`, phase `queued`, aucune
   prise en main vivante → phase `submitting`, `claim = { attemptId, until: maintenant + 90 s }`,
   `attempts + 1`, `lastAttemptAt` ; `InvoiceNumberingService.reserve(…, series, { session })`
   (série `test` en environnement de test) ; `reservedNumber` ; construction et empreinte du
   corps (§ 1) ; entrée de journal `number_reserved` (si nouveau). Bail tenu par une autre
   facture → la transaction est abandonnée, la phase reste `queued`, `lastError =
   NORMALIZATION_IN_PROGRESS`, issue `'deferred'`.
2. **Contrôles avant envoi** (sans appel réseau) : jeton du point de vente
   (`resolveActiveToken`) ; NIF ; ISF ; environnement du point de vente = environnement figé.
   Échec → phase `failed` (non réessayable sauf jeton), numéro rendu (`release`).
3. **Envoi** : entrée `edef_exchanges` « requête » écrite **strictement** (échec d'écriture →
   aucun envoi, retour en `queued`, numéro rendu) ; `POST /api/invoice`.
4. **Réponse du `POST`** :
   - `uid` + totaux → phase `comparing`, `uid`, `dgiTotals` (chaînes telles que reçues),
     `submittedAt` ;
   - erreur métier, `uid` nul → refus **certain** : phase `failed`, numéro rendu, code et libellé
     DGI conservés ; réessayable selon la catégorie (§ 5) ; **exception** : demande déjà en
     attente avec ce `rn` → phase `uncertain`, étape `submit` (une demande à nous traîne) ;
   - `401` → phase `failed` réessayable (« jeton refusé ») : la DGI n'a rien traité ;
   - délai, réseau, `5xx`, réponse illisible → phase `uncertain`, étape `submit`.
5. **Comparaison** : `compareWithEdefResponse(normalizedAmounts.calculation, taxRates.rates,
   raw)`, plus `curTotal` = `counterValueUsd.amount` quand une contre-valeur est transmise.
   - **Identique** → étape 6.
   - **Écart** → phase `cancelling`, `PUT …/cancel` ; puis phase `failed` (catégorie
     `totals_mismatch`, **non réessayable** : le contenu figé donnerait le même écart),
     `differences` conservées (champ, nous, DGI), numéro rendu, alerte plateforme
     `EDEF_TOTALS_MISMATCH` (journal serveur et audit). Annulation sans réponse → phase
     `uncertain`, étape `cancel`. **Jamais** de confirmation après un écart.
6. **Garde de délai** : si plus de **90 s** se sont écoulées depuis la réponse du `POST`
   (base lente, file d'attente), on n'envoie pas le `confirm` : annulation, phase `failed`
   réessayable. La fenêtre DGI est de 120 s ; on garde 30 s de marge.
7. **Confirmation** : phase `confirming`, `confirmStartedAt` ; entrée « requête » stricte ;
   `PUT …/confirm` avec **nos** `total` et `vtotal` (`normalizedAmounts.calculation`, jamais
   ceux de la DGI).
   - Éléments de sécurité reçus → **enregistrement** (§ 4.3) : issue `'normalized'`.
   - Refus pour écart de montant (TTC ou TVA) → annulation, phase `failed`
     (`totals_mismatch`).
   - Délai, réseau, `5xx`, erreur de traitement DGI, ou erreur ambiguë « inexistante ou déjà
     finalisée/annulée » → **vérification immédiate, une seule fois** :
     `GET /api/invoice/{uid}`. Éléments de sécurité présents → enregistrement. Demande encore
     **en attente** (dans `pendingRequestsList`) et garde de 90 s respectée → **un** second
     `confirm` sur le **même `uid`** (il ne peut pas créer une seconde facture : la vérification
     a montré qu'aucune ne l'est). Toute autre issue → phase `uncertain`, étape `confirm`.
   - `401` → la DGI n'a pas traité la confirmation : phase `uncertain`, étape `submit` (la
     demande expirera ; aucune normalisation possible sans `confirm` accepté).
8. **Fin de requête** : la route renvoie la vue du document (§ 9). Budget total des appels DGI
   dans une requête : au plus quatre appels de 15 s au pire, ~0,5 s en temps normal.

Une seconde requête concurrente (double clic, deux onglets) trouve une prise en main vivante :
elle ne fait rien et renvoie l'état courant. `normalizeNow` est donc **idempotent**.

### 4. États incertains et rattrapage

#### 4.1 Machine à états (`normalization.phase`)

```
                       ┌──────────── release ─────────────┐
 queued ──T1──▶ submitting ──uid──▶ comparing ──identique──▶ confirming ──éléments──▶ done
   ▲               │  │                 │                      │   │
   │      refus sûr│  │sans réponse     │écart                 │   │sans réponse / ambigu
   │               ▼  ▼                 ▼                      │   ▼
   │            failed  uncertain(submit)   cancelling ──▶ failed   uncertain(confirm)
   │              │         │             │ sans réponse            │
   │   retry      │         │             ▼                         │
   └──────────────┘         │        uncertain(cancel)              │
                            ▼             ▼                         ▼
                    rattrapage (§ 4.2) : failed (réessayable) · done · needs_review
```

| Phase | Statut ADR-0023 | Bail du numéro | Ce que la DGI peut contenir |
|---|---|---|---|
| `queued` | `pending_normalization` | aucun | rien de cette tentative |
| `submitting`, `comparing`, `cancelling`, `confirming` | `pending_normalization` | tenu (3 min) | une demande en attente |
| `uncertain` (`submit` · `cancel`) | `pending_normalization` | **prolongé** jusqu'au rattrapage | une demande en attente, qui expirera — **jamais** une facture normalisée (aucun `confirm` accepté) |
| `uncertain` (`confirm`) | `pending_normalization` | **prolongé** | **une facture normalisée, ou non** |
| `needs_review` | `pending_normalization` | **relâché**, numéro gardé | inconnu ; une personne doit trancher |
| `done` | `normalized` | numéro confirmé | une facture normalisée |
| `failed` | `normalization_failed` | numéro rendu (ou abandonné, § 4.4) | rien de valide |

Un arrêt du processus pendant une phase « en vol » se lit ainsi au rattrapage : `submitting`
→ `uncertain(submit)` ; `confirming` → `uncertain(confirm)` ; `cancelling` →
`uncertain(cancel)` ; `comparing` → `uncertain(submit)` (aucun `confirm` n'est parti).

Le bail du numéro (ADR-0023) est **prolongé** pendant l'incertitude
(`InvoiceNumberingService.holdLease`) : aucune autre facture de la série ne prend le numéro
suivant tant qu'on ne sait pas si celui-ci est normalisé. C'est ce qui garantit l'ordre et
l'absence de trou dans le cas courant. Coût : les autres normalisations de l'organisation
attendent (« Une autre facture est en cours de normalisation ») quelques minutes au plus.

#### 4.2 Rattrapage par l'ordonnanceur

Tâche récurrente `sales.normalization.reconcile`, **toutes les 30 s**, 10 documents au plus
par passage. Elle ne prend que les documents `uncertain` dont `reconcileAfter` est passé
(= dernier appel DGI + **150 s** : la demande en attente a alors **expiré**, l'état DGI est
stable) ou une phase « en vol » dont la prise en main a expiré. Elle prend la main par
`claim` (comme la requête utilisateur). Elle **lit** et peut **annuler** ; elle **n'envoie
jamais** de `POST` ni de `confirm`.

| Étape incertaine | Vérification | Conclusion **sûre** | Sinon |
|---|---|---|---|
| `submit` | `GET /api/invoice` ; pour chaque demande en attente : `GET /api/invoice/{uid}`, retenue si `rn`, `nif` **et** empreinte du contenu sont les nôtres | demande à nous encore en attente → `cancel` ; puis, aucun `confirm` n'ayant été accepté : **non normalisée** → `failed` réessayable, numéro rendu | DGI injoignable → reste `uncertain`, nouvel essai à +2 min |
| `cancel` | même chose avec l'`uid` connu | **non normalisée** (aucun `confirm` envoyé) → `failed` selon la cause d'origine | idem |
| `confirm` | `GET /api/invoice/{uid}` | éléments de sécurité présents, `rn` et `nif` identiques, `total`/`vtotal` = les nôtres → **enregistrement** (`done`) | voir ci-dessous |

Pour l'étape `confirm` sans éléments de sécurité dans la réponse, **la documentation ne
permet pas de conclure** : une facture finalisée peut ne pas être décrite par cette route.
Tant que le comportement réel n'est pas établi, la conclusion est **`needs_review`**. Le
réglage `EDEF_RECONCILIATION_EVIDENCE` (§ 7.4), renseigné par l'observation en environnement
de test **et** une réponse écrite de la DGI, pourra seul autoriser la conclusion « non
normalisée » automatique dans ce cas.

Plafond : `uncertain` depuis plus de **30 min** sans réponse DGI exploitable →
`needs_review`. Un document `needs_review` est revérifié automatiquement (lecture seule)
toutes les 15 min pendant 7 jours, puis chaque jour ; une vérification qui trouve les
éléments de sécurité le fait passer en `done` sans intervention.

**Idempotence.** Toute écriture est conditionnée par la phase et l'`attemptId` lus ; un
`cancel` rejoué est sans effet ; l'enregistrement d'une normalisation déjà enregistrée ne
change rien ; deux instances qui réclameraient le même document : une seule obtient la main.

**Jeton pour le rattrapage.** `resolveTokenForReconciliation(organizationId, posId)` (ajout à
`PointsOfSaleService`) rend le jeton d'un point de vente activé même `failing` ou
`token_expired` (la DGI répondra `401` si le jeton est mort ; on passe alors en
`needs_review` avec le message « renouvelez le jeton du point de vente »). **Un point de vente
qui porte une normalisation non soldée ne se désactive pas** (`409
POINT_OF_SALE_HAS_PENDING_NORMALIZATIONS`) : désactiver détruit le jeton, et sans jeton plus
aucune vérification n'est possible. La désactivation de la facture normalisée de
l'organisation (ADR-0021 R3) **n'arrête pas** le rattrapage.

#### 4.3 Enregistrement d'une normalisation — le verrou

Un **seul** écrivain du statut `normalized` : `NormalizationRecorder.recordNormalized`
(`apps/api/src/sales/normalization/normalization-recorder.ts`), appelé par la requête
utilisateur et par le rattrapage. Dans **une transaction** :

1. contrôle : `codeDefDgi`, `nim`, `counters`, `dateTime`, `qrCode` tous non vides ; sinon
   **erreur de programmation**, jamais de document `normalized` incomplet ;
2. `findOneAndUpdate({ _id, organizationId, status: 'pending_normalization', 'normalization.attemptId' })`
   → `status: 'normalized'`, phase `done`, éléments de sécurité **tels que reçus** (chaînes
   intactes : ils seront imprimés tels quels, S25g), `normalizedAt` ;
3. `InvoiceNumberingService.confirm(organizationId, invoiceId, issuedAt)`, `issuedAt` = date DGI
   (`dateTime`, heure de Kinshasa) si lisible, sinon l'heure du serveur ; le service la borne
   déjà par `lastIssuedAt` ;
4. entrée de journal `normalized` (code DEF/DGI, NIM, compteurs) ; audit
   `sales_invoice.normalized` ;
5. contrôle non bloquant : `nim` reçu ≠ `dgi.nim` du point de vente → alerte
   `EDEF_NIM_MISMATCH` (la facture **est** normalisée ; on l'enregistre et on alerte).

Si cette transaction échoue alors que la DGI a confirmé, le document reste en `confirming` ;
le rattrapage le relit et l'enregistre. **Aucun appel DGI n'est perdu**, il est seulement
enregistré plus tard.

**Verrou « pas de facture sans éléments DGI »**, en défense en profondeur :

- `documentKindOf` devient `invoice` **seulement** pour `issued` dans une organisation
  ordinaire, et pour `normalized` **avec** `codeDefDgi` et `qrCode` non vides. Un document
  `normalized` incomplet (impossible par construction) s'afficherait « Pro forma » et
  déclencherait une alerte.
- Test de lecture des sources : seul `normalization-recorder.ts` écrit `status:
  'normalized'` ; seul le gel ordinaire écrit `issued`.
- S25g n'a **qu'une** entrée pour l'intitulé d'un PDF : `documentKind`. Tant qu'il vaut
  `proforma`, le PDF porte « Pro forma — non valable comme facture » ; **aucune** route
  d'impression « facture » n'existe avant `normalized`.
- Tâche quotidienne `sales.normalization.consistency` : signale (journal serveur, audit) tout
  document `normalized` sans éléments, toute facture `issued` dont `issuedAt` suit
  `firstActivatedAt` de l'organisation (fenêtre résiduelle d'ADR-0023), tout numéro réservé
  depuis plus de 24 h.

#### 4.4 Ce qui demande une personne

`needs_review` signifie : **Lalanda ne sait pas** si la DGI a normalisé la facture. Rien
n'est renvoyé, rien n'est imprimé comme facture. L'interface explique quoi faire :

1. attendre la revérification automatique (souvent suffisante quand la DGI était
   injoignable) ;
2. sinon, le Propriétaire ou le Directeur financier vérifie auprès de la DGI (site de
   vérification de l'environnement, ou assistance DGI) ;
3. s'il est **établi** que la facture n'a pas été normalisée, il le **déclare** (`POST
   …/normalization/declare-not-normalized`, permission `fiscal.manage`, ré-authentification,
   motif de 20 à 500 caractères, audit **strict**) → phase `failed` réessayable.

**Une personne ne saisit jamais d'éléments de sécurité** : ils ne viennent que d'une lecture
DGI (« données imprimées = données échangées »). Si la facture a été normalisée, la
revérification automatique finit par le voir ; sinon, c'est un cas à traiter avec la DGI.

Pendant `needs_review`, le bail est **relâché** (les autres factures de l'organisation
reprennent) mais le numéro reste attaché au document. Si l'on déclare ensuite la facture non
normalisée alors que d'autres numéros ont été pris, ce numéro ne peut plus être rendu :
`InvoiceNumberingService.abandon` le marque abandonné, avec une entrée de journal
`number_abandoned` (motif) — le **seul** cas de trou dans la série, toujours tracé (décision
ouverte n° 2).

### 5. Erreurs DGI : traduction et conduite

`apps/api/src/edef/edef-errors.ts` associe chaque code d'erreur connu de l'annexe de la
documentation à une **catégorie**, un **message français rédigé par nous** (jamais une copie
du libellé DGI) et une conduite. L'utilisateur voit toujours **les deux** : notre phrase, et le
code et le libellé renvoyés par la DGI (exigence DGI).

| Catégorie | Codes (annexe DGI) | Effet | Réessayable |
|---|---|---|---|
| `data` — la facture est mal formée | 3, 4, 5, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 24, 25, 26, 27, 31, 33, 41, 42 | `failed` ; « Reprendre en brouillon » pour corriger ; un code de cette catégorie sur un document validé par nos contrôles est **aussi** une alerte plateforme (nos contrôles ont laissé passer quelque chose) | non |
| `configuration` | 32 (ISF vide) | `failed` ; alerte plateforme | non (avant correction de la plateforme) |
| `capacity` | 1 (trop de demandes en attente sur l'e-MCF) | `failed` ; « l'e-MCF est saturé, sans doute par un autre logiciel ; réessayez dans deux minutes » | oui |
| `temporary` | 10, 60 (contrôle d'avoir indisponible) | `failed` | oui |
| `server` | 61, 99 | au `POST` : `uncertain(submit)` ; au `confirm` : `uncertain(confirm)` | après rattrapage |
| `state` | 20 (inexistante ou déjà finalisée/annulée — ambigu) | jamais interprétée seule : vérification par `GET /api/invoice/{uid}` | — |
| `totals_mismatch` | 50, 51, et tout écart constaté par `compareWithEdefResponse` | annulation ; `failed` ; alerte plateforme | non |
| `duplicate_pending` | 63 | `uncertain(submit)` : le rattrapage annule notre demande en attente | après rattrapage |
| `unknown` | tout autre code | `failed` ; message générique + code et libellé DGI ; alerte | non |

HTTP : `401` → `token_rejected` (réessayable après renouvellement du jeton) ; délai, réseau,
`5xx` → incertain selon l'étape (§ 3). La catégorie et `retryable` sont exposés à l'interface
(§ 9) ; la décision de réessayer reste **humaine**.

### 6. Journal `edef_exchanges` (version 2), délais, débit

- **Champs ajoutés** : `exchangeId` (UUID), `entry` (`request` · `response` · `complete` — ce
  dernier pour les lectures, comme aujourd'hui), `invoiceId`, `rn`, `uid`, `_schemaVersion: 2`.
  Index ajouté `{ invoiceId: 1, at: 1 }` (partiel, `invoiceId` chaîne).
- Pour `POST`, `confirm`, `cancel` : entrée `request` écrite **avant** l'envoi, **strictement**
  (échec → pas d'envoi) ; entrée `response` après (en échec d'écriture : journal serveur
  bruyant, et les éléments utiles sont de toute façon dans `normalization`). Les lectures
  restent en une entrée `complete`, non bloquante.
- **Jamais d'en-tête, jamais de jeton** : le jeton n'entre que dans l'en-tête `Authorization`.
  Le corps de requête contient des données du client (nom, NIF) : c'est voulu (exigence DGI de
  conservation) ; il n'est exposé qu'aux membres de l'organisation qui ont `sales.read`
  (§ 9), jamais à `/admin`.
- Aucune purge (la DGI exige la conservation).

**Délais** (constantes nommées, surchargées en test par `DgiPlatformConfig`) :

| Constante | Valeur | Raison |
|---|---|---|
| `DGI_HTTP_TIMEOUT_MS` | 15 s (existant) | la DGI recommande d'attendre au moins 10 s |
| `CONFIRM_DEADLINE_MS` | 90 s après la réponse du `POST` | expiration DGI à 120 s, 30 s de marge |
| `DGI_PENDING_EXPIRY_MS` | 120 s | documentation DGI |
| `RECONCILE_DELAY_MS` | 150 s après le dernier appel | demande expirée, état stable |
| bail de numéro | 3 min (existant), prolongé à `reconcileAfter` + 3 min en incertitude | ordre de la série |
| plafond d'incertitude | 30 min → `needs_review` | ne pas bloquer l'organisation indéfiniment |

**Débit.** La DGI ne publie aucune limite. Côté Lalanda : une seule normalisation à la fois
par organisation et par série (bail), donc **au plus une** demande en attente de Lalanda par
e-MCF (loin des dix) ; un sémaphore de processus limite à **4** les appels DGI simultanés ;
nouveau quota `INVOICE_NORMALIZE_THROTTLE` (60 par heure et par utilisateur) sur `normalize`,
`retry` et `check` ; les tâches de l'ordonnanceur espacent leurs appels d'au moins 500 ms.
Précisé par l’amendement du 21 oct. 2026 (en fin de document) : plafond **par organisation** en plus, 429
en français.

### 7. Étalonnage des arrondis (outil d'exploitation, environnement de TEST seulement)

#### 7.1 Ce que c'est

Un **script** en ligne de commande, `apps/api/src/edef/calibration/calibrate.ts`
(`pnpm --filter @lalanda/api edef:calibrate`), **pas** une fonction pour les clients : aucune
route, aucun écran, aucun rôle plateforme ne le déclenche. Il rejoue sur l'environnement de
**test** de la DGI les cas de calibrage d'ADR-0022 (`INVOICE_TOTALS_REFERENCE_CASES` d'origine
`calibration` et `dgi_example`, plus le cas de contre-valeur), lit les totaux que la DGI
calcule, et dit quelle politique d'arrondi les reproduit.

#### 7.2 Garde-fous

- **Environnement de test codé en dur** : le script n'accepte que `DGI_EDEF_TEST_URL` et refuse
  de démarrer si cette URL est celle de production. Aucun paramètre ne permet la production.
- **Envoi puis annulation systématique** : chaque `POST` réussi est suivi **immédiatement** de
  `PUT …/cancel`, avant toute analyse. Le script **n'appelle jamais** `confirm` (test de
  lecture des sources). Une annulation sans réponse est signalée ; la demande expirera seule
  en deux minutes.
- **Jeton** : celui du point de vente de test de Go Freelance, **saisi au clavier** par la
  personne qui le détient, à une invite masquée ; jamais en argument, en variable
  d'environnement, en fichier ni dans un journal ; il n'est gardé qu'en mémoire (`Secret`) le
  temps de l'exécution. Le script vérifie d'abord `GET /api/info/status` (statut valide, NIF
  lu sur la réponse — rien n'est saisi à la main).
- **Numéros** : `rn` = `CAL-AAAAMMJJ-<cas>-<mode>` — hors de toute série de facturation ; ISF
  de test (`DGI_ISF_TEST`).
- **Débit** : un appel à la fois, 500 ms d'écart ; arrêt au premier `401` ou à la première
  erreur `1`.
- **Sortie** : un rapport JSON écrit **hors du dépôt** (par défaut dans `dgi/etalonnage/`,
  dossier ignoré par git) ; le script refuse un chemin suivi par git. Le rapport contient,
  par cas et par mode : notre calcul sous chacune des quatre politiques candidates, les totaux
  bruts de la DGI, les différences champ par champ, le code d'erreur éventuel. **Jamais** le
  jeton, le NIF ni le corps complet de la requête.

Qui le lance : le CTO (ou un développeur désigné), sur son poste, avec la décideuse qui saisit
elle-même le jeton de test. C'est une opération d'exploitation ponctuelle, rejouée à chaque
changement annoncé par la DGI.

#### 7.3 Choix et enregistrement de la politique

Règle de choix : la politique retenue est celle des quatre qui donne **zéro différence sur
tous les cas** envoyés (cas `calibration` et cas fiables). Une seule candidate → retenue. Aucune
ou plusieurs → pas de choix automatique : le CTO tranche par écrit et la question part à la
DGI. Un écart qui ne dépend pas des deux axes de la politique (taxe spécifique en pourcentage,
contenu de `haa`… avec taxe spécifique, groupe M, groupe N, arrondi de `curTotal`) est une
**correction du moteur**, avec sa propre nouvelle version du calcul — hors de l'outil.

Enregistrement, **dans le moteur**, versionné, sourcé, daté :

```ts
// packages/engine/src/invoice-totals/rounding-calibration.ts
export interface RoundingCalibrationRecord {
  status: 'not_calibrated' | 'calibrated';
  policyId: string;                    // doit égaler DGI_ROUNDING_POLICY.id
  calibratedAt: string | null;         // 'AAAA-MM-JJ'
  environment: 'test';
  source: string;                      // « Étalonnage e-DEF test, rapport sha256 … »
  reportSha256: string | null;         // empreinte du rapport local (hors dépôt)
  cases: readonly {
    caseId: string; priceMode: 'ttc' | 'ht';
    matchedPolicies: readonly string[];
    dgiTotals: Readonly<Record<string, string>>;   // champs comparés, tels que reçus
  }[];
}
export const ROUNDING_CALIBRATION: RoundingCalibrationRecord;
```

Livré à `status: 'not_calibrated'` (politique par défaut `dgi-cd-2026.1`). Après
l'étalonnage : le relevé est rempli à la main depuis le rapport ; si la politique retenue
diffère, `DGI_ROUNDING_POLICY` prend un nouvel identifiant (`dgi-cd-2026.2`) et
`INVOICE_TOTALS_VERSION` passe à `1.1.0` (ADR-0022). Test verrou : `ROUNDING_CALIBRATION.policyId
=== DGI_ROUNDING_POLICY.id`, et chaque cas du relevé se recalcule à l'identique de
`dgiTotals` sous cette politique. Les documents déjà figés gardent leur politique (ADR-0022).
docs/21 reçoit la date, la source et le résultat.

**Production** : tant que `status` vaut `not_calibrated`, l'ouverture de la production
(`DGI_PRODUCTION_ENABLED=true`) est **refusée au démarrage** (même mécanisme que l'absence
d'ISF de production, ADR-0021 § 5).

#### 7.4 Sondes de comportement (même outil, test seulement)

Sous-commande `probe`, distincte de l'étalonnage parce qu'elle **confirme** des factures de
**test** (sans valeur fiscale) pour observer ce que la documentation ne dit pas :
`GET /api/invoice/{uid}` après confirmation, après annulation, après expiration ; envoi d'un
même `rn` pendant l'attente, après annulation, après expiration ; présence de la demande dans
`GET /api/invoice` après expiration. Résultat consigné dans
`apps/api/src/sales/normalization/reconciliation-evidence.ts`
(`EDEF_RECONCILIATION_EVIDENCE`, daté, sourcé, environnement `test`). Tant qu'un fait n'est
pas observé **et** confirmé par écrit par la DGI, le rattrapage choisit l'interprétation
prudente (`needs_review`).

### 8. Rafraîchissement des listes de référence

Tâche récurrente `edef.reference.refresh`, **toutes les 6 heures** (et une fois peu après
00 h 15, heure de Kinshasa, pour le taux du jour) :

- pour chaque organisation dont la facture normalisée est activée, avec le jeton de **son**
  premier point de vente actif de l'environnement courant : `taxGroups` et `currencyRates` à
  chaque passage, les cinq listes de types une fois par jour ; `GET /api/info/status` une fois
  par jour (via `PointsOfSaleService.test` existant : la fin de validité du jeton reste à
  jour, et un jeton expiré bloque l'envoi avec un message clair au lieu d'un `401` en pleine
  normalisation) ;
- `EdefReferenceSnapshotsService.record` conserve le contenu **brut** (groupes Q, R, S
  compris, pour la preuve) ; un nouveau document seulement si le contenu change ;
- **filtrage A–P à l'usage**, inchangé (catalogue, gel, moteur) ; à chaque nouvel instantané
  `taxGroups` : un taux de A–P différent du précédent → alerte `EDEF_TAX_RATE_CHANGED` (audit
  et journal serveur) ; une lettre hors A–P → information `EDEF_UNDOCUMENTED_TAX_GROUPS`, une
  fois par empreinte ; le contrôle croisé avec le pack (`TAX_RATE_DIFFERS_FROM_PACK`) est
  rejoué ;
- échec (DGI injoignable, jeton refusé) : journalisé, nouvel essai au passage suivant ; jamais
  de blocage des autres organisations.

### 9. Contrat HTTP — ce que l'interface doit gérer

#### 9.1 Routes

| Méthode et chemin | Permission | Ré-auth | Quota | Réponse |
|---|---|:--:|---|---|
| `POST /sales/invoices/:invoiceId/normalize` (existante) | `sales.invoice` | | normalisation | 200 `InvoiceView` |
| `POST /sales/invoices/:invoiceId/normalization/retry` | `sales.invoice` | | normalisation | 200 `InvoiceView` |
| `POST /sales/invoices/:invoiceId/normalization/check` | `sales.invoice` | | normalisation | 200 `InvoiceView` |
| `POST /sales/invoices/:invoiceId/normalization/declare-not-normalized` | `fiscal.manage` | ✓ | écriture intégration | 200 `InvoiceView` |
| `GET /sales/invoices/:invoiceId/dgi-exchanges` | `sales.read` | | global | 200 `DgiExchangePage` |

- **Un refus de la DGI n'est pas une erreur HTTP** : une fois le gel réussi, `normalize` et
  `retry` répondent **200** avec l'état obtenu. Les erreurs HTTP restent celles du gel
  (ADR-0023 § S25e.14) et celles ci-dessous.
- `retry` : seulement depuis `failed` réessayable ou `queued`, sinon `409
  NORMALIZATION_NOT_RETRYABLE` (`details.phase`). Il refait l'étape 1 du § 3, **avec le même
  contenu figé**.
- `check` : lance tout de suite le rattrapage d'un document `uncertain` dont `nextCheckAt` est
  passé, ou `needs_review` ; sinon renvoie l'état sans appeler la DGI.
- `declare-not-normalized` `{ "reason": "20 à 500 caractères" }` : seulement depuis
  `needs_review`, sinon `409 NORMALIZATION_NOT_UNDER_REVIEW` ; `401 REAUTH_REQUIRED` sans
  fenêtre (même mécanique qu'ADR-0021).
- Erreurs nouvelles avant envoi, quand l'étape 2 du § 3 échoue, **rendues dans
  `lastError`** (pas en HTTP) : `POINT_OF_SALE_NOT_ACTIVE`, `SELLER_NIF_MISMATCH`,
  `ISF_NOT_CONFIGURED`, `REFERENCE_LISTS_UNAVAILABLE`, `DGI_PRODUCTION_UNAVAILABLE`.

#### 9.2 Vue `normalization` (ajouts à `NormalizationView`)

```jsonc
"normalization": {
  "phase": "uncertain",            // queued | in_progress | uncertain | needs_review | done | failed
                                   // (submitting, comparing, cancelling, confirming → in_progress)
  "attempts": 1,
  "reservedNumber": "TEST-2026-000012",   // JAMAIS affiché comme numéro de facture
  "dgiRequestId": "…",             // uid DGI, utile à l'assistance DGI ; null avant le POST
  "codeDefDgi": null, "nim": null, "counters": null, "dgiDateTime": null, "qrCode": null,
  "normalizedAt": null,
  "lastError": {                   // null si aucune
    "code": "EDEF_NO_RESPONSE",    // code Lalanda
    "category": "server",          // § 5, ou "network", "token_rejected", "precondition"
    "message": "La DGI n'a pas répondu à la confirmation…",   // français, à afficher
    "dgiErrorCode": null, "dgiMessage": null,                 // à afficher tels quels s'ils existent
    "retryable": false
  },
  "differences": null,             // écart de totaux : [{ "field": "vab", "ours": "64.00", "dgi": "64.01" }]
  "nextCheckAt": "2026-10-20T09:03:30.000Z",   // uncertain / needs_review
  "review": null,                  // needs_review : { "since": "…", "reason": "…" }
  "actions": { "retry": false, "check": false, "declareNotNormalized": false, "backToDraft": false }
}
```

`actions` est calculé par l'API selon la phase **et** les permissions de la personne :
l'interface n'en déduit rien d'autre.

#### 9.3 Ce que l'interface affiche

| `status` / `phase` | Titre de la fenêtre et du détail | Comportement |
|---|---|---|
| `normalized` / `done` | « Facture normalisée » | numéro définitif, code DEF/DGI, NIM, compteurs, date DGI ; **seul** cas d'en-tête « Facture » |
| `pending_normalization` / `in_progress` | « Transmission à la DGI… » | relecture `GET` toutes les 3 s pendant 1 min au plus |
| `pending_normalization` / `queued` | « En attente d'envoi » | `lastError` (ex. autre facture en cours) ; bouton « Relancer » si `actions.retry` |
| `pending_normalization` / `uncertain` | « Réponse de la DGI incertaine » | « Ne refaites pas cette vente : Lalanda vérifie auprès de la DGI vers HH:MM. » ; relecture toutes les 15 s jusqu'à `nextCheckAt` + 1 min, puis bouton « Vérifier maintenant » |
| `pending_normalization` / `needs_review` | « Vérification nécessaire » | marche à suivre du § 4.4 ; bouton « Déclarer non normalisée » si `actions.declareNotNormalized` (ré-authentification) |
| `normalization_failed` / `failed` | « Normalisation refusée » | notre message, **puis** code et libellé DGI tels quels ; `differences` en tableau pour un écart ; « Relancer » si `retryable`, sinon « Reprendre en brouillon » |

Dans tous les états sauf `done`, le document reste **« Pro forma — non valable comme
facture »** (ADR-0023). Si la requête `normalize` échoue côté navigateur (réseau, délai),
l'interface **ne la renvoie pas** : elle relit le document et affiche son état (la route est
idempotente). La requête peut durer jusqu'à ~60 s au pire : délai du client web ≥ 75 s, et le
mandataire HTTP (Caddy) ne doit pas couper avant 90 s (à vérifier en recette).

```jsonc
// GET /sales/invoices/:invoiceId/dgi-exchanges  →  DgiExchangePage (ordre chronologique)
{ "items": [ { "at": "…", "exchangeId": "…", "entry": "request", "method": "POST", "path": "/api/invoice",
               "httpStatus": null, "durationMs": null, "outcome": null, "dgiErrorCode": null,
               "body": "{…}" } ] }       // corps rédigés ; jamais d'en-tête
```

### 10. Interfaces internes ajoutées

```ts
// sales/invoices/normalization.port.ts — ajouts à InvoiceNormalizationState (jalon F0)
phase: 'queued' | 'submitting' | 'comparing' | 'cancelling' | 'confirming'
     | 'uncertain' | 'needs_review' | 'done' | 'failed';
uncertainStep: 'submit' | 'confirm' | 'cancel' | null;
attemptId: string | null;
claim: { attemptId: string; until: Date } | null;
requestSha256: string | null;
submittedAt: Date | null; confirmStartedAt: Date | null;
reconcileAfter: Date | null; uncertainSince: Date | null;
differences: readonly { field: string; ours: string | null; dgi: string | null }[] | null;
review: { since: Date; reason: string } | null;
lastError: { code: string; message: string; category?: string; dgiErrorCode?: string | null;
             dgiMessage?: string | null; retryable?: boolean } | null;    // élargi, compatible

// sales/invoices/invoice.contract.ts — JOURNAL_EVENTS : + 'normalization_uncertain',
//   'normalization_review_required', 'number_abandoned' ; codes 409 : + 'NORMALIZATION_NOT_RETRYABLE',
//   'NORMALIZATION_NOT_UNDER_REVIEW' ; NormalizationView et DgiExchangePage (§ 9).

// sales/invoices/invoice-numbering.service.ts — ajouts (F2)
holdLease(organizationId: string, invoiceId: string, until: Date, opts: { session: ClientSession }): Promise<void>;
dropLease(organizationId: string, invoiceId: string, opts: { session: ClientSession }): Promise<void>;  // garde le numéro
abandon(organizationId: string, invoiceId: string, reason: string, opts: { session: ClientSession }): Promise<void>;

// fiscal/points-of-sale.service.ts — ajouts (F2)
resolveTokenForReconciliation(organizationId: string, pointOfSaleId: string): Promise<{ token: Secret; environment: EdefEnvironment } | null>;
```

`InvoiceNormalizationState.phase` est initialisé à `queued` par le gel (une ligne dans
`freshNormalization`, F2). Les documents gelés avant ce lot (sans `phase`) se lisent `queued`.

### 11. Production fermée

`DGI_PRODUCTION_ENABLED=false` reste la valeur de toutes les configurations. Toute la
normalisation, l'étalonnage et les sondes se jouent en environnement de **test** ; une
organisation ne peut pas activer la production (ADR-0021 R1) ; le client refuse tout appel de
production sans réseau ; l'ouverture exigera, en plus de l'ISF de production, le relevé
d'étalonnage `calibrated` (§ 7.3) et l'homologation.

## Découpage en chantiers parallèles

Règle inchangée (ADR-0011) : **un fichier, un seul écrivain** ; toute exception passe par le
CTO.

### Jalon F0 — contrats (développeur F2, fusionné **avant** tout le reste)

- `sales/invoices/normalization.port.ts` et `invoice.contract.ts` : ajouts du § 10 et du § 9 ;
- `edef/edef-invoice.types.ts` (nouveau) : types et schémas Zod des requêtes et réponses de
  facturation (§ 2), signatures des cinq méthodes du client (corps `throw new Error('F1')`) ;
- `packages/engine/src/invoice-totals/rounding-calibration.ts` à `not_calibrated` et son export
  dans le barrel ;
- `platform-config/dgi-platform.config.ts` : délais du § 6 (surchargeables en test) ;
  refus de démarrer en production si l'étalonnage est `not_calibrated` ;
- `security/throttling.ts` : `INVOICE_NORMALIZE_THROTTLE` ;
- note « amendé par ADR-0024 » en tête d'ADR-0021 et d'ADR-0023.

### F1 — client e-MCF et faux serveur

| Possède | Ne touche pas |
|---|---|
| `apps/api/src/edef/**` : corps des cinq méthodes, `edef-exchange.schema.ts` (v2) et `edef-exchange.journal.ts` (`appendStrict`), `edef-errors.ts` (catégories, messages français), `testing/fake-edef-server.ts` enrichi (§ tests), tests | `apps/api/src/sales/**`, `fiscal/**`, `apps/web/**` |

### F2 — normalisation et rattrapage (API)

| Possède | Ne touche pas |
|---|---|
| nouveau `apps/api/src/sales/normalization/**` : `request-builder.ts`, `edef-normalizer.ts`, `normalization-recorder.ts`, `reconciliation.job.ts`, `reference-refresh.job.ts`, `consistency.job.ts`, `reconciliation-evidence.ts`, `normalization.controller.ts`, tests unitaires et e2e | `apps/api/src/edef/**` après F0, `packages/engine/**`, `apps/web/**` |
| **Ajouts purs** : fournisseur `SALES_INVOICE_NORMALIZER` dans `sales.module.ts` ; `freshNormalization` (phase) dans `invoice-freezing.service.ts` ; trois méthodes d'`invoice-numbering.service.ts` ; `documentKindOf` dans `invoice-view.ts` ; `resolveTokenForReconciliation` et la garde de désactivation dans `fiscal/points-of-sale.service.ts` ; un contrôleur dans `routes-coverage.test.ts` | le reste de `sales/invoices/**`, de `fiscal/**`, `authz/permissions.ts` |
| docs/15, docs/16, docs/17 (fin de lot) | |

### F3 — interface

| Possède | Ne touche pas |
|---|---|
| `apps/web/src/lib/api.ts` (types et méthodes du § 9) ; `ventes/factures/_components/normalize-dialog.tsx`, `invoice-detail.tsx`, nouveaux `normalization-status.tsx`, `dgi-exchanges.tsx`, `declare-not-normalized-dialog.tsx` ; `invoice-model.ts` (+ test) | `apps/api/**`, `packages/**` |
| docs/04 (section Ventes : normalisation et états) | |

### F4 — étalonnage et sondes

| Possède | Ne touche pas |
|---|---|
| `apps/api/src/edef/calibration/**` (`calibrate.ts`, `probe.ts`, construction minimale des requêtes de cas, rapport, tests contre le faux serveur) ; script `edef:calibrate` dans `apps/api/package.json` ; corps de `rounding-calibration.ts` **après** l'étalonnage réel ; docs/21 (section étalonnage) | `edef/edef.client.ts` (consommateur), `sales/**`, `compute.ts`, `reference-cases.ts` |

### Ordre

1. **F0** fusionné. 2. **F1, F2, F3, F4 en parallèle**, rebasés sur F0 ; F2 et F4 codent contre
les signatures du client et le faux serveur d'F1 (F2 rebase sur F1 avant fusion) ; F3 code
contre le contrat § 9 avec des réponses simulées. 3. Fusion **F1**, puis **F4** et **F2**, puis
**F3** (vérifié contre l'API réelle). 4. **Étalonnage réel** (F4, avec la décideuse) et sondes,
**avant** la campagne S25h ; relevé commité.

## Critères d'acceptation et tests

### Faux serveur e-MCF enrichi (F1)

Le faux serveur calcule ses totaux avec le moteur sous une **politique choisie par le test**
(il peut donc différer de la nôtre) et accepte, par jeton ou par `rn`, un scénario :
`ok` · `totals_offset` (un centime de plus sur un champ nommé) · `post_business_error:<code>` ·
`post_timeout_before_create` · `post_timeout_after_create` (crée la demande puis ne répond
pas) · `post_malformed` · `confirm_timeout_before_finalize` · `confirm_timeout_after_finalize`
· `confirm_error:<code>` · `cancel_timeout` · `pending_full` (erreur 1) · `duplicate_pending`
(erreur 63 avec l'`uid` existant) · `details_without_security` · `server_error`. Il gère
l'expiration des demandes (`pendingTtlMs`, court en test), la liste des demandes en attente,
le détail par `uid`, le refus d'un `rn` en attente, et enregistre chaque requête (méthode,
chemin, en-tête `Authorization`, corps).

### F1

- Chaque route : succès, chaque `EdefFailureKind`, `errorCode` dans un `200` → `business` ;
  `confirm` sans `codeDEFDGI` → `invalid_response` ; aucun réessai (une requête reçue par
  appel) ; production fermée → **aucune** requête reçue.
- Journal : `request` écrite avant l'envoi ; panne simulée de l'écriture → **aucune** requête
  reçue par le faux serveur ; `response` liée par `exchangeId` ; ni en-tête ni jeton dans
  aucune entrée (recherche de la chaîne du jeton).
- `edef-errors.ts` : chaque code de l'annexe a une catégorie et un message français ; code
  inconnu → `unknown`.

### F2

- **Correspondance** : golden test du § 1 pour chaque type, nature d'avoir, type de client,
  taxe spécifique, remise, contre-valeur, commentaires ; aucun montant USD hors `curRate` ;
  coordonnées du client absentes si `printContactDetails` est faux ; même corps et même
  empreinte à chaque tentative.
- **Nominal** contre le faux serveur : `normalize` → `normalized`, éléments de sécurité
  stockés tels que reçus, numéro définitif = numéro réservé, `issuedAt` = date DGI, journal
  `number_reserved` puis `normalized`, `documentKind = invoice` ; le `confirm` reçu porte
  **nos** `total`/`vtotal`.
- **Écart** (`totals_offset`) → `cancel` reçu, **aucun** `confirm` reçu, `failed`
  `totals_mismatch`, `differences` nommant le champ, numéro rendu, alerte journalisée ; idem
  pour une erreur 50/51 au `confirm`.
- **Refus métier** (une erreur de chaque catégorie) → `failed`, `retryable` conforme au § 5,
  code et libellé DGI dans `lastError`, numéro rendu et repris par la facture suivante.
- **Coupures** : `post_timeout_after_create` → `uncertain(submit)` ; le rattrapage (horloge
  avancée) retrouve la demande par `rn`, l'annule, conclut `failed` réessayable ; **aucun**
  second `POST` envoyé par le rattrapage. `confirm_timeout_after_finalize` → vérification
  immédiate → `normalized` dans la même requête. `confirm_timeout_before_finalize` +
  demande encore en attente → **un** second `confirm` sur le même `uid` → `normalized`.
  `confirm_timeout_*` + `details_without_security` → `uncertain(confirm)` puis, au
  rattrapage, `needs_review` (preuve `EDEF_RECONCILIATION_EVIDENCE` non établie).
  `cancel_timeout` → `uncertain(cancel)` → `failed`. Arrêt simulé du processus dans chaque
  phase « en vol » → interprétation du § 4.1.
- **Jamais de doublon** : dans tous les scénarios, le faux serveur reçoit au plus **un** `POST`
  par tentative et **zéro** `POST` venant de l'ordonnanceur ; aucune facture n'est confirmée
  deux fois.
- **Bail** : pendant `uncertain`, une autre facture de l'organisation obtient `queued` avec
  `NORMALIZATION_IN_PROGRESS` ; après conclusion, elle passe ; `needs_review` relâche le bail
  sans rendre le numéro ; `declare-not-normalized` après d'autres numéros → `number_abandoned`
  journalisé ; série sans autre trou sous 50 normalisations concurrentes avec coupures
  injectées.
- **Concurrence** : deux `normalize` simultanés → un seul `POST` ; deux instances du
  rattrapage → une seule prise en main ; enregistrement rejoué → sans effet.
- **Verrou** : test de lecture des sources (seul `normalization-recorder.ts` écrit
  `normalized`) ; `recordNormalized` refuse un élément vide ; `documentKind` = `proforma` pour
  tout état sauf `done` ; faux serveur arrêté → aucun document ne devient facture.
- **Garde de délai** : réponse du `POST` vieille de plus de 90 s → `cancel`, pas de `confirm`.
- **Rafraîchissement** : instantanés écrits seulement au changement ; Q, R, S conservés dans le
  brut, absents des taux figés ; taux de A–P changé → alerte ; DGI injoignable pour une
  organisation → les autres sont rafraîchies.
- **Point de vente** : désactivation avec une normalisation non soldée → 409 ;
  `resolveTokenForReconciliation` rend un jeton `token_expired`.
- **RBAC et isolation** : `retry`/`check` : Propriétaire, Directeur financier, Comptable 200 ;
  Administrateur, Analyste, Lecteur 403 ; `declare-not-normalized` : Propriétaire et Directeur
  financier seulement, ré-authentification exigée ; autre organisation → 404 partout ;
  `dgi-exchanges` sans jeton ni en-tête. `routes-coverage` vert.
- **Production fermée** : organisation forcée en production en base → `failed`
  `DGI_PRODUCTION_UNAVAILABLE`, aucune requête reçue.

### F3

- Chaque ligne du tableau § 9.3 rendue à partir d'une vue simulée ; titre « Facture » seulement
  pour `done` ; code et libellé DGI affichés tels quels ; aucun renvoi automatique de
  `normalize` après une erreur réseau (test du modèle) ; relectures bornées dans le temps ;
  boutons selon `actions` seulement ; « Mode test » partout où l'environnement est `test`.

### F4

- Contre le faux serveur : chaque `POST` réussi est suivi d'un `cancel` avant le cas suivant ;
  **aucun** `confirm` dans `calibrate` (test de lecture des sources) ; URL de production →
  refus de démarrer ; jeton absent du rapport, des journaux et de la sortie ; chemin de rapport
  suivi par git → refus ; politique retenue = la seule sans différence ; zéro ou plusieurs →
  « non décidé ».
- `rounding-calibration.ts` : test verrou du § 7.3.
- **Étalonnage réel** sur l'environnement de test DGI, avec la décideuse : rapport conservé
  dans `dgi/etalonnage/`, relevé commité, docs/21 à jour.

### Tous

`pnpm format`, lint, typecheck et tests verts à la racine ; tests existants inchangés (toute
modification justifiée dans la PR) ; `git diff --stat origin/main` sans suppression hors
périmètre ; aucun fichier de `dgi/`, aucun jeton, aucune donnée client réelle dans un commit.

## Conséquences

- Une organisation en facture normalisée obtient, en environnement de test, de vraies factures
  normalisées de test : la campagne S25h devient possible, S25g peut imprimer les éléments de
  sécurité.
- Une normalisation ne peut **jamais** produire deux factures normalisées pour un même
  document : aucun `POST` n'est rejoué sans vérification, l'ordonnanceur n'en envoie aucun.
- Le prix de cette prudence : quelques minutes d'attente pour l'organisation en cas de coupure,
  et, dans le cas rare où la DGI ne permet pas de conclure, une intervention humaine et
  possiblement un numéro abandonné, tracé.
- Le rattrapage automatique du cas « confirmation sans réponse » dépend d'une réponse de la DGI
  (question n° 1) ; sans elle, ce cas finit toujours chez une personne.
- `edef_exchanges` grossit d'environ six entrées par facture ; aucune purge (exigence DGI).
- La production ne peut s'ouvrir qu'avec un étalonnage enregistré.

## Plan de validation

Critères ci-dessus par chantier ; revue CTO avant chaque fusion (aucun `POST` ni `confirm` hors
de la requête utilisateur, écriture conditionnée par la phase partout, verrou, absence de jeton,
conformité au contrat § 9) ; étalonnage réel puis sondes en environnement de test ; essai de la
décideuse : normaliser en test une vente USD et un avoir, en TTC et en HT, vérifier chaque
facture sur le site de vérification de la DGI ; couper le réseau pendant une normalisation et
constater l'état « incertain » puis sa résolution.

## Décisions ouvertes — elles appartiennent à la décideuse

1. **Qui peut déclarer qu'une facture « incertaine » n'a pas été normalisée ?** Proposé : le
   Propriétaire et le Directeur financier (ceux qui gèrent la fiscalité), après vérification
   auprès de la DGI, avec un motif écrit. Faut-il l'ouvrir au Comptable ?
2. **Le numéro d'une facture restée incertaine.** Proposé : bloquer les autres normalisations
   de l'entreprise **au plus 30 minutes** pendant que Lalanda vérifie, puis les laisser
   reprendre ; si l'on établit ensuite que la facture incertaine n'a pas été normalisée, son
   numéro reste un **trou tracé** dans la série. L'autre choix — bloquer toute normalisation
   jusqu'à la décision d'une personne — garde la série parfaite mais peut arrêter la
   facturation de l'entreprise pendant des heures. Lequel préférez-vous ?
3. **Prévenir par e-mail ?** Proposé : un e-mail aux Propriétaires quand une facture passe en
   « vérification nécessaire », et quand un jeton e-MCF expire dans moins de 30 jours. D'accord ?
4. **Écart de calcul avec la DGI.** Proposé : la facture est annulée auprès de la DGI, la
   personne voit « Écart de calcul entre Lalanda et la DGI — l'équipe Lalanda est prévenue », et
   l'équipe est alertée. Faut-il aussi prévenir l'entreprise par e-mail ?
5. **Étalonnage.** Proposé : vous saisissez vous-même le jeton de test de Go Freelance au
   moment où le CTO lance l'outil ; une vingtaine de factures de test seront envoyées puis
   annulées aussitôt (aucune valeur fiscale), et quelques factures de test **confirmées** pour
   les sondes. D'accord pour utiliser votre compte de test ainsi ?
6. **Questions à envoyer à la DGI** (liste ci-dessous) : à adresser à l'assistance SFE avant la
   campagne S25h. Les envoyez-vous, ou voulez-vous un projet de courrier ?

Tranché par le CTO (technique) : envoi-comparaison-confirmation d'un seul tenant dans la
requête de l'utilisateur ; l'ordonnanceur ne fait que lire et annuler ; phases écrites avant
chaque appel ; bail du numéro prolongé pendant l'incertitude ; vérification avant tout second
`confirm`, sur le même `uid` seulement ; journal strict avant envoi ; aucune saisie humaine
d'éléments de sécurité ; politique d'arrondi enregistrée dans le moteur ; production
conditionnée à l'étalonnage ; jeton de chaque organisation pour ses seuls besoins.

## Amendement du 21 oct. 2026 — limite de débit de la normalisation

Tranche la proposition du § 6 (« Débit ») restée à mettre en œuvre : la route `POST
…/normalize` n'avait **aucun** quota propre (seuls `retry` et `check` en portaient un), et
aucune limite ne bornait une organisation entière.

**Décision.**

| Seau | Routes | Plafond | Clé |
|---|---|---|---|
| organisation | `POST …/normalize` **et** `POST …/normalization/retry`, compteur **commun** | 60 par heure | `org:<organizationId>` |
| utilisateur | `normalize`, `retry`, `check`, compteur par route | 60 par heure | `user:<userId>` |

- `check` ne lit que la DGI : il n'entame pas le plafond de l'organisation, seulement celui de
  la personne.
- Au-delà : **429** `NORMALIZATION_RATE_LIMITED` (ajouté à `INVOICE_ERROR_CODES`), message en
  français qui dit quel plafond est atteint et combien de minutes attendre (« Votre
  organisation a atteint la limite de 60 normalisations par heure auprès de la DGI.
  Réessayez dans 12 minutes. »), `details` : `scope` (`organization` · `user`), `limit`,
  `retryAfterSeconds` ; en-tête `Retry-After-normalization`. La fiche facture affiche ce
  message tel quel.
- Mise en œuvre : `apps/api/src/security/normalization-throttler.guard.ts`
  (`OrgNormalizationThrottlerGuard`, `UserNormalizationThrottlerGuard`), constantes
  `INVOICE_NORMALIZE_ORG_THROTTLE` et `INVOICE_NORMALIZE_THROTTLE` (`throttling.ts`).
- **Infrastructure réutilisée** : le `ThrottlerModule` de `@nestjs/throttler` déjà en place
  (S16a), stockage en mémoire du processus. Il n'existe **pas** de stockage Redis des quotas
  (le conteneur Redis de `docker-compose.yml` n'est utilisé par aucun code) ; l'API tourne en
  une seule instance, le plafond est donc exact. Si l'API se réplique, chaque instance aura
  son compteur : il faudra un stockage partagé (Redis ou MongoDB) — à décider à ce moment-là.
- Les guards portent leur limite **sans** `@Throttle` : ce décorateur est lu aussi par le
  guard global par IP, qui appliquait jusqu'ici 60 par heure **par adresse** à `retry` et
  `check` — un cabinet qui sert plusieurs organisations derrière un même NAT se serait
  bloqué lui-même. Le guard global garde sa règle (100 par minute et par IP).
- **Campagne d'homologation** (`apps/api/src/edef/homologation/**`, 58 normalisations
  espacées de 500 ms) : vérifié, elle appelle `InvoiceFreezingService.normalize`
  directement, sans HTTP ; elle n'est pas comptée. Le rattrapage de l'ordonnanceur non plus.

**Tests.** `security/normalization-throttler.test.ts` : 61ᵉ envoi d'une organisation → 429
(trois personnes différentes), seau commun `normalize`/`retry`, organisations isolées,
`check` hors seau d'organisation, plafond par personne, message et arrondi des minutes,
câblage des routes réelles (guards présents, aucun `@Throttle`).

## Questions à poser à la DGI (complètent ADR-0019, ADR-0022 et ADR-0023)

1. `GET /api/invoice/{uid}` répond-il pour une facture **finalisée**, **annulée**, **expirée** ?
   `secElements` y est-il renseigné après confirmation ? Sinon, comment établir qu'un `confirm`
   resté sans réponse a abouti ?
2. Après l'expiration d'une demande, figure-t-elle encore dans `GET /api/invoice` ?
3. Un `rn` annulé ou expiré peut-il être renvoyé pour la même facture ? Pour une autre ?
4. Les erreurs métier arrivent-elles toujours en HTTP 200 avec `errorCode` ? Existe-t-il une
   limite de débit (requêtes par seconde, par jeton) ?
5. Format et fuseau de `dateTime` dans la réponse de confirmation.
6. Arrondi exact de la TVA et du montant de ligne (déjà posée, ADR-0022) — l'étalonnage y
   répondra par l'observation, la réponse écrite la confirmera.

## Liens

- [ADR-0019](ADR-0019-facture-normalisee-dgi-rdc.md) — facture normalisée ;
  [ADR-0020](ADR-0020-ordonnanceur-mongodb.md) — ordonnanceur ;
  [ADR-0021](ADR-0021-modules-erp-et-identite-fiscale.md) — points de vente, client e-MCF,
  `edef_exchanges`, coffre (amendé) ;
  [ADR-0022](ADR-0022-clients-catalogue-et-calcul-des-factures.md) — moteur `invoice-totals`,
  cas de calibrage ;
  [ADR-0023](ADR-0023-factures-et-avoirs.md) — pro forma, « Normaliser », numérotation sous
  bail, port de normalisation (amendé).
- [docs/sources/dgi-rdc](../sources/dgi-rdc/README.md) — spécification e-DEF v2.0 publique ;
  règles détaillées : documentation du compte développeur DGI (hors dépôt).
- Code : `apps/api/src/edef/`, `apps/api/src/sales/invoices/`,
  `apps/api/src/fiscal/points-of-sale.service.ts`, `apps/api/src/scheduler/`,
  `packages/engine/src/invoice-totals/`.
