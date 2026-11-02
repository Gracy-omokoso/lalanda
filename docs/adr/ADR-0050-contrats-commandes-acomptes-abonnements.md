# ADR-0050 — Contrats clients, commandes clients, acomptes et abonnements : versions, avenants, échéances, reconduction, factures d'acompte, brouillons récurrents et alertes dans « Mes tâches »

Statut : Proposed

> **3 nov. 2026 — décisions ouvertes tranchées par [ADR-0054](ADR-0054-decisions-du-3-novembre.md)** (valeurs par défaut gardées sauf mention contraire, à revoir avec le juriste et l'expert-comptable).

Date : 2026-11-01
Décideurs : Gracy Omokoso (dirigeante) — **besoin exprimé** : compléter le RUN avec le § 5.2 du brief
stratégique (produits et services, tarifs, versions de devis, validations, commandes clients, contrats,
avenants, signature via intégration, acomptes, facturation, abonnements, renouvellements et échéances),
selon le parcours cible « prospect → opportunité → devis → contrat → projet → facture → paiement →
comptabilité » ; CTO Lalanda (contrat technique). Le cadrage est **proposé** : chaque choix qui
appartient à la dirigeante porte une valeur par défaut, la plus prudente, appliquée tant qu'elle ne
tranche pas autrement (§ Décisions ouvertes). **Aucune règle fiscale ni juridique n'est posée par cet
ADR** : traitement des acomptes, TVA, mentions obligatoires, reconduction tacite et préavis en droit
congolais sont des **questions** pour l'expert-comptable et le juriste (§ Questions), et restent sans
effet automatique tant qu'ils n'ont pas répondu.

> **Complète [ADR-0035](ADR-0035-crm-et-devis.md) et [ADR-0040](ADR-0040-crm-complet.md)** sans les
> modifier : un devis accepté peut, en plus de sa conversion en brouillon de facture (inchangée),
> donner une **commande client** ou un **contrat**. **Lève le hors-périmètre d'ADR-0035**
> (« pas de commandes ni de contrats ») ; la **signature électronique** reste hors périmètre
> (ADR-0040), remplacée par le **téléversement du PDF signé**.
> **S'appuie sans les modifier** sur [ADR-0022](ADR-0022-clients-catalogue-et-calcul-des-factures.md)
> (clients, catalogue, moteur `invoice-totals`), [ADR-0023](ADR-0023-factures-et-avoirs.md) (types
> `FT`/`ET`, ligne de commentaire C, circuit du brouillon), [ADR-0024](ADR-0024-normalisation-dgi.md)
> (normalisation), [ADR-0027](ADR-0027-numerotation-des-factures.md) (format des numéros),
> [ADR-0031](ADR-0031-encaissements-et-realise.md) (encaissements, pont vers le réalisé),
> [ADR-0049](ADR-0049-comptabilite-syscohada.md) (clés `sale.deposit.*`) : **aucune ligne** de
> `sales/invoices/`, `sales/normalization/`, `sales/receipts/`, `actuals/` ni `accounting/` ne change.
> **Étend [ADR-0039](ADR-0039-projets-et-taches-run.md)** (« Mes tâches », cloche, « Créer le projet »)
> et tranche **en partie** sa décision ouverte n° 10 (facturation par échéancier, sans pourcentage).
> **Amende [ADR-0012](ADR-0012-modele-rbac-complet.md) et docs/12** : deux actions nouvelles,
> `sales.contract` et `sales.contract.approve`, aucun rôle nouveau. **Étend
> [ADR-0041](ADR-0041-autorisations-par-membre.md)** : dépendances, domaine « Ventes et facturation »
> élargi, une action à séparation dynamique.
> **Distinct d'[ADR-0047](ADR-0047-factures-des-abonnements-lalanda.md)** : ADR-0047 traite de la
> facturation **par Lalanda** de ses propres abonnés ; cet ADR traite des abonnements que **les
> organisations clientes** vendent à **leurs** clients. Si la dirigeante retient l'option A d'ADR-0047,
> Go freelance SARLU pourra s'en servir comme n'importe quelle organisation ; rien ici ne le présuppose.

## Contexte

Le RUN sait déjà **chiffrer** (devis versionnés, ADR-0035), **suivre l'affaire** (CRM, ADR-0040),
**produire** (projets, jalons, ADR-0039), **facturer** (factures normalisées DGI et avoirs, ADR-0022 à
ADR-0028), **encaisser** (ADR-0031) et **comptabiliser** en projet (ADR-0049). Entre le devis accepté
et la facture, il manque ce qui **engage dans la durée** : la commande que le client passe, le contrat
qu'il signe, ses avenants, l'acompte qu'on lui demande, les factures qui reviennent chaque mois et les
dates qu'il ne faut pas laisser passer (préavis, fin de contrat, reconduction).

Cinq manques :

1. **Pas de commande client.** Le bon de commande du client (sa référence, ses quantités) n'est noté
   nulle part ; personne ne sait ce qui reste à facturer d'une commande livrée en plusieurs fois.
2. **Pas de contrat.** Un devis accepté n'a pas de durée, pas de date de fin, pas de préavis ; les
   modifications après accord (avenants) ne laissent aucune trace ; la copie signée n'est rangée nulle
   part.
3. **Acompte sans suivi.** Le type `FT` (et `ET` à l'export) existe et passe à la DGI, mais rien ne
   relie une facture d'acompte à la commande ou au contrat qu'elle concerne, ni à la facture finale qui
   doit la rappeler.
4. **Pas de facturation récurrente.** Une prestation mensuelle se refait à la main chaque mois, sans
   rappel ; un oubli est un manque à gagner.
5. **Pas d'alerte d'échéance.** Une date limite de préavis passe sans que personne ne la voie.

### Faits du dépôt qui commandent les décisions

| Fait | Où | Conséquence |
|---|---|---|
| Devis = document distinct `sales_quotes`, `DV{AA}{MM}-NNNNNN`, versions (`previousVersions`), statuts `draft`, `sent`, `accepted`, `refused`, `expired` dérivé ; `convert` crée **un** brouillon `FV` à prix fixés (O3) ; « la facture ne connaît pas le devis » | ADR-0035 § 1, `sales/quotes/quote.schema.ts`, `quotes.service.ts` | même motif pour contrats et commandes : documents distincts, liens tenus **du côté du nouveau module**, conversion à prix fixés |
| Composition et calcul d'un document de vente : `InvoiceDraftsService.compose` → `computeInvoiceTotals` ; création d'un brouillon : `InvoiceDraftsService.create`, seul écrivain autorisé de `sales_invoices` hors circuit (liste fermée testée) | ADR-0035 O2, `sales/invoices/invoice-drafts.service.ts`, `invoices.sources.test.ts` | contrats, commandes et échéances se calculent par `compose` ; leurs factures naissent par `create` ; **aucun calcul de montant nouveau** |
| Six types e-DEF : `FV`, `FT` (« acompte ou avance »), `FA`, `EV`, `ET`, `EA` ; mention imprimée « D'ACOMPTE » ; un avoir `FA` se rattache à une `FV` **ou une `FT`** | ADR-0023 § Règles DGI, ADR-0025, `sales/invoices/invoice.contract.ts:54`, `credit-note-rules.ts` | l'acompte est déjà une **facture fiscale** ; on n'invente pas de pièce « demande d'acompte » fiscale |
| Huit lignes de commentaire, seules A et C saisissables ; **C « pour rappeler le code d'une facture d'acompte »** | ADR-0023 § S25e.7 | le rappel de l'acompte sur la facture finale se fait en ligne C, **seul mécanisme sourcé** |
| « Aucune facture sans article ; aucun montant nul ou négatif » ; total = somme des paiements déclarés | ADR-0023 § Règles DGI, § S25e.8 | une déduction d'acompte ne peut **pas** être une ligne négative ; la manière de construire la facture finale reste une question (§ Questions) |
| Acomptes **exclus** du réalisé et du chiffre d'affaires, comptés à part ; décision ouverte n° 1 d'ADR-0031 non tranchée | ADR-0031 § 3, `actuals/run-bridge/run-bridge.service.ts:117`, `engine/src/receivables/aggregation.ts` | rien ne change : l'acompte reste exclu tant que l'expert n'a pas répondu |
| Une `FT` est une créance (`RECEIVABLE_TYPES` = `FV FT EV ET`), lettrable par un encaissement | `treasury/treasury-sources.ts:77`, `sales/receipts/settlements.service.ts` | l'acompte payé apparaît déjà en trésorerie ; cet ADR n'y touche pas |
| Comptabilité : `FT`/`ET` → préfixe `sale.deposit`, au **compte d'attente** sans règle ; question E1.4 d'ADR-0049 | `engine/src/accounting/entries/sales.ts:30`, `rules/operation-keys.ts`, ADR-0049 § 6.1 | rien à ajouter côté comptable ; l'imputation finale dépend de la même question |
| Dépenses récurrentes : « la règle prévoit, l'utilisateur confirme chaque occurrence » ; `occurrencesOf` (même quantième, ramené au dernier jour du mois) | ADR-0034 O3 et § 3, `engine/src/treasury/` | l'échéancier d'abonnement reprend **le même calcul d'occurrences** et le même principe : la machine prépare, l'humain émet |
| Projet depuis un devis (`from-quote`) ou une opportunité (`from-opportunity`), idempotents par index unique partiel ; jalon terminé → brouillon `FV` « jamais émis, jamais normalisé » ; lien facture ↔ projet tenu côté projet (`work_invoice_links`) | ADR-0039 § 6.1 et 6.3, ADR-0040 § 6.4, `work/billing/` | « Créer le projet » d'un contrat **délègue** à ces routes ; aucune émission automatique |
| « Mes tâches » agrège sans copie par ports en lecture seule (`CRM_AGENDA_SOURCE`, `PURCHASES_AGENDA_SOURCE`, `HR_AGENDA_SOURCE`…) | ADR-0040 § 5.2, `work/my-tasks.ports.ts` | un port de plus, `SALES_CONTRACTS_AGENDA_SOURCE` |
| La DGI refuse plus de **dix demandes en attente** par e-MCF ; la normalisation est un geste explicite | ADR-0023 § Règles DGI, ADR-0024 | aucune émission ni normalisation groupée automatique |
| Numérotation des pièces internes `XX{AA}{MM}-NNNNNN`, compteur annuel au jour de Kinshasa, trous admis, hors série fiscale ; `BC` pris par les achats, `PF`, `DV`, `DA`, `AV` pris | ADR-0027, ADR-0035, ADR-0044 § 2.3 | contrats `CT…`, commandes clients `CC…` |
| Pièces jointes PDF servies en téléchargement inerte, 10 Mio, empreinte | ADR-0039 § 2.5, ADR-0044 § 2.7 | la copie signée suit la même règle |
| Matrice **12 rôles × 51 actions** ; `APPROVAL_ACTIONS` = `plan.approve`, `purchase.approve`, `leave.approve`, `stock.manage`, `accounting.post`, `accounting.manage` ; approbateur unique compté sur les détenteurs **effectifs** | `authz/permissions.ts`, ADR-0044 § 4.3, ADR-0049 § 8 | deux actions en fin de liste, l'une en case ⓢ |
| Aucune règle de reconduction tacite, de préavis, de mention obligatoire d'un contrat ni de valeur probante d'une signature n'est sourcée dans `docs/` ; docs/28 § 1.3 tient les questions au juriste | `docs/28-CONFORMITE-LEGALE.md` | ces règles sont **saisies par l'utilisateur** comme clauses de **son** contrat ; Lalanda calcule des dates, n'en affirme jamais la validité |

## Options considérées

### O1 — Contrat et commande : un seul document, ou deux ?

1. **Un seul « engagement client »** avec un indicateur. Écarté : une commande est ponctuelle
   (quantités à livrer et facturer, puis soldée) ; un contrat dure (terme, reconduction, préavis,
   avenants, échéancier). Les mêlerait un modèle où la moitié des champs est vide.
2. **Deux documents distincts, `sales_orders` et `sales_contracts`**, qui partagent la forme des lignes
   du devis et le calcul par `compose`. **Retenu.**

### O2 — Où vit le lien entre facture et commande, contrat ou échéance ?

1. Champs ajoutés à `sales_invoices`. Écarté : la facture est figée (`contentSha256`), versée au journal
   électronique, et sa liste d'écrivains est fermée ; c'est le motif d'ADR-0035 (« la facture ne connaît
   pas le devis ») et d'ADR-0039 O3.
2. **Collection de liens `sales_document_links`, tenue par le nouveau module**, comme
   `work_invoice_links`. **Retenu.**

### O3 — Avenants : modifier le contrat, ou empiler des avenants ?

1. Modifier le contrat en place. Écarté : un contrat signé ne change pas ; l'historique serait perdu.
2. **Avenant = document numéroté, avec son cycle (préparé, approuvé, signé) et sa date d'effet ; les
   conditions en vigueur à une date sont calculées par le moteur** à partir du contrat et des avenants
   signés. **Retenu.** Avant la signature, les « versions » d'un contrat suivent le motif des devis
   (`previousVersions`).

### O4 — Acompte : quelle pièce ?

1. Une « demande d'acompte » non fiscale. Écarté : le type `FT` existe, est homologué, et la question
   de savoir si une demande non fiscale est permise n'est pas sourcée.
2. **La facture d'acompte est le brouillon `FT`/`ET` existant, préparé depuis une commande ou un contrat
   et relié par `sales_document_links`.** **Retenu.** Le calcul et la fiscalité restent ceux du circuit
   des factures.

### O5 — Imputation de l'acompte sur la facture finale

1. **Ligne négative de déduction.** Écarté : « aucun montant nul ou négatif » (ADR-0023).
2. **Facture finale pour le solde seulement.** Possible, non sourcé : question.
3. **Facture finale pour le total, acompte déclaré comme paiement** (moyen `AUTRE`) : possible, non
   sourcé : question.
4. **Avoir `FA` sur la `FT`, puis facture finale pour le total** : le rattachement `FA` → `FT` est
   permis (ADR-0023) ; le traitement fiscal et comptable n'est pas sourcé : question.
5. **Aucune imputation automatique en v1 : rappel en ligne C (sourcé), affichage des acomptes de la
   commande ou du contrat, choix laissé à l'utilisateur et à son expert.** **Retenu par défaut**
   (décision ouverte n° 11) ; dès que l'expert et, s'il le faut, la DGI auront répondu, une option 2, 3
   ou 4 deviendra un geste assisté, par amendement.

### O6 — Abonnements : factures créées, ou brouillons préparés ?

1. Émettre (ou normaliser) automatiquement à chaque échéance. Écarté : une facture émise engage le
   contribuable devant la DGI ; ADR-0039 § 6.3 et ADR-0034 O3 posent déjà « la machine prépare,
   l'humain émet » ; la limite de dix demandes en attente rendrait une émission groupée fragile.
2. **Brouillon (pro forma) préparé à l'échéance par une tâche idempotente ; émission par l'utilisateur,
   facture par facture, sous `sales.invoice`.** **Retenu.**
3. Rien d'automatique, simple rappel. Écarté : c'est la saisie répétitive que l'on veut supprimer ; un
   brouillon se supprime sans trace fiscale.

### O7 — Reconduction tacite : la machine prolonge-t-elle le contrat ?

1. Prolongation automatique silencieuse. Écarté : la validité d'une reconduction tacite et ses
   conditions (information préalable du client, durée) ne sont pas sourcées en droit congolais ;
   facturer une période reconduite à tort serait une faute.
2. **Le moteur calcule, à partir des clauses saisies, la date limite de préavis et la date de
   reconduction ; un humain constate la reconduction d'un geste ; sans ce geste, aucun brouillon n'est
   préparé au-delà du terme en cours.** **Retenu** (décision ouverte n° 9).

### O8 — Permissions : réutiliser `sales.quote` et `sales.manage`, ou des actions nouvelles ?

1. Tout sous `sales.manage`. Écarté : le Commercial (sans `sales.manage`) ne pourrait pas préparer le
   contrat de l'affaire qu'il a gagnée ; et signer un contrat engage l'organisation plus qu'un brouillon.
2. Tout sous `sales.quote`. Écarté : l'engagement (approuver, résilier) se confondrait avec la
   préparation.
3. **Deux actions : `sales.contract` (préparer contrats, avenants et commandes) et
   `sales.contract.approve` (approuver un contrat ou un avenant, constater une reconduction, résilier),
   en case ⓢ.** Les factures (acompte, échéance, finale) restent sous `sales.manage` (brouillon) et
   `sales.invoice` (émission). **Retenu.**

### O9 — Où vivent les contrats et les calculs

Comme ADR-0039 O5 et ADR-0049 O8 : contrats zod dans `packages/shared/src/sales-contracts/` ; calculs de
dates, d'occurrences et de restes dans un module pur `packages/engine/src/contracts/` ; montants par le
moteur `invoice-totals` existant, via `compose`.

## Décision

### 1. Vocabulaire

| Terme (écran) | Objet | Collection |
|---|---|---|
| Commande client | ce que le client commande, avec sa propre référence | `sales_orders` |
| Contrat | engagement durable : lignes, terme, reconduction, préavis, échéancier | `sales_contracts` |
| Version (d'un contrat) | état du contrat **avant** signature, comme un devis | `sales_contracts.previousVersions` |
| Avenant | modification d'un contrat **signé**, avec date d'effet | `sales_contract_amendments` |
| Conditions en vigueur | contrat + avenants signés dont la date d'effet est atteinte, calculés par le moteur | — (dérivé) |
| Terme | période contractuelle en cours (initiale ou reconduite) | — (dérivé) |
| Échéance (de facturation) | date à laquelle une facture est prévue (échéancier ou abonnement) | — (dérivé) ; lien une fois préparée |
| Abonnement | contrat dont l'échéancier est **récurrent** | `sales_contracts.billing.kind = 'recurring'` |
| Facture d'acompte | facture `FT` (ou `ET`) existante, reliée à une commande ou un contrat | `sales_invoices` (inchangé) + lien |
| Copie signée | PDF téléversé, preuve déclarée de la signature | `sales_contract_files` |

### 2. Modèle de données

Toutes les collections portent `organizationId`, `revision` (concurrence par `expectedRevision`,
`409 STALE_REVISION`), `createdBy`, `updatedBy`, horodatage, `_schemaVersion: 1`. Montants en chaînes
décimales ; dates civiles `AAAA-MM-JJ` au jour de Kinshasa.

#### 2.1 `sales_contract_settings` (une par organisation, défaut implicite)

| Champ | Défaut | Règle |
|---|---|---|
| `noticeAlertDays` | 30 | alerte « préavis » N jours avant la date limite de préavis (0 à 365) |
| `termEndAlertDays` | 60 | alerte « fin de terme » N jours avant la fin du terme (0 à 365) |
| `subscriptionLeadDays` | 0 | un brouillon d'échéance est préparé N jours avant l'échéance (0 à 30) |
| `autoPrepareSubscriptionDrafts` | `true` | préparation automatique des brouillons ; désactivable aussi par contrat |
| `allowSoleApprover` | `true` | l'unique détenteur effectif de `sales.contract.approve` peut approuver ce qu'il a préparé (motif ADR-0044) |

#### 2.2 `sales_orders` (commandes clients)

| Champ | Règle |
|---|---|
| `number` | `CC{AA}{MM}-NNNNNN`, attribué à la création (compteur `sales_order_counters`), hors série fiscale, trous admis |
| `customerId` | **client** de l'organisation, requis (un prospect est d'abord converti, ADR-0040) |
| `customerReference` | numéro du bon de commande du client, ≤ 60, facultatif |
| `orderedOn` | date de la commande du client |
| `source` | `{ kind: 'quote', quoteId, quoteVersion }` \| `{ kind: 'contract', contractId }` \| `null` |
| `opportunityId` | facultatif ; repris du devis |
| `currency`, `priceMode`, `customer`, `lines`, `documentAmounts` | **mêmes formes** que le devis (ADR-0035 § 1), composées par `compose` ; lignes `catalog` et `free` ; chaque ligne reçoit un `lineRef` stable |
| `requestedDeliveryDate` | information, facultative |
| `status` | `draft` · `confirmed` · `closed` · `cancelled` (stocké) |
| `invoicing` | **dérivé** par le moteur (§ 7) : `not_invoiced` · `partially_invoiced` · `invoiced`, avec reste à facturer par ligne |
| `notes` | ≤ 1 000 |

Contenu modifiable en `draft` seulement. « Confirmer » fige les lignes. « Clore » : à la main
(reliquat abandonné, motif) ou proposé quand tout est facturé. « Annuler » : `draft` ou `confirmed`
sans facture émise liée, motif. Une commande issue d'un devis : **une seule commande vivante par
devis** (index unique partiel `{ organizationId, 'source.quoteId' }` sur les commandes non annulées) ;
le devis n'est pas modifié et sa conversion en facture (ADR-0035) reste possible, signalée comme
concurrente (`QUOTE_ALREADY_CONVERTED` en avertissement, pas en refus).

#### 2.3 `sales_contracts`

| Champ | Règle |
|---|---|
| `number` | `CT{AA}{MM}-NNNNNN` (compteur `sales_contract_counters`), hors série fiscale, trous admis |
| `version` | 1 à la création ; +1 à chaque « nouvelle version » **avant** signature |
| `title` | ≤ 200 |
| `customerId`, `opportunityId`, `source` (`quote` \| `null`) | comme la commande |
| `ownerUserId` | responsable, destinataire des alertes ; défaut : le créateur ; doit détenir `sales.read` effectif |
| `currency`, `priceMode`, `customer`, `lines`, `documentAmounts` | comme la commande ; montants **indicatifs** (par période pour un abonnement) |
| `startDate` | début du premier terme |
| `initialTermMonths` | durée du premier terme, 1 à 120, ou `null` (durée indéterminée) |
| `renewal` | `{ mode: 'none' \| 'tacit' \| 'explicit', periodMonths: 1..60 \| null, maxRenewals: entier \| null }` — **clause saisie** |
| `noticeDays` | préavis contractuel de non-reconduction ou de résiliation, 0 à 365 — **clause saisie** |
| `billing` | § 2.4 |
| `clauses` | texte libre ≤ 4 000, **saisi par l'utilisateur** ; Lalanda ne propose aucun modèle de clause |
| `status` | `draft` · `submitted` · `approved` · `signed` · `terminated` · `cancelled` (stocké) ; **dérivés** à la lecture : `upcoming` (signé, début futur), `in_force`, `expiring` (fin de terme à moins de `termEndAlertDays`), `ended` (terme échu, sans reconduction constatée ni à constater) |
| `approvals` | `[{ userId, decision: 'approved' \| 'rejected', at, comment, soleApprover }]` (motif ADR-0044) |
| `signature` | `{ signedOn, signatories: [{ name, title, side: 'customer' \| 'organization' }], fileId, declaredBy, declaredAt }` \| `null` |
| `renewals` | ajout seul : `[{ termIndex, from, to, recordedBy, recordedAt, mode: 'tacit_recorded' \| 'explicit_amendment' }]` |
| `termination` | `{ noticeGivenOn, by: 'customer' \| 'organization', effectiveOn, reason, recordedBy, recordedAt, noticeCheck }` \| `null` |
| `projectId` | projet RUN lié (lecture de `work_projects`), facultatif |
| `previousVersions` | instantanés figés des versions avant signature (contenu, montants, statut, dates) |
| `contentSha256` | empreinte du contenu au passage en `signed` |

**Cycle de vie**

```
draft ─« Soumettre »─▶ submitted ─« Approuver »─▶ approved ─« Déclarer la signature »─▶ signed
  ▲                       │  └─« Rejeter » (commentaire) ─▶ draft                       │
  └── « Nouvelle version » (depuis submitted, approved, rejeté)        « Résilier » ─────▶ terminated
draft ─« Annuler »─▶ cancelled (jamais soumis : suppression ; sinon conservé)
```

- Le contenu n'est modifiable qu'en `draft`. « Soumettre » exige un calcul sans bloquant (contrôle
  `checkSellerVatStatus` compris, motif de l'amendement du 27 oct. 2026 d'ADR-0035).
- « Approuver » est une **validation interne** (séparation des tâches, § 8.3), pas la signature.
- « Déclarer la signature » exige `approved`, une date, au moins un signataire de chaque côté et
  **le PDF signé téléversé** (§ 2.6) ; le contenu devient immuable (`contentSha256`).
- « Résilier » (signé seulement) enregistre la notification et la date d'effet ; le moteur compare au
  préavis **saisi** et affiche `noticeCheck` (« conforme à la clause saisie » ou « en deçà de la clause
  saisie ») **sans jamais refuser** : la validité juridique n'est pas jugée par Lalanda.

#### 2.4 Échéancier (`sales_contracts.billing`)

| `kind` | Contenu | Usage |
|---|---|---|
| `none` | — | contrat-cadre : factures préparées à la main (commandes, jalons) |
| `schedule` | `items: [{ itemRef, dueDate, label, lines }]`, 1 à 60 échéances, lignes composées par `compose` | prestation payée en plusieurs fois à dates fixes |
| `recurring` | `{ frequency: 'weekly' \| 'monthly' \| 'quarterly' \| 'yearly', anchorDate, timing: 'in_advance' \| 'in_arrears', autoPrepare: boolean }` ; lignes = lignes du contrat en vigueur | abonnement |

- Les occurrences récurrentes sont celles de `occurrencesOf` (ADR-0034 § 3) : même quantième, ramené au
  dernier jour du mois. `timing` ne change que le **libellé de période** porté par le brouillon
  (période qui commence, ou qui finit, à l'échéance) ; il ne change aucun montant.
- **Aucun pourcentage** en v1 : chaque échéance d'un `schedule` porte ses propres lignes et quantités
  (décision ouverte n° 14). **Aucun prorata** d'une période incomplète (décision ouverte n° 13).
- Les occurrences s'arrêtent à la fin du **terme en cours** (initial, ou reconduit et constaté), à la
  date d'effet d'une résiliation, ou à `maxRenewals`.

#### 2.5 `sales_contract_amendments` (avenants)

| Champ | Règle |
|---|---|
| `contractId`, `index` | avenant n° 1, 2… ; numéro affiché `CT…-A{index}` |
| `effectiveDate` | ≥ `startDate` du contrat ; jamais antérieure à une échéance **déjà préparée** (`409 AMENDMENT_BEFORE_PREPARED_OCCURRENCE`) |
| `changes` | contenu **complet** des champs modifiables : `lines`, `billing`, `initialTermMonths`, `renewal`, `noticeDays`, `clauses` (ce qui n'est pas fourni est repris) |
| `purpose` | `change` \| `renewal` (renouvellement exprès, § 5.3) |
| `status`, `approvals`, `signature`, `contentSha256` | **même cycle** que le contrat (sans « Résilier ») |

Les **conditions en vigueur** à la date D sont calculées par le moteur (`termsAt`) : le contrat, puis
chaque avenant `signed` dont `effectiveDate ≤ D`, dans l'ordre des index. Un avenant non signé n'a
aucun effet.

#### 2.6 `sales_contract_files` (copies et pièces)

`{ contractId, amendmentId | null, orderId | null, kind: 'draft_copy' | 'signed_copy' | 'customer_order', fileName, size, sha256, uploadedBy, uploadedAt }` ;
PDF seul, 10 Mio, servi en téléchargement **inerte** (`Content-Disposition: attachment`, motif
ADR-0039 § 2.5), stockage par l'adaptateur des pièces jointes existant. Une copie signée n'est jamais
remplacée : une nouvelle copie s'ajoute, l'ancienne reste (ajout seul). La bibliothèque de documents
(ADR-0046) **présente** ces pièces sur la fiche client, filtrées par `sales.read` (ADR-0046 O5), sans
les copier.

#### 2.7 `sales_document_links` (liens facture ↔ commande, contrat, échéance)

| Champ | Règle |
|---|---|
| `invoiceId` | `sales_invoices` de l'organisation |
| `kind` | `order_invoice` · `order_deposit` · `contract_invoice` · `contract_deposit` · `schedule_item` · `subscription_occurrence` |
| `orderId` \| `contractId` | selon `kind` |
| `itemRef` \| `occurrenceDate` | échéance d'un `schedule`, ou date d'occurrence d'un abonnement |
| `lineMap` | `[{ invoiceLineIndex, lineRef, quantity }]` posé à la préparation (reste à facturer, § 7) |
| `requestedAmount` | acompte seulement : montant demandé (cible), dans la devise du document |
| `linkedAt`, `linkedBy` (`system:subscriptions` pour la tâche) | |

Index uniques : `{ organizationId, invoiceId }` (une facture appartient à un engagement au plus) ;
`{ organizationId, contractId, occurrenceDate }` partiel (`kind = subscription_occurrence`) ;
`{ organizationId, contractId, itemRef }` partiel (`kind = schedule_item`). Un brouillon supprimé laisse
un lien orphelin, ignoré à la lecture et nettoyé au passage (motif `work_invoice_links`) : l'échéance
redevient « à préparer ».

### 3. Contrat HTTP (préfixe `/sales`, `AuthGuard`, organisation de la session, 404 hors organisation)

| Méthode et chemin | Permission |
|---|---|
| `GET /sales/orders` · `GET /sales/orders/:id` · `GET /sales/contracts` · `GET /sales/contracts/:id` · `GET …/amendments` · `GET …/files/:fileId` · `GET /sales/contract-settings` | `sales.read` |
| `POST /sales/orders` · `PUT /sales/orders/:id` · `DELETE /sales/orders/:id` (brouillon) · `POST …/confirm` · `…/close` · `…/cancel` · `POST /sales/quotes/:id/to-order` | `sales.contract` |
| `POST /sales/contracts` · `PUT /sales/contracts/:id` · `DELETE` (brouillon v1 jamais soumis) · `POST …/submit` · `…/new-version` · `…/cancel` · `…/signature` · `POST …/files` · `POST /sales/quotes/:id/to-contract` | `sales.contract` |
| `POST /sales/contracts/:id/amendments` · `PUT …/amendments/:aid` · `POST …/amendments/:aid/submit` · `…/signature` | `sales.contract` |
| `POST /sales/contracts/:id/approve` · `…/reject` · `…/amendments/:aid/approve` · `…/reject` · `…/renewals` (constater) · `…/terminate` | `sales.contract.approve` (case ⓢ) |
| `POST /sales/orders/:id/prepare-invoice` · `POST /sales/orders/:id/prepare-deposit` · `POST /sales/contracts/:id/prepare-deposit` · `POST /sales/contracts/:id/occurrences/:key/prepare` | `sales.read` + `sales.manage` |
| `PUT /sales/contract-settings` | `sales.contract.approve` |
| `GET /sales/contracts/:id/schedule` (échéances : préparées, à préparer, à venir, bloquées) | `sales.read` |

Corps `.strict()`, montants en chaînes, erreurs au format des contrôleurs de ventes, listes paginées
par curseur. La préparation de facture répond `{ invoiceId, warnings }` et ouvre le brouillon ; elle
**n'émet rien** : « Émettre » et « Normaliser » restent les routes existantes sous `sales.invoice`.

### 4. Parcours et raccords

```
CRM (ADR-0040)        Ventes (ADR-0035 + cet ADR)                       RUN aval (inchangé)
prospect ─▶ opportunité ─▶ devis accepté ─┬─▶ brouillon FV (convert, inchangé)
                                          ├─▶ commande client ─┬─▶ brouillon FT/ET (acompte)
                                          │                    └─▶ brouillon FV (livré, reste)
                                          └─▶ contrat ─ avenants ─┬─▶ brouillons FT/ET, FV d'échéancier
                                                │                 └─▶ brouillons FV d'abonnement (tâche)
                                                └─▶ projet (from-quote / from-opportunity, ADR-0039/0040)
brouillon ─« Émettre / Normaliser » (sales.invoice, ADR-0023/0024)─▶ facture ─▶ encaissement (ADR-0031)
  ─▶ trésorerie (ADR-0034) ─▶ comptabilité en projet (ADR-0049) ; réalisé (ADR-0031 § 3)
```

#### 4.1 CRM (ADR-0035, ADR-0040)

- Depuis un devis `accepted` : « Créer la commande » ou « Créer le contrat » (lignes à prix fixés, motif
  O3 d'ADR-0035) ; le devis n'est pas modifié ; la commande ou le contrat garde `source.quoteId`.
- La fiche 360° du compte (ADR-0040 § 3.1) gagne deux blocs en lecture : commandes ouvertes, contrats
  (statut dérivé, prochaine échéance, date limite de préavis). Aucun écrit dans `crm_*`.
- L'opportunité n'est pas déplacée par un contrat : le gain reste porté par le devis accepté
  (`autoWinOnQuoteAccepted`).

#### 4.2 Projets (ADR-0039, ADR-0040 § 6.4)

- « Créer le projet » depuis un contrat **délègue** : à `from-quote` si le contrat vient d'un devis, à
  `from-opportunity` sinon s'il a une opportunité gagnée ; le contrat garde `projectId`. Sans devis ni
  opportunité : « Lier un projet existant ». **Aucune route `work` nouvelle en v1** ; aucune ligne de
  `work/billing/` ne change.
- Un jalon terminé continue de préparer sa facture par ADR-0039 § 6.3 ; s'il est lié à une commande, la
  préparation passe par la commande (`prepare-invoice`) pour que le reste à facturer soit juste. Le lien
  projet ↔ facture reste `work_invoice_links` ; les deux liens coexistent (ils ne portent pas la même
  chose).

#### 4.3 Factures (ADR-0022 à ADR-0028)

- Toute facture naît par `InvoiceDraftsService.create`, type `FV`/`EV` (finale, échéance) ou `FT`/`ET`
  (acompte), client et devise de l'engagement, **lignes à prix fixés** des conditions en vigueur à la
  date de l'échéance.
- Ligne de commentaire C : « Commande CC… » / « Contrat CT… — échéance du … » / « Abonnement CT… —
  période du … au … » ; pour une facture finale, le rappel des codes des factures d'acompte liées (§ 5.2).
  La longueur de C est celle d'ADR-0023 ; un texte trop long est tronqué avec un avertissement.
- Après la préparation, le brouillon est **un brouillon ordinaire** : l'utilisateur le modifie, le
  supprime, l'émet ou le normalise par le circuit existant. Aucun appel e-MCF/DGI n'est fait par ce
  module.

#### 4.4 Trésorerie et encaissements (ADR-0031, ADR-0034)

- Inchangés : une facture d'acompte émise est une créance, réglée par un encaissement ordinaire ; la
  trésorerie voit l'encaissement.
- Les échéances **non encore préparées** n'entrent **pas** dans la prévision de trésorerie en v1
  (décision ouverte n° 15) ; elles sont visibles dans l'échéancier du contrat.

#### 4.5 Comptabilité et réalisé (ADR-0049, ADR-0031)

- **Aucune règle nouvelle.** La comptabilité lit les factures émises comme aujourd'hui : `FT`/`ET` sous
  `sale.deposit.*`, au compte d'attente tant que la question E1.4 d'ADR-0049 n'a pas de règle validée.
- Le pont vers le réalisé exclut toujours les acomptes (ADR-0031 décision n° 1) ; une facture
  d'abonnement est une `FV` ordinaire, rattachée au mois civil de son émission (règle existante ; la
  répartition sur la période facturée est une question, EC4).
- `sales_document_links` n'est lu ni par la comptabilité ni par le pont : il n'a aucun effet fiscal ni
  comptable.

### 5. Acomptes, échéances et abonnements

#### 5.1 Préparer une facture d'acompte

`POST /sales/{orders|contracts}/:id/prepare-deposit` `{ type: 'FT' | 'ET', requestedAmount, taxGroup, label? }` :

- exige une commande `confirmed` ou un contrat `signed` ;
- crée un brouillon `FT`/`ET` avec **une ligne libre** dont le libellé est prérempli (« Acompte —
  commande CC… ») et le prix égal au montant demandé dans le mode de prix de l'engagement ; **le groupe
  de taxation est exigé dans la requête et jamais prérempli par l'écran** : une ligne libre exige déjà
  son groupe (`invoices.dto.ts`), et l'utilisateur le choisit lui-même (`400` si absent) — la taxation
  d'un acompte est une question (EC2) ;
- pose un lien `order_deposit` / `contract_deposit` avec `requestedAmount` ; l'écran signale l'écart
  entre le total du brouillon (calculé par le moteur) et le montant demandé, sans le corriger ;
- aucune valeur par défaut de pourcentage (décision ouverte n° 12).

#### 5.2 Rappel de l'acompte sur la facture finale

- Quand une facture est préparée depuis une commande ou un contrat qui a des factures d'acompte liées et
  **émises** (`issued` ou `normalized`, série réelle), la ligne C reçoit leurs codes (code DEF/DGI pour une
  facture normalisée, numéro sinon) — **seul mécanisme sourcé** (ADR-0023 § S25e.7).
- L'écran montre, à côté du brouillon, les acomptes de l'engagement (facturés, encaissés, par devise) et
  l'avertissement : « Comment la facture finale tient compte de l'acompte est à confirmer avec votre
  expert-comptable. Lalanda ne retire rien automatiquement. »
- **Aucune** ligne de déduction, **aucun** paiement déclaré prérempli, **aucun** avoir automatique
  (O5, décision ouverte n° 11). Le moteur signale `DEPOSIT_NOT_RESOLVED` sur l'engagement tant qu'un
  acompte émis coexiste avec une facture finale sans que l'utilisateur ait marqué l'acompte « traité »
  (geste déclaratif `POST …/deposits/:invoiceId/resolved`, `sales.manage`, motif libre, audit).

#### 5.3 Échéancier et abonnement

- **Tâche** `sales.subscriptions.prepare` (ordonnanceur ADR-0020, quotidienne, au moins une fois,
  idempotente) : pour chaque contrat `signed`, `billing.kind ∈ { schedule, recurring }`, `autoPrepare`
  (contrat et réglage), chaque échéance de `[aujourd'hui − 90 j, aujourd'hui + subscriptionLeadDays]`
  sans lien vivant → `InvoiceDraftsService.create` puis lien (index unique : rejouer ne crée rien).
  `createdBy` = `system:subscriptions`, journalisé.
- **Échéance bloquée** (aucun brouillon, motif affiché) : client archivé, calcul en erreur (taux DGI
  indisponibles), terme échu sans reconduction constatée (`RENEWAL_NOT_RECORDED`), résiliation effective,
  avenant non signé dont la date d'effet est passée (`AMENDMENT_PENDING`).
- **Préparer maintenant** (`…/occurrences/:key/prepare`) : même effet, à la main, `sales.manage`.
- **Émission** : facture par facture, par l'utilisateur (`sales.invoice`) ; l'élément « Brouillons
  d'abonnement à émettre » de « Mes tâches » mène à la liste filtrée. Aucune émission ni normalisation
  groupée en v1 (décision ouverte n° 8).
- **Reconduction tacite** : à la fin d'un terme, si `renewal.mode = 'tacit'`, que le contrat n'est pas
  résilié et que `maxRenewals` n'est pas atteint, le moteur propose le terme suivant ; un détenteur de
  `sales.contract.approve` le **constate** (`POST …/renewals`, ajout seul) ; sans ce geste, rien n'est
  préparé au-delà du terme. `renewal.mode = 'explicit'` : le renouvellement est un **avenant**
  `purpose: 'renewal'` ; `none` : le contrat finit au terme.

### 6. Alertes : « Mes tâches », cloche

Port `SALES_CONTRACTS_AGENDA_SOURCE` (`work/my-tasks.ports.ts`), fournisseur nul par défaut, fournisseur
réel `sales/contracts/agenda/contracts-agenda.source.ts` en **lecture seule** ; éléments
`SalesContractMyTaskItem` (`source: 'sales_contracts'`, identifiant préfixé `sct:`), fusionnés par
`myTasks` comme ceux du CRM ; droits **effectifs** (ADR-0041) vérifiés par élément.

| Élément | Pour qui | Échéance affichée |
|---|---|---|
| Contrat ou avenant à approuver | détenteurs de `sales.contract.approve`, sauf celui qui l'a soumis (sauf approbateur unique) | date de soumission |
| Date limite de préavis proche | responsable du contrat | date limite − `noticeAlertDays` → date limite |
| Fin de terme proche (`none`, `explicit`) | responsable | fin − `termEndAlertDays` |
| Reconduction à constater (`tacit`) | détenteurs de `sales.contract.approve` | fin du terme |
| Copie signée manquante sur un avenant approuvé depuis 15 jours | responsable | — |
| Brouillons d'échéance à émettre | détenteurs de `sales.invoice` (un élément agrégé par organisation) | échéance la plus ancienne |
| Échéance bloquée | responsable | date d'échéance |

« Cocher » un élément renvoie à l'écran propriétaire (aucune route d'écriture « agenda » commune, motif
ADR-0040 § 5.3). Notifications (types déclarés dans `shared/notifications`) :
`sales.contract_submitted`, `sales.contract_approved`, `sales.contract_rejected`,
`sales.contract_notice_due`, `sales.contract_term_ending`, `sales.subscription_drafts_ready` ;
destinataires par `holdersOf`, jamais par rôle. Brief du matin : **aucune règle en v1** (décision
ouverte n° 17).

### 7. Moteur — `packages/engine/src/contracts/`, `CONTRACTS_VERSION = '1.0.0'`

Module pur : ni base, ni réseau, ni horloge (la date du jour est un paramètre) ; il ne touche ni
`ENGINE_VERSION`, ni `INVOICE_TOTALS_VERSION`, ni `TREASURY_VERSION`.

| Fonction | Rôle |
|---|---|
| `termsAt(contract, amendments, date)` | conditions en vigueur à une date (§ 2.5) |
| `contractTerms(contract, amendments, renewals, termination, today)` | terme en cours, fin, **date limite de préavis** (= fin − `noticeDays`, jour civil), statut dérivé, terme suivant proposé |
| `billingOccurrences(billing, terms, from, to)` | échéances ; récurrence par `occurrencesOf` du module `treasury` (importé, non recopié) |
| `occurrenceStatus(occurrences, links, blocks)` | préparée, à préparer, à venir, bloquée (motif) |
| `orderInvoicing(lines, linkedFrozenInvoices)` | reste à facturer par `lineRef` ; une ligne de facture dont l'article ou le prix unitaire ne correspond plus à `lineMap` est signalée `UNMATCHED_LINE`, jamais devinée |
| `depositSummary(deposits, finals, resolved)` | acomptes facturés, encaissés, par devise ; `DEPOSIT_NOT_RESOLVED` |
| `noticeCheck(noticeGivenOn, effectiveOn, noticeDays)` | comparaison à la **clause saisie** |
| `contractAlerts(contracts, settings, today)` | éléments du § 6 |

Aucun montant n'est recalculé ici : les totaux viennent de `compose` (devis, commandes, contrats) ou des
factures figées. Tests : propriétés à graine fixe (occurrences = énumération naïve, fins de mois, années
bissextiles), bornes des termes, avenants dans le désordre, rejeu idempotent.

### 8. Permissions (amende ADR-0012, docs/12 ; étend ADR-0041)

#### 8.1 Deux actions nouvelles (en fin d'`ACTIONS`)

Rang : cinquante-deuxième et cinquante-troisième si cet ADR fusionne juste après ADR-0049 ; le rang
définitif suit l'**ordre de fusion** (règle d'ADR-0035, amendement du 27 oct. 2026), en particulier
avec ADR-0051 rédigé en parallèle.

| Action | Libellé (ADR-0041 § 5) | Couvre |
|---|---|---|
| `sales.contract` | Préparer contrats et commandes | créer, modifier, soumettre, nouvelle version, annuler ; avenants ; déclarer une signature et téléverser les copies ; commandes clients (créer, confirmer, clore, annuler) ; créer depuis un devis |
| `sales.contract.approve` | Approuver les contrats | approuver ou rejeter un contrat ou un avenant (case ⓢ), constater une reconduction, résilier, réglages |

| Action | PRO | ADM | DIR | CPT | ANA | CDP | CON | LEC | COM | RH | MAG | EXP |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| `sales.contract` | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ |
| `sales.contract.approve` | ✓ⓢ | ✗ | ✓ⓢ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

Rappel des actions existantes utilisées (inchangées) : préparer une facture depuis un engagement exige
`sales.manage` ; l'émettre, `sales.invoice` ; lire, `sales.read`.

Justifications :

- **`sales.contract`** : iso-privilège avec `sales.quote` (ADR-0040 § 4.1) — le Commercial prépare le
  contrat de l'affaire qu'il a gagnée, comme il a préparé le devis ; l'Administrateur prépare comme il
  gère clients et catalogue. Le Conseiller (externe), le Lecteur, l'Analyste, le Responsable RH, le
  Magasinier, l'Expert-comptable n'engagent pas l'organisation envers un client.
- **`sales.contract.approve`** : approuver un contrat, en constater la reconduction ou le résilier
  **engage** l'organisation ; Propriétaire et Directeur financier. Le **Comptable** prépare mais
  n'approuve pas (il ne gouverne pas les engagements commerciaux) ; l'**Administrateur** non plus (motif
  de `sales.invoice` et `accounting.post`) — décision ouverte n° 2.
- **Plateforme** : `sales.contract` sous accès délégué pour le super-administrateur (comme
  `sales.manage`) ; `sales.contract.approve` rejoint **`PLATFORM_FORBIDDEN_ACTIONS`** : la plateforme
  n'engage jamais un client envers ses propres clients.
- Matrice : **12 × 53 + 6 × 53 = 954** cases si cet ADR fusionne juste après ADR-0049 ; recalculée à la
  fusion (ADR-0051).

#### 8.2 Aucun rôle nouveau

Les rôles existants suffisent. Un rôle « Juriste » ou « Administration des ventes » serait un autre ADR.

#### 8.3 Compatibilité avec ADR-0041 et séparation des tâches

- **Dépendances** : `sales.contract` → `sales.read` ; `sales.contract.approve` → `sales.read`. Chaque
  ligne de la matrice les satisfait (test).
- **Domaine** : les deux actions rejoignent le domaine existant « Ventes et facturation », après
  `sales.quote` ; aucun domaine nouveau.
- **Séparation dynamique** : `sales.contract.approve` rejoint `APPROVAL_ACTIONS` (cases ⓢ). Fonction pure
  `contractApprovalDecision({ approverUserId, submittedBy, createdBy, holdersCount, allowSoleApprover })` :
  celui qui a soumis ou créé ne l'approuve pas (`409 SELF_APPROVAL_FORBIDDEN`), sauf **approbateur
  unique** (un seul détenteur effectif, `allowSoleApprover`), marqué `soleApprover: true`. Même règle pour
  un avenant et pour la constatation d'une reconduction préparée par un autre.
- **Aucune paire `SOD_PAIRS` nouvelle** : une paire statique empêcherait l'entrepreneur seul de
  contracter (motif ADR-0049 § 8.3).
- **Non délégable** : rien de nouveau. Destinataires des notifications : par `holdersOf`.

### 9. Interface (web)

- Deux onglets dans l'espace Ventes (ADR-0038) : **Commandes** et **Contrats** (`sales.read`), entre
  Devis et Factures. Abonnements : filtre « récurrents » de la liste des contrats, pas d'onglet de plus.
- Fiche contrat : statut dérivé, conditions en vigueur, historique (versions, avenants, approbations,
  signature, reconductions), **échéancier** (préparées, à préparer, à venir, bloquées), acomptes,
  factures liées et solde dû par devise (lecture des encaissements), copies, projet lié.
- Fiche commande : lignes, **reste à facturer**, acomptes, factures liées, pièce du client.
- Sur le devis accepté : « Créer la commande », « Créer le contrat » à côté de « Convertir » (ADR-0035).
- Bandeau constant sur la fiche contrat : « Les clauses de durée, de reconduction et de préavis sont
  celles que vous avez saisies. Lalanda calcule les dates ; il ne vérifie pas leur validité juridique. »
- Accessibilité (ADR-0030 § 5) : statuts distingués par libellé et forme, pas seulement par couleur.

### 10. Ce que cet ADR n'invente pas

- **Aucune règle fiscale** : taxation d'un acompte, construction de la facture finale, exigibilité de la
  TVA, répartition d'un abonnement payé d'avance, prorata — questions EC1 à EC6 et DGI1 à DGI3.
- **Aucune règle juridique** : validité de la reconduction tacite, préavis minimal, mentions
  obligatoires d'un contrat ou d'une commande, valeur probante d'une copie signée ou d'une signature
  électronique, durée de conservation — questions JU1 à JU7. Les clauses sont **saisies** ; Lalanda
  calcule des dates à partir d'elles et l'affiche.
- **Aucun modèle de clause** de contrat, aucun texte juridique proposé par Lalanda ni par l'IA.
- **Aucune** pièce fiscale nouvelle, **aucun** champ nouveau sur `sales_invoices`.

## Hors périmètre (v1), dit explicitement

- **Signature électronique via une intégration** (prestataire de signature) : décision ouverte n° 6 ;
  v1 = PDF signé téléversé et signature **déclarée**.
- **Émission ou normalisation automatique** d'une facture, même d'abonnement.
- Envoi du contrat ou de la commande par e-mail (ADR-0042) : décision ouverte n° 19.
- Bons de livraison, réservation de stock à la commande (les sorties restent lues des factures, ADR-0046).
- Indexation ou hausse de prix automatique, remises de fidélité, essais gratuits, paiement en ligne,
  prélèvement automatique, portail client, relances d'impayés.
- Facturation à l'usage ou au temps passé ; prorata ; pourcentages d'échéancier.
- Acomptes fournisseurs (ADR-0044 décision n° 7) ; abonnements de Lalanda à ses abonnés (ADR-0047).
- Conversion de devises ; toute écriture dans le réalisé ou un plan.
- L'IA explique un contrat, une échéance ou un reste à facturer ; elle ne rédige pas de clause et
  n'approuve, ne prépare ni n'émet rien.

## Conséquences

- Collections nouvelles : `sales_orders`, `sales_order_counters`, `sales_contracts`,
  `sales_contract_counters`, `sales_contract_amendments`, `sales_contract_files`,
  `sales_document_links`, `sales_contract_settings` ; toutes portent `organizationId`.
- Module nouveau `apps/api/src/sales/contracts/` (commandes, contrats, avenants, liens, tâche, agenda) ;
  il **lit** `sales_quotes`, `customers`, `sales_invoices`, `sales_invoice_settlements`, `work_projects` ;
  il **n'écrit** dans `sales_invoices` que par `InvoiceDraftsService.create` (la liste fermée des
  écrivains ne change pas).
