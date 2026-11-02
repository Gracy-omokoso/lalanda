# Relecture du pack de plan comptable SYSCOHADA — version 2

**Statut du pack :** `approved` — par **décision de la dirigeante du 3 novembre 2026**, sans relecture par un expert-comptable
**Pack :** `syscohada-revise-2017-cd@2` (RDC)
**Fichier :** `packages/engine/src/accounting/packs/syscohada-revise-2017-cd-v2.yaml`
**Empreinte SHA-256 du pack :** `aee2e8eab1bd488d4231cabde0aaa4198b3d91fb8c0bf8f0368c4e2dc7fdfb45`
**Cadre :** [ADR-0049](../adr/ADR-0049-comptabilite-syscohada.md), amendement du 3 novembre 2026
**Enregistrement en production :** migration `apps/api/migrations/20261103-0001-pack-syscohada-v2-approuve.mjs`

## La décision

> « Ne perdons pas le temps, fais ce qui s'applique en RDC Congo et nous allons améliorer au fur et à
> mesure avec les experts. Aucun client n'a encore commencé à utiliser Lalanda. »
> — Gracy Omokoso, dirigeante, 3 novembre 2026

Elle tranche les questions en attente sur les règles du plan comptable, les comptes de capitaux propres
et le traitement des acomptes et des avances. Le référentiel retenu est celui qui s'applique en RDC : le
**SYSCOHADA révisé** — Acte uniforme relatif au droit comptable et à l'information financière (AUDCIF) du
26 janvier 2017 et son Plan comptable général OHADA.

Ce que la décision **ne change pas** :

- les états restent des **projets** (`draft_unverified`), avec le bandeau « Projet — à valider par un
  expert-comptable » ; Lalanda ne dépose rien et ne transmet rien ;
- le pack v1 reste `draft`, inchangé ;
- une organisation valide son jeu de règles par le circuit existant (séparation des tâches, déclaration
  de relecture par son expert) avant de passer en mode `active` ;
- les écritures de stock et les amortissements restent éteints (questions E4).

## À l'attention de l'expert-comptable

Le pack v2 est en usage avant votre relecture. Pour chaque compte, chaque rubrique et chaque règle,
indiquez **Confirmé**, **Corrigé** (numéro ou intitulé officiel) ou **Supprimé**. Vos réponses
deviendront le pack v3 : une version approuvée ne change plus, une correction est une version nouvelle.

**Comment lire le statut des éléments.** Le schéma du pack ne connaît que `sourced` et `to_confirm`, et
un pack `approved` n'admet aucun `to_confirm`. Dans le v2, `sourced` veut dire : **numéro et intitulé
repris du Plan comptable général OHADA, tels que l'équipe les connaît, retenus par décision de la
dirigeante** — pas « vérifié sur le texte par un expert ». Chaque élément porte la note « décision de la
dirigeante du 3 nov. 2026, à revoir avec l'expert-comptable ». Seuls les comptes dont l'équipe est sûre
figurent au pack ; les autres sont au § 4.

## 1. Choix faits

