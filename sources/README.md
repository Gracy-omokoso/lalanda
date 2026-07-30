# Sources fondatrices — LECTURE SEULE

Ce dossier contient les **sources historiques immuables** du produit Lalanda.

**Règle absolue** (`docs/20-CLAUDE-CODE.md:42` + `docs/SOURCES-ET-TRACABILITE.md:13`) :

> Ne jamais modifier les fichiers de ce dossier.

Toute évolution passe par un ADR qui documente pourquoi la source directrice a été superseded, jamais par un patch silencieux du fichier original.

## Contenu

- `brief/lalanda-brief.md` — brief fondateur (charte produit, stack figée, plan de sprints). Voir [`docs/00-CHARTE-PRODUIT.md`](../docs/00-CHARTE-PRODUIT.md).
- `classeur/lalanda-classeur.xlsx` — classeur Excel de référence (feuilles « Données à saisir », « Plan financier SUCCESS », « Besoin »). Sert de source aux golden files du moteur financier (`packages/engine/__golden__/`).

## Traçabilité

Chaque exigence dérivée d'une source citera obligatoirement :

- le fichier source ;
- la ligne (markdown) ou la cellule/plage (Excel : `feuille!A1:C10`).

Voir `docs/SOURCES-ET-TRACABILITE.md` pour le format complet.
