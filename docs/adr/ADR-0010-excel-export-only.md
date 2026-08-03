# ADR-0010 — Excel : export uniquement, saisie exclusivement dans Lalanda

Statut : Accepted
Date : 2026-07-31
Décideurs : Gracy Omokoso

## Contexte

Le brief §11 S11 prévoyait un **aller-retour Excel complet** : l'utilisateur exporte, modifie le fichier hors ligne, réimporte, et Lalanda applique un diff. Ce parcours a été justifié par la connectivité faible et la préférence tableur de certains utilisateurs.

Gracy a clarifié le 2026-07-31 : *« lalanda permet évidemment de télécharger certains états »* — l'Excel est un **artefact de sortie**, pas un canal de saisie. Toute donnée entre par l'interface Lalanda (wizard, drivers, formulaires réalisé).

## Décision

- **Excel = sortie uniquement.** Aucun import de `.xlsx` produit par Lalanda ou modifié par l'utilisateur.
- **Toute saisie se fait dans Lalanda** (web).
- Le `classeur.xlsx` fourni dans `sources/classeur/` reste **source de conception** (structure des états, formules, KPIs à reproduire), pas une pièce runtime.
- L'import de **relevés bancaires** (CSV / OFX / Mobile Money) pour alimenter `actualEntries` (brief §11 S13) **reste dans le périmètre** — il ne s'agit pas d'Excel Lalanda, mais de fichiers bancaires standards.

## Conséquences

- **ADR-0007** est mis à jour : SheetJS retiré du stack. Seuls **ExcelJS** (écriture) et **Puppeteer** (PDF) restent.
- **Brief §11 S11** est **superseded** — le sprint « aller-retour Excel » est retiré du roadmap.
- `packages/engine` n'aura jamais de module `import/` pour Excel.
- La stratégie de connectivité faible est repensée : **PWA offline-first** (brief §11 S14 le prévoit déjà) devient le mécanisme principal, avec queue locale des saisies.
- Simplification importante : plus besoin de gérer la détection de diff cellules, la préservation des styles, ou la garantie de recalcul après import.

## Alternative rejetée

**Conserver le round-trip Excel.** Rejetée : contredit la philosophie produit (Lalanda est l'outil, pas Excel), double la surface de bugs (import Excel = énorme surface d'attaque et de cas limites), et va à l'encontre du principe brief §3 (une seule source de vérité pour les calculs — les formules Excel de retour ne le seraient pas).

## Liens

- `sources/brief/lalanda-brief.md` §11 S11 (superseded)
- `docs/adr/ADR-0007-generation-pdf-excel.md` (mis à jour)
- `docs/00-CHARTE-PRODUIT.md`