| Sujet | Choix du v2 | À revoir |
|---|---|---|
| Plan | 9 classes, 60 comptes (comptes principaux de 2 chiffres comme parents, comptes de 3 et 4 chiffres pour les écritures) | intitulés mot pour mot ; intitulé de la classe 9 |
| Capitaux propres | 101, 109, 111, 112, 118, 121, 129, 131, 139 | ventilation réserves indisponibles et libres au bilan |
| Compte d'attente | **471** désigné par le pack (`suspenseAccount`) ; remplace le compte technique `ATTENTE` dès que le pack v2 est choisi | sous-compte dédié préférable ? |
| Ventes | biens 701, services 706 ; TVA facturée 4431, tous groupes | 4432 pour les prestations de services ; groupes D, E, F, G, K, M, O, P |
| Avoirs de vente | diminution directe de 701 / 706 et de 4431 | compte de réductions accordées (E1) |
| Acomptes clients | facture d'acompte (FT, ET) : client 411 au débit, **4191** au crédit pour la base, 4431 pour la TVA ; encaissement non imputé : **4191** | imputation de l'acompte sur la facture finale (opération diverse aujourd'hui) |
| Avances fournisseurs | paiement non imputé à une facture : **4091** | imputation sur la facture (opération diverse) |
| Avances au personnel | `hr.advance.*` → **421** ; le blocage « jamais appliquée » de H13 est levé (moteur 1.2.0) | — |
| Dépenses et achats | achats 601, personnel 661, loyer 622, transport 618, marketing 627, outils et logiciels 638, honoraires 632, impôt sur les bénéfices 891 ; TVA déclarée 4452 (organisation assujettie seulement) | 638 contre un compte de redevances ; 632 pour les « services extérieurs » ; 4454 pour la TVA sur services |
| Trésorerie | compte rattaché par l'organisation (`{treasuryAccount}`) ; 521 et 571 comme comptes du pack ; virements internes **585** | monnaie électronique (§ 4) |
| États | bilan et compte de résultat, système normal, rubriques ci-dessous ; tableau des flux non fourni (E8) | rubriques et rattachements |
| Résultat de l'exercice aux à-nouveaux | inchangé : au compte d'attente, motif « traitement du résultat à confirmer » | affectation 131 / 139 (E7) |

## 2. Classes (9)

Libellés repris du v1, retenus par la décision ; la classe 9 est à vérifier mot pour mot.

| Classe | Libellé | Décision de l'expert |
|---|---|---|
| 1 | Comptes de ressources durables | |
| 2 | Comptes d'actif immobilisé | |
| 3 | Comptes de stocks | |
| 4 | Comptes de tiers | |
| 5 | Comptes de trésorerie | |
| 6 | Comptes de charges des activités ordinaires | |
| 7 | Comptes de produits des activités ordinaires | |
| 8 | Comptes des autres charges et des autres produits | |
| 9 | Comptes des engagements hors bilan et de comptabilité analytique de gestion | |

## 3. Comptes du pack (60)

| Numéro | Intitulé | Nature | Parent | Collectif | Remarque | Décision de l'expert |
|---|---|---|---|---|---|---|
| 10 | Capital | equity | — | non |  | |
| 101 | Capital social | equity | 10 | non |  | |
| 109 | Apporteurs, capital souscrit, non appelé | equity | 10 | non | Compte soustractif des capitaux propres (solde débiteur) | |
| 11 | Réserves | equity | — | non |  | |
| 111 | Réserve légale | equity | 11 | non |  | |
| 112 | Réserves statutaires ou contractuelles | equity | 11 | non |  | |
| 118 | Autres réserves | equity | 11 | non |  | |
| 12 | Report à nouveau | equity | — | non |  | |
| 121 | Report à nouveau créditeur | equity | 12 | non |  | |
| 129 | Report à nouveau débiteur | equity | 12 | non |  | |
| 13 | Résultat net de l'exercice | equity | — | non |  | |
| 131 | Résultat net : bénéfice | equity | 13 | non |  | |
| 139 | Résultat net : perte | equity | 13 | non |  | |
| 40 | Fournisseurs et comptes rattachés | liability | — | non |  | |
| 401 | Fournisseurs, dettes en compte | liability | 40 | oui (fournisseurs) | Compte collectif des fournisseurs | |
| 409 | Fournisseurs débiteurs | asset | 40 | non |  | |
| 4091 | Fournisseurs, avances et acomptes versés | asset | 409 | non | Avances versées aux fournisseurs (paiement non imputé à une facture) | |
| 41 | Clients et comptes rattachés | asset | — | non |  | |
| 411 | Clients | asset | 41 | oui (clients) | Compte collectif des clients | |
| 419 | Clients créditeurs | liability | 41 | non |  | |
| 4191 | Clients, avances et acomptes reçus | liability | 419 | non | Acomptes facturés (FT, ET) et encaissements non imputés à une facture | |
| 42 | Personnel | mixed | — | non |  | |
| 421 | Personnel, avances et acomptes | asset | 42 | non | Avances au personnel (clés hr.advance.*) | |
| 422 | Personnel, rémunérations dues | liability | 42 | non |  | |
| 44 | État et collectivités publiques | mixed | — | non |  | |
| 443 | État, TVA facturée | liability | 44 | non |  | |
| 4431 | TVA facturée sur ventes | liability | 443 | non | TVA de tous les groupes de taxation ; le plan prévoit aussi 4432 pour les prestations de services, non retenu (la clé ne distingue pas biens et services) | |
| 444 | État, TVA due ou crédit de TVA | mixed | 44 | non |  | |
| 4441 | État, TVA due | liability | 444 | non | Liquidation de la TVA par opération diverse ; aucune règle automatique | |
| 445 | État, TVA récupérable | asset | 44 | non |  | |
| 4452 | TVA récupérable sur achats | asset | 445 | non | TVA déclarée des dépenses et factures fournisseurs (organisation assujettie seulement) | |
| 4454 | TVA récupérable sur services extérieurs et autres charges | asset | 445 | non | Disponible pour un reclassement ; la clé de TVA déclarée ne distingue pas achats et services | |
| 47 | Débiteurs et créditeurs divers | mixed | — | non |  | |
| 471 | Débiteurs et créditeurs divers | mixed | 47 | non | Désigné compte d'attente du pack (suspenseAccount) : opérations à classer, avec leur motif | |
| 52 | Banques | asset | — | non |  | |
| 521 | Banques locales | asset | 52 | non | Comptes bancaires ; un sous-compte par banque se crée dans le plan de l’organisation | |
| 57 | Caisse | asset | — | non |  | |
| 571 | Caisse siège social | asset | 57 | non |  | |
| 58 | Régies d'avances, accréditifs et virements internes | mixed | — | non |  | |
| 585 | Virements de fonds | mixed | 58 | non | Virements internes entre comptes de trésorerie (soldé après les deux jambes) | |
| 60 | Achats et variations de stocks | expense | — | non |  | |
| 601 | Achats de marchandises | expense | 60 | non |  | |
| 604 | Achats stockés de matières et fournitures consommables | expense | 60 | non |  | |
| 605 | Autres achats | expense | 60 | non |  | |
| 61 | Transports | expense | — | non |  | |
| 618 | Autres frais de transport | expense | 61 | non |  | |
| 622 | Locations et charges locatives | expense | — | non | Compte principal 62 non repris (intitulé à vérifier) | |
| 627 | Publicité, publications, relations publiques | expense | — | non | Compte principal 62 non repris (intitulé à vérifier) | |
| 628 | Frais de télécommunications | expense | — | non | Compte principal 62 non repris (intitulé à vérifier) | |
| 631 | Frais bancaires | expense | — | non | Compte principal 63 non repris (intitulé à vérifier) | |
| 632 | Rémunérations d'intermédiaires et de conseils | expense | — | non | Compte principal 63 non repris (intitulé à vérifier) | |
| 638 | Autres charges externes | expense | — | non | Compte principal 63 non repris (intitulé à vérifier) | |
| 66 | Charges de personnel | expense | — | non |  | |
| 661 | Rémunérations directes versées au personnel national | expense | 66 | non | Montant payé seulement ; aucune paie dans Lalanda (ADR-0045) | |
| 70 | Ventes | income | — | non |  | |
| 701 | Ventes de marchandises | income | 70 | non | Produit des biens (BIE) | |
| 706 | Services vendus | income | 70 | non | Produit des services (SER) | |
| 707 | Produits accessoires | income | 70 | non | Aucune règle automatique ; disponible pour un reclassement | |
| 89 | Impôts sur le résultat | expense | — | non |  | |
| 891 | Impôts sur les bénéfices de l'exercice | expense | 89 | non |  | |

## 4. Comptes écartés par doute

Aucun de ces comptes n'est au pack ; les opérations concernées vont au compte d'attente 471, avec leur
motif.

| Compte envisagé | Pourquoi il est écarté | Conséquence dans le v2 | Question |
|---|---|---|---|
| 676 Pertes de change, 776 Gains de change | Le SYSCOHADA révisé distingue, à notre connaissance, les écarts de change **commerciaux** (656 / 756, dans les autres charges et autres produits) et **financiers** (676 / 776, dont l'intitulé serait « … de change financiers ») ; les écarts de Lalanda naissent du règlement des factures, donc commerciaux. Numéros et intitulés non sûrs. | `exchange.difference` → 471, motif « écart de change » | E3.3, décision ouverte n° 12 |
| 656, 756 | Même doute (numéro et intitulé) | idem | E3.3 |
| Classe 55 (monnaie électronique, dont 552 « téléphone portable ») | Instruments de monnaie électronique introduits par la révision ; numéros et intitulés exacts non sûrs | un compte mobile money se rattache par l'organisation à un compte de son plan ; `MOBILEMONEY` à l'émission → 471 | E1.1 |
| 62 et 63 (comptes principaux) | Intitulés exacts du révisé non sûrs (« Services extérieurs », « Autres services extérieurs » ?) | 622, 627, 628, 631, 632, 638 sans parent | E1.2 |
| 624 Entretien, réparations… | Intitulé du révisé non sûr | non employé | E1.2 |
| 634 Redevances pour brevets, licences, logiciels… | Intitulé du révisé non sûr | outils et logiciels → 638 | E1.2 |
| 4432 TVA facturée sur prestations de services | Sûr, mais la clé de TVA ne distingue pas biens et services | TVA → 4431 | E2.1 |
| 64x Impôts et taxes, 671 Intérêts des emprunts | Comptes connus, mais la catégorie de Lalanda ne dit pas la nature | `impots_taxes`, `frais_financiers` → 471 | E1.2 |
| Classe 2, comptes 16x | Dépendent de la nature du bien ou du prêteur | `investissement`, `remboursement_emprunt` → 471 | E1.2 |
| 130 Résultat en instance d'affectation | Non nécessaire au v2 | — | E7 |

## 5. Jeu de règles par défaut v1

Le pack propose **245 règles**, une par clé d'opération connue du moteur (les clés `stock.*` exceptées :
les écritures de stock restent éteintes, E4). Une organisation les reçoit en brouillon
(`POST /accounting/rule-sets`), peut changer un compte, puis les valide par le circuit existant.

- **170 règles applicables** : ventes, acomptes, avoirs, encaissements, dépenses et achats dont la
  nature est sûre, paiements fournisseurs, virements internes, avances au personnel.
- **75 règles « à revoir »** (`requiresReview: true`) : jamais appliquées ; leur clé va au compte
  d'attente 471 avec le motif `RULE_REQUIRES_REVIEW` (ou le motif propre de la clé, par exemple
  « écart de change »). Le motif écrit dans le pack :

