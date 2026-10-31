# ADR-0046 — Stocks, équipements et documents (R5) : articles stockés, emplacements, mouvements, valorisation au coût moyen pondéré, inventaires ; registre des équipements, affectations, maintenance, échéances ; bibliothèque de documents

Statut : Proposed
Date : 2026-10-31
Décideurs : Gracy Omokoso (dirigeante) — **ordre du RUN validé** (R0 navigation, R1 projets, R2 CRM,
R3 achats, R4 RH, **R5 stocks, équipements et documents**, dernier bloc du RUN) et consigne du
31 oct. 2026 : « continue, ne t'arrête pas » ; CTO Lalanda (contrat technique). Le cadrage est
**proposé** : chaque choix qui appartient à la dirigeante porte une valeur par défaut, appliquée tant
qu'elle ne tranche pas autrement (§ Décisions ouvertes). Les points comptables et fiscaux
(valorisation comptable des stocks, amortissement, cession) sont soumis à son expert-comptable ;
**cet ADR n'en pose aucun**.

> **Lève le refus d'[ADR-0018](ADR-0018-trajectoire-erp-trois-modules.md)** (« Refusés à ce stade :
> RH et paie, stocks, achats… ») **pour les stocks**, à la demande de la dirigeante (RUN complet,
> « pour ne plus utiliser d'autres outils ») ; la production, les nomenclatures et la comptabilité
> générale restent refusées (§ Hors périmètre).
> **Amende [ADR-0012](ADR-0012-modele-rbac-complet.md) et docs/12** : huit actions nouvelles
> (`stock.read`, `stock.move`, `stock.count`, `stock.manage`, `assets.read`, `assets.manage`,
> `docs.read`, `docs.manage`) et **un rôle nouveau, Magasinier** (`storekeeper`, § 4.2).
> **Étend [ADR-0041](ADR-0041-autorisations-par-membre.md)** : dixième, onzième et douzième domaines,
> dépendances, `stock.manage` parmi les actions à séparation dynamique (`APPROVAL_ACTIONS`).
> **Branche l'accroche d'[ADR-0044](ADR-0044-achats-et-fournisseurs.md) § 6.6** (port
> `PURCHASE_RECEPTION_SINK`) sans modifier le comportement des achats : une ligne change dans
> `purchases.module.ts` (le fournisseur nul devient celui des stocks). **Lit, sans jamais les
> écrire**, les factures de vente figées d'[ADR-0023](ADR-0023-factures-et-avoirs.md) et
> d'[ADR-0024](ADR-0024-normalisation-dgi.md) : aucune ligne du circuit de facturation ni de la
> normalisation DGI ne change (§ 6.2). **Étend [ADR-0039](ADR-0039-projets-et-taches-run.md)**
> (« Mes tâches », cloche, marge informative), **[ADR-0033](ADR-0033-brief-du-matin.md)** (ports
> `STOCK_SOURCE`, `ASSETS_SOURCE`, `DOCUMENTS_SOURCE`, règles R16 à R18). **Reprend sans les
> modifier** le motif des pièces jointes d'ADR-0039 § 2.5, le chiffrement par enveloppe des
> documents RH d'[ADR-0045](ADR-0045-ressources-humaines.md) § 2.8 et la séparation dynamique de
> `purchaseApprovalDecision` (ADR-0044 § 2.3). **N'introduit aucune règle comptable ni fiscale** :
> la valorisation est une **mesure de gestion**, l'amortissement une **estimation de gestion**
> étiquetée comme telle (§ 9).

## Contexte

Avec R3, Lalanda sait ce qui est **commandé, reçu, facturé et payé** ; avec R4, **qui** travaille dans
l'organisation. Il ne sait ni **ce qu'il y a dans le magasin**, ni **quel matériel appartient à
l'organisation et qui l'a**, ni **où sont les papiers** de l'entreprise. Une PME tient ces registres
dans un cahier de magasin, un tableur d'inventaire et un dossier partagé. Cinq manques :

1. **Pas de quantité.** Une réception d'achat (R3) dit « 6 cartons reçus » mais aucun solde n'existe ;
   une facture de vente dit « 4 vendus » sans rien retirer. Personne ne sait ce qui reste, ni où, ni ce
   qu'il faut racheter.
2. **Pas de valeur.** Ce que vaut le stock, ce qu'a coûté ce qui a été vendu ou consommé sur un chantier :
   inconnu. La marge d'un projet (ADR-0039 § 5) ignore le matériel sorti du magasin.
3. **Pas de contrôle.** Rien ne compare le stock théorique au stock compté ; un écart ne laisse pas de
   trace ni de motif ; celui qui compte peut aussi effacer l'écart.
4. **Pas de registre du matériel.** L'ordinateur remis à une nouvelle recrue (liste d'accueil R4), le
   véhicule affecté à un chantier, la garantie d'une machine, l'assurance d'un camion, la vidange tous
   les six mois : rien n'est tracé ni rappelé ; la liste de départ R4 dit « matériel repris » sans dire
   lequel.
5. **Pas de bibliothèque.** Statuts, attestations, licences, contrats de bail, polices d'assurance,
   certificats : éparpillés ; une attestation expire sans que personne le sache ; les pièces jointes
   existantes (projets, achats, RH) sont rangées chacune dans son module, sans vue d'ensemble.

### Faits du dépôt qui commandent les décisions

| Fait | Où | Conséquence |
|---|---|---|
| R3 appelle, **après** la transaction d'une réception enregistrée ou annulée, `PURCHASE_RECEPTION_SINK.onReceptionChanged({ organizationId, receptionId, status, lines: [{ orderLineId, itemRef, quantity, unit }] })` ; fournisseur **nul** ; une erreur du fournisseur est **journalisée et avalée** | `apps/api/src/purchases/stock-sink.port.ts`, `purchases/receptions/purchase-receptions.service.ts` (`afterChange`), `purchases.module.ts` (`useValue: noPurchaseReceptionSink`) | un appel peut se perdre : le fournisseur des stocks doit être **idempotent** et doublé d'un **rattrapage** périodique en lecture (§ 6.1) ; l'appel ne porte ni prix, ni devise, ni date : le fournisseur relit la réception et la commande |
| Une ligne de commande porte `itemRef` (texte libre ≤ 100, `null` par défaut), `unit`, `unitPrice` HT, `discountPercent`, `kind: goods \| service`, `receivable`, `workProjectId` | `purchases/orders/purchase-order.schema.ts`, `@lalanda/shared/purchases` | `itemRef` reçoit la référence de l'article de stock (`stk:<id>`) ou son code ; une ligne non reconnue n'est **jamais** perdue : elle attend un rattachement (§ 2.6) |
| Le catalogue de vente `catalog_items` porte `itemType` (`BIE`, `SER`, `TAX`), groupe de taxation DGI, mode de prix, devise, `unit`, `firstInvoicedAt` ; il **ne calcule rien** | `sales/catalog-item.schema.ts`, ADR-0022 | un objet fiscal de vente ; on ne lui greffe pas de quantité (O1) |
| Une facture figée porte `status` (`draft`, `issued`, `pending_normalization`, `normalized`, `normalization_failed`), `type` (`FV`, `FT`, `FA`, `EV`, `ET`, `EA` ; `FA`/`EA` = avoirs), des lignes figées `{ index, catalogItemId, unit, quantity, itemType, … }`, une empreinte `contentSha256` ; ses écrivains sont nommés et limités | `sales/invoices/invoice.schema.ts`, `invoice.contract.ts`, `invoice.types.ts` | la sortie de vente se fait **par lecture** des factures `issued` ou `normalized`, jamais par un crochet dans le gel ni dans la normalisation (§ 6.2) |
| Pièces jointes : PDF ≤ 10 Mio reconnu par `%PDF-`, **non analysé**, servi en téléchargement inerte ; images ≤ 2 Mio assainies ; clé au hasard ; **1 Gio par organisation en commun** (projets, achats, RH) | ADR-0039 § 2.5, `work/work-attachments.*`, `purchases/attachments/purchase-attachments.ts`, `packages/shared/src/work/constants.ts` | la bibliothèque reprend ce motif, préfixe `documents/`, même borne commune (décision ouverte n° 19) |
| Documents RH sensibles : chiffrement **par enveloppe** (clé de données par fichier, enveloppée sous `MASTER_KEYRING`, AAD = organisation + collaborateur + document), couverts par `secrets:rewrap` ; envoi en `multipart/form-data`, **aucune métadonnée dans l'URL ni dans un en-tête** (journalisés par pino-http) — correctif du lot H4 | `hr/documents/hr-document-crypto.ts`, `hr-documents.controller.ts`, commit `9d2e8a1` | même enveloppe pour les documents sensibles de la bibliothèque ; **la recherche passe dans un corps `POST`**, jamais en `?q=` (un titre de document est une donnée) |
| La matrice compte **10 rôles × 38 actions** (+ 6 rôles plateforme) = 608 cases ; `APPROVAL_ACTIONS` = `plan.approve`, `purchase.approve`, `leave.approve` ; `countApprovers` et `holdersOf` comptent les détenteurs **effectifs** ; `OWNER_ONLY_ROLES` = `hr_manager` | `authz/permissions.ts`, `authz/authz.service.ts`, docs/12 | huit actions et un rôle s'y déclarent une fois ; matrice **11 × 46 + 6 × 46 = 782** cases |
| Écarts par membre (ADR-0041) derrière `MEMBER_PERMISSIONS_ENABLED`, **éteint** | `organizations/member-permissions.ts`, docs/16 | sans rôle dédié, un magasinier ne peut aujourd'hui recevoir `stock.move` qu'en étant Administrateur, Directeur financier ou Propriétaire (O6) |
| Le plan financier porte un module **SYSCOHADA** d'amortissement (durées « indicatives » sourcées AUDCIF 2017) pour les **projections** | `packages/engine/src/amortissements/` | le registre des équipements est du **réalisé de gestion**, distinct du plan ; il ne reprend pas ces durées d'office (§ 9, décision ouverte n° 13) |
| Catégorie de dépense `investissement` (« Investissements (immobilisations) », nature investissement), hors réalisé d'exploitation | `packages/engine/src/treasury/types.ts`, ADR-0034 | l'acquisition d'un équipement **se relie** à une dépense ou à une facture fournisseur ; elle n'en crée aucune |
| Marge d'un projet : encaissé − remboursé − dépenses − coût du temps, par devise ; ajouts informatifs `purchases` (R3) et constat `PERSONNEL_…` (R4) ; `WORK_MARGIN_VERSION = '1.2.0'` ; ports `WORK_PURCHASES_SOURCE` | `engine/src/work/margin.ts`, `work/margin/` | le matériel consommé est **informatif**, jamais soustrait (il est déjà une dépense quand l'achat a été payé) |
| Brief : règles R1 à R15, `MORNING_BRIEF_VERSION = '1.4.0'`, un port par module | `morning-brief/morning-brief.ports.ts`, `engine/src/morning-brief/` | ports `STOCK_SOURCE`, `ASSETS_SOURCE`, `DOCUMENTS_SOURCE`, règles R16 à R18, version 1.5.0 |
| « Mes tâches » agrège à la lecture (`CRM_AGENDA_SOURCE`, `PURCHASES_AGENDA_SOURCE`, `HR_AGENDA_SOURCE`) ; cloche commune (`NOTIFICATION_SOURCE_MODULES` : `work`, `crm`, `organization`, `purchases`, `hr`) | `work/my-tasks.ports.ts`, `packages/shared/src/notifications/index.ts` | ports `STOCK_AGENDA_SOURCE`, `ASSETS_AGENDA_SOURCE` ; modules `stock`, `assets`, `documents` |
| Ordonnanceur en base, « au moins une fois », gestionnaires **idempotents** | `scheduler/scheduler.service.ts`, ADR-0020 | rattrapages et rappels : tâches idempotentes (index uniques de source) |
| Accueil : carte RUN, `MAX_TUILES_RUN = 4`, chiffres lus sur des API existantes (factures ouvertes, achats, CRM) | `accueil/_components/accueil-model.ts` | une tuile « sous le seuil » entre dans la liste ordonnée, sans changer le maximum |

## Options considérées

### O1 — Articles stockés : le catalogue de vente, ou des articles propres ?

1. **Ajouter quantités et coûts à `catalog_items`.** Écarté :
   - le catalogue est un objet **fiscal** de vente (groupe de taxation DGI, mode de prix, `firstInvoicedAt`
     qui fige des champs) ; le module des ventes deviendrait écrivain du stock, et chaque mouvement
     toucherait un document lu par le circuit de facturation ;
   - une PME stocke ce qu'elle **ne vend pas** : consommables, pièces détachées, matières, fournitures de
     chantier ; il faudrait des « articles de vente » jamais vendus, avec un groupe de taxation inventé ;
   - un service (`SER`) ou une taxe (`TAX`) n'ont pas de stock.
2. **Collection propre `stock_items`, avec lien facultatif et unique vers un article du catalogue**
   (`catalogItemId`, article de type `BIE` seulement). L'article stocké porte ce qui relève du magasin
   (unité de stock, conversions, seuils, emplacement par défaut, devise de coût) ; l'article de vente
   garde ce qui relève de la facture. La sortie de vente passe par ce lien, **en lecture** de la ligne
   figée (`catalogItemId`). Les achats y pointent par `itemRef`. **Retenu.**
