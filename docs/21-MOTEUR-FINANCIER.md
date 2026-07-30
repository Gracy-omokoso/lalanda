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

## Compatibilité

Le moteur peut évoluer, mais les versions historiques restent exécutables ou leurs résultats figés restent disponibles avec preuve d’intégrité.