| Règles | Clé (exemple) | Motif |
|---|---|---|
| 33 | `sale.invoice.nonrevenue.A` et 32 autres | taxe spécifique du groupe : compte de l'État à choisir par l'expert |
| 3 | `sale.invoice.nonrevenue.H` et 2 autres | consignation d'emballage : compte de tiers à choisir par l'expert |
| 3 | `sale.invoice.nonrevenue.I` et 2 autres | garantie et caution : compte de tiers à choisir par l'expert |
| 3 | `sale.invoice.nonrevenue.J` et 2 autres | débours : refacturation à l'identique, compte à choisir par l'expert |
| 3 | `sale.invoice.nonrevenue.L` et 2 autres | prélèvements sur ventes : compte de l'État à choisir par l'expert |
| 3 | `sale.invoice.nonrevenue.N` et 2 autres | TVA spécifique : compte de TVA à choisir par l'expert |
| 6 | `sale.payment_at_issue.ESPECES` et 5 autres | fonds déclarés reçus à l'émission, invisibles de la trésorerie : compte de trésorerie à préciser (décision ouverte n° 9) |
| 3 | `expense.energie_telecom` et 2 autres | catégorie mêlant énergie et eau (achats non stockés) et télécommunications : à ventiler |
| 3 | `expense.impots_taxes` et 2 autres | nature de l'impôt (direct, indirect, droits) non connue de la pièce |
| 3 | `expense.frais_financiers` et 2 autres | catégorie mêlant frais bancaires et intérêts : à ventiler |
| 3 | `expense.charges_diverses` et 2 autres | nature de la charge non connue de la pièce |
| 3 | `expense.investissement` et 2 autres | immobilisation : compte de la classe 2 selon sa nature, à choisir par l'expert |
| 3 | `expense.remboursement_emprunt` et 2 autres | remboursement d'emprunt : compte de la classe 16 selon le prêteur, à choisir par l'expert |
| 2 | `other_in.counterpart` et 1 autre | apport, prêt, prélèvement : nature non connue de la pièce (décision ouverte n° 13), reclassement par opération diverse |
| 1 | `exchange.difference` | le SYSCOHADA révisé distingue les écarts de change commerciaux et financiers ; comptes à confirmer par l'expert (voir le document de relecture) |

