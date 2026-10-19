# Moteur financier

**Statut :** Draft  
**Version :** 0.1

## Responsabilité

Transformer un jeu d’entrées validé, un scénario et un Country Pack en résultats financiers déterministes. Le moteur ne gère ni interface, ni autorisation, ni texte IA.

## Pipeline

```mermaid
flowchart LR
  A["Entrées typées"] --> B["Normalisation"]
  B --> C["Validation métier"]
  C --> D["Graphe de dépendances"]
  D --> E["Calcul par périodes"]
  E --> F["Contrôles invariants"]
  F --> G["Diagnostics"]
  G --> H["Résultat versionné"]
```

## Contrat d’entrée

- projet, scénario et version;
- calendrier;
- devise fonctionnelle;
- hypothèses de revenus;
- coûts variables et fixes;
- personnel;
- investissements;
- financements;
- délais et BFR;
- trésorerie initiale;
- objectifs;
- Country Pack et version.

## Registre de formules

Chaque formule possède :

```ts
type FormulaDefinition = {
  id: string;
  version: string;
  output: string;
  dependencies: string[];
  periodBehavior: "flow" | "stock" | "ratio";
  roundingPolicy: string;
  explanationKey: string;
};
```

Les fonctions sont pures autant que possible. Les dépendances cycliques sont refusées ou traitées par un mécanisme explicitement documenté.

## Périodes

- un flux s’additionne;
- un stock se reporte;
- un ratio est recalculé, pas additionné;
- le solde final devient l’ouverture suivante;
- les dates d’encaissement et décaissement déterminent la trésorerie;
- les agrégations annuelles dérivent des périodes élémentaires.

## Arrondis

La précision de calcul est supérieure à celle d’affichage. L’arrondi final suit une politique versionnée. Les écarts d’arrondi sont expliqués et affectés à des lignes identifiées.

## Explicabilité

Pour chaque résultat, le moteur peut produire :

- formule ou règle;
- dépendances;
- valeurs utilisées;
- étapes intermédiaires utiles;
- version;
- avertissements.

## Exécution

Une exécution est idempotente pour la même empreinte d’entrée. Le cache utilise cette empreinte. Un résultat incomplet ou invalide n’est jamais approuvé.

## Contrôles

- équilibre bilan;
- continuité de trésorerie;
- cohérence dette;
- cohérence immobilisations;
- résultat vers capitaux propres;
- taxes applicables;
- absence de valeur non finie;
- unité et devise cohérentes.

## Feuille amortissements SYSCOHADA (S14c)

En plus des feuilles calculées par le DSL, le moteur produit une feuille
synthétique `amortissements` quand le template déclare un champ
`immobilisations`. Cette feuille est calculée hors HyperFormula car sa forme
(colonnes = années × immobilisations) ne se prête pas au modèle
ligne/formule du DSL.

**Entrée :** liste d’immobilisations `[{ label, categorie, montant_ht,
date_acquisition, valeur_residuelle?, duree_annees? }]` plus l’horizon
`horizon_projection_annees` (défaut **5** depuis S18a — voir ci-dessous).

**Règle de calcul :**

- méthode linéaire ;
- durée par défaut fournie par la catégorie SYSCOHADA (voir Country Packs) ;
- base amortissable = `montant_ht − valeur_residuelle` ;
- dotation année pleine = base / durée ;
- prorata temporis 1re année : `(12 − mois_acquisition + 1) / 12` — la 1re
  année produit une dotation partielle, la dernière année reprend le
  reliquat pour que la somme des dotations = base amortissable ;
- VNC en fin d’année N = `montant_ht − Σ dotations jusqu’à N` ;
- au-delà de la durée, la dotation est nulle et la VNC reste à la valeur
  résiduelle.

**Sorties :**

- une ligne par immobilisation × année (dotation) ;
- une ligne par immobilisation × année (VNC fin de période) ;
- ligne total DAP par année ;
- ligne total VNC par année.

**Impact sur les autres feuilles :**

- si une ligne `dotations_amortissements` existe dans le template, sa valeur
  est surchargée par le total DAP année 1 (la feuille amortissements devient
  la source unique) ;
- pour chaque `resultat_annuel_N` de la projection, une ligne
  `resultat_annuel_N_apres_amort` est ajoutée avec la DAP soustraite ;
- aucun impact sur la trésorerie (les dotations sont des flux comptables
  non-monétaires — vérifié par un test de non-régression).

Un template sans `immobilisations` n’active aucun de ces comportements —
compatibilité totale avec les templates S6 à S13.

## États financiers prévisionnels (S18a — FIN-001)

**Correction d’horizon.** Ce document fixait auparavant
`horizon_projection_annees` à 3, en contradiction avec docs/07 qui exige
5 exercices. ADR-0011 § Contradictions 2 tranche en faveur de docs/07 : le
défaut est désormais **5** (`HORIZON_PROJECTION_DEFAUT`).

Comme la feuille `amortissements`, le module
`packages/engine/src/etats-financiers/` est calculé **hors HyperFormula** : un
déroulé pluriannuel avec report de stocks d’un exercice sur l’autre ne se
modélise pas en lignes/formules ponctuelles du DSL.

**Activation.** Un bloc DSL **optionnel** `structure_financiere` au niveau du
template. Il ne fait que **désigner** des lignes et des drivers déjà déclarés
(achats variables, charges fixes, délais clients/fournisseurs/rotation de stock,
drivers de financement) ; il n’introduit aucune règle de calcul et toutes ses
clés ont un défaut conventionnel. Un template sans ce bloc ne produit aucune
feuille supplémentaire — compatibilité S6→S14 totale.

**Sorties** (nommage ADR-0011 § Contrat 2, séries suffixées `_annuel_1..5`) :

