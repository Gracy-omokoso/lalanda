# ADR-0056 — Écran Factures de la maquette : coquille, chiffres, graphiques et tableau

Statut : **Proposé** (à valider par la dirigeante sur les captures `docs/refonte-ui/v3/`)
Date : 2026-11-03
Décideur : Gracy Omokoso (dirigeante de Go freelance SARLU).

> Prolonge [ADR-0055](ADR-0055-themes-et-design-professionnel.md) (vagues 2 à 5 sur un seul écran,
> en tranche verticale) et [ADR-0031](ADR-0031-encaissements-et-realise.md) (règlement des factures).
> Ne remplace ni ADR-0038 (navigation par modules) ni ADR-0023 (documents de vente).

## Contexte

La vague 1 a posé les jetons des trois thèmes, mais l'écran réel ressemblait encore à l'ancien design
et n'avait aucun graphique. La dirigeante a validé le 3 nov. 2026 une maquette « Lalanda plus
professionnel » de l'écran **RUN › Ventes › Factures** et demandé qu'il lui soit quasi identique, avec de
vraies données, dans les trois thèmes : c'est le modèle des écrans suivants.

## Décision

### 1. Coquille

- **Colonne de gauche pleine hauteur** (240 px, `--sidebar-width`) dans un module, sur grand écran :
  marque et sélecteur d'organisation en tête, puis les applications du module **rangées par rubrique**
  (`RUBRIQUES` de `nav-model.ts` : RUN = Opérations, Ventes, Gestion), intitulé de 11 px avec point de
  couleur du module. Entrées de 32 px, 13 px, icônes 16 px ; entrée active : fond, gras et filet
  d'accent de 2 px. Icônes, liens, sous-options, rôles et tiroir du téléphone inchangés.
- **En-tête de 56 px sur la surface** : fil d'Ariane (`filAriane` : module › rubrique › application ›
  sous-option, le dernier maillon `aria-current="page"`), onglets de modules compacts (ADR-0038 :
  niveau 1 conservé), aide, thème, cloche, avatar de 32 px. Hors module, la marque et l'organisation
  restent dans l'en-tête.
- L'en-tête d'espace « Ventes » n'est pas répété sur l'écran Factures, qui porte le sien
  (`SalesHeader`, liste `ECRANS_A_EN_TETE_PROPRE` à compléter écran par écran).

### 2. Graphiques maison (`packages/ui`)

`Sparkline`, `LineChart` (ligne, aire, tiretée), `DonutChart`, `BarList`, `ChartLegend` et
`StatusPill`, en SVG et HTML, **sans bibliothèque**. Couleurs par `--chart-1..6` et `--chart-grid`
seulement ; légende écrite ; **tableau masqué visuellement** portant toutes les valeurs (le dessin est
`aria-hidden`) ; infobulle au survol en CSS seul. Mouvement : révélation du tracé, fondu, allongement
des barres, une fois, en 240 ms (`charts.css`), coupés sous `prefers-reduced-motion`. Les graduations
et libellés sont en HTML : le tracé s'étire en largeur sans déformer le texte.

### 3. Chiffres calculés par le serveur — `GET /sales/invoices/stats`

`sales.read`, organisation active. Le moteur (`computeInvoiceStats`, `receivables`, version `1.0.0`)
calcule tout ; l'écran met en forme. Contrat partagé : `@lalanda/shared/sales-invoices`.

| Notion | Règle |
|---|---|
| Montants | **TTC** (on compare du facturé à de l'argent reçu ; ce n'est pas le chiffre d'affaires HT d'ADR-0031 § 3) |
| Devise de référence | monnaie de tenue de la comptabilité (`accounting_settings.bookCurrency`, ADR-0049) si elle est choisie, **sinon CDF** (monnaie légale, devise des montants normalisés) |
| Conversion | **au taux figé sur la facture** : total CDF de la normalisation (parts au prorata), sinon `conversion` du document, sinon contre-valeur USD figée. Jamais un taux du jour ou d'une autre pièce. Sans taux : **exclu des montants et compté** (`excluded.notConvertible`, total dans sa devise), le statut de règlement restant compté |
| Facturé | factures finales (`issued`, `normalized`) FV/EV hors série d'essai, **moins les avoirs finaux** FA/EA, au mois civil d'émission (Kinshasa). Pro forma et brouillons exclus |
| Acomptes FT/ET | **exclus et comptés** (reprise de la décision ouverte n° 1 d'ADR-0031) |
| Encaissé | part réglée à l'émission (total − part `CREDIT`) des factures, lettrages des encaissements non annulés à leur date, moins la part remboursée à l'émission d'un avoir |
| Reste à encaisser, retard | `computeSettlement` d'ADR-0031 tel quel, à la fin de chaque mois (au jour pour le mois courant). **En retard** = facture finale, échéance dépassée, non soldée |
| Compteurs | mêmes définitions que les filtres de `GET /sales/invoices` : les onglets concordent avec la liste |

Borne de lecture : 20 000 documents, au-delà `truncated: true`, dit à l'écran.

### 4. Écran Factures

En-tête compact (Factures, Journal, Nouveau document) ; quatre cartes (facturé et encaissé sur 12 mois,
reste à encaisser, retard en nombre et montant) avec mini-courbe ; courbe facturé/encaissé, anneau par
statut, meilleurs clients ; onglets de statut avec compteurs, recherche et type ; **tableau dense**
(`--row-h`) avec étiquette de statut et de règlement, liste compacte sur téléphone. Toutes les actions
et leurs droits sont conservés.

## Conséquences

- Écarts assumés avec la maquette : pas de recherche globale « ⌘K » (la fonction n'existe pas), pas
  d'onglets Factures/Clients/Catalogue/Modèle sous le titre (ADR-0038 : les sections sont dans la
  colonne, « plus de rangée d'onglets en double »), pas de bouton « Exporter » (l'export existant est
  celui du journal), cartes choisies par la dirigeante (facturé, encaissé, reste, retard) au lieu de
  « délai moyen de paiement ». Les onglets de modules restent dans l'en-tête.
- Une organisation qui facture en USD **en mode ordinaire** n'a pas de taux sur ses factures : ses
  montants USD sont exclus des graphiques en devise de référence et signalés. C'est le choix prudent
  (aucun taux inventé) ; à revoir si la dirigeante veut un taux de référence daté.
- Les autres écrans gardent l'en-tête d'espace jusqu'à leur migration ; la coquille est déjà commune.

## Points ouverts

1. Devise de référence sans comptabilité : CDF par défaut, ou devise majoritaire des factures ?
2. Montants USD de factures non normalisées : les laisser hors graphiques (actuel) ou les convertir au
   taux de référence DGI du jour d'émission ?
3. Acomptes : les intégrer au facturé quand la facture finale les déduit (lien ADR-0050) ?
