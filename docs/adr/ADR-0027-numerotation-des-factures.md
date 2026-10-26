# ADR-0027 — Numérotation des factures : `IN{AA}{MM}-NNNNNN`, une série annuelle ininterrompue

Statut : Accepted
Date : 2026-10-21
Décideurs : Gracy Omokoso (dirigeante, décision du 21 oct. 2026 sur le format) ; CTO Lalanda
(contrat technique)

> **Amende [ADR-0023](ADR-0023-factures-et-avoirs.md) § S25e.3** (format des numéros) et
> **tranche sa décision ouverte n° 2** (numéro de facture). Le mécanisme d'ADR-0023 (compteur
> par organisation, série et année, incrément dans la transaction, bail de normalisation,
> numéro rendu au refus) **ne change pas** ; seul l'habillage du rang change. Les méthodes de
> [ADR-0024](ADR-0024-normalisation-dgi.md) (`reserve`, `confirm`, `release`, `holdLease`,
> `dropLease`, `abandon`) gardent leur sens ; `rn` reste le numéro réservé.

## Contexte

ADR-0023 a livré des numéros `AAAA-NNNNNN` (série réelle), `TEST-AAAA-NNNNNN` (série
d'essai, environnement de test DGI) et `PF-AAAA-NNNNNN` (pro forma). La production porte
déjà `2026-000001`, `TEST-2026-000001`, `PF-2026-000001` et `PF-2026-000002`, figés
(`contentSha256`).

La dirigeante veut un numéro qui se lit d'un coup d'œil : la nature du document et le mois
où il a été émis. Elle a tranché le 21 oct. 2026 : `IN{AA}{MM}-{numéro sur 6 chiffres}`,
par exemple `IN2610-000042`.

L'exigence fiscale ne bouge pas : une référence unique par facture, en **série ascendante et
ininterrompue par année de gestion**, par contribuable (NS022 annexe, 1.1.15 et 1.2.1 k ;
grille d'homologation, exigences 1.15 et 2.1 k). Le mois est donc un **repère de lecture**,
pas une série : le compteur ne repart pas à 1 chaque mois.

## Options considérées

1. **Garder `AAAA-NNNNNN`.** Écarté : décision de la dirigeante.
2. **Compteur remis à zéro chaque mois** (`IN2610-000001`, `IN2611-000001`). Écarté : douze
   séries par an, contraire à « ininterrompue par année de gestion ».
3. **Série propre aux avoirs** (`AV…` avec son compteur). Écarté pour les raisons d'ADR-0023
   O3 : rien ne l'exige, plus de séries, plus de risques de trou.
4. **Un seul compteur annuel ; préfixe selon la nature (`IN` ou `AV`) ; mois de
   l'attribution imprimé comme repère.** **Retenu.**

## Décision

### Formats

| Document | Série | Compteur | Forme | Exemple |
| --- | --- | --- | --- | --- |
| Facture (FV, FT, EV, ET) | `real` | réel, annuel | `IN{AA}{MM}-NNNNNN` | `IN2610-000042` |
| Avoir (FA, EA) | `real` | **le même** | `AV{AA}{MM}-NNNNNN` | `AV2610-000043` |
| Facture, environnement de test DGI | `test` | essai, annuel, propre | `TEST-IN{AA}{MM}-NNNNNN` | `TEST-IN2610-000001` |
| Avoir, environnement de test DGI | `test` | **le même que TEST-IN** | `TEST-AV{AA}{MM}-NNNNNN` | `TEST-AV2610-000002` |
| Pro forma (brouillon) | `proforma` | pro forma, annuel, trous admis | `PF{AA}{MM}-NNNNNN` | `PF2610-000003` |

- `AA` : deux derniers chiffres de l'année de gestion (format valable de 2000 à 2099) ;
  `MM` : mois (01 à 12) ; `NNNNNN` : rang dans la série de l'année, sur 6 chiffres, qui
  s'allonge au-delà de 999 999.
- Une seule série par organisation et par année pour les factures **et** les avoirs :
  `IN2610-000041`, `AV2610-000042`, `IN2611-000043` est une suite correcte.
- Longueur : 13 caractères (18 avec `TEST-`), loin de la limite de 64 du `rn` DGI.
- Les références d'étalonnage (`CAL-AAAAMMJJ-<cas>-<mode>`, ADR-0024) restent hors série.

### Année et remise à zéro

Année de gestion = année civile au fuseau **Africa/Kinshasa** (UTC+1, sans heure d'été),
comme dans ADR-0023 (à confirmer par l'expert-comptable, décision ouverte n° 2 d'ADR-0023).
Le compteur repart à 1 le 1ᵉʳ janvier 0 h 00 à Kinshasa : `IN2612-000873` le 31 déc. à
23 h 30 (Kinshasa), `IN2701-000001` le 1ᵉʳ janv. 2027. Le 31 déc. à 23 h 30 **UTC** est
déjà le 1ᵉʳ janv. à Kinshasa : il appartient à 2027.

### Mois imprimé

Le mois est celui de l'**attribution** du numéro, à Kinshasa :

- **mode ordinaire** : mois de la date d'émission figée (`issuedAt`), elle-même lue après
  l'incrément et bornée par `lastIssuedAt` du compteur. Un rang plus grand n'a donc jamais
  un mois plus ancien, même si deux émissions se croisent à minuit ;
- **mode normalisé** : mois de la **réservation** (bornée de même par `lastIssuedAt`). Le
  numéro réservé part à la DGI dans `rn` et devient définitif tel quel : il ne change pas à
  la confirmation ;
- l'année imprimée est **toujours** celle du compteur : un instant d'une autre année (horloge
  en avance, date DGI après minuit) est ramené en décembre ou en janvier de l'année du
  compteur. Sinon deux compteurs pourraient produire la même chaîne ;
- un numéro rendu (refus DGI) est repris par le document suivant **avec son propre préfixe
  et son propre mois** : `TEST-IN2610-000002` rendu le 31 oct. peut revenir en
  `TEST-AV2611-000002` le 1ᵉʳ nov. Le rang, lui, reste sans trou.

Conséquence assumée : en mode normalisé, une facture réservée le 31 oct. à 23 h 59 et
confirmée par la DGI le 1ᵉʳ nov. porte `…2610…` et une date DGI de novembre (de même pour
une normalisation incertaine reprise plus tard). La continuité légale est portée par le
rang annuel ; voir la question n° 3 à la DGI.

### Continuité avec l'existant

- **Aucune migration** : aucun numéro existant n'est réécrit (documents figés, empreinte).
- Les compteurs ne connaissent que le rang : ceux de 2026 **continuent**. Après
  `2026-000001`, le prochain numéro réel est `IN2610-000002` ; après `TEST-2026-000001`, le
  prochain d'essai est `TEST-IN2610-000002` (ou `TEST-AV…`) ; après `PF-2026-000002`, la
  prochaine référence est `PF2610-000003`.
- La lecture (`parseInvoiceNumber`) accepte **les deux formes** : un numéro réservé à
  l'ancienne forme avant le déploiement (normalisation incertaine) se confirme, se rend ou
  s'abandonne comme avant.
- La recherche (`q`, clé `searchKey`) cherche dans la chaîne du numéro : les deux formes
  sont trouvées, sans changement.

### Code

- `apps/api/src/sales/invoices/invoice-numbering.ts` (nouveau, fonctions pures) :
  `fiscalPeriodOf`, `fiscalYearOf`, `periodInYear`, `fiscalPrefixOf`,
  `formatInvoiceNumber(series, prefix, period, seq)`, `formatProformaRef(period, seq)`,
  `parseInvoiceNumber` (rend `series`, `year`, `month | null`, `prefix`, `seq`, `legacy`).
- `InvoiceNumberingService` : `assignOnIssue` reçoit `type` (choix du préfixe, jamais du
  compteur) ; `reserve` lit le type du document ; `nextProformaRef` habille en `PF…`. Les
  écritures sur `sales_invoice_counters` sont inchangées.
- Web : texte d'aide de la recherche ; aucun affichage ne dépendait du format.

## Conséquences

- L'index unique partiel `{ organizationId, series, number }` garantit l'unicité de la
  **chaîne**, plus celle du **rang** (`IN2610-000042` et `AV2611-000042` sont deux chaînes
  distinctes). L'unicité du rang reste garantie, comme avant, par le compteur incrémenté dans
  la transaction et par le bail ; les tests de concurrence le vérifient. Renfort possible,
  hors de ce lot : stocker le rang (`fiscalSeq`) et l'indexer en unique par organisation,
  série et année. — **Fait le 21 oct. 2026** (amendement plus bas).
- Trier par la chaîne du numéro n'est plus chronologique (`AV…` avant `IN…`) : il faut trier
  par rang (`parseInvoiceNumber(…).seq`) ou par `sortAt`, ce que font déjà les listes.
- Les PDF impriment le numéro tel quel ; le nom de fichier reste `<numéro>.pdf`.
- 2026 mêle deux formes dans une même série (`2026-000001` puis `IN2610-000002`) : la
  continuité se lit sur le rang.

## Plan de validation

- Unitaires (`invoice-numbering.test.ts`) : formats IN, AV, TEST-IN, TEST-AV, PF ; préfixe par
  type ; lecture des deux formes et aller-retour ; formes refusées ; changement de mois et
  d'année à Kinshasa (31 déc. 23 h 30 Kinshasa ≠ 31 déc. 23 h 30 UTC) ; année du compteur
  toujours imprimée.
- e2e (`invoices.e2e.test.ts`) : prochain numéro après l'ancienne forme (IN, AV, PF, TEST-IN,
  TEST-AV, numéro réservé ancien rendu) ; suite sur trois mois et deux années avec avoirs ;
  50 émissions concurrentes mêlant factures et avoirs → une série IN/AV contiguë ; numéro
  rendu repris sous bail ; ancienne forme lue, affichée et trouvée par la recherche.
- `normalization.e2e` et `invoices.homologation.e2e` : numéros `TEST-IN`/`TEST-AV`
  contigus sans trou. Jamais d'appel à la vraie DGI.

## Amendement du 21 oct. 2026 — rang fiscal protégé par un index unique

Réalise le renfort annoncé dans « Conséquences » : l'unicité du **rang** ne repose plus
seulement sur le compteur et le bail.

- **Champ** `fiscalSeq` (entier, `null` sans numéro) sur chaque document de vente numéroté,
  séries `real` et `test`, à côté de `fiscalYear` (déjà présent). Écrit au même instant que
  `number` : `InvoiceNumberingService.assignOnIssue` (mode ordinaire, rang rendu à
  `InvoiceFreezingService`) et `InvoiceNumberingService.confirm` (mode normalisé, rang lu
  dans le numéro réservé). Un numéro réservé, rendu ou abandonné n'a pas de `fiscalSeq` :
  seul un numéro **définitif** occupe un rang.
- **Index** unique partiel `{ organizationId, series, fiscalYear, fiscalSeq }`,
  `partialFilterExpression: { fiscalSeq: { $type: 'number' } }` (`invoice.schema.ts`) ;
  `IndexesService` le crée au démarrage en production, comme les autres. `IN2610-000042` et
  `AV2611-000042` de la même année et de la même série sont désormais refusés par la base
  (E11000), même si le compteur se trompait.
- **Existant** : migration idempotente `apps/api/migrations/20261021-0001-rang-fiscal-factures.mjs`
  (exécuteur `migrations/run.mjs`, consignée dans `_migrations`). Elle lit le rang et l'année
  **dans le numéro** (deux formes : `AAAA-NNNNNN`, `TEST-AAAA-NNNNNN`, `IN|AV{AA}{MM}-NNNNNN`,
  `TEST-…`), écrit `fiscalSeq` (et `fiscalYear` s'il manque) et pose l'index. Elle ne touche
  **ni** `number`, **ni** `contentSha256`, ni aucun champ figé (le rang n'entre pas dans
  l'empreinte, `canonical.ts`). Un numéro illisible, ou dont l'année contredit `fiscalYear`,
  est laissé tel quel et fait échouer la migration à la fin (code non nul) pour qu'on
  l'examine. Ordre de déploiement indifférent (N-1) : une API démarrée avant la migration
  crée l'index sur les seuls documents qui ont déjà un rang.
- Commande de production, une fois après le déploiement (le paquet de l'API embarque
  `migrations/` et le pilote `mongodb` ; le conteneur porte `MONGODB_URI` et `MONGODB_DB`) :
  `docker exec lalanda-prod-api-1 node migrations/run.mjs 20261021-0001-rang-fiscal-factures`.
  Rejouable sans effet.

Tests : `invoices.e2e.test.ts` (rang stocké à l'émission et sous 50 émissions concurrentes,
doublon de rang refusé par l'index, migration rejouée deux fois sur l'existant sans toucher
numéro ni empreinte, lecture des deux formes) ; `normalization.e2e.test.ts` (rang de la
série d'essai à la confirmation).

## Questions à poser à la DGI

1. Dans une série unique et ininterrompue par année, un **préfixe distinct pour les avoirs**
   (`AV2610-000042` entre `IN2610-000041` et `IN2610-000043`) est-il admis, ou les avoirs
   doivent-ils porter le même préfixe que les factures ?
2. **Changement de format en cours d'année** : la série 2026 passe de `2026-000001` à
   `IN2610-000002` sans rupture de rang. Est-ce admis, ou le nouveau format devait-il
   attendre le 1ᵉʳ janvier 2027 ?
3. Le **mois imprimé** est celui de la réservation du numéro (`rn`) ; il peut différer du mois
   de la date de normalisation DGI pour une facture réservée en fin de mois. Est-ce admis ?

Question à l'expert-comptable (reprise d'ADR-0023) : l'année de gestion est-elle bien l'année
civile ?

## Liens

- [ADR-0023](ADR-0023-factures-et-avoirs.md) — factures et avoirs, § S25e.3 (amendé) ;
  [ADR-0024](ADR-0024-normalisation-dgi.md) — `rn`, bail, numéro rendu ou abandonné ;
  [ADR-0026](ADR-0026-campagne-homologation.md) — campagne d'homologation (exigence 1.15).
- Code : `apps/api/src/sales/invoices/invoice-numbering.ts`,
  `apps/api/src/sales/invoices/invoice-numbering.service.ts`.