3. Articles distincts sans lien avec le catalogue. Écarté : la sortie de stock à la vente deviendrait une
   saisie manuelle, donc un oubli.

### O2 — Méthode de valorisation

1. **Premier entré, premier sorti (PEPS/FIFO).** Écarté pour R5 : il exige des **couches** par entrée
   (lots datés), un appariement à chaque sortie, et devient illisible quand une entrée est annulée ou son
   coût corrigé après coup ; la cible (PME, quelques centaines d'articles) n'en a pas l'usage.
2. **Coût standard** fixé par l'utilisateur. Écarté : il n'apprend rien du réel et demande une mise à
   jour manuelle.
3. **Coût moyen unitaire pondéré recalculé après chaque entrée (CMUP « glissant »)**, par article et par
   devise de coût, tous emplacements confondus (un transfert ne change pas le coût). Simple à expliquer
   (« ce que vous avez payé en moyenne pour ce qui reste »), déterministe, **rejouable** : la valeur se
   recalcule en relisant le grand livre des mouvements de l'article, ce qui permet de corriger après coup
   un coût d'entrée sans écriture de rattrapage. **Retenu**, comme **mesure de gestion** ; son usage
   pour un inventaire comptable est à confirmer par l'expert-comptable (décision ouverte n° 5).

### O3 — Sortie de stock à la vente : quand et comment ?

1. **Crochet dans le gel de la facture** (`InvoiceFreezingService`). Écarté : il ajoute un écrivain et une
   dépendance au circuit fiscal ; une panne du stock bloquerait ou retarderait une émission DGI.
2. **Crochet sur l'événement `issued` du journal de facture.** Écarté pour la même raison (le journal est
   écrit dans la transaction de gel).
3. **Lecture après émission** : une tâche `stock.sales-sync` (toutes les cinq minutes, et à la demande)
   lit les factures `issued` ou `normalized` émises depuis son dernier point, et crée les sorties de
   vente, **idempotentes** par `(facture, ligne)`. Aucune ligne du module des ventes ne change ; le stock
   ne lit que des champs figés. **Retenu.** Un retard de quelques minutes est le prix de l'étanchéité.

### O4 — Stock négatif

1. Refuser toute sortie au-delà du disponible. Écarté pour les **faits** : une facture est déjà émise,
   une réception déjà annulée ; refuser la sortie fausserait le stock sans empêcher la vente.
2. **Distinguer** : les mouvements **constatés** ailleurs (vente émise, annulation d'une réception)
   s'enregistrent toujours et lèvent l'alerte `NEGATIVE_STOCK` ; les mouvements **décidés** dans le
   module (bon de sortie, transfert, ajustement) sont refusés au-delà du disponible
   (`409 STOCK_INSUFFICIENT`), sauf réglage `allowNegativeManualMoves` (défaut `false`). **Retenu.**

### O5 — Documents existants (projets, achats, RH, ventes) : migrer, indexer ou présenter ?

1. **Migrer** toutes les pièces vers la bibliothèque. Écarté : chaque module garde des règles d'accès
   propres (documents RH sensibles, portée relationnelle ; pièces d'achat liées au rapprochement ;
   factures de vente figées et empreintes) ; déplacer les objets casserait ces garanties pour un gain
   d'affichage.
2. **Indexer** les métadonnées de toutes les pièces dans une collection commune. Écarté pour R5 : un
   second écrivain à garder synchrone avec cinq modules, et un index qui révélerait des titres de
   pièces RH à qui n'a pas `hr.read`.
3. **Présenter** : la bibliothèque ne stocke que **ses** documents ; la fiche d'une entité (fournisseur,
   projet, équipement…) affiche, **à la lecture**, ses documents de bibliothèque **et** les pièces du
   module propriétaire, chacune filtrée par la permission de ce module. Aucune migration, aucun index.
   Les documents RH **ne sortent jamais** de `/rh`. **Retenu** (décision ouverte n° 20 pour un index
   futur).

### O6 — Rôle « Magasinier » : oui ou non ?

1. **Non**, un magasinier = un Lecteur avec ajouts (motif du refus de l'Acheteur, ADR-0044 O6). Écarté
   **ici** :
   - les ajouts par membre sont **éteints** (`MEMBER_PERMISSIONS_ENABLED`) ; sans rôle, le seul moyen de
     donner `stock.move` est un rôle qui voit aussi la trésorerie, les ventes ou l'organisation ;
   - la personne existe dans la cible et n'est **pas** un acteur financier : elle range, sort, transfère,
     compte ; elle n'a pas à connaître les **prix d'achat** ni la **valeur** du stock (minimisation) ;
     aucun rôle actuel n'a ce profil (le Lecteur n'écrit rien, le Commercial voit les ventes) ;
   - à la différence de l'Acheteur, que R3 servait par Propriétaire, Directeur financier, Comptable ou
     Administrateur, la tenue du magasin est rarement le fait du dirigeant.
2. **Oui** : rôle `storekeeper` (« Magasinier »), neuf actions, **sans** valeurs ni validation d'écart
   (§ 4.2). **Retenu** (décision ouverte n° 2). Le **Logisticien** n'est pas un rôle distinct : son
   besoin (transferts, emplacements) est couvert par le Magasinier.

### O7 — Amortissement des équipements

1. **Reprendre les durées SYSCOHADA du plan financier** et calculer un amortissement « comptable ».
   Écarté : ce serait poser une règle comptable (durée, prorata, base) pour un usage de **réalisé**, alors
   que le module du plan se déclare « indicatif » et réservé aux projections.
2. **Rien.** Écarté : la dirigeante veut voir ce que « vaut encore » son matériel pour décider de le
   remplacer.
3. **Estimation linéaire indicative, paramétrée par l'utilisateur** (durée et valeur résiduelle saisies
   par équipement, aucune durée par défaut), calculée par le moteur, **toujours étiquetée « Estimation de
   gestion — n'est pas un amortissement comptable ou fiscal »**, jamais écrite dans le réalisé, le plan,
   la trésorerie ni un export comptable. **Retenu** (décision ouverte n° 13).

### O8 — Où vivent les contrats et les calculs

Comme ADR-0044 O7 et ADR-0045 O7 : contrats zod dans **`packages/shared/src/stock/`**,
**`packages/shared/src/assets/`**, **`packages/shared/src/documents/`** (entrées `@lalanda/shared/stock`,
`/assets`, `/documents`) ; calculs dans deux modules **purs** `packages/engine/src/stock/`
(`STOCK_VERSION = '1.0.0'`) et `packages/engine/src/assets/` (`ASSETS_VERSION = '1.0.0'`), sans horloge
(jour de référence en paramètre), entiers `bigint` (montants en centimes, quantités en millièmes, coûts
unitaires à six décimales), chaînes décimales en entrée et en sortie, **jamais de conversion entre
devises**. La bibliothèque ne calcule rien d'autre que des échéances (moteur des équipements, fonction
partagée `expiryStatus`).

## Décision

### 1. Vocabulaire

| Interface (français) | Code | Collection |
|---|---|---|
| Article stocké | `StockItem` | `stock_items` (nouvelle) |
| Emplacement (entrepôt, magasin, véhicule, chantier) | `StockLocation` | `stock_locations` (nouvelle) |
| Mouvement (entrée, sortie, transfert, ajustement, retour) | `StockMovement` | `stock_movements` (nouvelle, **ajout seul**) |
| Bon de sortie, bon de transfert, bon d'ajustement | `StockVoucher` | `stock_vouchers` (nouvelle) |
| Stock par emplacement | `StockLevel` | `stock_levels` (cache des quantités, recalculable) |
| Entrée ou sortie à traiter (ligne non reconnue, retour proposé) | `StockPendingLine` | `stock_pending_lines` (nouvelle) |
| Inventaire (comptage) | `StockCount` | `stock_counts` (nouvelle) |
| Réglages des stocks | `StockSettings` | `stock_settings` (un par organisation) |
| Points de rattrapage | — | `stock_sync_checkpoints` (`organizationId + source`) |
| Équipement | `Asset` | `assets` (nouvelle) |
| Catégorie d'équipement | `AssetCategory` | `asset_categories` |
| Affectation | `AssetAssignment` | `asset_assignments` (ajout seul) |
| Intervention de maintenance | `AssetMaintenance` | `asset_maintenance` |
| Garantie, assurance, contrat | `AssetCoverage` | `asset_coverages` |
| Réglages des équipements | `AssetSettings` | `asset_settings` |
| Dossier | `DocumentFolder` | `document_folders` |
| Document, version | `LibraryDocument`, `DocumentVersion` | `library_documents`, `library_document_versions` |
| Compteurs | — | `stock_counters`, `asset_counters` (`organizationId + kind + year`) |

Dates civiles `AAAA-MM-JJ` au **jour de Kinshasa** (ADR-0027) ; horodatages en UTC. Tout document porte
`organizationId`, `revision`, `createdBy`, `updatedBy`, horodatages, `_schemaVersion`. Ressource d'une
autre organisation : **404**, y compris par identifiant forgé dans un corps (`itemId`, `locationId`,
`catalogItemId`, `workProjectId`, `employeeId`, `supplierId`, `supplierInvoiceId`, `expenseId`,
`folderId`, `entityId`). Écriture concurrente : `expectedRevision` → `409 STALE_REVISION`. Devises :
`CDF` et `USD`. Montants : chaînes décimales, deux décimales ; quantités : trois décimales au plus ; coût
unitaire : six décimales au plus.

### 2. Modèle de données — stocks

#### 2.1 `stock_items`

