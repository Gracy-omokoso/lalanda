# Plan financier

**Statut :** Draft  
**Version :** 0.1

## Horizon et granularité

- horizon standard : 5 exercices;
- vue annuelle obligatoire;
- vue mensuelle au minimum pour les 12 premiers mois lorsque les hypothèses le permettent;
- agrégations trimestrielles et semestrielles dérivées;
- calendrier configurable avec exercice décalé à terme.

## États attendus

### Compte de résultat

Chiffre d’affaires, coûts variables, marge brute, charges d’exploitation, EBITDA/EBE selon présentation, dotations, résultat financier, impôts et résultat net.

### Trésorerie

Solde initial, encaissements, décaissements d’exploitation, investissements, financements, taxes, variation et solde final.

### Plan de financement

Besoins durables, ressources durables, variation de BFR et équilibre de financement.

### Bilan prévisionnel

Actif immobilisé, actif circulant, trésorerie, capitaux propres, dettes financières, fournisseurs, dettes fiscales/sociales et contrôles d’équilibre.

### Indicateurs complémentaires

- BFR;
- capacité d’autofinancement;
- seuil de rentabilité et point mort;
- marge brute, opérationnelle et nette;
- DSCR si dette;
- VAN et TRI si les hypothèses nécessaires existent;
- burn rate et runway si pertinents;
- ratios de liquidité, solvabilité et endettement.

## Invariants

- bilan équilibré dans la tolérance d’arrondi;
- trésorerie finale d’une période égale à l’ouverture suivante;
- dette cohérente avec échéancier, intérêts et remboursements;
- immobilisations cohérentes avec acquisitions, cessions et amortissements;
- résultat reporté conformément à la règle du scénario;
- aucun total financier calculé par l’interface.

## Scénarios

Au minimum : base, prudent et ambitieux. Ils partagent le même projet mais possèdent leurs propres entrées et résultats. Une comparaison affiche valeur, écart et variables modifiées.

## Version validée

Une validation fige entrées, moteur, Country Pack, date, auteur et résultats. Elle reçoit un identifiant lisible. Toute modification crée un brouillon dérivé.

## Exports

Excel conserve les formules ou pistes d’audit nécessaires selon le modèle choisi; PDF présente les tableaux, hypothèses, diagnostics et avertissements. Chaque export porte version, pays, devise, période et date.

## Réconciliation avec le classeur source

Les feuilles « Données à saisir », « Plan financier SUCCESS » et « Besoin » doivent être inventoriées. Chaque entrée et sortie reçoit un identifiant Lalanda, une règle, une unité et au moins un cas de référence.
