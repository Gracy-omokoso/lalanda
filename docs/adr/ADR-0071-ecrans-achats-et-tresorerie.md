# ADR-0071 — Écrans Achats et Trésorerie : chiffres, graphiques et listes refaites

Statut : **Proposé** (à valider par la dirigeante sur les captures)
Date : 2026-11-08
Décideur : Gracy Omokoso (dirigeante de Go freelance SARLU).

> Prolonge [ADR-0056](ADR-0056-ecran-factures-et-tableau-de-bord.md) et
> [ADR-0067](ADR-0067-ecrans-devis-et-encaissements.md) (modèle des écrans refaits) à
> **RUN › Achats** ([ADR-0044](ADR-0044-achats-et-fournisseurs.md)) — Factures fournisseurs,
> À payer, Commandes — et à **RUN › Trésorerie** ([ADR-0034](ADR-0034-depenses-et-tresorerie.md))
> — Dépenses, Comptes. Version visée : 1.23.0. Ne change **aucune** règle d'achat, de paiement, de
> rapprochement, de dépense ni de solde : les chiffres sont des lectures des règles existantes.

## Contexte

La dirigeante a validé la refonte « plus professionnelle » écran par écran (ADR-0056, ADR-0067) et
exigé des **analytics sur chaque écran**. Les écrans Achats et Trésorerie gardaient l'ancien dessin
(cartes de liste, boutons de filtre sans compteur, totaux en pastilles ou tuiles).

## Décision

### 1. Mêmes briques qu'ADR-0067, mises en commun

En-tête compact propre à l'écran, quatre cartes de chiffres (mini-courbe sur grand écran),
graphiques SVG maison de `@lalanda/ui` (aucune nouvelle bibliothèque), onglets de statut **avec
compteurs servis par le serveur**, recherche, tableau dense (`--row-h`) avec `StatusPill`, liste
compacte sur téléphone, squelette, bandeau d'échec qui laisse la liste utilisable, état vide ;
trois thèmes et mode sombre ; aucun défilement horizontal de la page à 375 px.

Les briques d'ADR-0067 quittent `ventes/_components/dashboard-ui.tsx` pour
`apps/web/src/components/tableau-de-bord/` (`briques.tsx`, `format.ts`) ; l'ancien fichier et
`invoice-dashboard-model.ts` les **réexportent** : Ventes ne change pas. Les écrans refaits ont leur
propre en-tête : l'en-tête d'espace (`PageHeader`) n'y est plus répété (`ECRANS_A_EN_TETE_PROPRE`
d'Achats et de Trésorerie, comme Ventes).

### 2. Chiffres calculés par le moteur, routes de lecture

| Route | Moteur | Droit, fonctionnalité |
|---|---|---|
| `GET /purchases/invoices/stats` | `computeSupplierInvoiceStats` (`purchases`, 1.0.0) | `purchase.read`, `purchases` |
| `GET /purchases/payables/stats` | `computePayablesStats` (`purchases`, 1.0.0) | `purchase.read`, `purchases` |
| `GET /purchases/orders/stats` | `computePurchaseOrderStats` (`purchases`, 1.0.0) | `purchase.read`, `purchases` |
| `GET /treasury/expenses/stats?month=` | `computeExpenseStats` (`treasury`, 1.0.0) | `treasury.read`, `treasury` |
| `GET /treasury/accounts/stats` | `computeAccountStats` (`treasury`, 1.0.0) | `treasury.read`, `treasury` |