| Champ | Règle |
|---|---|
| `code` | facultatif, 1 à 40 ; `codeKey` majuscules sans espaces, **unique partiel** `{ organizationId, codeKey }` (`409 STOCK_ITEM_CODE_EXISTS`) |
| `name`, `description` | 1 à 200 ; ≤ 2 000 ; `sortName`, `searchKey` normalisés (motif de `catalog_items`) |
| `kind` | `goods` (marchandise revendue) \| `consumable` (consommable, fourniture) \| `material` (matière, pièce) — informatif, sert aux filtres et aux rapports |
| `catalogItemId` | `null` ou un article du catalogue de vente **de type `BIE`**, de l'organisation ; **unique partiel** `{ organizationId, catalogItemId }` (`409 CATALOG_ITEM_ALREADY_STOCKED`) ; un article `SER` ou `TAX` : `422 CATALOG_ITEM_NOT_STOCKABLE` |
| `unit` | unité de stock, 1 à 20 (`pièce`, `kg`, `carton`…) ; non modifiable dès le premier mouvement |
| `unitConversions` | 0 à 5 `{ unit, factor }` : 1 `unit` = `factor` unités de stock (`factor` > 0, six décimales) ; sert à lire une ligne d'achat ou de vente exprimée dans une autre unité (§ 7) |
| `costCurrency` | `CDF` \| `USD` : devise de **valorisation** ; défaut : devise par défaut de l'organisation ; non modifiable dès le premier mouvement valorisé |
| `tracked` | `true` (quantités suivies) ; `false` = article référencé sans suivi (rien n'entre ni ne sort) |
| `defaultLocationId` | emplacement des entrées et des sorties automatiques ; défaut : l'emplacement par défaut de l'organisation |
| `reorder` | `null` \| `{ minQuantity, targetQuantity?, locationId \| null }` : seuil d'alerte (et quantité visée, pour la suggestion), global (`null`) ou par emplacement |
| `preferredSupplierId` | `null` ou une fiche fournisseur (R3) active ; préremplit la suggestion d'achat |
| `active` | `false` = archivé (masqué des sélecteurs ; refusé si quantité non nulle : `409 STOCK_ITEM_NOT_EMPTY`) |

Index : `{ organizationId, sortName, _id }` ; `{ organizationId, active, kind }` ; uniques partiels ci-dessus.

#### 2.2 `stock_locations`

| Champ | Règle |
|---|---|
| `name` | 1 à 120, unique par organisation (clé normalisée) |
| `kind` | `warehouse` \| `shop` \| `vehicle` \| `site` (chantier) \| `other` |
| `workProjectId` | `null` ou un projet RUN (chantier) : une sortie vers cet emplacement n'est **pas** une consommation, c'est un transfert ; la consommation est un bon de sortie (§ 2.4) |
| `address`, `responsibleUserId` | facultatifs ; le responsable reçoit les rappels d'inventaire |
| `isDefault` | un seul par organisation ; créé à l'activation (« Magasin principal ») |
| `pointOfSaleIds` | 0 à 10 points de vente DGI (ADR-0021) dont les ventes sortent de cet emplacement ; sinon : emplacement par défaut de l'article |
| `active` | archivage refusé si une quantité non nulle y reste |

Plusieurs emplacements par organisation, à plat (pas d'arborescence en R5 ; allées et casiers : décision
ouverte n° 8).

#### 2.3 `stock_movements` (grand livre, ajout seul)

| Champ | Règle |
|---|---|
| `itemId`, `locationId` | requis |
| `kind` | `opening` (stock initial) · `purchase_receipt` · `purchase_receipt_reversal` · `sale_issue` · `sale_return` · `issue` (bon de sortie) · `issue_return` (retour au magasin) · `transfer_out` · `transfer_in` · `adjustment` · `count_adjustment` · `supplier_return` |
| `quantity` | décimal **signé** en unité de stock (entrées > 0, sorties < 0), jamais nul |
| `occurredOn` | date civile du fait (réception, émission de la facture, bon) ; jamais future |
| `unitCost` | pour une **entrée valorisée** : coût unitaire dans `costCurrency` de l'article ; `null` pour une sortie (valorisée par le moteur) |
| `costStatus` | `valued` \| `pending_cost` (entrée sans coût dans la devise de l'article, § 2.3.1) \| `not_applicable` (sorties, transferts) |
| `source` | `{ kind: 'reception', receptionId, orderLineId }` · `{ kind: 'invoice', invoiceId, lineIndex }` · `{ kind: 'voucher', voucherId, lineId }` · `{ kind: 'count', countId, lineId }` · `{ kind: 'pending', pendingLineId }` |
| `sourceKey` | clé d'idempotence ; **unique partiel** `{ organizationId, sourceKey }` : `reception:<id>:<ligne>:in`, `reception:<id>:<ligne>:reversal`, `invoice:<id>:<index>`, `voucher:<id>:<ligne>:<sens>`, `count:<id>:<ligne>` — rejouer un rattrapage n'écrit rien deux fois |
| `workProjectId` | `null` ou le projet consommateur (bon de sortie, ligne de commande imputée à un projet, voir § 6.4) |
| `transferId` | appariement `transfer_out` ↔ `transfer_in` |
| `reason` | requis pour `adjustment` (liste de motifs réglable : casse, péremption, vol, erreur de saisie, don, échantillon, autre + texte) |
| `reversalOf` | identifiant du mouvement contre-passé (une annulation **ajoute** un mouvement inverse, n'efface rien) |

Aucun mouvement n'est modifié ni supprimé, à **une** exception : `unitCost` d'une entrée (§ 2.3.1),
journalisée strictement (`stock.entry_cost_changed`, avant, après, motif). Index : `{ organizationId,
itemId, occurredOn, _id }` (rejeu de la valorisation) ; `{ organizationId, locationId, itemId }` ;
`{ organizationId, workProjectId, occurredOn }` (partiel) ; unique partiel `sourceKey`.

##### 2.3.1 Coût d'entrée et devise

- **Réception d'achat** : coût unitaire = prix unitaire HT de la ligne de commande après remise, divisé par
  le facteur de conversion d'unité (moteur `entryUnitCost`), **si** la devise de la commande est la
  `costCurrency` de l'article ; sinon l'entrée est enregistrée en quantité avec `costStatus: 'pending_cost'`
  et figure dans « À traiter » jusqu'à ce qu'un détenteur de `stock.manage` saisisse le coût **dans la devise
  de l'article** (aucun taux n'est proposé ni appliqué). Les taxes déclarées et les frais d'approche
  n'entrent pas dans le coût (décision ouverte n° 6).
- **Facture fournisseur à un prix différent** : aucune révision automatique ; le moteur lève le constat
  `ENTRY_COST_DIFFERS_FROM_INVOICE` (ligne, coût d'entrée, prix facturé), visible sur l'article et dans
  « À traiter » ; `stock.manage` peut corriger le coût d'entrée.
- **Stock initial, inventaire, retour** : coût saisi (stock initial, entrée d'inventaire sans historique) ou
  coût moyen courant (retour de vente, retour au magasin, écart positif d'inventaire d'un article déjà
  valorisé).

#### 2.4 `stock_vouchers` (bons)

| Champ | Règle |
|---|---|
| `number` | `BS{AA}{MM}-NNNNNN` (sortie), `BT…` (transfert), `BJ…` (ajustement) ; compteurs annuels au jour de Kinshasa, trous admis, **pièces internes hors série fiscale** |
| `kind` | `issue` (consommation interne ou projet) \| `issue_return` \| `transfer` \| `adjustment` \| `supplier_return` |
| `status` | `draft` → `posted` (mouvements écrits, transaction unique) → `cancelled` (contre-mouvements, motif) |
| `fromLocationId`, `toLocationId` | selon le type (transfert : les deux, distincts) |
| `lines` | 1 à 100 `{ id, itemId, quantity (> 0, unité de stock), note }` |
| `workProjectId`, `recipient` | facultatifs (bon de sortie) : projet consommateur ; bénéficiaire libre ou `employeeId` (R4, nom seulement) |
| `supplierId`, `receptionId` | retour fournisseur : fiche et réception d'origine (informatif ; **aucun** avoir fournisseur n'est créé) |
| `postedOn` | date civile du fait, jamais future |

#### 2.5 `stock_levels` (cache)

`{ organizationId, itemId, locationId, quantity, lastMovementAt, engineVersion }` : écrit **dans la même
transaction** que chaque mouvement (incrément), unique `{ organizationId, itemId, locationId }`.
**Ce n'est pas une source de vérité** : `POST /stock/levels/rebuild` (`stock.manage`) et la tâche
nocturne `stock.levels-check` le recalculent depuis le grand livre et signalent tout écart
(`STOCK_LEVEL_DRIFT`, journal d'exploitation). La **valeur** n'est jamais stockée : le moteur la
recalcule par rejeu (§ 7) ; elle est mise en cache mémoire par article et version de grand livre.

#### 2.6 `stock_pending_lines` (« À traiter »)

Ce qui arrive d'ailleurs et ne peut pas devenir seul un mouvement juste :

| `reason` | Origine | Résolution (`stock.move`, sauf coût : `stock.manage`) |
|---|---|---|
| `unknown_item` | ligne de réception `receivable` dont `itemRef` ne désigne aucun article | rattacher à un article (le rattachement est mémorisé : `itemRef` → article, pour les réceptions suivantes de la même commande) ou « ne pas stocker » (motif) |
| `unknown_unit` | unité de la ligne absente des conversions de l'article | saisir le facteur (ajouté à l'article) ou la quantité en unité de stock |
| `pending_cost` | entrée en devise différente (§ 2.3.1) | saisir le coût dans la devise de l'article |
| `sale_return_proposed` | avoir de vente (`FA`, `EA`) sur une ligne liée à un article | confirmer la quantité **physiquement revenue** (≤ quantité créditée) et l'emplacement, ou « pas de retour » (une remise ou une correction de prix n'a pas de retour physique) |
| `cost_differs` | constat `ENTRY_COST_DIFFERS_FROM_INVOICE` | corriger le coût ou classer |

Une ligne à traiter porte sa source, son `sourceKey` et ne disparaît qu'en `resolved` ou `dismissed`
(qui, quand, motif). Index : `{ organizationId, status, reason, createdAt }` ; unique partiel
`{ organizationId, sourceKey }`.

#### 2.7 `stock_counts` (inventaires)

| Champ | Règle |
|---|---|
| `number` | `IV{AA}{MM}-NNNNNN` |
| `locationId` | un emplacement par inventaire |
| `scope` | `all` (tous les articles suivis présents ou seuillés à l'emplacement) \| `items` (1 à 500 articles choisis : inventaire tournant) |
| `status` | `draft` → `counting` (lignes figées, comptage ouvert) → `submitted` → `validated` \| `cancelled` |
| `blind` | défaut `true` : le compteur **ne voit pas** la quantité théorique (comptage à l'aveugle) |
| `lines` | `{ id, itemId, countedQuantity \| null, countedAt, countedBy, note }` ; une ligne recomptée garde l'historique (`recounts[]`) |
| `variances` | rendues par le moteur à la soumission et à la validation : théorique **à l'instant du comptage de la ligne** (rejeu des mouvements jusqu'à `countedAt`), écart en quantité, écart valorisé au coût moyen (si l'appelant voit les valeurs) |
| `validation` | `{ by, at, comment, soleApprover }` ; crée un mouvement `count_adjustment` par écart non nul, daté du jour de validation, `sourceKey` = `count:<id>:<ligne>` |
| `assignees` | utilisateurs chargés du comptage (« Mes tâches ») |

**Séparation des tâches** (fonction pure `stockCountDecision` dans `permissions.ts`, motif de
`purchaseApprovalDecision`, aucun `if (role === …)`) : le validateur détient `stock.manage` (effectif) et
**n'a compté aucune ligne** de l'inventaire (`409 COUNT_SELF_VALIDATION`) ; exception **approbateur
unique** : si l'organisation n'a qu'**un** détenteur effectif de `stock.manage`
(`countApprovers(org, 'stock.manage')`), il valide son propre comptage, marqué `soleApprover: true`
et journalisé. Pendant un inventaire `counting`, les mouvements de l'emplacement restent permis (aucun
gel du magasin) : l'écart est calculé à l'instant de chaque comptage. Le **stock initial** se saisit par
un premier inventaire (lignes avec coût unitaire saisi ; écarts positifs valorisés à ce coût).

#### 2.8 `stock_settings`

| Champ | Défaut |
|---|---|
| `salesIssueMode` | `automatic` : toute ligne d'une facture finale liée à un article suivi sort du stock ; `proposed` : elle devient une ligne « À traiter » ; `off` (décision ouverte n° 4) |
| `allowNegativeManualMoves` | `false` (O4) |
| `adjustmentReasons` | sept motifs (§ 2.3), modifiables |
| `countReminderDays` | 0 (aucun rappel d'inventaire périodique) ; 1 à 365 sinon, par emplacement |
| `alertRecipients` | `holders` : détenteurs effectifs de `stock.manage` et responsables d'emplacement |

### 3. Modèle de données — équipements

#### 3.1 `assets`

| Champ | Règle |
|---|---|
| `number` | `EQ-NNNNNN`, compteur **non annuel** par organisation (un registre ne repart pas à zéro) |
| `tag` | étiquette physique facultative (≤ 40), unique partiel |
| `name`, `categoryId` | 1 à 200 ; catégorie de l'organisation |
| `brand`, `model`, `serialNumber` | facultatifs (≤ 80) ; `serialNumber` : avertissement `ASSET_SERIAL_DUPLICATE` |
| `status` | `in_service` \| `in_storage` \| `under_maintenance` \| `lost` \| `disposed` ; `disposed` est terminal (réouverture : `assets.manage`, motif, audit) |
| `acquisition` | `{ on (date), cost, currency, supplierId \| null, supplierInvoiceId \| null, expenseId \| null, note }` ; les liens sont **facultatifs** et vérifiés dans l'organisation ; ils **ne créent rien** (ni dépense, ni dette) |
| `stockItemId` | `null` ; un équipement **sorti du stock** (ex. : ordinateur acheté en lot) garde le lien informatif |
| `locationId` | emplacement courant (facultatif) |
| `currentAssignment` | copie de l'affectation ouverte (§ 3.2), pour les listes |
| `managementDepreciation` | `null` \| `{ years (1–50), residualValue, startOn }` — **estimation de gestion** (§ 9) ; aucune valeur par défaut |
| `disposal` | `null` \| `{ on, kind: 'scrapped' \| 'sold' \| 'donated' \| 'lost' \| 'stolen' \| 'returned', proceeds?, currency?, buyer?, reason, by }` ; une vente déclarée **n'émet aucune facture** et ne crée aucun encaissement (décision ouverte n° 15) |
| `notes` | ≤ 5 000 |

Index : `{ organizationId, status, sortName }` ; `{ organizationId, categoryId }` ;
`{ organizationId, 'currentAssignment.employeeId' }` et `…workProjectId` (partiels) ;
`{ organizationId, 'acquisition.supplierId' }` (partiel).

#### 3.2 `asset_assignments` (ajout seul)

`{ assetId, assignee: { kind: 'employee', employeeId } | { kind: 'project', workProjectId } |
{ kind: 'location', locationId } | { kind: 'member', userId }, from, to | null, handedOverBy, conditionOut,
conditionIn, note }`. Une seule affectation ouverte par équipement (unique partiel `{ organizationId,
assetId }` où `to = null`) ; réaffecter **clôt** l'ouverte et en ouvre une autre dans la même transaction.
Le collaborateur (R4) est lu par identifiant (nom, poste) ; aucune donnée sensible. Un collaborateur sorti
qui garde un équipement lève `ASSET_HELD_BY_FORMER_EMPLOYEE` (brief, fiche).

#### 3.3 `asset_maintenance`

`{ assetId, kind: 'preventive' | 'corrective' | 'inspection', status: 'planned' | 'done' | 'cancelled',
plannedOn, doneOn, cost?, currency?, supplierId?, supplierInvoiceId?, performedBy (texte), note,
recurrence: null | { everyMonths (1–60) } }`. Une intervention préventive **faite** avec récurrence crée
la suivante (`plannedOn` = moteur `nextMaintenanceDate`). Le coût saisi est **informatif** (pas de
dépense créée : elle passe par la trésorerie ou un achat R3, auquel l'intervention se relie). Un
équipement `under_maintenance` le reste jusqu'à `done` ou retour manuel.

#### 3.4 `asset_coverages`

`{ assetId, kind: 'warranty' | 'insurance' | 'service_contract', provider, reference, startOn, endOn,
cost?, currency?, documentId? (bibliothèque), reminderDays (défaut 30) }`. Les échéances alimentent le
brief, la cloche et la vue « Échéances ». Aucune règle d'assurance obligatoire n'est posée.

#### 3.5 `asset_categories`, `asset_settings`

Catégories proposées à l'activation (modifiables, **sans durée**) : Informatique, Téléphonie, Véhicules,
Machines et outillage, Mobilier, Autre. Réglages : `reminderDays` (défaut 30), `maintenanceDueSoonDays`
(défaut 7), `showDepreciationEstimate` (défaut `true` pour un équipement dont la durée est saisie).

### 4. Modèle de données — documents (bibliothèque)

#### 4.1 `document_folders`

| Champ | Règle |
|---|---|
| `name`, `parentId` | 1 à 120 ; arborescence de profondeur ≤ 5, sans cycle (`409 FOLDER_CYCLE`) |
| `access.read` | `'all'` (tout détenteur de `docs.read`) \| `{ action: Action }` (droit **par nature** : ex. dossier « Finances » réservé à `treasury.read`) \| `{ userIds: [] }` (dossier restreint) |
| `access.write` | `'managers'` (détenteurs de `docs.manage`) \| `{ userIds: [] }` (en plus des gestionnaires) |
| `inherit` | défaut `true` : un sous-dossier hérite des droits de son parent ; un sous-dossier ne peut **qu'ajouter** des restrictions, jamais élargir |

Les droits se jugent sur les **droits effectifs** et les **personnes**, jamais sur le rôle (fonction pure
`folderAccessDecision`, testée). Un dossier restreint par `userIds` n'est **visible** (nom compris) que de
ses membres et du Propriétaire ; `docs.manage` ne l'ouvre pas. Dossiers proposés à l'activation :
« Juridique », « Assurances », « Contrats », « Fiscal et administratif » (lecture `treasury.read`),
« Divers ».

#### 4.2 `library_documents` et `library_document_versions`

| Champ | Règle |
|---|---|
| `title` | 1 à 200 ; `searchKey` normalisé |
| `folderId` | `null` (pièce seulement liée à des entités) ou un dossier |
| `nature` | `contract` \| `certificate` \| `license` \| `insurance` \| `legal` \| `policy` \| `technical` \| `other` |
| `tags` | 0 à 10, 1 à 40 caractères, normalisés |
| `links` | 0 à 10 `{ entityType, entityId }` ; `entityType` ∈ `customer`, `supplier`, `work_project`, `crm_account`, `asset`, `stock_item`, `purchase_order` ; jamais `employee` (les pièces RH restent dans `hr_documents`) |
| `issuedOn`, `expiresOn`, `reminderDays` | facultatifs ; `reminderDays` défaut 30 |
| `sensitive` | défaut `false` ; `true` ⇒ chiffrement par enveloppe (§ 4.3), téléchargement journalisé strictement |
| `currentVersionId`, `versionCount` | version courante ; 1 à 50 versions |
| `status` | `active` \| `archived` ; `deletedAt` (suppression logique, puis effacement des objets par la tâche `documents.purge` après 30 jours) |

Une **version** : `{ documentId, number, objectKey (documents/<objectId> au hasard), fileName, type,
size, sha256, wrappedKey (si sensible), uploadedBy, uploadedAt, note }`. Ajouter une version ne supprime
pas l'ancienne ; on en restaure une en la recopiant comme nouvelle version.

**Lecture d'un document** = accès au dossier (s'il en a un) **et**, pour chaque lien, la permission de
lecture du module de l'entité (`sales.read`, `purchase.read`, `work.read`, `crm.read`, `assets.read`,
`stock.read`) — l'intersection, la plus restrictive. Un document sans dossier n'est lu que par ses liens.
Un document invisible rend **404**. Index : `{ organizationId, folderId, sortTitle }` ;
`{ organizationId, 'links.entityType', 'links.entityId' }` ; `{ organizationId, tags }` ;
`{ organizationId, expiresOn }` (partiel) ; `{ organizationId, searchKey }`.

#### 4.3 Fichiers, chiffrement, métadonnées

- **Types et tailles** : motif exact d'ADR-0039 § 2.5 — PNG, JPEG, WebP ≤ 2 Mio **assainis** ; PDF ≤ 10
  Mio reconnus par `%PDF-`, **non analysés**, servis **en téléchargement inerte** (`Content-Disposition:
  attachment`, `nosniff`, `Content-Security-Policy: sandbox`) ; autre type : `415 DOCUMENT_TYPE` (formats
  bureautiques : décision ouverte n° 18). 30 envois par heure et par utilisateur ; **borne commune de
  1 Gio** par organisation avec les pièces des projets, des achats et des RH (décision ouverte n° 19).
- **Chiffrement** : un document **sensible** est chiffré côté application par **enveloppe**, motif exact
  de `hr/documents/hr-document-crypto.ts` (clé de données par fichier, AES-256-GCM, AAD = organisation +
  document + version, clé enveloppée sous `MASTER_KEYRING` à l'emplacement `org:library_documents`),
  dans un fichier propre `documents/library-document-crypto.ts` (format `LLD1`) ; `secrets:rewrap` couvre
  ces clés. Les autres reposent sur le chiffrement du stockage objet. Sans trousseau, un envoi sensible
  est refusé (`503 SECRETS_NOT_CONFIGURED`).
- **Métadonnées jamais dans l'URL ni dans un en-tête** (leçon du lot H4 d'ADR-0045) : envoi en
  `multipart/form-data` (partie `file`, champs `title`, `folderId`, `nature`, `tags`, `links`, dates,
  `sensitive`, nom du fichier) ; la **recherche** est `POST /documents/search` avec un corps ; les listes
  par entité ne prennent en requête que des **identifiants** (`?entityType=supplier&entityId=<id>`),
  jamais un titre, un nom ni une étiquette. Test e2e : le titre et les étiquettes n'apparaissent ni dans
  `req.url` ni dans les en-têtes.
- **Recherche** : par titre, étiquettes, nature, dossier, entité liée, dates d'expiration et auteur ;
  **jamais dans le contenu** (aucune analyse de PDF, aucun OCR). Résultats filtrés par les droits de
  lecture **avant** pagination (un résultat invisible n'est pas compté).

### 5. Contrat HTTP

Tous les contrôleurs : `@UseGuards(AuthGuard, PermissionsGuard)`, `@RequirePermission(…)` par route ;
corps `.strict()`, montants et quantités en chaînes, erreurs au format des contrôleurs d'achats, listes
paginées par curseur. Modules API `apps/api/src/stock/` (`StockModule`), `apps/api/src/assets/`
(`AssetsModule`), `apps/api/src/documents/` (`DocumentsModule`). **Valeurs** (coûts, valeurs de stock,
écarts valorisés) : servies seulement si l'appelant détient aussi `purchase.read` **ou** `treasury.read` ;
sinon les champs valent `null` et la réponse porte `valuesHidden: true` (motif des montants du brief).

#### 5.1 Stocks

| Méthode et chemin | Permission | Effet |
|---|---|---|
| `GET /stock/items` · `GET …/:id` · `GET …/:id/movements` | `stock.read` | articles, quantités par emplacement, coût moyen et valeur (si valeurs visibles), seuil, constats |
| `POST /stock/items` · `PUT …/:id` · `…/archive` · `…/restore` | `stock.manage` | `409 STOCK_ITEM_CODE_EXISTS`, `CATALOG_ITEM_ALREADY_STOCKED`, `STOCK_ITEM_NOT_EMPTY` ; `422 CATALOG_ITEM_NOT_STOCKABLE` |
| `GET /stock/locations` · `POST` · `PUT …/:id` · `…/archive` | `stock.read` · `stock.manage` | emplacements |
| `GET /stock/levels?locationId=&below=reorder` | `stock.read` | stock en temps réel par emplacement ; `below=reorder` : sous le seuil |
| `POST /stock/levels/rebuild` | `stock.manage` | recalcul du cache depuis le grand livre ; rapport d'écarts |
| `GET /stock/vouchers` · `POST` · `PUT …/:id` · `…/post` · `…/cancel` | `stock.read` · `stock.move` (ajustement : `stock.manage`) | bons de sortie, de transfert, de retour ; `409 STOCK_INSUFFICIENT` ; numéros `BS`, `BT`, `BJ` |
| `GET /stock/pending` · `POST …/:id/resolve` · `…/dismiss` | `stock.read` · `stock.move` (coût : `stock.manage`) | « À traiter » (§ 2.6) |
| `PUT /stock/movements/:id/cost` | `stock.manage` | seule correction permise d'un mouvement ; audit strict ; valeurs recalculées |
| `GET /stock/counts` · `POST` · `…/:id/start` · `PUT …/:id/lines/:lineId` · `…/submit` · `…/cancel` | `stock.read` · `stock.count` (création, départ : `stock.manage`) | comptage ; quantité théorique masquée au compteur si `blind` |
| `POST /stock/counts/:id/validate` | `stock.manage` | `409 COUNT_SELF_VALIDATION` ; approbateur unique marqué ; mouvements `count_adjustment` |
| `GET /stock/valuation?on=&locationId=` | `stock.read` + (`purchase.read` ou `treasury.read`) | valeur par article et **par devise** à une date (rejeu), sans total toutes devises |
| `GET /stock/replenishment` | `stock.read` | suggestions (moteur `replenishmentSuggestions`) : article, emplacement, disponible, seuil, quantité suggérée, fournisseur préféré ; **aucune écriture** |
| `GET /stock/reports?from=&to=` | `stock.read` | entrées, sorties par nature, consommations par projet, rotation, articles dormants ; valeurs si visibles |
| `POST /stock/sync` | `stock.manage` | lance à la demande les rattrapages achats et ventes (§ 6.1, § 6.2) ; 6 par heure |
| `GET /stock/settings` · `PUT` | `stock.read` · `stock.manage` | § 2.8 |

#### 5.2 Équipements

| Méthode et chemin | Permission | Effet |
|---|---|---|
| `GET /assets?status=&categoryId=&employeeId=&workProjectId=&supplierId=` · `GET …/:id` | `assets.read` | registre ; coûts et estimation de valeur si `purchase.read` ou `treasury.read` |
| `POST /assets` · `PUT …/:id` · `…/dispose` · `…/reinstate` | `assets.manage` | numéro `EQ-…` ; liens d'acquisition vérifiés ; cession journalisée |
| `POST /assets/:id/assign` · `…/return` · `GET …/:id/assignments` | `assets.manage` · `assets.read` | affectation à un collaborateur, un membre, un projet ou un emplacement ; historique |
| `GET /assets/:id/maintenance` · `POST` · `PUT …/:mid` · `…/:mid/done` | `assets.read` · `assets.manage` | interventions ; récurrence |
| `GET /assets/:id/coverages` · `POST` · `PUT` · `DELETE` | `assets.read` · `assets.manage` | garanties, assurances, contrats |
| `GET /assets/deadlines?within=` | `assets.read` | maintenances dues, garanties et assurances qui expirent |
| `GET /assets/reports` | `assets.read` | registre par catégorie, statut, affectation ; coûts et **estimation de gestion** si valeurs visibles |
| `GET /assets/export.csv` | `assets.read` + `report.export` | registre (`;`, BOM, formules neutralisées), audit strict `assets.register.exported` |
| `GET /assets/categories` · `POST` · `PUT` · `GET /assets/settings` · `PUT` | `assets.read` · `assets.manage` | § 3.5 |

#### 5.3 Documents

| Méthode et chemin | Permission | Effet |
|---|---|---|
| `GET /documents/folders` · `POST` · `PUT …/:id` · `…/archive` | `docs.read` (arbre filtré) · `docs.manage` | `409 FOLDER_CYCLE` ; droits par dossier |
| `GET /documents?folderId=&entityType=&entityId=` · `GET …/:id` | `docs.read` + droits du dossier et des liens | identifiants seulement en requête |
| `POST /documents/search` | `docs.read` | corps : texte, étiquettes, nature, dossier, entité, expiration ; filtré **avant** pagination |
| `POST /documents` · `POST …/:id/versions` | `docs.read` + écriture du dossier (`docs.manage` ou membre de `access.write`) ; sensible : `docs.manage` | `multipart/form-data` ; 30 par heure ; `413`, `415 DOCUMENT_TYPE` ; borne commune |
| `PUT …/:id` (métadonnées, liens) · `…/archive` · `DELETE` | écriture du dossier | lier à une entité exige la permission de lecture de son module |
| `GET …/:id/versions/:vid/file` | lecture du document | téléchargement inerte ; audit strict si sensible ; jamais servi à un acteur plateforme si sensible |
| `GET /documents/deadlines?within=` | `docs.read` | documents qui expirent, filtrés par droits |
| `GET /documents/entity-pieces?entityType=&entityId=` | lecture de l'entité | **présentation** (O5) : documents de bibliothèque liés **et** pièces des modules propriétaires (achats, projets) lus par ports, chacune filtrée par sa permission ; jamais de pièce RH |

Contrôleurs nouveaux à inscrire dans `routes-coverage.test.ts` : `StockItemsController`,
`StockLocationsController`, `StockLevelsController`, `StockVouchersController`, `StockPendingController`,
`StockCountsController`, `StockReportsController`, `StockSettingsController`, `AssetsController`,
`AssetMaintenanceController`, `AssetSettingsController`, `DocumentFoldersController`,
`LibraryDocumentsController`.

### 6. Liens avec les modules existants

#### 6.1 Achats (R3) : entrées par réception — branchement de l'accroche

- **Fournisseur du port** : `StockReceptionSink` (`apps/api/src/stock/purchases/stock-reception.sink.ts`)
  remplace `noPurchaseReceptionSink` — **une ligne** dans `purchases.module.ts` (`useExisting` vers le
  fournisseur exporté par `StockPurchasesLinkModule`). Aucun autre fichier des achats ne change.
- **Traitement** (`applyReception(organizationId, receptionId)`, idempotent) : relit la réception et la
  commande **en lecture seule** (modèles Mongoose en lecture sur `purchase_receptions` et
  `purchase_orders`, dans le module des stocks) ; pour chaque ligne `receivable` d'une réception
  `recorded`, résout l'article (`itemRef` = `stk:<id>`, sinon `codeKey` égal au code de l'article, sinon
  ligne « À traiter ») et l'unité (conversion, sinon « À traiter »), puis écrit `purchase_receipt`
  (`sourceKey` `reception:<id>:<ligne>:in`) à l'emplacement par défaut de l'article, daté `receivedOn`, au
  coût d'entrée (§ 2.3.1), `workProjectId` de la ligne. Pour une réception `cancelled` : un
  `purchase_receipt_reversal` par entrée existante (constaté, O4).
- **Rattrapage** : tâche `stock.purchase-sync` (toutes les 10 minutes) qui relit les réceptions modifiées
  depuis son point (`stock_sync_checkpoints`, recouvrement de 15 minutes) et rejoue `applyReception` :
  un appel perdu (erreur avalée par R3, redémarrage) est rattrapé ; rien n'est écrit deux fois (index
  unique `sourceKey`).
- **Une ligne de service** (`receivable: false`) n'entre jamais en stock. Une réception **antérieure** à
  l'activation des stocks n'est pas rejouée (point initial = activation ; décision ouverte n° 7).
- **Suggestion d'achat** (`GET /stock/replenishment`) : l'écran propose « Préparer une demande d'achat »,
  qui ouvre le formulaire **existant** de R3 prérempli (fournisseur préféré, lignes `itemRef = stk:<id>`,
  quantités suggérées) ; la demande n'est créée que si l'utilisateur, détenteur de `purchase.request`,
  l'enregistre. **Jamais automatique**, aucun appel d'API des stocks vers les achats.

#### 6.2 Ventes : sorties par facture émise — lecture après émission

- Tâche **`stock.sales-sync`** (toutes les 5 minutes, et `POST /stock/sync`) : relit, **en lecture seule**,
  les `sales_invoices` de type `FV` ou `EV` au statut `issued` ou `normalized` dont `issuedAt` (ou la date
  de normalisation) est postérieure à son point ; pour chaque ligne dont `catalogItemId` est lié à un
  article **suivi**, écrit un `sale_issue` (`sourceKey` `invoice:<id>:<index>`) daté du jour d'émission, à
  l'emplacement du point de vente (`pointOfSaleIds`) ou par défaut de l'article, quantité convertie
  (unité de la ligne figée ; inconnue : « À traiter »).
- **Jamais** : ni écriture dans `sales_invoices`, son journal, ses compteurs ou sa normalisation ; ni
  lecture d'un brouillon, d'une facture `pending_normalization` ou `normalization_failed` (une facture qui
  revient en brouillon n'a jamais été sortie) ; ni blocage d'une émission faute de stock. Une facture
  d'acompte (`FT`, `ET`) ne sort rien.
- **Avoirs** (`FA`, `EA`) finaux : une ligne liée à un article devient `sale_return_proposed` (§ 2.6),
  **jamais** une rentrée automatique (un avoir peut être une remise sans retour physique).
- `salesIssueMode = proposed` : chaque ligne devient « À traiter » au lieu d'un mouvement ; `off` : rien.
- Le coût des ventes (sorties valorisées au coût moyen) est un **indicateur de gestion** des rapports de
  stock ; il n'entre ni dans le réalisé, ni dans la marge des projets, ni dans une facture.

#### 6.3 Trésorerie et réalisé (ADR-0034)

**Aucune écriture.** Le stock n'est pas de l'argent : un achat entre dans la trésorerie quand il est payé
(R3), une vente quand elle est encaissée (ADR-0031). La prévision ne change pas : les suggestions de
réapprovisionnement ne sont pas des engagements (décision ouverte n° 11) ; une commande approuvée l'est
déjà, par R3. Le registre des équipements **lit** les dépenses de catégorie `investissement` pour un
constat informatif `INVESTMENT_EXPENSES_WITHOUT_ASSET` (dépenses d'investissement non reliées à un
équipement, avec `treasury.read`).

#### 6.4 Projets RUN et marge (ADR-0039 § 5)

- Un bon de sortie peut viser un projet ; une réception imputée à un projet porte son `workProjectId`.
- **Ajout informatif** (`WORK_MARGIN_VERSION` **1.3.0**, sorties existantes inchangées) : `materials:
  [{ currency, consumedValue, issueCount, unvaluedCount }]` = sorties `issue` nettes des retours
  imputées au projet, valorisées au coût moyen, par devise de coût. **Jamais soustrait** de la marge :
  l'achat de ce matériel y est déjà, ou y sera, par sa dépense (R3, ADR-0034) ; le soustraire compterait
  deux fois. L'écran l'affiche sous la marge : « Matériel sorti du stock — informatif » (décision ouverte
  n° 12). Port `WORK_STOCK_SOURCE` (`work/margin/work-stock.port.ts`), fournisseur nul par défaut, `null`
  sans `stock.read` **et** valeurs visibles.
- Équipements affectés au projet : liste sur la fiche projet (`assets.read`).

#### 6.5 Ressources humaines (R4)

- Fiche collaborateur : « Matériel affecté » (`GET /assets?employeeId=`, `assets.read`), sans modifier
  `/hr`.
- Sortie d'un collaborateur : la fiche liste le matériel encore affecté ; l'élément « matériel repris » de
  la liste de départ ouvre cette liste ; **aucune** reprise automatique. Constat
  `ASSET_HELD_BY_FORMER_EMPLOYEE` (brief R17, fiche équipement).
- Les documents RH restent dans `hr_documents` ; la bibliothèque ne les affiche jamais (O5).

#### 6.6 Brief du matin (ADR-0033)

Ports **`STOCK_SOURCE`**, **`ASSETS_SOURCE`**, **`DOCUMENTS_SOURCE`** (`morning-brief.ports.ts`),
fournisseurs réels dans `stock/brief/`, `assets/brief/`, `documents/brief/`, nuls par défaut ; faits
(`MORNING_BRIEF_VERSION` **1.5.0**), **des nombres seulement** :

- `stock.ruptures` (articles suivis à quantité ≤ 0 à un emplacement), `stock.sous_seuil`, `stock.a_traiter`
  (lignes « À traiter ») — `stock.read`, sinon `hidden` ;
- `equipements.maintenances_dues` (prévues à `maintenanceDueSoonDays` jours ou en retard),
  `equipements.couvertures_expirant` (garanties, assurances, contrats), `equipements.chez_anciens` —
  `assets.read` ;
- `documents.expirant` — documents **lisibles par l'appelant** expirant sous leur `reminderDays`.

Règles : **R16 `ruptures_et_seuils`** (rang 16, `attention`) : `stock.ruptures + stock.sous_seuil` > 0 ;
« N articles en rupture ou sous le seuil » ; « Voir les suggestions de réapprovisionnement » ;
`actionPath: '/stocks/reapprovisionnement'`. **R17 `maintenances_dues`** (rang 17, `attention`) :
`equipements.maintenances_dues + equipements.chez_anciens` > 0 ; `/equipements/echeances`.
**R18 `echeances_documents_et_garanties`** (rang 18, `info`) : `equipements.couvertures_expirant +
documents.expirant` > 0 ; `/documents/echeances`. L'IA du brief les **explique** sans les produire ; elle
ne reçoit que ces nombres, jamais un titre de document. E-mail quotidien : mêmes faits, même garde.

#### 6.7 « Mes tâches » et cloche

- Ports **`STOCK_AGENDA_SOURCE`** et **`ASSETS_AGENDA_SOURCE`** (`work/my-tasks.ports.ts`), agrégation à la
  lecture, motif de `PURCHASES_AGENDA_SOURCE` : inventaires à compter (assigné), inventaires à valider
  (détenteurs effectifs de `stock.manage` éligibles, pas les compteurs), maintenances prévues dont
  l'appelant est responsable ; élément `{ source: 'stock' | 'assets', id, title, dueDate, href }`, sans
  case à cocher. Au plus 200 éléments, `truncated` signalé.
- **Notifications** (modules `stock`, `assets`, `documents` ; entités `stock_item`, `stock_count`,
  `asset`, `library_document`), refiltrées à la lecture :

| Type | Déclencheur | Destinataires |
|---|---|---|
| `stock.below_reorder` | passage sous le seuil (une fois par article, emplacement et franchissement) | détenteurs effectifs de `stock.manage`, responsable de l'emplacement |
| `stock.negative` | stock négatif constaté (O4) | idem |
| `stock.pending_lines` | nouvelles lignes « À traiter » (regroupées, au plus une par heure) | détenteurs de `stock.move` |
| `stock.count_assigned` · `stock.count_submitted` | inventaire assigné · soumis | compteurs · validateurs éligibles |
| `assets.maintenance_due` · `assets.coverage_expiring` | tâche `assets.reminders` (quotidienne, `dedupeKey`) | détenteurs de `assets.manage`, responsable |
| `documents.expiring` | tâche `documents.reminders` (quotidienne, `dedupeKey`) | auteur du document et détenteurs de `docs.manage` **qui peuvent le lire** |

#### 6.8 Fiches fournisseur, client, compte CRM, projet ; Accueil

- Fiche fournisseur (`/achats/fournisseurs/[id]`) : sections « Articles fournis » (`stock.read`),
  « Équipements acquis » (`assets.read`), « Documents » (présentation O5) — chargées par l'écran depuis les
  API des stocks, des équipements et des documents ; **aucune** modification de
  `GET /purchases/suppliers/:id/overview`.
- Fiches client, compte CRM, projet, équipement, article : panneau « Documents » (présentation O5).
- **Accueil, carte RUN** : tuile « Articles sous le seuil » (`GET /stock/levels?below=reorder`, nombre
  seulement, `stock.read`), placée après les factures ouvertes et avant les chiffres des achats et du
  CRM ; `MAX_TUILES_RUN` reste 4 (la dernière tuile de la liste cède sa place).

#### 6.9 GROW, IA

Rien en GROW (rotation des stocks, valeur du parc : définitions sourcées à poser d'abord). **IA** : elle
peut expliquer un écart d'inventaire, une rupture ou une échéance à partir des faits servis ; elle ne crée,
ne déplace, ne valide, n'affecte ni ne supprime rien. Aucun document de bibliothèque ni son titre n'est
servi à OpenAI (`ai-contexts.audit.test.ts` étendu).

### 7. Moteur

#### 7.1 `packages/engine/src/stock/` — `STOCK_VERSION = '1.0.0'`

Fonctions pures, jour de référence en paramètre, `bigint` (quantités en millièmes, montants en centimes,
coût unitaire en millionièmes), chaînes décimales en sortie, **jamais de conversion**, chaque résultat
porte `{ version }`.

| Fonction | Rôle |
|---|---|
| `toStockQuantity(quantity, unit, item)` | conversion par `unitConversions` ; arrondi demi vers le haut au millième ; `UNKNOWN_UNIT` |
| `entryUnitCost(orderLine, item)` | prix HT après remise ÷ facteur ; six décimales |
| `weightedAverageValuation(movements, item, until?)` | rejeu chronologique (`occurredOn`, puis ordre d'écriture) : entrée valorisée : `valeur += q × coût` (arrondi au centime), CMUP = valeur ÷ quantité ; sortie : `valeur −= q × CMUP` (au centime) ; quantité ramenée à 0 : valeur remise à 0 et reste d'arrondi rendu (`roundingResidue`) ; entrée alors que la quantité est ≤ 0 : le CMUP repart du coût de cette entrée ; entrée `pending_cost` : quantité comptée, valorisation marquée `incomplete` (valeur des seules entrées valorisées, constat `UNVALUED_ENTRIES`) ; rend quantité, valeur, CMUP, coût de chaque sortie |
| `stockLevels(movements)` | quantité par article et emplacement (sert au contrôle du cache) |
| `countVariances(lines, movements)` | théorique à `countedAt` de chaque ligne, écart, écart valorisé |
| `replenishmentSuggestions(levels, items, openOrders?)` | disponible < seuil ⇒ suggestion = `targetQuantity − disponible` (ou `minQuantity − disponible` sans cible), arrondie à l'unité entière supérieure si l'unité est discrète ; les quantités déjà **commandées non reçues** (lues de R3, `itemRef` reconnu) sont déduites et affichées |
| `stockFindings(...)` | `NEGATIVE_STOCK`, `BELOW_REORDER`, `UNVALUED_ENTRIES`, `ENTRY_COST_DIFFERS_FROM_INVOICE`, `DORMANT_ITEM` (aucun mouvement depuis N jours, réglable) |
| `stockReport(movements, items, period)` | entrées, sorties par nature, consommations par projet, coût des ventes, **par devise** |
| `projectMaterials(movements, items)` | § 6.4 |

#### 7.2 `packages/engine/src/assets/` — `ASSETS_VERSION = '1.0.0'`

| Fonction | Rôle |
|---|---|
| `managementDepreciationEstimate(asset, onDate)` | **linéaire mensuel** : base = coût − valeur résiduelle, répartie sur `years × 12` mois à partir du mois de `startOn` (mois entamé compté), au centime, reste d'arrondi sur le dernier mois ; rend `{ estimatedValue, consumedPercent, endOn, label: 'management_estimate' }` ; `null` sans paramètres ; arrêt à la cession |
| `nextMaintenanceDate(lastDoneOn, everyMonths)` | fin de mois bornée (31 janv. + 1 mois = 28 ou 29 févr.) |
| `expiryStatus(endOn, reminderDays, today)` | `expired` \| `due_soon` \| `ok` (partagée avec la bibliothèque) |
| `assetDeadlines(assets, maintenance, coverages, today, settings)` | maintenances dues, couvertures expirant, équipements chez d'anciens collaborateurs |
| `assetRegisterSummary(assets)` | nombres par catégorie et statut ; coûts d'acquisition **par devise** |

Modifiés : `work/margin.ts` (`WORK_MARGIN_VERSION` 1.3.0, § 6.4), `morning-brief` (1.5.0, § 6.6). Rien
n'écrit dans `actual_periods`, un plan, un scénario, la trésorerie ou une facture.

### 8. Permissions (amende ADR-0012, docs/12 ; étend ADR-0041)

#### 8.1 Huit actions nouvelles (trente-neuvième à quarante-sixième, en fin d'`ACTIONS`)

| Action | Libellé (ADR-0041 § 5) | Couvre |
|---|---|---|
| `stock.read` | Consulter les stocks | articles, emplacements, quantités, mouvements, inventaires, suggestions ; **valeurs** seulement avec `purchase.read` ou `treasury.read` |
| `stock.move` | Mouvementer le stock | bons de sortie, de transfert, de retour ; « À traiter » (hors coût) |
| `stock.count` | Compter un inventaire | saisir les quantités comptées des inventaires ouverts |
| `stock.manage` | Gérer les stocks et valider les écarts | articles, emplacements, réglages, coûts d'entrée, ajustements, création et **validation** d'inventaire (case ⓢ) |
| `assets.read` | Consulter les équipements | registre, affectations, maintenance, garanties ; coûts et estimation avec `purchase.read` ou `treasury.read` |
| `assets.manage` | Gérer les équipements | fiches, affectations, maintenance, couvertures, cession |
| `docs.read` | Consulter la bibliothèque de documents | documents des dossiers ouverts à l'appelant |
| `docs.manage` | Gérer la bibliothèque de documents | dossiers et leurs droits, tous dossiers non restreints, documents sensibles |

| Action | PRO | ADM | DIR | CPT | ANA | CDP | CON | LEC | COM | RH | MAG |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| `stock.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ | ✗ | ✓ |
| `stock.move` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| `stock.count` | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| `stock.manage` | ✓ⓢ | ✓ⓢ | ✓ⓢ | ✓ⓢ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `assets.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ | ✓ | ✓ |
| `assets.manage` | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `docs.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ |
| `docs.manage` | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |

Justifications :

- **`stock.read`** : quantités et emplacements ne révèlent ni prix ni dette ; le **Commercial** en a besoin
  pour promettre une livraison (il ne voit pas les valeurs : ni `purchase.read` ni `treasury.read`) ; le
  **Responsable RH** n'en a pas l'usage ; le **Conseiller** (externe) et le **Chef de projet** (non
  attribuable) n'ont rien.
- **`stock.move`** : geste opérationnel. Propriétaire, Administrateur (il prépare et exécute, comme pour les
  achats), Directeur financier, **Magasinier**. Le **Comptable** constate et compte, il ne sort pas de
  marchandise (séparation garde / enregistrement).
- **`stock.count`** : ceux qui sortent la marchandise **et** le Comptable (contrôle indépendant).
- **`stock.manage`** : il change des **valeurs** (coûts, écarts) ; Propriétaire, Administrateur, Directeur
  financier, Comptable, en case ⓢ (`stockCountDecision`, § 2.7). **Pas le Magasinier** : celui qui garde le
  stock ne valide pas l'écart de son propre stock.
- **`assets.read`** : tout rôle interne qui gère ou contrôle, le **Responsable RH** (matériel remis et repris
  aux entrées et sorties ; coûts masqués : ni `purchase.read` ni `treasury.read`) et le **Magasinier** ;
  pas le Commercial (aucun besoin).
- **`assets.manage`** : Propriétaire, Administrateur, Directeur financier, Comptable (registre, cession).
  Le Responsable RH et le Magasinier **lisent** ; leur donner la gestion est la décision ouverte n° 3.
- **`docs.read`** à tout rôle **interne** ; les dossiers restreignent ensuite (§ 4.1). Le **Conseiller**,
  externe, n'y a pas accès par défaut (décision ouverte n° 17 : dossiers partagés avec lui).
- **`docs.manage`** : Propriétaire, Administrateur, Directeur financier, Comptable (pièces fiscales et
  administratives), Responsable RH (règlement intérieur, politiques) ; un détenteur de `docs.read` écrit
  aussi dans un dossier qui le désigne (`access.write`).
- **Plateforme** : `stock.read`, `assets.read`, `docs.read` sous accès délégué pour le super-administrateur
  et le support ; `stock.move`, `stock.count`, `stock.manage`, `assets.manage`, `docs.manage` sous accès
  délégué pour le **seul** super-administrateur ; un document **sensible** n'est **jamais** servi à un
  acteur plateforme (règle de service testée, motif de `hr.sensitive.read`), sans nouvel interdit absolu
  dans `PLATFORM_FORBIDDEN_ACTIONS`.

#### 8.2 Rôle nouveau Magasinier (O6)

- Slug `storekeeper`, colonne **MAG**, libellé « Magasinier », description « Réceptionne, range, sort et
  compte le stock ; consulte le matériel et les documents. Ne voit ni les prix d'achat, ni la valeur du
  stock, ni la trésorerie, ni les ventes. », **rang 7** (après `hr_manager` ; `project_manager`, `advisor`,
  `viewer` passent à 8, 9 et 10 — le rang n'est pas un droit).
- **Neuf actions**, socle compris : `analytics.read`, `stock.read`, `stock.move`, `stock.count`,
  `assets.read`, `docs.read`, `work.read`, `work.update`, `leave.request` ; tout le reste ✗, dont
  `stock.manage`, `purchase.*` (il ne saisit pas la réception d'achat : elle reste à `purchase.manage` ;
  décision ouverte n° 9), `treasury.*`, `sales.*`.
- **R7** : l'attribuent les acteurs dont les droits effectifs contiennent les neuf actions — Propriétaire,
  Administrateur, Directeur financier. Pas dans `OWNER_ONLY_ROLES` : le rôle ne lit aucune donnée
  sensible.
- Avant d'attribuer `storekeeper`, toutes les instances de l'API doivent être à jour (consigne de
  `sales_rep` et `hr_manager`, docs/12). Aucune migration.
- Matrice : **11 × 46 + 6 × 46 = 782** cases.

#### 8.3 Compatibilité avec ADR-0041

- **Dépendances** : `stock.move`, `stock.count`, `stock.manage` → `stock.read` ; `assets.manage` →
  `assets.read` ; `docs.manage` → `docs.read`. Chaque ligne de la matrice les satisfait (test).
- **Domaines** : dixième « Stocks » (quatre actions), onzième « Équipements » (deux), douzième
  « Documents » (deux), libellés du § 8.1.
- **Séparation des tâches** : dynamique (`stockCountDecision`) ; `stock.manage` rejoint
  `APPROVAL_ACTIONS` (cases ⓢ, comptage des approbateurs). **Aucune paire `SOD_PAIRS` nouvelle** : une
  paire statique `stock.count` + `stock.manage` empêcherait le Comptable, le Directeur financier et le
  Propriétaire de compter, alors que la règle utile (« ne pas valider son propre comptage ») est
  dynamique (motif d'ADR-0045 § 4.5).
- **Non délégable** : rien de nouveau. **Destinataires** : par `holdersOf` (droits effectifs), jamais par
  `role: { $in: … }`.

### 9. Comptabilité et fiscalité : ce que cet ADR n'invente pas

| Sujet | Ce que fait Lalanda en R5 |
|---|---|
| Valorisation des stocks | coût moyen pondéré **de gestion** (O2), par devise de coût ; son emploi pour l'inventaire comptable de fin d'exercice est à confirmer par l'expert-comptable (décision ouverte n° 5) |
| Coût d'entrée (taxes, frais d'approche, douane) | prix HT de la commande après remise ; rien d'autre n'est incorporé (décision ouverte n° 6) |
| Dépréciation des stocks, provisions | **aucune** |
| Amortissement | **estimation de gestion** linéaire, paramètres saisis par l'utilisateur, aucune durée par défaut, étiquetée partout « Estimation de gestion — n'est pas un amortissement comptable ou fiscal » ; jamais dans le réalisé, le plan, un export comptable ; les durées SYSCOHADA du plan ne sont pas reprises (décision ouverte n° 13) |
| Cession d'un équipement (plus-value, TVA, facture) | déclarée seulement ; aucune facture, aucun encaissement, aucun calcul de résultat de cession (décision ouverte n° 15) |
| Conservation des documents | aucune durée légale posée ; suppression à la main, purge des objets après 30 jours (décision ouverte n° 16) |
| Assurance obligatoire, contrôle technique | aucune règle ; échéances saisies |
| Sortie de vente | lue sur la facture figée ; **aucune** incidence sur la facture, son numéro, son empreinte, sa normalisation |

## Hors périmètre (R5), dit explicitement

- **Comptabilité générale** : écritures de stock, variation de stock, inventaire permanent comptable,
  journaux, plan OHADA (ADR-0018).
- **Fiscalité de l'amortissement**, amortissement dégressif, plan d'amortissement comptable, tableau des
  immobilisations pour la liasse.
- **Code-barres, QR d'étiquette, lecteurs et terminaux** : lot futur proposé (« S-Scan » : `barcode` sur
  l'article et l'équipement, impression d'étiquettes, saisie par caméra du téléphone dans le comptage et
  les bons) ; les champs `code` et `tag` le préparent.
- **Production et nomenclatures** (ordres de fabrication, recettes, kits), lot futur ; **lots et numéros
  de série** de marchandises, **dates de péremption** par lot (décision ouverte n° 10).
- **Réservations** de stock pour une commande client ou un devis, préparation de commandes, expéditions,
  transporteurs.
- **Achat automatique** : la suggestion n'est jamais une demande d'achat.
- **IA qui agit** : elle explique, ne mouvemente, ne valide, n'affecte, ne classe ni ne supprime rien.
- **GED avancée** : signature électronique, circuit de validation de document, OCR, recherche plein texte
  dans le contenu, édition en ligne, partage public par lien, portail externe.
- **Migration** des pièces jointes existantes (O5).
- Multi-sociétés, conversion de devises, inventaire valorisé consolidé toutes devises.

## Conséquences

- Collections nouvelles : `stock_items`, `stock_locations`, `stock_movements`, `stock_vouchers`,
  `stock_levels`, `stock_pending_lines`, `stock_counts`, `stock_settings`, `stock_sync_checkpoints`,
  `stock_counters`, `assets`, `asset_categories`, `asset_assignments`, `asset_maintenance`,
  `asset_coverages`, `asset_settings`, `asset_counters`, `document_folders`, `library_documents`,
  `library_document_versions`. Toutes portent `organizationId`. **Aucune migration** ; aucune collection
  existante ne gagne de champ.
- Une ligne change dans les achats (`purchases.module.ts`, fournisseur du port) ; **aucune** dans les ventes.
- RBAC : onze rôles, **quarante-six actions** ; matrice 782 cases ; trois domaines, des dépendances,
  `stock.manage` dans `APPROVAL_ACTIONS` ; docs/12, ADR-0012, sonde e2e, couverture des routes et types web
  alignés.
- Moteur : `STOCK_VERSION` 1.0.0, `ASSETS_VERSION` 1.0.0 ; `WORK_MARGIN_VERSION` 1.3.0 ;
  `MORNING_BRIEF_VERSION` 1.5.0.
- `@lalanda/shared` gagne `./stock`, `./assets`, `./documents` ; `@lalanda/shared/notifications` neuf
  types, trois modules, quatre natures d'entité.
- Tâches d'ordonnanceur : `stock.purchase-sync`, `stock.sales-sync`, `stock.levels-check`,
  `assets.reminders`, `documents.reminders`, `documents.purge`.
- La borne de 1 Gio de pièces par organisation est partagée par un quatrième module ; elle deviendra un
  sujet d'offre (docs/13).
- `secrets:rewrap` couvre les clés enveloppées de la bibliothèque ; docs/17 à compléter au lot S6.
- Navigation : trois applications RUN de plus (`/stocks`, `/equipements`, `/documents`).

## Critères d'acceptation (testables)

1. **Permissions** : un `storekeeper` crée et valide un bon de sortie (`200`), compte un inventaire
   (`200`), mais `403` sur `POST /stock/counts/:id/validate`, `PUT /stock/movements/:id/cost`,
   `POST /assets`, `GET /purchases/orders`, `GET /treasury/expenses` ; ses réponses de stock portent
   `valuesHidden: true` et aucun coût ; un `sales_rep` lit les quantités sans valeur ; un `hr_manager` lit
   les équipements sans coût et `403` sur `GET /stock/items` ; un `advisor` : `403` sur `/stock`, `/assets`,
   `/documents`. Matrice 782 cases et sonde e2e vertes.
2. **Séparation des tâches** : dans une organisation à deux détenteurs de `stock.manage`, celui qui a compté
   une ligne ne valide pas (`409 COUNT_SELF_VALIDATION`), l'autre le peut ; avec **un seul** détenteur, il
   valide son comptage, `soleApprover: true`, audit présent.
3. **Entrée par réception** : commande de 10 cartons à 12,00 USD (`itemRef = stk:<id>`, article en USD,
   1 carton = 12 pièces) ; réception de 6 → +72 pièces au coût 1,000000 USD ; rejouer
   `onReceptionChanged` et la tâche de rattrapage n'écrit rien de plus ; annuler la réception → −72
   (`purchase_receipt_reversal`) même si le stock est devenu négatif (alerte `NEGATIVE_STOCK`).
4. **Appel perdu** : le fournisseur du port lève une erreur (simulée) ; R3 enregistre la réception ;
   `stock.purchase-sync` crée l'entrée au passage suivant.
5. **Ligne inconnue, devise différente** : `itemRef` libre non reconnu → ligne « À traiter »
   `unknown_item`, aucun mouvement ; rattachée, l'entrée est créée et le rattachement sert à la réception
   suivante ; une commande en CDF pour un article valorisé en USD → entrée en quantité, `pending_cost`,
   valorisation `incomplete` ; le coût saisi en USD rétablit la valeur ; **aucun** taux n'est appliqué.
6. **Coût moyen** : entrées 10 à 2,00 puis 10 à 3,00 → CMUP 2,50 ; sortie de 5 → valeur 37,50 ; entrée 5 à
   4,00 → CMUP 2,875 ; corriger après coup la première entrée à 2,20 recalcule par rejeu ; quantité ramenée
   à 0 → valeur 0 et reste d'arrondi rendu ; propriétés à graine fixe : valeur ≥ 0 quand la quantité ≥ 0,
   somme des coûts de sortie + valeur finale = somme des entrées valorisées.
7. **Vente** : une facture `FV` émise (mode ordinaire) d'une ligne liée à un article suivi → `sale_issue`
   au passage suivant de `stock.sales-sync` ; une facture `pending_normalization` → rien, puis `normalized`
   → sortie ; `normalization_failed` puis retour en brouillon → jamais de sortie ; le document
   `sales_invoices`, son journal et son `contentSha256` sont **identiques octet pour octet** avant et après
   (test) ; un avoir `FA` → ligne `sale_return_proposed`, aucune rentrée tant qu'elle n'est pas confirmée ;
   une facture `FT` → rien.
8. **Négatif** : bon de sortie de 5 avec 3 en stock → `409 STOCK_INSUFFICIENT` ; avec
   `allowNegativeManualMoves` → `200` et alerte ; une vente de 5 avec 3 en stock → sortie, −2, notification
   `stock.negative`.
9. **Transfert** : 4 du magasin au chantier → deux mouvements appariés, coût moyen inchangé, quantités par
   emplacement justes ; annulation → deux contre-mouvements.
10. **Inventaire** : théorique 20 à l'ouverture, 3 vendus avant le comptage de la ligne, compté 16 → écart
    −1 (théorique au moment du comptage = 17) ; comptage à l'aveugle : le compteur ne reçoit pas la
    quantité théorique ; validation → un `count_adjustment` −1 daté du jour de validation.
11. **Suggestion** : seuil 10, cible 30, disponible 4, 8 commandés non reçus → suggestion 18 ; « Préparer
    une demande d'achat » n'écrit rien dans `purchase_orders` tant que l'utilisateur n'enregistre pas.
12. **Cache** : altérer `stock_levels` à la main → `stock.levels-check` signale `STOCK_LEVEL_DRIFT`,
    `rebuild` rétablit la quantité du grand livre.
13. **Équipements** : affecter un ordinateur à un collaborateur clôt l'affectation précédente ; la sortie du
    collaborateur lève `ASSET_HELD_BY_FORMER_EMPLOYEE` et R17 ; une maintenance préventive tous les 6 mois
    faite le 31 août prévoit la suivante au 28 févr. (année non bissextile) ; une garantie qui expire dans
    20 jours (rappel 30) → `assets.coverage_expiring` une seule fois.
14. **Estimation** : coût 1 200,00 USD, résiduelle 0, 3 ans, début 15 janv. → valeur estimée 800,00 au
    31 déc. de la même année (12 mois sur 36) ; la réponse porte `label: 'management_estimate'` et l'écran
    le libellé d'estimation ; aucune sortie ne dépend de `DUREES_SYSCOHADA`.
15. **Documents, droits** : un dossier « Fiscal » (`treasury.read`) est invisible d'un Magasinier ; un
    dossier restreint à deux personnes est invisible de l'Administrateur (`docs.manage`) ; un document lié
    à un fournisseur n'est pas lu sans `purchase.read` même si le dossier est ouvert ; un document invisible
    rend `404` et n'est pas compté par la recherche.
16. **Documents, sécurité** : l'objet d'un document sensible au stockage ne contient pas `%PDF-` ; recopié
    vers un autre document, il ne se déchiffre pas ; après rotation `k1 → k2`, il se relit avec `k2` seule ;
    le titre et les étiquettes n'apparaissent ni dans `req.url` ni dans les en-têtes, envoi et recherche
    compris ; un acteur plateforme sous accès délégué reçoit `404` sur le fichier sensible.
17. **Présentation** : la fiche d'un fournisseur montre ses documents de bibliothèque et les pièces de ses
    factures fournisseurs (avec `purchase.read`), jamais une pièce RH ; aucune collection existante n'est
    modifiée.
18. **Brief, Mes tâches, marge** : deux articles sous le seuil → `stock.sous_seuil = 2` et R16 ; un
    inventaire soumis apparaît dans « Mes tâches » du validateur éligible et pas du compteur ; une sortie
    de 30,00 USD vers le projet P donne `materials` = 30,00 et la marge de P **inchangée**.
19. **Isolation** : toute route nouvelle rend `404` pour une ressource d'une autre organisation, y compris
    par `itemId`, `locationId`, `catalogItemId`, `employeeId`, `supplierInvoiceId`, `expenseId`, `folderId`,
    `entityId` forgés ; les tâches de rattrapage ne lisent que les réceptions et factures de l'organisation
    traitée.
20. **Aucune règle comptable** : aucune sortie des moteurs ne dépend d'un taux de change, d'une durée par
    défaut ou d'une règle fiscale ; `actual_periods`, `treasury_expenses` et `sales_invoices` ne sont
    jamais écrits par R5.

## Plan de validation

- **Moteur (vitest)** : `weightedAverageValuation` (cas du critère 6, négatif puis entrée, `pending_cost`,
  correction rétroactive, propriétés à graine fixe), `toStockQuantity` (facteurs, arrondis),
  `countVariances` (théorique à l'instant), `replenishmentSuggestions`, `stockFindings`,
  `managementDepreciationEstimate` (mois entamés, reste d'arrondi, cession), `nextMaintenanceDate` (fins de
  mois, bissextiles), `expiryStatus` ; `computeProjectMargin` 1.3.0 (sans stock : sorties identiques à
  1.2.0) ; brief 1.5.0 (sans les trois ports : identique à 1.4.0).
- **Shared (vitest)** : schémas `.strict()` des trois entrées ; notifications.
- **API e2e (Mongo en mémoire)** : `stock-items.e2e`, `stock-vouchers.e2e` (négatif, transferts,
  annulations), `stock-purchases-link.e2e` (port, rattrapage, idempotence, inconnus, devises),
  `stock-sales-link.e2e` (statuts, avoirs, **égalité octet pour octet** des factures), `stock-counts.e2e`
  (séparation, aveugle, approbateur unique), `assets.e2e`, `library-documents.e2e` (droits, chiffrement,
  rotation, métadonnées hors URL, plateforme), `rbac-matrix.e2e` (huit actions, Magasinier),
  `morning-brief.e2e` (R16 à R18), `my-tasks.e2e`, `work-margin.e2e` étendus,
  `ai-contexts.audit.test.ts` étendu.
- **Web (vitest, modèles purs)** : `stocks/_components/*-model.ts` (valeurs masquées, devises séparées),
  `equipements/_components/*-model.ts` (libellé d'estimation présent), `documents/_components/*-model.ts`
  (arbre filtré), `nav-model.test.ts` (trois applications), `routes.test.ts`, `accueil-model.test.ts`
  (tuile, maximum 4).
- **Essai de la dirigeante** : activer les stocks ; créer « Magasin principal » et « Chantier Gombe » ;
  saisir le stock initial par un premier inventaire ; lier deux articles du catalogue ; commander (R3) 10
  cartons, en recevoir 6, voir l'entrée ; émettre une facture de vente, voir la sortie quelques minutes
  plus tard ; transférer au chantier, sortir pour le projet, relire la marge (informatif) ; faire compter
  un inventaire par le Magasinier et le valider soi-même (`soleApprover` si seule) ; voir R16 et préparer
  une demande d'achat depuis la suggestion ; enregistrer un ordinateur, l'affecter à une recrue, poser une
  garantie ; déposer l'attestation fiscale dans « Fiscal et administratif » avec une date d'expiration et
  voir R18.

## Découpage en lots parallélisables (worktrees séparés)

Règle d'ADR-0011 et d'ADR-0012 § 9 : **un fichier = un seul écrivain** par lot ; les fichiers partagés ne
reçoivent que des **ajouts** d'une ligne ou d'un bloc, chacun dans sa zone, sous un commentaire
`// ADR-0046 — <lot>`.

| Lot | Contenu | Fichiers possédés (probables) | Critères | Tests | Dépend de |
|---|---|---|---|---|---|
| **S0 — Socle RBAC, rôle, contrats** (petit, en premier) | huit actions, rôle `storekeeper`, matrices, dépendances, trois domaines, `APPROVAL_ACTIONS`, `stockCountDecision`, `folderAccessDecision` ; contrats partagés ; types de notification | `apps/api/src/authz/permissions.ts`, `permissions.test.ts`, `overrides.test.ts`, `__tests__/rbac-matrix.e2e.test.ts` ; `packages/shared/src/{stock,assets,documents}/**`, `packages/shared/package.json` (trois exports) ; `packages/shared/src/notifications/index.ts` ; `apps/web/src/lib/api.ts` (`OrgAction`, rôle) ; `docs/12` (statut « appliqué ») | 1, 2 (fonctions pures), 15 (fonction pure) | matrice 782 ; dépendances ; tables de vérité | — |
| **S1 — Moteur des stocks** | `packages/engine/src/stock/**` (§ 7.1) | `packages/engine/src/stock/**`, une ligne dans `packages/engine/src/index.ts` | 6, 10, 11 (calcul) | vitest, propriétés | — (parallèle à S0) |
| **S2 — Moteur des équipements** | `packages/engine/src/assets/**` (§ 7.2) | `packages/engine/src/assets/**`, une ligne dans `index.ts` | 13, 14 (calcul) | vitest | — (parallèle) |
| **S3 — API stocks : référentiel, mouvements, bons, inventaires** | articles, emplacements, grand livre, cache, bons, « À traiter » (résolution), coûts, inventaires, valorisation, rapports, réglages, `stock.levels-check` | `apps/api/src/stock/**` sauf `stock/purchases/**`, `stock/sales/**`, `stock/brief/**`, `stock/agenda/**`, `stock/margin/**` ; `apps/api/src/app.module.ts` (une ligne) ; `__tests__/stock-items.e2e.test.ts`, `stock-vouchers.e2e.test.ts`, `stock-counts.e2e.test.ts` | 2, 6, 8, 9, 10, 12 | e2e | S0, S1 |
| **S4 — Branchements achats et ventes** | `StockReceptionSink`, `stock.purchase-sync`, `stock.sales-sync`, avoirs proposés, `POST /stock/sync`, suggestions (lecture des commandes ouvertes R3) | `apps/api/src/stock/purchases/**`, `stock/sales/**` ; `apps/api/src/purchases/purchases.module.ts` (**une ligne** : fournisseur du port) ; `__tests__/stock-purchases-link.e2e.test.ts`, `stock-sales-link.e2e.test.ts` | 3, 4, 5, 7, 11 | e2e (égalité des factures) | S3 |
| **S5 — API équipements** | registre, affectations, maintenance, couvertures, cession, catégories, réglages, export, `assets.reminders` | `apps/api/src/assets/**` sauf `assets/brief/**`, `assets/agenda/**` ; `app.module.ts` (une ligne) ; `__tests__/assets.e2e.test.ts` | 13, 14 | e2e | S0, S2 |
| **S6 — API documents** | dossiers et droits, documents, versions, chiffrement par enveloppe, recherche `POST`, présentation par entité (ports de lecture des pièces d'achats et de projets), `documents.reminders`, `documents.purge`, `secrets:rewrap` | `apps/api/src/documents/**` sauf `documents/brief/**` ; `app.module.ts` (une ligne) ; `apps/api/src/integrations/rewrap.ts` (**un bloc** : clés `library_document_versions`) ; `__tests__/library-documents.e2e.test.ts` ; `docs/17` | 15, 16, 17 | e2e | S0 |
| **S7 — Liens : brief, Mes tâches, marge** | `STOCK_SOURCE`, `ASSETS_SOURCE`, `DOCUMENTS_SOURCE`, R16 à R18 ; `STOCK_AGENDA_SOURCE`, `ASSETS_AGENDA_SOURCE` ; `WORK_STOCK_SOURCE`, `materials` | `apps/api/src/{stock,assets,documents}/brief/**`, `stock/agenda/**`, `assets/agenda/**`, `stock/margin/**` ; `apps/api/src/morning-brief/morning-brief.ports.ts`, `morning-brief.module.ts`, `morning-brief.service.ts`, `mail/mail.templates.ts` (bloc du brief) ; `packages/engine/src/morning-brief/**` ; `apps/api/src/work/my-tasks.ports.ts`, `work-tasks.service.ts` (**`myTasks` seulement**), `packages/shared/src/work/views.ts` ; `packages/engine/src/work/margin.ts`, `types.ts`, `apps/api/src/work/margin/**` | 18 | e2e brief, tâches, marge | S3, S4, S5, S6 |
| **S8 — Web (1) : navigation et `/stocks`** | navigation des **trois** applications, routes, coquilles ; écrans articles, emplacements, niveaux, mouvements, bons, « À traiter », inventaires (saisie mobile), réapprovisionnement (lien vers le formulaire R3 prérempli), réglages ; tuile de l'Accueil | `apps/web/src/app/(app)/stocks/**` ; `apps/web/src/lib/api-stock.ts` ; `_components/nav-model.ts` (+ test) ; `apps/web/src/lib/routes.ts` (+ test) ; `equipements/layout.tsx`, `documents/layout.tsx` (coquilles) ; `accueil/_components/accueil-model.ts` (+ test) ; `achats/commandes/_components/*` (**préremplissage par paramètres d'identifiants seulement**) | écrans § 5.1, § 6.8 | modèles purs, nav, routes | S0 ; données avec S3, S4 |
| **S9 — Web (2) : `/equipements`, `/documents`, panneaux des fiches** | registre, fiche équipement (affectations, maintenance, couvertures, estimation étiquetée), échéances ; bibliothèque (arbre, droits, envoi multipart, versions, recherche en corps), échéances ; panneaux « Documents », « Matériel affecté », « Articles fournis » sur les fiches fournisseur, client, compte CRM, projet, collaborateur ; « Mes tâches » (éléments stock et équipements) | `apps/web/src/app/(app)/equipements/**` et `documents/**` sauf leurs `layout.tsx` ; `apps/web/src/lib/api-assets.ts`, `api-documents.ts` ; `apps/web/src/components/entity-documents-panel.tsx` (nouveau) ; une insertion chacun dans `achats/fournisseurs/[id]`, `ventes/clients/[id]`, `crm/comptes/[id]`, `projets/[id]`, `rh/collaborateurs/[id]`, `projets/_components/mes-taches*` | écrans § 5.2, § 5.3, § 6.5, § 6.8 | modèles purs | S8 (coquilles) ; S5, S6, S7 |

### Zones de conflit entre lots

| Fichier | Lots | Règle |
|---|---|---|
| `apps/api/src/authz/permissions.ts`, `packages/shared/src/notifications/index.ts`, `apps/web/src/lib/api.ts` | **S0 seul** | aucun autre lot n'y écrit |
| `packages/engine/src/index.ts` | S1, S2 | une ligne d'export chacun, sous son commentaire |
| `apps/api/src/app.module.ts` | S3, S5, S6 | une ligne chacun |
| `apps/api/src/authz/routes-coverage.test.ts` | S3, S4, S5, S6 | un bloc par lot, **à la fin** |
| `apps/api/src/purchases/purchases.module.ts` | **S4 seul** | une ligne (fournisseur du port) ; aucun autre fichier `purchases/**` n'est touché par R5 |
| `apps/api/src/sales/**` | **aucun** | lecture seule par modèles en lecture déclarés dans `stock/sales/**` |
| `apps/api/src/stock/stock.module.ts` | S3 crée ; S4, S7 ajoutent une ligne chacun (`imports` ou `providers`) | sous son commentaire de lot |
| `apps/api/src/assets/assets.module.ts`, `documents/documents.module.ts` | S5, S6 créent ; S7 ajoute une ligne | idem |
| `apps/api/src/morning-brief/**`, `packages/engine/src/morning-brief/**`, `mail/mail.templates.ts`, `work/my-tasks.ports.ts`, `work-tasks.service.ts`, `work/margin/**`, `packages/engine/src/work/**` | **S7 seul** | — |
| `apps/api/src/integrations/rewrap.ts` | S6 seul | un bloc |
| `packages/shared/src/{stock,assets,documents}/**` | S0 crée ; S3 à S7 **ajoutent** des fichiers | `index.ts` : une ligne d'export par lot |
| `apps/web/src/app/(app)/_components/nav-model.ts`, `apps/web/src/lib/routes.ts`, `accueil/**`, `equipements/layout.tsx`, `documents/layout.tsx` | **S8 seul** | sous-options des trois applications posées par S8 |
| fiches existantes (`achats/fournisseurs/[id]`, `ventes/clients/[id]`, `crm/comptes/[id]`, `projets/[id]`, `rh/collaborateurs/[id]`, `projets/_components/mes-taches*`) | **S9 seul** | une insertion de composant chacune |
| `achats/commandes/_components/*` | **S8 seul** | lecture de paramètres de préremplissage (identifiants et quantités), aucune logique d'achat changée |
| `docs/12`, `docs/15`, `docs/16`, index des ADR | ce lot de documentation ; chaque lot passe sa ligne « proposé » à « implémenté » | une section par lot |

### Ordre de fusion conseillé

```
S0 ──┬──────── S3 ── S4 ──┐
S1 ──┘                    ├── S7
S2 ──── S5 ───────────────┤
S0 ──── S6 ───────────────┘
S8 (coquilles dès S0 ; écrans au fil de S3, S4)
S9 après S8, S5, S6 ; « Mes tâches » après S7.
```

1. **S0**, **S1**, **S2** en parallèle (les moteurs ne dépendent d'aucun contrat d'API).
2. **S3**, **S5**, **S6** en parallèle ; squelette de **S8** (navigation, routes, coquilles).
3. **S4** (après S3) : le stock devient vivant (achats, ventes).
4. **S7** (après S3 à S6) ; écrans **S8** puis **S9**.

Chemin critique : S0 → S3 → S4 → S7. Si S4 glisse, S3 livre déjà un magasin tenu à la main (bons,
inventaires, stock initial) ; S5 et S6 sont indépendants des stocks et peuvent être livrés avant.

## Décisions ouvertes — elles appartiennent à la dirigeante

Chacune a une **valeur par défaut**, appliquée si rien n'est tranché.

1. **Actions** : huit actions et la matrice du § 8.1. *Défaut : oui.*
2. **Rôle Magasinier** (`storekeeper`, O6). *Défaut : oui, neuf actions, sans valeurs ni validation. Le
   Logisticien n'est pas un rôle distinct.*
3. **Gestion des équipements par le Responsable RH ou le Magasinier** (`assets.manage`). *Défaut : non,
   lecture seule ; possible par ajout (ADR-0041) dès l'activation des écarts.*
4. **Sortie de stock à la vente** : automatique, proposée ou éteinte. *Défaut : automatique, par lecture
   des factures finales toutes les 5 minutes ; avoirs toujours proposés.*
5. **Méthode de valorisation** : coût moyen pondéré glissant de gestion. *Défaut : oui ; PEPS hors R5 ;
   usage comptable à confirmer par l'expert-comptable.*
6. **Coût d'entrée** : prix HT de la commande après remise ; taxes déclarées, transport, douane non
   incorporés. *Défaut : oui ; frais d'approche à cadrer avec l'expert-comptable.*
7. **Réceptions antérieures à l'activation** : rejouées ou non. *Défaut : non ; le stock initial se saisit
   par un premier inventaire.*
8. **Emplacements hiérarchiques** (allées, casiers). *Défaut : non, à plat.*
9. **Le Magasinier enregistre-t-il la réception d'achat ?** *Défaut : non (elle exige `purchase.manage`,
   qui ouvre aussi les factures et les coordonnées des fournisseurs) ; une action `purchase.receive` serait
   un amendement d'ADR-0044.*
10. **Lots, numéros de série et péremption** des marchandises. *Défaut : hors R5.*
11. **Suggestions de réapprovisionnement dans la prévision de trésorerie.** *Défaut : non.*
12. **Matériel consommé dans la marge des projets** : informatif seulement. *Défaut : oui, jamais
    soustrait.*
13. **Estimation d'amortissement** : linéaire, paramètres saisis, étiquetée « estimation de gestion ».
    *Défaut : disponible, sans durée par défaut ; proposer les durées indicatives du plan comme simple
    suggestion : non.*
14. **Stock négatif pour les mouvements manuels.** *Défaut : refusé.*
15. **Cession d'un équipement vendu** : déclarée seulement. *Défaut : oui ; la facture de vente, si elle
    est due, passe par les ventes, sans lien automatique.*
16. **Durées de conservation des documents.** *Défaut : aucune ; à poser par l'organisation sur avis
    juridique.*
17. **Conseiller (externe) et bibliothèque.** *Défaut : aucun accès ; un dossier partagé avec lui exigerait
    `docs.read` par ajout et un dossier `access.read = { userIds }`.*
18. **Formats bureautiques** (DOCX, XLSX) dans la bibliothèque. *Défaut : non (PDF et images seulement, pas
    d'analyse de fichier) ; à rouvrir avec un contrôle de signature ZIP et un service inerte.*
19. **Espace de stockage** : borne commune de 1 Gio par organisation. *Défaut : inchangée ; à arbitrer avec
    les offres (docs/13).*
20. **Index commun des pièces jointes** (recherche transversale). *Défaut : non ; présentation par entité.*
21. **Inventaire tournant planifié** (rappels par emplacement). *Défaut : aucun rappel (`countReminderDays
    = 0`).*
22. **Offres** (docs/13) : stocks, équipements et documents ouverts à toutes les offres, comme les autres
    applications RUN. *Défaut : toutes les offres, à arbitrer avec le reste du tableau.*

## Liens

- [ADR-0011](ADR-0011-contrats-integration-s18.md) ; [ADR-0012](ADR-0012-modele-rbac-complet.md)
  (amendé) ; [ADR-0013](ADR-0013-stockage-secrets-integration.md) ;
  [ADR-0018](ADR-0018-trajectoire-erp-trois-modules.md) (refus des stocks levé) ;
  [ADR-0020](ADR-0020-ordonnanceur-mongodb.md) ; [ADR-0021](ADR-0021-modules-erp-et-identite-fiscale.md)
  (points de vente) ; [ADR-0022](ADR-0022-clients-catalogue-et-calcul-des-factures.md) (catalogue, lu) ;
  [ADR-0023](ADR-0023-factures-et-avoirs.md) et [ADR-0024](ADR-0024-normalisation-dgi.md) (factures,
  **lues seulement**) ; [ADR-0027](ADR-0027-numerotation-des-factures.md) ;
  [ADR-0030](ADR-0030-refonte-ui-ux.md) ; [ADR-0033](ADR-0033-brief-du-matin.md) (étendu) ;
  [ADR-0034](ADR-0034-depenses-et-tresorerie.md) (lu) ; [ADR-0039](ADR-0039-projets-et-taches-run.md)
  (étendu) ; [ADR-0041](ADR-0041-autorisations-par-membre.md) (étendu) ;
  [ADR-0044](ADR-0044-achats-et-fournisseurs.md) (accroche § 6.6 branchée) ;
  [ADR-0045](ADR-0045-ressources-humaines.md) (motifs repris).
- [docs/08](../08-PREVISIONNEL-REALISE.md) ; [docs/12](../12-ROLES-PERMISSIONS.md) ;
  [docs/13](../13-PRICING.md) ; [docs/15](../15-DATABASE.md) ; [docs/16](../16-API.md) ;
  [docs/17](../17-SECURITE.md) ; [docs/26](../26-CONVENTIONS.md).
- Code existant : `apps/api/src/purchases/stock-sink.port.ts`, `purchases/receptions/`,
  `purchases/orders/purchase-order.schema.ts`, `apps/api/src/sales/catalog-item.schema.ts`,
  `sales/invoices/` (lu), `apps/api/src/hr/documents/hr-document-crypto.ts`, `apps/api/src/work/`
  (`work-attachments.*`, `margin/`, `my-tasks.ports.ts`), `apps/api/src/morning-brief/`,
  `apps/api/src/authz/permissions.ts`, `apps/api/src/scheduler/`, `packages/engine/src/purchases/money.ts`
  (arithmétique), `packages/engine/src/amortissements/` (non repris).
- Code à créer : `apps/api/src/{stock,assets,documents}/`, `packages/engine/src/{stock,assets}/`,
  `packages/shared/src/{stock,assets,documents}/`, `apps/web/src/app/(app)/{stocks,equipements,documents}/`.
