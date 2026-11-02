# Relecture du pack de plan comptable SYSCOHADA — version 1

**Statut du pack :** `draft` — non relu, utilisable en mode simulation seulement
**Pack :** `syscohada-revise-2017-cd@1` (RDC)
**Fichier :** `packages/engine/src/accounting/packs/syscohada-revise-2017-cd-v1.yaml`
**Empreinte SHA-256 du pack relu :** `d68b17cffe85df1fbef1f9a8e24a43089b9fa20b3dc33902881f19b941378ca8`
**Cadre :** [ADR-0049](../adr/ADR-0049-comptabilite-syscohada.md) § 2.1, § 2.1.1, § Plan de validation, § Questions pour l'expert-comptable

> **3 nov. 2026** : le pack v2, adopté par décision de la dirigeante, est en usage ; ses choix et ce que
> l'expert devra revoir sont dans [relecture-pack-syscohada-v2.md](relecture-pack-syscohada-v2.md). Le
> pack v1 reste `draft`, inchangé.

## À l'attention de l'expert-comptable

Lalanda prépare une comptabilité générée à partir des pièces de ses utilisateurs (factures, encaissements,
dépenses, achats). Ses états seront toujours présentés comme des **projets à valider**. Avant tout usage
réel, le plan comptable doit être relu par vous.

Ce document reprend **tout** le contenu du pack v1. Rien n'y a été vérifié sur le texte officiel :

- le texte de référence est l'**Acte uniforme OHADA relatif au droit comptable et à l'information
  financière (AUDCIF)**, adopté le 26 janvier 2017, et le Système comptable OHADA annexé (Plan comptable
  général OHADA) ; l'équipe n'en dispose pas dans le dépôt ;
- les classes et les comptes ci-dessous sont des **candidats d'usage courant** cités par l'ADR-0049 ; ils
  portent tous le statut `to_confirm`, « à confirmer par l'expert-comptable » ;
- les libellés des comptes décrivent le **besoin** de Lalanda, pas l'intitulé officiel ;
- les comptes que l'ADR laisse « à fournir par l'expert » n'ont **aucun numéro** : ils figurent dans la
  liste des comptes attendus.

