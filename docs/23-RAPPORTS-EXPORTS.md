# Rapports et exports

**Statut :** Draft  
**Version :** 0.1

## Catalogue initial

- Business Model Canvas;
- résumé exécutif;
- plan financier complet;
- besoins de financement;
- diagnostics;
- prévisionnel/réalisé;
- état mensuel de l’activité;
- rapport de scénario;
- dossier bancaire.

## Métadonnées obligatoires

Organisation, projet, scénario, plan, version, pays, Country Pack, devise, horizon, date de génération, auteur et avertissements.

## PDF

- page de garde;
- sommaire;
- hypothèses principales;
- tableaux avec répétition des en-têtes;
- graphiques accessibles;
- notes de méthode;
- pagination;
- absence de coupe illisible;
- polices incorporées si nécessaire.

## Excel

- feuille de lecture;
- données d’entrée;
- états;
- diagnostics;
- métadonnées et versions;
- cellules protégées selon usage;
- formats de nombre explicites;
- aucune formule cassée;
- validation LibreOffice.

L’export n’est pas la source de vérité : il matérialise un résultat déjà calculé.

### Implémentation (S14b)

Endpoint : `GET /projects/:id/report/xlsx` (auth requis, isolation par organisation).

Génération : `apps/api/src/reports/report-xlsx.ts`, via [ExcelJS](https://github.com/exceljs/exceljs).
Le classeur reprend un-pour-un les feuilles du moteur ; aucune règle métier n’est
réimplémentée côté export.

Structure du classeur :

- **Hypothèses** — un driver par ligne, label + valeur brute + unité.
- Une feuille par feuille moteur (`activite`, `plan_financement`, `tresorerie`,
  `projection`, `financement`, `ratios`) avec un label français lisible.
- **Métadonnées** — organisation, pays, projet, template, devise, cadre fiscal,
  avertissement du ParameterPack, date de génération.

Comportement des formules DSL → Excel :

- Les identifiants du DSL (drivers, lignes) sont substitués par leur référence
  de cellule qualifiée (`prix_unitaire` → `'Hypothèses'!B2`).
- Les fonctions Excel natives sont préservées avec la même signature :
  `MAX`, `MIN`, `IF`, `IFERROR`, `ABS`, `ROUND`, `SUM`, `AND`, `OR`, `NOT`
  (mathématiques + logique) ainsi que `PMT`, `PV`, `FV`, `NPV`, `IRR`
  (financières). Elles sont normalisées en majuscules par convention Excel.
- Fallback : si un identifiant ne peut pas être résolu (cas défensif, ne
  devrait pas arriver après compilation moteur), la valeur brute calculée est
  écrite à la place — jamais une formule cassée n’est produite.
- Chaque cellule à formule embarque également le résultat pré-calculé
  (`result`) pour que les visionneuses qui ne recalculent pas affichent
  quand même la bonne valeur.
- La feuille `ratios` colore chaque ligne en vert / orange / rouge selon le
  feu tricolore fourni par le moteur, sur la base des seuils du ParameterPack.

Sécurité : les labels et valeurs numériques sont assignés via
`cell.value = …`, jamais concaténés dans une chaîne de formule, ce qui empêche
toute injection de formule depuis une entrée utilisateur.

## Word

Prévu après stabilisation des rapports PDF/Excel. Le format vise les dossiers narratifs modifiables, sans devenir une seconde implémentation des calculs.

## Dossier bancaire

Structure configurable : présentation, promoteurs, Canvas, marché, hypothèses, financement demandé, états, ratios, risques, garanties et annexes. Les exigences d’une banque spécifique sont des templates versionnés.

## Sécurité

Exports générés en tâche isolée, analysés, stockés chiffrés, accessibles par URL courte signée, expirables et journalisés. Les modèles empêchent l’injection de formules depuis des entrées utilisateur.

## Reproductibilité

Deux exports du même format, moteur, données et template doivent produire les mêmes valeurs. Les différences non déterministes comme l’horodatage sont isolées.