- Moteur : module `contracts` nouveau ; `occurrencesOf` importé du module `treasury` (aucun changement
  de version).
- RBAC : deux actions, une case ⓢ de plus, un interdit plateforme de plus ; docs/12 amendé.
- Une tâche d'ordonnanceur de plus (`sales.subscriptions.prepare`), quotidienne.
- « Mes tâches » : un port de plus ; la cloche : six types de notification.
- docs/15 (collections), docs/16 (routes), docs/28 § 1.3 (questions JU1 à JU7) à amender par le lot de
  documentation de V0.

## Critères d'acceptation (testables)

1. **Permissions** : un `sales_rep` crée, modifie et soumet un contrat (`200`) mais `403` sur
   `approve`, `terminate`, `renewals` et `prepare-deposit` ; un `accountant` prépare un contrat et une
   facture d'acompte (`200`), `403` sur `approve` ; un `admin` prépare (`200`), `403` sur `approve` ; un
   `viewer` et un `analyst` lisent (`200`), `403` sur toute écriture ; un `advisor`, un `hr_manager`, un
   `storekeeper`, un `external_accountant` : `403` sur `GET /sales/contracts`. Matrice et sonde e2e
   vertes ; un acteur plateforme sous accès délégué : `403` sur `approve`.
2. **Séparation des tâches** : avec deux détenteurs (Propriétaire, Directeur financier), celui qui a
   soumis ne peut pas approuver (`409 SELF_APPROVAL_FORBIDDEN`), l'autre le peut ; seul détenteur avec
   `allowSoleApprover` → approbation marquée `soleApprover: true` ; réglage à `false` → `409`.
