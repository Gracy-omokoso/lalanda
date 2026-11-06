# ADR-0067 — Écrans Devis et Encaissements : chiffres, graphiques et listes refaites

Statut : **Proposé** (à valider par la dirigeante sur les captures `docs/refonte-ui/v7/`)
Date : 2026-11-06
Décideur : Gracy Omokoso (dirigeante de Go freelance SARLU).

> Prolonge [ADR-0056](ADR-0056-ecran-factures-et-tableau-de-bord.md) (écran Factures, modèle des
> écrans suivants) à **RUN › Ventes › Devis** ([ADR-0035](ADR-0035-crm-et-devis.md)) et
> **RUN › Ventes › Encaissements** ([ADR-0031](ADR-0031-encaissements-et-realise.md)). Version
> visée : 1.19.0. Ne change aucune règle de devis, d'encaissement ni de facture.

## Contexte

La dirigeante a validé une refonte « plus professionnelle » écran par écran, en tranche verticale
fidèle au modèle Factures, et exigé des **analytics** sur chaque écran. Devis et Encaissements
gardaient l'ancien dessin (liste de cartes, sélecteur de statut, totaux mensuels en tableau brut).

## Décision

### 1. Mêmes briques que Factures

En-tête compact propre (`ECRANS_A_EN_TETE_PROPRE`), quatre cartes de chiffres (mini-courbe sur grand
écran), graphiques SVG maison de `@lalanda/ui` (aucune nouvelle bibliothèque, aucun nouveau composant
du kit), onglets de statut **avec compteurs servis par le serveur**, recherche, tableau dense
(`--row-h`) avec `StatusPill`, liste compacte sur téléphone, squelette de chargement, bandeau d'échec
qui laisse la liste utilisable, état vide avec l'action principale. Briques partagées des deux écrans :
`ventes/_components/dashboard-ui.tsx`. Les trois thèmes et le mode sombre ; aucun défilement
horizontal de la page à 375 px ; mouvement limité aux animations des graphiques (240 ms, coupées sous
`prefers-reduced-motion`), pas de chiffres qui comptent.

### 2. Chiffres calculés par le moteur

| Route | Moteur (`receivables`) | Droit |
|---|---|---|
| `GET /sales/quotes/stats` | `computeQuoteStats` (1.0.0) | `sales.read`, fonctionnalité `quotes` |
| `GET /sales/receipts/stats` | `computeReceiptStats` (1.0.0) | `sales.read`, fonctionnalité `normalized_invoicing` |

Mêmes droits et même fonctionnalité que la liste de chaque écran ; organisation active ; rien n'est
stocké ; borne de lecture 20 000 documents (`truncated`). Contrats zod partagés :
`@lalanda/shared/sales-invoices` (`QuoteStatsSchema`, `ReceiptStatsSchema`).

### 3. Devises : la règle de Factures, telle quelle

Devise de référence de Factures (monnaie de tenue de la comptabilité, sinon CDF). Une seule fonction
de conversion pour les trois tableaux (`reference-rate.ts`, extraite d'`invoice-stats.ts` sans
changement) : **taux figé sur la facture** seulement ; sans taux, **exclu des montants et compté**,
total dans sa devise.

- **Devis** : un devis ne porte aucun taux. Un devis d'une autre devise est donc toujours exclu des
  montants et compté à part ; chaque carte de montant affiche à côté « + 3 190 USD » (montant dans
  sa devise, jamais converti). Les comptes (statuts, émis, acceptés, transformation) ne dépendent
  d'aucune devise.
- **Encaissements** : chaque lettrage est converti au taux figé sur **sa** facture.

### 4. Définitions (Devis)

| Chiffre | Règle |
|---|---|
| Statut | celui de la liste : envoyé dont la validité est passée = expiré (jour de Kinshasa) |
| En cours | envoyés encore valables ; nombre et montant TTC |
| Transformation, 90 j | devis dont le **premier envoi** (toutes versions) tombe dans les 90 derniers jours ; part de ceux acceptés aujourd'hui, en nombre, % entier demi vers le haut |
| Accepté ce mois | devis acceptés dans le mois civil en cours (date d'acceptation) |
| Expirent sous 7 jours | en cours, validité au plus tard J + 7 |
| Courbe | émis (mois du premier envoi) et acceptés (mois d'acceptation), 12 mois, en nombre |
| Répartition | les cinq statuts de la liste ; « N déjà convertis en facture » en note |

Tri de la liste : `sort=recent` (défaut, création décroissante) ou `sort=valid_until` (validité
croissante, curseur propre) ; pagination par curseur conservée.

### 5. Définitions (Encaissements)

| Chiffre | Règle |
|---|---|
| Encaissement | document `sales_receipts` **non annulé**, à sa date de réception. Les paiements déclarés à l'émission d'une facture n'en sont pas (ils restent dans l'« encaissé » de Factures) |
| Encaissé ce mois / vs mois précédent | mois civil en cours (au jour) et mois précédent complet ; variation (en cours − précédent) / précédent, % entier ; `null` si rien le mois précédent |
| Délai moyen d'encaissement | lettrages reçus dans les 90 derniers jours : jours entre l'émission de la facture et la réception (0 si la réception est datée avant), moyenne simple arrondie au jour |
| Restant dû | « Reste à encaisser » de Factures (`computeInvoiceStats`), même nombre, et le retard en note |
| Courbe | encaissé par mois sur 12 mois |
| Moyens de paiement | les six moyens d'ADR-0031, montant et nombre sur 12 mois |
| Compteurs | enregistrés, annulés, tous : les onglets de `GET /sales/receipts` |

La liste des encaissements reste celle de l'API (100 plus récents) ; la recherche porte sur la page
chargée (numéro de facture, référence, note).

## Conséquences

- L'interface ne calcule rien : les fichiers des deux écrans sont vérifiés par des tests de lecture
  des sources (ni `Number()`, ni `parseFloat`, ni `Math.`). Les valeurs passées aux graphiques sont
  des valeurs d'affichage (`nombre`, repris de Factures).
- `InvoiceStatsService.inputs` lit une fois les documents pour les tableaux Factures et
  Encaissements : le « restant dû » ne peut pas diverger du « reste à encaisser ».
- L'ancien tableau « Encaissé par mois, par devise, sans conversion » est remplacé par la courbe
  (son tableau accessible porte toutes les valeurs) ; `GET /sales/receipts/summary` reste servi.
- La règle « expiré » existe désormais dans le moteur (`quoteReadStatus`) et dans `quote-model.ts`
  de l'API (une ligne chacune, mêmes tests de concordance en e2e).

## Points ouverts

1. Devis en devise étrangère : les garder « à part » (actuel) ou les convertir à un taux de
   référence daté (même question que le point 2 d'ADR-0056) ?
2. Taux de transformation : sur les devis **envoyés** (actuel, les devis encore en attente le font
   baisser) ou sur les devis **tranchés** (acceptés + refusés + expirés) ?
3. Délai moyen : moyenne simple par règlement (actuel) ou pondérée par le montant ?
4. « Vs mois précédent » compare un mois en cours partiel à un mois complet : garder, ou comparer à
   la même période du mois précédent ?
5. Inclure les paiements déclarés à l'émission dans l'écran Encaissements (avec leur moyen) ?