Mêmes droits et même fonctionnalité que la liste de chaque écran ; organisation active ; rien n'est
stocké ; borne de lecture **20 000 documents** par collection (`truncated: true` au-delà, chiffres
partiels annoncés à l'écran) ; Comptes relit le grand livre de la liste des comptes, en entier, pour que
les soldes concordent. Le jour de référence est le jour de Kinshasa. Contrats zod partagés :
`@lalanda/shared/purchases` (`*StatsSchema`) et `@lalanda/shared/treasury`.

### 3. Devises : jamais converties

Achats et trésorerie restent **par devise, jamais additionnés ni convertis** (ADR-0034, ADR-0044 § 7).
Chaque réponse porte un bloc par devise présente (`byCurrency`), rangé du plus de documents au moins
(égalité : ordre alphabétique) ; l'écran affiche la première devise et un sélecteur CDF / USD quand
les deux existent. Les **compteurs** des onglets ne dépendent d'aucune devise.

### 4. Définitions — Factures fournisseurs

| Chiffre | Règle |
|---|---|
| Compteurs | ceux des filtres de `GET /purchases/invoices` : toutes ; brouillons (`draft`) ; en écart (brouillon au rapprochement `variance`) ; validées ; en retard (facture validée, échéance passée, reste non nul) ; en litige (litige ouvert, quel que soit le statut) |
| Facturé ce mois / courbe | factures **validées** (type facture) à leur date de facture, total TTC, mois civil en cours ; 12 mois |
| Vs mois précédent | (en cours − précédent) / précédent, % entier demi vers le haut ; `null` si rien le mois précédent |
| Reste à payer | reste du moteur (`payableSettlement`) des factures validées, litiges compris, et leur nombre |
| En retard | factures validées au reste non nul et à l'échéance passée |
| À traiter | brouillons, dont ceux en écart |
| Par catégorie | imputations de coût des factures validées des 12 mois |

### 5. Définitions — À payer

| Chiffre | Règle |
|---|---|
| Dû aux fournisseurs | reste des factures validées hors litige ; litiges à part |
| Échu | reste des factures hors litige à l'échéance passée |
| Sous 7 / 30 jours | reste hors litige dont l'échéance tombe entre aujourd'hui et J + 7 (J + 30) inclus |
| Délai moyen de paiement | imputations des paiements **non annulés** datés des 90 derniers jours : jours entre la date de la facture et le paiement (0 si avant), moyenne simple, arrondie au jour demi vers le haut |
| Payé par mois | paiements non annulés, à leur date, 12 mois |
| Ancienneté | tranches de `payablesAging` (ADR-0044), telles quelles |
| Compteurs | en retard, bientôt (fenêtre « bientôt » des réglages), plus tard, en litige : les groupes de l'écran |

### 6. Définitions — Commandes

| Chiffre | Règle |
|---|---|
| Compteurs | ceux des filtres de `GET /purchases/orders` : toutes, mes demandes, brouillons, à approuver (`submitted`), bons de commande (phase `order`) |
| Commandé ce mois / courbe | commandes approuvées dans le mois (date d'approbation), total TTC du moteur ; 12 mois |
| Commandes ouvertes | approuvées, envoyées ou reçues en partie ou en totalité, ni closes ni annulées : nombre et total TTC (ce n'est pas le reste à facturer du résumé des achats) |
| À approuver | demandes soumises, nombre et total TTC |
| Délai moyen d'approbation | demandes approuvées dans les 90 derniers jours : jours de la soumission à l'approbation, moyenne simple arrondie |
| Répartition | nombre de demandes et commandes par statut |

### 7. Définitions — Dépenses et Comptes

| Chiffre | Règle |
|---|---|
| Dépensé ce mois / courbe | dépenses **enregistrées** (non annulées), à leur date, montant payé ; 12 mois |
| Vs mois précédent | même règle que § 4 |
| Par catégorie | catégories d'ADR-0034, mois civil en cours |
| Sans pièce | dépenses enregistrées du mois sans pièce justificative |
| Compteurs | enregistrées, annulées, toutes, **du mois affiché** dans la liste (`?month=`) |
| Solde total | `computeAccountBalances` (ADR-0034 § 4) au jour, tous comptes de la devise |
| Entrées / sorties du mois | mouvements du grand livre des comptes datés du mois civil en cours |
| Courbe | solde de fin de mois (solde au dernier jour, ou au jour pour le mois en cours), 12 mois |
| À découvert | comptes actifs au solde négatif |

Les soldes sont ceux des **comptes réels** : l'écran le dit, et rappelle que la trésorerie
mensuelle des plans BUILD est une vue simplifiée, jamais la trésorerie de référence.

## Conséquences

- L'interface ne calcule rien : les fichiers de mise en forme des écrans refaits sont vérifiés par
  des tests de lecture des sources (ni `Number()`, ni `parseFloat`, ni `Math.`). Les graphiques
  reçoivent des valeurs d'affichage (`nombre`).
- Aucune règle métier nouvelle : les chiffres réutilisent `payableSettlement`, `payablesAging`,
  `computeAccountBalances` et les totaux stockés par le moteur des commandes.
- Les listes gardent leurs routes, leurs filtres et leur pagination ; À payer garde son paiement
  groupé et ses doublons probables ; Dépenses garde la saisie, la pièce et les récurrentes.

## Points ouverts

1. Délai moyen de paiement : moyenne simple (actuel) ou pondérée par le montant ?
2. « Commandes ouvertes » : total TTC (actuel) ou reste à facturer HT du résumé des achats ?
3. Afficher les deux devises côte à côte plutôt qu'un sélecteur ?
4. Fenêtre de « sous 7 / 30 jours » : fixe (actuel) ou alignée sur le réglage « bientôt » ?