3. **Devis → commande** : un devis `accepted` donne une commande `draft` aux **prix du devis** même si le
   catalogue a changé ; une deuxième commande vivante pour le même devis → `409 ORDER_EXISTS_FOR_QUOTE`
   (identifiant existant) ; le devis est **égal octet pour octet** avant et après.
4. **Reste à facturer** : commande de 10 unités ; facture préparée pour 6, émise ; reste 4 ; une seconde
   préparation propose 4 ; après émission, `invoicing = invoiced` et « Clore » est proposé ; une ligne
   modifiée dans le brouillon (autre article) → `UNMATCHED_LINE`, reste inchangé.
5. **Contrat** : un contrat non signé se modifie en `draft` seulement (`409 CONTRACT_NOT_DRAFT` sinon) ;
   « Nouvelle version » depuis `submitted` archive la v1 dans `previousVersions` ; « Déclarer la
   signature » sans PDF → `422 SIGNED_COPY_REQUIRED` ; après signature, `PUT` → `409` et
   `contentSha256` est posé.
6. **Avenant** : avenant signé au 1er mars changeant le prix ; `termsAt` au 28 février rend l'ancien prix,
   au 1er mars le nouveau ; un avenant daté avant une échéance déjà préparée → `409
   AMENDMENT_BEFORE_PREPARED_OCCURRENCE` ; un avenant non signé n'a aucun effet.