| Feuille | Lignes | Contenu |
|---|---|---|
| `bilan` | `bilan_*` | actif / passif par exercice, bilan d’ouverture, échéancier de dette, contrôles d’équilibre et autonomie financière |
| `caf` | `caf_*` | résultat net, dotations, CAF par exercice + CAF cumulée |
| `seuil_rentabilite` | `sr_*` | ventilation fixe/variable, CA au seuil, point mort, marge de sécurité |
| `plan_financement` | `pf_bfr_*` | BFR détaillé par exercice et sa variation (pas de feuille dédiée) |

**Règles de calcul :**

- délais convertis sur une **année commerciale de 360 jours** :
  stocks = achats × rotation / 360, créances = CA × délai clients / 360,
  fournisseurs = achats × délai fournisseurs / 360 ;
- achats variables et charges fixes extrapolés au `taux_croissance_ca`, même
  convention que la projection S12-lite (« coûts variables + fixes croissent
  proportionnellement ») — cohérence verrouillée par un test :
  `CA_N − achats_N − charges fixes_N = EBE_N` ;
- résultat net = résultat du compte d’exploitation − dotations − intérêts ;
- CAF = résultat net + dotations ;
- échéancier d’emprunt à mensualité constante (PMT), même convention que la
  ligne DSL `mensualite_emprunt` ; intérêts = mensualités payées − capital
  remboursé ;
- charges fixes du seuil = charges d’exploitation fixes + dotations + intérêts ;
  CA au seuil = charges fixes / taux de marge sur coûts variables.

**Invariant d’équilibre.** L’égalité actif = passif est obtenue **par
construction**, sans poste d’ajustement : la trésorerie de clôture est le déroulé
du tableau de flux (méthode indirecte). La démonstration par récurrence figure en
tête du module et dans docs/07. Testé à 0,01 près sur 3 templates × 5 exercices,
rejoué sur 7 scénarios déformants.

**Conventions à revalider par un expert-comptable** (détaillées dans docs/07) :
année commerciale de 360 jours, économie d’impôt des dotations et intérêts non
modélisée, dettes fiscales et sociales non modélisées, fournisseurs assis sur les
seuls achats variables.

## Calcul des factures (S25d — ADR-0022)

Module pur `packages/engine/src/invoice-totals/` : il calcule les totaux d'une facture
normalisée exactement comme la DGI les recalcule, pour que le logiciel compare et
annule en cas d'écart (ADR-0019). Aucune base, aucun réseau, aucune horloge ; aucune
bibliothèque ajoutée.

- **Arithmétique exacte.** Montants en chaînes décimales aux frontières (`"464.00"`),
  calcul en entiers `bigint` à l'échelle 10⁻⁸ (`decimal.ts`, interne). Aucune division
  implicite : chaque division est un arrondi explicite (`half_up`, `up`, `down`). Un
  test de lecture des sources interdit le type `number` dans les calculs ; seules les
  conversions vers et depuis les nombres JSON de l'API en manipulent.
- **Version.** `INVOICE_TOTALS_VERSION = '1.0.0'`, distincte d'`ENGINE_VERSION` ; une
  facture enregistre cette version et l'identifiant de politique.
- **Calcul** (`computeInvoiceTotals`) : un mode de prix par facture (TTC ou HT) ;
  montant de ligne = prix × quantité ; calcul **par groupe de taxation** sur le total
  du groupe ; taxe spécifique ajoutée à la base de la TVA ; groupe N entièrement de TVA ;
  HT + TVA = total pour chaque groupe. Tous les problèmes sont rendus d'un coup (montant
  nul ou négatif, précision excessive, groupe inconnu ou sans taux, type d'article non
  admis, taxe spécifique interdite en L et N, montant ≥ 10¹³).
- **Politique d'arrondi à deux axes** (`RoundingPolicy`) : arrondi du montant de ligne
  (`per_line` ou `per_group`) et arrondi de la TVA (`up` ou `half_up`). Défaut
  `dgi-cd-2026.1` = `per_line` + `up`, lecture littérale de la documentation DGI, **à
  calibrer** dans l'environnement de test (lot S25f). Changer de lecture est une
  nouvelle politique et une nouvelle version du calcul, jamais une modification d'une
  facture émise.
- **Échange avec la DGI** : `toEdefTotals` (champs `ta…tp`, `taa…tap`, `haa…hap`,
  `vaa…vap`, `ts`, `total`, `vtotal`) et `compareWithEdefResponse` (champ absent = 0 ;
  une valeur à plus de 2 décimales est une différence, jamais arrondie pour coïncider).
- **Prix et devise** : `convertUnitPrice` (TTC ↔ HT), `discountedUnitPrice` (remise en
  prix unitaire réduit), `usdCounterValue` (contre-valeur indicative ; la facture reste
  en CDF) et `isExchangeRateWithinTolerance` (±1 %).
- **Cas de référence** (`reference-cases.ts`) : exemples DGI, cas dérivés et cas de
  calibrage, avec l'attendu sous chacune des quatre politiques. Trois exemples de la
  documentation DGI sont **faux ou non fiables** (deux calculés à 19 % au lieu de 16 %,
  un sous-total à 69,00 au lieu de 68,97) : ils documentent l'écart et ne servent pas
  de non-régression.

Restent à trancher en environnement de test : l'arrondi de la TVA, l'arrondi du montant
de ligne, l'assiette d'une taxe spécifique en pourcentage en TTC, le contenu de `haa…`
avec une taxe spécifique, le taux du groupe M, l'arrondi de `curTotal`.

## Compatibilité

Le moteur peut évoluer, mais les versions historiques restent exécutables ou leurs résultats figés restent disponibles avec preuve d’intégrité.
