# @lalanda/engine

Cœur du produit : compilateur DSL de templates, graphe de dépendances, moteur d'évaluation (HyperFormula), générateur `.xlsx` (ExcelJS) et lecteur d'import (SheetJS).

## Statut

**S0** — squelette. Le contenu réel arrive en S1 (moteur) et S2 (export + golden files).

## Principes (brief §3, §5, §7, §10)

- **Une seule source de vérité pour les formules.** Toute formule vit ici, jamais dupliquée en front, jamais réécrite à la main dans le générateur Excel.
- **Formules Excel natives** dans les `.xlsx` exportés. Aucun nombre en dur.
- **Graphe acyclique** obligatoire. Refus du template en cas de cycle, avec affichage du cycle.
- **Fonctions custom** implémentées deux fois : HyperFormula (évaluation TS) et formule Excel équivalente.
- **Golden files** dans `__golden__/<slug>/` avec round-trip LibreOffice vérifié en CI, tolérance 0,01.

## Modules attendus

- `dsl/` — schéma Zod du DSL, parseur YAML, validation.
- `compiler/` — DSL → graphe HyperFormula, détection de cycle, résolution des dépendances.
- `evaluator/` — évaluation d'un scénario, extraction des agrégats.
- `excel/` — sérialisation graphe → workbook ExcelJS avec formules natives.
- `import/` — lecture SheetJS + diff sur les cellules modifiées.
- `functions/` — fonctions custom (paire HyperFormula + équivalent Excel).
- `__golden__/` — fixtures + tests de round-trip.

## Dépendances

- `hyperformula` — moteur de calcul headless.
- `exceljs` — écriture `.xlsx`.
- `yaml` — parseur DSL YAML.
- `zod` — validation du DSL.
- `@lalanda/shared` — Money, types communs.

L'import Excel utilisera `xlsx` (SheetJS), ajouté au sprint concerné.