7. **Préavis et terme** : contrat du 15 janv. 2027, 12 mois, préavis 30 jours, reconduction tacite de
   12 mois → fin du terme 14 janv. 2028 (jour civil), date limite de préavis 15 déc. 2027, élément
   « préavis » dans « Mes tâches » du responsable à partir du 15 nov. 2027 (`noticeAlertDays` 30). Les
   dates exactes de borne (« fin = veille de l'anniversaire ») sont fixées par le test et rappelées dans
   l'écran ; leur valeur juridique reste la question JU1.
8. **Reconduction tacite** : au terme échu sans constat, aucune échéance du terme suivant n'est préparée
   (`RENEWAL_NOT_RECORDED`) ; après `POST …/renewals` (détenteur de `sales.contract.approve`), la tâche
   prépare l'échéance ; `maxRenewals` atteint → plus de terme proposé.
9. **Abonnement** : contrat mensuel ancré le 31 janv. → brouillons des 31 janv., 28 (ou 29) févr.,
   31 mars ; la tâche rejouée deux fois le même jour ne crée **qu'un** brouillon par échéance ; les
   brouillons sont `draft` (pro forma), sans numéro fiscal ; **aucun** appel au faux serveur e-MCF.
10. **Jamais d'émission automatique** : après la tâche, aucune facture `issued`, `pending_normalization`
    ni `normalized` n'a pour créateur ou émetteur `system:subscriptions` (test sur le journal).
11. **Brouillon supprimé** : supprimer un brouillon d'échéance rend l'échéance « à préparer » ; la
    tâche suivante la prépare de nouveau (si `autoPrepare`).
12. **Acompte** : `prepare-deposit` sans `taxGroup` → `400` ; avec le groupe choisi, il crée sur une
    commande confirmée un brouillon `FT` à une ligne libre de ce groupe, et l'écran n'en propose aucun
    par défaut ; émission normale ; la facture finale préparée ensuite porte en ligne C le numéro (ou code
    DGI) de la `FT` ; **aucune** ligne négative ni paiement prérempli ; `DEPOSIT_NOT_RESOLVED` jusqu'au
    geste « traité ».
13. **Raccords inchangés** : avec des `FT` émises et des factures d'abonnement émises, le réalisé
    (ADR-0031), les écritures comptables (ADR-0049, `sale.deposit.*` au compte d'attente sans règle) et
    la trésorerie sont **identiques** à ceux obtenus en créant les mêmes factures à la main.
14. **Résiliation** : résiliation notifiée le 1er déc. 2027 avec effet au 14 janv. 2028 et préavis saisi
    de 60 jours → `noticeCheck = below_clause` affiché, résiliation **acceptée** ; aucune échéance après
    le 14 janv. 2028.
15. **Mes tâches** : un Propriétaire voit « Contrat à approuver » soumis par un Commercial ; le Commercial
    ne le voit pas ; un `accountant` voit « Brouillons d'échéance à émettre » ; un retrait de
    `sales.invoice` par écart (ADR-0041) fait disparaître l'élément.
16. **Copies** : un PDF de plus de 10 Mio ou non PDF → `422` ; le téléchargement est servi en
    `attachment` ; une seconde copie signée s'ajoute sans effacer la première.
17. **Isolation** : toute ressource d'une autre organisation → `404` ; un lien vers une facture d'une
    autre organisation est impossible.
18. **Mots** : aucun écran, export ni réponse ne dit « conforme », « valable juridiquement » ni
    « reconduit automatiquement » (test des libellés).

## Plan de validation

- **Moteur (vitest)** : `termsAt`, `contractTerms` (bornes, durée indéterminée, `maxRenewals`,
  résiliation), `billingOccurrences` (égalité avec `occurrencesOf`, fins de mois, bissextiles),
  `orderInvoicing` (cumul, `UNMATCHED_LINE`), `depositSummary`, `noticeCheck`, `contractAlerts` ;
  propriétés à graine fixe.
- **Shared (vitest)** : schémas `@lalanda/shared/sales-contracts` (`.strict()`, montants en chaînes,
  codes) ; types de notification ; `SalesContractMyTaskItem`.
- **API e2e (Mongo en mémoire)** : `sales-orders.e2e`, `sales-contracts.e2e` (cycle, versions,
  séparation, signature, avenants, résiliation), `sales-deposits.e2e`, `sales-subscriptions.e2e`
  (tâche, idempotence, blocages, aucune émission), `my-tasks.e2e` étendu, `rbac-matrix.e2e`,
  `invoices.sources.test.ts` (liste des écrivains inchangée), égalité des devis et factures avant et
  après.
- **Web (vitest, modèles purs)** : `ventes/contrats/_components/*-model.ts`, `ventes/commandes/…`,
  `mes-taches-model.ts` (éléments « Contrat »), libellés interdits.
- **Essai de la dirigeante** : un devis accepté donne un contrat d'abonnement mensuel de 12 mois avec
  préavis de 30 jours ; le Commercial le prépare, elle l'approuve, téléverse la copie signée ; un acompte
  `FT` est préparé, son groupe choisi, émis, encaissé ; les brouillons mensuels apparaissent, elle les
  émet ; un avenant change le prix au troisième mois ; l'alerte de préavis apparaît ; la reconduction est
  constatée ; une commande ponctuelle est facturée en deux fois.

## Questions pour l'expert-comptable

**EC1 — Facture finale après acompte.** Une facture d'acompte `FT` a été émise et encaissée. La facture
finale doit-elle porter le **total** de la vente (et comment l'acompte est-il alors constaté : paiement
déclaré, avoir `FA` sur la `FT`, autre) ou le **solde** seulement ? Rejoint la question E1.4 d'ADR-0049.

**EC2 — Taxation de l'acompte.** Quel groupe de taxation porte la ligne d'une facture d'acompte : celui
des biens ou services finalement vendus, ou un autre ? Si la vente mêle plusieurs groupes, faut-il
ventiler l'acompte ? La TVA est-elle exigible à la facture d'acompte ou à l'encaissement (rejoint E2.3
d'ADR-0049) ?

**EC3 — Réalisé et chiffre d'affaires.** Confirmez-vous l'exclusion des acomptes du chiffre d'affaires
du mois (ADR-0031 décision n° 1) et leur prise en compte à la facture finale ?

**EC4 — Abonnement payé d'avance.** Une facture d'abonnement annuel émise en janvier : le produit est-il
celui du mois d'émission, ou réparti sur la période couverte (produits constatés d'avance) ? Faut-il que
le réalisé et la comptabilité le répartissent ?

**EC5 — Prorata et résiliation en cours de période.** Une période commencée puis résiliée : avoir
partiel, aucune régularisation, ou autre ? Sur quelle base de calcul ?

**EC6 — Avance sans facture.** Un client paie avant toute facture d'acompte : faut-il émettre une `FT`
(rejoint ADR-0031 décision n° 4) ?

**À transmettre à la DGI par l'expert si nécessaire** — **DGI1** : la ligne C sert-elle aussi à d'autres
mentions (commande, période) quand elle rappelle un acompte, et quelle est sa longueur maximale ?
**DGI2** : quelle construction de la facture finale la DGI attend-elle après une `FT` normalisée ?
**DGI3** : `FT` ou `ET` pour un acompte à l'export (déjà posée, ADR-0026 § 5).

## Questions pour le juriste (s'ajoutent à docs/28 § 1.3)

- **JU1 — Reconduction tacite** : est-elle valable entre professionnels et envers un consommateur en
  droit congolais ? Le client doit-il être informé avant la date limite de non-reconduction (délai,
  forme) ? Une durée maximale ou un nombre maximal de reconductions s'impose-t-il ?
- **JU2 — Préavis** : existe-t-il un préavis minimal légal selon la nature du contrat (prestation de
  services, location, maintenance) ? Comment se compte-t-il (jours calendaires, date de réception) ?
- **JU3 — Mentions obligatoires** d'un contrat commercial et d'une commande ; langue ; mentions propres
  aux contrats conclus avec un consommateur.
- **JU4 — Preuve** : quelle valeur probante a une copie PDF d'un contrat signé à la main et numérisé ?
  Une signature électronique (simple ou qualifiée) est-elle reconnue, et à quelles conditions ? Préalable
  à la décision ouverte n° 6.
- **JU5 — Conservation** : combien de temps conserver contrats, avenants et commandes (rejoint la
  question 6 de docs/28 § 1.3) ?
- **JU6 — Données personnelles des signataires** (nom, fonction) : base légale et durée (rejoint la
  question 9 de docs/28 § 1.3).
- **JU7 — Modification du prix** d'un contrat en cours ou reconduit : avenant exigé, ou clause
  d'indexation admise ?

## Découpage en lots parallélisables (worktrees séparés)

Règle d'ADR-0011 et d'ADR-0012 § 9 : **un fichier = un seul écrivain** par lot ; les fichiers partagés ne
reçoivent que des **ajouts** d'une ligne ou d'un bloc, sous un commentaire `// ADR-0050 — <lot>`.

| Lot | Contenu | Fichiers possédés (probables) | Critères | Tests | Dépend de |
|---|---|---|---|---|---|
| **V0 — Socle RBAC et contrats partagés** (petit, en premier) | deux actions, matrice, dépendances, domaine, `APPROVAL_ACTIONS`, `PLATFORM_FORBIDDEN_ACTIONS`, `contractApprovalDecision` ; schémas zod ; amendement de docs/12, docs/15, docs/16, docs/28 | `apps/api/src/authz/permissions.ts`, `permissions.test.ts`, `overrides.test.ts`, `__tests__/rbac-matrix.e2e.test.ts` ; `packages/shared/src/sales-contracts/**`, `packages/shared/package.json` (un export) ; `apps/web/src/lib/api.ts` (`OrgAction`) ; `organisation/membres/_components/members-model.ts` (libellés) ; docs | 1, 2 (fonction pure) | matrice ; tables de vérité | — |
| **V1 — Moteur** | `termsAt`, `contractTerms`, `billingOccurrences`, `orderInvoicing`, `depositSummary`, `noticeCheck`, `contractAlerts` | `packages/engine/src/contracts/**` ; **une ligne** dans `packages/engine/src/index.ts` | 4, 6 à 9, 14 (calcul) | vitest, propriétés | — (parallèle à V0) |
| **V2 — Commandes clients et liens** | `sales_orders`, compteur, `sales_document_links`, `to-order`, `prepare-invoice`, reste à facturer, pièces client | `apps/api/src/sales/contracts/{orders,links,files,common}/**`, `sales/contracts/contracts.module.ts` (crée) ; **une ligne** dans `apps/api/src/sales/sales.module.ts` ; e2e `sales-orders.e2e` | 3, 4, 16, 17 | e2e | V0, V1 |
| **V3 — Contrats, versions, avenants, signature, résiliation** | `sales_contracts`, `sales_contract_amendments`, `sales_contract_settings`, compteur, `to-contract`, cycle, approbation, copies signées, reconductions | `apps/api/src/sales/contracts/{contracts,amendments,settings}/**` ; une ligne dans `contracts.module.ts` ; e2e `sales-contracts.e2e` | 5, 6, 7, 14 | e2e | V2 (module, liens, fichiers) |
| **V4 — Acomptes** | `prepare-deposit` (commande, contrat), ligne C de la facture finale, `DEPOSIT_NOT_RESOLVED`, geste « traité » | `apps/api/src/sales/contracts/deposits/**` ; une ligne dans `contracts.module.ts` ; e2e `sales-deposits.e2e` | 12, 13 | e2e (égalité des raccords) | V2 ; V3 pour les contrats |
| **V5 — Échéancier et abonnements** | tâche `sales.subscriptions.prepare`, préparation manuelle, blocages, `GET …/schedule` | `apps/api/src/sales/contracts/subscriptions/**` ; une ligne dans `contracts.module.ts` ; **un bloc** dans l'enregistrement des tâches de l'ordonnanceur ; e2e `sales-subscriptions.e2e` | 8 à 11, 13 | e2e | V3 |
| **V6 — Alertes** | port `SALES_CONTRACTS_AGENDA_SOURCE`, fournisseur, fusion dans `myTasks`, notifications | `apps/api/src/sales/contracts/agenda/**` ; `apps/api/src/work/my-tasks.ports.ts` (**un bloc**) ; `work/work-tasks.service.ts` (méthode `myTasks` seulement) ; `packages/shared/src/work/views.ts` (`MyTaskEntry`, une ligne d'union) ; `packages/shared/src/notifications/index.ts` (six types) ; web `projets/_components/mes-taches*.ts(x)` ; e2e `my-tasks.e2e` étendu | 15 | e2e ; modèle web | V3, V5 |
| **V7 — Web** | onglets Commandes et Contrats, fiches, échéancier, boutons sur le devis accepté, bandeau, libellés interdits | `apps/web/src/app/(app)/ventes/{commandes,contrats}/**` ; `apps/web/src/lib/api-sales-contracts.ts` ; une ligne dans la navigation de l'espace Ventes ; `ventes/devis/[id]/_components/` (boutons, **un bloc**) | écrans § 9, 18 | modèles purs | V0 (coquilles) ; données avec V2 à V6 |

### Zones de conflit entre lots

| Fichier | Lots | Règle |
|---|---|---|
| `apps/api/src/authz/permissions.ts`, `apps/web/src/lib/api.ts` | **V0 seul** ; **conflit avec ADR-0051** (RH) et tout ADR qui ajoute des actions | ajouts en fin de liste ; rang et nombre de cases fixés à la fusion ; tests de matrice recalculés par le second fusionné |
| `packages/engine/src/index.ts` | **V1 seul** | une ligne d'export `contracts` |
| `apps/api/src/sales/sales.module.ts` | **V2 seul** | une ligne (import de `ContractsModule`) |
| `apps/api/src/sales/contracts/contracts.module.ts` | V2 crée ; V3 à V6 ajoutent une ligne chacun | sous leur commentaire |
| `apps/api/src/authz/routes-coverage.test.ts` | V2 à V5 | un bloc par lot, **à la fin** |
| `apps/api/src/work/my-tasks.ports.ts`, `work/work-tasks.service.ts`, `packages/shared/src/work/views.ts` | **V6 seul** ; zone partagée avec ADR-0040 C4, ADR-0044 P3, ADR-0045 H3, ADR-0046 et **ADR-0051** | un bloc ajouté, sans modifier ceux des autres sources |
| `packages/shared/src/notifications/index.ts` | **V6 seul** (et ADR-0051) | six lignes ajoutées |
| enregistrement des tâches de l'ordonnanceur | **V5 seul** | un bloc |
| `apps/api/src/sales/{invoices,normalization,receipts,quotes}/**`, `apps/api/src/{actuals,accounting,treasury,work/billing}/**`, `packages/engine/src/{invoice-totals,receivables,accounting,treasury}/**` | **aucun** | lecture seule ; appels aux services et fonctions exportés (`InvoiceDraftsService.compose`/`create`, `occurrencesOf`) ; si un export manque, une ligne d'export dans le module propriétaire, revue à part |
| `packages/shared/src/sales-contracts/**` | V0 crée ; V2 à V6 **ajoutent** des fichiers | `index.ts` : une ligne d'export par lot |
| docs/12, 15, 16, 28, index des ADR | V0 (documentation) ; chaque lot passe sa ligne « proposé » à « implémenté » | une section par lot |

### Ordre de fusion conseillé

```
V0 ──┬── V2 ── V3 ──┬── V4
V1 ──┘              ├── V5 ── V6
                    └─────────── V7 (coquilles dès V0 ; écrans au fil de V2 à V6)
```

1. **V0** et **V1** en parallèle.
2. **V2** (module, liens, commandes).
3. **V3** ; puis **V4** et **V5** en parallèle.
4. **V6** (après V5) ; écrans **V7**.

Chemin critique : V0 → V2 → V3 → V5 → V6. Les acomptes (V4) se livrent sans attendre les réponses de
l'expert : leur comportement par défaut ne pose aucune règle fiscale.

## Décisions ouvertes — elles appartiennent à la dirigeante

Chacune a une **valeur par défaut**, la plus prudente, appliquée si rien n'est tranché.

1. **Actions** : `sales.contract` et `sales.contract.approve`, matrice du § 8.1. *Défaut : oui.*
2. **L'Administrateur et le Comptable approuvent-ils les contrats ?** *Défaut : non ; Propriétaire et
   Directeur financier seulement ; un ajout par membre (ADR-0041) reste possible.*
3. **Le Commercial prépare contrats, avenants et commandes.** *Défaut : oui, sans approuver ni préparer
   de facture.*
4. **Confirmer une commande client** exige-t-il une approbation ? *Défaut : non ; `sales.contract`
   suffit (la commande reprend un devis déjà accepté).*
5. **Approbation interne avant signature.** *Défaut : exigée pour tout contrat et tout avenant, avec
   séparation dynamique et approbateur unique toléré.*
6. **Signature électronique via une intégration.** *Défaut : hors v1 ; téléversement du PDF signé
   **obligatoire** pour passer en `signed` ; une intégration fera l'objet d'un ADR après la réponse
   JU4 (choix du prestataire, preuve, coût, ADR-0013 pour les secrets, ADR-0017 pour l'interrupteur).*
7. **Préparation automatique des brouillons d'échéance.** *Défaut : oui, le jour de l'échéance
   (`subscriptionLeadDays = 0`), désactivable par organisation et par contrat.*
8. **Émission groupée** (« Émettre la sélection ») pour une organisation non normalisée. *Défaut : non en
   v1 ; une facture à la fois ; jamais de normalisation groupée (limite de dix demandes en attente).*
9. **Reconduction tacite.** *Défaut : calculée et proposée, **constatée par un humain** ; aucun brouillon
   au-delà du terme sans ce constat ; bandeau de non-validation juridique.*
10. **Délais d'alerte.** *Défaut : préavis 30 jours avant la date limite, fin de terme 60 jours avant.*
11. **Imputation de l'acompte sur la facture finale.** *Défaut : aucune automatique ; rappel du code en
    ligne C, affichage des acomptes, geste déclaratif « traité » ; à revoir après EC1 et DGI2.*
12. **Montant et taxation de l'acompte.** *Défaut : montant saisi, aucun pourcentage proposé ; groupe de
    taxation choisi par l'utilisateur, jamais prérempli (EC2).*
13. **Prorata d'une période incomplète** (début ou résiliation en cours de période). *Défaut : aucun
    calcul ; l'utilisateur ajuste le brouillon ou émet un avoir (EC5).*
14. **Échéancier en pourcentages.** *Défaut : non ; chaque échéance porte ses lignes ; un pourcentage
    viendra avec une règle d'arrondi ajoutée au moteur et validée par l'expert (ADR-0039 décision
    n° 10).*
15. **Échéances futures dans la prévision de trésorerie.** *Défaut : non ; visibles dans l'échéancier
    seulement (risque de double compte avec le plan BUILD, ADR-0034 § 7).*
16. **Répartition d'un abonnement payé d'avance** dans le réalisé. *Défaut : aucune ; mois d'émission,
    règle existante, jusqu'à la réponse EC4.*
17. **Brief du matin** (préavis, échéances bloquées). *Défaut : aucune règle en v1 ; « Mes tâches » et
    cloche seulement.*
18. **Document de contrat produit par Lalanda** (modèle PDF à clauses). *Défaut : non ; le contrat est
    rédigé hors Lalanda et téléversé ; Lalanda tient les métadonnées, les dates et les copies.*
19. **Envoi du contrat ou de la commande par e-mail** (ADR-0042). *Défaut : non en v1.*
20. **Client obligatoire** pour une commande ou un contrat. *Défaut : oui ; un prospect est d'abord
    converti en client (ADR-0040).*
21. **Numérotation** `CT{AA}{MM}-NNNNNN` et `CC{AA}{MM}-NNNNNN`, hors série fiscale, trous admis.
    *Défaut : oui.*
22. **Offres** (docs/13). *Défaut : commandes et contrats ouverts à toutes les offres, comme le CRM ;
    abonnements (tâche récurrente) à arbitrer avec le reste du tableau « À ARBITRER ».*

## Liens

- [ADR-0011](ADR-0011-contrats-integration-s18.md) ; [ADR-0012](ADR-0012-modele-rbac-complet.md)
  (amendé) ; [ADR-0013](ADR-0013-stockage-secrets-integration.md) ;
  [ADR-0017](ADR-0017-interrupteur-integrations.md) ; [ADR-0018](ADR-0018-trajectoire-erp-trois-modules.md) ;
  [ADR-0020](ADR-0020-ordonnanceur-mongodb.md) ; [ADR-0022](ADR-0022-clients-catalogue-et-calcul-des-factures.md)
  à [ADR-0028](ADR-0028-modeles-de-facture-et-identite.md) (ventes, **inchangées**) ;
  [ADR-0031](ADR-0031-encaissements-et-realise.md) (inchangé) ;
  [ADR-0034](ADR-0034-depenses-et-tresorerie.md) (`occurrencesOf` réutilisé) ;
  [ADR-0035](ADR-0035-crm-et-devis.md) (complété) ; [ADR-0038](ADR-0038-navigation-par-modules-et-initiatives.md) ;
  [ADR-0039](ADR-0039-projets-et-taches-run.md) (étendu ; décision n° 10 tranchée en partie) ;
  [ADR-0040](ADR-0040-crm-complet.md) (complété) ; [ADR-0041](ADR-0041-autorisations-par-membre.md)
  (étendu) ; [ADR-0042](ADR-0042-envoi-des-documents-par-email.md) ;
  [ADR-0044](ADR-0044-achats-et-fournisseurs.md) (motif d'approbation) ;
  [ADR-0046](ADR-0046-stocks-equipements-documents.md) (présentation des pièces) ;
  [ADR-0047](ADR-0047-factures-des-abonnements-lalanda.md) (sujet distinct) ;
  [ADR-0049](ADR-0049-comptabilite-syscohada.md) (inchangé ; question E1.4).
- [docs/12](../12-ROLES-PERMISSIONS.md) ; [docs/13](../13-PRICING.md) ; [docs/15](../15-DATABASE.md) ;
  [docs/16](../16-API.md) ; [docs/28](../28-CONFORMITE-LEGALE.md).
- Code existant lu : `apps/api/src/sales/quotes/`, `sales/invoices/` (`invoice.contract.ts`,
  `invoice-drafts.service.ts`, `credit-note-rules.ts`), `sales/receipts/`, `apps/api/src/work/billing/`,
  `work/my-tasks.ports.ts`, `apps/api/src/actuals/run-bridge/`, `apps/api/src/treasury/treasury-sources.ts`,
  `packages/engine/src/{invoice-totals,receivables,treasury}/`,
  `packages/engine/src/accounting/{entries/sales.ts,rules/operation-keys.ts}`,
  `apps/api/src/authz/permissions.ts`.
- Code à créer : `apps/api/src/sales/contracts/`, `packages/engine/src/contracts/`,
  `packages/shared/src/sales-contracts/`, `apps/web/src/app/(app)/ventes/{commandes,contrats}/`.
