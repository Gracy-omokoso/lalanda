# ADR-0022 — Clients, catalogue et calcul conforme des factures (lots S25c et S25d)

Statut : Proposed
Date : 2026-10-19
Décideurs : Gracy Omokoso (décisions produit) ; CTO Lalanda (contrat technique)

## Contexte

### Où l'on en est

La priorité est l'**homologation DGI** du logiciel : 32 cas de test officiels (29 factures,
3 rapports), à produire chacun en mode de prix TTC **et** HT dans l'environnement de test
e-DEF. Plan des lots RUN : **S25c** clients et catalogue · **S25d** calcul conforme ·
S25e factures et avoirs · S25f connexion DGI (envoi, comparaison, confirmation) · S25g
documents PDF et QR code · S25h campagne d'homologation.

S25b (ADR-0021, fusionné) a livré l'identité fiscale, la facture normalisée par
organisation, les points de vente e-MCF avec jeton chiffré, le client e-MCF minimal
(`apps/api/src/edef/`), les instantanés datés des listes de référence
(`edef_reference_snapshots`) et l'action RBAC `fiscal.manage`.

Cet ADR spécifie **deux lots développés en parallèle** :

- **S25c — Clients et catalogue** (API et interface) : les données maîtres sans lesquelles
  aucune facture n'est possible ;
- **S25d — Calcul conforme** : un module **pur** du moteur (`packages/engine`) qui calcule
  les totaux d'une facture exactement comme la DGI les recalcule.

Les deux ne dépendent pas l'un de l'autre à l'exécution : le catalogue ne calcule rien, le
moteur ne lit aucune base. Ils se rejoignent au lot S25e (facture).

### Règles DGI qui s'appliquent (résumé)

Source : **documentation du compte développeur DGI** (non publique, hors dépôt ; synthèses
locales `dgi/`), et spécification publique e-DEF v2.0
(`docs/sources/dgi-rdc/edef-api-v2.0-2026-10-18.json`, ci-après « la spécification »).
Seuls les faits nécessaires au contrat sont repris, en substance.

**Clients.** Cinq types (`ClientTypeEnum` de la spécification : `PP PM PC PL AO`). Le type
est obligatoire dans le logiciel. Champs exigés par la DGI selon le type :

| Type | Sens | Exigé par la DGI |
|---|---|---|
| `PP` | Personne physique | rien |
| `PM` | Personne morale | dénomination, NIF |
| `PC` | Personne physique commerçante | nom, NIF |
| `PL` | Profession libérale | nom, NIF |
| `AO` | Ambassade, organisation internationale | nom, référence du document d'exonération (imprimée en ligne de commentaire A) |

`ClientDto` de la spécification : `nif`, `type`, `typeDesc`, `name`, `contact`, `address`
(chaînes simples).

**Articles.** Un article porte un code, un type, une désignation, un prix unitaire (HT ou
TTC), une unité de mesure, un groupe de taxation et, le cas échéant, une taxe spécifique.
`ItemDto` de la spécification : `code`, `name`, `type` (`BIE SER TAX`), `price`,
`quantity`, `taxGroup` (`A`…`Z`), `taxSpecificValue` (chaîne : montant par unité ou
`{valeur}%`), `taxSpecificAmount` (montant pour toute la quantité), `originalPrice`,
`priceModification`.

- **Seize groupes de taxation, A à P**, en vigueur depuis février 2026. Les lettres Q à Z
  existent dans la spécification mais **ne sont définies par aucun document** : refusées.
- Type `TAX` **pour les groupes L et N seulement** ; `BIE` et `SER` pour tous les autres.
- Groupe A « exonéré et hors champ » : pour une opération **hors champ**, le code d'article
  doit valoir la chaîne « HORS CHAMP » (orthographe exacte, casse et espace, **à confirmer
  auprès de la DGI**).
- Groupe N : le montant est **entièrement de la TVA** et s'ajoute au total de TVA.
- Les **taux** ne sont pas codés en dur : `GET /api/info/taxGroups` (déjà conservé par S25b
  dans `edef_reference_snapshots`) ; la spécification les déclare entiers, la documentation
  les laisse décimaux : on accepte les deux.

**Calcul.**

1. Un seul mode de prix par facture : `ttc` ou `ht`.
2. Prix unitaire : 2 décimales au plus ; quantité : 3 décimales au plus.
3. Arrondi au plus proche, 2 décimales au plus.
4. Calcul à partir du prix unitaire, **par groupe de taxation sur le total du groupe** : en
   TTC, la base HT du groupe se déduit du total du groupe ; en HT, le total se déduit de la
   base du groupe.
5. HT + taxe = total ; en cas d'arrondi, **la taxe est arrondie vers le haut**.
6. Aucun montant nul ou négatif, ni par article ni par facture. Une remise se traduit par un
   prix unitaire réduit (`price` = prix après remise ; `originalPrice` est informatif).
7. Le prix s'entend **sans** taxe spécifique ; la taxe spécifique **augmente la base de la
   TVA**.
8. La DGI recalcule et renvoie ses totaux (`InvoiceResponseDto` : taux `ta`…`tp`, totaux
   `taa`…`tap`, HT `haa`…`hap`, TVA `vaa`…`vap`, `ts`, `total`, `vtotal`, `curTotal`) ; le
   logiciel compare à son propre calcul et **annule** en cas d'écart (ADR-0019).

**Devise.** La facture normalisée est **libellée en CDF**. Un montant total en USD peut être
indiqué (`curCode`, `curDate`, `curRate` ; réponse `curTotal`) ; il devient **obligatoire**
quand un paiement est fait en USD, avec un taux à **±1 %** du taux moyen de la Banque
centrale du Congo. Rien ne documente une facture libellée en USD.

### Deux ambiguïtés de calcul que nous ne pouvons pas lever sur papier

- **(a) « Arrondie vers le haut »** : arrondi au centime supérieur de la TVA (plafond), ou
  arrondi au plus proche suivi d'un ajustement ?
- **(b) Montant de ligne** : `prix × quantité` est-il arrondi ligne par ligne avant la
  somme du groupe, ou seulement au niveau du groupe ?

Et deux exemples de la documentation sont **faux ou non fiables** :