## 6. Modèles d'états (système normal)

Rubriques retenues ; les intitulés et les rattachements sont à revoir. Les projets d'états portent
toujours `status: "draft_unverified"` et le bandeau.

| État | Rubrique | Comptes rattachés |
|---|---|---|
| Bilan | Actif immobilisé | classe 2 |
| Bilan | Stocks et encours | classe 3 |
| Bilan | Fournisseurs, avances versées | 409 |
| Bilan | Clients | 411 |
| Bilan | Autres créances | 421, 445 |
| Bilan | Trésorerie-Actif | 52, 57, 58 |
| Bilan | Capital | 101 |
| Bilan | Apporteurs, capital non appelé (−) | 109 |
| Bilan | Réserves | 11 |
| Bilan | Report à nouveau (+ ou −) | 12 |
| Bilan | Résultat net de l'exercice (bénéfice + ou perte −) | 13 |
| Bilan | Clients, avances reçues | 419 |
| Bilan | Fournisseurs d'exploitation | 401 |
| Bilan | Dettes fiscales et sociales | 422, 443, 444 |
| Bilan | Autres dettes | 47 (compte d'attente compris) |
| Compte de résultat | Ventes de marchandises | 701 |
| Compte de résultat | Achats de marchandises | 601 |
| Compte de résultat | Travaux, services vendus | 706 |
| Compte de résultat | Produits accessoires | 707 |
| Compte de résultat | Autres achats | 604, 605 |
| Compte de résultat | Transports | 61 |
| Compte de résultat | Services extérieurs | 62, 63 |
| Compte de résultat | Charges de personnel | 66 |
| Compte de résultat | Impôts sur le résultat | 89 |
| Tableau des flux | non fourni : l'état reste « non disponible » (E8) | — |

## 7. Ce que l'expert-comptable devra revoir, en priorité

1. Les intitulés des 60 comptes, mot pour mot, et ceux de la classe 9.
2. Les écarts de change (§ 4) : comptes et séparation commerciale ou financière.
3. Le traitement des acomptes clients (4191) et de leur imputation sur la facture finale ; idem pour les
   avances fournisseurs (4091).
4. Les avoirs : diminution directe du produit, ou compte de réductions.
5. Les catégories de dépense laissées au compte d'attente, et le choix 638 / 632.
6. Les groupes de taxation hors chiffre d'affaires (H, I, J, L, N) et les taxes spécifiques.
7. Les rubriques du bilan et du compte de résultat, et le tableau des flux (E8).
8. L'affectation du résultat aux à-nouveaux (E7) et les comptes de monnaie électronique.

## 8. Relecture

| Champ | À remplir |
|---|---|
| Nom de l'expert-comptable | |
| Qualité (inscription à l'ordre, cabinet) | |
| Date de la relecture | |
| Étendue de la relecture | |
| Référence du rapport joint | |