**Ce qui vous est demandé.** Pour chaque ligne, remplissez la colonne « Décision de l'expert » :
**Confirmé** (numéro et intitulé exacts), **Corrigé** (indiquez le numéro ou l'intitulé officiel) ou
**Supprimé**. Pour chaque compte attendu, indiquez le numéro et l'intitulé. Citez, si possible, l'article
ou la page du texte. Vos réponses deviendront le pack v2, au statut `review` puis `approved`.

**Légende des statuts.** `to_confirm` : non vérifié, à confirmer par l'expert-comptable. `sourced` :
vérifié sur le texte cité (aucun élément de la v1 n'a ce statut).

## 1. Source

| Identifiant | Émetteur | Titre | Adoption | Publication au JO OHADA | Entrée en vigueur | Vérifié le | Vérifié par |
|---|---|---|---|---|---|---|---|
| `audcif-2017` | OHADA — Conseil des ministres | AUDCIF et Système comptable OHADA annexé (Plan comptable général OHADA, guide d'application) | 2017-01-26 | à joindre | à joindre | — | — |

**Demandé à l'expert :** référence de publication, dates d'entrée en vigueur, texte ou extrait joint.

## 2. Classes (9)

| Classe | Libellé usuel (à vérifier) | Statut | Source | Décision de l'expert | Libellé officiel |
|---|---|---|---|---|---|
| 1 | Comptes de ressources durables | `to_confirm` | `audcif-2017` | | |
| 2 | Comptes d'actif immobilisé | `to_confirm` | `audcif-2017` | | |
| 3 | Comptes de stocks | `to_confirm` | `audcif-2017` | | |
| 4 | Comptes de tiers | `to_confirm` | `audcif-2017` | | |
| 5 | Comptes de trésorerie | `to_confirm` | `audcif-2017` | | |
| 6 | Comptes de charges des activités ordinaires | `to_confirm` | `audcif-2017` | | |
| 7 | Comptes de produits des activités ordinaires | `to_confirm` | `audcif-2017` | | |
| 8 | Comptes des autres charges et des autres produits | `to_confirm` | `audcif-2017` | | |
| 9 | Comptes des engagements hors bilan et de comptabilité analytique de gestion | `to_confirm` | `audcif-2017` | | |

## 3. Comptes candidats (10)

« Collectif » : le compte reçoit des comptes auxiliaires par client ou par fournisseur (ADR-0049 § 1). La
**nature** (actif, passif, charge, produit…) et le **compte parent** ne sont pas renseignés : ils vous
sont demandés.

| Numéro | Besoin de Lalanda (libellé d'usage) | Classe | Collectif | Statut | Source | Remarque | Décision de l'expert | Numéro et intitulé officiels | Nature | Parent |
|---|---|---|---|---|---|---|---|---|---|---|
| 411 | Clients | 4 | oui (clients) | `to_confirm` | `audcif-2017` | | | | | |
| 401 | Fournisseurs | 4 | oui (fournisseurs) | `to_confirm` | `audcif-2017` | | | | | |
| 4431 | TVA facturée sur ventes (collectée) | 4 | non | `to_confirm` | `audcif-2017` | ventilation par groupe de taxation DGI : E2.1 | | | | |
| 4452 | TVA récupérable sur achats | 4 | non | `to_confirm` | `audcif-2017` | subdivisions par nature à confirmer | | | | |
| 521 | Banques | 5 | non | `to_confirm` | `audcif-2017` | | | | | |
| 571 | Caisse | 5 | non | `to_confirm` | `audcif-2017` | | | | | |
| 585 | Virements internes de fonds | 5 | non | `to_confirm` | `audcif-2017` | virements entre comptes de trésorerie (ADR-0049 § 6.6) | | | | |
| 601 | Achats de marchandises | 6 | non | `to_confirm` | `audcif-2017` | | | | | |
| 701 | Ventes de marchandises | 7 | non | `to_confirm` | `audcif-2017` | produit des biens (`BIE`) : E1.3 | | | | |
| 706 | Services vendus | 7 | non | `to_confirm` | `audcif-2017` | produit des services (`SER`) : E1.3 | | | | |

## 4. Comptes attendus (8) — numéro à fournir par l'expert

Aucun numéro n'est proposé. L'indication de classe recopie seulement l'ADR-0049 § 2.1.1.

| Besoin de Lalanda | Indication de l'ADR | Questions | Numéro fourni | Intitulé officiel | Remarque de l'expert |
|---|---|---|---|---|---|
| Monnaie électronique (mobile money) | sous-compte de la classe 5 dédié à la monnaie électronique | E1.1 | | | |
| Comptes d'attente | compte de la classe 47 | E1.1 | | | |
| Autres achats, services extérieurs, impôts et taxes, charges de personnel, frais financiers | comptes des classes 60 à 67, un par catégorie de dépense (voir § 5) | E1.2 | | | |
| Impôt sur le résultat | compte de la classe 89 | E1.1 | | | |
| Immobilisations corporelles (dépenses « investissement ») | comptes de la classe 2, selon la nature | E1.2 | | | |
| Emprunts (dépenses « remboursement d’emprunt ») | compte de la classe 16 | E1.2 | | | |
| Résultat de l'exercice, report à nouveau (à-nouveaux) | comptes de la classe 1 | E1.1, E7 | | | |
| Pertes et gains de change | décision ouverte n° 12 | E3.3 | | | |

## 5. Catégories de dépense de Lalanda — un compte par catégorie (question E1.2)

Les quatorze catégories ci-dessous sont celles que saisit l'utilisateur (ADR-0034,
`packages/engine/src/treasury/types.ts`). Elles décrivent une **nature de gestion**, pas une
qualification comptable. Indiquez le compte de chacune, et si la catégorie suffit ou s'il faut une
précision à la saisie.

| Catégorie (code) | Libellé dans Lalanda | Compte proposé par l'expert | La catégorie suffit-elle ? | Remarque |
|---|---|---|---|---|
| `achats` | Achats de marchandises et matières | | | |
| `personnel` | Salaires et charges sociales | | | |
| `loyer` | Loyer et charges locatives | | | |
| `transport` | Transport et logistique | | | |
| `marketing` | Marketing et publicité | | | |
| `outils_logiciels` | Outils, logiciels et abonnements | | | |
| `energie_telecom` | Énergie, eau et télécommunications | | | |
| `services_exterieurs` | Honoraires et services extérieurs | | | |
| `impots_taxes` | Impôts et taxes (hors impôt sur les bénéfices) | | | |
| `impot_benefices` | Impôt sur les bénéfices | | | |
| `frais_financiers` | Frais bancaires et intérêts | | | |
| `charges_diverses` | Charges diverses | | | |
| `investissement` | Investissements (immobilisations) | | | |
| `remboursement_emprunt` | Remboursement du capital emprunté | | | |

## 6. Ce que le pack v1 ne contient pas encore

| Élément | État dans la v1 | Ce qui vous est demandé |
|---|---|---|
| Règles de correspondance (opération → comptes) | aucune ; toute opération va au compte d'attente | questions E1 à E3 de l'ADR-0049 |
| Modèle du bilan | absent | rubriques et plages de comptes (E8) |
| Modèle du compte de résultat | absent | rubriques et plages de comptes (E8) |
| Modèle du tableau des flux de trésorerie | absent ; l'état reste « non disponible » | rubriques, plages et méthode (E8) |
| Nature et parent de chaque compte | non renseignés | voir § 3 |

Les questions complètes (E1 à E10) figurent dans l'ADR-0049, § Questions pour l'expert-comptable.

## 7. Relecture

| Champ | À remplir |
|---|---|
| Nom de l'expert-comptable | |
| Qualité (inscription à l'ordre, cabinet) | |
| Date de la relecture | |
| Étendue de la relecture | |
| Référence du rapport joint | |

Ces informations alimentent le champ `review` du pack. Sans elles, le pack ne peut pas passer au statut
`approved`, et la comptabilité de Lalanda reste en mode simulation.
