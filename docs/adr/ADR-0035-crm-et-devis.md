# ADR-0035 — CRM minimal et devis : un devis est un document distinct qui se convertit en facture

Statut : Proposed
Date : 2026-10-21
Décideurs : Gracy Omokoso (décisions produit) ; CTO Lalanda (contrat technique)

> **Complète [ADR-0018](ADR-0018-trajectoire-erp-trois-modules.md)** (modules RUN n° 1 « devis » et
> n° 3 « CRM minimal », décision du 18 oct. 2026). **S'appuie sans les modifier** sur
> [ADR-0022](ADR-0022-clients-catalogue-et-calcul-des-factures.md) (clients, catalogue, moteur
> `invoice-totals`), [ADR-0023](ADR-0023-factures-et-avoirs.md) (brouillon pro forma, circuit de la
> facture), [ADR-0024](ADR-0024-normalisation-dgi.md) (normalisation), [ADR-0025](ADR-0025-documents-pdf-factures.md)
> et [ADR-0028](ADR-0028-modeles-de-facture-et-identite.md) (PDF et modèles). **Amende
> [ADR-0012](ADR-0012-modele-rbac-complet.md) et docs/12** : deux actions nouvelles, `crm.read` et
> `crm.manage` (vingt-troisième et vingt-quatrième depuis l'intégration — voir l'amendement du 27 oct. 2026).

## Contexte

ADR-0018 retient trois modules RUN : (1) catalogue → **devis** → factures → encaissements ;
(2) dépenses et trésorerie réelle ; (3) **CRM minimal** branché sur les devis. Les clients, le
catalogue, les factures, les avoirs, la normalisation DGI et les PDF existent (ADR-0022 à 0028).
Le brief stratégique (§ 5.1, § 5.2) décrit le CRM attendu — prospects, contacts, opportunités,
pipeline personnalisable « Lead → Qualifié → Proposition → Négociation → Gagné/Perdu »,
activités, relances, import/export — et précise : **« ne pas inventer de pourcentages sans
données suffisantes »**.

Fait du dépôt qui commande la première décision : le **pro forma existe déjà**, comme état
`draft` d'un document de vente (`sales_invoices`, ADR-0023 § S25e.1) : référence `PF{AA}{MM}-…`,
intitulé « Pro forma — non valable comme facture », calcul par le moteur à chaque
enregistrement, puis « Émettre » ou « Normaliser ».

## Options considérées

### O1 — Qu'est-ce qu'un devis ?

1. **Le devis est le pro forma** (un `sales_invoices` en `draft`, avec quelques champs de
   plus). Écarté :
   - un devis a **son propre cycle** — envoyé, accepté, refusé, expiré, nouvelle version — que
     le brouillon de facture n'a pas et ne doit pas avoir : ADR-0023 donne à chaque champ de
     suivi d'un document de vente **un seul écrivain** et prouve l'immuabilité par
     `contentSha256` ; y greffer des états commerciaux mêlerait les deux circuits ;
   - un devis **refusé ou expiré reste** (historique commercial), alors qu'un brouillon de
     facture abandonné se supprime ;
   - plusieurs **versions** d'un devis coexistent ; une facture n'a qu'un contenu ;
   - la collection `sales_invoices` porte le journal électronique, la numérotation fiscale et
     la normalisation : chaque document de plus y est un risque sur l'homologation.
2. **Le devis est un document distinct (`sales_quotes`) qui se CONVERTIT en brouillon de
   facture.** **Retenu.** La facture créée suit ensuite **son propre circuit**, inchangé :
   pro forma, puis « Émettre » (organisation ordinaire) ou « Normaliser » (facture normalisée
   DGI). Le devis n'écrit jamais dans `sales_invoices` autrement que par le service des
   brouillons existant (`InvoiceDraftsService.create`).

