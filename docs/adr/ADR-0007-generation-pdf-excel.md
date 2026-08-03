# ADR-0007 — Génération PDF/Excel : ExcelJS + Puppeteer

Statut : Accepted (mis à jour 2026-07-31 — SheetJS retiré, voir ADR-0010)
Date : 2026-07-30 (révisé 2026-07-31)
Décideurs : Gracy Omokoso

## Contexte

Le brief §4 imposait initialement :
- **ExcelJS** pour la génération `.xlsx` (formules natives, styles, validation, graphiques).
- ~~**SheetJS (`xlsx`)** pour la lecture et le diff à l'import.~~ ← retiré par ADR-0010
- **Puppeteer** pour le rendu HTML → PDF.

`docs/23-RAPPORTS-EXPORTS.md` et brief §11 S8 précisent la mise en page attendue par les banques RDC (Rawbank, Equity BCDC, TMB, PADMPME).

**Mise à jour 2026-07-31 :** l'ADR-0010 fige que **l'Excel est export-only**. Toute la partie « lecture Excel » et « import » est supprimée du périmètre. SheetJS n'est plus nécessaire.

## Décision

- **Écriture Excel** : ExcelJS avec formules Excel natives (aucun nombre en dur, brief §3-2).
- **PDF** : Puppeteer (rendu Next.js dédié → PDF) exécuté en tâche BullMQ.
- **Validation** : test de round-trip via **LibreOffice headless** (`soffice --headless --convert-to csv`) en CI, tolérance 0,01 (brief §10). Le round-trip vérifie que les formules exportées calculent bien les mêmes valeurs que le moteur — il ne s'agit pas de réimporter dans Lalanda.

## Ce qui n'est PAS retenu

- **SheetJS (`xlsx`)** — retiré. Lalanda ne lit jamais de fichier `.xlsx` produit ou modifié par un utilisateur. Voir ADR-0010.
- L'import de relevés bancaires CSV/OFX/Mobile Money (brief §11 S13) reste dans le périmètre mais **n'utilise pas SheetJS** — ce sont d'autres formats, traités par leur propre pipeline.

## Conséquences

- La CI installe `libreoffice-calc` et `puppeteer` (Chromium managé).
- Les golden files vivent dans `packages/engine/__golden__/<slug>/`.
- Aucune dépendance `xlsx` (SheetJS) dans le projet.
- Simplification importante du périmètre : pas de gestion de diff cellules, pas de détection d'altération de formules, pas de politique de merge post-import.

## Alternative rejetée

**ExcelJS + Playwright** — Playwright a un runner de test plus riche mais Puppeteer est spécifié par le brief et suffit pour le rendu PDF unique.

## Liens

- `sources/brief/lalanda-brief.md` §4, §10, §11 S2/S8 (S11 superseded par ADR-0010)
- `docs/adr/ADR-0010-excel-export-only.md`
- `docs/23-RAPPORTS-EXPORTS.md`
- `docs/18-TESTS.md`