- deux exemples de taxe spécifique annoncés au taux de 16 % ne tombent juste qu'à **19 %**
  (gabarit vraisemblablement repris d'un autre pays) ;
- un sous-total d'exemple donne une TVA de 69,00 pour 500 TTC à 16 %, alors que le calcul
  donne 68,97 sous les deux lectures de (a).

Ces exemples **ne servent pas de tests de non-régression** (§ S25d.6).

### Faits du dépôt vérifiés le 19 oct. 2026 (commit `85d5652`)

| Fait | Où |
|---|---|
| Matrice RBAC : 16 actions ; la seizième est `fiscal.manage` | `apps/api/src/authz/permissions.ts` |
| Toute route déclare une permission ou figure, justifiée, dans `SANS_PERMISSION` | `authz/routes-coverage.test.ts` |
| `edef_reference_snapshots` : `record()` et `count()` seulement, aucune lecture du dernier instantané | `edef/edef-reference-snapshots.service.ts` |
| L'environnement DGI de l'organisation se lit par `NormalizedInvoicingStateReader.read()`, **non exporté** de `FiscalModule` | `fiscal/normalized-invoicing-state.reader.ts`, `fiscal/fiscal.module.ts` |
| `normalizeNif()` exporté (majuscules, sans espaces ni tirets) | `fiscal/fiscal.dto.ts:35` |
| Les index sont créés en production pour **tous** les modèles enregistrés | `database/indexes.service.ts:71` |
| docs/16 : pagination **par curseur** | `docs/16-API.md` § Principes |
| docs/26 : « pas de nombre flottant natif pour les montants officiels » ; « noms de code en anglais » | `docs/26-CONVENTIONS.md` |
| Le moteur n'utilise aucune bibliothèque décimale ; `ENGINE_VERSION` est enregistrée avec chaque plan | `packages/engine/package.json`, `src/index.ts`, `apps/api/src/plans/plan.schema.ts` |
| `/organisation/facturation` désigne l'abonnement **Lalanda** (SaaS) | `apps/web/src/app/(app)/organisation/facturation` |

## Options considérées

### O1 — Nommage

Retenu (ADR-0018) : collections `customers` et `catalog_items`, module
`apps/api/src/sales/`, routes sous `/sales/…`, espace web **`/ventes`**. Écartés : `clients`
(ambigu avec les clients de Lalanda dans `billing/`), `products` (un service n'est pas un
produit), `/organisation/facturation` (déjà l'abonnement SaaS).

### O2 — Permissions

1. **Réutiliser `organization.manage`.** Écarté : le Directeur financier et le Comptable ne
   l'ont pas, alors qu'ils tiennent la facturation au quotidien.
2. **Réutiliser `fiscal.manage`.** Écarté : réservée à l'acte qui engage le contribuable
   (jeton, régime) ; la tenue d'un fichier clients n'engage personne devant la DGI.
3. **Une seule action `sales.manage`.** Écarté : il faut pouvoir **consulter** sans
   modifier (Analyste, Lecteur), et le fichier clients contient des données personnelles.
4. **Deux actions, `sales.read` et `sales.manage`.** **Retenu.** L'émission d'une facture,
   qui, elle, engage le contribuable, recevra sa propre action au lot S25e
   (`sales.invoice`, à concevoir alors).

### O3 — Arithmétique sans flottants

1. **`number` JavaScript.** Écarté : docs/26 l'interdit, et `0,1 + 0,2 ≠ 0,3` suffit à
   rater une comparaison au centime avec la DGI.
2. **Centimes entiers en `number`.** Écarté : le produit `prix (2 déc.) × quantité (3
   déc.)` vit à l'échelle 10⁻⁵ ; un montant de ligne de dix milliards de CDF dépasse alors
   `Number.MAX_SAFE_INTEGER` (2⁵³).
3. **Bibliothèque décimale (decimal.js, big.js).** Écarté : nouvelle dépendance du moteur,
   réglages globaux mutables (précision, mode d'arrondi) partagés par tout le processus, et
   bien plus de surface que les quatre opérations dont on a besoin.
4. **Entiers `bigint` à virgule fixe, chaînes décimales aux frontières.** **Retenu.**
   Natif (Node 20, navigateurs), exact, sans état global. Chaque valeur est ramenée à une
   échelle connue ; une division ne se fait qu'au moment d'un arrondi explicite, avec le
   mode d'arrondi écrit en toutes lettres. Les montants entrent et sortent comme **chaînes
   décimales canoniques** (`"464.00"`), jamais comme `number`.

### O4 — Lever les ambiguïtés (a) et (b)

1. **Choisir une lecture et la figer.** Écarté : un choix faux ne se verrait qu'au premier
   écart DGI, en homologation.
2. **Attendre une réponse écrite de la DGI.** Écarté comme seule voie : délai inconnu ; la
   question est posée quand même.
3. **Politique d'arrondi explicite, à deux axes, avec une valeur par défaut, et cas de
   calibrage qui départagent les lectures.** **Retenu.** Les cas de calibrage (§ S25d.6)
   seront **envoyés à l'environnement de test DGI puis annulés** (`POST /api/invoice`, puis
   `PUT …/cancel` : la DGI renvoie ses totaux sans qu'aucune facture ne soit normalisée) au
   début du lot S25f. Changer de politique est alors une ligne et une nouvelle version du
   calcul, pas une réécriture.

### O5 — Liste des groupes de taxation proposée par le catalogue

1. **Seulement l'instantané DGI.** Écarté : une organisation sans point de vente testé ne
   pourrait pas créer son catalogue.
2. **Liste codée en dur, taux compris.** Écarté : ADR-0019 interdit de coder un taux.
3. **Instantané DGI de l'environnement de l'organisation s'il existe ; sinon liste par
   défaut sourcée et datée — lettres, libellés et types d'article admis, sans aucun
   taux.** **Retenu.** Le catalogue n'a besoin que de la lettre ; le taux n'intervient
   qu'au calcul de la facture, et vient alors de l'instantané figé par la facture (S25e).

### O6 — Prix du catalogue : HT ou TTC

1. **Toujours HT.** Écarté : la vente au détail en RDC raisonne en TTC.
2. **Mode de l'organisation.** Écarté : l'homologation exige chaque cas dans les deux modes,
   sur le même catalogue.
3. **Chaque article porte son prix et son mode.** **Retenu.** Si la facture est dans
   l'autre mode, le moteur convertit le prix unitaire (`convertUnitPrice`, arrondi au plus
   proche) et la ligne affiche le prix converti, modifiable ; c'est ce prix-là qui part à la
   DGI.

### O7 — Suppression

Retenu : **suppression réelle seulement si jamais facturé**, sinon désactivation. Une
facture (S25e) recopie les données du client et des articles : la suppression ne la casse
pas, mais un client déjà facturé reste dans le fichier pour la traçabilité. Le champ
`firstInvoicedAt` (posé par S25e, jamais remis à `null`) décide.

## Décision — S25c : clients et catalogue

### S25c.1 Accès : permissions et forfait

Deux actions, ajoutées **en fin** de `ACTIONS` (dix-septième et dix-huitième) et de docs/12 :

- `sales.read` — « Consulter les clients et le catalogue » ;
- `sales.manage` — « Gérer les clients et le catalogue ».

| Action | PRO | ADM | DIR | CPT | ANA | CDP | CON | LEC |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| `sales.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ |
| `sales.manage` | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |

Justification : des données maîtres opérationnelles, sans engagement fiscal — l'Administrateur
et le Comptable les tiennent ; l'Analyste et le Lecteur consultent ; le Conseiller, externe
(banquier, mentor), ne voit pas le fichier clients (données personnelles) ; le Chef de
projet, rôle borné aux projets et non attribuable, n'a rien. **Proposition soumise à la
décideuse** (décision ouverte n° 1).

Plateforme : `sales.read` **`delegated`** pour `platform_super_admin` et `platform_support`
(lecture sous accès délégué, comme `project.read`), `forbidden` pour les autres ;
`sales.manage` **`delegated`** pour `platform_super_admin` seul (comme `project.update`),
`forbidden` pour les autres. Aucune des deux n'entre dans `PLATFORM_FORBIDDEN_ACTIONS`.

**Aucun contrôle de forfait dans ce lot** (ADR-0018 amendé, ADR-0021 §1) : accès sous les
seules permissions, jusqu'à la décision tarifaire de RUN.

### S25c.2 Collection `customers`

| Champ | Type | Règle |
|---|---|---|
| `organizationId` | string | requis |
| `type` | `'PP' \| 'PM' \| 'PC' \| 'PL' \| 'AO'` | requis |
| `name` | string | requis pour **tous** les types, 1–200, espaces de bord retirés (libellé « Dénomination » pour PM, « Nom » sinon) |
| `nif` | string \| null | `normalizeNif()` puis `^[A-Z0-9]{5,20}$` ; **requis** pour PM, PC, PL ; facultatif pour PP et AO |
| `exemptionReference` | string \| null | ≤ 200 ; **requis** pour AO, **`null` imposé** pour les autres types |
| `phone` | string \| null | `^\+?[0-9][0-9 .-]{6,19}$` |
| `email` | string \| null | adresse e-mail, ≤ 254 |
| `address` | string \| null | ≤ 255 (une chaîne, comme `ClientDto.address`) |
| `active` | boolean | `true` à la création |
| `deactivatedAt`, `deactivatedBy` | Date, string \| null | |
| `firstInvoicedAt` | Date \| null | écrit **seulement** par `markInvoiced` (§ S25c.6) ; jamais remis à `null` |
| `sortName` | string | `name` normalisé (minuscules, sans accents) — tri |
| `searchKey` | string | `name`, `nif`, `email` normalisés et concaténés — recherche |
| `revision` | entier | 1 à la création, +1 à chaque écriture |
| `createdBy`, `updatedBy`, `createdAt`, `updatedAt`, `_schemaVersion: 1` | | |

Le nom est requis même pour un PP (la DGI ne l'exige pas) : un fichier clients sans nom ne
sert à rien ; une vente au comptoir sans client enregistré restera possible au lot S25e
(client PP anonyme, non stocké).

Index : `{ organizationId: 1, sortName: 1, _id: 1 }` ; `{ organizationId: 1, active: 1 }` ;
**unique partiel** `{ organizationId: 1, nif: 1 }` (`nif` de type chaîne) → `409
CUSTOMER_NIF_EXISTS` avec `details.existingId` (clients actifs et inactifs confondus : un
même contribuable n'a qu'une fiche par organisation).

### S25c.3 Collection `catalog_items`

| Champ | Type | Règle |
|---|---|---|
| `organizationId` | string | requis |
| `code` | string \| null | référence interne, 1–50, `^[A-Za-z0-9._/-]+$` ; unique par organisation (comparaison en majuscules) ; **ne peut pas valoir « HORS CHAMP »** |
| `name` | string | requis, 1–200 (désignation imprimée) |
| `itemType` | `'BIE' \| 'SER' \| 'TAX'` | requis ; `TAX` **si et seulement si** `taxGroup` ∈ {L, N} |
| `taxGroup` | `'A'`…`'P'` | requis ; doit figurer dans la liste en vigueur (§ S25c.4) à la création et à chaque modification du groupe |
| `outOfScope` | boolean | `true` permis **seulement** en groupe A ; alors le code envoyé à la DGI est `OUT_OF_SCOPE_ITEM_CODE` |
| `unitPrice` | string | décimal canonique à **exactement 2 décimales** (`"464.00"`) ; entrée acceptée `^\d{1,13}(\.\d{1,2})?$`, strictement > 0 |
| `priceMode` | `'ttc' \| 'ht'` | requis |
| `currency` | `'CDF'` | seule valeur admise dans ce lot (décision ouverte n° 2) |
| `unit` | string | requis, 1–20 (« pièce », « kg », « heure »…) |
| `specificTax` | objet \| null | `{ kind: 'per_unit', amount }` (décimal > 0, 2 déc.) ou `{ kind: 'percent', rate }` (décimal > 0 et < 100, 2 déc.) ; **interdit** pour les groupes L et N |
| `active`, `deactivatedAt`, `deactivatedBy`, `firstInvoicedAt`, `sortName`, `searchKey` (`code`, `name`), `revision`, `createdBy`, `updatedBy`, `createdAt`, `updatedAt`, `_schemaVersion: 1` | | comme `customers` |

Index : `{ organizationId: 1, sortName: 1, _id: 1 }` ; `{ organizationId: 1, active: 1 }` ;
**unique partiel** `{ organizationId: 1, codeKey: 1 }` (`codeKey` = `code` en majuscules,
champ technique) → `409 CATALOG_CODE_EXISTS`.

**Le code DGI** d'un article est calculé, jamais saisi : `outOfScope ? OUT_OF_SCOPE_ITEM_CODE
: code`. Cela empêche une faute de frappe sur la valeur exigée par la DGI et garde la
référence interne de l'article.

### S25c.4 Liste des groupes de taxation

`GET /sales/tax-groups` renvoie la liste à proposer :

1. environnement de l'organisation = `NormalizedInvoicingStateReader.read(orgId).environment`
   (`test` par défaut) ;
2. dernier instantané `taxGroups` de cet environnement (nouvelle méthode
   `EdefReferenceSnapshotsService.latest(environment, list)`) ; s'il existe, les groupes
   proposés sont **les lettres A à P présentes dans l'instantané**, avec leur taux ;
3. sinon, la **liste par défaut** `DEFAULT_TAX_GROUPS` (§ S25d.2), sans taux,
   `source: 'default'`.

Un article dont le groupe n'est plus proposé reste lisible, marqué `taxGroupAvailable:
false` ; il faut changer son groupe pour le modifier ou l'utiliser (S25e refusera de le
facturer).

### S25c.5 Contrat HTTP

Toutes les routes : `@UseGuards(AuthGuard, PermissionsGuard)`, organisation active,
quota global. Une ressource d'une autre organisation répond **404**, jamais 403. Erreurs au
format des contrôleurs existants (`code`, `message` en français, `details` éventuels).

| Méthode et chemin | Permission | Réponse |
|---|---|---|
| `GET /sales/customers` | `sales.read` | 200 `CustomerPage` |
| `POST /sales/customers` | `sales.manage` | 201 `CustomerView` |
| `GET /sales/customers/:customerId` | `sales.read` | 200 `CustomerView` |
| `PUT /sales/customers/:customerId` | `sales.manage` | 200 `CustomerView` |
| `POST /sales/customers/:customerId/deactivate` | `sales.manage` | 200 `CustomerView` |
| `POST /sales/customers/:customerId/reactivate` | `sales.manage` | 200 `CustomerView` |
| `DELETE /sales/customers/:customerId` | `sales.manage` | 204 |
| `GET /sales/catalog-items` | `sales.read` | 200 `CatalogItemPage` |
| `POST /sales/catalog-items` | `sales.manage` | 201 `CatalogItemView` |
| `GET /sales/catalog-items/:itemId` | `sales.read` | 200 `CatalogItemView` |
| `PUT /sales/catalog-items/:itemId` | `sales.manage` | 200 `CatalogItemView` |
| `POST /sales/catalog-items/:itemId/deactivate` | `sales.manage` | 200 `CatalogItemView` |
| `POST /sales/catalog-items/:itemId/reactivate` | `sales.manage` | 200 `CatalogItemView` |
| `DELETE /sales/catalog-items/:itemId` | `sales.manage` | 204 |
| `GET /sales/tax-groups` | `sales.read` | 200 `TaxGroupList` |

Désactiver ou réactiver un élément déjà dans l'état demandé répond 200 sans écriture.

#### Listes, recherche, curseur

```
GET /sales/customers?q=kin&type=PM&status=active&limit=50&cursor=…
GET /sales/catalog-items?q=eau&taxGroup=B&itemType=BIE&status=all&limit=50&cursor=…
```

- `q` : 1–100 caractères, normalisé comme `searchKey` (minuscules, sans accents), recherche
  « contient », caractères spéciaux échappés ;
- `status` : `active` (défaut) | `inactive` | `all` ;
- `limit` : 1–100, défaut 50 ;
- tri : `sortName` puis `_id` ; `cursor` opaque (base64url de `{ "s": sortName, "i": id }`),
  `400 INVALID_CURSOR` s'il est illisible.

```jsonc
// CustomerPage
{ "items": [ /* CustomerView */ ], "nextCursor": null }      // null = dernière page

// CustomerView
{
  "id": "6713a0c4e1a2b3c4d5e6f701",
  "type": "PM",
  "typeLabel": "Personne morale",
  "name": "Exemple SARL",
  "nif": "A0000000X",
  "exemptionReference": null,
  "phone": "+243 800 000 000",
  "email": "compta@exemple.cd",
  "address": "1, avenue Exemple, Gombe, Kinshasa",
  "active": true,
  "deactivatedAt": null,
  "invoiced": false,                       // firstInvoicedAt !== null
  "revision": 1,
  "createdAt": "2026-10-20T09:00:00.000Z",
  "updatedAt": "2026-10-20T09:00:00.000Z"
}

// POST /sales/customers  (champs inconnus refusés, Zod .strict())
{
  "type": "PM",
  "name": "Exemple SARL",
  "nif": "a 000-0000x",                    // normalisé en "A0000000X"
  "exemptionReference": null,
  "phone": "+243 800 000 000",
  "email": "compta@exemple.cd",
  "address": "1, avenue Exemple, Gombe, Kinshasa"
}

// PUT /sales/customers/:customerId  — corps COMPLET + révision attendue
{ "expectedRevision": 1, "type": "PM", "name": "…", "nif": "…", "exemptionReference": null,
  "phone": null, "email": null, "address": null }
```

```jsonc
// CatalogItemView
{
  "id": "6713a0c4e1a2b3c4d5e6f702",
  "code": "LAIT-1L",
  "edefCode": "LAIT-1L",                   // "HORS CHAMP" si outOfScope
  "name": "Lait demi-écrémé 1 L",
  "itemType": "BIE",
  "taxGroup": "B",
  "taxGroupAvailable": true,
  "outOfScope": false,
  "unitPrice": "464.00",
  "priceMode": "ttc",
  "currency": "CDF",
  "unit": "pièce",
  "specificTax": null,                     // ou { "kind": "per_unit", "amount": "75.00" }
                                           // ou { "kind": "percent", "rate": "10.00" }
  "active": true,
  "deactivatedAt": null,
  "invoiced": false,
  "revision": 1,
  "createdAt": "2026-10-20T09:00:00.000Z",
  "updatedAt": "2026-10-20T09:00:00.000Z"
}

// POST /sales/catalog-items
{
  "code": "LAIT-1L",
  "name": "Lait demi-écrémé 1 L",
  "itemType": "BIE",
  "taxGroup": "B",
  "outOfScope": false,
  "unitPrice": "464",                      // chaîne ; normalisée en "464.00"
  "priceMode": "ttc",
  "currency": "CDF",
  "unit": "pièce",
  "specificTax": null
}
// PUT /sales/catalog-items/:itemId : corps complet + "expectedRevision"

// CatalogItemPage
{ "items": [ /* CatalogItemView */ ], "nextCursor": null }
```

`unitPrice` et `specificTax.amount|rate` sont **toujours des chaînes** dans les deux sens :
un `number` JSON est refusé (`400 INVALID_REQUEST`, problème `DECIMAL_MUST_BE_STRING`).

```jsonc
// GET /sales/tax-groups  →  200 TaxGroupList
{
  "source": "dgi_snapshot",                // "dgi_snapshot" | "default"
  "environment": "test",
  "fetchedAt": "2026-10-20T09:00:00.000Z", // null si "default"
  "sha256": "9f2c…",                       // null si "default"
  "groups": [
    { "letter": "A", "label": "Exonéré et hors champ", "ratePercent": "0",
      "itemTypes": ["BIE", "SER"], "outOfScopeAllowed": true },
    { "letter": "B", "label": "Taxable 16 %", "ratePercent": "16",
      "itemTypes": ["BIE", "SER"], "outOfScopeAllowed": false },
    { "letter": "L", "label": "Prélèvements sur ventes", "ratePercent": "0",
      "itemTypes": ["TAX"], "outOfScopeAllowed": false }
    // … ; ratePercent = null quand source = "default"
  ]
}
```

Le libellé vient de `DEFAULT_TAX_GROUPS` (les listes DGI ne donnent pas de libellé par
lettre) ; le taux, de l'instantané. Pour un groupe à taux variable selon la DGI, le libellé
par défaut ne mentionne pas de taux.

**Erreurs.**

| HTTP | Code | Quand |
|---|---|---|
| 400 | `INVALID_REQUEST` | corps invalide ; `details.issues: [{ path, code, message }]` avec, entre autres, `NAME_REQUIRED`, `NIF_REQUIRED_FOR_TYPE`, `NIF_INVALID`, `EXEMPTION_REFERENCE_REQUIRED`, `EXEMPTION_REFERENCE_NOT_ALLOWED`, `DECIMAL_MUST_BE_STRING`, `PRICE_NOT_POSITIVE`, `PRICE_TOO_PRECISE`, `ITEM_TYPE_NOT_ALLOWED_FOR_GROUP`, `OUT_OF_SCOPE_ONLY_GROUP_A`, `SPECIFIC_TAX_NOT_ALLOWED`, `CODE_RESERVED`, `UNKNOWN_TAX_GROUP` |
| 400 | `INVALID_CURSOR` | curseur illisible |
| 404 | `CUSTOMER_NOT_FOUND` · `CATALOG_ITEM_NOT_FOUND` | inconnu ou d'une autre organisation |
| 409 | `CUSTOMER_NIF_EXISTS` · `CATALOG_CODE_EXISTS` | doublon ; `details.existingId` |
| 409 | `STALE_REVISION` | `expectedRevision` ≠ révision courante ; `details.currentRevision` |
| 409 | `CUSTOMER_ALREADY_INVOICED` · `CATALOG_ITEM_ALREADY_INVOICED` | suppression d'un élément déjà facturé : « désactivez-le » |

### S25c.6 Comportements

- **Isolation** : chaque requête Mongo porte `organizationId` de l'organisation active ;
  aucun identifiant d'organisation n'est accepté dans un corps ou une URL.
- **Écritures concurrentes** : `PUT`, désactivation, réactivation par `findOneAndUpdate`
  conditionné par `{ _id, organizationId, revision }` ; perte → `409 STALE_REVISION`.
- **Suppression** : `deleteOne({ _id, organizationId, firstInvoicedAt: null })` ; zéro
  supprimé mais document présent → `409 …_ALREADY_INVOICED`.
- **Pour S25e, livré sans appelant** (même précédent qu'`emissionModeOf`, ADR-0021) :

  ```ts
  // apps/api/src/sales/sales-usage.service.ts
  markInvoiced(organizationId: string,
               refs: { customerId: string | null; catalogItemIds: readonly string[] },
               opts?: { session?: ClientSession }): Promise<void>;   // pose firstInvoicedAt s'il est null
  ```
  C'est le **seul** écrivain de `firstInvoicedAt` (test dédié).
- **Journal d'audit** (`record`, non bloquant) : `customer.deactivated`,
  `customer.reactivated`, `customer.deleted`, `catalog_item.deactivated`,
  `catalog_item.reactivated`, `catalog_item.deleted` ; métadonnées : l'identifiant
  seulement, **jamais** nom, NIF ni coordonnées. Créations et modifications ne sont pas
  journalisées (données maîtres à fort volume ; la `revision` et `updatedBy` suffisent).

## Décision — S25d : calcul conforme

### S25d.1 Emplacement, nommage, version

- Nouveau dossier `packages/engine/src/invoice-totals/`, exporté par l'index du moteur. Noms
  de code en anglais (docs/26), libellés et messages en français.
- **Aucune dépendance** à l'API, à la base, au réseau ni à une bibliothèque nouvelle ;
  aucune lecture d'horloge ; fonctions pures et déterministes.
- `INVOICE_TOTALS_VERSION = '1.0.0'`, **distincte** de `ENGINE_VERSION` : ce module ne touche
  aucun calcul de plan, et changer `ENGINE_VERSION` renuméroterait des plans sans raison. La
  facture (S25e) enregistrera `INVOICE_TOTALS_VERSION` et l'identifiant de politique.

### S25d.2 Types et constantes — jalon D0 (fichiers figés)

```ts
// packages/engine/src/invoice-totals/types.ts
/** Décimal canonique, sans signe ni exposant : /^\d+(\.\d+)?$/. Jamais un number. */
export type DecimalString = string;

export const TAX_GROUP_LETTERS = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P',
] as const;
export type TaxGroupLetter = (typeof TAX_GROUP_LETTERS)[number];

export const ITEM_TYPES = ['BIE', 'SER', 'TAX'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export type PriceMode = 'ttc' | 'ht';

export type SpecificTax =
  | { kind: 'per_unit'; amount: DecimalString }     // par unité, 2 déc., > 0
  | { kind: 'percent'; rate: DecimalString };       // en %, 2 déc., > 0 et < 100

export interface InvoiceLineInput {
  unitPrice: DecimalString;        // prix APRÈS remise, dans le mode de la facture ; ≤ 2 déc., > 0
  quantity: DecimalString;         // ≤ 3 déc., > 0
  taxGroup: TaxGroupLetter;
  itemType: ItemType;
  specificTax: SpecificTax | null;
}

/** Taux en pour cent, lus dans l'instantané DGI figé par la facture. */
export type TaxRateTable = Readonly<Partial<Record<TaxGroupLetter, DecimalString>>>;

export interface RoundingPolicy {
  id: string;
  /** Montant de ligne arrondi ligne par ligne, ou somme exacte arrondie par groupe. */
  lineAmount: 'per_line' | 'per_group';
  /** TVA du groupe : centime supérieur, ou arrondi au plus proche (demi vers le haut). */
  vat: 'up' | 'half_up';
}

export interface InvoiceTotalsInput {
  priceMode: PriceMode;
  lines: readonly InvoiceLineInput[];
  rates: TaxRateTable;
  policy?: RoundingPolicy;          // défaut : DGI_ROUNDING_POLICY
}

export interface LineTotals {
  index: number;
  amount: DecimalString;            // prix × quantité, arrondi selon la politique
  specificTaxAmount: DecimalString; // "0.00" si aucune → taxSpecificAmount
  specificTaxValue: string | null;  // forme DGI : "75.00" ou "10.00%" → taxSpecificValue
}

export interface GroupTotals {
  group: TaxGroupLetter;
  ratePercent: DecimalString;
  total: DecimalString;             // taa…  (TTC, taxe spécifique et sa TVA comprises)
  ht: DecimalString;                // haa…  (base imposable, taxe spécifique comprise)
  vat: DecimalString;               // vaa…
  specificTax: DecimalString;
}

export interface InvoiceTotals {
  calculationVersion: string;       // INVOICE_TOTALS_VERSION
  policyId: string;
  priceMode: PriceMode;
  lines: readonly LineTotals[];
  groups: readonly GroupTotals[];   // groupes utilisés seulement, ordre A → P
  specificTax: DecimalString;       // ts
  total: DecimalString;             // total
  vatTotal: DecimalString;          // vtotal
}

export type InvoiceTotalsIssueCode =
  | 'NO_LINES'
  | 'INVALID_DECIMAL'
  | 'PRICE_NOT_POSITIVE' | 'PRICE_TOO_PRECISE'
  | 'QUANTITY_NOT_POSITIVE' | 'QUANTITY_TOO_PRECISE'
  | 'LINE_AMOUNT_ZERO'
  | 'AMOUNT_TOO_LARGE'
  | 'UNKNOWN_TAX_GROUP' | 'TAX_RATE_INVALID'
  | 'ITEM_TYPE_NOT_ALLOWED'
  | 'SPECIFIC_TAX_INVALID' | 'SPECIFIC_TAX_NOT_ALLOWED';

export interface InvoiceTotalsIssue {
  code: InvoiceTotalsIssueCode;
  lineIndex: number | null;
  field: 'unitPrice' | 'quantity' | 'taxGroup' | 'itemType' | 'specificTax' | 'rates' | null;
  message: string;                  // français, affichable
}

export type InvoiceTotalsResult =
  | { ok: true; totals: InvoiceTotals }
  | { ok: false; issues: readonly InvoiceTotalsIssue[] };   // TOUS les problèmes, pas le premier
```

```ts
// packages/engine/src/invoice-totals/tax-groups.ts
export type TaxGroupNature = 'standard' | 'vat_only';     // vat_only : groupe N

export interface TaxGroupDefinition {
  letter: TaxGroupLetter;
  label: string;                         // libellé court, français
  nature: TaxGroupNature;
  itemTypes: readonly ItemType[];        // ['TAX'] pour L et N, ['BIE','SER'] sinon
  outOfScopeAllowed: boolean;            // true pour A seulement
}

/** Seize groupes en vigueur depuis février 2026 — source : documentation du compte
 *  développeur DGI (groupes de taxation, v1.2). Aucun taux ici (ADR-0019). */
export const DEFAULT_TAX_GROUPS: readonly TaxGroupDefinition[];
export const DEFAULT_TAX_GROUPS_SOURCE: { label: string; date: '2026-02' };

/** Valeur imposée du code d'article pour une opération hors champ (groupe A).
 *  Orthographe à confirmer auprès de la DGI. */
export const OUT_OF_SCOPE_ITEM_CODE = 'HORS CHAMP';

export function isTaxGroupLetter(value: unknown): value is TaxGroupLetter;
export function isItemTypeAllowed(group: TaxGroupLetter, type: ItemType): boolean;
export function taxGroupDefinition(group: TaxGroupLetter): TaxGroupDefinition;
```

Libellés de `DEFAULT_TAX_GROUPS` : A « Exonéré et hors champ » · B « Taxable 16 % » ·
C « Taxable 5 % » · D « Régimes dérogatoires » · E « Exportation » · F « Marché public à
financement extérieur 16 % » · G « … 5 % » · H « Consignation d'emballage » · I « Garantie
et caution » · J « Débours » · K « Opérations des non-assujettis » · L « Prélèvements sur
ventes » · M « Ventes réglementées à TVA spécifique » · N « TVA spécifique » · O « Taxable
1 % » · P « Marché public à financement extérieur 1 % ». Les pourcentages des libellés sont
des **noms** de groupe, pas des taux de calcul.

`invoice-totals/index.ts` (barrel) réexporte ces deux fichiers dès D0 ; `src/index.ts` du
moteur reçoit **une** ligne `export * from './invoice-totals/index.js'`. D3 n'ajoute ensuite
des exports **que** dans le barrel.

### S25d.3 Fonctions — chantier D3

```ts
// packages/engine/src/invoice-totals/index.ts (exports ajoutés par D3)
export const INVOICE_TOTALS_VERSION = '1.0.0';
export const DGI_ROUNDING_POLICY: RoundingPolicy =
  { id: 'dgi-cd-2026.1', lineAmount: 'per_line', vat: 'up' };

/** Totaux d'une facture, exactement comme la DGI les recalcule. */
export function computeInvoiceTotals(input: InvoiceTotalsInput): InvoiceTotalsResult;

/** Forme des totaux de l'API e-DEF : ta…tp, taa…tap, haa…hap, vaa…vap, ts, total, vtotal.
 *  Les seize groupes sont présents ; un groupe inutilisé vaut "0.00" ; un taux absent du
 *  tableau vaut null. */
type L = Lowercase<TaxGroupLetter>;
export type EdefTotals =
  { [K in `t${L}`]: DecimalString | null } &
  { [K in `ta${L}` | `ha${L}` | `va${L}`]: DecimalString } &
  { ts: DecimalString; total: DecimalString; vtotal: DecimalString };
export function toEdefTotals(totals: InvoiceTotals, rates: TaxRateTable): EdefTotals;

/** Compare nos totaux à la réponse brute de POST /api/invoice (S25f). Un champ absent de
 *  la réponse vaut 0. Un nombre qui n'est pas un décimal à 2 décimales au plus est une
 *  différence (jamais arrondi pour « faire coïncider »). */
export interface TotalsDifference { field: string; ours: DecimalString | null; dgi: string | null }
export function compareWithEdefResponse(
  ours: InvoiceTotals, rates: TaxRateTable, response: Readonly<Record<string, unknown>>,
): { identical: boolean; differences: readonly TotalsDifference[] };

/** Nombre JSON reçu de la DGI → décimal canonique, par sa représentation la plus courte
 *  (String(n)). null si non fini, négatif, en notation exponentielle ou > 2 décimales. */
export function decimalFromJsonNumber(value: number): DecimalString | null;

/** Décimal canonique → nombre JSON pour l'envoi (exact pour ≤ 15 chiffres significatifs). */
export function decimalToJsonNumber(value: DecimalString): number;

export function isValidDecimal(value: string, maxDecimals: number): boolean;

/** Contre-valeur indicative : total CDF / taux (CDF pour 1 USD), arrondi au plus proche. */
export function usdCounterValue(totalCdf: DecimalString, cdfPerUsd: DecimalString): DecimalString;

/** |taux − référence| ≤ tolérance % de la référence (bornes incluses). */
export function isExchangeRateWithinTolerance(
  rate: DecimalString, referenceRate: DecimalString, tolerancePercent?: DecimalString, // '1'
): boolean;

/** Conversion d'un prix unitaire d'un mode à l'autre, arrondi au plus proche, 2 déc. */
export function convertUnitPrice(
  unitPrice: DecimalString, ratePercent: DecimalString, from: PriceMode, to: PriceMode,
): DecimalString;

/** Prix unitaire après remise, pour une ligne (cas 25 de l'homologation). */
export type LineDiscount =
  | { kind: 'percent'; value: DecimalString }        // > 0 et < 100
  | { kind: 'total_amount'; value: DecimalString };  // remise pour toute la quantité
export function discountedUnitPrice(input: {
  originalPrice: DecimalString; quantity: DecimalString; discount: LineDiscount;
}):
  | { ok: true; unitPrice: DecimalString; priceModification: string;  // "Remise 10 %"
      effectiveDiscountTotal: DecimalString }                         // (origine − prix) × qté
  | { ok: false; issue: InvoiceTotalsIssue };
```

Le fichier interne `decimal.ts` porte l'arithmétique (`bigint` à l'échelle de 10⁻⁸) et les
trois arrondis nommés `roundHalfUp`, `roundUp` (vers +∞), `roundDown` ; il n'est pas exporté
du moteur.

### S25d.4 Algorithme (politique `dgi-cd-2026.1`)

Notations : `r(x)` arrondi au centime le plus proche (demi vers le haut) ; `R_v` = arrondi
de la TVA selon `policy.vat` (`up` : centime supérieur ; `half_up` : `r`) ; `t` = taux du
groupe en %.

1. **Validation** (tous les problèmes collectés) : au moins une ligne ; `unitPrice` décimal,
   > 0, ≤ 2 déc. ; `quantity` décimal, > 0, ≤ 3 déc. ; `taxGroup` ∈ A–P et présent dans
   `rates` (sinon `UNKNOWN_TAX_GROUP`), taux décimal ≥ 0 et < 1000 (sinon
   `TAX_RATE_INVALID`) ; `isItemTypeAllowed` ; `specificTax` interdite en L et N, valeurs
   conformes ; tout montant (ligne, groupe, total) < 10¹³ (`AMOUNT_TOO_LARGE` : au-delà, un
   nombre JSON à 2 décimales n'est plus exact côté DGI).
2. **Ligne** : `amount_i = r(prix × qté)` si `per_line` ; si `per_group`, la somme exacte du
   groupe est arrondie une fois. `amount_i = 0.00` → `LINE_AMOUNT_ZERO` (ex. 0,001 × 0,01).
3. **Taxe spécifique de la ligne** : `per_unit` → `r(montant × qté)` ; `percent` → `r(base ×
   taux_TS / 100)` où `base` = `amount_i` en HT, `amount_i × 100 / (100 + t)` (non arrondi)
   en TTC. `TS_g` = somme du groupe.
4. **Groupe standard** :
   - **HT** : `H0 = Σ amount_i` ; `ht = H0 + TS_g` ; `vat = R_v(ht × t / 100)` ;
     `total = ht + vat`.
   - **TTC** : `T0 = Σ amount_i` ; `total = T0 + r(TS_g × (100 + t) / 100)` ;
     `vat = R_v(total × t / (100 + t))` ; `ht = total − vat`.
   - `t = 0` : `vat = 0`, `ht = total`.
5. **Groupe N** (`vat_only`) : `total = Σ amount_i`, `vat = total`, `ht = 0`, quel que soit
   le mode.
6. **Facture** : `total = Σ total_g` ; `vatTotal = Σ vat_g` ; `specificTax = Σ TS_g`.
   Invariants vérifiés par test sur chaque groupe : `ht + vat = total`, tous ≥ 0, `total` de
   la facture > 0.

Points **à calibrer** en environnement de test (S25f), qui ne changeraient que la politique
ou l'étape concernée : (a) et (b) ; l'assiette d'une taxe spécifique en pourcentage en mode
TTC ; le contenu de `haa`… quand une taxe spécifique existe ; le traitement du groupe M (le
moteur applique le taux renvoyé par la DGI, attendu à 0) ; l'arrondi de `curTotal`. La
structure retenue pour la taxe spécifique en TTC est **confirmée** par les deux exemples
faux de la documentation : recalculés à 19 %, ils tombent juste au centime (2 357,00 et
168,07) — c'est le taux qui est faux, pas la méthode.

### S25d.5 Devise

Le moteur calcule **en CDF**. `usdCounterValue` produit la contre-valeur indicative et
`isExchangeRateWithinTolerance` le contrôle à ±1 %. Le choix du taux de référence (liste
`currencyRates` de la DGI ou taux publié par la Banque centrale) et la date du taux
appartiennent au lot S25e ; question posée à la DGI. Un prix catalogue en USD n'existe pas
dans ce lot (décision ouverte n° 2).

### S25d.6 Cas de référence

Exportés par `packages/engine/src/invoice-totals/reference-cases.ts` pour être rejoués au
lot S25f contre la DGI :

```ts
export interface InvoiceTotalsReferenceCase {
  id: string;
  origin: 'dgi_example' | 'derived' | 'calibration';
  reliability: 'reliable' | 'unreliable' | 'to_calibrate';
  note: string;
  input: InvoiceTotalsInput;
  expected: { ok: true; groups: Partial<Record<TaxGroupLetter,
                { total: DecimalString; ht: DecimalString; vat: DecimalString }>>;
              specificTax: DecimalString; total: DecimalString; vatTotal: DecimalString }
          | { ok: false; codes: readonly InvoiceTotalsIssueCode[] };
}
export const INVOICE_TOTALS_REFERENCE_CASES: readonly InvoiceTotalsReferenceCase[];
```

Valeurs attendues sous `DGI_ROUNDING_POLICY` (calculées par le CTO, à recalculer par le test,
jamais recopiées de la sortie du code) :

| Id | Origine · fiabilité | Entrée | Attendu |
|---|---|---|---|
| `dgi-modele` | exemple DGI · **fiable** | TTC ; A 5 × 720,00 ; B 1 × 464,00 ; taux A 0, B 16 | A 3 600,00 / 3 600,00 / 0,00 ; B 464,00 / 400,00 / 64,00 ; total 4 064,00 ; TVA 64,00 |
| `dgi-remise` | exemple DGI · fiable pour le montant | TTC ; B 4 × 500,00 (prix d'origine 1 000,00, informatif) | montant de ligne 2 000,00 ; B 2 000,00 / 1 724,13 / 275,87 (TVA dérivée) |
| `dgi-ts-19` | exemple DGI · **faux (19 %)** | TTC ; B 4 × 500,00, TS 75,00 par unité ; taux 16 | **pas** 2 357,00 ; le moteur donne 2 348,00 / 2 024,13 / 323,87 |
| `dgi-ts-pct-19` | exemple DGI · **faux (19 %)** | TTC ; B 4 × 500,00, TS 10 % ; taux 16 | **pas** TS 168 ; le moteur donne TS 172,41 ; B 2 200,00 / 1 896,55 / 303,45 |
| `dgi-sous-total-69` | exemple DGI · **non fiable** | TTC ; B 1 × 500,00 | **pas** TVA 69,00 ; le moteur donne 500,00 / 431,03 / 68,97 |
| `mixte-b-c-ttc` | dérivé · fiable | TTC ; B 1 × 1 160,00 ; C 1 × 1 050,00 ; taux 16, 5 | B 1 160,00 / 1 000,00 / 160,00 ; C 1 050,00 / 1 000,00 / 50,00 ; total 2 210,00 ; TVA 210,00 |
| `mixte-b-c-ht` | dérivé · fiable | HT ; B 1 × 1 000,00 ; C 1 × 1 000,00 | mêmes totaux |
| `cal-tva-ht` | **calibrage (a)** | HT ; B 1 × 431,03 | `up` : 500,00 / 431,03 / 68,97 · `half_up` : 499,99 / 431,03 / 68,96 |
| `cal-tva-ttc-1pct` | **calibrage (a)** | TTC ; O 1 × 1 000,00 ; taux 1 | `up` : 1 000,00 / 990,09 / 9,91 · `half_up` : 1 000,00 / 990,10 / 9,90 |
| `cal-ligne` | **calibrage (b)** | HT ; B 3 lignes 0,335 × 1,00 | `per_line` : HT 1,02, TVA 0,17, total 1,19 · `per_group` : 1,01 / 0,17 / 1,18 |
| `cal-ts-ht` | calibrage | HT ; B 4 × 431,03, TS 75,00 par unité | 2 347,98 / 2 024,12 / 323,86 ; TS 300,00 |
| `qte-decimale` | dérivé · fiable | HT ; B 2,375 × 1,99 | montant de ligne 4,73 |
| `groupe-n` | dérivé · à calibrer | HT ; N 3 × 10,00 (TAX) | N 30,00 / 0,00 / 30,00 ; TVA 30,00 |
| `refus-*` | dérivé · fiable | prix 0 ; prix 1,234 ; quantité 1,2345 ; 0,001 × 0,01 ; BIE en L ; TAX en B ; TS en N ; groupe Q ; groupe absent du tableau ; aucune ligne ; `"1e3"` | `PRICE_NOT_POSITIVE` · `PRICE_TOO_PRECISE` · `QUANTITY_TOO_PRECISE` · `LINE_AMOUNT_ZERO` · `ITEM_TYPE_NOT_ALLOWED` (×2) · `SPECIFIC_TAX_NOT_ALLOWED` · `UNKNOWN_TAX_GROUP` (×2) · `NO_LINES` · `INVALID_DECIMAL` |
| `devise` | dérivé | 4 064,00 CDF à 2 987,33 | 1,36 USD ; taux 2 929 contre référence 2 900 → accepté (1,00 %) ; 2 930 → refusé (1,03 %) |

Les cas `dgi-ts-19`, `dgi-ts-pct-19` et `dgi-sous-total-69` sont gardés pour **documenter**
l'écart, avec une assertion « le moteur ne produit pas la valeur de l'exemple ». Ils seront
signalés à la DGI.

## Découpage en chantiers parallèles

Règle inchangée (ADR-0011) : **un fichier, un seul écrivain** ; toute exception passe par le
CTO.

### Jalon D0 — contrats (développeur D1, fusionné **avant** D1, D2 et D3)

Sans comportement visible ; il permet aux trois chantiers de compiler contre des types
réels.

- `apps/api/src/authz/permissions.ts` : `sales.read`, `sales.manage` en fin de `ACTIONS`, les
  deux matrices (§ S25c.1) ;
- `authz/permissions.test.ts` : matrice littérale 8 × 18 + 6 × 18 = **252 assertions** ;
  texte « 18 actions » de `routes-coverage.test.ts` ;
- `packages/engine/src/invoice-totals/types.ts`, `tax-groups.ts` (+ `tax-groups.test.ts`),
  `index.ts` (barrel initial), une ligne dans `packages/engine/src/index.ts` ;
- `docs/12-ROLES-PERMISSIONS.md` (deux actions) ; note « amendé par ADR-0022 » en tête
  d'ADR-0012.

### D1 — back-end ventes (S25c)

| Possède | Ne touche pas |
|---|---|
| `apps/api/src/sales/**` (nouveau) : `customer.schema.ts`, `catalog-item.schema.ts`, `customers.service.ts`, `catalog-items.service.ts`, `tax-groups.service.ts`, `sales-usage.service.ts`, `customers.controller.ts`, `catalog-items.controller.ts`, `tax-groups.controller.ts`, `sales.dto.ts`, `sales.errors.ts`, `search.ts` (normalisation, curseur), `sales.module.ts`, tests | `packages/engine/**` (consommateur de `tax-groups.ts` seulement) |
| **Ajouts purs** : méthode `latest()` dans `edef/edef-reference-snapshots.service.ts` (+ test) ; export de `NormalizedInvoicingStateReader` dans `fiscal/fiscal.module.ts` (une ligne) ; `SalesModule` dans `app.module.ts` (une ligne) ; trois contrôleurs dans `authz/routes-coverage.test.ts` | le reste de `fiscal/**`, `edef/**`, `authz/permissions.ts` après D0, `apps/web/**` |
| docs/15 et docs/16 (fin de lot, après fusion) | docs/04, docs/21 |

### D2 — front-end ventes (S25c)

| Possède | Ne touche pas |
|---|---|
| `apps/web/src/lib/api.ts` : `OrgAction` + `'sales.read' \| 'sales.manage'`, types et méthodes du § S25c.5 | `apps/api/**`, `packages/**` |
| `apps/web/src/lib/routes.ts` (+ test) : `/ventes` dans `PROTECTED_PREFIXES` | `organisation/**`, `compte/**` |
| `_components/user-menu-model.ts` (+ test) : entrée « Ventes » → `/ventes`, après « Tableau de bord », visible pour tout membre d'une organisation (même règle qu'« Organisation », ADR-0016 §1 : aucun appel de plus) | `app-header.tsx` |
| nouveau `apps/web/src/app/(app)/ventes/` : `layout.tsx` (onglets Clients · Catalogue filtrés par `GET /me/permissions`), `page.tsx` (redirige vers `clients`), `clients/page.tsx`, `catalogue/page.tsx`, `_components/customer-list.tsx`, `customer-form.tsx`, `catalog-list.tsx`, `catalog-item-form.tsx`, `sales-model.ts` (+ `sales-model.test.ts`) | |
| docs/04 (section Ventes) ; ADR-0016 reçoit une note d'amendement (entrée « Ventes » du menu) | |

### D3 — moteur de calcul (S25d)

| Possède | Ne touche pas |
|---|---|
| `packages/engine/src/invoice-totals/**` **sauf** `types.ts` et `tax-groups.ts` (figés par D0) : `decimal.ts`, `compute.ts`, `edef-shape.ts`, `currency.ts`, `pricing.ts`, `reference-cases.ts`, exports ajoutés au barrel `index.ts`, tests | `packages/engine/src/index.ts` après D0, tout le reste du moteur, `ENGINE_VERSION` |
| `docs/21-MOTEUR-FINANCIER.md` (section « Calcul des factures ») | `apps/**` |

### Ordre

1. **D0** fusionné dans `main`.
2. **D1, D2, D3 en parallèle**, rebasés sur D0. D2 code contre le contrat § S25c.5 avec des
   réponses simulées ; D1 et D3 n'ont aucune dépendance mutuelle.
3. Fusion **D3** (le plus isolé), puis **D1**, puis **D2** (rebasé, vérifié contre l'API
   réelle). D1 met à jour docs/15 et docs/16.

## Critères d'acceptation et tests

### D0

- 252 assertions littérales ; `sales.read` et `sales.manage` exactement selon § S25c.1 ;
  `PLATFORM_FORBIDDEN_ACTIONS` inchangée (quatre) ; `fiscal.manage` inchangée.
- `isItemTypeAllowed` : TAX ⇔ L ou N, pour les 16 × 3 combinaisons ; `outOfScopeAllowed`
  vrai pour A seul ; 16 définitions, lettres uniques, ordre A → P ; aucun taux dans le
  fichier (test qui cherche un champ de taux).

### D1

- Clients : pour chaque type, chaque champ requis manquant → 400 avec le code du problème ;
  PP sans NIF → 201 ; AO sans référence d'exonération → 400 ; référence d'exonération sur
  un PM → 400 ; NIF normalisé (`"a 000-0000x"` → `"A0000000X"`) ; doublon de NIF dans la
  même organisation → 409 avec `existingId`, même NIF dans une autre organisation → 201 ;
  champ inconnu → 400.
- Catalogue : TAX en B → 400 ; BIE en L → 400 ; `outOfScope` en B → 400 ; `edefCode` vaut
  « HORS CHAMP » pour un article hors champ, son `code` propre conservé ; code « hors
  champ » saisi → 400 `CODE_RESERVED` ; `unitPrice` `464` (number) → 400, `"464"` →
  `"464.00"`, `"1.234"` → 400, `"0"` → 400 ; TS en N → 400 ; groupe Q → 400 ; doublon de
  code (casse ignorée) → 409.
- Liste des groupes : sans instantané → `source: "default"`, 16 groupes, `ratePercent`
  null ; avec un instantané de l'environnement de l'organisation → ses taux ; un
  instantané de l'**autre** environnement est ignoré ; une lettre absente de l'instantané
  n'est pas proposée et un article existant de ce groupe ressort `taxGroupAvailable: false`.
- Pagination : 120 clients → trois pages de 50/50/20 sans doublon ni trou, y compris avec
  des noms identiques ; curseur altéré → 400 ; recherche insensible à la casse et aux
  accents (« kinshasa » trouve « KINSHASA », « eleve » trouve « Élevé ») ; `q` contenant
  `.*` ne fait pas tout correspondre.
- Révision : deux `PUT` avec la même `expectedRevision` → un 200, un 409 `STALE_REVISION`.
- Suppression : jamais facturé → 204 et document absent ; après `markInvoiced` → 409, document
  intact ; `markInvoiced` ne remet jamais à `null` et ne touche pas une autre organisation ;
  seul `SalesUsageService` écrit `firstInvoicedAt`.
- Isolation et RBAC e2e : Propriétaire, Administrateur, Directeur financier, Comptable →
  écriture 200 ; Analyste, Lecteur → lecture 200, écriture 403 ; Conseiller → 403 ;
  ressource d'une autre organisation → 404 sur **chaque** route ; super-administrateur sans
  appartenance ni accès délégué → refus.
- Audit : désactivation, réactivation, suppression écrivent un événement ; aucune
  métadonnée ne contient nom, NIF, téléphone ou e-mail.
- `routes-coverage.test.ts` vert.

### D2

- Entrée « Ventes » dans le menu pour tout membre ; onglets filtrés par permission ; sans
  `sales.read` → écran de refus explicite, pas de page vide.
- Formulaire client : champs requis affichés selon le type choisi (`requiredFieldsFor(type)`
  dans `sales-model.ts`, testé contre le tableau du § S25c.2) ; libellé « Dénomination »
  pour PM ; erreurs serveur affichées champ par champ ; `409 STALE_REVISION` → message
  « modifié par quelqu'un d'autre », rechargement proposé ; `409 CUSTOMER_NIF_EXISTS` →
  lien vers la fiche existante.
- Formulaire article : groupes lus de `GET /sales/tax-groups` ; type d'article restreint
  aux types admis du groupe ; case « Opération hors champ » seulement en A, avec le code
  DGI affiché ; mode TTC/HT obligatoire ; bandeau « Liste par défaut (février 2026) » quand
  `source = "default"`.
- Montants : saisis et transmis **comme chaînes** ; affichage formaté (`1 234,50 CDF`) par
  manipulation de chaîne, **sans** `Number()` ni `parseFloat` (test qui l'impose sur
  `sales-model.ts`) ; aucune règle de calcul dans un composant.
- Suppression proposée seulement si `invoiced = false`, sinon « Désactiver ».
- Logique testée dans `sales-model.test.ts` (vitest en environnement node).

### D3

- Tous les cas du § S25d.6, sous `DGI_ROUNDING_POLICY` **et**, pour les cas de calibrage,
  sous chaque variante de politique.
- Propriétés (1 000 factures générées, graine fixe) : `ht + vat = total` pour chaque groupe ;
  `total = Σ total_g` ; `vatTotal = Σ vat_g` ; résultat identique quel que soit l'ordre des
  lignes ; en `vat: 'up'`, la TVA n'est jamais inférieure à la TVA exacte.
- Arithmétique : aucun `number` dans `decimal.ts`, `compute.ts`, `currency.ts`,
  `pricing.ts` hors `decimalToJsonNumber` et `decimalFromJsonNumber` (test de lecture des
  sources, comme les tests verrous existants) ; `0.1 + 0.2` en entrée chaîne donne
  `"0.30"` ; montants de 10¹² CDF × quantités à 3 décimales exacts.
- `toEdefTotals` : 16 × 4 clés + `ts`, `total`, `vtotal` ; `ta` = taux A, `taa` = total A.
- `compareWithEdefResponse` : réponse identique → `identical: true` ; un centime d'écart sur
  `vab` → une différence nommée `vab` ; `68.97` reçu comme nombre JSON est accepté,
  `68.965` est une différence ; champs absents = 0.
- `convertUnitPrice` : 1 000,00 HT à 16 % → 1 160,00 TTC ; 464,00 TTC → 400,00 HT.
- `discountedUnitPrice` : 10 % sur 1 000,00 → 900,00, « Remise 10 % » ; 300,00 sur 3 unités
  à 1 000,00 → 900,00, remise effective 300,00 ; remise ≥ prix → refus.
- Aucun import d'`apps/`, de Mongo, de Nest ni de réseau dans `invoice-totals/` (test de
  dépendances) ; tous les tests existants du moteur passent **sans modification** ;
  `ENGINE_VERSION` inchangée.

### Tous

`pnpm format`, lint, typecheck et tests verts à la racine ; `git diff --stat origin/main`
sans suppression hors périmètre ; aucun fichier de `dgi/`, aucun jeton, aucune donnée
client réelle dans un commit (les jeux d'essai utilisent des NIF fictifs).

## Conséquences

- Deux collections nouvelles, `customers` et `catalog_items`, indexées en production sans
  action manuelle ; la matrice passe à 18 actions ; ADR-0012, ADR-0016 et docs/12 reçoivent
  une note d'amendement.
- Le lot S25e trouvera : les fiches typées, les articles avec code DGI, groupe et type
  vérifiés, `markInvoiced`, et le calcul des totaux ; il ajoutera l'action d'émission, le
  mode de prix de la facture, le gel de l'instantané des taux et la recopie des données
  client et article dans la facture.
- Le lot S25f trouvera `toEdefTotals`, `compareWithEdefResponse`, les conversions de nombres
  JSON et les cas de calibrage ; **sa première tâche** est la campagne de calibrage
  (envoi puis annulation, environnement de test seulement), qui fixe la politique
  définitive et, si elle diffère, `INVOICE_TOTALS_VERSION = '1.1.0'`.
- Une facture enregistrera la version du calcul et la politique : un changement ultérieur
  de politique ne modifie jamais une facture émise.
- **Risque connu** : l'exigence d'inventaire (contrôle de stock, rapport d'état du stock)
  figure au dossier d'homologation en catégorie reportable, alors qu'ADR-0018 refuse les
  stocks. Ce lot n'y touche pas ; il faudra trancher avant l'homologation définitive
  (décision ouverte n° 4).
- Le catalogue n'impose aucun périmètre : les seize groupes y sont disponibles, parce que les
  cas de test les exigent tous.

## Plan de validation

Critères ci-dessus, par chantier ; revue CTO de chaque branche avant fusion (isolation par
organisation, absence de flottant dans les montants, conformité au contrat § S25c.5 et aux
signatures § S25d.2–3) ; essai de la décideuse : créer un client de chacun des cinq types et
les articles nécessaires aux cas 1 à 8 de l'homologation, en TTC et en HT.

## Décisions ouvertes — elles appartiennent à la décideuse

1. **Qui tient les clients et le catalogue ?** Proposé : Propriétaire, Administrateur,
   Directeur financier et Comptable modifient ; Analyste et Lecteur consultent ; le
   Conseiller externe ne voit pas le fichier clients. Faut-il le montrer au Conseiller, ou
   retirer l'Administrateur ?
2. **Prix en dollars dans le catalogue ?** La facture normalisée est en francs congolais.
   Proposé : prix en CDF seulement tant que la DGI n'a pas répondu sur la facturation en USD
   (le champ devise existe déjà pour l'ouvrir plus tard). Beaucoup de vos clients pensent en
   dollars : est-ce bloquant pour les premiers utilisateurs ?
3. **Périmètre à faire homologuer.** Le logiciel ne pourra servir que pour les groupes et
   types de facture validés. Proposé : viser les seize groupes et les six types, puisque
   les cas de test les couvrent tous ; un périmètre réduit irait plus vite mais limiterait
   les clients possibles.
4. **Gestion de stock.** Le dossier d'homologation mentionne un contrôle d'inventaire
   (exigence reportable), alors que la trajectoire ERP l'a écarté. Faut-il le prévoir pour
   l'homologation définitive, ou accepter de rester en homologation transitoire sur ce
   point ?

Tranché par le CTO (technique, non soumis) : arithmétique `bigint`, politique d'arrondi
paramétrable calibrée en S25f, nommage, curseur, révision optimiste, liste des groupes par
défaut sans taux, code « HORS CHAMP » calculé, version du calcul distincte de celle du
moteur.

## Questions à poser à la DGI (complètent ADR-0019)

- Arrondi exact de la TVA (centime supérieur ou plus proche) et arrondi du montant de ligne.
- Orthographe exacte de la valeur « HORS CHAMP ».
- Assiette d'une taxe spécifique en pourcentage en mode TTC ; contenu de `haa`… avec une
  taxe spécifique ; taux renvoyé pour le groupe M.
- Facturation libellée en USD possible ? Taux de référence qui fait foi pour le contrôle à
  ±1 %, et à quelle date.
- Signalement : deux exemples de taxe spécifique calculés à 19 % au lieu de 16 %, et un
  sous-total à 69,00 au lieu de 68,97.

## Liens

- [ADR-0012](ADR-0012-modele-rbac-complet.md) — RBAC (amendé : 17ᵉ et 18ᵉ actions) ;
  [ADR-0016](ADR-0016-navigation-applicative.md) — navigation (amendé : entrée Ventes).
- [ADR-0018](ADR-0018-trajectoire-erp-trois-modules.md) — trajectoire BUILD → RUN → GROW ;
  [ADR-0019](ADR-0019-facture-normalisee-dgi-rdc.md) — facture normalisée ;
  [ADR-0020](ADR-0020-ordonnanceur-mongodb.md) — ordonnanceur ;
  [ADR-0021](ADR-0021-modules-erp-et-identite-fiscale.md) — identité fiscale, `edef/`,
  instantanés de référence.
- [docs/sources/dgi-rdc](../sources/dgi-rdc/README.md) — spécification e-DEF v2.0 publique ;
  règles détaillées : documentation du compte développeur DGI (hors dépôt).
- [docs/16](../16-API.md) — pagination par curseur ; [docs/26](../26-CONVENTIONS.md) — pas de
  flottant pour les montants officiels.
- Code : `apps/api/src/authz/permissions.ts`, `apps/api/src/edef/`, `apps/api/src/fiscal/`,
  `packages/engine/src/`.