Conséquence assumée : deux documents « non valables comme facture » coexistent, avec des
intitulés distincts — **« DEVIS — non valable comme facture »** (engagement commercial
proposé) et **« PRO FORMA — non valable comme facture »** (facture en préparation).

### O2 — Calcul des montants d'un devis

1. Calcul propre au devis. Écarté (CLAUDE.md : le moteur est l'unique source des calculs).
2. **Composition et calcul par le code des brouillons de facture** (`InvoiceDraftsService.compose`
   → `computeInvoiceTotals`, mêmes groupes de taxation, même conversion TTC ↔ HT, mêmes
   remises, mêmes taux de l'instantané DGI). **Retenu.** Un devis et la facture qui en naît
   donnent le même total pour les mêmes lignes et les mêmes taux. **Aucun calcul nouveau**
   pour les montants des documents.

### O3 — Prix à la conversion

1. Reprendre le prix courant du catalogue. Écarté : un devis accepté engage sur ses prix.
2. **Reprendre le prix du devis** : chaque ligne de catalogue est convertie avec son prix
   unitaire **fixé** (`unitPrice` explicite = prix avant remise du devis) et la même remise ;
   une ligne libre est recopiée. **Retenu.** Le lien `catalogItemId` est conservé (la facture
   marque l'article comme facturé, ADR-0022). Si le groupe de taxation de l'article ou les
   taux DGI ont changé depuis, le total de la facture peut différer : la réponse de conversion
   le **signale** (`amountsDiffer`) au lieu de le masquer — la facture fait foi, avec les taux
   en vigueur.

### O4 — CRM : où vivent prospects et contacts ?

1. Un prospect est un client (`customers`). Écarté : la fiche client porte des exigences DGI
   (NIF obligatoire pour PM, PC, PL) qu'un prospect ne remplit pas encore, et le fichier
   clients sert à facturer.
2. **Collections CRM propres, rattachées aux clients existants.** **Retenu.** Un **contact**
   (`crm_contacts`) est une personne ; rattaché à un client (`customerId`), c'est un contact
   client ; sans client, c'est un **prospect**, qui porte le nom de son entreprise
   (`companyName`). Une **opportunité** (`crm_opportunities`) vise un client existant **ou** un
   prospect nommé ; quand le prospect devient client, on rattache l'opportunité et ses contacts
   à la fiche créée dans Ventes.

### O5 — Probabilité de conversion

1. Pourcentage par étape fixé à l'avance (10 %, 25 %…). Écarté : un pourcentage inventé.
2. Score d'IA. Écarté : l'IA explique, elle ne produit pas les chiffres (CLAUDE.md).
3. **Taux historique de l'organisation, calculé par le moteur, seulement au-delà d'un
   échantillon minimal ; sinon « indisponible ».** **Retenu.** Pour une étape S, l'échantillon
   est l'ensemble des opportunités **clôturées** (gagnées ou perdues) passées par S ; le taux
   est la part gagnée, arrondie à l'entier. En dessous de **10** opportunités clôturées passées
   par S, la probabilité est `unavailable` avec la taille de l'échantillon (décision ouverte
   n° 3).

## Décision

### 1. Devis — collection `sales_quotes` (module `apps/api/src/sales/quotes/`)

| Champ | Règle |
|---|---|
| `organizationId` | requis ; toute requête le porte |
| `number` | `DV{AA}{MM}-NNNNNN`, attribué à la création (compteur `sales_quote_counters`, annuel, à Kinshasa, trous admis — un devis brouillon supprimé laisse un trou) ; **hors série fiscale** |
| `version` | 1 à la création ; +1 à chaque « nouvelle version » |
| `status` | `draft` · `sent` · `accepted` · `refused` (stocké) ; **`expired` est dérivé** à la lecture : `sent` dont `validUntil` est passé (jour civil de Kinshasa) |
| `opportunityId` | `null` ou une opportunité de l'organisation |
| `title` | objet du devis, ≤ 200 |
| `notes` | conditions, ≤ 1 000 (imprimées) |
| `validUntil` | `AAAA-MM-JJ` ; par défaut, 30 jours après la création (décision ouverte n° 4) |
| `currency`, `priceMode`, `customer`, `lines`, `documentAmounts` | **mêmes formes et mêmes règles** que le brouillon de facture (ADR-0023 § S25e.2), composées par `InvoiceDraftsService.compose` ; lignes `catalog` et `free` seulement |
| `sentAt`, `acceptedAt`, `refusedAt`, `refusalReason` | suivi |
| `conversion` | `{ invoiceId, convertedAt, convertedBy }` \| `null` |
| `previousVersions` | instantanés figés des versions précédentes (contenu, montants, statut, dates) |
| `revision`, `createdBy`, `updatedBy`, horodatage, `_schemaVersion: 1` | |

**Cycle de vie**

```
draft ──« Marquer envoyé »──▶ sent ──« Accepté »──▶ accepted ──« Convertir »──▶ brouillon de facture
  ▲                            │  └──« Refusé »────▶ refused                     (circuit ADR-0023)
  │                            └── (validUntil passé) = expired
  └────────── « Nouvelle version » (depuis sent, refused, expired) : version + 1
```

- Le contenu n'est modifiable qu'en `draft`. « Marquer envoyé » exige un calcul sans problème
  (taux DGI disponibles) et une validité non échue ; Lalanda n'envoie pas d'e-mail (le PDF
  est remis par l'utilisateur). **Amendé par [ADR-0042](ADR-0042-envoi-des-documents-par-email.md)** :
  un devis envoyé ou accepté peut être envoyé au client par e-mail, PDF joint, d'un geste explicite.
- « Accepté » exige `sent` non expiré. **Règle de gain** : si le devis est rattaché à une
  opportunité ouverte et que le réglage `autoWinOnQuoteAccepted` de l'organisation est actif
  (défaut : oui), l'opportunité passe à l'étape « gagnée » (historique : `source: 'quote'`).
  Désactivable dans les réglages du CRM.
- « Convertir » : `accepted` seulement ; crée un **brouillon de facture** `FV` pré-rempli
  (client, devise, mode de prix, lignes à prix fixés, objet du devis en commentaire C). Une
  seule conversion vivante : reconvertir n'est possible que si le brouillon créé a été supprimé.
  La facture ne connaît pas le devis ; le devis garde `conversion.invoiceId`.
- Suppression : brouillon de version 1 jamais envoyé seulement ; sinon on refuse le devis.
- Concurrence : `expectedRevision` sur chaque écriture (409 `STALE_REVISION`).

**PDF** : `GET /sales/quotes/:id/pdf` rend le devis avec le **modèle de facture choisi par
l'organisation** (ADR-0028), par le même moteur de rendu et la même vérification des mentions.
Le contenu imprimé est construit par `quote-document.model.ts` : intitulé **« DEVIS — non
valable comme facture »**, numéro et version, date d'établissement, **validité**, vendeur
(fiche fiscale courante), client, lignes et totaux du moteur, total en lettres (« Arrêté le
présent devis… »), conditions. **Aucune mention DGI de facture** : ni éléments de sécurité, ni
QR code, ni numéro de facture, ni bandeau de test, ni paiement. Export journalisé (audit
strict, comme le PDF de facture).

### 2. CRM minimal (module `apps/api/src/crm/`)

**Réglages (`crm_settings`, un document par organisation, défaut implicite)**

- `stages` : 3 à 12 étapes ordonnées `{ key, label, kind }`, `kind` ∈ `open | won | lost` ;
  **exactement une** `won` et une `lost`, au moins une `open`. Défaut : `lead` « Lead »,
  `qualified` « Qualifié », `proposal` « Proposition », `negotiation` « Négociation »,
  `won` « Gagné », `lost` « Perdu ». Renommer, ajouter, réordonner : libre. Retirer une étape
  utilisée par une opportunité, ou changer la nature d'une étape existante : 409
  `CRM_STAGE_IN_USE` / `CRM_STAGE_KIND_CHANGED`.
- `autoWinOnQuoteAccepted` (défaut `true`) ; `staleAfterDays` (défaut 14, 1 à 365).

**Contacts (`crm_contacts`)** : `name` (requis), `jobTitle`, `email`, `phone`, `customerId`
(client de l'organisation) **ou** `companyName` (prospect), `notes`, `active`. Vue : `kind` =
`customer_contact` | `prospect`, nom du client.

**Opportunités (`crm_opportunities`)** : `title`, `customerId` **ou** `prospectName`,
`contactId`, `stageKey`, `status` (dénormalisé de la nature de l'étape), `amount` (estimé,
chaîne décimale à 2 décimales, facultatif) et `currency` (`CDF` | `USD`), `expectedCloseDate`,
`lostReason`, `closedAt`, `lastActivityAt`, `stageHistory` (`{ stageKey, at, by, source }`).
Déplacer (`POST …/move`) écrit l'historique ; passer en perdu accepte un motif.

**Activités (`crm_activities`)** : `kind` ∈ `call | meeting | note | follow_up` (appel,
réunion, note, relance), `subject`, `notes`, `dueAt` (facultatif), rattachées à une opportunité,
un contact et/ou un client ; `done`, `doneAt`. **En retard** : non faite et `dueAt` passé.
Créer ou terminer une activité rattachée à une opportunité met à jour `lastActivityAt`.

**Indicateurs déterministes** (`GET /crm/pipeline`) :

- tableau par étape (Kanban) : opportunités ouvertes et clôturées des 90 derniers jours ;
  **totaux estimés par devise** (somme par le moteur, `sumAmountsByCurrency`, jamais de
  conversion entre devises) ;
- **opportunités inactives** : ouvertes, sans activité depuis `staleAfterDays` jours ;
- **relances en retard** et **prochaines actions** (activités non faites, par échéance) ;
- **probabilité par étape** : `stageWinRates` (moteur) — `available` avec le taux et
  l'échantillon, ou `unavailable` avec l'échantillon et le minimum requis (O5).

Moteur : nouveau module pur `packages/engine/src/crm/` (`CRM_INDICATORS_VERSION = '1.0.0'`,
`sumAmountsByCurrency`, `stageWinRates`), entiers `bigint` comme `invoice-totals`. Il ne touche
ni `ENGINE_VERSION` ni `INVOICE_TOTALS_VERSION`.

**Import / export CSV** : contacts et opportunités. Séparateur `;` (Excel francophone), `,`
accepté à l'import, UTF-8 avec BOM à l'export, cellules commençant par `= + - @` neutralisées
(injection de formule). Import **tout ou rien** : toutes les lignes sont validées, la
moindre erreur renvoie `400` avec le numéro de ligne et rien n'est créé ; 500 lignes et 100 Ko au plus (essai à blanc possible : `dryRun`).
Rattachement par NIF du client et e-mail du contact. Les exports sont journalisés (audit
strict : données personnelles).

### 3. Permissions (amende ADR-0012 et docs/12)

Devis : **`sales.read`** (lire, PDF) et **`sales.manage`** (créer, modifier, envoyer,
accepter, refuser, nouvelle version, convertir en brouillon de facture). Un devis n'engage pas
le contribuable devant la DGI ; l'émission de la facture reste en `sales.invoice`.

CRM : deux actions nouvelles, en fin de `ACTIONS` :

| Action | PRO | ADM | DIR | CPT | ANA | CDP | CON | LEC |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| `crm.read` — « Consulter le CRM » | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ |
| `crm.manage` — « Gérer le CRM » | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |

Même répartition que `sales.read` / `sales.manage` : le CRM contient des données personnelles
(le Conseiller, externe, n'y accède pas) et alimente les devis. Réglages du pipeline, import et
export : `crm.manage`. Plateforme : `crm.read` sous accès délégué (super-administrateur,
support), `crm.manage` sous accès délégué (super-administrateur) ; aucune n'est un interdit
absolu. La matrice R7 (attribution des rôles) est inchangée : chaque rôle gagne les deux
actions dans la même proportion que `sales.*`.

### 4. Contrat HTTP

| Méthode et chemin | Permission |
|---|---|
| `GET /sales/quotes` · `GET /sales/quotes/:id` · `GET /sales/quotes/:id/pdf` | `sales.read` |
| `POST /sales/quotes` · `PUT /sales/quotes/:id` · `DELETE /sales/quotes/:id` | `sales.manage` |
| `POST /sales/quotes/:id/send` · `…/accept` · `…/refuse` · `…/new-version` · `…/convert` | `sales.manage` |
| `GET /crm/settings` · `GET /crm/pipeline` | `crm.read` |
| `PUT /crm/settings` | `crm.manage` |
| `GET /crm/contacts` · `GET /crm/contacts/:id` | `crm.read` |
| `POST /crm/contacts` · `PUT /crm/contacts/:id` · `DELETE /crm/contacts/:id` | `crm.manage` |
| `GET /crm/opportunities` · `GET /crm/opportunities/:id` | `crm.read` |
| `POST /crm/opportunities` · `PUT /crm/opportunities/:id` · `POST /crm/opportunities/:id/move` · `DELETE /crm/opportunities/:id` | `crm.manage` |
| `GET /crm/activities` | `crm.read` |
| `POST /crm/activities` · `PUT /crm/activities/:id` · `POST /crm/activities/:id/complete` · `DELETE /crm/activities/:id` | `crm.manage` |
| `GET /crm/contacts/export` · `GET /crm/opportunities/export` · `POST /crm/contacts/import` · `POST /crm/opportunities/import` | `crm.manage` |

Ressource d'une autre organisation : **404**. Corps `.strict()`, montants en chaînes, erreurs au
format des contrôleurs de ventes. Listes paginées par curseur.

### 5. Interface (espace Ventes)

Deux onglets de plus dans `/ventes` : **Devis** (`sales.read`) et **CRM** (`crm.read`). CRM :
vue **Kanban** (colonnes = étapes, déplacement par menu, accessible au clavier) et vue
**liste**, fiche d'opportunité (activités, devis liés, « Créer un devis »), contacts et
prospects, réglages du pipeline, import et export CSV, encadrés « relances en retard »,
« inactives » et « prochaines actions ». Devis : liste, éditeur (lignes du catalogue, calcul
du moteur affiché), actions selon le statut, PDF, conversion qui ouvre la facture créée.

## Conséquences

- Six collections nouvelles : `sales_quotes`, `sales_quote_counters`, `crm_settings`,
  `crm_contacts`, `crm_opportunities`, `crm_activities` ; toutes portent `organizationId`.
- `InvoiceDraftsService` et `InvoiceDocumentsService` deviennent exportés par `SalesModule`
  (aucun changement de comportement). Le circuit de normalisation n'est pas touché.
- Le CRM ne produit aucun réalisé ni aucune prévision : montants **estimés**, étiquetés comme
  tels ; rien n'alimente `actual_periods` ni un plan.
- Pas d'envoi d'e-mail, pas de signature électronique, pas de commandes ni de contrats
  (brief § 5.2) : hors périmètre.

## Plan de validation

- Moteur : `sumAmountsByCurrency`, `stageWinRates` (seuil, arrondi, étapes jamais visitées).
- e2e : pipeline (étapes personnalisées, déplacement, historique, inactives, relances en
  retard, probabilité indisponible puis disponible), contacts et import/export CSV,
  devis (calcul identique au brouillon de facture, versions, expiration, PDF), **conversion
  devis → facture puis normalisation via le faux serveur e-MCF**, gain automatique et sa
  désactivation, isolation entre organisations, RBAC par rôle.
- Couverture des routes et matrice des permissions à jour ; tests web des modèles d'écran.

## Décisions ouvertes — elles appartiennent à la dirigeante

1. **Répartition des droits CRM** : calquée sur `sales.*` (le Comptable gère le CRM,
   l'Analyste et le Lecteur le consultent). Un rôle « commercial » distinct serait un autre
   ADR.
2. **Gain automatique** à l'acceptation d'un devis : activé par défaut, désactivable par
   organisation. À confirmer.
3. **Seuil de la probabilité** : 10 opportunités clôturées passées par l'étape. Plus haut =
   plus fiable mais plus tardif.
4. **Validité par défaut d'un devis** : 30 jours, modifiable à chaque devis. Aucune règle légale
   RDC connue ne l'impose ; c'est une valeur de confort.
5. **Numérotation `DV{AA}{MM}-NNNNNN`**, alignée sur ADR-0027, compteur annuel avec trous admis
   (un devis n'est pas une pièce fiscale).

## Amendement du 27 oct. 2026 — intégration avec ADR-0031 et ADR-0034

L'ADR a été rédigé sur une base où `sales.invoice` était la dix-neuvième et dernière action.
Entre-temps, `main` a reçu `sales.receipt` (ADR-0031, vingtième) puis `treasury.read` et
`treasury.manage` (ADR-0034, vingt et unième et vingt-deuxième). La règle « en fin de liste,
ordre de fusion » s'applique : **`crm.read` et `crm.manage` deviennent la vingt-troisième et
la vingt-quatrième action** (24 au total). Leur répartition par rôle et côté plateforme est
inchangée ; matrice, tests (8 × 24 + 6 × 24 = 336 cases), couverture des routes, sonde RBAC
de bout en bout, docs/12 et type web `OrgAction` sont alignés.

Vérifications de l'intégration, sans changer le cycle du devis :

- **Numérotation** : la conversion crée un brouillon `FV` sans numéro ; le numéro fiscal
  `IN{AA}{MM}-NNNNNN` (ADR-0027) n'est attribué qu'à l'émission ou à la normalisation, par le
  circuit des factures. Le test de bout en bout normalise la facture convertie et vérifie ce
  format.
- **Vendeur non assujetti** : le devis applique désormais, tant qu'il est en brouillon, le
  contrôle du moteur `checkSellerVatStatus` contre la fiche fiscale courante (comme l'éditeur
  de facture) : une ligne d'un groupe réservé aux assujettis devient un bloquant
  (`TAX_GROUP_REQUIRES_VAT_REGISTRATION`) et le devis ne peut pas être marqué envoyé. Sans cela,
  un devis accepté aurait produit une facture inémettable.
- **Encaissements** : la facture issue d'un devis est une facture ordinaire ; émise à crédit,
  elle se règle par un encaissement (`sales.receipt`) et son statut de règlement passe à
  « payée » (vérifié de bout en bout).
- **Navigation RUN** : Factures, Devis, Encaissements, Clients, Catalogue, CRM, Trésorerie —
  le commerçant chiffre, facture puis encaisse ; le CRM suit les données maîtres qu'il prolonge.

## Liens

- [ADR-0012](ADR-0012-modele-rbac-complet.md) — RBAC ; [ADR-0018](ADR-0018-trajectoire-erp-trois-modules.md) — trajectoire RUN.
- [ADR-0022](ADR-0022-clients-catalogue-et-calcul-des-factures.md), [ADR-0023](ADR-0023-factures-et-avoirs.md), [ADR-0024](ADR-0024-normalisation-dgi.md), [ADR-0025](ADR-0025-documents-pdf-factures.md), [ADR-0027](ADR-0027-numerotation-des-factures.md), [ADR-0028](ADR-0028-modeles-de-facture-et-identite.md).
- Brief stratégique ERP (hors dépôt), § 5.1 et § 5.2.
