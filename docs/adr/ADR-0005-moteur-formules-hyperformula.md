# ADR-0005 — Moteur de formules : HyperFormula

Statut : Accepted
Date : 2026-07-30
Décideurs : Gracy Omokoso

## Contexte

Le brief §4 impose **HyperFormula** (MIT/GPL, headless, compatible formules Excel). C'est la clé de voûte du principe architectural du brief §3 :

- une seule source de vérité pour les calculs (`packages/engine`) ;
- les `.xlsx` exportés contiennent les **formules Excel natives**, pas des valeurs figées ;
- traduction identique DSL → formule Excel obligatoire (brief §7).

## Décision

- **HyperFormula** comme moteur d'évaluation dans `packages/engine`.
- Le compilateur DSL produit un **graphe acyclique** (échec en CI sinon).
- Chaque fonction custom du DSL est implémentée **deux fois** : comme fonction custom HyperFormula (évaluation TS) **et** comme formule Excel équivalente (export).
- Sérialisation graphe → ExcelJS avec préservation des formules.

## Conséquences

- Une suite de **golden files** (brief §10) vérifie que le `.xlsx` recalculé par LibreOffice headless donne les mêmes valeurs que le moteur (tolérance 0,01).
- La CI installe `libreoffice-calc` pour ce test de round-trip.

## Alternative rejetée

**Moteur TS pur maison** — plus contrôlable mais impose de réimplémenter toutes les fonctions Excel. Rejeté par le brief.

## Liens

- `sources/brief/lalanda-brief.md` §3, §4, §7, §10
- `docs/21-MOTEUR-FINANCIER.md`
- HyperFormula : https://hyperformula.handsontable.com/
