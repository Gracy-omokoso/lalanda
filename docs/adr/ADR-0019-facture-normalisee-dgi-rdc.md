# ADR-0019 — Facture normalisée DGI (RDC) : intégrée, activable par organisation

Statut : Proposed
Date : 2026-10-18
Décideurs : Gracy Omokoso

## Contexte

Depuis le 1ᵉʳ avril 2026, les assujettis à la TVA en RDC doivent émettre des
**factures normalisées** : chaque facture est enregistrée auprès de la DGI par un
dispositif électronique fiscal (DEF), qui lui attribue un code d'authentification,
des compteurs et un QR code. Un logiciel de facturation (SFE, « système de
facturation d'entreprise ») peut s'interfacer avec la plateforme **e-DEF** de la DGI
par API, après **homologation** (arrêté n° 034 du 23 oct. 2023). Sources et dates :
[docs/sources/dgi-rdc](../sources/dgi-rdc/README.md).

Une facturation vendue en RDC sans facture normalisée est inutilisable pour un
assujetti. Bien faite, elle devient une différenciation qu'aucune plateforme
généraliste n'offre. Le décideur dispose déjà d'un accès développeur (jeton) ;
l'homologation interviendra une fois l'intégration terminée.

### Ce que dit la spécification e-DEF v2.0 (relevée le 18 oct. 2026)

Authentification par jeton porteur (`Bearer`). Flux en **deux temps** :

1. `POST /api/invoice` — le SFE envoie la facture : `nif` du vendeur, `rn`, `mode`,
   `isf`, `type` (`FV FT FA EV ET EA`), lignes (`code`, `name`, `type`
   `BIE|SER|TAX`, `price`, `quantity`, `taxGroup` `A`…`Z`, taxes spécifiques, prix
   d'origine), `client` (`nif`, `type` `PP|PM|PC|PL|AO`, nom, contact, adresse),
   `operator`, paiements (`ESPECES VIREMENT CARTEBANCAIRE MOBILEMONEY CHEQUES CREDIT
   AUTRE`), référence (pour un avoir), devise (`curCode`, `curDate`, `curRate`).
   La DGI **recalcule** et renvoie un `uid` provisoire et les totaux par groupe de
   taxe (`ta`…`taz`, `ha`…, `va`…, `total`, `vtotal`).
2. `PUT /api/invoice/{uid}/confirm` avec `total` et `vtotal` → `codeDEFDGI`,
   `counters`, `nim`, `dateTime`, `qrCode`. Ou `PUT …/cancel`.

Routes d'information : `status` (validité du jeton, demandes en attente),
`taxGroups`, `invoiceTypes`, `paymentTypes`, `clientTypes`, `referenceTypes`,
`itemTypes`, `currencyRates`.

## Options considérées

1. **Facture normalisée obligatoire pour toute organisation RDC.** Écarté : les non
   assujettis à la TVA n'y sont pas soumis, et un compte sans identifiants DGI
   serait bloqué.
2. **Un seul compte DGI plateforme pour tous.** Écarté : la facture normalisée est
   émise **au nom du contribuable** (son NIF, son dispositif). Le jeton du décideur
   sert au développement et à l'homologation, jamais aux clients.
3. **Intégrée, désactivée par défaut, activable par organisation avec ses propres
   identifiants DGI.** Retenu (décision du 18 oct. 2026).

## Décision

- **Interrupteur par organisation** dans `/organisation/parametres` :
  « Facture normalisée DGI » activé/désactivé. Désactivé par défaut. Activable
  seulement quand les identifiants sont saisis **et** qu'un appel `GET
  /api/info/status` les a validés.
- **Identifiants DGI par organisation**, saisis par l'utilisateur : NIF, `isf` et
  jeton e-DEF. Le jeton est un **secret** : stocké chiffré dans `integrations`
  avec `scope: 'organization'` (ADR-0013 l'avait prévu sans l'écrire), jamais
  renvoyé en clair, jamais journalisé. Seuls les rôles qui gèrent l'organisation
  le saisissent.
- **Aucune règle fiscale codée en dur.** Groupes de taxation, types de facture,
  de client et de paiement sont lus par les routes `/api/info/*` et mis en cache
  avec leur date de relevé ; le catalogue associe chaque article à un groupe de
  taxation. Un écart de totaux entre Lalanda et la DGI **annule** la demande
  (`cancel`) au lieu de la confirmer : on ne certifie jamais un montant que l'on
  n'a pas calculé identique.
- **Une facture normalisée est immuable.** Une fois `codeDEFDGI` reçu, elle ne se
  modifie plus ; une correction passe par une **facture d'avoir** référencée
  (`reference`, `referenceType`).
- **Reprise des demandes en attente.** Une facture envoyée mais ni confirmée ni
  annulée (coupure réseau, plantage) est retrouvée par `GET /api/info/status`
  (`pendingRequestsList`) et soldée par l'ordonnanceur ([ADR-0018](ADR-0018-trajectoire-erp-trois-modules.md)).
- **Le PDF** porte les éléments renvoyés par la DGI : code DEF/DGI, NIM, compteurs,
  date et QR code.
- **Environnements.** URL de l'API configurable (test / production) ; le mode test
  est affiché tant que l'organisation n'est pas passée en production.

## Conséquences

- Dépend de l'ordonnanceur (lot 0) et du module ventes (lot 1).
- Ouvre la portée `organization` des intégrations, aujourd'hui limitée à la
  plateforme : `SecretsService` gagne une résolution par organisation.
- **Homologation** : dossier à constituer auprès de la DGI une fois l'intégration
  terminée (factures de test : vente, avoir ; échantillons transmis). Tant qu'elle
  n'est pas obtenue, la fonctionnalité reste en mode test.
- Une note de conformité (docs/28) décrit la responsabilité de l'éditeur et du
  contribuable.

## Plan de validation

- Tests unitaires du calcul des totaux par groupe de taxation contre les réponses
  de la DGI.
- Tests e2e contre un faux serveur e-DEF : vente, avoir, écart de totaux (annulation),
  demande restée en attente puis reprise, jeton invalide.
- Essai réel sur l'environnement de test DGI avec le jeton du décideur, puis
  homologation.

## Questions ouvertes (à obtenir de la DGI ou du décideur)

- Signification de `rn`, `mode`, `isf` et des types `FT`, `EV`, `ET`, `EA`.
- Délai maximal entre envoi et confirmation ; table des codes d'erreur.
- URL des environnements de test et de production.
- Devise : facture en USD avec contre-valeur CDF, ou CDF uniquement ?
- Mentions obligatoires et format d'impression du QR code.

## Liens

- [docs/sources/dgi-rdc](../sources/dgi-rdc/README.md) — spécification e-DEF v2.0 et cadre légal.
- [ADR-0013](ADR-0013-stockage-secrets-integration.md) — secrets chiffrés ; [ADR-0017](ADR-0017-interrupteur-integrations.md) — interrupteur.
- [ADR-0018](ADR-0018-trajectoire-erp-trois-modules.md) — trajectoire ERP.
